"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ExpressServer = void 0;
var _express = _interopRequireDefault(require("express"));
var _bodyParser = _interopRequireDefault(require("body-parser"));
var _cookieParser = _interopRequireDefault(require("cookie-parser"));
var _compression = _interopRequireDefault(require("compression"));
var _morgan = _interopRequireDefault(require("morgan"));
var _http = _interopRequireDefault(require("http"));
var _https = _interopRequireDefault(require("https"));
var _fs = _interopRequireDefault(require("fs"));
var _path = _interopRequireDefault(require("path"));
var _q = _interopRequireDefault(require("q"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, e) { if ("object" != typeof t || !t) return t; var r; if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) { var i = r.call(t, e || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === e ? String : Number)(t); }
// body-parser silently reads some typos as bytes ('1 megabyte' -> 1 byte), so check limits
// here: a number of bytes, or a number followed by b, kb, mb or gb ('500kb', '1.5mb').
var LIMIT = /^\d+(\.\d+)?\s*(b|kb|mb|gb)$/i;
function checkLimit(name, opts) {
  if (!opts || opts.limit === undefined) return;
  var l = opts.limit;
  if (!(typeof l === 'number' && l >= 0) && !(typeof l === 'string' && LIMIT.test(l))) {
    throw new Error('n158 => ExpressServer: invalid bodyParser.' + name + '.limit ' + JSON.stringify(l) + " (use bytes or a size like '500kb', '1mb')");
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
_morgan.default.token('start-utc', function (req) {
  return req._startTime ? req._startTime.toISOString() : '-';
});
function createLogger(opts) {
  if (opts === false) return null;
  if (opts === undefined || opts === true) opts = {};
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    throw new Error('n158 => ExpressServer: invalid logger ' + JSON.stringify(opts) + ' (use false or { format, timestamp })');
  }
  var format = opts.format === undefined ? 'dev' : opts.format;
  // A typo such as 'combind' would otherwise be printed literally as every log line.
  if (typeof format !== 'string' || LOG_FORMATS.indexOf(format) === -1 && format.indexOf(':') === -1) {
    throw new Error('n158 => ExpressServer: invalid logger.format ' + JSON.stringify(format) + ' (use ' + LOG_FORMATS.join(', ') + ' or a format string with :tokens)');
  }
  if (opts.timestamp !== undefined && typeof opts.timestamp !== 'boolean') {
    throw new Error('n158 => ExpressServer: invalid logger.timestamp ' + JSON.stringify(opts.timestamp) + ' (use true or false)');
  }
  if (!opts.timestamp) return (0, _morgan.default)(format);
  var named = LOG_FORMATS.indexOf(format) !== -1 ? _morgan.default[format] : format;
  var line = typeof named === 'function' ? named : _morgan.default.compile(named);
  return (0, _morgan.default)(function (tokens, req, res) {
    var l = line(tokens, req, res);
    return l == null ? l : '[' + tokens['start-utc'](req, res) + '] ' + l;
  });
}
let ExpressServer = exports.ExpressServer = /*#__PURE__*/function () {
  // options.bodyParser.json / options.bodyParser.urlencoded are passed to body-parser
  // (e.g. { limit: '1mb' }). Without them the defaults are unchanged: 100kb limits and
  // urlencoded extended: false. An invalid limit throws here, at startup.
  // options.logger: see createLogger above.
  function ExpressServer(options) {
    _classCallCheck(this, ExpressServer);
    var bodyParserOptions = options && options.bodyParser || {};
    checkLimit('json', bodyParserOptions.json);
    checkLimit('urlencoded', bodyParserOptions.urlencoded);
    var logger = createLogger(options ? options.logger : undefined);
    this.app = (0, _express.default)();
    this.app.use((0, _compression.default)());
    this.app.use(_bodyParser.default.urlencoded(Object.assign({
      extended: false
    }, bodyParserOptions.urlencoded)));
    this.app.use(_bodyParser.default.json(Object.assign({}, bodyParserOptions.json)));
    this.app.use((0, _cookieParser.default)());
    this.app.disable('x-powered-by');
    if (logger) this.app.use(logger);
    this.app.use(function (req, res, next) {
      req.startTimestamp = Date.now();
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
      if ('OPTIONS' == req.method) res.status(200).send('OK');else next();
    });
    this.httpServer = _http.default.Server(this.app);
    this.routersMap = {};
  }
  return _createClass(ExpressServer, [{
    key: "addRouter",
    value: function addRouter(name, pth) {
      this.routersMap[name] = _express.default.Router();
      this.app.use(pth, this.routersMap[name]);
    }
  }, {
    key: "addRoute",
    value: function addRoute(routerName, routeData) {
      // Statics handler
      if (routeData.staticsPath) {
        this.routersMap[routerName].use(routeData.path, _express.default.static(routeData.staticsPath));
      }
      // Regular handler
      else {
        this.routersMap[routerName][routeData.method.toLowerCase()](routeData.path, routeData.handler);
      }
    }
  }, {
    key: "startHTTPServer",
    value: function startHTTPServer(httpPort) {
      var deferred = _q.default.defer();
      this.httpServer.listen(httpPort, () => {
        deferred.resolve();
      });
      return deferred.promise;
    }
  }, {
    key: "startHTTPSServer",
    value: function startHTTPSServer(httpsPort, credentials) {
      var deferred = _q.default.defer();
      this.httpsServer = _https.default.createServer({
        key: credentials.key,
        cert: credentials.cert
      }, this.app);
      this.httpsServer.listen(httpsPort, () => {
        deferred.resolve();
      });
      return deferred.promise;
    }
  }, {
    key: "start",
    value: function start(httpPort, httpsPort, credentials) {
      var deferred = _q.default.defer();
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
        });
      });
      return deferred.promise;
    }
  }]);
}();
//# sourceMappingURL=ExpressServer.js.map