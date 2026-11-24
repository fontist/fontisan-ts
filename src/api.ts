import { Engine, Op, UnsupportedError, unpackRows } from './engine.js';

export interface ReadOptions {
  /** Metadata-only read (else full). */
  metadata?: boolean;
  /** Lazy table loading (else eager). */
  lazy?: boolean;
}

export interface AuditOptions {
  validate?: boolean;
}

export type ConvertTarget = 'ttf' | 'otf' | 'woff' | 'woff2';
const TARGETS: Record<ConvertTarget, number> = { ttf: 0, otf: 1, woff: 2, woff2: 3 };

const utf8 = new TextEncoder();

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The wasm face of the fontisan engine. Obtain one from `load()` in the package entry point. */
export class Fontisan {
  constructor(private readonly engine: Engine) {}

  get abiVersion(): number {
    return this.engine.abiVersion;
  }

  /** One document per face (the facade's canonical read document). */
  read(font: Uint8Array, options: ReadOptions = {}): unknown[] {
    const flags = (options.metadata ? 1 : 0) | (options.lazy ? 2 : 0);
    return unpackRows(this.engine.call(Op.READ, flags, font));
  }

  /** One audit report per face; `name` is the source file name the report records. */
  audit(font: Uint8Array, name: string, options: AuditOptions = {}): unknown[] {
    const n = utf8.encode(name);
    return unpackRows(this.engine.call(Op.AUDIT, options.validate ? 1 : 0, concat(u32(n.length), n, font)));
  }

  /** Sorted, unique glyph ids kept for `codepoints`. */
  glyphIds(font: Uint8Array, name: string, codepoints: number[]): number[] {
    const n = utf8.encode(name);
    const cps = concat(...codepoints.map(u32));
    const out = this.engine.call(Op.GLYPH_IDS, 0, concat(u32(n.length), n, u32(codepoints.length), cps, font));
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    return Array.from({ length: out.length / 4 }, (_, i) => view.getUint32(i * 4, false));
  }

  /** Convert to another container/outline format. woff2 output needs `timestamp` here: wasm has no clock. */
  convert(font: Uint8Array, target: ConvertTarget, timestamp = 0n): Uint8Array {
    const prefix = new Uint8Array(16);
    const view = new DataView(prefix.buffer);
    view.setUint32(0, TARGETS[target], false);
    view.setBigInt64(8, timestamp, false);
    return this.engine.call(Op.CONVERT, 0, concat(prefix, font));
  }

  /** Needs a file system: not available on wasm. Use `audit`/`read` on bytes. */
  scan(): never {
    throw new UnsupportedError('scan needs a file system; the wasm face serves bytes only');
  }

  /** Needs a file system: not available on wasm. */
  auditDir(): never {
    throw new UnsupportedError('auditDir needs a file system; the wasm face serves bytes only');
  }
}
