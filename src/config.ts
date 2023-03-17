import networkInstance from './network';
import Network from './models/network';
import { GetWalletServiceUrlError, GetWalletServiceWsUrlError } from './errors';


// Default server and network user will connect when none have been chosen
export const DEFAULT_SERVER = 'https://node1.mainnet.hathor.network/v1a/';
const DEFAULT_NETWORK = new Network('mainnet');

// Base URL for the tx mining api
const TX_MINING_MAINNET_URL = 'https://txmining.mainnet.hathor.network/';
const TX_MINING_TESTNET_URL = 'https://txmining.testnet.hathor.network/';

// Explorer service URL
const EXPLORER_SERVICE_MAINNET_BASE_URL  = 'https://explorer-service.hathor.network/';
const EXPLORER_SERVICE_TESTNET_BASE_URL  = 'https://explorer-service.testnet.hathor.network/';

// Atomic Swap Service URL
export const SWAP_SERVICE_MAINNET_BASE_URL  = 'https://atomic-swap-service.hathor.network/';
export const SWAP_SERVICE_TESTNET_BASE_URL  = 'https://atomic-swap-service.testnet.hathor.network/';

export class Config {
  TX_MINING_URL?: string;
  TX_MINING_API_KEY?: string;
  SWAP_SERVICE_BASE_URL?: string;
  WALLET_SERVICE_BASE_URL?: string;
  WALLET_SERVICE_BASE_WS_URL?: string;
  EXPLORER_SERVICE_BASE_URL?: string;
  SERVER_URL?: string;
  NETWORK?: string;
  USER_AGENT?: string;

  /**
   * Sets the tx mining service url that will be returned by the config object.
   *
   * @param url - The url to be set
   */
  setTxMiningUrl(url: string) {
    this.TX_MINING_URL = url;
  }

  /**
   * Returns the correct base url constant for tx mining.
   * If the url was explicitly set using the config object, it is always returned.
   * Otherwise, we return it based on the network set with networkInstance.
   *
   * @return The tx mining service url
   */
  getTxMiningUrl(): string {
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
   * Sets the tx mining service api key that will be returned by the config object.
   *
   * @param apiKey - The api key to be set
   */
  setTxMiningApiKey(apiKey: string) {
    this.TX_MINING_API_KEY = apiKey;
  }

  /**
   * Gets the configured api key for tx-mining-service
   *
   * @returns The api key
   */
  getTxMiningApiKey(): string | undefined {
    return this.TX_MINING_API_KEY;
  }

  /**
   * Sets the wallet service url that will be returned by the config object.
   *
   * @param url - The url to be set
   */
  setWalletServiceBaseUrl(url: string): void {
    this.WALLET_SERVICE_BASE_URL = url;
  }

  /**
   * Returns the base url for wallet service set previously using setWalletServiceBaseUrl
   *
   * Throws an error if it is not yet set.
   *
   * @return The wallet service url
   */
  getWalletServiceBaseUrl(): string {
    if (!this.WALLET_SERVICE_BASE_URL) {
      throw new GetWalletServiceUrlError('Wallet service base URL not set.');
    }

    return this.WALLET_SERVICE_BASE_URL;
  }

  /**
   * Returns the correct base url constant for the Atomic Swap Service.
   * If the url was explicitly set using the config object, it is always returned.
   * Otherwise, we return it based on the provided network parameter.
   *
   * If the url was not set in the config, and no network is provided, we throw an Error.
   *
   * @param network - The name of the network to be used to select the url.
   * @throws {Error} When `network` is not 'mainnet' or 'testnet'
   * @throws {Error} When `network` is not provided neither by `setSwapServiceBaseUrl` nor parameter
   * @return The Atomic Swap Service url
   */
  getSwapServiceBaseUrl(network?: 'mainnet'|'testnet'): string {
    if (this.SWAP_SERVICE_BASE_URL) {
      return this.SWAP_SERVICE_BASE_URL;
    }

    if (!network) {
      throw new Error('You should either provide a network or call setSwapServiceBaseUrl before calling this.');
    }

    // Keeps the old behavior for cases that don't explicitly set a SWAP_SERVICE_BASE_URL
    if (network == 'mainnet') {
      return SWAP_SERVICE_MAINNET_BASE_URL;
    } else if (network == 'testnet'){
      return SWAP_SERVICE_TESTNET_BASE_URL;
    } else {
      throw new Error(`Network ${network} doesn't have a correspondent Atomic Swap Service url. You should set it explicitly by calling setSwapServiceBaseUrl.`);
    }
  }

  /**
   * Sets the swap service url that will be returned by the config object.
   *
   * @param url - The url to be set
   */
  setSwapServiceBaseUrl(url: string): void {
    this.SWAP_SERVICE_BASE_URL = url;
  }

  /**
   * Returns the correct websocket base url constant for wallet service.
   *
   * If it is not set, throw an error.
   *
   * @return The wallet service websocket url
   */
  getWalletServiceBaseWsUrl(): string {
    if (!this.WALLET_SERVICE_BASE_WS_URL) {
      throw new GetWalletServiceWsUrlError('Wallet service base WebSocket URL not set.');
    }

    return this.WALLET_SERVICE_BASE_WS_URL;
  }

  /**
   * Sets the wallet service websocket url that will be returned by the config object.
   *
   * @param url - The url to be set
   */
  setWalletServiceBaseWsUrl(url: string): void {
    this.WALLET_SERVICE_BASE_WS_URL = url;
  }

  /**
   * Sets the explorer service url that will be returned by the config object.
   *
   * @param url - The url to be set
   */
  setExplorerServiceBaseUrl(url: string): void {
    this.EXPLORER_SERVICE_BASE_URL = url;
  }

  /**
   * Returns the correct base url constant for explorer service.
   * If the url was explicitly set using the config object, it is always returned.
   * Otherwise, we return it based on the provided network object.
   *
   * If the url was not set in the config, and no network is provided, we throw an Error.
   *
   * @param network - The name of the network to be used to select the url.
   * @return The explorer service url
   */
  getExplorerServiceBaseUrl(network: string): string {
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
   * @param url - The url to be set
   */
  setServerUrl(url: string): void {
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
   * @return Server URL according to the priority described above
   */
  getServerUrl(): string {
    if (this.SERVER_URL) {
      return this.SERVER_URL;
    }

    return DEFAULT_SERVER;
  }

  /**
   * Sets the current network the wallet is connected to
   */
  setNetwork(network: string): void {
    /* Until we replace the network singleton with the new config singleton, we need to
     * maintain reverse compatibility as there are multiple use cases using the lib with
     * the network singleton
     *
     * TODO: Remove this when the network singleton is completely deprecated
     */
    networkInstance.setNetwork(network, true);

    this.NETWORK = network;
  }

  /**
   * Gets the current network
   *
   * There is more than one method of setting this.
   * The priority will be given to the network set using the config object.
   * If not set, we look next into the storage object keys.
   * If still not set, the default url is returned
   */
  getNetwork(): Network {
    if (this.NETWORK) {
      return new Network(this.NETWORK);
    }

    return DEFAULT_NETWORK;
  }

  /**
   * Sets the user agent to be set in all requests
   */
  setUserAgent(userAgent: string): void {
    this.USER_AGENT = userAgent;
  }

  /**
   * Gets the user agent
   */
  getUserAgent(): string | undefined {
    return this.USER_AGENT;
  }
}

const instance = new Config();

export default instance;
