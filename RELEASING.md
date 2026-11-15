# Releasing

The package is published to npm from GitHub Actions with npm trusted publishing (OIDC): no npm token lives in this repository.

1. Bump `version` in `package.json` on a branch, merge it after the **Test** workflow passes (it includes `npm run test:pack`, which installs the packed tarball into an empty project).
2. Run **Release to npm** (`release-npm.yml`) from `main` with the same version. It refuses a version that is already on npm, runs the full suite and the pack test, then publishes.

First release only: npm can attach a trusted publisher only to a package that exists. The owner publishes the first version once by hand (`npm test && npm run test:pack && npm publish --access public`, with 2FA), then adds the trusted publisher on npmjs.com → package → Settings: repository `mhatipog/belgian-utils`, workflow `release-npm.yml`, environment `npm`. After that, set publishing access to require 2FA and disallow tokens.

What ships: `src/`, `README.md`, `LICENSE` (including the JSVAT-Next licence under `src/vendor/`). Tests, samples and CI files stay out; `npm run test:pack` fails if that changes.
