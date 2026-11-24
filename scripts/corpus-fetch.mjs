#!/usr/bin/env node
// Fetch the shared fontisan corpus (fontist/fontisan `corpus/`) at CORPUS_REV for the parity test.
// usage: node scripts/corpus-fetch.mjs [dest]   (default ./.corpus/fontisan)
// FONTISAN_CORPUS_SRC may name an existing fontisan checkout holding `corpus/` at the pinned rev.
// ci-tier source fonts are downloaded from their pinned URLs and sha256-checked; the large tier is skipped.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(process.argv[2] ?? join(root, '.corpus', 'fontisan'));
const rev = readFileSync(join(root, 'CORPUS_REV'), 'utf8').trim();
const corpus = join(dest, 'corpus');

if (!existsSync(join(corpus, 'manifest.json'))) {
  mkdirSync(dest, { recursive: true });
  if (process.env.FONTISAN_CORPUS_SRC) {
    cpSync(join(process.env.FONTISAN_CORPUS_SRC, 'corpus'), corpus, { recursive: true });
  } else {
    const tmp = join(dest, '_clone');
    const git = (...a) => execFileSync('git', a, { stdio: 'inherit' });
    git('clone', '--filter=blob:none', '--no-checkout', 'https://github.com/fontist/fontisan', tmp);
    git('-C', tmp, 'checkout', rev, '--', 'corpus');
    renameSync(join(tmp, 'corpus'), corpus);
    rmSync(tmp, { recursive: true, force: true });
  }
}

const manifest = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8'));
let n = 0;
for (const font of manifest.fonts) {
  if (font.type !== 'source' || font.tier !== 'ci') continue;
  const target = join(corpus, 'fonts', font.id, font.file);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  if (!(existsSync(target) && sha(readFileSync(target)) === font.sha256)) {
    const res = await fetch(font.source.url.replaceAll('[', '%5B').replaceAll(']', '%5D'));
    if (!res.ok) throw new Error(`${font.id}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (sha(data) !== font.sha256) throw new Error(`${font.id}: sha256 ${sha(data)} != manifest ${font.sha256}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  n++;
}
console.log(`corpus-fetch: ${n} ci source fonts verified in ${corpus}`);
