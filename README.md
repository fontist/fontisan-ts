# fontisan-ts

`fontisan-ts` is the TypeScript/JavaScript scaffold for the Fontisan Rust
engine, intended to support Node.js and browser consumers. This repository is
still a private placeholder package named `fontisan-ts-placeholder`. Its ESM
Node and browser entrypoints and TypeScript declarations are empty scaffolding;
there is no WASM-backed API yet.

Part of [fontist/fontisan#165](https://github.com/fontist/fontisan/issues/165).

## Requirements

Node.js 22.23.1 or later. This is the supported LTS floor.

## Install and verify

From the repository root:

```sh
npm install --package-lock=false
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm pack --dry-run
```

The Playwright install command downloads Chromium for the browser tests.
`npm pack --dry-run` previews the package contents without publishing it.
The package includes `dist/`, `vendor/`, this README, and `LICENSE` when supplied;
npm also always includes `package.json`.

## Package status

The eventual npm package name is for the package owner to choose. This
placeholder is private and must not be published. No license has been selected
or included yet.
