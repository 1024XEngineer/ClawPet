import {
  PetclawSdk,
  type InitStatusPushData,
  type StreamData,
  type PetInboundMessage,
} from "./petclaw-sdk"

async function main() {
  const sdk = new PetclawSdk({
    baseUrl: "http://127.0.0.1:18800",
    token: "goclaw-local-token",
  })

  const socket = await sdk.bootstrap()

  socket.onMessage((payload: PetInboundMessage) => {
    if ("type" in payload && payload.type === "push") {
      switch (payload.push_type) {
        case "init_status": {
          const data = payload.data as InitStatusPushData
          console.log("[init_status]", data.need_config, data.character?.pet_name)
          if (data.need_config) {
            sdk.sendOnboardingConfig({
              pet_name: "艾莉",
              pet_persona: "温柔体贴，善于提醒学习与休息节奏",
              pet_persona_type: "gentle",
            })
          } else {
            sdk.sendEmotionGet()
            sdk.sendChat("你好，先做个自我介绍。")
          }
          break
        }
        case "ai_chat": {
          const data = payload.data as StreamData | string
          console.log("[ai_chat]", data)
          break
        }
        case "audio":
          console.log("[audio chunk]")
          break
        case "emotion_change":
          console.log("[emotion_change]", payload.data)
          break
        case "action_trigger":
          console.log("[action_trigger]", payload.data)
          break
        default:
          console.log("[push]", payload.push_type, payload.data)
      }
      return
    }

    if ("status" in payload) {
      console.log("[response]", payload.action ?? "", payload.status, payload.data)
    }
  })
}

void main()
