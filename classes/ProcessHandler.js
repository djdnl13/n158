"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ProcessHandler = void 0;
var _ExpressServer = require("./ExpressServer");
var _jsYaml = _interopRequireDefault(require("js-yaml"));
var _path = _interopRequireDefault(require("path"));
var _fs = _interopRequireDefault(require("fs"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, e) { if ("object" != typeof t || !t) return t; var r; if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) { var i = r.call(t, e || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === e ? String : Number)(t); }
let ProcessHandler = exports.ProcessHandler = /*#__PURE__*/function () {
  function ProcessHandler(_settings) {
    _classCallCheck(this, ProcessHandler);
    this.settings = this._resolveSettingsParams(_settings);
    this.procVariablesMap = {};
    this.httpServersMap = {};
    this._setupVars();
  }
  return _createClass(ProcessHandler, [{
    key: "set",
    value: function set(key, value) {
      this.procVariablesMap[key] = value;
    }
  }, {
    key: "get",
    value: function get(key) {
      return this.procVariablesMap[key];
    }
  }, {
    key: "_resolveSettingsParams",
    value: function _resolveSettingsParams(settings) {
      if (typeof settings == 'object') {
        return settings;
      }
      if (typeof settings == 'string') {
        if (settings.match(/.yaml$/)) {
          var procSettingsPath = _path.default.resolve(settings);
          var procSettings = _jsYaml.default.safeLoad(_fs.default.readFileSync(procSettingsPath, 'utf-8'));
          return procSettings;
        }
        if (settings.match(/.json$/)) {
          var procSettingsPath = _path.default.resolve(settings);
          var procSettings = JSON.parse(_fs.default.readFileSync(procSettingsPath, 'utf-8'));
          return procSettings;
        }
        throw Error('n158 => ProcessHandler: Invalid settings file path');
        return;
      }
      throw Error('n158 => ProcessHandler: Invalid settings param');
      return;
    }
  }, {
    key: "_setupVars",
    value: function _setupVars() {
      Object.keys(this.settings.vars || {}).forEach(k => {
        this.set(k, this.settings.vars[k]);
      });
    }
  }, {
    key: "_resolveHandler",
    value: function _resolveHandler(pipelineItemData, routeSettings) {
      return (req, res, next) => {
        req.locals = req.locals || {};
        if (pipelineItemData.skipWhenErrors && req.locals.status) {
          var sType = Math.floor(req.locals.status / 100);
          if (sType == 4 || sType == 5) {
            next();
            return;
          }
        }
        var procSelf = this;
        pipelineItemData.handler({
          processGet: key => {
            return procSelf.get(key);
          },
          processSet: (key, value) => {
            return procSelf.set(key, value);
          },
          params: pipelineItemData.params || {},
          routeSettings: routeSettings,
          req: req,
          res: res,
          set: (key, value) => {
            req.locals[key] = value;
          },
          get: key => {
            return req.locals[key];
          }
        }, (status, data) => {
          req.locals.status = status;
          req.locals.data = data;
          next();
        }, (status, data) => {
          var fStatus = status || req.locals.status || 200;
          var fData = data || req.locals.data || {};
          res.status(fStatus);
          res.send(fData);
          res.end();
        });
      };
    }
  }, {
    key: "_attachHTTPServer",
    value: function _attachHTTPServer(name, serverSettings) {
      // Init server
      var server = new _ExpressServer.ExpressServer({
        bodyParser: serverSettings.bodyParser,
        logger: serverSettings.logger
      });
      this.httpServersMap[name] = {};
      this.httpServersMap[name].settings = serverSettings;
      this.httpServersMap[name].server = server;
      // Setup routers
      serverSettings.routers.forEach(routerData => {
        server.addRouter(routerData.name, routerData.path);
        routerData.routes.forEach(routeData => {
          routeData.pipeline.push({
            handler: (context, next, finish) => {
              finish();
            }
          });
          routeData.pipeline.forEach(pipelineItemData => {
            var handlerSetup = {
              method: routeData.method,
              path: routeData.path
            };
            if (pipelineItemData.staticsPath) {
              handlerSetup.staticsPath = pipelineItemData.staticsPath;
            } else {
              handlerSetup.handler = this._resolveHandler(pipelineItemData, routeData);
            }
            server.addRoute(routerData.name, handlerSetup);
          });
        });
      });
    }
  }, {
    key: "_resolveSettings",
    value: function _resolveSettings(settings) {
      var VAR_CHAR = '$';
      var r = value => {
        var fValue = value;
        if (typeof value == 'string') {
          if (value[0] == VAR_CHAR) {
            fValue = this.get(value.substring(1, value.length));
          }
        } else if (typeof value == 'object') {
          if (!Array.isArray(value)) {
            Object.keys(value).forEach(k => {
              value[k] = r(value[k]);
            });
          } else {
            value = value.map(item => {
              return r(item);
            });
          }
        }
        return fValue;
      };
      return r(settings);
    }
  }, {
    key: "_setupHTTPServers",
    value: function _setupHTTPServers() {
      var settings = this._resolveSettings(this.settings);
      settings.httpServers.forEach(httpServerData => {
        this._attachHTTPServer(httpServerData.name, httpServerData);
      });
    }
  }, {
    key: "startHTTPServers",
    value: function startHTTPServers(credentials) {
      this._setupHTTPServers();
      return Promise.all(Object.keys(this.httpServersMap).map(serverName => {
        var buffServer = this.httpServersMap[serverName].server;
        var buffServerSettings = this.httpServersMap[serverName].settings;
        return new Promise(resolve => {
          buffServer.start(buffServerSettings.ports.http, buffServerSettings.ports.https, credentials).then(ports => {
            resolve({
              serverName: serverName,
              ports: ports
            });
          });
        });
      }));
    }
  }, {
    key: "startDaemons",
    value: function startDaemons() {}
  }]);
}();
//# sourceMappingURL=ProcessHandler.js.map