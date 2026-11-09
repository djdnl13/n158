// Boots a real HTTP server through ProcessHandler -> ExpressServer -> modelMongoTransaction ->
// MongoModel (with a fake callback-style db) and checks the observable HTTP behavior.
// Run: node test/http-pipeline.test.js
process.env.NODE_ENV = 'test'; // express logs expected errors (e.g. the 413 case) unless NODE_ENV=test
var assert = require('assert');
var http = require('http');
var ProcessHandler = require('../classes').ProcessHandler;
var MongoModel = require('../classes').MongoModel;
var ExpressServer = require('../classes').ExpressServer;
var modelMongoTransaction = require('../http-pipeline-handlers').modelMongoTransaction;
var deferResponse = require('../services').deferResponse;

// Fake db with the callback API of the mongodb 3.x driver that MongoModel uses.
var store = {};
var createdIndexes = [];
var fakeDb = {
    collection: function (name) {
        return {
            createIndex: function (key, options) { createdIndexes.push({ name: name, key: key, options: options }); },
            insertOne: function (doc, cb) { store[name] = (store[name] || []).concat([doc]); cb(null, { ops: [doc] }); },
            findOne: function (q, cb) { cb(null, (store[name] || [])[0] || null); }
        };
    }
};

// Subclass written the way Babel 6 (es2015) compiles `class X extends MongoModel`, which is
// what older consumers ship: it CALLS the parent constructor. That only works while n158's
// classes are compiled to ES5 functions; a native class would throw
// "Class constructor MongoModel cannot be invoked without 'new'". Keep this test.
function ThingModel (db) {
    MongoModel.call(this, db, 'thing',
        { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        { indexes: [{ key: { name: 1 }, options: { unique: true } }] });
}
ThingModel.prototype = Object.create(MongoModel.prototype, { constructor: { value: ThingModel } });
Object.setPrototypeOf(ThingModel, MongoModel);
ThingModel.prototype.echoParams = function (a, b, c) { var d = deferResponse(); d.resolve({ a: a, b: b, c: c }); return d.promise; };
ThingModel.prototype.fails = function () { var d = deferResponse(); d.reject(404, 'nope', { why: 'x' }); return d.promise; };
ThingModel.prototype.failsObj = function () { var d = deferResponse(); d.reject({ status: 409, details: 'conflict' }); return d.promise; };

function tx (transaction, transactionParams) {
    return { handler: modelMongoTransaction, params: { model: ThingModel, db: '$db', transaction: transaction, transactionParams: transactionParams, resolveRoute: true } };
}

var settings = {
    vars: { greeting: 'hi' },
    httpServers: [{
        name: 'api', ports: { http: 0 },
        routers: [{
            name: 'r', path: '/api',
            routes: [
                { method: 'GET', path: '/echo/:id', pipeline: [
                    { handler: function (ctx, next) { ctx.set('user', { name: 'ana' }); next(); } },
                    tx('echoParams', ['&params.id', '%user.name', '&query'])
                ] },
                { method: 'GET', path: '/fails', pipeline: [tx('fails', [])] },
                { method: 'GET', path: '/fails-obj', pipeline: [tx('failsObj', [])] },
                { method: 'GET', path: '/no-tx', pipeline: [tx('doesNotExist', [])] },
                { method: 'POST', path: '/insert', pipeline: [tx('insert', ['&body'])] },
                { method: 'GET', path: '/find', pipeline: [tx('findOne', [{}])] },
                { method: 'POST', path: '/body', pipeline: [{ handler: function (ctx, next) { next(201, { len: JSON.stringify(ctx.req.body).length }); } }] },
                { method: 'GET', path: '/skip', pipeline: [
                    { handler: function (ctx, next) { next(403, { err: 'forbidden' }); } },
                    { skipWhenErrors: true, handler: function (ctx, next) { next(200, { reached: true }); } }
                ] },
                { method: 'GET', path: '/procvar', pipeline: [
                    { params: { v: '$greeting' }, handler: function (ctx, next, finish) { finish(200, { g: ctx.processGet('greeting'), p: ctx.params }); } }
                ] }
            ]
        }]
    }]
};

var port;
var bigPort; // server from test/body-limit.settings.yaml
var logPorts = {}; // servers with logger settings (see logSettings)
var logLines = []; // request log lines captured from stdout
function wait (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function logLineFor (url) {
    return logLines.filter(function (l) { return l.indexOf(url + ' ') !== -1 || l.trim().slice(-url.length) === url; });
}
var ISO_UTC = '(\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z)';

function logServer (name, logger) {
    var srv = { name: name, ports: { http: 0 }, routers: [{ name: 'r', path: '/api', routes: [
        { method: 'GET', path: '/log-' + name, pipeline: [{ handler: function (ctx, next, finish) { finish(200, { ok: 1 }); } }] }
    ] }] };
    if (logger !== undefined) srv.logger = logger;
    return srv;
}
var logSettings = { httpServers: [
    logServer('tiny', { format: 'tiny', timestamp: true }),
    logServer('dev', { timestamp: true }),
    logServer('custom', { format: ':start-utc :method :url' }),
    logServer('off', false)
] };
function request (method, path, body, headers, toPort) {
    return new Promise(function (resolve, reject) {
        var data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
        var h = Object.assign(data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}, headers || {});
        var r = http.request({ host: '127.0.0.1', port: toPort || port, method: method, path: path, headers: h }, function (res) {
            var buf = '';
            res.on('data', function (c) { buf += c; });
            res.on('end', function () {
                var json = null;
                try { json = JSON.parse(buf); } catch (e) {}
                resolve({ status: res.statusCode, headers: res.headers, text: buf, json: json });
            });
        });
        r.on('error', reject);
        if (data !== undefined) r.write(data);
        r.end();
    });
}

var cases = [
    ['route params, request locals (%) and query (&) resolve into the transaction', async function () {
        var r = await request('GET', '/api/echo/42?x=1&y=2');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.json, { a: '42', b: 'ana', c: { x: '1', y: '2' } });
    }],
    ['deferResponse.reject(status, details, err) shape', async function () {
        var r = await request('GET', '/api/fails');
        assert.strictEqual(r.status, 404);
        assert.deepStrictEqual(r.json, { status: 404, details: 'nope', error: { why: 'x' } });
    }],
    ['deferResponse.reject({status, details}) shape', async function () {
        var r = await request('GET', '/api/fails-obj');
        assert.strictEqual(r.status, 409);
        assert.deepStrictEqual(r.json, { status: 409, details: 'conflict', error: {} });
    }],
    ['deferResponse.reject without status throws', async function () {
        assert.throws(function () { deferResponse().reject({ details: 'x' }); }, /Missing status attribute/);
    }],
    ['unknown transaction -> 404', async function () {
        var r = await request('GET', '/api/no-tx');
        assert.strictEqual(r.status, 404);
        assert.strictEqual(r.text, 'Model transaction not found');
    }],
    ['MongoModel.insert validates against the JSON schema', async function () {
        var r = await request('POST', '/api/insert', { nope: 1 });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.json.details, 'Validation error');
        assert.strictEqual(r.json.error.error[0].argument, 'name');
    }],
    ['MongoModel.insert / findOne round trip', async function () {
        var r = await request('POST', '/api/insert', { name: 'boat' });
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.json, { name: 'boat' });
        var f = await request('GET', '/api/find');
        assert.deepStrictEqual(f.json, { name: 'boat' });
    }],
    ['MongoModel creates the declared indexes', async function () {
        assert.deepStrictEqual(createdIndexes[0], { name: 'thing', key: { name: 1 }, options: { unique: true } });
    }],
    ['JSON body under 100kb is accepted', async function () {
        var r = await request('POST', '/api/body', { s: 'a'.repeat(99 * 1000) });
        assert.strictEqual(r.status, 201);
    }],
    ['JSON body over 100kb (body-parser default) -> 413', async function () {
        var r = await request('POST', '/api/body', { s: 'a'.repeat(101 * 1024) });
        assert.strictEqual(r.status, 413);
    }],
    ['settings.yaml bodyParser.json.limit ($var) raises the JSON limit', async function () {
        var ok = await request('POST', '/api/body', { s: 'a'.repeat(900 * 1024) }, undefined, bigPort);
        assert.strictEqual(ok.status, 201);
        var tooBig = await request('POST', '/api/body', { s: 'a'.repeat(1025 * 1024) }, undefined, bigPort);
        assert.strictEqual(tooBig.status, 413);
    }],
    ['settings.yaml bodyParser.urlencoded.limit raises the urlencoded limit', async function () {
        var form = function (n) { return 's=' + 'a'.repeat(n); };
        var h = function (b) { return { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(b) }; };
        var ok = form(150 * 1024);
        assert.strictEqual((await request('POST', '/api/body', ok, h(ok), bigPort)).status, 201);
        assert.strictEqual((await request('POST', '/api/body', ok, h(ok))).status, 413); // default server: 100kb
        var tooBig = form(201 * 1024);
        assert.strictEqual((await request('POST', '/api/body', tooBig, h(tooBig), bigPort)).status, 413);
    }],
    ['an invalid bodyParser limit fails at startup (body-parser would read "1 megabyte" as 1 byte)', async function () {
        [['json', '1 megabyte'], ['json', 'lots'], ['urlencoded', '10 MB!'], ['json', -1]].forEach(function (c) {
            var bp = {}; bp[c[0]] = { limit: c[1] };
            var bad = new ProcessHandler({ httpServers: [{ name: 'bad', ports: { http: 0 }, bodyParser: bp, routers: [] }] });
            assert.throws(function () { bad.startHTTPServers(); }, new RegExp('invalid bodyParser\\.' + c[0] + '\\.limit'), JSON.stringify(c));
        });
        // limit: with no value in YAML is null (ProcessHandler can't resolve null settings, so check the class)
        assert.throws(function () { new ExpressServer({ bodyParser: { json: { limit: null } } }); }, /invalid bodyParser\.json\.limit null/);
        ['2mb', '1.5MB', '500 kb', 1048576].forEach(function (l) {
            assert.doesNotThrow(function () { new ExpressServer({ bodyParser: { json: { limit: l } } }); }, String(l));
        });
    }],
    ['urlencoded bodies are parsed', async function () {
        var r = await request('POST', '/api/body', 'a=1&b=2', { 'content-type': 'application/x-www-form-urlencoded', 'content-length': 7 });
        assert.strictEqual(r.status, 201);
        assert.deepStrictEqual(r.json, { len: JSON.stringify({ a: '1', b: '2' }).length });
    }],
    ['skipWhenErrors skips handlers after a 4xx', async function () {
        var r = await request('GET', '/api/skip');
        assert.strictEqual(r.status, 403);
        assert.deepStrictEqual(r.json, { err: 'forbidden' });
    }],
    ['$vars are substituted in pipeline params', async function () {
        var r = await request('GET', '/api/procvar');
        assert.deepStrictEqual(r.json, { g: 'hi', p: { v: 'hi' } });
    }],
    ['OPTIONS preflight answers 200 with CORS headers, no x-powered-by', async function () {
        var r = await request('OPTIONS', '/api/echo/1');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.text, 'OK');
        assert.strictEqual(r.headers['access-control-allow-origin'], '*');
        assert.strictEqual(r.headers['x-powered-by'], undefined);
    }],
    ['unknown route -> 404', async function () {
        var r = await request('GET', '/api/unknown-route');
        assert.strictEqual(r.status, 404);
    }],
    ['default logger is unchanged: morgan dev, no timestamp', async function () {
        var lines = logLineFor('/api/echo/42?x=1&y=2');
        assert.strictEqual(lines.length, 1, JSON.stringify(logLines));
        assert.ok(/^\u001b\[0mGET \/api\/echo\/42\?x=1&y=2 /.test(lines[0]), JSON.stringify(lines[0]));
    }],
    ['logger.timestamp prefixes the request start time in UTC (ISO 8601)', async function () {
        var before = Date.now();
        await request('GET', '/api/log-tiny', undefined, undefined, logPorts.tiny);
        var after = Date.now();
        await wait(50); // morgan writes when the response finishes
        var lines = logLineFor('/api/log-tiny');
        assert.strictEqual(lines.length, 1, JSON.stringify(logLines));
        var m = new RegExp('^\\[' + ISO_UTC + '\\] GET /api/log-tiny 200 ').exec(lines[0]);
        assert.ok(m, JSON.stringify(lines[0]));
        var t = Date.parse(m[1]);
        assert.ok(t >= before && t <= after, m[1] + ' not between ' + new Date(before).toISOString() + ' and ' + new Date(after).toISOString());
    }],
    ['logger.timestamp works with the default dev format', async function () {
        await request('GET', '/api/log-dev', undefined, undefined, logPorts.dev);
        await wait(50);
        var lines = logLineFor('/api/log-dev');
        assert.strictEqual(lines.length, 1, JSON.stringify(logLines));
        assert.ok(new RegExp('^\\[' + ISO_UTC + '\\] \\u001b\\[0mGET /api/log-dev ').test(lines[0]), JSON.stringify(lines[0]));
    }],
    ['custom logger.format can use the :start-utc token', async function () {
        await request('GET', '/api/log-custom', undefined, undefined, logPorts.custom);
        await wait(50);
        var lines = logLineFor('/api/log-custom');
        assert.strictEqual(lines.length, 1, JSON.stringify(logLines));
        assert.ok(new RegExp('^' + ISO_UTC + ' GET /api/log-custom\\n$').test(lines[0]), JSON.stringify(lines[0]));
    }],
    ['logger: false logs nothing', async function () {
        var r = await request('GET', '/api/log-off', undefined, undefined, logPorts.off);
        assert.strictEqual(r.status, 200);
        await wait(50);
        assert.deepStrictEqual(logLineFor('/api/log-off'), []);
    }],
    ['an invalid logger setting fails at startup', async function () {
        [['dev', /invalid logger "dev"/], [{ format: 'combind' }, /invalid logger\.format "combind"/],
            [{ format: 42 }, /invalid logger\.format 42/], [{ timestamp: 'yes' }, /invalid logger\.timestamp "yes"/]
        ].forEach(function (c) {
            assert.throws(function () { new ExpressServer({ logger: c[0] }); }, c[1], JSON.stringify(c[0]));
        });
        ['combined', 'common', 'short', 'tiny', 'dev'].forEach(function (f) {
            assert.doesNotThrow(function () { new ExpressServer({ logger: { format: f, timestamp: true } }); }, f);
        });
    }]
];

(async function () {
    // morgan logs every request to stdout: capture those lines (checked by the logger tests)
    // and keep the test output readable.
    var write = process.stdout.write.bind(process.stdout);
    process.stdout.write = function (chunk) {
        var line = String(chunk);
        if (/^(\[[^\]]+\] )?\u001b\[0m(GET|POST|OPTIONS|PUT|DELETE) /.test(line) ||
            /^\[?\d{4}-\d\d-\d\dT/.test(line)) {
            logLines.push(line);
            return true;
        }
        return write.apply(null, arguments);
    };

    var ph = new ProcessHandler(settings);
    ph.set('db', fakeDb);
    await ph.startHTTPServers();
    port = ph.httpServersMap.api.server.httpServer.address().port;

    var big = new ProcessHandler(require('path').join(__dirname, 'body-limit.settings.yaml'));
    big.set('body-length', function (ctx, next) { next(201, { len: JSON.stringify(ctx.req.body).length }); });
    await big.startHTTPServers();
    bigPort = big.httpServersMap.big.server.httpServer.address().port;

    var logs = new ProcessHandler(logSettings);
    await logs.startHTTPServers();
    Object.keys(logs.httpServersMap).forEach(function (n) { logPorts[n] = logs.httpServersMap[n].server.httpServer.address().port; });

    var passed = 0;
    for (var i = 0; i < cases.length; i++) {
        try {
            await cases[i][1]();
            passed++;
            console.log('ok - ' + cases[i][0]);
        } catch (err) {
            console.log('not ok - ' + cases[i][0]);
            console.log(err.stack);
            process.exitCode = 1;
        }
    }
    console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
    ph.httpServersMap.api.server.httpServer.close();
    big.httpServersMap.big.server.httpServer.close();
    Object.keys(logs.httpServersMap).forEach(function (n) { logs.httpServersMap[n].server.httpServer.close(); });
})().catch(function (err) {
    console.error(err);
    process.exit(1);
});
