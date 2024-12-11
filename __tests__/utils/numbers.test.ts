import { prettyValue } from '../../src/utils/numbers';

test('Pretty value', () => {
  expect(prettyValue(1000n)).toBe('10.00');
  expect(prettyValue(100000n)).toBe('1,000.00');
  expect(prettyValue(100000000n)).toBe('1,000,000.00');
  expect(prettyValue(-1000n)).toBe('-10.00');
  expect(prettyValue(10000000000n, 4)).toBe('1,000,000.0000');
  expect(prettyValue(100n, 1)).toBe('10.0');
  expect(prettyValue(100000n, 1)).toBe('10,000.0');
  expect(prettyValue(10n, 0)).toBe('10');
  expect(prettyValue(1000n, 0)).toBe('1,000');
  expect(prettyValue(-1000n, 0)).toBe('-1,000');
  expect(prettyValue(-1000n, 4)).toBe('-0.1000');
  expect(prettyValue(1023n)).toBe('10.23');
  expect(prettyValue(-1023n)).toBe('-10.23');
  expect(prettyValue(12345678901234567890n)).toBe('123,456,789,012,345,678.90');
  expect(prettyValue(12345678901234567890n, 4)).toBe('1,234,567,890,123,456.7890');
  expect(prettyValue(-12345678901234567890n)).toBe('-123,456,789,012,345,678.90');
  expect(prettyValue(-12345678901234567890n, 4)).toBe('-1,234,567,890,123,456.7890');

  expect(() => prettyValue(123)).toThrow('value 123 should be a bigint');
});
