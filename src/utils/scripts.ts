import Address from '../models/address';
import Network from '../models/network';
import helpers from '../utils/helpers';
import { unpackLen, unpackToInt } from '../utils/buffer';
import _ from 'lodash';

/**
* Parse output script
* We currently support only P2PKH
* 
* @param {Buffer} buff Output script
* @param {Network} network Network to get the address first byte parameter
*
* @return {[number | null, Address]} Timelock and address from output script
*/
export const parseOutputScript = (buff: Buffer, network: Network): [number | null, Address] => {
  // This method will work only for P2PKH scripts for now
  // The whole lib works only for this type of output script
  // We should do something similar to what we have in the full node with
  // Scripts regex verification match
  let timelock: number | null = null;
  let offset = 0;
  let scriptBuf = _.clone(buff);
  if (scriptBuf.length === 31) {
    // There is timelock in this script
    // First byte is len, which is always 4 bytes
    [timelock, scriptBuf] = unpackToInt(4, false, scriptBuf.slice(1));
    offset = 1;
  }

  let addressHash;
  [addressHash, scriptBuf] = unpackLen(20, scriptBuf.slice(3 + offset));

  return [timelock, helpers.encodeAddress(addressHash, network)];
};
