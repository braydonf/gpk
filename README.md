# Git Package Manager

Decentralized and secure package management for JavaScript and Node.js
libraries and applications.

## Features

- Packages are decentralized via Git and can be hosted and published
  via any Git repository.
- Signature verification via signed Git tags.
- Package integrity using strong hash algorithms (e.g. `sha512`).
- Redundancy of packages, multiple remotes can be listed for the
  availability of packages.
- Resolves shared dependencies based on semantic versioning via Git
  tags (e.g. `v1.1.0`).

## Usage

### Dependencies

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

### Multiple remotes for dependencies

Here is how multiple remotes can be listed for dependencies in `package.json`:

```json
{
  "remotes": {
    "bcoin": ["https://github.com/bcoin-org"],
    "chjj": ["https://github.com/chjj"],
  },
  "dependencies": {
    "bcoin": "bcoin:#semver:~2.0.0",
    "bcrypto": "bcoin:#semver:~4.2.6",
    "bmultisig": "bcoin:#semver:~2.0.0",
    "buffer-map": "chjj:#semver:~0.0.7",
    "n64": "chjj:#semver:~0.2.10"
  }
}
```

The `remotes` list available namespaces and repository mirrors. For
example the `bcoin` dependency would resolve into the repository url
`https://github.com/bcoin-org/bcoin.git`. If the repository name
is not included it will use the dependency name.
