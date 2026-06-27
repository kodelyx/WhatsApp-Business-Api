//go:build webhook

package main

import (
	"bufio"
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

// --- Shared Fallback Template Components (FIX #7: single source of truth) ---
var defaultFallbackComponents = []interface{}{
	map[string]interface{}{
		"type": "BODY",
		"text": "Hello {{1}},\n\nWe appreciate you contacting us. Below are the details regarding your query:\n\n{{2}}\n\n{{3}}\n\n{{4}}\n\nLet us know if you have any questions.",
	},
	map[string]interface{}{
		"type": "BUTTONS",
		"buttons": []interface{}{
			map[string]interface{}{
				"type": "URL",
				"text": "WhatsApp Now",
				"url":  "https://example.com/{{1}}",
			},
			map[string]interface{}{
				"type": "QUICK_REPLY",
				"text": "Stop Promotions",
			},
		},
	},
}

// --- Template Structs ---
type TemplateInfo struct {
	Name       string                   `json:"name"`
	Components []map[string]interface{} `json:"components"`
}

type TemplateDetail struct {
	Name       string        `json:"name"`
	Components []interface{} `json:"components"`
}

// --- Template Pool (Thread-safe round-robin with blocking) ---
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
	broadcastLog("🚫 Template BLOCKED: %s (removed from rotation)\n", name)
	active := 0
	for _, t := range tp.templates {
		if !tp.blocked[t] {
			active++
		}
	}
	broadcastLog("   📋 Active templates remaining: %d\n", active)
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

// --- File Loading ---
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

func loadFallbackTemplates() []string {
	data, err := os.ReadFile(getConfigFile())
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

// --- Unified Template Fetcher (FIX #6: merged into single API call) ---
// Returns both the approved template names list AND the detailed components map.
func fetchApprovedTemplatesWithInfo(apiVer, wabaID, token string) ([]string, map[string]TemplateInfo) {
	templatesMap := make(map[string]TemplateInfo)
	if token == "" || wabaID == "" {
		return nil, templatesMap
	}

	broadcastLog("🔍 Fetching templates from WhatsApp API...\n")
	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/message_templates?limit=1000", apiVer, wabaID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, templatesMap
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		broadcastLog("⚠️ API fetch failed: %v — using fallback from %s\n", err, getConfigFile())
		return nil, templatesMap
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		broadcastLog("⚠️ API error %d: %s — using fallback from %s\n", resp.StatusCode, string(body), getConfigFile())
		return nil, templatesMap
	}

	var result struct {
		Data []struct {
			Name       string                   `json:"name"`
			Status     string                   `json:"status"`
			Components []map[string]interface{} `json:"components"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		broadcastLog("⚠️ Failed to decode API response: %v\n", err)
		return nil, templatesMap
	}

	var approved, paused, rejected []string
	for _, t := range result.Data {
		switch t.Status {
		case "APPROVED":
			approved = append(approved, t.Name)
			templatesMap[t.Name] = TemplateInfo{
				Name:       t.Name,
				Components: t.Components,
			}
		case "PAUSED":
			paused = append(paused, t.Name)
		case "REJECTED":
			rejected = append(rejected, t.Name)
		}
	}

	broadcastLog("   ✅ APPROVED: %d\n", len(approved))
	if len(paused) > 0 {
		broadcastLog("   ⏸️  PAUSED:   %d — %s\n", len(paused), strings.Join(paused, ", "))
	}
	if len(rejected) > 0 {
		broadcastLog("   ❌ REJECTED: %d — %s\n", len(rejected), strings.Join(rejected, ", "))
	}

	// Update fallback templates in config.json
	if len(approved) > 0 {
		cfgData, _ := os.ReadFile(getConfigFile())
		var cfgMap map[string]interface{}
		if json.Unmarshal(cfgData, &cfgMap) != nil {
			cfgMap = map[string]interface{}{}
		}
		cfgMap["fallbackTemplates"] = approved
		updated, _ := json.MarshalIndent(cfgMap, "", "  ")
		os.WriteFile(getConfigFile(), updated, 0644)
	}

	return approved, templatesMap
}

// --- Get components for a template, fall back if not found ---
func getTemplateComponents(tplName string, templatesMap map[string]TemplateInfo) []map[string]interface{} {
	if info, ok := templatesMap[tplName]; ok {
		return info.Components
	}
	// Convert defaultFallbackComponents to []map[string]interface{} for sender
	fallback := []map[string]interface{}{}
	for _, comp := range defaultFallbackComponents {
		if m, ok := comp.(map[string]interface{}); ok {
			fallback = append(fallback, m)
		}
	}
	return fallback
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

func countPlaceholders(text string) int {
	maxIndex := 0
	for i := 1; i <= 20; i++ {
		placeholder := fmt.Sprintf("{{%d}}", i)
		if strings.Contains(text, placeholder) {
			maxIndex = i
		}
	}
	return maxIndex
}
