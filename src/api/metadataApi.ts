/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import explorerServiceAxios from './explorerServiceAxios';

const metadataApi = {
  async getDagMetadata(id: string, network: string) {
    const axios = await explorerServiceAxios(network);
    return axios.get(`metadata/dag`, { params: { id }});
  }
};

export default metadataApi;