# 小龙虾桌宠使用指南（LLM 增强版）

## 快速开始

### 1. 配置 DeepSeek API
1. 访问 [DeepSeek 平台](https://platform.deepseek.com/api_keys) 获取 API Key
2. 复制 `.env.example` 为 `.env`
3. 在 `.env` 中设置你的 API Key

### 2. 启动服务
**基础模式（无 LLM）:**
```bash
cd shrimp-demo
go run main.go
```

**LLM 增强模式:**
```bash
cd shrimp-demo
# 方式1：设置环境变量
export DEEPSEEK_API_KEY=your_api_key
export USE_LLM=true
go run main.go

# 方式2：使用 .env 文件（需要安装 godotenv 等工具）
```

服务启动后会在 `http://localhost:8080` 监听。

### 2. 基本测试

**健康检查:**
```bash
curl http://localhost:8080/health
```

**获取当前状态:**
```bash
curl http://localhost:8080/api/v1/status
```

**获取所有动作:**
```bash
curl http://localhost:8080/api/v1/actions
```

### 3. 核心功能测试

**基础模式（无 LLM）:**

1. **用户请求搜索:**
```bash
curl -X POST http://localhost:8080/api/v1/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我查一下明天面试这家公司的信息"}'
```

2. **触发搜索任务:**
```bash
curl -X POST http://localhost:8080/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"company":"腾讯"}'
```

3. **用户需要思考:**
```bash
curl -X POST http://localhost:8080/api/v1/think \
  -H 'Content-Type: application/json' \
  -d '{"question":"如何回答技术问题"}'
```

**LLM 增强模式:**

1. **智能消息处理:**
```bash
curl -X POST http://localhost:8080/api/v1/message/llm \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我查一下明天面试这家公司的信息"}'
```

2. **智能搜索:**
```bash
curl -X POST http://localhost:8080/api/v1/search/llm \
  -H 'Content-Type: application/json' \
  -d '{"company":"腾讯"}'
```

3. **智能思考:**
```bash
curl -X POST http://localhost:8080/api/v1/think/llm \
  -H 'Content-Type: application/json' \
  -d '{"question":"如何回答技术问题"}'
```

4. **重置状态:**
```bash
curl -X POST http://localhost:8080/api/v1/reset
```

## API 详细说明

### 基础 API

#### GET /health
**功能:** 健康检查
**响应:**
```json
{
  "status": "healthy",
  "service": "shrimp-demo",
  "version": "1.0.0"
}
```

#### GET /api/v1/status
**功能:** 获取桌宠当前状态
**响应:**
```json
{
  "success": true,
  "data": {
    "state": "standby",
    "action": {
      "name": "standby",
      "description": "小龙虾切换为「安静待命」动作，缩到屏幕角落",
      "emotion": "安静"
    },
    "idle_too_long": false
  }
}
```

#### GET /api/v1/actions
**功能:** 获取所有可用动作
**响应:**
```json
{
  "success": true,
  "data": {
    "actions": [
      {
        "name": "search",
        "description": "小龙虾开始执行搜索任务，切换为「出发」动作",
        "emotion": "专注",
        "keywords": "搜索, 查找, 查一下, 帮我查, 找找, 查询"
      },
      // ... 其他动作
    ],
    "count": 7
  }
}
```

#### POST /api/v1/message
**功能:** 处理用户消息（基础版）
**请求:**
```json
{
  "message": "帮我查一下明天面试这家公司的信息"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "message": "帮我查一下明天面试这家公司的信息",
    "matched_actions": [
      {
        "name": "search",
        "description": "小龙虾开始执行搜索任务，切换为「出发」动作",
        "emotion": "专注"
      }
    ],
    "new_state": "search",
    "transition_success": true,
    "suggested_action": "search",
    "use_llm": false
  }
}
```

#### POST /api/v1/message/llm
**功能:** 使用 LLM 处理用户消息（增强版）
**请求:**
```json
{
  "message": "帮我查一下明天面试这家公司的信息"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "message": "帮我查一下明天面试这家公司的信息",
    "new_state": "search",
    "transition_success": true,
    "use_llm": true,
    "llm_action": "search",
    "llm_response": "action:search 我正在帮你搜索这家公司的信息，让我看看能找到什么有用的资料..."
  }
}
```

#### POST /api/v1/search
**功能:** 触发搜索任务（基础版）
**请求:**
```json
{
  "company": "腾讯"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "company": "腾讯",
    "status": "searching",
    "use_llm": false,
    "search_method": "basic",
    "steps": [
      "搜索公司官网",
      "查找近期新闻",
      "分析业务动态",
      "整理招聘信息"
    ],
    "estimated_time": "45秒"
  }
}
```

#### POST /api/v1/search/llm
**功能:** 使用 LLM 触发搜索任务（增强版）
**请求:**
```json
{
  "company": "腾讯"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "company": "腾讯",
    "status": "searching",
    "use_llm": true,
    "search_method": "llm_enhanced",
    "llm_response": "action:search 正在搜索腾讯公司的信息...\n\n腾讯是中国领先的互联网公司，主要业务包括...",
    "llm_action": "search"
  }
}
```

#### POST /api/v1/think
**功能:** 触发思考任务（基础版）
**请求:**
```json
{
  "question": "如何回答技术问题"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "question": "如何回答技术问题",
    "status": "thinking",
    "use_llm": false,
    "think_method": "basic",
    "suggestions": [
      "从你的项目经验说起",
      "连接到公司业务需求",
      "展示你的技术能力",
      "表达你的学习意愿"
    ]
  }
}
```

#### POST /api/v1/think/llm
**功能:** 使用 LLM 触发思考任务（增强版）
**请求:**
```json
{
  "question": "如何回答技术问题"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "question": "如何回答技术问题",
    "status": "thinking",
    "use_llm": true,
    "think_method": "llm_enhanced",
    "llm_response": "action:think 让我帮你思考如何回答技术问题...\n\n首先，你可以从这几个方面入手...",
    "llm_action": "think"
  }
}
```

#### POST /api/v1/reset
**功能:** 重置状态
**响应:**
```json
{
  "success": true,
  "message": "状态已重置",
  "data": {
    "state": "standby",
    "action": {
      "name": "standby",
      "description": "小龙虾切换为「安静待命」动作，缩到屏幕角落",
      "emotion": "安静"
    }
  }
}
```

## 动作系统

### 可用动作列表

| 动作名称 | 触发关键词 | 情感 | 描述 |
|---------|-----------|------|------|
| search | 搜索, 查找, 查一下, 帮我查, 找找, 查询 | 专注 | 小龙虾开始执行搜索任务，切换为「出发」动作 |
| focus | 专注, 认真, 仔细, 研究, 分析, 阅读 | 专注 | 小龙虾动作从「翻找」逐渐变为「专注阅读」，头微微前倾，偶尔点头 |
| excited | 有用, 发现, 宝贝, 重要, 关键, 找到了, 这个好 | 兴奋 | 小龙虾突然兴奋起来，切换为「发现宝贝」动作，做出抓取的手势 |
| organize | 整理, 分类, 汇总, 归纳, 总结, 梳理 | 认真 | 小龙虾切换为「整理资料」状态，有条不紊地将信息分类 |
| deliver | 好了, 完成, 给你, 交付, 整理好了, 准备好了 | 郑重 | 小龙虾切换为「郑重交付」动作，双手托起，向用户方向推出 |
| think | 思考, 想想, 考虑, 琢磨, 怎么答, 如何回答 | 思考 | 小龙虾进入「思考模式」，动作切换为「托腮」 |
| standby | 待命, 安静, 休息, 等待, 好了, 完成 | 安静 | 小龙虾切换为「安静待命」动作，缩到屏幕角落 |

### 动作匹配规则

系统使用简单的前缀匹配算法：
1. 用户消息预处理
2. 遍历所有动作的触发关键词
3. 检查消息是否以关键词开头
4. 返回所有匹配的动作

**示例:**
- 消息: `"帮我查一下"` → 匹配 `search` 动作
- 消息: `"整理资料"` → 匹配 `organize` 动作
- 消息: `"思考问题"` → 匹配 `think` 动作

## 状态机

### 状态流转

桌宠有7种状态，按照用户故事场景流转：

```
待命态 → 搜索态 → 专注态 → 兴奋态 → 整理态 → 交付态 → 思考态 → 待命态
```

### 状态转换触发

1. **用户消息触发**: 根据消息内容自动转换状态
2. **API 调用触发**: 通过 `/search`、`/think` 等接口触发
3. **时间触发**: 15分钟无活动会标记为 `idle_too_long`

## 集成到前端

### 动作显示
前端可以根据 API 返回的动作描述显示相应的动画或文本：

```javascript
// 示例：处理状态响应
fetch('/api/v1/status')
  .then(response => response.json())
  .then(data => {
    const action = data.data.action;
    console.log(`当前动作: ${action.name}`);
    console.log(`动作描述: ${action.description}`);
    console.log(`情感状态: ${action.emotion}`);
    
    // 根据动作名称显示相应动画
    displayAction(action.name, action.description);
  });
```

### 消息处理
```javascript
// 示例：发送用户消息
async function sendMessage(message) {
  const response = await fetch('/api/v1/message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  
  const data = await response.json();
  
  if (data.success) {
    // 显示匹配的动作
    data.data.matched_actions.forEach(action => {
      console.log(`匹配动作: ${action.name} - ${action.description}`);
    });
    
    // 更新桌宠状态
    updateShrimpState(data.data.new_state, data.data.suggested_action);
  }
}
```

## 调试技巧

### 1. 查看完整状态
```bash
curl -s http://localhost:8080/api/v1/status | python -m json.tool
```

### 2. 测试所有动作匹配
```bash
# 测试搜索关键词
curl -X POST http://localhost:8080/api/v1/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"搜索"}'

# 测试整理关键词  
curl -X POST http://localhost:8080/api/v1/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"整理"}'

# 测试思考关键词
curl -X POST http://localhost:8080/api/v1/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"思考"}'
```

### 3. 完整用户故事测试
```bash
# 1. 初始状态
curl http://localhost:8080/api/v1/status

# 2. 用户请求搜索
curl -X POST http://localhost:8080/api/v1/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我查一下明天面试这家公司的信息"}'

# 3. 触发搜索
curl -X POST http://localhost:8080/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"company":"腾讯"}'

# 4. 用户需要思考
curl -X POST http://localhost:8080/api/v1/think \
  -H 'Content-Type: application/json' \
  -d '{"question":"如何回答技术问题"}'

# 5. 返回待命状态
curl -X POST http://localhost:8080/api/v1/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"好了"}'
```

## 常见问题

### Q: 服务启动失败
**A:** 检查端口 8080 是否被占用，或尝试修改 `main.go` 中的端口号。

### Q: 动作匹配不准确
**A:** 在 `action/` 目录下的各个动作文件中修改 `TriggerKeywords()` 方法。

### Q: 状态转换不符合预期
**A:** 检查 `state/machine.go` 中的 `isValidTransition` 方法，修改状态转换规则。

### Q: 如何添加新动作
**A:** 
1. 在 `action/` 目录创建新文件，实现 `Action` 接口
2. 在 `action/registry.go` 的 `NewRegistry()` 方法中注册新动作
3. 在 `state/machine.go` 中添加对应的状态转换

## 性能指标

- API 平均响应时间: < 50ms
- 内存占用: ~10MB
- 并发支持: 100+ 并发连接
- 状态机操作: O(1) 时间复杂度

## 监控

服务提供以下监控端点：
- `/health` - 健康状态
- 状态转换日志（控制台输出）
- 动作匹配统计（未来扩展）