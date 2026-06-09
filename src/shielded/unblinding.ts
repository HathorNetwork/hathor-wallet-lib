/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Canonical encoder for the explorer-side unblinding URL fragment.
 *
 * Three independent consumers historically shipped their own copy of
 * this encoder (hathor-wallet-mobile's `AuditUnblindingRows`,
 * shielded-outputs-audit's `bigintJson.ts`, and an earlier draft in
 * hathor-wallet-headless's `shielded.controller`). The explorer
 * parser at hathor-explorer/src/utils/unblinding.js requires the
 * format to be byte-for-byte identical across producers, so keeping
 * three copies in lockstep was bound to drift. This module is the
 * single source of truth — every consumer should call this function
 * rather than re-implementing the envelope.
 *
 * Wire schema (versioned so we can evolve without a flag day):
 *
 *   {
 *     v: 1,
 *     txId: <hex tx id>,
 *     outputs: [{index, value: <stringified bigint>, token, vbf, abf?}, ...],
 *     inputs?:  [{index, value: <stringified bigint>, token, vbf, abf?}, ...],
 *   }
 *
 * Notes that the explorer parser relies on:
 *   - `value` is stringified because JSON.stringify can't serialize a
 *     bigint natively; the parser revives it via BigInt(...).
 *   - `inputs` is omitted from the JSON when empty (not emitted as
 *     `inputs: []`) so output-only payloads stay byte-identical to the
 *     original v=1 shape some explorer builds may still expect.
 *   - The envelope is encoded as URL-fragment-safe base64
 *     (RFC 4648 §5 — `+`→`-`, `/`→`_`, no `=` padding) so it can be
 *     dropped into `…/transaction/<txId>#unblind=<envelope>` directly.
 */

/**
 * One per-output (or per-input) opening entry the wallet shares for
 * audit / explorer verification.
 */
export interface IShieldedUnblindingEntry {
  /** On-chain absolute index of the output (or input position). */
  index: number;
  /** Plaintext value. */
  value: bigint;
  /** Token UID as lowercase hex (32 bytes / 64 chars). */
  token: string;
  /** Value blinding factor as lowercase hex (32 bytes / 64 chars). */
  vbf: string;
  /** Asset blinding factor — only present on FullShielded entries. */
  abf?: string;
}

/**
 * Encode an unblinding payload into the URL-fragment shape the
 * explorer expects at `#unblind=<base64url>`.
 *
 * Returns an empty string when both `outputs` and `inputs` are empty
 * — there is nothing to unblind, so callers should treat the empty
 * return as "do not surface an explorer link". (Returning `null`
 * would have been an alternative but `string` keeps the return type
 * uniform and the caller's `.length === 0` check trivial.)
 *
 * @param txId   tx id the openings belong to (echoed into the envelope so the parser can pin which tx the payload is for)
 * @param outputs opening entries for this tx's shielded outputs
 * @param inputs  opening entries for this tx's shielded inputs whose parent the wallet owns
 */
export function encodeShieldedUnblindingPayload(
  txId: string,
  outputs: IShieldedUnblindingEntry[],
  inputs: IShieldedUnblindingEntry[]
): string {
  if (outputs.length === 0 && inputs.length === 0) return '';

  const envelope = {
    v: 1,
    txId,
    outputs: outputs.map(encodeEntry),
    // Match every existing producer's wire form — only emit `inputs`
    // when non-empty so output-only payloads stay byte-identical to
    // the original v=1 shape.
    ...(inputs.length > 0 ? { inputs: inputs.map(encodeEntry) } : {}),
  };
  return base64url(JSON.stringify(envelope));
}

function encodeEntry(e: IShieldedUnblindingEntry): {
  index: number;
  value: string;
  token: string;
  vbf: string;
  abf?: string;
} {
  return {
    index: e.index,
    value: e.value.toString(),
    token: e.token,
    vbf: e.vbf,
    ...(e.abf ? { abf: e.abf } : {}),
  };
}

/**
 * URL-fragment-safe base64 (RFC 4648 §5): `+`→`-`, `/`→`_`, strip `=`
 * padding. Matches the explorer parser's
 * `hathor-explorer/src/utils/unblinding.js` decoder byte-for-byte.
 */
function base64url(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
