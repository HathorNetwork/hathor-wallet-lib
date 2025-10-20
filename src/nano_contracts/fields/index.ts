/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { StrField } from './str';
import { IntField } from './int';
import { BytesField } from './bytes';
import { Bytes32Field } from './bytes32';
import { BoolField } from './bool';
import { AddressField } from './address';
import { TimestampField } from './timestamp';
import { AmountField } from './amount';
import { TokenUidField } from './token';
import { OptionalField } from './optional';
import { TupleField } from './tuple';
import { SignedDataField } from './signedData';
import { NCFieldBase } from './base';
import { DictField } from './dict';
import { CollectionField } from './collection';

export { NCFieldBase } from './base';

export function isSignedDataField(value: NCFieldBase): value is SignedDataField {
  return value.getType() === 'SignedData';
}

export default {
  StrField,
  IntField,
  BoolField,
  AddressField,
  TimestampField,
  AmountField,
  TokenUidField,

  // Bytes fields
  BytesField,
  TxOutputScriptField: BytesField,

  // sized bytes (32)
  VertexIdField: Bytes32Field,
  ContractIdField: Bytes32Field,
  BlueprintIdField: Bytes32Field,

  OptionalField,
  TupleField,
  SignedDataField,
  RawSignedDataField: SignedDataField,
  DictField,
  ListField: CollectionField,
  SetField: CollectionField,
  DequeField: CollectionField,
  FrozenSetField: CollectionField,
};
