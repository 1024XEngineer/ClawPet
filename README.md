# GoClaw - 桌面宠物

基于 PyQt5 的智能桌面宠物助手，集成 PicoClaw AI 大脑，支持情感识别、工具调用、记忆系统和个性化角色定制。

## 功能特性

- **AI 对话** - 基于 PicoClaw 的智能对话，理解用户情感和意图
- **情感系统** - 12种情感识别，根据角色性格生成个性化回复
- **工具调用** - 提醒、日程、搜索、文件查找、应用启动
- **语音合成** - Edge TTS 实时语音播放
- **记忆系统** - 多维分类记忆，自动提取关键信息
- **角色系统** - 40+ 性格标签，25 个预设角色，支持自定义
- **气泡优先级** - 提醒 > AI回复 > 待机气泡

## 项目结构

```
pet/
├── pet.py              # 主程序
├── pico_brain.py       # PicoClaw AI 大脑
├── pico_tools.py       # 工具执行器
├── ai_manager.py       # AI 后端管理
├── character_editor.py # 设置界面
├── character_system.py # 角色系统
├── pet_system.py       # 行为与记忆系统
├── tts_manager.py      # 语音管理
├── picoclaw.exe        # PicoClaw AI 后端
├── picoclaw_data/      # PicoClaw 配置
├── characters/         # 角色配置
└── png/               # 动画资源
```

## 快速开始

### 1. 配置 API Key

复制 `.env.example` 为 `.env`，填入你的 API Key：

```bash
cp .env.example .env
```

编辑 `.env` 文件：
```
ZHIPU_API_KEY=your_zhipu_api_key_here
PICOCLAW_API_KEY=your_picoclaw_api_key_here
```

### 2. 运行

```bash
pip install -r requirements.txt
python pet.py
```

## API Key 获取

### 智谱 AI (BigModel)
- 注册地址：https://open.bigmodel.cn/
- 免费额度：GLM-4-Flash 模型免费使用

### PicoClaw
- 使用智谱 AI API Key 配置到 `picoclaw_data/config.json`

## 技术栈

- Python 3.12+
- PyQt5
- edge-tts
- OpenAI SDK (兼容智谱AI)
