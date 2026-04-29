/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AddressField } from './address';
import { AmountField } from './amount';
import { NCFieldBase } from './base';
import { BoolField } from './bool';
import { BytesField } from './bytes';
import { Bytes32Field } from './bytes32';
import { CallerIdField } from './callerId';
import { CollectionField } from './collection';
import { DictField } from './dict';
import { IntField } from './int';
import { OptionalField } from './optional';
import { SignedDataField } from './signedData';
import { StrField } from './str';
import { TimestampField } from './timestamp';
import { TokenUidField } from './token';
import { TupleField } from './tuple';

export { NCFieldBase } from './base';

export function isSignedDataField(value: NCFieldBase): value is SignedDataField {
  return value.getType() === 'SignedData';
}

export default {
  StrField,
  IntField,
  BoolField,
  AddressField,
  CallerIdField,
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
