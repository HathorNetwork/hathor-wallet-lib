/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { z } from 'zod';
export declare const addressHistorySchema: z.ZodDiscriminatedUnion<"success", [z.ZodObject<{
    success: z.ZodLiteral<true>;
    history: z.ZodArray<import("../../utils/bigint").ZodSchema<import("../../types").IHistoryTx>, "many">;
    has_more: z.ZodBoolean;
    first_hash: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    first_address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    success: z.ZodLiteral<true>;
    history: z.ZodArray<import("../../utils/bigint").ZodSchema<import("../../types").IHistoryTx>, "many">;
    has_more: z.ZodBoolean;
    first_hash: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    first_address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    success: z.ZodLiteral<true>;
    history: z.ZodArray<import("../../utils/bigint").ZodSchema<import("../../types").IHistoryTx>, "many">;
    has_more: z.ZodBoolean;
    first_hash: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    first_address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{
    success: z.ZodLiteral<false>;
    message: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    success: z.ZodLiteral<false>;
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    success: z.ZodLiteral<false>;
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">>]>;
export type AddressHistorySchema = z.infer<typeof addressHistorySchema>;
export declare const mintMeltUtxoSchema: z.ZodObject<{
    tx_id: z.ZodString;
    index: z.ZodNumber;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    tx_id: z.ZodString;
    index: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    tx_id: z.ZodString;
    index: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">>;
export declare const generalTokenInfoSchema: z.ZodDiscriminatedUnion<"success", [z.ZodObject<{
    success: z.ZodLiteral<true>;
    name: z.ZodString;
    symbol: z.ZodString;
    mint: z.ZodArray<z.ZodObject<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    melt: z.ZodArray<z.ZodObject<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    total: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
    transactions_count: z.ZodNumber;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    success: z.ZodLiteral<true>;
    name: z.ZodString;
    symbol: z.ZodString;
    mint: z.ZodArray<z.ZodObject<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    melt: z.ZodArray<z.ZodObject<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    total: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
    transactions_count: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    success: z.ZodLiteral<true>;
    name: z.ZodString;
    symbol: z.ZodString;
    mint: z.ZodArray<z.ZodObject<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    melt: z.ZodArray<z.ZodObject<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tx_id: z.ZodString;
        index: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    total: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
    transactions_count: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{
    success: z.ZodLiteral<false>;
    message: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    success: z.ZodLiteral<false>;
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    success: z.ZodLiteral<false>;
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">>]>;
export type GeneralTokenInfoSchema = z.infer<typeof generalTokenInfoSchema>;
//# sourceMappingURL=wallet.d.ts.map