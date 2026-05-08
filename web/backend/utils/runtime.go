package utils

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/processutil"
)

// CheckPortAvailable checks if a port is available for binding.
// Returns an error if the port is already in use.
func CheckPortAvailable(port int) error {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("port %d is already in use: %w", port, err)
	}
	ln.Close()
	return nil
}

// GetPicoclawHome returns the picoclaw home directory.
// Priority: $PICOCLAW_HOME > ~/.picoclaw
func GetPicoclawHome() string {
	return config.GetHome()
}

// GetDefaultConfigPath returns the default path to the picoclaw config file.
func GetDefaultConfigPath() string {
	if configPath := os.Getenv(config.EnvConfig); configPath != "" {
		return configPath
	}
	return filepath.Join(GetPicoclawHome(), "config.json")
}

// searchPath represents a potential binary location with context
type searchPath struct {
	path    string
	context string
}

func getFallbackSearchPaths() []searchPath {
	var paths []searchPath
	binaryName := "picoclaw"
	if runtime.GOOS == "windows" {
		binaryName = "picoclaw.exe"
	}

	switch runtime.GOOS {
	case "windows":
		if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
			paths = append(paths, searchPath{
				path:    filepath.Join(localAppData, "picoclaw", binaryName),
				context: "Windows user-local install",
			})
		}
		if programFiles := os.Getenv("PROGRAMFILES"); programFiles != "" {
			paths = append(paths, searchPath{
				path:    filepath.Join(programFiles, "picoclaw", binaryName),
				context: "Windows system install",
			})
		}
		if userProfile := os.Getenv("USERPROFILE"); userProfile != "" {
			paths = append(paths, searchPath{
				path:    filepath.Join(userProfile, "go", "bin", binaryName),
				context: "Go install from source",
			})
		}
	case "linux":
		if home, _ := os.UserHomeDir(); home != "" {
			paths = append(paths, searchPath{
				path:    filepath.Join(home, ".local", "bin", "picoclaw"),
				context: "Linux user-local",
			})
		}
		paths = append(paths, searchPath{
			path:    "/usr/local/bin/picoclaw",
			context: "Linux system install",
		})
		paths = append(paths, searchPath{
			path:    "/opt/picoclaw/picoclaw",
			context: "Linux /opt location",
		})
	case "darwin":
		if home, _ := os.UserHomeDir(); home != "" {
			paths = append(paths, searchPath{
				path:    filepath.Join(home, "go", "bin", "picoclaw"),
				context: "macOS Go install",
			})
		}
		paths = append(paths, searchPath{
			path:    "/usr/local/bin/picoclaw",
			context: "macOS Homebrew/system",
		})
		paths = append(paths, searchPath{
			path:    "/opt/picoclaw/picoclaw",
			context: "macOS /opt location",
		})
	}

	return paths
}

func isPackagedApp() bool {
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		resourcesPath := filepath.Join(exeDir, "resources")
		if info, err := os.Stat(resourcesPath); err == nil && info.IsDir() {
			return true
		}
	}
	return false
}

func getPackagedAppBinaryPath() string {
	binaryName := "picoclaw"
	if runtime.GOOS == "windows" {
		binaryName = "picoclaw.exe"
	}

	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		resourcesPath := filepath.Join(exeDir, "resources")
		if info, err := os.Stat(resourcesPath); err == nil && info.IsDir() {
			return filepath.Join(resourcesPath, binaryName)
		}
	}
	return ""
}

// FindPicoclawBinary locates the picoclaw executable with enhanced search.
// Search order:
//  1. PICOCLAW_BINARY environment variable (explicit override)
//  2. Packaged Electron app location (resources/ directory)
//  3. Same directory as the current executable
//  4. Platform-specific fallback locations
//  5. $PATH via exec.LookPath
//
// Returns the path and an error if the binary cannot be found in any location.
func FindPicoclawBinary() (string, error) {
	binaryName := "picoclaw"
	if runtime.GOOS == "windows" {
		binaryName = "picoclaw.exe"
	}

	if p := os.Getenv(config.EnvBinary); p != "" {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p, nil
		}
		return "", fmt.Errorf("PICOCLAW_BINARY environment variable points to non-existent file: %s", p)
	}

	if isPackagedApp() {
		if packagedPath := getPackagedAppBinaryPath(); packagedPath != "" {
			if info, err := os.Stat(packagedPath); err == nil && !info.IsDir() {
				logger.Debugf("Found picoclaw binary in packaged app resources: %s", packagedPath)
				return packagedPath, nil
			}
		}
	}

	if exe, err := os.Executable(); err == nil {
		logger.Debugf("Trying to find picoclaw binary in %s", exe)
		candidate := filepath.Join(filepath.Dir(exe), binaryName)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}

	// 检查当前工作目录（go run 时 os.Executable 返回的是 go 工具路径，需要单独检查 cwd）
	// 必须返回绝对路径，Go 1.19+ 拒绝以相对路径运行当前目录里的可执行文件
	if cwd, err := os.Getwd(); err == nil {
		candidate := filepath.Join(cwd, binaryName)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}

	var searchedPaths []string
	var foundPath string
	for _, sp := range getFallbackSearchPaths() {
		searchedPaths = append(searchedPaths, sp.path)
		if info, err := os.Stat(sp.path); err == nil && !info.IsDir() {
			foundPath = sp.path
			logger.Debugf("Found picoclaw binary at fallback location: %s (%s)", sp.path, sp.context)
			break
		}
	}

	if foundPath != "" {
		return foundPath, nil
	}

	if path, err := exec.LookPath(binaryName); err == nil {
		return path, nil
	}

	return buildBinaryNotFoundError(searchedPaths)
}

func buildBinaryNotFoundError(searchedPaths []string) (string, error) {
	var sb strings.Builder
	sb.WriteString("picoclaw binary not found.\n\n")
	sb.WriteString("Searched locations:\n")
	for _, p := range searchedPaths {
		sb.WriteString(fmt.Sprintf("  - %s\n", p))
	}
	sb.WriteString("  - $PATH (via which/where)\n\n")
	sb.WriteString("Installation suggestions:\n")

	switch runtime.GOOS {
	case "windows":
		sb.WriteString("  - Download from https://picoclaw.ai/downloads\n")
		sb.WriteString("  - Install via winget: winget install picoclaw\n")
		sb.WriteString("  - Build from source: go install github.com/sipeed/picoclaw@latest\n")
	case "darwin":
		sb.WriteString("  - Download from https://picoclaw.ai/downloads\n")
		sb.WriteString("  - Install via Homebrew: brew install picoclaw\n")
		sb.WriteString("  - Build from source: go install github.com/sipeed/picoclaw@latest\n")
	case "linux":
		sb.WriteString("  - Download from https://picoclaw.ai/downloads\n")
		sb.WriteString("  - Install via: curl -fsSL https://picoclaw.ai/install.sh | sh\n")
		sb.WriteString("  - Build from source: go install github.com/sipeed/picoclaw@latest\n")
	default:
		sb.WriteString("  - Download from https://picoclaw.ai/downloads\n")
		sb.WriteString("  - Build from source: go install github.com/sipeed/picoclaw@latest\n")
	}

	sb.WriteString("\nOr set the PICOCLAW_BINARY environment variable to the executable path.")

	return "", errors.New(sb.String())
}

// GetLocalIP returns the local IP address of the machine.
func GetLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	return ""
}

// OpenBrowser automatically opens the given URL in the default browser.
func OpenBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		return fmt.Errorf("unsupported platform")
	}

	processutil.PrepareBackgroundCommand(cmd)
	return cmd.Start()
}
