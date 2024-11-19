/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/// <reference types="node" />
import { EventEmitter } from 'events';
import Transaction from '../models/transaction';
import { MineTxSuccessData } from './types';
/**
 * This is transaction mining class responsible for:
 *
 * - Submit a job to be mined;
 * - Update mining time estimation from time to time;
 * - Get back mining response;
 *
 * It emits the following events:
 * 'job-submitted': after job was submitted;
 * 'estimation-updated': after getting the job status;
 * 'job-done': after job is finished;
 * 'error': if an error happens;
 * 'unexpected-error': if an unexpected error happens;
 * */
declare class MineTransaction extends EventEmitter {
    transaction: Transaction;
    promise: Promise<MineTxSuccessData>;
    private estimation;
    private jobID;
    private countTxMiningAttempts;
    private maxTxMiningRetries;
    constructor(transaction: Transaction, options?: {
        maxTxMiningRetries: number;
    });
    /**
     * Used to handle errors in requests to the tx mining API
     *
     * @param error The error that was received from the axiosInstance
     */
    handleRequestError(error: any): void;
    /**
     * Submit job to be mined, update object variables of jobID and estimation, and start method to get job status
     * Emits 'job-submitted' after submit.
     */
    submitJob(): void;
    /**
     * Schedule job status request
     * If the job is done, emits 'job-done' event, complete and send the tx
     * Otherwise, schedule again the job status request and emits 'estimation-updated' event.
     */
    handleJobStatus(): void;
    /**
     * Start object (submit job)
     */
    start(): void;
}
export default MineTransaction;
//# sourceMappingURL=mineTransaction.d.ts.map