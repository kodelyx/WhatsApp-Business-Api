//go:build webhook

package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

// --- Database Init & Operations ---
func initDB() {
	os.MkdirAll("data", 0755)
	var err error
	db, err = sql.Open("sqlite3", "file:data/tracker.db?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		fmt.Printf("❌ Cannot open DB: %v\n", err)
		os.Exit(1)
	}
	db.SetMaxOpenConns(1)

	// Create tables with error checking
	tables := []struct {
		name string
		ddl  string
	}{
		{"sends", `CREATE TABLE IF NOT EXISTS sends (
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
		)`},
		{"statuses", `CREATE TABLE IF NOT EXISTS statuses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			wamid TEXT NOT NULL,
			phone TEXT NOT NULL,
			status TEXT NOT NULL,
			error_code TEXT DEFAULT '',
			error_title TEXT DEFAULT '',
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
		)`},
		{"replies", `CREATE TABLE IF NOT EXISTS replies (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			campaign_id TEXT DEFAULT 'default',
			phone TEXT NOT NULL,
			msg_type TEXT NOT NULL,
			text TEXT DEFAULT '',
			direction TEXT DEFAULT 'incoming',
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
		)`},
		{"contacts", `CREATE TABLE IF NOT EXISTS contacts (
			phone TEXT PRIMARY KEY,
			name TEXT NOT NULL
		)`},
		{"campaigns", `CREATE TABLE IF NOT EXISTS campaigns (
			id TEXT PRIMARY KEY,
			total INTEGER DEFAULT 0,
			sent INTEGER DEFAULT 0,
			delivered INTEGER DEFAULT 0,
			read_count INTEGER DEFAULT 0,
			failed INTEGER DEFAULT 0,
			started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			finished_at DATETIME
		)`},
		{"campaign_logs", `CREATE TABLE IF NOT EXISTS campaign_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			campaign_id TEXT NOT NULL,
			log_line TEXT NOT NULL,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
		)`},
	}

	for _, t := range tables {
		if _, err := db.Exec(t.ddl); err != nil {
			fmt.Printf("❌ Failed to create table '%s': %v\n", t.name, err)
			os.Exit(1)
		}
	}

	// Safe ALTER TABLE — ignore "duplicate column" errors
	db.Exec(`ALTER TABLE replies ADD COLUMN direction TEXT DEFAULT 'incoming'`)
	db.Exec(`ALTER TABLE replies ADD COLUMN is_read INTEGER DEFAULT 0`)

	// Create indexes (non-fatal if they fail)
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_sends_phone ON sends(phone)`,
		`CREATE INDEX IF NOT EXISTS idx_sends_wamid ON sends(wamid)`,
		`CREATE INDEX IF NOT EXISTS idx_sends_status ON sends(status)`,
		`CREATE INDEX IF NOT EXISTS idx_sends_campaign ON sends(campaign_id)`,
		`CREATE INDEX IF NOT EXISTS idx_statuses_wamid ON statuses(wamid)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_unique ON statuses(wamid, status)`,
		`CREATE INDEX IF NOT EXISTS idx_campaign_logs_campaign ON campaign_logs(campaign_id)`,
	}
	for _, idx := range indexes {
		if _, err := db.Exec(idx); err != nil {
			fmt.Printf("⚠️ Index creation warning: %v\n", err)
		}
	}

	fmt.Println("✅ Tracker DB ready (data/tracker.db)")
}

func logSendLocal(campaignID, phone, template, wamid, status, errMsg string) {
	if db == nil {
		return
	}
	db.Exec(`INSERT INTO sends (campaign_id, phone, template, wamid, status, error, sent_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		campaignID, phone, template, wamid, status, errMsg, time.Now().UTC().Format("2006-01-02 15:04:05"))
}

func initCampaignLocal(id string, total int) {
	if db == nil {
		return
	}
	db.Exec(`INSERT OR REPLACE INTO campaigns (id, total, sent, delivered, read_count, failed, started_at)
		VALUES (?, ?, 0, 0, 0, 0, ?)`, id, total, time.Now())
}

func finishCampaignLocal(id string, sent, failed int64) {
	if db == nil {
		return
	}
	db.Exec(`UPDATE campaigns SET sent = ?, failed = ?, finished_at = ? WHERE id = ?`,
		sent, failed, time.Now(), id)
}

func pct(part, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(part) / float64(total) * 100
}
