//go:build webhook

package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/joho/godotenv"
)

/*
	webhook.go — Official WhatsApp Management (Webhook + Bulk Sender)

	Receives status updates from WhatsApp and provides a GUI to:
	  1. Configure & trigger concurrent sending campaigns.
	  2. View statistics & live delivery logs.

	File Structure:
	  webhook.go   — Main entry point, HTTP routes, webhook & dashboard handlers
	  db.go        — Database init, schema, CRUD operations
	  templates.go — Template pool, Meta API fetching, fallback logic
	  campaign.go  — Campaign runner, broadcast logging, message sending
*/

func getConfigFile() string {
	f := os.Getenv("CONFIG_FILE")
	if f == "" {
		return "config.json"
	}
	return f
}

// --- Middlewares ---

// FIX #13: Request logging middleware
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/campaign-logs" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Microsecond))
	})
}

// FIX #14: CORS headers middleware
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// FIX #15: Validate phone numbers before sending
func validatePhone(phone string) string {
	var digits strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	c := digits.String()
	// WhatsApp requires country code (e.g. 91XXXXXXXXXX = 12 digits for India)
	if len(c) >= 11 && len(c) <= 15 {
		return c
	}
	return ""
}

// --- HTTP Route Handlers ---

func handleStartCampaign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}

	campaignMu.Lock()
	defer campaignMu.Unlock()

	if atomic.LoadInt32(&isCampaignRunning) == 1 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		json.NewEncoder(w).Encode(map[string]string{"error": "A campaign is already running"})
		return
	}

	var req CampaignConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}

	if req.CampaignName == "" {
		req.CampaignName = "Campaign"
	}
	if req.Workers <= 0 {
		req.Workers = 40
	}

	ctx, cancel := context.WithCancel(context.Background())
	campaignCancel = cancel

	campaignWg.Add(1)
	go func() {
		defer campaignWg.Done()
		runCampaign(ctx, req)
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}

func handleStopCampaign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}

	campaignMu.Lock()
	defer campaignMu.Unlock()

	if atomic.LoadInt32(&isCampaignRunning) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		json.NewEncoder(w).Encode(map[string]string{"error": "No campaign is currently running"})
		return
	}

	broadcastLog("🛑 Stopping campaign manually...\n")
	if campaignCancel != nil {
		campaignCancel()
	}

	go func() {
		campaignWg.Wait()
		broadcastLog("🛑 Campaign fully stopped.\n")
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopping"})
}

func handleCampaignStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	running := atomic.LoadInt32(&isCampaignRunning) == 1
	campaignMu.Lock()
	campID := activeCampaignID
	campaignMu.Unlock()

	var lastCampID string
	if campID == "" && db != nil {
		db.QueryRow(`SELECT id FROM campaigns ORDER BY started_at DESC LIMIT 1`).Scan(&lastCampID)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"running":          running,
		"campaign_id":      campID,
		"last_campaign_id": lastCampID,
	})
}

func handleGetCampaignLogs(w http.ResponseWriter, r *http.Request) {
	campaignID := r.URL.Query().Get("campaign")
	w.Header().Set("Content-Type", "application/json")
	if campaignID == "" {
		json.NewEncoder(w).Encode([]string{})
		return
	}

	rows, err := db.Query(`SELECT log_line FROM campaign_logs WHERE campaign_id = ? ORDER BY id ASC`, campaignID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	logs := []string{}
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err == nil {
			logs = append(logs, line)
		}
	}

	json.NewEncoder(w).Encode(logs)
}

func handleCampaignLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	client := make(LogClient, 100)

	logClientsMu.Lock()
	logClients[client] = true
	logClientsMu.Unlock()

	defer func() {
		logClientsMu.Lock()
		delete(logClients, client)
		logClientsMu.Unlock()
		close(client)
	}()

	// Stream history
	logHistoryMu.Lock()
	for _, logLine := range logHistory {
		fmt.Fprintf(w, "data: %s\n\n", logLine)
	}
	logHistoryMu.Unlock()
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case logLine, ok := <-client:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", logLine)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		case <-ticker.C:
			fmt.Fprintf(w, ": ping\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		case <-r.Context().Done():
			return
		}
	}
}

func handleTemplates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// FIX #8: removed duplicate godotenv.Load() — already loaded in main()
	token := os.Getenv("WHATSAPP_TOKEN")
	wabaID := os.Getenv("WABA_ID")
	apiVer := os.Getenv("API_VERSION")
	if apiVer == "" {
		apiVer = "v25.0"
	}

	var details []TemplateDetail
	if token != "" && wabaID != "" {
		url := fmt.Sprintf("https://graph.facebook.com/%s/%s/message_templates?limit=1000", apiVer, wabaID)
		req, err := http.NewRequest("GET", url, nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+token)
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Do(req)
			if err == nil && resp.StatusCode == 200 {
				var result struct {
					Data []struct {
						Name       string        `json:"name"`
						Status     string        `json:"status"`
						Components []interface{} `json:"components"`
					} `json:"data"`
				}
				if json.NewDecoder(resp.Body).Decode(&result) == nil {
					for _, t := range result.Data {
						if t.Status == "APPROVED" {
							details = append(details, TemplateDetail{
								Name:       t.Name,
								Components: t.Components,
							})
						}
					}
				}
				resp.Body.Close()
			}
		}
	}

	if len(details) == 0 {
		names := loadFallbackTemplates()
		for _, name := range names {
			details = append(details, TemplateDetail{
				Name:       name,
				Components: defaultFallbackComponents, // FIX #7: use shared constant
			})
		}
	}

	json.NewEncoder(w).Encode(details)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	campaignID := r.URL.Query().Get("campaign")
	if campaignID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"campaign":      "",
			"total":         0,
			"sent":          0,
			"delivered":     0,
			"read":          0,
			"failed":        0,
			"clicks":        0,
			"stops":         0,
			"delivery_rate": "0.0%",
			"read_rate":     "0.0%",
			"speed":         0,
		})
		return
	}

	var total, sent, delivered, readCount, failed int
	// Get total campaign size from campaigns table
	db.QueryRow(`SELECT total FROM campaigns WHERE id = ?`, campaignID).Scan(&total)
	if total == 0 {
		// Fallback to sends count if campaign record not found or total is 0
		db.QueryRow(`SELECT COUNT(*) FROM sends WHERE campaign_id = ?`, campaignID).Scan(&total)
	}

	db.QueryRow(`SELECT 
		COUNT(CASE WHEN status IN ('SENT','DELIVERED','READ') THEN 1 END),
		COUNT(CASE WHEN status IN ('DELIVERED','READ') THEN 1 END),
		COUNT(CASE WHEN status = 'READ' THEN 1 END),
		COUNT(CASE WHEN status = 'FAILED' THEN 1 END)
		FROM sends WHERE campaign_id = ?`, campaignID).
		Scan(&sent, &delivered, &readCount, &failed)

	var durationSecs float64
	db.QueryRow(`SELECT (coalesce(julianday(finished_at), julianday('now')) - julianday(started_at)) * 86400.0 FROM campaigns WHERE id = ?`, campaignID).Scan(&durationSecs)

	processed := sent + failed
	if durationSecs <= 0.05 {
		durationSecs = 0.05
	}
	speed := float64(processed) / durationSecs * 60.0

	var clicks, stops int
	db.QueryRow(`SELECT COUNT(*) FROM replies WHERE campaign_id = ? AND (
		((msg_type = 'button' OR msg_type = 'interactive') AND (LOWER(text) LIKE '%stop%' OR LOWER(text) LIKE '%block%')) OR 
		(msg_type = 'text' AND (LOWER(text) = 'stop' OR LOWER(text) = 'block' OR LOWER(text) LIKE '%stop%'))
	)`, campaignID).Scan(&stops)

	db.QueryRow(`SELECT COUNT(*) FROM replies WHERE campaign_id = ? AND (msg_type = 'button' OR msg_type = 'interactive') AND NOT (LOWER(text) LIKE '%stop%' OR LOWER(text) LIKE '%block%')`, campaignID).Scan(&clicks)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"campaign":      campaignID,
		"total":         total,
		"sent":          sent,
		"delivered":     delivered,
		"read":          readCount,
		"failed":        failed,
		"clicks":        clicks,
		"stops":         stops,
		"delivery_rate": fmt.Sprintf("%.1f%%", pct(delivered, total)),
		"read_rate":     fmt.Sprintf("%.1f%%", pct(readCount, total)),
		"speed":         int(speed),
	})
}

func handleSummary(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT status, COUNT(*) FROM sends GROUP BY status ORDER BY COUNT(*) DESC`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type SC struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	}
	var counts []SC
	for rows.Next() {
		var sc SC
		rows.Scan(&sc.Status, &sc.Count)
		counts = append(counts, sc)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(counts)
}

func handleStatuses(w http.ResponseWriter, r *http.Request) {
	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "100"
	}
	status := r.URL.Query().Get("status")
	campaignID := r.URL.Query().Get("campaign")

	var rows *sql.Rows
	var err error
	if campaignID != "" {
		if status != "" {
			rows, err = db.Query(`SELECT phone, template, wamid, status, error, sent_at,
				COALESCE(delivered_at,''), COALESCE(read_at,'')
				FROM sends WHERE campaign_id = ? AND status = ? ORDER BY id DESC LIMIT ?`, campaignID, status, limit)
		} else {
			rows, err = db.Query(`SELECT phone, template, wamid, status, error, sent_at,
				COALESCE(delivered_at,''), COALESCE(read_at,'')
				FROM sends WHERE campaign_id = ? ORDER BY id DESC LIMIT ?`, campaignID, limit)
		}
	} else {
		if status != "" {
			rows, err = db.Query(`SELECT phone, template, wamid, status, error, sent_at,
				COALESCE(delivered_at,''), COALESCE(read_at,'')
				FROM sends WHERE status = ? ORDER BY id DESC LIMIT ?`, status, limit)
		} else {
			rows, err = db.Query(`SELECT phone, template, wamid, status, error, sent_at,
				COALESCE(delivered_at,''), COALESCE(read_at,'')
				FROM sends ORDER BY id DESC LIMIT ?`, limit)
		}
	}
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	type R struct {
		Phone       string `json:"phone"`
		Template    string `json:"template"`
		Wamid       string `json:"wamid"`
		Status      string `json:"status"`
		Error       string `json:"error"`
		SentAt      string `json:"sent_at"`
		DeliveredAt string `json:"delivered_at"`
		ReadAt      string `json:"read_at"`
	}
	var results []R
	for rows.Next() {
		var row R
		rows.Scan(&row.Phone, &row.Template, &row.Wamid, &row.Status, &row.Error, &row.SentAt, &row.DeliveredAt, &row.ReadAt)
		results = append(results, row)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// --- Webhook Processing ---
func processWebhook(body []byte) {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return
	}

	entries, _ := payload["entry"].([]interface{})
	for _, entry := range entries {
		changes, _ := entry.(map[string]interface{})["changes"].([]interface{})
		for _, change := range changes {
			value, _ := change.(map[string]interface{})["value"].(map[string]interface{})
			if value == nil {
				continue
			}

			rawStatuses, _ := value["statuses"].([]interface{})
			for _, rawSt := range rawStatuses {
				st, ok := rawSt.(map[string]interface{})
				if !ok {
					continue
				}

				wamid, _ := st["id"].(string)
				recipient, _ := st["recipient_id"].(string)
				status, _ := st["status"].(string)

				errCode, errTitle := "", ""
				if errors, ok := st["errors"].([]interface{}); ok && len(errors) > 0 {
					errObj, _ := errors[0].(map[string]interface{})
					if c, ok := errObj["code"].(float64); ok {
						errCode = strconv.Itoa(int(c))
					}
					errTitle, _ = errObj["title"].(string)
				}

				metaTS := time.Now().UTC()
				if tsStr, ok := st["timestamp"].(string); ok {
					tsVal, _ := strconv.ParseInt(tsStr, 10, 64)
					if tsVal > 0 {
						metaTS = time.Unix(tsVal, 0).UTC()
					}
				}

				db.Exec(`INSERT OR IGNORE INTO statuses (wamid, phone, status, error_code, error_title, timestamp)
					VALUES (?, ?, ?, ?, ?, ?)`, wamid, recipient, status, errCode, errTitle, metaTS.Format("2006-01-02 15:04:05"))

				switch status {
				case "sent":
					db.Exec(`UPDATE sends SET status = 'SENT' WHERE wamid = ? AND status NOT IN ('DELIVERED','READ')`, wamid)
				case "delivered":
					db.Exec(`UPDATE sends SET status = 'DELIVERED', delivered_at = ? WHERE wamid = ?`, metaTS.Format("2006-01-02 15:04:05"), wamid)
				case "read":
					db.Exec(`UPDATE sends SET status = 'READ', read_at = ? WHERE wamid = ?`, metaTS.Format("2006-01-02 15:04:05"), wamid)
				case "failed":
					db.Exec(`UPDATE sends SET status = 'FAILED', error = ?, failed_at = ? WHERE wamid = ?`,
						errCode+": "+errTitle, metaTS.Format("2006-01-02 15:04:05"), wamid)
				}

				emoji := map[string]string{"sent": "📤", "delivered": "📬", "read": "👀", "failed": "❌"}
				e := emoji[status]
				if e == "" {
					e = "📋"
				}
				broadcastLog("%s %s → %s [%s]\n", e, recipient, status, wamid)
			}

			messages, _ := value["messages"].([]interface{})
			for _, rawMsg := range messages {
				msg, ok := rawMsg.(map[string]interface{})
				if !ok {
					continue
				}
				from, _ := msg["from"].(string)
				msgType, _ := msg["type"].(string)
				text := ""
				if msgType == "text" {
					if textObj, ok := msg["text"].(map[string]interface{}); ok {
						text, _ = textObj["body"].(string)
					}
				} else if msgType == "button" {
					if btnObj, ok := msg["button"].(map[string]interface{}); ok {
						text, _ = btnObj["text"].(string)
					}
				} else if msgType == "interactive" {
					if interactiveObj, ok := msg["interactive"].(map[string]interface{}); ok {
						if btnReply, ok := interactiveObj["button_reply"].(map[string]interface{}); ok {
							text, _ = btnReply["title"].(string)
						}
					}
				}
				broadcastLog("💬 Incoming from %s: [%s] %s\n", from, msgType, text)

				contacts, _ := value["contacts"].([]interface{})
				if len(contacts) > 0 {
					if c, ok := contacts[0].(map[string]interface{}); ok {
						if profile, ok := c["profile"].(map[string]interface{}); ok {
							profileName, _ := profile["name"].(string)
							if profileName != "" {
								db.Exec(`INSERT OR REPLACE INTO contacts (phone, name) VALUES (?, ?)`, from, profileName)
							}
						}
					}
				}

				var campaignID string = "default"
				db.QueryRow(`SELECT campaign_id FROM sends WHERE phone = ? ORDER BY sent_at DESC LIMIT 1`, from).Scan(&campaignID)

				msgTS := time.Now().UTC()
				if tsStr, ok := msg["timestamp"].(string); ok {
					tsVal, _ := strconv.ParseInt(tsStr, 10, 64)
					if tsVal > 0 {
						msgTS = time.Unix(tsVal, 0).UTC()
					}
				}
				db.Exec(`INSERT INTO replies (campaign_id, phone, msg_type, text, direction, timestamp) VALUES (?, ?, ?, ?, 'incoming', ?)`,
					campaignID, from, msgType, text, msgTS.Format("2006-01-02 15:04:05"))
			}
		}
	}
}

// --- Helper Functions ---
func cleanPhoneNumber(str string) string {
	var cleaned strings.Builder
	for _, r := range str {
		if r >= '0' && r <= '9' {
			cleaned.WriteRune(r)
		}
	}
	c := cleaned.String()
	if len(c) >= 10 && len(c) <= 15 {
		return c
	}
	return ""
}

func isNumeric(str string) bool {
	_, err := strconv.Atoi(str)
	return err == nil
}

var fallbackNames = []string{
	"Nitesh Sharma", "Priya Patel", "Rahul Gupta", "Ananya Iyer", "Amit Verma",
	"Sneha Rao", "Vikram Malhotra", "Karan Johar", "Rohan Mehta", "Neha Kapoor",
	"Aman Singh", "Divya Sharma", "Abhishek Goel", "Meera Nair", "Siddharth Roy",
}

func getFallbackName() string {
	randIdx := time.Now().UnixNano() % int64(len(fallbackNames))
	return fallbackNames[randIdx]
}

func getFirstContactName(numbersStr string) string {
	if numbersStr == "" {
		return getFallbackName()
	}

	lines := strings.Split(numbersStr, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		parts := strings.FieldsFunc(trimmed, func(r rune) bool {
			return r == ',' || r == ';' || r == '\t'
		})

		var nameCandidate string
		var phone string

		for _, part := range parts {
			trimmedPart := strings.TrimSpace(part)
			if trimmedPart == "" {
				continue
			}

			cleaned := cleanPhoneNumber(trimmedPart)
			if cleaned != "" && phone == "" {
				phone = cleaned
			} else if cleaned == "" && nameCandidate == "" {
				if len(trimmedPart) > 1 && !strings.Contains(trimmedPart, "@") && !isNumeric(trimmedPart) {
					nameCandidate = trimmedPart
				}
			}
		}

		if nameCandidate != "" {
			return nameCandidate
		}
	}
	return getFallbackName()
}

func getAvatarUrl(name string) string {
	firstWord := strings.Split(name, " ")[0]
	if firstWord == "" {
		firstWord = "user"
	}
	return "https://api.dicebear.com/7.x/lorelei/svg?seed=" + url.QueryEscape(firstWord)
}

func getAvatarHtml(name string) string {
	urlVal := getAvatarUrl(name)
	return `<img src="` + urlVal + `" style="width: 100%; height: 100%; display: block; object-fit: cover;" alt="avatar" onerror="this.outerHTML='<i data-lucide=&quot;user&quot; style=&quot;width: 16px; height: 16px; color: #54656f;&quot;></i>'">`
}

// --- Dashboard & Config Handlers ---

type SavedMessageConfig struct {
	CampaignName string `json:"campaignName"`
	Template     string `json:"template"`
	Var1         string `json:"var1"`
	Var2         string `json:"var2"`
	Var3         string `json:"var3"`
	Var4         string `json:"var4"`
	ButtonParam  string `json:"buttonParam"`
	Numbers      string `json:"numbers"`
}

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	campaigns := []string{}
	rows, err := db.Query(`SELECT id FROM campaigns ORDER BY started_at DESC`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id string
			rows.Scan(&id)
			campaigns = append(campaigns, id)
		}
	}

	rows2, _ := db.Query(`SELECT DISTINCT campaign_id FROM sends ORDER BY id DESC LIMIT 20`)
	if rows2 != nil {
		defer rows2.Close()
		seen := map[string]bool{}
		for _, c := range campaigns {
			seen[c] = true
		}
		for rows2.Next() {
			var id string
			rows2.Scan(&id)
			if !seen[id] {
				campaigns = append(campaigns, id)
			}
		}
	}

	campaignOptionsHtml := ""
	selectedVal := ""
	selectedLabel := ""
	if len(campaigns) > 0 {
		selectedVal = campaigns[0]
		selectedLabel = campaigns[0]
	}

	for i, c := range campaigns {
		selectedClass := ""
		checkmarkHtml := ""
		if i == 0 {
			selectedClass = " selected"
			checkmarkHtml = `<i data-lucide="check" class="lucide-check" style="width:14px; height:14px; color: #10b981;"></i>`
		}
		campaignOptionsHtml += fmt.Sprintf(`<div class="custom-select-option%s" data-value="%s" onclick="selectCampaignOption('%s', '%s')"><span>%s</span>%s</div>`, selectedClass, c, c, c, c, checkmarkHtml)
	}

	dashboardPath := "src/frontend/dashboard.html"
	if _, err := os.Stat(dashboardPath); err != nil {
		dashboardPath = "frontend/dashboard.html"
	}
	htmlData, err := os.ReadFile(dashboardPath)
	if err != nil {
		http.Error(w, "❌ dashboard.html not found: "+err.Error(), 500)
		return
	}

	// Load campaign config from config.json
	var fullCfg struct {
		Campaign SavedMessageConfig `json:"campaign"`
	}
	configBytes, err := os.ReadFile(getConfigFile())
	if err == nil {
		json.Unmarshal(configBytes, &fullCfg)
	}
	config := fullCfg.Campaign

	port := os.Getenv("WEBHOOK_PORT")
	if port == "" {
		port = "9090"
	}

	// Inject campaign configuration into HTML template
	htmlContent := string(htmlData)
	htmlContent = strings.Replace(htmlContent, "{{CAMPAIGN_OPTIONS_HTML}}", campaignOptionsHtml, 1)
	htmlContent = strings.Replace(htmlContent, "{{CAMPAIGN_SELECTED_VALUE}}", html.EscapeString(selectedVal), 1)
	htmlContent = strings.Replace(htmlContent, "{{CAMPAIGN_SELECTED_LABEL}}", html.EscapeString(selectedLabel), 1)
	htmlContent = strings.Replace(htmlContent, "{{PORT}}", port, 1)

	recipientName := getFirstContactName(config.Numbers)
	avatarHtml := getAvatarHtml(recipientName)

	htmlContent = strings.Replace(htmlContent, "{{CAMPAIGN_NAME}}", html.EscapeString(config.CampaignName), 1)
	htmlContent = strings.Replace(htmlContent, "{{VAR1}}", html.EscapeString(config.Var1), 1)
	htmlContent = strings.Replace(htmlContent, "{{VAR2}}", html.EscapeString(config.Var2), 1)
	htmlContent = strings.Replace(htmlContent, "{{VAR3}}", html.EscapeString(config.Var3), 1)
	htmlContent = strings.Replace(htmlContent, "{{VAR4}}", html.EscapeString(config.Var4), 1)
	htmlContent = strings.Replace(htmlContent, "{{BUTTON_PARAM}}", html.EscapeString(config.ButtonParam), 1)
	htmlContent = strings.Replace(htmlContent, "{{NUMBERS}}", html.EscapeString(config.Numbers), 1)
	htmlContent = strings.Replace(htmlContent, "{{RECIPIENT_NAME}}", html.EscapeString(recipientName), 1)
	htmlContent = strings.Replace(htmlContent, "{{AVATAR_HTML}}", avatarHtml, 1)

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(htmlContent))
}

func handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error": "Failed to read request body"}`, http.StatusBadRequest)
		return
	}

	var config SavedMessageConfig
	if err := json.Unmarshal(body, &config); err != nil {
		http.Error(w, `{"error": "Invalid JSON"}`, http.StatusBadRequest)
		return
	}

	// Read existing config.json, update the campaign sub-object
	cfgData, _ := os.ReadFile(getConfigFile())
	var cfgMap map[string]interface{}
	if json.Unmarshal(cfgData, &cfgMap) != nil {
		cfgMap = map[string]interface{}{}
	}
	cfgMap["campaign"] = config
	updated, err := json.MarshalIndent(cfgMap, "", "  ")
	if err != nil {
		http.Error(w, `{"error": "Failed to marshal JSON"}`, http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(getConfigFile(), updated, 0644); err != nil {
		http.Error(w, `{"error": "Failed to write config: `+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"success": true}`))
}

func handleLoadConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if _, err := os.Stat(getConfigFile()); os.IsNotExist(err) {
		w.Write([]byte(`{}`))
		return
	}

	data, err := os.ReadFile(getConfigFile())
	if err != nil {
		http.Error(w, `{"error": "Failed to read config"}`, http.StatusInternalServerError)
		return
	}

	var fullCfg struct {
		Campaign json.RawMessage `json:"campaign"`
	}
	if json.Unmarshal(data, &fullCfg) != nil || fullCfg.Campaign == nil {
		w.Write([]byte(`{}`))
		return
	}
	w.Write(fullCfg.Campaign)
}

func handleReplies(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "50"
	}
	campaignID := r.URL.Query().Get("campaign")

	var rows *sql.Rows
	var err error
	if campaignID != "" {
		rows, err = db.Query(`SELECT phone, msg_type, text, timestamp FROM replies WHERE campaign_id = ? ORDER BY id DESC LIMIT ?`, campaignID, limit)
	} else {
		rows, err = db.Query(`SELECT phone, msg_type, text, timestamp FROM replies ORDER BY id DESC LIMIT ?`, limit)
	}
	if err != nil {
		errJSON, _ := json.Marshal(err.Error())
		http.Error(w, `{"error": `+string(errJSON)+`}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ReplyRow struct {
		Phone     string `json:"phone"`
		MsgType   string `json:"msg_type"`
		Text      string `json:"text"`
		Timestamp string `json:"timestamp"`
	}

	var results []ReplyRow = []ReplyRow{}
	for rows.Next() {
		var row ReplyRow
		rows.Scan(&row.Phone, &row.MsgType, &row.Text, &row.Timestamp)
		results = append(results, row)
	}

	json.NewEncoder(w).Encode(results)
}

func sendTextDirect(to, text string) (bool, string) {
	// FIX #8: removed duplicate godotenv.Load() — already loaded in main()
	token := os.Getenv("WHATSAPP_TOKEN")
	phoneID := os.Getenv("PHONE_NUMBER_ID")
	apiVer := os.Getenv("API_VERSION")
	if apiVer == "" {
		apiVer = "v25.0"
	}

	if token == "" || phoneID == "" {
		return false, "WHATSAPP_TOKEN or PHONE_NUMBER_ID not set in .env"
	}

	apiURL := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", apiVer, phoneID)
	payload := map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "text",
		"text": map[string]string{
			"body": text,
		},
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", apiURL, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return false, string(respBody)
	}

	var result struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	wamid := ""
	if json.Unmarshal(respBody, &result) == nil && len(result.Messages) > 0 {
		wamid = result.Messages[0].ID
	}

	return true, wamid
}

func handleChats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var totalMessages int
	_ = db.QueryRow(`SELECT COUNT(*) FROM replies`).Scan(&totalMessages)
	w.Header().Set("X-Total-Messages", fmt.Sprintf("%d", totalMessages))

	var totalContacts int
	_ = db.QueryRow(`SELECT COUNT(*) FROM contacts`).Scan(&totalContacts)
	w.Header().Set("X-Total-Contacts", fmt.Sprintf("%d", totalContacts))

	rows, err := db.Query(`
		SELECT c.phone, COALESCE(con.name, '') as name, MAX(c.timestamp) as last_time, c.text, c.direction,
			(SELECT COUNT(*) FROM replies r WHERE r.phone = c.phone AND r.direction = 'incoming' AND r.is_read = 0) as unread_count
		FROM (
			SELECT phone, timestamp, text, direction FROM replies
			UNION ALL
			SELECT phone, sent_at as timestamp, 'Template: ' || template as text, 'outgoing' as direction FROM sends
		) c
		LEFT JOIN contacts con ON c.phone = con.phone
		GROUP BY c.phone 
		ORDER BY last_time DESC
	`)
	if err != nil {
		errJSON, _ := json.Marshal(err.Error())
		http.Error(w, `{"error": `+string(errJSON)+`}`, 500)
		return
	}
	defer rows.Close()

	type ChatRow struct {
		Phone       string `json:"phone"`
		Name        string `json:"name"`
		LastTime    string `json:"last_time"`
		Text        string `json:"text"`
		Direction   string `json:"direction"`
		UnreadCount int    `json:"unread_count"`
	}

	results := []ChatRow{}
	for rows.Next() {
		var row ChatRow
		rows.Scan(&row.Phone, &row.Name, &row.LastTime, &row.Text, &row.Direction, &row.UnreadCount)
		results = append(results, row)
	}

	json.NewEncoder(w).Encode(results)
}

func handleChatHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	phone := r.URL.Query().Get("phone")
	if phone == "" {
		http.Error(w, `{"error": "Missing phone parameter"}`, 400)
		return
	}

	db.Exec(`UPDATE replies SET is_read = 1 WHERE phone = ? AND direction = 'incoming'`, phone)

	rows, err := db.Query(`
		SELECT id, msg_type, text, direction, datetime(timestamp) as timestamp FROM (
			SELECT id, msg_type, text, direction, timestamp FROM replies WHERE phone = ?
			UNION ALL
			SELECT id, 'template' as msg_type, 'Sent Template: ' || template as text, 'outgoing' as direction, sent_at as timestamp FROM sends WHERE phone = ?
		)
		ORDER BY timestamp ASC
	`, phone, phone)
	if err != nil {
		errJSON, _ := json.Marshal(err.Error())
		http.Error(w, `{"error": `+string(errJSON)+`}`, 500)
		return
	}
	defer rows.Close()

	type HistoryRow struct {
		ID        int    `json:"id"`
		MsgType   string `json:"msg_type"`
		Text      string `json:"text"`
		Direction string `json:"direction"`
		Timestamp string `json:"timestamp"`
	}

	results := []HistoryRow{}
	for rows.Next() {
		var row HistoryRow
		rows.Scan(&row.ID, &row.MsgType, &row.Text, &row.Direction, &row.Timestamp)
		if !strings.Contains(row.Timestamp, "T") && row.Timestamp != "" {
			row.Timestamp = strings.Replace(row.Timestamp, " ", "T", 1) + "Z"
		}
		results = append(results, row)
	}

	json.NewEncoder(w).Encode(results)
}

func handleSendMessage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Phone string `json:"phone"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, 400)
		return
	}

	if req.Phone == "" || req.Text == "" {
		http.Error(w, `{"error": "Missing phone or text"}`, 400)
		return
	}

	success, detail := sendTextDirect(req.Phone, req.Text)
	if !success {
		http.Error(w, `{"error": "`+detail+`"}`, 500)
		return
	}

	_, err := db.Exec(`
		INSERT INTO replies (campaign_id, phone, msg_type, text, direction, timestamp) 
		VALUES ('direct', ?, 'text', ?, 'outgoing', ?)
	`, req.Phone, req.Text, time.Now().UTC().Format("2006-01-02 15:04:05"))
	if err != nil {
		http.Error(w, `{"error": "Failed to log message: `+err.Error()+`"}`, 500)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "wamid": detail})
}

func handleSaveContact(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Phone string `json:"phone"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, 400)
		return
	}

	if req.Phone == "" {
		http.Error(w, `{"error": "Missing phone"}`, 400)
		return
	}

	_, err := db.Exec(`INSERT OR REPLACE INTO contacts (phone, name) VALUES (?, ?)`, req.Phone, req.Name)
	if err != nil {
		http.Error(w, `{"error": "Failed to save contact: `+err.Error()+`"}`, 500)
		return
	}

	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleDeleteChat(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, 400)
		return
	}

	if req.Phone == "" {
		http.Error(w, `{"error": "Missing phone"}`, 400)
		return
	}

	// Delete from replies
	_, err := db.Exec(`DELETE FROM replies WHERE phone = ?`, req.Phone)
	if err != nil {
		errJSON, _ := json.Marshal(err.Error())
		http.Error(w, `{"error": `+string(errJSON)+`}`, 500)
		return
	}

	// Delete from sends
	_, _ = db.Exec(`DELETE FROM sends WHERE phone = ?`, req.Phone)

	// Delete from contacts
	_, _ = db.Exec(`DELETE FROM contacts WHERE phone = ?`, req.Phone)

	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func handleDeleteAllChats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	// Delete all replies
	_, err := db.Exec(`DELETE FROM replies`)
	if err != nil {
		errJSON, _ := json.Marshal(err.Error())
		http.Error(w, `{"error": `+string(errJSON)+`}`, 500)
		return
	}

	// Delete all sends
	_, _ = db.Exec(`DELETE FROM sends`)

	// Delete all contacts
	_, _ = db.Exec(`DELETE FROM contacts`)

	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// --- Main Entry Point ---
func main() {
	_ = godotenv.Load() // FIX #8: single load, no duplicates

	port := os.Getenv("WEBHOOK_PORT")
	if port == "" {
		port = "9090"
	}
	verifyToken := os.Getenv("WEBHOOK_VERIFY_TOKEN")
	if verifyToken == "" {
		verifyToken = "token_verify_2026"
	}

	initDB()

	// Create router mux
	mux := http.NewServeMux()

	// Webhook endpoints
	mux.HandleFunc("/webhook", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			mode := r.URL.Query().Get("hub.mode")
			token := r.URL.Query().Get("hub.verify_token")
			challenge := r.URL.Query().Get("hub.challenge")
			if mode == "subscribe" && token == verifyToken {
				w.WriteHeader(200)
				w.Write([]byte(challenge))
				fmt.Println("✅ Webhook verified by Meta")
				return
			}
			w.WriteHeader(403)
			return
		}

		if r.Method == http.MethodPost {
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
			if err != nil {
				w.WriteHeader(413)
				return
			}
			w.WriteHeader(200)
			go processWebhook(body)
			return
		}
		w.WriteHeader(405)
	})

	// Stats endpoints
	mux.HandleFunc("/stats", handleStats)
	mux.HandleFunc("/summary", handleSummary)
	mux.HandleFunc("/statuses", handleStatuses)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// API logic endpoints
	mux.HandleFunc("/api/start-campaign", handleStartCampaign)
	mux.HandleFunc("/api/stop-campaign", handleStopCampaign)
	mux.HandleFunc("/api/campaign-status", handleCampaignStatus)
	mux.HandleFunc("/api/campaign-logs", handleCampaignLogs)
	mux.HandleFunc("/api/get-campaign-logs", handleGetCampaignLogs)
	mux.HandleFunc("/api/templates", handleTemplates)
	mux.HandleFunc("/api/save-config", handleSaveConfig)
	mux.HandleFunc("/api/load-config", handleLoadConfig)
	mux.HandleFunc("/api/replies", handleReplies)
	mux.HandleFunc("/api/chats", handleChats)
	mux.HandleFunc("/api/chat-history", handleChatHistory)
	mux.HandleFunc("/api/send-message", handleSendMessage)
	mux.HandleFunc("/api/save-contact", handleSaveContact)
	mux.HandleFunc("/api/delete-chat", handleDeleteChat)
	mux.HandleFunc("/api/delete-all-chats", handleDeleteAllChats)

	// Static frontend assets handler
	frontendDir := "src/frontend"
	if _, err := os.Stat(frontendDir); err != nil {
		frontendDir = "frontend"
	}
	mux.Handle("/frontend/", http.StripPrefix("/frontend/", http.FileServer(http.Dir(frontendDir))))

	// Dashboard UI
	mux.HandleFunc("/", handleDashboard)

	// FIX #13 + #14: Wrap all routes with logging and CORS middlewares
	handler := loggingMiddleware(corsMiddleware(mux))

	webhookURL := os.Getenv("WEBHOOK_URL")
	if webhookURL == "" {
		webhookURL = fmt.Sprintf("http://localhost:%s/webhook", port)
	}

	fmt.Printf("\n╔══════════════════════════════════════════╗\n")
	fmt.Printf("║  WA Manage                              ║\n")
	fmt.Printf("║  Dashboard: http://localhost:%-11s ║\n", port)
	fmt.Printf("║  Webhook:   /webhook                     ║\n")
	fmt.Printf("║  Stats:     /stats?campaign=default      ║\n")
	fmt.Printf("╚══════════════════════════════════════════╝\n")
	fmt.Printf("💡 Webhook URL: %s\n\n", webhookURL)

	// --- Graceful Shutdown ---
	server := &http.Server{Addr: ":" + port, Handler: handler}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		fmt.Printf("\n⚠️ Received signal: %v — shutting down gracefully...\n", sig)

		if atomic.LoadInt32(&isCampaignRunning) == 1 && campaignCancel != nil {
			fmt.Println("🛑 Stopping active campaign...")
			campaignCancel()
			campaignWg.Wait()
			fmt.Println("✅ Campaign stopped cleanly")
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(ctx)

		if db != nil {
			db.Close()
			fmt.Println("✅ Database closed cleanly")
		}

		fmt.Println("👋 Server shut down successfully")
		os.Exit(0)
	}()

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Printf("❌ Server failed: %v\n", err)
		os.Exit(1)
	}
}
