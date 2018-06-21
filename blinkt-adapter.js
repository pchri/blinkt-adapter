/**
 * Blinkt!Adapter - an adapter for controlling Pimoroni Blinkt!
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const Gpio = require('onoff').Gpio;
const Color = require('color');

const {
  Adapter,
  Constants,
  Device,
  Property,
} = require('gateway-addon');

/**
 * Property of a Blinkt! device - ie a single RGB LED
 * Boolean on/off or level or color
 */
class BlinktProperty extends Property {
  constructor(device, name, descr, value) {
    super(device, name, descr);
    this.setCachedValue(value);
  }

  /**
   * setValue - set property value
   * @param {boolean|number|color} value
   * @return {Promise} a promise which resolves to the updated value.
   */
  setValue(value) {
    let changed = this.value !== value;
    return new Promise(resolve => {
      this.setCachedValue(value);
      resolve(this.value);
      if (changed) {
        this.device.notifyPropertyChanged(this);
      }
    });
  }
}

/**
 * A single Blinkt! RGB LED
 */
class BlinktDevice extends Device {
  /**
   * @param {BlinktAdapter} adapter
   * @param {String} id - A globally unique identifier
   * @param {String} deviceId - id of the device expected by the bridge API
   * @param {Object} device - the device API object
   */
  constructor(adapter, id, name) {
    super(adapter, id);
    this.name = name;
    this.type = Constants.THING_TYPE_DIMMABLE_COLOR_LIGHT;
    this.properties.set('on',
      new BlinktProperty(this, 'on', {type: 'boolean'}, false));
    this.properties.set('color',
      new BlinktProperty(this, 'color', {type: 'string'}, '#ffffff'));
    this.properties.set('level',
      new BlinktProperty(this, 'level', {type: 'number'}, 8));
    this.adapter.handleDeviceAdded(this);
  }

  /**
   * When a property changes notify the Adapter to communicate with the Blinkt!
   * Property changes are batched using a timer in the adapter.
   * @param {BlinktProperty} property
   */
  notifyPropertyChanged(property) {
    super.notifyPropertyChanged(property);
    this.adapter.sendProperties();
  }

  /**
   * sendProperties - use adapter to send the properties of this device
   */
  sendProperties() {
    const on = this.properties.get('on').value; 
    const cssc = Color(this.properties.get('color').value);
    let lvl = this.properties.get('level').value; 
    if (!on) {
      lvl = 0;
    }
    this.adapter.sendDeviceProperties(lvl, cssc);
  }
}

/**
 * Blinkt! Adapter
 * Instantiates 8 BlinktDevices - one for each RGB LED
 */
class BlinktAdapter extends Adapter {
  constructor(adapterManager, packageName, bridgeId, bridgeIp) {
    super(adapterManager, 'blinkt-adapter', packageName);
    adapterManager.addAdapter(this);
    this.pendingSend = false;
    this._gpio_setup();
    this.createDevices();
    this.sendProperties();
  }

  /**
   * createDevices, instantiate one BlinktDevice per RGB LED
   */
  createDevices() {
    for (var x = 0; x < 8; x++) {
      this.createDevice(x);
    }
  }

  /**
   * createDevice - create one BlinktDevice representing an RGB LED
   * @param {Number} deviceNum - LED number (0..7)   
   */
  createDevice(deviceNum) {
    const id = 'blinkt-led-'+(deviceNum+1);
    const name = 'Blinkt! LED '+(deviceNum+1);
    new BlinktDevice(this, id, name);
  }

  /**
   * _gpio_setup from blinkt.py
   */
  _gpio_setup() {
    this.gpioDAT = new Gpio(23, 'out'); // BCM 23 // GPIO 4
    this.gpioCLK = new Gpio(24, 'out'); // BCM 24 // GPIO 5
  }

  _write_bit(b) {
    this.gpioDAT.writeSync(b);
    this.gpioCLK.writeSync(1);
    this.gpioCLK.writeSync(0);
  }

  /**
   * _write_byte from blinkt.py
   */
  _write_byte(byte) {
    for (var x = 0; x < 8; x++) {
      this._write_bit(byte & 0b10000000 ? 1 : 0);
      byte = byte << 1;
    }
  }

  /**
   * _sof from blinkt.py
   */
  _sof() {
    for (var x = 0; x < 32; x++) {
      this._write_bit(0);
    }
  }

  /**
   * _eof from blinkt.py
   */
  _eof() {
    for (var x = 0; x < 36; x++) {
      this._write_bit(0);
    }
  }

  /**
   * sendDeviceProperties - called by devices to write properties
   * to the Blinkt!
   * @param {Number} lvl - Light level (0..100)   
   * @param {Color} col - Light color
   */
  sendDeviceProperties(lvl, col) {
    lvl = Math.round((lvl * 15) / 100);
    this._write_byte(0xe0 | lvl);
    this._write_byte(col.blue());
    this._write_byte(col.green());
    this._write_byte(col.red());
  }

  /**
   * sendProperties - schedule sending all device properties to the Blinkt!
   * Property changes are batched using a timer to limit the number of times
   * we actually send data to the Blinkt!
   */
  sendProperties() {
    if (this.pendingSend) {
      clearTimeout(this.timer);
    }
    this.pendingSend = true;
    let obj = this;
    this.timer = setTimeout(function() {
      obj.doSendProperties();
    }, 100);
  }

  /**
   * doSendProperties - send all device properties to the Blinkt!
   * This is done by asking each device (LED) to send its own properties
   * inside a frame marked by _sof() and _eof()
   */
  doSendProperties() {
    this.pendingSend = false;
    this._sof();     
    for (var x = 0; x < 8; x++) {
      this.devices['blinkt-led-'+(x+1)].sendProperties();
    }
    this._eof();
  }
}

function loadBlinktAdapter(addonManager, manifest, _errorCallback) {
  const adapter = new BlinktAdapter(addonManager, manifest.name);
}

module.exports = loadBlinktAdapter;
