import { GenesisWalletHelper } from './helpers/genesis-wallet.helper';
import {
  createTokenHelper,
  DEFAULT_PIN_CODE,
  generateWalletHelper,
  stopAllWallets,
  waitForTxReceived,
} from './helpers/wallet.helper';
import { HATHOR_TOKEN_CONFIG } from '../../src/constants';
import SendTransaction from '../../src/new/sendTransaction';
import PartialTxProposal from '../../src/wallet/partialTxProposal';

const fakeTokenUid = '008a19f84f2ae284f19bf3d03386c878ddd15b8b0b604a3a3539aa9d714686e1';

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
    await GenesisWalletHelper.injectFunds(hWallet1.getAddressAtIndex(0), 101);
    const { hash: token1Uid } = await createTokenHelper(
      hWallet1,
      'Token1',
      'TK1',
      100,
    );

    // Injecting funds and creating a new custom token
    await GenesisWalletHelper.injectFunds(hWallet2.getAddressAtIndex(0), 10);
    const { hash: token2Uid } = await createTokenHelper(
      hWallet2,
      'Token2',
      'TK2',
      1000,
    );

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

    expect(proposal.partialTx.serialize()).toBeInstanceOf(String);

    const proposal1 = PartialTxProposal.fromPartialTx(serialized, network);
    await proposal1.signData(DEFAULT_PIN_CODE, true);
    expect(proposal1.signatures.isComplete()).toBeFalsy();

    const proposal2 = PartialTxProposal.fromPartialTx(serialized, network);
    await proposal2.signData(DEFAULT_PIN_CODE, true);
    expect(proposal2.signatures.isComplete()).toBeFalsy();

    proposal2.signatures.addSignatures(proposal1.signatures.serialize());
    expect(proposal2.signatures.isComplete()).toBeTruthy();

    const transaction = proposal2.prepareTx();
    const sendTransaction = new SendTransaction({ transaction, network });
    const tx = await sendTransaction.runFromMining();
    expect(tx.hash).toBeDefined();
  });
});
