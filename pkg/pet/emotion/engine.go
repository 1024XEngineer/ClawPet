package emotion

import (
	"math"
	"sync"
	"time"
)

// =============================================================================
// 情绪常量定义
// =============================================================================

// 六大基础情绪标签
// 基于心理学基础情绪理论，每种情绪都有0-100的强度值，50为平静状态
const (
	EmotionJoy      = "joy"      // 快乐：积极正向情绪，表示愉悦、开心的状态
	EmotionAnger    = "anger"    // 愤怒：强烈负面情绪，通常由挫败或受威胁引发
	EmotionSadness  = "sadness"  // 悲伤：负面情绪，表示失落、难过的状态
	EmotionDisgust  = "disgust"  // 厌恶：强烈负面情绪，表示反感、讨厌
	EmotionSurprise = "surprise" // 惊讶：中性偏正向的强烈情绪，表示意外、震惊
	EmotionFear     = "fear"     // 恐惧：强烈负面情绪，表示害怕、担忧
	EmotionNeutral  = "neutral"  // 中性：无明显情绪，保持平静

	// 情绪阈值：当情绪值超过此范围时，视为"强烈情绪"
	// 用于判断是否需要推送到客户端触发特殊表情/动画
	ThresholdHigh = 80 // 高阈值：超过此值表示情绪非常强烈
	ThresholdLow  = 20 // 低阈值：低于此值表示情绪非常低落
	NeutralValue  = 50 // 中性值：情绪的平衡点，远离此值表示情绪明显

	// 衰减速率：每秒向中性回归的比例
	// 实现"时间抚平一切情绪"的生理规律
	// 每秒衰减1%，即情绪值每秒向50靠近1%
	DecayRate = 0.01

	// 波动系数安全区间
	VolatilityMin = 0.0
	VolatilityMax = 3.0

	defaultPushCooldown   = 0 * time.Second
	defaultCouplingFactor = 0.0
	defaultSmoothingAlpha = 1.0

	defaultCriticalEnterHigh = 90
	defaultCriticalEnterLow  = 10
	defaultCriticalExitHigh  = 85
	defaultCriticalExitLow   = 15
	defaultElevatedEnterHigh = ThresholdHigh
	defaultElevatedEnterLow  = ThresholdLow
	defaultElevatedExitHigh  = 75
	defaultElevatedExitLow   = 25
)

type EmotionThresholds struct {
	ElevatedEnterHigh int
	ElevatedEnterLow  int
	ElevatedExitHigh  int
	ElevatedExitLow   int
	CriticalEnterHigh int
	CriticalEnterLow  int
	CriticalExitHigh  int
	CriticalExitLow   int
}

func defaultEmotionThresholds() EmotionThresholds {
	return EmotionThresholds{
		ElevatedEnterHigh: defaultElevatedEnterHigh,
		ElevatedEnterLow:  defaultElevatedEnterLow,
		ElevatedExitHigh:  defaultElevatedExitHigh,
		ElevatedExitLow:   defaultElevatedExitLow,
		CriticalEnterHigh: defaultCriticalEnterHigh,
		CriticalEnterLow:  defaultCriticalEnterLow,
		CriticalExitHigh:  defaultCriticalExitHigh,
		CriticalExitLow:   defaultCriticalExitLow,
	}
}

var emotionCouplingMatrix = map[string]map[string]float64{
	EmotionJoy: {
		EmotionSadness: -0.18,
		EmotionFear:    -0.10,
		EmotionAnger:   -0.08,
	},
	EmotionAnger: {
		EmotionJoy:     -0.10,
		EmotionFear:    0.12,
		EmotionDisgust: 0.10,
	},
	EmotionSadness: {
		EmotionJoy:  -0.16,
		EmotionFear: 0.10,
	},
	EmotionDisgust: {
		EmotionJoy:   -0.08,
		EmotionAnger: 0.08,
	},
	EmotionSurprise: {
		EmotionFear: 0.06,
		EmotionJoy:  0.05,
	},
	EmotionFear: {
		EmotionJoy:   -0.12,
		EmotionAnger: 0.10,
	},
}

// =============================================================================
// 数据结构定义
// =============================================================================

// SixEmotions 六大基础情绪状态
// 每种情绪独立评分(0-100)，50为平静状态
// - 0:   完全负面极端（如极度悲伤）
// - 50:  平静/中性
// - 100: 完全正面极端（如极度快乐）
type SixEmotions struct {
	Joy      int `json:"joy"`      // 快乐
	Anger    int `json:"anger"`    // 愤怒
	Sadness  int `json:"sadness"`  // 悲伤
	Disgust  int `json:"disgust"`  // 厌恶
	Surprise int `json:"surprise"` // 惊讶
	Fear     int `json:"fear"`     // 恐惧
}

// MBTIPersonality MBTI性格四维配置
// 用于长期人格漂移的追踪
// 每个维度0-100，50为中心点
// - IE: 内向(I) <-> 外向(E)，50为中性
// - SN: 实感(S) <-> 直觉(N)，50为中性
// - TF: 理性(T) <-> 感性(F)，50为中性
// - JP: 判断(J) <-> 感知(P)，50为中性
type MBTIPersonality struct {
	IE float64 `json:"ie"` // 内向-外向维度
	SN float64 `json:"sn"` // 实感-直觉维度
	TF float64 `json:"tf"` // 理性-感性维度
	JP float64 `json:"jp"` // 判断-感知维度
}

// EmotionEngine 情绪状态机
// 核心组件，负责：
// 1. 维护六大情绪的实时状态
// 2. MBTI性格四轴的长期漂移
// 3. 情绪衰减计算（稳态回归）
// 4. 阈值检测与推送判断
type EmotionEngine struct {
	personality MBTIPersonality // MBTI性格配置（长期）
	emotions    SixEmotions     // 六大情绪状态（当前）
	volatility  float64         // 情绪波动系数，影响每次变化的幅度（越大变化越剧烈）
	lastUpdate  time.Time       // 最后更新时间，用于计算衰减
	pushLevels  map[string]emotionLevel
	lastPushAt  map[string]time.Time
	lastPushed  map[string]emotionLevel

	thresholds        EmotionThresholds
	pushCooldown      time.Duration
	dynamicVolatility bool
	lastSignalAt      time.Time
	couplingFactor    float64
	smoothingAlpha    float64

	persistPath string       // 持久化路径，保存到哪个目录
	mu          sync.RWMutex // 读写锁，保证并发安全
}

type emotionEntry struct {
	name  string
	score int
}

type emotionLevel string

const (
	emotionLevelNormal   emotionLevel = "normal"
	emotionLevelElevated emotionLevel = "elevated"
	emotionLevelCritical emotionLevel = "critical"
)

const defaultEmotionAnimation = "init.png"

var emotionAnimationKeyMap = map[string]string{
	EmotionJoy:      "happy",
	EmotionAnger:    "shake-head",
	EmotionSadness:  "sad",
	EmotionDisgust:  "shake-head",
	EmotionSurprise: "celebrate",
	EmotionFear:     "stay-out",
}

var emotionLevelAnimationKeyMap = map[emotionLevel]string{
	emotionLevelNormal:   "standby",
	emotionLevelElevated: "standby",
	emotionLevelCritical: "stay-out",
}

// EmotionPush 情绪变化推送数据结构
// 当情绪触发阈值时，推送给客户端
type EmotionPush struct {
	Emotion        string   `json:"emotion"`                   // 情绪标签
	Score          int      `json:"score"`                     // 情绪强度值
	Level          string   `json:"level,omitempty"`           // 情绪等级：normal/elevated/critical
	Animation      string   `json:"animation,omitempty"`       // 首选动画标识
	AnimationHints []string `json:"animation_hints,omitempty"` // 动画回退顺序
	Motion         string   `json:"motion,omitempty"`          // 关联的动作（可选）
	Prompt         string   `json:"prompt,omitempty"`          // 阈值触发时的Prompt，用于注入LLM
}

// =============================================================================
// 构造函数
// =============================================================================

// NewEmotionEngine 创建情绪引擎实例
// 参数：
//   - persistPath: 持久化存储路径，如 "/home/user/picoclaw"
//     如果为空，则不进行持久化存储
//
// 初始状态：
//   - 所有情绪值为50（中性）
//   - MBTI四维都为50（中性）
//   - 波动系数为1.0（默认）
//   - 最后更新为当前时间
func NewEmotionEngine(persistPath string) *EmotionEngine {
	now := time.Now()
	return &EmotionEngine{
		personality: MBTIPersonality{IE: 50.0, SN: 50.0, TF: 50.0, JP: 50.0},
		emotions:    SixEmotions{Joy: NeutralValue, Anger: NeutralValue, Sadness: NeutralValue, Disgust: NeutralValue, Surprise: NeutralValue, Fear: NeutralValue},
		volatility:  1.0,
		lastUpdate:  now,
		pushLevels: map[string]emotionLevel{
			EmotionJoy:      emotionLevelNormal,
			EmotionAnger:    emotionLevelNormal,
			EmotionSadness:  emotionLevelNormal,
			EmotionDisgust:  emotionLevelNormal,
			EmotionSurprise: emotionLevelNormal,
			EmotionFear:     emotionLevelNormal,
		},
		lastPushAt:        make(map[string]time.Time),
		lastPushed:        make(map[string]emotionLevel),
		thresholds:        defaultEmotionThresholds(),
		pushCooldown:      defaultPushCooldown,
		dynamicVolatility: false,
		lastSignalAt:      now,
		couplingFactor:    defaultCouplingFactor,
		smoothingAlpha:    defaultSmoothingAlpha,
		persistPath:       persistPath,
	}
}

// =============================================================================
// Getter方法（读操作）
// =============================================================================

// GetEmotions 获取当前六大情绪状态
// 返回当前情绪的拷贝，保证内部状态不被外部修改
func (e *EmotionEngine) GetEmotions() SixEmotions {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.emotions
}

// GetPersonality 获取当前MBTI性格配置
// 返回拷贝，防止外部修改
func (e *EmotionEngine) GetPersonality() MBTIPersonality {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.personality
}

// SetPersonality 设置MBTI性格配置
// 用于从持久化存储加载时初始化人格
func (e *EmotionEngine) SetPersonality(p MBTIPersonality) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.personality = p
}

func (e *EmotionEngine) getPersonalityFloat64(dimension string) float64 {
	switch dimension {
	case MBTIDimensionIE:
		return e.personality.IE
	case MBTIDimensionSN:
		return e.personality.SN
	case MBTIDimensionTF:
		return e.personality.TF
	case MBTIDimensionJP:
		return e.personality.JP
	default:
		return 50.0
	}
}

func (e *EmotionEngine) setPersonalityFloat64(dimension string, value float64) {
	switch dimension {
	case MBTIDimensionIE:
		e.personality.IE = value
	case MBTIDimensionSN:
		e.personality.SN = value
	case MBTIDimensionTF:
		e.personality.TF = value
	case MBTIDimensionJP:
		e.personality.JP = value
	}
}

// GetVolatility 获取当前波动系数
// 波动系数影响情绪变化的幅度
func (e *EmotionEngine) GetVolatility() float64 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.volatility
}

// SetVolatility 设置波动系数
// 波动系数影响情绪变化的幅度（越大变化越剧烈）
func (e *EmotionEngine) SetVolatility(v float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	switch {
	case math.IsNaN(v), math.IsInf(v, 0):
		e.volatility = 1.0
	case v < VolatilityMin:
		e.volatility = VolatilityMin
	case v > VolatilityMax:
		e.volatility = VolatilityMax
	default:
		e.volatility = v
	}
}

func (e *EmotionEngine) SetPushCooldown(d time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if d < 0 {
		d = 0
	}
	e.pushCooldown = d
}

func (e *EmotionEngine) GetPushCooldown() time.Duration {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.pushCooldown
}

func (e *EmotionEngine) SetThresholds(t EmotionThresholds) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.thresholds = normalizeThresholds(t)
}

func (e *EmotionEngine) GetThresholds() EmotionThresholds {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.thresholds
}

func (e *EmotionEngine) SetDynamicVolatility(enabled bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.dynamicVolatility = enabled
}

func (e *EmotionEngine) SetCouplingFactor(f float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if f < 0 {
		f = 0
	}
	if f > 1 {
		f = 1
	}
	e.couplingFactor = f
}

func (e *EmotionEngine) SetSmoothingAlpha(alpha float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if alpha < 0 {
		alpha = 0
	}
	if alpha > 1 {
		alpha = 1
	}
	e.smoothingAlpha = alpha
}

// GetLastUpdate 获取最后更新时间
// 用于计算衰减
func (e *EmotionEngine) GetLastUpdate() time.Time {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.lastUpdate
}

// =============================================================================
// 情绪设置与更新
// =============================================================================

// SetEmotion 设置单个情绪值
// 参数：
//   - emotion: 情绪标签（joy/anger/sadness/disgust/surprise/fear）
//   - score: 情绪强度值，会被clamp到0-100范围
//
// 注意：
//   - 自动更新lastUpdate为当前时间
//   - 线程安全
func (e *EmotionEngine) SetEmotion(emotion string, score int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastSignalAt = time.Now()
	e.lastUpdate = time.Now()
	e.setEmotionLocked(emotion, score)
}

// UpdateFromLLMTags 从LLM标签批量更新情绪
// 参数：
//   - tags: LLM返回的情绪标签数组
//
// LLM标签格式：[emotion:joy:80]、[emotion:angry:30]等
//
// 逻辑：
//  1. 解析每个标签
//  2. 更新对应情绪值
//  3. 自动更新lastUpdate
func (e *EmotionEngine) UpdateFromLLMTags(tags []EmotionTag) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastSignalAt = time.Now()
	e.lastUpdate = time.Now()

	for _, tag := range tags {
		e.updateEmotionLocked(tag.Emotion, false, tag.Score, 0)
	}
}

// UpdateFromLLMTagsDelta 从LLM标签更新情绪（支持增量格式）
// 参数：
//   - tags: 解析出的情绪标签，支持绝对值和增量值
//
// 增量格式：[emotion:joy:+5] 表示在当前值基础上+5
// 绝对格式：[emotion:joy:75] 表示设置为75
func (e *EmotionEngine) UpdateFromLLMTagsDelta(tags []EmotionTag) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastSignalAt = time.Now()
	e.lastUpdate = time.Now()

	for _, tag := range tags {
		e.updateEmotionLocked(tag.Emotion, tag.IsDelta, tag.Score, tag.Delta)
	}
}

// =============================================================================
// 情绪衰减（稳态回归）
// =============================================================================

// ApplyDecay 应用时间衰减，使情绪逐渐回归平静
// 参数：
//   - elapsed: 逝去的时间
//
// 算法：
//
//	每秒衰减公式：emotion_new = emotion_old + (50 - emotion_old) * DecayRate * volatility
//
// 特点：
//   - 离50越远，回归速度越快（指数衰减）
//   - 波动系数volatility影响衰减速度
//   - 50时完全不变
//
// 示例：
//   - 愤怒值80，经过10秒后：
//     衰减因子 = 0.01 * 10 * 1.0 = 0.1
//     新值 = 80 + (50-80)*0.1 = 77
func (e *EmotionEngine) ApplyDecay(elapsed time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()

	seconds := elapsed.Seconds()
	if seconds <= 0 {
		return
	}

	// 将线性近似改为指数衰减，避免长时间间隔导致过冲
	decayVolatility := e.effectiveDecayVolatilityLocked(seconds)
	decayFactor := 1 - math.Exp(-DecayRate*seconds*decayVolatility)

	// 对每个情绪值应用衰减
	// 公式：new = old + (50 - old) * decayFactor
	// 使用四舍五入减少长期离散化偏差
	e.emotions.Joy = decayEmotionTowardNeutral(e.emotions.Joy, decayFactor)
	e.emotions.Anger = decayEmotionTowardNeutral(e.emotions.Anger, decayFactor)
	e.emotions.Sadness = decayEmotionTowardNeutral(e.emotions.Sadness, decayFactor)
	e.emotions.Disgust = decayEmotionTowardNeutral(e.emotions.Disgust, decayFactor)
	e.emotions.Surprise = decayEmotionTowardNeutral(e.emotions.Surprise, decayFactor)
	e.emotions.Fear = decayEmotionTowardNeutral(e.emotions.Fear, decayFactor)
	e.lastUpdate = time.Now()
}

// =============================================================================
// 情绪状态查询
// =============================================================================

// GetDominantEmotion 获取当前主导情绪
// 返回：
//   - string: 主导情绪标签（偏离50最远的情绪）
//   - int: 该情绪的强度值
//
// 算法：
//
//	找出六大情绪中偏离中性值50最远的情绪
//	- 如果 score >= 50，deviation = score - 50
//	- 如果 score < 50，deviation = 50 - score（视为相反情绪）
//
// 示例：
//   - joy=70, anger=50, others=50 → 返回 ("joy", 70)
//   - joy=30, anger=50, others=50 → 返回 ("joy", 30)，因为 joy=30 视为 sadness，deviation=20
func (e *EmotionEngine) GetDominantEmotion() (string, int) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	dominant := EmotionNeutral
	maxScore := NeutralValue
	maxDeviation := 0

	// 遍历所有情绪，找出偏离中性最远的
	for _, entry := range e.emotionEntriesLocked() {
		score := entry.score
		var deviation int
		if score >= NeutralValue {
			deviation = score - NeutralValue
		} else {
			deviation = NeutralValue - score
		}

		if deviation > maxDeviation {
			maxDeviation = deviation
			dominant = entry.name
			maxScore = score
		}
	}

	return dominant, maxScore
}

// ShouldPush 判断是否应该推送情绪变化
// 返回：
//   - bool: 是否应该推送
//   - EmotionPush: 如果应该推送，包含推送数据
//
// 推送条件：
//   - 任意情绪值 > ThresholdHigh(80)
//   - 或任意情绪值 < ThresholdLow(20)
//
// 这个阈值用于触发客户端的特殊表情/动画效果
func (e *EmotionEngine) ShouldPush() (bool, EmotionPush) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// 检查每个情绪是否进入新的非正常状态
	// 只在状态变化时推送一次，避免同一状态重复刷屏
	var candidate EmotionPush
	found := false
	bestWeight := -1
	bestDeviation := -1
	now := time.Now()
	for _, entry := range e.emotionEntriesLocked() {
		score := entry.score
		prevLevel := e.pushLevels[entry.name]
		if prevLevel == "" {
			prevLevel = emotionLevelNormal
		}
		level := classifyEmotionLevel(score, prevLevel, e.thresholds)
		if shouldEmitTransition(prevLevel, level) && e.canEmitByCooldownLocked(entry.name, level, now) {
			weight := emotionLevelWeight(level)
			deviation := abs(score - NeutralValue)
			if !found || weight > bestWeight || (weight == bestWeight && deviation > bestDeviation) {
				animation, hints := resolveEmotionAnimation(entry.name, level)
				candidate = EmotionPush{
					Emotion:        entry.name,
					Score:          score,
					Level:          string(level),
					Animation:      animation,
					AnimationHints: hints,
					Prompt:         e.getThresholdPrompt(entry.name, score),
				}
				bestWeight = weight
				bestDeviation = deviation
				found = true
			}
		}
		e.pushLevels[entry.name] = level
	}

	if found {
		e.lastPushAt[candidate.Emotion] = now
		e.lastPushed[candidate.Emotion] = emotionLevel(candidate.Level)
		return true, candidate
	}
	return false, EmotionPush{}
}

// =============================================================================
// 辅助方法
// =============================================================================

// getThresholdPrompt 生成阈值触发时的Prompt
// 用于注入LLM，让LLM知道当前处于某种强烈情绪状态
//
// 返回格式：
//   - score > 80: "【当前状态】：非常{情绪描述}"
//   - score < 20: "【当前状态】：很不开心/很平静等
func (e *EmotionEngine) getThresholdPrompt(emotion string, score int) string {
	desc := emotionDescriptionByScore(emotion, score)
	return "【当前状态】：" + desc
}

// emotionDescriptionByScore 根据情绪类型和分数返回中文描述
func emotionDescriptionByScore(emotion string, score int) string {
	idx := emotionScoreToIndex(score)

	switch emotion {
	case EmotionJoy:
		descs := []string{"很不开心", "有点不开心", "有点开心", "很开心"}
		return descs[idx]
	case EmotionAnger:
		descs := []string{"很平静", "有点生气", "比较生气", "非常生气"}
		return descs[idx]
	case EmotionSadness:
		descs := []string{"很平静", "有点难过", "比较难过", "非常难过"}
		return descs[idx]
	case EmotionDisgust:
		descs := []string{"很平静", "有点厌恶", "比较厌恶", "非常厌恶"}
		return descs[idx]
	case EmotionSurprise:
		descs := []string{"很平静", "有点惊讶", "比较惊讶", "非常惊讶"}
		return descs[idx]
	case EmotionFear:
		descs := []string{"很平静", "有点害怕", "比较害怕", "非常害怕"}
		return descs[idx]
	default:
		return "平静"
	}
}

// emotionScoreToIndex 将分数转换为描述索引
// 0=<20, 1=20-50, 2=50-80, 3=>80
func emotionScoreToIndex(score int) int {
	switch {
	case score < 20:
		return 0
	case score < 50:
		return 1
	case score < 80:
		return 2
	default:
		return 3
	}
}

// clamp 将值限制在0-100范围内
// 用于确保情绪值在有效范围内
func clamp(val int) int {
	if val < 0 {
		return 0
	}
	if val > 100 {
		return 100
	}
	return val
}

func (e *EmotionEngine) setEmotionLocked(emotion string, score int) {
	if _, ok := e.getEmotionScoreLocked(emotion); !ok {
		return
	}
	newScore := clamp(score)
	e.setEmotionScoreLocked(emotion, newScore)
}

func (e *EmotionEngine) updateEmotionLocked(emotion string, isDelta bool, score int, delta int) {
	current, ok := e.getEmotionScoreLocked(emotion)
	if !ok {
		return
	}
	updated := e.applyEmotionUpdate(current, isDelta, score, delta)
	e.setEmotionScoreLocked(emotion, updated)
	e.applyEmotionCouplingLocked(emotion, updated-current)
}

func (e *EmotionEngine) applyEmotionUpdate(current int, isDelta bool, score int, delta int) int {
	if isDelta {
		next := float64(current + delta)
		if e.smoothingAlpha < 1 {
			next = float64(current) + float64(delta)*e.smoothingAlpha
		}
		return clamp(int(math.Round(next)))
	}

	next := float64(score)
	if e.smoothingAlpha < 1 {
		next = float64(current) + (float64(score-current) * e.smoothingAlpha)
	}
	return clamp(int(math.Round(next)))
}

func (e *EmotionEngine) getEmotionScoreLocked(emotion string) (int, bool) {
	switch emotion {
	case EmotionJoy:
		return e.emotions.Joy, true
	case EmotionAnger:
		return e.emotions.Anger, true
	case EmotionSadness:
		return e.emotions.Sadness, true
	case EmotionDisgust:
		return e.emotions.Disgust, true
	case EmotionSurprise:
		return e.emotions.Surprise, true
	case EmotionFear:
		return e.emotions.Fear, true
	default:
		return 0, false
	}
}

func (e *EmotionEngine) setEmotionScoreLocked(emotion string, score int) {
	clamped := clamp(score)
	switch emotion {
	case EmotionJoy:
		e.emotions.Joy = clamped
	case EmotionAnger:
		e.emotions.Anger = clamped
	case EmotionSadness:
		e.emotions.Sadness = clamped
	case EmotionDisgust:
		e.emotions.Disgust = clamped
	case EmotionSurprise:
		e.emotions.Surprise = clamped
	case EmotionFear:
		e.emotions.Fear = clamped
	}
}

func (e *EmotionEngine) applyEmotionCouplingLocked(source string, sourceDelta int) {
	if sourceDelta == 0 || e.couplingFactor <= 0 {
		return
	}

	targets, ok := emotionCouplingMatrix[source]
	if !ok {
		return
	}

	d := float64(sourceDelta) * e.couplingFactor
	for target, weight := range targets {
		current, exists := e.getEmotionScoreLocked(target)
		if !exists {
			continue
		}
		adjusted := float64(current) + d*weight
		e.setEmotionScoreLocked(target, int(math.Round(adjusted)))
	}
}

func (e *EmotionEngine) emotionEntriesLocked() []emotionEntry {
	return []emotionEntry{
		{name: EmotionJoy, score: e.emotions.Joy},
		{name: EmotionAnger, score: e.emotions.Anger},
		{name: EmotionSadness, score: e.emotions.Sadness},
		{name: EmotionDisgust, score: e.emotions.Disgust},
		{name: EmotionSurprise, score: e.emotions.Surprise},
		{name: EmotionFear, score: e.emotions.Fear},
	}
}

func classifyEmotionLevel(score int, previous emotionLevel, thresholds EmotionThresholds) emotionLevel {
	if previous == "" {
		previous = emotionLevelNormal
	}

	switch previous {
	case emotionLevelCritical:
		if score > thresholds.CriticalExitHigh || score < thresholds.CriticalExitLow {
			return emotionLevelCritical
		}
		if score > thresholds.ElevatedEnterHigh || score < thresholds.ElevatedEnterLow {
			return emotionLevelElevated
		}
		return emotionLevelNormal
	case emotionLevelElevated:
		if score >= thresholds.CriticalEnterHigh || score <= thresholds.CriticalEnterLow {
			return emotionLevelCritical
		}
		if score > thresholds.ElevatedExitHigh || score < thresholds.ElevatedExitLow {
			return emotionLevelElevated
		}
		return emotionLevelNormal
	default:
		switch {
		case score >= thresholds.CriticalEnterHigh || score <= thresholds.CriticalEnterLow:
			return emotionLevelCritical
		case score > thresholds.ElevatedEnterHigh || score < thresholds.ElevatedEnterLow:
			return emotionLevelElevated
		default:
			return emotionLevelNormal
		}
	}
}

func shouldEmitTransition(previous, next emotionLevel) bool {
	if next == emotionLevelNormal {
		return false
	}
	return emotionLevelWeight(next) > emotionLevelWeight(previous)
}

func (e *EmotionEngine) canEmitByCooldownLocked(emotion string, level emotionLevel, now time.Time) bool {
	if e.pushCooldown <= 0 {
		return true
	}
	lastAt, ok := e.lastPushAt[emotion]
	if !ok {
		return true
	}
	if now.Sub(lastAt) >= e.pushCooldown {
		return true
	}
	lastLevel := e.lastPushed[emotion]
	return emotionLevelWeight(level) > emotionLevelWeight(lastLevel)
}

func emotionLevelWeight(level emotionLevel) int {
	switch level {
	case emotionLevelCritical:
		return 2
	case emotionLevelElevated:
		return 1
	default:
		return 0
	}
}

func decayEmotionTowardNeutral(current int, factor float64) int {
	next := float64(current) + (float64(NeutralValue-current) * factor)
	return clamp(int(math.Round(next)))
}

func (e *EmotionEngine) effectiveDecayVolatilityLocked(_ float64) float64 {
	v := e.volatility
	if !e.dynamicVolatility {
		return v
	}

	deviationRatio := float64(e.maxDeviationLocked()) / float64(NeutralValue)
	v *= 1 + 0.35*deviationRatio

	idleFor := time.Since(e.lastSignalAt)
	if idleFor < 8*time.Second {
		v *= 0.8
	} else if idleFor > 45*time.Second {
		v *= 1.25
	}

	if v < VolatilityMin {
		return VolatilityMin
	}
	if v > VolatilityMax {
		return VolatilityMax
	}
	return v
}

func (e *EmotionEngine) maxDeviationLocked() int {
	maxDeviation := 0
	for _, entry := range e.emotionEntriesLocked() {
		deviation := abs(entry.score - NeutralValue)
		if deviation > maxDeviation {
			maxDeviation = deviation
		}
	}
	return maxDeviation
}

func normalizeThresholds(t EmotionThresholds) EmotionThresholds {
	n := t
	n.ElevatedEnterHigh = clamp(n.ElevatedEnterHigh)
	n.ElevatedEnterLow = clamp(n.ElevatedEnterLow)
	n.ElevatedExitHigh = clamp(n.ElevatedExitHigh)
	n.ElevatedExitLow = clamp(n.ElevatedExitLow)
	n.CriticalEnterHigh = clamp(n.CriticalEnterHigh)
	n.CriticalEnterLow = clamp(n.CriticalEnterLow)
	n.CriticalExitHigh = clamp(n.CriticalExitHigh)
	n.CriticalExitLow = clamp(n.CriticalExitLow)

	if n.ElevatedEnterHigh <= NeutralValue {
		n.ElevatedEnterHigh = defaultElevatedEnterHigh
	}
	if n.ElevatedEnterLow >= NeutralValue {
		n.ElevatedEnterLow = defaultElevatedEnterLow
	}
	if n.ElevatedExitHigh > n.ElevatedEnterHigh {
		n.ElevatedExitHigh = n.ElevatedEnterHigh
	}
	if n.ElevatedExitLow < n.ElevatedEnterLow {
		n.ElevatedExitLow = n.ElevatedEnterLow
	}
	if n.CriticalEnterHigh < n.ElevatedEnterHigh {
		n.CriticalEnterHigh = n.ElevatedEnterHigh
	}
	if n.CriticalEnterLow > n.ElevatedEnterLow {
		n.CriticalEnterLow = n.ElevatedEnterLow
	}
	if n.CriticalExitHigh > n.CriticalEnterHigh {
		n.CriticalExitHigh = n.CriticalEnterHigh
	}
	if n.CriticalExitLow < n.CriticalEnterLow {
		n.CriticalExitLow = n.CriticalEnterLow
	}

	return n
}

func resolveEmotionAnimation(emotion string, level emotionLevel) (string, []string) {
	specific, ok := emotionAnimationKeyMap[emotion]
	if !ok {
		specific = ""
	}

	levelKey, ok := emotionLevelAnimationKeyMap[level]
	if !ok {
		levelKey = ""
	}

	hints := make([]string, 0, 3)
	if specific != "" {
		hints = append(hints, specific)
	}
	if levelKey != "" && levelKey != specific {
		hints = append(hints, levelKey)
	}
	hints = append(hints, defaultEmotionAnimation)

	preferred := defaultEmotionAnimation
	if specific != "" {
		preferred = specific
	} else if levelKey != "" {
		preferred = levelKey
	}

	return preferred, hints
}

// abs 取绝对值
func abs(val int) int {
	if val < 0 {
		return -val
	}
	return val
}

// =============================================================================
// 标签数据结构
// =============================================================================

// EmotionTag LLM返回的情绪标签
// 格式：
//   - 绝对值：[emotion:joy:80] - 设置为80
//   - 增量值：[emotion:joy:+5] - 增加5
//   - 增量值：[emotion:joy:-3] - 减少3
type EmotionTag struct {
	Emotion string // 情绪名称
	Score   int    // 情绪强度（绝对值时使用）
	IsDelta bool   // 是否为增量值
	Delta   int    // 增量值（IsDelta=true时使用）
}
