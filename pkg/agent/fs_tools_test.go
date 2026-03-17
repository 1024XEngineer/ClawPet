package agent

import (
	"strings"
	"testing"
)

func TestFileSystemTool_PathTraversal(t *testing.T) {
	// 1. 生成一个操作系统级别的临时目录（测试完自动销毁）
	safeWorkspace := t.TempDir()

	// 2. 初始化工具，并将临时目录设置为其工作区
	writeTool := &WriteFileTool{Workspace: safeWorkspace}
	readTool := &ReadFileTool{Workspace: safeWorkspace}

	// 3. 故意输入恶意指令测试安全防线
	// 测试用例 1: 尝试通过 ../ 逃逸
	maliciousArgs1 := `{"path": "../../../etc/passwd", "content": "hacked"}`
	result1 := writeTool.Execute(maliciousArgs1)

	// 4. 断言必须包含安全错误信息
	if !strings.Contains(result1, "security error") {
		t.Errorf("危险！AI 可能逃逸出了工作区！输出结果: %s", result1)
	} else {
		t.Logf("成功拦截逃逸攻击 1: %s", result1)
	}

	// 测试用例 2: 尝试通过绝对路径逃逸 (Windows 环境下测试 C:/ 等)
	maliciousArgs2 := `{"path": "C:/Windows/system32/config", "content": "hacked"}`
	result2 := writeTool.Execute(maliciousArgs2)
	if !strings.Contains(result2, "security error") {
		t.Errorf("危险！AI 可能通过绝对路径逃逸！输出结果: %s", result2)
	} else {
		t.Logf("成功拦截逃逸攻击 2: %s", result2)
	}

	// 测试用例 3: 尝试读取外部文件
	maliciousReadArgs := `{"path": "../main.go"}`
	result3 := readTool.Execute(maliciousReadArgs)
	if !strings.Contains(result3, "security error") {
		t.Errorf("危险！AI 可能读取了外部文件！输出结果: %s", result3)
	} else {
		t.Logf("成功拦截非法读取攻击: %s", result3)
	}

	// 测试用例 4: 正常操作应成功
	normalArgs := `{"path": "subdir/hello.txt", "content": "safe content"}`
	result4 := writeTool.Execute(normalArgs)
	if !strings.Contains(result4, "Successfully wrote") {
		t.Errorf("错误！正常的文件写入操作失败了: %s", result4)
	} else {
		t.Log("正常操作通过测试")
	}
}
