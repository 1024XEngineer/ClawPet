# ClawPet API - 智能虚拟桌宠后端

基于PRD文档开发的最简单后端API接口，接入大模型实现虚拟桌宠功能。提供动作注册、智能对话和状态管理服务。

## 📖 文档索引

- **[API接口文档](docs/API_DOCUMENTATION.md)** - 详细的API接口说明和使用示例
- **[项目架构文档](docs/ARCHITECTURE.md)** - 系统架构设计和模块说明
- **[API使用示例](API_EXAMPLES.md)** - 快速上手的代码示例

## 🚀 功能特性

### 核心接口
1. **动作注册接口** (`POST /api/actions/register`)
   - 参数：`name`（动作名）, `description`（动作描述）
   - 返回：生成的简单ID

2. **大模型交互接口** (`POST /api/chat`)
   - 参数：`message`（用户文本）
   - 返回：`response`（大模型回复）, `selected_action`（可选动作或空）, `state`（当前状态）

### 状态管理
- **亲密度** (intimacy): 0-100
- **沮丧程度** (frustration): 0-100  
- **开心程度** (happiness): 0-100
- 双重更新机制：本地规则 + 大模型智能建议

### 上下文记忆
- 记住最近10条对话
- 支持查看和清空上下文
- 结构化响应格式，状态变化建议不显示给用户

## 🛠️ 技术栈
- **Go 1.25.8** - 主要编程语言
- **Gin** - 高性能HTTP Web框架  
- **Zap** - 结构化日志系统
- **DeepSeek API** - 大语言模型服务

## 快速开始

### 1. 环境准备
```bash
# 设置DeepSeek API密钥
export DEEPSEEK_API_KEY="your-api-key-here"

# 可选：设置端口（默认8080）
export PORT="8080"
```

### 2. 启动服务
```bash
go run main.go
```

### 3. API使用示例

#### 注册动作
```bash
curl -X POST http://localhost:8080/api/actions/register \
  -H "Content-Type: application/json" \
  -d '{"name": "播放音乐", "description": "播放轻松的音乐"}'
```

#### 与桌宠聊天
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "今天心情不好"}'
```

#### 查看所有动作
```bash
curl http://localhost:8080/api/actions
```

#### 查看对话上下文
```bash
curl http://localhost:8080/api/chat/context
```

## 🏗️ 项目架构

### 分层架构设计
```
┌─────────────────────────────────────────┐
│            HTTP API Layer               │
│          (handlers/*.go)                │
├─────────────────────────────────────────┤
│          Business Logic Layer           │
│          (services/*.go)                │
├─────────────────────────────────────────┤
│           Data Access Layer             │
│          (storage/*.go)                 │
├─────────────────────────────────────────┤
│           Data Model Layer              │
│           (models/*.go)                 │
└─────────────────────────────────────────┘
```

### 项目结构
```
go-claw/
├── main.go                    # 程序入口，服务启动和路由配置
├── config/                    # 配置管理
│   └── config.go             # 配置结构定义和默认配置
├── handlers/                  # HTTP请求处理器
│   ├── action.go             # 动作注册和管理处理器
│   └── chat.go               # 聊天和上下文管理处理器
├── models/                    # 数据模型定义
│   ├── action.go             # 动作相关模型
│   ├── state.go              # 状态管理模型
│   ├── context.go            # 上下文管理模型
│   └── chat.go               # 聊天相关模型
├── services/                  # 业务逻辑服务
│   ├── deepseek.go           # DeepSeek API集成服务
│   └── state_manager.go      # 状态管理服务
├── storage/                   # 数据存储层
│   └── memory_store.go       # 内存存储实现
├── utils/                     # 工具类
│   └── logger.go             # 日志工具
├── docs/                      # 文档目录
│   ├── API_DOCUMENTATION.md  # API接口文档
│   └── ARCHITECTURE.md       # 项目架构文档
├── scripts/                   # 脚本目录
│   ├── run.sh                # 服务启动脚本
│   ├── integration_test.sh   # 集成测试脚本
│   └── test_api.sh           # API测试脚本
├── .env.example              # 环境变量示例
├── go.mod                    # Go模块定义
├── go.sum                    # 依赖校验文件
├── README.md                 # 项目说明文档
└── API_EXAMPLES.md           # API使用示例
```

## 🔄 状态更新机制

### 1. 本地规则更新（基础）
- **积极词汇**（开心、高兴、喜欢等）：开心度+10，亲密度+5，沮丧度-5
- **消极词汇**（难过、生气、累等）：开心度-10，沮丧度+10，亲密度+3
- **中性词汇**（你好、吃饭、工作等）：亲密度+2
- 所有值保持在0-100范围内

### 2. 大模型智能状态更新（增强）
大模型使用结构化格式返回响应，系统自动提取并应用状态变化：

**大模型响应格式**：
```
text: [温暖贴心的回复内容]
state: [状态变化建议，格式：亲密度±N，沮丧度±N，开心度±N]
action: [可选动作名称]
```

**状态变化提取规则**：
- 支持中文关键词：`亲密度`、`沮丧度`、`开心度`
- 支持英文关键词：`intimacy`、`frustration`、`happiness`
- 支持中文冒号和英文冒号
- 变化值限制在-10到+10之间
- 无效值或超出范围的值会被忽略

**用户看到的回复**：
```json
{
  "response": "我最喜欢和你一起玩啦！如果能让你开心的话，我还会高兴地转圈圈呢～",
  "selected_action": "播放音乐",
  "state": {
    "intimacy": 56,
    "frustration": 16,
    "happiness": 67
  }
}
```

### 3. 更新顺序
1. 先应用本地规则更新（作为基础）
2. 再应用大模型建议的状态变化（作为增强）
3. 最终状态值限制在0-100范围内

## 🩺 健康检查
```bash
curl http://localhost:8080/health
```

## ⚠️ 注意事项
1. **必须设置** `DEEPSEEK_API_KEY` 环境变量
2. **数据持久化**: 所有数据存储在内存中，重启后丢失
3. **上下文限制**: 最多保存10条对话记录
4. **状态范围**: 所有状态值保持在0-100范围内
5. **并发安全**: 支持并发请求处理

## 📈 扩展路线图

### 短期计划
- 添加数据库持久化存储 (MySQL/PostgreSQL)
- 实现用户认证系统 (JWT)
- 添加更多工具调用支持

### 中期计划
- 实现WebSocket实时通信
- 添加前端管理界面
- 支持插件化扩展机制

### 长期愿景
- 构建桌宠开放平台
- 支持多模态交互 (语音、图像)
- 实现个性化学习和记忆

## 📞 支持与反馈

如有问题或建议，请：
1. 查看详细文档：[API接口文档](docs/API_DOCUMENTATION.md)
2. 参考使用示例：[API使用示例](API_EXAMPLES.md)
3. 了解系统设计：[项目架构文档](docs/ARCHITECTURE.md)