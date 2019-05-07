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
      var _this2 = this;

      if (this.started) {
        return;
      }
      var wsURL = _helpers2.default.getWSServerURL();
      if (wsURL === null) {
        return;
      }
      this.ws = new WebSocket(wsURL);

      this.ws.onopen = function () {
        _this2.onOpen();
      };
      this.ws.onmessage = function (evt) {
        _this2.onMessage(evt);
      };
      this.ws.onerror = function (evt) {
        _this2.onError(evt);
      };
      this.ws.onclose = function () {
        _this2.onClose();
      };
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
      this.emit(_type, message);
    }

    /**
     * Method called when websocket connection is opened
     */

  }, {
    key: 'onOpen',
    value: function onOpen() {
      var _this3 = this;

      if (this.connected === false) {
        // If was not connected  we need to reload data
        // Emits event to reload data
        this.emit('reload_data');
      }
      this.connected = true;
      this.started = true;
      this.setIsOnline(true);
      this.heartbeat = setInterval(function () {
        _this3.sendPing();
      }, HEARTBEAT_TMO);
      _wallet2.default.subscribeAllAddresses();
    }

    /**
     * Method called when websocket connection is closed
     */

  }, {
    key: 'onClose',
    value: function onClose() {
      var _this4 = this;

      this.started = false;
      this.connected = false;
      this.setIsOnline(false);
      setTimeout(function () {
        _this4.setup();
      }, 500);
      clearInterval(this.heartbeat);
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
      var _this5 = this;

      if (!this.started) {
        this.setIsOnline(false);
        return;
      }

      if (this.ws.readyState === WS_READYSTATE_READY) {
        this.ws.send(msg);
      } else {
        // If it is still connecting, we wait a little and try again
        setTimeout(function () {
          _this5.sendMessage(msg);
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
      this.sendMessage(msg);
    }

    /**
     * Method called to end a websocket connection
     *
     */

  }, {
    key: 'endConnection',
    value: function endConnection() {
      this.setIsOnline(undefined);
      this.started = false;
      this.connected = undefined;
      if (this.ws) {
        this.ws.onclose = function () {};
        this.ws.close();
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
      if (this.isOnline !== value) {
        this.isOnline = value;
        // Emits event of online state change
        this.emit('is_online', value);
      }
    }
  }]);

  return WS;
}(_events2.default);

var instance = new WS();

exports.default = instance;