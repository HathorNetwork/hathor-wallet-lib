# Wallet TypeScript Migration - Dependency Map

This document maps the dependencies between methods in `src/new/wallet.ts` to enable parallelizing the typing work across multiple PRs.

## File Overview
- **Total Lines**: ~3537
- **Total Methods**: ~100+
- **Current State**: Migrated with minimal typing (`any` everywhere, `@ts-nocheck`)

## Dependency Groups

Methods are grouped by their interdependencies. Methods within the same group can be typed together in a single PR, while different groups can be worked on in parallel.

---

## Group 1: Core Configuration & State (Foundation)
**Priority**: HIGH - These are foundational methods used everywhere
**Can be parallelized**: NO - Must be done first

### Methods:
- `constructor()`
- `getServerUrl()` - src/new/wallet.ts:317
- `getNetwork()` - src/new/wallet.ts:325
- `getNetworkObject()` - src/new/wallet.ts:332
- `getVersionData()` - src/new/wallet.ts:345
- `changeServer(newServer)` - src/new/wallet.ts:375
- `setState(state)` - src/new/wallet.ts:1399
- `isReady()` - src/new/wallet.ts:2555
- `enableDebugMode()` - src/new/wallet.ts:489
- `disableDebugMode()` - src/new/wallet.ts:496
- `clearSensitiveData()` - src/new/wallet.ts:2456

### Dependencies:
- Storage interface (`this.storage`)
- Connection interface (`this.conn`)
- Internal state variables

### External Types Needed:
- `IStorage` interface
- `Connection` interface
- Network model
- State enum

---

## Group 2: Address Management
**Priority**: HIGH - Critical for most operations
**Can be parallelized**: After Group 1

### Methods:
- `getAllAddresses()` - src/new/wallet.ts:650
- `getAddressAtIndex(index)` - src/new/wallet.ts:671
- `getAddressPathForIndex(index)` - src/new/wallet.ts:695
- `getCurrentAddress(options)` - src/new/wallet.ts:718
- `getNextAddress()` - src/new/wallet.ts:731
- `getAddressIndex(address)` - src/new/wallet.ts:2598
- `isAddressMine(address)` - src/new/wallet.ts:2566
- `checkAddressesMine(addresses)` - src/new/wallet.ts:2577
- `getAddressInfo(address, options)` - src/new/wallet.ts:940
- `getAddressPrivKey(pinCode, addressIndex)` - src/new/wallet.ts:1694
- `getPrivateKeyFromAddress(address, options)` - src/new/wallet.ts:3314

### Dependencies:
- Storage methods (`this.storage.getAddressAtIndex`, etc.)
- Wallet type (P2PKH vs P2SH)
- Address derivation utilities

### External Types Needed:
- `Address` model
- `IWalletAccessData`
- `IAddressInfo`

---

## Group 3: Gap Limit & Scanning Policy
**Priority**: MEDIUM
**Can be parallelized**: With Group 2

### Methods:
- `setGapLimit(value)` - src/new/wallet.ts:384
- `getGapLimit()` - src/new/wallet.ts:443
- `indexLimitLoadMore(count)` - src/new/wallet.ts:393
- `indexLimitSetEndIndex(endIndex)` - src/new/wallet.ts:413
- `scanAddressesToLoad(processHistory)` - src/new/wallet.ts:1376

### Dependencies:
- Storage methods for gap limit
- Scanning policy configuration

### External Types Needed:
- `SCANNING_POLICY` enum
- `AddressScanPolicyData`

---

## Group 4: Wallet Access & Security
**Priority**: HIGH - Required for many operations
**Can be parallelized**: After Group 1

### Methods:
- `getAccessData()` - src/new/wallet.ts:451
- `getWalletType()` - src/new/wallet.ts:463
- `getMultisigData()` - src/new/wallet.ts:474
- `isReadonly()` - src/new/wallet.ts:505
- `isHardwareWallet()` - src/new/wallet.ts:3070
- `checkPin(pin)` - src/new/wallet.ts:3044
- `checkPassword(password)` - src/new/wallet.ts:3053
- `checkPinAndPassword(pin, password)` - src/new/wallet.ts:3062

### Dependencies:
- Storage access data methods
- Wallet type checking

### External Types Needed:
- `IWalletAccessData`
- `IMultisigData`
- `WalletType` enum

---

## Group 5: Token & Balance Management
**Priority**: HIGH - Core wallet functionality
**Can be parallelized**: After Groups 1, 2, 4

### Methods:
- `getBalance(token)` - src/new/wallet.ts:768
- `getTokens()` - src/new/wallet.ts:896
- `getTokenData()` - src/new/wallet.ts:2480
- `getTokenDetails(tokenId)` - src/new/wallet.ts:2527

### Dependencies:
- Storage token methods
- Token API calls
- Address management (Group 2)

### External Types Needed:
- `TokenVersion` enum
- Token metadata interfaces

---

## Group 6: Transaction History & Management
**Priority**: HIGH - Core wallet functionality
**Can be parallelized**: After Groups 1, 2, 5

### Methods:
- `getTx(id)` - src/new/wallet.ts:912
- `getTxHistory(options)` - src/new/wallet.ts:845
- `getFullHistory()` - src/new/wallet.ts:1337
- `getTxBalance(tx, options)` - src/new/wallet.ts:2618
- `getTxAddresses(tx)` - src/new/wallet.ts:2639
- `getTxById(txId)` - src/new/wallet.ts:2943
- `getFullTxById(txId)` - src/new/wallet.ts:2829
- `getTxConfirmationData(txId)` - src/new/wallet.ts:2855
- `graphvizNeighborsQuery(txId, graphType, maxLevel)` - src/new/wallet.ts:2882

### Dependencies:
- Storage transaction methods
- Transaction API calls
- Balance calculation
- Address checking (Group 2)

### External Types Needed:
- `IHistoryTx` schema
- `DecodedTx` type
- Transaction models

---

## Group 7: UTXO Management
**Priority**: MEDIUM-HIGH - Required for transaction building
**Can be parallelized**: After Groups 1, 2

### Methods:
- `getUtxos(options)` - src/new/wallet.ts:1047
- `getAvailableUtxos(options)` - src/new/wallet.ts:1121
- `getUtxosForAmount(amount, options)` - src/new/wallet.ts:1150
- `markUtxoSelected(txId, index, value, ttl)` - src/new/wallet.ts:1177
- `prepareConsolidateUtxosData(destinationAddress, options)` - src/new/wallet.ts:1197
- `consolidateUtxosSendTransaction(destinationAddress, options)` - src/new/wallet.ts:1243
- `consolidateUtxos(destinationAddress, options)` - src/new/wallet.ts:1287

### Dependencies:
- Storage UTXO selection methods
- Time/height lock checking
- Transaction utilities

### External Types Needed:
- `UtxoOptions`
- `UtxoDetails`
- `UtxoInfo`
- `OutputValueType`

---

## Group 8: Authority Management (Mint/Melt)
**Priority**: MEDIUM - Token authority operations
**Can be parallelized**: After Groups 1, 2, 7

### Methods:
- `getMintAuthority(tokenUid, options)` - src/new/wallet.ts:1902
- `getMeltAuthority(tokenUid, options)` - src/new/wallet.ts:1924
- `getAuthorityUtxo(tokenUid, authority, options)` - src/new/wallet.ts:1947
- `getAuthorityUtxos(tokenUid, type)` - src/new/wallet.ts:2470

### Dependencies:
- UTXO selection (Group 7)
- Storage methods

### External Types Needed:
- Authority value types

---

## Group 9: Transaction Signing & Preparation
**Priority**: HIGH - Core for all transaction operations
**Can be parallelized**: After Groups 1, 2, 4, 7

### Methods:
- `getWalletInputInfo(tx)` - src/new/wallet.ts:2725
- `getSignatures(tx, options)` - src/new/wallet.ts:2763
- `signTx(tx, options)` - src/new/wallet.ts:2795
- `getAllSignatures(txHex, pin)` - src/new/wallet.ts:561
- `assemblePartialTransaction(txHex, signatures)` - src/new/wallet.ts:595
- `signMessageWithAddress(message, index, pinCode)` - src/new/wallet.ts:1714

### Dependencies:
- Address management (Group 2)
- Access data (Group 4)
- Transaction utilities
- Storage signing methods

### External Types Needed:
- Transaction models
- P2SH signature model
- Signature info types

---

## Group 10: Simple Transaction Building
**Priority**: HIGH - Basic send operations
**Can be parallelized**: After Groups 1, 2, 7, 9

### Methods:
- `sendTransactionInstance(address, value, options)` - src/new/wallet.ts:1480
- `sendTransaction(address, value, options)` - src/new/wallet.ts:1506
- `sendManyOutputsSendTransaction(outputs, options)` - src/new/wallet.ts:1542
- `sendManyOutputsTransaction(outputs, options)` - src/new/wallet.ts:1576

### Dependencies:
- UTXO management (Group 7)
- Signing (Group 9)
- SendTransaction class
- Address validation (Group 2)

### External Types Needed:
- `ProposedOutput`
- `ProposedInput`
- `SendManyOutputsOptions`
- `SendTransaction` class

---

## Group 11: Token Creation
**Priority**: MEDIUM - Token operations
**Can be parallelized**: After Groups 1, 2, 7, 9, 10

### Methods:
- `prepareCreateNewToken(name, symbol, amount, options)` - src/new/wallet.ts:1773
- `createNewTokenSendTransaction(name, symbol, amount, options)` - src/new/wallet.ts:1857
- `createNewToken(name, symbol, amount, options)` - src/new/wallet.ts:1879
- `createNFTSendTransaction(name, symbol, amount, data, options)` - src/new/wallet.ts:2668
- `createNFT(name, symbol, amount, data, options)` - src/new/wallet.ts:2709

### Dependencies:
- Simple transactions (Group 10)
- Address validation (Group 2)
- Token utilities
- SendTransaction class

### External Types Needed:
- `CreateTokenOptions`
- `CreateNFTOptions`
- `TokenVersion` enum
- Token transaction models

---

## Group 12: Token Minting
**Priority**: MEDIUM - Token operations
**Can be parallelized**: After Groups 1, 2, 7, 8, 9, 10

### Methods:
- `prepareMintTokensData(tokenUid, amount, options)` - src/new/wallet.ts:2002
- `mintTokensSendTransaction(tokenUid, amount, options)` - src/new/wallet.ts:2076
- `mintTokens(tokenUid, amount, options)` - src/new/wallet.ts:2093

### Dependencies:
- Authority management (Group 8)
- Transaction building (Group 10)
- Address validation (Group 2)

### External Types Needed:
- `MintTokensOptions`

---

## Group 13: Token Melting
**Priority**: MEDIUM - Token operations
**Can be parallelized**: With Group 12

### Methods:
- `prepareMeltTokensData(tokenUid, amount, options)` - src/new/wallet.ts:2124
- `meltTokensSendTransaction(tokenUid, amount, options)` - src/new/wallet.ts:2196
- `meltTokens(tokenUid, amount, options)` - src/new/wallet.ts:2213

### Dependencies:
- Authority management (Group 8)
- Transaction building (Group 10)
- Address validation (Group 2)

### External Types Needed:
- `MeltTokensOptions`

---

## Group 14: Authority Delegation & Destruction
**Priority**: MEDIUM - Token operations
**Can be parallelized**: With Groups 12, 13

### Methods:
- `prepareDelegateAuthorityData(tokenUid, type, destinationAddress, options)` - src/new/wallet.ts:2238
- `delegateAuthoritySendTransaction(tokenUid, type, destinationAddress, options)` - src/new/wallet.ts:2297
- `delegateAuthority(tokenUid, type, destinationAddress, options)` - src/new/wallet.ts:2325
- `prepareDestroyAuthorityData(tokenUid, type, count, options)` - src/new/wallet.ts:2359
- `destroyAuthoritySendTransaction(tokenUid, type, count, options)` - src/new/wallet.ts:2421
- `destroyAuthority(tokenUid, type, count, options)` - src/new/wallet.ts:2444

### Dependencies:
- Authority management (Group 8)
- Transaction building (Group 10)

### External Types Needed:
- `DelegateAuthorityOptions`
- `DestroyAuthorityOptions`

---

## Group 15: Nano Contracts
**Priority**: LOW-MEDIUM - Advanced feature
**Can be parallelized**: After Groups 1, 2, 7, 9

### Methods:
- `createAndSendNanoContractTransaction(method, address, data, options)` - src/new/wallet.ts:3098
- `createNanoContractTransaction(method, address, data, options)` - src/new/wallet.ts:3123
- `createAndSendNanoContractCreateTokenTransaction(method, address, data, createTokenOptions, options)` - src/new/wallet.ts:3191
- `createNanoContractCreateTokenTransaction(method, address, data, createTokenOptions, options)` - src/new/wallet.ts:3219
- `createAndSendOnChainBlueprintTransaction(code, address, options)` - src/new/wallet.ts:3460
- `createOnChainBlueprintTransaction(code, address, options)` - src/new/wallet.ts:3482
- `getNanoHeaderSeqnum(address)` - src/new/wallet.ts:3518

### Dependencies:
- Address management (Group 2)
- Transaction signing (Group 9)
- Nano contract utilities

### External Types Needed:
- `CreateNanoTxOptions`
- `CreateNanoTxData`
- `CreateTokenTxOptions`
- `NanoContractTransactionBuilder`
- `OnChainBlueprint`
- `Address` model

---

## Group 16: Connection & Sync Management
**Priority**: HIGH - Core wallet lifecycle
**Can be parallelized**: After Groups 1, 2

### Methods:
- `start(options)` - src/new/wallet.ts:1590
- `stop(options)` - src/new/wallet.ts:1667
- `onConnectionChangedState(newState)` - src/new/wallet.ts:518
- `handleWebsocketMsg(wsData)` - src/new/wallet.ts:740
- `onNewTx(wsData)` - src/new/wallet.ts:1422
- `enqueueOnNewTx(wsData)` - src/new/wallet.ts:1415
- `processTxQueue()` - src/new/wallet.ts:1351
- `onEnterStateProcessing()` - src/new/wallet.ts:1389
- `syncHistory(startIndex, count, shouldProcessHistory)` - src/new/wallet.ts:3359
- `reloadStorage()` - src/new/wallet.ts:3389
- `setExternalTxSigningMethod(method)` - src/new/wallet.ts:3340
- `setHistorySyncMode(mode)` - src/new/wallet.ts:3349

### Dependencies:
- Connection state management
- Storage operations
- Address scanning (Group 3)
- Transaction processing

### External Types Needed:
- Connection state enum
- `HistorySyncMode` enum
- `TxHistoryProcessingStatus` enum
- WebSocket message types

---

## Group 17: Transaction Templates
**Priority**: LOW - Advanced feature
**Can be parallelized**: After Groups 1, 9, 10

### Methods:
- `buildTxTemplate(template, options)` - src/new/wallet.ts:3416
- `runTxTemplate(template, pinCode)` - src/new/wallet.ts:3438

### Dependencies:
- Transaction building (Group 10)
- Transaction signing (Group 9)
- Template interpreter

### External Types Needed:
- `TransactionTemplate` schema
- `WalletTxTemplateInterpreter`

---

## Group 18: Legacy/Deprecated
**Priority**: LOW - Can be done last
**Can be parallelized**: Yes, independently

### Methods:
- `handleSendPreparedTransaction(transaction)` - src/new/wallet.ts:1734 (deprecated)
- `startReadOnly(options)` - src/new/wallet.ts:3524 (not implemented)
- `getReadOnlyAuthToken()` - src/new/wallet.ts:3531 (not implemented)
- `_txNotFoundGuard(data)` - src/new/wallet.ts:2815 (static)

---

## Suggested PR Sequence

### Phase 1: Foundation (Sequential - 1-2 PRs)
1. **PR1**: Group 1 (Core Configuration & State)
2. **PR2**: Group 4 (Wallet Access & Security)

### Phase 2: Core Features (Parallel - 3 PRs)
3. **PR3**: Group 2 (Address Management)
4. **PR4**: Group 3 (Gap Limit & Scanning)
5. **PR5**: Groups 5 & 6 (Token & Transaction History)

### Phase 3: UTXO & Signing (Parallel - 2 PRs)
6. **PR6**: Group 7 (UTXO Management)
7. **PR7**: Group 9 (Transaction Signing)

### Phase 4: Transaction Operations (Parallel - 2 PRs)
8. **PR8**: Groups 10 & 11 (Simple Transactions & Token Creation)
9. **PR9**: Group 8 (Authority Management)

### Phase 5: Advanced Token Operations (Parallel - 2 PRs)
10. **PR10**: Groups 12 & 13 (Mint & Melt)
11. **PR11**: Group 14 (Authority Delegation/Destruction)

### Phase 6: Advanced Features (Parallel - 3 PRs)
12. **PR12**: Group 16 (Connection & Sync)
13. **PR13**: Group 15 (Nano Contracts)
14. **PR14**: Group 17 (Transaction Templates)

### Phase 7: Cleanup (1 PR)
15. **PR15**: Group 18 (Legacy/Deprecated)

---

## Key External Dependencies to Define First

Before starting any group, these shared types/interfaces should be defined:

1. **Storage Interface** (`IStorage`)
2. **Connection Interface**
3. **Address Model** (`Address`)
4. **Transaction Models** (`Transaction`, `CreateTokenTransaction`)
5. **Wallet Access Data** (`IWalletAccessData`, `IMultisigData`)
6. **UTXO Types** (`UtxoOptions`, `UtxoDetails`, `UtxoInfo`)
7. **Output Value Type** (`OutputValueType`)
8. **Enums**: `WalletType`, `TokenVersion`, `SCANNING_POLICY`, `HistorySyncMode`, etc.

---

## Testing Strategy

Each group should have:
- Unit tests for individual methods
- Integration tests for group interactions
- Backward compatibility tests to ensure existing behavior is preserved

---

## Notes

- Methods marked as deprecated should be typed but can be done last
- Static methods can be typed independently
- Some methods have JSDoc typedefs that can guide the TypeScript types
- The file currently has `@ts-nocheck` which should be removed incrementally per PR
- Consider creating a `types.ts` file for shared interfaces used across groups

### Recommendations

- Parameters that have JSDocs should be kept, only the type removed not to conflict with typescript.
- Parameters without JSDocs can have their JSDocs removed when adding types.
- Return types should be left to Typescript to infer them automatically. Only declare them if it breaks the code not to.
- Return types that have a description on JSDocs should keep the JSDoc description but remove the type not to conflict with typescript.
- Variable types inside methods should be left to Typescript to infer them automatically. Only declare them if it breaks the code not to.

### Critical points

- No code should be changed, only types and docstrings.
- There will be times when the types won't match without code changes. In those cases, leave the type as `any` and add a `TODO` comment to fix the type later, with a bit of context.
- Unless you're avoiding one of those critical issues, never use `any` or `unknown`, and always add a comment explaining why if you do.
- It is possible the ambiguity or confidence level of some tasks can be challenging. In these cases, interrupt the implementation and ask the user.
