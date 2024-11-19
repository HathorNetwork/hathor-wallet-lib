"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _buffer = require("../utils/buffer");
var _helpers = _interopRequireDefault(require("../utils/helpers"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class Deserializer {
  constructor(network) {
    _defineProperty(this, "network", void 0);
    this.network = network;
  }

  /**
   * Helper method to deserialize any value from its type
   * We receive these types from the full node, so we
   * use the python syntax
   *
   * @param {value} Value to deserialize
   * @param {type} Type of the value to be deserialized
   *
   * @memberof Deserializer
   * @inner
   */
  deserializeFromType(value, type) {
    if (type.endsWith('?')) {
      // It's an optional
      const optionalType = type.slice(0, -1);
      return this.toOptional(value, optionalType);
    }
    if (type.startsWith('SignedData[')) {
      return this.toSigned(value, type);
    }
    switch (type) {
      case 'str':
        return this.toString(value);
      case 'bytes':
      case 'TxOutputScript':
      case 'TokenUid':
      case 'ContractId':
      case 'VertexId':
        return this.toBytes(value);
      case 'Address':
        return this.toAddress(value);
      case 'int':
      case 'Timestamp':
        return this.toInt(value);
      case 'Amount':
        return this.toAmount(value);
      case 'float':
        return this.toFloat(value);
      case 'bool':
        return this.toBool(value);
      default:
        throw new Error('Invalid type.');
    }
  }

  /* eslint-disable class-methods-use-this -- XXX: Methods that don't use `this` should be made static */

  /**
   * Deserialize string value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toString(value) {
    return value.toString('utf8');
  }

  /**
   * Deserialize bytes value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toBytes(value) {
    return value;
  }

  /**
   * Deserialize int value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toInt(value) {
    return (0, _buffer.unpackToInt)(4, true, value)[0];
  }

  /**
   * Deserialize amount value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toAmount(value) {
    // Nano `Amount` currently only supports up to 4 bytes, so we simply use the `number` value converted to `BigInt`.
    // If we change Nano to support up to 8 bytes, we must update this.
    return BigInt(this.toInt(value));
  }

  /**
   * Deserialize float value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toFloat(value) {
    return (0, _buffer.unpackToFloat)(value)[0];
  }

  /**
   * Deserialize boolean value
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toBool(value) {
    if (value[0]) {
      return true;
    }
    return false;
  }
  /* eslint-enable class-methods-use-this */

  /**
   * Deserialize an optional value
   *
   * First we check the first byte. If it's 0, then we return null.
   *
   * Otherwise, we deserialize the rest of the buffer to the type.
   *
   * @param {value} Buffer with the optional value
   * @param {type} Type of the optional without the ?
   *
   * @memberof Deserializer
   * @inner
   */
  toOptional(value, type) {
    if (value[0] === 0) {
      // It's an empty optional
      return null;
    }

    // Remove the first byte to deserialize the value, since it's not empty
    const valueToDeserialize = value.slice(1);
    return this.deserializeFromType(valueToDeserialize, type);
  }

  /**
   * Deserialize a signed value
   *
   * The signedData what will be deserialized is
   * [len(serializedValue)][serializedValue][inputData]
   *
   * @param {signedData} Buffer with serialized signed value
   * @param {type} Type of the signed value, with the subtype, e.g., SignedData[str]
   *
   * @memberof Deserializer
   * @inner
   */
  toSigned(signedData, type) {
    // Get signed data type inside []
    const match = type.match(/\[(.*?)\]/);
    const valueType = match ? match[1] : null;
    if (!valueType) {
      throw new Error('Unable to extract type');
    }
    let signedBuffer;
    let size;
    // [len(serializedResult)][serializedResult][inputData]
    // eslint-disable-next-line prefer-const -- To split this declaration would be confusing
    [size, signedBuffer] = (0, _buffer.unpackToInt)(2, false, signedData);
    let parsed = this.deserializeFromType(signedBuffer.slice(0, size), valueType);
    if (valueType === 'bytes') {
      // If the value is bytes, we should transform into hex to return the string
      parsed = parsed.toString('hex');
    }
    signedBuffer = signedBuffer.slice(size);
    return `${(0, _buffer.bufferToHex)(signedBuffer)},${parsed},${valueType}`;
  }

  /**
   * Deserialize a value decoded in bytes to a base58 string
   *
   * @param {value} Value to deserialize
   *
   * @memberof Deserializer
   * @inner
   */
  toAddress(value) {
    // First we get the 20 bytes of the address without the version byte and checksum
    const addressBytes = value.slice(1, 21);
    const address = _helpers.default.encodeAddress(addressBytes, this.network);
    const decoded = address.decode();
    if (decoded[0] !== value[0]) {
      throw new Error(`Asked to deserialize an address with version byte ${value[0]} but the network from the deserializer object has version byte ${decoded[0]}.`);
    }
    return address.base58;
  }
}
var _default = exports.default = Deserializer;