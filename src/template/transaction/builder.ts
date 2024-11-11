/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { JSONBigInt } from '../../utils/bigint';
import {
  TxTemplateInstruction,
  TransactionTemplate,
  TransactionTemplateType,
  TxTemplateInstructionType,
  RawInputInstruction,
  UtxoSelectInstruction,
  AuthoritySelectInstruction,
  RawOutputInstruction,
  DataOutputInstruction,
  TokenOutputInstruction,
  AuthorityOutputInstruction,
  ShuffleInstruction,
  ChangeInstruction,
  CompleteTxInstruction,
  ConfigInstruction,
  SetVarInstruction,
} from './instructions';

// Helper schemas to validate the arguments of each command in the builder args
const RawInputInsArgs = RawInputInstruction.omit({ type: true });
const UtxoSelectInsArgs = UtxoSelectInstruction.omit({type: true});
const AuthoritySelectInsArgs = AuthoritySelectInstruction.omit({type: true});
const RawOutputInsArgs = RawOutputInstruction.omit({type: true});
const DataOutputInsArgs = DataOutputInstruction.omit({type: true});
const TokenOutputInsArgs = TokenOutputInstruction.omit({type: true});
const AuthorityOutputInsArgs = AuthorityOutputInstruction.omit({type: true});
const ShuffleInsArgs = ShuffleInstruction.omit({type: true});
const ChangeInsArgs = ChangeInstruction.omit({type: true});
const CompleteTxInsArgs = CompleteTxInstruction.omit({type: true});
const ConfigInsArgs = ConfigInstruction.omit({type: true});
const SetVarInsArgs = SetVarInstruction.omit({type: true});

export class TransactionTemplateBuilder {
  template: TransactionTemplateType;

  constructor() {
    this.template = [];
  }

  static from(instructions: TransactionTemplateType): TransactionTemplateBuilder {
    const parsedTemplate = TransactionTemplate.parse(instructions);
    const tt = new TransactionTemplateBuilder();
    tt.template = parsedTemplate;
    return tt;
  }

  build(): TransactionTemplateType {
    return this.template;
  }

  export(space:number = 2): string {
    return JSONBigInt.stringify(this.template, space);
  }

  addInstruction(ins: TxTemplateInstructionType): TransactionTemplateBuilder {
    this.template.push(TxTemplateInstruction.parse(ins));
    return this;
  }

  addRawInput(ins: z.input<typeof RawInputInsArgs>) {
    const parsedIns = RawInputInstruction.parse({
      type: 'input/raw',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addUtxoSelect(ins: z.input<typeof UtxoSelectInsArgs>) {
    const parsedIns = UtxoSelectInstruction.parse({
      type: 'input/utxo',
      ...ins
    });

    this.template.push(parsedIns);
    return this;
  }

  addAuthoritySelect(ins: z.input<typeof AuthoritySelectInsArgs>) {
    const parsedIns = AuthoritySelectInstruction.parse({
      type: 'input/authority',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addRawOutput(ins: z.input<typeof RawOutputInsArgs>) {
    const parsedIns = RawOutputInstruction.parse({
      type: 'output/raw',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addDataOutput(ins: z.input<typeof DataOutputInsArgs>) {
    const parsedIns = DataOutputInstruction.parse({
      type: 'output/data',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addTokenOutput(ins: z.input<typeof TokenOutputInsArgs>) {
    const parsedIns = TokenOutputInstruction.parse({
      type: 'output/token',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addAuthorityOutput(ins: z.input<typeof AuthorityOutputInsArgs>) {
    const parsedIns = AuthorityOutputInstruction.parse({
      type: 'output/authority',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addShuffleAction(ins: z.input<typeof ShuffleInsArgs>) {
    const parsedIns = ShuffleInstruction.parse({
      type: 'action/shuffle',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addChangeAction(ins: z.input<typeof ChangeInsArgs>) {
    const parsedIns = ChangeInstruction.parse({
      type: 'action/change',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addCompleteAction(ins: z.input<typeof CompleteTxInsArgs>) {
    const parsedIns = CompleteTxInstruction.parse({
      type: 'action/change',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addConfigAction(ins: z.input<typeof ConfigInsArgs>) {
    const parsedIns = ConfigInstruction.parse({
      type: 'action/config',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }

  addSetVarAction(ins: z.input<typeof SetVarInsArgs>) {
    const parsedIns = SetVarInstruction.parse({
      type: 'action/setvar',
      ...ins,
    });
    this.template.push(parsedIns);

    return this;
  }
}
