"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _promise_queue = _interopRequireDefault(require("../models/promise_queue"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const MAX_CONCURRENT_LOAD_TASKS = 3;
const GLL = new _promise_queue.default();
GLL.concurrent = MAX_CONCURRENT_LOAD_TASKS;
var _default = exports.default = GLL;