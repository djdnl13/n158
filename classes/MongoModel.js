"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MongoModel = void 0;
var mongodb = _interopRequireWildcard(require("mongodb"));
var _underscore = _interopRequireDefault(require("underscore"));
var _jsonschema = require("jsonschema");
var _services = require("../services");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, e) { if ("object" != typeof t || !t) return t; var r; if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) { var i = r.call(t, e || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === e ? String : Number)(t); }
var ObjectID = mongodb.ObjectID;
let MongoModel = exports.MongoModel = /*#__PURE__*/function () {
  function MongoModel(db, name, jsonSchema, options) {
    _classCallCheck(this, MongoModel);
    this.name = name;
    this.db = db;
    this.collection = db.collection(name);
    this.schema = jsonSchema || {};
    this.options = options || {};
    if (options.indexes) {
      this.createIndexes(options.indexes);
    }
  }
  return _createClass(MongoModel, [{
    key: "createIndexes",
    value: function createIndexes(indexes) {
      indexes.forEach(index => {
        this.collection.createIndex(index.key, index.options);
      });
    }
  }, {
    key: "validate",
    value: function validate(data) {
      var deferred = (0, _services.deferResponse)();
      var validationResult = (0, _jsonschema.validate)(data, this.schema);
      if (validationResult.errors.length) {
        deferred.reject(400, 'Validation error', validationResult.errors);
      } else {
        deferred.resolve(validationResult);
      }
      return deferred.promise;
    }
  }, {
    key: "insert",
    value: function insert(data) {
      var deferred = (0, _services.deferResponse)();
      this.validate(data).then(() => {
        this.collection.insertOne(data, (err, r) => {
          if (err) {
            deferred.reject(500, 'Insertion error on db', err);
            return;
          }
          deferred.resolve(r.ops[0]);
        });
      }).catch(err => {
        deferred.reject(400, 'Validation error', err);
      });
      return deferred.promise;
    }
  }, {
    key: "register",
    value: function register(data) {
      return this.insert(data);
    }
  }, {
    key: "removeById",
    value: function removeById(id) {
      var deferred = (0, _services.deferResponse)();
      this.collection.remove({
        _id: new ObjectID(id)
      }, (err, resp) => {
        if (err) {
          deferred.reject(500, 'Remove error on db', err);
          return;
        }
        deferred.resolve(resp);
      });
      return deferred.promise;
    }
  }, {
    key: "findById",
    value: function findById(id) {
      var deferred = (0, _services.deferResponse)();
      this.collection.findOne({
        _id: new ObjectID(id)
      }, (err, resp) => {
        if (err) {
          deferred.reject(500, 'Find error on db', err);
          return;
        }
        if (!resp) {
          deferred.reject(404, 'Item not found');
          return;
        }
        deferred.resolve(resp);
      });
      return deferred.promise;
    }
  }, {
    key: "rawUpdate",
    value: function rawUpdate(criteria, updateData, options) {
      options = options || {};
      var deferred = (0, _services.deferResponse)();
      this.collection.update(criteria, updateData, options, (err, resp) => {
        if (err) {
          deferred.reject(500, 'Update error on db', err);
          return;
        }
        deferred.resolve(resp);
      });
      return deferred.promise;
    }
  }, {
    key: "update",
    value: function update(id, data) {
      var deferred = (0, _services.deferResponse)();
      this.findById(id).then(instance => {
        var keys = _underscore.default.union(Object.keys(instance), Object.keys(data));
        keys.forEach(attr => {
          if (attr == '_id') return;
          if (data[attr] === null) {
            instance[attr] = null;
          } else if (data[attr] === false) {
            instance[attr] = false;
          } else if (data[attr] === 0) {
            instance[attr] = 0;
          } else {
            instance[attr] = data[attr] || instance[attr];
          }
        });
        this.collection.update({
          _id: new ObjectID(id)
        }, instance, (err, resp) => {
          if (err) {
            deferred.reject(500, 'Update error on db', err);
            return;
          }
          deferred.resolve(instance);
        });
      }).catch(err => {
        deferred.reject(err);
      });
      return deferred.promise;
    }
  }, {
    key: "findOne",
    value: function findOne(criteria) {
      var deferred = (0, _services.deferResponse)();
      this.collection.findOne(criteria, (err, r) => {
        if (err) {
          deferred.reject(500, 'Find one error on db', err);
          return;
        }
        deferred.resolve(r);
      });
      return deferred.promise;
    }
  }, {
    key: "findAll",
    value: function findAll(criteria) {
      var deferred = (0, _services.deferResponse)();
      this.collection.find(criteria, (err, r) => {
        if (err) {
          deferred.reject(500, 'Find error on db', err);
          return;
        }
        deferred.resolve(r.toArray());
      });
      return deferred.promise;
    }
  }, {
    key: "aggregate",
    value: function aggregate(pipeline, options) {
      var deferred = (0, _services.deferResponse)();
      this.collection.aggregate(pipeline, options, (err, cursor) => {
        if (err) {
          deferred.reject(500, 'Aggregate error on db', err);
          return;
        }
        cursor.get((err, data) => {
          if (err) {
            deferred.reject(500, 'Cursor error on db', err);
            return;
          }
          deferred.resolve(data);
        });
      });
      return deferred.promise;
    }
  }]);
}();
//# sourceMappingURL=MongoModel.js.map