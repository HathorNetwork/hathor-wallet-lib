# TypeScript Errors Report

**Total Errors:** 59
**Files Affected:** 2 (`src/new/wallet.ts`: 58, `src/new/sendTransaction.ts`: 1)

## How to Reproduce

The `tsconfig.json` has conflicting options (`emitDeclarationOnly` and `noEmit` cannot be used together), so to check for type errors, run:

```bash
npx tsc --noEmit --emitDeclarationOnly false
```

Or to filter for specific patterns:
```bash
npx tsc --noEmit --emitDeclarationOnly false 2>&1 | grep "wallet.ts"
```

---

## Summary by Complexity

| Complexity | Error Types                              | Count | Effort |
|------------|------------------------------------------|-------|--------|
| 🟢 Easy    | Null checks, optional chaining           | 8     | Low    |
| 🟡 Medium  | Type narrowing, nullability              | 25    | Medium |
| 🔴 Hard    | Interface mismatches, missing properties | 26    | High   |

---

## 🟢 EASY - Low Hanging Fruits

### TS18047: Object is possibly 'null' (3 errors)
**Fix:** Add null checks or optional chaining (`?.`)

| File      | Line | Variable      |
|-----------|------|---------------|
| wallet.ts | 1654 | `tx`          |
| wallet.ts | 3682 | `addressInfo` |
| wallet.ts | 3682 | `addressInfo` |

```typescript
// Before
tx.someProperty
// After
tx?.someProperty
// Or with assertion if you're certain:
tx!.someProperty
```

### TS18048: Property is possibly 'undefined' (1 error)
**Fix:** Add optional chaining or default value

| File | Line | Property |
|------|------|----------|
| wallet.ts | 3682 | `addressInfo.seqnum` |

### TS2531: Object is possibly 'null' (1 error)
**Fix:** Add null check or non-null assertion

| File | Line | Location |
|------|------|----------|
| wallet.ts | 1577 | Column 29 |

### TS18046: Variable is of type 'unknown' (3 errors)
**Fix:** Add type assertion or type guard

| File | Line | Variable |
|------|------|----------|
| wallet.ts | 1997 | `info` |
| wallet.ts | 2003 | `info` |
| wallet.ts | 3099 | `confirmationData` |

```typescript
// Before
info.someProperty
// After
(info as SomeType).someProperty
```

---

## 🟡 MEDIUM - Nullability Mismatches

### TS2345: Argument type not assignable (null/undefined issues) (13 errors)
**Fix:** Handle nullability with `?? defaultValue`, `!` assertion, or update function signatures

| File | Line | Issue |
|------|------|-------|
| wallet.ts | 1502 | `number \| null` → `number` |
| wallet.ts | 1559 | `number \| null` → `number \| undefined` |
| wallet.ts | 1998 | `unknown` → `ApiVersion` |
| wallet.ts | 2970 | `string \| undefined` → `string` |
| wallet.ts | 3350 | `string \| null \| undefined` → `string` |
| wallet.ts | 3351 | `string \| null \| undefined` → `string` |
| wallet.ts | 3354 | `unknown[] \| null \| undefined` → `unknown[] \| null` |
| wallet.ts | 3466 | `string \| null \| undefined` → `string` |
| wallet.ts | 3467 | `string \| null \| undefined` → `string` |
| wallet.ts | 3470 | `unknown[] \| null \| undefined` → `unknown[] \| null` |
| wallet.ts | 3514 | `EcdsaTxSign \| null` → `EcdsaTxSign` |
| wallet.ts | 3599 | `string \| null` → `string` |

```typescript
// Option 1: Non-null assertion (if you're certain)
someFunction(value!)

// Option 2: Nullish coalescing
someFunction(value ?? defaultValue)

// Option 3: Early return / guard
if (value === null) return;
someFunction(value)
```

### TS2322: Type assignment issues (null to string) (5 errors)
**Fix:** Handle null case or update type definitions

| File | Line | Issue |
|------|------|-------|
| wallet.ts | 1970 | `string \| null` → `string` |
| wallet.ts | 1971 | `string \| null` → `string` |
| wallet.ts | 1977 | `string \| null` → `string` |
| wallet.ts | 2765 | `number \| null \| undefined` → `TokenVersion \| undefined` |
| wallet.ts | 1906 | `ProposedOutput[]` → `ISendOutput[]` |

---

## 🔴 HARD - Interface & Type Mismatches

### TS2345: Complex argument type mismatches (12 errors)
**Fix:** Align interfaces or add proper type conversions

| File | Line | Description |
|------|------|-------------|
| sendTransaction.ts | 509 | `{ history: IHistoryTx }` → `WalletWebSocketData` (missing `type` property) |
| wallet.ts | 1464 | `authorities: number` → should be `bigint` |
| wallet.ts | 1477 | Object → `never` (likely array type issue) |
| wallet.ts | 1500 | `filter_address` nullability mismatch |
| wallet.ts | 1536 | Object missing `token`, `type`, `height` from `IUtxo` |
| wallet.ts | 1540 | `IUtxo[]` → `Utxo[]` (interface mismatch) |
| wallet.ts | 1582 | Object → `never` |
| wallet.ts | 1711 | `{} \| null` → `WalletWebSocketData` |
| wallet.ts | 2274 | `filter_address` null vs undefined |
| wallet.ts | 2348 | Missing `tokenVersion` property |
| wallet.ts | 2544 | Object → `string` |
| wallet.ts | 2833 | Promise → `never` |

### TS2339: Property does not exist (9 errors)
**Fix:** Update type definitions or use type assertions

| File | Line | Property | On Type |
|------|------|----------|---------|
| wallet.ts | 1583 | `tx_id` | `never` |
| wallet.ts | 1584 | `index` | `never` |
| wallet.ts | 1587 | `amount` | `never` |
| wallet.ts | 2271 | `max_utxos` | filter options object |
| wallet.ts | 2838 | `address` | `never` |
| wallet.ts | 2838 | `mine` | `never` |
| wallet.ts | 3130 | `success` | `string` |
| wallet.ts | 3542 | `hasCapability` | `Connection` |
| wallet.ts | 3564 | `onReload` | `Connection` |
| wallet.ts | 3568 | `unsubscribeAddress` | `Connection` |

### TS2445: Protected property access (4 errors)
**Fix:** Make property public, add getter, or refactor access pattern

| File | Line | Property | Class |
|------|------|----------|-------|
| wallet.ts | 1950 | `network` | `Connection` |
| wallet.ts | 1972 | `network` | `Connection` |
| wallet.ts | 1997 | `network` | `Connection` |
| wallet.ts | 2003 | `network` | `Connection` |

### TS2740: Missing properties from type (1 error)
**Fix:** Major interface alignment needed

| File | Line | Description |
|------|------|-------------|
| wallet.ts | 2022 | `Connection` missing 15+ properties from `WalletConnection` |

### TS2322/TS2345: Complex type mismatches (4 errors)
**Fix:** Align FullNode types with History types

| File | Line | Description |
|------|------|-------------|
| wallet.ts | 3068 | Callback signature mismatch (`nc_id` nullability) |
| wallet.ts | 3211 | `FullNodeOutput` → `IHistoryInput \| IHistoryOutput` |
| wallet.ts | 3213 | Array type mismatch + `FullNodeInput` → `IHistoryInput` |
| wallet.ts | 3217 | `FullNodeTx` missing `tx_id`, `is_voided` from `IHistoryTx` |
| wallet.ts | 3471 | Optional `name` should be required |

### TS2367: Unintentional comparison (1 error)
**Fix:** Logic issue - comparing empty string with error message

| File | Line | Description |
|------|------|-------------|
| wallet.ts | 3052 | Comparing `""` with `"Transaction not found"` |

---

## Recommended Fix Order

1. **Start with 🟢 Easy (8 errors)**
   - Quick wins with null checks and optional chaining
   - Estimated: 15-30 minutes

2. **Then 🟡 Medium (18 errors)**
   - Nullability handling, mostly mechanical fixes
   - Estimated: 1-2 hours

3. **Finally 🔴 Hard (33 errors)**
   - Interface alignments may require deeper refactoring
   - Consider if some interfaces should be updated vs code changes
   - The `Connection` vs `WalletConnection` issue (line 2022) may cascade

---

## Key Patterns to Address

### Pattern 1: `null` vs `undefined`
Many errors stem from inconsistent use of `null` vs `undefined`. Consider standardizing.

### Pattern 2: `IUtxo` vs `Utxo`
There seem to be two UTXO types with different shapes. May need interface consolidation.

### Pattern 3: `Connection` vs `WalletConnection`
The `Connection` class is being used where `WalletConnection` is expected. This appears to be a class hierarchy issue.

### Pattern 4: FullNode types vs History types
`FullNodeTx`, `FullNodeInput`, `FullNodeOutput` don't align with `IHistoryTx`, `IHistoryInput`, `IHistoryOutput`.
