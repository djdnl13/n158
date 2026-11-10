import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import q from 'q';

// body-parser silently reads some typos as bytes ('1 megabyte' -> 1 byte), so check limits
// here: a number of bytes, or a number followed by b, kb, mb or gb ('500kb', '1.5mb').
var LIMIT = /^\d+(\.\d+)?\s*(b|kb|mb|gb)$/i;
function checkLimit (name, opts) {
    if (!opts || opts.limit === undefined) return;
    var l = opts.limit;
    if (!(typeof l === 'number' && l >= 0) && !(typeof l === 'string' && LIMIT.test(l))) {
        throw new Error('n158 => ExpressServer: invalid bodyParser.' + name + '.limit ' + JSON.stringify(l) +
            " (use bytes or a size like '500kb', '1mb')");
    }
}

// Request logging. options.logger:
//   omitted          -> morgan('dev'), as before
//   false            -> no request log
//   { format, timestamp }
//     format: 'dev' (default), 'combined', 'common', 'short', 'tiny', or a custom morgan
//             format string (must contain a :token, e.g. ':start-utc :method :url :status')
//     timestamp: true prefixes each line with the request start time in UTC, ISO 8601:
//             [2026-11-09T21:48:03.512Z] GET /api/x 200 4.123 ms - 15
var LOG_FORMATS = ['combined', 'common', 'dev', 'short', 'tiny'];
// morgan records req._startTime (a Date) when the request reaches its middleware.
morgan.token('start-utc', function (req) {
    return req._startTime ? req._startTime.toISOString() : '-';
});
function createLogger (opts) {
    if (opts === false) return null;
    if (opts === undefined || opts === true) opts = {};
    if (typeof opts !== 'object' || Array.isArray(opts)) {
        throw new Error('n158 => ExpressServer: invalid logger ' + JSON.stringify(opts) + ' (use false or { format, timestamp })');
    }
    var format = opts.format === undefined ? 'dev' : opts.format;
    // A typo such as 'combind' would otherwise be printed literally as every log line.
    if (typeof format !== 'string' || (LOG_FORMATS.indexOf(format) === -1 && format.indexOf(':') === -1)) {
        throw new Error('n158 => ExpressServer: invalid logger.format ' + JSON.stringify(format) +
            ' (use ' + LOG_FORMATS.join(', ') + ' or a format string with :tokens)');
    }
    if (opts.timestamp !== undefined && typeof opts.timestamp !== 'boolean') {
        throw new Error('n158 => ExpressServer: invalid logger.timestamp ' + JSON.stringify(opts.timestamp) + ' (use true or false)');
    }
    if (!opts.timestamp) return morgan(format);
    var named = LOG_FORMATS.indexOf(format) !== -1 ? morgan[format] : format;
    var line = typeof named === 'function' ? named : morgan.compile(named);
    return morgan(function (tokens, req, res) {
        var l = line(tokens, req, res);
        return l == null ? l : '[' + tokens['start-utc'](req, res) + '] ' + l;
    });
}

export class ExpressServer {
    
    // options.bodyParser.json / options.bodyParser.urlencoded are passed to body-parser
    // (e.g. { limit: '1mb' }). Without them the defaults are unchanged: 100kb limits and
    // urlencoded extended: false. An invalid limit throws here, at startup.
    // options.logger: see createLogger above.
    constructor (options) {
        var bodyParserOptions = (options && options.bodyParser) || {};
        checkLimit('json', bodyParserOptions.json);
        checkLimit('urlencoded', bodyParserOptions.urlencoded);
        var logger = createLogger(options ? options.logger : undefined);
        this.app = express();
        this.app.use(compression());
        this.app.use(bodyParser.urlencoded(Object.assign({ extended: false }, bodyParserOptions.urlencoded)));
        this.app.use(bodyParser.json(Object.assign({}, bodyParserOptions.json)));
        this.app.use(cookieParser());
        this.app.disable('x-powered-by');
        if (logger) this.app.use(logger);
        this.app.use(function (req, res, next) {
            req.startTimestamp = Date.now();
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
            if ('OPTIONS' == req.method) res.status(200).send('OK');
            else next();
        });
        this.httpServer = http.Server(this.app);
        this.routersMap = {};
    }

    addRouter (name, pth) {
        this.routersMap[name] = express.Router();
        this.app.use(pth, this.routersMap[name]);
    }

    addRoute (routerName, routeData) {
        // Statics handler
        if (routeData.staticsPath) {
            this.routersMap[routerName].use(
                routeData.path, express.static(routeData.staticsPath)
            );
        }
        // Regular handler
        else {
            this.routersMap[routerName][
                routeData.method.toLowerCase()
            ](routeData.path, routeData.handler);
        }
    }

    startHTTPServer (httpPort) {
        var deferred = q.defer();
        this.httpServer.listen(httpPort, () => {
            deferred.resolve();
        });
        return deferred.promise;
    }

    startHTTPSServer (httpsPort, credentials) {
        var deferred = q.defer();
        this.httpsServer = https.createServer({
            key: credentials.key,
            cert: credentials.cert
        }, this.app);
        this.httpsServer.listen(httpsPort, () => {
            deferred.resolve();
        });
        return deferred.promise;
    }
    
    start (httpPort, httpsPort, credentials) {
        var deferred = q.defer();
        this.startHTTPServer(httpPort).then(() => {
            if (!httpsPort || !credentials) {
                deferred.resolve({
                    http: httpPort
                });
                return;
            }
            this.startHTTPSServer(httpsPort, credentials).then(() => {
                deferred.resolve({
                    http: httpPort,
                    https: httpsPort
                });
            })
        });
        return deferred.promise;
    }

}