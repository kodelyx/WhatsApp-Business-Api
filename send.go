//go:build !webhook

package main

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"
)

/*
	send.go — Official WhatsApp Bulk Sender CLI

	Features:
	  - 40 goroutines parallel sending
	  - Auto-fetch APPROVED templates from API
	  - Runtime: if template fails → auto-remove + retry with next template
	  - Round-robin rotation across all active templates
	  - SQLite tracking: every send logged with wamid for delivery tracking

	Database: data/tracker.db (shared with webhook server)

	Usage:
	  go run send.go numbers.txt
*/

const (
	workers      = 40
	lang         = "en"
	dbPath       = "data/tracker.db"
)

// ——— EDIT YOUR MESSAGE HERE ———
var (
	var1        = "💥 Google Reviews Boost Service 💥"
	var2        = "🔥 Plans: 🆓 3 Reviews – Free | 💥 10 Reviews – ₹199 | 🚀 50+ Reviews – ₹899 | 🔥 100+ Reviews – ₹1499 | 💎 200+ Reviews – ₹2899"
	var3        = "⚡ Rank ↑ | Trust ↑ | Orders ↑"
	var4        = "📞 Call/WhatsApp: 9399046788 📩 DM START 🚀"
	buttonParam = "9399046788"
	configFile = "config.json"
)

var trackDB *sql.DB

// ——— SQLite Tracker ———

func initTracker() {
	os.MkdirAll("data", 0755)
	var err error
	trackDB, err = sql.Open("sqlite3", "file:"+dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		fmt.Printf("❌ DB error: %v\n", err)
		os.Exit(1)
	}
	trackDB.SetMaxOpenConns(1)

	trackDB.Exec(`CREATE TABLE IF NOT EXISTS sends (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		campaign_id TEXT DEFAULT 'default',
		phone TEXT NOT NULL,
		template TEXT DEFAULT '',
		wamid TEXT DEFAULT '',
		status TEXT DEFAULT 'QUEUED',
		error TEXT DEFAULT '',
		sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		delivered_at DATETIME,
		read_at DATETIME,
		failed_at DATETIME
	)`)

	trackDB.Exec(`CREATE TABLE IF NOT EXISTS statuses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		wamid TEXT NOT NULL,
		phone TEXT NOT NULL,
		status TEXT NOT NULL,
		error_code TEXT DEFAULT '',
		error_title TEXT DEFAULT '',
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)

	trackDB.Exec(`CREATE TABLE IF NOT EXISTS campaigns (
		id TEXT PRIMARY KEY,
		total INTEGER DEFAULT 0,
		sent INTEGER DEFAULT 0,
		delivered INTEGER DEFAULT 0,
		read_count INTEGER DEFAULT 0,
		failed INTEGER DEFAULT 0,
		started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		finished_at DATETIME
	)`)

	trackDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sends_phone ON sends(phone)`)
	trackDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sends_wamid ON sends(wamid)`)
	trackDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sends_status ON sends(status)`)
	trackDB.Exec(`CREATE INDEX IF NOT EXISTS idx_sends_campaign ON sends(campaign_id)`)
	trackDB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_unique ON statuses(wamid, status)`)

	fmt.Println("✅ Tracker DB ready (data/tracker.db)")
}

func logSend(campaignID, phone, template, wamid, status, errMsg string) {
	if trackDB == nil {
		return
	}
	trackDB.Exec(`INSERT INTO sends (campaign_id, phone, template, wamid, status, error, sent_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		campaignID, phone, template, wamid, status, errMsg, time.Now())
}

func initCampaign(id string, total int) {
	if trackDB == nil {
		return
	}
	trackDB.Exec(`INSERT OR REPLACE INTO campaigns (id, total, sent, delivered, read_count, failed, started_at)
		VALUES (?, ?, 0, 0, 0, 0, ?)`, id, total, time.Now())
}

func finishCampaign(id string, sent, failed int64) {
	if trackDB == nil {
		return
	}
	trackDB.Exec(`UPDATE campaigns SET sent = ?, failed = ?, finished_at = ? WHERE id = ?`,
		sent, failed, time.Now(), id)
}

// ——— Template Pool ———

type TemplatePool struct {
	mu        sync.RWMutex
	templates []string
	blocked   map[string]bool
	index     int64
}

func NewTemplatePool(templates []string) *TemplatePool {
	return &TemplatePool{
		templates: templates,
		blocked:   make(map[string]bool),
	}
}

func (tp *TemplatePool) Next() string {
	tp.mu.RLock()
	defer tp.mu.RUnlock()
	if len(tp.templates) == 0 {
		return ""
	}
	for range tp.templates {
		idx := atomic.AddInt64(&tp.index, 1)
		tpl := tp.templates[int(idx)%len(tp.templates)]
		if !tp.blocked[tpl] {
			return tpl
		}
	}
	return ""
}

func (tp *TemplatePool) Block(name string) {
	tp.mu.Lock()
	defer tp.mu.Unlock()
	if tp.blocked[name] {
		return
	}
	tp.blocked[name] = true
	fmt.Printf("🚫 Template BLOCKED: %s (removed from rotation)\n", name)
	active := 0
	for _, t := range tp.templates {
		if !tp.blocked[t] {
			active++
		}
	}
	fmt.Printf("   📋 Active templates remaining: %d\n", active)
}

func (tp *TemplatePool) ActiveCount() int {
	tp.mu.RLock()
	defer tp.mu.RUnlock()
	count := 0
	for _, t := range tp.templates {
		if !tp.blocked[t] {
			count++
		}
	}
	return count
}

// ——— Helpers ———

func loadLines(path string) []string {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func loadFallbackTemplatesFromConfig(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var cfg struct {
		FallbackTemplates []string `json:"fallbackTemplates"`
	}
	if json.Unmarshal(data, &cfg) != nil {
		return nil
	}
	return cfg.FallbackTemplates
}

func fetchApprovedTemplates(apiVer, wabaID, token string) []string {
	fmt.Println("🔍 Fetching templates from WhatsApp API...")
	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/message_templates?limit=1000", apiVer, wabaID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("⚠️ API fetch failed: %v — using fallback from %s\n", err, configFile)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("⚠️ API error %d: %s — using fallback from %s\n", resp.StatusCode, string(body), configFile)
		return nil
	}

	var result struct {
		Data []struct {
			Name   string `json:"name"`
			Status string `json:"status"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	var approved, paused, rejected []string
	for _, t := range result.Data {
		switch t.Status {
		case "APPROVED":
			approved = append(approved, t.Name)
		case "PAUSED":
			paused = append(paused, t.Name)
		case "REJECTED":
			rejected = append(rejected, t.Name)
		}
	}

	fmt.Printf("   ✅ APPROVED: %d\n", len(approved))
	if len(paused) > 0 {
		fmt.Printf("   ⏸️  PAUSED:   %d — %s\n", len(paused), strings.Join(paused, ", "))
	}
	if len(rejected) > 0 {
		fmt.Printf("   ❌ REJECTED: %d — %s\n", len(rejected), strings.Join(rejected, ", "))
	}

	if len(approved) > 0 {
		// Update fallbackTemplates in config.json
		cfgData, _ := os.ReadFile(configFile)
		var cfgMap map[string]interface{}
		if json.Unmarshal(cfgData, &cfgMap) != nil {
			cfgMap = map[string]interface{}{}
		}
		cfgMap["fallbackTemplates"] = approved
		updated, _ := json.MarshalIndent(cfgMap, "", "  ")
		os.WriteFile(configFile, updated, 0644)
	}
	return approved
}

func isTemplateError(respBody []byte) bool {
	templateErrors := []string{"132001", "132005", "132007", "132015", "template", "paused", "PAUSED"}
	bodyStr := string(respBody)
	for _, code := range templateErrors {
		if strings.Contains(bodyStr, code) {
			return true
		}
	}
	return false
}

// ——— Main ———

func main() {
	_ = godotenv.Load()

	if envCfg := os.Getenv("CONFIG_FILE"); envCfg != "" {
		configFile = envCfg
	}

	token := os.Getenv("WHATSAPP_TOKEN")
	phoneID := os.Getenv("PHONE_NUMBER_ID")
	wabaID := os.Getenv("WABA_ID")
	apiVer := os.Getenv("API_VERSION")
	if apiVer == "" {
		apiVer = "v25.0"
	}
	if token == "" || phoneID == "" {
		fmt.Println("❌ Set WHATSAPP_TOKEN and PHONE_NUMBER_ID in .env")
		os.Exit(1)
	}

	// Init SQLite tracker
	initTracker()

	// Fetch approved templates
	var templates []string
	if wabaID != "" {
		templates = fetchApprovedTemplates(apiVer, wabaID, token)
	}
	if len(templates) == 0 {
		templates = loadFallbackTemplatesFromConfig(configFile)
	}
	if len(templates) == 0 {
		fmt.Println("❌ No templates available")
		os.Exit(1)
	}

	pool := NewTemplatePool(templates)

	// Load numbers
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run send.go numbers.txt")
		os.Exit(1)
	}
	numbers := loadLines(os.Args[1])
	if len(numbers) == 0 {
		fmt.Println("❌ No numbers found")
		os.Exit(1)
	}

	total := len(numbers)
	campaignName := os.Getenv("CAMPAIGN_NAME")
	if campaignName == "" {
		campaignName = "Campaign"
	}
	campaignID := fmt.Sprintf("%s - Send %s", campaignName, time.Now().Format("Jan 2 3:04 PM"))

	// Init campaign in DB
	initCampaign(campaignID, total)

	fmt.Printf("\n🚀 Sending to %d numbers\n", total)
	fmt.Printf("🆔 Campaign: %s\n", campaignID)
	fmt.Printf("📋 Templates: %d (round-robin, auto-remove on fail)\n", len(templates))
	fmt.Printf("👷 Workers: %d\n", workers)
	fmt.Printf("🔗 Button: %s\n\n", buttonParam)

	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", apiVer, phoneID)

	var success, failed int64
	start := time.Now()

	numChan := make(chan string, 100)
	var wg sync.WaitGroup

	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 50,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	// Start workers
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for num := range numChan {
				sent := false
				for attempt := 0; attempt < 3; attempt++ {
					tpl := pool.Next()
					if tpl == "" {
						fmt.Printf("💀 ALL templates blocked! Cannot send to %s\n", num)
						break
					}

					ok, templateErr := sendTemplate(client, url, token, num, tpl, campaignID, pool)
					if ok {
						s := atomic.AddInt64(&success, 1)
						f := atomic.LoadInt64(&failed)
						fmt.Printf("✅ %s [%s] | %d/%d sent | %d failed\n", num, tpl, s, total, f)
						sent = true
						break
					}

					if !templateErr {
						break
					}
				}

				if !sent {
					f := atomic.AddInt64(&failed, 1)
					s := atomic.LoadInt64(&success)
					fmt.Printf("❌ %s | %d/%d sent | %d failed\n", num, s, total, f)
				}
			}
		}()
	}

	for _, num := range numbers {
		numChan <- num
	}
	close(numChan)
	wg.Wait()

	// Update campaign stats
	finishCampaign(campaignID, success, failed)

	elapsed := time.Since(start)
	fmt.Printf("\n════════════════════════════════\n")
	fmt.Printf("✅ Done in %s\n", elapsed.Round(time.Millisecond))
	fmt.Printf("📊 Success: %d | Failed: %d | Total: %d\n", success, failed, total)
	fmt.Printf("📋 Active templates: %d/%d\n", pool.ActiveCount(), len(templates))
	if elapsed.Seconds() > 0 {
		fmt.Printf("⚡ Speed: %.1f msg/sec\n", float64(success)/elapsed.Seconds())
	}
	fmt.Printf("💾 Tracked in: %s (campaign: %s)\n", dbPath, campaignID)
}

// sendTemplate — returns (success, isTemplateError)
func sendTemplate(client *http.Client, url, token, to, tplName, campaignID string, pool *TemplatePool) (bool, bool) {
	payload := map[string]interface{}{
		"messaging_product": "whatsapp",
		"to":                to,
		"type":              "template",
		"template": map[string]interface{}{
			"name":     tplName,
			"language": map[string]string{"code": lang},
			"components": []map[string]interface{}{
				{
					"type": "body",
					"parameters": []map[string]interface{}{
						{"type": "text", "text": var1},
						{"type": "text", "text": var2},
						{"type": "text", "text": var3},
						{"type": "text", "text": var4},
					},
				},
				{
					"type":     "button",
					"sub_type": "url",
					"index":    "0",
					"parameters": []map[string]interface{}{
						{"type": "text", "text": buttonParam},
					},
				},
			},
		},
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		logSend(campaignID, to, tplName, "", "FAILED", err.Error())
		return false, false
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		isTplErr := isTemplateError(respBody)
		if isTplErr {
			pool.Block(tplName)
		} else {
			fmt.Printf("   ⚠️ %s [%s]: HTTP %d — %s\n", to, tplName, resp.StatusCode, string(respBody))
		}
		logSend(campaignID, to, tplName, "", "FAILED", string(respBody))
		return false, isTplErr
	}

	// Parse wamid
	var result struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	wamid := ""
	if json.Unmarshal(respBody, &result) == nil && len(result.Messages) > 0 {
		wamid = result.Messages[0].ID
	}

	logSend(campaignID, to, tplName, wamid, "SENT", "")
	return true, false
}
