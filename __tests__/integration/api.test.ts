import featureApi from '../../src/api/featureApi';

describe('Feature api', () => {
  it('should be able to call the features api', async () => {
    await expect(featureApi.getFeatures()).resolves.not.toThrow();
  });

  it('should be able to call the features api', async () => {
    const response = await featureApi.getFeatures();
    await expect(featureApi.getBlockFeatures(response.block_hash)).resolves.not.toThrow();
  });
});
