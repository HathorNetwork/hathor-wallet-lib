/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { z } from 'zod';
export declare const transactionSchema: z.ZodDiscriminatedUnion<"success", [z.ZodObject<{
    success: z.ZodLiteral<true>;
    tx: z.ZodObject<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodObject<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>;
    spent_outputs: z.ZodRecord<z.ZodNumber, z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    success: z.ZodLiteral<true>;
    tx: z.ZodObject<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodObject<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>;
    spent_outputs: z.ZodRecord<z.ZodNumber, z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    success: z.ZodLiteral<true>;
    tx: z.ZodObject<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        hash: z.ZodString;
        nonce: z.ZodString;
        timestamp: z.ZodNumber;
        version: z.ZodNumber;
        weight: z.ZodNumber;
        signal_bits: z.ZodNumber;
        parents: z.ZodArray<z.ZodString, "many">;
        nc_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_method: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_pubkey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_args: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        nc_blueprint_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        inputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodString;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodNumber;
            }, z.ZodTypeAny, "passthrough">>;
            tx_id: z.ZodString;
            index: z.ZodNumber;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        outputs: z.ZodArray<z.ZodObject<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
            token_data: z.ZodNumber;
            script: z.ZodString;
            decoded: z.ZodObject<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                type: z.ZodString;
                address: z.ZodOptional<z.ZodString>;
                timelock: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                value: z.ZodPipeline<z.ZodUnion<[z.ZodUnion<[z.ZodBigInt, z.ZodNumber]>, z.ZodString]>, z.ZodBigInt>;
                token_data: z.ZodOptional<z.ZodNumber>;
            }, z.ZodTypeAny, "passthrough">>;
            token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            spent_by: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        tokens: z.ZodArray<z.ZodObject<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            uid: z.ZodString;
            name: z.ZodNullable<z.ZodString>;
            symbol: z.ZodNullable<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        token_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        token_symbol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        raw: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodObject<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        hash: z.ZodString;
        spent_outputs: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodArray<z.ZodString, "many">], null>, "many">;
        received_by: z.ZodArray<z.ZodString, "many">;
        children: z.ZodArray<z.ZodString, "many">;
        conflict_with: z.ZodArray<z.ZodString, "many">;
        voided_by: z.ZodArray<z.ZodString, "many">;
        twins: z.ZodArray<z.ZodString, "many">;
        accumulated_weight: z.ZodNumber;
        score: z.ZodNumber;
        height: z.ZodNumber;
        min_height: z.ZodNumber;
        feature_activation_bit_counts: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        first_block: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        validation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        first_block_height: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>;
    spent_outputs: z.ZodRecord<z.ZodNumber, z.ZodString>;
}, z.ZodTypeAny, "passthrough">>, z.ZodObject<{
    success: z.ZodLiteral<false>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    success: z.ZodLiteral<false>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    success: z.ZodLiteral<false>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>]>;
export type TransactionSchema = z.infer<typeof transactionSchema>;
//# sourceMappingURL=txApi.d.ts.map