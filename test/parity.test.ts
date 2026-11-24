// Corpus parity: results through the wasm C ABI vs the Ruby-tier goldens of fontist/fontisan `corpus/`.
// Port of fontisan-python tests/test_parity.py (read + audit). Needs `node scripts/corpus-fetch.mjs`
// (or FONTISAN_CORPUS_DIR); FONTISAN_REQUIRE_CORPUS=1 makes a missing corpus a failure, not a skip.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { FontisanError, UnsupportedError, load } from 'fontisan-ts-placeholder';

const here = dirname(fileURLToPath(import.meta.url));
const corpus = process.env.FONTISAN_CORPUS_DIR
  ? join(process.env.FONTISAN_CORPUS_DIR, 'corpus')
  : resolve(here, '..', '.corpus', 'fontisan', 'corpus');
const present = existsSync(join(corpus, 'goldens', 'read')) && existsSync(join(corpus, 'fonts'));
if (!present && process.env.FONTISAN_REQUIRE_CORPUS) throw new Error(`corpus missing at ${corpus}`);

const norm = (s: string) => s.replace(/\d+/g, '<N>');
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function fontPath(name: string): string {
  const derived = join(corpus, 'derived', name);
  if (existsSync(derived)) return derived;
  for (const id of readdirSync(join(corpus, 'fonts'))) {
    const p = join(corpus, 'fonts', id, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`${name} not in corpus`);
}

interface Case { id: string; file: string; data: Uint8Array; g: any; swallow: boolean }
function cases(): Case[] {
  const root = join(corpus, 'goldens', 'read');
  const out: Case[] = [];
  for (const f of readdirSync(root).filter((n) => n.endsWith('.json')).sort()) {
    const g = json(join(root, f));
    if (g.tier !== 'ci') continue;
    out.push({ id: g.id, file: g.file, data: readFileSync(fontPath(g.file)), g, swallow: false });
  }
  const sw = join(root, '_swallow');
  if (existsSync(sw)) {
    for (const f of readdirSync(sw).filter((n) => n.endsWith('.json')).sort()) {
      const font = f.replace(/\.json$/, '.ttf');
      out.push({ id: `_swallow/${f}`, file: font, data: readFileSync(join(sw, font)), g: json(join(sw, f)), swallow: true });
    }
  }
  return out;
}

const VARIANTS = ['full/lazy', 'full/eager', 'metadata/lazy', 'metadata/eager'];
const entry = (g: any, key: string) => {
  const e = g.read[key];
  return typeof e.same_as === 'string' ? g.read[e.same_as] : e;
};

function expectError(err: unknown, want: any, what: string) {
  expect(err, what).toBeInstanceOf(FontisanError);
  const e = err as FontisanError;
  expect(want.error, `${what}: unexpected error ${e.message}`).toBeDefined();
  expect(e.errorClass, what).toBe(want.error.class);
  expect(e.message, what).toBe(want.error.message);
}

test.skipIf(!present)('read matches the goldens', async () => {
  const fontisan = await load();
  let ok = 0, unsupported = 0;
  for (const { id, data, g, swallow } of cases()) {
    for (const key of VARIANTS) {
      if (swallow && key !== 'full/eager') continue;
      const want = entry(g, key);
      const [mode, lazy] = key.split('/');
      const what = `${id} ${key}`;
      let got: any[];
      try {
        got = fontisan.read(data, { metadata: mode === 'metadata', lazy: lazy === 'lazy' }) as any[];
      } catch (err) {
        if (err instanceof UnsupportedError) { unsupported++; continue; }
        expectError(err, want, what);
        continue;
      }
      expect(want.ok, `${what}: expected an error`).toBeDefined();
      expect(got.length, `${what}: face count`).toBe(want.ok.length);
      const deduped = typeof g.read[key].same_as === 'string';
      got.forEach((have, i) => {
        if (deduped) have = { ...have, lazy: want.ok[i].lazy, mode: want.ok[i].mode };
        expect(have, `${what}[${i}]`).toEqual(want.ok[i]);
        ok++;
      });
    }
  }
  expect(ok).toBeGreaterThanOrEqual(150);
  expect(unsupported).toBeGreaterThanOrEqual(4);
});

test.skipIf(!present)('audit matches the goldens', async () => {
  const fontisan = await load();
  let ok = 0;
  for (const { id, file, data, g } of cases()) {
    for (const [profile, validate] of [['default', false], ['validate', true]] as const) {
      const want = g.audit[profile];
      const what = `${id} ${profile}`;
      let got: unknown;
      try {
        got = fontisan.audit(data, file, { validate });
      } catch (err) {
        if (err instanceof UnsupportedError) continue;
        expectError(err, want, what);
        continue;
      }
      expect(want.ok, `${what}: expected an error`).toBeDefined();
      expect(got, what).toEqual(want.ok);
      ok++;
    }
  }
  expect(ok).toBeGreaterThanOrEqual(50);
});

test.skipIf(!present)('convert and glyphIds serve real fonts', async () => {
  const fontisan = await load();
  const ttf = readFileSync(fontPath('SourceSans3-Regular.ttf'));
  const woff2 = fontisan.convert(ttf, 'woff2', 1_700_000_000n);
  expect(new TextDecoder().decode(woff2.subarray(0, 4))).toBe('wOF2');
  const [face] = fontisan.read(woff2, { metadata: true }) as any[];
  const [orig] = fontisan.read(ttf, { metadata: true }) as any[];
  expect(face.family_name ?? face.names).toEqual(orig.family_name ?? orig.names);
  const ids = fontisan.glyphIds(ttf, 'SourceSans3-Regular.ttf', [0x41, 0x42]);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
});
