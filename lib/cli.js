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

function processArgs(argv, config, cmds) {
  const args = {};
  let cmd = null;

  for (const key in config)
    args[key] = config[key].fallback;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (cmds.includes(arg)) {
      if (!cmd)
        cmd = arg;
      else
        throw new Error(`Unexpected command: ${arg}.`);

      continue;
    }

    const match = arg.match(/^(\-){1,2}([a-z]+)(\=)?(.*)?$/);

    if (!match) {
      throw new Error(`Unexpected argument: ${arg}.`);
    } else {
      const key = match[2];
      let value = match[4];

      if (!config[key])
        throw new Error(`Invalid argument: ${arg}.`);

      if (config[key].value && !value) {
        value = process.argv[i + 1];
        i++;
      } else if (!config[key].value && !value) {
        value = true;
      } else if (!config[key].value && value) {
        throw new Error(`Unexpected value: ${key}=${value}`);
      }

      if (config[key].parse)
        value = config[key].parse(value);

      if (value)
        args[key] = value;

      if (!config[key].valid(args[key]))
        throw new Error(`Invalid value: ${key}=${value}`);
    }
  }

  return {cmd, args};
}

module.exports = {
  processArgs
}
