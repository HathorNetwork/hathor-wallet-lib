/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NANO_CONTRACTS_INFO_VERSION, NANO_CONTRACTS_VERSION } from '../constants';
import Transaction from '../models/transaction';
import Input from '../models/input';
import Output from '../models/output';
import { hexToBuffer, intToBytes } from '../utils/buffer';

class NanoContract extends Transaction {
  id: string;

  method: string;

  args: Buffer[];

  pubkey: Buffer;

  signature: Buffer | null;

  constructor(
    inputs: Input[],
    outputs: Output[],
    tokens: string[],
    id: string,
    method: string,
    args: Buffer[],
    pubkey: Buffer,
    signature: Buffer | null = null
  ) {
    super(inputs, outputs, { tokens });
    this.version = NANO_CONTRACTS_VERSION;

    this.id = id;
    this.method = method;
    this.args = args;
    this.pubkey = pubkey;
    this.signature = signature;
  }

  /**
   * Serialize funds fields
   * Add the serialized fields to the array parameter
   *
   * @param {array} Array of buffer to push the serialized fields
   * @param {addInputData} If should add input data when serializing it
   *
   * @memberof NanoContract
   * @inner
   */
  serializeFundsFields(array: Buffer[], addInputData: boolean) {
    super.serializeFundsFields(array, addInputData);

    // Info version
    array.push(intToBytes(NANO_CONTRACTS_INFO_VERSION, 1));

    // nano contract id
    array.push(hexToBuffer(this.id));

    const methodBytes = Buffer.from(this.method, 'utf8');
    array.push(intToBytes(methodBytes.length, 1));
    array.push(methodBytes);

    const argsArray: Buffer[] = [];
    for (const arg of this.args) {
      argsArray.push(intToBytes(arg.length, 2));
      argsArray.push(arg);
    }

    const argsConcat: Buffer = Buffer.concat(argsArray);
    array.push(intToBytes(argsConcat.length, 2));
    array.push(argsConcat);

    array.push(intToBytes(this.pubkey.length, 1));
    array.push(this.pubkey);

    if (addInputData && this.signature !== null) {
      array.push(intToBytes(this.signature.length, 1));
      array.push(this.signature);
    } else {
      array.push(intToBytes(0, 1));
    }
  }

  /**
   * Serialize tx to bytes
   *
   * @memberof NanoContract
   * @inner
   */
  toBytes(): Buffer {
    const arr: Buffer[] = [];
    // Serialize first the funds part
    //
    this.serializeFundsFields(arr, true);

    // Graph fields
    this.serializeGraphFields(arr);

    // Nonce
    this.serializeNonce(arr);

    return Buffer.concat(arr);
  }

  /**
   * Prepare transaction to be sent
   * Update timestamp, calculate weight
   * Override Transaction's prepareToSend to add detailed logging
   *
   * @memberof NanoContract
   * @inner
   */
  prepareToSend() {
    console.log('NanoContract prepareToSend called');
    try {
      // Ensure version is set to NANO_CONTRACTS_VERSION
      if (this.version !== NANO_CONTRACTS_VERSION) {
        console.log(`Setting version to NANO_CONTRACTS_VERSION (${NANO_CONTRACTS_VERSION})`);
        this.version = NANO_CONTRACTS_VERSION;
      }
      
      // Call parent method for timestamp and weight updates
      super.prepareToSend();
      
      // Now create the raw transaction for debugging
      try {
        const arr: Buffer[] = [];
        
        console.log('Serializing funds fields');
        this.serializeFundsFields(arr, true);
        console.log('Funds fields serialized successfully');

        console.log('Serializing graph fields');
        this.serializeGraphFields(arr);
        console.log('Graph fields serialized successfully');

        console.log('Serializing nonce');
        this.serializeNonce(arr);
        console.log('Nonce serialized successfully');

        // Just print the detailed information about outputs for debugging
        console.log(`Outputs count: ${this.outputs.length}`);
        for (let i = 0; i < this.outputs.length; i++) {
          const output = this.outputs[i];
          console.log(`Output #${i} details:`, {
            value: output.value.toString(),
            scriptLength: output.script ? output.script.length : 0
          });

          if (output.script) {
            // Try to log the hex representation safely
            try {
              const scriptHex = output.script.toString('hex');
              console.log(`Output #${i} script hex: ${scriptHex}`);
            } catch (err) {
              console.error(`Error getting script hex for output #${i}:`, err);
            }
          }
        }

        // For clarity, we're not modifying the transaction here, just logging
      } catch (error) {
        console.error('Error during NanoContract debug serialization:', error);
      }
    } catch (error) {
      console.error('Error in NanoContract prepareToSend:', error);
      throw error;
    }
  }
}

export default NanoContract;
