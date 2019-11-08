# Git Package Manager

Decentralized and secure package managment for JavaScript and Node.js
libraries and applications.

## Features

- Packages are decentralized via Git and can be hosted and published
  via any Git repository.
- Signature verification via signed Git tags.
- Package integrity using strong hash algorithms (e.g. `sha512`).
- Redundancy of packages, multiple remotes can be listed for the
  availability of packages.
- Resolves sharded dependencies based on semantic versioning via Git
  tags (e.g. `v1.1.0`).

## Usage

Here is as example of how dependencies are specified in `package.json`:

```json
{
  "remotes": {
    "bcoin": ["https://github.com/bcoin-org"],
    "chjj": ["https://github.com/chjj"],
  },
  "dependencies": {
    "bcoin": "bcoin:@~2.0.0",
    "bcrypto": "bcoin:@~4.2.6",
    "bmultisig": "bcoin:@~2.0.0",
    "buffer-map": "chjj:@~0.0.7",
    "n64": "chjj:@~0.2.10"
  }
}
```

The `remotes` list available namespaces and repository mirrors. For
example the `bcoin` dependency would resolve into the repository url
`https://github.com/bcoin-org/bcoin.git`. A lockfile specifies the exact
tag to checkout that is verified by a `sha512` integrity hash. The
dependency can then be upgraded to the latest tagged version that
satisfies `~2.0.0`, for example `v2.0.20` and the signature of that
tag is verified.
