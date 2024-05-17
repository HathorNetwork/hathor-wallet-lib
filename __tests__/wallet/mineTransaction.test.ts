import Network from "../../src/models/network";

import helpers from "../../src/utils/helpers";
import MineTransaction from "../../src/wallet/mineTransaction";

test('Handle Rate Limit', (done) => {
  global.mock.onPost('submit-job').replyOnce(() => {
    return [429];
  });

  const rawTx = '00010001020082c7dd1f0ceb8867219dcca68540abe77222d11bb2dc67a7af1f04640ea1f701006a473045022100e41968f863dc3372c96a944641f2361ed86849249822b5988804adba1683b3ec02201877dd97d0c85d3754f3378828a4484de407ed2985fcf87782d90cce8f72ec9c2103168e0d873a5bbd75c90c24a68071ea05b9c10996d0cadb543ca650aa76607a260000006400001976a9143f207b6b6fdc624f6c4aff52daf5b80f7f15caf988ac0000001700001976a9143f207b6b6fdc624f6c4aff52daf5b80f7f15caf988ac40200000218def4160dcc22702006f1ebedd590bb5db5c71adbdeaa9b15f7f75c6257c26b11781dc1a5b20f83300b96fdd7a445e063326bbba979919be3b76add5b9cac9ff3330aa2bb804fb0e000000f4';
  const expectedErrorMessage = 'Too many transactions sent in a short time-span.\n\nAll transactions need to solve a proof-of-work as an anti spam mechanism. Currently, Hathor Labs provides a tx mining service for free, but there are limits to the number of transactions someone can mine using it to avoid abuse.\n\nPlease try again in a few seconds.';

  const network = new Network('testnet');
  const tx = helpers.createTxFromHex(rawTx, network);
  const messagesValidated = {};
  function validateErrorMessages(source: string) {
    messagesValidated[source] = true;

    // We should wait until both handlers receive the error with the correct message
    if (Object.keys(messagesValidated).length === 2) {
      done();
    }
  }

  const mineTransaction = new MineTransaction(tx, { maxTxMiningRetries: 1 });
  mineTransaction.promise.catch(e => {
    expect(e?.message).toBe(expectedErrorMessage);
    validateErrorMessages('promise');
  });
  mineTransaction.on('error', (message) => {
    expect(message).toBe(expectedErrorMessage);
    validateErrorMessages('error_event');
  });

  mineTransaction.start();
});
