package characters

import (
	"github.com/sipeed/picoclaw/pkg/pet/emotion"
)

// Character 角色实体
// 代表一个独立的桌宠角色，拥有自己的情绪、性格和记忆
type Character struct {
	ID          string // 角色唯一标识
	Name        string // 角色名称
	Persona     string // 性格描述
	PersonaType string // 性格类型（如gentle/playful）
	SpeechTone  string // 说话风格
	Catchphrase string // 口头禅
	Hobbies     string // 兴趣爱好
	Background  string // 背景设定
	Preferences string // 偏好
	Avatar      string // 头像/模型ID

	EmotionEngine *emotion.EmotionEngine // 角色专属的情绪引擎
}

// NewCharacter 创建新角色实例
// 所有新建角色都有默认的中性情绪和MBTI配置
func NewCharacter(id, name, persona, personaType, speechTone, catchphrase, hobbies, background, preferences, avatar string) *Character {
	return &Character{
		ID:            id,
		Name:          name,
		Persona:       persona,
		PersonaType:   personaType,
		SpeechTone:    speechTone,
		Catchphrase:   catchphrase,
		Hobbies:       hobbies,
		Background:    background,
		Preferences:   preferences,
		Avatar:        avatar,
		EmotionEngine: emotion.NewEmotionEngine(""),
	}
}

// GetEmotionEngine 获取角色的情绪引擎
func (c *Character) GetEmotionEngine() *emotion.EmotionEngine {
	return c.EmotionEngine
}

// SetEmotions 设置角色的六维情绪值
func (c *Character) SetEmotions(e emotion.SixEmotions) {
	c.EmotionEngine.SetEmotion(emotion.EmotionJoy, e.Joy)
	c.EmotionEngine.SetEmotion(emotion.EmotionAnger, e.Anger)
	c.EmotionEngine.SetEmotion(emotion.EmotionSadness, e.Sadness)
	c.EmotionEngine.SetEmotion(emotion.EmotionDisgust, e.Disgust)
	c.EmotionEngine.SetEmotion(emotion.EmotionSurprise, e.Surprise)
	c.EmotionEngine.SetEmotion(emotion.EmotionFear, e.Fear)
}

// GetEmotions 获取角色的当前六维情绪值
func (c *Character) GetEmotions() emotion.SixEmotions {
	return c.EmotionEngine.GetEmotions()
}

// Clone 创建角色的深拷贝
// 情绪状态也会被复制一份
func (c *Character) Clone() *Character {
	clone := &Character{
		ID:            c.ID,
		Name:          c.Name,
		Persona:       c.Persona,
		PersonaType:   c.PersonaType,
		SpeechTone:    c.SpeechTone,
		Catchphrase:   c.Catchphrase,
		Hobbies:       c.Hobbies,
		Background:    c.Background,
		Preferences:   c.Preferences,
		Avatar:        c.Avatar,
		EmotionEngine: emotion.NewEmotionEngine(""),
	}
	clone.SetEmotions(c.GetEmotions())
	return clone
}
