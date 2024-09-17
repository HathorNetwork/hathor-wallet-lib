import PromiseQueue from '../models/promise_queue';

const MAX_CONCURRENT_LOAD_TASKS = 3;

const GLL = new PromiseQueue();
GLL.concurrent = MAX_CONCURRENT_LOAD_TASKS;

export default GLL;
