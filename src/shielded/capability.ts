/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ShieldedKeyError, ShieldedKeyErrorCode } from '../errors';
import { ErrorMessages } from '../errorMessages';
import { HistorySyncMode, IStorage, WALLET_FLAGS, WalletType } from '../types';
import walletUtils from '../utils/wallet';
import { shieldedSessionOf } from './session';
import type {
  IShieldedCapability,
  ShieldedCapabilityCause,
  ShieldedCapabilityLevel,
  ShieldedCapabilityReason,
} from './types';

/** The reasons a level below `view` can have. */
type ShieldedAddressRefusalReason = Exclude<ShieldedCapabilityReason, 'no-spend-authority'>;

/** The causes of a session that holds no scan key. */
const LOCK_CAUSES: ReadonlySet<ShieldedCapabilityCause> = new Set<ShieldedCapabilityCause>([
  'not-supplied',
  'wrong-pin',
  'corrupt-key',
  'error',
]);

/** The causes of a failed migration, which leaves the record without shielded keys. */
const MIGRATION_CAUSES: ReadonlySet<ShieldedCapabilityCause> = new Set<ShieldedCapabilityCause>([
  'wrong-password',
  'wrong-pin',
  'passphrase-mismatch',
]);

/** The error a request for a shielded address gets, by the reason the level is below `view`. */
const ADDRESS_REFUSALS: Record<
  ShieldedAddressRefusalReason,
  { code: ShieldedKeyErrorCode; message: string }
> = {
  'not-started': {
    code: ErrorMessages.SHIELDED_NOT_STARTED,
    message: 'The wallet is not started, so it gives no shielded address.',
  },
  multisig: {
    code: ErrorMessages.SHIELDED_MULTISIG,
    message:
      'A multisig wallet has no shielded addresses: its shielded keys are single-signature keys.',
  },
  integrity: {
    code: ErrorMessages.SHIELDED_INTEGRITY,
    message:
      "The wallet's shielded keys do not match each other, so it gives no shielded address until they are repaired.",
  },
  'needs-password': {
    code: ErrorMessages.SHIELDED_NO_KEYS,
    message: 'The wallet record has no shielded keys.',
  },
  hardware: {
    code: ErrorMessages.SHIELDED_NO_KEYS,
    message: 'The wallet record has no shielded keys.',
  },
  'no-shielded-keys': {
    code: ErrorMessages.SHIELDED_NO_KEYS,
    message: 'The wallet record has no shielded keys.',
  },
  'no-provider': {
    code: ErrorMessages.SHIELDED_NO_PROVIDER,
    message:
      'No shielded crypto provider is registered, so the wallet cannot see what a shielded address receives.',
  },
  locked: {
    code: ErrorMessages.SHIELDED_LOCKED,
    message:
      "The wallet's scan key is not unlocked, so it cannot see what a shielded address receives.",
  },
};

/**
 * What the wallet whose storage is `storage` can do with shielded outputs, and
 * why it cannot do more.
 *
 * It needs no wallet object, so code that holds only the storage reads the
 * same capability as the wallet. The checks run in this order, and the first
 * that matches gives the level and the reason:
 * 1. the wallet is not started: `none`, `not-started`;
 * 2. the wallet is multisig: `none`, `multisig`;
 * 3. the record's shielded keys do not match each other: `none`, `integrity`;
 * 4. the record lacks a shielded xpub: `none`, with `needs-password` when it
 *    holds the words and the main key, `hardware` for a hardware wallet, and
 *    `no-shielded-keys` otherwise;
 * 5. no crypto provider is registered, so the shielded chain is not loaded:
 *    `none`, `no-provider`;
 * 6. the scan key is not unlocked: `watch`, `locked`;
 * 7. the wallet cannot sign the inputs that spend shielded outputs: `view`,
 *    `no-spend-authority`;
 * 8. otherwise: `full`.
 *
 * @param storage The wallet storage
 */
export async function computeShieldedCapability(storage: IStorage): Promise<IShieldedCapability> {
  const accessData = await storage.getAccessData();
  const session = shieldedSessionOf(storage);
  const canSpend = storage.hasTxSignatureMethod()
    ? session.spendSigner
    : !!accessData?.spendMainKey;
  const polling = session.syncMode === HistorySyncMode.POLLING_HTTP_API;
  const capability = (
    level: ShieldedCapabilityLevel,
    reason: ShieldedCapabilityReason | null,
    cause: ShieldedCapabilityCause | null = null
  ): IShieldedCapability => ({
    level,
    reason,
    cause,
    canReceive: (level === 'view' || level === 'full') && polling,
    canSpend,
    historyComplete: level !== 'none' && polling && !session.discoveryCapped,
    undecoded: session.undecodedSummary(),
  });

  if (!session.active) {
    return capability('none', 'not-started');
  }
  if (accessData?.walletType === WalletType.MULTISIG) {
    return capability('none', 'multisig');
  }
  if (session.integrity !== null) {
    return capability('none', 'integrity', session.integrity);
  }
  if (!walletUtils.hasShieldedXpubs(accessData)) {
    if (accessData?.words && accessData.mainKey) {
      const { cause } = session;
      return capability(
        'none',
        'needs-password',
        cause !== null && MIGRATION_CAUSES.has(cause) ? cause : null
      );
    }
    if (accessData && (accessData.walletFlags & WALLET_FLAGS.HARDWARE) > 0) {
      return capability('none', 'hardware');
    }
    return capability('none', 'no-shielded-keys');
  }
  if (!storage.shieldedCryptoProvider) {
    return capability('none', 'no-provider');
  }
  if (!session.hasKey) {
    // A record that got its shielded keys after a failed migration was never
    // unlocked: its key was not supplied.
    const { cause } = session;
    return capability(
      'watch',
      'locked',
      cause !== null && LOCK_CAUSES.has(cause) ? cause : 'not-supplied'
    );
  }
  if (!canSpend) {
    return capability('view', 'no-spend-authority');
  }
  return capability('full', null);
}

/**
 * The error for a shielded address requested for `reason`.
 *
 * @param reason Why the capability level is below `view`
 */
export function shieldedAddressError(reason: ShieldedAddressRefusalReason): ShieldedKeyError {
  const { code, message } = ADDRESS_REFUSALS[reason];
  return new ShieldedKeyError(code, message);
}

/**
 * The error a request for a shielded receive address gets at `capability`, or
 * null when the wallet can give one out: at level `view` or `full`.
 *
 * A wallet that cannot decode what its shielded addresses receive never sees
 * one of them used, so it would give out the same address forever.
 *
 * @param capability The wallet's shielded capability
 */
export function shieldedAddressRefusal(capability: IShieldedCapability): ShieldedKeyError | null {
  const { level, reason } = capability;
  if (level === 'view' || level === 'full' || reason === null || reason === 'no-spend-authority') {
    return null;
  }
  return shieldedAddressError(reason);
}
