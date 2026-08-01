/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import EventEmitter from 'events';
import { shuffle } from 'lodash';
import txApi from '../api/txApi';
import {
  NATIVE_TOKEN_UID,
  MAX_SHIELDED_OUTPUTS,
  SELECT_OUTPUTS_TIMEOUT,
  ZERO_TWEAK,
  FEE_PER_AMOUNT_SHIELDED_OUTPUT,
  FEE_PER_FULL_SHIELDED_OUTPUT,
} from '../constants';
import { ErrorMessages } from '../errorMessages';
import { SendTxError, WalletError } from '../errors';
import Address from '../models/address';
import { getAddressType, resolveOutputScriptAddress } from '../utils/address';
import CreateTokenTransaction from '../models/create_token_transaction';
import { Fee } from '../utils/fee';
import Transaction from '../models/transaction';
import {
  IDataInput,
  IDataOutput,
  IDataOutputWithToken,
  IDataTx,
  isDataOutputCreateToken,
  IStorage,
  IUtxo,
  IUtxoFilterOptions,
  IUtxoSelectionOptions,
  UtxoSelectionAlgorithm,
  OutputValueType,
  WalletType,
} from '../types';
import {
  ChangeOutputMode,
  IDataShieldedOutput,
  InputGeneratorInfo,
  ShieldedOutputMode,
  ShieldedOutputProposal,
} from '../shielded/types';
import { createShieldedOutputs } from '../shielded/creation';
import helpers from '../utils/helpers';
import { addCreatedTokenFromTx } from '../utils/storage';
import tokens from '../utils/tokens';
import transactionUtils from '../utils/transaction';
import { bestUtxoSelection } from '../utils/utxo';
import {
  ISelectionReport,
  ITokenSelectionPolicy,
  SplitFallback,
  buildTokenOutputProfiles,
  computeTokenPolicy,
  decideChangeMode,
  hasShieldedUtxo,
  makeShieldedAwareSelection,
  needsAvailabilityProbe,
} from '../utils/shieldedSelection';
import MineTransaction from '../wallet/mineTransaction';
import { ISendTransaction as ISendTransactionInterface, OutputType } from '../wallet/types';
import HathorWallet from './wallet';
import Header from '../headers/base';
import FeeHeader from '../headers/fee';

export interface ISendInput {
  txId: string;
  index: number;
}

export interface ISendDataOutput {
  type: OutputType.DATA;
  data: Buffer;
  value?: number;
  token?: string;
}

export function isDataOutput(output: ISendOutput): output is ISendDataOutput {
  return 'type' in output && output.type === OutputType.DATA;
}

export interface ISendTokenOutput {
  // XXX: This type is ignored in the only place it is used
  // It was made optional because the ultimately the type is derived from the address at runtime,
  // see prepareTxData().
  // Making it optional allows ProposedOutput to be passed directly as ISendOutput.
  type?: OutputType.P2PKH | OutputType.P2SH;
  address: string;
  value: OutputValueType;
  token: string;
  timelock?: number | null;
}

export interface ISendShieldedOutput {
  /**
   * The recipient's shielded address exactly as handed to the user (71-byte
   * base58). The pipeline derives the on-chain spend-derived P2PKH and the
   * ECDH scan pubkey from it internally — callers never pre-derive anything.
   * No `type` field: a shielded output's on-chain script is always the
   * spend-derived P2PKH; P2SH is structurally impossible (the address embeds
   * only scan + spend pubkeys).
   */
  address: string;
  value: OutputValueType;
  token: string;
  shieldedMode: ShieldedOutputMode;
  timelock?: number | null;
}

/**
 * A shielded output definition resolved for the crypto pipeline: `address` is
 * the on-chain spend-derived P2PKH and `scanPubkey` the ECDH key, both
 * extracted from the caller-supplied 71-byte shielded address. The original
 * shielded address is kept in `shieldedAddress` for error/debug context.
 */
export interface IResolvedShieldedOutputDef extends ShieldedOutputProposal {
  shieldedAddress?: string;
  /** True for defs the wallet created as change (never for recipient outputs). */
  isChange?: boolean;
}

export function isShieldedOutput(output: ISendOutput): output is ISendShieldedOutput {
  return 'shieldedMode' in output;
}

export type ISendOutput = ISendDataOutput | ISendTokenOutput | ISendShieldedOutput;

/**
 * This is transaction mining class responsible for:
 *
 * - Submit a job to be mined;
 * - Update mining time estimation from time to time;
 * - Get back mining response;
 * - Push tx to the network;
 *
 * It emits the following events:
 * 'job-submitted': after job was submitted;
 * 'estimation-updated': after getting the job status;
 * 'job-done': after job is finished;
 * 'send-success': after push tx succeeds;
 * 'send-error': if an error happens;
 * 'unexpected-error': if an unexpected error happens;
 * */
export default class SendTransaction extends EventEmitter implements ISendTransactionInterface {
  wallet: HathorWallet | null;

  storage: IStorage | null;

  transaction: Transaction | null;

  outputs: ISendOutput[];

  inputs: ISendInput[];

  changeAddress: string | null;

  /**
   * If set, EVERY change output the tx would otherwise emit transparently is
   * rewritten as a shielded output in the given mode (FullShielded or
   * AmountShielded) — both the HTR fee-change and any custom-token change.
   * The HTR change covers the surplus over everything HTR-denominated in the
   * tx: any HTR being sent plus ALL fees (fees are always charged in HTR,
   * including the per-shielded-output fees), so its shielded value is the
   * change minus its own shielded-output fee. Custom-token change carries its
   * FULL value — the fee is HTR, a different token. Defaults to `null`, which
   * preserves the long-standing transparent-change behavior.
   *
   * Only takes effect when the tx already carries caller-requested shielded
   * outputs: on a purely transparent send, shielding the change adds no
   * privacy and would risk a lone shielded output (violates the >= 2 rule).
   * Used by callers that also pass shielded recipient outputs and want the
   * change to match the same privacy mode — otherwise the transparent change
   * would correlate the sender with an otherwise-private send. When the HTR
   * change alone is too small to fund its own shielded-output fee, additional
   * HTR UTXOs are pulled to cover it; if none are available the send throws
   * rather than downgrade to transparent change (see
   * convertHtrChangeIfRequested).
   */
  changeShieldedMode: ChangeOutputMode | null;

  pin: string | null;

  fullTxData: IDataTx | null;

  mineTransaction: MineTransaction | null = null;

  private _currentStep: 'idle' | 'prepared' | 'signed' = 'idle';

  /**
   *
   * @param {HathorWallet} wallet Wallet instance
   * @param {IStorage} storage Storage object, superseded by `wallet.storage` if wallet is present
   * @param {Object} [options={}] Options to initialize the facade
   * @param {Transaction|null} [options.transaction=null] Full tx data
   * @param {ISendInput[]} [options.inputs=[]] tx inputs
   * @param {ISendOutput[]} [options.outputs=[]] tx outputs
   * @param {string|null} [options.changeAddress=null] Address to use if we need to create a change output
   * @param {ChangeOutputMode|null} [options.changeShieldedMode=null] Change-output mode: null lets the automatic rules decide per token; 'transparent' keeps every change public; AMOUNT_SHIELDED/FULLY_SHIELDED emit every change output shielded in that mode
   * @param {string|null} [options.pin=null] Wallet pin
   * @param {IStorage|null} [options.network=null] Network object
   */
  constructor({
    wallet = null,
    storage = null,
    transaction = null,
    outputs = [],
    inputs = [],
    changeAddress = null,
    changeShieldedMode = null,
    pin = null,
  }: {
    wallet?: HathorWallet | null;
    storage?: IStorage | null;
    transaction?: Transaction | null;
    inputs?: ISendInput[];
    outputs?: ISendOutput[];
    changeAddress?: string | null;
    changeShieldedMode?: ChangeOutputMode | null;
    pin?: string | null;
  } = {}) {
    super();

    this.wallet = wallet;
    if (wallet) {
      this.storage = wallet.storage;
    } else {
      this.storage = storage;
    }
    this.transaction = transaction;
    this.outputs = outputs;
    this.inputs = inputs;
    this.changeAddress = changeAddress;
    this.changeShieldedMode = changeShieldedMode;
    this.pin = pin;
    this.fullTxData = null;
  }

  /**
   * Prepare transaction data from inputs and outputs
   * Fill the inputs if needed, create output change if needed
   *
   * @throws SendTxError
   *
   * @return {Object} fullTxData with tokens array, inputs and outputs
   *
   * @memberof SendTransaction
   * @inner
   */
  async prepareTxData(): Promise<IDataTx> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }
    const HTR_UID = NATIVE_TOKEN_UID;
    const network = this.storage.config.getNetwork();
    const txData: IDataTx = {
      inputs: [],
      outputs: [],
      tokens: [],
    };
    // Map of token uid to the chooseInputs value of this token
    const tokenMap = new Map<string, boolean>();

    // Collect shielded output definitions separately (resolved from the
    // caller-supplied 71-byte shielded addresses below)
    const shieldedOutputDefs: IResolvedShieldedOutputDef[] = [];
    // Track phantom outputs for removal after UTXO selection and shuffle
    const phantomOutputs = new Set<IDataOutput>();

    for (const output of this.outputs) {
      if (isDataOutput(output)) {
        tokenMap.set(HTR_UID, true);
        output.token = HTR_UID;

        // Data output will always have value 1 (0.01) HTR
        txData.outputs.push({
          type: OutputType.DATA,
          data: output.data.toString('hex'),
          value: 1n,
          authorities: 0n,
          token: output.token,
        });
      } else if (isShieldedOutput(output)) {
        // Shielded output: the caller passes the 71-byte shielded address
        // exactly as handed to the user. Resolve it here — extract the ECDH
        // scan pubkey and the spend-derived P2PKH (the on-chain script
        // address) — so direct SendTransaction consumers never pre-derive
        // anything. Mirrors convertHtrChangeIfRequested's own resolution.
        // isShieldedOutput only asserts the field exists, not that its value is
        // a valid mode. Reject an unknown mode here rather than let it fail
        // deep in the crypto layer with an opaque error.
        if (
          output.shieldedMode !== ShieldedOutputMode.AMOUNT_SHIELDED &&
          output.shieldedMode !== ShieldedOutputMode.FULLY_SHIELDED
        ) {
          throw new SendTxError(
            `Invalid shieldedMode '${String(output.shieldedMode)}': expected AMOUNT_SHIELDED or ` +
              `FULLY_SHIELDED.`
          );
        }
        const shieldedAddressObj = new Address(output.address, { network });
        if (!shieldedAddressObj.isShielded()) {
          throw new SendTxError(
            `Shielded output requires a shielded address, got '${output.address}'.`
          );
        }
        const spendBase58 = shieldedAddressObj.getSpendAddress().base58;
        shieldedOutputDefs.push({
          address: spendBase58,
          value: output.value,
          token: output.token,
          scanPubkey: shieldedAddressObj.getScanPubkey().toString('hex'),
          shieldedMode: output.shieldedMode,
          ...(output.timelock != null ? { timelock: output.timelock } : {}),
          shieldedAddress: output.address,
        });
        tokenMap.set(output.token, true);

        // Phantom output for UTXO selection (removed after shuffle), at the
        // resolved spend-derived P2PKH so selection accounts for this value.
        const phantom: IDataOutput = {
          address: spendBase58,
          value: output.value,
          timelock: null,
          authorities: 0n,
          token: output.token,
          type: getAddressType(spendBase58, network),
        };
        phantomOutputs.add(phantom);
        txData.outputs.push(phantom);
      } else {
        // We set chooseInputs true as default and may be overwritten by the inputs.
        // chooseInputs should be true if no inputs are given
        tokenMap.set(output.token, true);

        // The new address format serves both shielded and transparent
        // outputs: a plain transparent output aimed at a 71-byte address is
        // paid to its embedded spend-derived P2PKH. Legacy addresses pass
        // through unchanged.
        const transparentAddress = resolveOutputScriptAddress(output.address, network);
        txData.outputs.push({
          address: transparentAddress,
          value: output.value,
          timelock: output.timelock ? output.timelock : null,
          authorities: 0n,
          token: output.token,
          type: getAddressType(transparentAddress, network),
        });
      }
    }

    const requiresFees: { txId: string; index: number }[] = [];

    // Per-token digest of the user-supplied inputs, for the change-mode rules.

    const userInputSummaries = new Map<string, ISelectionReport>();

    for (const input of this.inputs) {
      const inputTx = await this.storage.getTx(input.txId);
      // SEPARATED-model resolve. Positional inputTx.outputs[input.index] would
      // return the wrong output (or undefined) for any input whose absolute
      // on-chain index lands in the shielded range (idx >= outputs.length),
      // causing this send pipeline to attach wrong value/token/address to the
      // input and the fullnode to reject the signed tx.
      const resolved =
        inputTx !== null ? transactionUtils.resolveSpentOutput(inputTx, input.index) : undefined;
      if (inputTx === null || !resolved) {
        const err = new SendTxError(ErrorMessages.INVALID_INPUT);
        err.errorData = { txId: input.txId, index: input.index };
        throw err;
      }

      // Resolve value/token/address/authorities by kind. For a shielded spend
      // the public token/value/address live in the owned-marker fields written
      // in place on the slot when the wallet decrypted it.
      let spentValue: OutputValueType;
      let spentToken: string;
      let spentAddress: string;
      let spentAuthorities: bigint;
      if (resolved.kind === 'shielded') {
        const so = resolved.output;
        const decodedAddress = so.decoded?.address;
        if (so.value === undefined || decodedAddress === undefined) {
          // A shielded slot the wallet doesn't own / hasn't decoded carries no
          // value, address or blinding factor to sign with, so it cannot be
          // spent. A caller-provided input can point at any slot, including one
          // that isn't ours — reject it with a clear error.
          const err = new SendTxError(ErrorMessages.INVALID_INPUT);
          err.errorData = { txId: input.txId, index: input.index };
          throw err;
        }
        // Owned + decoded: decrypt writes value/token/decoded together, so both
        // are present here. Shielded outputs are never authority outputs (the
        // fullnode rejects that with ShieldedAuthorityError), so no authorities.
        spentValue = so.value;
        spentToken = so.token!;
        spentAddress = decodedAddress;
        spentAuthorities = 0n;
      } else {
        const spentOut = resolved.output;
        spentValue = spentOut.value;
        spentToken = spentOut.token;
        spentAddress = spentOut.decoded.address!;
        spentAuthorities = transactionUtils.authoritiesFromOutput(spentOut);
      }

      if (!tokenMap.has(spentToken)) {
        // the inputs should be used to pay fees, otherwise it's an invalid input and it will raise an error after the fee is calculated
        if (HTR_UID === spentToken) {
          requiresFees.push({ txId: input.txId, index: input.index });
        } else {
          // The input select is from a token that is not in the outputs
          const err = new SendTxError(ErrorMessages.INVALID_INPUT);
          err.errorData = { txId: input.txId, index: input.index };
          throw err;
        }
      }
      tokenMap.set(spentToken, false);
      txData.inputs.push({
        txId: input.txId,
        index: input.index,
        value: spentValue,
        token: spentToken,
        address: spentAddress,
        authorities: spentAuthorities,
        // Mark shielded spends so fee accounting can skip them — the fullnode
        // cannot attribute a shielded input to a token.
        ...(resolved.kind === 'shielded' ? { shielded: true } : {}),
      });

      // User-supplied inputs bypass selection, but the change-mode rules still
      // read them: a shielded input makes that token's change shielded.
      const summary = userInputSummaries.get(spentToken) ?? {
        shieldedInputCount: 0,
        anyFullyShieldedInput: false,
        exactMatch: false,
      };
      if (resolved.kind === 'shielded') {
        summary.shieldedInputCount += 1;
        summary.anyFullyShieldedInput =
          summary.anyFullyShieldedInput || resolved.output.assetBlindingFactor !== undefined;
      }
      userInputSummaries.set(spentToken, summary);
    }

    // If the user provided HTR inputs, tokenMap.get(HTR_UID) will be false
    // In that case, we should NOT choose inputs automatically (accept what user provided)
    // Otherwise (true or undefined), we should choose HTR inputs if needed for fee
    const tokenMapHasHTR = tokenMap.has(HTR_UID);
    let shouldChooseHTRInputs = tokenMap.get(HTR_UID) || false;

    // we remove HTR from the tokenMap since we will calculate the fee based on the inputs and outputs
    // and we don't want to select inputs for HTR before that
    tokenMap.delete(HTR_UID);

    // ── Automatic selection rules ─────────────────────────────────────────
    // Analyze each token's outputs and decide its input-pool policy, whether a
    // shielded input must be forced, and whether a lone shielded output has to
    // be split because the wallet cannot supply the shielded input the rules
    // require. Splits run HERE — before selection and before Fee.calculate —
    // so the extra output's fee and funding flow through the normal machinery.
    const changeModeOverride = this.changeShieldedMode ?? null;
    const outputProfiles = await buildTokenOutputProfiles(
      this.outputs.map(o => ({
        token: 'token' in o ? o.token : undefined,
        address: 'address' in o ? o.address : undefined,
        shieldedMode: 'shieldedMode' in o ? o.shieldedMode : undefined,
      })),
      this.storage
    );
    const selectionPolicies = new Map<string, ITokenSelectionPolicy>();
    const selectionReports = new Map<string, ISelectionReport>();
    for (const [token, profile] of outputProfiles) {
      const chooseInputs = token === HTR_UID ? shouldChooseHTRInputs : tokenMap.get(token) ?? false;
      // The availability the rules test: the wallet's shielded pool for tokens
      // it selects for, the user's own inputs for tokens they control.
      let shieldedAvailable = true;
      if (needsAvailabilityProbe(profile)) {
        shieldedAvailable = chooseInputs
          ? await hasShieldedUtxo(this.storage, token)
          : (userInputSummaries.get(token)?.shieldedInputCount ?? 0) > 0;
      }
      const { policy, needsSplitFallback } = computeTokenPolicy(
        profile,
        shieldedAvailable,
        changeModeOverride
      );
      if (chooseInputs) {
        selectionPolicies.set(token, policy);
      }
      if (needsSplitFallback !== 'none') {
        splitShieldedDefForToken(shieldedOutputDefs, token, needsSplitFallback);
      }
    }

    // ── changeAddress under the address model ────────────────────────────
    // Legacy addresses are transparent-only; the new 71-byte format serves
    // both shielded and transparent outputs. A legacy changeAddress on a tx
    // that carries shielded outputs (or an explicit shielded change mode) can
    // never honor the change rules — fail rather than silently downgrade.
    const changeAddressIsNewFormat = this.changeAddress
      ? new Address(this.changeAddress, { network }).isShielded()
      : false;
    if (
      this.changeAddress &&
      !changeAddressIsNewFormat &&
      (shieldedOutputDefs.length > 0 ||
        changeModeOverride === ShieldedOutputMode.AMOUNT_SHIELDED ||
        changeModeOverride === ShieldedOutputMode.FULLY_SHIELDED)
    ) {
      throw new SendTxError(
        'A legacy change address cannot be used on a transaction with shielded outputs ' +
          'or a shielded change mode — use a new-format (shielded-capable) address.'
      );
    }
    // A new-format changeAddress hosts the shielded change itself. It must be
    // ours — same contract the transparent path enforces via getChangeAddress.
    if (changeAddressIsNewFormat && !(await this.storage.isAddressMine(this.changeAddress!))) {
      throw new SendTxError('Change address is not from the wallet');
    }
    const shieldedChangeAddress = changeAddressIsNewFormat ? this.changeAddress : null;

    const partialTxData = await prepareSendManyTokensData(
      this.storage,
      txData,
      tokenMap,
      this.changeAddress,
      token => {
        const policy = selectionPolicies.get(token);
        if (!policy) {
          return undefined;
        }
        return makeShieldedAwareSelection(policy, report => selectionReports.set(token, report));
      }
    );

    // Custom-token change: the rules decide, per token, whether the change is
    // shielded — shielded when that token's inputs include a shielded one or
    // all its outputs are shielded, transparent otherwise, with an explicit
    // changeShieldedMode always winning. The fee is always HTR (a different
    // token), so the FULL change value carries over — nothing is subtracted
    // here. Done before Fee.calculate (so the converted output is charged the
    // per-output shielded fee, not the transparent per-output fee) and before
    // the HTR pass (so its selection funds the resulting larger total fee).
    // HTR change is handled separately, after selection, by
    // convertHtrChangeIfRequested.
    const changeWallet = this.wallet;
    {
      const keptOutputs: IDataOutput[] = [];
      for (const out of partialTxData.outputs) {
        const withToken = out as IDataOutputWithToken;
        if (withToken.token === HTR_UID || out.isChange !== true) {
          keptOutputs.push(out);
          continue;
        }
        const tokenChangeMode = decideChangeMode({
          profile: outputProfiles.get(withToken.token),
          report:
            selectionReports.get(withToken.token) ??
            userInputSummaries.get(withToken.token) ??
            null,
          override: changeModeOverride,
        });
        if (tokenChangeMode === 'transparent') {
          keptOutputs.push(out);
          continue;
        }
        if (shieldedOutputDefs.length >= MAX_SHIELDED_OUTPUTS) {
          throw new SendTxError(
            `Cannot shield custom-token change: the transaction already has the ` +
              `maximum ${MAX_SHIELDED_OUTPUTS} shielded outputs.`
          );
        }
        // The change destination: an explicit new-format changeAddress, else
        // the wallet's own shielded address. A rules-shielded change with
        // neither available is a hard error — never a silent transparent
        // downgrade.
        let shieldedAddress: string;
        if (shieldedChangeAddress) {
          shieldedAddress = shieldedChangeAddress;
        } else if (changeWallet) {
          ({ address: shieldedAddress } = await changeWallet.getCurrentAddress(
            {},
            { legacy: false }
          ));
        } else {
          throw new SendTxError(
            'A shielded change is required but no wallet is available to derive its address.'
          );
        }
        const addressObj = new Address(shieldedAddress, { network });
        if (!addressObj.isShielded()) {
          throw new SendTxError(
            'Wallet did not return a shielded address for custom-token change conversion.'
          );
        }
        shieldedOutputDefs.push({
          address: addressObj.getSpendAddress().base58,
          value: withToken.value,
          token: withToken.token,
          scanPubkey: addressObj.getScanPubkey().toString('hex'),
          shieldedMode: tokenChangeMode,
          shieldedAddress,
          isChange: true,
        });
      }
      partialTxData.outputs = keptOutputs;
    }

    const partialInputs = [...txData.inputs, ...partialTxData.inputs];
    const partialOutputs = [...txData.outputs, ...partialTxData.outputs] as IDataOutputWithToken[];

    // Phantoms exist only so UTXO selection accounts for the shielded value.
    // The fullnode counts just the real transparent outputs for FEE_PER_OUTPUT
    // and rejects any fee that isn't an exact match, so a phantom here would
    // over-declare. Shielded outputs are charged separately, in shieldedFee.
    // (A FEE token with inputs but no transparent output pays the flat melt fee.)
    const feeOutputs =
      phantomOutputs.size > 0
        ? partialOutputs.filter(out => !phantomOutputs.has(out))
        : partialOutputs;

    // calculate the fee based in the inputs and outputs, including the change output
    // fee is always in HTR
    const fee = await Fee.calculate(
      partialInputs,
      feeOutputs,
      await tokens.getTokensByManyIds(this.storage, new Set(tokenMap.keys()))
    );

    // Calculate shielded output fee
    let shieldedFee = 0n;
    for (const def of shieldedOutputDefs) {
      if (def.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED) {
        shieldedFee += FEE_PER_FULL_SHIELDED_OUTPUT;
      } else {
        shieldedFee += FEE_PER_AMOUNT_SHIELDED_OUTPUT;
      }
    }

    let totalFee = fee + shieldedFee;

    // An explicit input that pays only shielded-output fees is legitimate, so
    // validate against the TOTAL fee (transparent + shielded), not the
    // transparent `fee` alone — otherwise a fee-only HTR input on a custom-token
    // shielded send (whose transparent fee is 0n) is wrongly rejected.
    if (requiresFees.length > 0 && totalFee === 0n) {
      const err = new SendTxError(ErrorMessages.INVALID_INPUT);
      err.errorData = requiresFees;
      throw err;
    }

    // Decide whether to auto-pick HTR inputs based on the original
    // totalFee (the value `prepareSendTokensData` is about to use for
    // selection). The post-conversion fee bump done below is funded
    // entirely from the would-be transparent change, so inputs picked
    // here remain sufficient.
    if (totalFee > 0n && !tokenMapHasHTR) {
      shouldChooseHTRInputs = true;
    }

    const options: IUtxoSelectionOptions = {
      token: HTR_UID,
      chooseInputs: shouldChooseHTRInputs,
    };

    // HTR follows the same rules. With HTR outputs its policy was computed in
    // the analysis phase above; entering only to pay fees it follows the
    // all-public rule: public inputs first, shielded only when public is
    // insufficient, with the exact-single-shielded forcing.
    const htrPolicy =
      selectionPolicies.get(HTR_UID) ??
      computeTokenPolicy(outputProfiles.get(HTR_UID), true, changeModeOverride).policy;
    if (shouldChooseHTRInputs) {
      options.utxoSelectionMethod = makeShieldedAwareSelection(htrPolicy, report =>
        selectionReports.set(HTR_UID, report)
      );
    }

    if (this.changeAddress) {
      options.changeAddress = this.changeAddress;
    }

    const partialHtrTxData = await prepareSendTokensData(
      this.storage,
      {
        inputs: partialInputs,
        outputs: partialOutputs,
      },
      options,
      totalFee
    );

    // The HTR change mode follows the same rules: shielded when shielded HTR
    // inputs were spent (mirroring them) or all HTR outputs are shielded,
    // transparent otherwise, with the explicit override winning. The helper
    // mutates both `partialHtrTxData.outputs` (removing the transparent
    // change) and `shieldedOutputDefs` (appending the shielded replacement),
    // and returns the extra shielded-output fee we now owe — funded by
    // reducing the change by the same amount, so inputs already picked are
    // still sufficient.
    const htrChangeMode = decideChangeMode({
      profile: outputProfiles.get(HTR_UID),
      report: selectionReports.get(HTR_UID) ?? userInputSummaries.get(HTR_UID) ?? null,
      override: changeModeOverride,
    });
    const { addedFee } = await convertHtrChangeIfRequested(
      partialHtrTxData,
      shieldedOutputDefs,
      htrChangeMode === 'transparent' ? null : htrChangeMode,
      this.wallet,
      network,
      this.storage,
      partialInputs,
      // Only pull extra HTR to fund the shielded-change fee when the wallet is
      // already auto-selecting HTR; if the caller supplied the HTR inputs,
      // convertHtrChangeIfRequested throws rather than choosing more.
      shouldChooseHTRInputs,
      htrPolicy.preference,
      shieldedChangeAddress
    );
    totalFee += addedFee;

    // ── Structural minimum: never emit a lone shielded output ─────────────
    // A single shielded output carries a random blinding factor and can never
    // satisfy the node's balance equation, so a tx ending with exactly one —
    // whatever produced it — is resolved by splitting it into two halves. The
    // second output's fee is funded without ever touching a recipient's value:
    // shave the lone def when it is itself the HTR change, else shave the
    // transparent HTR change, else pull extra HTR.
    if (shieldedOutputDefs.length === 1) {
      const lone = shieldedOutputDefs[0];
      const extraFee =
        lone.shieldedMode === ShieldedOutputMode.FULLY_SHIELDED
          ? FEE_PER_FULL_SHIELDED_OUTPUT
          : FEE_PER_AMOUNT_SHIELDED_OUTPUT;
      const usedUtxos = new Set<string>();
      for (const inp of [...partialInputs, ...partialHtrTxData.inputs]) {
        usedUtxos.add(`${inp.txId}:${inp.index}`);
      }

      if (lone.isChange && lone.token === HTR_UID) {
        // The lone def is the shielded HTR change: fund the split's fee from
        // itself, pulling extra HTR only if the shave would make a half
        // impossible (each half must be at least 1n).
        const deficit = extraFee + 2n - lone.value;
        if (deficit > 0n) {
          if (!shouldChooseHTRInputs) {
            throw new SendTxError(
              'The shielded HTR change is too small to split into the two shielded outputs ' +
                'the protocol requires, and HTR inputs were user-supplied so no additional ' +
                'HTR can be selected.'
            );
          }
          const { pulledInputs, pulledSum } = await pullExtraHtrUtxos(
            this.storage,
            usedUtxos,
            htrPolicy.preference,
            sum => sum >= deficit
          );
          if (pulledSum < deficit) {
            throw new SendTxError(
              'The shielded HTR change is too small to split into the two shielded outputs ' +
                'the protocol requires, and no additional HTR is available.'
            );
          }
          partialHtrTxData.inputs.push(...pulledInputs);
          lone.value += pulledSum;
        }
        lone.value -= extraFee;
      } else {
        const htrChangeIdx = partialHtrTxData.outputs.findIndex(o => {
          const withToken = o as IDataOutputWithToken;
          return withToken.token === HTR_UID && withToken.isChange === true;
        });
        if (htrChangeIdx !== -1) {
          const htrChange = partialHtrTxData.outputs[htrChangeIdx];
          if (htrChange.value > extraFee) {
            htrChange.value -= extraFee;
          } else if (htrChange.value === extraFee) {
            partialHtrTxData.outputs.splice(htrChangeIdx, 1);
          } else {
            if (!shouldChooseHTRInputs) {
              throw new SendTxError(
                'The HTR change cannot fund the shielded-output split the protocol requires, ' +
                  'and HTR inputs were user-supplied so no additional HTR can be selected.'
              );
            }
            const deficit = extraFee - htrChange.value;
            const { pulledInputs, pulledSum } = await pullExtraHtrUtxos(
              this.storage,
              usedUtxos,
              htrPolicy.preference,
              sum => sum >= deficit
            );
            if (pulledSum < deficit) {
              throw new SendTxError(
                'The HTR change cannot fund the shielded-output split the protocol requires, ' +
                  'and no additional HTR is available.'
              );
            }
            partialHtrTxData.inputs.push(...pulledInputs);
            const surplus = pulledSum - deficit;
            if (surplus > 0n) {
              htrChange.value = surplus;
            } else {
              partialHtrTxData.outputs.splice(htrChangeIdx, 1);
            }
          }
        } else {
          if (!shouldChooseHTRInputs) {
            throw new SendTxError(
              'Splitting the lone shielded output requires extra HTR for its fee, and HTR ' +
                'inputs were user-supplied so no additional HTR can be selected.'
            );
          }
          const { pulledInputs, pulledSum } = await pullExtraHtrUtxos(
            this.storage,
            usedUtxos,
            htrPolicy.preference,
            sum => sum >= extraFee
          );
          if (pulledSum < extraFee) {
            throw new SendTxError(
              'Splitting the lone shielded output requires extra HTR for its fee, and no ' +
                'additional HTR is available.'
            );
          }
          partialHtrTxData.inputs.push(...pulledInputs);
          const surplus = pulledSum - extraFee;
          if (surplus > 0n) {
            // The pull preference is public-first, so a transparent surplus
            // change is the expected shape here; a shielded surplus would need
            // the shielded pool to be the only HTR left, in which case the HTR
            // selection above already produced a shielded change def and this
            // branch (no HTR change anywhere) is not reachable.
            partialHtrTxData.outputs.push({
              type: await getOutputTypeFromWallet(this.storage),
              token: HTR_UID,
              value: surplus,
              address: await this.storage.getChangeAddress({
                changeAddress: this.changeAddress ?? undefined,
              }),
              authorities: 0n,
              timelock: null,
              isChange: true,
            });
          }
        }
      }
      totalFee += extraFee;
      splitShieldedDef(shieldedOutputDefs, 0);
    }

    // FeeHeader is pushed AFTER the conversion and the structural pass so it
    // carries the final total. The header gates on `totalFee > 0`; that's
    // still monotonically increasing through both (added fees >= 0n) so the
    // gate's outcome can't flip from true to false.
    const headers: Header[] = [];
    if (totalFee > 0n) {
      headers.push(new FeeHeader([{ tokenIndex: 0, amount: totalFee }]));
    }

    const shouldShuffleOutputs =
      partialTxData.outputs.length > 0 || partialHtrTxData.outputs.length > 0;
    // we initialize the outputs with the provided outputs to keep the order
    let outputs = [...txData.outputs];
    if (shouldShuffleOutputs) {
      // Shuffle outputs, so we don't have change output always in the same index
      outputs = shuffle([...partialOutputs, ...partialHtrTxData.outputs]);
    }

    // Remove phantom outputs (shielded) from the final outputs list.
    // This relies on reference equality — Set.has() matches the same object instances
    // created above. The spread operators and shuffle preserve object references.
    if (phantomOutputs.size > 0) {
      outputs = outputs.filter(out => !phantomOutputs.has(out));
    }

    // Walk every input (user-supplied + auto-selected per token, including
    // the HTR fee inputs) once, regardless of
    // whether we're building shielded outputs. We need these both for:
    //   (a) surjection-proof domain construction (shielded-outputs path), and
    //   (b) excess-blinding-factor computation (full-unshield path).
    // Collecting once keeps the two paths in sync on input ordering.
    const allInputs = [...partialInputs, ...partialHtrTxData.inputs];
    const inputGenerators: InputGeneratorInfo[] = [];
    const blindedInputsArr: Array<{
      value: bigint;
      valueBlindingFactor: Buffer;
      generatorBlindingFactor: Buffer;
    }> = [];
    // Transparent non-authority inputs collected separately. Needed only for the
    // excess-blinding-factor calc on full-unshield txs where the wallet holds a
    // mix of transparent + shielded UTXOs of the same token: the fullnode's
    // balance verifier sums ALL inputs (transparent + shielded) against all
    // outputs, so computeBalancingBlindingFactor must see the transparent
    // inputs too or it returns a bf that doesn't satisfy the equation, and the
    // fullnode rejects the tx: its balance verification fails when it builds
    // the excess commitment.
    const transparentInputEntries: Array<{
      value: bigint;
      valueBlindingFactor: Buffer;
      generatorBlindingFactor: Buffer;
    }> = [];

    // Every input here is wallet-owned: user-supplied inputs are validated
    // upstream (checkUnspentInput rejects a transparent output that is not
    // isAddressMine with "... is not from the wallet"; the input-resolve step
    // rejects a non-owned/undecoded shielded slot), and auto-selected inputs
    // come from the wallet's own UTXO set. So getUtxo below is always found.
    for (const inp of allInputs) {
      const utxo = await this.storage.getUtxo({
        txId: inp.txId,
        index: inp.index,
      });

      // Build generator info for surjection proof domain
      if (inp.token) {
        const genInfo: InputGeneratorInfo = { tokenUid: inp.token as string };
        // For FullShielded inputs, pass the asset blinding factor so the
        // surjection proof domain uses the blinded generator (asset_commitment)
        // matching what the fullnode verifies against.
        if (utxo?.shielded && utxo.assetBlindingFactor) {
          genInfo.assetBlindingFactor = Buffer.from(utxo.assetBlindingFactor, 'hex');
        }
        inputGenerators.push(genInfo);
      }

      // Extract blinding factors from shielded inputs for the homomorphic balance equation.
      if (utxo?.shielded) {
        if (!utxo.blindingFactor) {
          throw new SendTxError(
            `Shielded input ${inp.txId}:${inp.index} is missing blindingFactor — ` +
              'cannot satisfy the homomorphic balance equation.'
          );
        }
        blindedInputsArr.push({
          value: utxo.value,
          valueBlindingFactor: Buffer.from(utxo.blindingFactor, 'hex'),
          // AmountShielded inputs carry no assetBlindingFactor — their token
          // is public, so the asset-generator tweak is zero (explicit
          // generator, matching how the commitment was created). Only
          // FullShielded UTXOs store an assetBlindingFactor.
          generatorBlindingFactor: utxo.assetBlindingFactor
            ? Buffer.from(utxo.assetBlindingFactor, 'hex')
            : ZERO_TWEAK,
        });
      } else if (utxo && (utxo.authorities ?? 0n) === 0n && utxo.value > 0n) {
        transparentInputEntries.push({
          value: utxo.value,
          valueBlindingFactor: ZERO_TWEAK,
          generatorBlindingFactor: ZERO_TWEAK,
        });
      }
    }

    // Create shielded outputs with cryptographic commitments and proofs
    let shieldedOutputs: IDataShieldedOutput[] = [];
    if (shieldedOutputDefs.length > 0) {
      const cryptoProvider = this.storage.shieldedCryptoProvider;
      if (!cryptoProvider) {
        throw new SendTxError(
          'Shielded crypto provider is not set. Cannot create shielded outputs.'
        );
      }

      // Validate shielded output count before expensive crypto work
      if (shieldedOutputDefs.length === 1) {
        throw new SendTxError(
          'At least 2 shielded outputs are required to prevent trivial commitment matching.'
        );
      }
      if (shieldedOutputDefs.length > MAX_SHIELDED_OUTPUTS) {
        throw new SendTxError(
          `Cannot create more than ${MAX_SHIELDED_OUTPUTS} shielded outputs per transaction ` +
            `(requested ${shieldedOutputDefs.length}).`
        );
      }

      // Shuffle the shielded outputs so a change output isn't at a predictable
      // index. Unlike transparent outputs (shuffled above), shielded outputs
      // hide amount + token but NOT the destination address — the spend-derived
      // P2PKH is on-chain in the output script — so change sent to the wallet's
      // own address stays identifiable by position. The balance equation is a
      // sum over all outputs, so order is cryptographically irrelevant
      // (createShieldedOutputs assigns the balancing blinding factor to whichever
      // def ends up last). inputGenerators/blindedInputsArr are input-side and
      // order-independent of the outputs.
      const shuffledShieldedDefs = shuffle(shieldedOutputDefs);
      shieldedOutputs = await createShieldedOutputs(
        shuffledShieldedDefs,
        cryptoProvider,
        network,
        inputGenerators,
        blindedInputsArr
      );
    }

    // Full-unshield detection: tx has shielded inputs but no shielded outputs.
    // The fullnode rejects such a tx unless it carries an UnshieldBalanceHeader
    // with excess = sum(r_in) − sum(r_out). Compute excess using the existing
    // computeBalancingBlindingFactor primitive: pass value=0,
    // generatorBlindingFactor=ZERO, ALL inputs (shielded with their real
    // blinding factors + transparent with valueBlindingFactor=0) as `inputs`,
    // and every output + transparent fee entry as `otherOutputs` with
    // (valueBlindingFactor=0, generatorBlindingFactor=0). The function expects
    // sum of input values to equal sum of other-output values plus the
    // last-output value, so transparent inputs MUST be included when the
    // wallet pulls from a mixed transparent+shielded pool — otherwise the
    // function returns a bf that doesn't satisfy the equation and the fullnode
    // rejects the tx: its balance verification fails when it builds the excess
    // commitment at verify time.
    //
    // Mutually exclusive with shielded outputs (hathor-core enforces this at
    // verify time). We gate on `shieldedOutputs.length === 0` to skip this
    // branch on the shielded/partial-unshield path.
    let excessBlindingFactor: Buffer | undefined;
    if (shieldedOutputs.length === 0 && blindedInputsArr.length > 0) {
      const cryptoProvider = this.storage.shieldedCryptoProvider;
      if (!cryptoProvider) {
        throw new SendTxError(
          'Shielded crypto provider is not set. Cannot compute excess blinding ' +
            'factor for a full-unshield transaction.'
        );
      }

      // All transparent outputs contribute (value, valueBlindingFactor=0,
      // generatorBlindingFactor=0). Include the HTR fee amount as a transparent
      // output entry — the scalar must cover the full output side the verifier
      // sees.
      const transparentOutputEntries: Array<{
        value: bigint;
        valueBlindingFactor: Buffer;
        generatorBlindingFactor: Buffer;
      }> = [];
      for (const out of outputs) {
        transparentOutputEntries.push({
          value: out.value,
          valueBlindingFactor: ZERO_TWEAK,
          generatorBlindingFactor: ZERO_TWEAK,
        });
      }
      if (totalFee > 0n) {
        transparentOutputEntries.push({
          value: totalFee,
          valueBlindingFactor: ZERO_TWEAK,
          generatorBlindingFactor: ZERO_TWEAK,
        });
      }

      const excess = await cryptoProvider.computeBalancingBlindingFactor(
        0n,
        ZERO_TWEAK,
        [...blindedInputsArr, ...transparentInputEntries],
        transparentOutputEntries
      );
      excessBlindingFactor = excess;
    }

    // Privacy guard: a non-HTR token MUST appear in `tokens[]` only when
    // at least one output in the FINAL tx references it via `token_data`
    // — i.e. a transparent (including downstream-added change) or
    // AmountShielded output. FullShielded outputs commit the token UID
    // under `asset_commitment` instead; listing the token publicly in
    // `tokens[]` would defeat that privacy guarantee. Inputs don't carry
    // `token_data` in the wire format, so they don't pull a token in.
    //
    // Computed AFTER `outputs` is finalized (phantoms removed, change
    // outputs added by prepareSendManyTokensData included) — populating
    // earlier from `this.outputs` alone misses transparent change and
    // breaks balance verification when the same token has both FS user
    // outputs and a transparent change.
    const tokensWithVisibleOutput = new Set<string>();
    for (const out of outputs) {
      const tokenUid = (out as { token?: string }).token;
      if (!tokenUid || tokenUid === HTR_UID) continue;
      if ((out.authorities ?? 0n) !== 0n) continue;
      tokensWithVisibleOutput.add(tokenUid);
    }
    for (const so of shieldedOutputs) {
      if (so.shieldedMode !== ShieldedOutputMode.FULLY_SHIELDED) {
        tokensWithVisibleOutput.add(so.token);
      }
    }

    // This new IDataTx should be complete with the requested funds
    this.fullTxData = {
      outputs,
      inputs: [...partialInputs, ...partialHtrTxData.inputs],
      // We already removed HTR from the tokenMap. Filter out any token
      // whose only references are FullShielded outputs (see the privacy
      // guard above).
      tokens: Array.from(tokenMap.keys()).filter(t => tokensWithVisibleOutput.has(t)),
      headers,
      ...(shieldedOutputs.length > 0 ? { shieldedOutputs } : {}),
      ...(excessBlindingFactor ? { excessBlindingFactor } : {}),
    };

    return this.fullTxData;
  }

  /**
   * Prepare transaction without signing it.
   * Fill the inputs if needed, create output change if needed.
   *
   * @throws SendTxError
   *
   * @return {Transaction} Transaction object prepared to be signed
   *
   * @memberof SendTransaction
   * @inner
   */
  async prepareTx(): Promise<Transaction> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }

    const txData = this.fullTxData || (await this.prepareTxData());
    try {
      this.transaction = await transactionUtils.prepareTransaction(txData, '', this.storage, {
        signTx: false,
      });
      // This will validate if the transaction has more than the max number of inputs and outputs.
      this.transaction.validate();
      this._currentStep = 'prepared';
      return this.transaction;
    } catch (e) {
      const message = helpers.handlePrepareDataError(e);
      throw new SendTxError(message);
    }
  }

  /**
   * Sign the transaction and prepare the tx to be mined
   *
   * @param {string | null} pin Pin to use in this method (overwrites this.pin)
   *
   * @throws SendTxError
   *
   * @return {Transaction} Transaction object prepared to be mined
   *
   * @memberof SendTransaction
   * @inner
   */
  async signTx(pin: string | null = null): Promise<Transaction> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }

    if (!this.transaction) {
      throw new SendTxError('Transaction is not set.');
    }

    const pinToUse = pin ?? this.pin ?? '';
    try {
      // The pin is only needed to decrypt the local private key; an external tx-signing
      // method (e.g. a hardware or passkey signer) signs without it, so it is optional then.
      if (!pinToUse && !this.storage.hasTxSignatureMethod()) {
        throw new SendTxError('Pin is not set.');
      }

      await transactionUtils.signTransaction(this.transaction, this.storage, pinToUse);
      this.transaction.prepareToSend(transactionUtils.getWeightConstantsFromStorage(this.storage));
      this._currentStep = 'signed';
      return this.transaction;
    } catch (e) {
      const message = helpers.handlePrepareDataError(e);
      throw new SendTxError(message);
    }
  }

  /**
   * Prepare transaction to be mined from signatures
   *
   * The full tx data should already be prepared
   * since the signatures have already been made
   *
   * @params {Array<Buffer>} Array of Buffer, each being a signature of the tx data
   * The order of the signatures must match the inputs (private key used to sign should solve the input)
   *
   * @throws SendTxError
   *
   * @return {Transaction} Transaction object prepared to be mined
   *
   * @memberof SendTransaction
   * @inner
   */
  async prepareTxFrom(signatures: Buffer[]): Promise<Transaction> {
    if (!this.storage) {
      throw new SendTxError('Storage is not set.');
    }
    if (this.fullTxData === null) {
      // This method can only be called with a prepared tx data
      // because prepareTxData may modify the inputs and outputs
      throw new SendTxError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    // add each input data from signature
    for (const [index, input] of this.fullTxData.inputs.entries()) {
      const signature = signatures[index];
      const addressInfo = await this.storage.getAddressInfo(input.address);
      if (addressInfo === null) {
        throw new SendTxError(ErrorMessages.INVALID_INPUT);
      }
      // Creates input data for P2PKH
      if (!addressInfo.publicKey) {
        throw new SendTxError('Missing public key for address');
      }
      input.data = transactionUtils
        .createInputData(signature, Buffer.from(addressInfo.publicKey, 'hex'))
        .toString('hex');
    }

    // prepare and create transaction
    try {
      this.transaction = transactionUtils.createTransactionFromData(
        this.fullTxData,
        this.storage.config.getNetwork()
      );
      this.transaction.prepareToSend(transactionUtils.getWeightConstantsFromStorage(this.storage));
      return this.transaction;
    } catch (e) {
      const message = helpers.handlePrepareDataError(e);
      throw new SendTxError(message);
    }
  }

  /**
   * Mine the transaction
   * Expects this.transaction to be prepared and signed
   * Emits MineTransaction events while the process is ongoing
   *
   * @params {Object} options Optional object with {'startMiningTx', 'maxTxMiningRetries'}
   *
   * @throws WalletError
   *
   * @memberof SendTransaction
   * @inner
   */
  async mineTx(options = {}) {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    await this.updateOutputSelected(true);

    const newOptions = {
      startMiningTx: true,
      maxTxMiningRetries: 3,
      ...options,
    };

    this.mineTransaction = new MineTransaction(this.transaction, {
      maxTxMiningRetries: newOptions.maxTxMiningRetries,
    });

    this.mineTransaction.on('mining-started', () => {
      this.emit('mine-tx-started');
    });

    this.mineTransaction.on('estimation-updated', data => {
      this.emit('estimation-updated', data);
    });

    this.mineTransaction.on('job-submitted', data => {
      this.emit('job-submitted', data);
    });

    this.mineTransaction.on('job-done', data => {
      this.emit('job-done', data);
    });

    this.mineTransaction.on('error', message => {
      this.updateOutputSelected(false);
      this.emit('send-error', message);
    });

    this.mineTransaction.on('unexpected-error', message => {
      this.updateOutputSelected(false);
      this.emit('unexpected-error', message);
    });

    this.mineTransaction.on('success', data => {
      this.emit('mine-tx-ended', data);
    });

    if (newOptions.startMiningTx) {
      this.mineTransaction.start();
    }

    return this.mineTransaction.promise;
  }

  /**
   * Push tx to the network
   * If success, emits 'send-tx-success' event, otherwise emits 'send-error' event.
   *
   * @memberof SendTransaction
   * @inner
   */
  handlePushTx(): Promise<Transaction> {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    const promise = new Promise<Transaction>((resolve, reject) => {
      if (this.transaction === null) {
        throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
      }
      this.emit('send-tx-start', this.transaction);
      const txHex = this.transaction.toHex();
      txApi
        .pushTx(txHex, false, response => {
          if (response.success) {
            if (this.transaction === null) {
              throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
            }
            this.transaction.updateHash();
            if (this.wallet && this.storage) {
              // Add transaction to storage and process storage
              (async (wallet: HathorWallet, storage: IStorage, transaction: Transaction) => {
                // Get the transaction as a history object
                const historyTx = await transactionUtils.convertTransactionToHistoryTx(
                  transaction,
                  storage
                );
                // Add token from a create token transaction to the storage
                // This just returns if the transaction is not a CREATE_TOKEN_TX
                await addCreatedTokenFromTx(transaction as CreateTokenTransaction, storage);
                // Add new transaction to the wallet's storage.
                // Pass the pin used for this send so the wallet can decrypt and
                // credit its own shielded change even when it holds no stored
                // pinCode (per-call-pin flow).
                // The type labels the WS event this sender-local insert emulates
                // (the fullnode will deliver the real one for this tx shortly);
                // only the handleWebsocketMsg router inspects it, and this path
                // bypasses the router.
                wallet.enqueueOnNewTx(
                  { type: 'wallet:address_history', history: historyTx },
                  this.pin ?? undefined
                );
              })(this.wallet, this.storage, this.transaction);
            }
            this.emit('send-tx-success', this.transaction);
            resolve(this.transaction);
          } else {
            this.updateOutputSelected(false);
            const err = new SendTxError(response.message);
            reject(err);
          }
        })
        .catch(e => {
          this.updateOutputSelected(false);
          this.emit('send-error', e.message);
          reject(e);
        });
    });

    return promise;
  }

  /**
   * Run sendTransaction from mining, i.e. expects this.transaction to be prepared and signed
   * then it will mine and push tx
   *
   * 'until' parameter can be 'mine-tx', in order to only mine the transaction without propagating
   *
   * @memberof SendTransaction
   * @inner
   */
  async runFromMining(until: 'mine-tx' | null = null): Promise<Transaction> {
    try {
      if (this.transaction === null) {
        throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
      }
      // This will await until mine tx is fully completed
      // mineTx method returns a promise that resolves when
      // mining succeeds or rejects when there is an error
      const mineData = await this.mineTx();
      this.transaction.parents = mineData.parents;
      this.transaction.timestamp = mineData.timestamp;
      this.transaction.nonce = mineData.nonce;
      this.transaction.weight = mineData.weight;

      if (until === 'mine-tx') {
        return this.transaction;
      }

      const tx = await this.handlePushTx();
      return tx;
    } catch (err) {
      if (err instanceof WalletError) {
        this.emit('send-error', err.message);
      }
      throw err;
    }
  }

  /**
   * Method created for compatibility reasons
   * some people might be using the old facade and this start method just calls runFromMining
   *
   * @deprecated
   *
   * @memberof SendTransaction
   * @inner
   */
  start() {
    this.runFromMining();
  }

  /**
   * Run sendTransaction from preparing, i.e. prepare, sign, mine and push the tx
   *
   * 'until' parameter can be 'prepare-tx' (it will stop before signing the tx),
   * 'sign-tx' (it will stop before mining the tx),
   * or 'mine-tx' (it will stop before send tx proposal, i.e. propagating the tx)
   *
   * Can be called incrementally: run('prepare-tx') then run(null) to continue.
   *
   * @memberof SendTransaction
   * @inner
   */
  async run(
    until: 'prepare-tx' | 'sign-tx' | 'mine-tx' | null = null,
    pin: string | null = null
  ): Promise<Transaction> {
    try {
      if (this._currentStep === 'idle') {
        await this.prepareTx();
      }

      if (until === 'prepare-tx') {
        return this.transaction!;
      }

      if (this._currentStep === 'prepared') {
        await this.signTx(pin);
      }

      if (until === 'sign-tx') {
        return this.transaction!;
      }

      const tx = await this.runFromMining(until);
      return tx;
    } catch (err) {
      if (err instanceof WalletError) {
        this.emit('send-error', err.message);
      }
      throw err;
    }
  }

  /**
   * Update the outputs of the tx data in localStorage to set 'selected_as_input'
   * This will prevent the input selection algorithm to select the same input before the
   * tx arrives from the websocket and set the 'spent_by' key
   *
   * @param {boolean} selected If should set the selected parameter as true or false
   *
   * */
  async updateOutputSelected(selected: boolean) {
    if (this.transaction === null) {
      throw new WalletError(ErrorMessages.TRANSACTION_IS_NULL);
    }

    if (!this.storage) {
      // No storage available, so we can't update the selected utxos
      return;
    }

    // Mark all inputs as selected
    for (const input of this.transaction.inputs) {
      await this.storage.utxoSelectAsInput(
        { txId: input.hash, index: input.index },
        selected,
        SELECT_OUTPUTS_TIMEOUT
      );
    }
  }

  /**
   * Release all UTXOs that were marked as selected for this transaction.
   * Call this when the transaction is rejected or abandoned to free the locked UTXOs.
   */
  async releaseUtxos(): Promise<void> {
    if (this.transaction === null) {
      return;
    }

    if (!this.storage) {
      return;
    }

    for (const input of this.transaction.inputs) {
      try {
        await this.storage.utxoSelectAsInput({ txId: input.hash, index: input.index }, false);
      } catch (err) {
        // Best-effort: continue releasing remaining UTXOs
        this.storage.logger.debug(`Failed to release UTXO ${input.hash}:${input.index}: ${err}`);
      }
    }
  }
}

/**
 * Check the tx data and propose inputs and outputs to complete the transaction.
 * We will only check a single token
 *
 * @param {IStorage} storage
 * @param {Pick<IDataTx, 'inputs' | 'outputs'>} dataTx inputs and outputs from dataTx
 * @param {IUtxoSelectionOptions} options
 */
/**
 * Replace one shielded output definition with two floor/ceil halves at the
 * same destination, mode and token.
 *
 * This is how the rules satisfy the protocol's two-shielded-outputs minimum
 * (a single shielded output carries a random blinding factor and can never
 * balance) and how a lone shielded output is de-correlated from its inputs
 * when no shielded input is available. The phantom output pushed for UTXO
 * selection is untouched: the halves sum to the original value.
 */
export function splitShieldedDef(defs: IResolvedShieldedOutputDef[], index: number): void {
  const target = defs[index];
  if (target.value < 2n) {
    throw new SendTxError(
      'Cannot split a 1-unit shielded output to satisfy the minimum of 2 shielded outputs.'
    );
  }
  if (defs.length + 1 > MAX_SHIELDED_OUTPUTS) {
    throw new SendTxError(
      `Cannot split a shielded output: the transaction already carries the ` +
        `maximum ${MAX_SHIELDED_OUTPUTS} shielded outputs.`
    );
  }
  const half = target.value / 2n;
  defs.splice(index, 1, { ...target, value: half }, { ...target, value: target.value - half });
}

/**
 * Apply a rules-mandated split for a token: its only shielded output
 * ('splitOne') or its largest one ('splitLargest').
 */
export function splitShieldedDefForToken(
  defs: IResolvedShieldedOutputDef[],
  token: string,
  fallback: Exclude<SplitFallback, 'none'>
): void {
  let targetIndex = -1;
  for (let i = 0; i < defs.length; i++) {
    if (defs[i].token !== token) {
      continue;
    }
    if (
      targetIndex === -1 ||
      (fallback === 'splitLargest' && defs[i].value > defs[targetIndex].value)
    ) {
      targetIndex = i;
    }
  }
  if (targetIndex === -1) {
    // Defensive: the profile said this token has shielded outputs.
    throw new SendTxError(`No shielded output found to split for token ${token}.`);
  }
  splitShieldedDef(defs, targetIndex);
}

export async function prepareSendTokensData(
  storage: IStorage,
  dataTx: Pick<IDataTx, 'inputs' | 'outputs'>,
  options: IUtxoSelectionOptions = {},
  fee: bigint = 0n
): Promise<Pick<IDataTx, 'inputs' | 'outputs'>> {
  try {
    return await _prepareSendTokensData(storage, dataTx, options, fee);
  } catch (e) {
    if (e instanceof Error) {
      throw new SendTxError(e.message);
    }
    throw e;
  }
}

/**
 * Pull additional HTR UTXOs (excluding already-used ones) until the pulled sum
 * satisfies `isEnough`. Pool-aware: the preferred pool first, the other as a
 * fallback. Ascending value inside each pool — the pulled value flows into a
 * change output, so pulling smallest-first moves the least extra HTR around.
 */
async function pullExtraHtrUtxos(
  storage: IStorage,
  usedUtxos: Set<string>,
  preference: 'shielded' | 'public',
  isEnough: (pulledSum: bigint) => boolean
): Promise<{ pulledInputs: IDataInput[]; pulledSum: bigint }> {
  const pulledInputs: IDataInput[] = [];
  let pulledSum = 0n;
  const passes: boolean[] = preference === 'shielded' ? [true, false] : [false, true];
  for (const shieldedPass of passes) {
    if (isEnough(pulledSum)) {
      break;
    }
    const selectOptions: IUtxoFilterOptions = {
      token: NATIVE_TOKEN_UID,
      authorities: 0n,
      only_available_utxos: true,
      order_by_value: 'asc',
      shielded: shieldedPass,
      filter_method: (utxo: IUtxo) => !usedUtxos.has(`${utxo.txId}:${utxo.index}`),
    };
    // eslint-disable-next-line no-await-in-loop -- sequential pool passes
    for await (const utxo of storage.selectUtxos(selectOptions)) {
      pulledInputs.push(helpers.getDataInputFromUtxo(utxo));
      usedUtxos.add(`${utxo.txId}:${utxo.index}`);
      pulledSum += utxo.value;
      if (isEnough(pulledSum)) {
        break;
      }
    }
  }
  return { pulledInputs, pulledSum };
}

/**
 * If `mode` is set and `prepareSendTokensData` emitted a transparent
 * HTR change output, rewrite that change as a shielded HTR output in
 * `shieldedOutputDefs`. Mutates both `partialHtrTxData.outputs` (to
 * remove the transparent change) and `shieldedOutputDefs` (to append
 * the shielded one). Returns the additional shielded-output fee that
 * the caller must add to `totalFee`, or `0n` when no conversion was
 * performed.
 *
 * When the change value is at most `additionalFee` the change alone
 * cannot fund its own shielded-output fee. Rather than silently keeping
 * a transparent change (which would leak alongside an otherwise-private
 * send), we select additional HTR UTXO(s) not already used by the tx and
 * fold their value into the change until it clears the fee. The pulled
 * value flows entirely into the change output — it adds no new shielded
 * output, so `additionalFee` does not grow again. If no additional HTR is
 * available to clear the threshold, we throw rather than downgrade.
 *
 * No-ops in any of these cases:
 *   - `mode` is null/undefined (the rules decided on a transparent change).
 *   - No HTR change output exists in `partialHtrTxData.outputs` (the
 *     selected HTR UTXO covered the fee exactly).
 *
 * A shielded change on a transaction with no other shielded output is legal
 * here: the structural pass downstream splits a lone shielded output into two
 * halves, restoring the protocol minimum.
 *
 * @throws SendTxError when the change is too small to fund its shielded
 *   fee and no additional HTR UTXO is available to cover the difference, or
 *   when a shielded change is required with no address source for it.
 */
export async function convertHtrChangeIfRequested(
  partialHtrTxData: Pick<IDataTx, 'inputs' | 'outputs'>,
  shieldedOutputDefs: IResolvedShieldedOutputDef[],
  mode: ShieldedOutputMode | null,
  wallet: HathorWallet | null,
  network: ReturnType<IStorage['config']['getNetwork']>,
  storage: IStorage,
  existingInputs: IDataInput[] = [],
  canSelectMoreHtr: boolean = true,
  pullPreference: 'shielded' | 'public' = 'public',
  shieldedChangeAddress: string | null = null
): Promise<{ addedFee: bigint }> {
  if (!mode) return { addedFee: 0n };

  const additionalFee =
    mode === ShieldedOutputMode.FULLY_SHIELDED
      ? FEE_PER_FULL_SHIELDED_OUTPUT
      : FEE_PER_AMOUNT_SHIELDED_OUTPUT;

  const HTR_UID = NATIVE_TOKEN_UID;
  const changeIdx = partialHtrTxData.outputs.findIndex(o => {
    const withToken = o as IDataOutputWithToken;
    return withToken.token === HTR_UID && withToken.isChange === true;
  });
  if (changeIdx === -1) return { addedFee: 0n };

  // There is an HTR change to shield, but the tx already carries the maximum
  // number of shielded outputs — adding one more would exceed the cap the
  // fullnode enforces. Fail clearly (and before pulling extra HTR UTXOs below)
  // rather than with a late, generic over-limit error downstream.
  if (shieldedOutputDefs.length >= MAX_SHIELDED_OUTPUTS) {
    throw new SendTxError(
      `Cannot shield the HTR change: the transaction already has the maximum ` +
        `${MAX_SHIELDED_OUTPUTS} shielded outputs.`
    );
  }

  const transparentChange = partialHtrTxData.outputs[changeIdx];
  let changeValue = transparentChange.value;

  if (changeValue <= additionalFee) {
    // The change alone can't fund the shielded-output fee. If the wallet is NOT
    // auto-selecting HTR (the caller supplied the HTR inputs), pulling extra
    // UTXOs would break the "user-supplied inputs -> wallet selects nothing
    // more" contract — fail instead so the caller keeps control of the input
    // set (they can add HTR, send less, or drop changeShieldedMode).
    if (!canSelectMoreHtr) {
      throw new SendTxError(
        'HTR change is too small to fund its shielded-output fee, and HTR inputs were ' +
          'user-supplied so no additional HTR can be selected to cover the difference.'
      );
    }
    // Pull extra HTR UTXOs (excluding those already consumed by this tx) until
    // the change strictly exceeds the fee, so the resulting shielded value is
    // > 0. The pulled value flows entirely into the change; it adds no shielded
    // output, so the fee does not grow again — no re-selection loop.
    const usedUtxos = new Set<string>();
    for (const inp of existingInputs) {
      usedUtxos.add(`${inp.txId}:${inp.index}`);
    }
    for (const inp of partialHtrTxData.inputs) {
      usedUtxos.add(`${inp.txId}:${inp.index}`);
    }

    // We need the pulled sum to strictly exceed the deficit so that
    // (changeValue + pulled) > additionalFee, leaving a positive shielded
    // value after subtracting the fee. Smallest-first, honoring the HTR
    // pool preference — 'desc' would sweep the largest UTXO into the shielded
    // change, silently shielding most of the wallet's HTR balance.
    const deficit = additionalFee - changeValue;
    const { pulledInputs, pulledSum } = await pullExtraHtrUtxos(
      storage,
      usedUtxos,
      pullPreference,
      sum => sum > deficit
    );

    if (pulledSum <= deficit) {
      // Deliberate hard failure, NOT a silent transparent downgrade: the caller
      // asked to shield this change, so quietly leaving it transparent to
      // "rescue" the send would publish the change (and link the sender)
      // against their stated privacy intent. Fail loudly so the caller can
      // decide (send less, consolidate HTR, or drop changeShieldedMode) rather
      // than have privacy silently downgraded.
      throw new SendTxError(
        'HTR change is too small to fund its shielded-output fee and no additional ' +
          'HTR is available to cover the difference.'
      );
    }

    partialHtrTxData.inputs.push(...pulledInputs);
    changeValue += pulledSum;
  }

  let shieldedAddress: string;
  if (shieldedChangeAddress) {
    shieldedAddress = shieldedChangeAddress;
  } else if (wallet) {
    ({ address: shieldedAddress } = await wallet.getCurrentAddress({}, { legacy: false }));
  } else {
    throw new SendTxError(
      'A shielded HTR change is required but no wallet is available to derive its address.'
    );
  }
  const addressObj = new Address(shieldedAddress, { network });
  if (!addressObj.isShielded()) {
    throw new SendTxError('Wallet did not return a shielded address for HTR change conversion.');
  }
  const spendAddress = addressObj.getSpendAddress();

  // Remove the transparent change output before appending the shielded
  // replacement so any later iteration over `partialHtrTxData.outputs`
  // sees the post-conversion shape.
  partialHtrTxData.outputs.splice(changeIdx, 1);

  shieldedOutputDefs.push({
    address: spendAddress.base58,
    value: changeValue - additionalFee,
    token: HTR_UID,
    scanPubkey: addressObj.getScanPubkey().toString('hex'),
    shieldedMode: mode,
    shieldedAddress,
    isChange: true,
  });

  return { addedFee: additionalFee };
}

async function getOutputTypeFromWallet(storage: IStorage): Promise<'p2pkh' | 'p2sh'> {
  const walletType = await storage.getWalletType();
  if (walletType === WalletType.P2PKH) {
    return 'p2pkh';
  }
  if (walletType === WalletType.MULTISIG) {
    return 'p2sh';
  }
  throw new Error('Unsupported wallet type.');
}

async function _prepareSendTokensData(
  storage: IStorage,
  dataTx: Pick<IDataTx, 'inputs' | 'outputs'>,
  options: IUtxoSelectionOptions = {},
  fee: bigint = 0n
): Promise<Pick<IDataTx, 'inputs' | 'outputs'>> {
  const token = options.token || NATIVE_TOKEN_UID;
  const utxoSelection = options.utxoSelectionMethod || bestUtxoSelection;
  const newtxData: Pick<IDataTx, 'inputs' | 'outputs'> = { inputs: [], outputs: [] };
  let outputAmount = fee;

  // Calculate balance for the token on the transaction
  for (const output of dataTx.outputs) {
    if (isDataOutputCreateToken(output)) {
      // This is a mint output
      // Since the current transaction is creating the token we can safely ignore it
      continue;
    }
    const outputToken = output.token || NATIVE_TOKEN_UID;
    if (outputToken !== token) {
      // This output is not for the token we are looking for
      continue;
    }
    outputAmount += output.value;
  }

  if (options.chooseInputs) {
    if (outputAmount === 0n) {
      // We cannot process a target amount of 0 tokens.
      throw new Error('Invalid amount of tokens to send.');
    }

    // We will choose the inputs to fill outputAmount.funds
    const newUtxos = await utxoSelection(storage, token, outputAmount);
    if (newUtxos.amount < outputAmount) {
      throw new Error(`Token: ${token}. Insufficient amount of tokens to fill the amount.`);
    }
    newtxData.inputs = newUtxos.utxos.map(helpers.getDataInputFromUtxo);

    if (newUtxos.amount > outputAmount) {
      // We need to create a change output
      const changeAddress = await storage.getChangeAddress({
        changeAddress: options.changeAddress,
      });
      const changeOutput: IDataOutput = {
        type: await getOutputTypeFromWallet(storage),
        token,
        value: newUtxos.amount - outputAmount,
        address: changeAddress,
        authorities: 0n,
        timelock: null,
        isChange: true,
      };
      newtxData.outputs.push(changeOutput);
    }
  } else {
    let inputAmount = 0n;
    for (const input of dataTx.inputs) {
      if (input.token !== token) {
        // The input is not for the token we are checking
        continue;
      }

      // We will check the validity and availability of the provided inputs
      // and the amount (suggesting a change if needed)
      // The inputs do not need to be added on newtxData.inputs since they are provided by the caller.
      const checkSpent = await checkUnspentInput(storage, input, token);
      if (!checkSpent.success) {
        throw new Error(`Token: ${token}. ${checkSpent.message}`);
      }

      if (!(await transactionUtils.canUseUtxo(input, storage))) {
        throw new Error(
          `Token: ${token}. Output [${input.txId}, ${input.index}] is locked or being used`
        );
      }

      inputAmount += input.value;
    }
    if (inputAmount < outputAmount) {
      throw new Error(`Token: ${token}. Sum of outputs is greater than sum of inputs`);
    }
    if (inputAmount > outputAmount) {
      // Need to create a change output
      const changeAddress = await storage.getChangeAddress({
        changeAddress: options.changeAddress,
      });
      newtxData.outputs.push({
        type: await getOutputTypeFromWallet(storage),
        token,
        value: inputAmount - outputAmount,
        address: changeAddress,
        authorities: 0n,
        timelock: null,
        isChange: true,
      });
    }
  }
  return newtxData;
}

/**
 * Check the tx data and propose inputs and outputs to complete the transaction.
 * We will check all the tokens and choose the inputs for each token based on the tokenMap value
 * @param {IStorage} storage
 * @param {IDataTx} dataTx
 * @param {IUtxoSelectionOptions} options
 */
export async function prepareSendManyTokensData(
  storage: IStorage,
  txData: IDataTx,
  tokenMap: Map<string, boolean>,
  changeAddress: string | null,
  utxoSelectionForToken?: (token: string) => UtxoSelectionAlgorithm | undefined
): Promise<Pick<IDataTx, 'outputs' | 'inputs'>> {
  const partialTxData: Pick<IDataTx, 'outputs' | 'inputs'> = { inputs: [], outputs: [] };
  for (const [token, chooseInputs] of tokenMap) {
    const options: IUtxoSelectionOptions = {
      token,
      chooseInputs,
    };
    const utxoSelectionMethod = utxoSelectionForToken?.(token);
    if (utxoSelectionMethod) {
      options.utxoSelectionMethod = utxoSelectionMethod;
    }
    if (changeAddress) {
      options.changeAddress = changeAddress;
    }
    const proposedData = await prepareSendTokensData(storage, txData, options);
    partialTxData.inputs.push(...proposedData.inputs);
    partialTxData.outputs.push(...proposedData.outputs);
  }
  return partialTxData;
}

/**
 * Check that the input is unspent, valid and available.
 * Will return a user-friendly message if it is not.
 *
 * @param {IStorage} storage The storage instance
 * @param {IDataInput} input The input we are checking
 * @param {string} selectedToken The token uid we are checking
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function checkUnspentInput(
  storage: IStorage,
  input: IDataInput,
  selectedToken: string
): Promise<{ success: boolean; message: string }> {
  const tx = await storage.getTx(input.txId);
  if (tx === null) {
    return { success: false, message: `Transaction [${input.txId}] does not exist in the wallet` };
  }
  if (tx.is_voided) {
    return { success: false, message: `Transaction [${input.txId}] is voided` };
  }
  // SEPARATED-model resolve so explicit shielded inputs validate against the
  // correct entry, not whatever happens to sit positionally at
  // `tx.outputs[input.index]` (which is out of bounds for any shielded slot).
  const resolved = transactionUtils.resolveSpentOutput(tx, input.index);
  if (!resolved) {
    return {
      success: false,
      message: `Transaction [${input.txId}] does not have this output [index=${input.index}]`,
    };
  }

  // Normalize the fields the checks below read off the resolved output. For a
  // shielded slot the public token/value live in the owned-marker fields
  // written in place when the wallet decrypted it; `token_data` may be absent
  // so authority detection only applies to transparent outputs.
  const isAuthority =
    resolved.kind === 'transparent' && transactionUtils.isAuthorityOutput(resolved.output);
  const outputAddress = resolved.output.decoded?.address;
  const outputToken = resolved.output.token;
  const outputSpentBy = resolved.output.spent_by;

  if (isAuthority) {
    /**
     * XXX: We are NOT enabling authority outputs for now.
     */
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] is an authority output`,
    };
  }

  if (outputAddress) {
    if (outputAddress !== input.address) {
      return {
        success: false,
        message: `Output [${input.index}] of transaction [${input.txId}] does not have the same address as the provided input`,
      };
    }
    if (!(await storage.isAddressMine(outputAddress))) {
      return {
        success: false,
        message: `Output [${input.index}] of transaction [${input.txId}] is not from the wallet`,
      };
    }
  } else {
    // This output does not have an address, so it cannot be spent by us
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] cannot be spent since it does not belong to an address`,
    };
  }

  if (outputToken !== input.token || input.token !== selectedToken) {
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] is not from selected token [${selectedToken}]`,
    };
  }

  if (outputSpentBy) {
    return {
      success: false,
      message: `Output [${input.index}] of transaction [${input.txId}] is already spent`,
    };
  }

  return { success: true, message: '' };
}
