import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import Network from '../models/network';
import helpers from '../utils/helpers';
import { unpackLen, unpackToInt } from '../utils/buffer';
import _ from 'lodash';
import { ParseError, ParseScriptError, XPubError } from '../errors';
import { OP_PUSHDATA1, OP_CHECKSIG } from '../opcodes';
import { Script, HDPublicKey } from 'bitcore-lib';

/**
 * Parse P2PKH output script
 *
 * @param {Buffer} buff Output script
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2PKH} P2PKH object
 */
export const parseP2PKH = (buff: Buffer, network: Network): P2PKH => {
  let timelock: number | null = null;
  let offset = 0;

  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  let scriptBuf = _.clone(buff);
  if (scriptBuf.length === 31) {
    // There is timelock in this script
    // First byte is len, which is always 4 bytes
    [timelock, scriptBuf] = unpackToInt(4, false, scriptBuf.slice(1));
    offset = 1;
  } else {
    if (scriptBuf.length !== 25) {
      // It's not a P2PKH
      throw new ParseScriptError('Invalid output script.');
    }
  }

  let addressHash;
  [addressHash, scriptBuf] = unpackLen(20, scriptBuf.slice(3 + offset));

  return new P2PKH(helpers.encodeAddress(addressHash, network), { timelock });
};

/**
 * Parse P2SH output script
 *
 * @param {Buffer} buff Output script
 * @param {Network} network Network to get the address first byte parameter
 *
 * @return {P2SH} P2PKH object
 */
export const parseP2SH = (buff: Buffer, network: Network): P2SH => {
  let timelock: number | null = null;
  let offset = 0;

  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  let scriptBuf = _.clone(buff);
  if (scriptBuf.length === 29) {
    // There is timelock in this script
    // First byte is len, which is always 4 bytes
    [timelock, scriptBuf] = unpackToInt(4, false, scriptBuf.slice(1));
    offset = 1;
  } else {
    if (scriptBuf.length !== 23) {
      // It's not a P2PKH
      throw new ParseScriptError('Invalid output script.');
    }
  }

  let scriptHash;
  [scriptHash, scriptBuf] = unpackLen(20, scriptBuf.slice(2 + offset));

  return new P2SH(helpers.encodeAddressP2SH(scriptHash, network), { timelock });
};

/**
 * Parse Data output script
 *
 * @param {Buffer} buff Output script
 *
 * @return {ScriptData} ScriptData object
 */
export const parseScriptData = (buff: Buffer): ScriptData => {
  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  let scriptBuf = _.clone(buff);
  if (scriptBuf.length < 2) {
    // At least 1 byte for len data and 1 byte for OP_CHECKSIG
    throw new ParseScriptError('Invalid output script. Script must have at least 2 bytes.');
  }

  // The expected len will be at least 2 bytes
  // 1 for the script len and 1 for the OP_CHECKSIG in the end
  let expectedLen = 2;
  let dataBytesLen: number;

  // If we have OP_PUSHDATA1 as first byte, the second byte has the length of data
  // otherwise, the first byte already has the length of data
  if (scriptBuf[0] === OP_PUSHDATA1[0]) {
    expectedLen += 1;
    dataBytesLen = scriptBuf[1];
  } else {
    dataBytesLen = scriptBuf[0];
  }

  // Set the expected length
  expectedLen += dataBytesLen;

  if (expectedLen !== scriptBuf.length) {
    // The script has different qty of bytes than expected
    throw new ParseScriptError(
      `Invalid output script. Expected len ${expectedLen} and received len ${scriptBuf.length}.`
    );
  }

  if (scriptBuf[expectedLen - 1] !== OP_CHECKSIG[0]) {
    // Last byte must be an OP_CHECKSIG
    throw new ParseScriptError('Invalid output script. Last byte must be OP_CHECKSIG.');
  }

  // Get data from the script
  const data = getPushData(scriptBuf);
  let decodedData: string;

  try {
    decodedData = data.toString('utf-8');
  } catch (e) {
    throw new ParseScriptError('Invalid output script. Error decoding data to utf-8.');
  }

  return new ScriptData(decodedData);
};

/**
 * Parse buffer to data decoding pushdata opcodes
 *
 * @param {Buffer} buff Buffer to get pushdata
 *
 * @return {Buffer} Data extracted from buffer
 */
export const getPushData = (buff: Buffer): Buffer => {
  // We should clone the buffer being sent in order to never mutate
  // what comes from outside the library
  let scriptBuf = _.clone(buff);

  if (scriptBuf.length === 0) {
    throw new ParseError('Invalid buffer.');
  }

  let lenData, start;

  if (scriptBuf[0] > 75) {
    lenData = scriptBuf[1];
    start = 2;
  } else {
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
export function createP2SHRedeemScript(
  xpubs: string[],
  numSignatures: number,
  index: number
): Buffer {
  let sortedXpubs: HDPublicKey[];
  try {
    sortedXpubs = _.sortBy(
      xpubs.map(xp => new HDPublicKey(xp)),
      (xpub: HDPublicKey) => {
        return xpub.publicKey.toString('hex');
      }
    );
  } catch (e) {
    throw new XPubError('Invalid xpub');
  }

  // xpub comes derived to m/45'/280'/0'
  // Derive to m/45'/280'/0'/0/index
  const pubkeys = sortedXpubs.map(xpub => xpub.deriveChild(0).deriveChild(index).publicKey);

  // bitcore-lib sorts the public keys by default before building the script
  // noSorting prevents that and keeps our order
  const redeemScript = Script.buildMultisigOut(pubkeys, numSignatures, { noSorting: true });
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
export const parseScript = (script: Buffer, network: Network): P2PKH | P2SH | ScriptData | null => {
  // It's still unsure how expensive it is to throw an exception in JavaScript. Some languages are really
  // inefficient when it comes to exceptions while others are totally efficient. If it is efficient,
  // we can keep throwing the error. Otherwise, we should just return null
  // because this method will be used together with others when we are trying to parse a given script.

  try {
    let parsedScript;
    if (P2PKH.identify(script)) {
      // This is a P2PKH script
      parsedScript = parseP2PKH(script, network);
    } else if (P2SH.identify(script)) {
      // This is a P2SH script
      parsedScript = parseP2SH(script, network);
    } else {
      // defaults to data script
      parsedScript = parseScriptData(script);
    }
    return parsedScript;
  } catch (error) {
    if (error instanceof ParseError) {
      // We don't know how to parse this script
      return null;
    } else {
      throw error;
    }
  }
};
