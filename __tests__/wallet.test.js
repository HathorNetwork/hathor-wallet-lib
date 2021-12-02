/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import wallet from '../src/wallet';
import dateFormatter from '../src/date';
import Mnemonic from 'bitcore-mnemonic';
import { HATHOR_TOKEN_CONFIG, HATHOR_BIP44_CODE } from '../src/constants';
import storage from '../src/storage';
import WebSocketHandler from '../src/WebSocketHandler';
import txHistoryFixture from "./__fixtures__/tx_history";
import network from '../src/network';

beforeEach(() => {
  wallet.setConnection(WebSocketHandler);
});

test('Wallet operations for transaction', () => {
  const words = wallet.generateWalletWords(256);
  wallet.executeGenerateWallet(words, '', '123456', 'password', false);

  let historyTransactions = {
    '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e': {
      'version': 1,
      'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e',
      'inputs': [],
      'outputs': [
        {
          'decoded': {
            'address': '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
            'timelock': null
          },
          'value': 100,
          'spent_by': null,
          'token': '00',
        },
        {
          'decoded': {
            'address': '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q',
            'timelock': null
          },
          'value': 300,
          'spent_by': null,
          'token': '01',
        }
      ],
      'tokens': [{uid: '01', name: '01', symbol: '01'}]
    },
    '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295f': {
      'version': 1,
      'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295f',
      'inputs': [],
      'outputs': [
        {
          'decoded': {
            'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
            'timelock': dateFormatter.dateToTimestamp(new Date()) - 99999,
            'token_data': 0,
          },
          'spent_by': null,
          'value': 200,
          'token': '00',
        },
        {
          'decoded': {
            'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
            'timelock': dateFormatter.dateToTimestamp(new Date()) - 99999,
            'token_data': 1,
          },
          'value': 100,
          'spent_by': null,
          'token': '01',
        },
      ],
      'tokens': [{uid: '01', name: '01', symbol: '01'}]
    },
    '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d': {
      'version': 1,
      'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d',
      'inputs': [
        {
          'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295f',
          'index': 0,
          'decoded': {
            'address': '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
            'timelock': dateFormatter.dateToTimestamp(new Date()) - 99999,
            'token_data': 0,
          },
          'value': 200,
        }
      ],
      'outputs': [
        {
          'decoded': {
            'address': '13NREDS4kVKTvkDxcXS5JACRnD8DBHJb3A',
            'timelock': dateFormatter.dateToTimestamp(new Date()) + 99999,
            'token_data': 0,
          },
          'value': 500,
          'spent_by': null,
          'token': '00',
        },
        {
          'decoded': {
            'address': '13NREDS4kVKTvkDxcXS5JACRnD8DBHJb3A',
            'timelock': dateFormatter.dateToTimestamp(new Date()) + 99999,
            'token_data': 1,
          },
          'value': 1000,
          'token': '01',
          'spent_by': null,
        },
      ],
      'tokens': [{uid: '01', name: '01', symbol: '01'}]
    },
    '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295c': {
      'version': 0,
      'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295c',
      'inputs': [],
      'outputs': [
        {
          'decoded': {
            'address': '13NREDS4kVKTvkDxcXS5JACRnD8DBHJb3A',
            'timelock': dateFormatter.dateToTimestamp(new Date()) + 99999,
            'token_data': 1,
          },
          'value': 50,
          'token': '01',
          'spent_by': null,
        },
      ],
      'tokens': [{uid: '01', name: '01', symbol: '01'}]
    }
  }

  const futureChangeAddress = 'WgPiMqEcT2vMpQEy2arDkEcfEtGJhofyGd';
  const keys = {
    '13NREDS4kVKTvkDxcXS5JACRnD8DBHJb3A': {},
    '1PtH3rBmiYDiUuomQyoxMREicrxjg3LA5q': {},
    '171hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r': {},
  }
  keys[futureChangeAddress] = {};

  storage.setItem('wallet:data', {keys, historyTransactions});

  const expectedBalance = {
    '00': {
      'available': 300,
      'locked': 500
    },
    '01': {
      'available': 400,
      'locked': 1050
    }
  }
  const filteredHistoryTransactions1 = wallet.filterHistoryTransactions(historyTransactions, '00');
  const balance1 = wallet.calculateBalance(filteredHistoryTransactions1, '00');
  expect(balance1).toEqual(expect.objectContaining(expectedBalance['00']));

  const filteredHistoryTransactions2 = wallet.filterHistoryTransactions(historyTransactions, '01');
  const balance2 = wallet.calculateBalance(filteredHistoryTransactions2, '01');
  expect(balance2).toEqual(expect.objectContaining(expectedBalance['01']));

  // Calculating balance of one tx
  const tx1 = historyTransactions['00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d'];
  expect(wallet.getTxBalance(tx1)).toMatchObject({'00': 300, '01': 1000});

  const tx2 = historyTransactions['00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295c'];
  const outsideTx = {
    'tx_id': '00034515973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d',
    'inputs': [
      {
        'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b296a',
        'index': 0,
        'decoded': {
          'address': 'W71hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r',
          'timelock': dateFormatter.dateToTimestamp(new Date()) - 99999,
          'token_data': 0,
        },
        'value': 200,
      }
    ],
    'outputs': [
      {
        'decoded': {
          'address': 'W3NREDS4kVKTvkDxcXS5JACRnD8DBHJb3A',
          'timelock': dateFormatter.dateToTimestamp(new Date()) + 99999,
          'token_data': 1,
        },
        'value': 1000,
        'token': '01',
        'spent_by': null,
      },
    ],
    'tokens': [{uid: '01', name: '01', symbol: '01'}]
  };


  // Verifying tx existance
  expect(wallet.txExists(tx1)).toBe(true);
  expect(wallet.txExists(tx2)).toBe(true);
  expect(wallet.txExists(outsideTx)).toBe(false);

  // Verifying if inputs are from the wallet
  expect(wallet.areInputsMine(outsideTx)).toBe(false);
  expect(wallet.areInputsMine(tx2)).toBe(false);
  expect(wallet.areInputsMine(tx1)).toBe(true);

  // Preparing a new transaction
  const address = 'W71hK8MaRpG2SqQMMQ34EdTharUmP1Qk4r';

  // No outputs
  const result1 = wallet.prepareSendTokensData({'outputs': []}, HATHOR_TOKEN_CONFIG, true, historyTransactions, new Set());
  expect(result1.success).toBe(false);

  const data2 = {'outputs': [{ 'address': address, 'value': 50}]};
  const result2 = wallet.prepareSendTokensData(data2, HATHOR_TOKEN_CONFIG, true, historyTransactions, new Set());
  expect(result2.success).toBe(true);
  expect(result2.data.outputs.length).toBe(2);

  const data3 = {'outputs': [{ 'address': address, 'value': 100}]};
  const result3 = wallet.prepareSendTokensData(data3, HATHOR_TOKEN_CONFIG, true, historyTransactions, new Set());
  expect(result3.success).toBe(true);
  expect(result3.data.outputs.length).toBe(1);

  const data4 = {'outputs': [{ 'address': address, 'value': 999999999}]};
  // No amount
  const result4 = wallet.prepareSendTokensData(data4, HATHOR_TOKEN_CONFIG, true, historyTransactions, new Set());
  expect(result4.success).toBe(false);

  // Selecting inputs
  const data5 = {
    'outputs': [
      {'address': address, 'value': 100}
    ],
    'inputs': [
      {'tx_id': '00034515973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d', 'index': 0}
    ],
  };
  // Unspent tx does not exist
  const result5 = wallet.prepareSendTokensData(data5, HATHOR_TOKEN_CONFIG, false, historyTransactions, new Set());
  expect(result5.success).toBe(false);

  const data6 = {
    'outputs': [
      {'address': address, 'value': 100}
    ],
    'inputs': [
      {'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295d', 'index': 0}
    ],
  };
  // Unspent tx locked
  const result6 = wallet.prepareSendTokensData(data6, HATHOR_TOKEN_CONFIG, false, historyTransactions, new Set());
  expect(result6.success).toBe(false);

  const data7 = {
    'outputs': [
      {'address': address, 'value': 200}
    ],
    'inputs': [
      {'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 'index': 0}
    ],
  };
  // Not enough amount in the unspent tx
  const result7 = wallet.prepareSendTokensData(data7, HATHOR_TOKEN_CONFIG, false, historyTransactions, new Set());
  expect(result7.success).toBe(false);

  const data8 = {
    'outputs': [
      {'address': address, 'value': 100}
    ],
    'inputs': [
      {'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 'index': 0}
    ],
  };
  // Success
  const result8 = wallet.prepareSendTokensData(data8, HATHOR_TOKEN_CONFIG, false, historyTransactions, new Set());
  expect(result8.success).toBe(true);
  expect(result8.data.outputs.length).toBe(1);

  const data9 = {
    'outputs': [
      {'address': address, 'value': 50}
    ],
    'inputs': [
      {'tx_id': '00034a15973117852c45520af9e4296c68adb9d39dc99a0342e23cd6686b295e', 'index': 0}
    ],
  };
  // Success 2
  const result9 = wallet.prepareSendTokensData(data9, HATHOR_TOKEN_CONFIG, false, historyTransactions, new Set(), {changeAddress: futureChangeAddress});
  expect(result9.success).toBe(true);
  expect(result9.data.outputs.length).toBe(2);

  for (const output of result9.data.outputs) {
    if (output.isChange === true) {
      expect(output.address).toBe(futureChangeAddress);
    }
  }
});

test('Try to check tx before wallet has loaded', () => {
  const words = wallet.generateWalletWords(256);
  wallet.executeGenerateWallet(words, '', '123456', 'password', false);
  // this should return false, not fail
  expect(wallet.txExists({'tx_id': 'aaa'})).toBe(false);
});

test('Utxo selection', () => {
  wallet._rewardSpendMinBlocks = 0;
  wallet._networkBestChainHeight = 11;
  // First we need to parse the history in the fixture to the expected format in the localStorage
  const history = {}

  for (const h of txHistoryFixture) {
    history[h.tx_id] = h;
  }

  const keys = {
    'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ': {},
    'WYBwT3xLpDnHNtYZiU52oanupVeDKhAvNp': {},
  }

  storage.setItem('wallet:data', {keys, historyTransactions: history});

  const ret1 = wallet.getInputsFromAmount(history, 1, "00")
  // It will get the first utxo
  expect(ret1.inputsAmount).toBe(1);
  expect(ret1.inputs.length).toBe(1);
  expect(ret1.inputs[0].tx_id).toBe("0000000419625e2587c225fb49f36278c9da681ec05e039125307b8aef3d3d30");

  const ret2 = wallet.getInputsFromAmount(history, 2, "00")
  // It will use all HTR utxos
  expect(ret2.inputsAmount).toBe(2);
  expect(ret2.inputs.length).toBe(2);

  const ret3 = wallet.getInputsFromAmount(history, 3, "00")
  // It won't have 3 HTR
  expect(ret3.inputsAmount).toBe(0);
  expect(ret3.inputs.length).toBe(0);

  const ret4 = wallet.getInputsFromAmount(history, 1, "02")
  // It will get the first utxo for token "02"
  expect(ret4.inputsAmount).toBe(1);
  expect(ret4.inputs.length).toBe(1);
  expect(ret4.inputs[0].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1053");

  const ret5 = wallet.getInputsFromAmount(history, 3, "02")
  // It will get the last utxo for token "02"
  expect(ret5.inputsAmount).toBe(3);
  expect(ret5.inputs.length).toBe(1);
  expect(ret5.inputs[0].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1055");

  const ret6 = wallet.getInputsFromAmount(history, 4, "02")
  // It will get the last two utxo for token "02", the ones with bigger amount
  expect(ret6.inputsAmount).toBe(5);
  expect(ret6.inputs.length).toBe(2);
  expect(ret6.inputs[0].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1055");
  expect(ret6.inputs[1].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1054");

  const ret7 = wallet.getInputsFromAmount(history, 5, "02")
  // It will get the last two utxo for token "02", the ones with bigger amount
  expect(ret7.inputsAmount).toBe(5);
  expect(ret7.inputs.length).toBe(2);
  expect(ret7.inputs[0].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1055");
  expect(ret7.inputs[1].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1054");

  const ret8 = wallet.getInputsFromAmount(history, 6, "02")
  // It will get all utxos for token "02"
  expect(ret8.inputsAmount).toBe(6);
  expect(ret8.inputs.length).toBe(3);
  expect(ret8.inputs[0].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1055");
  expect(ret8.inputs[1].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1054");
  expect(ret8.inputs[2].tx_id).toBe("0000000fa2157d34a56b89c08e1783cd1103f6e6807bb01ccff1d920b31d1053");

  const ret9 = wallet.getInputsFromAmount(history, 7, "02")
  // Won't have enough tokens
  expect(ret9.inputsAmount).toBe(0);
  expect(ret9.inputs.length).toBe(0);
});

test('change pin and password', () => {
  const words = wallet.generateWalletWords(256);
  const pin = '123456';
  const password = 'password';
  const passphrase = '';
  wallet.executeGenerateWallet(words, passphrase, pin, password, false);

  const code = new Mnemonic(words);
  const xpriv = code.toHDPrivateKey(passphrase, network.getNetwork());
  const privkey = xpriv.deriveNonCompliantChild(`m/44'/${HATHOR_BIP44_CODE}'/0'/0`);
  const xprivkey = privkey.xprivkey;

  wallet.isPinCorrect(pin);
  wallet.isPasswordCorrect(password);

  const accessData = wallet.getWalletAccessData();
  const decryptedXprivkey = wallet.decryptData(accessData.mainKey, pin);
  expect(xprivkey).toBe(decryptedXprivkey);
  const decryptedWords = wallet.decryptData(accessData.words, password);
  expect(words).toBe(decryptedWords);

  const newPin = '111111';
  const newPassword = 'password1';
  wallet.changePin(pin, newPin);
  wallet.changePassword(password, newPassword);

  const newAccessData = wallet.getWalletAccessData();
  const newDecryptedXprivkey = wallet.decryptData(newAccessData.mainKey, newPin);
  expect(xprivkey).toBe(newDecryptedXprivkey);
  const newDecryptedWords = wallet.decryptData(newAccessData.words, newPassword);
  expect(words).toBe(newDecryptedWords);

  const newPin2 = '222222';
  const newPassword2 = 'password2';
  wallet.changePinAndPassword(newPin, newPin2, newPassword, newPassword2);

  const newAccessData2 = wallet.getWalletAccessData();
  const newDecryptedXprivkey2 = wallet.decryptData(newAccessData2.mainKey, newPin2);
  expect(xprivkey).toBe(newDecryptedXprivkey2);
  const newDecryptedWords2 = wallet.decryptData(newAccessData2.words, newPassword2);
  expect(words).toBe(newDecryptedWords2);
});
