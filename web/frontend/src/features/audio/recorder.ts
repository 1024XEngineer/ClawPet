const TARGET_SAMPLE_RATE = 16000

function encodePcm16Base64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  const bytes = new Uint8Array(pcm.buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function downsampleTo16k(input: Float32Array, sourceSampleRate: number): Float32Array {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) {
    return input
  }

  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE
  const targetLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(targetLength)

  let outputIndex = 0
  let inputIndex = 0
  while (outputIndex < targetLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio))
    let total = 0
    let count = 0
    for (let i = inputIndex; i < nextInputIndex; i += 1) {
      total += input[i]
      count += 1
    }
    output[outputIndex] = count > 0 ? total / count : 0
    outputIndex += 1
    inputIndex = nextInputIndex
  }

  return output
}

export interface AudioRecorderCallbacks {
  onFrame: (base64Pcm: string) => void
  onError: (error: string) => void
}

export interface AudioRecorderController {
  start: () => Promise<void>
  stop: () => void
  isRecording: () => boolean
}

export function createAudioRecorder(
  callbacks: AudioRecorderCallbacks,
): AudioRecorderController {
  let mediaStream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let workletNode: AudioWorkletNode | null = null
  let scriptNode: ScriptProcessorNode | null = null
  let recording = false

  const cleanup = () => {
    try {
      workletNode?.disconnect()
      scriptNode?.disconnect()
      sourceNode?.disconnect()
    } catch {
      // ignore
    }

    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop()
      }
    }

    if (audioContext) {
      void audioContext.close()
    }

    mediaStream = null
    audioContext = null
    sourceNode = null
    workletNode = null
    scriptNode = null
    recording = false
  }

  const handleSamples = (samples: Float32Array, sourceSampleRate: number) => {
    if (!recording) {
      return
    }
    const downsampled = downsampleTo16k(samples, sourceSampleRate)
    callbacks.onFrame(encodePcm16Base64(downsampled))
  }

  const start = async () => {
    if (recording) {
      return
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioContext = new AudioContext()
      sourceNode = audioContext.createMediaStreamSource(mediaStream)

      const sourceSampleRate = audioContext.sampleRate

      if (typeof AudioWorkletNode !== "undefined" && audioContext.audioWorklet) {
        const moduleUrl = new URL("./audio-worklet-processor.ts", import.meta.url)
        await audioContext.audioWorklet.addModule(moduleUrl)
        workletNode = new AudioWorkletNode(audioContext, "pico-audio-processor")
        workletNode.port.onmessage = (event: MessageEvent<{ samples?: Float32Array }>) => {
          const samples = event.data?.samples
          if (!samples) {
            return
          }
          handleSamples(samples, sourceSampleRate)
        }
        sourceNode.connect(workletNode)
        workletNode.connect(audioContext.destination)
      } else {
        scriptNode = audioContext.createScriptProcessor(2048, 1, 1)
        scriptNode.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0)
          const copied = new Float32Array(input.length)
          copied.set(input)
          handleSamples(copied, sourceSampleRate)
        }
        sourceNode.connect(scriptNode)
        scriptNode.connect(audioContext.destination)
      }

      recording = true
    } catch (error) {
      cleanup()
      callbacks.onError(error instanceof Error ? error.message : "Failed to start recording")
    }
  }

  return {
    start,
    stop: cleanup,
    isRecording: () => recording,
  }
}
