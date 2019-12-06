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

/**
 * Files that are ignored by default in packages.
 * @const {Array}
 * @default
 */

exports.ALWAYS_IGNORE = ['.*.swp', '._*', '.DS_Store', '.git', '.hg',
                         '.npmrc', '.lock-wscript', '.svn', '.wafpickle-*',
                         'config.gypi', 'CVS', 'npm-debug.log'];

/**
 * Files that are never ignored in packages.
 * @const {Array}
 * @default
 */

exports.NEVER_IGNORE = ['package.json', 'README', 'README.md',
                        'readme', 'readme.md', 'CHANGELOG',
                        'CHANGELOG.md', 'changelog', 'changelog.md',
                        'LICENSE'];

/**
 * Files that store ignore definitions. The syntax is
 * the same as Git ignore files. The order gives
 * preference to which file is used before the other.
 * @const {Array}
 * @default
 */

exports.IGNORE_FILES = ['.gpkignore', '.yarnignore',
                        '.npmignore', '.gitignore'];
