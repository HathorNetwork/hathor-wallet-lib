/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Mining blocks on the test network from the tests, to the address a test chooses.
 *
 * The dev miner pays its blocks to an empty script, so a test that needs a block reward in a wallet
 * mines the block itself, from the fullnode's block template.
 */

import axios from 'axios';
import Output from '../../../src/models/output';
import { FULLNODE_URL } from '../configuration/test-constants';

export interface MinedBlock {
  txId: string;
  height: number;
  reward: bigint;
}

/** The best block height of the fullnode, asked for without the wallet-lib. */
export async function fullnodeHeight(): Promise<number> {
  const { data } = await axios.get(`${FULLNODE_URL}getmininginfo`);
  if (!data.success) {
    throw new Error(`The fullnode did not give its height: ${JSON.stringify(data)}`);
  }
  return data.blocks;
}

/**
 * Mines a block on top of the fullnode's best block that pays its reward to `address`. The
 * fullnode refuses a block whose parent is no longer its best block, so when the dev miner adds a
 * block first, the block is mined again from a fresh template.
 */
export async function mineBlockTo(address: string): Promise<MinedBlock> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: template } = await axios.get(`${FULLNODE_URL}get_block_template`, {
      params: { address },
    });
    const { height } = template.metadata;
    const outputs = template.outputs.map(
      (output: { value: number; token_data: number; script: string }) =>
        new Output(BigInt(output.value), Buffer.from(output.script, 'base64'), {
          tokenData: output.token_data,
        })
    );
    const data = Buffer.from(template.data, 'base64');
    const graph = Buffer.alloc(13);
    graph.writeDoubleBE(template.weight, 0);
    graph.writeUInt32BE(template.timestamp, 8);
    graph.writeUInt8(template.parents.length, 12);
    const blockWithoutNonce = Buffer.concat([
      Buffer.from([template.signal_bits, template.version, outputs.length]),
      ...outputs.flatMap((output: Output) => output.serialize()),
      graph,
      ...template.parents.map((parent: string) => Buffer.from(parent, 'hex')),
      Buffer.from([data.length]),
      data,
    ]);

    // The test network mines with weight 1, so about half the nonces solve a block. The fullnode
    // answers a nonce that does not with an error, and a block whose parent is no longer its best
    // block with `result: false`.
    let accepted: boolean | null = null;
    let lastError: unknown = null;
    for (let nonce = 0; nonce < 64 && accepted === null; nonce += 1) {
      const nonceBytes = Buffer.alloc(16);
      nonceBytes.writeUInt32BE(nonce, 12);
      const response = await axios.post(
        `${FULLNODE_URL}submit_block`,
        { hexdata: Buffer.concat([blockWithoutNonce, nonceBytes]).toString('hex') },
        { validateStatus: () => true }
      );
      if (response.status === 200) {
        accepted = response.data.result === true;
      } else {
        lastError = response.data;
      }
    }
    if (accepted === null) {
      throw new Error(
        `No nonce solved the block at height ${height}: ${JSON.stringify(lastError)}`
      );
    }

    if (accepted) {
      const { data: history } = await axios.get(
        `${FULLNODE_URL}thin_wallet/address_history?addresses[]=${address}`
      );
      const block = history.history.find((tx: { height?: number }) => tx.height === height);
      if (!block) {
        throw new Error(`The block mined at height ${height} is not in the history of ${address}`);
      }
      return { txId: block.tx_id, height, reward: outputs[0].value };
    }
  }
  throw new Error('The dev miner added a block before every block the test mined');
}
