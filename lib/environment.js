/*!
 * Copyright (c) 2019, Braydon Fuller
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');
const mkdir = util.promisify(fs.mkdir);
const access = util.promisify(fs.access);

/**
 * Environment
 * @property {Object} global
 * @property {Object} home
 * @property {Object} cache
 * @property {Object} stdio
 */

class Environment {
  /**
   * Initialize the environment.
   * @param {Object} stdio
   * @param {String} home
   * @param {String} global
   * @returns {Promise}
   */

  constructor(stdio, home, global) {
    this.global = null;
    this.home = null;
    this.cache = null;

    this.stdio = [
      process.stdin,
      process.stdout,
      process.stderr
    ];

    this.initProperties(stdio, home, global);
  }

  /**
   * Initialize the environment properties.
   * @param {Object} stdio
   * @param {String} home
   * @param {String} global
   * @returns {Promise}
   */

  initProperties(stdio, home, global) {
    if (stdio != null)
      this.stdio = stdio;

    // Setup global.
    if (global != null) {
      this.global = global;
    } else if (process.env.PREFIX) {
      this.global = process.env.PREFIX;
    } else {
      this.global = path.dirname(process.execPath);

      if (process.platform !== 'win32') {
        this.global = path.dirname(this.global);

        if (process.env.DESTDIR)
          this.global = path.join(process.env.DESTDIR, this.global);
      }
    }

    // Setup home.
    if (home != null)
      this.home = home;
    else
      this.home = path.join(os.homedir(), './.gpk');

    this.cache = path.join(this.home, './cache');
  }

  /**
   * Ensure that necessary home directories exist.
   * @returns {Promise}
   */

  async ensure() {
    async function init(dir) {
      try {
        await access(dir, fs.constants.R_OK & fs.constants.W_OK);
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
        else
          await mkdir(dir);
      }
    }

    await init(this.home);
    await init(this.cache);
  }

  /**
   * Write to configured output.
   * @param {String} data
   */

  stdout(data) {
    this.stdio[1].write(data);
  }

  /**
   * Write to configured error output.
   * @param {String} data
   */

  stderr(data) {
    this.stdio[2].write(data);
  }

  /**
   * Log at info level.
   * @param {String} data
   */

  log(data) {
    this.stdout(`gpk: \x1b[34m[info]\x1b[39m ${data}\n`);
  }

  /**
   * Log at warn level.
   * @param {String} data
   */

  warn(data) {
    this.stdout(`gpk: \x1b[35m[warn]\x1b[39m ${data}\n`);
  }

  /**
   * Log at debug level.
   * @param {String} data
   */

  debug(data) {
    this.stdout(`gpk: \x1b[36m[debug]\x1b[39m ${data}\n`);
  }

  /**
   * Log at error level.
   * @param {String} data
   */

  error(data) {
    this.stderr(`gpk: \x1b[31m[error]\x1b[39m ${data}\n`);
  }
}

module.exports = Environment;
