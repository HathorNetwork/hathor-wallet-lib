
const hathorLib = require('.');

hathorLib.network.setNetwork('mainnet');

const network = hathorLib.network;

const servers = ['https://node2.mainnet.hathor.network/v1a/'];

const uidTST1 = '00123...';
const uidTST2 = '00456...';

const aliceWords = '...';
const bobWords = '...';

const startWallet = async (seed, pin) => {
  const connection = new hathorLib.Connection({
    network: 'mainnet',
    servers,
    connectionTimeout: null,
  });

  const wallet = new hathorLib.HathorWallet({
    seed,
    connection,
    password: pin,
    pinCode: pin,
  });
  wallet.start().then(info => {
    console.log('Wallet is connecting...');
  });

  for (let i = 0; i < 5; i++) {
    if (wallet.state === hathorLib.HathorWallet.READY) {
      return wallet;
    }
    // Sleep for 2s
    await new Promise(r => setTimeout(r, 2000));
  }

  // return even if not ready
  return wallet;
}

/**
 * Alice will send 10 TST1 and Bob will send 20 TST2
 */
const atomicSwap = async () => {
  const pin = '123';
  const aliceWallet = await startWallet(aliceWords, pin);
  const bobWallet = await startWallet(bobWords, pin);

  // ALice side
  //
  hathorLib.storage.setStore(aliceWallet.store);

  aliceProposal = new hathorLib.TxProposal(network);

  await aliceProposal.addSend(uidTST1, 10);
  aliceProposal.addReceive(uidTST2, 20);

  const aliceData = aliceProposal.proposal.serialize();
  console.log('alice data', aliceData)

  // Bob side
  //
  hathorLib.storage.setStore(bobWallet.store);

  bobProposal = new hathorLib.TxProposal(network);
  // bob will fill the proposal with alice's data
  await bobProposal.setData(aliceData);

  await bobProposal.addSend(uidTST2, 20);
  bobProposal.addReceive(uidTST1, 10);

  // Bob will serialize the data and send it to Alice so they can agree on the transaction
  const bobData = bobProposal.proposal.serialize();
  console.log('bob data', bobData)

  // this will fail if the transaction is not balanced, as all things should be
  bobProposal.signData(pin);

  // Then he will send the signatures to alice
  const bobSignatures = bobProposal.signatures.serialize();
  console.log('bob signatures', bobSignatures)

  // Alice side again
  // The new data and signatures will be sent for alice
  //
  hathorLib.storage.setStore(aliceWallet.store);

  // She will complete the tx with bob's data
  await aliceProposal.setData(bobData);

  // She will lock and sign her transaction
  aliceProposal.signData(pin);
  // And add bobs signatures
  aliceProposal.signatures.addSignatures(bobSignatures);

  const transaction = aliceProposal.prepareTx();
  // This transaction should be completed with all input data
  // So `transaction.toHex()` can be used to mine+push the transation or we can use the sendTransaction facade.
  const sendTx = new hathorLib.SendTransaction({transaction});

  // mine + push the transaction, we can also listen for events on `sendTx`
  const tx = await sendTx.runFromMining();
  console.log(tx.hash);
};


atomicSwap();
