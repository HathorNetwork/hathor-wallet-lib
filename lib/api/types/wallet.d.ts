import { z } from 'zod';
export declare const addressHistorySchema: z.ZodDiscriminatedUnion<"success", [z.ZodObject<{
    success: z.ZodLiteral<true>;
    history: z.ZodArray<import("../../zod_schemas").ZodSchema<import("../../types").IHistoryTx>, "many">;
    has_more: z.ZodBoolean;
    first_hash: z.ZodNullable<z.ZodString>;
    first_address: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    success: true;
    history: import("../../types").IHistoryTx[];
    has_more: boolean;
    first_hash: string | null;
    first_address: string | null;
}, {
    success: true;
    history: unknown[];
    has_more: boolean;
    first_hash: string | null;
    first_address: string | null;
}>, z.ZodObject<{
    success: z.ZodLiteral<false>;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    success: false;
}, {
    message: string;
    success: false;
}>]>;
export type AddressHistorySchema = z.infer<typeof addressHistorySchema>;
//# sourceMappingURL=wallet.d.ts.map