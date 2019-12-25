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
const fs = require('fs');
const readlink = util.promisify(fs.readlink);
const access = util.promisify(fs.access);
const mkdir = util.promisify(fs.mkdir);
const symlink = util.promisify(fs.symlink);

async function ensureDir(dir) {
  try {
    await access(dir, fs.constants.R_OK & fs.constants.W_OK);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;

    await mkdir(dir);
  }
}

async function ensureSymlink(target, dst) {
  let existing = null;

  try {
    existing = await readlink(dst);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;
  }

  if (existing && existing !== target)
    throw new Error(`Existing '${dst}' symlink.`);
  else if (existing)
    return;

  return symlink(target, dst);
}

module.exports = {
  ensureDir,
  ensureSymlink
}
