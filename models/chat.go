package models

type ChatRequest struct {
	Message string `json:"message" binding:"required"`
}

type ChatResponse struct {
	Response       string    `json:"response"`
	SelectedAction string    `json:"selected_action,omitempty"`
	State          *PetState `json:"state"`
}

type StateChange struct {
	IntimacyDelta    int `json:"intimacy_delta"`
	FrustrationDelta int `json:"frustration_delta"`
	HappinessDelta   int `json:"happiness_delta"`
}

type DeepSeekRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Stream   bool      `json:"stream"`
}

type DeepSeekResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}
