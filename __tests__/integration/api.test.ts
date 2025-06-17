import featureApi, { getBlockFeaturesSchema, getFeaturesSchema } from '../../src/api/featuresApi';

describe('Feature api', () => {
  it('should be able to call the features api', async () => {
    await expect(featureApi.getFeatures()).resolves.not.toThrow();

    // Validate response format
    const response = await featureApi.getFeatures();
    expect(() => getFeaturesSchema.parse(response)).not.toThrow();

    expect(response.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'INCREASE_MAX_MERKLE_PATH_LENGTH',
        }),
      ])
    );
  });

  it('should be able to call the block features api', async () => {
    const response = await featureApi.getFeatures();
    await expect(featureApi.getBlockFeatures(response.block_hash)).resolves.not.toThrow();
    // Validate response format
    const blockResponse = await featureApi.getBlockFeatures(response.block_hash);
    expect(() => getBlockFeaturesSchema.parse(blockResponse)).not.toThrow();
  });
});
