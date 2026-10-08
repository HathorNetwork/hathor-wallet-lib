/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Builders for the wallet-service's shielded API payloads, mirroring the
 * server contract on wallet-service `origin/master` (api/addresses.ts,
 * api/newAddresses.ts, api/balances.ts, api/txOutputs.ts, db/index.ts).
 * Tests share these so the contract lives in one place.
 */

import { PRECALCULATED_SHIELDED_ADDRESSES } from '../integration/configuration/precalculated-shielded-addresses';

export const shieldedFixtureSeed =
  'avocado spot town typical traffic vault danger century property shallow divorce festival spend attack anchor afford rotate green audit adjust fade wagon depart level';

export const shieldedFixtureAddresses = PRECALCULATED_SHIELDED_ADDRESSES[shieldedFixtureSeed];

const shieldedPath = (index: number) => `m/44'/280'/2'/0/${index}`;

/** A legacy testnet address used alongside the shielded fixtures. */
export const legacyFixtureAddress = 'WP1rVhxzT3YTWg8VbBKkacLqLU2LrouWDx';

/** One row of `GET wallet/addresses?legacy=false`. */
export const buildShieldedAddressRow = (index: number, transactions = 0) => ({
  address: shieldedFixtureAddresses[index].shieldedBase58,
  spendAddress: shieldedFixtureAddresses[index].spendBase58,
  index,
  transactions,
  seqnum: 0,
});

/** Body of `GET wallet/addresses/new?legacy=false`. */
export const buildShieldedNewAddressesResponse = (indexes: number[] = [0, 1, 2]) => ({
  success: true,
  addresses: indexes.map(index => ({
    address: shieldedFixtureAddresses[index].shieldedBase58,
    index,
    addressPath: shieldedPath(index),
  })),
  spendAddresses: indexes.map(index => ({
    address: shieldedFixtureAddresses[index].spendBase58,
    index,
    addressPath: shieldedPath(index),
  })),
  legacyAddresses: [{ address: legacyFixtureAddress, index: 5, addressPath: "m/44'/280'/0'/0/5" }],
});

/** One shielded entry of `GET wallet/tx_outputs` (mode 1 = amount shielded, 2 = fully shielded). */
export const buildShieldedTxOutputEntry = (
  overrides: { mode?: 1 | 2; index?: number; shieldedIndex?: number; value?: number } = {}
) => {
  const { mode = 1, index = 5, shieldedIndex = 1, value = 150 } = overrides;
  const base = {
    kind: 'shielded',
    txId: '00000000c3c4a3a1d7a7d2e5b3b6e1f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
    index,
    tokenId: '00',
    address: shieldedFixtureAddresses[shieldedIndex].spendBase58,
    value,
    authorities: 0,
    timelock: null,
    heightlock: null,
    locked: false,
    spentBy: null,
    txProposalId: null,
    txProposalIndex: null,
    addressPath: shieldedPath(shieldedIndex),
    mode,
    recoveryState: 'recovered',
    shieldedIndex,
    ctAddress: shieldedFixtureAddresses[shieldedIndex].shieldedBase58,
    commitment: '08'.padEnd(66, 'a'),
    ephemeralPubkey: '02'.padEnd(66, 'b'),
    rangeProof: 'cd'.repeat(32),
    script: '76a914'.padEnd(50, 'e'),
  };
  if (mode === 1) {
    return { ...base, tokenData: 0 };
  }
  return { ...base, assetCommitment: '0a'.padEnd(66, 'f'), surjectionProof: 'ab'.repeat(32) };
};

/** One transparent entry of `GET wallet/tx_outputs` from an updated server. */
export const buildTransparentTxOutputEntry = (withKind = true) => ({
  ...(withKind ? { kind: 'transparent', mode: 0, recoveryState: null } : {}),
  txId: '00000000c3c4a3a1d7a7d2e5b3b6e1f4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e1',
  index: 0,
  tokenId: '00',
  address: legacyFixtureAddress,
  value: 100,
  authorities: 0,
  timelock: null,
  heightlock: null,
  locked: false,
  addressPath: "m/44'/280'/0'/0/5",
});

/** Body of `GET wallet/balances?split=true` for HTR. */
export const buildSplitBalanceResponse = () => ({
  success: true,
  status: 'ready',
  balances: [
    {
      token: { id: '00', name: 'Hathor', symbol: 'HTR', version: 0 },
      transactions: 50,
      balance: {
        unlocked: { transparent: 1000, shielded: 2500, total: 3500 },
        locked: { transparent: 0, shielded: 0, total: 0 },
      },
      lockExpires: null,
      tokenAuthorities: {
        unlocked: { mint: false, melt: false },
        locked: { mint: false, melt: false },
      },
    },
  ],
});
