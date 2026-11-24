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

## Node API

```ts
import { load } from 'fontisan-ts-placeholder';
const fontisan = await load();                       // verifies vendor/fontisan.wasm against the compiled-in sha256
fontisan.read(bytes, { metadata: true });            // one document per face
fontisan.audit(bytes, 'Font.ttf', { validate: true });
fontisan.glyphIds(bytes, 'Font.ttf', [0x41]);
fontisan.convert(bytes, 'woff2', 1_700_000_000n);    // woff2 needs an explicit timestamp: wasm has no clock
```

`scan()` and `auditDir()` need a file system and throw `UnsupportedError`. A
tampered or stale artifact throws `IntegrityError`. A panic cannot unwind on
wasm32, so it traps: `EngineTrapError` is thrown and the next call starts a
fresh instance.

## Engine artifact

`vendor/fontisan.wasm` is build output of `fontisan-ffi` at the rev in
`ENGINE_REV` (fontisan-rs is consumed read-only). `npm run refresh-wasm`
rebuilds it and rewrites `vendor/BUILT_FROM.json` and `src/integrity.ts`.
`CORPUS_REV` pins the goldens for the parity test (`npm run corpus-fetch`).

## Package status

The eventual npm package name is for the package owner to choose. This
placeholder is private and must not be published. No license has been selected
or included yet.
