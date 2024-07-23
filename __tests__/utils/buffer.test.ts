import {
  bufferToHex,
  floatToBytes,
  hexToBuffer,
  intToBytes,
  signedIntToBytes,
  unpackToFloat,
  unpackToInt,
} from '../../src/utils/buffer';

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

test('Float to bytes', () => {
  const number = 10.5;
  const buffer = floatToBytes(number, 8);
  expect(unpackToFloat(buffer)[0]).toBe(number);
});
