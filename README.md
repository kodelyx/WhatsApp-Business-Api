<div align="center">
<img src="assets/banner.png" alt="WhatsApp Business API Dashboard Banner" width="100%" style="border-radius: 8px; margin-bottom: 15px;" />

# 📱 WhatsApp Management Dashboard

### Self-hosted Go/JS WhatsApp campaign broadcaster and real-time chat inbox using Meta Cloud API.

[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![License](https://img.shields.io/github/license/kodelyx/WhatsApp-Business-Api?style=flat-square&color=ff3366)](LICENSE)

</div>

---

## ✨ Features
* **💬 Two-Way Inbox:** Real-time chat sync using SSE (Server-Sent Events) with delivery indicators (✔️ sent, ✔️✔️ read).
* **📢 Bulk Campaigns:** High-concurrency broadcast pool using **40 parallel Go workers**.
* **📂 Smart Import:** Drag & drop numbers from TXT, CSV, or Excel (.xlsx).
* **🔄 Auto Fallback:** Dynamically rotates and retries template sends up to 3 times on failures.
* **🏷️ Alias Directory:** Inline renaming of contacts saved in SQLite database.
* **🎨 Glassmorphic UI:** Modern responsive dark/light style UI.

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
go run webhook.go campaign.go db.go templates.go
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
