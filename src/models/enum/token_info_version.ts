/**
 * Create token information version
 * so far we expect name and symbol
 */
export enum TokenInfoVersion {
  DEPOSIT = 1,

  FEE = 2,
}

export const isTokenInfoVersion = (value: number): value is TokenInfoVersion => {
  return Object.values(TokenInfoVersion)
    .filter(v => typeof v === 'number')
    .includes(value);
};
