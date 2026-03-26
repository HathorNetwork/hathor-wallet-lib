import {
  SCANNING_POLICY,
  isSingleAddressScanPolicy,
  isGapLimitScanPolicy,
  isIndexLimitScanPolicy,
} from '../src/types';
import type { AddressScanPolicyData } from '../src/types';

describe('isSingleAddressScanPolicy type guard', () => {
  it('should return true for single-address policy data', () => {
    const data: AddressScanPolicyData = { policy: SCANNING_POLICY.SINGLE_ADDRESS };
    expect(isSingleAddressScanPolicy(data)).toBe(true);
    expect(isGapLimitScanPolicy(data)).toBe(false);
    expect(isIndexLimitScanPolicy(data)).toBe(false);
  });

  it('should return false for gap-limit policy data', () => {
    const data: AddressScanPolicyData = { policy: SCANNING_POLICY.GAP_LIMIT, gapLimit: 20 };
    expect(isSingleAddressScanPolicy(data)).toBe(false);
    expect(isGapLimitScanPolicy(data)).toBe(true);
    expect(isIndexLimitScanPolicy(data)).toBe(false);
  });

  it('should return false for index-limit policy data', () => {
    const data: AddressScanPolicyData = {
      policy: SCANNING_POLICY.INDEX_LIMIT,
      startIndex: 0,
      endIndex: 10,
    };
    expect(isSingleAddressScanPolicy(data)).toBe(false);
    expect(isGapLimitScanPolicy(data)).toBe(false);
    expect(isIndexLimitScanPolicy(data)).toBe(true);
  });
});
