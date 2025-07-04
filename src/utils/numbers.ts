import { DECIMAL_PLACES } from '../constants';

const formatter = new Intl.NumberFormat('en-US');

/**
 * Get the formatted integer value with thousand separators
 *
 * Hermes does not have support for Intl.NumberFormat format method
 * with bigint values, and we use it in the Android for a better performance.
 * The iOS app runs with JSC, which doesn't work with bigint and toLocaleString.
 * Then I have this method that tries both options to format the integer value.
 *
 * @param value Amount to be formatted
 *
 * @return {string} Formatted value
 *
 * @inner
 */
function getLocaleString(value: bigint): string {
  try {
    return formatter.format(value);
  } catch (e) {
    return value.toLocaleString('en-US');
  }
}

/**
 * Get the formatted value with decimal places and thousand separators
 *
 * @param inputValue Amount to be formatted
 * @param [decimalPlaces=DECIMAL_PLACES] Number of decimal places
 *
 * @return {string} Formatted value
 *
 * @inner
 */
export function prettyValue(
  inputValue: bigint | number | string,
  decimalPlaces = DECIMAL_PLACES
): string {
  const value = BigInt(inputValue);
  if (typeof value !== 'bigint') {
    throw Error(`value ${value} should be a bigint`);
  }
  if (decimalPlaces === 0) {
    return getLocaleString(value);
  }
  const absValue = value >= 0 ? value : -value;
  const decimalDivisor = 10n ** BigInt(decimalPlaces);
  const integerPart = absValue / decimalDivisor;
  const decimalPart = absValue % decimalDivisor;
  const signal = value < 0 ? '-' : '';
  const integerString = getLocaleString(integerPart);
  const decimalString = decimalPart.toString().padStart(decimalPlaces, '0');
  return `${signal}${integerString}.${decimalString}`;
}
