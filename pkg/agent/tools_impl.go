package agent

import (
	"encoding/json"
	"fmt"
)

// WeatherTool 获取天气工具
type WeatherTool struct{}

func (t *WeatherTool) Name() string {
	return "get_weather"
}

func (t *WeatherTool) Description() string {
	return "Get the current weather in a given location"
}

func (t *WeatherTool) Parameters() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"location": {
				"type": "string",
				"description": "The city and state, e.g. San Francisco, CA"
			}
		},
		"required": ["location"]
	}`)
}

func (t *WeatherTool) Execute(args string) string {
	var input struct {
		Location string `json:"location"`
	}
	if err := json.Unmarshal([]byte(args), &input); err != nil {
		return fmt.Sprintf("Error parsing arguments: %v", err)
	}
	return fmt.Sprintf("The weather in %s is sunny and 25°C.", input.Location)
}

// CalculatorTool 计算器工具
type CalculatorTool struct{}

func (t *CalculatorTool) Name() string {
	return "calculator"
}

func (t *CalculatorTool) Description() string {
	return "Perform basic arithmetic operations"
}

func (t *CalculatorTool) Parameters() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"a": {
				"type": "number",
				"description": "First number"
			},
			"b": {
				"type": "number",
				"description": "Second number"
			},
			"operator": {
				"type": "string",
				"enum": ["add", "subtract", "multiply", "divide"],
				"description": "Arithmetic operator"
			}
		},
		"required": ["a", "b", "operator"]
	}`)
}

func (t *CalculatorTool) Execute(args string) string {
	var input struct {
		A        float64 `json:"a"`
		B        float64 `json:"b"`
		Operator string  `json:"operator"`
	}
	if err := json.Unmarshal([]byte(args), &input); err != nil {
		return fmt.Sprintf("Error parsing arguments: %v", err)
	}

	var res float64
	switch input.Operator {
	case "add":
		res = input.A + input.B
	case "subtract":
		res = input.A - input.B
	case "multiply":
		res = input.A * input.B
	case "divide":
		if input.B == 0 {
			return "Error: Division by zero"
		}
		res = input.A / input.B
	default:
		return "Error: Invalid operator"
	}
	return fmt.Sprintf("Result: %f", res)
}
