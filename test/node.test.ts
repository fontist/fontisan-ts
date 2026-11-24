import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { Engine, EngineTrapError, FontisanError as SrcFontisanError, Op, unpackRows } from '../src/engine.js';
import { ENGINE_REV, FontisanError, IntegrityError, UnsupportedError, WASM_SHA256, load } from 'fontisan-ts-placeholder';

const root = new URL('..', import.meta.url);
const vendor = (f: string) => new URL(`vendor/${f}`, root);

test('loads the vendored engine at ABI 2', async () => {
  const fontisan = await load();
  expect(fontisan.abiVersion).toBe(2);
});

test('provenance, pin and compiled checksum agree', () => {
  const built = JSON.parse(readFileSync(vendor('BUILT_FROM.json'), 'utf8'));
  expect(built.engine_rev).toBe(readFileSync(new URL('ENGINE_REV', root), 'utf8').trim());
  expect(built.engine_rev).toBe(ENGINE_REV);
  expect(built.files['fontisan.wasm']).toBe(WASM_SHA256);
});

test('a tampered artifact fails loudly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fontisan-ts-'));
  const bad = join(dir, 'fontisan.wasm');
  const bytes = readFileSync(vendor('fontisan.wasm'));
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(bad, bytes);
  await expect(load({ wasmPath: bad })).rejects.toBeInstanceOf(IntegrityError);
  const stale = join(dir, 'stale.wasm');
  copyFileSync(vendor('fontisan.wasm'), stale);
  writeFileSync(stale, Buffer.concat([readFileSync(stale), Buffer.from([0])]));
  await expect(load({ wasmPath: stale })).rejects.toBeInstanceOf(IntegrityError);
});

test('file-system ops are an explicit unsupported result', async () => {
  const fontisan = await load();
  expect(() => fontisan.scan()).toThrow(UnsupportedError);
  expect(() => fontisan.auditDir()).toThrow(UnsupportedError);
});

test('an unreadable font is a FontisanError, and the instance stays usable', async () => {
  const fontisan = await load();
  for (const input of [new Uint8Array(0), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]) {
    let err: unknown;
    try {
      fontisan.read(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FontisanError);
    expect((err as FontisanError).status).toBe(9);
    expect((err as FontisanError).errorClass).toMatch(/Error$/);
  }
  expect(fontisan.abiVersion).toBe(2);
});

test('a large input grows the scratch region and errors cleanly', async () => {
  const fontisan = await load();
  expect(() => fontisan.read(new Uint8Array(3 * 1024 * 1024))).toThrow(FontisanError);
  expect(() => fontisan.read(new Uint8Array(8 * 1024 * 1024))).toThrow(FontisanError);
});

// Needs a valid font: the corpus (npm run corpus-fetch / FONTISAN_CORPUS_DIR); CI requires it.
const corpus = process.env.FONTISAN_CORPUS_DIR
  ? join(process.env.FONTISAN_CORPUS_DIR, 'corpus')
  : fileURLToPath(new URL('.corpus/fontisan/corpus', root));
const fontFile = join(corpus, 'fonts', 'source-sans-3-regular-ttf', 'SourceSans3-Regular.ttf');
const haveFont = existsSync(fontFile);
if (!haveFont && process.env.FONTISAN_REQUIRE_CORPUS) throw new Error(`corpus font missing at ${fontFile}`);

/** Run `fn` with WebAssembly.Instance wrapped to count instances and result frees, and to trap on demand. */
async function withInstrumentedInstance<T>(fn: (probe: Probe) => T | Promise<T>): Promise<T> {
  const probe: Probe = { instances: 0, frees: 0, trapNextCall: false };
  const Real = WebAssembly.Instance;
  const Fake = function (mod: WebAssembly.Module, imports?: WebAssembly.Imports) {
    probe.instances++;
    const real = new Real(mod, imports).exports as Record<string, any>;
    return {
      exports: {
        ...real,
        fontisan_call: (...a: unknown[]) => {
          if (probe.trapNextCall) {
            probe.trapNextCall = false;
            throw new WebAssembly.RuntimeError('forced trap');
          }
          return real.fontisan_call(...a);
        },
        fontisan_result_free: (p: number) => {
          probe.frees++;
          real.fontisan_result_free(p);
        },
      },
    };
  };
  (WebAssembly as any).Instance = Fake;
  try {
    return await fn(probe);
  } finally {
    (WebAssembly as any).Instance = Real;
  }
}
interface Probe { instances: number; frees: number; trapNextCall: boolean }

async function engine() {
  const module = await WebAssembly.compile(readFileSync(vendor('fontisan.wasm')));
  return new Engine(module);
}

test.skipIf(!haveFont)('after a trap a fresh instance serves a valid read', async () => {
  await withInstrumentedInstance(async (probe) => {
    const e = await engine();
    const font = readFileSync(fontFile);
    expect(unpackRows(e.call(Op.READ, 1, font))).toHaveLength(1);
    expect(probe.instances).toBe(1);
    probe.trapNextCall = true;
    expect(() => e.call(Op.READ, 1, font)).toThrow(EngineTrapError);
    expect(unpackRows(e.call(Op.READ, 1, font))).toHaveLength(1);
    expect(probe.instances).toBe(2);
  });
});

test.skipIf(!haveFont)('a valid read succeeds after the scratch region grew', async () => {
  const fontisan = await load();
  const font = readFileSync(fontFile);
  const before = fontisan.read(font, { metadata: true });
  for (const mb of [3, 8]) {
    expect(() => fontisan.read(new Uint8Array(mb * 1024 * 1024))).toThrow(FontisanError);
    expect(fontisan.read(font, { metadata: true })).toEqual(before);
  }
});

test.skipIf(!haveFont)('every result block, success or error, is freed', async () => {
  await withInstrumentedInstance(async (probe) => {
    const e = await engine();
    const font = readFileSync(fontFile);
    const payload = e.call(Op.READ, 1, font);
    const copy = Uint8Array.from(payload);
    expect(probe.frees).toBe(1);
    expect(() => e.call(Op.READ, 0, new Uint8Array(0))).toThrow(SrcFontisanError);
    expect(probe.frees).toBe(2);
    expect(() => e.call(Op.READ, 0, new Uint8Array(8 * 1024 * 1024))).toThrow(SrcFontisanError);
    expect(probe.frees).toBe(3);
    expect(payload).toEqual(copy); // the returned payload is a copy, not a view into freed memory
  });
});
