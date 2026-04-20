# ClawPet 初始化数据接口对接文档（方案 B：草稿 + 完成）

本文档用于前后端对接初始化流程的数据接口。目标是：

- 支持分步保存草稿（防中断丢失）
- 支持最终完成提交（原子落库）
- 支持断点恢复
- 保证幂等与状态一致性

---

## 1. 接口总览

Base URL（示例）：`/api/v1/onboarding`

1. `GET /status`：获取初始化状态与草稿进度
2. `PUT /draft`：保存草稿（整包覆盖，幂等）
3. `POST /complete`：完成初始化（服务端校验并原子提交）
4. `POST /reset`（可选）：重置初始化（用于“重新初始化”）

认证：与现有项目登录态保持一致（Cookie Session / Bearer Token 均可）

内容类型：`application/json; charset=utf-8`

---

## 2. 数据类型定义（前后端统一）

```ts
export type OnboardingStep = 1 | 2 | 3

export type Chronotype = "morning" | "balanced" | "night"
export type ReminderCadence = "light" | "standard" | "intensive"
export type PressureLevel = "low" | "medium" | "high" | "critical"

export interface OnboardingProfile {
  displayName: string
  role: string
  language: string
}

export interface OnboardingPet {
  petName: string
  personality: string
  voiceStyle: string
}

export interface OnboardingAppSettings {
  autoConnectOnLaunch: boolean
  enableDesktopBubble: boolean
  openConsoleOnPetClick: boolean
}

export interface LearningRhythm {
  chronotype: Chronotype
  focusWindows: string[]
  quietWindows: string[]
  reminderCadence: ReminderCadence
  summary: string
}

export interface PressurePlan {
  level: PressureLevel
  strategy: string
  reminderIntervalsMinutes: number[]
  toneGuide: string
  templates: {
    soft: string
    normal: string
    strong: string
  }
}

export interface StudentInsights {
  learningRhythm: LearningRhythm
  pressurePlan: PressurePlan
}

export interface OnboardingPayloadV1 {
  schemaVersion: 1
  onboardingId: string
  step: OnboardingStep
  profile: OnboardingProfile
  pet: OnboardingPet
  app: OnboardingAppSettings
  studentInsights?: StudentInsights
}
```

### 字段说明

- `schemaVersion`：协议版本，当前固定 `1`
- `onboardingId`：本次初始化会话 ID（前端生成 UUID，整个流程不变）
- `step`：当前步骤（用于恢复到对应 UI）
- `studentInsights`：可选；如果前端已生成分析结果就带上

---

## 3. 接口详细定义

## 3.1 `GET /api/v1/onboarding/status`

用途：页面加载时判断是否已完成初始化、是否有草稿。

### Response 200

```json
{
  "code": "OK",
  "data": {
    "completed": false,
    "completedAt": null,
    "hasDraft": true,
    "step": 2,
    "onboardingId": "d63f0e4f-5b43-4d6f-bbd8-5f8e30f50d10",
    "schemaVersion": 1,
    "draftUpdatedAt": "2026-04-20T12:20:31.102Z",
    "payload": {
      "schemaVersion": 1,
      "onboardingId": "d63f0e4f-5b43-4d6f-bbd8-5f8e30f50d10",
      "step": 2,
      "profile": {
        "displayName": "小王",
        "role": "student",
        "language": "zh-CN"
      },
      "pet": {
        "petName": "爪爪",
        "personality": "温柔鼓励",
        "voiceStyle": "温和陪伴型"
      },
      "app": {
        "autoConnectOnLaunch": true,
        "enableDesktopBubble": true,
        "openConsoleOnPetClick": true
      }
    }
  }
}
```

说明：

- `payload` 在 `hasDraft=false` 时可返回 `null`
- `completed=true` 时前端应直接进入控制台，不再弹初始化

---

## 3.2 `PUT /api/v1/onboarding/draft`

用途：每一步“下一步”或关键字段变更时保存草稿。

### Request Body

`OnboardingPayloadV1`

### Response 200

```json
{
  "code": "OK",
  "data": {
    "saved": true,
    "draftUpdatedAt": "2026-04-20T12:28:41.662Z",
    "step": 2,
    "onboardingId": "d63f0e4f-5b43-4d6f-bbd8-5f8e30f50d10"
  }
}
```

服务端约束：

- 幂等：同一用户 + 同一 `onboardingId` 多次提交应可安全覆盖
- 状态限制：若已 `completed=true`，默认拒绝写草稿（除非 reset 后）

---

## 3.3 `POST /api/v1/onboarding/complete`

用途：点击“完成初始化”时调用，最终提交并标记完成。

### Request Body

```json
{
  "schemaVersion": 1,
  "onboardingId": "d63f0e4f-5b43-4d6f-bbd8-5f8e30f50d10"
}
```

### Response 200

```json
{
  "code": "OK",
  "data": {
    "completed": true,
    "completedAt": "2026-04-20T12:35:09.411Z",
    "onboardingId": "d63f0e4f-5b43-4d6f-bbd8-5f8e30f50d10"
  }
}
```

服务端动作（建议事务内完成）：

1. 读取草稿并校验完整性（必填字段）
2. 写入正式用户设置/画像
3. 标记初始化完成
4. 清理或归档草稿

前端约束：

- 只有 `complete` 成功后才调用 Electron 的 `completeOnboarding`（解锁显示控制台/桌宠）

---

## 3.4 `POST /api/v1/onboarding/reset`（可选）

用途：用户手动“重新初始化”。

### Request Body

```json
{
  "reason": "manual-rerun"
}
```

### Response 200

```json
{
  "code": "OK",
  "data": {
    "completed": false,
    "hasDraft": false,
    "resetAt": "2026-04-20T12:40:00.000Z"
  }
}
```

---

## 4. 错误码约定

统一返回：

```json
{
  "code": "INVALID_ARGUMENT",
  "message": "step is required",
  "requestId": "..."
}
```

建议错误码：

- `OK`
- `UNAUTHORIZED`：未登录或认证失效
- `FORBIDDEN`
- `NOT_FOUND`
- `INVALID_ARGUMENT`：字段非法/缺失
- `CONFLICT`：状态冲突（例如已完成后还写 draft）
- `PRECONDITION_FAILED`：complete 时草稿不完整
- `INTERNAL`

HTTP 状态建议：

- `200` 成功
- `400` 参数错误
- `401/403` 认证与权限问题
- `404` 资源不存在
- `409` 状态冲突
- `412` 前置条件不满足
- `500` 服务端错误

---

## 5. 服务端校验规则（最小必需）

- `schemaVersion` 必须为 `1`
- `onboardingId` 必须为 UUID
- `step` 范围：`1~3`
- `profile.displayName` 非空，长度建议 `1~32`
- `app` 三个布尔字段必须存在
- `studentInsights` 如存在需全字段合法

---

## 6. 前端调用流程（建议）

1. 初始化页打开：`GET /status`
   - `completed=true`：直接跳控制台
   - `hasDraft=true`：回填草稿，跳到 `step`
2. 每次切步：`PUT /draft`
3. 点击完成：
   - 先 `PUT /draft`（最终状态）
   - 再 `POST /complete`
   - 成功后调用 Electron `completeOnboarding`

---

## 7. 存储建议（后端）

可拆两张表（或同表两种状态）：

- `onboarding_draft`
  - `user_id`, `onboarding_id`, `schema_version`, `step`, `payload_json`, `updated_at`
- `onboarding_state`
  - `user_id`, `completed`, `completed_at`, `last_onboarding_id`, `updated_at`

索引建议：

- `onboarding_draft(user_id, onboarding_id)` 唯一索引
- `onboarding_state(user_id)` 唯一索引

---

## 8. 兼容与演进

- 新增字段只加不改，保持向后兼容
- 协议升级走 `schemaVersion=2`
- 后端保留 v1 解析路径，避免已发布客户端崩溃

---

## 9. 示例 cURL

### 保存草稿

```bash
curl -X PUT "http://127.0.0.1:18800/api/v1/onboarding/draft" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": 1,
    "onboardingId": "d63f0e4f-5b43-4d6f-bbd8-5f8e30f50d10",
    "step": 2,
    "profile": {"displayName":"小王","role":"student","language":"zh-CN"},
    "pet": {"petName":"爪爪","personality":"温柔鼓励","voiceStyle":"温和陪伴型"},
    "app": {"autoConnectOnLaunch":true,"enableDesktopBubble":true,"openConsoleOnPetClick":true}
  }'
```

### 完成初始化

```bash
curl -X POST "http://127.0.0.1:18800/api/v1/onboarding/complete" \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion":1,"onboardingId":"d63f0e4f-5b43-4d6f-bbd8-5f8e30f50d10"}'
```
