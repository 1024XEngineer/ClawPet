import { IconPlus, IconTool } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { type ChangeEvent, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { getTools } from "@/api/tools"
import { AssistantMessage } from "@/components/chat/assistant-message"
import { ChatComposer } from "@/components/chat/chat-composer"
import { ChatEmptyState } from "@/components/chat/chat-empty-state"
import { ModelSelector } from "@/components/chat/model-selector"
import { SessionHistoryMenu } from "@/components/chat/session-history-menu"
import { TypingIndicator } from "@/components/chat/typing-indicator"
import { UserMessage } from "@/components/chat/user-message"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { useChatModels } from "@/hooks/use-chat-models"
import { useGateway } from "@/hooks/use-gateway"
import { useAudioInput } from "@/hooks/use-audio-input"
import { usePicoChat } from "@/hooks/use-pico-chat"
import { useSessionHistory } from "@/hooks/use-session-history"
import type { ChatAttachment } from "@/store/chat"

const MAX_IMAGE_SIZE_BYTES = 7 * 1024 * 1024
const MAX_IMAGE_SIZE_LABEL = "7 MB"
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
])

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("Failed to read file"))
    }
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

export function ChatPage() {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasScrolled, setHasScrolled] = useState(false)
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])

  const {
    messages,
    connectionState,
    isTyping,
    audioRecordingState,
    audioError,
    protocolMode,
    activeSessionId,
    sendMessage,
    switchSession,
    newChat,
  } = usePicoChat()

  const { state: gwState } = useGateway()
  const isGatewayRunning = gwState === "running"
  const isChatConnected = connectionState === "connected"

  const {
    defaultModelName,
    hasAvailableModels,
    apiKeyModels,
    oauthModels,
    localModels,
    handleSetDefault,
  } = useChatModels({ isConnected: isGatewayRunning })
  const canSend = isChatConnected && Boolean(defaultModelName)

  const { data: toolSupport } = useQuery({
    queryKey: ["tools", "chat"],
    queryFn: getTools,
    staleTime: 15_000,
    enabled: isGatewayRunning,
  })

  const enabledToolCount =
    toolSupport?.tools.filter((item) => item.status === "enabled").length ??
    undefined
  const toolInfoSource = toolSupport?.source
  const showToolDisabledHint =
    isChatConnected && enabledToolCount !== undefined && enabledToolCount <= 0

  const handleNewChat = () => {
    setInput("")
    setAttachments([])
    void newChat()
  }

  const {
    sessions,
    hasMore,
    loadError,
    loadErrorMessage,
    observerRef,
    loadSessions,
    handleDeleteSession,
  } = useSessionHistory({
    activeSessionId,
    onDeletedActiveSession: handleNewChat,
  })

  const syncScrollState = (element: HTMLDivElement) => {
    const { scrollTop, scrollHeight, clientHeight } = element
    setHasScrolled(scrollTop > 0)
    setIsAtBottom(scrollHeight - scrollTop <= clientHeight + 10)
  }

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    syncScrollState(e.currentTarget)
  }

  useEffect(() => {
    if (scrollRef.current) {
      if (isAtBottom) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
      syncScrollState(scrollRef.current)
    }
  }, [messages, isTyping, isAtBottom])

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || !canSend) return
    if (
      sendMessage({
        content: input,
        attachments,
      })
    ) {
      setInput("")
      setAttachments([])
    }
  }

  const handleAddImages = () => {
    if (!canSend) return
    fileInputRef.current?.click()
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  }

  const handleImageSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""

    if (files.length === 0) {
      return
    }

    const nextAttachments: ChatAttachment[] = []
    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        toast.error(
          t("chat.invalidImage", {
            name: file.name,
          }),
        )
        continue
      }

      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        toast.error(
          t("chat.imageTooLarge", {
            name: file.name,
            size: MAX_IMAGE_SIZE_LABEL,
          }),
        )
        continue
      }

      try {
        nextAttachments.push({
          type: "image",
          filename: file.name,
          url: await readFileAsDataUrl(file),
        })
      } catch {
        toast.error(
          t("chat.imageReadFailed", {
            name: file.name,
          }),
        )
      }
    }

    if (nextAttachments.length > 0) {
      setAttachments(nextAttachments.slice(0, 1))
    }
  }

  const canSubmit = canSend && (Boolean(input.trim()) || attachments.length > 0)
  const { isRecording, toggleRecording } = useAudioInput(canSend)
  const canAttachImages = protocolMode !== "pet"
  const attachImageDisabledReason = canAttachImages
    ? undefined
    : t("chat.attachmentsUnsupportedInPetMode")

  useEffect(() => {
    if (!audioError) {
      return
    }
    toast.error(audioError)
  }, [audioError])

  useEffect(() => {
    if (protocolMode !== "pet" || attachments.length === 0) {
      return
    }
    setAttachments([])
    toast.info(t("chat.attachmentsClearedForPetMode"))
  }, [protocolMode, attachments.length, t])

  const audioStatusText =
    audioRecordingState === "recording"
      ? t("chat.audio.recording")
      : audioRecordingState === "recognizing"
        ? t("chat.audio.recognizing")
        : audioRecordingState === "error"
          ? audioError || t("chat.audio.error")
          : ""

  return (
    <div className="bg-background/95 flex h-full flex-col">
      <PageHeader
        title={t("navigation.chat")}
        className={`transition-shadow ${
          hasScrolled ? "shadow-xs" : "shadow-none"
        }`}
        titleExtra={
          hasAvailableModels && (
            <ModelSelector
              defaultModelName={defaultModelName}
              apiKeyModels={apiKeyModels}
              oauthModels={oauthModels}
              localModels={localModels}
              onValueChange={handleSetDefault}
            />
          )
        }
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={handleNewChat}
          className="h-9 gap-2"
        >
          <IconPlus className="size-4" />
          <span className="hidden sm:inline">{t("chat.newChat")}</span>
        </Button>

        <SessionHistoryMenu
          sessions={sessions}
          activeSessionId={activeSessionId}
          hasMore={hasMore}
          loadError={loadError}
          loadErrorMessage={loadErrorMessage}
          observerRef={observerRef}
          onOpenChange={(open) => {
            if (open) {
              void loadSessions(true)
            }
          }}
          onSwitchSession={switchSession}
          onDeleteSession={handleDeleteSession}
        />
      </PageHeader>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-24 xl:px-48"
      >
        <div className="mx-auto flex w-full max-w-250 flex-col gap-8 pb-8">
          {messages.length === 0 && !isTyping && (
            <ChatEmptyState
              hasAvailableModels={hasAvailableModels}
              defaultModelName={defaultModelName}
              isConnected={isGatewayRunning}
              enabledToolCount={enabledToolCount}
              toolInfoSource={toolInfoSource}
            />
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="flex w-full">
              {msg.role === "assistant" ? (
                <AssistantMessage
                  content={msg.content}
                  timestamp={msg.timestamp}
                  attachments={msg.attachments}
                />
              ) : (
                <UserMessage
                  content={msg.content}
                  attachments={msg.attachments}
                />
              )}
            </div>
          ))}

          {isTyping && <TypingIndicator />}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
        className="hidden"
        onChange={handleImageSelection}
      />

      {showToolDisabledHint && (
        <div className="border-border/70 bg-amber-50/70 text-amber-800 flex items-center justify-center gap-2 border-t px-4 py-2 text-xs">
          <IconTool className="size-3.5" />
          <span>Tools are currently disabled. Enable one in</span>
          <Link to="/agent/tools" className="underline underline-offset-2">
            Tools
          </Link>
          <span>to allow tool actions.</span>
        </div>
      )}

      {audioStatusText && (
        <div className="border-border/70 bg-muted/45 text-muted-foreground flex items-center justify-center border-t px-4 py-2 text-xs">
          <span>{audioStatusText}</span>
        </div>
      )}

      <ChatComposer
        input={input}
        attachments={attachments}
        onInputChange={setInput}
        onAddImages={handleAddImages}
        onRemoveAttachment={handleRemoveAttachment}
        onSend={handleSend}
        onToggleRecording={() => {
          void toggleRecording()
        }}
        isConnected={isChatConnected}
        hasDefaultModel={Boolean(defaultModelName)}
        canSend={canSubmit}
        canRecord={isChatConnected}
        isRecording={isRecording}
        canAttachImages={canAttachImages}
        attachImageDisabledReason={attachImageDisabledReason}
      />
    </div>
  )
}
