package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/constants"
	cronpkg "github.com/sipeed/picoclaw/pkg/cron"
)

type cronJobRequest struct {
	Name         *string `json:"name,omitempty"`
	Description  *string `json:"description,omitempty"`
	Message      *string `json:"message,omitempty"`
	ScheduleType *string `json:"scheduleType,omitempty"`
	Schedule     *string `json:"schedule,omitempty"`
	CronExpr     *string `json:"cronExpr,omitempty"`
	EverySeconds *int64  `json:"everySeconds,omitempty"`
	AtMS         *int64  `json:"atMs,omitempty"`
	DelaySeconds *int64  `json:"delaySeconds,omitempty"`
	Enabled      *bool   `json:"enabled,omitempty"`
	Command      *string `json:"command,omitempty"`
	Channel      *string `json:"channel,omitempty"`
	To           *string `json:"to,omitempty"`
}

type cronToggleRequest struct {
	Enabled bool `json:"enabled"`
}

type cronJobResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Message      string `json:"message"`
	ScheduleType string `json:"scheduleType"`
	Schedule     string `json:"schedule"`
	CronExpr     string `json:"cronExpr,omitempty"`
	EverySeconds *int64 `json:"everySeconds,omitempty"`
	AtMS         *int64 `json:"atMs,omitempty"`
	Command      string `json:"command,omitempty"`
	Enabled      bool   `json:"enabled"`
	Channel      string `json:"channel,omitempty"`
	To           string `json:"to,omitempty"`
	LastRunAtMS  *int64 `json:"lastRunAtMs,omitempty"`
	NextRunAtMS  *int64 `json:"nextRunAtMs,omitempty"`
	LastStatus   string `json:"lastStatus,omitempty"`
	LastError    string `json:"lastError,omitempty"`
	CreatedAtMS  int64  `json:"createdAtMs"`
	UpdatedAtMS  int64  `json:"updatedAtMs"`
}

func (h *Handler) registerCronRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/cron", h.handleListCronJobs)
	mux.HandleFunc("POST /api/cron", h.handleCreateCronJob)
	mux.HandleFunc("PUT /api/cron/{id}", h.handleUpdateCronJob)
	mux.HandleFunc("DELETE /api/cron/{id}", h.handleDeleteCronJob)
	mux.HandleFunc("POST /api/cron/{id}/toggle", h.handleToggleCronJob)
}

func (h *Handler) handleListCronJobs(w http.ResponseWriter, r *http.Request) {
	_, cs, err := h.newCronService()
	if err != nil {
		writeCronServiceError(w, err)
		return
	}
	if err := cs.Load(); err != nil {
		writeCronError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to load cron jobs: %v", err))
		return
	}

	includeDisabled := true
	rawIncludeDisabled := strings.TrimSpace(r.URL.Query().Get("include_disabled"))
	if rawIncludeDisabled != "" {
		parsed, parseErr := strconv.ParseBool(rawIncludeDisabled)
		if parseErr != nil {
			writeCronError(w, http.StatusBadRequest, "include_disabled must be true or false")
			return
		}
		includeDisabled = parsed
	}

	jobs := cs.ListJobs(includeDisabled)
	respJobs := make([]cronJobResponse, 0, len(jobs))
	for _, job := range jobs {
		respJobs = append(respJobs, buildCronJobResponse(job))
	}

	writeCronJSON(w, http.StatusOK, map[string]any{"jobs": respJobs})
}

func (h *Handler) handleCreateCronJob(w http.ResponseWriter, r *http.Request) {
	req, err := decodeCronJobRequest(r)
	if err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}

	name := strings.TrimSpace(derefString(req.Name))
	if name == "" {
		writeCronError(w, http.StatusBadRequest, "name is required")
		return
	}

	message := strings.TrimSpace(resolveCronMessage(req))
	if message == "" {
		writeCronError(w, http.StatusBadRequest, "description or message is required")
		return
	}

	nowMS := time.Now().UnixMilli()
	schedule, _, err := buildCronSchedule(req, nowMS, nil)
	if err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}

	channel := strings.TrimSpace(derefString(req.Channel))
	to := strings.TrimSpace(derefString(req.To))

	cfg, cs, err := h.newCronService()
	if err != nil {
		writeCronServiceError(w, err)
		return
	}
	if err := validateCronCommandPolicy(cfg, strings.TrimSpace(derefString(req.Command)), channel); err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}

	job, err := cs.AddJob(name, schedule, message, channel, to)
	if err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.Enabled != nil && !*req.Enabled {
		job = cs.EnableJob(job.ID, false)
		if job == nil {
			writeCronError(w, http.StatusInternalServerError, "Failed to disable cron job after creation")
			return
		}
	}

	if req.Command != nil {
		job.Payload.Command = strings.TrimSpace(*req.Command)
		if err := cs.UpdateJob(job); err != nil {
			writeCronError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := h.reloadGatewayCronRuntime(cfg); err != nil {
		writeCronError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeCronJSON(w, http.StatusCreated, map[string]any{"job": buildCronJobResponse(*job)})
}

func (h *Handler) handleUpdateCronJob(w http.ResponseWriter, r *http.Request) {
	req, err := decodeCronJobRequest(r)
	if err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}

	cfg, cs, err := h.newCronService()
	if err != nil {
		writeCronServiceError(w, err)
		return
	}

	jobID := r.PathValue("id")
	existing, found, err := findCronJobByID(cs, jobID)
	if err != nil {
		writeCronError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to load cron jobs: %v", err))
		return
	}
	if !found {
		writeCronError(w, http.StatusNotFound, fmt.Sprintf("Cron job %q not found", jobID))
		return
	}

	if req.Name != nil {
		existing.Name = strings.TrimSpace(*req.Name)
		if existing.Name == "" {
			writeCronError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
	}

	if req.Description != nil || req.Message != nil {
		existing.Payload.Message = strings.TrimSpace(resolveCronMessage(req))
		if existing.Payload.Message == "" {
			writeCronError(w, http.StatusBadRequest, "description or message cannot be empty")
			return
		}
	}

	schedule, scheduleChanged, err := buildCronSchedule(req, time.Now().UnixMilli(), &existing.Schedule)
	if err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}
	if scheduleChanged {
		existing.Schedule = schedule
	}

	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	if req.Command != nil {
		existing.Payload.Command = strings.TrimSpace(*req.Command)
	}
	if req.Channel != nil {
		existing.Payload.Channel = strings.TrimSpace(*req.Channel)
	}
	if req.To != nil {
		existing.Payload.To = strings.TrimSpace(*req.To)
	}
	if err := validateCronCommandPolicy(cfg, existing.Payload.Command, existing.Payload.Channel); err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := cs.UpdateJob(existing); err != nil {
		writeCronError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.reloadGatewayCronRuntime(cfg); err != nil {
		writeCronError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeCronJSON(w, http.StatusOK, map[string]any{"job": buildCronJobResponse(*existing)})
}

func (h *Handler) handleDeleteCronJob(w http.ResponseWriter, r *http.Request) {
	cfg, cs, err := h.newCronService()
	if err != nil {
		writeCronServiceError(w, err)
		return
	}

	jobID := r.PathValue("id")
	if !cs.RemoveJob(jobID) {
		writeCronError(w, http.StatusNotFound, fmt.Sprintf("Cron job %q not found", jobID))
		return
	}
	if err := h.reloadGatewayCronRuntime(cfg); err != nil {
		writeCronError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeCronJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) handleToggleCronJob(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeCronError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	var req cronToggleRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeCronError(w, http.StatusBadRequest, fmt.Sprintf("Invalid JSON: %v", err))
		return
	}

	cfg, cs, err := h.newCronService()
	if err != nil {
		writeCronServiceError(w, err)
		return
	}

	jobID := r.PathValue("id")
	job := cs.EnableJob(jobID, req.Enabled)
	if job == nil {
		writeCronError(w, http.StatusNotFound, fmt.Sprintf("Cron job %q not found", jobID))
		return
	}
	if err := h.reloadGatewayCronRuntime(cfg); err != nil {
		writeCronError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeCronJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"job":     buildCronJobResponse(*job),
	})
}

func (h *Handler) newCronService() (*config.Config, *cronpkg.CronService, error) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		return nil, nil, err
	}
	if !cfg.Tools.Cron.Enabled {
		return nil, nil, errCronDisabled
	}
	storePath := filepath.Join(cfg.WorkspacePath(), "cron", "jobs.json")
	return cfg, cronpkg.NewCronService(storePath, nil), nil
}

var errCronDisabled = fmt.Errorf("cron tool is disabled")
var gatewayReloadPost = func(url string, authToken string, timeout time.Duration) (*http.Response, error) {
	client := http.Client{Timeout: timeout}
	req, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		return nil, err
	}
	if authToken != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}
	return client.Do(req)
}

func writeCronServiceError(w http.ResponseWriter, err error) {
	if err == nil {
		writeCronError(w, http.StatusInternalServerError, "Failed to load cron store")
		return
	}
	if err == errCronDisabled {
		writeCronError(w, http.StatusServiceUnavailable, "cron tool is disabled")
		return
	}
	writeCronError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to load cron store: %v", err))
}

func buildCronJobResponse(job cronpkg.CronJob) cronJobResponse {
	resp := cronJobResponse{
		ID:           job.ID,
		Name:         job.Name,
		Description:  job.Payload.Message,
		Message:      job.Payload.Message,
		ScheduleType: job.Schedule.Kind,
		Command:      job.Payload.Command,
		Enabled:      job.Enabled,
		Channel:      job.Payload.Channel,
		To:           job.Payload.To,
		LastRunAtMS:  job.State.LastRunAtMS,
		NextRunAtMS:  job.State.NextRunAtMS,
		LastStatus:   job.State.LastStatus,
		LastError:    job.State.LastError,
		CreatedAtMS:  job.CreatedAtMS,
		UpdatedAtMS:  job.UpdatedAtMS,
	}

	switch job.Schedule.Kind {
	case "cron":
		resp.Schedule = job.Schedule.Expr
		resp.CronExpr = job.Schedule.Expr
	case "every":
		if job.Schedule.EveryMS != nil {
			everySeconds := *job.Schedule.EveryMS / 1000
			resp.EverySeconds = &everySeconds
		}
	case "at":
		resp.AtMS = job.Schedule.AtMS
	}

	return resp
}

func buildCronSchedule(req *cronJobRequest, nowMS int64, existing *cronpkg.CronSchedule) (cronpkg.CronSchedule, bool, error) {
	if req == nil {
		if existing == nil {
			return cronpkg.CronSchedule{}, false, fmt.Errorf("schedule is required")
		}
		return *existing, false, nil
	}

	if req.ScheduleType == nil && req.Schedule == nil && req.CronExpr == nil &&
		req.EverySeconds == nil && req.AtMS == nil && req.DelaySeconds == nil {
		if existing == nil {
			return cronpkg.CronSchedule{}, false, fmt.Errorf("schedule is required")
		}
		return *existing, false, nil
	}

	kind := strings.ToLower(strings.TrimSpace(derefString(req.ScheduleType)))

	if req.AtMS != nil || req.DelaySeconds != nil {
		if kind != "" && kind != "at" {
			return cronpkg.CronSchedule{}, false, fmt.Errorf("schedule_type must be 'at' for one-time jobs")
		}
		var atMS int64
		switch {
		case req.AtMS != nil:
			atMS = *req.AtMS
		case req.DelaySeconds != nil && *req.DelaySeconds > 0:
			atMS = nowMS + (*req.DelaySeconds * 1000)
		default:
			return cronpkg.CronSchedule{}, false, fmt.Errorf("delay_seconds must be greater than 0")
		}
		return cronpkg.CronSchedule{Kind: "at", AtMS: &atMS}, true, nil
	}

	if req.EverySeconds != nil {
		if kind != "" && kind != "every" {
			return cronpkg.CronSchedule{}, false, fmt.Errorf("schedule_type must be 'every' for interval jobs")
		}
		if *req.EverySeconds <= 0 {
			return cronpkg.CronSchedule{}, false, fmt.Errorf("every_seconds must be greater than 0")
		}
		everyMS := *req.EverySeconds * 1000
		return cronpkg.CronSchedule{Kind: "every", EveryMS: &everyMS}, true, nil
	}

	if req.CronExpr != nil || req.Schedule != nil || kind == "cron" || kind == "" {
		expr := strings.TrimSpace(derefString(req.CronExpr))
		if expr == "" {
			expr = strings.TrimSpace(derefString(req.Schedule))
		}
		if expr == "" {
			if kind == "" && existing != nil {
				return *existing, false, nil
			}
			return cronpkg.CronSchedule{}, false, fmt.Errorf("cron schedule requires schedule or cron_expr")
		}
		return cronpkg.CronSchedule{Kind: "cron", Expr: expr}, true, nil
	}

	return cronpkg.CronSchedule{}, false, fmt.Errorf("unsupported schedule_type %q", kind)
}

func decodeCronJobRequest(r *http.Request) (*cronJobRequest, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("Failed to read request body")
	}
	defer r.Body.Close()

	var req cronJobRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, fmt.Errorf("Invalid JSON: %v", err)
	}
	return &req, nil
}

func findCronJobByID(cs *cronpkg.CronService, jobID string) (*cronpkg.CronJob, bool, error) {
	if err := cs.Load(); err != nil {
		return nil, false, err
	}
	jobs := cs.ListJobs(true)
	for i := range jobs {
		if jobs[i].ID == jobID {
			jobCopy := jobs[i]
			return &jobCopy, true, nil
		}
	}
	return nil, false, nil
}

func resolveCronMessage(req *cronJobRequest) string {
	if req == nil {
		return ""
	}
	if req.Message != nil {
		return *req.Message
	}
	return derefString(req.Description)
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func validateCronCommandPolicy(cfg *config.Config, command string, channel string) error {
	command = strings.TrimSpace(command)
	channel = strings.TrimSpace(channel)
	if command == "" {
		return nil
	}
	if cfg == nil {
		return fmt.Errorf("missing cron configuration")
	}
	if !cfg.Tools.Exec.Enabled {
		return fmt.Errorf("command execution is disabled")
	}
	if !constants.IsInternalChannel(channel) {
		return fmt.Errorf("scheduling command execution is restricted to internal channels")
	}
	if !cfg.Tools.Cron.AllowCommand {
		return fmt.Errorf("command_confirm=true is required when allow_command is disabled")
	}
	return nil
}

func (h *Handler) reloadGatewayCronRuntime(cfg *config.Config) error {
	gateway.mu.Lock()
	runtimePIDData := gateway.pidData
	runtimeState := gatewayStatusWithoutHealthLocked()
	gateway.mu.Unlock()

	if runtimeState != "running" {
		return nil
	}

	baseURL := h.currentGatewayBaseURL(cfg, runtimePIDData)
	reloadURL := strings.TrimRight(baseURL, "/") + "/reload"
	authToken := ""
	if runtimePIDData != nil {
		authToken = strings.TrimSpace(runtimePIDData.Token)
	}

	resp, err := gatewayReloadPost(reloadURL, authToken, 3*time.Second)
	if err != nil {
		return fmt.Errorf("cron job saved but gateway reload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = resp.Status
		}
		return fmt.Errorf("cron job saved but gateway reload failed: %s", message)
	}

	return nil
}

func writeCronJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeCronError(w http.ResponseWriter, status int, message string) {
	writeCronJSON(w, status, map[string]string{"message": message})
}
