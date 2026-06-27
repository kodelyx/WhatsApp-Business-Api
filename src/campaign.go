//go:build webhook

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// --- Campaign Structs & State ---
type CampaignConfig struct {
	CampaignName string   `json:"campaign_name"`
	Template     string   `json:"template"`
	Language     string   `json:"language"`
	Var1         string   `json:"var1"`
	Var2         string   `json:"var2"`
	Var3         string   `json:"var3"`
	Var4         string   `json:"var4"`
	ButtonParam  string   `json:"button_param"`
	Numbers      []string `json:"numbers"`
	Workers      int      `json:"workers"`
}

type LogClient chan string

var (
	logClients        = make(map[LogClient]bool)
	logClientsMu      sync.Mutex
	logHistory        []string
	logHistoryMu      sync.Mutex
	campaignCancel    context.CancelFunc
	campaignWg        sync.WaitGroup
	campaignMu        sync.Mutex
	isCampaignRunning int32
	activeCampaignID  string
)

// --- Broadcast logs to all connected dashboard SSE clients ---
func broadcastLog(format string, a ...interface{}) {
	msg := fmt.Sprintf(format, a...)
	fmt.Print(msg) // Output to terminal console

	// Strip trailing newline for clean display in web log viewer
	cleanMsg := strings.TrimSuffix(msg, "\n")
	tsMsg := fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), cleanMsg)

	logHistoryMu.Lock()
	logHistory = append(logHistory, tsMsg)
	if len(logHistory) > 500 {
		logHistory = logHistory[len(logHistory)-500:]
	}
	logHistoryMu.Unlock()

	campaignMu.Lock()
	campID := activeCampaignID
	campaignMu.Unlock()

	if campID != "" && db != nil {
		db.Exec(`INSERT INTO campaign_logs (campaign_id, log_line) VALUES (?, ?)`, campID, tsMsg)
	}

	logClientsMu.Lock()
	defer logClientsMu.Unlock()
	for client := range logClients {
		select {
		case client <- tsMsg:
		default:
		}
	}
}

func clearLogHistory() {
	logHistoryMu.Lock()
	logHistory = nil
	logHistoryMu.Unlock()
}

// --- WhatsApp API Template Sender ---
func sendTemplateLocal(client *http.Client, url, token, to, tplName, campaignID string, pool *TemplatePool, cfg CampaignConfig, tplComponents []map[string]interface{}) (bool, bool) {
	recipientPhone := to
	recipientName := cfg.Var1

	if strings.Contains(to, ",") {
		parts := strings.SplitN(to, ",", 2)
		recipientPhone = strings.TrimSpace(parts[0])
		namePart := strings.TrimSpace(parts[1])
		if namePart != "" {
			recipientName = namePart
		}
	}

	// Construct the dynamic parameter elements
	reqComponents := []map[string]interface{}{}

	// 1. Body text parameters
	bodyParams := []map[string]interface{}{}
	varBodyCount := 0

	for _, comp := range tplComponents {
		if compType, ok := comp["type"].(string); ok && strings.ToUpper(compType) == "BODY" {
			if textVal, ok := comp["text"].(string); ok {
				varBodyCount = countPlaceholders(textVal)
			}
		}
	}

	if varBodyCount == 0 && (recipientName != "" || cfg.Var2 != "" || cfg.Var3 != "" || cfg.Var4 != "") {
		varBodyCount = 4
	}

	if varBodyCount > 0 {
		vars := []string{recipientName, cfg.Var2, cfg.Var3, cfg.Var4}
		for i := 0; i < varBodyCount; i++ {
			val := " "
			if i < len(vars) && vars[i] != "" {
				val = vars[i]
			}
			bodyParams = append(bodyParams, map[string]interface{}{"type": "text", "text": val})
		}
		reqComponents = append(reqComponents, map[string]interface{}{
			"type":       "body",
			"parameters": bodyParams,
		})
	}

	// 2. Dynamic URL button parameter
	hasDynamicURL := false
	buttonIndex := "0"

	for _, comp := range tplComponents {
		if compType, ok := comp["type"].(string); ok && strings.ToUpper(compType) == "BUTTONS" {
			if btns, ok := comp["buttons"].([]interface{}); ok {
				for idx, btnVal := range btns {
					if btnMap, ok := btnVal.(map[string]interface{}); ok {
						if btnType, ok := btnMap["type"].(string); ok && strings.ToUpper(btnType) == "URL" {
							if urlVal, ok := btnMap["url"].(string); ok && strings.Contains(urlVal, "{{1}}") {
								hasDynamicURL = true
								buttonIndex = fmt.Sprintf("%d", idx)
								break
							}
						}
					}
				}
			}
		}
	}

	if hasDynamicURL {
		btnVal := " "
		if cfg.ButtonParam != "" {
			btnVal = cfg.ButtonParam
		}
		reqComponents = append(reqComponents, map[string]interface{}{
			"type":     "button",
			"sub_type": "url",
			"index":    buttonIndex,
			"parameters": []map[string]interface{}{
				{"type": "text", "text": btnVal},
			},
		})
	}

	payload := map[string]interface{}{
		"messaging_product": "whatsapp",
		"to":                recipientPhone,
		"type":              "template",
		"template": map[string]interface{}{
			"name":     tplName,
			"language": map[string]string{"code": cfg.Language},
		},
	}
	if len(reqComponents) > 0 {
		payload["template"].(map[string]interface{})["components"] = reqComponents
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		logSendLocal(campaignID, recipientPhone, tplName, "", "FAILED", err.Error())
		return false, false
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		isTplErr := isTemplateError(respBody)
		if isTplErr {
			pool.Block(tplName)
		} else {
			broadcastLog("   ⚠️ HTTP %d for %s [%s] — %s\n", resp.StatusCode, recipientPhone, tplName, string(respBody))
		}
		logSendLocal(campaignID, recipientPhone, tplName, "", "FAILED", string(respBody))
		return false, isTplErr
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

	logSendLocal(campaignID, recipientPhone, tplName, wamid, "SENT", "")
	if recipientName != "" && recipientName != cfg.Var1 {
		db.Exec(`INSERT OR REPLACE INTO contacts (phone, name) VALUES (?, ?)`, recipientPhone, recipientName)
	}
	return true, false
}

// --- Bulk Sending Worker Engine ---
func runCampaign(ctx context.Context, cfg CampaignConfig) {
	atomic.StoreInt32(&isCampaignRunning, 1)
	clearLogHistory()

	broadcastLog("🚀 Starting Campaign: %s\n", cfg.CampaignName)

	token := os.Getenv("WHATSAPP_TOKEN")
	phoneID := os.Getenv("PHONE_NUMBER_ID")
	wabaID := os.Getenv("WABA_ID")
	apiVer := os.Getenv("API_VERSION")
	if apiVer == "" {
		apiVer = "v25.0"
	}
	// FIX #12: Default language if not provided
	if cfg.Language == "" {
		cfg.Language = "en"
	}
	if token == "" || phoneID == "" {
		broadcastLog("❌ WHATSAPP_TOKEN and PHONE_NUMBER_ID must be set in .env\n")
		atomic.StoreInt32(&isCampaignRunning, 0)
		return
	}

	// FIX #6: Single API call fetches both names and component details
	var templates []string
	var templatesMap map[string]TemplateInfo

	if cfg.Template != "" && cfg.Template != "all_rotation" {
		templates = []string{cfg.Template}
		_, templatesMap = fetchApprovedTemplatesWithInfo(apiVer, wabaID, token)
	} else {
		templates, templatesMap = fetchApprovedTemplatesWithInfo(apiVer, wabaID, token)
		if len(templates) == 0 {
			templates = loadFallbackTemplates()
		}
	}

	if len(templates) == 0 {
		broadcastLog("❌ No templates available to send\n")
		atomic.StoreInt32(&isCampaignRunning, 0)
		return
	}

	pool := NewTemplatePool(templates)

	numbers := cfg.Numbers
	if len(numbers) == 0 {
		numbers = loadLines("numbers.txt")
	}

	if len(numbers) == 0 {
		broadcastLog("❌ No phone numbers found to send to\n")
		atomic.StoreInt32(&isCampaignRunning, 0)
		return
	}

	// FIX #15: Validate phone numbers before sending
	var validNumbers []string
	var skippedCount int
	for _, num := range numbers {
		phone := num
		if strings.Contains(num, ",") {
			phone = strings.TrimSpace(strings.SplitN(num, ",", 2)[0])
		}
		cleaned := validatePhone(phone)
		if cleaned != "" {
			validNumbers = append(validNumbers, num)
		} else {
			skippedCount++
		}
	}
	if skippedCount > 0 {
		broadcastLog("⚠️ Skipped %d invalid phone numbers\n", skippedCount)
	}
	numbers = validNumbers

	total := len(numbers)
	campaignID := fmt.Sprintf("%s - Send %s", cfg.CampaignName, time.Now().Format("Jan 2 3:04 PM"))

	campaignMu.Lock()
	activeCampaignID = campaignID
	campaignMu.Unlock()

	initCampaignLocal(campaignID, total)

	broadcastLog("🆔 Campaign ID: %s\n", campaignID)
	broadcastLog("📋 Total Numbers: %d\n", total)
	broadcastLog("📋 Templates: %d (%s)\n", len(templates), strings.Join(templates, ", "))
	broadcastLog("👷 Worker Threads: %d\n", cfg.Workers)

	apiURL := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", apiVer, phoneID)

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

	workersCount := cfg.Workers
	if workersCount <= 0 {
		workersCount = 40
	}

	// Start workers
	for i := 0; i < workersCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for num := range numChan {
				select {
				case <-ctx.Done():
					broadcastLog("🛑 Skipped: %s (Campaign Aborted)\n", num)
					atomic.AddInt64(&failed, 1)
					continue
				default:
				}

				sent := false
				for attempt := 0; attempt < 3; attempt++ {
					tpl := pool.Next()
					if tpl == "" {
						broadcastLog("💀 ALL templates blocked! Cannot send to %s\n", num)
						break
					}

					tplComponents := getTemplateComponents(tpl, templatesMap)
					ok, templateErr := sendTemplateLocal(client, apiURL, token, num, tpl, campaignID, pool, cfg, tplComponents)
					if ok {
						s := atomic.AddInt64(&success, 1)
						f := atomic.LoadInt64(&failed)
						broadcastLog("✅ %s [%s] | %d/%d sent | %d failed\n", num, tpl, s, total, f)
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
					broadcastLog("❌ %s | %d/%d sent | %d failed\n", num, s, total, f)
				}
			}
		}()
	}

	// Rate limiter: 80 messages/sec (WhatsApp Business API limit)
	rateLimiter := time.NewTicker(time.Second / 80)
	defer rateLimiter.Stop()
	broadcastLog("⏱️ Rate limit: 80 msg/sec\n")

	for _, num := range numbers {
		select {
		case <-ctx.Done():
			break
		case <-rateLimiter.C:
			numChan <- num
		}
	}
	close(numChan)
	wg.Wait()

	finishCampaignLocal(campaignID, success, failed)

	elapsed := time.Since(start)
	broadcastLog("\n════════════════════════════════\n")
	broadcastLog("🏁 Campaign Completed in %s\n", elapsed.Round(time.Millisecond))
	broadcastLog("📊 Success: %d | Failed: %d | Total: %d\n", success, failed, total)
	broadcastLog("💾 Campaign ID: %s (Tracked in DB)\n", campaignID)

	campaignMu.Lock()
	activeCampaignID = ""
	campaignMu.Unlock()

	atomic.StoreInt32(&isCampaignRunning, 0)
}
