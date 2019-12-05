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

const path = require('path');

/**
 * Package
 * Exposes information and methods for installing
 * and building a package and dependencies.
 * @property {Object} global
 */

class Environment {
  /**
   * Initialize the environment.
   * @param {String} name
   * @param {Object} stdio
   * @returns {Promise}
   */

  constructor(stdio) {
    this.global = null;
    this.stdio = [
      process.stdin,
      process.stdout,
      process.stderr
    ];

    this.initProperties(stdio);
    this.initGlobal();
  }

  initProperties(stdio) {
    if (stdio != null)
      this.stdio = stdio;
  }

  /**
   * Initialize the base directory for global packages.
   * @returns {Promise}
   */

  initGlobal() {
    if (process.env.PREFIX) {
      this.global = process.env.PREFIX;
    } else {
      this.global = path.dirname(process.execPath);

      if (process.platform !== 'win32') {
        this.global = path.dirname(this.global);

        if (process.env.DESTDIR)
          this.global = path.join(process.env.DESTDIR, this.global);
      }
    }

    return this;
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
