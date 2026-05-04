class PetClawAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.tick = 0
  }

  process(inputs) {
    this.tick += 1
    if (this.tick % 100 === 0) {
      this.port.postMessage({ kind: "tick", tick: this.tick })
    }
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

registerProcessor("petclaw-audio-processor", PetClawAudioProcessor)
