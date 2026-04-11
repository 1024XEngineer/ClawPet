package tts

import (
	"math"

	"github.com/sipeed/picoclaw/pkg/pet/emotion"
)

const (
	DefaultVoiceID = "Chinese (Mandarin)_Lyrical_Voice"
)

func MapEmotionToParams(e *emotion.EmotionEngine, voiceID string) EmotionParams {
	if voiceID == "" {
		voiceID = DefaultVoiceID
	}

	emotions := e.GetEmotions()
	dominant, score := e.GetDominantEmotion()

	params := EmotionParams{
		VoiceID: voiceID,
		Speed:   1.0,
		Vol:     1.0,
		Pitch:   0,
		Emotion: mapDominantEmotion(dominant),
	}

	deviation := math.Abs(float64(score-emotion.NeutralValue)) / 50.0
	if deviation > 1 {
		deviation = 1
	}

	joyDev := math.Abs(float64(emotions.Joy-emotion.NeutralValue)) / 50.0
	angerDev := math.Abs(float64(emotions.Anger-emotion.NeutralValue)) / 50.0
	sadnessDev := math.Abs(float64(emotions.Sadness-emotion.NeutralValue)) / 50.0

	params.ModifyPitch = int((joyDev*25 - sadnessDev*20 - angerDev*15) * deviation)
	params.ModifyIntensity = int((joyDev*15 - sadnessDev*25 + angerDev*30) * deviation)
	params.ModifyTimbre = int((joyDev*20 - sadnessDev*15) * deviation)

	return params
}

func mapDominantEmotion(dominant string) string {
	switch dominant {
	case emotion.EmotionJoy:
		return "happy"
	case emotion.EmotionAnger:
		return "angry"
	case emotion.EmotionSadness:
		return "sad"
	case emotion.EmotionFear:
		return "fearful"
	case emotion.EmotionDisgust:
		return "disgusted"
	case emotion.EmotionSurprise:
		return "surprised"
	default:
		return "calm"
	}
}
