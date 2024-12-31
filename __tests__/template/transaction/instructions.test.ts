/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import {
  AddressSchema,
  AuthorityOutputInstruction,
  AuthoritySelectInstruction,
  ChangeInstruction,
  CompleteTxInstruction,
  ConfigInstruction,
  CustomTokenSchema,
  DataOutputInstruction,
  RawInputInstruction,
  RawOutputInstruction,
  SetVarInstruction,
  Sha256HexSchema,
  ShuffleInstruction,
  TemplateRef,
  TokenOutputInstruction,
  TokenSchema,
  TransactionTemplate,
  TxIdSchema,
  TxTemplateInstruction,
  UtxoSelectInstruction,
  getVariable,
} from '../../../src/template/transaction/instructions';

describe('parsing variable references', () => {
  it('should validate template variable reference strings', () => {
    expect(TemplateRef.safeParse('').success).toBeFalsy();
    expect(TemplateRef.safeParse('varname').success).toBe(false);
    expect(TemplateRef.safeParse('"varname"').success).toBe(false);
    expect(TemplateRef.safeParse('{varname}').success).toBe(true);
  });

  it('should throw when variable is not present or validation fail', () => {
    expect(() => getVariable('{foo1}', { foo: 'bar' }, z.string())).toThrow();
    expect(() => getVariable('ABC123', {}, z.number())).toThrow();
  });

  it('should get a template variable from reference', () => {
    expect(getVariable('{foo}', { foo: 'bar' }, z.string())).toBe('bar');
    // Validation/transform should be applied to value from context
    expect(
      getVariable(
        '{foo2}',
        { foo2: 'bar' },
        z.string().transform(o => `${o}1`)
      )
    ).toBe('bar1');
    expect(getVariable(`{foo3}`, { foo3: 10 }, z.coerce.bigint())).toBe(10n);
    // Validation/refinement should be applied to value
    expect(
      getVariable(
        'baz',
        {},
        z.string().transform(o => `${o}1`)
      )
    ).toBe('baz1');
    expect(getVariable(11, {}, z.coerce.bigint())).toBe(11n);
    // Should work with any schema
    expect(
      getVariable('{objfoo}', { objfoo: { foo: '10' } }, z.object({ foo: z.coerce.bigint() }))
    ).toStrictEqual({ foo: 10n });
    expect(getVariable('{numfoo}', { numfoo: '12' }, z.coerce.number())).toBe(12);
    expect(getVariable(123, {}, z.coerce.number())).toBe(123);
    expect(getVariable(456n, {}, z.bigint())).toBe(456n);
    expect(getVariable('{boolfoo}', { boolfoo: true }, z.boolean())).toBe(true);
    expect(getVariable(false, {}, z.boolean())).toBe(false);
  });
});

describe('parsing non-instruction schemas', () => {
  const address = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
  const token = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';

  it('should parse sha256 hex and derivations', () => {
    // sha256 hex example
    expect(Sha256HexSchema.safeParse(token).success).toBe(true);
    expect(TxIdSchema.safeParse(token).success).toBe(true);
    expect(CustomTokenSchema.safeParse(token).success).toBe(true);
    // Hex but of the wrong length
    expect(Sha256HexSchema.safeParse('cafe123').success).toBe(false);
    expect(TxIdSchema.safeParse('cafe123').success).toBe(false);
    expect(CustomTokenSchema.safeParse('cafe123').success).toBe(false);
    // Non hex string
    expect(Sha256HexSchema.safeParse(address).success).toBe(false);
    expect(TxIdSchema.safeParse(address).success).toBe(false);
    expect(CustomTokenSchema.safeParse(address).success).toBe(false);
  });

  it('should parse token schema', () => {
    // Token schema should be either a 64 hex string or native token UID
    // success cases
    expect(TokenSchema.safeParse(token).success).toBe(true);
    expect(TokenSchema.safeParse('00').success).toBe(true);
    // wrong length cases
    expect(TokenSchema.safeParse('cafe123').success).toBe(false);
    expect(TokenSchema.safeParse('0').success).toBe(false);
    expect(TokenSchema.safeParse('000').success).toBe(false);
    expect(TokenSchema.safeParse(token.slice(0, -1)).success).toBe(false);
    expect(TokenSchema.safeParse(`${token}0`).success).toBe(false);
    // Non hex string
    expect(TokenSchema.safeParse(address).success).toBe(false);
  });

  it('should parse address schema', () => {
    // success cases
    expect(AddressSchema.safeParse(address).success).toBe(true);
    // length 35 is still valid because a custom network with a different
    // version byte can potencially create addresses with 35 characters
    expect(AddressSchema.safeParse(`${address}H`).success).toBe(true);
    // wrong length cases
    expect(AddressSchema.safeParse(`${address}HH`).success).toBe(false);
    expect(AddressSchema.safeParse(address.slice(0, -1)).success).toBe(false);
    expect(AddressSchema.safeParse('H').success).toBe(false);
    // Non base58 alphabet string (all alphanumerics minus [0OIl])
    expect(AddressSchema.safeParse(`${address.slice(0, -1)}0`).success).toBe(false);
    expect(AddressSchema.safeParse(`${address.slice(0, -1)}O`).success).toBe(false);
    expect(AddressSchema.safeParse(`${address.slice(0, -1)}I`).success).toBe(false);
    expect(AddressSchema.safeParse(`${address.slice(0, -1)}l`).success).toBe(false);
  });
});

describe('should parse template instructions', () => {
  const address = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
  const token = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
  const txId = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';

  it('should parse RawInputInstruction', () => {
    expect(
      RawInputInstruction.safeParse({
        type: 'input/raw',
        position: 0,
        index: 1,
        txId,
      }).success
    ).toBe(true);
    // Parse with default, coersion and variable
    expect(
      RawInputInstruction.parse({
        type: 'input/raw',
        index: '10',
        txId: '{foo}',
        foo: 'bar',
      })
    ).toStrictEqual({
      type: 'input/raw',
      position: -1,
      index: 10,
      txId: '{foo}',
    });
    // Error cases
    expect(
      RawInputInstruction.safeParse({
        type: 'output/raw', // wrong type
        index: 1,
        txId,
      }).success
    ).toBe(false);
    expect(
      RawInputInstruction.safeParse({
        type: 'input/raw',
        index: 'a1', // cannot coerce index
        txId,
      }).success
    ).toBe(false);
    expect(
      RawInputInstruction.safeParse({
        type: 'input/raw',
        index: 10,
        txId: '00', // invalid txId string
      }).success
    ).toBe(false);
    expect(
      RawInputInstruction.safeParse({
        type: 'input/raw',
        position: 'abd', // invalid position
        index: 10,
        txId,
      }).success
    ).toBe(false);
  });

  it('should parse UtxoSelectInstruction', () => {
    expect(
      UtxoSelectInstruction.safeParse({
        type: 'input/utxo',
        position: 0,
        fill: 10,
        token,
        address,
        autoChange: false,
        changeAddress: address,
      }).success
    ).toBe(true);
    // Parse with default
    expect(
      UtxoSelectInstruction.parse({
        type: 'input/utxo',
        fill: 10,
      })
    ).toStrictEqual({
      type: 'input/utxo',
      position: -1,
      fill: 10n,
      token: '00',
      autoChange: true,
    });
    // Parse with template refs
    expect(
      UtxoSelectInstruction.parse({
        type: 'input/utxo',
        fill: '{fillKey}',
        token: '{tokenKey}',
        address: '{addressKey}',
        changeAddress: '{caddr}',
      })
    ).toStrictEqual({
      type: 'input/utxo',
      position: -1,
      fill: '{fillKey}',
      token: '{tokenKey}',
      address: '{addressKey}',
      autoChange: true,
      changeAddress: '{caddr}',
    });
    // Error cases
    expect(
      UtxoSelectInstruction.safeParse({
        type: 'invalid-type', // wrong type
      }).success
    ).toBe(false);
  });

  it('should parse AuthoritySelectInstruction', () => {
    expect(
      AuthoritySelectInstruction.safeParse({
        type: 'input/authority',
        address,
        authority: 'mint',
        count: 10,
        position: 0,
        token,
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      AuthoritySelectInstruction.parse({
        type: 'input/authority',
        authority: 'melt',
        token,
      })
    ).toStrictEqual({
      type: 'input/authority',
      authority: 'melt',
      count: 1,
      position: -1,
      token,
    });
    // parse with template refs
    expect(
      AuthoritySelectInstruction.parse({
        type: 'input/authority',
        authority: 'mint',
        count: '{countKey}',
        token: '{tokenKey}',
        address: '{addressKey}',
      })
    ).toStrictEqual({
      type: 'input/authority',
      position: -1,
      authority: 'mint',
      count: '{countKey}',
      token: '{tokenKey}',
      address: '{addressKey}',
    });
    // Error cases
    expect(
      AuthoritySelectInstruction.safeParse({
        type: 'invalid-type', // wrong type
        authority: 'melt',
        token,
      }).success
    ).toBe(false);
    expect(
      AuthoritySelectInstruction.safeParse({
        // Missing authority
        type: 'input/authority',
        token,
      }).success
    ).toBe(false);
    expect(
      AuthoritySelectInstruction.safeParse({
        // Missing token
        type: 'input/authority',
        authority: 'melt',
      }).success
    ).toBe(false);
    expect(
      AuthoritySelectInstruction.safeParse({
        type: 'input/authority',
        authority: 'melt',
        token: '00', // Cannot use native token with authority
      }).success
    ).toBe(false);
  });

  it('should parse RawOutputInstruction', () => {
    expect(
      RawOutputInstruction.safeParse({
        type: 'output/raw',
        position: 0,
        amount: '10',
        script: 'cafe',
        token,
        timelock: 100,
        authority: 'mint',
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      RawOutputInstruction.parse({
        type: 'output/raw',
        script: 'cafe',
      })
    ).toStrictEqual({
      type: 'output/raw',
      script: 'cafe',
      position: -1,
      token: '00',
      useCreatedToken: false,
    });
    // parse with template refs
    expect(
      RawOutputInstruction.parse({
        type: 'output/raw',
        script: '{scriptKey}',
        amount: '{amountKey}',
        token: '{tokenKey}',
        timelock: '{timelockKey}',
      })
    ).toStrictEqual({
      type: 'output/raw',
      position: -1,
      script: '{scriptKey}',
      amount: '{amountKey}',
      token: '{tokenKey}',
      timelock: '{timelockKey}',
      useCreatedToken: false,
    });
    // Error cases
    expect(
      RawOutputInstruction.safeParse({
        type: 'invalid-type', // wrong type
        script: 'cafe',
      }).success
    ).toBe(false);
    expect(
      RawOutputInstruction.safeParse({
        // Missing script
        type: 'output/raw',
      }).success
    ).toBe(false);
    expect(
      RawOutputInstruction.safeParse({
        type: 'output/raw',
        script: 'cafe',
        authority: 'none', // Invalid authority
      }).success
    ).toBe(false);
  });

  it('should parse TokenOutputInstruction', () => {
    expect(
      TokenOutputInstruction.safeParse({
        type: 'output/token',
        position: 0,
        amount: '10',
        token,
        address,
        timelock: 100,
        checkAddress: false,
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      TokenOutputInstruction.parse({
        type: 'output/token',
        amount: '5',
        address,
      })
    ).toStrictEqual({
      type: 'output/token',
      position: -1,
      amount: 5n,
      address,
      token: '00',
      useCreatedToken: false,
    });
    // parse with template refs
    expect(
      TokenOutputInstruction.parse({
        type: 'output/token',
        amount: '{amountKey}',
        token: '{tokenKey}',
        address: '{addressKey}',
        timelock: '{timelockKey}',
      })
    ).toStrictEqual({
      type: 'output/token',
      position: -1,
      amount: '{amountKey}',
      token: '{tokenKey}',
      address: '{addressKey}',
      timelock: '{timelockKey}',
      useCreatedToken: false,
    });
    // Error cases
    expect(
      TokenOutputInstruction.safeParse({
        type: 'invalid-type', // wrong type
        amount: 10,
        address,
      }).success
    ).toBe(false);
    expect(
      TokenOutputInstruction.safeParse({
        // Missing amount
        type: 'output/token',
        address,
      }).success
    ).toBe(false);
    expect(
      TokenOutputInstruction.safeParse({
        // Missing address
        type: 'output/token',
        amount: 10,
      }).success
    ).toBe(false);
  });

  it('should parse AuthorityOutputInstruction', () => {
    expect(
      AuthorityOutputInstruction.safeParse({
        type: 'output/authority',
        position: 0,
        count: '10',
        token,
        authority: 'mint',
        address,
        timelock: 100,
        checkAddress: false,
        useCreatedToken: false,
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      AuthorityOutputInstruction.parse({
        type: 'output/authority',
        token,
        authority: 'mint',
        address,
      })
    ).toStrictEqual({
      type: 'output/authority',
      position: -1,
      count: 1,
      token,
      authority: 'mint',
      address,
      useCreatedToken: false,
    });
    // parse with template refs
    expect(
      AuthorityOutputInstruction.parse({
        type: 'output/authority',
        count: '{countKey}',
        token: '{tokenKey}',
        authority: 'melt',
        address: '{addressKey}',
        timelock: '{timelockKey}',
      })
    ).toStrictEqual({
      type: 'output/authority',
      position: -1,
      count: '{countKey}',
      token: '{tokenKey}',
      authority: 'melt',
      address: '{addressKey}',
      timelock: '{timelockKey}',
      useCreatedToken: false,
    });
    // Error cases
    expect(
      AuthorityOutputInstruction.safeParse({
        type: 'invalid-type', // wrong type
        token,
        authority: 'mint',
        address,
      }).success
    ).toBe(false);
    expect(
      AuthorityOutputInstruction.safeParse({
        type: 'output/authority',
        token,
        authority: 'none', // Invalid authority
        address,
      }).success
    ).toBe(false);
    expect(
      AuthorityOutputInstruction.safeParse({
        // Missing authority
        type: 'output/authority',
        token,
        address,
      }).success
    ).toBe(false);
    expect(
      AuthorityOutputInstruction.safeParse({
        // Missing address
        type: 'output/authority',
        token,
        authority: 'mint',
      }).success
    ).toBe(false);
  });

  it('should parse DataOutputInstruction', () => {
    expect(
      DataOutputInstruction.safeParse({
        type: 'output/data',
        position: 0,
        data: 'foo',
        token,
        useCreatedToken: false,
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      DataOutputInstruction.parse({
        type: 'output/data',
        data: 'foo',
      })
    ).toStrictEqual({
      type: 'output/data',
      position: -1,
      data: 'foo',
      token: '00',
      useCreatedToken: false,
    });
    // parse with template refs
    expect(
      DataOutputInstruction.parse({
        type: 'output/data',
        data: '{dataKey}',
        token: '{tokenKey}',
      })
    ).toStrictEqual({
      type: 'output/data',
      position: -1,
      data: '{dataKey}',
      token: '{tokenKey}',
      useCreatedToken: false,
    });
    // Error cases
    expect(
      DataOutputInstruction.safeParse({
        type: 'invalid-type', // wrong type
        data: 'foo',
      }).success
    ).toBe(false);
    expect(
      DataOutputInstruction.safeParse({
        // Missing data
        type: 'output/data',
      }).success
    ).toBe(false);
  });

  it('should parse ShuffleInstruction', () => {
    expect(
      ShuffleInstruction.safeParse({
        type: 'action/shuffle',
        target: 'all',
      }).success
    ).toBe(true);
    expect(
      ShuffleInstruction.safeParse({
        type: 'action/shuffle',
        target: 'inputs',
      }).success
    ).toBe(true);
    expect(
      ShuffleInstruction.safeParse({
        type: 'action/shuffle',
        target: 'outputs',
      }).success
    ).toBe(true);
    // error cases
    expect(
      ShuffleInstruction.safeParse({
        type: 'action/shuffle',
        target: 'invalid', // invalid target
      }).success
    ).toBe(false);
    expect(
      ShuffleInstruction.safeParse({
        // missing target
        type: 'action/shuffle',
      }).success
    ).toBe(false);
    expect(
      ShuffleInstruction.safeParse({
        type: 'invalid-type', // invalid type
        target: 'all',
      }).success
    ).toBe(false);
  });

  it('should parse ChangeInstruction', () => {
    expect(
      ChangeInstruction.safeParse({
        type: 'action/change',
        token,
        address,
        timelock: 456,
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      ChangeInstruction.parse({
        type: 'action/change',
      })
    ).toStrictEqual({
      type: 'action/change',
    });
    // parse with template refs
    expect(
      ChangeInstruction.parse({
        type: 'action/change',
        token: '{tokenKey}',
        address: '{addrKey}',
        timelock: '{timelockKey}',
      })
    ).toStrictEqual({
      type: 'action/change',
      token: '{tokenKey}',
      address: '{addrKey}',
      timelock: '{timelockKey}',
    });
    // Error cases
    expect(
      ChangeInstruction.safeParse({
        type: 'invalid-type', // wrong type
      }).success
    ).toBe(false);
  });

  it('should parse CompleteInstruction', () => {
    expect(
      CompleteTxInstruction.safeParse({
        type: 'action/complete',
        token,
        address,
        changeAddress: address,
        timelock: 456,
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      CompleteTxInstruction.parse({
        type: 'action/complete',
      })
    ).toStrictEqual({
      type: 'action/complete',
    });
    // parse with template refs
    expect(
      CompleteTxInstruction.parse({
        type: 'action/complete',
        token: '{tokenKey}',
        address: '{addrKey}',
        changeAddress: '{caddrKey}',
        timelock: '{timelockKey}',
      })
    ).toStrictEqual({
      type: 'action/complete',
      token: '{tokenKey}',
      address: '{addrKey}',
      changeAddress: '{caddrKey}',
      timelock: '{timelockKey}',
    });
    // Error cases
    expect(
      CompleteTxInstruction.safeParse({
        type: 'invalid-type', // wrong type
      }).success
    ).toBe(false);
  });

  it('should parse ConfigInstruction', () => {
    expect(
      ConfigInstruction.safeParse({
        type: 'action/config',
        version: 202,
        signalBits: 254,
        tokenName: 'foo',
        tokenSymbol: 'bar',
      }).success
    ).toBe(true);
    // Parse with defaults
    expect(
      ConfigInstruction.parse({
        type: 'action/config',
      })
    ).toStrictEqual({
      type: 'action/config',
    });
    // parse with template refs
    expect(
      ConfigInstruction.parse({
        type: 'action/config',
        version: '{versionKey}',
        signalBits: '{signalBitsKey}',
        tokenName: '{tokenNameKey}',
        tokenSymbol: '{tokenSymbolKey}',
      })
    ).toStrictEqual({
      type: 'action/config',
      version: '{versionKey}',
      signalBits: '{signalBitsKey}',
      tokenName: '{tokenNameKey}',
      tokenSymbol: '{tokenSymbolKey}',
    });
    // Error cases
    expect(
      ConfigInstruction.safeParse({
        type: 'invalid-type', // wrong type
      }).success
    ).toBe(false);
  });

  it('should parse SetVarInstruction', () => {
    expect(
      SetVarInstruction.safeParse({
        type: 'action/setvar',
        name: 'foo',
        value: 'anything',
      }).success
    ).toBe(true);

    expect(
      SetVarInstruction.safeParse({
        type: 'action/setvar',
        name: 'foo',
        call: { method: 'get_wallet_address' },
      }).success
    ).toBe(true);

    expect(
      SetVarInstruction.safeParse({
        type: 'action/setvar',
        name: 'foo',
        call: { method: 'get_wallet_balance', token },
      }).success
    ).toBe(true);
  });
});

describe('Template schemes', () => {
  const address = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
  const token = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';
  const txId = '0000000110eb9ec96e255a09d6ae7d856bff53453773bae5500cee2905db670e';

  it('should parse any template instruction', () => {
    expect(
      TxTemplateInstruction.safeParse({
        type: 'input/raw',
        index: 1,
        txId,
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'input/utxo',
        fill: 10,
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'input/authority',
        address,
        authority: 'mint',
        token,
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'output/raw',
        amount: '10',
        script: 'cafe',
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'output/token',
        amount: '10',
        address,
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'output/authority',
        count: '10',
        token,
        authority: 'mint',
        address,
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'output/data',
        data: 'foo',
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'action/shuffle',
        target: 'all',
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'action/change',
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'action/complete',
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'action/config',
        version: 3,
        tokenName: 'foo',
        tokenSymbol: 'bar',
      }).success
    ).toBe(true);
    expect(
      TxTemplateInstruction.safeParse({
        type: 'action/setvar',
        name: 'foo',
        value: 'anything',
      }).success
    ).toBe(true);
  });

  it('should parse a simple template', () => {
    expect(
      TransactionTemplate.safeParse([
        {
          type: 'action/config',
          version: 3,
          tokenName: 'foo',
          tokenSymbol: 'bar',
        },
        {
          type: 'input/utxo',
          fill: 10,
        },
        {
          type: 'output/token',
          amount: '10',
          address,
        },
      ]).success
    ).toBe(true);
  });
});
