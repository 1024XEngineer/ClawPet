package api

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
)

// registerPicoRoutes binds Pico Channel management endpoints to the ServeMux.
func (h *Handler) registerPicoRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/pet/token", h.handleGetPicoToken)
	mux.HandleFunc("POST /api/pet/token", h.handleRegenPicoToken)
	mux.HandleFunc("POST /api/pet/setup", h.handlePicoSetup)
	mux.HandleFunc("POST /api/pet/onboarding", h.handlePetOnboarding)

	mux.HandleFunc("GET /api/pico/token", h.handleGetPicoToken)
	mux.HandleFunc("POST /api/pico/token", h.handleRegenPicoToken)
	mux.HandleFunc("POST /api/pico/setup", h.handlePicoSetup)
	mux.HandleFunc("POST /api/pico/onboarding", h.handlePetOnboarding)

	// WebSocket proxy: forward /pico/ws to gateway
	// This allows the frontend to connect via the same port as the web UI,
	// avoiding the need to expose extra ports for WebSocket communication.
	mux.HandleFunc("GET /pet/ws", h.handleWebSocketProxy())
	mux.HandleFunc("GET /pico/ws", h.handleWebSocketProxy())
}

// createWsProxy creates a reverse proxy to the current gateway WebSocket endpoint.
// The gateway bind host and port are resolved from the latest configuration.
func (h *Handler) createWsProxy(origProtocol string, token string) *httputil.ReverseProxy {
	wsProxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			target := h.gatewayProxyURL()
			r.SetURL(target)
			// Gateway only guarantees /pico/ws. Keep /pet/ws as an alias on launcher
			// by rewriting upstream path to /pico/ws.
			if r.In != nil && strings.HasPrefix(r.In.URL.Path, "/pet/ws") {
				r.Out.URL.Path = strings.Replace(r.In.URL.Path, "/pet/ws", "/pico/ws", 1)
			}
			r.Out.Header.Set(protocolKey, tokenPrefix+token)
		},
		ModifyResponse: func(r *http.Response) error {
			if prot := r.Header.Values(protocolKey); len(prot) > 0 {
				r.Header.Del(protocolKey)
				if origProtocol != "" {
					r.Header.Set(protocolKey, origProtocol)
				}
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.Errorf("Failed to proxy WebSocket: %v", err)
			http.Error(w, "Gateway unavailable: "+err.Error(), http.StatusBadGateway)
		},
	}
	return wsProxy
}

// handleWebSocketProxy wraps a reverse proxy to handle WebSocket connections.
// It validates the client token before forwarding; rejects immediately on failure.
func (h *Handler) handleWebSocketProxy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		gateway.mu.Lock()
		if gateway.pidData == nil {
			if pd := readGatewayPidData(h.configPath); pd != nil {
				logger.Infof("handleWebSocketProxy: found pidData, port=%d, pid=%d", pd.Port, pd.PID)
				gateway.pidData = pd
			}
		}
		ensurePicoTokenCachedLocked(h.configPath)
		gatewayAvailable := gateway.picoToken != ""
		gateway.mu.Unlock()

		if !gatewayAvailable {
			logger.Warnf("Gateway not available for WebSocket proxy")
			http.Error(w, "Gateway not available", http.StatusServiceUnavailable)
			return
		}
		prot := r.Header.Values(protocolKey)
		if len(prot) > 0 {
			origProtocol := prot[0]
			newToken := picoComposedToken(prot[0])
			if newToken != "" {
				h.createWsProxy(origProtocol, newToken).ServeHTTP(w, r)
				return
			}
		}

		logger.Warnf("Rejected WebSocket proxy request with invalid Pico token")
		http.Error(w, "Invalid Pico token", http.StatusForbidden)
	}
}

// handleGetPicoToken returns the current WS token and URL for the frontend.
//
//	GET /api/pico/token
func (h *Handler) handleGetPicoToken(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	if token := loadPicoTokenFromSecurityConfig(h.configPath); token != "" {
		cfg.Channels.Pico.SetToken(token)
	}

	protocol := "pico"
	wsURL := h.buildWsURL(r)
	if strings.Contains(r.URL.Path, "/api/pet/") {
		protocol = "pet"
		wsURL = h.buildChannelWsURL(r, "/pet/ws")
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"token":    cfg.Channels.Pico.Token.String(),
		"ws_url":   wsURL,
		"enabled":  cfg.Channels.Pico.Enabled,
		"protocol": protocol,
	})
}

// handleRegenPicoToken generates a new Pico WebSocket token and saves it.
//
//	POST /api/pico/token
func (h *Handler) handleRegenPicoToken(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	token := generateSecureToken()
	cfg.Channels.Pico.SetToken(token)

	if err := config.SaveConfig(h.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), http.StatusInternalServerError)
		return
	}

	// Refresh cached pico token.
	gateway.mu.Lock()
	gateway.picoToken = token
	gateway.mu.Unlock()

	protocol := "pico"
	wsURL := h.buildWsURL(r)
	if strings.Contains(r.URL.Path, "/api/pet/") {
		protocol = "pet"
		wsURL = h.buildChannelWsURL(r, "/pet/ws")
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"token":    token,
		"ws_url":   wsURL,
		"protocol": protocol,
	})
}

// EnsurePicoChannel enables the Pico channel with sane defaults if it isn't
// already configured. Returns true when the config was modified.
//
// callerOrigin is the Origin header from the setup request. If non-empty and
// no origins are configured yet, it's written as the allowed origin so the
// WebSocket handshake works for whatever host the caller is on (LAN, custom
// port, etc.). Pass "" when there's no request context.
func (h *Handler) EnsurePicoChannel(callerOrigin string) (bool, error) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		return false, fmt.Errorf("failed to load config: %w", err)
	}

	changed := false

	if !cfg.Channels.Pico.Enabled {
		cfg.Channels.Pico.Enabled = true
		changed = true
	}

	if cfg.Channels.Pico.Token.String() == "" {
		cfg.Channels.Pico.SetToken(generateSecureToken())
		changed = true
	}

	// Seed origins from the request instead of hardcoding ports.
	if len(cfg.Channels.Pico.AllowOrigins) == 0 && callerOrigin != "" {
		cfg.Channels.Pico.AllowOrigins = []string{callerOrigin}
		changed = true
	}

	if changed {
		if err := config.SaveConfig(h.configPath, cfg); err != nil {
			return false, fmt.Errorf("failed to save config: %w", err)
		}
	}

	return changed, nil
}

// handlePicoSetup automatically configures everything needed for the Pico Channel to work.
//
//	POST /api/pico/setup
func (h *Handler) handlePicoSetup(w http.ResponseWriter, r *http.Request) {
	changed, err := h.EnsurePicoChannel(r.Header.Get("Origin"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Reload config (EnsurePicoChannel may have modified it) and refresh cache.
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}
	if changed {
		refreshPicoToken(cfg)
	}

	protocol := "pico"
	wsURL := h.buildWsURL(r)
	if strings.Contains(r.URL.Path, "/api/pet/") {
		protocol = "pet"
		wsURL = h.buildChannelWsURL(r, "/pet/ws")
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"token":    cfg.Channels.Pico.Token.String(),
		"ws_url":   wsURL,
		"enabled":  true,
		"changed":  changed,
		"protocol": protocol,
	})
}

// generateSecureToken creates a random 32-character hex string.
func generateSecureToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// Fallback to something pseudo-random if crypto/rand fails
		return fmt.Sprintf("%032x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func (h *Handler) handlePetOnboarding(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	target := h.gatewayProxyURL()
	target.Path = "/pet/onboarding"

	req, err := http.NewRequest(http.MethodPost, target.String(), bytes.NewReader(body))
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to build request: %v", err), http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to call gateway onboarding endpoint: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
