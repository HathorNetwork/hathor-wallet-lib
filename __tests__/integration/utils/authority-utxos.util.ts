/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type Network from '../../../src/models/network';
import type Output from '../../../src/models/output';
import P2PKH from '../../../src/models/p2pkh';
import { TOKEN_MELT_MASK, TOKEN_MINT_MASK } from '../../../src/constants';
import transaction from '../../../src/utils/transaction';

/**
 * Asserts that the mint and melt authority outputs in `outputs` are routed
 * to `mintAddress` and `meltAddress` respectively, and that no extra
 * authority outputs are present.
 *
 * Used by fullnode-side tests that verify authority routing through
 * `parseScript(network)` on raw `Output` buffers — a code path the
 * wallet-service facade exposes differently (via `getUtxoFromId`).
 */
export function expectAuthoritiesRoutedTo(
  outputs: Output[],
  network: Network,
  expected: { mintAddress: string; meltAddress: string }
): void {
  const authorityOutputs = outputs.filter(o =>
    transaction.isAuthorityOutput({ token_data: o.tokenData })
  );
  expect(authorityOutputs).toHaveLength(2);

  const [mintOutput] = authorityOutputs.filter(o => o.value === TOKEN_MINT_MASK);
  const mintScript = mintOutput.parseScript(network);
  expect(mintScript).toBeInstanceOf(P2PKH);
  expect((mintScript as P2PKH).address.base58).toEqual(expected.mintAddress);

  const [meltOutput] = authorityOutputs.filter(o => o.value === TOKEN_MELT_MASK);
  const meltScript = meltOutput.parseScript(network);
  expect(meltScript).toBeInstanceOf(P2PKH);
  expect((meltScript as P2PKH).address.base58).toEqual(expected.meltAddress);
}
