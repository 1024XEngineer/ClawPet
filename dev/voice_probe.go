package main

import (
	"fmt"
	"os"

	petconfig "github.com/sipeed/picoclaw/pkg/pet/config"
	"github.com/sipeed/picoclaw/pkg/pet/voice"
)

func main() {
	workspace := os.Getenv("VOICE_PROBE_WORKSPACE")
	if workspace == "" {
		fmt.Fprintln(os.Stderr, "VOICE_PROBE_WORKSPACE is required")
		os.Exit(1)
	}

	manager := petconfig.NewManager(workspace)
	if manager == nil {
		fmt.Fprintln(os.Stderr, "failed to create config manager")
		os.Exit(1)
	}

	loader := voice.NewLoader(manager.GetVoice())
	if err := loader.Load(); err != nil {
		fmt.Fprintf(os.Stderr, "load voice failed: %v\n", err)
		os.Exit(1)
	}

	provider := loader.GetProvider()
	if provider == nil {
		fmt.Fprintln(os.Stderr, "voice provider is nil")
		os.Exit(1)
	}

	ch, err := provider.Synthesize("你好，这是语音探测。", voice.DefaultVoiceParams())
	if err != nil {
		fmt.Fprintf(os.Stderr, "synthesize failed: %v\n", err)
		os.Exit(1)
	}

	total := 0
	chunks := 0
	final := false
	for chunk := range ch {
		total += len(chunk.Data)
		chunks++
		if chunk.IsLast {
			final = true
		}
	}

	fmt.Printf("chunks=%d bytes=%d final=%v\n", chunks, total, final)
}
