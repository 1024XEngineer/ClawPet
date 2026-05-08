package utils

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/processutil"
)

var execCommand = exec.Command
var findBinaryFunc = FindPicoclawBinary

func SetBinaryFinder(f func() (string, error)) {
	findBinaryFunc = f
}

func EnsureOnboarded(configPath string) error {
	_, err := os.Stat(configPath)
	if err == nil {
		return nil
	}
	if !os.IsNotExist(err) {
		return fmt.Errorf("stat config: %w", err)
	}

	picoclawPath, err := findBinaryFunc()
	if err != nil {
		return fmt.Errorf("failed to locate picoclaw binary for onboarding: %w", err)
	}

	cmd := execCommand(picoclawPath, "onboard")
	cmd.Env = append(os.Environ(), config.EnvConfig+"="+configPath)
	cmd.Stdin = strings.NewReader("n\n")
	processutil.PrepareBackgroundCommand(cmd)

	output, err := cmd.CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf(
				"failed to run onboard: %w. "+
					"This may happen if picoclaw binary is incompatible or missing dependencies. "+
					"Please ensure you have a valid picoclaw installation.",
				err)
		}
		return fmt.Errorf("onboard failed: %w. Output: %s", err, trimmed)
	}

	if _, err := os.Stat(configPath); err != nil {
		if os.IsNotExist(err) {
			dir := filepath.Dir(configPath)
			return fmt.Errorf(
				"onboard completed but config file was not created at %s. "+
					"Please check if the directory %s exists and is writable, "+
					"or create a config file manually.",
				configPath, dir)
		}
		return fmt.Errorf("verify config after onboard: %w", err)
	}

	return nil
}
