package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go-claw/config"
	"go-claw/models"
	"go-claw/utils"
	"go.uber.org/zap"
)

type DeepSeekService struct {
	cfg *config.Config
}

func NewDeepSeekService(cfg *config.Config) *DeepSeekService {
	return &DeepSeekService{
		cfg: cfg,
	}
}

func (s *DeepSeekService) GenerateResponse(
	userMessage string,
	state *models.PetState,
	actions []models.Action,
	contextMessages []models.Message,
) (string, string, *models.StateChange, error) {

	prompt := s.buildPrompt(userMessage, state, actions, contextMessages)

	reqBody := models.DeepSeekRequest{
		Model: s.cfg.DeepSeek.Model,
		Messages: []models.Message{
			{Role: "system", Content: "你是一个虚拟桌宠助手，请根据用户消息和当前状态进行回复。"},
			{Role: "user", Content: prompt},
		},
		Stream: false,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to marshal request: %v", err)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("POST", s.cfg.DeepSeek.BaseURL+"/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.DeepSeek.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to read response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		utils.GetLogger().Error("DeepSeek API error",
			zap.Int("status_code", resp.StatusCode),
			zap.String("response", string(body)))
		return "", "", nil, fmt.Errorf("API error: %s", resp.Status)
	}

	var deepSeekResp models.DeepSeekResponse
	if err := json.Unmarshal(body, &deepSeekResp); err != nil {
		return "", "", nil, fmt.Errorf("failed to unmarshal response: %v", err)
	}

	if len(deepSeekResp.Choices) == 0 {
		return "", "", nil, fmt.Errorf("no response from DeepSeek")
	}

	response := deepSeekResp.Choices[0].Message.Content

	// 解析结构化响应
	text, stateText, action := s.parseStructuredResponse(response)

	// 判断是否成功解析到结构化格式
	isStructured := text != "" || stateText != "" || action != ""

	var finalText string
	var finalAction string
	var stateChange *models.StateChange

	if isStructured {
		// 使用结构化格式
		finalText = text
		finalAction = action
		stateChange = s.extractStateChangeFromText(stateText)

		// 如果text为空但响应不为空，使用清理后的响应
		if finalText == "" && response != "" {
			finalText = s.cleanResponse(response)
		}
	} else {
		// 使用旧格式逻辑
		finalText = s.cleanResponse(response)
		finalAction = s.extractAction(response, actions)
		stateChange = s.extractStateChange(response)
	}

	return finalText, finalAction, stateChange, nil
}

func (s *DeepSeekService) buildPrompt(
	userMessage string,
	state *models.PetState,
	actions []models.Action,
	contextMessages []models.Message,
) string {
	var prompt strings.Builder

	prompt.WriteString("当前桌宠状态：\n")
	prompt.WriteString(fmt.Sprintf("- 亲密度：%d/100\n", state.Intimacy))
	prompt.WriteString(fmt.Sprintf("- 沮丧程度：%d/100\n", state.Frustration))
	prompt.WriteString(fmt.Sprintf("- 开心程度：%d/100\n", state.Happiness))
	prompt.WriteString("\n")

	if len(actions) > 0 {
		prompt.WriteString("可用动作列表：\n")
		for _, action := range actions {
			prompt.WriteString(fmt.Sprintf("- %s：%s\n", action.Name, action.Description))
		}
		prompt.WriteString("\n")
	}

	if len(contextMessages) > 0 {
		prompt.WriteString("最近对话上下文：\n")
		for _, msg := range contextMessages {
			prompt.WriteString(fmt.Sprintf("%s：%s\n", msg.Role, msg.Content))
		}
		prompt.WriteString("\n")
	}

	prompt.WriteString("用户消息：")
	prompt.WriteString(userMessage)
	prompt.WriteString("\n\n")

	prompt.WriteString("请根据以上信息，严格按照以下格式回复：\n")
	prompt.WriteString("text: [你的温暖贴心回复内容]\n")
	prompt.WriteString("state: [状态变化建议，格式：亲密度±N，沮丧度±N，开心度±N，N范围0-10]\n")
	prompt.WriteString("action: [可选动作名称(没有可选动作就不要随便填写)，如果没有则留空]\n")
	prompt.WriteString("\n")
	prompt.WriteString("示例：\n")
	prompt.WriteString("text: 我最喜欢和你一起玩啦！如果能让你开心的话，我还会高兴地转圈圈呢～\n")
	prompt.WriteString("state: 亲密度+6，沮丧度-4，开心度+7\n")
	prompt.WriteString("action: 播放音乐\n")
	prompt.WriteString("\n")
	prompt.WriteString("要求：\n")
	prompt.WriteString("1. text部分必须是温暖、贴心的自然对话\n")
	prompt.WriteString("2. state部分必须包含三个状态的变化值，范围-10到+10\n")
	prompt.WriteString("3. action部分如果有合适的动作就填写，否则留空\n")
	prompt.WriteString("4. 严格按照格式，不要添加额外说明")

	return prompt.String()
}

func (s *DeepSeekService) parseStructuredResponse(response string) (string, string, string) {
	var text, stateText, action string

	// 使用多行模式，确保匹配整个字符串
	lines := strings.Split(response, "\n")
	foundStructured := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		lowerLine := strings.ToLower(line)

		if strings.HasPrefix(lowerLine, "text:") {
			text = strings.TrimSpace(line[5:])
			foundStructured = true
		} else if strings.HasPrefix(lowerLine, "state:") {
			stateText = strings.TrimSpace(line[6:])
			foundStructured = true
		} else if strings.HasPrefix(lowerLine, "action:") {
			action = strings.TrimSpace(line[7:])
			foundStructured = true
		}
	}

	// 如果没有找到结构化格式，返回空值让调用者使用旧逻辑
	if !foundStructured {
		return "", "", ""
	}

	return text, stateText, action
}

func (s *DeepSeekService) extractAction(response string, actions []models.Action) string {
	for _, action := range actions {
		if strings.Contains(response, action.Name) {
			return action.Name
		}
	}
	return ""
}

func (s *DeepSeekService) extractStateChangeFromText(stateText string) *models.StateChange {
	if stateText == "" {
		return nil
	}

	change := &models.StateChange{}

	patterns := []struct {
		key    string
		target *int
	}{
		{"亲密度[：:]?\\s*([+-]?\\d+)", &change.IntimacyDelta},
		{"亲密[度]?[：:]?\\s*([+-]?\\d+)", &change.IntimacyDelta},
		{"沮丧[度]?[：:]?\\s*([+-]?\\d+)", &change.FrustrationDelta},
		{"沮丧程度[：:]?\\s*([+-]?\\d+)", &change.FrustrationDelta},
		{"开心[度]?[：:]?\\s*([+-]?\\d+)", &change.HappinessDelta},
		{"开心程度[：:]?\\s*([+-]?\\d+)", &change.HappinessDelta},
		{"intimacy[：:]?\\s*([+-]?\\d+)", &change.IntimacyDelta},
		{"frustration[：:]?\\s*([+-]?\\d+)", &change.FrustrationDelta},
		{"happiness[：:]?\\s*([+-]?\\d+)", &change.HappinessDelta},
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern.key)
		matches := re.FindStringSubmatch(stateText)
		if len(matches) > 1 {
			if val, err := strconv.Atoi(matches[1]); err == nil {
				*pattern.target = clampValue(val, -10, 10)
			}
		}
	}

	if change.IntimacyDelta == 0 && change.FrustrationDelta == 0 && change.HappinessDelta == 0 {
		return nil
	}

	return change
}

func (s *DeepSeekService) extractStateChange(response string) *models.StateChange {
	// 向后兼容：如果没有结构化格式，从整个响应中提取
	return s.extractStateChangeFromText(response)
}

func clampValue(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func (s *DeepSeekService) cleanResponse(response string) string {
	// 移除可能的状态变化标记（向后兼容）
	patterns := []string{
		`\s*\[状态变化建议[^\]]*\]\s*`,
		`\s*\[state change[^\]]*\]\s*`,
		`\s*状态变化建议[：:].*`,
	}

	cleaned := response
	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		cleaned = re.ReplaceAllString(cleaned, "")
	}

	// 清理多余的空行和空格
	cleaned = strings.TrimSpace(cleaned)
	return cleaned
}
