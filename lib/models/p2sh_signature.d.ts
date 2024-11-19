/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * This class purpose is serialization/deserialization of signatures from a MultiSig participant
 * The structure of the serialized signature string is:
 * "<pubkey>|<index>:<signature>|<index>:<signature>|..."
 *
 * The `pubkey` is required so we can identify the original signer (and his position on the redeemScript)
 * The `<index>:<signature>` pair is the input index and the signature for that input.
 * The signature is formatted to DER and hex encoded.
 *
 * With this information we will be able to encode the signatures for all inputs on one string.
 * It also has all information needed to assemble the input data if you have enough participants' P2SHSignature serialized signatures.
 */
declare class P2SHSignature {
    pubkey: string;
    signatures: Record<number, string>;
    constructor(pubkey: string, signatures: Record<number, string>);
    /**
     * Serialize P2SH signatures
     *
     * @memberof P2SHSignature
     * @inner
     */
    serialize(): string;
    /**
     * Deserialize P2SH signatures
     *
     * @memberof P2SHSignature
     * @static
     */
    static deserialize(p2shSig: string): P2SHSignature;
}
export default P2SHSignature;
//# sourceMappingURL=p2sh_signature.d.ts.map