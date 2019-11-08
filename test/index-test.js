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

const assert = require('assert');
const util = require('util');
const {randomBytes} = require('crypto');
const {resolve} = require('path');
const {tmpdir} = require('os');
const fs = require('fs');
const mkdir = util.promisify(fs.mkdir);
const child_process = require('child_process');
const exec = util.promisify(child_process.exec);

const {
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
  install
} = require('../');

describe('Git Package Manager', function() {
  const datadir = resolve(__dirname, './data');

  function testdir(name) {
    return `${tmpdir()}/gpm-test-${name}-${randomBytes(4).toString('hex')}`;
  }

  function testfile(name) {
    return `${tmpdir()}/gpm-test-${randomBytes(4).toString('hex')}-${name}`;
  }

  async function unpack(tar, dst) {
    const cmd = `tar xf ${tar} -C ${dst}`
    const {stdout, stderr} = await exec(cmd);
  }

  const remotes = {
    local: [
      `file:${datadir}`
    ],
    onion: [
      'ssh://git@fszyuaceipjhnbyy44mtfmoocwzgzunmdu46votrm5c72poeeffa.onion:22',
      'ssh://git@xg5jwb4xxwajkhur2ahuhtdwifniyoyvbm5h4yzawawwjziol3jq.onion:22',
      'ssh://git@23aj5gsggiufl6qhfbmzwd334qyhgaugbh2g3ty4ecl3jikmt5ja.onion:22',
    ],
    gitlab: [
      'https://gitlab.com'
    ],
    github: [
      'https://github.com',
    ]
  };

  it('should parse source', () => {
    const vectors = [
      {
        input: 'github:bcoin-org/bdb@~1.1.7',
        output: {
          git: [
            'https://github.com/bcoin-org/bdb.git'
          ],
          version: '~1.1.7'
        }
      },
      {
        input: 'gitlab:bcoin-org/bdb@~1.1.7',
        output: {
          git: [
            'https://gitlab.com/bcoin-org/bdb.git'
          ],
          version: '~1.1.7'
        }
      },
      {
        input: 'onion:bcoin/bcoin@~1.1.7',
        output: {
          git: [
            'ssh://git@fszyuaceipjhnbyy44mtfmoocwzgzunmdu46votrm5c72poeeffa.onion:22/bcoin/bcoin.git',
            'ssh://git@xg5jwb4xxwajkhur2ahuhtdwifniyoyvbm5h4yzawawwjziol3jq.onion:22/bcoin/bcoin.git',
            'ssh://git@23aj5gsggiufl6qhfbmzwd334qyhgaugbh2g3ty4ecl3jikmt5ja.onion:22/bcoin/bcoin.git',
          ],
          version: '~1.1.7'
        }
      },
      {
        input: 'local:repo@~1.1.7',
        output: {
          git: [
            `${datadir}/repo/.git`
          ],
          version: '~1.1.7'
        }
      }
    ];

    for (const {input, output} of vectors) {
      const src = expandSrc(datadir, remotes, input);
      assert.deepEqual(src, output);
    }
  });

  it('should find all tags', async () => {
    const git = `${datadir}/repo/.git`;

    const tags = await listTags(git);
    assert.deepEqual(tags, ['v1.0.0','v1.1.0','v2.0.0']);
  });

  it('should find matching semver tags', async () => {
    const tags = ['v1.0.0', 'v1.1.0', 'v2.0.0'];

    let tag = null;

    tag = matchTag(tags, '^1.0.0');
    assert.equal(tag, 'v1.1.0');

    tag = matchTag(tags, '^1.1.0');
    assert.equal(tag, 'v1.1.0');

    tag = matchTag(tags, '^2.0.0');
    assert.equal(tag, 'v2.0.0');
  });

  it('should clone and verify signature', async () => {
    let err = null;
    const git = `${datadir}/repo/.git`;
    const tag = 'v1.1.0'

    try {
      await cloneRepo(tag, git, testdir('clone'));
    } catch (e) {
      err = e;
    }

    assert(!err);
  });

  it('should archive and checksum repository', async () => {
    const git = `${datadir}/repo/.git`;
    let err = null;

    const dst = `${testfile('archive.tar.gz')}`;
    const expected = '+sXeok+a/rLq3Zm+R3E204qf+6by2DjMXzkGR2ZtFQ/S'
          + 'nWBL1X+k+s5Jld5CWMgLZFnERZi8Y8zlbkU+ZohIfw==';

    try {
      await archive(git, dst);
    } catch (e) {
      err = e;
    }

    assert(!err);

    let digest = null;

    try {
      digest = await checksum(dst, 'sha512');
    } catch (e) {
      err = e;
    }

    assert(!err);
    assert(digest);
    assert.equal(digest.toString('base64'), expected);
  });

  it('should compute a sha512 tree of git tree', async () => {
    const git = `${datadir}/repo/.git`;

    let err = null;
    let digest = null;

    try {
      digest = await treeHash(git, 'sha512');
    } catch (e) {
      err = e;
    }

    assert(!err);
    assert(digest);

    const expected = 'igbXIOim9X0NRErAteeEUQvGciEOFOJ1gl88qVb+385Q'
          + 'i7aabJwW5AKhUe+7+MY6OYtPCHwFjm1lJ9JAQ6RfUw==';

    assert(digest);
    assert.equal(digest.toString('base64'), expected);
  });

  it('should clone files to destination', async () => {
    let err = null;
    const git = `${datadir}/repo/.git`;
    const dst = testdir('clonefiles');

    try {
      await cloneFiles(git, dst);
    } catch (e) {
      err = e;
    }

    assert(!err);
  });

  it('should locate and read package.json', async () => {
    let err = null;

    const cwd = `${datadir}/modules/foo/lib`;

    const {root, pkg} = await locatePkg(cwd);

    assert.equal(root, `${datadir}/modules/foo`);
    assert.deepEqual(pkg, {
      name: 'foo',
      version: '1.0.0',
      main: './lib/index.js',
      remotes: {
        local: ['file:../'],
      },
      dependencies: {
        bar: 'local:bar@^1.0.0'
      }
    });
  });

  it('should install dependencies', async () => {
    // Setup the test modules.
    const modules = testdir('install');
    await mkdir(modules);
    await unpack(`${datadir}/modules.tar.gz`, modules);

    // Install the dependencies of foo module.
    await install(`${modules}/modules/foo`);
  });
});
