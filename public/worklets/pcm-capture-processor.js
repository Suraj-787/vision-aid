/* global AudioWorkletProcessor, registerProcessor */

/**
 * Runs on the audio rendering thread. Only batches mono Float32 samples into
 * fixed-size blocks and hands them to the main thread (transferred, not
 * copied). Resampling and PCM16 conversion happen in src/lib/audio/pcm.ts.
 * Input is mono: the node is created with channelCount 1 / explicit mode, so
 * the browser downmixes. Nothing is stored here beyond the current block.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = (options.processorOptions && options.processorOptions.blockSize) || 960;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.stopped = true;
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let i = 0;
    while (i < channel.length) {
      const n = Math.min(channel.length - i, this.size - this.fill);
      this.buf.set(channel.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.size) {
        const full = this.buf;
        this.port.postMessage(full.buffer, [full.buffer]);
        this.buf = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
