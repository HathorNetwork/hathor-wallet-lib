/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import version from '../src/version';
import wallet from '../src/wallet';
import transaction from '../src/transaction';

beforeEach(() => {
  wallet.cleanLocalStorage();
});

test('Get version', (done) => {
  const weightConstants = transaction.getTransactionWeightConstants();
  check(isNaN(weightConstants.txMinWeight), true, done);
  check(isNaN(weightConstants.txWeightCoefficient), true, done);
  check(isNaN(weightConstants.txMinWeightK), true, done);

  const promise = version.checkApiVersion();

  promise.then((data) => {
    const newWeightConstants = transaction.getTransactionWeightConstants();
    check(newWeightConstants.txMinWeight, 14, done);
    check(newWeightConstants.txWeightCoefficient, 1.6, done);
    check(newWeightConstants.txMinWeightK, 100, done);

    check(data.version, '1.0.0', done);
    check(data.network, 'mainnet', done);

    done();
  }, (e) => {
    done.fail('Error checking API version');
  });
}, 15000); // 15s to timeout in case done() is not called