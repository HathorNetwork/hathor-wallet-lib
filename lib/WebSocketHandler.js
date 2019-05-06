'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('events');

var _events2 = _interopRequireDefault(_events);

var _helpers = require('./helpers');

var _helpers2 = _interopRequireDefault(_helpers);

var _wallet = require('./wallet');

var _wallet2 = _interopRequireDefault(_wallet);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } /**
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                * Copyright (c) Hathor Labs and its affiliates.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                *
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                * This source code is licensed under the MIT license found in the
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                * LICENSE file in the root directory of this source tree.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                */

var HEARTBEAT_TMO = 30000; // 30s
var WS_READYSTATE_READY = 1;

/**
 * Handles websocket connections and message transmission
 *
 * @class
 * @name WebSocketHandler
 */

var WS = function (_EventEmitter) {
  _inherits(WS, _EventEmitter);

  function WS() {
    var _ret;

    _classCallCheck(this, WS);

    if (!WS.instance) {
      // Boolean to show when there is a websocket started with the server
      var _this = _possibleConstructorReturn(this, (WS.__proto__ || Object.getPrototypeOf(WS)).call(this));

      _this.started = false;
      // Boolean to show when the websocket connection is working
      _this.connected = undefined;
      // Store variable that is passed to Redux if ws is online
      _this.isOnline = undefined;
      _this.setup();
    }

    return _ret = WS.instance, _possibleConstructorReturn(_this, _ret);
  }

  /**
   * Start websocket object and its methods
   */


  _createClass(WS, [{
    key: 'setup',
    value: function setup() {
      if (this.started) {
        return;
      }
      var wsURL = _helpers2.default.getWSServerURL();
      if (wsURL === null) {
        return;
      }
      this.ws = new WebSocket(wsURL);

      this.ws.onopen = this.onOpen;
      this.ws.onmessage = this.onMessage;
      this.ws.onerror = this.onError;
      this.ws.onclose = this.onClose;
    }

    /**
     * Handle message receiving from websocket
     *
     * @param {Object} evt Event that has data (evt.data) sent in the websocket
     */

  }, {
    key: 'onMessage',
    value: function onMessage(evt) {
      var message = JSON.parse(evt.data);
      var _type = message.type.split(':')[0];
      //this.emit(_type, message);
      instance.emit(_type, message);
    }

    /**
     * Method called when websocket connection is opened
     */

  }, {
    key: 'onOpen',
    value: function onOpen() {
      if (instance.connected === false) {
        // If was not connected  we need to reload data
        _wallet2.default.reloadData();
      }
      instance.connected = true;
      instance.started = true;
      //instance.setIsOnline(true);
      instance.heartbeat = setInterval(instance.sendPing, HEARTBEAT_TMO);
      _wallet2.default.subscribeAllAddresses();
    }

    /**
     * Method called when websocket connection is closed
     */

  }, {
    key: 'onClose',
    value: function onClose() {
      instance.started = false;
      instance.connected = false;
      //instance.setIsOnline(false);
      setTimeout(instance.setup, 500);
      clearInterval(instance.heartbeat);
    }

    /**
     * Method called when an error happend on websocket
     *
     * @param {Object} evt Event that contains the error
     */

  }, {
    key: 'onError',
    value: function onError(evt) {
      console.log('ws error', evt);
    }

    /**
     * Method called to send a message to the server
     *
     * @param {string} msg Message to be sent to the server (usually JSON stringified)
     */

  }, {
    key: 'sendMessage',
    value: function sendMessage(msg) {
      var _this2 = this;

      if (!instance.started) {
        //instance.setIsOnline(false);
        return;
      }

      if (instance.ws.readyState === WS_READYSTATE_READY) {
        instance.ws.send(msg);
      } else {
        // If it is still connecting, we wait a little and try again
        setTimeout(function () {
          _this2.sendMessage(msg);
        }, 1000);
      }
    }

    /**
     * Ping method to check if server is still alive
     *
     */

  }, {
    key: 'sendPing',
    value: function sendPing() {
      var msg = JSON.stringify({ 'type': 'ping' });
      instance.sendMessage(msg);
    }

    /**
     * Method called to end a websocket connection
     *
     */

  }, {
    key: 'endConnection',
    value: function endConnection() {
      //instance.setIsOnline(undefined);
      instance.started = false;
      instance.connected = undefined;
      if (instance.ws) {
        instance.ws.onclose = function () {};
        instance.ws.close();
      }
    }

    /**
     * Set in redux if websocket is online
     *
     * @param {*} value Can be true|false|undefined
     */

  }, {
    key: 'setIsOnline',
    value: function setIsOnline(value) {
      // Save in redux
      // Need also to keep the value in 'this' because I was accessing redux store
      // from inside a reducer and was getting error
      if (instance.isOnline !== value) {
        instance.isOnline = value;
      }
    }
  }]);

  return WS;
}(_events2.default);

var instance = new WS();

exports.default = instance;
