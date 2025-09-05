import fs from 'fs';
import { isEmpty } from 'lodash';
import { GenesisWalletHelper } from '../helpers/genesis-wallet.helper';
import { generateWalletHelper, waitForTxReceived, waitTxConfirmed } from '../helpers/wallet.helper';
import { NANO_CONTRACTS_INITIALIZE_METHOD } from '../../../src/constants';
import ncApi from '../../../src/api/nano';
import { bufferToHex } from '../../../src/utils/buffer';
import helpersUtils from '../../../src/utils/helpers';
import { isNanoContractCreateTx } from '../../../src/nano_contracts/utils';

describe('Full blueprint basic tests', () => {
  /** @type HathorWallet */
  let hWallet;
  let address0;

  beforeAll(async () => {
    hWallet = await generateWalletHelper();
    address0 = await hWallet.getAddressAtIndex(0);
    await GenesisWalletHelper.injectFunds(hWallet, address0, 1000n);
  });

  afterAll(async () => {
    await hWallet.stop();
    await GenesisWalletHelper.clearListeners();
  });

  const checkTxValid = async (wallet, tx) => {
    const txId = tx.hash;
    // Check that serialization and deserialization match
    const network = wallet.getNetworkObject();
    const txBytes = tx.toBytes();
    const deserializedTx = helpersUtils.createTxFromBytes(txBytes, network);
    const deserializedTxBytes = deserializedTx.toBytes();
    expect(bufferToHex(txBytes)).toBe(bufferToHex(deserializedTxBytes));

    expect(txId).toBeDefined();
    await waitForTxReceived(wallet, txId);
    // We need to wait for the tx to get a first block, so we guarantee it was executed
    await waitTxConfirmed(wallet, txId);
    // Now we query the transaction from the full node to double check it's still valid after the nano execution
    // and it already has a first block, so it was really executed
    const txAfterExecution = await wallet.getFullTxById(txId);
    expect(isEmpty(txAfterExecution.meta.voided_by)).toBe(true);
    expect(txAfterExecution.meta.first_block).not.toBeNull();
  };

  const executeTests = async (wallet, blueprintId) => {
    const vertexId = '00008f315e8268b39a0ed2ffb31e58f7a883e41229cbd866a2d392d77888aa98';
    const amount = 1234;
    const address = 'WYiD1E8n5oB9weZ8NMyM3KoCjKf1KCjWAZ';
    const txOutputScript = 'cafecafe';
    const tokenUid = '00';
    const timestamp = 1748609035;
    const contractId = '00005570d7493d5afe8f4b41d1a0e73dc2ae1234ac491cb4ebc4827aa1695b12';
    // const varint = 5678n;
    const attrStr = 'test';
    const attrInt = 9;
    const attrBytes = Buffer.from('abcd').toString('hex');
    const attrBool = false;

    // NC initialize
    const txInitialize = await wallet.createAndSendNanoContractTransaction(
      NANO_CONTRACTS_INITIALIZE_METHOD,
      address0,
      {
        blueprintId,
        args: [
          vertexId,
          amount,
          address,
          txOutputScript,
          tokenUid,
          timestamp,
          contractId,
          blueprintId,
          // varint,
          attrStr,
          attrInt,
          attrBytes,
          attrBool,
        ],
      }
    );
    await checkTxValid(wallet, txInitialize);
    const txInitializeData = await wallet.getFullTxById(txInitialize.hash);
    expect(isNanoContractCreateTx(txInitializeData.tx)).toBe(true);

    // Get NC state
    const attrCall = 'is_attr_optional_filled()';
    const ncState = await ncApi.getNanoContractState(
      txInitialize.hash,
      [
        'vertex',
        'amount',
        'address',
        'tx_output_script',
        'token_uid',
        'timestamp',
        'contract_id',
        'blueprint_id',
        'attr_str',
        'attr_int',
        'attr_bytes',
        'attr_bool',
        'attr_optional',
      ],
      [],
      [attrCall]
    );

    expect(ncState.fields.vertex.value).toBe(vertexId);
    expect(ncState.fields.amount.value).toBe(amount);
    // XXX the address from state will return base58 in the next version
    // expect(ncState.fields.address.value).toBe(address);
    expect(ncState.fields.tx_output_script.value).toBe(txOutputScript);
    expect(ncState.fields.token_uid.value).toBe(tokenUid);
    expect(ncState.fields.timestamp.value).toBe(timestamp);
    expect(ncState.fields.contract_id.value).toBe(contractId);
    expect(ncState.fields.blueprint_id.value).toBe(blueprintId);
    expect(ncState.fields.attr_str.value).toBe(attrStr);
    expect(ncState.fields.attr_int.value).toBe(attrInt);
    expect(ncState.fields.attr_bytes.value).toBe(attrBytes);
    expect(ncState.fields.attr_bool.value).toBe(attrBool);
    expect(ncState.fields.attr_optional.value).toBe(null);
    expect(ncState.calls[attrCall].value).toBe(false);

    // Set optional
    const attrOptional = 'test';
    const txOptional = await wallet.createAndSendNanoContractTransaction('set_optional', address0, {
      ncId: txInitialize.hash,
      args: [attrOptional],
    });
    await checkTxValid(wallet, txOptional);

    const ncStateOptional = await ncApi.getNanoContractState(
      txInitialize.hash,
      ['attr_optional'],
      [],
      [attrCall]
    );

    expect(ncStateOptional.fields.attr_optional.value).toBe(attrOptional);
    expect(ncStateOptional.calls[attrCall].value).toBe(true);

    // Set dict address
    const txDictAddress = await wallet.createAndSendNanoContractTransaction(
      'set_dict_address',
      address0,
      {
        ncId: txInitialize.hash,
        args: [address, amount],
      }
    );
    await checkTxValid(wallet, txDictAddress);

    /*
    const stateDictAddressField = `attr_dict_address.a'${address}'`;
    const ncStateDictAddress = await ncApi.getNanoContractState(txInitialize.hash, [
      stateDictAddressField,
    ]);

    expect(ncStateDictAddress.fields[stateDictAddressField].value).toBe(amount);
    */

    // Set dict bytes
    const txDictBytes = await wallet.createAndSendNanoContractTransaction(
      'set_dict_bytes',
      address0,
      {
        ncId: txInitialize.hash,
        args: [attrBytes, attrInt],
      }
    );
    await checkTxValid(wallet, txDictBytes);

    /*
    const stateDictBytesField = `attr_dict_bytes.b'${attrBytes}'`;
    const ncStateDictBytes = await ncApi.getNanoContractState(txInitialize.hash, [
      stateDictBytesField,
    ]);

    expect(ncStateDictBytes.fields[stateDictBytesField].value).toBe(attrInt);
    */

    // Set dict str -> str int
    const txDictStrInt = await wallet.createAndSendNanoContractTransaction(
      'set_dict_str_int',
      address0,
      {
        ncId: txInitialize.hash,
        args: ['test1', 'test2', 2],
      }
    );
    await checkTxValid(wallet, txDictStrInt);

    /*
    const stateDictStrIntField = 'attr_dict_str.test1';
    const ncStateDictStrInt = await ncApi.getNanoContractState(txInitialize.hash, [
      stateDictStrIntField,
    ]);

    expect(ncStateDictStrInt.fields[stateDictStrIntField].value).toStrictEqual({ test2: 2 });
    */

    // Set dict  -> str bytes int
    const txDictStrBytesInt = await wallet.createAndSendNanoContractTransaction(
      'set_dict_str_bytes_int',
      address0,
      {
        ncId: txInitialize.hash,
        args: ['test1', 'cafecafe', 2],
      }
    );
    await checkTxValid(wallet, txDictStrBytesInt);

    /* This state get raises an error in nano hathor core
    const stateDictStrBytesIntField = 'attr_dict_str_bytes.test1';
    const ncStateDictStrBytesInt = await ncApi.getNanoContractState(
      txInitialize.hash,
      [stateDictStrBytesIntField]
    );

    expect(ncStateDictStrBytesInt.fields[stateDictStrBytesIntField].value).toStrictEqual({ cafecafe: 2 });
    */

    // Append list str
    const txListStr = await wallet.createAndSendNanoContractTransaction('append_str', address0, {
      ncId: txInitialize.hash,
      args: ['test1'],
    });
    await checkTxValid(wallet, txListStr);

    /*
    const randomListStrField = 'attr_random_list.0';
    const ncStateListStr = await ncApi.getNanoContractState(txInitialize.hash, [
      randomListStrField,
    ]);

    expect(ncStateListStr.fields[randomListStrField].value).toBe('test1');
    */

    // Append new list str
    const newTxListStr = await wallet.createAndSendNanoContractTransaction('append_str', address0, {
      ncId: txInitialize.hash,
      args: ['test2'],
    });
    await checkTxValid(wallet, newTxListStr);

    /*
    const newRandomListStrField = 'attr_random_list.1';
    const newNcStateListStr = await ncApi.getNanoContractState(txInitialize.hash, [
      newRandomListStrField,
    ]);

    expect(newNcStateListStr.fields[newRandomListStrField].value).toBe('test2');
    */

    // Set random value and read the state
    const txRandom = await wallet.createAndSendNanoContractTransaction(
      'set_random_value',
      address0,
      {
        ncId: txInitialize.hash,
      }
    );
    await checkTxValid(wallet, txRandom);

    const ncStateRandom = await ncApi.getNanoContractState(txInitialize.hash, ['random_value']);

    const possibleValues = ['test1', 'test2'];
    expect(possibleValues).toContain(ncStateRandom.fields.random_value.value);

    // Set list attrs
    const txListAttrs = await wallet.createAndSendNanoContractTransaction(
      'set_list_attrs',
      address0,
      {
        ncId: txInitialize.hash,
        args: [['ab', 'cd', 'efg']],
      }
    );
    await checkTxValid(wallet, txListAttrs);

    const txListAttrsState = await ncApi.getNanoContractState(txInitialize.hash, [
      'attr_list_0',
      'attr_list_1',
      'attr_list_2',
    ]);
    expect(txListAttrsState.fields.attr_list_0.value).toBe('ab');
    expect(txListAttrsState.fields.attr_list_1.value).toBe('cd');
    expect(txListAttrsState.fields.attr_list_2.value).toBe('efg');
  };

  it('Run with on chain blueprint', async () => {
    // Use the blueprint code
    const code = fs.readFileSync(
      './__tests__/integration/configuration/blueprints/full_blueprint.py',
      'utf8'
    );
    const tx = await hWallet.createAndSendOnChainBlueprintTransaction(code, address0);
    // Wait for the tx to be confirmed, so we can use the on chain blueprint
    await waitTxConfirmed(hWallet, tx.hash);
    // Execute the blueprint tests
    await executeTests(hWallet, tx.hash);
  });
});
