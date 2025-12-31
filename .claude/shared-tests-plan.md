# Wallet Facade Test Consolidation Plan

## Executive Summary

This document analyzes the two wallet facades (`HathorWallet` and `HathorWalletServiceWallet`) and their respective integration tests, providing a strategic approach for consolidating tests into shared test files that validate both implementations against a common contract.

---

## Part 1: Facade Analysis

### 1.1 Architecture Overview

| Aspect    | HathorWallet (Fullnode)            | HathorWalletServiceWallet  |
|-----------|------------------------------------|----------------------------|
| Location  | `src/new/wallet.ts`                | `src/wallet/wallet.ts`     |
| Lines     | ~3,372                             | ~3,002                     |
| Backend   | Direct fullnode connection         | Centralized wallet service |
| Interface | Does NOT implement `IHathorWallet` | Implements `IHathorWallet` |

### 1.2 API Signature Differences

Critical differences that affect test consolidation:

| Method                | HathorWallet             | WalletServiceWallet      | Impact                |
|-----------------------|--------------------------|--------------------------|-----------------------|
| `getCurrentAddress()` | `async`                  | `sync`                   | Test must handle both |
| `getAddressAtIndex()` | `async`                  | `sync`                   | Test must handle both |
| `isAddressMine()`     | `async`                  | `sync`                   | Test must handle both |
| `getAddressIndex()`   | `async`                  | `sync`                   | Test must handle both |
| `getAllAddresses()`   | `async`                  | `sync`                   | Test must handle both |
| `getBalance()`        | Returns balance object   | Returns balance object   | Compatible            |
| `getUtxos()`          | Returns `{utxos, total}` | Returns `{utxos, total}` | Compatible            |

### 1.3 Methods NOT Implemented in WalletServiceWallet

These methods throw "Not implemented" errors:
- `getTx()` - Transaction retrieval
- `getAddressInfo()` - Address information
- `consolidateUtxos()` - UTXO consolidation
- `getFullHistory()` - Full transaction history

### 1.4 Methods Unique to Each Facade

**HathorWallet only:**
- `checkAddressesMine()` - Batch address ownership check
- `createAndSendNanoContractTransaction()` - Nano contract support
- `createNanoContractCreateTokenTransaction()` - NC token creation
- `createNanoContractMintTokensTransaction()` - NC token minting
- `createNanoContractMeltTokensTransaction()` - NC token melting
- Template-based transaction methods (`createNewTokenFromTemplate`, etc.)

**WalletServiceWallet only:**
- `requestBiometricOperation()` - Mobile biometric support
- `updatePassphraseHash()` - Passphrase management

---

## Part 2: Test Coverage Analysis

### 2.1 Current Test Distribution

| Test File                      | Target Facade | Describe Blocks | Key Coverage Areas                                |
|--------------------------------|---------------|-----------------|---------------------------------------------------|
| `hathorwallet_facade.test.ts`  | HathorWallet  | 25              | Templates, transactions, tokens, authority, NFTs  |
| `hathorwallet_others.test.ts`  | HathorWallet  | 10              | Void handling, address info, UTXOs, consolidation |
| `walletservice_facade.test.ts` | WalletService | ~8              | Start, addresses, transactions, tokens, balances  |

### 2.2 Test Helper Discrepancy

| Aspect          | HathorWallet Tests                  | WalletService Tests                  |
|-----------------|-------------------------------------|--------------------------------------|
| Wallet Creation | `generateWalletHelper()`            | Custom `buildWalletInstance()`       |
| Fund Injection  | `GenesisWalletHelper.injectFunds()` | Uses `walletHelper.waitForBalance()` |
| Tx Confirmation | `waitForTxReceived()`               | Manual polling                       |

### 2.3 Coverage Matrix - Shared Methods

| Method                         | HathorWallet Tests | WalletService Tests   | Consolidation Priority |
|--------------------------------|--------------------|-----------------------|------------------------|
| `start()`                      | ✅                  | ✅                     | HIGH                   |
| `stop()`                       | ✅                  | ✅                     | HIGH                   |
| `getBalance()`                 | ✅                  | ✅                     | HIGH                   |
| `sendTransaction()`            | ✅                  | ✅                     | HIGH                   |
| `sendManyOutputsTransaction()` | ✅                  | ✅                     | HIGH                   |
| `getCurrentAddress()`          | ✅                  | ✅                     | MEDIUM (async diff)    |
| `getAddressAtIndex()`          | ✅                  | ✅                     | MEDIUM (async diff)    |
| `getAllAddresses()`            | ✅                  | ✅                     | MEDIUM (async diff)    |
| `isAddressMine()`              | ✅                  | ✅                     | MEDIUM (async diff)    |
| `getUtxos()`                   | ✅                  | ✅                     | MEDIUM                 |
| `createNewToken()`             | ✅                  | ✅                     | MEDIUM                 |
| `mintTokens()`                 | ✅                  | ✅                     | MEDIUM                 |
| `meltTokens()`                 | ✅                  | ✅                     | MEDIUM                 |
| `delegateAuthority()`          | ✅                  | ❌                     | LOW                    |
| `destroyAuthority()`           | ✅                  | ❌                     | LOW                    |
| `createNFT()`                  | ✅                  | ❌                     | LOW                    |
| `consolidateUtxos()`           | ✅                  | N/A (not implemented) | SKIP                   |
| `getAddressInfo()`             | ✅                  | N/A (not implemented) | SKIP                   |

---

## Part 3: Consolidation Strategy

### 3.1 Recommended Approach: Parameterized Test Factory

Create a factory function that generates test suites for any wallet facade:

```typescript
// __tests__/integration/shared/shared_facades_factory.ts

export function createWalletFacadeTests(
  facadeName: string,
  walletFactory: () => Promise<IHathorWallet>,
  options: {
    hasAsyncAddressMethods: boolean;
    supportsConsolidateUtxos: boolean;
    supportsNanoContracts: boolean;
    // ... other capability flags
  }
) {
  describe(`${facadeName} - Wallet Facade Contract`, () => {
    // Shared tests that work for both facades
  });
}
```

### 3.2 Implementation Steps

1. **Create shared test infrastructure**
   - New file: `__tests__/integration/shared/shared_facades_factory.ts`
   - New file: `__tests__/integration/shared/test_helpers.ts`
   - Unified wallet factory interface

2. **Standardize test helpers**
   - Create adapter for `generateWalletHelper()` that works with both facades
   - Unify fund injection approach
   - Standardize transaction confirmation waiting

3. **Handle async/sync differences**
   - Use `await Promise.resolve(wallet.getCurrentAddress())` pattern
   - This works for both async and sync methods

4. **Feature flag system**
   - Pass capability flags to test factory
   - Skip tests for unimplemented methods
   - Include facade-specific tests only when applicable

---

## Part 4: Migration Priority Order

### Phase 1: Core Functionality (HIGH PRIORITY)
Migrate these first - they're fundamental and have identical contracts:

| Priority | Method(s)                        | Rationale                                  |
|----------|----------------------------------|--------------------------------------------|
| 1        | `start()`, `stop()`, `isReady()` | Lifecycle - foundation for all other tests |
| 2        | `getBalance()`                   | Simple getter, identical contract          |
| 3        | `sendTransaction()`              | Core functionality, well-tested in both    |
| 4        | `sendManyOutputsTransaction()`   | Core functionality, well-tested            |
| 5        | `getUtxos()`                     | Returns same structure `{utxos, total}`    |

### Phase 2: Address Operations (MEDIUM PRIORITY)
Requires async/sync handling:

| Priority | Method(s)             | Notes                         |
|----------|-----------------------|-------------------------------|
| 6        | `getCurrentAddress()` | Wrap with `Promise.resolve()` |
| 7        | `getAddressAtIndex()` | Wrap with `Promise.resolve()` |
| 8        | `getAllAddresses()`   | Wrap with `Promise.resolve()` |
| 9        | `isAddressMine()`     | Wrap with `Promise.resolve()` |
| 10       | `getAddressIndex()`   | Wrap with `Promise.resolve()` |

### Phase 3: Token Operations (MEDIUM PRIORITY)
Complex but well-tested in both:

| Priority | Method(s)          | Notes                   |
|----------|--------------------|-------------------------|
| 11       | `createNewToken()` | Both have good coverage |
| 12       | `mintTokens()`     | Both have good coverage |
| 13       | `meltTokens()`     | Both have good coverage |
| 14       | `getTokens()`      | Simple getter           |

### Phase 4: Authority Operations (LOW PRIORITY)
Only tested in HathorWallet:

| Priority | Method(s)             | Notes                             |
|----------|-----------------------|-----------------------------------|
| 15       | `delegateAuthority()` | Needs WalletService test addition |
| 16       | `destroyAuthority()`  | Needs WalletService test addition |
| 17       | `getMintAuthority()`  | Needs WalletService test addition |
| 18       | `getMeltAuthority()`  | Needs WalletService test addition |

### Phase 5: Advanced Features (DEFER)
Skip or handle specially:

| Method                | Action                 | Reason                           |
|-----------------------|------------------------|----------------------------------|
| `consolidateUtxos()`  | SKIP                   | Not implemented in WalletService |
| `getAddressInfo()`    | SKIP                   | Not implemented in WalletService |
| `getTx()`             | SKIP                   | Not implemented in WalletService |
| Template methods      | HathorWallet-only test | Unique to fullnode facade        |
| Nano contract methods | HathorWallet-only test | Unique to fullnode facade        |

---

## Part 5: File Structure Recommendation

```
__tests__/integration/
├── shared/
│   ├── shared_facades_factory.ts      # Parameterized test factory
│   ├── test_helpers.ts             # Unified helpers
│   └── types.ts                    # Test-specific types
├── hathorwallet_facade/
│   ├── facade.test.ts              # Imports shared + HW-specific
│   └── specific.test.ts            # Template/NC tests only
├── walletservice_facade/
│   ├── facade.test.ts              # Imports shared + WS-specific
│   └── specific.test.ts            # Mobile-specific tests only
└── legacy/                         # Move old files here during migration
    ├── hathorwallet_facade.test.ts
    ├── hathorwallet_others.test.ts
    └── walletservice_facade.test.ts
```

---

## Part 6: Key Recommendations

### 6.1 Before Starting Migration

1. **Fix interface compliance**: Make `HathorWallet` implement `IHathorWallet` interface
2. **Audit `IHathorWallet`**: Ensure all 57+ methods in the interface are correctly typed
3. **Standardize async signatures**: Consider making all address methods async in both facades

### 6.2 Migration Best Practices

1. **Incremental approach**: Migrate one method group at a time
2. **Keep old tests running**: Don't delete until shared tests pass
3. **CI validation**: Ensure both facades pass shared tests before merge
4. **Document capability flags**: Clear comments on what each flag controls

### 6.3 Success Metrics

- All shared methods tested through single test file
- Zero code duplication between facade tests
- Clear separation of facade-specific tests
- Reduced test maintenance burden

---

## Summary: First 5 Functions to Migrate

1. **`start()`/`stop()`** - Wallet lifecycle, foundation for all tests
2. **`getBalance()`** - Simple, identical contract, quick win
3. **`sendTransaction()`** - Core use case, high value
4. **`sendManyOutputsTransaction()`** - Core use case, high value
5. **`getUtxos()`** - Same return structure, needed by many tests

---

## Interacting with the user

1. Run `npm run format && npm run lint && npm run build` to validate broader code changes
2. Leave the test executions for the user to run manually.
