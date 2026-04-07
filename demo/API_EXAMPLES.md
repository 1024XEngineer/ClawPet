# ClawPet API 使用示例

## 基础设置

### 1. 设置环境变量
```bash
# Linux/macOS
export DEEPSEEK_API_KEY="your-api-key-here"
export PORT="8080"

# Windows (PowerShell)
$env:DEEPSEEK_API_KEY="your-api-key-here"
$env:PORT="8080"
```

### 2. 启动服务
```bash
# 方法1: 使用启动脚本
./scripts/run.sh

# 方法2: 直接运行
go run main.go
```

## API 接口示例

### 健康检查
```bash
curl http://localhost:8080/health
```
响应:
```json
{
  "status": "ok",
  "service": "clawpet-api"
}
```

### 1. 注册动作

**请求:**
```bash
curl -X POST http://localhost:8080/api/actions/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "播放音乐",
    "description": "播放轻松的音乐帮助放松心情"
  }'
```

**响应:**
```json
{
  "id": "A0",
  "name": "播放音乐",
  "description": "播放轻松的音乐帮助放松心情"
}
```

### 2. 查看所有动作

**请求:**
```bash
curl http://localhost:8080/api/actions
```

**响应:**
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

### 3. 与桌宠聊天

**请求:**
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "今天工作好累，心情不太好"
  }'
```

**响应:**
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

### 4. 查看对话上下文

**请求:**
```bash
curl http://localhost:8080/api/chat/context
```

**响应:**
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

### 5. 清空对话上下文

**请求:**
```bash
curl -X DELETE http://localhost:8080/api/chat/context
```

**响应:**
```json
{
  "message": "Context cleared successfully"
}
```

## 状态更新示例

### 积极消息
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "今天很开心，项目完成了！"}'
```

状态变化:
- 开心度: +10
- 亲密度: +5  
- 沮丧度: -5

### 消极消息
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "好难过，考试没考好"}'
```

状态变化:
- 开心度: -10
- 沮丧度: +10
- 亲密度: +3

### 中性消息  
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好，吃饭了吗？"}'
```

状态变化:
- 亲密度: +2

## 使用Python客户端示例

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

## 故障排除

### 1. 服务无法启动
```bash
# 检查端口是否被占用
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

### 4. 内存使用
- 所有数据存储在内存中
- 重启服务会丢失所有数据
- 上下文最多保存10条对话

## 下一步
- 添加数据库持久化
- 实现WebSocket实时通信
- 添加用户认证系统
- 支持更多工具调用