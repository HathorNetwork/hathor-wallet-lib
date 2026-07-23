/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared createNFT() and data-output token creation tests.
 *
 * Validates NFT and data-output creation behavior that is common to both the
 * fullnode ({@link HathorWallet}) and wallet-service
 * ({@link HathorWalletServiceWallet}) facades. Each test is self-contained: it
 * builds its own wallet(s), funds them, and creates its own token.
 *
 * Cross-facade notes:
 * - Both facades implement `createNFT()` and `createNewToken({ data })` through
 *   the same `prepareCreateNewToken` layout (fullnode: `src/new/wallet.ts`,
 *   service: `src/wallet/wallet.ts`): an NFT's data output comes first, a plain
 *   token's data outputs come last.
 * - The facades' `createNFT()` authority-creation defaults diverge; the adapter
 *   normalizes them (see {@link CreateNftAdapterOptions} in `adapters/types.ts`).
 * - Authority presence and routing are observed through
 *   `adapter.getAuthorityUtxos` rather than by parsing raw output scripts,
 *   keeping the assertions facade-agnostic.
 * - Both facades reject an external authority address without the explicit
 *   allow flag using the same "must belong to your wallet" message.
 */

import type { FuzzyWalletType, IWalletTestAdapter } from '../adapters/types';
import {
  AUTHORITY_TOKEN_DATA,
  NATIVE_TOKEN_UID,
  TOKEN_MINT_MASK,
  TOKEN_MELT_MASK,
} from '../../../src/constants';
import { AuthorityType } from '../../../src/types';
import { NftValidationError } from '../../../src/errors';
import { parseScriptData } from '../../../src/utils/scripts';
import Network from '../../../src/models/network';
import type CreateTokenTransaction from '../../../src/models/create_token_transaction';
import { FullnodeWalletTestAdapter } from '../adapters/fullnode.adapter';
import { ServiceWalletTestAdapter } from '../adapters/service.adapter';

const adapters: IWalletTestAdapter[] = [
  new FullnodeWalletTestAdapter(),
  new ServiceWalletTestAdapter(),
];

const sampleNftData =
  'ipfs://bafybeiccfclkdtucu6y4yc5cpr6y3yuinr67svmii46v5cfcrkp47ihehy/albums/QXBvbGxvIDEwIE1hZ2F6aW5lIDI3L04=/21716695748_7390815218_o.jpg';

const tokenBalance = (wallet: FuzzyWalletType, tokenUid: string): Promise<bigint> =>
  wallet.getBalance(tokenUid).then(b => b[0].balance.unlocked);

describe.each(adapters)('[Shared] createNFT & data outputs — $name', adapter => {
  beforeAll(async () => {
    await adapter.suiteSetup();
  });

  afterAll(async () => {
    await adapter.suiteTeardown();
  });

  describe('create token with data outputs', () => {
    it('should create a token with data outputs', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);

        const created = await adapter.createToken(wallet, 'Token with data outputs', 'DOUT', 100n, {
          data: ['test1', 'test2'],
        });

        // The last two outputs must be the data outputs, in creation order.
        const { outputs } = created.transaction;
        const lastOutput = outputs[outputs.length - 1];
        expect(lastOutput.value).toBe(1n);
        expect(lastOutput.tokenData).toBe(0);
        expect(parseScriptData(lastOutput.script).data).toBe('test2');

        const outputBeforeLast = outputs[outputs.length - 2];
        expect(outputBeforeLast.value).toBe(1n);
        expect(outputBeforeLast.tokenData).toBe(0);
        expect(parseScriptData(outputBeforeLast.script).data).toBe('test1');

        // A plain token with data outputs is not NFT-standard (its first output
        // is not a data output), so NFT validation must reject it.
        const createTokenTx = created.transaction as CreateTokenTransaction;
        expect(() => {
          createTokenTx.validateNft(new Network(adapter.networkName));
        }).toThrow(NftValidationError);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });
  });

  describe('createNFT', () => {
    it('should create an NFT with mint/melt authorities', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);

        const nft = await adapter.createNFT(wallet, 'New NFT', 'NNFT', 1n, sampleNftData, {
          createMint: true,
          createMelt: true,
        });
        expect(nft.hash).toHaveLength(64);
        expect(nft.transaction).toMatchObject({
          hash: nft.hash,
          name: 'New NFT',
          symbol: 'NNFT',
        });

        // 10n injected − 1n deposit − 1n NFT data-output fee = 8n.
        const htrBalance = await wallet.getBalance(NATIVE_TOKEN_UID);
        expect(htrBalance[0].balance.unlocked).toBe(8n);
        expect(await tokenBalance(wallet, nft.hash)).toBe(1n);

        // Creation left exactly one mint authority.
        let mintAuthorities = await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MINT);
        expect(mintAuthorities).toHaveLength(1);
        expect(mintAuthorities[0].txId).toBe(nft.hash);
        expect(mintAuthorities[0].authorities).toBe(TOKEN_MINT_MASK);

        // Minting more NFT units without keeping the authority consumes it.
        await adapter.mintTokens(wallet, nft.hash, 10n, { createAnotherMint: false });
        expect(await tokenBalance(wallet, nft.hash)).toBe(11n);
        mintAuthorities = await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MINT);
        expect(mintAuthorities).toHaveLength(0);

        // Creation left exactly one melt authority.
        let meltAuthorities = await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MELT);
        expect(meltAuthorities).toHaveLength(1);
        expect(meltAuthorities[0].txId).toBe(nft.hash);
        expect(meltAuthorities[0].authorities).toBe(TOKEN_MELT_MASK);

        // Melting NFT units without keeping the authority consumes it.
        await adapter.meltTokens(wallet, nft.hash, 5n, { createAnotherMelt: false });
        expect(await tokenBalance(wallet, nft.hash)).toBe(6n);
        meltAuthorities = await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MELT);
        expect(meltAuthorities).toHaveLength(0);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should create an NFT without authorities', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        await adapter.injectFunds(wallet, addr0, 10n);
        const destAddr = (await wallet.getAddressAtIndex(3))!;
        const changeAddr = (await wallet.getAddressAtIndex(4))!;

        const nft = await adapter.createNFT(wallet, 'New NFT 2', 'NNFT2', 1n, sampleNftData, {
          createMint: false,
          createMelt: false,
          address: destAddr,
          changeAddress: changeAddr,
        });
        expect(nft.hash).toHaveLength(64);

        // No authority outputs on the transaction...
        const authorityOutputs = nft.transaction.outputs.filter(
          o => o.tokenData === AUTHORITY_TOKEN_DATA
        );
        expect(authorityOutputs).toHaveLength(0);

        // ...and no indexed authority UTXOs of either type.
        expect(await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MINT)).toHaveLength(
          0
        );
        expect(await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MELT)).toHaveLength(
          0
        );

        // The NFT unit went to the chosen destination address.
        const fullTx = await adapter.getTx(wallet, nft.hash);
        const nftOutput = fullTx.outputs.find(o => o.token === nft.hash);
        expect(nftOutput).toHaveProperty('decoded.address', destAddr);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should route mint/melt authorities to chosen wallet addresses', async () => {
      const { wallet } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        const mintAuthorityAddr = (await wallet.getAddressAtIndex(10))!;
        const meltAuthorityAddr = (await wallet.getAddressAtIndex(11))!;
        await adapter.injectFunds(wallet, addr0, 10n);

        const nft = await adapter.createNFT(wallet, 'New Token', 'NTKN', 100n, sampleNftData, {
          createMint: true,
          mintAuthorityAddress: mintAuthorityAddr,
          createMelt: true,
          meltAuthorityAddress: meltAuthorityAddr,
        });

        // Exactly one mint plus one melt authority output on the creation tx.
        const authorityOutputs = nft.transaction.outputs.filter(
          o => o.tokenData === AUTHORITY_TOKEN_DATA
        );
        expect(authorityOutputs).toHaveLength(2);

        // The mint authority landed on the chosen address.
        const mintAuthorities = await adapter.getAuthorityUtxos(
          wallet,
          nft.hash,
          AuthorityType.MINT,
          { filter_address: mintAuthorityAddr }
        );
        expect(mintAuthorities).toHaveLength(1);
        expect(mintAuthorities[0].address).toBe(mintAuthorityAddr);
        expect(mintAuthorities[0].authorities).toBe(TOKEN_MINT_MASK);

        // The melt authority landed on the chosen address.
        const meltAuthorities = await adapter.getAuthorityUtxos(
          wallet,
          nft.hash,
          AuthorityType.MELT,
          { filter_address: meltAuthorityAddr }
        );
        expect(meltAuthorities).toHaveLength(1);
        expect(meltAuthorities[0].address).toBe(meltAuthorityAddr);
        expect(meltAuthorities[0].authorities).toBe(TOKEN_MELT_MASK);

        expect(await tokenBalance(wallet, nft.hash)).toBe(100n);
      } finally {
        await adapter.stopWallet(wallet);
      }
    });

    it('should reject external mint/melt authority addresses unless explicitly allowed', async () => {
      const { wallet } = await adapter.createWallet();
      const { wallet: external } = await adapter.createWallet();
      try {
        const addr0 = (await wallet.getAddressAtIndex(0))!;
        const externalMintAddr = (await external.getAddressAtIndex(0))!;
        const externalMeltAddr = (await external.getAddressAtIndex(1))!;
        await adapter.injectFunds(wallet, addr0, 10n);

        // Both facades reject an external authority address without the allow
        // flag using the same "must belong to your wallet" message.
        await expect(
          adapter.createNFT(wallet, 'New Token', 'NTKN', 100n, sampleNftData, {
            createMint: true,
            mintAuthorityAddress: externalMintAddr,
          })
        ).rejects.toThrow(/mint authority address must belong to your wallet/);

        await expect(
          adapter.createNFT(wallet, 'New Token', 'NTKN', 100n, sampleNftData, {
            createMelt: true,
            meltAuthorityAddress: externalMeltAddr,
          })
        ).rejects.toThrow(/melt authority address must belong to your wallet/);

        // With the allow flags, creation succeeds and the authorities land on
        // the external wallet's addresses.
        const nft = await adapter.createNFT(wallet, 'New Token', 'NTKN', 100n, sampleNftData, {
          createMint: true,
          mintAuthorityAddress: externalMintAddr,
          allowExternalMintAuthorityAddress: true,
          createMelt: true,
          meltAuthorityAddress: externalMeltAddr,
          allowExternalMeltAuthorityAddress: true,
          recvWallet: external,
        });

        const authorityOutputs = nft.transaction.outputs.filter(
          o => o.tokenData === AUTHORITY_TOKEN_DATA
        );
        expect(authorityOutputs).toHaveLength(2);

        // The creating wallet holds no authorities...
        expect(await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MINT)).toHaveLength(
          0
        );
        expect(await adapter.getAuthorityUtxos(wallet, nft.hash, AuthorityType.MELT)).toHaveLength(
          0
        );

        // ...they landed at the external wallet's target addresses.
        const externalMint = await adapter.getAuthorityUtxos(
          external,
          nft.hash,
          AuthorityType.MINT,
          { filter_address: externalMintAddr }
        );
        expect(externalMint).toHaveLength(1);
        expect(externalMint[0].address).toBe(externalMintAddr);
        expect(externalMint[0].authorities).toBe(TOKEN_MINT_MASK);

        const externalMelt = await adapter.getAuthorityUtxos(
          external,
          nft.hash,
          AuthorityType.MELT,
          { filter_address: externalMeltAddr }
        );
        expect(externalMelt).toHaveLength(1);
        expect(externalMelt[0].address).toBe(externalMeltAddr);
        expect(externalMelt[0].authorities).toBe(TOKEN_MELT_MASK);

        // The token amount stayed with the creating wallet.
        expect(await tokenBalance(wallet, nft.hash)).toBe(100n);
      } finally {
        await adapter.stopWallet(wallet);
        await adapter.stopWallet(external);
      }
    });
  });
});
