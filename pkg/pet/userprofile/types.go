package userprofile

import "time"

type UserProfile struct {
	DisplayName     string         `json:"display_name"`
	Role            string         `json:"role"`
	Language        string         `json:"language"`
	Chronotype      string         `json:"chronotype"`
	PersonalityTone string         `json:"personality_tone"`
	AnxietyLevel    int            `json:"anxiety_level"`
	PressureLevel   string         `json:"pressure_level"`
	Extra           map[string]any `json:"extra"`
	UpdatedAt       int64          `json:"updated_at"`
}

type UserState struct {
	CurrentMood     string `json:"current_mood"`
	EnergyLevel     int    `json:"energy_level"`
	EngagementLevel int    `json:"engagement_level"`
	StressTrend     string `json:"stress_trend"`
	LastAnalyzedAt  int64  `json:"last_analyzed_at"`
}

type UserProfileUpdateRequest struct {
	DisplayName     string         `json:"display_name"`
	Role            string         `json:"role"`
	Language        string         `json:"language"`
	Chronotype      string         `json:"chronotype"`
	PersonalityTone string         `json:"personality_tone"`
	AnxietyLevel    int            `json:"anxiety_level"`
	PressureLevel   string         `json:"pressure_level"`
	Extra           map[string]any `json:"extra"`
}

func NewUserProfile() *UserProfile {
	return &UserProfile{
		Extra:     make(map[string]any),
		UpdatedAt: time.Now().Unix(),
	}
}

func NewUserState() *UserState {
	return &UserState{
		EnergyLevel:     50,
		EngagementLevel: 50,
		LastAnalyzedAt:  time.Now().Unix(),
	}
}
