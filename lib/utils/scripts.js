"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createP2SHRedeemScript = createP2SHRedeemScript;
exports.parseScriptData = exports.parseScript = exports.parseP2SH = exports.parseP2PKH = exports.getPushData = void 0;
var _lodash = _interopRequireDefault(require("lodash"));
var _bitcoreLib = require("bitcore-lib");
var _p2pkh = _interopRequireDefault(require("../models/p2pkh"));
var _p2sh = _interopRequireDefault(require("../models/p2sh"));
var _script_data = _interopRequireDefault(require("../models/script_data"));
var _helpers = _interopRequireDefault(require("./helpers"));
var _buffer = require("./buffer");
var _errors = require("../errors");
var _opcodes = require("../opcodes");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Parse P2PKH output script
 *
 * @param {Buffer} buff Output script
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2PKH} P2PKH object
 */
const parseP2PKH = (buff, network) => {
  let timelock = null;
  let offset = 0;

  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  let scriptBuf = _lodash.default.clone(buff);
  if (scriptBuf.length === 31) {
    // There is timelock in this script
    // First byte is len, which is always 4 bytes
    [timelock, scriptBuf] = (0, _buffer.unpackToInt)(4, false, scriptBuf.slice(1));
    offset = 1;
  } else if (scriptBuf.length !== 25) {
    // It's not a P2PKH
    throw new _errors.ParseScriptError('Invalid output script.');
  }
  const [addressHash] = (0, _buffer.unpackLen)(20, scriptBuf.slice(3 + offset));
  return new _p2pkh.default(_helpers.default.encodeAddress(addressHash, network), {
    timelock
  });
};

/**
 * Parse P2SH output script
 *
 * @param {Buffer} buff Output script
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2SH} P2PKH object
 */
exports.parseP2PKH = parseP2PKH;
const parseP2SH = (buff, network) => {
  let timelock = null;
  let offset = 0;

  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  let scriptBuf = _lodash.default.clone(buff);
  if (scriptBuf.length === 29) {
    // There is timelock in this script
    // First byte is len, which is always 4 bytes
    [timelock, scriptBuf] = (0, _buffer.unpackToInt)(4, false, scriptBuf.slice(1));
    offset = 1;
  } else if (scriptBuf.length !== 23) {
    // It's not a P2PKH
    throw new _errors.ParseScriptError('Invalid output script.');
  }
  const [scriptHash] = (0, _buffer.unpackLen)(20, scriptBuf.slice(2 + offset));
  return new _p2sh.default(_helpers.default.encodeAddressP2SH(scriptHash, network), {
    timelock
  });
};

/**
 * Parse Data output script
 *
 * @param {Buffer} buff Output script
 *
 * @return {ScriptData} ScriptData object
 */
exports.parseP2SH = parseP2SH;
const parseScriptData = buff => {
  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  const scriptBuf = _lodash.default.clone(buff);
  if (scriptBuf.length < 2) {
    // At least 1 byte for len data and 1 byte for OP_CHECKSIG
    throw new _errors.ParseScriptError('Invalid output script. Script must have at least 2 bytes.');
  }

  // The expected len will be at least 2 bytes
  // 1 for the script len and 1 for the OP_CHECKSIG in the end
  let expectedLen = 2;
  let dataBytesLen;

  // If we have OP_PUSHDATA1 as first byte, the second byte has the length of data
  // otherwise, the first byte already has the length of data
  if (scriptBuf[0] === _opcodes.OP_PUSHDATA1[0]) {
    expectedLen += 1;
    // eslint-disable-next-line prefer-destructuring -- Destructuring would make this harder to read
    dataBytesLen = scriptBuf[1];
  } else {
    // eslint-disable-next-line prefer-destructuring -- Destructuring would make this harder to read
    dataBytesLen = scriptBuf[0];
  }

  // Set the expected length
  expectedLen += dataBytesLen;
  if (expectedLen !== scriptBuf.length) {
    // The script has different qty of bytes than expected
    throw new _errors.ParseScriptError(`Invalid output script. Expected len ${expectedLen} and received len ${scriptBuf.length}.`);
  }
  if (scriptBuf[expectedLen - 1] !== _opcodes.OP_CHECKSIG[0]) {
    // Last byte must be an OP_CHECKSIG
    throw new _errors.ParseScriptError('Invalid output script. Last byte must be OP_CHECKSIG.');
  }

  // Get data from the script
  const data = getPushData(scriptBuf);
  let decodedData;
  try {
    decodedData = data.toString('utf-8');
  } catch (e) {
    throw new _errors.ParseScriptError('Invalid output script. Error decoding data to utf-8.');
  }
  return new _script_data.default(decodedData);
};

/**
 * Parse buffer to data decoding pushdata opcodes
 *
 * @param {Buffer} buff Buffer to get pushdata
 *
 * @return {Buffer} Data extracted from buffer
 */
exports.parseScriptData = parseScriptData;
const getPushData = buff => {
  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  const scriptBuf = _lodash.default.clone(buff);
  if (scriptBuf.length === 0) {
    throw new _errors.ParseError('Invalid buffer.');
  }
  let lenData;
  let start;
  if (scriptBuf[0] > 75) {
    // eslint-disable-next-line prefer-destructuring -- Destructuring would make this harder to read
    lenData = scriptBuf[1];
    start = 2;
  } else {
    // eslint-disable-next-line prefer-destructuring -- Destructuring would make this harder to read
    lenData = scriptBuf[0];
    start = 1;
  }
  return scriptBuf.slice(start, start + lenData);
};

/**
 * Create a P2SH MultiSig redeem script
 *
 * @param {string[]} xpubs The list of xpubkeys involved in this MultiSig
 * @param {number} numSignatures Minimum number of signatures to send a
 * transaction with this MultiSig
 * @param {number} index Index to derive the xpubs
 *
 * @return {Buffer} A buffer with the redeemScript
 * @throws {XPubError} In case any of the given xpubs are invalid
 */
exports.getPushData = getPushData;
function createP2SHRedeemScript(xpubs, numSignatures, index) {
  let sortedXpubs;
  try {
    sortedXpubs = _lodash.default.sortBy(xpubs.map(xp => new _bitcoreLib.HDPublicKey(xp)), xpub => {
      return xpub.publicKey.toString('hex');
    });
  } catch (e) {
    throw new _errors.XPubError('Invalid xpub');
  }

  // xpub comes derived to m/45'/280'/0'
  // Derive to m/45'/280'/0'/0/index
  const pubkeys = sortedXpubs.map(xpub => xpub.deriveChild(0).deriveChild(index).publicKey);

  // bitcore-lib sorts the public keys by default before building the script
  // noSorting prevents that and keeps our order
  const redeemScript = _bitcoreLib.Script.buildMultisigOut(pubkeys, numSignatures, {
    noSorting: true
  });
  return redeemScript.toBuffer();
}

/**
 * Parse script to get an object corresponding to the script data
 *
 * @param {Buffer} script Output script to parse
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2PKH | P2SH | ScriptData | null} Parsed script object
 */
const parseScript = (script, network) => {
  // It's still unsure how expensive it is to throw an exception in JavaScript. Some languages are really
  // inefficient when it comes to exceptions while others are totally efficient. If it is efficient,
  // we can keep throwing the error. Otherwise, we should just return null
  // because this method will be used together with others when we are trying to parse a given script.

  try {
    let parsedScript;
    if (_p2pkh.default.identify(script)) {
      // This is a P2PKH script
      parsedScript = parseP2PKH(script, network);
    } else if (_p2sh.default.identify(script)) {
      // This is a P2SH script
      parsedScript = parseP2SH(script, network);
    } else {
      // defaults to data script
      parsedScript = parseScriptData(script);
    }
    return parsedScript;
  } catch (error) {
    if (error instanceof _errors.ParseError) {
      // We don't know how to parse this script
      return null;
    }
    throw error;
  }
};
exports.parseScript = parseScript;