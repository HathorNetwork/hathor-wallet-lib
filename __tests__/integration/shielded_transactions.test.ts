/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import HathorWallet from '../../src/new/wallet';
import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
  waitUntilNextTimestamp,
} from './helpers/wallet.helper';
import { NATIVE_TOKEN_UID } from '../../src/constants';
import { ShieldedOutputMode } from '../../src/shielded/types';
import ShieldedOutputsHeader from '../../src/headers/shielded_outputs';
import Network from '../../src/models/network';
import * as constants from '../../src/constants';

// Increase Axios timeout for test environment — the fullnode is under load from continuous mining.
// TIMEOUT is declared as `const` so we must cast to override it in tests.
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

    // Verify sender balance decreased: 100 - 30 - 20 - fees
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBeLessThan(100n);
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

    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBeLessThan(100n);
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
      { address: shieldedAddrB1, value: 20n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
      { address: shieldedAddrB2, value: 10n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
    ]);

    expect(tx).not.toBeNull();

    // Wait for both wallets
    await waitForTxReceived(walletB, tx!.hash!);
    await waitForTxReceived(walletA, tx!.hash!);

    // Wallet B should have at least the transparent output
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBeGreaterThanOrEqual(50n);

    // Sender balance decreased
    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBeLessThan(200n);
  });

  it('should send shielded outputs to self', async () => {
    const walletA = await generateWalletHelper();

    const addrA0 = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA0, 100n);

    const shieldedAddrA1 = await walletA.getAddressAtIndex(1, { legacy: false });
    const shieldedAddrA2 = await walletA.getAddressAtIndex(2, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      { address: shieldedAddrA1, value: 25n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
      { address: shieldedAddrA2, value: 15n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
    ]);

    expect(tx).not.toBeNull();
    await waitForTxReceived(walletA, tx!.hash!);

    const balanceA = await walletA.getBalance(NATIVE_TOKEN_UID);
    expect(balanceA[0].balance.unlocked).toBeLessThanOrEqual(100n);
    expect(balanceA[0].balance.unlocked).toBeGreaterThan(0n);
  });

  it('should decrypt received shielded outputs and include in receiver balance', async () => {
    const walletA = await generateWalletHelper();
    const walletB = await generateWalletHelper();

    const addrA = await walletA.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(walletA, addrA, 100n);

    const shieldedAddrB0 = await walletB.getAddressAtIndex(0, { legacy: false });
    const shieldedAddrB1 = await walletB.getAddressAtIndex(1, { legacy: false });

    const tx = await walletA.sendManyOutputsTransaction([
      { address: shieldedAddrB0, value: 30n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
      { address: shieldedAddrB1, value: 20n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
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
        { address: legacyAddrB, value: 50n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
        { address: legacyAddrB, value: 10n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
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
      { address: shieldedAddrB0, value: 50n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
      { address: shieldedAddrB1, value: 30n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
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
      { address: shieldedAddrB3, value: 20n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
      { address: shieldedAddrB4, value: 10n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
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
      { address: shieldedAddrB5, value: 20n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
      { address: shieldedAddrB6, value: 15n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
    ]);
    expect(tx2).not.toBeNull();
    await waitForTxReceived(walletB, tx2!.hash!);

    // Wallet B should have both legacy and shielded funds
    const balanceB = await walletB.getBalance(NATIVE_TOKEN_UID);
    expect(balanceB[0].balance.unlocked).toBe(45n); // 10 legacy + 20 + 15 shielded

    // Check wallet data tracks both chains
    const walletData = await walletB.storage.getWalletData();
    expect(walletData.lastUsedAddressIndex).toBe(0);
    expect(walletData.shieldedLastUsedAddressIndex).toBeGreaterThanOrEqual(5);
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
      { address: shieldedAddrB0, value: 30n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
      { address: shieldedAddrB1, value: 20n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.AMOUNT_SHIELDED },
    ]);
    const tx = await sendTx.run('sign-tx');

    // Find the ShieldedOutputsHeader
    const shieldedHeader = tx.headers.find(h => h instanceof ShieldedOutputsHeader) as ShieldedOutputsHeader | undefined;
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
      { address: shieldedAddrB0, value: 30n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.FULLY_SHIELDED },
      { address: shieldedAddrB1, value: 20n, token: NATIVE_TOKEN_UID, shielded: ShieldedOutputMode.FULLY_SHIELDED },
    ]);
    const tx = await sendTx.run('sign-tx');

    const shieldedHeader = tx.headers.find(h => h instanceof ShieldedOutputsHeader) as ShieldedOutputsHeader | undefined;
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
});
