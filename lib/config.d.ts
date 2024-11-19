import Network from './models/network';
export declare const DEFAULT_SERVER = "https://node1.mainnet.hathor.network/v1a/";
export declare const SWAP_SERVICE_MAINNET_BASE_URL = "https://atomic-swap-service.hathor.network/";
export declare const SWAP_SERVICE_TESTNET_BASE_URL = "https://atomic-swap-service.testnet.hathor.network/";
export declare class Config {
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
    setTxMiningUrl(url: string): void;
    /**
     * Returns the correct base url constant for tx mining.
     * If the url was explicitly set using the config object, it is always returned.
     * Otherwise, we return it based on the network set with networkInstance.
     *
     * @return The tx mining service url
     */
    getTxMiningUrl(): string;
    /**
     * Sets the tx mining service api key that will be returned by the config object.
     *
     * @param apiKey - The api key to be set
     */
    setTxMiningApiKey(apiKey: string): void;
    /**
     * Gets the configured api key for tx-mining-service
     *
     * @returns The api key
     */
    getTxMiningApiKey(): string | undefined;
    /**
     * Sets the wallet service url that will be returned by the config object.
     *
     * @param url - The url to be set
     */
    setWalletServiceBaseUrl(url: string): void;
    /**
     * Returns the base url for wallet service set previously using setWalletServiceBaseUrl
     *
     * Throws an error if it is not yet set.
     *
     * @return The wallet service url
     */
    getWalletServiceBaseUrl(): string;
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
    getSwapServiceBaseUrl(network?: 'mainnet' | 'testnet'): string;
    /**
     * Sets the swap service url that will be returned by the config object.
     *
     * @param url - The url to be set
     */
    setSwapServiceBaseUrl(url: string): void;
    /**
     * Returns the correct websocket base url constant for wallet service.
     *
     * If it is not set, throw an error.
     *
     * @return The wallet service websocket url
     */
    getWalletServiceBaseWsUrl(): string;
    /**
     * Sets the wallet service websocket url that will be returned by the config object.
     *
     * @param url - The url to be set
     */
    setWalletServiceBaseWsUrl(url: string): void;
    /**
     * Sets the explorer service url that will be returned by the config object.
     *
     * @param url - The url to be set
     */
    setExplorerServiceBaseUrl(url: string): void;
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
    getExplorerServiceBaseUrl(network: string): string;
    /**
     * Sets the fullnode server url that will be returned by the config object.
     *
     * @param url - The url to be set
     */
    setServerUrl(url: string): void;
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
    getServerUrl(): string;
    /**
     * Sets the current network the wallet is connected to
     */
    setNetwork(network: string): void;
    /**
     * Gets the current network
     *
     * There is more than one method of setting this.
     * The priority will be given to the network set using the config object.
     * If not set, we look next into the storage object keys.
     * If still not set, the default url is returned
     */
    getNetwork(): Network;
    /**
     * Sets the user agent to be set in all requests
     */
    setUserAgent(userAgent: string): void;
    /**
     * Gets the user agent
     */
    getUserAgent(): string | undefined;
}
declare const instance: Config;
export default instance;
//# sourceMappingURL=config.d.ts.map