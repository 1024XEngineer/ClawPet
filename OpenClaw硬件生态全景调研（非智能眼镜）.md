# OpenClaw 硬件生态全景调研
> 视觉开发接入视角 · 非智能眼镜类硬件 

---

## 前置理解：OpenClaw 的硬件接入架构

OpenClaw 采用 **Gateway-Node** 两层架构来连接硬件：

```
物理硬件（摄像头/传感器/执行器）
        ↓
  Node 客户端 App（WebSocket 连接）
        ↓
  Gateway 网关（运行在 PC/服务器/树莓派）
        ↓
  LLM 大模型（Claude/GPT/DeepSeek/本地Ollama）
        ↓
  Agent 执行结果 → 消息渠道（Telegram/飞书/微信等）
```

**官方原话**：`"Nodes are peripherals, not gateways."` Node 是外设，不是主服务，只需通过 WebSocket 连上 Gateway 即可。这意味着：

- 眼镜、手机、机器人、嵌入式板等**都可以作为 Node** 挂到同一个 Gateway
- 摄像头的调用指令：`camera.snap`（拍照）、`camera.clip`（录视频）
- Gateway 可以挂多个 Node，多摄像头并行调用

---

## 一、手机类（官方 Node 支持）

### Android 手机 / 平板

| 项目 | 详情 |
|------|------|
| 接入方式 | 官方 Node App（需编译 APK 安装） |
| 摄像头支持 | ✅ 前后摄均支持，拍照 + 录视频 |
| 其他能力 | GPS 定位、屏幕录制、发 SMS、Canvas 显示 |
| 配对方式 | 扫 Telegram Setup Code / `openclaw devices approve` |
| 成本 | 闲置旧手机即可，零成本 |
| AI 锁定 | 否，自定义 AI |

**典型视觉场景**：把旧 Android 手机固定在冰箱门口，OpenClaw 定时调用 `camera.snap` 拍照并分析食材；或当作家庭监控节点，有人触发时自动拍照识别。

**相关链接**：
- 官方 Node 配对教程：https://tbbbk.com/openclaw-node-android-ios-pairing-guide-2026/
- OpenClaw Node 文档：https://github.com/openclaw/openclaw（官方 GitHub）

---

### iOS 手机

| 项目 | 详情 |
|------|------|
| 接入方式 | 官方 Node App（TestFlight 内测，尚未公开分发） |
| 摄像头支持 | ✅ 支持（功能比 Android 少，无屏录和 SMS） |
| 其他能力 | 摄像头、Canvas 显示、位置服务、Talk Mode 语音 |
| 状态 | 内部预览阶段，官方文档注明 "not publicly distributed yet" |
| AI 锁定 | 否 |

**建议**：iOS 版本等公开发布，关注官方 GitHub Release 页面，届时功能会对齐 Android 版本。

---

### 小米手机（miclaw）

| 项目 | 详情 |
|------|------|
| 定位 | 小米定制版 OpenClaw，深度适配 MIUI/HyperOS |
| 摄像头支持 | ✅（小米高精度摄像头） |
| 特色 | 手机自动化能力强，小米生态互联 |
| 相关链接 | https://www.mi.com（小米官网） |

---

## 二、单板计算机 / 边缘计算硬件（Gateway 宿主）

这类硬件是 OpenClaw **Gateway 的宿主**，同时可接外置摄像头作为 Node 使用，实现 7×24 小时持续运行的视觉节点。

### 树莓派系列（Raspberry Pi）

| 型号 | 推荐程度 | 价格 | 特点 |
|------|:-:|------|------|
| Raspberry Pi 5（8GB） | ⭐⭐⭐⭐⭐ | ¥700 左右 | 最强性能，运行 OpenClaw 最流畅 |
| Raspberry Pi 4B（8GB） | ⭐⭐⭐⭐ | ¥500 左右 | 经典款，文档最丰富 |
| Raspberry Pi CM5 | ⭐⭐⭐⭐ | 模块价 | Distiller Alpha 硬件核心 |
| Raspberry Pi Zero 2W | ⭐⭐⭐ | ¥180 左右 | 超低功耗，轻量任务 |

**接入方式**：直接在树莓派上部署 OpenClaw Gateway，接 USB 摄像头或 CSI 摄像头模块即可。

**摄像头配件**：
- Raspberry Pi Camera Module 3（官方，1200万像素，支持 HDR）
- USB 摄像头（即插即用，最简单）
- Arducam 系列（多焦距选择）

**视觉场景实测**：
- 家庭监控 AI 管家（有人触发 → 自动拍照 → AI 识别 → 飞书推送）
- 植物生长监测（定时拍摄 → AI 分析长势）
- 门禁人脸识别节点

**相关链接**：
- 树莓派官网：https://www.raspberrypi.com
- 树莓派 + OpenClaw 完整教程：https://blog.csdn.net/m0_60781580/article/details/158495458
- 边缘计算部署实战：https://www.ncnynl.com/archives/202602/6875.html
- ClawPanel ARM64 支持说明：https://github.com/qingchencloud/clawpanel

---

### Orange Pi / RK3588 系列

| 型号 | 特点 |
|------|------|
| Orange Pi 5 Plus（RK3588） | NPU 6 TOPS，可跑本地视觉模型 |
| Orange Pi 5B | 内置 eMMC，稳定性强 |
| Orange Pi Zero 3 | 超低成本，轻量 Gateway |

**优势**：RK3588 芯片内置 6TOPS NPU，可在本地跑轻量视觉推理（如 YOLO 目标检测），再将结果传给 OpenClaw，减少 API 调用成本。

**接入方式**：同树莓派，ClawPanel 明确支持 Orange Pi ARM64 一键部署。

**相关链接**：
- Orange Pi 官网：http://www.orangepi.cn
- ClawPanel 部署指南：https://github.com/qingchencloud/clawpanel

---

### Mac mini（"AI 数字肉身"）

| 项目 | 详情 |
|------|------|
| 定位 | 社区最主流的 OpenClaw 本地 Gateway 宿主 |
| 性能 | Apple Silicon M4，本地跑 Ollama 视觉模型无压力 |
| 摄像头 | 需外接 USB 摄像头；或以手机作为视觉 Node |
| 现状 | 2026年初 Mac mini 因 OpenClaw 热潮曾一度断货 |
| 成本 | M4 基础款 ¥4499 起 |

**搭配方案**：Mac mini（Gateway）+ 旧 iPhone（iOS Node 视觉摄像头）+ Ollama 本地视觉模型（如 LLaVA），实现完全本地化视觉推理，零 API 费用。

**相关链接**：
- Apple Mac mini：https://www.apple.com.cn/mac-mini/
- Ollama 本地模型：https://ollama.com

---

### NAS（威联通 QNAP / 群晖 Synology）

| 项目 | 详情 |
|------|------|
| 接入方式 | Docker 容器部署 OpenClaw Gateway |
| 摄像头支持 | 通过 NAS 自带的监控摄像头管理系统获取视频流 |
| 优势 | 7×24 小时低功耗运行，存储容量大，适合视频归档 |
| 群晖型号 | DS923+（AMD Ryzen）/ DS1522+（更强） |
| 威联通型号 | TS-464（Intel N5095）/ TS-253E |

**视觉场景**：NAS 已接入家庭 IP 摄像头，OpenClaw 通过 RTSP 流调用摄像头画面，定期截图分析，结果存入 NAS 并推送通知。

**相关链接**：
- 群晖官网：https://www.synology.cn
- 威联通官网：https://www.qnap.com/zh-cn
- Docker 部署 OpenClaw：https://github.com/qingchencloud/clawpanel（含 Docker Compose 教程）

---

## 三、专用 OpenClaw 硬件产品

### Distiller Alpha（Pamir）

| 项目 | 详情 |
|------|------|
| 定位 | 专为 OpenClaw 打造的一体化硬件，开箱即用 |
| 创始团队 | 两位 95 后华人开发者 |
| 价格 | $250（约 ¥1700） |
| 核心模块 | 树莓派 CM5，8GB 内存，64GB 存储 |
| 内置硬件 | 墨水屏 + LED 环境指示灯 + 麦克风 + 扬声器 + **摄像头** |
| 尺寸 | 比手机还小，可放裤兜 |
| 预装 | OpenClaw 完整环境 + Pamir Agent，扫二维码即可对话 |
| 摄像头用途 | 开发者视觉节点（远程监控、屏幕状态检测等） |

**优势**：零部署门槛，插电即用，特别适合不想折腾环境配置的开发者验证 OpenClaw 视觉工作流。

**相关链接**：
- 量子位报道：https://www.qbitai.com/2026/02/375361.html
- Pamir 官网：https://pamir.dev（需自查最新状态）

---

## 四、机器人 / 具身智能

这是 OpenClaw 与视觉最深度融合的硬件方向：**摄像头 → 视觉感知 → Agent 决策 → 机器人执行**。

### ROSClaw（ROS 2 + OpenClaw 桥接层）

| 项目 | 详情 |
|------|------|
| 项目来源 | SF OpenClaw Hackathon 2026 冠军项目（Irvin 团队） |
| 开源状态 | ✅ 已开源（夺冠后立即开源） |
| 接入方式 | OpenClaw Skill 插件层 + ROS 2 Topic/Service 桥接 |
| 连接协议 | WebRTC（低延迟、安全、全球远程连接） |
| 视觉能力 | 通过摄像头/传感器感知环境，AI 实时决策 |
| 兼容硬件 | 所有 ROS 2 兼容机器人（TurtleBot、机械臂、无人车等） |
| 安全机制 | 线速度默认 ≤1m/s，角速度 ≤1.5rad/s，硬编码紧急停止 |

**工作流**：WhatsApp 发指令 → OpenClaw Agent 理解意图 → ROS 2 控制指令 → 机器人真实动作

**视觉场景**：
- 机器人通过摄像头识别物体 → Agent 规划抓取路径 → 机械臂执行
- 无人车通过摄像头感知障碍物 → Agent 决策绕行路线

**相关链接**：
- 新浪科技报道：https://finance.sina.com.cn/tech/roll/2026-03-03/doc-inhpteii0789423.shtml
- 知乎详解：https://zhuanlan.zhihu.com/p/2012243433985714129
- ROS 2 官网：https://docs.ros.org/en/rolling/

---

### Asimov 开源人形机器人（Menlo Research）

| 项目 | 详情 |
|------|------|
| 定位 | 完整开源人形机器人生态，与 OpenClaw 官宣对接 |
| 组成 | Asimov OS + 人形机器人参考设计 + 开放供应链 |
| 核心 | Agent 抽象层：AI 表达意图，OS 处理电机/传感器/安全 |
| 标准 | 与硬件无关的通用标准，软件可跨平台迁移 |
| 成本目标 | 年化总拥有成本 ~$30,000（约 ¥20万） |
| 视觉能力 | 头部搭载摄像头，结合 OpenClaw 视觉节点实现环境感知 |
| 对接声明 | Asimov 官方：「你的 OpenClaw 代理可以拥有实体了」 |

**相关链接**：
- Menlo Research（Asimov）：https://menlo.ai
- DAMO 报道：https://damodev.csdn.net/69ab8a6554b52172bc5f8ee0.html

---

### ZeroClaw（极轻量化，支持 ESP32）

| 项目 | 详情 |
|------|------|
| 定位 | OpenClaw 的 Rust 极轻量替代，专为嵌入式设计 |
| 运行内存 | < 5MB |
| 冷启动 | < 10ms |
| 支持硬件 | 服务器 → 树莓派 → **ESP32**（全覆盖） |
| 机器人集成 | 内置机器人硬件集成套件 |
| 视觉接入 | 通过 ESP32-CAM 等低成本摄像头模块接入 |

**视觉场景**：用 ESP32-CAM（约 ¥30）作为廉价视觉节点，通过 ZeroClaw 接入 OpenClaw 工作流。

**相关链接**：
- 知乎生态拆解：https://zhuanlan.zhihu.com/p/2014676164254381240
- ESP32-CAM：https://www.espressif.com.cn

---

## 五、IP 摄像头 / 监控摄像头

通过 RTSP/HTTP 流方式，IP 摄像头可作为 OpenClaw 的视觉数据源，无需官方 Node 支持。

### 大华 / 海康威视（工业/安防级）

| 项目 | 详情 |
|------|------|
| 接入方式 | RTSP 流 → OpenClaw Skill（自定义摄像头 Skill） |
| 分辨率 | 200万～800万像素 |
| 特点 | 稳定性强，适合长期固定场景视觉监控 |
| SDK | 大华 SDK / 海康 SDK（提供二次开发接口） |
| 典型用途 | 工厂质检、园区安防 AI 化 |

**相关链接**：
- 海康威视开发者：https://open.hikvision.com
- 大华开放平台：https://developer.dahuasecurity.com

---

### 萤石云摄像头（海康旗下，消费级）

| 项目 | 详情 |
|------|------|
| 接入方式 | 萤石开放平台 API → OpenClaw Skill |
| 特点 | 消费级价格，云端存储，API 文档完善 |
| OpenClaw 接入 | 通过 HTTP API 获取截图或视频流 |

**相关链接**：
- 萤石开放平台：https://open.ys7.com

---

### DJI 无人机摄像头

| 项目 | 详情 |
|------|------|
| 接入方式 | DJI Mobile SDK / DJI Windows SDK → 自定义 OpenClaw Skill |
| 视觉能力 | 4K/6K 航拍摄像，实时图像流 |
| 典型用途 | 农业巡检、建筑工地监控、应急勘察 |
| SDK 状态 | ✅ 已开放（需申请企业开发者权限） |
| 限制 | 飞行区域限制，需本地算力处理实时流 |

**相关链接**：
- DJI 开发者平台：https://developer.dji.com/cn/
- DJI Mobile SDK：https://developer.dji.com/mobile-sdk/

---

## 六、VR/MR 头显（视觉硬件扩展）

### Apple Vision Pro

| 项目 | 详情 |
|------|------|
| 摄像头 | 12 颗摄像头 + 传感器阵列（仅供系统使用，不对外开放） |
| 开发接入 | visionOS + ARKit（不能直接调摄像头流，可通过 App 间接接入） |
| OpenClaw 接入路径 | 运行 macOS 版 OpenClaw 后，visionOS 应用通过 Canvas 与 Agent 交互 |
| 限制 | 摄像头 API 受沙箱限制，视觉数据不可直接导出 |

**相关链接**：
- Apple Vision Pro 开发者：https://developer.apple.com/visionos/
- visionOS 文档：https://developer.apple.com/documentation/visionos

---

### Meta Quest 3 / Quest 3S

| 项目 | 详情 |
|------|------|
| 摄像头 | 彩色透视摄像头（Color Passthrough，开发者可访问） |
| SDK | Meta XR SDK（可访问 passthrough 画面） |
| OpenClaw 接入路径 | Quest 上跑 Android 版 OpenClaw Node 或自定义 App 接入 Gateway |
| 视觉能力 | 实时空间感知、手势识别、平面检测 |

**相关链接**：
- Meta 开发者平台：https://developer.meta.com/horizon/
- Meta XR SDK：https://developer.meta.com/horizon/develop/

---

## 七、综合对比总览

| 硬件类型 | 代表产品 | 视觉接入难度 | 成本区间 | OpenClaw 接入方式 | 推荐场景 |
|---------|---------|:-:|---------|---------|---------|
| Android 手机 | 闲置安卓机 | ⭐ 极低 | 0（闲置） | 官方 Node App | 快速验证、家庭监控 |
| 树莓派 5 | RPi 5 + CSI 摄像头 | ⭐⭐ 低 | ¥700-900 | Gateway + 本地 Skill | 边缘视觉节点，7×24 运行 |
| Mac mini | M4 Mac mini | ⭐⭐ 低 | ¥4499+ | Gateway + iOS Node | 高性能本地推理，Ollama 视觉 |
| NAS | 群晖/威联通 | ⭐⭐ 低 | ¥2000+ | Docker Gateway + RTSP | 安防摄像头 AI 化 |
| 专用硬件 | Distiller Alpha | ⭐ 极低 | ¥1700 | 开箱即用 | 零运维，开发者验证 |
| ROS 2 机器人 | TurtleBot/机械臂 | ⭐⭐⭐⭐ 高 | ¥5000+ | ROSClaw 插件 | 具身智能、机器人视觉控制 |
| 人形机器人 | Asimov | ⭐⭐⭐⭐⭐ 极高 | ¥20万+ | Asimov OS + OpenClaw | 前沿具身 AI 研究 |
| ESP32-CAM | ESP32-CAM | ⭐⭐ 低 | ¥30 | ZeroClaw / 自定义 Skill | 超低成本 IoT 摄像节点 |
| IP 摄像头 | 海康/大华/萤石 | ⭐⭐ 低 | ¥200-2000 | RTSP + 自定义 Skill | 安防监控 AI 分析 |
| DJI 无人机 | DJI Mavic 系列 | ⭐⭐⭐ 中 | ¥3000+ | DJI Mobile SDK + Skill | 航拍巡检、空间监测 |
| Meta Quest 3 | Quest 3 | ⭐⭐⭐ 中 | ¥3499 | Android Node + XR SDK | 空间计算视觉 |
| Apple Vision Pro | Vision Pro | ⭐⭐⭐⭐ 高 | ¥24999+ | macOS Gateway + Canvas | 企业级空间视觉交互 |

---

## 八、OpenClaw 视觉接入技术路径

### 方案 A：官方 Node App（最简单）

```bash
# 手机安装 Node App 后，Gateway 侧配对
openclaw devices list
openclaw devices approve <requestId>

# Agent 调用摄像头
camera.snap          # 拍照
camera.clip          # 录视频（默认5秒）
location.get         # 获取 GPS 坐标
```

**适用**：Android 手机、旧 iPad 等移动设备

---

### 方案 B：自定义 Skill（RTSP/HTTP 摄像头）

在 `~/clawd/skills/my-camera/SKILL.md` 中定义 Skill，调用外部摄像头的 API：

```markdown
# Camera Skill

从 RTSP 流截图并分析：
1. 调用 curl 获取摄像头截图
2. 使用 Image Model 分析画面
3. 返回结构化描述

RTSP 地址：rtsp://192.168.1.100:554/stream
```

**适用**：IP 摄像头、NAS 接入的摄像头、DJI 无人机

---

### 方案 C：ROSClaw 插件（机器人）

```bash
# 安装 ROSClaw 插件
openclaw plugins install rosclaw

# 配置 ROS 2 endpoint
# Agent 通过 WebRTC 连接 ROS 2 节点
# 调用 /camera/image_raw topic 获取视觉数据
```

**适用**：ROS 2 兼容机器人（TurtleBot、机械臂等）

---

## 九、推荐的分阶段接入路线

### 阶段 1：低成本验证（¥0 - ¥100）
- 用闲置 Android 手机装 Node App
- 接入 OpenClaw Gateway，测试 `camera.snap` 视觉调用
- 验证端到端：拍照 → AI 分析 → Telegram 推送

### 阶段 2：稳定视觉节点（¥700 - ¥1000）
- 树莓派 5 + CSI 摄像头模块
- 部署 7×24 小时 Gateway + 视觉 Skill
- 场景：固定位置监控、定时视觉分析

### 阶段 3：多节点视觉网络（¥3000+）
- Mac mini（主 Gateway + Ollama 本地视觉模型）
- 多部手机/树莓派作为分布式视觉 Node
- ESP32-CAM 作为廉价补充节点
- 实现多点位、多摄像头并行视觉采集

### 阶段 4：具身智能接入（¥5000+）
- ROSClaw + ROS 2 机器人（TurtleBot 3 等）
- 摄像头视觉感知 → Agent 决策 → 机器人执行闭环
- 参考 SF OpenClaw Hackathon 冠军方案

---

## 参考资源

| 资源 | 链接 |
|------|------|
| OpenClaw 官方 GitHub | https://github.com/openclaw/openclaw |
| OpenClaw Wikipedia | https://en.wikipedia.org/wiki/OpenClaw |
| ClawPanel（可视化管理面板）| https://github.com/qingchencloud/clawpanel |
| 手机 Node 配对教程 | https://tbbbk.com/openclaw-node-android-ios-pairing-guide-2026/ |
| 树莓派部署教程 | https://blog.csdn.net/m0_60781580/article/details/158495458 |
| 边缘计算实战（树莓派/Mac mini） | https://www.ncnynl.com/archives/202602/6875.html |
| ROSClaw 相关报道 | https://finance.sina.com.cn/tech/roll/2026-03-03/doc-inhpteii0789423.shtml |
| OpenClaw 生态项目拆解 | https://zhuanlan.zhihu.com/p/2014676164254381240 |
| Distiller Alpha 报道 | https://www.qbitai.com/2026/02/375361.html |
| DJI 开发者平台 | https://developer.dji.com/cn/ |
| 海康威视开放平台 | https://open.hikvision.com |
| 萤石开放平台 | https://open.ys7.com |
| ROS 2 官网 | https://docs.ros.org/en/rolling/ |
| Ollama 本地模型 | https://ollama.com |
| Meta XR 开发者 | https://developer.meta.com/horizon/ |

---

*调研时间：2026年3月 | 数据来源：OpenClaw 官方文档、GitHub 社区、行业媒体报道*
