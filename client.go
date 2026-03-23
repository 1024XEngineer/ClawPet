package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

// 模拟发送给 OpenClaw
func callOpenClaw(action string, detail string) {
	url := "http://localhost:8000/api/agent/action" // 假设 OpenClaw 运行在 8000
	payload, _ := json.Marshal(map[string]string{
		"role":    "ClawPet",
		"command": action,
		"target":  detail,
	})

	// 异步发送，不卡住桌宠动画
	go func() {
		_, err := http.Post(url, "application/json", bytes.NewBuffer(payload))
		if err != nil {
			fmt.Println("OpenClaw 连接失败，请检查后端是否启动")
		}
	}()
}
