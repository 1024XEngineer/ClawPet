import { useState, useEffect, useCallback, useRef } from 'react'

type PetState = 'idle' | 'sad' | 'happy' | 'listen' | 'standby' | 'celebrate' | 'shakeHead' | 'stayOut'

interface BubbleData {
  text: string | null
  emotion?: string
  level?: string
  animation?: string
  animationHints?: string[]
  audio?: string
}

const happyImages = ['/happy1.gif', '/happy2.gif']
const standbyImages = ['/standby1.gif', '/standby2.gif', '/standby3.gif']

const getPetImage = (state: PetState, prevImage?: string): string => {
  switch (state) {
    case 'idle':
      return '/init.png'
    case 'sad':
      return '/sad.gif'
    case 'happy':
      return happyImages[Math.floor(Math.random() * happyImages.length)]
    case 'listen':
      return '/listening.gif'
    case 'celebrate':
      return '/celebrate_out.gif'
    case 'shakeHead':
      return '/shake-head_out.gif'
    case 'stayOut':
      return '/stay_out.gif'
    case 'standby': {
      let img = standbyImages[Math.floor(Math.random() * standbyImages.length)]
      if (prevImage && standbyImages.includes(prevImage) && standbyImages.length > 1) {
        while (img === prevImage) {
          img = standbyImages[Math.floor(Math.random() * standbyImages.length)]
        }
      }
      return img
    }
    default:
      return '/init.png'
  }
}

const emotionToPetState: Record<string, PetState> = {
  joy: 'happy',
  happy: 'happy',
  sadness: 'sad',
  sad: 'sad',
  anger: 'shakeHead',
  disgust: 'shakeHead',
  surprise: 'celebrate',
  fear: 'stayOut',
  neutral: 'standby',
}

const levelToPetState: Record<string, PetState> = {
  critical: 'stayOut',
  elevated: 'standby',
  normal: 'standby',
}

const animationToPetState: Record<string, PetState> = {
  happy: 'happy',
  sad: 'sad',
  listen: 'listen',
  standby: 'standby',
  celebrate: 'celebrate',
  'shake-head': 'shakeHead',
  'stay-out': 'stayOut',
  'init.png': 'idle',
}

const resolvePetState = (data: BubbleData): PetState => {
  const candidates = [
    data.animation,
    ...(data.animationHints ?? []),
    data.emotion ? emotionToPetState[data.emotion] : undefined,
    data.level ? levelToPetState[data.level] : undefined,
    'idle' as PetState,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate in animationToPetState) {
      return animationToPetState[candidate]
    }
    if (
      candidate === 'idle' ||
      candidate === 'sad' ||
      candidate === 'happy' ||
      candidate === 'listen' ||
      candidate === 'standby' ||
      candidate === 'celebrate' ||
      candidate === 'shakeHead' ||
      candidate === 'stayOut'
    ) {
      return candidate
    }
  }

  return 'idle'
}

function App() {
  const [petState, setPetState] = useState<PetState>('standby')
  const [currentImage, setCurrentImage] = useState('/standby1.gif')
  const currentImageRef = useRef(currentImage)
  currentImageRef.current = currentImage

  const [bubble, setBubble] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const transitionTo = useCallback((newState: PetState, delay?: number) => {
    const prevImage = currentImageRef.current
    setPetState(newState)
    setCurrentImage(getPetImage(newState, prevImage))
    if (delay) {
      setTimeout(() => {
        setPetState('standby')
        setCurrentImage(getPetImage('standby', currentImageRef.current))
      }, delay)
    }
  }, [])

  useEffect(() => {
    const handleBubbleShow = (data: BubbleData) => {
      if (bubbleTimerRef.current) {
        clearTimeout(bubbleTimerRef.current)
        bubbleTimerRef.current = null
      }

      if (data.text !== null) {
        setBubble(data.text)
      }

      transitionTo(resolvePetState(data))

      if (data.audio) {
        let audioUrl = data.audio
        if (!audioUrl.startsWith('data:') && !audioUrl.startsWith('http')) {
          audioUrl = `data:audio/mp3;base64,${audioUrl}`
        }
        if (audioRef.current) {
          audioRef.current.pause()
        }
        audioRef.current = new Audio(audioUrl)
        audioRef.current.onended = () => {
          setBubble('')
          transitionTo('standby')
        }
        audioRef.current.play().catch(() => {
          setBubble('')
        })
      } else {
        bubbleTimerRef.current = setTimeout(() => {
          setBubble('')
          transitionTo('standby')
        }, 10000)
      }
    }

    window.electronAPI?.onBubbleShow(handleBubbleShow)
    window.electronAPI?.onSettingsUpdate(() => {})
    document.title = 'PetClaw'
  }, [transitionTo])

  const openSettings = () => {
    window.electronAPI?.openSettings()
  }

  return (
    <div className="app">
      <div className="pet-container">
        <div className="controls">
          <button className="btn" onClick={openSettings} title="Settings">S</button>
          <button className="btn close" onClick={() => window.close()} title="Close">X</button>
        </div>

        {bubble && <div className="bubble">{bubble}</div>}

        <div className="pet-area">
          <img className="pet-image" src={currentImage} alt="Pet" />
          <span style={{ display: 'none' }}>{petState}</span>
        </div>
      </div>
    </div>
  )
}

export default App
