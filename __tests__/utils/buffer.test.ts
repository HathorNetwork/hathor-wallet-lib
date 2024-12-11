import buffer from 'buffer';
import {
  bigIntToBytes,
  bufferToHex,
  bytesToOutputValue,
  floatToBytes,
  hexToBuffer,
  intToBytes,
  signedIntToBytes,
  unpackToBigInt,
  unpackToFloat,
  unpackToInt,
} from '../../src/utils/buffer';
import Output from '../../src/models/output';
import { MAX_OUTPUT_VALUE, MAX_OUTPUT_VALUE_32 } from '../../src/constants';
import Address from '../../src/models/address';
import P2PKH from '../../src/models/p2pkh';

test('Buffer to hex', () => {
  const hexString =
    '044f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1';
  const buff = hexToBuffer(hexString);
  expect(bufferToHex(buff)).toBe(hexString);
});

test('Unsigned int to bytes', () => {
  const number1 = 10;
  const buf1 = intToBytes(number1, 1);
  expect(unpackToInt(1, false, buf1)[0]).toBe(number1);

  const number2 = 300;
  const buf2 = intToBytes(number2, 2);
  expect(unpackToInt(2, false, buf2)[0]).toBe(number2);

  const number3 = 70000;
  const buf3 = intToBytes(number3, 4);
  expect(unpackToInt(4, false, buf3)[0]).toBe(number3);
});

test('Signed int to bytes', () => {
  const number1 = 10;
  const buf1 = signedIntToBytes(number1, 1);
  expect(unpackToInt(1, true, buf1)[0]).toBe(number1);

  const number2 = 300;
  const buf2 = signedIntToBytes(number2, 2);
  expect(unpackToInt(2, true, buf2)[0]).toBe(number2);

  const number3 = 70000;
  const buf3 = signedIntToBytes(number3, 4);
  expect(unpackToInt(4, true, buf3)[0]).toBe(number3);
});

test('bigint to bytes', () => {
  // it only supports either 4 ou 8 bytes
  expect(() => bigIntToBytes(0n, 2)).toThrow();

  expect(bigIntToBytes(0n, 4)).toStrictEqual(buffer.Buffer.from([0, 0, 0, 0]));
  expect(bigIntToBytes(1n, 4)).toStrictEqual(buffer.Buffer.from([0, 0, 0, 1]));
  expect(bigIntToBytes(2n ** 31n - 1n, 4)).toStrictEqual(
    buffer.Buffer.from([0x7f, 0xff, 0xff, 0xff])
  );
  expect(() => bigIntToBytes(2n ** 31n, 4)).toThrow();
  expect(bigIntToBytes(-(2n ** 31n), 4)).toStrictEqual(
    buffer.Buffer.from([0x80, 0x00, 0x00, 0x00])
  );
  expect(() => bigIntToBytes(-(2n ** 31n) - 1n, 4)).toThrow();

  expect(bigIntToBytes(0n, 8)).toStrictEqual(buffer.Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
  expect(bigIntToBytes(1n, 8)).toStrictEqual(buffer.Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]));
  expect(bigIntToBytes(2n ** 31n - 1n, 8)).toStrictEqual(
    buffer.Buffer.from([0, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff])
  );
  expect(bigIntToBytes(2n ** 31n, 8)).toStrictEqual(
    buffer.Buffer.from([0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00])
  );
  expect(bigIntToBytes(-(2n ** 31n), 8)).toStrictEqual(
    buffer.Buffer.from([0xff, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00])
  );
  expect(bigIntToBytes(-(2n ** 31n) - 1n, 8)).toStrictEqual(
    buffer.Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7f, 0xff, 0xff, 0xff])
  );

  expect(bigIntToBytes(2n ** 63n - 1n, 8)).toStrictEqual(
    buffer.Buffer.from([0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  );
  expect(() => bigIntToBytes(2n ** 63n, 8)).toThrow();
  expect(bigIntToBytes(-(2n ** 63n), 8)).toStrictEqual(
    buffer.Buffer.from([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
  );
  expect(() => bigIntToBytes(-(2n ** 63n) - 1n, 4)).toThrow();
});

test('unpack to bigint', () => {
  // it only supports 8 bytes
  expect(() => unpackToBigInt(4, true, buffer.Buffer.from([]))).toThrow();

  expect(unpackToBigInt(8, true, bigIntToBytes(0n, 8))[0]).toStrictEqual(0n);
  expect(unpackToBigInt(8, true, bigIntToBytes(1n, 8))[0]).toStrictEqual(1n);
  expect(unpackToBigInt(8, true, bigIntToBytes(2n ** 31n - 1n, 8))[0]).toStrictEqual(
    2n ** 31n - 1n
  );
  expect(unpackToBigInt(8, true, bigIntToBytes(2n ** 31n, 8))[0]).toStrictEqual(2n ** 31n);
  expect(unpackToBigInt(8, true, bigIntToBytes(-(2n ** 31n), 8))[0]).toStrictEqual(-(2n ** 31n));
  expect(unpackToBigInt(8, true, bigIntToBytes(-(2n ** 31n) - 1n, 8))[0]).toStrictEqual(
    -(2n ** 31n) - 1n
  );
  expect(unpackToBigInt(8, true, bigIntToBytes(2n ** 63n - 1n, 8))[0]).toStrictEqual(
    2n ** 63n - 1n
  );
  expect(unpackToBigInt(8, true, bigIntToBytes(-(2n ** 63n), 8))[0]).toStrictEqual(-(2n ** 63n));
});

test('Float to bytes', () => {
  const number = 10.5;
  const buf = floatToBytes(number, 8);
  expect(unpackToFloat(buf)[0]).toBe(number);
});

test('bytes to output value', () => {
  const address = new Address('WZ7pDnkPnxbs14GHdUFivFzPbzitwNtvZo');
  const p2pkh = new P2PKH(address);
  const p2pkhScript = p2pkh.createScript();

  // Value smaller than 32 bytes max
  const o3 = new Output(MAX_OUTPUT_VALUE_32 - 1n, p2pkhScript);
  expect(bytesToOutputValue(o3.valueToBytes())[0]).toStrictEqual(MAX_OUTPUT_VALUE_32 - 1n);

  // Value equal to 32 bytes max
  const o4 = new Output(MAX_OUTPUT_VALUE_32, p2pkhScript);
  expect(bytesToOutputValue(o4.valueToBytes())[0]).toStrictEqual(MAX_OUTPUT_VALUE_32);

  // Value greater than 32 bytes max
  const o5 = new Output(MAX_OUTPUT_VALUE_32 + 1n, p2pkhScript);
  expect(bytesToOutputValue(o5.valueToBytes())[0]).toStrictEqual(MAX_OUTPUT_VALUE_32 + 1n);

  // Value smaller than max
  const o6 = new Output(MAX_OUTPUT_VALUE - 1n, p2pkhScript);
  expect(bytesToOutputValue(o6.valueToBytes())[0]).toStrictEqual(MAX_OUTPUT_VALUE - 1n);

  // Value equal to max
  const o7 = new Output(MAX_OUTPUT_VALUE, p2pkhScript);
  expect(bytesToOutputValue(o7.valueToBytes())[0]).toStrictEqual(MAX_OUTPUT_VALUE);
});
