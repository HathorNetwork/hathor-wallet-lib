# RFC #104 — Shielded Outputs (summary)

Source: https://github.com/HathorNetwork/rfcs/pull/104 (branch `feat/shielded-outputs`, file `text/0000-shielded-outputs.md`)

NOTE: The RFC and hathor-core code may diverge. The hathor-core branch `experimental/shielded-outputs-alpha-v4` is the source of truth that the wallet-lib must follow.

## Design
- Two output types: **AmountShieldedOutput** (hides amount, reveals recipient/token) and **FullShieldedOutput** (hides amount + token).
- New headers for mint/melt operations: **MintHeader** (public token-creation entries binding into balance verification) and **MeltHeader** (transparent (token_index, amount) pairs for redemption).
- Crypto: Pedersen commitments, Bulletproof range proofs (prevent negative values), blinding factors, per-output ephemeral keypairs `(e, E = e*G)` for ECDH-based key derivation.
- Shielded address format: `scan_pubkey(33) || hash(spend_pubkey)(20)` — compact; full spend pubkey retrieved out-of-band or from chain for some operations.
- Wallet-side rule (protocol enforcement deferred): when all inputs are transparent, the wallet must ensure at least 2 shielded outputs (or include a transparent output) to avoid trivially revealing the shielded amount.
- Sender requirements: choose privacy tier per output, generate ephemeral keypairs, coordinate key material with receivers.
- Token reference disclosure: token version always visible to verifiers (needed for deposit/fee logic); amount visibility per tier.
