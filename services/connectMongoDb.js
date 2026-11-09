"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _q = _interopRequireDefault(require("q"));
var _mongodb = require("mongodb");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var _default = (dbUrl, dbName) => {
  var deferred = _q.default.defer();
  _mongodb.MongoClient.connect(dbUrl, function (err, client) {
    if (err) {
      deferred.reject(err);
      return;
    }
    var db = client.db(dbName);
    deferred.resolve(db);
  });
  return deferred.promise;
};
exports.default = _default;
//# sourceMappingURL=connectMongoDb.js.map