---
name: hathor-pr-review
description: Review code changes against Hathor team conventions, patterns, and standards (drawn primarily from hathor-wallet-lib's PR history — 899 PRs, 4958 review comments — but applicable across the Hathor TS/JS stack). Checks TypeScript safety, error handling, naming, tests, security, and Hathor-specific patterns.
---

# Hathor Wallet Lib — PR Review

Review the current branch's changes against project conventions derived from historical PR review data (899 PRs, 4958 inline review comments from core reviewers: pedroferreira1, r4mmer, msbrogli, tuliomir, andreabadesso).

## Workflow

### Step 1: Gather Changes

Run these commands to understand the full scope of changes:

```bash
# Find the base branch
git merge-base HEAD master

# All commits on this branch
git log --oneline $(git merge-base HEAD master)..HEAD

# Full diff
git diff $(git merge-base HEAD master)..HEAD

# Changed files
git diff --name-only $(git merge-base HEAD master)..HEAD
```

Read every changed file in full (not just the diff) to understand context.

### Step 2: Review Against Rules

Apply each rule category below. For every finding, assign a severity:

| Severity | Meaning |
|----------|---------|
| **critical** | Will break at runtime, data corruption, security vulnerability |
| **major** | Logic error, missing error handling, wrong type, behavior change |
| **minor** | Naming convention, style, unnecessary code, missing test |
| **nit** | Cosmetic, optional improvement, personal preference |

Only report findings with **>80% confidence**. If uncertain, read more context before reporting.

### Step 3: Output Format

```markdown
## PR Review: <branch-name>

### Summary
<1-2 sentence overview of the changes>

### Findings

#### [critical|major|minor|nit] <Short title>
**File:** `path/to/file.ts:LINE`
**Issue:** <What's wrong>
**Suggestion:** <How to fix>

...

### Checklist
- [ ] PR title follows convention (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`)
- [ ] No `null` used where `undefined` should be used
- [ ] Proper error handling (no swallowed errors)
- [ ] Types are explicit, no unnecessary `any`
- [ ] Tests cover new/changed behavior
- [ ] No duplicated code that should be extracted
- [ ] No test-specific logic in production code
- [ ] No hardcoded magic numbers
- [ ] Async/await used correctly (no floating promises)
- [ ] No security concerns (key exposure, injection, etc.)

### Verdict
**APPROVE** | **REQUEST CHANGES** | **NEEDS DISCUSSION**
<Brief justification>
```

---

## Rule Categories

### 1. TypeScript & Type Safety

The project is migrating from JavaScript to TypeScript. Reviewers consistently flag:

- **Avoid `any` type.** Use proper types or generics. The project has `noImplicitAny: false` but reviewers still push for explicit types in new code.
- **Use `undefined` instead of `null` for optional/empty values.** This is a strong, explicit convention. From tuliomir: *"We're trying to use `undefined` and `null` correctly. No `null` for empty parameters."* Use optional parameters (`param?: Type`) instead of `param: Type | null`.
- **Avoid `@ts-expect-error` and `@ts-ignore`.** Use proper type narrowing, non-null assertions (`!`), or type guards instead.
- **Add explicit return types** to public methods and exported functions.
- **Use type guards** instead of type assertions where possible.
- **Generic types on collections.** When using `Queue`, `Map`, `Set`, etc., always specify the generic type parameter.

### 2. Error Handling

The #2 most common review theme (462 comments). Key patterns:

- **Never swallow errors.** Empty catch blocks or `catch (e) { /* ignore */ }` are flagged.
- **No `console.error` in library code.** This is a library consumed by other apps. Use proper error propagation or the planned logging infrastructure. From andreabadesso: *"I hate the idea of adding test-specific logic here."*
- **Throw descriptive errors.** Include context about what failed and why.
- **Check for null/undefined at system boundaries.** Validate inputs from external APIs and user input, but trust internal code.
- **Async error handling.** Always `await` promises or handle rejections. No floating promises.

### 3. Naming Conventions

- **PR titles:** Must follow conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`. Optionally with scope: `feat(wallet):`. ~78% of PRs follow this convention.
- **Variables/functions:** camelCase.
- **Types/interfaces:** PascalCase. Prefix interfaces with `I` only for storage interfaces (`IStore`, `IStorage`).
- **Constants:** UPPER_SNAKE_CASE.
- **Files:** snake_case for most files, camelCase for some legacy files. New files should use camelCase for `.ts` files.
- **Test files:** Match source file name with `.test.ts` extension.
- **Be precise with names.** From r4mmer: *"Rename the wallet adapters. We should have `FullnodeWalletTestAdapter` and `WalletServiceWalletTestAdapter`."*
- **No temporal references in comments.** From andreabadesso: *"Remove 'for this stage of the ts refactor' — a future dev shouldn't have to know which stage we're in."*

### 4. Code Duplication

Consistently flagged by pedroferreira1 and r4mmer:

- **Extract shared logic into utility methods.** From pedroferreira1: *"Both methods are exactly the same. We should create a util method."*
- **Don't duplicate code across wallet facades.** If logic exists in both `HathorWallet` and `HathorWalletServiceWallet`, extract to a shared utility.
- **Reuse existing test helpers.** From pedroferreira1: *"Why don't you use `buildWalletInstance`? It's pretty similar and the code seems to be duplicated here."*
- **Use configuration objects instead of many boolean parameters.** From pedroferreira1: *"We could use a single object for these options."*

### 5. Testing

The #3 most common theme (417 comments):

- **Coverage thresholds must be maintained.** Global: 48% lines, 40% branches. Wallet class: 90%+. From r4mmer: *"I don't think we should lower the standards without approval from @pedroferreira1."*
- **Mock the correct API.** Match the actual method being called, not a similar one. Mismatched mocks cause CI failures.
- **Use case-insensitive regex in test assertions** where appropriate: `.toThrow(/pin/i)`.
- **No test-specific logic in production code.** From andreabadesso: *"Just mock the `axiosInstance` in the setup of the tests and keep the global axios instance clean."*
- **Don't over-engineer test helpers.** From tuliomir: *"This is over-engineering for test helpers. Adding AbortController/AbortSignal threading is a significant change for negligible benefit in test code."*
- **Integration tests** require Docker setup and use precalculated wallets. Test files go in `__tests__/integration/`.
- **Catch errors in tests.** Uncaught promise rejections in tests must be fixed.

### 6. Wallet Architecture Patterns

Core domain patterns reviewers enforce:

- **Wallet lifecycle states:** CLOSED → CONNECTING → SYNCING → READY. Check state transitions are valid.
- **Storage initialization:** Storage must be initialized before use. Verify `setStore()` is called.
- **Address handling:**
  - GAP_LIMIT of 20 addresses.
  - BIP44 derivation: `m/44'/280'/0'/0/index`.
  - Distinguish P2PKH vs P2SH addresses and their derivation paths.
- **Two wallet types exist:** `HathorWallet` (fullnode) and `HathorWalletServiceWallet` (wallet service). Changes should consider both where applicable.
- **Single address mode.** New feature; default for wallets unless user has txs at index > 0.
- **IHathorWallet interface.** Shared options between wallet facades should be typed in this interface.

### 7. Nano Contracts

Specialized domain reviewed mainly by jansegre, glevco, and r4mmer:

- **Terminology:** Use "nc-type" for general types (not "field"), as "field" refers specifically to Blueprint attributes/properties in hathor-core.
- **Encoding limits:** `NC_ARGS_MAX_BYTES_LENGTH=1000` applies to total serialized call args. Individual bytes fields can be up to `2**16`.
- **Variable-size tuples:** `tuple[T, ...]` syntax from hathor-core. Fixed-size tuple abstraction may not cover all cases.
- **Type safety for BigInt.** When parsing JSON numbers, handle the IEEE 754 double precision limitation. Use `BigInt` for large integers.
- **Accept only `bigint` type** (not `number`) for functions dealing with large values. Force explicit conversion at call sites.

### 8. API & Network

- **Error responses from hathor-core.** Non-200 responses (e.g., 400) may contain useful error info. Propagate error messages from the API, don't just throw generic errors. From luislhl: *"Will the error message be available in this error object? Otherwise we could make debugging harder."*
- **Axios interceptors.** Don't add test-specific logic to global interceptors. Mock axios in tests instead.
- **Retry logic comments.** Don't hardcode delay values in comments; describe the pattern generically.
- **No hardcoded sleep durations.** Extract as constants or make configurable.
- **Zod schemas** for API response validation in `src/api/schemas/`.

### 9. Security

Critical for a blockchain wallet library:

- **Never expose private keys, seeds, or mnemonics** in logs, error messages, or serialized data.
- **Validate all external input.** API responses, WebSocket messages, user-provided addresses.
- **Dependency management.** From the release template: *"Do not include new dependencies unless strictly necessary. Do not include dev-dependencies as production ones. More dependencies increase hijacking risk."*
- **Pin signing operations.** Verify PIN/password is always required for signing operations. From r4mmer: *"We should check that the wallets don't expect some special case where pin or password are not passed."*
- **Script validation.** Validate Bitcoin-style scripts before executing.

### 10. Imports & Module Structure

- **No circular imports.** The codebase has had issues with circular dependencies.
- **Named exports preferred.** From recent PRs: renamed types at source rather than aliasing at export.
- **Don't add unused eslint-disable directives** unless there's a clear reason (e.g., exhaustive import tests).
- **Public API surface.** Changes to exports affect downstream consumers. Verify backward compatibility.

### 11. Comments & Documentation

- **Comments should explain "why", not "what".** Don't describe obvious code.
- **Remove stale comments.** Don't leave TODO references to completed work or specific refactoring stages.
- **JSDoc for public API methods.** Especially on wallet facade methods and exported utilities.
- **Don't add generic/obvious comments.** From andreabadesso: *"Comment is pretty much useless, remove it or explain why this might happen."*

### 12. Git & PR Conventions

- **PR title format:** `type(optional-scope): description` where type is one of: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`, `style`, `perf`, `revert`.
- **PR descriptions** should include acceptance criteria and a security checklist for non-trivial changes.
- **Labels:** `enhancement`, `bug`, `refactor`, `tests`, `dependencies`.
- **Breaking changes** must be explicitly called out in PR description.
- **Separate concerns.** Don't mix unrelated changes. If a linter reformats unrelated code, question whether it belongs in the PR.
- **One PR per feature/fix.** From raul-oliveira: *"I'll open another PR to address it."*
