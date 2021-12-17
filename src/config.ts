import networkInstance from './network';
import Network from './models/network';
import storage from './storage';


// Default server user will connect when none have been chosen
export const DEFAULT_SERVER = 'https://node1.mainnet.hathor.network/v1a/';

// Base URL for the tx mining api
const TX_MINING_MAINNET_URL = 'https://txmining.mainnet.hathor.network/';
const TX_MINING_TESTNET_URL = 'https://txmining.testnet.hathor.network/';

// Wallet service URLs
const WALLET_SERVICE_MAINNET_BASE_URL  = 'https://wallet-service.hathor.network/';
const WALLET_SERVICE_TESTNET_BASE_URL  = 'https://wallet-service.testnet.hathor.network/';

// Wallet service Websocket URLs
const WALLET_SERVICE_MAINNET_WS_BASE_URL  = 'wss://ws.wallet-service.hathor.network/';
const WALLET_SERVICE_TESTNET_WS_BASE_URL  = 'wss://ws.wallet-service.testnet.hathor.network/';

// Explorer service URL
const EXPLORER_SERVICE_MAINNET_BASE_URL  = 'https://explorer-service.hathor.network/';
const EXPLORER_SERVICE_TESTNET_BASE_URL  = 'https://explorer-service.testnet.hathor.network/';

class Config {
    TX_MINING_URL?: string;
    WALLET_SERVICE_BASE_URL?: string;
    WALLET_SERVICE_WS_BASE_URL?: string;
    EXPLORER_SERVICE_BASE_URL?: string;
    SERVER_URL?: string;

    /**
    * Sets the tx mining service url that will be returned by the config object.
    *
    * @param {string} url - The url to be set
    */
    setTxMiningUrl(url: string) {
        this.TX_MINING_URL = url;
    }

    /**
     * Returns the correct base url constant for tx mining.
     * If the url was explicitly set using the config object, it is always returned.
     * Otherwise, we return it based on the network set with networkInstance.
     *
     * @return {string} The tx mining service url
     */
    getTxMiningUrl() {
        if (this.TX_MINING_URL) {
            return this.TX_MINING_URL;
        }

        // Keeps the old behavior for cases that don't explicitly set a TX_MINING_URL
        if (networkInstance.name == 'mainnet') {
            return TX_MINING_MAINNET_URL;
        } else if (networkInstance.name == 'testnet') {
            return TX_MINING_TESTNET_URL;
        } else {
            throw new Error(`Network ${networkInstance.name} doesn't have a correspondent tx mining service url. You should set it explicitly.`);
        }
    }

    /**
    * Sets the wallet service url that will be returned by the config object.
    *
    * @param {string} url - The url to be set
    */
    setWalletServiceBaseUrl(url: string) {
        this.WALLET_SERVICE_BASE_URL = url;
    }

    /**
     * Returns the correct base url constant for wallet service.
     * If the url was explicitly set using the config object, it is always returned.
     * Otherwise, we return it based on the provided network object.
     *
     * @param {Network} network The network, can be either mainnet or testnet
     * @return {string} The wallet service url
     */
    getWalletServiceBaseUrl(network?: Network) {
        if (this.WALLET_SERVICE_BASE_URL) {
            return this.WALLET_SERVICE_BASE_URL;
        }

        if (!network) {
            throw new Error('You should either provide a network or call setWalletServiceBaseUrl before calling this.');
        }

        // Keeps the old behavior for cases that don't explicitly set a WALLET_SERVICE_BASE_URL
        if (network.name == 'mainnet') {
            return WALLET_SERVICE_MAINNET_BASE_URL;
        } else if (network.name == 'testnet'){
            return WALLET_SERVICE_TESTNET_BASE_URL;
        } else {
            throw new Error(`Network ${network.name} doesn't have a correspondent wallet service url. You should set it explicitly.`);
        }
    }

    /**
     * Returns the correct websocket base url constant for wallet service.
     * If the url was explicitly set using the config object, it is always returned.
     * Otherwise, we return it based on the provided network object.
     *
     * @param {Network} network The network, can be either mainnet or testnet
     * @return {string} The wallet service websocket url
     */
    getWalletServiceBaseWsUrl(network?: Network) {
        if (this.WALLET_SERVICE_WS_BASE_URL) {
            return this.WALLET_SERVICE_WS_BASE_URL;
        }

        if (!network) {
            throw new Error('You should either provide a network or call setWalletServiceBaseUrl before calling this.');
        }

        // Keeps the old behavior for cases that don't explicitly set a WALLET_SERVICE_BASE_WS_URL
        if (network.name == 'mainnet') {
            return WALLET_SERVICE_MAINNET_WS_BASE_URL;
        } else if (network.name == 'testnet'){
            return WALLET_SERVICE_TESTNET_WS_BASE_URL;
        } else {
            throw new Error(`Network ${network.name} doesn't have a correspondent wallet service websocket url. You should set it explicitly.`);
        }
    }

    /**
    * Sets the explorer service url that will be returned by the config object.
    *
    * @param {string} url - The url to be set
    */
    setExplorerServiceBaseUrl(url: string) {
        this.EXPLORER_SERVICE_BASE_URL = url;
    }

    /**
    * Returns the correct base url constant for explorer service.
    * If the url was explicitly set using the config object, it is always returned.
    * Otherwise, we return it based on the provided network object.
    *
    * If the url was not set in the config, and no network is provided, we throw an Error.
    *
    * @param {string} network - The name of the network to be used to select the url.
    * @return {string} The explorer service url
    */
    getExplorerServiceBaseUrl(network: string) {
        if (this.EXPLORER_SERVICE_BASE_URL) {
            return this.EXPLORER_SERVICE_BASE_URL;
        }

        if (!network) {
            throw new Error('You should either provide a network or call setExplorerServiceBaseUrl before calling this.');
        }

        // Keeps the old behavior for cases that don't explicitly set a EXPLORER_SERVICE_BASE_URL
        if (network == 'mainnet') {
            return EXPLORER_SERVICE_MAINNET_BASE_URL;
        } else if (network == 'testnet'){
            return EXPLORER_SERVICE_TESTNET_BASE_URL;
        } else {
            throw new Error(`Network ${network} doesn't have a correspondent explorer service url. You should set it explicitly.`);
        }
    }

    /**
    * Sets the fullnode server url that will be returned by the config object.
    *
    * @param {string} url - The url to be set
    */
    setServerUrl(url: string) {
        this.SERVER_URL = url;
    }

    /**
     * Get the server URL that the wallet is connected.
     *
     * There is more than one method of setting this.
     * The priority will be given to the url set using the config object.
     * If not set, we look next into the storage object keys.
     * If still not set, the default url is returned
     *
     * @return {string} Server URL according to the priority described above
     */
    getServerUrl() {
        if (this.SERVER_URL) {
            return this.SERVER_URL;
        }

        if (storage.isInitialized()) {
            const server = storage.getItem('wallet:server');
            const defaultServer = storage.getItem('wallet:defaultServer');

            if (server !== null) {
                return server;
            } else if (defaultServer !== null) {
                return defaultServer
            }
        }

        return DEFAULT_SERVER;
    }

}

const instance = new Config();

export default instance;
