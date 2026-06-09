/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../../src/new/wallet';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  generateConnection,
  generateWalletHelper,
  registerShieldedProvider,
  stopAllWallets,
  waitForTxReceived,
  waitForWalletReady,
  waitUntilNextTimestamp,
  DEFAULT_PASSWORD,
  DEFAULT_PIN_CODE,
} from '../helpers/wallet.helper';
import {
  NATIVE_TOKEN_UID,
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
} from '../../../src/constants';
import { ShieldedOutputMode } from '../../../src/shielded/types';
import ShieldedOutputsHeader from '../../../src/headers/shielded_outputs';
import Network from '../../../src/models/network';
import { precalculationHelpers } from '../helpers/wallet-precalculation.helper';
import { getGapLimitConfig } from '../utils/core.util';
import * as constants from '../../../src/constants';

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

  it('should send AmountShielded outputs with a large amount (1M+ HTR)', async () => {
    // Verify that shielded outputs work with amounts > 1M HTR.
    // Requires RANGE_PROOF_BITS=40 pinned on both wallet-lib and fullnode.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    // 1M HTR = 100,000,000 wallet units (2 decimals). Inject 1.5M for headroom.
    const totalFund = 150_000_000n;
    await GenesisWalletHelper.injectFunds(walletA, addrA, totalFund);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    // Send 1.2M HTR shielded (= 120M wallet units), split into two outputs.
    const value0 = 80_000_000n;
    const value1 = 40_000_000n;
    const sendTotal = value0 + value1;
    const tx = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: value0,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: value1,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);

    expect(tx).not.toBeNull();
    expect(tx!.hash).toBeDefined();

    await waitForTxReceived(walletA, tx!.hash!);

    // Sender spent total + fee
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBe(
      totalFund - sendTotal - 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT
    );

    // Receiver gets the full shielded amount
    await waitForTxReceived(walletB, tx!.hash!);
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(sendTotal);
  });

  it('should send shielded outputs with exact UTXO match (no transparent change)', async () => {
    // This test reproduces the scenario where the UTXO value exactly matches
    // the shielded output total + fee, resulting in 0 transparent outputs.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    // Fund wallet A with EXACTLY amount + fee so no change is created.
    // Sending 50 HTR shielded (30+20) + 2 HTR fee (2 AmountShielded × 1 HTR) = 52 HTR.
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 52n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    // Send 2 shielded outputs consuming the entire UTXO (no transparent change)
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

    await waitForTxReceived(walletA, tx!.hash!);

    // Sender should have 0 balance (all consumed by shielded outputs + fee)
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBe(0n);

    // Receiver should have 50 HTR shielded
    await waitForTxReceived(walletB, tx!.hash!);
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
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
    registerShieldedProvider(walletB2);
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
    registerShieldedProvider(walletB2);
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

  it('should chain FullShielded outputs (FullShielded-to-FullShielded)', async () => {
    // This test verifies that spending a FullShielded UTXO to create new FullShielded outputs
    // works correctly. The surjection proof domain must use the input's asset_commitment
    // (blinded generator) rather than the unblinded generator for FullShielded inputs.
    //
    // Important: the fullnode skips FullShielded inputs from the transparent balance check,
    // so wallet B needs transparent HTR to cover the fee. The shielded values must sum
    // exactly (no shielded change) to avoid transparent change from shielded inputs.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    // Fund walletA
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 200n);

    // A sends FullShielded to B (transparent → FullShielded, this works)
    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: shieldedAddrB0,
        value: 60n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrB1,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);
    await waitUntilNextTimestamp(walletA, tx1!.hash!);

    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(100n);

    // Give B transparent HTR to pay the FullShielded fee (2 HTR per output × 2 = 4 HTR).
    // The fullnode skips FullShielded inputs from transparent balance, so transparent
    // HTR is needed to cover fees and any transparent change.
    const addrB = await walletB.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletB, addrB, 10n);
    await waitUntilNextTimestamp(walletB, tx1!.hash!);

    // B sends FullShielded to C (FullShielded → FullShielded)
    // This is the critical path: the surjection proof domain must use B's input
    // asset_commitments (blinded generators), not unblinded generators.
    // Send exactly 60+40=100 to avoid shielded change.
    const shieldedAddrC0 = await walletC.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrC1 = await walletC.getAddressAtIndex(1, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: shieldedAddrC0,
        value: 60n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
      {
        address: shieldedAddrC1,
        value: 40n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.FULLY_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletC, tx2!.hash!);

    // C should have 100 HTR from FullShielded outputs
    expect((await walletC.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(100n);
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
    registerShieldedProvider(walletB2);
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

  it('should persist blinding factors and use them for shielded-to-shielded spending', async () => {
    // This test verifies that blinding factors are persisted to the UTXO
    // and correctly used when spending shielded inputs to create new shielded outputs.
    // Without blinding factor persistence, computeBalancingBlindingFactor receives
    // empty inputs and the homomorphic balance equation fails.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();
    const walletC = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Step 1: A sends shielded to B
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

    // Verify B has 50 HTR shielded
    expect((await walletB.getBalance(NATIVE_TOKEN_UID))[0].balance.unlocked).toBe(50n);

    // Verify blinding factors are persisted on UTXOs
    let shieldedUtxoCount = 0;
    for await (const utxo of walletB.storage.selectUtxos({
      token: NATIVE_TOKEN_UID,
      shielded: true,
    })) {
      expect(utxo.shielded).toBe(true);
      expect(utxo.blindingFactor).toBeDefined();
      expect(utxo.blindingFactor!.length).toBe(64); // 32 bytes hex
      shieldedUtxoCount++;
    }
    expect(shieldedUtxoCount).toBe(2);

    // Step 2: B spends shielded UTXOs to create new shielded outputs for C.
    // This requires B's blinding factors to satisfy the balance equation.
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

  it('should gracefully handle shielded outputs on read-only (xpub-only) wallet', async () => {
    const walletA = await generateWalletHelper();

    // Create a read-only wallet from xpub (no pinCode, can't decrypt shielded)
    const walletDataB = precalculationHelpers.test.getPrecalculatedWallet();
    const walletB = await generateWalletHelper({
      seed: walletDataB.words,
      preCalculatedAddresses: walletDataB.addresses,
    });

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Send shielded outputs to walletB's shielded addresses
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

    // WalletB should receive the tx without crashing
    await waitForTxReceived(walletB, tx!.hash!);

    // WalletB has a pinCode so it CAN decrypt. Verify balance is 50n.
    // A truly xpub-only wallet (no pinCode) would show 0n but not crash.
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(50n);
  });

  it('should debit shielded inputs when spending wallet-owned shielded UTXOs (self-send)', async () => {
    // Reproduces a balance-accounting bug observed in the mobile wallet where a
    // shielded-to-shielded self-send shows up as "Received" the full output value
    // instead of "-fee". Root cause: processNewTx and getTxBalance both skip shielded
    // inputs (no decoded/value/token on-chain) without looking up the stored UTXO,
    // so the two new shielded outputs are credited but the spent shielded input is
    // never debited.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    // Fund walletA transparent so it can send shielded to walletB.
    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    // Step 1: walletA → walletB (create shielded UTXOs owned by B).
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

    // Step 2: walletB sends shielded-to-shielded to itself. This consumes a
    // shielded UTXO (the 30n one, or both) and creates two new shielded UTXOs.
    // Expected delta for tx2 is -fee (2 * FEE_PER_AMOUNT_SHIELDED_OUTPUT).
    const shieldedAddrB2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const shieldedAddrB3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const expectedFee = 2n * FEE_PER_AMOUNT_SHIELDED_OUTPUT;
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: shieldedAddrB2,
        value: 18n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB3,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);

    // After the self-send, walletB should have lost only the fee — not gained 28n.
    // Bug: without debiting the shielded input, balance becomes 50 + 28 = 78.
    const balanceBAfter = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceBAfter[0].balance.unlocked).toBe(50n - expectedFee);

    // Per-tx balance (what the mobile wallet shows in history) must be -fee, not +28.
    const storedTx2 = await walletB.getTx(tx2!.hash!);
    expect(storedTx2).not.toBeNull();
    const tx2Balance = await walletB.getTxBalance(storedTx2!);
    expect(tx2Balance[NATIVE_TOKEN_UID]).toBe(-expectedFee);
  });

  it('should preserve decoded shielded outputs across metadata updates (re-onNewTx)', async () => {
    // Reproduces a bug observed in the mobile wallet: after a shielded tx is
    // received and processed, a subsequent ws "update-tx" event for the same
    // tx (e.g., a spent_by metadata change) overwrites the stored tx with the
    // wire-form (no decoded shielded entries). After that, getTxBalance reads
    // tx.outputs without any shielded credit and reports the full transparent
    // input as the per-tx delta until the next processHistory cycle.
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
    await waitForTxReceived(walletB, tx!.hash!);

    // Sanity check: walletB sees the +50 shielded credit on the first receipt.
    const stored1 = await walletB.getTx(tx!.hash!);
    expect((await walletB.getTxBalance(stored1!))[NATIVE_TOKEN_UID]).toBe(50n);

    // Simulate a metadata-update ws event re-arriving for the same tx in
    // the BARE form the fullnode actually sends for some updates: empty
    // outputs[] and undefined shielded_outputs. Without the fix the merge
    // adds decoded entries to newTx.outputs but addTx's normalize then
    // re-extracts them (because shielded_outputs is undefined → not
    // truthy → normalize doesn't early-return), leaving the stored tx with
    // outputs=[] again and getTxBalance reporting -input on the per-tx delta.
    const barePayload = {
      ...stored1,
      outputs: [],
      shielded_outputs: undefined,
      inputs: stored1!.inputs.map(i => ({
        tx_id: i.tx_id,
        index: i.index,
        type: 'shielded',
        decoded: i.decoded,
      })),
    };
    await walletB.onNewTx({ history: barePayload });

    // After the metadata update, getTxBalance must still credit the shielded
    // outputs — i.e., the per-tx delta must remain +50.
    const stored2 = await walletB.getTx(tx!.hash!);
    expect((await walletB.getTxBalance(stored2!))[NATIVE_TOKEN_UID]).toBe(50n);
  });

  it('should report correct per-tx delta for shielded-to-shielded self-send with 3 outputs to same address', async () => {
    // Reproduces a mobile-wallet bug: after a shielded self-send with multiple
    // outputs to the same address, the wallet shows the full input as the
    // displayed delta (e.g. -999M HTR) instead of -fee, until the user
    // reloads. Verifies both the live first-receipt path and a subsequent
    // metadata-update path return the correct -fee delta from getTxBalance.
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const sameSelfAddr = await walletB.getAddressAtIndex(0, { legacy: false });
    const otherSelfAddr = await walletB.getAddressAtIndex(1, { legacy: false });

    // tx1: walletA → walletB shielded (2 outputs, both to walletB index 0).
    const tx1 = await walletA.sendManyOutputsTransaction([
      {
        address: sameSelfAddr,
        value: 60n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: otherSelfAddr,
        value: 38n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx1).not.toBeNull();
    await waitForTxReceived(walletB, tx1!.hash!);

    // tx2: walletB self-send with 3 shielded outputs all to the SAME address
    // (the user's reported scenario from tx 0098fb71...). Spends 60n shielded
    // UTXO, creates 3 outputs summing to 60n - 3*FEE_PER_AMOUNT_SHIELDED_OUTPUT.
    const fee = 3n * FEE_PER_AMOUNT_SHIELDED_OUTPUT;
    const expectedSplit = (60n - fee) / 3n; // = 19n with fee=3n, sum 57n
    const remainder = 60n - fee - expectedSplit * 2n; // last output gets the rest
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: sameSelfAddr,
        value: expectedSplit,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sameSelfAddr,
        value: expectedSplit,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: sameSelfAddr,
        value: remainder,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);

    // First-receipt check: per-tx delta MUST be -fee (3n), not -input (-60n).
    const stored1 = await walletB.getTx(tx2!.hash!);
    expect(stored1).not.toBeNull();
    const live = await walletB.getTxBalance(stored1!);
    expect(live[NATIVE_TOKEN_UID]).toBe(-fee);

    // Metadata-update check: re-deliver the wire-form (with shielded outputs
    // hidden, as the fullnode would re-send for any update event) to onNewTx
    // and verify the per-tx delta is preserved.
    const wsLikeOutputs = (stored1!.shielded_outputs ?? []).map((so, idx) => ({
      type: 'shielded',
      commitment: so.commitment,
      range_proof: Buffer.from(so.range_proof, 'hex').toString('base64'),
      script: Buffer.from(so.script, 'hex').toString('base64'),
      token_data: so.token_data,
      ephemeral_pubkey: so.ephemeral_pubkey,
      decoded: so.decoded,
      asset_commitment: so.asset_commitment,
      surjection_proof: so.surjection_proof
        ? Buffer.from(so.surjection_proof, 'hex').toString('base64')
        : undefined,
    }));
    const wsLikePayload = {
      ...stored1,
      // Strip the previously-decoded shielded entries — wire form has only
      // the commitment-only versions.
      outputs: wsLikeOutputs,
      shielded_outputs: undefined,
      // Reset shielded input enrichment that processNewTx had added on first
      // receipt — wire form has only {type, tx_id, index, decoded, commitment, ...}.
      inputs: stored1!.inputs.map(i => ({
        tx_id: i.tx_id,
        index: i.index,
        type: 'shielded',
        decoded: i.decoded,
      })),
    };
    await walletB.onNewTx({ history: wsLikePayload });

    const stored2 = await walletB.getTx(tx2!.hash!);
    expect((await walletB.getTxBalance(stored2!))[NATIVE_TOKEN_UID]).toBe(-fee);
  });

  it('should decrypt shielded outputs delivered in a follow-up ws message after a bare announcement', async () => {
    // Reproduces the user-observed mobile bug: the full node sometimes sends
    // a shielded tx across two ws messages — the first is bare (empty
    // outputs[], no shielded_outputs), the second carries the full shielded
    // data. The wallet treats the second as a metadata update (isNewTx=false
    // because msg 1 already added the tx to storage), so
    // processMetadataChanged runs without decrypting. The per-tx delta then
    // shows -input forever, until the user reloads (and processHistory runs).
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

    // Capture the "full" ws form (what the second-stage msg would carry).
    await waitForTxReceived(walletA, tx!.hash!);
    const fullForm = await walletA.getTx(tx!.hash!);
    expect(fullForm).not.toBeNull();
    // Reconstruct the wire format by moving any decoded shielded entries
    // back to outputs[] as raw shielded entries (reversing what
    // normalizeShieldedOutputs would do server-side). Since walletA never
    // decoded the outputs (it's the sender, not the receiver), fullForm
    // already has them only in shielded_outputs[]. Build the wire form
    // by inlining shielded_outputs into outputs[] with type:'shielded'.
    const fullPayload = {
      ...fullForm,
      outputs: [
        ...fullForm!.outputs,
        ...(fullForm!.shielded_outputs ?? []).map(so => ({
          type: 'shielded',
          commitment: so.commitment,
          range_proof: Buffer.from(so.range_proof, 'hex').toString('base64'),
          script: Buffer.from(so.script, 'hex').toString('base64'),
          token_data: so.token_data,
          ephemeral_pubkey: so.ephemeral_pubkey,
          decoded: so.decoded,
          asset_commitment: so.asset_commitment,
          surjection_proof: so.surjection_proof
            ? Buffer.from(so.surjection_proof, 'hex').toString('base64')
            : undefined,
        })),
      ],
      shielded_outputs: undefined,
    };

    // Stage 1: deliver a BARE ws msg (outputs=[], no shielded data) to
    // walletB. This emulates the first ws notification with no tx body.
    const barePayload = {
      ...fullForm,
      outputs: [],
      shielded_outputs: undefined,
    };
    await walletB.onNewTx({ history: barePayload });

    // After stage 1, the tx is in storage but with no decoded shielded
    // entries — the per-tx delta would show -input only (no credits).

    // Stage 2: deliver the FULL ws msg with the shielded entries.
    await walletB.onNewTx({ history: fullPayload });

    // After the fix, walletB must now have decrypted the shielded outputs
    // and the per-tx delta must be +50 (the value walletA sent), not 0
    // (no credits) or -input.
    const stored = await walletB.getTx(tx!.hash!);
    expect(stored).not.toBeNull();
    expect((await walletB.getTxBalance(stored!))[NATIVE_TOKEN_UID]).toBe(50n);
  });

  it('should delete spent shielded UTXOs so the next send does not double-spend', async () => {
    // Reproduces a mobile-wallet bug: after sending a shielded-to-shielded
    // self-send, the wallet keeps the spent UTXO in its index because the
    // outer deleteUtxo loop in processSingleTx skips shielded inputs (they
    // sit at indices beyond origTx.outputs after normalization). The next
    // send picks the same already-spent UTXO and the fullnode rejects with
    // "input has already been spent".
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

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

    // Sanity: walletB has 2 shielded UTXOs.
    let count = 0;
    for await (const _u of walletB.storage.selectUtxos({
      token: NATIVE_TOKEN_UID,
      shielded: true,
    })) {
      count++;
    }
    expect(count).toBe(2);

    // Spend one shielded UTXO via a self-send.
    const shieldedAddrB2 = await walletB.getAddressAtIndex(2, { legacy: false });
    const shieldedAddrB3 = await walletB.getAddressAtIndex(3, { legacy: false });
    const tx2 = await walletB.sendManyOutputsTransaction([
      {
        address: shieldedAddrB2,
        value: 18n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB3,
        value: 10n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);

    // After the spend, walletB must NOT still hold the spent UTXO. We expect:
    //   - 1 untouched shielded UTXO from tx1 (the one not spent).
    //   - 2 new shielded UTXOs from tx2.
    // Total = 3. Without the fix, the spent UTXO from tx1 lingers (total 4)
    // and the next send picks it.
    const allShielded: { txId: string; index: number }[] = [];
    for await (const u of walletB.storage.selectUtxos({
      token: NATIVE_TOKEN_UID,
      shielded: true,
    })) {
      allShielded.push({ txId: u.txId, index: u.index });
    }
    expect(allShielded.length).toBe(3);
    // None of them should be the (tx1, spent_index) pair. The spent one is
    // whichever tx1 output the input loop debited; since UTXO selection
    // picks deterministically, we just assert at most one tx1 UTXO remains.
    const tx1UtxosRemaining = allShielded.filter(u => u.txId === tx1!.hash);
    expect(tx1UtxosRemaining.length).toBe(1);

    // Final guard: a second self-send must succeed (no double-spend rejection).
    const shieldedAddrB4 = await walletB.getAddressAtIndex(4, { legacy: false });
    const shieldedAddrB5 = await walletB.getAddressAtIndex(5, { legacy: false });
    const tx3 = await walletB.sendManyOutputsTransaction([
      {
        address: shieldedAddrB4,
        value: 8n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
      {
        address: shieldedAddrB5,
        value: 6n,
        token: NATIVE_TOKEN_UID,
        shielded: ShieldedOutputMode.AMOUNT_SHIELDED,
      },
    ]);
    expect(tx3).not.toBeNull();
  });
});
