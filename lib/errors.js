"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Possible errors to be thrown in wallet
 *
 * @namespace Errors
 */

/**
 * Error thrown when address is invalid
 *
 * @memberof Errors
 * @inner
 */
var AddressError = exports.AddressError = function (_Error) {
  _inherits(AddressError, _Error);

  function AddressError() {
    _classCallCheck(this, AddressError);

    return _possibleConstructorReturn(this, (AddressError.__proto__ || Object.getPrototypeOf(AddressError)).apply(this, arguments));
  }

  return AddressError;
}(Error);

/**
 * Error thrown when output value is invalid
 *
 * @memberof Errors
 * @inner
 */


var OutputValueError = exports.OutputValueError = function (_Error2) {
  _inherits(OutputValueError, _Error2);

  function OutputValueError() {
    _classCallCheck(this, OutputValueError);

    return _possibleConstructorReturn(this, (OutputValueError.__proto__ || Object.getPrototypeOf(OutputValueError)).apply(this, arguments));
  }

  return OutputValueError;
}(Error);