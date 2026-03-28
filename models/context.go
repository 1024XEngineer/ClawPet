package models

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatContext struct {
	Messages []Message `json:"messages"`
}

func NewChatContext() *ChatContext {
	return &ChatContext{
		Messages: make([]Message, 0),
	}
}

func (c *ChatContext) AddMessage(role, content string) {
	c.Messages = append(c.Messages, Message{Role: role, Content: content})
}

func (c *ChatContext) GetLastN(n int) []Message {
	if len(c.Messages) <= n {
		return c.Messages
	}
	return c.Messages[len(c.Messages)-n:]
}

func (c *ChatContext) Clear() {
	c.Messages = make([]Message, 0)
}
