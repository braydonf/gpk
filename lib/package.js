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
const copyFile = util.promisify(fs.copyFile);
const access = util.promisify(fs.access);
const readdir = util.promisify(fs.readdir);
const rename = util.promisify(fs.rename);
const mkdir = util.promisify(fs.mkdir);
const symlink = util.promisify(fs.symlink);
const {spawn} = child_process;
const nodeGyp = path.resolve(__dirname, '../vendor/node-gyp/bin/node-gyp.js');
const glob = util.promisify(require('../vendor/glob'));

const Environment = require('./environment');
const constants = require('./constants');
const {cloneRepo, verifyRepo, listTags, matchTag} = require('./git');

/**
 * Package
 * Exposes information and methods for installing
 * and building a package and dependencies.
 * @property {String} dir
 * @property {Object} info
 * @property {Environment} env
 */

class Package {

  /**
   * Initialize the package.
   * @param {String} dir
   * @param {Object} info
   * @param {Environment?} env
   * @returns {Promise}
   */

  constructor(dir, info, env) {
    this.dir = null;
    this.info = null;
    this.env = new Environment();
    this.initProperties(dir, info, env);
  }

  /**
   * Initialize the package from object with
   * the directory of the package and the package
   * definition (package.json).
   * @param {String} dir
   * @param {Object} info
   * @param {Object} env
   * @returns {Promise}
   */

  initProperties(dir, info, env) {
    if (dir != null)
      this.dir = dir;

    if (info != null)
      this.info = info;

    if (env != null)
      this.env = env;

    return this;
  }

  /**
   * Initialize the package from a directory. Optionally
   * it will recursively walk up directories to find the
   * package definition.
   * @param {String} dir
   * @param {Boolean?} walk
   * @param {Environment?} env
   * @returns {Promise}
   */

  async fromDirectory(dir, walk = true, env) {
    let cwd = dir;
    let moddir = null;
    let data = null;

    while (data == null) {
      try {
        data = await readFile(path.join(cwd, './package.json'), 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;

        if (data)
          break;

        const parent = path.resolve(cwd, '../');
        if (parent === cwd || !walk)
          break;
        else
          cwd = parent
      }
    }

    let info = null;

    if (data) {
      info = JSON.parse(data)
      moddir = cwd;
    } else {
      moddir = dir;
    }

    return this.initProperties(moddir, info, env);
  }

  static async fromDirectory(dir, walk = true, env) {
    return new Package().fromDirectory(dir, walk, env);
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
    if (prefix == null)
      prefix = this.dir;

    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    this.env.log(`Installing '${this.info.name}' at '${this.dir}'.`);

    if (!this.info.dependencies && !this.info.devDependencies)
      return;

    const installed = [];
    const dependencies = {};

    if (this.info.dependencies) {
      for (const [name, src] of Object.entries(this.info.dependencies))
        dependencies[name] = src;
    }

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
      let moduleBase = path.join(prefix, './node_modules');
      let modulePath = path.join(moduleBase, name);
      let existingPkg = null;

      try {
        existingPkg = JSON.parse(
          await readFile(path.join(modulePath, './package.json'), 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
      }

      if (existingPkg) {
        if (semver.satisfies(existingPkg.version, version))
          continue;

        // There is an incompatible existing version, so it's
        // necessary to install relative to the module.
        moduleBase = path.join(this.dir, './node_modules');
        modulePath = path.join(moduleBase, name);
      }

      if (git.length === 0)
        throw new Error(`Unknown remotes for '${name}'.`);

      for (const url of git) {
        const tags = await listTags(url);
        const tag = matchTag(Object.keys(tags), version);

        if (!tag)
          continue;

        const {annotated, commit} = tags[tag];

        let verified = null;

        if (annotated)
          verified = path.join(this.env.cache, `${name}-${annotated}`);
        else
          verified = path.join(this.env.cache, `${name}-${commit}`);

        let hasVerified = false;

        try {
          await access(verified, fs.constants.R_OK);
          hasVerified = true;
        } catch (err) {
          if (err.code !== 'ENOENT')
            throw err;
        }

        if (!hasVerified) {
          this.env.log(`Cloning '${name}' from '${url}' at '${tag}'.`);

          const unverified = `${verified}-unverified`;

          await cloneRepo(tag, url, unverified);

          if (annotated)
            await verifyRepo(tag, null, unverified, this.env.stdio);
          else
            await verifyRepo(null, commit, unverified, this.env.stdio);

          await rename(unverified, verified);
        }

        this.env.log(`Copying '${name}' at '${tag}' to '${modulePath}'.`);

        await ensureDir(moduleBase);

        await this.copyPackage(verified, modulePath);

        installed.push(modulePath);
        break;
      }
    }

    // Install each of the dependencies.
    for (const nextDst of installed) {
      const dep = await Package.fromDirectory(nextDst, false, this.env);
      await dep.install(prefix, {production: true});
    }
  }

  /**
   * Read the ignore file for a package directory from
   * several possible sources and create an array of patterns
   * of files to ignore. The ignore file syntax follows
   * the same pattern rules as a Git ignore file. There can be
   * an ignore file unique per directory.
   * @see https://git-scm.com/docs/gitignore
   * @see https://docs.npmjs.com/misc/developers#keeping-files-out-of-your-package
   * @param {String} dir
   * @returns {Promise}
   */

  async getIgnorePatterns(dir) {
    let data = '';
    let exists = false;

    for (const name of constants.IGNORE_FILES) {
      try {
        data = await readFile(path.join(dir, name), 'utf8');
        exists = true;
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
      }

      if (exists)
        break;
    }

    const patterns = [];

    for (const pattern of constants.ALWAYS_IGNORE)
      patterns.push({pattern, always: true, inverse: false});

    for (const pattern of constants.IGNORE_FILES)
      patterns.push({pattern, always: true, inverse: false});

    for (let line of data.split('\n')) {
      // Exclude comments.
      if (line.indexOf('#') === 0)
        continue;

      // Exclude any blank line.
      if (!line.trim())
        continue;

      // Exclude anything that should never be ignored.
      if (constants.NEVER_IGNORE.includes(line))
        continue;

      // Determine if the pattern is inverse.
      const inverse = (line.indexOf('!') === 0);
      if (inverse)
        line = line.replace('!', '');

      patterns.push({pattern: line, always: false, inverse});
    }

    return patterns;
  }

  /**
   * Read the files to include for the package from the package
   * and create an array of patterns of files to keep. The syntax
   * follows the same pattern rules as a Git ignore file, however
   * it will keep the files instead of ignoring them.
   * @see https://docs.npmjs.com/files/package.json#files
   */

  async getOnlyPatterns() {
    if (!Array.isArray(this.info.files))
      throw new Error(`Package 'files' is not an array.`);

    const patterns = [];

    for (const pattern of constants.NEVER_IGNORE)
      patterns.push({pattern: pattern});

    for (let pattern of this.info.files) {
      if (constants.ALWAYS_IGNORE.includes(pattern))
        continue;

      const inverse = (pattern.indexOf('!') === 0);

      if (inverse)
        pattern = pattern.replace('!', '');

      patterns.push({pattern, inverse});
    }

    return patterns;
  }

  /**
   * Copies files from a git repository to a destination
   * directory filtering any ignored files.
   *
   * If the package.json includes a files property, only
   * those files will be copied.
   *
   * If there is an ignore file defined in the package, it
   * will copy all files except those that match the
   * ignored patterns.
   *
   * If there is both a files property and an ignore file,
   * the files property patterns will not be overridden.
   * However if a subdirectory includes an ignore file, it
   * will override the files pattern.
   *
   * @param {String} src
   * @param {String} dst
   * @returns {Promise}
   */

  async copyPackage(src, dst) {
    const only = new Set();
    const ignore = new Set();

    let onlyPatterns = [{pattern: '*'}];
    const hasOnlyPatterns = (this.info.files != null);

    if (hasOnlyPatterns)
      onlyPatterns = await this.getOnlyPatterns();

    for (const {pattern, inverse} of onlyPatterns) {
      const files = await glob(pattern, {
        matchBase: true,
        root: src,
        cwd: src,
        absolute: true,
        dot: true
      });

      for (const file of files) {
        if (inverse)
          ignore.add(file);
        else
          only.add(file);
      }
    }

    const ignorePatterns = await this.getIgnorePatterns(src);

    for (const {pattern, always, inverse} of ignorePatterns) {
      const files = await glob(pattern, {
        matchBase: true,
        root: src,
        cwd: src,
        absolute: true,
        dot: true
      });

      // Do not override file patterns defined unless
      // it should always be ignored.
      if (!always && hasOnlyPatterns && only.has(file))
        continue;

      for (const file of files) {
        if (inverse)
          only.add(file)
        else
          ignore.add(file);
      }
    }

    const copyDirectory = async (from, to) => {
      const ignorePatterns = await this.getIgnorePatterns(from);

      for (const {pattern, inverse} of ignorePatterns) {
        const files = await glob(pattern, {
          matchBase: true,
          root: from,
          cwd: from,
          absolute: true,
          dot: true
        });

        for (const file of files) {
          if (inverse)
            only.add(file)
          else
            ignore.add(file);
        }
      }

      let dirents = await readdir(from, {withFileTypes: true});

      await mkdir(to);

      for (const dirent of dirents) {
        const fromPath = path.join(from, dirent.name);

        if (!only.has(fromPath))
          continue;

        if (ignore.has(fromPath))
          continue;

        const toPath = path.join(to, dirent.name);

        if (dirent.isDirectory()) {
          await copyDirectory(fromPath, toPath);
        } else {
          await copyFile(fromPath, toPath);
        }
      }
    }

    await copyDirectory(src, dst);
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
      const child = spawn(nodeGyp, ['rebuild'], {
        cwd: dir,
        stdio: this.env.stdio
      });

      child.once('exit', code => resolve(code));
      child.once('error', err => reject(err));
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

    this.env.log(`Building '${dir}'.`);

    let dependencies = [];

    const moddir = path.join(dir, './node_modules');

    try {
      dependencies = await readdir(moddir);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    for (const dep of dependencies) {
      if (dep.indexOf('.') === 0)
        continue;

      await this.rebuild(path.join(moddir, dep));
    }

    await this.rebuildModule(dir);
  }

  /**
   * Will link executables to the location.
   * @param {String?} location
   * @returns {Promise}
   */

  async linkBin(location) {
    this.env.log(`Linking '${this.dir}'.`);

    if (location && this.info.bin) {
      for (const [name, rel] of Object.entries(this.info.bin)) {
        const target = path.join(this.dir, rel);
        const bin = path.join(location, name);
        await ensureDir(location);
        await symlink(target, bin);
      }
    }

    let dependencies = [];

    const moddir = path.join(this.dir, './node_modules');

    try {
      dependencies = await readdir(moddir);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (dependencies.length > 0) {
      const bindir = path.join(moddir, '.bin');

      for (const name of dependencies) {
        if (name.indexOf('.') === 0)
          continue;

        const depdir = path.join(moddir, name);
        const pkg = await Package.fromDirectory(depdir, false, this.env);

        await pkg.linkBin(bindir);
      }
    }
  }

  /**
   * Will run a script defined by the package.
   * @param {String} name
   * @returns {Promise}
   */

  async run(name) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    if (!this.info.scripts || !this.info.scripts[name])
      throw new Error(`Unknown script '${name}'.`);

    this.env.log(`Running '${name}' at '${this.dir}' for ` +
                 `'${this.info.name}@${this.info.version}'.`);
    this.env.log(`Command '${this.info.scripts[name]}'.`)

    const [cmd, ...args] = this.info.scripts[name].split(' ');

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: this.dir,
        stdio: this.env.stdio
      });

      child.once('exit', code => resolve(code));
      child.once('error', err => reject(err));
    });
  }
}

async function ensureDir(dir) {
  try {
    await access(dir, fs.constants.R_OK & fs.constants.W_OK);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;

    await mkdir(dir);
  }
}

module.exports = Package;
