export const meta = {
  name: 'shielded-integration-deep-review',
  description: 'Deep multi-agent review of wallet-lib shielded outputs integration vs hathor-core source of truth',
  phases: [
    { title: 'Ground Truth', detail: 'map hathor-core consensus rules, wire formats, node API, ct-crypto API' },
    { title: 'Review', detail: '7 reviewer souls: completeness, wire, crypto, state, edge cases, tests, security' },
    { title: 'Verify', detail: 'adversarial skeptics per finding; 3-vote panel for critical/high' },
    { title: 'Write', detail: 'one description file per confirmed finding' },
    { title: 'Synthesize', detail: 'completeness critic, dedup, README index' },
  ],
}

const REVIEW_DIR = '/Users/pedroferreira/Hathor/hathor-wallet-lib/SHIELDED_INTEGRATION_REVIEW'
const WL = '/tmp/review-wallet-lib-shielded'
const CORE = '/tmp/review-hathor-core-shielded'

const CTX = `
## Environment (read carefully)
- WALLET-LIB UNDER REVIEW: ${WL} — a git worktree of branch feat/shielded-outputs-integration. This is the code being reviewed. READ ONLY: never edit anything under it. It has NO node_modules — do NOT run npm install/test there; this is a static review.
- SOURCE OF TRUTH: ${CORE} — a git worktree of hathor-core branch experimental/shielded-outputs-alpha-v4 (Python). Where the RFC and core diverge, CORE WINS. Also read-only.
  - Key core files: hathor/transaction/shielded_tx_output.py, hathor/transaction/headers/ (shielded_outputs_header.py, unshield_balance_header.py, mint/melt headers), hathor/verification/ (transaction_verifier.py etc.), hathor/crypto/shielded/.
- ct-crypto library (the crypto the wallet calls):
  - Rust source of truth: ${CORE}/hathor-ct-crypto/src/
  - Node bindings repo: /Users/pedroferreira/Hathor/hathor-ct-crypto-node (index.d.ts is the TS API surface)
  - Installed packages actually imported by wallet-lib: /Users/pedroferreira/Hathor/hathor-wallet-lib/node_modules/@hathor/ct-crypto-node and @hathor/ct-crypto-provider (note: installed from a sibling branch checkout; cross-check versions against ${WL}/package.json).
- Reference docs (fetched from RFC PR #104 and the official client integration guide): ${REVIEW_DIR}/reference/client-guide-checklist.md and ${REVIEW_DIR}/reference/rfc-summary.md. Read both.
- To scope what the integration changed: git -C ${WL} diff master...HEAD --stat  (and per-file diffs). Key wallet files: src/shielded/processing.ts, src/shielded/unblinding.ts, src/headers/*, src/models/shielded_output.ts, src/models/address.ts, src/models/transaction.ts, src/models/network.ts, src/new/sendTransaction.ts, src/new/wallet.ts, src/new/types.ts, src/storage/storage.ts, src/storage/memory_store.ts, src/utils/storage.ts, src/utils/transaction.ts, src/utils/address.ts, src/utils/shieldedAddress.ts, src/utils/wallet.ts, src/sync/stream.ts, src/api/schemas/txApi.ts, src/schemas.ts, src/constants.ts, src/types.ts, plus __tests__/ (unit + __tests__/integration/shielded_outputs/).
- Cite evidence as file:line from these exact paths.
`

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'severity', 'file', 'description', 'evidence', 'recommendation'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'CATEGORY-NN, e.g. SEC-03' },
          title: { type: 'string' },
          severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] },
          file: { type: 'string', description: 'primary wallet-lib file affected, repo-relative path' },
          line: { type: 'string', description: 'line or line-range if known' },
          description: { type: 'string', description: 'what is wrong / missing and why it matters' },
          evidence: { type: 'string', description: 'concrete file:line refs and code excerpts in wallet-lib AND in hathor-core/ct-crypto proving the divergence' },
          recommendation: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['isReal', 'confidence', 'notes'],
  additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    confidence: { enum: ['high', 'medium', 'low'] },
    adjustedSeverity: { enum: ['critical', 'high', 'medium', 'low', 'info'] },
    notes: { type: 'string', description: 'evidence found; if refuted, the exact file:line that disproves the claim' },
  },
}

const WRITTEN = {
  type: 'object',
  required: ['path'],
  additionalProperties: false,
  properties: { path: { type: 'string' } },
}

const CRITIC_SCHEMA = {
  type: 'object',
  required: ['areas'],
  additionalProperties: false,
  properties: {
    areas: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        required: ['key', 'charter'],
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          charter: { type: 'string' },
        },
      },
    },
  },
}

const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

// ---------- Phase 1: Ground truth (barrier: every reviewer needs all four docs) ----------
phase('Ground Truth')
log('Mapping hathor-core source of truth with 4 parallel agents')

const gtPrompts = [
  ['wire-format', `You are a wire-format archaeologist. In the hathor-core worktree at ${CORE} (branch experimental/shielded-outputs-alpha-v4), extract the EXACT byte-level serialization of everything shielded:
1. ShieldedTxOutput (hathor/transaction/shielded_tx_output.py): every field, order, sizes, length prefixes, how AmountShielded vs FullShielded are discriminated, token_data semantics.
2. ShieldedOutputsHeader and UnshieldBalanceHeader (hathor/transaction/headers/): header IDs, entry layout, counts, bounds/limits, sighash coverage (what is signed).
3. Mint/Melt headers (find them in hathor/transaction/headers/): IDs, entry encoding, limits.
4. How shielded outputs/headers appear in transaction struct serialization and in the full node's tx APIs / event payloads (grep for where these are serialized to JSON for clients — resources/, event APIs).
5. Shielded address format and version bytes (hathor/crypto/shielded/ and anywhere addresses are encoded/decoded).
Return a precise reference doc (max ~2500 words) with file:line citations. This will be handed to reviewers comparing the wallet-lib byte-for-byte.`],
  ['consensus-rules', `You are a consensus-rules auditor. In the hathor-core worktree at ${CORE} (branch experimental/shielded-outputs-alpha-v4), enumerate EVERY validation/consensus rule touching shielded outputs: search hathor/verification/ (transaction_verifier.py, vertex_verifier.py, verification_service.py, verification_params.py, token_creation_transaction_verifier.py) plus the header classes' own validate methods and hathor/crypto/shielded/.
For each rule state: what is checked, exact constants/limits, error raised, and file:line. Include: point validation, range proof, surjection proof, balance verification (incl. excess/full-unshield path), header mutual exclusions, count limits, mint/melt rules, token creation with shielded, sigops/script rules, mempool/relay constraints, and anything about minimum numbers of shielded outputs. ALSO explicitly list rules the node does NOT enforce that wallets are expected to handle (privacy hygiene, 2-output rule, etc.) — note where the code comments say so. Max ~2500 words, file:line citations.`],
  ['node-api', `You are a full-node API cartographer. In the hathor-core worktree at ${CORE} (branch experimental/shielded-outputs-alpha-v4 — its HEAD commit is 'events API'), document everything a wallet CLIENT sees over the wire for shielded outputs:
1. REST/tx API JSON shapes for transactions containing shielded outputs and headers (search hathor/api resources, transaction resource serializers, to_json methods on ShieldedTxOutput/headers).
2. WebSocket / event-queue payloads (the alpha-v4 HEAD added an events API — run: git -C ${CORE} show HEAD --stat to see what changed; document new/changed event shapes).
3. Address history / address-search behavior for shielded outputs and shielded addresses, if any.
4. Anything about how the node reports balance/UTXO info for shielded outputs.
Note exact field names, casing, hex/base64 encodings, optional vs required. Max ~2000 words, file:line citations. Reviewers will compare this against wallet-lib's zod schemas (src/api/schemas/txApi.ts, src/schemas.ts) and sync code.`],
  ['ct-crypto-api', `You are a crypto-API librarian. Document the ct-crypto API surface the wallet-lib calls:
1. Read /Users/pedroferreira/Hathor/hathor-wallet-lib/node_modules/@hathor/ct-crypto-node/index.d.ts and @hathor/ct-crypto-provider (the packages actually imported) — every exported function: exact parameter order, types (bigint vs number, Buffer vs Uint8Array), return shapes, throw vs boolean-return semantics.
2. Cross-check against the Rust source of truth at ${CORE}/hathor-ct-crypto/src/ (napi_bindings.rs, balance.rs, rangeproof.rs, surjection.rs, ecdh.rs, pedersen.rs, generators.rs) — note any divergence between installed .d.ts and Rust semantics (e.g. validation done in Rust vs assumed by caller, units, endianness).
3. Compare installed package versions (node_modules/@hathor/*/package.json) vs what ${WL}/package.json pins — flag mismatches.
4. Note which functions validate inputs themselves vs which require the CALLER to pre-validate (curve point checks, scalar range, buffer lengths).
Max ~2500 words. This tells reviewers whether wallet-lib calls the crypto correctly.`],
]

const groundTruth = await parallel(gtPrompts.map(pair => () =>
  agent(`${CTX}\n${pair[1]}\n\nReturn the reference doc as plain markdown text — your final message IS the doc.`,
    { label: `truth:${pair[0]}`, phase: 'Ground Truth' })
))
const gtWire = groundTruth[0]
const gtRules = groundTruth[1]
const gtApi = groundTruth[2]
const gtCrypto = groundTruth[3]
const GT = `
## Ground truth: hathor-core wire formats
${gtWire || '(agent failed — derive from core sources directly)'}

## Ground truth: hathor-core consensus/validation rules
${gtRules || '(agent failed — derive from core sources directly)'}

## Ground truth: full-node client-facing API
${gtApi || '(agent failed — derive from core sources directly)'}

## Ground truth: ct-crypto API surface
${gtCrypto || '(agent failed — derive from core sources directly)'}
`
log('Ground truth assembled; fanning out 7 reviewers')

// ---------- Phases 2-4: Review -> Verify -> Write (pipeline per dimension, no barriers) ----------
const QUALITY = `
## Quality bar
- Report ONLY findings you would defend in front of the authors: each needs concrete evidence (file:line in wallet-lib AND, where applicable, the contradicting file:line in hathor-core / ct-crypto / the guide).
- Max 12 findings; prefer fewer, deeper. No style nits. No findings about code that is identical to master (this review is about the shielded integration).
- Severity: critical = funds loss, privacy break (blinding/key leak), or wallet builds txs the node rejects / accepts txs it must not; high = likely-hit bug or real security weakness; medium = bug in edge path or robustness gap; low = minor; info = observation worth recording.
- Number ids with your category prefix, two digits, starting 01.
- Before reporting a "missing X" finding, grep the WHOLE wallet-lib worktree for it — it may live in an unexpected file.`

const DIMENSIONS = [
  { key: 'completeness', prefix: 'COMP', charter: `You are the COMPLETENESS reviewer — answer: is everything the core feature supports implemented in the wallet-lib integration, or is something missing?
Build a feature matrix from the ground truth + reference docs: AmountShielded create/receive/spend, FullShielded create/receive/spend, full unshield + UnshieldBalanceHeader, balancing VBF, mint/melt headers (create + parse + balance participation), token creation with shielded outputs, shielded address derivation/encode/decode/validation, scanning/rewind of incoming outputs, change handling to shielded, storage/balance reporting, the events/streaming sync path for shielded, multisig wallets, readonly/xpub wallets, wallet-service wallet parity, fee/deposit handling for hidden tokens.
For each row, find where wallet-lib implements it (cite) or report a MISSING/PARTIAL finding. Explicitly check the new events API the core alpha-v4 HEAD added — does the wallet consume it?` },
  { key: 'wire', prefix: 'WIRE', charter: `You are the WIRE-FORMAT reviewer — byte-level correctness. Compare wallet-lib serialization/deserialization against the core ground truth byte for byte:
src/models/shielded_output.ts vs hathor/transaction/shielded_tx_output.py; src/headers/shielded_outputs.ts, unshield_balance.ts, mint_header.ts, melt_header.ts, mint_melt_entry.ts, mint_melt_header_base.ts vs the core header classes (IDs, field order, length prefixes, counts, bounds); sighash construction in src/models/transaction.ts and src/utils/transaction.ts vs core (what bytes get signed — any divergence is critical); src/api/schemas/txApi.ts + src/schemas.ts zod schemas vs actual node JSON (field names, casing, encodings, optionality, bigint handling); shielded address encode/decode (src/utils/shieldedAddress.ts, src/models/address.ts, src/models/network.ts version bytes) vs core.
Round-trip asymmetries (serialize vs deserialize), endianness, signed/unsigned, varint vs fixed, and off-by-one bounds are your prey.` },
  { key: 'crypto', prefix: 'CRY', charter: `You are the CRYPTOGRAPHY reviewer. Audit every crypto call and flow in the wallet-lib integration against the ct-crypto ground truth and the client guide:
- Blinding factor generation (library generator only?), VBF/GBF balancing math in src/new/sendTransaction.ts + src/utils/transaction.ts: correct (value, vbf, gbf) entry construction for transparent/amount-shielded/full-shielded inputs and outputs, correct last-output balancing, correct excess computation for full unshield, per-token handling.
- ECDH/rewind usage in src/shielded/unblinding.ts and processing.ts: right keys, right parameters, right generator selection (derive_asset_tag vs asset_commitment).
- The MANDATORY FullShielded token-UID cross-check after rewind (guide section 4.3) — is it done, correctly, everywhere rewind happens?
- Validation order and point validation before use; what wallet-lib must pre-validate because the binding does not.
- Key derivation for shielded addresses (scan/spend keys) in src/utils/wallet.ts / shieldedAddress.ts vs core derivation; ephemeral key generation and disposal.
- Any place crypto results are trusted without verification, or wallet verifies something wrong (e.g. wrong generator, wrong commitment).` },
  { key: 'state', prefix: 'STATE', charter: `You are the WALLET-STATE reviewer. Audit storage, balances, UTXO and sync correctness for shielded outputs:
src/storage/storage.ts, src/storage/memory_store.ts, src/utils/storage.ts (the 670-line diff!), src/utils/utxo.ts, src/sync/stream.ts, src/new/wallet.ts lifecycle.
Hunt: balance double-counting or omission of shielded outputs (per token, locked/unlocked, authorities); UTXO selection mixing shielded/transparent incorrectly or selecting unspendable shielded UTXOs (missing blinding factor); persistence of unblinded data (value, blinding factors) across restart and access-data migration; reorg/voided-tx handling for shielded outputs and their cached unblindings; mempool/unconfirmed handling; sender-local insert vs websocket race (there is a known race area); partial history loads; gap-limit/address scanning interaction with shielded addresses; wallet-service storage proxy parity; stale caches after spending a shielded UTXO.` },
  { key: 'edge', prefix: 'EDGE', charter: `You are the CORNER-CASE reviewer. Hunt unconsidered edge cases in the integration:
zero/dust values; values near 2^63/2^64 boundaries and bigint vs number truncation; single-shielded-output txs (RFC privacy rule + any core rule about minimum counts); max entries per header / max headers per tx; full-unshield with exactly one shielded input (excess = that input's blinding — handled? warned?); mixed token tx where the SAME token appears shielded and transparent; FullShielded of HTR (token uid zeros); token_data index edge cases (authority bit set? index out of range of tokens array?); change output when everything else is shielded; mint/melt where minted amount goes to a shielded output; sending TO your own shielded address (self-send: does scanning double-count?); receiving a shielded output on an address past the gap limit; outputs whose rewind fails permanently (corrupted) — does sync wedge or skip; timelocked shielded outputs; multisig + shielded; readonly wallet trying to scan (no private scan key); concurrent sends consuming the same shielded UTXO; nano-contract txs carrying shielded headers.
For each edge you check, either cite where wallet-lib handles it or file a finding with a concrete failing scenario.` },
  { key: 'tests', prefix: 'TEST', charter: `You are the TEST-COVERAGE reviewer — answer: do the tests cover every aspect of the integration?
Inventory __tests__/integration/shielded_outputs/ (23 suites) plus the shielded unit tests (__tests__/headers/, __tests__/shielded/, __tests__/models/shielded_output.test.ts, __tests__/utils/...). Build a coverage matrix: feature/rule (from ground truth + reference checklist) x test that exercises it. Read test BODIES, not just names — a suite named crypto_failures.test.ts may not actually assert what you expect; watch for tests that assert nothing meaningful, skip themselves, or mock away the very thing they claim to test.
Report findings for: untested features (e.g. is full unshield tested? mint/melt with shielded? FullShielded token-uid spoof rejection? malformed proof handling? reorg of shielded tx?), negative paths never exercised, integration tests that would pass even if the feature were broken, and unit-test gaps on serialization round-trips/bounds. Severity by risk of the untested path.` },
  { key: 'security', prefix: 'SEC', charter: `You are the SECURITY reviewer — adversarial mindset, wallet-side threat model:
1. Secret hygiene: where do blinding factors, scan/spend private keys, recovered values live? Plaintext at rest? Encrypted under PIN like other keys? Logged? Sent to any API (privacy leak)? Exposed in events/serializations (toJSON) that callers might persist or transmit? Check what gets included in tx push payloads beyond what the node needs.
2. Malicious counterparty/node: spoofed token UID in rangeproof message (cross-check enforced?); oversized proofs (DoS — buffer limits 1024/4096 enforced before native calls?); malformed curve points from node JSON reaching native code; a malicious node feeding fake unblinded values — does the wallet verify rewound (value, blinding) against the on-chain commitment before trusting/displaying/storing it?
3. Tx-construction safety: can a crafted "send" request make the wallet reveal more than intended (e.g. excess scalar when not a full unshield, unblinding outputs that belong to other recipients)? Wallet must only ever expose blindings of wallet-owned outputs. Change address reuse / ephemeral key reuse across outputs?
4. Sighash: are all shielded headers and fields covered by what the wallet signs (malleability)? Compare with core sighash.
5. Privacy leaks: address reuse of shielded addresses, deterministic ephemeral keys, ordering correlations (shielded change always last?), amounts inferable from rounding or token_data.
Cite code for every claim.` },
]

function reviewPrompt(d) {
  return `${CTX}\n${GT}\n${QUALITY}\n\n${d.charter}\n\nUse id prefix ${d.prefix}-. Go deep: read the actual code in ${WL}, not just the diff. Return findings via StructuredOutput.`
}

function skepticPrompt(f, lens) {
  return `${CTX}\n\nYou are an adversarial verifier. A reviewer claims the following finding about the wallet-lib shielded integration (branch feat/shielded-outputs-integration, worktree ${WL}). Your job: try to REFUTE it by reading the actual code (wallet-lib AND hathor-core/ct-crypto sources of truth). Focus lens: ${lens}.

FINDING ${f.id} [${f.severity}] ${f.title}
File: ${f.file}${f.line ? ':' + f.line : ''}
Description: ${f.description}
Evidence claimed: ${f.evidence}
Recommendation: ${f.recommendation}

Rules:
- Open the cited files at the cited lines. Verify the quoted code exists and behaves as claimed. Grep the whole wallet-lib worktree for handling the reviewer may have missed (validation may live elsewhere — utils, zod schemas, callers).
- For "missing feature/test" claims: search exhaustively before confirming (the thing may exist under another name).
- Check the source-of-truth side too: does hathor-core/ct-crypto actually require/forbid what the finding assumes? Where RFC and core diverge, core wins.
- isReal=true only if the finding survives your attack with concrete evidence; isReal=false requires the exact file:line that disproves it. If evidence is ambiguous, set confidence accordingly and explain.
- Suggest adjustedSeverity if the stated severity is wrong in either direction.`
}

function writerPrompt(v) {
  const f = v.f
  const notes = v.votes.map(x => x.notes).join(' | ')
  return `${CTX}\n\nYou are the report writer for ONE confirmed review finding about the wallet-lib shielded outputs integration. Re-read the relevant code yourself to make the write-up precise and self-contained, then Write EXACTLY ONE file:

Path: ${REVIEW_DIR}/${f.id}-<slug>.md   (derive <slug> from the title: lowercase, hyphens, max ~6 words)

FINDING ${f.id} [${f.severity}] ${f.title}
File: ${f.file}${f.line ? ':' + f.line : ''}
Description: ${f.description}
Evidence: ${f.evidence}
Recommendation: ${f.recommendation}
Verifier notes: ${notes}

File structure (markdown):
# ${f.id}: ${f.title}
**Severity:** ${f.severity} - **Status:** confirmed by adversarial review
## Summary  (2-4 sentences, plain language)
## Location  (wallet-lib file:line list, repo-relative paths like src/...)
## Details  (full technical explanation; include the relevant wallet-lib code excerpts)
## Source of truth  (what hathor-core / ct-crypto / the client guide requires, with file:line cited as hathor-core:path:line)
## Impact  (concrete scenario: who is affected, what goes wrong)
## Recommendation  (specific fix, with sketch if short)
## Verification notes  (how the skeptic panel confirmed it)

Important: inside the report body cite wallet-lib paths repo-relative (src/..., __tests__/...), not the /tmp worktree path. Return {path} via StructuredOutput when done.`
}

async function verifyFinding(f) {
  const heavy = f.severity === 'critical' || f.severity === 'high'
  const lenses = heavy
    ? ['code correctness — does the wallet-lib code really behave as claimed',
       'source of truth — does hathor-core/ct-crypto actually require what the finding assumes',
       'impact — is there a realistic concrete scenario justifying the severity']
    : ['code correctness and source-of-truth agreement']
  const votes = (await parallel(lenses.map((lens, i) => () =>
    agent(skepticPrompt(f, lens), { label: `verify:${f.id}` + (lenses.length > 1 ? '#' + (i + 1) : ''), phase: 'Verify', schema: VERDICT })
  ))).filter(Boolean)
  if (!votes.length) return { f, confirmed: false, votes: [], reason: 'all verifiers failed' }
  const real = votes.filter(v => v.isReal).length
  const confirmed = real * 2 > votes.length
  let severity = f.severity
  const adj = votes.filter(v => v.isReal && v.adjustedSeverity).map(v => v.adjustedSeverity)
  if (confirmed && adj.length) {
    adj.sort((a, b) => SEV_RANK[a] - SEV_RANK[b])
    severity = adj[Math.floor((adj.length - 1) / 2)]
  }
  let reason = ''
  if (!confirmed) {
    const refuter = votes.find(v => !v.isReal)
    reason = refuter ? refuter.notes.slice(0, 400) : 'majority refuted'
  }
  return { f: Object.assign({}, f, { severity: severity }), confirmed, votes, reason }
}

async function reviewVerifyWrite(d) {
  const rev = await agent(reviewPrompt(d), { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS })
  const findings = ((rev && rev.findings) || []).slice(0, 12)
  log(`${d.key}: ${findings.length} candidate findings`)
  const verified = (await parallel(findings.map(f => () =>
    verifyFinding(Object.assign({}, f, { id: f.id.indexOf(d.prefix) === 0 ? f.id : d.prefix + '-' + f.id }))
  ))).filter(Boolean)
  const confirmed = verified.filter(v => v.confirmed)
  log(`${d.key}: ${confirmed.length}/${findings.length} confirmed after adversarial verification`)
  const written = (await parallel(confirmed.map(v => () =>
    agent(writerPrompt(v), { label: `write:${v.f.id}`, phase: 'Write', schema: WRITTEN })
      .then(w => ({ id: v.f.id, title: v.f.title, severity: v.f.severity, file: v.f.file, path: w && w.path }))
  ))).filter(Boolean)
  return {
    dimension: d.key,
    confirmed: written,
    rejected: verified.filter(v => !v.confirmed).map(v => ({ id: v.f.id, title: v.f.title, reason: v.reason })),
  }
}

const results = (await parallel(DIMENSIONS.map(d => () => reviewVerifyWrite(d)))).filter(Boolean)

// ---------- Phase 5: completeness critic + synthesis ----------
phase('Synthesize')
const allConfirmed = []
const allRejected = []
for (const r of results) {
  allConfirmed.push(...r.confirmed)
  allRejected.push(...r.rejected)
}
log(`Total confirmed: ${allConfirmed.length}; rejected: ${allRejected.length}. Running completeness critic.`)

const confirmedList = allConfirmed.map(f => `- ${f.id} [${f.severity}] ${f.title} (${f.file})`).join('\n')
const critic = await agent(`${CTX}\n${GT}\n\nYou are the completeness critic for a finished multi-agent review of the wallet-lib shielded integration. Confirmed findings so far:\n${confirmedList}\n\nCompare against the reference checklist (${REVIEW_DIR}/reference/client-guide-checklist.md), the ground truth above, and the user's five review questions (feature completeness, correctness, corner cases, test coverage, security). Identify up to 3 IMPORTANT areas the review plausibly under-covered (be specific: which files/rules were never examined). Only name an area if you verify by reading code that there is genuine uncovered risk there — do a quick spot check yourself. If coverage looks adequate, return an empty areas array. Each charter should be a focused reviewer instruction (like a mini review charter).`,
  { label: 'critic', phase: 'Synthesize', schema: CRITIC_SCHEMA })

let gapResults = []
if (critic && critic.areas && critic.areas.length) {
  log(`Critic found ${critic.areas.length} under-covered areas; running follow-up reviewers`)
  gapResults = (await parallel(critic.areas.map((a, i) => () =>
    reviewVerifyWrite({ key: 'gap-' + a.key, prefix: 'GAP' + (i + 1), charter: a.charter })
  ))).filter(Boolean)
}
const finalConfirmed = allConfirmed.slice()
const finalRejected = allRejected.slice()
for (const r of gapResults) {
  finalConfirmed.push(...r.confirmed)
  finalRejected.push(...r.rejected)
}

const finalList = finalConfirmed.map(f => `- ${f.id} [${f.severity}] ${f.title} -> ${f.path || 'unknown path'}`).join('\n')
const rejectedList = finalRejected.map(f => `${f.id}: ${f.title} (refuted: ${f.reason})`).join('\n') || 'none'
const synthesis = await agent(`${CTX}\n\nYou are the synthesis editor. The findings folder ${REVIEW_DIR} now contains one markdown file per confirmed finding (plus reference/). Confirmed list:\n${finalList}\n\nRejected during adversarial verification (for the record):\n${rejectedList}\n\nTasks:
1. Read every finding file in ${REVIEW_DIR} (not reference/). Identify DUPLICATES (same root cause found by different reviewers). Merge each duplicate set: keep the best-written file, fold any unique evidence from the others into it (add an 'Also reported as' line), and DELETE the redundant files.
2. The repo root has pre-existing TODO_FIX_*.md files from earlier PR-stack reviews (/Users/pedroferreira/Hathor/hathor-wallet-lib/TODO_FIX_*.md). Where a finding matches one, add a cross-reference line in the finding file ('Previously tracked in TODO_FIX_NN').
3. Write ${REVIEW_DIR}/README.md containing: title; one-paragraph overall verdict; explicit answers to the five review questions (1 feature completeness, 2 correctness, 3 corner cases, 4 test coverage, 5 security) each summarizing the relevant findings; a findings table sorted by severity (ID | Severity | Title | File) where ID links to the finding file; a 'Rejected candidates' section listing rejected ones with one-line reasons; and a short 'How this review was produced' note (multi-agent: ground truth from hathor-core alpha-v4, 7 reviewer dimensions + gap round, adversarial 1-3 skeptic verification per finding).
4. Return as your final message: final counts by severity, the 5 most important findings (id + title + one line each), and the verdict paragraph.`,
  { label: 'synthesis', phase: 'Synthesize' })

return {
  confirmedCount: finalConfirmed.length,
  rejectedCount: finalRejected.length,
  confirmed: finalConfirmed,
  rejected: finalRejected,
  synthesis,
}
