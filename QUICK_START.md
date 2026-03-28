# ClawPet API 快速启动指南

## 🚀 5分钟快速开始

### 步骤1: 环境准备
```bash
# 克隆项目（如果已克隆则跳过）
git clone <repository-url>
cd go-claw

# 安装Go依赖
go mod download
```

### 步骤2: 配置API密钥
```bash
# Linux/macOS
export DEEPSEEK_API_KEY="your-deepseek-api-key"

# Windows (PowerShell)
$env:DEEPSEEK_API_KEY="your-deepseek-api-key"

# Windows (CMD)
set DEEPSEEK_API_KEY=your-deepseek-api-key
```

### 步骤3: 启动服务
```bash
# 方法1: 使用启动脚本（推荐）
./scripts/run.sh

# 方法2: 直接运行
go run main.go
```

### 步骤4: 验证服务
```bash
# 打开新终端，测试健康检查
curl http://localhost:8080/health
```
预期响应：
```json
{"status":"ok","service":"clawpet-api"}
```

## 📋 基础功能测试

### 1. 注册动作
```bash
curl -X POST http://localhost:8080/api/actions/register \
  -H "Content-Type: application/json" \
  -d '{"name":"播放音乐","description":"播放轻松的音乐帮助放松心情"}'
```

### 2. 与桌宠聊天
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"今天心情很好"}'
```

### 3. 查看所有动作
```bash
curl http://localhost:8080/api/actions
```

## 🔧 常用命令

### 服务管理
```bash
# 启动服务
./scripts/run.sh

# 测试API
./scripts/test_api.sh

# 集成测试
./scripts/integration_test.sh
```

### 开发工具
```bash
# 编译项目
go build -o clawpet-api

# 运行测试
go test ./...

# 清理编译文件
go clean
```

## 🐛 故障排除

### 问题1: 服务启动失败
**症状**: `go run main.go` 报错
**解决方案**:
```bash
# 检查Go版本
go version  # 需要 >= 1.25

# 检查依赖
go mod tidy

# 检查端口占用
netstat -an | grep 8080  # Linux/macOS
# 或
lsof -i :8080
```

### 问题2: API密钥错误
**症状**: `API error: 401 Unauthorized`
**解决方案**:
```bash
# 确认环境变量已设置
echo $DEEPSEEK_API_KEY  # Linux/macOS
# 或
echo %DEEPSEEK_API_KEY% # Windows CMD

# 重新设置环境变量
export DEEPSEEK_API_KEY="正确的API密钥"
```

### 问题3: 响应超时
**症状**: `context deadline exceeded`
**解决方案**:
```bash
# 检查网络连接
ping api.deepseek.com

# 检查防火墙设置
# 确保可以访问外部API
```

## 📚 下一步

### 学习API使用
- 查看 [API使用示例](API_EXAMPLES.md) 获取更多代码示例
- 阅读 [API接口文档](docs/API_DOCUMENTATION.md) 了解详细接口说明

### 了解系统架构
- 阅读 [项目架构文档](docs/ARCHITECTURE.md) 理解系统设计
- 查看项目结构了解模块划分

### 扩展开发
- 添加新的动作类型
- 实现自定义状态更新规则
- 集成其他大模型服务

## 💡 小贴士

1. **快速测试**: 使用 `./scripts/test_api.sh` 快速验证所有接口
2. **环境变量**: 创建 `.env` 文件避免每次设置环境变量
3. **日志查看**: 服务启动后查看控制台日志了解运行状态
4. **上下文管理**: 使用 `/api/chat/context` 接口管理对话历史

## 📞 获取帮助

- **文档**: 查看项目中的文档文件
- **示例**: 参考 `API_EXAMPLES.md` 中的代码示例
- **架构**: 了解系统设计请阅读 `ARCHITECTURE.md`
- **API详情**: 所有接口说明在 `API_DOCUMENTATION.md`

---

*开始你的ClawPet开发之旅吧！* 🎉