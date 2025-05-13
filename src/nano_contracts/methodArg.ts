/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import {
  NanoContractArgumentSingleType,
  NanoContractArgumentType,
  NanoContractParsedArgument,
  NanoContractRawSignedData,
  NanoContractSignedData,
  BufferROExtract,
  NanoContractArgumentApiInputType,
  NanoContractArgumentApiInputSchema,
} from './types';
import Serializer from './serializer';
import Deserializer from './deserializer';
import { getContainerInternalType, getContainerType } from './utils';
import Address from '../models/address';

/**
 * Refinement method meant to validate, parse and return the transformed type.
 * User input will be parsed, validated and converted to the actual internal TS type.
 * Issues are added to the context so zod can show parse errors safely.
 */
function refineSingleValue(
  ctx: z.RefinementCtx,
  inputVal: NanoContractArgumentApiInputType,
  type: string
) {
  if (['int', 'Timestamp'].includes(type)) {
    const parse = z.coerce.number().safeParse(inputVal);
    if (!parse.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value is invalid ${type}: ${parse.error}`,
        fatal: true,
      });
    } else {
      return parse.data;
    }
  } else if (type === 'VarInt') {
    const parse = z.coerce.bigint().safeParse(inputVal);
    if (!parse.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value is invalid VarInt: ${parse.error}`,
        fatal: true,
      });
    } else {
      return parse.data;
    }
  } else if (
    ['bytes', 'BlueprintId', 'ContractId', 'TokenUid', 'TxOutputScript', 'VertexId'].includes(type)
  ) {
    const parse = z
      .string()
      .regex(/[0-9A-Fa-f]+/g)
      .transform(val => Buffer.from(val, 'hex'))
      .safeParse(inputVal);
    if (!parse.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value is invalid ${type}: ${parse.error}`,
        fatal: true,
      });
    } else {
      return parse.data;
    }
  } else if (type === 'bool') {
    const parse = z
      .boolean()
      .or(z.union([z.literal('true'), z.literal('false')]).transform(val => val === 'true'))
      .safeParse(inputVal);
    if (!parse.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value is invalid bool: ${parse.error}`,
        fatal: true,
      });
    } else {
      return parse.data;
    }
  } else if (type === 'str') {
    const parse = z.string().safeParse(inputVal);
    if (!parse.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value is invalid str: ${parse.error}`,
        fatal: true,
      });
    } else {
      return parse.data;
    }
  } else if (type === 'Address') {
    const parse = z.string().safeParse(inputVal);
    if (!parse.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value is invalid Address: ${parse.error}`,
        fatal: true,
      });
    } else {
      const address = new Address(parse.data);
      try {
        address.validateAddress({ skipNetwork: true });
        return parse.data;
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Value is invalid Address: ${err instanceof Error ? err.message : String(err)}`,
          fatal: true,
        });
      }
    }
  } else {
    // No known types match the given type
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Type(${type}) is not supported as a 'single' type`,
      fatal: true,
    });
  }

  // Meant to keep the typing correct
  return z.NEVER;
}

/**
 * Type and value validation for non-container types.
 * Returns the internal TS type for the argument given.
 */
const SingleValueApiInputScheme = z
  .tuple([
    z.string(), // type
    NanoContractArgumentApiInputSchema, // value
  ])
  .transform((value, ctx) => {
    return refineSingleValue(ctx, value[1], value[0]);
  });

/**
 * Type and value validation for Optional types.
 * Returns the internal TS type for the argument given.
 */
const OptionalApiInputScheme = z
  .tuple([
    z.string(), // Inner type
    NanoContractArgumentApiInputSchema, // value
  ])
  .transform((value, ctx) => {
    const parse = z.null().safeParse(value[1]);
    if (parse.success) {
      return parse.data;
    }
    // value is not null, should transform based on the type
    return refineSingleValue(ctx, value[1], value[0]);
  });

/**
 * Type and value validation for SignedData types.
 * returns an instance of NanoContractSignedData
 */
const SignedDataApiInputScheme = z
  .string()
  .transform(value => value.split(','))
  .pipe(
    z.tuple([
      z.string().regex(/[0-9A-Fa-f]+/g),
      z.string().regex(/[0-9A-Fa-f]+/g),
      z.string(),
      z.string(),
    ])
  )
  .transform((value, ctx) => {
    const signature = Buffer.from(value[0], 'hex');
    const ncID = Buffer.from(value[1], 'hex');
    const type = value[3];
    const refinedValue = refineSingleValue(ctx, value[2], type);
    const ret: NanoContractSignedData = {
      signature,
      type,
      value: [ncID, refinedValue],
    };
    return ret;
  });

/**
 * Type and value validation for RawSignedData types.
 * returns an instance of NanoContractRawSignedData
 */
const RawSignedDataApiInputScheme = z
  .string()
  .transform(value => value.split(','))
  .pipe(z.tuple([z.string().regex(/[0-9A-Fa-f]+/g), z.string(), z.string()]))
  .transform((value, ctx) => {
    const signature = Buffer.from(value[0], 'hex');
    const type = value[2];
    const refinedValue = refineSingleValue(ctx, value[1], type);
    const ret: NanoContractRawSignedData = {
      signature,
      type,
      value: refinedValue,
    };
    return ret;
  });

export class NanoContractMethodArgument {
  name: string;

  type: string;

  value: NanoContractArgumentType;

  _serialized: Buffer;

  constructor(name: string, type: string, value: NanoContractArgumentType) {
    this.name = name;
    this.type = type;
    this.value = value;
    this._serialized = Buffer.alloc(0);
  }

  serialize(serializer: Serializer): Buffer {
    if (this._serialized.length === 0) {
      this._serialized = serializer.serializeFromType(this.value, this.type);
    }

    return this._serialized;
  }

  static fromSerialized(
    name: string,
    type: string,
    buf: Buffer,
    deserializer: Deserializer
  ): BufferROExtract<NanoContractMethodArgument> {
    const parseResult = deserializer.deserializeFromType(buf, type);
    return {
      value: new NanoContractMethodArgument(name, type, parseResult.value),
      bytesRead: parseResult.bytesRead,
    };
  }

  /**
   * User input and api serialized input may not be encoded in the actual value type.
   *
   * ## SignedData
   * We expect the value as a string separated by comma (,) with 4 elements
   * (signature, ncID, value, type)
   * Since the value is encoded as a string some special cases apply:
   * - bool: 'true' or 'false'.
   * - bytes (and any bytes encoded value): hex encoded string of the byte value.
   *
   * While the value should be the NanoContractSignedDataSchema
   *
   * ## RawSignedData
   * We expect the value as a string separated by comma (,) with 3 elements
   * (signature, value, type)
   *
   * While the value should be the NanoContractRawSignedDataSchema
   */
  static fromApiInput(
    name: string,
    type: string,
    value: NanoContractArgumentApiInputType
  ): NanoContractMethodArgument {
    const isContainerType = getContainerType(type) !== null;
    if (isContainerType) {
      const [containerType, innerType] = getContainerInternalType(type);
      if (containerType === 'SignedData') {
        // Parse string SignedData into NanoContractSignedData
        const data = SignedDataApiInputScheme.parse(value);
        if (data.type !== innerType.trim()) {
          throw new Error();
        }
        return new NanoContractMethodArgument(name, type, data);
      }
      if (containerType === 'RawSignedData') {
        // Parse string RawSignedData into NanoContractRawSignedData
        const data = RawSignedDataApiInputScheme.parse(value);
        return new NanoContractMethodArgument(name, type, data);
      }
      if (containerType === 'Optional') {
        const data = OptionalApiInputScheme.parse([innerType, value]);
        return new NanoContractMethodArgument(name, type, data);
      }
      // XXX: add special case for Tuple

      throw new Error(`ContainerType(${containerType}) is not supported as api input.`);
    }
    // This is a single value type and should
    const data = SingleValueApiInputScheme.parse([type, value]);
    return new NanoContractMethodArgument(name, type, data);
  }

  toApiInput(): NanoContractParsedArgument {
    function prepSingleValue(type: string, value: NanoContractArgumentSingleType) {
      if (type === 'bool') {
        return (value as boolean) ? 'true' : 'false';
      }
      if (
        ['bytes', 'BlueprintId', 'ContractId', 'TokenUid', 'TxOutputScript', 'VertexId'].includes(
          type
        )
      ) {
        return (value as Buffer).toString('hex');
      }
      if (type === 'VarInt') {
        return String(value as bigint);
      }
      return value;
    }

    if (this.type.startsWith('SignedData')) {
      const data = this.value as NanoContractSignedData;
      return {
        name: this.name,
        type: this.type,
        parsed: [
          data.signature.toString('hex'),
          data.value[0].toString('hex'),
          prepSingleValue(data.type, data.value[1]),
          this.type,
        ].join(','),
      };
    }

    if (this.type.startsWith('RawSignedData')) {
      const data = this.value as NanoContractRawSignedData;
      return {
        name: this.name,
        type: this.type,
        parsed: [
          data.signature.toString('hex'),
          prepSingleValue(data.type, data.value),
          this.type,
        ].join(','),
      };
    }

    return {
      name: this.name,
      type: this.type,
      parsed: prepSingleValue(this.type, this.value as NanoContractArgumentSingleType),
    };
  }
}
