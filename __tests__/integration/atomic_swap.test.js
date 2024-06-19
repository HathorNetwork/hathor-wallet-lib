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

    // Injecting funds and creating a new custom token
    const txI = await GenesisWalletHelper.injectFunds(
      hWallet1,
      await hWallet1.getAddressAtIndex(0),
      103
    );
    const { hash: token1Uid } = await createTokenHelper(hWallet1, 'Token1', 'TK1', 200);

    // Injecting funds and creating a new custom token
    await GenesisWalletHelper.injectFunds(hWallet2, await hWallet2.getAddressAtIndex(0), 10);
    const { hash: token2Uid } = await createTokenHelper(hWallet2, 'Token2', 'TK2', 1000);

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
    // Wallet1 side
    const proposal1 = new PartialTxProposal(hWallet1.storage);
    await proposal1.addSend(HATHOR_TOKEN_CONFIG.uid, 100);
    await proposal1.addSend(token1Uid, 100);
    await proposal1.addReceive(token2Uid, 1000);
    expect(proposal1.partialTx.isComplete()).toBeFalsy();
    const serialized1 = proposal1.partialTx.serialize();
    // Wallet2 side + sign
    const proposal2 = PartialTxProposal.fromPartialTx(serialized1, hWallet2.storage);
    await proposal2.addSend(token2Uid, 1000);
    await proposal2.addReceive(HATHOR_TOKEN_CONFIG.uid, 100);
    await proposal2.addReceive(token1Uid, 100);
    expect(proposal2.partialTx.isComplete()).toBeTruthy();
    await proposal2.signData(DEFAULT_PIN_CODE, true);
    expect(proposal2.signatures.isComplete()).toBeFalsy();

    // Signatures come back to wallet1
    const serialized2 = proposal2.partialTx.serialize();
    const proposal1After = PartialTxProposal.fromPartialTx(serialized2, hWallet1.storage);
    await proposal1After.signData(DEFAULT_PIN_CODE, true);
    expect(proposal1After.signatures.isComplete()).toBeFalsy();
    proposal1After.signatures.addSignatures(proposal2.signatures.serialize());

    expect(proposal1After.signatures.isComplete()).toBeTruthy();

    const transaction = proposal1After.prepareTx();
    const sendTransaction = new SendTransaction({ storage: hWallet1.storage, transaction });
    const tx = await sendTransaction.runFromMining();
    expect(tx.hash).toBeDefined();

    await waitForTxReceived(hWallet1, tx.hash);
    await waitForTxReceived(hWallet2, tx.hash);

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
