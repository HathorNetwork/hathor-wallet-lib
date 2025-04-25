/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { z } from 'zod';
import { createRequestInstance } from './axiosInstance';
import { transformJsonBigIntResponse } from '../utils/bigint';

const featureActivationSchema = z.object({
  name: z.string(),
  state: z.string(),
  acceptance: z.number().nullish(),
  threshold: z.number(),
  start_height: z.number(),
  minimum_activation_height: z.number(),
  timeout_height: z.number(),
  lock_in_on_timeout: z.boolean(),
  version: z.string(),
}).passthrough();

const getFeaturesSchema = z.object({
  block_hash: z.string(),
  block_height: z.number().min(0),
  features: z.array(featureActivationSchema),
}).passthrough();

const errorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const getBlockFeatureSignalBitSchema = z.object({
  bit: z.number(),
  signal: z.number(),
  feature: z.string(),
  feature_state: z.string(),
}).passthrough();

const getBlockFeaturesSuccessSchema = z.object({
  signal_bits: z.array(getBlockFeatureSignalBitSchema),
}).passthrough();

const getBlockFeaturesSchema = z.union([getBlockFeaturesSuccessSchema, errorSchema]);

const featuresApi = {
  /**
   * Get feature activation information
   */
  async getFeatures(): Promise<z.output<typeof getFeaturesSchema>> {
    return new Promise((resolve, reject) => {
      // @ts-ignore XXX: createRequestInstance resolve argument is not typed correctly
      return createRequestInstance(resolve)
        .get(`feature`, {
          transformResponse: res => transformJsonBigIntResponse(res, getFeaturesSchema),
        })
        .then(
          res => {
            resolve(res.data);
          },
          res => {
            reject(res);
          }
        );
    });
  },

  /**
   * Get block features information
   * @param blockHash Block id encoded as hex
   */
  async getBlockFeatures(blockHash: string): Promise<z.output<typeof getBlockFeaturesSchema>> {
    return new Promise((resolve, reject) => {
      // @ts-ignore XXX: createRequestInstance resolve argument is not typed correctly
      return createRequestInstance(resolve)
        .get(`feature`, {
          params: { block: blockHash },
          transformResponse: res => transformJsonBigIntResponse(res, getBlockFeaturesSchema),
        })
        .then(
          res => {
            resolve(res.data);
          },
          res => {
            reject(res);
          }
        );
    });
  },
};

export default featuresApi;
