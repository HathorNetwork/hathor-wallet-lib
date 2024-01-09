import GenericWebSocket from '../websocket';
import helpers from '../utils/helpers';
import BaseConnection, {
  ConnectionParams,
} from '../connection';
import {
  ConnectionState,
} from '../wallet/types';
import Output from '../models/output';
import P2PKH from '../models/p2pkh';
import P2SH from '../models/p2sh';
import ScriptData from '../models/script_data';
import Network from '../models/network';
import { handleSubscribeAddress, handleWsDashboard } from '../utils/connection';
import { parseScript } from '../utils/scripts';
import tokenUtils from '../utils/tokens';
import { IStorage, IHistoryTx, IHistoryOutputDecoded, IHistoryOutput } from '../types';
import { HATHOR_TOKEN_CONFIG } from '../constants';
import txApi from '../api/txApi';
import { FullNodeTxResponse } from '../wallet/types';
import transactionUtils from '../utils/transaction';
import { cloneDeep } from 'lodash';


interface IWalletUpdateEvent {
	type: 'wallet:address_history',
	history: IHistoryTx,
}

/**
 * EventQueueTxData
 *
 * | Attribute      | Type             | Description                                                               |
 * |----------------|------------------|---------------------------------------------------------------------------|
 * | `hash`         | `str`            | The hash of this vertex.                                                  |
 * | `nonce`        | `Optional[int]`  | The nonce of this vertex.                                                 |
 * | `timestamp`    | `int`            | The timestamp of this vertex.                                             |
 * | `version`      | `int`            | The version of this vertex.                                               |
 * | `weight`       | `float`          | The weight of this vertex.                                                |
 * | `inputs`       | `List[TxInput]`  | The inputs of this vertex.                                                |
 * | `outputs`      | `List[TxOutput]` | The outputs of this vertex.                                               |
 * | `parents`      | `List[str]`      | The hashes of this vertex's parents.                                      |
 * | `tokens`       | `List[str]`      | The tokens of this vertex.                                                |
 * | `token_name`   | `Optional[str]`  | The token name of this vertex, if it is a `TokenCreationTransaction`.     |
 * | `token_symbol` | `Optional[str]`  | The token symbol of this vertex, if it is a `TokenCreationTransaction`.   |
 * | `metadata`     | `TxMetadata`     | The metadata of this vertex.                                              |
 * | `aux_pow`      | `Optional[str]`  | The auxiliary Proof of Work of this vertex, if it is a `MergeMinedBlock`. |
 */
interface EventQueueTxData {
  hash: string;
  nonce?: number;
  timestamp: number;
  version: number;
  weight: number;
  inputs: EventQueueTxInput[];
  outputs: EventQueueTxOutput[];
  parents: string[];
  tokens: string[];
  token_name?: string;
  token_symbol?: string;
  metadata: EventQueueTxMetadata;
  aux_pow?: string;
}

/**
 * EventQueueTxMetadata
 *
 * | Attribute            | Type                |
 * |----------------------|---------------------|
 * | `hash`               | `str`               |
 * | `spent_outputs`      | `List[SpentOutput]` |
 * | `conflict_with`      | `List[str]`         |
 * | `voided_by`          | `List[str]`         |
 * | `received_by`        | `List[int]`         |
 * | `children`           | `List[str]`         |
 * | `twins`              | `List[str]`         |
 * | `accumulated_weight` | `float`             |
 * | `score`              | `float`             |
 * | `first_block`        | `Optional[str]`     |
 * | `height`             | `int`               |
 * | `validation`         | `str`               |
 */
interface EventQueueTxMetadata {
  hash: string;
  spent_outputs: EventQueueSpentOutput[];
  conflict_with: string[];
  voided_by: string[];
  received_by: number[];
  children: string[];
  twins: string[];
  accumulated_weight: number;
  score: number;
  first_block?: string;
  height: number;
  validation: string;
}


/**
 * EventQueueTxInput
 *
 * | Attribute | Type  |
 * |-----------|-------|
 * | `tx_id`   | `str` |
 * | `index`   | `int` |
 * | `data`    | `str` |
 */
interface EventQueueTxInput {
  tx_id: string;
  index: number;
  data: string;
}

/**
 * EventQueueTxOutput
 *
 * | Attribute    | Type  |
 * |--------------|-------|
 * | `value`      | `int` |
 * | `script`     | `str` |
 * | `token_data` | `int` |
 */
interface EventQueueTxOutput {
  value: number;
  script: string;
  token_data: number;
}

/**
 * EventQueueSpentOutput
 *
 * | Attribute | Type        |
 * |-----------|-------------|
 * | `index`   | `int`       |
 * | `tx_ids`  | `List[str]` |
 */
interface EventQueueSpentOutput {
  index: number;
  tx_ids: string[];
}

/**
 * ReorgData
 *
 * | Attribute             | Type  | Description                                                              |
 * |-----------------------|-------|--------------------------------------------------------------------------|
 * | `reorg_size`          | `int` | The amount of blocks affected by this reorg.                             |
 * | `previous_best_block` | `str` | The hash of the best block before this reorg happened.                   |
 * | `new_best_block`      | `str` | The hash of the best block after this reorg.                             |
 * | `common_block`        | `str` | The hash of the last common block between the two differing blockchains. |
 */
interface EventQueueReorgData {
  reorg_size: number;
  previous_best_block: string;
  new_best_block: string;
  common_block: string;
}


enum EventType {
  LOAD_STARTED = 'LOAD_STARTED',
  LOAD_FINISHED = 'LOAD_FINISHED',
  NEW_VERTEX_ACCEPTED = 'NEW_VERTEX_ACCEPTED',
  REORG_STARTED = 'REORG_STARTED',
  REORG_FINISHED = 'REORG_FINISHED',
  VERTEX_METADATA_CHANGED = 'VERTEX_METADATA_CHANGED',
}

type EmptyObject = Record<string, never>;

type EventQueueEventDataType = EventQueueTxData | EventQueueReorgData | EmptyObject

function isEventQueueTxData(data: EventQueueEventDataType): data is EventQueueTxData {
  return (data as EventQueueTxData).hash !== undefined;
}

interface EventQueueBaseEvent {
  peer_id: string;
  id: number;
  timestamp: number;
  type: EventType;
  data: EventQueueEventDataType;
  group_id?: number;
}

interface EventQueueData {
  type: string;
  event: EventQueueBaseEvent;
  latest_event_id: number;
}

class EventQueueConnection extends BaseConnection {

  private subAddresses: Record<string, any>;
  private storage: IStorage;
  private txCache: Record<string, IHistoryTx>;

  constructor(options: ConnectionParams & { storage: IStorage}) {
    super(options);

    const wsOptions = {
      wsURL: helpers.getWSServerURL(this.currentServer),
      splitMessageType: false,
    };

    if (options.connectionTimeout) {
      wsOptions['connectionTimeout'] = options.connectionTimeout;
    }

    this.websocket = new GenericWebSocket(wsOptions);
    this.subAddresses = {};
    this.txCache = {};
    this.storage =  options.storage;
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    // This should never happen as the websocket is initialized on the constructor
    if (!this.websocket) {
      throw new Error('Websocket is not initialized');
    }

    this.websocket.on('is_online', this.onConnectionChange);

    this.websocket.on('EVENT', this.handleEvent.bind(this))

    this.setState(ConnectionState.CONNECTING);
    this.websocket.setup();
  }

  subscribeAddresses(addresses: string[]) {
    for (const address of addresses) {
      this.subAddresses[address] = true;
    }
  }

  unsubscribeAddress(address: string) {
    delete this.subAddresses[address];
  }

  isTxMine(data: EventQueueTxData): boolean {
    for (const output of data.outputs) {
      // We will parse the output script of each output
      const scriptBuf = Buffer.from(output.script, 'hex');
      const parsedScript = parseScript(scriptBuf, new Network(this.network));

      // We ignore data outputs and unknown scripts
      // Only P2PKH and P2SH scripts have addresses so we can check against subAddresses
      if (parsedScript instanceof P2PKH || parsedScript instanceof P2SH) {
        if (parsedScript.address.base58 in this.subAddresses) {
          // This means that the tx has a subscribed address
          return true;
        }
      }
    }

    // alternative, but async
    // await this.storage.isAddressMine(parsedScript.address.base58)

    return false;
  }

  /**
   * Handler for `EVENT` messages from the fullnode.
   */
  handleEvent(data: EventQueueData) {
    const { event } = data;
    if (!(event.type === EventType.NEW_VERTEX_ACCEPTED || event.type === EventType.VERTEX_METADATA_CHANGED)) {
      // We only care for vertex events
      return;
    }

    if (!isEventQueueTxData(event.data)) {
      return;
    }

    if (!this.isTxMine(event.data)) {
      return;
    }

    // If the tx is mine, we will emit an event
    this.buildEventData(event.data).then(eventData => {
      this.emit('tx', eventData);
    });

    // Send ack for this event to the fullnode
    // TODO
  }

  /**
   * Build the `WalletConnection` compatible event
   *
   * @param {EventQueueTxData} tx
   * @returns {Promise<IWalletUpdateEvent>}
   */
  async buildEventData(tx: EventQueueTxData): Promise<IWalletUpdateEvent> {
    const historyTx = await this.convertTxData(tx);
    return {
      type: 'wallet:address_history',
      history: historyTx,
    };
  }

  async fetchTxData(txId: string): Promise<IHistoryTx> {

    if (txId in this.txCache) {
      return this.txCache[txId];
    }

    const storagetx = await this.storage.getTx(txId);
    if (storagetx) {
      return storagetx;
    }

    /// TODO: retry at least 3 times

    // could not find tx in storage, try fullnode
    const nodeResponse: FullNodeTxResponse = await new Promise((resolve, reject) => {
      txApi.getTransaction(txId, resolve)
        .then(() => reject(new Error('API client did not use the callback')))
        .catch(reject);
    });

    if (nodeResponse.success) {
      const foundTx = transactionUtils.convertFullnodeTxToHistoryTx(nodeResponse, new Network(this.network));
      this.txCache[txId] = foundTx;
      return foundTx;
    }

    throw new Error('Could not find transaction');
  }

  /**
   * Convert EventQueueTxData to IHistoryTx
   * This is needed because of the structural difference between event queue and pubsub transactions
   *
   * Obs: We cannot call the fullnode api on tx.hash directly because the fullnode may have a different
   * metadata and this can leave the wallet state in an inconsistent state.
   *
   * @param {EventQueueTxData} tx
   * @returns {Promise<IHistoryTx>}
   */
  async convertTxData(tx: EventQueueTxData): Promise<IHistoryTx> {
    const is_voided = !!(tx.metadata && tx.metadata.voided_by && tx.metadata.voided_by.length !== 0);
    const historyTx: IHistoryTx = {
      tx_id: tx.hash,
      signalBits: tx.version & 0xFF00,
      version: tx.version & 0x00FF,
      weight: tx.weight,
      timestamp: tx.timestamp,
      is_voided,
      nonce: tx.nonce || 0,
      inputs: [],
      outputs: [],
      parents: tx.parents,
      tokens: tx.tokens,
    };
    if (tx.token_name && tx.token_symbol) {
      historyTx.token_name = tx.token_name;
      historyTx.token_symbol = tx.token_symbol;
    }
    if (tx.metadata && tx.metadata.height) {
      historyTx.height = tx.metadata.height;
    }

    const spentOutputs: Record<number, string> = {};
    for (const spent of tx.metadata.spent_outputs) {
      if (spent.tx_ids.length > 0) {
        spentOutputs[spent.index] = spent.tx_ids[0];
      }
    }

    for (const [index, output] of tx.outputs.entries()) {
      const { value, script, token_data } = output;

      // Get the token uid of this output
      const tokenIndex = tokenUtils.getTokenIndexFromData(token_data);
      const token = tokenIndex === 0 ? HATHOR_TOKEN_CONFIG.uid : tx.tokens[tokenIndex - 1];

      // Build decoded data from script
      const parsedScript = parseScript(Buffer.from(script, 'hex'), new Network(this.network));
      const decoded = parsedScript?.getDecoded() || {};

      historyTx.outputs.push({
        value,
        token_data,
        script,
        decoded,
        token,
        spent_by: spentOutputs[index] || null,
      });
    }

    // This should only be used to build the inputs
    const referenceTx = await this.fetchTxData(tx.hash);
    historyTx.inputs = cloneDeep(referenceTx.inputs);


    return historyTx;
  }
}

// TODO: This is to maintain compatibility until we migrate to typescript
// @ts-ignore
EventQueueConnection.CLOSED = 0;
// @ts-ignore
EventQueueConnection.CONNECTING = 1;
// @ts-ignore
EventQueueConnection.CONNECTED = 2;

export default EventQueueConnection;
