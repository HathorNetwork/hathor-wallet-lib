import { encodeSigned, decodeSigned, encodeUnsigned, decodeUnsigned } from '../../src/utils/leb128';

/**
 * Signed examples from the DWARF 5 standard, section 7.6, table 7.8.
 * https://dwarfstd.org/doc/DWARF5.pdf
 */
const DWARF5SignedTestCases: [bigint, Buffer][] = [
  [2n, Buffer.from([2])],
  [-2n, Buffer.from([0x7e])],
  [127n, Buffer.from([127 + 0x80, 0])],
  [-127n, Buffer.from([1 + 0x80, 0x7f])],
  [128n, Buffer.from([0 + 0x80, 1])],
  [-128n, Buffer.from([0 + 0x80, 0x7f])],
  [129n, Buffer.from([1 + 0x80, 1])],
  [-129n, Buffer.from([0x7f + 0x80, 0x7e])],
];

/**
 * Unsigned examples from the DWARF 5 standard, section 7.6, table 7.7.
 * https://dwarfstd.org/doc/DWARF5.pdf
 */
const DWARF5UnsignedTestCases: [bigint, Buffer][] = [
  [2n, Buffer.from([2])],
  [127n, Buffer.from([127])],
  [128n, Buffer.from([0x80, 1])],
  [129n, Buffer.from([1 + 0x80, 1])],
  [12857n, Buffer.from([57 + 0x80, 100])],
];

test('Encoded values should be decoded as the same values', () => {
  const extraValues = [
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
  ];

  const signedTestCases = Array.from(DWARF5SignedTestCases.map(v => v[0])).concat(extraValues);
  for (const value of signedTestCases) {
    // Signed encoding
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

  const unsignedTestCases = Array.from(DWARF5UnsignedTestCases.map(v => v[0])).concat(extraValues);
  for (const value of unsignedTestCases) {
    // Unsigned encoding
    const encodedBuffer = encodeUnsigned(value);
    const decoded = decodeUnsigned(encodedBuffer);
    expect(decoded.value).toEqual(value);
    expect(decoded.rest).toHaveLength(0);
  }
});

test('signed leb128 should work with fullnode docstring examples', () => {
  const tests: [number, Buffer][] = [
    [0, Buffer.from([0x00])],
    [624485, Buffer.from([0xe5, 0x8e, 0x26])],
    [-123456, Buffer.from([0xc0, 0xbb, 0x78])],
  ];

  for (const value of tests) {
    const encoded = encodeSigned(value[0]);
    expect(encoded).toEqual(value[1]);

    const decoded = decodeSigned(Buffer.concat([value[1], Buffer.from('cafe')]));
    expect(decoded.value).toEqual(BigInt(value[0]));
    expect(decoded.rest).toEqual(Buffer.from('cafe'));
  }
});

test('leb128 signed should work with DWARF 5 examples', () => {
  for (const value of DWARF5SignedTestCases) {
    const encoded = encodeSigned(value[0]);
    expect(encoded).toEqual(value[1]);

    const decoded = decodeSigned(Buffer.concat([value[1], Buffer.from('cafe')]));
    expect(decoded.value).toEqual(BigInt(value[0]));
    expect(decoded.rest).toEqual(Buffer.from('cafe'));
    expect(decoded.bytesRead).toEqual(value[1].length);
  }
});

test('leb128 unsigned should work with DWARF 5 positive examples', () => {
  for (const value of DWARF5UnsignedTestCases) {
    const encoded = encodeUnsigned(value[0]);
    expect(encoded).toEqual(value[1]);

    const decoded = decodeUnsigned(Buffer.concat([value[1], Buffer.from('cafe')]));
    expect(decoded.value).toEqual(BigInt(value[0]));
    expect(decoded.rest).toEqual(Buffer.from('cafe'));
    expect(decoded.bytesRead).toEqual(value[1].length);
  }
});

test('leb128 signed should fail if maxBytes is lower than required', () => {
  for (const value of DWARF5SignedTestCases) {
    const expectedLen = (value[1]).length;
    const val = value[0];
    // Encode should throw if maxBytes is expectedLen-1
    expect(() => {
      return encodeSigned(val, expectedLen - 1);
    }).toThrow();
    // Decode should throw if maxBytes is expectedLen-1
    const buf = Buffer.concat([value[1], Buffer.from('cafe')]);
    expect(() => {
      return decodeSigned(buf, expectedLen - 1);
    }).toThrow();
  }
});

test('leb128 unsigned should fail if maxBytes is lower than required', () => {
  for (const value of DWARF5UnsignedTestCases) {
    const expectedLen = (value[1]).length;
    const val = value[0];
    if (val < 0n) {
      // Skip negative cases
      continue;
    }
    // Encode should throw if maxBytes is expectedLen-1
    expect(() => {
      return encodeUnsigned(val, expectedLen - 1);
    }).toThrow();
    // Decode should throw if maxBytes is expectedLen-1
    const buf = Buffer.concat([value[1], Buffer.from('cafe')]);
    expect(() => {
      return decodeUnsigned(buf, expectedLen - 1);
    }).toThrow();
  }
});

test('leb128 unsigned should fail with negative numbers', () => {
  expect(() => {
    return encodeUnsigned(-1n);
  }).toThrow('Cannot encode an unsigned negative value');

  expect(() => {
    return encodeUnsigned(-127n);
  }).toThrow('Cannot encode an unsigned negative value');
});
