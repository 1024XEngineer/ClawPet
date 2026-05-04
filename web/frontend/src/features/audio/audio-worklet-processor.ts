// @ts-nocheck
class PicoAudioProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    if (!input || input.length === 0) {
      return true
    }

    const channelData = input[0]
    if (!channelData || channelData.length === 0) {
      return true
    }

    const copied = new Float32Array(channelData.length)
    copied.set(channelData)
    this.port.postMessage({ samples: copied }, [copied.buffer])
    return true
  }
}

registerProcessor("pico-audio-processor", PicoAudioProcessor)
