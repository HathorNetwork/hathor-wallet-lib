/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { TemplateVar, TxTemplateInstruction, TransactionTemplate } from './instructions';

export class TransactionTemplateBuilder {
  instructions: TxTemplateInstruction[];

  constructor() {
    this.instructions = [];
  }

  static from(instructions: TxTemplateInstruction[]): TransactionTemplateBuilder {
    const tt = new TransactionTemplateBuilder();
    tt.instructions = instructions;
    return tt;
  }

  addInstruction(ins: TxTemplateInstruction): TransactionTemplateBuilder {
    this.instructions.push(ins);
    return this;
  }

  // TODO: other adders

  addRawInput(txId: TemplateVar<string>, index: TemplateVar<number>, position: number = -1) {
    this.instructions.push({
      type: 'input/raw',
      position,
      txId,
      index,
    });

    return this;
  }

  addRawOutput(
    amount: TemplateVar<number>,
    script: TemplateVar<string>,
    token: TemplateVar<string>,
    position: number = -1
  ) {
    this.instructions.push({
      type: 'output/raw',
      position,
      amount,
      script,
      token,
    });

    return this;
  }

  export(): TransactionTemplate {
    return this.instructions;
  }
}
