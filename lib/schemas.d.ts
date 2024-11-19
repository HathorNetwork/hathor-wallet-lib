/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { IAddressMetadataAsRecord, IAuthoritiesBalance, IBalance, IHistoryInput, IHistoryOutput, IHistoryOutputDecoded, IHistoryTx, ILockedUtxo, ITokenBalance, ITokenMetadata, IUtxo } from './types';
import { ZodSchema } from './utils/bigint';
export declare const ITokenBalanceSchema: ZodSchema<ITokenBalance>;
export declare const IAuthoritiesBalanceSchema: ZodSchema<IAuthoritiesBalance>;
export declare const IBalanceSchema: ZodSchema<IBalance>;
export declare const IAddressMetadataAsRecordSchema: ZodSchema<IAddressMetadataAsRecord>;
export declare const ITokenMetadataSchema: ZodSchema<ITokenMetadata>;
export declare const IHistoryOutputDecodedSchema: ZodSchema<IHistoryOutputDecoded>;
export declare const IHistoryInputSchema: ZodSchema<IHistoryInput>;
export declare const IHistoryOutputSchema: ZodSchema<IHistoryOutput>;
export declare const IHistoryTxSchema: ZodSchema<IHistoryTx>;
export declare const IUtxoSchema: ZodSchema<IUtxo>;
export declare const ILockedUtxoSchema: ZodSchema<ILockedUtxo>;
//# sourceMappingURL=schemas.d.ts.map