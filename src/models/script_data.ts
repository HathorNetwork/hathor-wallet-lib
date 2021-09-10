/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { OP_CHECKSIG } from '../opcodes';
import { util } from 'bitcore-lib';
import helpers from '../utils/helpers';
import buffer from 'buffer';

class ScriptData {
  // String of data to store on the script
  data: string;

  constructor(data: string) {
    if (!data) {
      throw Error('You must provide data.');
    }

    this.data = data;
  }

  /**
   * Create an output script from data
   * 
   * @return {Buffer}
   * @memberof ScriptData
   * @inner
   */
  createScript(): Buffer {
    const arr: Buffer[] = [];
    const dataBytes = buffer.Buffer.from(this.data, 'utf8');
    helpers.pushDataToStack(arr, dataBytes);
    arr.push(OP_CHECKSIG);
    return util.buffer.concat(arr);
  }
}

export default ScriptData;
