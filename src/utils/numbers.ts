import { DECIMAL_PLACES } from '../constants';

/**
 * Get the formatted value with decimal places and thousand separators
 *
 * @param {number} value Amount to be formatted
 * @param {number} [decimalPlaces=DECIMAL_PLACES] Number of decimal places
 *
 * @return {string} Formatted value
 *
 * @inner
 */
export function prettyValue(value: number, decimalPlaces = DECIMAL_PLACES): string {
  if (decimalPlaces === 0) {
    return prettyIntegerValue(value);
  }
  const fixedPlaces = (value / 10 ** decimalPlaces).toFixed(decimalPlaces);
  const integerPart = fixedPlaces.split('.')[0];
  const decimalPart = fixedPlaces.split('.')[1];
  let signal = '';
  if ((parseInt(integerPart) === 0) && (value < 0)) {
    // For negative numbers greater than -1 (e.g. -0.5) the prettyIntegerValue method receives
    // 0 as argument, which makes the prettyValue method return a positive number.
    // In this case we need to add a minus sign here.
    signal = '-';
  }
  return `${signal}${prettyIntegerValue(parseInt(integerPart, 10))}.${decimalPart}`;
}

/**
 * Get the formatted value for an integer number
 *
 * @param {number} value Amount to be formatted
 *
 * @return {string} Formatted value
 *
 * @inner
 */
export function prettyIntegerValue(value: number): string {
  const integerFormated = new Intl.NumberFormat('en-US').format(Math.abs(value));
  const signal = value < 0 ? '-' : '';
  return `${signal}${integerFormated}`;
}
