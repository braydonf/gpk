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
const child_process = require('child_process');
const crypto = require('crypto');
const path = require('path');
const semver = require('../vendor/semver');
const exec = util.promisify(child_process.exec);
const readFile = util.promisify(fs.readFile);
const access = util.promisify(fs.access);
const {execFile} = child_process;
const NODE_GYP = path.resolve(__dirname, '../vendor/node-gyp/bin/node-gyp.js');

function expandSrc(root, remotes, name, src) {
  const [remote, id] = src.split(':');
  let [repo, version] = id.split('@');

  if (!repo)
    repo = name;

  const hosts = remotes[remote];

  if (!hosts)
    throw new Error(`Unknown remote ${remote}.`);

  const git = [];

  for (const host of hosts) {
    if (host.indexOf('file:') === 0) {
      let dir = host.replace('file:', '');

      if (!path.isAbsolute(dir))
        dir = path.resolve(root, dir)

      git.push(`${dir}/${repo}/.git`);
    } else {
      git.push(`${host}/${repo}.git`);
    }
  }

  return {git, version};
}

async function listTags(git) {
  const cmd = `git ls-remote --tags --refs -q ${git}`;
  const {stdout, stderr} = await exec(cmd);

  // Split and trim the last line.
  const items = stdout.trim().split('\n');

  const tags = items.map((item) => {
    // The format of the item is:
    // 35c9aaaffc27f295981e996a24a0cb9cd7a84ecb\trefs/tags/v1.0.0
    return item.match(/(.*)refs\/tags\/(.*)/)[2];
  });

  return tags;
}

function matchTag(tags, needed) {
  let matched = null;

  // Filter out all tags that are not version tags.
  const filtered = tags.filter(tag => tag.indexOf('v') === 0);

  // Sort lexicographical with the largest value at the beginning.
  const sorted = filtered.sort((a, b) => {
    if (a == b)
      return 0;
    else
      return a < b ? 1 : -1;
  });

  for (const tag of sorted) {
    // Remove the leading 'v' version in the tag.
    const version = tag.replace('v', '');
    if (semver.satisfies(version, needed)) {
      matched = tag;
      break;
    }
  }

  return matched;
}

async function cloneRepo(tag, git, dst) {
  let result = null;

  // Clone the remote repository with matching tag.
  const cmd = `git clone --depth 1 --branch ${tag} ${git} ${dst}`;
  result = await exec(cmd);

  // Verify the signature.
  const verify = `git verify-tag ${tag}`;
  result = await exec(verify, {cwd: dst});

  return true;
}

async function archive(git, dst) {
  const cmd = `git archive -o ${dst} HEAD`;
  const {stdout, stderr} = await exec(cmd, {cwd: git});
}

async function checksum(file, algo) {
  const stream = fs.createReadStream(file);
  const hash = crypto.createHash(algo);

  return new Promise((resolve, reject) => {
    stream.once('error', err => reject(err));
    stream.once('end', () => {
      hash.end();
      resolve(hash.digest());
    });
    stream.pipe(hash);
  });
}

async function listTree(dst) {
  return new Promise((resolve, reject) => {
    execFile(
      'git', ['ls-tree', '--full-tree', '-r', '--name-only', 'HEAD'],
      {cwd: dst},
      (err, stdout) => {
        if (err)
          reject(err);
        resolve(stdout.trim().split('\n').sort());
      });
  });
}

/**
 * Verify tree hashes by running:
 * ```
 * git ls-tree --full-tree -r --name-only HEAD | LANG=C sort \
 *   | xargs -n 1 sha512sum | sha512sum
 * ```
 *
 * Inspired by Bitcoin Core commit:
 * fa89670d34ac7839e7e2fe6f59fdfd6cc76c4483
 */

async function treeHash(dst, algo) {
  const files = await listTree(dst);
  const ctx = crypto.createHash(algo);

  while (files.length > 0) {
    const f = files.shift();
    const digest = await checksum(f, algo);
    ctx.update(Buffer.from(digest.toString('hex'), 'utf8'));
    ctx.update(Buffer.from(`  ${f}\n`, 'utf8'));
  }

  return ctx.digest();
}

async function cloneFiles(git, dst) {
  const cmd = `git clone --depth=1 ${git} ${dst}`;
  const {stdout, stderr} = await exec(cmd);
}

async function locatePkg(dst, walk = true) {
  let cwd = dst;
  let data = null;

  while (cwd != null && data == null) {
    try {
      data = await readFile(path.join(cwd, './package.json'), 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;

      const parent = path.resolve(cwd, '../');
      if (parent === cwd || !walk)
        cwd = null;
      else
        cwd = parent
    }
  }

  let pkg = null;

  if (data)
    pkg = JSON.parse(data)

  return {root: cwd, pkg};
}

async function rebuild(dst) {
  return new Promise((resolve, reject) => {
    execFile(NODE_GYP, ['rebuild'], {cwd: dst}, (err, stdout) => {
      if (err)
        reject(err);
      resolve(stdout);
    });
  });
}

async function install(dst, prefix = null) {
  const {root, pkg} = await locatePkg(dst, false);

  if (prefix == null)
    prefix = root;

  if (!pkg)
    throw new Error('Unknown package.');

  if (!pkg.dependencies)
    return;

  if (!pkg.remotes)
    throw new Error('Unknown remotes.');

  const installed = [];

  for (const [name, src] of Object.entries(pkg.dependencies)) {
    const {git, version} = expandSrc(prefix, pkg.remotes, name, src);

    // Prefer to install dependency as flat as possible.
    let dst = path.join(prefix, `./node_modules/${name}`);
    let existingPkg = null;

    try {
      existingPkg = JSON.parse(
        await readFile(path.join(dst, './package.json'), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (existingPkg) {
      if (semver.satisfies(existingPkg.version, version))
        continue;

      // There is an incompatible existing version, so it's
      // necessary to install relative to the module.
      dst = path.join(root, `./node_modules/${name}`);
    }

    for (const url of git) {
      const tags = await listTags(url);
      const tag = matchTag(tags, version);

      if (!tag)
        continue;

      const success = await cloneRepo(tag, url, dst);

      if (success) {
        installed.push(dst);
        break;
      }
    }
  }

  // Install each of the dependencies.
  for (const nextDst of installed)
    await install(nextDst, prefix);

  // Check if native addon should be built.
  const gyp = path.join(root, './binding.gyp');
  let addon = false;
  try {
    await access(gyp, fs.constants.R_OK);
    addon = true
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;
  }

  if (addon)
    await rebuild(root)
}

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
  expandSrc,
  listTags,
  matchTag,
  cloneRepo,
  archive,
  checksum,
  listTree,
  treeHash,
  cloneFiles,
  locatePkg,
  install,
  processArgs
}
