/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import ncFields, { NCFieldBase } from '../fields';
import Network from '../../models/network';
import { ILogger } from '../../types';

const simpleTypes = z.enum([
  'str',
  'int',
  'bool',
  'Address',
  'Timestamp',
  'Amount',
  'TokenUid',

  // bytes
  'bytes',
  'TxOutputScript',

  'BlueprintId',
  'ContractId',
  'VertexId',
]);

type TypeNode =
  | { kind: 'simple'; name: string } // e.g., str, int, bytes
  | { kind: 'optional'; inner: TypeNode } // e.g., Optional[str]
  | { kind: 'raw_signed_data'; inner: TypeNode; subtype: string } // e.g., RawSignedData[str]
  | { kind: 'signed_data'; inner: TypeNode; subtype: string } // e.g., SignedData[str]
  | { kind: 'dict'; key: TypeNode; value: TypeNode } // e.g., Dict[str, int]
  | { kind: 'tuple'; elements: TypeNode[] } // e.g., Tuple[int, str]
  | { kind: 'list'; element: TypeNode } // e.g., list[int]
  | { kind: 'set'; element: TypeNode } // e.g., Set[int];
  | { kind: 'deque'; element: TypeNode } // e.g., Deque[int];
  | { kind: 'frozenset'; element: TypeNode }; // e.g., frozenset[int];

export function getFieldParser(typeStr: string, network: Network, logger?: ILogger) {
  const type = parseTypeString(typeStr);
  logger?.debug(`[nc type] type parsed: ${JSON.stringify(type)}`);
  return fieldFromTypeNode(type, network);
}

/**
 * Convert the TypeNode into a NCField which can be used to (de)serialize nano contract arguments.
 */
function fieldFromTypeNode(type: TypeNode, network: Network, logger?: ILogger): NCFieldBase {
  switch (type.kind) {
    case 'simple':
      logger?.debug(`[nc type] simple field: ${type.name}`);
      switch (type.name) {
        case 'str':
          return ncFields.StrField.new();
        case 'int':
          return ncFields.IntField.new();
        case 'bool':
          return ncFields.BoolField.new();
        case 'Address':
          return ncFields.AddressField.new(network);
        case 'Timestamp':
          return ncFields.TimestampField.new();
        case 'Amount':
          return ncFields.AmountField.new();
        case 'TokenUid':
          return ncFields.TokenUidField.new();
        case 'bytes':
          return ncFields.BytesField.new();
        case 'TxOutputScript':
          return ncFields.TxOutputScriptField.new();
        case 'BlueprintId':
          return ncFields.BlueprintIdField.new();
        case 'ContractId':
          return ncFields.ContractIdField.new();
        case 'VertexId':
          return ncFields.VertexIdField.new();
        default:
          throw new Error('Invalid simple type');
      }
    case 'optional':
      logger?.debug(`[nc type] field: optional`);
      return ncFields.OptionalField.new(fieldFromTypeNode(type.inner, network));
    case 'tuple':
      logger?.debug(`[nc type] field: tuple`);
      return ncFields.TupleField.new(type.elements.map(el => fieldFromTypeNode(el, network)));
    case 'signed_data':
      logger?.debug(`[nc type] field: signed_data`);
      return ncFields.SignedDataField.new(fieldFromTypeNode(type.inner, network), type.subtype);
    case 'raw_signed_data':
      logger?.debug(`[nc type] field: raw_signed_data`);
      return ncFields.RawSignedDataField.new(fieldFromTypeNode(type.inner, network), type.subtype);
    case 'dict':
      return ncFields.DictField.new(fieldFromTypeNode(type.key, network), fieldFromTypeNode(type.value, network));
    case 'list':
      return ncFields.ListField.new(fieldFromTypeNode(type.element, network));
    case 'set':
      return ncFields.SetField.new(fieldFromTypeNode(type.element, network));
    case 'deque':
      return ncFields.DequeField.new(fieldFromTypeNode(type.element, network));
    case 'frozenset':
      return ncFields.FrozenSetField.new(fieldFromTypeNode(type.element, network));
    default:
      logger?.error(`[nc type] could not identify: ${JSON.stringify(type)}`);
      throw new Error('Unsupported TypeNode');
  }
}

/**
 * Parse a type string into a parsed TypeNode.
 * The TypeNode is used to understand the structure of the type.
 *
 * @example
 * ```ts
 * // { kind: 'tuple', elements: [ {kind: 'simple', name: 'Address'}, {kind: 'simple', name: 'Amount'} ]}
 * const type1 = parseTypeString('Tuple[Address, Amount]');
 *
 * // { kind: 'simple', name: 'TxOutputScript' }
 * const type2 = parseTypeString('TxOutputScript');
 *
 * // { kind: 'dict', key: {kind: 'simple', name: 'Address'}, value: {kind: 'simple', name: 'Amount'} }
 * const type3 = parseTypeString('Dict[Address, Amount]');
 * ```
 */
function parseTypeString(typeStrIn: string): TypeNode {
  // Remove whitespace and normalize
  const typeStr = typeStrIn.trim();

  // Base case: simple types
  const simple = simpleTypes.safeParse(typeStr);
  if (simple.success) {
    return { kind: 'simple', name: simple.data };
  }

  // Handle optional `type?`
  if (typeStr.endsWith('?')) {
    const innerStr = typeStr.slice(0, -1); // Remove trailing '?'
    return { kind: 'optional', inner: parseTypeString(innerStr) };
  }

  // Handle container type `Type[...]`

  const match = typeStr.match(/^(.*?)\[(.*)\]/);
  if (match === null) {
    throw new Error(`Unsupported type: ${typeStr}`);
  }
  const containerType = match[1].trim();
  const innerTypeStr = match[2].trim();

  if (containerType === 'SignedData') {
    return {
      kind: 'signed_data',
      inner: parseTypeString(innerTypeStr),
      subtype: innerTypeStr,
    };
  }

  if (containerType === 'RawSignedData') {
    return {
      kind: 'raw_signed_data',
      inner: parseTypeString(innerTypeStr),
      subtype: innerTypeStr,
    };
  }

  // Handles Dict and dict
  if (containerType.toLowerCase() === 'dict') {
    const [keyStr, valueStr] = splitTopLevel(innerTypeStr, ',');
    return {
      kind: 'dict',
      key: parseTypeString(keyStr),
      value: parseTypeString(valueStr),
    };
  }

  // handles Tuple and tuple
  if (containerType.toLowerCase() === 'tuple') {
    const elements = splitTopLevel(innerTypeStr, ',').map(s => parseTypeString(s));
    return { kind: 'tuple', elements };
  }

  if (containerType.toLowerCase() === 'list') {
    return { kind: 'list', element: parseTypeString(innerTypeStr) };
  }

  if (containerType.toLowerCase() === 'set') {
    return { kind: 'set', element: parseTypeString(innerTypeStr) };
  }

  if (containerType.toLowerCase() === 'deque') {
    return { kind: 'deque', element: parseTypeString(innerTypeStr) };
  }

  if (containerType.toLowerCase() === 'frozenset') {
    return { kind: 'frozenset', element: parseTypeString(innerTypeStr) };
  }

  throw new Error(`Unsupported type: ${typeStr}`);
}

/**
 * Helper function to split top-level comma-separated elements
 * respecting nested brackets boundaries.
 *
 * @example
 * ```ts
 * // [ 'Tuple[str?, int]', 'int', 'Dict[str, Set[int]]?' ]
 * splitTopLevel('Tuple[str?, int], int, Dict[str, Set[int]]?');
 * ```
 */
function splitTopLevel(str: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '[' && (str[i - 1] === undefined || /[a-zA-Z]/.test(str[i - 1]))) {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (char === separator && bracketDepth === 0) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result;
}
