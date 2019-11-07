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
const {execFile} = child_process;

function expandSrc(remotes, src) {
  const [remote, path] = src.split(':');
  const [repo, version] = path.split('@');

  const hosts = remotes[remote];

  if (!hosts)
    throw new Error(`Unknown remote ${remote}.`);

  const git = [];

  for (const host of hosts) {
    if (remote === 'file')
      git.push(`${host}/${repo}/.git`);
    else
      git.push(`${host}/${repo}.git`);
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

async function clone(remotes, src, dst) {
  const {git, version} = expandSrc(remotes, src);
  const tags = await listTags(git);
  const tag = matchTag(tags, version);

  let result = null;

  // Clone the remote repository with matching tag.
  const cmd = `git clone --depth 1 --bare --branch ${tag} ${git} ${dst}`;
  result = await exec(cmd);

  // Verify the signature.
  const verify = `git verify-tag ${tag}`;
  result = await exec(verify, {cwd: dst});
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

module.exports = {
  expandSrc,
  listTags,
  matchTag,
  clone,
  archive,
  checksum,
  listTree,
  treeHash,
  cloneFiles
}
