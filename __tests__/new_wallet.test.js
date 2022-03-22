/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GAP_LIMIT } from '../src/constants';
import wallet from '../src/wallet';
import walletUtils from '../src/utils/wallet';
import WebSocketHandler from '../src/WebSocketHandler';
import storage from '../src/storage';

beforeEach(() => {
  wallet.setConnection(WebSocketHandler);
});


var addressUsed = '';
var addressShared = '';
var txId = '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e';
var pin = '123456';
var doneCb = null;

// Mock any GET request to /thin_wallet/address_history
// arguments for reply are (status, data, headers)
mock.onGet('thin_wallet/address_history').reply((config) => {
  if (config.params.addresses.length === GAP_LIMIT) {
    if (addressUsed === '') {
      addressUsed = config.params.addresses[0];
      addressShared = config.params.addresses[1];
    }
    let ret = {
      'success': true,
      'has_more': false,
      'history': [
        {
          'tx_id': txId,
          'timestamp': 1548892556,
          'is_voided': false,
          'inputs': [],
          'outputs': [
            {
              'decoded': {
                'timelock': null,
                'address': config.params.addresses[0],
              },
              'token': '00',
              'value': 2000,
              'voided': false
            }
          ],
        }
      ]
    }
    return [200, ret];
  } else {
    return [200, {'success': true, 'has_more': false, 'history': []}];
  }
});

const checkData = () => {
  check(storage.getItem('wallet:address'), addressShared, doneCb);
  check(storage.getItem('wallet:lastUsedAddress'), addressUsed, doneCb);
  check(parseInt(storage.getItem('wallet:lastSharedIndex'), 10), 1, doneCb);
  check(parseInt(storage.getItem('wallet:lastUsedIndex'), 10), 0, doneCb);
  check(parseInt(storage.getItem('wallet:lastGeneratedIndex'), 10), 20, doneCb);
  let accessData = storage.getItem('wallet:accessData');
  checkNot(accessData, null, doneCb);

  check('mainKey' in accessData, true, doneCb);
  check(typeof accessData['mainKey'], 'string', doneCb);
  check('hash' in accessData, true, doneCb);
  check('hashPasswd' in accessData, true, doneCb);
  check('salt' in accessData, true, doneCb);
  check('saltPasswd' in accessData, true, doneCb);
  check(accessData['hash'], wallet.hashPassword(pin, accessData['salt']).key.toString());
  check(accessData['hashPasswd'], wallet.hashPassword('password', accessData['saltPasswd']).key.toString());

  let walletData = storage.getItem('wallet:data');
  checkNot(walletData, null, doneCb);
  let walletDataJson = walletData;
  check('historyTransactions' in walletDataJson, true, doneCb);
  check(typeof walletDataJson['historyTransactions'], 'object', doneCb);
  check(txId in walletDataJson['historyTransactions'], true, doneCb);

  doneCb();
}

beforeEach(() => {
  wallet.cleanLoadedData();
  addressShared = '';
  WebSocketHandler.started = true;
  doneCb = null;
});

test('Generate new HD wallet', (done) => {
  doneCb = done;

  // Generate new wallet and save data in storage
  const words = wallet.generateWalletWords(256);
  check(wallet.wordsValid(words).valid, true, done);
  const promise = wallet.executeGenerateWallet(words, '', pin, 'password', true);

  promise.then(() => {
    checkData();
  }, (e) => {
    done.fail('Error loading history from addresses');
  });
}, 15000); // 15s to timeout if case done() is not called

test('Generate new MultiSig wallet', (done) => {
  // Generate seeds for participants
  const words = wallet.generateWalletWords(256);
  check(wallet.wordsValid(words).valid, true, done);
  const words1 = wallet.generateWalletWords(256);
  check(wallet.wordsValid(words1).valid, true, done);
  const words2 = wallet.generateWalletWords(256);
  check(wallet.wordsValid(words2).valid, true, done);

  const xpub = walletUtils.getMultiSigXPubFromWords(words);
  const xpub1 = walletUtils.getMultiSigXPubFromWords(words1);
  const xpub2 = walletUtils.getMultiSigXPubFromWords(words2);

  const multisigData = {minSignatures: 2, pubkeys: [xpub, xpub1, xpub2]};

  // Generate new wallet and save data in storage
  const promise = wallet.executeGenerateWallet(words, '', pin, 'password', true, multisigData);

  let accessData = storage.getItem('wallet:accessData');
  // Check multisig is correctly configured
  check('multisig' in accessData, true, done);
  check('pubkey' in accessData.multisig, true, done);
  check('pubkeys' in accessData.multisig, true, done);
  check('minSignatures' in accessData.multisig, true, done);
  done();

}, 15000); // 15s to timeout if case done() is not called

test('Generate HD wallet from predefined words', (done) => {
  doneCb = done;
  const words = 'purse orchard camera cloud piece joke hospital mechanic timber horror shoulder rebuild you decrease garlic derive rebuild random naive elbow depart okay parrot cliff';
  addressUsed = 'WR1i8USJWQuaU423fwuFQbezfevmT4vFWX';
  addressShared = 'WgSpcCwYAbtt31S2cqU7hHJkUHdac2EPWG';

  // Generate new wallet and save data in storage
  const promise = wallet.executeGenerateWallet(words, '', pin, 'password', true);

  promise.then(() => {
    checkData();
  }, (e) => {
    done.fail('Error loading history from addresses');
  });
}, 15000); // 15s to timeout in case done() is not called
