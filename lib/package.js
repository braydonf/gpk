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
const path = require('path');
const semver = require('../vendor/semver');
const readFile = util.promisify(fs.readFile);
const access = util.promisify(fs.access);
const readdir = util.promisify(fs.readdir);
const {execFile, spawn} = child_process;
const {cloneRepo, verifyRepo, listTags, matchTag} = require('./git');

const NODE_GYP = path.resolve(__dirname, '../vendor/node-gyp/bin/node-gyp.js');

/**
 * Package
 * Exposes information and methods for installing
 * and building a package and dependencies.
 * @property {String} dir
 * @property {Object} info
 */

class Package {

  /**
   * Initialize the package.
   * @param {Object?} options
   * @returns {Promise}
   */
  constructor(options) {
    this.dir = null;
    this.info = null;
    this.stdio = [
      process.stdin,
      process.stdout,
      process.stderr
    ];

    if (options)
      this.fromOptions(options);
  }

  /**
   * Initialize the package from object with
   * the directory of the package and the package
   * definition (package.json).
   * @param {Object} options
   * @param {String} options.dir
   * @param {Object} options.info
   * @returns {Promise}
   */

  fromOptions(options) {
    if (options.dir != null)
      this.dir = options.dir;

    if (options.info != null)
      this.info = options.info;

    if (options.stdio != null)
      this.stdio = options.stdio;

    return this;
  }

  /**
   * Initialize the package from a directory. Optionally
   * it will recursively walk up directories to find the
   * package definition.
   * @param {String} dir
   * @param {Boolean?} walk
   * @returns {Promise}
   */

  async fromDirectory(dir, walk = true) {
    let cwd = dir;
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

    let info = null;

    if (data)
      info = JSON.parse(data)

    return this.fromOptions({dir: cwd, info});
  }

  static fromOptions(options) {
    return new Package().fromOptions(options);
  }

  static async fromDirectory(dir, walk = true) {
    return new Package().fromDirectory(dir, walk);
  }

  /**
   * Write to configured output (e.g. stdout).
   * @param {String} name
   * @param {String?} prefix
   */

  print(data) {
    this.stdio[1].write(data);
  }

  /**
   * Write to configured error output (e.g. stderr).
   * @param {String} name
   * @param {String?} prefix
   */

  error(data) {
    this.stdio[2].write(data);
  }

  /**
   * Resolves the git remote url for a dependency for
   * the package with branch and version information.
   * @param {String} name
   * @param {String?} prefix
   */

  resolveRemote(name, prefix) {
    if (!prefix)
      prefix = this.dir;

    let src = null;

    if (this.info.dependencies)
      src = this.info.dependencies[name];

    if (this.info.devDependencies) {
      if (this.info.devDependencies[name]) {
        if (src != null)
          throw new Error(`Duplicate dependency ${name}.`);
        else
          src = this.info.devDependencies[name];
      }
    }

    const git = [];
    const matched = src.match(/^(git\+(ssh\:\/\/|https\:\/\/)|git\:\/\/)(.*)$/);

    function findVersion(branch) {
      let version = null;

      if (branch)
        version = branch.replace('semver:', '');

      if (version !== branch)
        branch = null;
      else
        version = null;

      return {branch, version};
    }

    // Handle sources.
    if (matched) {
      const protocol = matched[1];
      let url = null;

      if (matched[2])
        url = matched[2] + matched[3];
      else
        url = matched[1] + matched[3];

      let [host, extra] = url.split('#');
      const {branch, version} = findVersion(extra);

      git.push(host);

      return {git, version, branch};
    }

    // Handle multiple remote sources.
    const [remote, id] = src.split(/\:(.*)/, 2);

    // Handle version only sources if the src
    // does not have remote and id.
    if (!id)
      return {git, version: src, branch: null};

    let [repo, extra] = id.split('#');
    const {branch, version} = findVersion(extra);

    if (!repo)
      repo = name;

    const hosts = this.info.remotes[remote];

    if (!hosts)
      throw new Error(`Unknown remote ${remote}.`);

    if (!Array.isArray(hosts))
      throw new Error('Remotes expected to be an array.')

    for (const host of hosts) {
      if (host.indexOf('file:') === 0) {
        let dir = host.replace('file:', '');

        if (!path.isAbsolute(dir))
          dir = path.resolve(prefix, dir)

        git.push(`${dir}/${repo}/.git`);
      } else {
        git.push(`${host}/${repo}.git`);
      }
    }


    return {git, version, branch};
  }

  /**
   * Will fetch, verify, install and build the dependencies
   * for the package.
   * @param {String?} prefix
   * @param {Object?} options
   * @param {Boolean?} options.production
   * @returns {Promise}
   */

  async install(prefix = null, options = {}) {
    this.print(`Installing: ${this.dir}\n`);

    if (prefix == null)
      prefix = this.dir;

    if (!this.info)
      throw new Error('Unknown package.');

    if (!this.info.dependencies)
      return;

    const installed = [];
    const dependencies = {};

    for (const [name, src] of Object.entries(this.info.dependencies))
      dependencies[name] = src;

    if (!options.production && this.info.devDependencies) {
      for (const [name, src] of Object.entries(this.info.devDependencies)) {
        if (dependencies[name] != null)
          throw new Error('Duplicate dependency ${name}.');
        else
          dependencies[name] = src;
      }
    }

    for (const [name, src] of Object.entries(dependencies)) {
      const {git, version} = this.resolveRemote(name, prefix);

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
        dst = path.join(this.dir, `./node_modules/${name}`);
      }

      if (git.length === 0)
        throw new Error(`Unknown remotes for '${name}'.`);

      for (const url of git) {
        const tags = await listTags(url);
        const tag = matchTag(Object.keys(tags), version);

        if (!tag)
          continue;

        const {annotated, commit} = tags[tag];

        this.print(`Cloning: ${url} ${tag}\n`);
        await cloneRepo(tag, url, dst);

        try {
          let result = null;
          if (annotated)
            result = await verifyRepo(tag, null, dst);
          else
            result = await verifyRepo(null, commit, dst);

          this.print(result.stderr);
        } catch (err) {
          throw new Error(`Could not verify ${dst}, reason: ${err.message}.`);
        }

        installed.push(dst);
        break;
      }
    }

    // Install each of the dependencies.
    for (const nextDst of installed) {
      const dep = await Package.fromDirectory(nextDst, false);
      await dep.install(prefix);
    }

    // Build the native addon if necessary.
    await this.rebuildModule(this.dir)
  }

  /**
   * Will determine if there is a native addon.
   * @param {String} dir
   * @returns {Promise}
   */

  async hasAddon(dir) {
    const gyp = path.join(dir, './binding.gyp');
    let has = false;

    try {
      await access(gyp, fs.constants.R_OK);
      has = true
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    return has;
  }

  /**
   * Will build the native addon for the package.
   * @param {String} dir
   * @returns {Promise}
   */

  async rebuildModule(dir) {
    if (!await this.hasAddon(dir))
      return;

    return new Promise((resolve, reject) => {
      const child = spawn(NODE_GYP, ['rebuild'], {cwd: dir, stdio: this.stdio});
      child.on('close', code => resolve(code));
      child.on('exit', code => resolve(code));
      child.on('error', err => reject(err));
    });
  }

  /**
   * Will build the native addon for the package
   * and all dependencies.
   * @param {String?} dir
   * @returns {Promise}
   */

  async rebuild(dir) {
    if (!dir)
      dir = this.dir;

    let dependencies = [];

    const moddir = path.join(dir, './node_modules');

    try {
      dependencies = await readdir(moddir);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    for (const dep of dependencies)
      await this.rebuild(path.join(moddir, dep));

    await this.rebuildModule(dir);
  }

  /**
   * Will run a script defined by the package.
   * @param {String} name
   * @returns {Promise}
   */

  async run(name) {
    if (!this.info.scripts || !this.info.scripts[name])
      throw new Error(`Unknown script '${name}'.`);

    const [cmd, ...args] = this.info.scripts[name].split(' ');

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {cwd: this.dir, stdio: this.stdio});
      child.on('close', code => resolve(code));
      child.on('exit', code => resolve(code));
      child.on('error', err => reject(err));
    });
  }
}

module.exports = Package;
