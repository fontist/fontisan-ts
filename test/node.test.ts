import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
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

test('a large input grows the scratch region and round-trips', async () => {
  const fontisan = await load();
  expect(() => fontisan.read(new Uint8Array(3 * 1024 * 1024))).toThrow(FontisanError);
  expect(() => fontisan.read(new Uint8Array(8 * 1024 * 1024))).toThrow(FontisanError);
});
