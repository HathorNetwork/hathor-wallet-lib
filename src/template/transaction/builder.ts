/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  TemplateVar,
  TxTemplateInstruction,
  TransactionTemplate,
  TemplateVarName,
  TemplateVarValue,
  SetVarCommand,
  SetVarOptions,
} from './instructions';

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

  addUtxoSelect(
    fill: TemplateVar<number>,
    token?: TemplateVar<string>,
    address?: TemplateVar<string>,
    autoChange?: boolean,
    position: number = -1,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'input/utxo',
      fill,
      position,
    };
    if (token) ins.token = token;
    if (address) ins.address = address;
    if (autoChange) ins.autoChange = autoChange;

    this.instructions.push(ins);
    return this;
  }

  addAuthoritySelect(
    authority: 'mint'|'melt',
    token: TemplateVar<string>,
    amount?: TemplateVar<number>,
    address?: TemplateVar<string>,
    position: number = -1,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'input/authority',
      authority,
      token,
      position,
    };
    if (amount) ins.amount = amount;
    if (address) ins.address = address;

    this.instructions.push(ins);
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

  addDataOutput(
    data: TemplateVar<string>,
    position: number = -1,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'output/data',
      data,
      position,
    };

    this.instructions.push(ins);
    return this;
  }

  addTokenOutput(
    amount: TemplateVar<number>,
    token?: TemplateVar<string>,
    address?: TemplateVar<string>,
    timelock?: TemplateVar<number>,
    checkAddress?: boolean,
    position: number = -1,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'output/token',
      amount,
      position,
    };
    if (token) ins.token = token;
    if (address) ins.address = address;
    if (timelock) ins.timelock = timelock;
    if (checkAddress) ins.checkAddress = checkAddress;

    this.instructions.push(ins);
    return this;
  }

  addAuthorityOutput(
    amount: TemplateVar<number>,
    token: TemplateVar<string>,
    authority: 'mint'|'melt',
    address?: TemplateVar<string>,
    timelock?: TemplateVar<number>,
    checkAddress?: boolean,
    position: number = -1,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'output/authority',
      amount,
      token,
      authority,
      position,
    };
    if (address) ins.address = address;
    if (timelock) ins.timelock = timelock;
    if (checkAddress) ins.checkAddress = checkAddress;

    this.instructions.push(ins);
    return this;
  }

  addShuffleAction(
    target: 'inputs' | 'outputs' | 'all',
  ) {
    const ins: TxTemplateInstruction = {
      type: 'action/shuffle',
      target,
    };

    this.instructions.push(ins);
    return this;
  }

  addChangeAction(
    token?: TemplateVar<string>,
    address?: TemplateVar<string>,
    timelock?: TemplateVar<number>,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'action/change',
    };
    if (token) ins.token = token;
    if (address) ins.address = address;
    if (timelock) ins.timelock = timelock;

    this.instructions.push(ins);
    return this;
  }

  addConfigAction(
    version?: TemplateVar<number>,
    signalBits?: TemplateVar<number>,
    tokenName?: TemplateVar<string>,
    tokenSymbol?: TemplateVar<string>,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'action/config',
    };
    if (version) ins.version = version;
    if (signalBits) ins.signalBits = signalBits;
    if (tokenName) ins.tokenName = tokenName;
    if (tokenSymbol) ins.tokenSymbol = tokenSymbol;

    this.instructions.push(ins);
    return this;
  }

  addSetVarAction(
    name: TemplateVarName,
    value?: TemplateVarValue,
    action?: SetVarCommand,
    options?: SetVarOptions,
  ) {
    const ins: TxTemplateInstruction = {
      type: 'action/setvar',
      name,
    };
    if (value) ins.value = value;
    if (action) ins.action = action;
    if (options) ins.options = options;

    this.instructions.push(ins);
    return this;
  }

  export(): TransactionTemplate {
    return this.instructions;
  }
}
