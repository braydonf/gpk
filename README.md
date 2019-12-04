# gpk

Git based, decentralized and secure package management for JavaScript and
Node.js libraries and applications.

## Features

- Packages are decentralized via Git and can be hosted and published
  via any Git repository.
- Signature verification via signed Git tags.
- Package integrity using strong hash algorithms (e.g. `sha512`).
- Resolves shared dependencies based on semantic versioning via Git
  tags (e.g. `v1.1.0`).
- Node.js C/C++ addon build support.

## Usage

Here is how to specify dependencies in `package.json`:

```json
{
  "dependencies": {
    "bcoin": "git+https://github.com/bcoin-org/bcoin.git#semver:~2.0.0",
    "bcrypto": "git+https://github.com/bcoin-org/bcrypto.git#semver:~4.2.6",
    "bmultisig": "git+https://github.com/bcoin-org/bmultisig.git#semver:~2.0.0",
    "buffer-map": "git+https://github.com/chjj/buffer-map.git#semver:~0.0.7",
    "n64": "git+https://github.com/chjj/n64.git#semver:~0.2.10"
  }
}
```
The signature of the matching Git tag or commit is verified for each
dependency. The dependencies must be from a Git repository. The referenced
Git tag or commit must be signed and the necessary public keys imported.

Note: The format of `package.json` dependencies is compatible with other
package managers such as `npm` and `yarn`, however they lack support
for signature verification.
