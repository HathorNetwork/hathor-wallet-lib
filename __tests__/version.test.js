/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import version from '../src/version';
import wallet from '../src/wallet';
import transaction from '../src/transaction';
import tokens from '../src/tokens';
import { ConstantNotSet } from '../src/errors';

beforeEach(() => {
  wallet.cleanLoadedData();
});

test('Get version', (done) => {
  try {
    // weight constants are not set for now, so should throw error
    transaction.getTransactionWeightConstants();
    done.fail();
  } catch (e) {
    if (!(e instanceof ConstantNotSet)) {
      done.fail();
    }
  }

  const promise = version.checkApiVersion();

  // set to wrong value and check it updates on version API
  tokens.updateDepositPercentage(0.5);

  promise.then((data) => {
    const newWeightConstants = transaction.getTransactionWeightConstants();
    check(newWeightConstants.txMinWeight, 14, done);
    check(newWeightConstants.txWeightCoefficient, 1.6, done);
    check(newWeightConstants.txMinWeightK, 100, done);

    check(data.version, '1.0.0', done);
    check(data.network, 'mainnet', done);

    expect(tokens.getDepositPercentage()).toBe(0.01);

    done();
  }, (e) => {
    done.fail('Error checking API version');
  });
}, 15000); // 15s to timeout in case done() is not called
