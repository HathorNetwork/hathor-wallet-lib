# Shared Contract Investigation Report

## Executive Summary

This report analyzes the differences between `HathorWallet` (fullnode facade), `HathorWalletServiceWallet` (wallet service facade), and the `IHathorWallet` interface to identify contract misalignments that need resolution for unified testing.

**Key Findings:**
- 3 methods have inconsistent async/sync signatures (critical)
- 4 methods throw "Not implemented" in WalletServiceWallet
- ~20 methods exist only in HathorWallet
- Return types differ significantly for several shared methods
- The `IHathorWallet` interface has incomplete type annotations

---

## Part 1: Critical Contract Violations

### 1.1 Async/Sync Signature Mismatches

These methods have different async behaviors between facades:

| Method | HathorWallet | WalletServiceWallet | IHathorWallet | Impact |
|--------|-------------|---------------------|---------------|--------|
| `getCurrentAddress()` | `async` → `Promise<GetCurrentAddressFullnodeFacadeReturnType>` | `sync` → `AddressInfoObject` | `AddressInfoObject \| Promise<unknown>` (FIXME) | **CRITICAL** |
| `getNextAddress()` | `async` → `Promise<GetCurrentAddressFullnodeFacadeReturnType>` | `sync` → `AddressInfoObject` | `AddressInfoObject \| Promise<unknown>` (FIXME) | **CRITICAL** |
| `getFullHistory()` | `async` → `Promise<Record<string, IHistoryTx>>` | `sync` (throws "Not implemented") | `TransactionFullObject[] \| Promise<unknown>` (FIXME) | **CRITICAL** |
| `stop()` | `async` → `Promise<void>` | `async` → `Promise<void>` | `sync` → `void` | **MEDIUM** |

**Impact:** Tests cannot use a simple `await` pattern because the WalletServiceWallet returns sync values.

**Current Workaround (from shared tests):**
```typescript
// Wrapping with Promise.resolve() handles both cases
const address = await Promise.resolve(wallet.getCurrentAddress());
```

### 1.2 Return Type Mismatches

| Method | HathorWallet Return | WalletServiceWallet Return | Interface Declares |
|--------|--------------------|-----------------------------|-------------------|
| `getCurrentAddress()` | `{ address, index, addressPath }` | `{ address, index, addressPath, info? }` | Mixed |
| `getMintAuthority()` | `IUtxo[]` | `AuthorityTxOutput[]` | **NOT DEFINED** |
| `getMeltAuthority()` | `IUtxo[]` | `AuthorityTxOutput[]` | **NOT DEFINED** |
| `getAuthorityUtxo()` | `IUtxo[]` | `AuthorityTxOutput[]` | **NOT DEFINED** |
| `sendManyOutputsTransaction()` | `Transaction \| null` | `Transaction` | `Transaction` |
| `sendTransaction()` | `Transaction \| null` | `Transaction` | `Transaction` |
| `getFullHistory()` | `Record<string, IHistoryTx>` | N/A (throws) | `TransactionFullObject[]` |
| `getAddressPrivKey()` | `Promise<unknown>` | `Promise<bitcore.HDPrivateKey>` | `Promise<bitcore.PrivateKey>` |

#### 1.2.1 Detailed Type Property Comparison

**Address Return Types:**

| Property | `GetCurrentAddressFullnodeFacadeReturnType` (HathorWallet) | `AddressInfoObject` (WalletServiceWallet) |
|----------|-----------------------------------------------------------|-------------------------------------------|
| `address` | `string` | `string` |
| `index` | `number \| null` | `number` |
| `addressPath` | `string` | `string` |
| `info` | ❌ Not present | `string \| undefined` (optional) |

**Authority UTXO Return Types:**

| Property | `IUtxo` (HathorWallet) | `AuthorityTxOutput` (WalletServiceWallet) |
|----------|------------------------|-------------------------------------------|
| `txId` | ✅ `string` | ✅ `string` |
| `index` | ✅ `number` | ✅ `number` |
| `address` | ✅ `string` | ✅ `string` |
| `authorities` | ✅ `OutputValueType` | ✅ `OutputValueType` |
| `token` | ✅ `string` | ❌ Not present |
| `value` | ✅ `OutputValueType` | ❌ Not present |
| `timelock` | ✅ `number \| null` | ❌ Not present |
| `type` | ✅ `number` (tx version byte) | ❌ Not present |
| `height` | ✅ `number \| null` (block outputs) | ❌ Not present |

**History Return Types:**

| Property | `IHistoryTx` (HathorWallet) | `TransactionFullObject` (Interface declares) |
|----------|-----------------------------|--------------------------------------------|
| `tx_id` | ✅ `string` | ✅ `string` |
| `version` | ✅ `number` | ✅ `number` |
| `timestamp` | ✅ `number` | ✅ `number` |
| `is_voided` | ✅ `boolean` | ✅ `boolean` |
| `inputs` | ✅ `IHistoryInput[]` | ✅ `Input[]` |
| `outputs` | ✅ `IHistoryOutput[]` | ✅ `Output[]` |
| `parents` | ✅ `string[]` | ✅ `string[]` |
| `weight` | ✅ `number` | ❌ Not present |
| `signalBits` | ✅ `number` (optional) | ❌ Not present |
| `nonce` | ✅ `number` (optional) | ❌ Not present |
| `token_name` | ✅ `string` (optional, create token) | ❌ Not present |
| `token_symbol` | ✅ `string` (optional, create token) | ❌ Not present |
| `token_version` | ✅ `TokenVersion` (optional) | ❌ Not present |
| `tokens` | ✅ `string[]` (optional) | ❌ Not present |
| `height` | ✅ `number` (optional) | ❌ Not present |
| `processingStatus` | ✅ `TxHistoryProcessingStatus` (optional) | ❌ Not present |
| `nc_id` | ✅ `string` (optional, nano contract) | ❌ Not present |
| `nc_blueprint_id` | ✅ `string` (optional, nano contract) | ❌ Not present |
| `nc_method` | ✅ `string` (optional, nano contract) | ❌ Not present |
| `nc_args` | ✅ `string` (optional, nano contract) | ❌ Not present |

**Note:** HathorWallet's `getFullHistory()` returns `Record<string, IHistoryTx>` (keyed by tx_id), not an array. The interface declares `TransactionFullObject[]` which is neither format.

---

## Part 2: Methods Not Implemented

### 2.1 WalletServiceWallet "Not Implemented" Methods

These methods exist but throw `WalletError('Not implemented.')`:

| Method | Parameters | HathorWallet Has | Notes |
|--------|------------|------------------|-------|
| `getTx()` | `id: string` | ✅ Yes | Returns `IHistoryTx \| null` |
| `getAddressInfo()` | `address: string, options?: {}` | ✅ Yes | Returns address analytics |
| `consolidateUtxos()` | `destinationAddress: string, options?: {}` | ✅ Yes | UTXO consolidation |
| `getFullHistory()` | None | ✅ Yes | Full tx history |

### 2.2 Methods Missing from WalletServiceWallet

These methods exist in HathorWallet but not in WalletServiceWallet:

**Transaction Template Methods:**
- `buildTxTemplate()`
- `runTxTemplate()`

**On-Chain Blueprint Methods:**
- `createOnChainBlueprintTransaction()`
- `createAndSendOnChainBlueprintTransaction()`

**Nano Contract Token Methods:**
- `createNanoContractMintTokensTransaction()` (if exists)
- `createNanoContractMeltTokensTransaction()` (if exists)

**UTXO & Address Methods:**
- `getAvailableUtxos()` (generator)
- `prepareConsolidateUtxosData()`
- `consolidateUtxosSendTransaction()`
- `getAuthorityUtxos()`

**Multisig Methods:**
- `getAllSignatures()`
- `assemblePartialTransaction()`
- `getMultisigData()`

**Configuration Methods:**
- `setGapLimit()`
- `getGapLimit()`
- `indexLimitLoadMore()`
- `indexLimitSetEndIndex()`
- `setExternalTxSigningMethod()`
- `setHistorySyncMode()`

**Internal/Lifecycle Methods:**
- `syncHistory()`
- `reloadStorage()`
- `scanAddressesToLoad()`
- `processTxQueue()`
- `onEnterStateProcessing()`
- `handleWebsocketMsg()`
- `enqueueOnNewTx()`
- `onNewTx()`

---

## Part 3: Methods Missing from IHathorWallet Interface

The following methods exist in BOTH facades but are NOT in the interface:

| Method | HathorWallet | WalletServiceWallet | Should Add to Interface? |
|--------|-------------|---------------------|--------------------------|
| `getMintAuthority()` | ✅ | ✅ | **YES** |
| `getMeltAuthority()` | ✅ | ✅ | **YES** |
| `getAuthorityUtxo()` | ✅ | ✅ | **YES** |
| `markUtxoSelected()` | ✅ | ✅ (no-op) | Consider |
| `handleSendPreparedTransaction()` | ✅ | ✅ | Consider |
| `isReady()` | ✅ | ✅ | **YES** |
| `getTokenData()` | ✅ | ❌ | No |
| `clearSensitiveData()` | ✅ | ✅ | Consider |
| `isHardwareWallet()` | ✅ | ✅ | Consider |
| `setState()` | ✅ | ✅ | No (internal) |

---

## Part 4: Interface Type Issues

### 4.1 Missing Return Types in IHathorWallet

```typescript
// These methods lack proper return type annotations:
getNetworkObject();  // Return type missing
getPrivateKeyFromAddress(address: string, options: { pinCode?: string });  // Return type missing
```

### 4.2 Loose `any`/`options` Types

Many methods use untyped `options` parameter:
```typescript
prepareCreateNewToken(name: string, symbol: string, amount: OutputValueType, options): Promise<CreateTokenTransaction>;
createNewToken(name: string, symbol: string, amount: OutputValueType, options): Promise<Transaction>;
createNFT(name: string, symbol: string, amount: OutputValueType, data: string, options): Promise<Transaction>;
prepareMintTokensData(token: string, amount: OutputValueType, options): Promise<Transaction>;
mintTokens(token: string, amount: OutputValueType, options): Promise<Transaction>;
prepareMeltTokensData(token: string, amount: OutputValueType, options): Promise<Transaction>;
meltTokens(token: string, amount: OutputValueType, options): Promise<Transaction>;
getTxBalance(tx: IHistoryTx, optionsParams): Promise<{ [tokenId: string]: OutputValueType }>;
```

### 4.3 FIXME Comments in Interface

The interface has explicit FIXME comments acknowledging inconsistencies:
```typescript
getCurrentAddress(options?: { markAsUsed: boolean }): AddressInfoObject | Promise<unknown>; // FIXME: Should have a single return type
getNextAddress(): AddressInfoObject | Promise<unknown>; // FIXME: Should have a single return type;
getFullHistory(): TransactionFullObject[] | Promise<unknown>; // FIXME: Should have a single return type;
```

---

## Part 5: Options Parameter Differences

### 5.1 `sendTransaction()` Options

| Option | HathorWallet | WalletServiceWallet | Interface |
|--------|-------------|---------------------|-----------|
| `token` | ✅ | ✅ | ✅ |
| `changeAddress` | ✅ (`null` allowed) | ✅ | ✅ |
| `pinCode` | ✅ (`null` allowed) | ✅ | ❌ Missing |

### 5.2 `sendManyOutputsTransaction()` Options

| Option | HathorWallet | WalletServiceWallet | Interface |
|--------|-------------|---------------------|-----------|
| `inputs` | ✅ | ✅ | ✅ |
| `changeAddress` | ✅ (`null` allowed) | ✅ | ✅ |
| `pinCode` | ✅ (`null` allowed) | ✅ | ❌ Missing |
| `startMiningTx` | ✅ | ❌ | ❌ |

### 5.3 Token Creation Options

HathorWallet uses `CreateTokenOptions`:
- `address`, `changeAddress`, `startMiningTx`, `pinCode`
- `createMint`, `mintAuthorityAddress`, `allowExternalMintAuthorityAddress`
- `createMelt`, `meltAuthorityAddress`, `allowExternalMeltAuthorityAddress`
- `data`, `isCreateNFT`, `signTx`, `tokenVersion`

WalletServiceWallet uses inline options object with similar but not identical fields.

---

## Part 6: Authority Methods Deep Dive

Both facades have authority methods but with different return types:

### HathorWallet
```typescript
getMintAuthority(tokenUid: string, options?: GetAuthorityOptions): Promise<IUtxo[]>
getMeltAuthority(tokenUid: string, options?: GetAuthorityOptions): Promise<IUtxo[]>
getAuthorityUtxo(tokenUid: string, authority: 'mint' | 'melt', options?: GetAuthorityOptions): Promise<IUtxo[]>

// GetAuthorityOptions:
{
  many?: boolean;
  only_available_utxos?: boolean;
  filter_address?: string;
}
```

### WalletServiceWallet
```typescript
getMintAuthority(tokenId: string, options?: { many?: boolean; skipSpent?: boolean }): Promise<AuthorityTxOutput[]>
getMeltAuthority(tokenId: string, options?: { many?: boolean; skipSpent?: boolean }): Promise<AuthorityTxOutput[]>
getAuthorityUtxo(tokenUid: string, authority: string, options?: {...}): Promise<AuthorityTxOutput[]>

// AuthorityTxOutput:
{
  txId: string;
  index: number;
  address: string;
  authorities: OutputValueType;
}
```

### IUtxo vs AuthorityTxOutput

| Field | IUtxo | AuthorityTxOutput |
|-------|-------|-------------------|
| txId | ✅ | ✅ |
| index | ✅ | ✅ |
| address | ✅ | ✅ |
| authorities | ✅ | ✅ |
| tokenId | ✅ | ❌ |
| value | ✅ | ❌ |
| timelock | ✅ | ❌ |
| heightlock | ✅ | ❌ |
| locked | ✅ | ❌ |
| addressPath | ✅ | ❌ |

---

## Part 7: Prioritized Recommendations

### Priority 1: Fix Critical Async/Sync Mismatches

1. **Make `getCurrentAddress()` async in both facades**
   - WalletServiceWallet needs to return `Promise<AddressInfoObject>`
   - Update interface to `Promise<AddressInfoObject>`

2. **Make `getNextAddress()` async in both facades**
   - Same approach as above

3. **Update `stop()` in interface to be async**
   - Change interface from `void` to `Promise<void>`
   - Both facades already return Promise

### Priority 2: Unify Return Types

1. **Standardize authority method returns**
   - Define a common `AuthorityUtxo` type
   - Update both facades to return the same structure
   - Add methods to interface

2. **Standardize `sendTransaction()` return type**
   - Decide: `Transaction` or `Transaction | null`
   - HathorWallet returns `null` on certain conditions

### Priority 3: Add Missing Interface Methods

```typescript
// Add to IHathorWallet:
getMintAuthority(tokenUid: string, options?: AuthorityOptions): Promise<AuthorityUtxo[]>;
getMeltAuthority(tokenUid: string, options?: AuthorityOptions): Promise<AuthorityUtxo[]>;
isReady(): boolean;
```

### Priority 4: Type the Options Parameters

Create explicit types for all options objects and use them in the interface.

### Priority 5: Implement Missing Methods in WalletServiceWallet

- `getTx()` - Consider implementing via API
- `getAddressInfo()` - Consider implementing via API
- `consolidateUtxos()` - May require backend support
- `getFullHistory()` - Consider implementing via API

---

## Part 8: Shared Test Compatibility Matrix

Based on the current state, here's what can be tested with the shared test factory:

| Test Category | Compatible | Notes |
|---------------|------------|-------|
| Lifecycle (`start`/`stop`/`isReady`) | ✅ | Need to handle async stop |
| Balance Operations | ✅ | Compatible |
| Address Operations | ⚠️ | Need Promise.resolve() wrapper |
| Simple Transactions | ✅ | Return type differs but compatible |
| Multi-output Transactions | ✅ | Return type differs but compatible |
| UTXO Operations | ✅ | Compatible |
| Token Creation | ✅ | Compatible |
| Token Details | ✅ | Compatible |
| Mint Tokens | ⚠️ | WalletService has sync issues |
| Melt Tokens | ⚠️ | WalletService has sync issues |
| Authority Operations | ⚠️ | Different return types |
| UTXO Consolidation | ❌ | Not implemented in WalletService |
| Full History | ❌ | Not implemented in WalletService |
| Address Info | ❌ | Not implemented in WalletService |
| Nano Contracts | ✅ | Both implement |

---

## Appendix A: Method Count Summary

| Category | HathorWallet | WalletServiceWallet | IHathorWallet |
|----------|-------------|---------------------|---------------|
| Total Methods | ~113 | ~75 | ~52 |
| Async Methods | ~97 | ~62 | ~45 |
| Sync Methods | ~16 | ~13 | ~4 |
| Not Implemented | 0 | 4 | N/A |

---

## Appendix B: Files Referenced

- `src/new/wallet.ts` - HathorWallet (Fullnode Facade) - ~3,372 lines
- `src/wallet/wallet.ts` - HathorWalletServiceWallet - ~3,002 lines
- `src/wallet/types.ts` - IHathorWallet interface and related types
- `src/new/types.ts` - HathorWallet-specific types
- `src/types.ts` - Shared types (IUtxo, OutputValueType, etc.)