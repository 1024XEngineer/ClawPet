package voice

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/logger"
)

type VolcEngineTTS struct {
	apiBase    string
	apiKey     string
	model      string
	voiceID    string
	secretKey  string
	resourceId string
	httpClient *http.Client
}

func newVolcEngineTTS(apiBase, apiKey, model, voiceID string, extra map[string]any) *VolcEngineTTS {
	if apiBase == "" {
		apiBase = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
	}
	if model == "" {
		model = "seed-tts-2.0-expressive"
	}
	if voiceID == "" {
		voiceID = "BV001_tutorial"
	}

	var secretKey, resourceId string
	if extra != nil {
		if sk, ok := extra["secret_key"].(string); ok {
			secretKey = sk
		}
		if sk, ok := extra["secretAccessKey"].(string); ok {
			secretKey = sk
		}
		if rid, ok := extra["resourceId"].(string); ok {
			resourceId = rid
		}
	}
	if resourceId == "" {
		resourceId = "seed-tts-2.0"
	}

	return &VolcEngineTTS{
		apiBase:    apiBase,
		apiKey:     apiKey,
		model:      model,
		voiceID:    voiceID,
		secretKey:  secretKey,
		resourceId: resourceId,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

func init() {
	RegisterProvider("doubao", func(apiBase, apiKey, model, voiceID string, extra map[string]any) StreamingTTS {
		return newVolcEngineTTS(apiBase, apiKey, model, voiceID, extra)
	})
}

func (t *VolcEngineTTS) Synthesize(text string, params VoiceParams) (<-chan AudioChunk, error) {
	logger.DebugCF("pet-voice", "VolcEngineTTS.Synthesize", map[string]any{
		"text":        text[:min(len(text), 50)],
		"text_len":    len(text),
		"voice_id":    t.voiceID,
		"model":       t.model,
		"resource_id": t.resourceId,
		"api_base":    t.apiBase,
		"speed":       params.Speed,
		"vol":         params.Vol,
	})

	reqBody := map[string]any{
		"user": map[string]any{
			"uid": "",
		},
		"req_params": map[string]any{
			"text":    text,
			"speaker": t.voiceID,
			"model":   t.model,
			"audio_params": map[string]any{
				"format":        "mp3",
				"sample_rate":   32000,
				"speech_rate":   int(params.Speed*100) - 100,
				"loudness_rate": int(params.Vol*100) - 50,
			},
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
	req.Header.Set("X-Api-Key", t.apiKey)
	req.Header.Set("X-Api-Resource-Id", t.resourceId)
	req.Header.Set("X-Api-Request-Id", fmt.Sprintf("%d", time.Now().UnixNano()))

	logger.DebugCF("pet-voice", "V3 request headers", map[string]any{
		"X-Api-Key":         t.apiKey[:min(len(t.apiKey), 10)] + "...",
		"X-Api-Resource-Id": t.resourceId,
	})

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	logger.DebugCF("pet-voice", "V3 response status", map[string]any{
		"status":      resp.StatusCode,
		"status_text": resp.Status,
	})

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		logger.DebugCF("pet-voice", "V3 response body", map[string]any{
			"body": string(body),
		})
		resp.Body.Close()
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	ch := make(chan AudioChunk, 100)
	go t.readStreamV3(resp.Body, ch)
	return ch, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (t *VolcEngineTTS) readStream(body io.Reader, ch chan<- AudioChunk) {
	defer close(ch)

	reader := io.Reader(body)
	buf := make([]byte, 4096)
	partial := ""

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			partial += string(buf[:n])
			lines := strings.Split(partial, "\n")

			if len(lines) == 0 {
				continue
			}

			partial = lines[len(lines)-1]

			for i := 0; i < len(lines)-1; i++ {
				line := strings.TrimSpace(lines[i])
				if line == "" {
					continue
				}

				if !strings.HasPrefix(line, "data:") {
					continue
				}

				data := strings.TrimPrefix(line, "data:")
				data = strings.TrimSpace(data)

				if data == "" || data == "[DONE]" {
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

	logger.DebugCF("pet-voice", "VolcEngineTTS readStream finished", nil)
}

func (t *VolcEngineTTS) readStreamV3(body io.Reader, ch chan<- AudioChunk) {
	defer close(ch)

	reader := io.Reader(body)
	buf := make([]byte, 4096)
	partial := ""

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			partial += string(buf[:n])
			lines := strings.Split(partial, "\n")

			if len(lines) == 0 {
				continue
			}

			partial = lines[len(lines)-1]

			for i := 0; i < len(lines)-1; i++ {
				line := strings.TrimSpace(lines[i])
				if line == "" {
					continue
				}

				chunk, parseErr := t.parseChunkV3(line)
				if parseErr != nil {
					logger.WarnCF("pet-voice", "failed to parse V3 chunk", map[string]any{
						"error": parseErr,
						"data":  line,
					})
					continue
				}

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
			if partial != "" {
				line := strings.TrimSpace(partial)
				if line != "" {
					chunk, parseErr := t.parseChunkV3(line)
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

	logger.DebugCF("pet-voice", "VolcEngineTTS readStreamV3 finished", nil)
}

type volcengineV3Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

func (t *VolcEngineTTS) parseChunkV3(data string) (AudioChunk, error) {
	var resp volcengineV3Response
	if err := json.Unmarshal([]byte(data), &resp); err != nil {
		return AudioChunk{}, fmt.Errorf("failed to unmarshal chunk: %w", err)
	}

	logger.DebugCF("pet-voice", "V3 chunk", map[string]any{
		"code":     resp.Code,
		"message":  resp.Message,
		"data_len": len(resp.Data),
	})

	if resp.Code == 20000000 || resp.Code == 152 {
		return AudioChunk{IsLast: true}, nil
	}

	if resp.Code != 0 {
		return AudioChunk{}, fmt.Errorf("API error (code %d): %s", resp.Code, resp.Message)
	}

	if resp.Data == "" {
		return AudioChunk{IsLast: false}, nil
	}

	audioBytes, err := base64.StdEncoding.DecodeString(resp.Data)
	if err != nil {
		return AudioChunk{}, fmt.Errorf("failed to decode audio: %w", err)
	}

	return AudioChunk{
		Data:   audioBytes,
		IsLast: false,
	}, nil
}

type volcengineResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		Audio string `json:"audio"`
	} `json:"data"`
}

func (t *VolcEngineTTS) parseChunk(data string) (AudioChunk, error) {
	var resp volcengineResponse
	if err := json.Unmarshal([]byte(data), &resp); err != nil {
		return AudioChunk{}, fmt.Errorf("failed to unmarshal chunk: %w", err)
	}

	if resp.Code != 0 && resp.Code != 10007 {
		return AudioChunk{}, fmt.Errorf("API error (code %d): %s", resp.Code, resp.Msg)
	}

	if resp.Data.Audio == "" {
		return AudioChunk{IsLast: true}, nil
	}

	audioBytes, err := base64.StdEncoding.DecodeString(resp.Data.Audio)
	if err != nil {
		return AudioChunk{}, fmt.Errorf("failed to decode audio: %w", err)
	}

	return AudioChunk{
		Data:   audioBytes,
		IsLast: resp.Code == 10007 || resp.Msg == "success",
	}, nil
}

func (t *VolcEngineTTS) Close() error {
	return nil
}

func hashSHA256(data []byte) []byte {
	h := sha256.New()
	h.Write(data)
	return h.Sum(nil)
}

func hexSHA256(data []byte) string {
	return hex.EncodeToString(hashSHA256(data))
}

func getSignedKey(secretKey, date, region, service string) []byte {
	kDate := hmacSHA256([]byte(secretKey), []byte(date))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	kSigning := hmacSHA256(kService, []byte("request"))
	return kSigning
}

// GetVolcEngineVoices 获取豆包可用音色列表（新接口 ListSpeakers）
// accessKeyId: HMAC 签名用的 AccessKeyID
// secretAccessKey: HMAC 签名用的 SecretAccessKey
// model: 模型版本，如 seed-tts-2.0，不传则用默认值
func GetVolcEngineVoices(accessKeyId, secretAccessKey, model string) ([]VolcEngineVoiceInfo, error) {
	if accessKeyId == "" {
		return nil, fmt.Errorf("access_key_id is required")
	}
	if secretAccessKey == "" {
		return nil, fmt.Errorf("secret_access_key is required")
	}

	// 默认使用 seed-tts-2.0
	if model == "" {
		model = "seed-tts-2.0"
	}

	reqBody := map[string]any{
		"ResourceIDs": []string{model},
		"VoiceTypes":  []string{},
		"Page":        1,
		"Limit":       30,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	timestamp := time.Now().UTC().Format("20060102T150405Z")
	date := timestamp[:8]
	serviceName := "speech_saas_prod"
	region := "cn-beijing"
	host := "open.volcengineapi.com"
	path := "/"

	payload := hexSHA256(jsonData)

	signedHeaders := []string{"host", "x-date", "x-content-sha256", "content-type"}
	headerList := []string{
		fmt.Sprintf("host:%s", host),
		fmt.Sprintf("x-date:%s", timestamp),
		fmt.Sprintf("x-content-sha256:%s", payload),
		"content-type:application/json; charset=UTF-8",
	}
	headerString := strings.Join(headerList, "\n")

	queryString := "Action=ListSpeakers&Version=2025-05-20"

	canonicalString := strings.Join([]string{
		"POST",
		path,
		queryString,
		headerString + "\n",
		strings.Join(signedHeaders, ";"),
		payload,
	}, "\n")

	hashedCanonical := hexSHA256([]byte(canonicalString))

	credentialScope := fmt.Sprintf("%s/%s/%s/request", date, region, serviceName)
	signString := strings.Join([]string{
		"HMAC-SHA256",
		timestamp,
		credentialScope,
		hashedCanonical,
	}, "\n")

	signedKey := getSignedKey(secretAccessKey, date, region, serviceName)
	signature := hex.EncodeToString(hmacSHA256(signedKey, []byte(signString)))

	authorization := fmt.Sprintf("HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKeyId, credentialScope, strings.Join(signedHeaders, ";"), signature)

	req, err := http.NewRequestWithContext(context.Background(), "POST",
		fmt.Sprintf("https://%s/?%s", host, queryString), bytes.NewReader(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("X-Date", timestamp)
	req.Header.Set("X-Content-Sha256", payload)
	req.Header.Set("Authorization", authorization)

	logger.DebugCF("pet-voice", "VolcEngine request", map[string]any{
		"url":         req.URL.String(),
		"timestamp":   timestamp,
		"payload":     payload,
		"canonical":   canonicalString,
		"sign_string": signString,
		"signature":   signature,
		"auth":        authorization,
	})

	logger.DebugCF("pet-voice", "VolcEngine request details", map[string]any{
		"host":    host,
		"url":     fmt.Sprintf("https://%s/?%s", host, queryString),
		"method":  "POST",
		"headers": req.Header,
	})

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	logger.DebugCF("pet-voice", "VolcEngine response", map[string]any{
		"status": resp.StatusCode,
		"body":   string(body),
	})

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	var result VolcEngineVoicesResp
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	for i := range result.Result.Speakers {
		v := &result.Result.Speakers[i]
		if len(v.Language) == 0 {
			v.Language = "zh-cn"
		}
		if len(v.Emotion) == 0 {
			v.Emotion = "normal"
		}
	}

	return result.Result.Speakers, nil
}

func sha256Sum(data []byte) string {
	h := sha256.New()
	h.Write(data)
	return fmt.Sprintf("%x", h.Sum(nil))
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}
