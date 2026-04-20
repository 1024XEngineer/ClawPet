package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
	ppid "github.com/sipeed/picoclaw/pkg/pid"
)

func TestCronAPI_CRUDLifecycle(t *testing.T) {
	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	cfg.Tools.Cron.Enabled = true
	if err := config.SaveConfig(configPath, cfg); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	createBody := `{"name":"Morning reminder","description":"Send a daily check-in","scheduleType":"cron","schedule":"0 9 * * *"}`
	createRec := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/api/cron", bytes.NewBufferString(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d, body=%s", createRec.Code, http.StatusCreated, createRec.Body.String())
	}

	var createResp struct {
		Job cronJobResponse `json:"job"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("create unmarshal error = %v", err)
	}
	if createResp.Job.ID == "" {
		t.Fatal("expected created job id")
	}
	if createResp.Job.ScheduleType != "cron" || createResp.Job.CronExpr != "0 9 * * *" {
		t.Fatalf("unexpected created job schedule: %#v", createResp.Job)
	}

	listRec := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/api/cron", nil)
	mux.ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d, body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}

	var listResp struct {
		Jobs []cronJobResponse `json:"jobs"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("list unmarshal error = %v", err)
	}
	if len(listResp.Jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(listResp.Jobs))
	}

	updateBody := `{"description":"Run every 5 minutes","scheduleType":"every","everySeconds":300}`
	updateRec := httptest.NewRecorder()
	updateReq := httptest.NewRequest(
		http.MethodPut,
		"/api/cron/"+createResp.Job.ID,
		bytes.NewBufferString(updateBody),
	)
	updateReq.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(updateRec, updateReq)

	if updateRec.Code != http.StatusOK {
		t.Fatalf("update status = %d, want %d, body=%s", updateRec.Code, http.StatusOK, updateRec.Body.String())
	}

	var updateResp struct {
		Job cronJobResponse `json:"job"`
	}
	if err := json.Unmarshal(updateRec.Body.Bytes(), &updateResp); err != nil {
		t.Fatalf("update unmarshal error = %v", err)
	}
	if updateResp.Job.ScheduleType != "every" || updateResp.Job.EverySeconds == nil || *updateResp.Job.EverySeconds != 300 {
		t.Fatalf("unexpected updated schedule: %#v", updateResp.Job)
	}
	toggleRec := httptest.NewRecorder()
	toggleReq := httptest.NewRequest(
		http.MethodPost,
		"/api/cron/"+createResp.Job.ID+"/toggle",
		bytes.NewBufferString(`{"enabled":false}`),
	)
	toggleReq.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(toggleRec, toggleReq)

	if toggleRec.Code != http.StatusOK {
		t.Fatalf("toggle status = %d, want %d, body=%s", toggleRec.Code, http.StatusOK, toggleRec.Body.String())
	}

	var toggleResp struct {
		Success bool            `json:"success"`
		Job     cronJobResponse `json:"job"`
	}
	if err := json.Unmarshal(toggleRec.Body.Bytes(), &toggleResp); err != nil {
		t.Fatalf("toggle unmarshal error = %v", err)
	}
	if !toggleResp.Success || toggleResp.Job.Enabled {
		t.Fatalf("expected job to be disabled: %#v", toggleResp)
	}

	enabledOnlyRec := httptest.NewRecorder()
	enabledOnlyReq := httptest.NewRequest(http.MethodGet, "/api/cron?include_disabled=false", nil)
	mux.ServeHTTP(enabledOnlyRec, enabledOnlyReq)

	if enabledOnlyRec.Code != http.StatusOK {
		t.Fatalf("enabled-only status = %d, want %d, body=%s", enabledOnlyRec.Code, http.StatusOK, enabledOnlyRec.Body.String())
	}

	var enabledOnlyResp struct {
		Jobs []cronJobResponse `json:"jobs"`
	}
	if err := json.Unmarshal(enabledOnlyRec.Body.Bytes(), &enabledOnlyResp); err != nil {
		t.Fatalf("enabled-only unmarshal error = %v", err)
	}
	if len(enabledOnlyResp.Jobs) != 0 {
		t.Fatalf("expected 0 enabled jobs, got %d", len(enabledOnlyResp.Jobs))
	}

	deleteRec := httptest.NewRecorder()
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/cron/"+createResp.Job.ID, nil)
	mux.ServeHTTP(deleteRec, deleteReq)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d, body=%s", deleteRec.Code, http.StatusOK, deleteRec.Body.String())
	}
}

func TestCronAPI_CreateRejectsCommandOutsideInternalChannel(t *testing.T) {
	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	cfg.Tools.Cron.Enabled = true
	cfg.Tools.Exec.Enabled = true
	cfg.Tools.Cron.AllowCommand = true
	if err := config.SaveConfig(configPath, cfg); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/cron",
		bytes.NewBufferString(`{"name":"shell","description":"run shell","scheduleType":"every","everySeconds":60,"command":"echo hi"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "restricted to internal channels") {
		t.Fatalf("body = %q, want internal-channel restriction", rec.Body.String())
	}
}

func TestCronAPI_CreateRejectsCommandWhenAllowCommandDisabled(t *testing.T) {
	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	cfg.Tools.Cron.Enabled = true
	cfg.Tools.Exec.Enabled = true
	cfg.Tools.Cron.AllowCommand = false
	if err := config.SaveConfig(configPath, cfg); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/cron",
		bytes.NewBufferString(`{"name":"shell","description":"run shell","scheduleType":"every","everySeconds":60,"command":"echo hi","channel":"cli"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "command_confirm=true") {
		t.Fatalf("body = %q, want allow_command rejection", rec.Body.String())
	}
}

func TestCronAPI_CreateReloadsRunningGateway(t *testing.T) {
	resetGatewayTestState(t)

	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	cfg.Tools.Cron.Enabled = true
	if err := config.SaveConfig(configPath, cfg); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	originalReloadPost := gatewayReloadPost
	t.Cleanup(func() {
		gatewayReloadPost = originalReloadPost
	})

	var gotURL string
	var gotAuth string
	gatewayReloadPost = func(url string, authToken string, timeout time.Duration) (*http.Response, error) {
		gotURL = url
		gotAuth = authToken
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"status":"reload triggered"}`)),
		}, nil
	}

	gateway.mu.Lock()
	gateway.pidData = &ppid.PidFileData{
		Host:  "127.0.0.1",
		Port:  18999,
		Token: "reload-token",
	}
	setGatewayRuntimeStatusLocked("running")
	gateway.mu.Unlock()

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/cron",
		bytes.NewBufferString(`{"name":"Morning reminder","description":"Send a daily check-in","scheduleType":"cron","schedule":"0 9 * * *"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if gotURL != "http://127.0.0.1:18999/reload" {
		t.Fatalf("reload url = %q, want %q", gotURL, "http://127.0.0.1:18999/reload")
	}
	if gotAuth != "reload-token" {
		t.Fatalf("reload auth = %q, want %q", gotAuth, "reload-token")
	}
}

func TestCronAPI_CreateRejectsInvalidCron(t *testing.T) {
	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/cron",
		bytes.NewBufferString(`{"name":"Bad cron","description":"broken","scheduleType":"cron","schedule":"invalid"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error = %v", err)
	}
	if resp["message"] == "" {
		t.Fatalf("expected error message, got %#v", resp)
	}
}

func TestCronAPI_DisabledReturnsServiceUnavailable(t *testing.T) {
	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	cfg.Tools.Cron.Enabled = false
	if err := config.SaveConfig(configPath, cfg); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	testCases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/cron"},
		{
			name:   "create",
			method: http.MethodPost,
			path:   "/api/cron",
			body:   `{"name":"job","description":"msg","scheduleType":"every","everySeconds":60}`,
		},
		{
			name:   "update",
			method: http.MethodPut,
			path:   "/api/cron/job-1",
			body:   `{"description":"msg"}`,
		},
		{name: "delete", method: http.MethodDelete, path: "/api/cron/job-1"},
		{
			name:   "toggle",
			method: http.MethodPost,
			path:   "/api/cron/job-1/toggle",
			body:   `{"enabled":false}`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}

			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}

			var resp map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("unmarshal error = %v", err)
			}
			if resp["message"] != "cron tool is disabled" {
				t.Fatalf("message = %q, want %q", resp["message"], "cron tool is disabled")
			}
		})
	}
}
