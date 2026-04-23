package emotion

import (
	"math"
	"strconv"
	"strings"
)

// =============================================================================
// MBTI维度常量
// =============================================================================

// MBTI四维维度标识符
// 用于标识MBTI性格的四个维度
const (
	MBTIDimensionIE = "ie" // 内向(I)-外向(E)维度
	MBTIDimensionSN = "sn" // 实感(S)-直觉(N)维度
	MBTIDimensionTF = "tf" // 理性(T)-感性(F)维度
	MBTIDimensionJP = "jp" // 判断(J)-感知(P)维度
)

// MBTI字母常量
const (
	MBTILetterI = 'i' // 内向
	MBTILetterE = 'e' // 外向
	MBTILetterS = 's' // 实感
	MBTILetterN = 'n' // 直觉
	MBTILetterT = 't' // 理性
	MBTILetterF = 'f' // 感性
	MBTILetterJ = 'j' // 判断
	MBTILetterP = 'p' // 感知
)

// =============================================================================
// 标签数据结构
// =============================================================================

// MBTITag MBTI漂移标签
// 用于从LLM输出中解析MBTI变化指令
//
// 支持两种格式：
// 1. 漂移格式（原有）：[mbti:ie:+5] 表示内向性增加5点
// 2. 字母标签格式（新）：[mbti:ie:i] 表示本次涉及内向(I)，以1为基数通过非线性阻力算法计算漂移
type MBTITag struct {
	Dimension string // 维度标识符（ie/sn/tf/jp）
	Delta     int    // 变化值（正数表示正向偏移，负数表示负向偏移）

	// 新增：字母标签模式
	IsLabel bool // 是否为字母标签模式
	Label   rune // 字母标签（i/e/s/n/t/f/j/p）
}

// DriftByLabel 根据字母标签漂移MBTI
// 参数：
//   - dimension: MBTI维度（ie/sn/tf/jp）
//   - label: 字母标签（i/e/s/n/t/f/j/p）
//
// 算法：
//  1. 确定目标值：如果字母是 I/S/T/J 则目标为0，如果是 E/N/F/P 则目标为100
//  2. 以1为基数，通过非线性阻力算法计算实际漂移值
//  3. 公式：actualDelta = 1 * (1 - |currentVal - targetVal| / 100)
//     - 距离目标越远，漂移越容易
//     - 距离目标越近，漂移越困难
//  4. 将漂移值加到当前值上
//
// 示例：
//
//   - IE=50（中性），收到 i
//     target=0（内向），距离=50
//     resistance = 1 - 50/100 = 0.5
//     actualDelta = 1 * 0.5 = 0.5
//     新IE = 50 + 0.5 = 50.5
//
//   - IE=70（偏E），收到 i
//     target=0（内向），距离=70
//     resistance = 1 - 70/100 = 0.3
//     actualDelta = 1 * 0.3 = 0.3
//     新IE = 70 + 0.3 = 70.3
func (e *EmotionEngine) DriftByLabel(dimension string, label rune) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// 确定目标值
	var targetVal float64
	switch label {
	case MBTILetterI, MBTILetterS, MBTILetterT, MBTILetterJ:
		targetVal = 0 // I/S/T/J 指向内向/实感/理性/判断
	case MBTILetterE, MBTILetterN, MBTILetterF, MBTILetterP:
		targetVal = 100 // E/N/F/P 指向外向/直觉/感性/感知
	default:
		return
	}

	// 获取当前维度值
	currentVal := e.getPersonalityFloat64(dimension)

	// 计算非线性阻力漂移
	// resistance = 1 - |currentVal - targetVal| / 100
	// actualDelta = 1 * resistance
	distance := math.Abs(currentVal - targetVal)
	resistance := 1.0 - (distance / 100.0)
	if resistance < 0 {
		resistance = 0
	}
	actualDelta := 1.0 * resistance

	// 应用漂移
	newVal := currentVal + actualDelta
	if newVal < 0 {
		newVal = 0
	}
	if newVal > 100 {
		newVal = 100
	}

	// 更新维度值
	e.setPersonalityFloat64(dimension, newVal)
}

// =============================================================================
// MBTI漂移方法
// =============================================================================

// DriftMBTI 对指定维度进行MBTI漂移
// 参数：
//   - dimension: MBTI维度（ie/sn/tf/jp）
//   - delta: 基础变化值（正负均可）
//
// 算法：
//
//	采用非线性阻力公式，距离中心点(50)越远，继续变化的阻力越大
//	公式：actualDelta = baseDelta * (1 - |currentVal - 50| / 50)
//
// 示例：
//
//   - 当前IE=70（偏外向），要增加5点
//     距离中心 = |70-50| = 20
//     阻力 = 1 - 20/50 = 0.6
//     实际变化 = 5 * 0.6 = 3
//     新IE = 70 + 3 = 73
//
//   - 当前IE=30（偏内向），要增加5点
//     距离中心 = |30-50| = 20
//     阻力 = 1 - 20/50 = 0.6
//     实际变化 = 5 * 0.6 = 3
//     新IE = 30 + 3 = 33
//
// 特点：
//   - 越接近极端（0或100），越难继续变化
//   - 模拟人格改变的"惯性"
func (e *EmotionEngine) DriftMBTI(dimension string, delta int) {
	e.mu.Lock()
	defer e.mu.Unlock()

	currentVal := e.getPersonalityFloat64(dimension)
	newVal := calcMBTIDriftFloat(currentVal, float64(delta))
	e.setPersonalityFloat64(dimension, newVal)
}

// calcMBTIDriftFloat 计算MBTI漂移值（内部函数）
// 参数：
//   - currentVal: 当前值（0-100）
//   - baseDelta: 基础变化值
//
// 算法：
//  1. 计算当前值与中心点(50)的距离
//  2. 计算阻力因子：1 - distance/50
//     - 距离中心越近，阻力越小
//     - 距离中心越远，阻力越大
//     - 当已经在极端(0或100)时，阻力为0
//  3. 实际变化 = 基础变化 * 阻力因子
//
// 公式：
//
//	resistance = max(0, 1 - |currentVal - 50| / 50)
//	actualDelta = baseDelta * resistance
//	newVal = clampFloat(currentVal + actualDelta)
func calcMBTIDriftFloat(currentVal, baseDelta float64) float64 {
	const centerValue = 50.0
	const maxValue = 100.0

	distanceFromCenter := math.Abs(currentVal - centerValue)
	resistance := 1.0 - (distanceFromCenter / 50.0)
	if resistance < 0 {
		resistance = 0
	}

	actualDelta := baseDelta * resistance
	newVal := currentVal + actualDelta

	if newVal < 0 {
		return 0
	}
	if newVal > maxValue {
		return maxValue
	}
	return newVal
}

// UpdateMBTIFromTags 批量更新MBTI（从LLM标签）
// 参数：
//   - tags: MBTI标签数组
//
// 支持两种标签格式：
// 1. 漂移格式：[mbti:ie:+5] 表示内向性增加5点
// 2. 字母标签格式：[mbti:ie:i] 表示本次涉及内向(I)，以1为基数通过非线性阻力算法计算漂移
func (e *EmotionEngine) UpdateMBTIFromTags(tags []MBTITag) {
	for _, tag := range tags {
		if tag.IsLabel {
			// 字母标签模式：使用 DriftByLabel
			e.DriftByLabel(tag.Dimension, tag.Label)
		} else {
			// 漂移模式：使用 DriftMBTI
			e.DriftMBTI(tag.Dimension, tag.Delta)
		}
	}
}

// =============================================================================
// 标签解析方法
// =============================================================================

// ParseMBTITag 解析单个MBTI标签
// 参数：
//   - tag: 原始标签字符串，如 "[mbti:ie:+5]" 或 "[mbti:ie:i]"
//
// 返回：
//   - MBTITag: 解析后的标签
//   - bool: 解析是否成功
//
// 解析格式支持两种：
//
//  1. 漂移格式：
//     [mbti:维度:变化值]
//     - 维度: ie/sn/tf/jp（不区分大小写）
//     - 变化值: +N 或 -N（N为整数）
//     示例："[mbti:ie:+5]" → MBTITag{Dimension:"ie", Delta:5, IsLabel:false}
//
//  2. 字母标签格式：
//     [mbti:维度:字母]
//     - 维度: ie/sn/tf/jp（不区分大小写）
//     - 字母: i/e/s/n/t/f/j/p（不区分大小写）
//     示例："[mbti:ie:i]" → MBTITag{Dimension:"ie", Label:'i', IsLabel:true}
func ParseMBTITag(tag string) (MBTITag, bool) {
	tag = strings.TrimSpace(tag)

	// 检查格式：必须是 [mbti:...:...]
	if !strings.HasPrefix(tag, "[mbti:") || !strings.HasSuffix(tag, "]") {
		return MBTITag{}, false
	}

	// 提取内容部分
	content := tag[6 : len(tag)-1] // 去掉 "[mbti:" 和 "]"

	// 按 ":" 分割
	parts := strings.Split(content, ":")
	if len(parts) != 2 {
		return MBTITag{}, false
	}

	// 解析维度（不区分大小写）
	dimension := strings.ToLower(parts[0])
	if dimension != MBTIDimensionIE && dimension != MBTIDimensionSN &&
		dimension != MBTIDimensionTF && dimension != MBTIDimensionJP {
		return MBTITag{}, false
	}

	// 尝试解析字母标签格式（i/e/s/n/t/f/j/p）
	if label := parseMBTILetter(parts[1]); label != 0 {
		return MBTITag{Dimension: dimension, IsLabel: true, Label: label}, true
	}

	// 解析漂移格式（+N 或 -N 或 N）
	delta, err := strconv.Atoi(parts[1])
	if err != nil {
		return MBTITag{}, false
	}

	return MBTITag{Dimension: dimension, Delta: delta, IsLabel: false}, true
}

// parseMBTILetter 解析MBTI字母
// 参数：
//   - s: 字符串，如 "i" 或 "E"
//
// 返回：
//   - rune: 解析出的字母（转为小写），如果不是有效字母返回0
func parseMBTILetter(s string) rune {
	if len(s) != 1 {
		return 0
	}
	lower := strings.ToLower(s)[0]
	switch lower {
	case MBTILetterI, MBTILetterE, MBTILetterS, MBTILetterN,
		MBTILetterT, MBTILetterF, MBTILetterJ, MBTILetterP:
		return rune(lower)
	}
	return 0
}

// ParseMBTITags 从文本中解析所有MBTI标签
// 参数：
//   - text: 包含标签的文本
//
// 返回：
//   - 解析出的所有MBTI标签数组
//
// 查找范围：
//
//	扫描文本中所有匹配 [mbti:...:...] 模式的标签
//
// 示例输入：
//
//	"今天心情好\n[mbti:ie:+5]\n我觉得应该多出去走走\n[mbti:sn:-2]"
//
// 示例输出：
//
//	[
//	  {Dimension:"ie", Delta:5},
//	  {Dimension:"sn", Delta:-2}
//	]
func ParseMBTITags(text string) []MBTITag {
	var tags []MBTITag
	lines := strings.Split(text, "\n")

	// 逐行扫描
	for _, line := range lines {
		// 查找第一个 [mbti: 位置
		idx := strings.Index(line, "[mbti:")
		for idx != -1 {
			// 查找对应的 ]
			endIdx := strings.Index(line[idx:], "]")
			if endIdx != -1 {
				// 提取标签并解析
				tagStr := line[idx : idx+endIdx+1]
				if tag, ok := ParseMBTITag(tagStr); ok {
					tags = append(tags, tag)
				}
				// 查找下一个 [mbti:
				nextIdx := strings.Index(line[idx+endIdx+1:], "[mbti:")
				if nextIdx != -1 {
					idx = idx + endIdx + 1 + nextIdx
				} else {
					break
				}
			} else {
				break
			}
		}
	}

	return tags
}
