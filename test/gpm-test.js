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
  matchTag,
  locatePkg,
  rebuild,
  install
} = require('../lib/gpm');

const {
  listTags,
  cloneRepo,
  verifyRepo,
  archive,
  listTree,
  checksum,
  treeHash,
  cloneFiles
} = require('../lib/git');

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
        input: {
          name: 'bdb',
          src: 'github:bcoin-org/bdb@~1.1.7',
        },
        output: {
          git: [
            'https://github.com/bcoin-org/bdb.git'
          ],
          version: '~1.1.7'
        }
      },
      {
        input: {
          name: 'bdb',
          src: 'gitlab:bcoin-org/bdb@~1.1.7',
        },
        output: {
          git: [
            'https://gitlab.com/bcoin-org/bdb.git'
          ],
          version: '~1.1.7'
        }
      },
      {
        input: {
          name: 'bcoin',
          src: 'onion:bcoin/bcoin@~1.1.7'
        },
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
        input: {
          name: 'repo',
          src: 'local:repo@~1.1.7'
        },
        output: {
          git: [
            `${datadir}/repo/.git`
          ],
          version: '~1.1.7'
        }
      },
      {
        input: {
          name: 'repo',
          src: 'local:@~1.1.7'
        },
        output: {
          git: [
            `${datadir}/repo/.git`
          ],
          version: '~1.1.7'
        }
      }
    ];

    for (const {input, output} of vectors) {
      const src = expandSrc(datadir, remotes, input.name, input.src);
      assert.deepEqual(src, output);
    }
  });

  it('should parse legacy package', () => {
    const vectors = [
      {
        input: {
          name: 'repo',
          src: '~1.1.7'
        },
        output: {
          git: [],
          version: '~1.1.7'
        }
      }
    ];

    const remotes = undefined;

    for (const {input, output} of vectors) {
      const src = expandSrc(datadir, remotes, input.name, input.src);
      assert.deepEqual(src, output);
    }
  });

  it('should find all tags', async () => {
    const git = `${datadir}/repo/.git`;

    const tags = await listTags(git);
    assert.deepEqual(tags, {
      'v1.0.0': {
        annotated: 'dff7f77c1a6f17cefec11342a6e410ab83c8488a',
        commit: '35c9aaaffc27f295981e996a24a0cb9cd7a84ecb'
      },
      'v1.1.0': {
        annotated: '94071e59398891cb2cfd183045237c2494923459',
        commit: '36ea09f31e77f24a796722adfa51eb62dac043fa'
      },
      'v2.0.0': {
        annotated: '0ab87dcfe1dc8c327b1d8b8e9fa78bb1839ea86f',
        commit: '294acab444f9742a7c1d0de273b7a412e7809e52'
      },
      'v2.1.0': {
        commit: '3d2115aa2e86d8c08ce1639d177757aa1ce85799'
      }
    });
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
    const tag = 'v1.1.0';
    const dst = testdir('clone');

    try {
      await cloneRepo(tag, git, dst);
    } catch (e) {
      err = e;
    }

    assert(!err);

    try {
      await verifyRepo(tag, null, dst);
    } catch (e) {
      err = e;
    }

    assert(!err);
  });

  it('should clone and verify lightweight tag', async () => {
    let err = null;
    const git = `${datadir}/repo/.git`;

    // The tag was created lightweight via `git tag v2.1.0` instead of
    // `git tag -a v2.1.0 -m "v2.1.0"`. Thus the command `git verify-tag`
    // can not be used.
    const tag = 'v2.1.0';
    const commit = '3d2115aa2e86d8c08ce1639d177757aa1ce85799';
    const dst = testdir('clonelight');

    try {
      await cloneRepo(tag, git, dst);
    } catch (e) {
      err = e;
    }

    assert(!err);

    try {
      await verifyRepo(null, commit, dst);
    } catch (e) {
      err = e;
    }

    assert(!err);
  });

  it('should archive and checksum repository', async () => {
    const git = `${datadir}/repo/.git`;
    let err = null;

    const dst = `${testfile('archive.tar.gz')}`;
    const expected = 'wNVracPFLWusleCon1AQu+ngVEmjZpliCCgUY2bcfVLr'
          + 'JCrun9NOVAMM8XgUH3+A4gpbY2JEjmm1+yPii1wiAQ==';

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

    const expected = '5wtrttD9yjVEQgmQY4mXWTzIpN5dLh6peY2gAIvu8dpv'
          + '6NMlo+E1Bf9acr5gjNtuUQtuOkaopWeOzpeNm8VU1Q==';

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
        bar: 'local:bar@^1.0.0',
        beep: 'local:beep@^1.0.0',
        bloop: 'local:bloop@^1.0.0'
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
