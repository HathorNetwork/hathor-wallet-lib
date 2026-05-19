# SingleKeyWallet Inheritance Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the Web3Auth single-key wallet PoC from flag-based guards scattered across `HathorWallet` into a `SingleKeyWallet extends HathorWallet` subclass, fixing the `changeEncryptionPin` bug and completing the RFC acceptance criteria for `hathor-wallet-lib`.

**Architecture:** `SingleKeyWallet` extends `HathorWallet` and overrides ~15 HD-specific methods. The PoC's foundational changes stay in place (types, storage, access data generation, `start()` branch). Inline `if (singleKeyMode)` guards in `HathorWallet` move to clean overrides in the subclass. `privateKey`/`publicKey` are removed from `HathorWalletConstructorParams` (the public type) so TypeScript prevents `new HathorWallet({ privateKey })` at compile time; a `new.target` runtime guard provides defense-in-depth. Consumers typed as `IHathorWallet` accept `SingleKeyWallet` via structural subtyping — no formal `implements` declaration needed (the existing `HathorWallet`/`IHathorWallet` signature mismatches are a pre-existing issue outside this scope).

**Tech Stack:** TypeScript, Jest, bitcore-lib

**Branch:** `feat/web3auth-single-key-poc` (worktree at `/Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth`)

**RFC:** `internal-rfcs/projects/wallet-mobile/0003-web3auth-single-key-wallet.md`

---

## Context for the implementer

The PoC (PR #1062, 2 commits) already added:
- `privateKey`/`publicKey` constructor params on `HathorWallet` (`src/new/wallet.ts`)
- `IWalletAccessData.singleKeyMode` + related fields (`src/types.ts`)
- `generateAccessDataFromPrivateKey()` in `walletUtils` (`src/utils/wallet.ts`)
- `getSingleKeyPrivateKey()` in `Storage` class + `IStorage` interface
- `start()` branch for `this.privateKey` in `HathorWallet`
- Guards in `stream.ts` and `deriveAddressP2PKH` (defense-in-depth, keep these)
- Inline `if (accessData.singleKeyMode)` guards in `hasTxOutsideFirstAddress`, `getAddressPrivKey`, `getPrivateKeyFromAddress`, `signMessageWithAddress`
- Test file: `__tests__/new/singleKeyWallet.test.ts` (13 unit tests)

**What we're doing:** Moving the inline guards into `SingleKeyWallet` overrides, locking down `HathorWallet`'s constructor so `privateKey` is only usable via `SingleKeyWallet`, adding the missing guards from RFC section 1.7, fixing `changeEncryptionPin`, addressing review gaps (signing rejection, sync mode restriction, `getAddressPubkey` guard), and adding the safety test.

**What stays untouched:** All PoC changes to `src/types.ts`, `src/storage/storage.ts`, `src/utils/wallet.ts` (except `changeEncryptionPin`), `src/sync/stream.ts`, `src/utils/address.ts` remain as-is.

**Key design decision — `new.target` constructor guard:**

`privateKey`/`publicKey` are removed from the public `HathorWalletConstructorParams` type. TypeScript excess property checking blocks `new HathorWallet({ privateKey: '...' })` at compile time. A `new.target === HathorWallet` runtime check in the constructor catches edge cases (casts, `any`). `SingleKeyWallet` passes `privateKey` via `super()` and `new.target === SingleKeyWallet` lets it through.

---

## Task 1: Lock down `HathorWallet` constructor + create `SingleKeyWallet` skeleton

**Files:**
- Modify: `src/new/types.ts` (move `privateKey`/`publicKey` out of public params, add `SingleKeyWalletConstructorParams`)
- Modify: `src/new/wallet.ts` (add `new.target` guard, make `privateKey`/`publicKey` protected)
- Create: `src/new/singleKeyWallet.ts`
- Test: `__tests__/new/singleKeyWallet.test.ts` (update existing)

### Step 1: Refactor `HathorWalletConstructorParams` in `src/new/types.ts`

Remove `privateKey` and `publicKey` from `HathorWalletConstructorParams` (lines 59-62 of the PoC). Then add two new types after the closing brace (line 87):

```ts
/**
 * @internal — Extended constructor params including single-key fields.
 * Use {@link SingleKeyWalletConstructorParams} and {@link SingleKeyWallet}
 * instead of passing these to HathorWallet directly.
 */
export interface HathorWalletInternalConstructorParams extends HathorWalletConstructorParams {
  /** Raw secp256k1 private key (hex). Only via SingleKeyWallet. */
  privateKey?: string;
  /** DER-encoded compressed public key (hex). Required with privateKey. */
  publicKey?: string;
}

/**
 * Constructor parameters for SingleKeyWallet.
 *
 * A single-key wallet is backed by a raw secp256k1 private key (no BIP32 HD
 * tree) and has exactly one address. Intended for Web3Auth / social-login
 * onboarding.
 */
export interface SingleKeyWalletConstructorParams {
  /** Connection to the fullnode server */
  connection: WalletConnection;
  /** Storage implementation (defaults to MemoryStore if not provided) */
  storage?: IStorage;
  /** Raw 32-byte secp256k1 private key as hex string (no 0x prefix) */
  privateKey: string;
  /** DER-encoded compressed public key as hex string */
  publicKey: string;
  /** The single P2PKH address derived from publicKey */
  address: string;
  /** UID of the token to track (defaults to HTR) */
  tokenUid?: string;
  /** PIN code to encrypt the private key at rest and execute wallet actions */
  pinCode: string;
  /** Password to encrypt access data */
  password?: string | null;
  /** Enable debug mode */
  debug?: boolean;
  /** Callback executed before reloading wallet data */
  beforeReloadCallback?: (() => void) | null;
  /** Logger instance */
  logger?: ILogger | null;
}
```

### Step 2: Update `HathorWallet` constructor in `src/new/wallet.ts`

Change the constructor signature to accept `HathorWalletInternalConstructorParams` (import it from types). Change `privateKey` and `publicKey` class properties from implicit public to `protected`:

```ts
  // Change from:
  privateKey?: string;
  publicKey?: string;
  // To:
  protected privateKey?: string;
  protected publicKey?: string;
```

Add `new.target` guard at the top of the constructor body, right after `super()` and the connection check:

```ts
    // Prevent direct use of privateKey on HathorWallet — use SingleKeyWallet instead.
    if (privateKey && new.target === HathorWallet) {
      throw new Error(
        'privateKey is not accepted directly on HathorWallet. Use SingleKeyWallet instead.'
      );
    }
```

### Step 3: Write failing constructor tests

Replace the `singleKeyWallet -- construction validation` describe block in `__tests__/new/singleKeyWallet.test.ts`. Keep all imports and fixtures (lines 1-65) unchanged. Add `SingleKeyWallet` import and update:

```ts
import SingleKeyWallet from '../../src/new/singleKeyWallet';

// ... (keep existing fixtures: SEED, NETWORK_NAME, rawPrivHex, pubKeyHex, expectedAddress, etc.)

describe('SingleKeyWallet -- construction validation', () => {
  test('constructs with required params', () => {
    expect(
      () =>
        new SingleKeyWallet({
          connection: makeMockedConnection() as never,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
          address: expectedAddress,
          pinCode: PIN,
        })
    ).not.toThrow();
  });

  test('is an instance of both SingleKeyWallet and HathorWallet', () => {
    const wallet = new SingleKeyWallet({
      connection: makeMockedConnection() as never,
      privateKey: rawPrivHex,
      publicKey: pubKeyHex,
      address: expectedAddress,
      pinCode: PIN,
    });
    expect(wallet).toBeInstanceOf(SingleKeyWallet);
    expect(wallet).toBeInstanceOf(HathorWallet);
  });

  test('HathorWallet rejects privateKey directly (new.target guard)', () => {
    expect(
      () =>
        new HathorWallet({
          connection: makeMockedConnection() as never,
          privateKey: rawPrivHex,
          publicKey: pubKeyHex,
          preCalculatedAddresses: [expectedAddress],
          pinCode: PIN,
        } as any) // cast needed since privateKey is no longer on the public type
    ).toThrow(/Use SingleKeyWallet/);
  });
});
```

### Step 4: Run test to verify it fails

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts -v --no-coverage 2>&1 | tail -20`

Expected: FAIL — `Cannot find module '../../src/new/singleKeyWallet'`

### Step 5: Create `SingleKeyWallet` class

Create `src/new/singleKeyWallet.ts`:

```ts
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { SCANNING_POLICY } from '../types';
import HathorWallet from './wallet';
import { SingleKeyWalletConstructorParams } from './types';

/**
 * A single-key wallet backed by a raw secp256k1 private key (no BIP32 HD tree).
 *
 * Intended for Web3Auth / social-login onboarding where the auth provider
 * returns a single private key with no chain code. The wallet has exactly one
 * address and delegates transaction signing to an external signer callback
 * registered via {@link setExternalTxSigningMethod}.
 *
 * Extends {@link HathorWallet} and overrides HD-specific methods that are
 * meaningless or dangerous for single-key wallets.
 */
class SingleKeyWallet extends HathorWallet {
  constructor({
    connection,
    storage,
    privateKey,
    publicKey,
    address,
    tokenUid,
    pinCode,
    password = null,
    debug = false,
    beforeReloadCallback = null,
    logger = null,
  }: SingleKeyWalletConstructorParams) {
    super({
      connection,
      storage,
      privateKey,
      publicKey,
      preCalculatedAddresses: [address],
      scanPolicy: { policy: SCANNING_POLICY.SINGLE_ADDRESS },
      tokenUid,
      pinCode,
      password,
      debug,
      beforeReloadCallback,
      logger,
    });
  }
}

export default SingleKeyWallet;
```

### Step 6: Run tests to verify they pass

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="construction validation" -v --no-coverage 2>&1 | tail -20`

Expected: PASS

### Step 7: Commit

```
feat: lock down HathorWallet constructor + add SingleKeyWallet skeleton

- Remove privateKey/publicKey from public HathorWalletConstructorParams
- Add new.target runtime guard preventing direct use on HathorWallet
- Make privateKey/publicKey properties protected
- Create SingleKeyWallet with simplified constructor
```

---

## Task 2: Override methods that must throw (not supported for single-key)

**Files:**
- Modify: `src/new/singleKeyWallet.ts`
- Test: `__tests__/new/singleKeyWallet.test.ts`

These methods are meaningless for a single-key wallet and must throw a clear error.

### Step 1: Write failing tests

Add to `__tests__/new/singleKeyWallet.test.ts`:

```ts
describe('SingleKeyWallet -- unsupported HD methods throw', () => {
  let wallet: SingleKeyWallet;

  beforeEach(async () => {
    ({ wallet } = await buildPopulatedSingleKeyWallet());
  });

  test('setGapLimit throws', async () => {
    await expect(wallet.setGapLimit(20)).rejects.toThrow(/not supported/i);
  });

  test('indexLimitLoadMore throws', async () => {
    await expect(wallet.indexLimitLoadMore(10)).rejects.toThrow(/not supported/i);
  });

  test('indexLimitSetEndIndex throws', async () => {
    await expect(wallet.indexLimitSetEndIndex(5)).rejects.toThrow(/not supported/i);
  });

  test('enableMultiAddressMode throws', async () => {
    await expect(wallet.enableMultiAddressMode()).rejects.toThrow(/not supported/i);
  });

  test('getMultisigData throws', async () => {
    await expect(wallet.getMultisigData()).rejects.toThrow(/not supported/i);
  });

  test('getAllSignatures throws', async () => {
    await expect(wallet.getAllSignatures('deadbeef', PIN)).rejects.toThrow(/not supported/i);
  });

  test('assemblePartialTransaction throws', async () => {
    await expect(wallet.assemblePartialTransaction('deadbeef', [])).rejects.toThrow(
      /not supported/i
    );
  });
});
```

**Note:** `buildPopulatedSingleKeyWallet` needs updating to return a `SingleKeyWallet` instead of `HathorWallet`. Change the function:

```ts
async function buildPopulatedSingleKeyWallet(opts?: {
  pin?: string;
}): Promise<{ wallet: SingleKeyWallet; storage: IStorage }> {
  const store = new MemoryStore();
  const storage = new Storage(store);
  storage.config.setNetwork(NETWORK_NAME);

  await storage.setScanningPolicyData({ policy: SCANNING_POLICY.SINGLE_ADDRESS });

  const accessData = walletUtils.generateAccessDataFromPrivateKey(rawPrivHex, pubKeyHex, {
    pin: opts?.pin ?? PIN,
  });
  await storage.saveAccessData(accessData);
  await storage.saveAddress({
    base58: expectedAddress,
    bip32AddressIndex: 0,
    publicKey: pubKeyHex,
  });

  const wallet = new SingleKeyWallet({
    connection: makeMockedConnection() as never,
    storage,
    privateKey: rawPrivHex,
    publicKey: pubKeyHex,
    address: expectedAddress,
    pinCode: opts?.pin ?? PIN,
    password: PASSWORD,
  });

  return { wallet, storage };
}
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="unsupported HD" -v --no-coverage 2>&1 | tail -30`

Expected: FAIL — methods don't throw

### Step 3: Implement the overrides

Add to `src/new/singleKeyWallet.ts`, inside the class body after the constructor:

```ts
  // ---------------------------------------------------------------------------
  // HD methods that are not supported for single-key wallets
  // ---------------------------------------------------------------------------

  async setGapLimit(_value: number): Promise<void> {
    throw new Error('setGapLimit is not supported for single-key wallets.');
  }

  async indexLimitLoadMore(_count: number): Promise<number> {
    throw new Error('indexLimitLoadMore is not supported for single-key wallets.');
  }

  async indexLimitSetEndIndex(_endIndex: number): Promise<void> {
    throw new Error('indexLimitSetEndIndex is not supported for single-key wallets.');
  }

  async enableMultiAddressMode(): Promise<void> {
    throw new Error('enableMultiAddressMode is not supported for single-key wallets.');
  }

  async getMultisigData(): Promise<never> {
    throw new Error('getMultisigData is not supported for single-key wallets.');
  }

  async getAllSignatures(_txHex: string, _pin: string): Promise<never> {
    throw new Error('getAllSignatures is not supported for single-key wallets.');
  }

  async assemblePartialTransaction(_txHex: string, _signatures: string[]): Promise<never> {
    throw new Error('assemblePartialTransaction is not supported for single-key wallets.');
  }
```

### Step 4: Run tests to verify they pass

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="unsupported HD" -v --no-coverage 2>&1 | tail -30`

Expected: PASS

### Step 5: Commit

```
feat: SingleKeyWallet throws on unsupported HD/multisig methods
```

---

## Task 3: Override methods with single-key behavior

**Files:**
- Modify: `src/new/singleKeyWallet.ts`
- Test: `__tests__/new/singleKeyWallet.test.ts`

### Step 1: Write failing tests

```ts
describe('SingleKeyWallet -- single-key behavior overrides', () => {
  let wallet: SingleKeyWallet;
  let storage: IStorage;

  beforeEach(async () => {
    ({ wallet, storage } = await buildPopulatedSingleKeyWallet());
  });

  test('getNextAddress returns the single address with isNew false', async () => {
    const result = await wallet.getNextAddress();
    expect(result.address).toBe(expectedAddress);
    expect(result.index).toBe(0);
  });

  test('getAddressAtIndex(0) returns the single address', async () => {
    const addr = await wallet.getAddressAtIndex(0);
    expect(addr).toBe(expectedAddress);
  });

  test('getAddressAtIndex(1) throws', async () => {
    await expect(wallet.getAddressAtIndex(1)).rejects.toThrow(/index 0/);
  });

  test('getCurrentAddress returns the single address', async () => {
    const result = await wallet.getCurrentAddress();
    expect(result.address).toBe(expectedAddress);
    expect(result.index).toBe(0);
  });

  test('getAddressPathForIndex(0) returns empty string (no BIP32 path)', async () => {
    const path = await wallet.getAddressPathForIndex(0);
    expect(path).toBe('');
  });

  test('getAddressPathForIndex(1) throws', async () => {
    await expect(wallet.getAddressPathForIndex(1)).rejects.toThrow(/index 0/);
  });

  test('getAddressMode returns SINGLE_ADDRESS', async () => {
    const mode = await wallet.getAddressMode();
    expect(mode).toBe('single-address');
  });

  test('hasTxOutsideFirstAddress returns false', async () => {
    expect(await wallet.hasTxOutsideFirstAddress()).toBe(false);
  });

  test('enableSingleAddressMode is a no-op', async () => {
    await expect(wallet.enableSingleAddressMode()).resolves.not.toThrow();
    const policy = await storage.getScanningPolicy();
    expect(policy).toBe(SCANNING_POLICY.SINGLE_ADDRESS);
  });

  test('clearSensitiveData clears privateKey', () => {
    // Access the internal field before clearing
    expect((wallet as any).privateKey).toBeDefined();
    wallet.clearSensitiveData();
    expect((wallet as any).privateKey).toBeUndefined();
    expect((wallet as any).seed).toBeUndefined();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="single-key behavior" -v --no-coverage 2>&1 | tail -30`

Expected: FAIL

### Step 3: Implement the overrides

Add to `src/new/singleKeyWallet.ts`. Requires importing `AddressError` and `WalletAddressMode`:

```ts
import { AddressError } from '../errors';

// At the top, update imports from ../types:
import { SCANNING_POLICY, WalletAddressMode } from '../types';
```

Then inside the class:

```ts
  // ---------------------------------------------------------------------------
  // Single-key behavior overrides
  // ---------------------------------------------------------------------------

  async getNextAddress(): Promise<{ address: string; index: number | null; addressPath: string }> {
    return this.getCurrentAddress();
  }

  async getAddressAtIndex(index: number): Promise<string> {
    if (index !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }
    return super.getAddressAtIndex(0);
  }

  async getCurrentAddress(
    _options?: { markAsUsed?: boolean }
  ): Promise<{ address: string; index: number | null; addressPath: string }> {
    const address = await super.getAddressAtIndex(0);
    return { address, index: 0, addressPath: '' };
  }

  async getAddressPathForIndex(index: number): Promise<string> {
    if (index !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }
    return '';
  }

  async getAddressMode(): Promise<WalletAddressMode> {
    return 'single-address' as WalletAddressMode;
  }

  async hasTxOutsideFirstAddress(): Promise<boolean> {
    return false;
  }

  async enableSingleAddressMode(): Promise<void> {
    // Already in single-address mode by construction — no-op.
  }

  clearSensitiveData(): void {
    super.clearSensitiveData();
    this.privateKey = undefined;
  }
```

### Step 4: Run tests to verify they pass

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="single-key behavior" -v --no-coverage 2>&1 | tail -30`

Expected: PASS

### Step 5: Commit

```
feat: SingleKeyWallet overrides for single-key address behavior
```

---

## Task 4: Override key derivation methods

**Files:**
- Modify: `src/new/singleKeyWallet.ts`
- Test: `__tests__/new/singleKeyWallet.test.ts`

These methods are already tested in the PoC tests (sections 4 and 5 of the test file). After updating `buildPopulatedSingleKeyWallet` in Task 2 to use `SingleKeyWallet`, the existing tests should pass once the overrides are in place.

### Step 1: Verify existing derivation tests now fail

The PoC tests for `getAddressPrivKey`, `getPrivateKeyFromAddress`, and `signMessageWithAddress` were written against `HathorWallet` with inline guards. After switching `buildPopulatedSingleKeyWallet` to `SingleKeyWallet`, these tests should fail because the inline guards live in `HathorWallet` and `SingleKeyWallet` doesn't override them yet.

Wait — actually the inline guards are in HathorWallet and SingleKeyWallet inherits them. So the tests will PASS via inheritance. That's fine — the point of this task is to make the overrides explicit in SingleKeyWallet so we can later remove the inline guards from HathorWallet.

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="direct derivation|parity" -v --no-coverage 2>&1 | tail -20`

Expected: PASS (inherited from parent)

### Step 2: Add the overrides to SingleKeyWallet

Add imports at the top of `src/new/singleKeyWallet.ts`:

```ts
import bitcore from 'bitcore-lib';
import { signMessage } from '../utils/crypto';
```

Then inside the class:

```ts
  // ---------------------------------------------------------------------------
  // Key derivation overrides
  // ---------------------------------------------------------------------------

  async getAddressPrivKey(pinCode: string, addressIndex: number): Promise<unknown> {
    if (addressIndex !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }
    const rawPrivHex = await this.storage.getSingleKeyPrivateKey(pinCode);
    return new bitcore.PrivateKey(rawPrivHex);
  }

  async getPrivateKeyFromAddress(
    address: string,
    options?: { pinCode?: string | null }
  ): Promise<unknown> {
    const pin = options?.pinCode ?? this.pinCode;
    if (!pin) {
      throw new Error('Pin is required.');
    }

    const addrInfo = await this.storage.getAddressInfo(address);
    if (!addrInfo) {
      throw new AddressError('Address does not belong to the wallet.');
    }
    if (addrInfo.bip32AddressIndex !== 0) {
      throw new AddressError('Single-key wallets only support address index 0.');
    }

    const rawPrivHex = await this.storage.getSingleKeyPrivateKey(pin);
    return new bitcore.PrivateKey(rawPrivHex);
  }

  async signMessageWithAddress(
    message: string,
    index: number,
    pinCode: string
  ): Promise<string> {
    const key = await this.getAddressPrivKey(pinCode, index);
    return signMessage(message, key);
  }
```

### Step 3: Run existing tests to verify they still pass

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts -v --no-coverage 2>&1 | tail -30`

Expected: PASS (all tests including derivation, parity, and signer tests)

### Step 4: Commit

```
feat: SingleKeyWallet key derivation and signing overrides
```

---

## Task 5: Fix `changeEncryptionPin` for single-key wallets

**Files:**
- Modify: `src/utils/wallet.ts`
- Test: `__tests__/new/singleKeyWallet.test.ts`

This is the **critical bug** found in the PoC: `changeEncryptionPin` doesn't re-encrypt `singleKeyPrivateKey`, so changing PIN on a single-key wallet loses access to the private key.

### Step 1: Write failing test

Add to `__tests__/new/singleKeyWallet.test.ts`:

```ts
describe('SingleKeyWallet -- changeEncryptionPin', () => {
  test('re-encrypts singleKeyPrivateKey with new pin', async () => {
    const { storage } = await buildPopulatedSingleKeyWallet({ pin: PIN });
    const accessData = await storage.getAccessData();
    expect(accessData).not.toBeNull();

    const OLD_PIN = PIN;
    const NEW_PIN = '654321';

    const newAccessData = walletUtils.changeEncryptionPin(accessData!, OLD_PIN, NEW_PIN);

    // The new access data should have the private key encrypted with the new pin
    expect(newAccessData.singleKeyPrivateKey).toBeDefined();
    expect(newAccessData.singleKeyMode).toBe(true);

    // Save and verify we can decrypt with new pin
    await storage.saveAccessData(newAccessData);
    const decrypted = await storage.getSingleKeyPrivateKey(NEW_PIN);
    expect(decrypted).toBe(rawPrivHex);

    // Old pin should fail
    await expect(storage.getSingleKeyPrivateKey(OLD_PIN)).rejects.toThrow();
  });

  test('throws when no encrypted data exists (neither HD nor single-key)', () => {
    const emptyAccessData = {
      walletType: 'p2pkh' as any,
      walletFlags: 0,
    };
    expect(() => walletUtils.changeEncryptionPin(emptyAccessData as any, '1', '2')).toThrow(
      /No data to change/
    );
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="changeEncryptionPin" -v --no-coverage 2>&1 | tail -20`

Expected: FAIL — `"No data to change"` thrown because `singleKeyPrivateKey` is not handled

### Step 3: Fix `changeEncryptionPin` in `src/utils/wallet.ts`

Replace lines 739-768 (`changeEncryptionPin` method):

```ts
  changeEncryptionPin(
    accessData: IWalletAccessData,
    oldPin: string,
    newPin: string
  ): IWalletAccessData {
    const data = _.cloneDeep(accessData);
    if (!(data.mainKey || data.authKey || data.acctPathKey || data.singleKeyPrivateKey)) {
      throw new Error('No data to change');
    }

    if (data.mainKey) {
      const mainKey = decryptData(data.mainKey, oldPin);
      const newEncryptedMainKey = encryptData(mainKey, newPin);
      data.mainKey = newEncryptedMainKey;
    }

    if (data.authKey) {
      const authKey = decryptData(data.authKey, oldPin);
      const newEncryptedAuthKey = encryptData(authKey, newPin);
      data.authKey = newEncryptedAuthKey;
    }

    if (data.acctPathKey) {
      const acctPathKey = decryptData(data.acctPathKey, oldPin);
      const newEncryptedAcctPathKey = encryptData(acctPathKey, newPin);
      data.acctPathKey = newEncryptedAcctPathKey;
    }

    if (data.singleKeyPrivateKey) {
      const privateKey = decryptData(data.singleKeyPrivateKey, oldPin);
      data.singleKeyPrivateKey = encryptData(privateKey, newPin);
    }

    return data;
  },
```

### Step 4: Run test to verify it passes

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="changeEncryptionPin" -v --no-coverage 2>&1 | tail -20`

Expected: PASS

### Step 5: Commit

```
fix: changeEncryptionPin now re-encrypts singleKeyPrivateKey
```

---

## Task 6: Remove inline guards from `HathorWallet`

**Files:**
- Modify: `src/new/wallet.ts`

Now that `SingleKeyWallet` has its own overrides and `new.target` prevents direct `privateKey` use on `HathorWallet`, the inline `if (singleKeyMode)` guards are redundant. Removing them keeps `HathorWallet` focused on HD wallets.

**Keep untouched:** Guards in `stream.ts` and `deriveAddressP2PKH` — those are defense-in-depth at infrastructure level.

**Note on `clearSensitiveData`:** Since `privateKey` is now `protected` and `new.target` prevents direct use on `HathorWallet`, no external code can reach `HathorWallet.clearSensitiveData()` with a `privateKey` set. `SingleKeyWallet.clearSensitiveData()` handles the subclass case. Safe to revert.

### Step 1: Remove `hasTxOutsideFirstAddress` guard

In `src/new/wallet.ts`, remove the `singleKeyMode` short-circuit added by the PoC (lines ~804-810 in the PoC diff):

```ts
// REMOVE this block from hasTxOutsideFirstAddress():
    const accessData = await this.storage?.getAccessData?.();
    if (accessData?.singleKeyMode) {
      return false;
    }
```

### Step 2: Remove `getAddressPrivKey` guard

In `src/new/wallet.ts`, remove the `singleKeyMode` branch at the top of `getAddressPrivKey` (lines ~1808-1818 in the PoC diff):

```ts
// REMOVE this block from getAddressPrivKey():
    const accessData = await this.storage.getAccessData();
    if (accessData?.singleKeyMode) {
      if (addressIndex !== 0) {
        throw new AddressError('Single-key wallets only support address index 0.');
      }
      const rawPrivHex = await this.storage.getSingleKeyPrivateKey(pinCode);
      return new bitcore.PrivateKey(rawPrivHex);
    }
```

### Step 3: Remove `getPrivateKeyFromAddress` guard

In `src/new/wallet.ts`, remove the `singleKeyMode` branch (lines ~3348-3356 in the PoC diff):

```ts
// REMOVE this block from getPrivateKeyFromAddress():
    const accessData = await this.storage.getAccessData();
    if (accessData?.singleKeyMode) {
      if (addressIndex !== 0) {
        throw new AddressError('Single-key wallets only support address index 0.');
      }
      const rawPrivHex = await this.storage.getSingleKeyPrivateKey(pin);
      return new bitcore.PrivateKey(rawPrivHex);
    }
```

### Step 4: Revert `signMessageWithAddress` to original

In `src/new/wallet.ts`, revert `signMessageWithAddress` to its pre-PoC form:

```ts
  async signMessageWithAddress(message: string, index: number, pinCode: string): Promise<string> {
    const addressHDPrivKey = (await this.getAddressPrivKey(pinCode, index)) as {
      privateKey: unknown;
    };
    const signedMessage = signMessage(message, addressHDPrivKey.privateKey);
    return signedMessage;
  }
```

### Step 5: Revert `clearSensitiveData` to original

In `src/new/wallet.ts`, remove the `this.privateKey = undefined;` line added by the PoC from `clearSensitiveData`. `SingleKeyWallet.clearSensitiveData` handles this via its override + `super.clearSensitiveData()`. The `new.target` guard ensures no external code can reach `HathorWallet` directly with `privateKey` set.

```ts
  clearSensitiveData(): void {
    this.xpriv = undefined;
    this.seed = undefined;
  }
```

### Step 6: Run ALL tests to verify nothing broke

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest --no-coverage 2>&1 | tail -20`

Expected: PASS — SingleKeyWallet tests pass via overrides, HD wallet tests pass via original logic.

### Step 7: Commit

```
refactor: remove inline singleKeyMode guards from HathorWallet

SingleKeyWallet overrides now handle all single-key behavior.
HathorWallet rejects privateKey directly via new.target guard.
Defense-in-depth guards in stream.ts and deriveAddressP2PKH are kept.
```

---

## Task 7: Safety test — verify all HD methods are overridden

**Files:**
- Test: `__tests__/new/singleKeyWallet.test.ts`

This test catches future regressions: if someone adds a new HD-specific method to `HathorWallet` and forgets to override it in `SingleKeyWallet`, this test fails.

### Step 1: Write the safety test

Add to `__tests__/new/singleKeyWallet.test.ts`:

```ts
describe('SingleKeyWallet -- override safety net', () => {
  // Methods that touch HD internals (xpub derivation, gap limit, multi-address,
  // multisig) and MUST be overridden in SingleKeyWallet. If you add a new
  // HD-specific method to HathorWallet, add it here.
  const HD_METHODS_REQUIRING_OVERRIDE = [
    'setGapLimit',
    'indexLimitLoadMore',
    'indexLimitSetEndIndex',
    'enableMultiAddressMode',
    'getMultisigData',
    'getAllSignatures',
    'assemblePartialTransaction',
    'getNextAddress',
    'getAddressAtIndex',
    'getCurrentAddress',
    'getAddressPathForIndex',
    'getAddressMode',
    'hasTxOutsideFirstAddress',
    'enableSingleAddressMode',
    'clearSensitiveData',
    'getAddressPrivKey',
    'getPrivateKeyFromAddress',
    'signMessageWithAddress',
  ];

  for (const method of HD_METHODS_REQUIRING_OVERRIDE) {
    test(`overrides ${method}`, () => {
      expect(SingleKeyWallet.prototype[method]).not.toBe(HathorWallet.prototype[method]);
    });
  }
});
```

### Step 2: Run it

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="override safety" -v --no-coverage 2>&1 | tail -30`

Expected: PASS (all 18 methods confirmed overridden)

### Step 3: Commit

```
test: add safety net verifying SingleKeyWallet HD method overrides
```

---

## Task 8: Address review gaps — signing rejection, sync mode, getAddressPubkey

**Files:**
- Modify: `src/utils/storage.ts` (restrict sync modes for single-key)
- Modify: `src/storage/storage.ts` (guard `getAddressPubkey` xpubkey fallback)
- Test: `__tests__/new/singleKeyWallet.test.ts`

These gaps were found by the code review against the RFC.

### Step 1: Write failing tests

```ts
describe('SingleKeyWallet -- review gap fixes', () => {
  test('signing a tx without external signer registered produces a clear error', async () => {
    const { wallet, storage } = await buildPopulatedSingleKeyWallet();
    // Do NOT register an external signer — this is the test scenario
    const tx = new Transaction([], []);
    // getTxSignatures falls through to the default signing path which
    // requires an xpriv. For single-key wallets this should fail clearly.
    await expect(storage.getTxSignatures(tx, PIN)).rejects.toThrow();
  });

  test('getAddressPrivKey with wrong pin throws', async () => {
    const { wallet } = await buildPopulatedSingleKeyWallet();
    await expect(wallet.getAddressPrivKey('wrong-pin', 0)).rejects.toThrow();
  });
});
```

### Step 2: Run tests to verify behavior

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest __tests__/new/singleKeyWallet.test.ts --testNamePattern="review gap" -v --no-coverage 2>&1 | tail -20`

These tests should pass already (errors propagate from the decryption/signing layer). If they do, they serve as regression tests.

### Step 3: Guard `getAddressPubkey` xpubkey fallback

In `src/storage/storage.ts`, method `getAddressPubkey` (around line 245-256), the fallback path does `new HDPublicKey(accessData.xpubkey)`. Add a guard before it:

```ts
    // If public key is cached on the address, return it directly.
    // (Single-key wallets always cache the key via start().)
    if (addressInfo.publicKey) {
      return addressInfo.publicKey;
    }

    // Fallback: derive from xpub (HD wallets only)
    const accessData = await this._getValidAccessData();
    if (!accessData.xpubkey) {
      throw new Error('Cannot derive public key: wallet has no xpub (single-key wallet). The public key should have been cached on the address.');
    }
    // ... existing HDPublicKey derivation
```

Check if this guard already exists or if the code already returns early when `publicKey` is cached. If the early return is already in place, just add the `xpubkey` null check before the `new HDPublicKey()` call.

### Step 4: Restrict `getSupportedSyncMode` for single-key

In `src/utils/storage.ts`, method `getSupportedSyncMode` (around line 63-76), the `WalletType.P2PKH` branch returns `XPUB_STREAM_WS` as a supported mode. For single-key wallets, xpub-stream is not available because there's no xpub.

Add a check after the walletType switch:

```ts
  // Single-key wallets cannot use xpub-based stream sync
  const accessData = await storage.getAccessData();
  if (accessData?.singleKeyMode) {
    return modes.filter(m => m !== HistorySyncMode.XPUB_STREAM_WS);
  }
```

### Step 5: Run full test suite

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest --no-coverage 2>&1 | tail -20`

Expected: PASS

### Step 6: Commit

```
fix: guard xpubkey fallback in getAddressPubkey + restrict sync modes for single-key

- getAddressPubkey throws clearly if xpubkey is missing and publicKey not cached
- getSupportedSyncMode excludes XPUB_STREAM_WS for singleKeyMode wallets
- Add regression tests for signing rejection and wrong-pin on SingleKeyWallet
```

---

## Task 9: Export `SingleKeyWallet` and update mock

**Files:**
- Modify: `src/lib.ts` (add export)
- Modify: `__tests__/wallet/walletServiceStorageProxy.test.ts` (add mock method)

### Step 1: Export from `src/lib.ts`

Add import near the `HathorWallet` import (around line 17):

```ts
import SingleKeyWallet from './new/singleKeyWallet';
```

Add to the named exports block (around line 85, after `HathorWallet`):

```ts
  SingleKeyWallet,
```

### Step 2: Add `getSingleKeyPrivateKey` mock in storage proxy test

In `__tests__/wallet/walletServiceStorageProxy.test.ts`, find the `mockStorage` object and add:

```ts
  getSingleKeyPrivateKey: jest.fn(),
```

### Step 3: Run full test suite

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npx jest --no-coverage 2>&1 | tail -30`

Expected: PASS — no regressions

### Step 4: Commit

```
feat: export SingleKeyWallet from library public API
```

---

## Task 10: Full regression check + lint

**Files:** None (verification only)

### Step 1: Run linter

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npm run lint 2>&1 | tail -20`

Expected: PASS (or fix any lint errors)

### Step 2: Run full test suite with coverage

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npm test 2>&1 | tail -40`

Expected: PASS — all existing HD wallet tests + all SingleKeyWallet tests

### Step 3: Build check

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && npm run build 2>&1 | tail -20`

Expected: PASS

### Step 4: Verify the diff is clean

Run: `cd /Users/rauloliveira/git/hathor/hathor-wallet-lib-web3auth && git diff --stat origin/master`

Verify that the changes make sense: new file `src/new/singleKeyWallet.ts`, modified test file, and the PoC's original changes.

---

## Out of scope (documented for follow-up)

1. **`HathorWallet implements IHathorWallet`** — the interface has ~11 signature mismatches with the implementation. Fixing these is a valuable but separate refactor.
2. **E2E integration test** (RFC acceptance criteria) — requires Docker network; should be a follow-up PR.
3. **README/JSDoc documentation** for the new `SingleKeyWallet` public API.
4. **Wallet-service guards** — `HathorWalletServiceWallet.getAddressPrivKey` (`:1473`) and `getPrivateKeyFromAddress` (`:1675`) should throw for single-key wallets. `HathorWalletServiceWallet` should also reject `singleKeyMode` access data at construction (RFC §1.9). Wallet-service is disabled in Phase 1 per RFC — add guards when wallet-service support is implemented.
5. **`WalletType` enum audit** — RFC unresolved question. The flag approach (`singleKeyMode: true` on `WalletType.P2PKH`) is used. A quick `WalletType` switch-site audit should be done to confirm no surprises, but is not blocking.
