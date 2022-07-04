/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { PartialTxInputData } from '../../src/models/partial_tx';

import { IndexOOBError } from '../../src/errors';

describe('PartialTxInputData.addData', () => {
  it('should throw OOB error when index is OOB', () => {
    const signatures = new PartialTxInputData('1', 3);
    expect(() => {
      signatures.addData(3, Buffer.from([]));
    }).toThrow(IndexOOBError);
    expect(() => {
      signatures.addData(4, Buffer.from([]));
    }).toThrow(IndexOOBError);
  });

  it('should add data when called', () => {
    const signatures = new PartialTxInputData('1', 3);
    expect(Object.values(signatures.data)).toHaveLength(0);

    signatures.addData(0, Buffer.from('abc1', 'hex'));
    expect(Object.values(signatures.data)).toHaveLength(1);
    expect(signatures.data[0].toString('hex')).toBe('abc1');

    // Should add on correct index
    signatures.addData(1, Buffer.from('dead', 'hex'));
    expect(Object.values(signatures.data)).toHaveLength(2);
    expect(signatures.data[1].toString('hex')).toBe('dead');

    // Should overwrite index if it already exists
    signatures.addData(1, Buffer.from('cafe', 'hex'));
    expect(Object.values(signatures.data)).toHaveLength(2);
    expect(signatures.data[1].toString('hex')).toBe('cafe');
  });
});

describe('PartialTxInputData.isComplete', () => {
  it('should return false if incomplete', () => {
    const signatures = new PartialTxInputData('1', 3);
    expect(signatures.isComplete()).toBeFalsy();
    for (let i = 0; i< 2; i++) {
      signatures.addData(i, Buffer.from('cafe', 'hex'));
      expect(signatures.isComplete()).toBeFalsy();
    }
  });

  it('should return true if complete', () => {
    const signatures = new PartialTxInputData('1', 3);
    for (let i = 0; i< 3; i++) {
      signatures.addData(i, Buffer.from('cafe', 'hex'));
    }
    expect(signatures.isComplete()).toBeTruthy();
  });
});


describe('PartialTxInputData serialization', () => {
  it('should serialize correctly', () => {
    // incomplete signatures
    const sigs1 = new PartialTxInputData('1', 3);
    sigs1.addData(0, Buffer.from('cafe00', 'hex'));
    sigs1.addData(1, Buffer.from('cafe01', 'hex'));
    expect(sigs1.serialize()).toBe('PartialTxInputData|1|0:cafe00|1:cafe01');

    // complete signatures
    const sigs2 = new PartialTxInputData('2', 3);
    sigs2.addData(0, Buffer.from('cafe00', 'hex'));
    sigs2.addData(1, Buffer.from('cafe01', 'hex'));
    sigs2.addData(2, Buffer.from('cafe02', 'hex'));
    expect(sigs2.serialize()).toBe('PartialTxInputData|2|0:cafe00|1:cafe01|2:cafe02')

    // empty signatures
    const sigs3 = new PartialTxInputData('3', 3);
    expect(sigs3.serialize()).toBe('PartialTxInputData|3');
  });

  it('should merge signatures correctly', () => {

    const sigs = new PartialTxInputData('d1', 2);
    sigs.addSignatures('PartialTxInputData|d1|0:cafe00')
    expect(sigs.serialize()).toBe('PartialTxInputData|d1|0:cafe00')

    sigs.addSignatures('PartialTxInputData|d1|1:cafe01')
    expect(sigs.serialize()).toBe('PartialTxInputData|d1|0:cafe00|1:cafe01')

    // should overwrite
    sigs.addSignatures('PartialTxInputData|d1|1:cafafe51');
    expect(sigs.serialize()).toBe('PartialTxInputData|d1|0:cafe00|1:cafafe51')
  });


  it('should throw when adding invalid signatures', () => {

    const sigs = new PartialTxInputData('a-transaction-id', 2);
    expect(() => {
      sigs.addSignatures('PartialTxInputInvalid|a-transaction-id|0:cafe');
    }).toThrow(SyntaxError);

    expect(() => {
      sigs.addSignatures('PartialTxInputData|a-transaction-id|0:1:2');
    }).toThrow(SyntaxError);

    expect(() => {
      sigs.addSignatures('PartialTxInputData|a-transaction-id|0');
    }).toThrow(SyntaxError);

    expect(() => {
      sigs.addSignatures('PartialTxInputData|another-transaction-id|0:cafe00');
    }).toThrow(SyntaxError);
  });
})
