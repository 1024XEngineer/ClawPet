package utils

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestEnsureOnboardedSkipsWhenConfigExists(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(configPath, []byte(`{}`), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	origExecCommand := execCommand
	defer func() { execCommand = origExecCommand }()

	called := false
	execCommand = func(name string, args ...string) *exec.Cmd {
		called = true
		return exec.Command("sh", "-c", "exit 1")
	}

	if err := EnsureOnboarded(configPath); err != nil {
		t.Fatalf("EnsureOnboarded() error = %v", err)
	}
	if called {
		t.Fatal("expected onboard command not to run when config already exists")
	}
}

func TestEnsureOnboardedRunsOnboardWhenConfigMissing(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")

	origExecCommand := execCommand
	defer func() { execCommand = origExecCommand }()

	origFindBinary := findBinaryFunc
	defer func() { findBinaryFunc = origFindBinary }()
	SetBinaryFinder(func() (string, error) {
		return "mock-picoclaw", nil
	})

	var gotName string
	var gotArgs []string
	execCommand = func(name string, args ...string) *exec.Cmd {
		gotName = name
		gotArgs = append([]string(nil), args...)
		// Create a command that does nothing successfully but creates the config file
		// The key is that it exits successfully (exit 0)
		if runtime.GOOS == "windows" {
			// Use PowerShell to create the config file
			return exec.Command("powershell", "-Command", fmt.Sprintf("New-Item -Path '%s' -ItemType File -Value '{}' -Force; exit 0", configPath))
		}
		return exec.Command("sh", "-c", fmt.Sprintf("touch '%s' && printf '{}' > '%s'", configPath, configPath))
	}

	if err := EnsureOnboarded(configPath); err != nil {
		t.Fatalf("EnsureOnboarded() error = %v", err)
	}
	if gotName == "" {
		t.Fatal("expected onboard command to run")
	}
	if len(gotArgs) != 1 || gotArgs[0] != "onboard" {
		t.Fatalf("command args = %#v, want []string{\"onboard\"}", gotArgs)
	}
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("expected config to be created: %v", err)
	}
}

func TestEnsureOnboardedFailsWhenOnboardDoesNotCreateConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")

	origExecCommand := execCommand
	defer func() { execCommand = origExecCommand }()

	origFindBinary := findBinaryFunc
	defer func() { findBinaryFunc = origFindBinary }()
	SetBinaryFinder(func() (string, error) {
		return "mock-picoclaw", nil
	})

	execCommand = func(name string, args ...string) *exec.Cmd {
		if runtime.GOOS == "windows" {
			return exec.Command("cmd", "/c", "exit 0")
		}
		return exec.Command("sh", "-c", "exit 0")
	}

	if err := EnsureOnboarded(configPath); err == nil {
		t.Fatal("EnsureOnboarded() error = nil, want failure when onboard does not create config")
	}
}

func TestEnsureOnboardedIncludesOnboardOutputOnFailure(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")

	origExecCommand := execCommand
	defer func() { execCommand = origExecCommand }()

	origFindBinary := findBinaryFunc
	defer func() { findBinaryFunc = origFindBinary }()
	SetBinaryFinder(func() (string, error) {
		return "mock-picoclaw", nil
	})

	execCommand = func(name string, args ...string) *exec.Cmd {
		if runtime.GOOS == "windows" {
			return exec.Command("cmd", "/c", "echo onboarding failed >&2 && exit /b 2")
		}
		return exec.Command("sh", "-c", "echo onboarding failed >&2; exit 2")
	}

	err := EnsureOnboarded(configPath)
	if err == nil {
		t.Fatal("EnsureOnboarded() error = nil, want failure")
	}
	if !strings.Contains(err.Error(), "onboarding failed") {
		t.Fatalf("error = %q, want onboard output included", err)
	}
}
