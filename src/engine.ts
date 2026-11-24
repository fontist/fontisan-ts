// The C ABI of fontisan-rs (`fontisan-ffi`, ABI 2) driven through a wasm32-unknown-unknown module.
// The module exports no allocator, so the host owns a scratch region it carves out with
// `memory.grow`; engine-allocated result blocks are released with `fontisan_result_free`.
// wasm32 pointers are 32 bits: fontisan_request is 32 bytes, fontisan_result is 48.

export const MAGIC = 0x4e415346;
export const ABI_VERSION = 2;

export const Op = {
  CONVERT: 1,
  SUBSET: 6,
  INSTANCE: 7,
  READ: 8,
  AUDIT: 9,
  SCAN: 10,
  AUDIT_DIR: 11,
  GLYPH_IDS: 12,
} as const;

const STATUS_READ_FAILED = 9;
const STATUS_UNSUPPORTED = 10;
const KIND_UNSUPPORTED = 5;
const PAGE = 65536;
const REQ_SIZE = 32;
const INPUT_OFFSET = 40; // request (32) + out-pointer slot (4), 8-aligned

export interface ErrorCause {
  class: string;
  message: string;
}

/** An engine error. For read/audit failures `errorClass` and `causes` carry the Ruby error surface. */
export class FontisanError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: number,
    readonly errorClass: string | null = null,
    readonly causes: ErrorCause[] = [],
  ) {
    super(message);
    this.name = 'FontisanError';
  }
}

/** The operation is not served by the wasm face (or not natively by the engine); never a silent wrong answer. */
export class UnsupportedError extends FontisanError {
  constructor(message: string, status = STATUS_UNSUPPORTED, kind = KIND_UNSUPPORTED) {
    super(message, status, kind);
    this.name = 'UnsupportedError';
  }
}

/** The engine trapped (a panic cannot unwind on wasm32). The instance was discarded; the next call starts a fresh one. */
export class EngineTrapError extends Error {
  constructor(cause: unknown) {
    super(`fontisan engine trapped: ${String(cause)}`, { cause });
    this.name = 'EngineTrapError';
  }
}

interface Exports {
  memory: WebAssembly.Memory;
  fontisan_abi_version(): number;
  fontisan_call(req: number, out: number): number;
  fontisan_result_free(result: number): void;
}

export class Engine {
  #exports: Exports | null = null;
  #scratch = 0;
  #scratchSize = 0;

  constructor(private readonly module: WebAssembly.Module) {
    this.#instantiate();
  }

  #instantiate(): Exports {
    const instance = new WebAssembly.Instance(this.module, {});
    const ex = instance.exports as unknown as Exports;
    if (ex.fontisan_abi_version() !== ABI_VERSION) {
      throw new Error(`fontisan wasm ABI ${ex.fontisan_abi_version()} != expected ${ABI_VERSION}`);
    }
    this.#exports = ex;
    this.#scratch = 0;
    this.#scratchSize = 0;
    return ex;
  }

  get abiVersion(): number {
    return (this.#exports ?? this.#instantiate()).fontisan_abi_version();
  }

  #reserve(ex: Exports, need: number): void {
    if (this.#scratchSize >= need) return;
    const pages = Math.ceil(Math.max(need, this.#scratchSize * 2) / PAGE);
    const base = ex.memory.grow(pages);
    if (base < 0) throw new FontisanError('wasm memory exhausted', 0, 0);
    this.#scratch = base * PAGE;
    this.#scratchSize = pages * PAGE;
  }

  /** One `fontisan_call`. Returns a copy of the payload; throws FontisanError on a non-zero status. */
  call(op: number, flags: number, input: Uint8Array): Uint8Array {
    const ex = this.#exports ?? this.#instantiate();
    try {
      this.#reserve(ex, INPUT_OFFSET + input.length);
      const base = this.#scratch;
      const mem = new Uint8Array(ex.memory.buffer);
      const view = new DataView(ex.memory.buffer);
      view.setUint32(base, MAGIC, true);
      view.setUint32(base + 4, ABI_VERSION, true);
      view.setUint32(base + 8, REQ_SIZE, true);
      view.setUint32(base + 12, 0, true);
      view.setUint32(base + 16, op, true);
      view.setUint32(base + 20, flags, true);
      view.setUint32(base + 24, base + INPUT_OFFSET, true);
      view.setUint32(base + 28, input.length, true);
      view.setUint32(base + 32, 0, true);
      mem.set(input, base + INPUT_OFFSET);
      const status = ex.fontisan_call(base, base + 32);
      // Rust may have grown (and so detached) the buffer.
      const after = new DataView(ex.memory.buffer);
      const bytes = new Uint8Array(ex.memory.buffer);
      const res = after.getUint32(base + 32, true);
      if (res === 0) throw new FontisanError(`fontisan_call returned status ${status} without a result`, status, 0);
      try {
        const structSize = after.getUint32(res + 8, true);
        const kind = structSize >= 48 ? after.getInt32(res + 40, true) : 0;
        if (status !== 0) {
          const msgPtr = after.getUint32(res + 24, true);
          const msgLen = after.getUint32(res + 28, true);
          const message = new TextDecoder().decode(bytes.subarray(msgPtr, msgPtr + msgLen));
          throw classify(status, kind, message);
        }
        const pay = after.getUint32(res + 32, true);
        const len = after.getUint32(res + 36, true);
        return bytes.slice(pay, pay + len);
      } finally {
        ex.fontisan_result_free(res);
      }
    } catch (err) {
      if (err instanceof WebAssembly.RuntimeError) {
        this.#exports = null;
        throw new EngineTrapError(err);
      }
      throw err;
    }
  }
}

function classify(status: number, kind: number, message: string): FontisanError {
  if (status === STATUS_UNSUPPORTED || kind === KIND_UNSUPPORTED) return new UnsupportedError(message, status, kind);
  if (status === STATUS_READ_FAILED) {
    try {
      const doc = JSON.parse(message) as { class?: string; message?: string; causes?: ErrorCause[] };
      return new FontisanError(doc.message ?? message, status, kind, doc.class ?? null, doc.causes ?? []);
    } catch {
      // not the JSON error surface: fall through with the raw message
    }
  }
  return new FontisanError(message, status, kind);
}

/** Decode the engine's "packed rows" payload: u32 BE count, then per row a u32 BE length and UTF-8 JSON. */
export function unpackRows(payload: Uint8Array): unknown[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const count = view.getUint32(0, false);
  const rows: unknown[] = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(at, false);
    at += 4;
    rows.push(JSON.parse(new TextDecoder().decode(payload.subarray(at, at + len))));
    at += len;
  }
  return rows;
}
