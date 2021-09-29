import networkInstance from './network';
import { TX_MINING_URL, TX_MINING_TESTNET_URL } from './constants';

class Config {
    TX_MINING_URL?: string;

    setTxMiningUrl(url) {
        this.TX_MINING_URL = url;
    }

    getTxMiningUrl() {
        if (this.TX_MINING_URL) {
            return this.TX_MINING_URL;
        }

        // Keeps the old behavior for cases that don't explicitly set a TX_MINING_URL
        if (networkInstance.name == 'mainnet') {
            return TX_MINING_URL;
        } else {
            return TX_MINING_TESTNET_URL;
        }
    }
}

const instance = new Config();

export default instance; 