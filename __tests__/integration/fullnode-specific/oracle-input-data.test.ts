/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Oracle input data signing (`unsafeGetOracleInputData`) on the fullnode facade.
 *
 * When the oracle script is an address, the wallet signs the result with that address' key, but
 * only if the address belongs to the loaded wallet. That ownership check uses the async
 * `isAddressMine`, so it must be awaited: a non-awaited Promise is always truthy, the check never
 * fires, and the failure surfaces later as an unrelated AddressError from the key lookup.
 */

import { DEFAULT_PIN_CODE, generateWalletHelper, stopAllWallets } from '../helpers/wallet.helper';
import { getOracleBuffer, unsafeGetOracleInputData } from '../../../src/nano_contracts/utils';
import { OracleParseError } from '../../../src/errors';

describe('[Fullnode] oracle input data', () => {
  afterEach(async () => {
    await stopAllWallets();
  });

  it('rejects an oracle address that belongs to another wallet', async () => {
    const hWallet = await generateWalletHelper();
    const otherWallet = await generateWalletHelper();
    const network = hWallet.getNetworkObject();
    const foreignOracle = getOracleBuffer(await otherWallet.getAddressAtIndex(0), network);

    const result = unsafeGetOracleInputData(foreignOracle, Buffer.from('oracle-result'), hWallet, {
      pinCode: DEFAULT_PIN_CODE,
    });

    await expect(result).rejects.toThrow(OracleParseError);
    await expect(result).rejects.toThrow('Oracle address is not from the loaded wallet.');
  });

  it('signs the result with the key of an oracle address from the loaded wallet', async () => {
    const hWallet = await generateWalletHelper();
    const network = hWallet.getNetworkObject();
    const address = await hWallet.getAddressAtIndex(0);
    const ownOracle = getOracleBuffer(address, network);

    const inputData = await unsafeGetOracleInputData(
      ownOracle,
      Buffer.from('oracle-result'),
      hWallet,
      { pinCode: DEFAULT_PIN_CODE }
    );

    // The input data is <signature><public key>; it must carry this address' own public key.
    const key = await hWallet.getPrivateKeyFromAddress(address, { pinCode: DEFAULT_PIN_CODE });
    expect(inputData.length).toBeGreaterThan(0);
    expect(inputData.toString('hex')).toContain(key.publicKey.toString());
  });
});
