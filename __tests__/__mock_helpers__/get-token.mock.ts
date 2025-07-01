import { NATIVE_TOKEN_UID } from '../../src/constants';
import { TokenInfoVersion } from '../../src/models/enum/token_info_version';
import { ITokenData, ITokenMetadata } from '../../src/types';

export const mockGetToken = async (
  tokenUid: string
): Promise<ITokenData & Partial<ITokenMetadata>> => {
  const tokenMap: Record<string, ITokenData> = {
    [NATIVE_TOKEN_UID]: {
      version: undefined,
      uid: NATIVE_TOKEN_UID,
      symbol: 'HTR',
      name: 'Hathor',
    },
    '01': {
      version: TokenInfoVersion.DEPOSIT,
      uid: '01',
      symbol: 'TKN01',
      name: 'Token 01',
    },
    '02': {
      version: TokenInfoVersion.FEE,
      uid: '02',
      symbol: 'FBT',
      name: 'Fee Based Token',
    },
    dbt: {
      version: TokenInfoVersion.DEPOSIT,
      uid: 'dbt',
      symbol: 'DBT',
      name: 'Deposit Based Token',
    },
    fbt: {
      version: TokenInfoVersion.FEE,
      uid: 'fbt',
      symbol: 'FBT',
      name: 'Fee Based Token',
    },
  };

  return tokenMap[tokenUid];
};
