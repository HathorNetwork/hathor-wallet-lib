/**
 * Token version used to identify the type of token during the token creation process.
 */
export enum TokenInfoVersion {
  DEPOSIT = 1,

  FEE = 2,
}

/**
 * Check if the value is a valid TokenInfoVersion
 * @param value number to check
 * @returns true if the value is a valid TokenInfoVersion, false otherwise
 */
export const isTokenInfoVersion = (value: number): value is TokenInfoVersion => {
  return Object.values(TokenInfoVersion)
    .filter(v => typeof v === 'number')
    .includes(value);
};
