/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../src/new/wallet';
import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateConnection,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  waitUntilNextTimestamp,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
} from './helpers/wallet.helper';
import {
  NATIVE_TOKEN_UID,
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
} from '../../src/constants';
import { ShieldedOutputMode } from '../../src/shielded/types';
import ShieldedOutputsHeader from '../../src/headers/shielded_outputs';
import Network from '../../src/models/network';
import { precalculationHelpers } from './helpers/wallet-precalculation.helper';
import { getGapLimitConfig } from './utils/core.util';
import * as constants from '../../src/constants';

// Increase Axios timeout for test environment — the fullnode is under load from continuous mining.
// TIMEOUT is declared as `const` so we must cast to override it in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(constants as any).TIMEOUT = 30000;

describe('shielded transactions', () => {
  jest.setTimeout(300_000);

  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('should send AmountShielded outputs using shielded addresses', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    // Fund wallet A with a legacy address
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Get shielded addresses from wallet B (scan_pubkey + spend_pubkey encoded)
    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    // Send 2 shielded outputs from A to B (minimum 2 required by protocol)
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);

    expect(tx).not.toBeNull();
    expect(tx!.hash).toBeDefined();

    // Wait for sender to see the tx (via change output)
    await waitForTxReceived(walletA, tx!.hash!);

    // Verify sender balance: 100 - 30 - 20 - 2*FEE_PER_AMOUNT_SHIELDED_OUTPUT
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBe(100n - 50n - 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT);
  });

  it('should send FullShielded outputs using shielded addresses', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);

    expect(tx).not.toBeNull();
    expect(tx!.hash).toBeDefined();

    await waitForTxReceived(walletA, tx!.hash!);

    // Verify sender balance: 100 - 30 - 20 - 2*FEE_PER_FULL_SHIELDED_OUTPUT
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBe(100n - 50n - 2n * FEE_PER_FULL_SHIELDED_OUTPUT);
  });

  it('should send mixed transaction (transparent + shielded outputs)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    // Legacy address for transparent output to B
    const addrB = await walletB.getAddressAtIndex(0);
    // Shielded addresses for shielded outputs also to B
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const shieldedAddrB2 = await walletB.getAddressAtIndex(2, { legacy: false });

    // Send mixed: transparent to B, 2 shielded to B
    const tx = await walletA.sendManyOutputsTransaction([
      { address: addrB, value: 50n, token: NATIVE_TOKEN_UID },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB2,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);

    expect(tx).not.toBeNull();

    // Wait for both wallets
    await waitForTxReceived(walletB, tx!.hash!);
    await waitForTxReceived(walletA, tx!.hash!);

    // Wallet B should have 80 HTR (50 transparent + 20 + 10 shielded)
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(80n);

    // Sender balance: 200 - 50 - 20 - 10 - 2*FEE_PER_AMOUNT_SHIELDED_OUTPUT
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBe(200n - 80n - 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT);
  });

  it('should send shielded outputs to self', async () => {
    const walletA = await generateWalletHelper();

    const addrA0 = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA0, 100n);

    const shieldedAddrA1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const shieldedAddrA2 = await walletA.getAddressAtIndex(2, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrA1,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrA2,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);

    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);

    // Balance should be 100 - fees (2 shielded outputs × FEE_PER_AMOUNT_SHIELDED_OUTPUT)
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBe(100n - 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT);
  });

  it('should decrypt received shielded outputs and include in receiver balance', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);

    expect(tx).not.toBeNull();

    // Wait for wallet B to receive and decrypt the shielded outputs
    await waitForTxReceived(walletB, tx!.hash!);

    // Wallet B should see the decrypted shielded amounts in its balance
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
  });

  it('should reject shielded output with a legacy (non-shielded) address', async () => {
    const walletA = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const walletB = await generateWalletHelper();
    const legacyAddrB = await walletB.getAddressAtIndex(0);

    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: legacyAddrB,
          value: 50n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
        {
          address: legacyAddrB,
          value: 10n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ])
    ).rejects.toThrow('Shielded output requires a shielded address');
  });

  it('should handle multiple sequential transactions with mixed output types', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 500n);

    // Transaction 1: transparent outputs only
    const legacyAddrB = await walletB.getAddressAtIndex(0);
    const tx1 = await walletA.sendManyOutputsTransaction([
      { address: legacyAddrB, value: 100n, token: NATIVE_TOKEN_UID },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletA, tx1!.hash!);
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // Transaction 2: shielded outputs only
    const shieldedAddrB0 = await walletB.getAddressAtIndex(1, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(2, { legacy: false });
    const tx2 = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 50n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletA, tx2!.hash!);
    await waitForTxReceived(walletB, tx2!.hash!);
    await waitUntilNextTimestamp(walletA, tx2!.hash!);

    // Transaction 3: mixed transparent + shielded
    const legacyAddrB2 = await walletB.getAddressAtIndex(3);
    const shieldedAddrB3 = await walletB.getAddressAtIndex(4, { legacy: false });
    const shieldedAddrB4 = await walletB.getAddressAtIndex(5, { legacy: false });
    const tx3 = await walletA.sendManyOutputsTransaction([
      { address: legacyAddrB2, value: 40n, token: NATIVE_TOKEN_UID },
      {
        address: shieldedAddrB3,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB4,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx3).not.toBeNull();
    await waitForTxReceived(walletB, tx3!.hash!);

    // Wallet B total: 100 (transparent) + 80 (shielded) + 40 (transparent) + 30 (shielded) = 250
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(250n);
  });

  it('should generate and use both legacy and shielded addresses at the same index', async () => {
    const walletA = await generateWalletHelper();

    const legacyAddr = await walletA.getAddressAtIndex(0, { legacy: true });
    const shieldedAddr = await walletA.getAddressAtIndex(0, { legacy: false });

    // Different formats
    expect(legacyAddr).not.toBe(shieldedAddr);

    // Both recognized by the wallet
    expect(await walletA.storage.isAddressMine(legacyAddr)).toBe(true);
    expect(await walletA.storage.isAddressMine(shieldedAddr)).toBe(true);
  });

  it('should load wallet and track shielded address gap limit independently', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 1000n);

    // Send to walletB's legacy address at index 0
    const legacyAddrB = await walletB.getAddressAtIndex(0);
    const tx1 = await walletA.sendTransaction(legacyAddrB, 10n);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // Send to walletB's shielded addresses at index 5 and 6 (gap in shielded chain)
    const shieldedAddrB5 = await walletB.getAddressAtIndex(5, { legacy: false });
    const shieldedAddrB6 = await walletB.getAddressAtIndex(6, { legacy: false });
    const tx2 = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB5,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB6,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);

    // Wallet B should have both legacy and shielded funds
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(45n); // 10 legacy + 20 + 15 shielded

    // Check wallet data tracks both chains
    const walletData = await walletB.storage.getWalletData();
    expect(walletData.lastUsedAddressIndex).toBe(0);
    expect(walletData.shieldedLastUsedAddressIndex).toBe(6);
  });

  it('should send transparent output to a shielded address (auto-converts to spend P2PKH)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Use walletB's shielded address as destination but send as transparent (no shielded flag)
    const shieldedAddrB = await walletB.getAddressAtIndex(0, { legacy: false });

    const tx = await walletA.sendTransaction(shieldedAddrB, 50n);

    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    // walletB should receive the funds via the spend-derived P2PKH address
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
  });

  it('should round-trip serialize/deserialize ShieldedOutputsHeader from a real transaction', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    // Build but don't send — we want to inspect the Transaction object
    const sendTx = await walletA.sendManyOutputsSendTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    const tx = await sendTx.run('sign-tx');

    // Find the ShieldedOutputsHeader
    const shieldedHeader = tx.headers.find(h => h instanceof ShieldedOutputsHeader) as
      | ShieldedOutputsHeader
      | undefined;
    expect(shieldedHeader).toBeDefined();
    expect(shieldedHeader!.shieldedOutputs.length).toBe(2);

    // Serialize the header
    const serializedParts: Buffer[] = [];
    shieldedHeader!.serialize(serializedParts);
    const serialized = Buffer.concat(serializedParts);

    // Deserialize from the same bytes
    const network = new Network('privatenet');
    const [deserialized, remaining] = ShieldedOutputsHeader.deserialize(serialized, network);
    const deserializedHeader = deserialized as ShieldedOutputsHeader;

    // Verify all bytes are consumed
    expect(remaining.length).toBe(0);

    // Verify deserialized outputs match original
    expect(deserializedHeader.shieldedOutputs.length).toBe(2);
    for (let i = 0; i < 2; i++) {
      const orig = shieldedHeader!.shieldedOutputs[i];
      const deser = deserializedHeader.shieldedOutputs[i];

      expect(deser.mode).toBe(orig.mode);
      expect(deser.commitment).toEqual(orig.commitment);
      expect(deser.rangeProof).toEqual(orig.rangeProof);
      expect(deser.tokenData).toBe(orig.tokenData);
      expect(deser.script).toEqual(orig.script);
      expect(deser.ephemeralPubkey).toEqual(orig.ephemeralPubkey);
    }

    // Verify re-serialization produces identical bytes
    const reserializedParts: Buffer[] = [];
    deserializedHeader.serialize(reserializedParts);
    const reserialized = Buffer.concat(reserializedParts);
    expect(reserialized).toEqual(serialized);
  });

  it('should round-trip serialize/deserialize FullShielded ShieldedOutputsHeader', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const sendTx = await walletA.sendManyOutputsSendTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    const tx = await sendTx.run('sign-tx');

    const shieldedHeader = tx.headers.find(h => h instanceof ShieldedOutputsHeader) as
      | ShieldedOutputsHeader
      | undefined;
    expect(shieldedHeader).toBeDefined();

    const serializedParts: Buffer[] = [];
    shieldedHeader!.serialize(serializedParts);
    const serialized = Buffer.concat(serializedParts);

    const network = new Network('privatenet');
    const [deserialized, remaining] = ShieldedOutputsHeader.deserialize(serialized, network);
    const deserializedHeader = deserialized as ShieldedOutputsHeader;

    expect(remaining.length).toBe(0);
    expect(deserializedHeader.shieldedOutputs.length).toBe(2);

    for (let i = 0; i < 2; i++) {
      const orig = shieldedHeader!.shieldedOutputs[i];
      const deser = deserializedHeader.shieldedOutputs[i];

      expect(deser.mode).toBe(orig.mode);
      expect(deser.commitment).toEqual(orig.commitment);
      expect(deser.rangeProof).toEqual(orig.rangeProof);
      expect(deser.script).toEqual(orig.script);
      expect(deser.ephemeralPubkey).toEqual(orig.ephemeralPubkey);
      expect(deser.assetCommitment).toEqual(orig.assetCommitment);
      expect(deser.surjectionProof).toEqual(orig.surjectionProof);
    }

    // Re-serialization should be identical
    const reserializedParts: Buffer[] = [];
    deserializedHeader.serialize(reserializedParts);
    expect(Buffer.concat(reserializedParts)).toEqual(serialized);
  });

  it('should send transparent-only transaction without shielded addresses', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const legacyAddrB = await walletB.getAddressAtIndex(0);
    const tx = await walletA.sendTransaction(legacyAddrB, 50n);

    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
  });

  it('should recover shielded balance after wallet restart', async () => {
    const walletA = await generateWalletHelper();

    // Use a precalculated wallet so we know the seed for restart
    const walletDataB = precalculationHelpers.test.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Send shielded outputs to walletB
    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    // Verify balance before restart
    const balanceBefore = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceBefore[0].balance.unlocked).toBe(50n);

    // Stop walletB (clean storage to simulate fresh load from fullnode)
    await walletB.stop({ cleanStorage: true, cleanAddresses: true });

    // Restart walletB from same seed
    const walletB2 = new HathorWallet({
      seed: walletDataB.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      scanPolicy: getGapLimitConfig(),
    });
    await walletB2.start();
    await waitForWalletReady(walletB2);

    // Balance should be recovered from fullnode history (including shielded outputs)
    const balanceAfter = await walletB2.getBalance(NATIVE_TOKEN_UID);
    expect(balanceAfter[0].balance.unlocked).toBe(50n);

    await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
  });

  // TODO: Custom token shielded outputs fail with "tokens melted, but there is no melt authority input".
  // The phantom output trick in sendTransaction.ts balances UTXO selection, but when phantoms are
  // removed the custom token inputs exceed the transparent outputs, looking like a melt to the fullnode.
  // The shielded output amounts need to be accounted for in the token balance equation.
  it('should send shielded outputs with a custom token (AmountShielded)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    // Fund walletA and create a custom token
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 20n);
    const tokenResp = await createTokenHelper(walletA, 'ShieldedToken', 'SHT', 1000n);
    const tokenUid = tokenResp.hash;

    // Send shielded outputs of the custom token to walletB
    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 300n,
        token: tokenUid,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 200n,
        token: tokenUid,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    // WalletB should see the custom token balance from decrypted shielded outputs
    const balanceB = await walletB.getBalance(tokenUid);
    expect(balanceB[0].balance.unlocked).toBe(500n);

    // WalletA should have the remaining custom tokens
    const balanceA = await walletA.getBalance(tokenUid);
    expect(balanceA[0].balance.unlocked).toBe(500n);
  });

  // TODO: Same issue as AmountShielded custom token test above.
  it('should send FullShielded outputs with a custom token', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 20n);
    const tokenResp = await createTokenHelper(walletA, 'FullShieldToken', 'FST', 1000n);
    const tokenUid = tokenResp.hash;

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 400n,
        token: tokenUid,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 100n,
        token: tokenUid,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    const balanceB = await walletB.getBalance(tokenUid);
    expect(balanceB[0].balance.unlocked).toBe(500n);
  });

  it('should decrypt FullShielded outputs and include in receiver balance', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    // Wallet B should see the decrypted FullShielded amounts in its balance
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
  });

  it('should send mixed AmountShielded and FullShielded outputs in the same transaction', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    // Wallet B should see both decrypted amounts
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(40n);
  });

  it('should deduct correct fees for shielded outputs', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    // Send 2 AmountShielded outputs
    const txAmount = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(txAmount).not.toBeNull();
    await waitForTxReceived(walletA, txAmount!.hash!);

    // Fee for 2 AmountShielded outputs = 2 * FEE_PER_AMOUNT_SHIELDED_OUTPUT
    const expectedFeeAmount = 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT;
    const balanceAfterAmount = await walletA.getBalance(NATIVE_TOKEN_UID);
    // Sender sent 20 + fees, so balance = 100 - 20 - fees
    expect(balanceAfterAmount[0].balance.unlocked).toBe(100n - 20n - expectedFeeAmount);

    await waitUntilNextTimestamp(walletA, txAmount!.hash!);

    // Now send 2 FullShielded outputs from remaining balance
    const walletC = await generateWalletHelper();
    const shieldedAddrC0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrC1 = await walletC.getAddressAtIndex(1, { legacy: false });

    const remainingBalance = balanceAfterAmount[0].balance.unlocked;
    const sendValue = 5n;
    const expectedFeeFull = 2n * FEE_PER_FULL_SHIELDED_OUTPUT;

    const txFull = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrC0,
        value: sendValue,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrC1,
        value: sendValue,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(txFull).not.toBeNull();
    await waitForTxReceived(walletA, txFull!.hash!);

    const balanceAfterFull = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceAfterFull[0].balance.unlocked).toBe(
      remainingBalance - 2n * sendValue - expectedFeeFull
    );
  });

  it('should reject a single shielded output with no transparent outputs (Rule 4)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB = await walletB.getAddressAtIndex(0, { legacy: false });

    // Sending a single shielded output should fail due to trivial commitment protection.
    // The wallet-lib or fullnode rejects transactions with fewer than 2 shielded outputs.
    await expect(
      walletA.sendManyOutputsTransaction([
        {
          address: shieldedAddrB,
          value: 50n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ])
    ).rejects.toThrow(/at least 2 shielded outputs/i);
  });

  it('should reject a single shielded output even with transparent outputs present', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const addrB = await walletB.getAddressAtIndex(0);
    const shieldedAddrB = await walletB.getAddressAtIndex(1, { legacy: false });

    // The fullnode requires at least 2 shielded outputs, even when transparent outputs are present.
    await expect(
      walletA.sendManyOutputsTransaction([
        { address: addrB, value: 30n, token: NATIVE_TOKEN_UID },
        {
          address: shieldedAddrB,
          value: 20n,
          token: NATIVE_TOKEN_UID,
          shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
        },
      ])
    ).rejects.toThrow(/at least 2 shielded outputs/i);
  });

  it('should recover FullShielded balance after wallet restart', async () => {
    const walletA = await generateWalletHelper();

    const walletDataB = precalculationHelpers.test.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    const balanceBefore = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceBefore[0].balance.unlocked).toBe(50n);

    await walletB.stop({ cleanStorage: true, cleanAddresses: true });

    const walletB2 = new HathorWallet({
      seed: walletDataB.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      scanPolicy: getGapLimitConfig(),
    });
    await walletB2.start();
    await waitForWalletReady(walletB2);

    const balanceAfter = await walletB2.getBalance(NATIVE_TOKEN_UID);
    expect(balanceAfter[0].balance.unlocked).toBe(50n);

    await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should unshield funds (spend shielded UTXOs as transparent output)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    // Fund walletA
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Send shielded outputs from A to B
    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    // WalletB has 50 HTR (from shielded outputs)
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);

    // Now walletB sends a transparent output to walletC from its shielded balance
    const addrC = await walletC.getAddressAtIndex(0);

    // Record walletC's balance before receiving
    const balanceCBefore = (await walletC.getBalance(NATIVE_TOKEN_UID))[0]?.balance.unlocked ?? 0n;

    const tx2 = await walletB.sendTransaction(addrC, 40n);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletC, tx2!.hash!);

    // WalletC should have received exactly 40 HTR more
    const balanceCAfter = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balanceCAfter[0].balance.unlocked - balanceCBefore).toBe(40n);
  });

  it('should chain shielded outputs (shielded-to-shielded)', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    // Fund walletA
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // A sends shielded to B
    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    // B sends shielded to C (spending shielded UTXOs as shielded outputs)
    const shieldedAddrC0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrC1 = await walletC.getAddressAtIndex(1, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: shieldedAddrC0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrC1,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletC, tx2!.hash!);

    // C should have 40 HTR shielded
    expect((await walletC.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(40n);
  });

  it('should spend shielded UTXOs after wallet restart', async () => {
    const walletA = await generateWalletHelper();
    const walletDataB = precalculationHelpers.test.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });
    const walletC = await generateWalletHelper();

    // Fund A and send shielded to B
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 30n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 20n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    // Restart walletB
    await walletB.stop({ cleanStorage: true, cleanAddresses: true });
    const walletB2 = new HathorWallet({
      seed: walletDataB.words,
      connection: generateConnection(),
      password: DEFAULT_PASSWORD,
      pinCode: DEFAULT_PIN_CODE,
      scanPolicy: getGapLimitConfig(),
    });
    await walletB2.start();
    await waitForWalletReady(walletB2);

    // Verify balance survived restart
    expect((await walletB2.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    // Spend shielded UTXOs after restart
    const addrC = await walletC.getAddressAtIndex(0);
    const balanceCBefore = (await walletC.getBalance(NATIVE_TOKEN_UID))[0]?.balance.unlocked ?? 0n;
    const tx2 = await walletB2.sendTransaction(addrC, 40n);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletC, tx2!.hash!);

    const balanceCAfter = await walletC.getBalance(NATIVE_TOKEN_UID);
    expect(balanceCAfter[0].balance.unlocked - balanceCBefore).toBe(40n);

    await walletB2.stop({ cleanStorage: true, cleanAddresses: true });
  });

  it('should send mixed AmountShielded and FullShielded for the same token', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    // Same token (HTR), one AmountShielded and one FullShielded
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 25n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 15n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx).not.toBeNull();
    await waitForTxReceived(walletB, tx!.hash!);

    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(40n);
  });
});
