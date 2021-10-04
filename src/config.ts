import networkInstance from './network';
import Network from './models/network';
import storage from './storage';

import { DEFAULT_SERVER } from './constants';


// TODO: Check if those variables need to stay in constants.js (Are they imported from some project?)

// Base URL for the tx mining api
const TX_MINING_MAINNET_URL = 'https://txmining.mainnet.hathor.network/';
const TX_MINING_TESTNET_URL = 'https://txmining.testnet.hathor.network/';

// Wallet service URL
const WALLET_SERVICE_MAINNET_BASE_URL  = 'https://wallet-service.hathor.network/';
const WALLET_SERVICE_TESTNET_BASE_URL  = 'https://wallet-service.testnet.hathor.network/';

// Explorer service URL
const EXPLORER_SERVICE_MAINNET_BASE_URL  = 'https://explorer-service.hathor.network/';
const EXPLORER_SERVICE_TESTNET_BASE_URL  = 'https://explorer-service.testnet.hathor.network/';

class Config {
    TX_MINING_URL?: string;
    WALLET_SERVICE_BASE_URL?: string;
    EXPLORER_SERVICE_BASE_URL?: string;
    SERVER_URL?: string;

    setTxMiningUrl(url: string) {
        this.TX_MINING_URL = url;
    }

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

    setWalletServiceBaseUrl(url: string) {
        this.WALLET_SERVICE_BASE_URL = url;
    }

    /**
     * Returns the correct base url constant for wallet service.
     * If the url was explicitly set, it is always returned as set.
     * Otherwise, we return it based on the provided network object.
     *
     * @param {Network} network The network, can be either mainnet or testnet
     */
    getWalletServiceBaseUrl(network?: Network) {
        if (this.WALLET_SERVICE_BASE_URL) {
            return this.WALLET_SERVICE_BASE_URL;
        }

        if (!network) {
            throw new Error("You should either provide a network or call setWalletServiceBaseUrl before calling this.")
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

    setExplorerServiceBaseUrl(url: string) {
        this.EXPLORER_SERVICE_BASE_URL = url;
    }

    getExplorerServiceBaseUrl(network: string) {
        if (this.EXPLORER_SERVICE_BASE_URL) {
            return this.EXPLORER_SERVICE_BASE_URL;
        }

        if (!network) {
            throw new Error("You should either provide a network or call setExplorerServiceBaseUrl before calling this.")
        }

        // Keeps the old behavior for cases that don't explicitly set a WALLET_SERVICE_BASE_URL
        if (network == 'mainnet') {
            return EXPLORER_SERVICE_MAINNET_BASE_URL;
        } else if (network == 'testnet'){
            return EXPLORER_SERVICE_TESTNET_BASE_URL;
        } else {
            throw new Error(`Network ${network} doesn't have a correspondent explorer service url. You should set it explicitly.`);
        }
    }

    setServerUrl(url: string) {
        this.SERVER_URL = url;
    }

    /**
     * Get the server URL that the wallet is connected
     *
     * If a server was not selected, returns the default one
     *
     * @return {string} Server URL
     *
     * @memberof Helpers
     * @inner
     */
    getServerUrl() {
        if (this.SERVER_URL) {
            return this.SERVER_URL;
        }

        const server = storage.getItem('wallet:server');
        const defaultServer = storage.getItem('wallet:defaultServer');

        if (server !== null) {
            return server;
        } else if (defaultServer !== null) {
            return defaultServer
        } else {
            return DEFAULT_SERVER;
        }
    }

}

const instance = new Config();

export default instance; 