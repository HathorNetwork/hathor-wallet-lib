import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import metadataApi from '../../src/api/metadataApi';

describe('getDagMetadata', () => {
  let axiosMock;
  const id = 'mock-id';
  const network = 'testnet';
  const successResponse = { dag: 'mockDagData' };

  beforeEach(() => {
    axiosMock = new MockAdapter(axios);
  });

  afterEach(() => {
    axiosMock.restore();
  });

  it('should return correct data on successful response', async () => {
    // Setup
    axiosMock.onGet('metadata/dag').reply(200, successResponse);

    // Execute
    const result = await metadataApi.getDagMetadata(id, network);

    // Verify
    expect(result).toStrictEqual(successResponse);
    expect(axiosMock.history.get).toHaveLength(1);
  });

  it('should throw if there was no data on response', async () => {
    // Setup
    axiosMock.onGet('metadata/dag').reply(200, undefined);

    // Execute
    jest.useFakeTimers();
    const promiseObj = metadataApi
      .getDagMetadata(id, network)
      .catch(e => `Catched error: ${e.message}`);
    // By default, this method has 1 try and 3 retries
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    jest.useRealTimers();

    // Verify
    await expect(promiseObj).resolves.toMatch('Catched error: Invalid metadata API response.');
    expect(axiosMock.history.get).toHaveLength(4);
  });

  it('should return null if response is 404', async () => {
    // Setup
    axiosMock.onGet('metadata/dag').reply(404);

    // Execute
    const result = await metadataApi.getDagMetadata(id, network);

    // Verify
    expect(result).toBe(null);
    expect(axiosMock.history.get).toHaveLength(1);
  });

  it('should return rethrow the error message', async () => {
    // Setup
    axiosMock.onGet('metadata/dag').reply(500, { message: 'Some API Error' });

    // Execute
    jest.useFakeTimers();
    const promiseObj = metadataApi
      .getDagMetadata(id, network)
      .catch(e => `Catched error: ${e.message}`);
    // By default, this method has 1 try and 3 retries
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    jest.useRealTimers();

    // Verify
    await expect(promiseObj).resolves.toMatch('Catched error: Request failed with status code 500');
    expect(axiosMock.history.get).toHaveLength(4);
  });

  it('should retry and resolve on the last try', async () => {
    // Setup
    axiosMock
      .onGet('metadata/dag')
      .replyOnce(500, { message: 'Some API Error' })
      .onGet('metadata/dag')
      .replyOnce(500, { message: 'Some API Error' })
      .onGet('metadata/dag')
      .replyOnce(500, { message: 'Some API Error' })
      .onGet('metadata/dag')
      .replyOnce(200, successResponse);

    // Execute
    jest.useFakeTimers();
    const promiseObj = metadataApi
      .getDagMetadata(id, network)
      .catch(e => `Catched error: ${e.message}`);
    // By default, this method has 1 try and 3 retries with 5000ms between each
    const initialTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    const finalTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    await jest.advanceTimersToNextTimerAsync();
    jest.useRealTimers();

    // Verify
    await expect(promiseObj).resolves.toStrictEqual(successResponse);
    expect(finalTime - initialTime).toEqual(5000);
    expect(axiosMock.history.get).toHaveLength(4);
  });

  it('should config retries according to parameters', async () => {
    // Setup
    axiosMock
      .onGet('metadata/dag')
      .replyOnce(500, { message: 'Some API Error' })
      .onGet('metadata/dag')
      .replyOnce(500, { message: 'Some API Error' })
      .onGet('metadata/dag')
      .replyOnce(200, successResponse);
    const retries = 2;
    const retryInterval = 1000;

    // Execute
    jest.useFakeTimers();
    const promiseObj = metadataApi
      .getDagMetadata(id, network, { retries, retryInterval })
      .catch(e => `Catched error: ${e.message}`);
    const initialTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    const finalTime = jest.now();
    await jest.advanceTimersToNextTimerAsync();
    jest.useRealTimers();

    // Verify
    await expect(promiseObj).resolves.toStrictEqual(successResponse);
    expect(finalTime - initialTime).toEqual(retryInterval);
    expect(axiosMock.history.get).toHaveLength(3);
  });

  /* Missing Test cases:
    1)  Should return generic unknown error message
        There must be an effort to mock the client entirely for this test to work, as the client needs
        to return an invalid error type.
   */
});
