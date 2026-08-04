import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import txApi from '../../src/api/txApi';

/**
 * Every txApi method follows the same shape: it takes a `resolve` callback for
 * the success path and returns a promise that must reject when the request
 * itself fails, so the caller can tell a transport failure apart from an
 * API-level one.
 *
 * These cases drive the rejection handlers directly. The wallet-facing tests in
 * __tests__/new/hathorwallet.test.ts spy on txApi itself, which replaces the
 * handlers under test here.
 */
describe('transport error propagation', () => {
  let axiosMock;
  const resolve = jest.fn();

  beforeEach(() => {
    axiosMock = new MockAdapter(axios);
    resolve.mockClear();
  });

  afterEach(() => {
    axiosMock.restore();
  });

  /**
   * Each entry names one rejection handler in src/api/txApi.ts, the endpoint it
   * calls, and how to invoke it. Kept exhaustive on purpose: the handlers are
   * identical by convention rather than by construction, so a table is what
   * stops a single one from drifting.
   */
  const HANDLERS: { name: string; endpoint: string; method?: 'post'; call: () => Promise<void> }[] =
    [
      {
        name: 'getTransaction',
        endpoint: 'transaction',
        call: () => txApi.getTransaction('tx1', resolve),
      },
      {
        name: 'getTransactions',
        endpoint: 'transaction',
        call: () => txApi.getTransactions('tx', 10, null, null, null, resolve),
      },
      {
        name: 'getConfirmationData',
        endpoint: 'transaction_acc_weight',
        call: () => txApi.getConfirmationData('tx1', resolve),
      },
      {
        name: 'decodeTx',
        endpoint: 'decode_tx',
        call: () => txApi.decodeTx('cafe', resolve),
      },
      {
        name: 'pushTx',
        endpoint: 'push_tx',
        method: 'post',
        call: () => txApi.pushTx('cafe', false, resolve),
      },
      {
        name: 'getDashboardTx',
        endpoint: 'dashboard_tx',
        call: () => txApi.getDashboardTx(1, 1, resolve),
      },
      {
        name: 'getGraphviz',
        endpoint: 'graphviz/dot',
        call: () => txApi.getGraphviz('graphviz/dot', resolve),
      },
      {
        name: 'getGraphvizNeighbors',
        endpoint: 'graphviz/neighbours.dot',
        call: () => txApi.getGraphvizNeighbors('tx1', 'funds', 1, resolve),
      },
    ];

  const mockFailure = (handler: (typeof HANDLERS)[number], kind: 'http500' | 'network') => {
    const scope =
      handler.method === 'post'
        ? axiosMock.onPost(handler.endpoint)
        : axiosMock.onGet(handler.endpoint);
    return kind === 'http500' ? scope.reply(500) : scope.networkError();
  };

  test.each(HANDLERS)('$name does not resolve on HTTP 500', async handler => {
    mockFailure(handler, 'http500');

    await expect(handler.call()).rejects.toBeDefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  test.each(HANDLERS)('$name does not resolve when the request never lands', async handler => {
    mockFailure(handler, 'network');

    await expect(handler.call()).rejects.toBeDefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  /**
   * The table above asserts only that the chain rejects, because `getTransaction`
   * passes a zod schema into `transformResponse`, which parses the error body and
   * throws a ZodError before the rejection handler is reached. The handlers below
   * take no schema, so the caller receives the axios error itself.
   */
  describe('the axios error reaches the caller', () => {
    test.each([
      {
        name: 'getConfirmationData',
        endpoint: 'transaction_acc_weight',
        call: () => txApi.getConfirmationData('tx1', resolve),
      },
      {
        name: 'getGraphvizNeighbors',
        endpoint: 'graphviz/neighbours.dot',
        call: () => txApi.getGraphvizNeighbors('tx1', 'funds', 1, resolve),
      },
    ])('$name rejects with the axios error on HTTP 500', async handler => {
      axiosMock.onGet(handler.endpoint).reply(500);

      await expect(handler.call()).rejects.toMatchObject({
        isAxiosError: true,
        response: { status: 500 },
      });
    });
  });

  /**
   * Regression guard for the specific defect: getConfirmationData used to
   * evaluate `Promise.reject(res)` without returning it, so the chain resolved
   * with undefined and the real error was dropped on an unhandled rejection.
   */
  test('getConfirmationData settles as rejected, never as resolved', async () => {
    axiosMock.onGet('transaction_acc_weight').reply(500);

    const settled = await txApi
      .getConfirmationData('tx1', resolve)
      .then(() => 'resolved')
      .catch(() => 'rejected');

    expect(settled).toStrictEqual('rejected');
  });
});
