package tts

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/logger"
)

type MinimaxStreamingProvider struct {
	apiKey    string
	apiBase   string
	model     string
	voiceID   string
	extraBody map[string]any
}

func NewMinimaxStreamingProvider(apiKey, apiBase, model string, extraBody map[string]any) *MinimaxStreamingProvider {
	if apiBase == "" {
		apiBase = "https://api.minimaxi.com"
	}
	if !strings.HasSuffix(apiBase, "/v1/t2a_v2") {
		apiBase = strings.TrimSuffix(apiBase, "/") + "/v1/t2a_v2"
	}

	if model == "" {
		model = "speech-2.8-hd"
	}

	voiceID := DefaultVoiceID
	if extraBody != nil {
		if v, ok := extraBody["voice_id"].(string); ok && v != "" {
			voiceID = v
		}
	}

	return &MinimaxStreamingProvider{
		apiKey:    apiKey,
		apiBase:   apiBase,
		model:     model,
		voiceID:   voiceID,
		extraBody: extraBody,
	}
}

func (p *MinimaxStreamingProvider) Name() string {
	return "minimax-tts-streaming"
}

func (p *MinimaxStreamingProvider) SynthesizeStream(
	ctx context.Context,
	text string,
	params EmotionParams,
	onChunk func(VoiceSegment) error,
) error {
	voiceID := params.VoiceID
	if voiceID == "" {
		voiceID = p.voiceID
	}

	voiceSetting := map[string]any{
		"voice_id": voiceID,
	}

	reqBody := map[string]any{
		"model":         p.model,
		"text":          text,
		"stream":        true,
		"voice_setting": voiceSetting,
		"audio_setting": map[string]any{
			"sample_rate": 32000,
			"format":      "mp3",
			"channel":     1,
		},
		"stream_options": map[string]any{
			"exclude_aggregated_audio": false,
		},
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.apiBase, strings.NewReader(string(jsonData)))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Accept", "text/event-stream")

	client := &http.Client{
		Timeout: 120 * time.Second,
	}

	logger.DebugCF("voice-tts", "Minimax TTS HTTP stream request", map[string]any{
		"url":   p.apiBase,
		"text":  text,
		"voice": voiceID,
	})

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK || strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		body, _ := io.ReadAll(resp.Body)
		logger.ErrorCF("voice-tts", "Minimax TTS API error or JSON response", map[string]any{
			"status":       resp.StatusCode,
			"content_type": resp.Header.Get("Content-Type"),
			"body":         string(body),
		})
		return fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	logger.DebugCF("voice-tts", "Minimax TTS response headers", map[string]any{
		"content_type": resp.Header.Get("Content-Type"),
		"status":       resp.StatusCode,
	})

	reader := bufio.NewReader(resp.Body)
	var latestAudio string
	var lineCount int

	for {
		line, err := reader.ReadString('\n')
		lineCount++
		if err != nil {
			if err == io.EOF {
				logger.DebugCF("voice-tts", "Minimax TTS stream EOF", map[string]any{
					"lines_read": lineCount,
					"audio_size": len(latestAudio),
				})
				break
			}
			logger.ErrorCF("voice-tts", "Minimax TTS read error", map[string]any{
				"error":      err.Error(),
				"lines_read": lineCount,
			})
			return fmt.Errorf("failed to read response: %w", err)
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if !strings.HasPrefix(line, "data:") {
			continue
		}

		dataStr := strings.TrimPrefix(line, "data:")
		dataStr = strings.TrimSpace(dataStr)

		if dataStr == "" {
			continue
		}

		var sseResp SSEEvent
		if err := json.Unmarshal([]byte(dataStr), &sseResp); err != nil {
			logger.DebugCF("voice-tts", "Minimax TTS SSE parse error", map[string]any{
				"error":    err.Error(),
				"data":     dataStr,
				"line_num": lineCount,
			})
			continue
		}

		if sseResp.Data.Audio != "" {
			latestAudio = sseResp.Data.Audio
		}

		if sseResp.Data.Status == 2 {
			segment := VoiceSegment{
				Text:     text,
				HexAudio: latestAudio,
				Emotion:  params.Emotion,
				IsFinal:  true,
			}

			logger.DebugCF("voice-tts", "Minimax TTS final chunk received", map[string]any{
				"audio_size": len(segment.HexAudio),
				"status":     sseResp.Data.Status,
			})

			if err := onChunk(segment); err != nil {
				return err
			}
			return nil
		}
	}

	return fmt.Errorf("unexpected end of stream")
}

type SSEEvent struct {
	Event     string     `json:"event,omitempty"`
	Data      SSEData    `json:"data"`
	TraceID   string     `json:"trace_id,omitempty"`
	ExtraInfo *ExtraInfo `json:"extra_info,omitempty"`
	BaseResp  BaseResp   `json:"base_resp,omitempty"`
}

type SSEData struct {
	Audio        string `json:"audio,omitempty"`
	Status       int    `json:"status,omitempty"`
	SubtitleFile string `json:"subtitle_file,omitempty"`
}

type ExtraInfo struct {
	AudioLength        int     `json:"audio_length,omitempty"`
	AudioSampleRate    int     `json:"audio_sample_rate,omitempty"`
	AudioSize          int     `json:"audio_size,omitempty"`
	Bitrate            int     `json:"bitrate,omitempty"`
	AudioFormat        string  `json:"audio_format,omitempty"`
	AudioChannel       int     `json:"audio_channel,omitempty"`
	InvisibleCharRatio float64 `json:"invisible_character_ratio,omitempty"`
	UsageCharacters    int     `json:"usage_characters,omitempty"`
	WordCount          int     `json:"word_count,omitempty"`
}

type BaseResp struct {
	StatusCode int    `json:"status_code,omitempty"`
	StatusMsg  string `json:"status_msg,omitempty"`
}

type MinimaxBatchProvider struct {
	apiKey     string
	apiBase    string
	model      string
	voiceID    string
	httpClient *http.Client
}

func NewMinimaxBatchProvider(apiKey, apiBase, model, proxy string) *MinimaxBatchProvider {
	if apiBase == "" {
		apiBase = "https://api.minimaxi.com/v1/t2a_v2"
	} else {
		apiBase = strings.TrimSuffix(apiBase, "/") + "/v1/t2a_v2"
	}

	client := &http.Client{Timeout: 60 * time.Second}

	return &MinimaxBatchProvider{
		apiKey:     apiKey,
		apiBase:    apiBase,
		model:      model,
		voiceID:    "",
		httpClient: client,
	}
}

func (p *MinimaxBatchProvider) Name() string {
	return "minimax-tts"
}

func (p *MinimaxBatchProvider) Synthesize(ctx context.Context, text string) (io.ReadCloser, error) {
	logger.DebugCF("voice-tts", "Starting Minimax TTS synthesis", map[string]any{"text_len": len(text)})

	reqBody := map[string]any{
		"model":  p.model,
		"text":   text,
		"stream": false,
		"voice_setting": map[string]any{
			"voice_id": p.voiceID,
			"speed":    1.0,
			"vol":      1.0,
			"pitch":    0,
		},
		"audio_setting": map[string]any{
			"sample_rate": 32000,
			"format":      "mp3",
			"channel":     1,
		},
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.apiBase, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	return resp.Body, nil
}

var _ StreamingTTSProvider = (*MinimaxStreamingProvider)(nil)
var _ BatchTTSProvider = (*MinimaxBatchProvider)(nil)
