/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DECIMAL_PLACES } from '../constants';

const formatter = new Intl.NumberFormat('en-US');

/**
 * Get the formatted integer value with thousand separators.
 *
 * Hermes does not support Intl.NumberFormat.format with BigInt, and we use it
 * on Android for performance. iOS uses JSC, which also doesn’t support BigInt
 * with toLocaleString. This method tries Intl first, then falls back to a
 * manual formatter that works with BigInt.
 *
 * @param value Amount to be formatted
 * @return {string} Formatted value
 */
function getLocaleString(value: bigint | number): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatter.format(value);
  }
  const s = value.toString(10);
  const isNeg = s[0] === '-';
  const digits = isNeg ? s.slice(1) : s;
  return (isNeg ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Get the formatted value with decimal places and thousand separators.
 *
 * Accepts a fixed-point integer stored as BigInt, splits into integer and
 * fractional parts, formats them with grouping, and reattaches the sign.
 *
 * @param inputValue Amount to be formatted
 * @param decimalPlaces Number of decimal places (>= 0)
 * @return {string} Formatted decimal string
 */
export function prettyValue(
  inputValue: bigint | number | string,
  decimalPlaces: number = DECIMAL_PLACES
): string {
  const value = BigInt(inputValue);

  if (decimalPlaces === 0) {
    return getLocaleString(value);
  }

  const absValue = value >= 0n ? value : -value;
  const decimalDivisor = 10n ** BigInt(decimalPlaces);
  const integerPart = absValue / decimalDivisor;
  const decimalPart = absValue % decimalDivisor;
  const signal = value < 0n ? '-' : '';

  const integerString = getLocaleString(integerPart);
  const decimalString = decimalPart.toString(10).padStart(decimalPlaces, '0');

  return `${signal}${integerString}.${decimalString}`;
}
