/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fullnode-facade API query tests: getFullTxById, getTxConfirmationData and
 * graphvizNeighborsQuery.
 *
 * The wallet-service facade implements all three methods too, proxied through
 * its own backend (`wallet/proxy/*` endpoints in src/wallet/api/walletApi.ts).
 * What keeps this file fullnode-specific are the tests bound to fullnode-only
 * contracts:
 * - The `success: false` failure paths assert the fullnode facade's plain
 *   `Invalid transaction <txId>` error (src/new/wallet.ts); the wallet-service
 *   proxy raises `WalletRequestError` with its own message instead.
 * - The graphviz transport-error case omits the required `graphType`/`maxLevel`
 *   arguments so the fullnode receives `?tx=` alone and answers HTTP 500. Both
 *   facades declare the same required arity, so this is a deliberate contract
 *   violation rather than a signature difference — but it is still fullnode-only
 *   behaviour: the proxy interpolates the missing values into its query string
 *   (src/wallet/api/walletApi.ts), sending the literal `undefined` and failing
 *   differently.
 *
 * The happy-path and `TxNotFoundError` cases are closer to shared, but are not
 * mechanically portable yet:
 * - `IWalletTestAdapter` already supports `getFullTxById` (adapters/types.ts),
 *   so that happy path could move to `shared/` today. Before promoting it,
 *   note that `spent_outputs` is required on the fullnode schema but
 *   `.optional()` on the proxy schema (src/wallet/api/schemas/walletApi.ts),
 *   and Zod strips absent optionals — so the `spent_outputs` key assertion
 *   below is not guaranteed to hold on the wallet-service side.
 * - `getTxConfirmationData` and `graphvizNeighborsQuery` are genuinely absent
 *   from the adapter interface; those cases need it to grow the methods first.
 *   `stop_value` is likewise required on the proxy schema while the fullnode
 *   documents it as optional, so confirmation data for a not-yet-confirmed
 *   transaction diverges between the facades.
 */

import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import { TxNotFoundError } from '../../../src/errors';
import HathorWallet from '../../../src/new/wallet';

/**
 * A well-formed transaction hash that is absent from the private test network.
 * Used to drive the "valid hash, no such transaction" path, as opposed to
 * `INVALID_TX_HASH` which is rejected on format alone.
 */
const NOT_FOUND_TX_HASH = '000000000bc8c6fab1b3a5af184cc0e7ff7934c6ad982c8bea9ab5006ae1bafc';

/** A malformed hash, rejected by the fullnode before any lookup happens. */
const INVALID_TX_HASH = 'invalid-tx-hash';

describe('[Fullnode] fullnode API queries', () => {
  let gWallet: HathorWallet;

  beforeAll(async () => {
    const { hWallet } = await GenesisWalletHelper.getSingleton();
    gWallet = hWallet;
  });

  afterEach(async () => {
    await stopAllWallets();
  });

  describe('getFullTxById', () => {
    it('should download an existing transaction from the fullnode', async () => {
      const hWallet = await generateWalletHelper();

      const tx1 = await GenesisWalletHelper.injectFunds(
        hWallet,
        await hWallet.getAddressAtIndex(0),
        10n
      );

      const fullTx = await hWallet.getFullTxById(tx1.hash);
      expect(fullTx.success).toStrictEqual(true);

      // Pin the identity of the returned transaction: without this the test
      // passes for any well-formed response, including one for another tx.
      expect(fullTx.tx.hash).toStrictEqual(tx1.hash);

      const fullTxKeys = Object.keys(fullTx);
      expect(fullTxKeys).toContain('meta');
      expect(fullTxKeys).toContain('tx');
      expect(fullTxKeys).toContain('success');
      expect(fullTxKeys).toContain('spent_outputs');
    });

    it('should throw an error if success is false on response', async () => {
      await expect(gWallet.getFullTxById(INVALID_TX_HASH)).rejects.toThrow(
        `Invalid transaction ${INVALID_TX_HASH}`
      );
    });

    it('should throw an error on valid but not found transaction', async () => {
      await expect(gWallet.getFullTxById(NOT_FOUND_TX_HASH)).rejects.toThrow(TxNotFoundError);
    });
  });

  describe('getTxConfirmationData', () => {
    it('should download confirmation data for an existing transaction from the fullnode', async () => {
      const hWallet = await generateWalletHelper();

      const tx1 = await GenesisWalletHelper.injectFunds(
        hWallet,
        await hWallet.getAddressAtIndex(0),
        10n
      );

      const confirmationData = await hWallet.getTxConfirmationData(tx1.hash);

      expect(confirmationData.success).toStrictEqual(true);

      const confirmationDataKeys = Object.keys(confirmationData);
      expect(confirmationDataKeys).toContain('accumulated_bigger');
      expect(confirmationDataKeys).toContain('accumulated_weight');
      expect(confirmationDataKeys).toContain('confirmation_level');
      expect(confirmationDataKeys).toContain('success');

      // Key presence alone would still pass if the fullnode changed these to
      // strings, which is exactly what the wallet-service proxy schema
      // (z.number()) would reject at runtime.
      expect(typeof confirmationData.accumulated_weight).toStrictEqual('number');
      expect(typeof confirmationData.confirmation_level).toStrictEqual('number');
      expect(typeof confirmationData.accumulated_bigger).toStrictEqual('boolean');
    });

    it('should throw an error if success is false on response', async () => {
      await expect(gWallet.getTxConfirmationData(INVALID_TX_HASH)).rejects.toThrow(
        `Invalid transaction ${INVALID_TX_HASH}`
      );
    });

    it('should throw TxNotFoundError on valid hash but not found transaction', async () => {
      await expect(gWallet.getTxConfirmationData(NOT_FOUND_TX_HASH)).rejects.toThrow(
        TxNotFoundError
      );
    });
  });

  describe('graphvizNeighborsQuery', () => {
    it('should download graphviz neighbors data for an existing transaction from the fullnode', async () => {
      const hWallet = await generateWalletHelper();
      const tx1 = await GenesisWalletHelper.injectFunds(
        hWallet,
        await hWallet.getAddressAtIndex(0),
        10n
      );
      const neighborsData = await hWallet.graphvizNeighborsQuery(tx1.hash, 'funds', 1);

      expect(neighborsData).toMatch(/digraph {/);
      // Tie the document to the queried transaction: any neighbours graph
      // starts with `digraph {`, including one for an unrelated tx.
      expect(neighborsData).toContain(tx1.hash);
    });

    it('should capture HTTP transport errors from the fullnode', async () => {
      const hWallet = await generateWalletHelper();
      const tx1 = await GenesisWalletHelper.injectFunds(
        hWallet,
        await hWallet.getAddressAtIndex(0),
        10n
      );

      // Deliberately omitting the required graphType/maxLevel arguments: axios
      // drops the resulting undefined params, the fullnode receives `?tx=` only
      // and answers HTTP 500. That rejection surfaces from the axios `.catch`
      // in graphvizNeighborsQuery, before the `Invalid transaction` branch is
      // ever reached — so this covers the transport path, not the API-level
      // error handling exercised by the two cases below.
      // @ts-expect-error -- intentional arity violation, see comment above.
      await expect(hWallet.graphvizNeighborsQuery(tx1.hash)).rejects.toThrow(
        'Request failed with status code 500'
      );
    });

    it('should throw an error if success is false on response', async () => {
      await expect(gWallet.graphvizNeighborsQuery(INVALID_TX_HASH, 'funds', 1)).rejects.toThrow(
        `Invalid transaction ${INVALID_TX_HASH}`
      );
    });

    it('should throw TxNotFoundError on valid but not found transaction', async () => {
      await expect(gWallet.graphvizNeighborsQuery(NOT_FOUND_TX_HASH, 'funds', 1)).rejects.toThrow(
        TxNotFoundError
      );
    });
  });
});
