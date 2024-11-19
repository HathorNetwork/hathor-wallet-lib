"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UtxoSelection = void 0;
exports.bestUtxoSelection = bestUtxoSelection;
exports.fastUtxoSelection = fastUtxoSelection;
exports.getAlgorithmFromEnum = getAlgorithmFromEnum;
function _asyncIterator(r) { var n, t, o, e = 2; for ("undefined" != typeof Symbol && (t = Symbol.asyncIterator, o = Symbol.iterator); e--;) { if (t && null != (n = r[t])) return n.call(r); if (o && null != (n = r[o])) return new AsyncFromSyncIterator(n.call(r)); t = "@@asyncIterator", o = "@@iterator"; } throw new TypeError("Object is not async iterable"); }
function AsyncFromSyncIterator(r) { function AsyncFromSyncIteratorContinuation(r) { if (Object(r) !== r) return Promise.reject(new TypeError(r + " is not an object.")); var n = r.done; return Promise.resolve(r.value).then(function (r) { return { value: r, done: n }; }); } return AsyncFromSyncIterator = function (r) { this.s = r, this.n = r.next; }, AsyncFromSyncIterator.prototype = { s: null, n: null, next: function () { return AsyncFromSyncIteratorContinuation(this.n.apply(this.s, arguments)); }, return: function (r) { var n = this.s.return; return void 0 === n ? Promise.resolve({ value: r, done: !0 }) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); }, throw: function (r) { var n = this.s.return; return void 0 === n ? Promise.reject(r) : AsyncFromSyncIteratorContinuation(n.apply(this.s, arguments)); } }, new AsyncFromSyncIterator(r); } /**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
let UtxoSelection = exports.UtxoSelection = /*#__PURE__*/function (UtxoSelection) {
  UtxoSelection["FAST"] = "fast";
  UtxoSelection["BEST"] = "best";
  return UtxoSelection;
}({});
/**
 * Get the algorithm function from the enum value.
 *
 * @param algorithm The algorithm to get
 * @returns {UtxoSelectionAlgorithm} The algorithm function
 */
function getAlgorithmFromEnum(algorithm) {
  switch (algorithm) {
    case UtxoSelection.FAST:
      return fastUtxoSelection;
    case UtxoSelection.BEST:
      return bestUtxoSelection;
    default:
      throw new Error(`Unknown algorithm ${algorithm}`);
  }
}

/**
 * Select utxos to fill the amount required.
 * This method should be faster since it stops the iteration once the target amount is reached.
 * Obs: Does not work with authority utxos.
 *
 * @param {IStorage} storage The wallet storage to select the utxos
 * @param {string} token The token uid to select the utxos
 * @param {OutputValueType} amount The target amount of tokens required
 * @returns {Promise<{ utxos: IUtxo[], amount: OutputValueType, available?: OutputValueType }>}
 */
async function fastUtxoSelection(storage, token, amount) {
  const utxos = [];
  let utxosAmount = 0n;
  const options = {
    token,
    authorities: 0n,
    target_amount: amount,
    only_available_utxos: true,
    order_by_value: 'desc'
  };
  var _iteratorAbruptCompletion = false;
  var _didIteratorError = false;
  var _iteratorError;
  try {
    for (var _iterator = _asyncIterator(storage.selectUtxos(options)), _step; _iteratorAbruptCompletion = !(_step = await _iterator.next()).done; _iteratorAbruptCompletion = false) {
      const utxo = _step.value;
      {
        // We let selectUtxos to filter the utxos for us and stop after target amount is reached
        utxosAmount += utxo.value;
        utxos.push(utxo);
      }
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (_iteratorAbruptCompletion && _iterator.return != null) {
        await _iterator.return();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }
  if (utxosAmount < amount) {
    // Not enough funds to fill the amount required.
    return {
      utxos: [],
      amount: 0n,
      available: utxosAmount
    };
  }
  return {
    utxos,
    amount: utxosAmount
  };
}

/**
 * Select utxos to fill the amount required.
 * This method will select the smallest utxos that are bigger than the amount required.
 * Obs: this will iterate on all available utxos to choose the best suited selection.
 * Obs: Does not work with authority utxos.
 *
 * @param {IStorage} storage The wallet storage to select the utxos
 * @param {string} token The token uid to select the utxos
 * @param {OutputValueType} amount The target amount of tokens required
 * @returns {Promise<{ utxos: IUtxo[], amount: OutputValueType, available?: OutputValueType }>}
 */
async function bestUtxoSelection(storage, token, amount) {
  const utxos = [];
  let utxosAmount = 0n;
  let selectedUtxo = null;
  const options = {
    token,
    authorities: 0n,
    only_available_utxos: true,
    order_by_value: 'desc'
  };
  var _iteratorAbruptCompletion2 = false;
  var _didIteratorError2 = false;
  var _iteratorError2;
  try {
    for (var _iterator2 = _asyncIterator(storage.selectUtxos(options)), _step2; _iteratorAbruptCompletion2 = !(_step2 = await _iterator2.next()).done; _iteratorAbruptCompletion2 = false) {
      const utxo = _step2.value;
      {
        // storage ensures the utxo can be used
        if (utxo.value === amount) {
          return {
            utxos: [utxo],
            amount
          };
        }
        utxos.push(utxo);
        utxosAmount += utxo.value;
        if (utxo.value > amount) {
          // We want to select the smallest utxo that is bigger than the amount
          if (selectedUtxo === null || utxo.value < selectedUtxo.value) {
            selectedUtxo = utxo;
          }
        }
        if (utxo.value < amount) {
          if (selectedUtxo !== null) {
            // We already have an utxo that is bigger than the amount required
            // with the lowest possible value.
            // We don't need to iterate more
            break;
          }
          if (utxosAmount >= amount) {
            // We have enough funds to fill the amount required
            // We don't need to iterate more
            break;
          }
        }
      }
    }
  } catch (err) {
    _didIteratorError2 = true;
    _iteratorError2 = err;
  } finally {
    try {
      if (_iteratorAbruptCompletion2 && _iterator2.return != null) {
        await _iterator2.return();
      }
    } finally {
      if (_didIteratorError2) {
        throw _iteratorError2;
      }
    }
  }
  if (selectedUtxo !== null) {
    return {
      utxos: [selectedUtxo],
      amount: selectedUtxo.value
    };
  }
  if (utxosAmount < amount) {
    // We don't have enough funds
    return {
      utxos: [],
      amount: 0n,
      available: utxosAmount
    };
  }
  // We need to ensure we use the smallest number of utxos and avoid hitting the maximum number of inputs
  // This can be done by ordering the utxos by value and selecting the highest values first until the amount is fulfilled
  // But since the store ensures the utxos are ordered by value descending
  // (Which is ensured by options.order_by_value = 'desc' on the selectUtxos method)
  // And we stop selecting when the amount in the utxos array is greater than or equal to the requested amount
  // We can just return the utxos selected during the loop above
  return {
    utxos,
    amount: utxosAmount
  };
}