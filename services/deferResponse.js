"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _q = _interopRequireDefault(require("q"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var _default = () => {
  var deferred = _q.default.defer();
  var customDeferred = {};
  customDeferred.promise = deferred.promise;
  customDeferred.reject = (statusOrErr, details, err) => {
    if (typeof statusOrErr == 'number') {
      deferred.reject({
        status: statusOrErr,
        details: details,
        error: err || {}
      });
    } else {
      if (!statusOrErr.status) {
        throw Error('Missing status attribute');
      }
      deferred.reject({
        status: statusOrErr.status || 200,
        details: statusOrErr.details,
        error: statusOrErr.err || {}
      });
    }
  };
  customDeferred.resolve = data => {
    deferred.resolve(data);
  };
  return customDeferred;
};
exports.default = _default;
//# sourceMappingURL=deferResponse.js.map