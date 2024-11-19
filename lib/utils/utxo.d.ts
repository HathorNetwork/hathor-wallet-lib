/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IStorage, IUtxo, OutputValueType, UtxoSelectionAlgorithm } from '../types';
export declare enum UtxoSelection {
    FAST = "fast",
    BEST = "best"
}
/**
 * Get the algorithm function from the enum value.
 *
 * @param algorithm The algorithm to get
 * @returns {UtxoSelectionAlgorithm} The algorithm function
 */
export declare function getAlgorithmFromEnum(algorithm: UtxoSelection): UtxoSelectionAlgorithm;
/**
 * Select utxos to fill the amount required.
 * This method should be faster since it stops the iteration once the target amount is reached.
 * Obs: Does not work with authority utxos.
 *
 * @param {IStorage} storage The wallet storage to select the utxos
 * @param {string} token The token uid to select the utxos
 * @param {OutputValueType} amount The target amount of tokens required
 * @returns {Promise<{ utxos: IUtxo[], amount: OutputValueType, available?: OutputValueType }>}
 */
export declare function fastUtxoSelection(storage: IStorage, token: string, amount: OutputValueType): Promise<{
    utxos: IUtxo[];
    amount: OutputValueType;
    available?: OutputValueType;
}>;
/**
 * Select utxos to fill the amount required.
 * This method will select the smallest utxos that are bigger than the amount required.
 * Obs: this will iterate on all available utxos to choose the best suited selection.
 * Obs: Does not work with authority utxos.
 *
 * @param {IStorage} storage The wallet storage to select the utxos
 * @param {string} token The token uid to select the utxos
 * @param {OutputValueType} amount The target amount of tokens required
 * @returns {Promise<{ utxos: IUtxo[], amount: OutputValueType, available?: OutputValueType }>}
 */
export declare function bestUtxoSelection(storage: IStorage, token: string, amount: OutputValueType): Promise<{
    utxos: IUtxo[];
    amount: OutputValueType;
    available?: OutputValueType;
}>;
//# sourceMappingURL=utxo.d.ts.map