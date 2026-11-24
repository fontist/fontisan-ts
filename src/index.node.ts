import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Engine } from './engine.js';
import { Fontisan } from './api.js';
import { WASM_SHA256 } from './integrity.js';

export { Fontisan } from './api.js';
export type { AuditOptions, ConvertTarget, ReadOptions } from './api.js';
export { EngineTrapError, FontisanError, UnsupportedError } from './engine.js';
export type { ErrorCause } from './engine.js';
export { ENGINE_REV, WASM_SHA256 } from './integrity.js';

/** The vendored wasm artifact does not match the checksum compiled into this package. */
export class IntegrityError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(`fontisan.wasm sha256 ${actual} != expected ${WASM_SHA256}; refusing to load a tampered or stale artifact`);
    this.name = 'IntegrityError';
  }
}

export interface LoadOptions {
  /** Override the artifact location (still checksum-verified). Defaults to the vendored file. */
  wasmPath?: string | URL;
}

/** Load the vendored wasm, verify its sha256, and return the engine. Writes nothing to disk. */
export async function load(options: LoadOptions = {}): Promise<Fontisan> {
  const path = options.wasmPath ?? new URL('../vendor/fontisan.wasm', import.meta.url);
  const bytes = await readFile(path);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== WASM_SHA256) throw new IntegrityError(WASM_SHA256, actual);
  return new Fontisan(new Engine(await WebAssembly.compile(bytes)));
}
