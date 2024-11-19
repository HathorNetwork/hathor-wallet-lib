/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
type MetadataApiResponse = {
    id: string;
    nft?: boolean;
    banned?: boolean;
    verified?: boolean;
    reason?: string;
    nft_media?: {
        file: string;
        type: string;
        loop: boolean;
        autoplay: boolean;
        mime_type?: string;
    };
};
declare const metadataApi: {
    /**
     * Returns the Dag Metadata for a given transaction id
     * @param id Tx Identifier
     * @param network Network name
     * @param options
     * @param [options.retries] Number of retries that the method will attempt before rejecting
     * @param [options.retryInterval] Interval, in miliseconds, between each attempt
     */
    getDagMetadata(id: string, network: string, options?: {
        retries?: number;
        retryInterval?: number;
    }): Promise<MetadataApiResponse | null>;
};
export default metadataApi;
//# sourceMappingURL=metadataApi.d.ts.map