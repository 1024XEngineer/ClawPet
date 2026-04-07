package models

type PetState struct {
	Intimacy    int `json:"intimacy"`    // 亲密度 0-100
	Frustration int `json:"frustration"` // 沮丧程度 0-100
	Happiness   int `json:"happiness"`   // 开心程度 0-100
}

func NewDefaultState() *PetState {
	return &PetState{
		Intimacy:    50,
		Frustration: 20,
		Happiness:   60,
	}
}

func (s *PetState) Normalize() {
	s.Intimacy = clamp(s.Intimacy, 0, 100)
	s.Frustration = clamp(s.Frustration, 0, 100)
	s.Happiness = clamp(s.Happiness, 0, 100)
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
