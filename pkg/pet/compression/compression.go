package compression

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/pet/memory"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// DefaultWeight 默认权重
// 当 LLM 没有提供有效权重时使用
const DefaultWeight = 50

// CompressionService 压缩服务
// 负责将对话压缩为记忆，以及合并低权重记忆
type CompressionService struct {
	config            *CompressionConfig    // 压缩配置
	provider          providers.LLMProvider // LLM Provider
	modelCfg          *config.ModelConfig   // 模型配置
	memoryStore       *memory.Store         // 记忆存储
	conversationStore *ConversationStore    // 对话存储
	mergeTicker       *time.Ticker          // 低权重合并定时器
	ctx               context.Context
	cancel            context.CancelFunc
}

// NewCompressionService 创建压缩服务实例
// cfg: 压缩配置
// memoryStore: 记忆存储
// conversationStore: 对话存储
func NewCompressionService(
	cfg *CompressionConfig,
	memoryStore *memory.Store,
	conversationStore *ConversationStore,
) *CompressionService {
	ctx, cancel := context.WithCancel(context.Background())
	return &CompressionService{
		config:            cfg,
		memoryStore:       memoryStore,
		conversationStore: conversationStore,
		ctx:               ctx,
		cancel:            cancel,
	}
}

// SetProvider 设置 LLM Provider 和模型配置
// provider: LLM Provider
// modelCfg: 模型配置，包含 API Key 等信息
func (s *CompressionService) SetProvider(provider providers.LLMProvider, modelCfg *config.ModelConfig) {
	s.provider = provider
	s.modelCfg = modelCfg
}

// Start 启动压缩服务
// 启动低权重合并定时器
// 如果压缩被禁用则不启动
func (s *CompressionService) Start() {
	if s.config == nil || !s.config.Enabled {
		logger.Infof("compression: disabled, not starting")
		return
	}

	// 设置合并检查间隔
	interval := time.Duration(s.config.MergeIntervalMinutes) * time.Minute
	if interval <= 0 {
		interval = 5 * time.Minute
	}

	s.mergeTicker = time.NewTicker(interval)
	go s.runMergeChecker()
	logger.Infof("compression: started with interval %v", interval)
}

// Stop 停止压缩服务
func (s *CompressionService) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	if s.mergeTicker != nil {
		s.mergeTicker.Stop()
	}
}

// runMergeChecker 低权重合并检查循环
// 定期执行：
// 1. 软删除旧的已压缩对话
// 2. 合并低权重记忆
func (s *CompressionService) runMergeChecker() {
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-s.mergeTicker.C:
			// 清理旧的已压缩对话
			if s.config.RetainCompressedDays > 0 {
				if err := s.conversationStore.SoftDeleteOld(s.config.RetainCompressedDays); err != nil {
					logger.Warnf("compression: failed to soft delete old conversations: %v", err)
				}
			}

			// 合并低权重记忆
			characters := s.getActiveCharacters()
			for _, charID := range characters {
				if err := s.MergeLowWeight(charID); err != nil {
					logger.Warnf("pet compression: failed to merge low weight memories for %s: %v", charID, err)
				}
			}
		}
	}
}

// getActiveCharacters 获取当前活跃的角色ID列表
// 目前返回空列表，需要外部注入
func (s *CompressionService) getActiveCharacters() []string {
	return []string{}
}

// Compress 压缩对话为记忆
// characterID: 角色ID
// entries: 待压缩的对话列表
// 流程：
// 1. 构建压缩 prompt
// 2. 调用 LLM 压缩
// 3. 解析结果
// 4. 保存记忆到 memoryStore
// 5. 标记对话为已压缩
func (s *CompressionService) Compress(characterID string, entries []*ConversationEntry) error {
	if len(entries) == 0 {
		return nil
	}

	// 构建压缩 prompt 并调用 LLM
	prompt := s.buildCompressionPrompt(entries)
	response, err := s.callLLM(prompt)
	if err != nil {
		return fmt.Errorf("compression failed: %w", err)
	}

	// 解析 LLM 返回结果
	result := s.parseCompressionResult(response)
	if result == nil {
		return fmt.Errorf("failed to parse compression result")
	}

	// 保存压缩后的记忆
	_, err = s.memoryStore.Add(characterID, result.Content, result.MemoryType, result.Weight)
	if err != nil {
		return fmt.Errorf("failed to save compressed memory: %w", err)
	}

	// 标记对话为已压缩（不是删除，保留给用户查看）
	var ids []int64
	for _, e := range entries {
		ids = append(ids, e.ID)
	}
	if err := s.conversationStore.MarkCompressed(ids); err != nil {
		logger.Warnf("compression: failed to mark conversations as compressed: %v", err)
	}

	logger.Infof("pet compression: compressed %d entries into memory for character %s", len(entries), characterID)
	return nil
}

// MergeLowWeight 合并低权重记忆
// 当低权重记忆数量达到阈值时触发
// 使用统计学方法（平均值 - 2*标准差）识别低权重记忆
func (s *CompressionService) MergeLowWeight(characterID string) error {
	memories, err := s.memoryStore.List(characterID)
	if err != nil {
		return err
	}

	// 获取低权重阈值
	threshold := s.config.LowWeightThreshold
	if threshold <= 0 {
		threshold = 10
	}

	// 记忆数量少于阈值，不处理
	if len(memories) < threshold {
		return nil
	}

	// 计算统计数据
	avg, stddev := s.calculateStats(memories)
	// 使用平均值 - 2*标准差 作为低权重阈值
	weightThreshold := avg - 2*stddev

	// 获取低于阈值的记忆
	lowWeightMemories, err := s.memoryStore.ListBelowWeight(characterID, weightThreshold)
	if err != nil {
		return err
	}

	// 低权重记忆数量少于阈值，不处理
	if len(lowWeightMemories) < threshold {
		return nil
	}

	// 构建合并 prompt 并调用 LLM
	prompt := s.buildMergePrompt(lowWeightMemories)
	response, err := s.callLLM(prompt)
	if err != nil {
		return fmt.Errorf("merge failed: %w", err)
	}

	// 解析合并结果
	results := s.parseMultipleCompressionResults(response)
	if len(results) == 0 {
		return nil
	}

	// 删除被合并的低权重记忆
	var idsToDelete []int64
	for _, m := range lowWeightMemories {
		idsToDelete = append(idsToDelete, m.ID)
	}
	s.memoryStore.DeleteByIDs(idsToDelete)

	// 保存合并后的新记忆
	for _, result := range results {
		_, err = s.memoryStore.Add(characterID, result.Content, result.MemoryType, result.Weight)
		if err != nil {
			logger.Warnf("pet compression: failed to add merged memory: %v", err)
		}
	}

	logger.Infof("pet compression: merged %d low weight memories into %d new memories for character %s",
		len(lowWeightMemories), len(results), characterID)
	return nil
}

// buildCompressionPrompt 构建压缩 prompt
// 将对话列表转换为 LLM 可理解的压缩请求
func (s *CompressionService) buildCompressionPrompt(entries []*ConversationEntry) string {
	var sb strings.Builder
	sb.WriteString("你是一个记忆压缩助手。请将以下对话压缩为一条记忆。\n\n对话内容：\n")
	for _, e := range entries {
		role := "用户"
		if e.Role == "pet" {
			role = "宠物"
		}
		sb.WriteString(fmt.Sprintf("%s: %s\n", role, e.Content))
	}
	sb.WriteString(fmt.Sprintf("\n要求：\n"))
	sb.WriteString(fmt.Sprintf("1. 生成简洁的摘要，包含关键信息\n"))
	sb.WriteString(fmt.Sprintf("2. 判断记忆类型：conversation(对话)/preference(偏好)/fact(事实)\n"))
	sb.WriteString(fmt.Sprintf("3. 给出权重(0-100)，根据重要程度：一般50，中间70，重要85+，特别95+\n\n"))
	sb.WriteString(fmt.Sprintf("输出格式（必须严格遵循）：\n"))
	sb.WriteString(fmt.Sprintf("[memory_type:类型-weight:权重-content:摘要]\n"))
	return sb.String()
}

// buildMergePrompt 构建合并 prompt
// 将低权重记忆列表合并为更少但更高质量的记忆
func (s *CompressionService) buildMergePrompt(memories []*memory.Memory) string {
	var sb strings.Builder
	sb.WriteString("以下是一些低权重的记忆碎片，请合并为 1-3 条有价值的记忆。\n\n记忆碎片：\n")
	for _, m := range memories {
		sb.WriteString(fmt.Sprintf("- [%s] weight=%d: %s\n", m.MemoryType, m.Weight, m.Content))
	}
	sb.WriteString(fmt.Sprintf("\n要求：\n"))
	sb.WriteString(fmt.Sprintf("1. 去除重复信息\n"))
	sb.WriteString(fmt.Sprintf("2. 提取共性\n"))
	sb.WriteString(fmt.Sprintf("3. 生成简洁有力的摘要\n"))
	sb.WriteString(fmt.Sprintf("4. 给出新的权重(通常比原权重高)\n\n"))
	sb.WriteString(fmt.Sprintf("输出格式（每条一行）：\n"))
	sb.WriteString(fmt.Sprintf("[memory_type:类型-weight:权重-content:摘要]\n"))
	return sb.String()
}

// callLLM 调用 LLM 进行压缩或合并
// prompt: 输入 prompt
// 返回 LLM 的原始文本响应
func (s *CompressionService) callLLM(prompt string) (string, error) {
	if s.provider == nil {
		return "", fmt.Errorf("no provider configured")
	}

	messages := []providers.Message{
		{Role: "user", Content: prompt},
	}

	// 模型选择优先级：config.Model > modelCfg.Model > provider.GetDefaultModel()
	model := s.modelCfg.Model

	if model == "" {
		model = s.provider.GetDefaultModel()
	}
	if model == "" {
		return "", fmt.Errorf("no model configured")
	}

	logger.Debugf("compression: calling LLM with model %s", model)

	resp, err := s.provider.Chat(context.Background(), messages, nil, model, nil)
	if err != nil {
		return "", err
	}

	if resp == nil || resp.Content == "" {
		return "", fmt.Errorf("empty response from LLM")
	}

	return resp.Content, nil
}

// parseCompressionResult 解析单条压缩结果
// 格式: [memory_type:类型-weight:权重-content:摘要]
// 如果解析失败返回 nil
func (s *CompressionService) parseCompressionResult(content string) *CompressionResult {
	regex := regexp.MustCompile(`\[memory_type:(\w+)-weight:(\d+)-content:([^\]]+)\]`)
	matches := regex.FindStringSubmatch(content)
	if len(matches) < 4 {
		return nil
	}

	weight := DefaultWeight
	fmt.Sscanf(matches[2], "%d", &weight)

	return &CompressionResult{
		MemoryType: matches[1],
		Weight:     weight,
		Content:    strings.TrimSpace(matches[3]),
	}
}

// parseMultipleCompressionResults 解析多条压缩结果
// 用于合并场景，返回多条记忆
func (s *CompressionService) parseMultipleCompressionResults(content string) []*CompressionResult {
	regex := regexp.MustCompile(`\[memory_type:(\w+)-weight:(\d+)-content:([^\]]+)\]`)
	matches := regex.FindAllStringSubmatch(content, -1)

	var results []*CompressionResult
	for _, m := range matches {
		if len(m) < 4 {
			continue
		}
		weight := DefaultWeight
		fmt.Sscanf(m[2], "%d", &weight)
		results = append(results, &CompressionResult{
			MemoryType: m[1],
			Weight:     weight,
			Content:    strings.TrimSpace(m[3]),
		})
	}
	return results
}

// calculateStats 计算记忆权重的统计数据
// 返回平均值和标准差
// 使用样本标准差公式
func (s *CompressionService) calculateStats(memories []*memory.Memory) (avg float64, stddev float64) {
	if len(memories) == 0 {
		return 0, 0
	}

	// 计算平均值
	var sum float64
	for _, m := range memories {
		sum += float64(m.Weight)
	}
	avg = sum / float64(len(memories))

	// 计算标准差
	var varianceSum float64
	for _, m := range memories {
		diff := float64(m.Weight) - avg
		varianceSum += diff * diff
	}
	stddev = math.Sqrt(varianceSum / float64(len(memories)))
	return avg, stddev
}
