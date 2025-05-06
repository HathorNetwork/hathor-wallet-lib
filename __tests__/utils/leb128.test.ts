import { encodeSigned, decodeSigned } from '../../src/utils/leb128';

/**
 * Examples from the DWARF 5 standard, section 7.6, table 7.8.
 * https://dwarfstd.org/doc/DWARF5.pdf
 */
const DWARF5TestCases = [
  [2n, Buffer.from([2])],
  [-2n, Buffer.from([0x7e])],
  [127n, Buffer.from([127 + 0x80, 0])],
  [-127n, Buffer.from([1 + 0x80, 0x7f])],
  [128n, Buffer.from([0 + 0x80, 1])],
  [-128n, Buffer.from([0 + 0x80, 0x7f])],
  [129n, Buffer.from([1 + 0x80, 1])],
  [-129n, Buffer.from([0x7f + 0x80, 0x7e])],
];

test('Encoded values should be decoded as the same values', () => {
  const testCases = Array.from(DWARF5TestCases.map(v => v[0] as bigint)).concat([
    0n,
    1n,
    27n,
    100n,
    1023n,
    1024n,
    BigInt(Number.MAX_SAFE_INTEGER),
    BigInt(Number.MAX_SAFE_INTEGER) + 2n,
    BigInt(Number.MAX_SAFE_INTEGER) + 1000n,
    0xcafecafecafe01n,
    0xcafecafecafecafen,
    0x0afecafecafecafen,
  ]);

  for (const value of testCases) {
    const encodedBuffer = encodeSigned(value);
    const decoded = decodeSigned(encodedBuffer);
    expect(decoded.value).toEqual(value);
    expect(decoded.rest).toHaveLength(0);
    // Negative values should also work
    const encodedNegBuffer = encodeSigned(-value);
    const decodedNeg = decodeSigned(encodedNegBuffer);
    expect(decodedNeg.value).toEqual(-value);
    expect(decodedNeg.rest).toHaveLength(0);
  }
});

test('leb128 should work with fullnode docstring examples', () => {
  const tests = [
    [0, Buffer.from([0x00])],
    [624485, Buffer.from([0xe5, 0x8e, 0x26])],
    [-123456, Buffer.from([0xc0, 0xbb, 0x78])],
  ];

  for (const value of tests) {
    const encoded = encodeSigned(value[0] as number);
    expect(encoded).toEqual(value[1]);

    const decoded = decodeSigned(Buffer.concat([value[1] as Buffer, Buffer.from('cafe')]));
    expect(decoded.value).toEqual(BigInt(value[0] as number));
    expect(decoded.rest).toEqual(Buffer.from('cafe'));
  }
});

test('leb128 should work with DWARF 5 examples', () => {
  for (const value of DWARF5TestCases) {
    const encoded = encodeSigned(value[0] as bigint);
    expect(encoded).toEqual(value[1]);

    const decoded = decodeSigned(Buffer.concat([value[1] as Buffer, Buffer.from('cafe')]));
    expect(decoded.value).toEqual(BigInt(value[0] as bigint));
    expect(decoded.rest).toEqual(Buffer.from('cafe'));
  }
});

test('leb128 should fail if maxBytes is lower than required', () => {
  for (const value of DWARF5TestCases) {
    const expectedLen = (value[1] as Buffer).length;
    const val = value[0] as bigint;
    // Encode should throw if maxBytes is expectedLen-1
    expect(() => {
      return encodeSigned(val, expectedLen - 1);
    }).toThrow();
    // Decode should throw if maxBytes is expectedLen-1
    const buf = Buffer.concat([value[1] as Buffer, Buffer.from('cafe')]);
    expect(() => {
      return decodeSigned(buf, expectedLen - 1);
    }).toThrow();
  }
});
