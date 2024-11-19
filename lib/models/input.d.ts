/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
type optionsType = {
    data?: Buffer | null | undefined;
};
declare class Input {
    hash: string;
    index: number;
    data: Buffer | null;
    constructor(hash: string, index: number, options?: optionsType);
    /**
     * Serialize an input to bytes
     *
     * @param {boolean} addData If should add the input data to the serialization
     * The data is not used to sign/verify the transaction (see https://github.com/HathorNetwork/rfcs/blob/master/text/0015-anatomy-of-tx.md)
     * thus it's important to have this parameter and not add the data to serialization when getting the transaction data to sign
     *
     * @return {Buffer[]}
     * @memberof Input
     * @inner
     */
    serialize(addData?: boolean): Buffer[];
    setData(data: Buffer): void;
    /**
     * Create input object from bytes
     *
     * @param {Buffer} buf Buffer with bytes to get input fields
     *
     * @return {[Input, Buffer]} Created input and rest of buffer bytes
     * @memberof Input
     * @static
     * @inner
     */
    static createFromBytes(buf: Buffer): [Input, Buffer];
}
export default Input;
//# sourceMappingURL=input.d.ts.map