import axios from "axios";
import MockAdapter from 'axios-mock-adapter';

export const mockAxios = axios.create({
  validateStatus: (status) => status >= 200 && status < 500,
});
export const mockAxiosAdapter = new MockAdapter(mockAxios);
jest.mock('../../src/wallet/api/walletServiceAxios', () => ({ axiosInstance: jest.fn().mockResolvedValue(mockAxios) }));