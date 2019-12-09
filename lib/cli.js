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

function processArgs(argv, cmds) {
  let cmd = null;
  const args = [];
  const params = Object.create(null);

  // Setup aliases.
  for (const name in cmds) {
    const aliases = cmds[name].aliases;
    if (aliases)
      for (const alias of aliases)
        cmds[alias] = cmds[name];
  }

  const cmdNames = Object.keys(cmds);
  let cmdConfig = Object.create(null);
  let argsMax = 0;
  let argsMin = 0;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    // Determine the command.
    if (!cmd) {
      if (cmdNames.includes(arg)) {
        cmd = arg;
        cmdConfig = cmds[cmd];

        for (const key in cmdConfig.params) {
          const config = cmdConfig.params[key];

          config.key = key;
          params[key] = config.fallback;

          const aliases = config.aliases;
          if (aliases) {
            for (const alias of aliases)
              cmdConfig.params[alias] = config;
          }
        }

        argsMax = cmdConfig.args.max;
        argsMin = cmdConfig.args.min;

        if (!Number.isInteger(argsMax))
          throw new Error(`Argument 'max' not an integer for '${cmd}'.`);

        if (!Number.isInteger(argsMin))
          throw new Error(`Argument 'min' not an integer for '${cmd}'.`);

        continue;
      } else {
        throw new Error(`Unknown command '${arg}'.`);
      }
    }

    // Determine the command args and params.
    const match = arg.match(/^(\-){1,2}([a-z]+)(\=)?(.*)?$/);

    if (!match) {
      if (args.length === argsMax)
        throw new Error(`Unexpected argument '${arg}'.`);

      args.push(arg);
    } else {
      const key = match[2];
      let value = match[4];

      const config = cmdConfig.params[key];

      if (!config)
        throw new Error(`Invalid argument '${arg}'.`);

      if (config.value && !value) {
        value = process.argv[i + 1];
        i++;
      } else if (!config.value && !value) {
        value = true;
      } else if (!config.value && value) {
        throw new Error(`Unexpected value '${key}=${value}'.`);
      }

      if (config.parse)
        value = config.parse(value);

      if (value)
        params[config.key] = value;

      if (!config.valid(params[config.key]))
        throw new Error(`Invalid value '${key}=${value}'.`);
    }
  }

  if (args.length < argsMin)
    throw new Error('Too few arguments.');

  return {cmd, args, params};
}

function printHelp(cmds) {
  const {stdout} = process;

  const pkg = require('../package.json');
  const which = path.resolve(__dirname, '../');
  const commandNames = Object.keys(cmds).sort();

  stdout.write('\n');
  stdout.write(`Usage: ${pkg.name} <command>\n\n`);
  stdout.write('where <command> is one of:\n');
  stdout.write(`    ${commandNames.join(', ')}`);
  stdout.write('\n\n');
  stdout.write(`${pkg.name}@${pkg.version} ${which}\n`);
}

module.exports = {
  processArgs,
  printHelp
}
