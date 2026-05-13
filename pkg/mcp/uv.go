package mcp

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/sipeed/picoclaw/pkg/logger"
)

const (
	uvVersion     = "0.11.14"
	uvDownloadURL = "https://github.com/astral-sh/uv/releases/download/" + uvVersion + "/uv-{arch}-pc-windows-msvc.zip"
)

// ensureUVX 确保 uvx 可用，返回 uvx.exe 的完整路径。
// 先检查系统 PATH，再检查 installDir，最后从 GitHub 下载。
func ensureUVX(installDir string) (string, error) {
	// 1. 检查系统 PATH
	if p, err := exec.LookPath("uvx"); err == nil {
		return p, nil
	}

	// 2. 检查安装目录
	os.MkdirAll(installDir, 0755)
	uvxPath := filepath.Join(installDir, "uvx.exe")
	if info, err := os.Stat(uvxPath); err == nil && !info.IsDir() {
		return uvxPath, nil
	}

	// 3. 从 GitHub 下载
	logger.InfoCF("mcp", "Downloading uv "+uvVersion, map[string]any{
		"install_dir": installDir,
	})

	arch := "x86_64"
	if runtime.GOARCH == "arm64" {
		arch = "aarch64"
	}
	url := strings.ReplaceAll(uvDownloadURL, "{arch}", arch)

	tmpZip := filepath.Join(os.TempDir(), "uv-download.zip")
	defer os.Remove(tmpZip)

	// 下载
	out, err := os.Create(tmpZip)
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}
	resp, err := http.Get(url)
	if err != nil {
		out.Close()
		return "", fmt.Errorf("download uv: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		out.Close()
		return "", fmt.Errorf("download uv: HTTP %d", resp.StatusCode)
	}
	_, err = io.Copy(out, resp.Body)
	out.Close()
	if err != nil {
		return "", fmt.Errorf("save uv zip: %w", err)
	}

	// 解压
	zr, err := zip.OpenReader(tmpZip)
	if err != nil {
		return "", fmt.Errorf("open uv zip: %w", err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name == "uv.exe" || f.Name == "uvx.exe" {
			dst := filepath.Join(installDir, f.Name)
			rc, openErr := f.Open()
			if openErr != nil {
				continue
			}
			dstF, createErr := os.Create(dst)
			if createErr != nil {
				rc.Close()
				continue
			}
			io.Copy(dstF, rc)
			dstF.Close()
			rc.Close()
		}
	}

	// 验证
	if info, err := os.Stat(uvxPath); err == nil && !info.IsDir() {
		logger.InfoCF("mcp", "uv downloaded successfully", map[string]any{
			"path": uvxPath,
		})
		return uvxPath, nil
	}

	return "", fmt.Errorf("uvx not found after download")
}
