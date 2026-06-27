# 📱 Official WhatsApp Management

Official WhatsApp Management is a high-performance, enterprise-grade unified campaign broadcaster and two-way Chat Inbox panel. It integrates with the Meta WhatsApp Cloud API to run highly concurrent broadcast campaigns (leveraging Go's concurrency model) and manage customer conversations in real-time.

Designed with a sleek dark-glassmorphic styling, standard HSL theme tokens, and dynamic micro-animations, the frontend provides instant feedback, dynamic layouts, and a responsive mobile-ready mockup preview.

---

## 🚀 Key Features & Micro-Features

### 1. 📨 Real-Time Inbox & Chat Panel
- **Two-Way Messaging:** Real-time incoming and outgoing chat synchronization.
- **Optimistic UI Updates:** Outgoing messages appear instantly with a pending status icon (🕒) and automatically transition to standard WhatsApp indicators (✔️ sent, ✔️✔️ delivered, read) as Meta Webhook events arrive.
- **Unread Counters:** Displays dynamic green notification badges indicating the count of incoming unread messages per contact. Selecting a contact instantly marks those messages as read, syncing with the SQLite database backend.

### 2. 🏷️ Contact Directory & Auto-Mapping
- **Inline Contact Editing:** Directly rename any contact by clicking the **Edit Name** (✏️) button in the chat header, prompting a persistent database save.
- **Smart Contact Parsing:** When importing recipients via files or pasting text, using the format `PHONE, NAME` (e.g., `919952319666, John Doe`) extracts the name and automatically creates or updates the database record. The dashboard dynamically resolves and displays the saved name instead of raw phone numbers.

### 3. 📂 Batch Recipient & Media Import
- **Multi-Format Uploads:** Drag and drop or browse files to import phone lists. Supports:
  - **Plain Text (.txt):** Numbers listed line-by-line.
  - **CSV Files (.csv):** Separated by commas, tabs, or semicolons.
  - **Excel Sheets (.xlsx / .xls):** Automatically scans spreadsheet sheets, cleaning numbers and pairing them with name columns if present.
- **Media Attachments Drag & Drop:** Attach Images, Videos, or PDFs directly into the campaign form. The system manages preview generation and metadata before transmission.

### 4. 🔄 Smart Template Rotation & Auto-Fallback
- **Auto-Fetching:** Dynamically queries Meta's WhatsApp Business Account APIs to fetch approved templates.
- **Parallel Workers:** Spins up to **40 parallel Go goroutines** to distribute the sending workload.
- **Fail-Safe Rotation:** If a template fails during broadcasting (due to quality rate-limiting or template issues), the sending routine dynamically blocks it and falls back to retry the send with the next approved template, up to 3 times per recipient.

### 5. 📊 Live Campaign Metrics & Analytics
- **Live Logging Terminal:** Real-time stdout log streamed directly to the frontend during broadcasts.
- **Interactive Selectors:** Search and select campaign logs via a search-enabled dropdown.
- **Delivery Timeline:** Detailed table including Message IDs (wamid) with instant copy-to-clipboard functionality, status badges, and precise timestamps.

---

## 🛠️ Technology Stack

- **Backend:** Go (Standard Library `net/http` + SQLite driver)
- **Frontend:** HTML5, JavaScript (Vanilla ES6), CSS3 (Modern dark-glass theme + interactive micro-animations)
- **Icons:** Lucide Icons (Dynamically generated via SVG loader)
- **Database:** SQLite (`data/tracker.db`)

---

## 📦 Database Schema (`data/tracker.db`)

The sqlite database maintains logs for both bulk campaigns and direct chat history. The main tables are:

### `sends` (Outbound Campaigns)
Tracks the status and lifecycles of outbound campaign messages.
```sql
CREATE TABLE IF NOT EXISTS sends (
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
);
```

### `replies` (Two-Way Chat Logs)
Maintains conversation records for the Chat Inbox.
```sql
CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT DEFAULT 'default',
    phone TEXT NOT NULL,
    msg_type TEXT NOT NULL,
    text TEXT DEFAULT '',
    direction TEXT DEFAULT 'incoming', -- 'incoming' or 'outgoing'
    is_read INTEGER DEFAULT 0,         -- 0 = unread, 1 = read
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `contacts` (Saved Name Directory)
Stores human-readable names for phone numbers.
```sql
CREATE TABLE IF NOT EXISTS contacts (
    phone TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
```

### `campaigns` (Aggregated Cache Metrics)
Stores pre-calculated metrics for fast loading.
```sql
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    total INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    delivered INTEGER DEFAULT 0,
    read_count INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
);
```

---

## 🚀 Installation & Configuration

### 1. Prerequisites
- **Go 1.25+**
- **SQLite**

### 2. Configure Environment (`.env`)
Create a `.env` file in the root directory:
```env
PORT=9090
WHATSAPP_TOKEN=your_meta_system_user_access_token
PHONE_NUMBER_ID=your_whatsapp_phone_number_id
BUSINESS_ACCOUNT_ID=your_whatsapp_business_account_id
VERIFY_TOKEN=your_custom_webhook_verify_token
WEBHOOK_URL=https://your-public-url.com/webhook
```

### 3. Setting up Meta Webhook
1. Go to your app in the [Meta Developer Console](https://developers.facebook.com/).
2. Under **WhatsApp** -> **Configuration**, set the Callback URL to: `https://your-public-domain.com/webhook`.
3. Set the **Verify Token** to match your `.env` `VERIFY_TOKEN`.
4. Subscribe to the following Webhook fields:
   - `messages` (for incoming chats)
   - `messages_deliveries` (for delivery status updates like delivered/read)

---

## 📖 Usage Guide

### 1. Building and Running the Dashboard Server
```bash
# Clean up dependencies
go mod tidy

# Build the binary
go build -tags webhook -o webhook webhook.go

# Start the server
./webhook
```
Open `http://localhost:9090` in your web browser.

### 2. Operating the UI Tabs

#### Tab A: Send Campaign
1. **Define Campaign:** Enter a unique **Campaign Name**.
2. **Load Numbers:** Paste phone numbers line-by-line, or drag and drop a TXT, CSV, or XLSX file. Paste format `919952319666, John Doe` automatically records names.
3. **Select Template:** Select an approved template or choose **Smart Rotation** to distribute delivery.
4. **Map Variables:** Fill out variables (`Line 1` to `Line 4`) and custom button parameters. Live preview instantly reflects layout.
5. **Attach Media (Optional):** Drag and drop an Image, Video, or PDF to broadcast custom media.
6. **Launch:** Click **Start Campaign** and watch the live logs stream below.

#### Tab B: Delivery Dashboard
1. **Select Campaign:** Choose a campaign from the searchable custom dropdown.
2. **Review Counters:** Instantly review the total, sent, delivered, read, and failed counts.
3. **Copy Message IDs:** Click on any message ID (wamid) in the log details table to copy it to your clipboard.

#### Tab C: Inbox
1. **Select Contacts:** Click on a contact avatar. Avatars feature dynamic colors based on initials.
2. **Read:** Selecting a contact automatically updates unread messages to `read` in the background.
3. **Rename Contacts:** Click the **Edit Name** button in the chat header to change or set a name.
4. **Add New Chat:** Use the search bar, click **New Chat**, enter a number, and instantly start a conversation thread.
5. **Send Messages:** Type your message and hit Enter. The optimistic rendering pipeline will instantly show the message with a sending spinner status.

---

## 🛠️ CLI Bulk Sender Tool
For command-line execution without the web dashboard, use the `send.go` CLI utility:
```bash
# Compile CLI binary
go build -o send send.go

# Run campaign using a number text file (one phone number per line)
./send numbers.txt
```
*Note: Make sure your `numbers.txt` conforms to the `.env` settings.*

---

## 🔒 License
This project is open-source and available under the MIT License.
