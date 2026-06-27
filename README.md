# 📱 WhatsApp Management Dashboard

### Self-hosted Go/JS WhatsApp campaign broadcaster and real-time chat inbox using Meta Cloud API.

[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![License](https://img.shields.io/github/license/kodelyx/WhatsApp-Business-Api?style=flat-square&color=ff3366)](LICENSE)

---

## ✨ Features
* **💬 Two-Way Inbox:** Real-time chat sync using SSE (Server-Sent Events) with delivery indicators (✔️ sent, ✔️✔️ read).
* **📢 Bulk Campaigns:** High-concurrency broadcast pool using **40 parallel Go workers**.
* **📂 Smart Import:** Drag & drop numbers from TXT, CSV, or Excel (.xlsx).
* **🔄 Auto Fallback:** Dynamically rotates and retries template sends up to 3 times on failures.
* **🏷️ Alias Directory:** Inline renaming of contacts saved in SQLite database.
* **🎨 Glassmorphic UI:** Modern responsive dark/light style UI.

---

## 📸 Interface Screenshots

<div align="center">
  <h4>📨 Two-Way Chat Inbox</h4>
  <img src="assets/inbox_screenshot.png" alt="Two-Way Chat Inbox" width="95%" style="border-radius: 8px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />
  
  <h4>📢 Bulk Campaign Broadcaster</h4>
  <img src="assets/send_screenshot.png" alt="Campaign Sender UI" width="95%" style="border-radius: 8px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />

  <h4>📊 Real-Time Campaign Analytics</h4>
  <img src="assets/report_screenshot.png" alt="Campaign Metrics Dashboard" width="95%" style="border-radius: 8px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" />
</div>

---

## ⚡ Quick Start

```bash
# 1. Clone & Copy config
cp .env.example .env

# 2. Add credentials in .env
PORT=9090
WHATSAPP_TOKEN=your_token
PHONE_NUMBER_ID=your_id
WABA_ID=your_waba_id
VERIFY_TOKEN=your_token
WEBHOOK_URL=https://your-public-url.com/webhook

# 3. Download dependencies & start
go mod tidy
go run src/webhook.go src/campaign.go src/db.go src/templates.go
```
Open **[http://localhost:9090](http://localhost:9090)** in your browser.

---

## 📡 Webhook Setup
1. Expose port `9090` publicly (e.g. via Cloudflare Tunnels).
2. Set Webhook Callback URL in Meta Developer Console to `{WEBHOOK_URL}/webhook`.
3. Set Verify Token and subscribe to `messages` & `messages_deliveries` events.

---

## 🗄️ SQLite Schema (`data/tracker.db`)
* `sends`: Outbound campaign delivery statuses.
* `replies`: Two-way chat messages.
* `contacts`: Name directory list.
* `campaigns`: Cached analytics data.

---

## 📄 License
MIT License.
