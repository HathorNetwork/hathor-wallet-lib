/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { IMultisigData, IWalletAccessData } from '../types';
declare const wallet: {
    /**
     * Get the wallet id given the change path xpubkey
     *
     * @param {string} xpub - The change path xpubkey
     * @returns {string} The walletId
     *
     * @memberof Wallet
     * @inner
     */
    getWalletIdFromXPub(xpub: string): string;
    /**
     * Verify if words passed to generate wallet are valid. In case of invalid, returns message
     *
     * @param {string} words Words (separated by space) to generate the HD Wallet seed
     *
     * @return {Object} {'valid': boolean, 'words': string} where 'words' is a cleaned
     * string with the words separated by a single space
     * @throws {InvalidWords} In case the words string is invalid. The error object will have
     * an invalidWords attribute with an array of words that are not valid.
     *
     * @memberof Wallet
     * @inner
     */
    wordsValid(words: string): {
        valid: boolean;
        words: string;
    };
    /**
     * Generate HD wallet words
     *
     * @param {number} entropy Data to generate the HD Wallet seed - entropy (256 - to generate 24 words)
     *
     * @return {string} words generated
     * @memberof Wallet
     * @inner
     */
    generateWalletWords(entropy?: number): string;
    /**
     * Get xpub from data
     *
     * @param {Buffer} pubkey Compressed public key
     * @param {Buffer} chainCode HDPublic key chaincode
     * @param {Buffer} fingerprint parent fingerprint
     * @param {string} networkName Optional parameter to select the used network (default is mainnet)
     *
     * @return {String} Xpub
     *
     * @memberof Wallet
     * @inner
     */
    xpubFromData(pubkey: Buffer, chainCode: Buffer, fingerprint: Buffer, networkName?: string): string;
    /**
     * Get compressed public key from uncompressed
     *
     * @param {Buffer} pubkey Uncompressed public key
     *
     * @return {Buffer} Compressed public key
     * @throws {UncompressedPubKeyError} In case the given public key is invalid
     *
     * @memberof Wallet
     * @inner
     */
    toPubkeyCompressed(pubkey: Buffer): Buffer;
    /**
     * Get public key for specific key index derivation.
     * We expect to receive the xpub after the derivation and the index to get the public key
     * Example: to get the public key of the path m/44'/280/0'/0/{index}
     * you must send in this method the xpubkey from m/44'/280/0'/0 and the index you want to derive
     *
     * @param {String} xpubkey Xpub of the path before the last derivation
     * @param {number?} index Index of the key to derive, if not present no derivation will be made.
     *
     * @return {Object} Public key object
     * @throws {XPubError} In case the given xpub key is invalid
     *
     * @memberof Wallet
     * @inner
     */
    getPublicKeyFromXpub(xpubkey: string, index?: number): PublicKey;
    /**
     * Get xpubkey from xpriv
     *
     * @param {String} xpriv Private key
     *
     * @return {String} Wallet xpubkey
     * @memberof Wallet
     * @inner
     */
    getXPubKeyFromXPrivKey(xpriv: string): string;
    /**
     * Get xpubkey in account derivation path from seed
     *
     * @param {String} seed 24 words
     * @param {Object} options Options with passphrase, networkName and accountDerivationIndex
     *
     * @return {String} Wallet xpubkey
     * @memberof Wallet
     * @inner
     */
    getXPubKeyFromSeed(seed: string, options?: {
        passphrase?: string;
        networkName?: string;
        accountDerivationIndex?: string;
    }): string;
    /**
     * Get root privateKey from seed
     *
     * TODO: Change method name as we are not returning a xpriv
     *
     * @param {String} seed 24 words
     * @param {Object} options Options with passphrase, networkName
     *
     * @return {HDPrivateKey} Root HDPrivateKey
     * @memberof Wallet
     * @inner
     */
    getXPrivKeyFromSeed(seed: string, options?: {
        passphrase?: string;
        networkName?: string;
    }): HDPrivateKey;
    /**
     * Derive xpriv from root to account derivation path
     *
     * TODO: Method name is misleading as we are returning a HDPrivateKey and not a xpriv, we should change it
     *
     * @param {string} accountDerivationIndex String with derivation index of account (can be hardened)
     *
     * @return {HDPrivateKey} Derived private key
     * @memberof Wallet
     * @inner
     */
    deriveXpriv(xpriv: HDPrivateKey, accountDerivationIndex: string): HDPrivateKey;
    /**
     * Validate an xpubkey.
     *
     * @param {string} xpubkey The xpubkey
     *
     * @return {boolean} true if it's a valid xpubkey, false otherwise
     * @memberof Wallet
     * @inner
     */
    isXpubKeyValid(xpubkey: string): boolean;
    /**
     * Derive next step of child from xpub
     *
     * @param {string} xpubkey The xpubkey
     * @param {number} derivationIndex Index to derive the xpub
     *
     * @return {string} Derived xpub
     * @throws {XPubError} In case the given xpub key is invalid
     * @memberof Wallet
     * @inner
     */
    xpubDeriveChild(xpubkey: string, derivationIndex: number): string;
    /**
     * Create a P2SH MultiSig redeem script
     *
     * @param {string[]} xpubs The list of xpubkeys involved in this MultiSig
     * @param {number} numSignatures Minimum number of signatures to send a
     * transaction with this MultiSig
     * @param {number} index Index to derive the xpubs
     *
     * @return {Buffer} A buffer with the redeemScript
     * @throws {XPubError} In case any of the given xpubs are invalid
     * @memberof Wallet
     * @inner
     */
    createP2SHRedeemScript(xpubs: string[], numSignatures: number, index: number): Buffer;
    /**
     * Create a P2SH MultiSig input data from the signatures and redeemScript
     *
     * @param {Buffer[]} signatures The list of signatures collected from participants.
     * @param {Buffer} redeemScript The redeemScript as a Buffer
     *
     * @return {Buffer} A buffer with the input data to send.
     * @memberof Wallet
     * @inner
     */
    getP2SHInputData(signatures: Buffer[], redeemScript: Buffer): Buffer;
    /**
     * Create an HDPublicKey on P2SH MultiSig account path from the root xpriv
     *
     * @param {HDPrivateKey} xpriv HD private key used to derive the multisig xpub.
     *
     * @return {string} xpubkey at MultiSig account path
     * @memberof Wallet
     * @inner
     */
    getMultiSigXPubFromXPriv(xpriv: HDPrivateKey): string;
    /**
     * Create an HDPublicKey on P2SH MultiSig account path from the seed
     *
     * @param {string} seed space separated list of words to use as seed.
     * @param {Object} options Optionally inform passphrase and network (defaults to no passphrase and mainnet).
     *
     * @return {string} xpubkey at MultiSig account path
     * @memberof Wallet
     * @inner
     */
    getMultiSigXPubFromWords(seed: string, options?: {
        passphrase?: string;
        networkName?: string;
    }): string;
    /**
     * Generate access data from xpubkey.
     * The access data will be used to start a wallet and derive the wallet's addresses.
     * This method can only generate READONLY wallets since we do not have the private key.
     *
     * We can only accept xpubs derived to the account or change path.
     * Since hdpublickeys cannot derive on hardened paths, the derivation must be done previously with the private key
     * The last path with hardened derivation defined on bip44 is the account path so we support using an account path xpub.
     * We can also use the change path xpub since we use it to derive the addresses
     * but we cannot use the address path xpub since we won't be able to derive all addresses.
     * And the wallet-lib currently does not support the creation of a wallet with a single address.
     *
     * @param {string} xpubkey HDPublicKey in string format.
     * @param {Object} [options={}] Options to generate the access data.
     * @param {IMultisigData|undefined} [options.multisig=undefined] MultiSig data of the wallet
     * @param {boolean} [options.hardware=false] If the wallet is a hardware wallet
     * @returns {IWalletAccessData}
     */
    generateAccessDataFromXpub(xpubkey: string, { multisig, hardware }?: {
        multisig?: IMultisigData;
        hardware?: boolean;
    }): IWalletAccessData;
    /**
     * Generate access data from the xprivkey.
     * We can use either the root xprivkey or the change path xprivkey.
     * Obs: A multisig wallet cannot be started with a change path xprivkey.
     *
     * The seed can be passed so we save it on the storage, even if its not used.
     * Obs: must also pass password to encrypt the seed.
     *
     * @param {string} xprivkey
     * @param {Object} options
     * @param {IMultisigData | undefined} [options.multisig=undefined]
     * @param {string} [options.pin]
     * @param {string | undefined} [options.seed=undefined]
     * @param {string | undefined} [options.password=undefined]
     * @param {string | undefined} [options.authXpriv=undefined]
     * @returns {IWalletAccessData}
     */
    generateAccessDataFromXpriv(xprivkey: string, { multisig, pin, seed, password, authXpriv, }: {
        multisig?: IMultisigData;
        pin: string;
        seed?: string;
        password?: string;
        authXpriv?: string;
    }): IWalletAccessData;
    generateAccessDataFromSeed(words: string, { multisig, passphrase, pin, password, networkName, }: {
        multisig?: IMultisigData;
        pin: string;
        password: string;
        passphrase?: string;
        networkName: string;
    }): IWalletAccessData;
    /**
     * Change the encryption pin on the fields that are encrypted using the pin.
     * Will not save the access data, only return the new access data.
     *
     * @param {IWalletAccessData} accessData The current access data encrypted with `oldPin`.
     * @param {string} oldPin Used to decrypt the old access data.
     * @param {string} newPin Encrypt the fields with this pin.
     * @returns {IWalletAccessData} The access data with fields encrypted with `newPin`.
     */
    changeEncryptionPin(accessData: IWalletAccessData, oldPin: string, newPin: string): IWalletAccessData;
    /**
     * Change the encryption password on the seed.
     * Will not save the access data, only return the new access data.
     *
     * @param {IWalletAccessData} accessData The current access data encrypted with `oldPassword`.
     * @param {string} oldPassword Used to decrypt the old access data.
     * @param {string} newPassword Encrypt the seed with this password.
     * @returns {IWalletAccessData} The access data with fields encrypted with `newPassword`.
     */
    changeEncryptionPassword(accessData: IWalletAccessData, oldPassword: string, newPassword: string): IWalletAccessData;
};
export default wallet;
//# sourceMappingURL=wallet.d.ts.map