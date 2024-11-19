/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { CheckAddressesMineResponseData, WalletStatusResponseData, AddressesResponseData, NewAddressesResponseData, BalanceResponseData, HistoryResponseData, TokensResponseData, TxProposalCreateResponseData, TxProposalUpdateResponseData, TokenDetailsResponseData, TxOutputResponseData, AuthTokenResponseData, FullNodeVersionData, TxByIdTokensResponseData, FullNodeTxResponse, FullNodeTxConfirmationDataResponse } from '../types';
import HathorWalletServiceWallet from '../wallet';
/**
 * Api calls for wallet
 *
 * @namespace ApiWallet
 */
declare const walletApi: {
    getWalletStatus(wallet: HathorWalletServiceWallet): Promise<WalletStatusResponseData>;
    getVersionData(wallet: HathorWalletServiceWallet): Promise<FullNodeVersionData>;
    createWallet(wallet: HathorWalletServiceWallet, xpubkey: string, xpubkeySignature: string, authXpubkey: string, authXpubkeySignature: string, timestamp: number, firstAddress?: string | null): Promise<WalletStatusResponseData>;
    getAddresses(wallet: HathorWalletServiceWallet, index?: number): Promise<AddressesResponseData>;
    checkAddressesMine(wallet: HathorWalletServiceWallet, addresses: string[]): Promise<CheckAddressesMineResponseData>;
    getNewAddresses(wallet: HathorWalletServiceWallet): Promise<NewAddressesResponseData>;
    getTokenDetails(wallet: HathorWalletServiceWallet, tokenId: string): Promise<TokenDetailsResponseData>;
    getBalances(wallet: HathorWalletServiceWallet, token?: string | null): Promise<BalanceResponseData>;
    getTokens(wallet: HathorWalletServiceWallet): Promise<TokensResponseData>;
    getHistory(wallet: HathorWalletServiceWallet, options?: {}): Promise<HistoryResponseData>;
    getTxOutputs(wallet: HathorWalletServiceWallet, options?: {}): Promise<TxOutputResponseData>;
    createTxProposal(wallet: HathorWalletServiceWallet, txHex: string): Promise<TxProposalCreateResponseData>;
    updateTxProposal(wallet: HathorWalletServiceWallet, id: string, txHex: string): Promise<TxProposalUpdateResponseData>;
    deleteTxProposal(wallet: HathorWalletServiceWallet, id: string): Promise<TxProposalUpdateResponseData>;
    createAuthToken(wallet: HathorWalletServiceWallet, timestamp: number, xpub: string, sign: string): Promise<AuthTokenResponseData>;
    getTxById(wallet: HathorWalletServiceWallet, txId: string): Promise<TxByIdTokensResponseData>;
    _txNotFoundGuard(data: unknown): void;
    getFullTxById(wallet: HathorWalletServiceWallet, txId: string): Promise<FullNodeTxResponse>;
    getTxConfirmationData(wallet: HathorWalletServiceWallet, txId: string): Promise<FullNodeTxConfirmationDataResponse>;
    graphvizNeighborsQuery(wallet: HathorWalletServiceWallet, txId: string, graphType: string, maxLevel: number): Promise<string>;
};
export default walletApi;
//# sourceMappingURL=walletApi.d.ts.map