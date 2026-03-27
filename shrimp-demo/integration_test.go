package main

import (
	"fmt"
	"testing"
	"time"

	"shrimp-demo/service"
	"shrimp-demo/state"
)

func TestCoordinatorIntegration(t *testing.T) {
	// 测试无 LLM 的协调器（简单模式）
	coordinator := service.NewCoordinator(nil)

	// 获取初始状态
	initialStatus := coordinator.GetCurrentStatus()
	fmt.Printf("初始状态: %+v\n", initialStatus)

	// 强制执行一个动作来测试
	err := coordinator.ForceAction("standby", map[string]interface{}{"duration": 5})
	if err != nil {
		t.Fatalf("强制执行动作失败: %v", err)
	}

	fmt.Printf("动作执行成功\n")

	// 获取更新后的状态
	updatedStatus := coordinator.GetCurrentStatus()
	fmt.Printf("更新后状态: %+v\n", updatedStatus)

	// 验证状态有变化（通过比较 JSON 输出）
	initialJSON := fmt.Sprintf("%+v", initialStatus)
	updatedJSON := fmt.Sprintf("%+v", updatedStatus)
	if initialJSON == updatedJSON {
		t.Error("状态应该被更新，但JSON输出没有变化")
	}
}

func TestStateManager(t *testing.T) {
	// 测试状态管理器
	manager := state.DefaultStateManager()

	// 获取所有状态
	states := manager.GetAll()
	fmt.Printf("状态管理器状态数量: %d\n", len(states))

	// 验证核心状态存在
	requiredStates := []string{"mood", "affection", "frustration"}
	for _, stateName := range requiredStates {
		if _, exists := manager.Get(stateName); !exists {
			t.Errorf("缺少必需状态: %s", stateName)
		} else {
			fmt.Printf("状态存在: %s ✓\n", stateName)
		}
	}

	// 测试状态值获取
	moodState, exists := manager.Get("mood")
	if !exists {
		t.Fatal("无法获取 mood 状态")
	}

	initialMood := moodState.Value()
	fmt.Printf("初始 mood 值: %.0f\n", initialMood)

	// 测试状态更新（注意：值会被限制在 min-max 范围内）
	changes := map[string]float64{
		"mood":        75.0,
		"affection":   500.0,
		"frustration": 20.0,
	}

	manager.ApplyChanges(changes)

	// 验证更新（mood 75 应该在有效范围内）
	updatedMoodState, _ := manager.Get("mood")
	updatedMood := updatedMoodState.Value()
	fmt.Printf("更新后 mood 值: %.0f\n", updatedMood)

	// 测试情感映射
	if mood, ok := moodState.(*state.MoodState); ok {
		emotion := mood.GetEmotionText()
		fmt.Printf("当前情感: %s\n", emotion)

		// 验证情感映射
		if updatedMood == 75.0 {
			expectedEmotion := "开心 😊"
			if emotion != expectedEmotion {
				t.Errorf("mood=75 应该映射到 '%s', 得到 '%s'", expectedEmotion, emotion)
			}
		}
	}

	// 测试提示词生成
	prompt := state.BuildStatePrompt(manager)
	fmt.Printf("生成的提示词长度: %d\n", len(prompt))
	if len(prompt) == 0 {
		t.Error("提示词不应该为空")
	} else {
		fmt.Printf("提示词生成成功 ✓\n")
	}
}

func TestActionExecution(t *testing.T) {
	// 测试动作执行
	coordinator := service.NewCoordinator(nil)

	// 强制执行搜索动作
	err := coordinator.ForceAction("search", map[string]interface{}{
		"query":    "测试查询",
		"duration": 3,
	})
	if err != nil {
		t.Fatalf("执行动作失败: %v", err)
	}

	fmt.Printf("搜索动作执行成功\n")

	// 等待动作完成
	time.Sleep(2 * time.Second)

	// 获取状态查看动作状态
	status := coordinator.GetCurrentStatus()
	actionStatus := status["action_status"]
	fmt.Printf("动作状态: %+v\n", actionStatus)
}

func TestEmotionMapping(t *testing.T) {
	// 测试情感映射
	testCases := []struct {
		mood     float64
		expected string
	}{
		{10.0, "非常难过 😭"},
		{30.0, "难过 😔"},
		{50.0, "平静 😐"},
		{70.0, "开心 😊"},
		{90.0, "非常开心 😄"},
	}

	for _, tc := range testCases {
		manager := state.DefaultStateManager()

		// 直接获取状态并设置值
		moodState, exists := manager.Get("mood")
		if !exists {
			t.Fatalf("无法获取 mood 状态")
		}

		// 设置绝对值（而不是增量）
		moodState.SetValue(tc.mood)

		if mood, ok := moodState.(*state.MoodState); ok {
			emotion := mood.GetEmotionText()

			if emotion != tc.expected {
				t.Errorf("mood=%.0f: 期望 '%s', 得到 '%s'", tc.mood, tc.expected, emotion)
			} else {
				fmt.Printf("mood=%.0f -> emotion=%s ✓\n", tc.mood, emotion)
			}
		}
	}
}
