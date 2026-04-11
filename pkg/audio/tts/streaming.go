package tts

import (
	"context"
	"io"
)

type EmotionParams struct {
	VoiceID string  `json:"voice_id"`
	Speed   float64 `json:"speed"`
	Vol     float64 `json:"vol"`
	Pitch   int     `json:"pitch"`
	Emotion string  `json:"emotion"`

	ModifyPitch     int    `json:"modify_pitch"`
	ModifyIntensity int    `json:"modify_intensity"`
	ModifyTimbre    int    `json:"modify_timbre"`
	SoundFX         string `json:"sound_fx"`
}

type VoiceSegment struct {
	Text     string `json:"text"`
	HexAudio string `json:"hex_audio"`
	Emotion  string `json:"emotion"`
	IsFinal  bool   `json:"is_final"`
}

type StreamingTTSProvider interface {
	Name() string
	SynthesizeStream(ctx context.Context, text string, params EmotionParams, onChunk func(VoiceSegment) error) error
}

type BatchTTSProvider interface {
	Name() string
	Synthesize(ctx context.Context, text string) (io.ReadCloser, error)
}

var _ BatchTTSProvider = (*OpenAITTSProvider)(nil)
