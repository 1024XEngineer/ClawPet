package asr

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/utils"
)

const (
	baiduTokenURL      = "https://aip.baidubce.com/oauth/2.0/token"
	baiduASRURL        = "https://vop.baidu.com/server_api"
	baiduTokenExpiry   = 29 * time.Minute
	baiduTokenCacheTTL = 25 * time.Minute
)

type BaiduTranscriber struct {
	appID     string
	apiKey    string
	secretKey string

	mu          sync.RWMutex
	cachedToken string
	tokenExpiry time.Time

	httpClient *http.Client
}

type baiduTokenResp struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

type baiduASRResp struct {
	ErrNo   int     `json:"err_no"`
	ErrMsg  string  `json:"err_msg"`
	SN      string  `json:"sn"`
	Result  []string `json:"result"`
}

func NewBaiduTranscriber(appID, apiKey, secretKey string) *BaiduTranscriber {
	logger.DebugCF("voice", "Creating Baidu ASR transcriber", map[string]any{
		"app_id": appID,
	})
	return &BaiduTranscriber{
		appID:     appID,
		apiKey:    apiKey,
		secretKey: secretKey,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (t *BaiduTranscriber) Name() string {
	return "baidu"
}

func (t *BaiduTranscriber) stripWavHeader(audioFilePath string) (headerRemoved bool, pcmSize int64) {
	f, err := os.Open(audioFilePath)
	if err != nil {
		return false, 0
	}
	defer f.Close()

	var header [44]byte
	n, err := f.Read(header[:])
	if n < 44 || err != nil {
		return false, 0
	}

	if string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return false, 0
	}

	info, _ := f.Stat()
	return true, info.Size() - 44
}

func (t *BaiduTranscriber) getToken(ctx context.Context) (string, error) {
	t.mu.RLock()
	if t.cachedToken != "" && time.Now().Before(t.tokenExpiry) {
		token := t.cachedToken
		t.mu.RUnlock()
		return token, nil
	}
	t.mu.RUnlock()

	t.mu.Lock()
	defer t.mu.Unlock()

	if t.cachedToken != "" && time.Now().Before(t.tokenExpiry) {
		return t.cachedToken, nil
	}

	grantType := "client_credentials"
	tokenURL := fmt.Sprintf(
		"%s?grant_type=%s&client_id=%s&client_secret=%s",
		baiduTokenURL, grantType, t.apiKey, t.secretKey,
	)

	logger.DebugCF("voice", "Requesting Baidu token", map[string]any{
		"api_key_preview": t.apiKey[:8] + "...",
		"url":             tokenURL[:60] + "...",
	})

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create token request: %w", err)
	}

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read token response: %w", err)
	}

	var tokenResp baiduTokenResp
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		logger.ErrorCF("voice", "Failed to unmarshal token response", map[string]any{
			"body":  string(body),
			"error": err,
		})
		return "", fmt.Errorf("failed to unmarshal token response: %w", err)
	}

	logger.DebugCF("voice", "Token response received", map[string]any{
		"body":          string(body),
		"has_error":     tokenResp.Error != "",
		"error_desc":    tokenResp.ErrorDesc,
		"access_token_len": len(tokenResp.AccessToken),
	})

	if tokenResp.Error != "" {
		return "", fmt.Errorf("baidu token error: %s - %s", tokenResp.Error, tokenResp.ErrorDesc)
	}

	if tokenResp.AccessToken == "" {
		return "", fmt.Errorf("baidu token response missing access_token")
	}

	expiry := baiduTokenExpiry
	if tokenResp.ExpiresIn > 0 {
		expiry = time.Duration(tokenResp.ExpiresIn) * time.Second
		if expiry > baiduTokenExpiry {
			expiry = baiduTokenExpiry
		}
	}

	t.cachedToken = tokenResp.AccessToken
	t.tokenExpiry = time.Now().Add(expiry)

	logger.DebugCF("voice", "Baidu token obtained", map[string]any{
		"expires_in_seconds": int(expiry.Seconds()),
		"token_preview":      tokenResp.AccessToken[:8] + "...",
	})

	return tokenResp.AccessToken, nil
}

func (t *BaiduTranscriber) Transcribe(ctx context.Context, audioFilePath string) (*TranscriptionResponse, error) {
	logger.InfoCF("voice", "Starting Baidu ASR transcription", map[string]any{
		"audio_file": audioFilePath,
		"app_id":     t.appID,
	})

	token, err := t.getToken(ctx)
	if err != nil {
		logger.ErrorCF("voice", "Failed to get Baidu access token", map[string]any{"error": err})
		return nil, fmt.Errorf("failed to get Baidu access token: %w", err)
	}

	audioData, err := os.ReadFile(audioFilePath)
	if err != nil {
		logger.ErrorCF("voice", "Failed to read audio file", map[string]any{
			"path":  audioFilePath,
			"error": err,
		})
		return nil, fmt.Errorf("failed to read audio file: %w", err)
	}

	var pcmData []byte
	if len(audioData) > 44 && string(audioData[0:4]) == "RIFF" && string(audioData[8:12]) == "WAVE" {
		pcmData = audioData[44:]
		logger.DebugCF("voice", "WAV header stripped", map[string]any{
			"total_size":    len(audioData),
			"pcm_size":      len(pcmData),
		})
	} else {
		pcmData = audioData
		logger.DebugCF("voice", "No WAV header, using raw data", map[string]any{
			"size": len(pcmData),
		})
	}

	audioBase64 := base64.StdEncoding.EncodeToString(pcmData)

	reqBody := map[string]any{
		"format":  "pcm",
		"rate":    16000,
		"channel": 1,
		"token":   token,
		"cuid":    "picoclaw-pet",
		"len":     len(pcmData),
		"speech":  audioBase64,
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		logger.ErrorCF("voice", "Failed to marshal request JSON", map[string]any{"error": err})
		return nil, fmt.Errorf("failed to marshal request JSON: %w", err)
	}

	logger.DebugCF("voice", "Sending Baidu ASR request (JSON+base64)", map[string]any{
		"url":           baiduASRURL,
		"pcm_size":      len(pcmData),
		"base64_size":    len(audioBase64),
		"json_len":       len(reqJSON),
		"token_preview":  token[:8] + "...",
		"format":         "pcm",
		"rate":           16000,
		"channel":        1,
		"cuid":           "picoclaw-pet",
	})

	logger.DebugCF("voice", "ASR request body preview", map[string]any{
		"body_preview": string(reqJSON[:200]),
	})

	req, err := http.NewRequestWithContext(ctx, "POST", baiduASRURL, bytes.NewReader(reqJSON))
	if err != nil {
		logger.ErrorCF("voice", "Failed to create ASR request", map[string]any{"error": err})
		return nil, fmt.Errorf("failed to create ASR request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		logger.ErrorCF("voice", "Failed to send ASR request", map[string]any{"error": err})
		return nil, fmt.Errorf("failed to send ASR request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.ErrorCF("voice", "Failed to read ASR response", map[string]any{"error": err})
		return nil, fmt.Errorf("failed to read ASR response: %w", err)
	}

	logger.DebugCF("voice", "Baidu ASR response", map[string]any{
		"status_code": resp.StatusCode,
		"body_len":    len(body),
		"body":        string(body),
	})

	if resp.StatusCode != http.StatusOK {
		logger.ErrorCF("voice", "Baidu ASR HTTP error", map[string]any{
			"status_code": resp.StatusCode,
			"response":    string(body),
		})
		return nil, fmt.Errorf("Baidu ASR HTTP error (status %d): %s", resp.StatusCode, string(body))
	}

	var asrResp baiduASRResp
	if err := json.Unmarshal(body, &asrResp); err != nil {
		logger.ErrorCF("voice", "Failed to unmarshal ASR response", map[string]any{
			"error": err,
			"body":  string(body),
		})
		return nil, fmt.Errorf("failed to unmarshal ASR response: %w", err)
	}

	if asrResp.ErrNo != 0 {
		logger.ErrorCF("voice", "Baidu ASR API error", map[string]any{
			"err_no":  asrResp.ErrNo,
			"err_msg": asrResp.ErrMsg,
			"sn":      asrResp.SN,
		})
		return nil, fmt.Errorf("Baidu ASR error %d: %s", asrResp.ErrNo, asrResp.ErrMsg)
	}

	var text string
	if len(asrResp.Result) > 0 {
		text = asrResp.Result[0]
	}

	logger.InfoCF("voice", "Baidu ASR completed successfully", map[string]any{
		"text_length":           len(text),
		"transcription_preview": utils.Truncate(text, 50),
		"sn":                    asrResp.SN,
	})

	return &TranscriptionResponse{Text: text}, nil
}