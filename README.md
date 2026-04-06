# GoClaw - 桌面宠物

基于 PyQt5 的智能桌面宠物助手，集成 AI 对话、语音合成、记忆系统和个性化角色定制。

## 功能特性

- **AI 对话** - 基于智谱 GLM-4-Flash 模型，智能对话交互
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
├── character_system.py # 角色系统
├── pet_system.py       # 行为与记忆系统
├── tts_manager.py      # 语音管理
├── characters/         # 角色配置
└── png/               # 动画资源
```

## 运行

```bash
python pet.py
```

## 配置

首次运行需要配置智谱 AI API Key（免费额度）：
- 注册地址：https://open.bigmodel.cn/
- 修改 `pet.py` 中的 `api_key`

## 技术栈

- Python 3.12+
- PyQt5
- edge-tts
- OpenAI (智谱AI SDK)
