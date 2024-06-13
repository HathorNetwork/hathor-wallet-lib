/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import P2SHSignature from '../../src/models/p2sh_signature';

test('P2SHSignature', () => {
  const pubkey =
    'xpub6BnoFhDySfUAaJQveYx1YvB8YcLdnnGdz19twSXRh6byEfZSWS4ewinKVDVJcvp6m17mAkQiBuhUgytwS561AkyCFXTvSjRXatueS2E4s3K';
  const signatures = {
    0: '0123',
    1: '4567',
    3: '89ab',
    4: 'cdef',
  };
  const expected = pubkey + '|0:0123|1:4567|3:89ab|4:cdef';

  const p2shSig = new P2SHSignature(pubkey, signatures);
  expect(p2shSig.serialize()).toBe(expected);

  const p2shSig2 = P2SHSignature.deserialize(expected);
  expect(p2shSig2.pubkey).toBe(pubkey);
  expect(p2shSig2.signatures[0]).toBe('0123');
  expect(p2shSig2.signatures[1]).toBe('4567');
  expect(p2shSig2.signatures[3]).toBe('89ab');
  expect(p2shSig2.signatures[4]).toBe('cdef');
});
