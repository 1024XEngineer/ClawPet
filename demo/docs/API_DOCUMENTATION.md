# ClawPet API 接口文档

## 概述

ClawPet API 是一个基于Go语言的虚拟桌宠后端服务，提供动作注册、智能对话和状态管理功能。API采用RESTful设计，返回JSON格式数据。

## 基础信息

- **基础URL**: `http://localhost:8080` (默认端口)
- **内容类型**: `application/json`
- **认证**: 当前版本无需认证
- **响应格式**: 所有接口返回JSON格式数据

## 健康检查

### GET /health

检查服务是否正常运行。

**请求示例**:
```bash
curl http://localhost:8080/health
```

**响应示例**:
```json
{
  "status": "ok",
  "service": "clawpet-api"
}
```

**响应字段**:
| 字段名 | 类型 | 说明 |
|--------|------|------|
| status | string | 服务状态，"ok"表示正常 |
| service | string | 服务名称 |

## 动作管理接口

### POST /api/actions/register

注册一个新的桌宠动作。

**请求体**:
```json
{
  "name": "播放音乐",
  "description": "播放轻松的音乐帮助放松心情"
}
```

**请求字段**:
| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 是 | 动作名称 |
| description | string | 是 | 动作描述 |

**响应示例**:
```json
{
  "id": "A0",
  "name": "播放音乐",
  "description": "播放轻松的音乐帮助放松心情"
}
```

**响应字段**:
| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 自动生成的唯一标识符 |
| name | string | 动作名称 |
| description | string | 动作描述 |

**ID生成规则**:
- 格式: 字母+数字 (如 A0, B0, C0)
- 递增生成，确保唯一性

### GET /api/actions

获取所有已注册的动作列表。

**请求示例**:
```bash
curl http://localhost:8080/api/actions
```

**响应示例**:
```json
{
  "actions": [
    {
      "id": "A0",
      "name": "播放音乐",
      "description": "播放轻松的音乐帮助放松心情"
    },
    {
      "id": "B0",
      "name": "提醒休息",
      "description": "提醒用户定时休息保护眼睛"
    }
  ],
  "count": 2
}
```

**响应字段**:
| 字段名 | 类型 | 说明 |
|--------|------|------|
| actions | array | 动作对象数组 |
| count | integer | 动作总数 |

## 聊天接口

### POST /api/chat

与虚拟桌宠进行对话，获取智能回复和状态更新。

**请求体**:
```json
{
  "message": "今天工作好累，心情不太好"
}
```

**请求字段**:
| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| message | string | 是 | 用户发送的文本消息 |

**响应示例**:
```json
{
  "response": "听到你说工作累了，我在这里陪着你。要不要我为你播放一些轻松的音乐？",
  "selected_action": "播放音乐",
  "state": {
    "intimacy": 63,
    "frustration": 30,
    "happiness": 50
  }
}
```

**响应字段**:
| 字段名 | 类型 | 说明 |
|--------|------|------|
| response | string | 桌宠的回复内容（已清理状态变化标记） |
| selected_action | string | 推荐的动作名称（可选） |
| state | object | 当前桌宠状态 |

**状态对象字段**:
| 字段名 | 类型 | 范围 | 说明 |
|--------|------|------|------|
| intimacy | integer | 0-100 | 亲密度 |
| frustration | integer | 0-100 | 沮丧程度 |
| happiness | integer | 0-100 | 开心程度 |

### 状态更新机制

#### 1. 本地规则更新（基础）
- **积极词汇**（开心、高兴、喜欢等）：开心度+10，亲密度+5，沮丧度-5
- **消极词汇**（难过、生气、累等）：开心度-10，沮丧度+10，亲密度+3
- **中性词汇**（你好、吃饭、工作等）：亲密度+2

#### 2. 大模型智能状态更新（增强）
大模型会在结构化响应中建议状态变化，系统自动提取并应用：

**大模型响应格式**:
```
text: [温暖贴心的回复内容]
state: [状态变化建议，格式：亲密度±N，沮丧度±N，开心度±N]
action: [可选动作名称]
```

**状态变化提取规则**:
- 支持中文关键词：`亲密度`、`沮丧度`、`开心度`
- 支持英文关键词：`intimacy`、`frustration`、`happiness`
- 支持中文冒号和英文冒号
- 变化值限制在-10到+10之间
- 无效值或超出范围的值会被忽略

#### 3. 更新顺序
1. 先应用本地规则更新（作为基础）
2. 再应用大模型建议的状态变化（作为增强）
3. 最终状态值限制在0-100范围内

## 上下文管理接口

### GET /api/chat/context

获取当前对话的上下文历史。

**请求示例**:
```bash
curl http://localhost:8080/api/chat/context
```

**响应示例**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "今天工作好累，心情不太好"
    },
    {
      "role": "assistant",
      "content": "听到你说工作累了，我在这里陪着你。要不要我为你播放一些轻松的音乐？"
    }
  ],
  "count": 2
}
```

**响应字段**:
| 字段名 | 类型 | 说明 |
|--------|------|------|
| messages | array | 消息对象数组 |
| count | integer | 消息总数 |

**消息对象字段**:
| 字段名 | 类型 | 说明 |
|--------|------|------|
| role | string | 角色，"user"或"assistant" |
| content | string | 消息内容 |

**上下文限制**:
- 最多保存最近10条对话
- 重启服务后上下文会清空

### DELETE /api/chat/context

清空当前对话的上下文历史。

**请求示例**:
```bash
curl -X DELETE http://localhost:8080/api/chat/context
```

**响应示例**:
```json
{
  "message": "Context cleared successfully"
}
```

## 错误处理

### 错误响应格式
```json
{
  "error": "错误描述信息"
}
```

### 常见错误码
| HTTP状态码 | 错误描述 | 可能原因 |
|------------|----------|----------|
| 400 | Invalid request body | 请求体格式错误或缺少必要字段 |
| 500 | Failed to generate response | 大模型API调用失败 |
| 500 | API error: 401 Unauthorized | DeepSeek API密钥无效 |
| 500 | API error: 429 Too Many Requests | API调用频率超限 |

## 环境变量配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| DEEPSEEK_API_KEY | 是 | 无 | DeepSeek API密钥 |
| PORT | 否 | 8080 | 服务监听端口 |

## 使用示例

### Python客户端示例
```python
import requests
import json

class ClawPetClient:
    def __init__(self, base_url="http://localhost:8080"):
        self.base_url = base_url
    
    def register_action(self, name, description):
        url = f"{self.base_url}/api/actions/register"
        data = {"name": name, "description": description}
        response = requests.post(url, json=data)
        return response.json()
    
    def chat(self, message):
        url = f"{self.base_url}/api/chat"
        data = {"message": message}
        response = requests.post(url, json=data)
        return response.json()
    
    def get_actions(self):
        url = f"{self.base_url}/api/actions"
        response = requests.get(url)
        return response.json()

# 使用示例
client = ClawPetClient()

# 注册动作
action = client.register_action("天气查询", "查询当前天气情况")
print(f"注册动作: {action}")

# 聊天
response = client.chat("今天天气怎么样？")
print(f"桌宠回复: {response['response']}")
print(f"推荐动作: {response.get('selected_action', '无')}")
print(f"当前状态: {response['state']}")

# 查看所有动作
actions = client.get_actions()
print(f"可用动作: {actions}")
```

### cURL命令示例

1. **启动服务**:
```bash
export DEEPSEEK_API_KEY="your-api-key"
go run main.go
```

2. **注册动作**:
```bash
curl -X POST http://localhost:8080/api/actions/register \
  -H "Content-Type: application/json" \
  -d '{"name":"播放音乐","description":"播放轻松音乐"}'
```

3. **与桌宠聊天**:
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"今天心情不好"}'
```

4. **查看所有动作**:
```bash
curl http://localhost:8080/api/actions
```

5. **查看对话上下文**:
```bash
curl http://localhost:8080/api/chat/context
```

6. **清空上下文**:
```bash
curl -X DELETE http://localhost:8080/api/chat/context
```

## 注意事项

1. **数据持久化**: 所有数据存储在内存中，重启服务后会丢失
2. **API密钥**: 必须设置有效的DeepSeek API密钥
3. **状态范围**: 所有状态值保持在0-100范围内
4. **上下文限制**: 最多保存10条对话记录
5. **向后兼容**: 支持旧格式的状态变化建议

## 故障排除

### 1. 服务无法启动
```bash
# 检查端口占用
netstat -an | grep 8080

# 检查Go版本
go version
```

### 2. API密钥错误
```
错误: "API error: 401 Unauthorized"
解决方法: 检查DEEPSEEK_API_KEY环境变量是否正确
```

### 3. 响应超时
```
错误: "context deadline exceeded"
解决方法: 检查网络连接，或增加超时时间
```

### 4. 状态不更新
- 检查大模型是否返回正确的结构化格式
- 查看日志确认状态变化是否被提取
- 验证状态值是否在有效范围内

## 版本历史

### v1.0.0 (当前)
- 动作注册和管理
- 智能对话接口
- 状态管理和更新
- 上下文记忆
- 结构化响应格式支持

### 未来计划
- 数据库持久化存储
- 用户认证系统
- WebSocket实时通信
- 更多工具调用支持