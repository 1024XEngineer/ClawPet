package voice

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/logger"
)

// MinimaxTTS MiniMax语音合成服务实现
// 支持流式音频输出，采用SSE协议接收增量音频数据
type MinimaxTTS struct {
	apiBase    string       // API地址
	apiKey     string       // API密钥
	model      string       // 使用的模型名称
	voiceID    string       // 音色ID
	httpClient *http.Client // HTTP客户端，包含60秒超时
}

// newMinimaxTTS 创建MiniMax TTS实例
func newMinimaxTTS(apiBase, apiKey, model, voiceID string, extra map[string]any) *MinimaxTTS {
	if apiBase == "" {
		apiBase = "https://api.minimaxi.com/v1/t2a_v2"
	}
	if model == "" {
		model = "speech-2.8-hd"
	}
	if voiceID == "" {
		voiceID = "male-qn-qingse"
	}

	return &MinimaxTTS{
		apiBase: apiBase,
		apiKey:  apiKey,
		model:   model,
		voiceID: voiceID,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func init() {
	RegisterProvider("minimax", func(apiBase, apiKey, model, voiceID string, extra map[string]any) StreamingTTS {
		return newMinimaxTTS(apiBase, apiKey, model, voiceID, extra)
	})
}

// Synthesize 执行语音合成，将文本转换为语音
// 返回一个通道，用于接收流式音频数据块
func (t *MinimaxTTS) Synthesize(text string, params VoiceParams) (<-chan AudioChunk, error) {
	logger.DebugCF("pet-voice", "MinimaxTTS.Synthesize", map[string]any{
		"text":     text,
		"text_len": len(text),
		"params":   params,
	})

	// 构建请求体
	reqBody := map[string]any{
		"model":  t.model,
		"text":   text,
		"stream": true, // 启用流式输出
		"voice_setting": map[string]any{
			"voice_id": t.voiceID,
			"speed":    params.Speed,
			"vol":      params.Vol,
			"pitch":    params.Pitch,
		},
		"audio_setting": map[string]any{
			"sample_rate": 32000,
			"bitrate":     128000,
			"format":      "mp3",
			"channel":     1,
		},
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(context.Background(), "POST", t.apiBase, bytes.NewReader(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.apiKey)

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	// 创建通道并在后台goroutine中读取流数据
	ch := make(chan AudioChunk, 100)
	go t.readStream(resp.Body, ch)
	return ch, nil
}

// readStream 从HTTP响应体中读取SSE格式的流数据
// 将每一行数据解析为AudioChunk并发送到通道
func (t *MinimaxTTS) readStream(body io.Reader, ch chan<- AudioChunk) {
	defer close(ch)

	reader := io.Reader(body)
	buf := make([]byte, 4096) // 4KB缓冲区
	partial := ""             // 处理不完整的行
	totalRead := 0

	for {
		n, err := reader.Read(buf)
		totalRead += n

		if n > 0 {
			partial += string(buf[:n])

			// 按行分割，处理已收到的完整行
			lines := strings.Split(partial, "\n")

			// 保护：确保 lines 不为空
			if len(lines) == 0 {
				continue
			}

			partial = lines[len(lines)-1] // 保留最后一个不完整的行

			for i := 0; i < len(lines)-1; i++ {
				line := strings.TrimSpace(lines[i])

				if line == "" {
					continue
				}

				// SSE格式: "data: {...}"
				if !strings.HasPrefix(line, "data:") {
					logger.DebugCF("pet-voice", "skipping non-data line", nil)
					continue
				}

				data := strings.TrimPrefix(line, "data:")
				data = strings.TrimSpace(data)

				if data == "" {
					continue
				}

				chunk, parseErr := t.parseChunk(data)
				if parseErr != nil {
					logger.WarnCF("pet-voice", "failed to parse chunk", map[string]any{
						"error": parseErr,
						"data":  data,
					})
					continue
				}

				// 非阻塞发送，若通道满则丢弃
				select {
				case ch <- chunk:
				default:
					logger.WarnCF("pet-voice", "chunk channel full, dropping", nil)
				}
			}
		}

		if err != nil {
			if err != io.EOF {
				logger.WarnCF("pet-voice", "stream read error", map[string]any{"error": err})
			}
			// 处理剩余的 partial 数据
			if partial != "" {
				line := strings.TrimSpace(partial)
				if strings.HasPrefix(line, "data:") {
					data := strings.TrimPrefix(line, "data:")
					data = strings.TrimSpace(data)
					chunk, parseErr := t.parseChunk(data)
					if parseErr == nil {
						select {
						case ch <- chunk:
						default:
						}
					}
				}
			}
			break
		}
	}

	logger.DebugCF("pet-voice", "readStream finished", nil)
}

// minimaxResponse MiniMax API的响应结构
type minimaxResponse struct {
	Data struct {
		Audio  string `json:"audio"`  // hex编码的音频数据
		Status int    `json:"status"` // 状态码，2表示最后一块
	} `json:"data"`
	ExtraInfo *AudioInfo `json:"extra_info,omitempty"` // 音频元信息
}

// parseChunk 解析单个JSON数据块
// 音频数据为hex编码的字符串，需要解码为字节
func (t *MinimaxTTS) parseChunk(data string) (AudioChunk, error) {
	var resp minimaxResponse
	if err := json.Unmarshal([]byte(data), &resp); err != nil {
		return AudioChunk{}, fmt.Errorf("failed to unmarshal chunk: %w", err)
	}

	// 空音频数据块，仅表示状态信息
	if resp.Data.Audio == "" {
		return AudioChunk{IsLast: resp.Data.Status == 2}, nil
	}

	// hex解码音频数据
	audioBytes, err := hex.DecodeString(resp.Data.Audio)
	if err != nil {
		return AudioChunk{}, fmt.Errorf("failed to decode audio: %w", err)
	}

	chunk := AudioChunk{
		Data:   audioBytes,
		IsLast: resp.Data.Status == 2, // Status=2表示流结束
	}

	if resp.ExtraInfo != nil {
		chunk.Info = resp.ExtraInfo
	}

	return chunk, nil
}

// Close 关闭TTS连接（MiniMax不需要显式关闭）
func (t *MinimaxTTS) Close() error {
	return nil
}

// GetMinimaxVoices 获取 MiniMax 可用音色列表
func GetMinimaxVoices(apiKey string) ([]MinimaxVoiceInfo, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("api_key is required")
	}

	reqBody := map[string]any{
		"voice_type": "all",
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(context.Background(), "POST",
		"https://api.minimaxi.com/v1/get_voice", bytes.NewReader(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	var result MinimaxVoicesResp
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	var voices []MinimaxVoiceInfo
	voices = append(voices, result.SystemVoice...)
	voices = append(voices, result.VoiceCloning...)
	voices = append(voices, result.VoiceGeneration...)

	return voices, nil
}
