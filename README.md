# GoClaw - 桌面宠物

基于 PyQt5 的智能桌面宠物助手，集成 AI 对话、语音合成、记忆系统和个性化角色定制。

## 功能特性

- **AI 对话** - 支持智谱 GLM-4-Flash 和 PicoClaw 双后端
- **语音合成** - Edge TTS 实时语音播放，自动过滤表情符号
- **记忆系统** - 多维分类记忆，自动提取和合并关键信息
- **角色系统** - 40+ 性格标签，25 个预设角色，支持自定义
- **行为系统** - 主动对话、随机动作、情绪感知
- **设置界面** - 外观、角色、行为、语音四大设置模块

## 项目结构

```
pet/
├── pet.py              # 主程序
├── character_editor.py  # 设置界面
├── character_system.py  # 角色系统
├── pet_system.py       # 行为与记忆系统
├── tts_manager.py      # 语音管理
├── characters/         # 角色配置
└── png/               # 动画资源
```

## 运行

```bash
python pet.py
```

## AI 后端配置

支持两种 AI 后端：

### 方案一：智谱 AI（默认）
- 注册地址：https://open.bigmodel.cn/
- 修改 `pet.py` 中的 `api_key`

### 方案二：PicoClaw Gateway
1. 安装 PicoClaw：https://picoclaw.io
2. 启动 Gateway：`picoclaw gateway`
3. 修改 `pet.py`：`self.ai_backend = "picoclaw"`
4. 如需修改地址：`self.picoclaw_url = "http://localhost:18790"`

## 技术栈

- Python 3.12+
- PyQt5
- edge-tts
- OpenAI (智谱AI SDK)
