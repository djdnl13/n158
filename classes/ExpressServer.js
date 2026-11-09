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
let ExpressServer = exports.ExpressServer = /*#__PURE__*/function () {
  function ExpressServer() {
    _classCallCheck(this, ExpressServer);
    this.app = (0, _express.default)();
    this.app.use((0, _compression.default)());
    this.app.use(_bodyParser.default.urlencoded({
      extended: false
    }));
    this.app.use(_bodyParser.default.json());
    this.app.use((0, _cookieParser.default)());
    this.app.disable('x-powered-by');
    this.app.use((0, _morgan.default)('dev'));
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