import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from './helpers/wallet.helper';
import { loggers } from './utils/logger.util';
import { HATHOR_TOKEN_CONFIG } from '../../src/constants';
import SendTransaction from '../../src/new/sendTransaction';
import PartialTxProposal from '../../src/wallet/partialTxProposal';
import storage from '../../src/storage';
import { delay } from './utils/core.util';

describe('partial tx proposal', () => {
  afterEach(async () => {
    await stopAllWallets();
    await GenesisWalletHelper.clearListeners();
  });

  it('Should exchange tokens between wallets', async () => {
    // Create the wallet
    const hWallet1 = await generateWalletHelper();
    const hWallet2 = await generateWalletHelper();
    const network = hWallet1.getNetworkObject();

    // Injecting funds and creating a new custom token
    await GenesisWalletHelper.injectFunds(hWallet1.getAddressAtIndex(0), 103);
    const { hash: token1Uid } = await createTokenHelper(
      hWallet1,
      'Token1',
      'TK1',
      200,
    );

    // Injecting funds and creating a new custom token
    await GenesisWalletHelper.injectFunds(hWallet2.getAddressAtIndex(0), 10);
    const { hash: token2Uid } = await createTokenHelper(
      hWallet2,
      'Token2',
      'TK2',
      1000,
    );

    // Get the balance states before the exchange
    const w1HTRBefore = await hWallet1.getBalance(HATHOR_TOKEN_CONFIG.uid);
    const w1Tk1Before = await hWallet1.getBalance(token1Uid);
    const w1Tk2Before = await hWallet1.getBalance(token2Uid);

    const w2HTRBefore = await hWallet2.getBalance(HATHOR_TOKEN_CONFIG.uid);
    const w2Tk2Before = await hWallet2.getBalance(token2Uid);
    const w2Tk1Before = await hWallet2.getBalance(token1Uid);
    loggers.test.log('Balances before', {
      wallet1: {
        HTR: w1HTRBefore,
        Tk1: w1Tk1Before,
        Tk2: w1Tk2Before,
      },
      wallet2: {
        HTR: w2HTRBefore,
        Tk1: w2Tk1Before,
        Tk2: w2Tk2Before,
      },
    });

    /**
     * The exchange will be:
     *
     * Wallet1 will send 100 HTR and 100 TK1
     * Wallet2 will send 1000 TK2
     */
    const proposal = new PartialTxProposal(network);
    // Wallet1 side
    proposal.addSend(hWallet1, HATHOR_TOKEN_CONFIG.uid, 100);
    proposal.addSend(hWallet1, token1Uid, 100);
    proposal.addReceive(hWallet1, token2Uid, 1000);
    expect(proposal.partialTx.isComplete()).toBeFalsy();
    // Wallet2 side
    proposal.addSend(hWallet2, token2Uid, 1000);
    proposal.addReceive(hWallet2, HATHOR_TOKEN_CONFIG.uid, 100);
    proposal.addReceive(hWallet2, token1Uid, 100);
    expect(proposal.partialTx.isComplete()).toBeTruthy();

    const serialized = proposal.partialTx.serialize();
    const proposal1 = PartialTxProposal.fromPartialTx(serialized, network);
    storage.setStore(hWallet1.store);
    await proposal1.signData(DEFAULT_PIN_CODE, true);
    expect(proposal1.signatures.isComplete()).toBeFalsy();

    const proposal2 = PartialTxProposal.fromPartialTx(serialized, network);
    storage.setStore(hWallet2.store);
    await proposal2.signData(DEFAULT_PIN_CODE, true);

    expect(proposal2.signatures.isComplete()).toBeFalsy();

    proposal2.signatures.addSignatures(proposal1.signatures.serialize());
    expect(proposal2.signatures.isComplete()).toBeTruthy();

    const transaction = proposal2.prepareTx();
    const sendTransaction = new SendTransaction({ transaction, network });
    const tx = await sendTransaction.runFromMining();
    expect(tx.hash).toBeDefined();

    await waitForTxReceived(hWallet1, tx.hash);
    await delay(1000); // This transaction seems to take longer than usual to complete

    // Get the balance states before the exchange
    const w1HTRAfter = await hWallet1.getBalance(HATHOR_TOKEN_CONFIG.uid);
    const w1Tk1After = await hWallet1.getBalance(token1Uid);
    const w1Tk2After = await hWallet1.getBalance(token2Uid);

    const w2HTRAfter = await hWallet2.getBalance(HATHOR_TOKEN_CONFIG.uid);
    const w2Tk2After = await hWallet2.getBalance(token2Uid);
    const w2Tk1After = await hWallet2.getBalance(token1Uid);

    loggers.test.log('Balances after', {
      wallet1: {
        HTR: w1HTRAfter,
        Tk1: w1Tk1After,
        Tk2: w1Tk2After,
      },
      wallet2: {
        HTR: w2HTRAfter,
        Tk1: w2Tk1After,
        Tk2: w2Tk2After,
      },
    });

    // Check balance HTR
    expect(w1HTRAfter[0].balance.unlocked - w1HTRBefore[0].balance.unlocked).toEqual(-100);
    expect(w1HTRAfter[0].balance.locked - w1HTRBefore[0].balance.locked).toEqual(0);
    expect(w2HTRAfter[0].balance.unlocked - w2HTRBefore[0].balance.unlocked).toEqual(100);
    expect(w2HTRAfter[0].balance.locked - w2HTRBefore[0].balance.locked).toEqual(0);

    // Check balance token1
    expect(w1Tk1After[0].balance.unlocked - w1Tk1Before[0].balance.unlocked).toEqual(-100);
    expect(w1Tk1After[0].balance.locked - w1Tk1Before[0].balance.locked).toEqual(0);
    expect(w2Tk1After[0].balance.unlocked - w2Tk1Before[0].balance.unlocked).toEqual(100);
    expect(w2Tk1After[0].balance.locked - w2Tk1Before[0].balance.locked).toEqual(0);

    // Check balance token2
    expect(w1Tk2After[0].balance.unlocked - w1Tk2Before[0].balance.unlocked).toEqual(1000);
    expect(w1Tk2After[0].balance.locked - w1Tk2Before[0].balance.locked).toEqual(0);
    expect(w2Tk2After[0].balance.unlocked - w2Tk2Before[0].balance.unlocked).toEqual(-1000);
    expect(w2Tk2After[0].balance.locked - w2Tk2Before[0].balance.locked).toEqual(0);
  });
});
