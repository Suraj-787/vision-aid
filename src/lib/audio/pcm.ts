/**
 * Pure audio conversion helpers for microphone input (no browser APIs, so they
 * can be unit-tested in Node).
 *
 * Target format, per the Gemini Live API docs (verified 2026-11-02):
 * raw, little-endian, 16-bit PCM, mono, 16 kHz, MIME type
 * "audio/pcm;rate=16000". Chunk length is NOT specified by the API; the value
 * below is this project's own choice.
 */
export const INPUT_SAMPLE_RATE = 16000;
export const INPUT_MIME_TYPE = "audio/pcm;rate=16000";
export const CHUNK_MS = 100;
export const CHUNK_SAMPLES = (INPUT_SAMPLE_RATE * CHUNK_MS) / 1000;

/** Float32 [-1, 1] -> Int16, clamped and rounded. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

/** Explicit little-endian serialisation, independent of platform endianness. */
export function pcm16ToLittleEndianBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i], true);
  }
  return bytes;
}

/** Input level 0..1 from RMS, mapped over -60 dBFS .. 0 dBFS. For the UI meter. */
export function rmsLevel(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  const rms = Math.sqrt(sum / block.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

const LOBES = 8;
const PHASES = 128;

/**
 * Streaming band-limited resampler (windowed-sinc, Hann window). When
 * downsampling, the sinc cutoff is scaled to the output Nyquist so content
 * above it is filtered out instead of aliasing into the speech band.
 */
export class Resampler {
  private readonly ratio: number;
  private readonly halfWidth: number;
  private readonly table: Float32Array;
  private readonly passthrough: boolean;
  private buf: Float32Array;
  private pos: number;

  constructor(inputRate: number, outputRate: number = INPUT_SAMPLE_RATE) {
    this.ratio = inputRate / outputRate;
    this.passthrough = inputRate === outputRate;
    const scale = Math.max(1, this.ratio);
    this.halfWidth = Math.ceil(LOBES * scale);
    this.table = new Float32Array(2 * this.halfWidth * PHASES + 2);
    for (let i = 0; i < this.table.length; i++) {
      const t = i / PHASES - this.halfWidth;
      const x = t / scale;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const hann = 0.5 * (1 + Math.cos((Math.PI * t) / this.halfWidth));
      this.table[i] = (sinc / scale) * (Math.abs(t) <= this.halfWidth ? hann : 0);
    }
    // Leading zeros stand in for "silence before the stream started".
    this.buf = new Float32Array(this.halfWidth);
    this.pos = this.halfWidth;
  }

  private kernel(t: number): number {
    const x = (t + this.halfWidth) * PHASES;
    const i = Math.floor(x);
    const f = x - i;
    return this.table[i] * (1 - f) + this.table[i + 1] * f;
  }

  push(input: Float32Array): Float32Array {
    if (this.passthrough) return input.slice();

    const b = new Float32Array(this.buf.length + input.length);
    b.set(this.buf);
    b.set(input, this.buf.length);

    const out = new Float32Array(
      Math.max(0, Math.ceil((b.length - this.pos) / this.ratio)),
    );
    let n = 0;
    // Need input up to floor(pos + halfWidth) to produce the next output.
    while (this.pos + this.halfWidth < b.length) {
      const first = Math.ceil(this.pos - this.halfWidth);
      const last = Math.floor(this.pos + this.halfWidth);
      let acc = 0;
      for (let k = first; k <= last; k++) {
        acc += b[k] * this.kernel(this.pos - k);
      }
      out[n++] = acc;
      this.pos += this.ratio;
    }

    const drop = Math.floor(this.pos) - this.halfWidth;
    this.buf = b.slice(drop);
    this.pos -= drop;
    return out.subarray(0, n);
  }
}

/**
 * Native-rate mono Float32 blocks in, fixed-size PCM16 little-endian chunks
 * out. Samples are only held until a chunk is full; nothing is retained after.
 */
export class MicPcmPipeline {
  private readonly resampler: Resampler;
  private readonly pending: Int16Array;
  private readonly chunkSamples: number;
  private fill = 0;

  constructor(inputRate: number, chunkSamples: number = CHUNK_SAMPLES) {
    this.resampler = new Resampler(inputRate, INPUT_SAMPLE_RATE);
    this.chunkSamples = chunkSamples;
    this.pending = new Int16Array(chunkSamples);
  }

  push(block: Float32Array): Uint8Array[] {
    const pcm = floatToPcm16(this.resampler.push(block));
    const chunks: Uint8Array[] = [];
    let i = 0;
    while (i < pcm.length) {
      const n = Math.min(pcm.length - i, this.chunkSamples - this.fill);
      this.pending.set(pcm.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.chunkSamples) {
        chunks.push(pcm16ToLittleEndianBytes(this.pending));
        this.fill = 0;
      }
    }
    return chunks;
  }
}
