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
const writeFile = util.promisify(fs.writeFile);
const copyFile = util.promisify(fs.copyFile);
const access = util.promisify(fs.access);
const readdir = util.promisify(fs.readdir);
const rename = util.promisify(fs.rename);
const mkdir = util.promisify(fs.mkdir);
const {spawn} = child_process;
const nodeGyp = path.resolve(__dirname, '../vendor/node-gyp/bin/node-gyp.js');
const glob = util.promisify(require('../vendor/glob'));

const Environment = require('./environment');
const constants = require('./constants');
const {ensureDir, ensureSymlink, exists} = require('./common');

const {
  cloneRepo,
  verifyRepo,
  listTags,
  listBranches,
  sortTags,
  matchTag,
  getHeadCommit
} = require('./git');

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
   * @param {String} options.base
   * @param {String} options.name
   * @param {String} options.src
   * @param {Boolean} options.global
   */

  resolveRemote(options) {
    const {name, src} = options;

    let remotes = null;
    let base = null;

    if (!options.global) {
      remotes = this.info.remotes;
      base = options.base;
    }

    let git = null;
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

      git = host;

      return {git, version, branch};
    }

    // Handle remote sources.
    const [remote, id] = src.split(/\:(.*)/, 2);

    // Handle version only sources if the src
    // does not have remote and id.
    if (!id)
      return {git, version: src, branch: null};

    let [repo, extra] = id.split('#');
    const {branch, version} = findVersion(extra);

    if (!repo)
      repo = name;

    if (!remotes)
      throw new Error('Unknown remotes.');

    const host = remotes[remote];

    if (!host)
      throw new Error(`Unknown remote ${remote}.`);

    if (host.indexOf('file:') === 0) {
      let dir = host.replace('file:', '');

      if (!path.isAbsolute(dir)) {
        if (!base)
          throw new Error('Unknown base.');

        dir = path.resolve(base, dir)
      }

      git = `${dir}/${repo}/.git`;
    } else {
      git = `${host}/${repo}.git`;
    }

    return {git, version, branch};
  }

  /**
   * Will check for an existing installation.
   * @param {String} dst
   * @returns {Promise}
   */

  async existingVersion(dst) {
    let existingPkg = null;

    try {
      existingPkg = JSON.parse(
        await readFile(path.join(dst, './package.json'), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    const info = {};

    if (existingPkg) {
      info.pkg = true;
      info.version = existingPkg.version;
      info.commit = existingPkg._commit;
    }

    return info;
  }

  /**
   * Will determine the installation path.
   * @param {String} options.base
   * @param {String} options.name
   * @param {String} options.version
   * @param {String} options.commit
   * @param {String} options.global
   * @returns {Promise}
   */

  async determinePath(options) {
    const {base, name, version, commit} = options;

    let moduleBase = null;
    let modulePath = null;

    if (options.global) {
      moduleBase = path.join(this.env.global, './lib/node_modules/');
      modulePath = path.join(moduleBase, name);
    } else {
      if (!base)
        throw new Error('Unknown base.');

      moduleBase = path.join(base, './node_modules');
      modulePath = path.join(moduleBase, name);
    }

    const existing = await this.existingVersion(modulePath);

    if (existing.pkg) {
      if (commit) {
        if (existing.commit === commit)
          return {dstDir: null, dst: null};
        else if (options.global)
          throw new Error(`Existing '${name}' at '${modulePath}'.`);

        moduleBase = path.join(this.dir, './node_modules');
        modulePath = path.join(moduleBase, name);
      } else {
        if (semver.satisfies(existing.version, version))
          return {dstDir: null, dst: null};
        else if (options.global)
          throw new Error(`Existing '${name}' at '${modulePath}'.`);

        moduleBase = path.join(this.dir, './node_modules');
        modulePath = path.join(moduleBase, name);
      }
    }

    return {dstDir: moduleBase, dst: modulePath};
  }

  /**
   * Will discover the name and version for a git repository.
   * @param {String} git
   * @param {String} version
   * @param {String} branch
   * @returns {Promise}
   */

  async discoverRepo(git, version, branch) {
    const info = {name: null, version: null};
    let commit = null;
    let tag = null;

    if (branch) {
      const branches = await listBranches(git);
      if (!branches[branch])
        throw new Error(`Unknown branch '${branch}'.`);

      commit = branches[branch];
    } else {
      const tags = await listTags(git);
      const keys = sortTags(Object.keys(tags), true);

      if (version) {
        const match = matchTag(keys, version);
        if (!match)
          throw new Error(`Unknown tag for '${name}'.`);

        tag = tags[match];
      } else {
        let latest = null;

        for (const tag of keys) {
          const parsed = semver.parse(tag);

          if (parsed.prerelease.length > 0)
            continue;

          latest = tag;
        }

        if (latest)
          tag = tags[latest];
      }
    }

    const verified = this.getVerifiedPath(tag, commit);

    const hasVerified = await exists(verified);

    if (!hasVerified)
      await this.fetchVerified({git, tag, branch, dst: verified});

    const pkg = await Package.fromDirectory(verified, false, this.env);

    if (!pkg.info)
      return info;

    info.name = pkg.info.name;
    info.version = pkg.info.version;

    return info;
  }

  /**
   * Will fetch a repository to cache and verify
   * the signature.
   * @param {Object} options
   * @param {String} options.git
   * @param {Object} options.tag
   * @param {String} options.tag.name
   * @param {String} options.tag.annotated
   * @param {String} options.tag.commit
   * @param {String} options.branch
   * @param {String} options.dst
   * @returns {Promise}
   */

  async fetchVerified(options) {
    const {git, tag, branch, dst} = options;
    const unverified = `${dst}-unverified`;

    if (branch) {
      await cloneRepo(branch, git, unverified);

      await verifyRepo(null, branch, unverified, this.env.stdio);
    } else {
      await cloneRepo(tag.name, git, unverified);

      if (tag.annotated)
        await verifyRepo(tag.name, null, unverified, this.env.stdio);
      else
        await verifyRepo(null, tag.commit, unverified, this.env.stdio);
    }

    await rename(unverified, dst);
  }

  /**
   * Will get the cache path for a verified repository.
   * @param {Object} tag
   * @param {String} tag.annotated
   * @param {String} tag.commit
   * @param {String} commit
   * @returns {String}
   */

  getVerifiedPath(tag, commit) {
    let verified = null;

    if (commit) {
      verified = path.join(this.env.cache, `${commit}`);
    } else if (tag.annotated) {
      verified = path.join(this.env.cache, `${tag.annotated}`);
    } else {
      if (!tag.commit)
        throw new Error('Unknown commit.');

      verified = path.join(this.env.cache, `${tag.commit}`);
    }

    return verified;
  }

  /**
   * Will install a module.
   * @param {String} options.base
   * @param {String} options.name
   * @param {String} options.src
   * @param {String} options.global
   * @returns {Promise}
   */

  async installModule(options) {
    const {base, name, src} = options;

    const {git, version, branch} = this.resolveRemote({
      base: base,
      name: name,
      src: src,
      global: options.global
    });

    let branches = Object.create(null);
    let commit = null;
    let tags = Object.create(null);
    let tag = null;

    if (branch) {
      if (!git)
        throw new Error(`Unknown remote for '${name}'.`);

      branches = await listBranches(git);

      if (!branches[branch])
        throw new Error(`Unknown branch '${branch}'.`);

      commit = branches[branch];
    }

    const {dst, dstDir} = await this.determinePath({
      base: base,
      name: name,
      version: version,
      commit: commit,
      global: options.global
    });

    if (!dst)
      return;

    if (!branch) {
      tags = await listTags(git);
      const match = matchTag(Object.keys(tags), version);

      if (!match)
        throw new Error(`Unknown tag for '${name}'.`);

      tag = tags[match];
    }

    const verified = this.getVerifiedPath(tag, commit);
    const hasVerified = await exists(verified);

    if (!hasVerified) {
      this.env.log(`Cloning '${name}' from '${git}' at '${tag.name}'.`);

      await this.fetchVerified({
        git: git,
        tag: tag,
        branch: branch,
        dst: verified
      });
    }

    const head = await getHeadCommit(verified);

    const pkg = await Package.fromDirectory(verified, false, this.env);

    this.env.log(`Copying '${name}' at '${head}' to '${dst}'.`);

    await ensureDir(dstDir);

    await pkg.copyPackage(verified, dst);
    await pkg.injectMeta(dst, src, git, head);

    return dst;
  }

  /**
   * Will get all the dependencies that should be installed.
   * @param {Object?} options
   * @param {Boolean?} options.production
   * @returns {Object}
   */

  getDependencies(options = {}) {
    const dependencies = {};

    if (!this.info.dependencies && !this.info.devDependencies)
      return dependencies;

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

    return dependencies;
  }

  /**
   * Will add and install packages and dependencies.
   * @param {Array?} sources
   * @param {Object?} options
   * @returns {Promise}
   */

  async install(sources = [], options = {}) {
    const deps = await this.determineSources(sources, {
      global: options.global
    });

    if (options.global && sources.length > 0) {
      // Install sources to global.
      for (const [name, src] of Object.entries(deps)) {
        const dst = await this.installModule({
          name,
          src,
          global: true
        });

        if (!dst)
          return;

        const pkg = await Package.fromDirectory(dst, false, this.env);

        // Install all dependencies.
        await pkg.installDependencies(dst, {production: true});

        // Build any native addons.
        await pkg.rebuild();

        // Link any executables.
        await pkg.linkBin(null, {global: true});
      }
    } else {
      // Add the sources to the dependencies.
      await this.addDependencies(deps);

      // Install all dependencies.
      await this.installDependencies(this.dir, {
        production: options.production
      });

      // Build any native addons.
      await this.rebuild();

      // Link library to global path.
      if (options.global)
        await this.linkGlobal();

      // Link any executables.
      await this.linkBin(null, {
        global: options.global
      });
    }

    return 0;
  }

  /**
   * Will determine the dependency object from the sources.
   * @param {Array} sources
   * @returns {Promise}
   */

  async determineSources(sources, options) {
    const deps = {};

    if (!sources.length)
      return deps;

    for (const src of sources) {
      const {git, version, branch} = this.resolveRemote({
        base: this.dir,
        src: `git+${src}`,
        global: options.global
      });

      const info = await this.discoverRepo(git, version, branch);

      if (branch)
        deps[info.name] = `git+${git}#${branch}`;
      else
        deps[info.name] = `git+${git}#semver:^${info.version}`;
    }

    return deps;
  }

  /**
   * Will add new dependencies to the package.
   * @param {Object}
   * @returns {Promise}
   */

  async addDependencies(deps) {
    const entries = Object.entries(deps);
    if (!entries.length)
      return;

    let data = null;
    const filename = path.join(this.dir, './package.json');

    try {
      data = await readFile(filename, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (!data)
      throw new Error(`Unknown package at ${dst}.`);

    const info = JSON.parse(data);

    if (!info.dependencies)
      info.dependencies = {};

    let dependencies = Object.entries(info.dependencies);
    dependencies = dependencies.concat(entries);

    dependencies.sort((a, b) => {
      if (a[0] == b[0])
        return 0;
      else
        return a[0] < b[0] ? -1 : 1;
    });

    for (const [name, src] of dependencies)
      info.dependencies[name] = src;

    await writeFile(filename, JSON.stringify(info, null, 2) + '\n');

    this.info = info;
  }

  /**
   * Will fetch, verify, install and build the dependencies
   * for the package.
   * @param {String} base
   * @param {Object?} options
   * @param {Boolean?} options.production
   * @returns {Promise}
   */

  async installDependencies(base, options = {}) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    this.env.log(`Installing '${this.info.name}' at '${this.dir}'.`);

    const installed = [];
    const dependencies = this.getDependencies(options);

    for (const [name, src] of Object.entries(dependencies)) {
      const dst = await this.installModule({base, name, src});
      if (dst)
        installed.push(dst);
    }

    // Install each of the dependencies.
    for (const next of installed) {
      const dep = await Package.fromDirectory(next, false, this.env);

      await dep.installDependencies(base, {production: true});
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
   * Inject metadata into the package.json file
   * for a dependency. This is necessary for compatibility
   * purposes (_from and _resolved) and for use in keeping
   * track of the source (_commit).
   * @param {String} dst
   * @param {String} src
   * @param {String} url
   * @param {String} commit
   * @returns {Promise}
   */

  async injectMeta(dst, src, url, commit) {
    let data = null;
    const filename = path.join(dst, './package.json');

    try {
      data = await readFile(filename, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (!data)
      throw new Error(`Unknown package at ${dst}.`);

    const info = JSON.parse(data)

    info._from = src;
    info._resolved = `git+${url}#${commit}`;
    info._commit = commit;

    return writeFile(filename, JSON.stringify(info, null, 2) + '\n');
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
   * Will link library to the global library path.
   * @returns {Promise}
   */

  async linkGlobal() {
    const libdir = path.join(this.env.global, './lib/node_modules');
    await ensureDir(libdir);

    const libpath = path.join(libdir, this.info.name);
    await ensureSymlink(this.dir, libpath);
  }

  /**
   * Will return the library directory path.
   * @param {Object} options
   * @param {Boolean} options.global
   * @returns {Promise}
   */

  getDir(options) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    if (options.global)
      return path.join(this.env.global, './lib/node_modules', this.info.name);

    return this.dir;
  }

  /**
   * Will link executables to the location.
   * @param {String?} location
   * @param {Object?} options
   * @param {Boolean?} options.global
   * @returns {Promise}
   */

  async linkBin(location, options = {}) {
    this.env.log(`Linking '${this.dir}'.`);

    if (options.global)
      location = path.join(this.env.global, './bin');

    if (location && this.info.bin) {
      for (const [name, rel] of Object.entries(this.info.bin)) {
        const libdir = this.getDir({global: options.global});
        const target = path.relative(location, path.join(libdir, rel));
        const bin = path.join(location, name);

        await ensureDir(location);
        await ensureSymlink(target, bin);
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
   * @param {Array} extra
   * @returns {Promise}
   */

  async run(name, extra = []) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    if (!this.info.scripts || !this.info.scripts[name])
      throw new Error(`Unknown script '${name}'.`);

    this.env.log(`Running '${name}' at '${this.dir}' for ` +
                 `'${this.info.name}@${this.info.version}'.`);
    this.env.log(`Command '${this.info.scripts[name]}'.`)

    const [cmd, ...args] = this.info.scripts[name].split(' ');

    const local = path.join(this.dir, './node_modules/.bin');
    const PATH = `${local}:${process.env.PATH}`;

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args.concat(extra), {
        cwd: this.dir,
        stdio: this.env.stdio,
        env: {PATH}
      });

      child.once('exit', code => resolve(code));
      child.once('error', err => reject(err));
    });
  }
}

module.exports = Package;
