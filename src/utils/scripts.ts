import P2PKH from '../models/p2pkh';
import ScriptData from '../models/script_data';
import Network from '../models/network';
import helpers from '../utils/helpers';
import { unpackLen, unpackToInt } from '../utils/buffer';
import _ from 'lodash';
import { ParseError, ParseScriptError } from '../errors';
import { OP_PUSHDATA1, OP_CHECKSIG } from '../opcodes';

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
    throw new ParseScriptError('Invalid output script.');
  }

  // The expected len will be at least 2 bytes
  // 1 for the script len and 1 for the OP_CHECKSIG in the end
  let expectedLen = 2;
  let dataBytesLen;

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
    throw new ParseScriptError('Invalid output script.');
  }

  if (scriptBuf[expectedLen - 1] !== OP_CHECKSIG[0]) {
    // Last byte must be an OP_CHECKSIG
    throw new ParseScriptError('Invalid output script.');
  }

  // Get data from the script
  const data = getPushData(scriptBuf);
  let decodedData;

  try {
    decodedData = data.toString('utf-8');
  } catch (e) {
    throw new ParseScriptError('Invalid output script.');
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
}
