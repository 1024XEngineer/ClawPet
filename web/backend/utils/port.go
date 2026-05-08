package utils

import (
	"fmt"
)

const (
	DefaultGatewayPort  = 18790
	DefaultLauncherPort = 18800
	MaxPortRetries      = 100
)

type PortResult struct {
	Port     int
	UsedPort int
	IsFallback bool
}

func (r *PortResult) Message() string {
	if r.IsFallback {
		return fmt.Sprintf("port %d is already in use, using fallback port %d", r.UsedPort, r.Port)
	}
	return fmt.Sprintf("using port %d", r.Port)
}

func FindAvailablePort(preferred int, fallbackStart int, maxRetries int) (*PortResult, error) {
	if preferred <= 0 {
		preferred = fallbackStart
	}

	if err := CheckPortAvailable(preferred); err == nil {
		return &PortResult{Port: preferred, UsedPort: 0, IsFallback: false}, nil
	}

	for i := 0; i < maxRetries; i++ {
		candidate := fallbackStart + i
		if candidate == preferred {
			continue
		}
		if err := CheckPortAvailable(candidate); err == nil {
			return &PortResult{Port: candidate, UsedPort: preferred, IsFallback: true}, nil
		}
	}

	return nil, fmt.Errorf("no available port found in range %d-%d", fallbackStart, fallbackStart+maxRetries-1)
}

func FindAvailablePortForService(serviceType string, preferred int) (*PortResult, error) {
	var fallbackStart int
	switch serviceType {
	case "gateway":
		fallbackStart = DefaultGatewayPort + 1
	case "launcher":
		fallbackStart = DefaultLauncherPort + 1
	default:
		fallbackStart = preferred + 1
	}

	return FindAvailablePort(preferred, fallbackStart, MaxPortRetries)
}
