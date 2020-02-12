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
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);
const child_process = require('child_process');
const {spawn} = child_process;

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

      if (!isWin32()) {
        this.global = path.dirname(this.global);

        if (process.env.DESTDIR)
          this.global = path.join(process.env.DESTDIR, this.global);
      }
    }

    // Setup global paths.
    if (!isWin32()) {
      this.globalLibRoot = path.join(this.global, './lib/');
      this.globalLib = path.join(this.global, './lib/node_modules');
      this.globalBin = path.join(this.global, './bin');
    } else {
      this.globalLibRoot = path.join(this.global, './');
      this.globalLib = path.join(this.global, './node_modules');
      this.globalBin = path.join(this.global, './');
    }

    // Setup home.
    if (home != null)
      this.home = home;
    else
      this.home = path.join(os.homedir(), './.gpk');

    this.cache = path.join(this.home, './cache');
  }

  /**
   * For Windows a command script is generated
   * as the shebang of the target executable is
   * not honored.
   * @param {String} target
   * @returns {Promise}
   */

  async createCmd(target) {
    if (!isWin32())
      return;

    let body = `:: File created by gpk.\r\n`;
    body += `@ECHO OFF\r\n`;
    body += `node "${target}" %*\r\n`;

    await writeFile(`${target}.cmd`, body);
  }

  async unlinkCmd(target) {
    if (!isWin32())
      return;

    return unlink(`${target}.cmd`);
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
   * Will run a command and arguments with the supplied
   * directory, environment variables and an additional
   * location added to the path.
   * @param {String} cmd
   * @param {Array} args
   * @param {Object} options
   * @param {Object} options.cwd
   * @param {Object} options.env
   * @param {String} options.extraPath
   */

  async run(cmd, args, options) {
    const env = Object.assign({}, options.env);

    let PATH = env.PATH;
    if (isWin32())
      PATH = env.Path;

    if (options.extraPath)
      PATH = `${options.extraPath}${isWin32() ? ';' : ':'}${PATH}`;

    if (isWin32())
      env.Path = PATH;
    else
      env.PATH = PATH;

    return new Promise((resolve, reject) => {
      let shell = false;

      if (isWin32())
        shell = true;

      const child = spawn(cmd, args, {
        shell: shell,
        cwd: options.cwd,
        stdio: this.stdio,
        env: env
      });

      child.once('exit', code => resolve(code));
      child.once('error', err => reject(err));
    });
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

function isWin32() {
  return (process.platform === 'win32');
}

module.exports = Environment;
