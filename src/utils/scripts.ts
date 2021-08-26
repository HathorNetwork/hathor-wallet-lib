import P2PKH from '../models/p2pkh';
import Network from '../models/network';
import helpers from '../utils/helpers';
import { unpackLen, unpackToInt } from '../utils/buffer';
import _ from 'lodash';
import { ParseScriptError } from '../errors';

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
