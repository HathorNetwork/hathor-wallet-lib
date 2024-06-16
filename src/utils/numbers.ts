import { DECIMAL_PLACES } from '../constants';

/**
 * Get the formatted value with decimal places and thousand separators
 *
 * @param {number} value Amount to be formatted
 *
 * @return {string} Formatted value
 *
 * @inner
 */
export function prettyValue(value: number): string {
  const fixedPlaces = (value / 10 ** DECIMAL_PLACES).toFixed(DECIMAL_PLACES);
  const integerPart = fixedPlaces.split('.')[0];
  const decimalPart = fixedPlaces.split('.')[1];
  return `${prettyIntegerValue(parseInt(integerPart, 10))}.${decimalPart}`;
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
