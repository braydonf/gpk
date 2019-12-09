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

class CLI {
  constructor(cmds) {
    this.cmds = cmds;

    this.cmd = null;
    this.args = null;
    this.params = null;
  }

  process(argv) {
    let cmd = null;
    const args = [];
    const params = Object.create(null);

    // Setup aliases.
    for (const key in this.cmds) {
      this.cmds[key].key = key;
      const aliases = this.cmds[key].aliases;
      if (aliases)
        for (const alias of aliases)
          this.cmds[alias] = this.cmds[key];
    }

    const cmdNames = Object.keys(this.cmds);
    let cmdConfig = Object.create(null);
    let argsMax = 0;
    let argsMin = 0;

    for (let i = 2; i < argv.length; i++) {
      const arg = argv[i];

      // Determine the command.
      if (!cmd) {
        if (cmdNames.includes(arg)) {
          cmdConfig = this.cmds[arg];
          cmd = cmdConfig.key;

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
          value = argv[i + 1];
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

    this.cmd = cmd;
    this.args = args;
    this.params = params;
  }

  async run(argv) {
    if (argv)
      this.process(argv);

    let config = this.cmds[this.cmd];
    if (!config)
      config = this.cmds.help;

    return config.fn(this.args, this.params);
  }
}

module.exports = CLI;
