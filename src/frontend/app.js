function num(n) { return (n || 0).toLocaleString() }
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0 }

function setLiveStatus(isOnline) {
	const dot = document.querySelector('.pulse-dot');
	const icon = document.querySelector('.status-badge-container [data-lucide="radio"]');
	if (dot) {
		if (isOnline) {
			dot.classList.remove('offline');
		} else {
			dot.classList.add('offline');
		}
	}
	if (icon) {
		icon.style.color = isOnline ? '#10b981' : '#ef4444';
	}
}

// --- Toast Notifications System ---
function showToast(message, type = 'info') {
	const container = document.getElementById('toast-container') || (() => {
		const c = document.createElement('div');
		c.id = 'toast-container';
		c.className = 'toast-container';
		document.body.appendChild(c);
		return c;
	})();

	const toast = document.createElement('div');
	toast.className = `toast toast-${type}`;

	let icon = 'info';
	let iconColor = '#3b82f6';
	if (type === 'success') {
		icon = 'check-circle';
		iconColor = '#10b981';
	} else if (type === 'error') {
		icon = 'alert-triangle';
		iconColor = '#ef4444';
	} else if (type === 'warning') {
		icon = 'alert-circle';
		iconColor = '#f59e0b';
	}

	toast.innerHTML = `<i data-lucide="${icon}" style="width:16px; height:16px; color: ${iconColor};"></i> <span>${message}</span>`;
	container.appendChild(toast);
	lucide.createIcons();

	setTimeout(() => {
		toast.classList.add('fade-out');
		setTimeout(() => { toast.remove(); }, 300);
	}, 4000);
}

function copyToClipboard(text) {
	navigator.clipboard.writeText(text).then(() => {
		showToast("Wamid Copied!", "success");
	}).catch(err => {
		console.error("Failed to copy:", err);
	});
}
window.copyToClipboard = copyToClipboard;

// Modal toggling is disabled as console logs are now shown inline normally.

// --- Live WhatsApp Preview Binder ---
window.templatesCached = [];

// --- Dynamic Form inputs manager ---
function updateDynamicInputs() {
	const select = document.getElementById('field-template');
	if (!select) return;
	const selectedTemplateVal = select.value;

	if (selectedTemplateVal === "all_rotation") {
		// Show all variables when rotation is selected
		document.getElementById('field-var1').parentElement.style.display = 'flex';
		document.getElementById('field-var2').parentElement.style.display = 'flex';
		document.getElementById('field-var3').parentElement.style.display = 'flex';
		document.getElementById('field-var4').parentElement.style.display = 'flex';
		document.getElementById('field-button-param').parentElement.style.display = 'flex';
		return;
	}

	if (!window.templatesCached) return;
	const activeTpl = window.templatesCached.find(t => t.name === selectedTemplateVal);
	if (!activeTpl) return;

	let bodyText = "";
	let hasDynamicURLButton = false;

	if (activeTpl.components) {
		const bodyCmp = activeTpl.components.find(c => c.type === "BODY");
		if (bodyCmp && bodyCmp.text) {
			bodyText = bodyCmp.text;
		}
		const btnCmp = activeTpl.components.find(c => c.type === "BUTTONS");
		if (btnCmp && btnCmp.buttons) {
			// Show input if there is any URL button
			hasDynamicURLButton = btnCmp.buttons.some(btn => btn.type === 'URL');
		}
	}

	// Count placeholders in body text
	let maxPlaceholder = 0;
	for (let i = 1; i <= 4; i++) {
		if (bodyText.includes(`{{${i}}}`)) {
			maxPlaceholder = i;
		}
	}

	// Show/hide body var inputs
	for (let i = 1; i <= 4; i++) {
		const inputField = document.getElementById(`field-var${i}`);
		if (inputField) {
			const parent = inputField.parentElement;
			if (i <= maxPlaceholder) {
				parent.style.display = 'flex';
			} else {
				parent.style.display = 'none';
			}
		}
	}

	// Show/hide dynamic URL button input
	const buttonParamField = document.getElementById('field-button-param');
	if (buttonParamField) {
		const parent = buttonParamField.parentElement;
		if (hasDynamicURLButton) {
			parent.style.display = 'flex';
		} else {
			parent.style.display = 'none';
		}
	}
}

let selectedFallbackName = '';
function getFallbackName() {
	if (!selectedFallbackName) {
		const fallbackNames = [
			"Nitesh Sharma", "Priya Patel", "Rahul Gupta", "Ananya Iyer", "Amit Verma",
			"Sneha Rao", "Vikram Malhotra", "Karan Johar", "Rohan Mehta", "Neha Kapoor",
			"Aman Singh", "Divya Sharma", "Abhishek Goel", "Meera Nair", "Siddharth Roy"
		];
		const randIndex = Math.floor(Math.random() * fallbackNames.length);
		selectedFallbackName = fallbackNames[randIndex];
	}
	return selectedFallbackName;
}

function getFirstContactName() {
	const textarea = document.getElementById('field-numbers');
	if (!textarea) return getFallbackName();

	const val = textarea.value.trim();
	if (val === '') return getFallbackName();

	const lines = val.split(/\r?\n/);
	for (let line of lines) {
		const trimmed = line.trim();
		if (trimmed === '') continue;

		const parts = trimmed.split(/[,;\t]+/);
		let nameCandidate = '';
		let phone = '';

		parts.forEach(part => {
			const trimmedPart = part.trim();
			if (trimmedPart === '') return;

			const cleaned = cleanPhoneNumber(trimmedPart);
			if (cleaned && !phone) {
				phone = cleaned;
			} else if (!cleaned && !nameCandidate) {
				if (trimmedPart.length > 1 && !trimmedPart.includes('@') && isNaN(trimmedPart)) {
					nameCandidate = trimmedPart;
				}
			}
		});

		if (nameCandidate) {
			return nameCandidate;
		}
	}
	return getFallbackName();
}

function getAvatarUrl(name) {
	// Generate a unique seed based on the first name to get a consistent face from Dicebear
	const seedName = name.split(' ')[0] || 'user';
	return `https://api.dicebear.com/7.x/lorelei/svg?seed=${encodeURIComponent(seedName)}`;
}

function updatePreview() {
	updateDynamicInputs();
	const var1 = document.getElementById('field-var1').value || '';
	const var2 = document.getElementById('field-var2').value || '';
	const var3 = document.getElementById('field-var3').value || '';
	const var4 = document.getElementById('field-var4').value || '';
	const waNum = document.getElementById('field-button-param').value || '';

	const select = document.getElementById('field-template');
	let selectedTemplateVal = select ? select.value : 'all_rotation';

	// Update dynamic User Name in Mockup Header based on recipient name (fallback to a random real name)
	const phoneNameEl = document.querySelector('.phone-name');
	const phoneAvatarEl = document.querySelector('.phone-avatar');

	const recipientName = getFirstContactName();

	if (phoneNameEl) {
		phoneNameEl.innerHTML = `${recipientName} <i data-lucide="check-circle-2" style="width: 12.5px; height: 12.5px; fill: #00e676; color: #ffffff; display: inline-block; vertical-align: middle; stroke-width: 2.5px; margin-left: 2px;"></i>`;
	}

	// Update dynamic avatar using a random loaded avatar URL matching the name
	if (phoneAvatarEl) {
		phoneAvatarEl.style.background = '#f8fafc';
		phoneAvatarEl.style.width = '32px';
		phoneAvatarEl.style.height = '32px';
		phoneAvatarEl.style.display = 'block';
		phoneAvatarEl.style.overflow = 'hidden';
		phoneAvatarEl.style.borderRadius = '50%';
		phoneAvatarEl.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
		phoneAvatarEl.style.border = '1px solid rgba(0,0,0,0.08)';

		const avatarUrl = getAvatarUrl(recipientName);
		phoneAvatarEl.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; display: block; object-fit: cover;" alt="avatar" onerror="this.outerHTML='<i data-lucide=&quot;user&quot; style=&quot;width: 16px; height: 16px; color: #54656f;&quot;></i>'">`;
	}

	let templateHeader = "";
	let templateBody = "Hello {{1}},\n\nWe appreciate you contacting us. Below are the details regarding your query:\n\n{{2}}\n\n{{3}}\n\n{{4}}\n\nLet us know if you have any questions.";
	let templateFooter = "";
	let buttons = [
		{ "type": "URL", "text": "WhatsApp Now" },
		{ "type": "QUICK_REPLY", "text": "Stop Promotions" }
	];

	// Find the matched cached template structure
	let activeTpl = null;
	if (selectedTemplateVal === "all_rotation") {
		if (window.templatesCached && window.templatesCached.length > 0) {
			activeTpl = window.templatesCached[0];
		}
	} else {
		activeTpl = window.templatesCached.find(t => t.name === selectedTemplateVal);
	}

	if (activeTpl && activeTpl.components) {
		const headerCmp = activeTpl.components.find(c => c.type && c.type.toUpperCase() === "HEADER");
		if (headerCmp && headerCmp.text) {
			templateHeader = headerCmp.text;
		}
		const bodyCmp = activeTpl.components.find(c => c.type && c.type.toUpperCase() === "BODY");
		if (bodyCmp && bodyCmp.text) {
			templateBody = bodyCmp.text;
		}
		const footerCmp = activeTpl.components.find(c => c.type && c.type.toUpperCase() === "FOOTER");
		if (footerCmp && footerCmp.text) {
			templateFooter = footerCmp.text;
		}
		const btnCmp = activeTpl.components.find(c => c.type && c.type.toUpperCase() === "BUTTONS");
		if (btnCmp && btnCmp.buttons) {
			buttons = btnCmp.buttons;
		}
	}

	// Substitute placeholders in header, body, footer
	let formattedHeader = templateHeader;
	let formattedBody = templateBody;
	let formattedFooter = templateFooter;

	[formattedHeader, formattedBody, formattedFooter] = [formattedHeader, formattedBody, formattedFooter].map(text => {
		let t = text || '';
		t = t.replace(/\{\{1\}\}/g, var1);
		t = t.replace(/\{\{2\}\}/g, var2);
		t = t.replace(/\{\{3\}\}/g, var3);
		t = t.replace(/\{\{4\}\}/g, var4);
		return t;
	});

	// Build buttons list HTML
	let buttonsHtml = '';
	if (buttons && buttons.length > 0) {
		buttonsHtml = buttons.map(btn => {
			let icon = '<i data-lucide="reply" style="width:11px; height:11px; color:#006653; margin-right:4px;"></i>';
			const bType = (btn.type || '').toUpperCase();
			if (bType === 'URL') {
				icon = '<i data-lucide="external-link" style="width:11px; height:11px; color:#006653; margin-right:4px;"></i>';
			} else if (bType === 'PHONE_NUMBER') {
				icon = '<i data-lucide="phone" style="width:11px; height:11px; color:#006653; margin-right:4px;"></i>';
			}
			return `
				<div class="wa-button-wrapper">
					<a href="#" class="wa-btn" onclick="return false;">
						${icon} ${btn.text}
					</a>
				</div>
			`;
		}).join('');
	}
	const mockupBody = document.querySelector('.phone-body');
	if (mockupBody) {
		let headerHtml = formattedHeader ? `<div style="font-weight: 700; font-size: 13px; margin-bottom: 6px; color: #111b21;">${formattedHeader}</div>` : '';
		let footerHtml = formattedFooter ? `<div style="font-size: 10px; color: #667781; margin-top: 4px; margin-bottom: 2px;">${formattedFooter}</div>` : '';

		let mediaHeaderHtml = '';
		if (window.selectedMedia) {
			if (window.selectedMedia.type.startsWith('image/')) {
				mediaHeaderHtml = `<div class="wa-media-header" style="margin-bottom: 8px; border-radius: 8px; overflow: hidden; max-height: 180px; display: flex; align-items: center; justify-content: center; background: #e2e8f0;"><img src="${window.selectedMedia.url}" style="width: 100%; height: 100%; object-fit: cover; display: block;" /></div>`;
			} else if (window.selectedMedia.type.startsWith('video/')) {
				mediaHeaderHtml = `<div class="wa-media-header" style="margin-bottom: 8px; border-radius: 8px; overflow: hidden; max-height: 180px; display: flex; align-items: center; justify-content: center; background: #e2e8f0;"><video src="${window.selectedMedia.url}" style="width: 100%; height: 100%; object-fit: cover; display: block;" controls /></div>`;
			} else {
				mediaHeaderHtml = `
					<div class="wa-media-header" style="margin-bottom: 8px; background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; display: flex; align-items: center; gap: 10px; border: 1px solid rgba(0,0,0,0.06);">
						<i data-lucide="file-text" style="width: 24px; height: 24px; color: #ef4444; flex-shrink: 0;"></i>
						<div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1; text-align: left;">
							<div style="font-size: 11px; font-weight: 700; color: #0f172a; overflow: hidden; text-overflow: ellipsis;">${window.selectedMedia.name}</div>
							<div style="font-size: 9px; color: #64748b; font-weight: 600;">${(window.selectedMedia.size / 1024).toFixed(1)} KB • Document</div>
						</div>
					</div>
				`;
			}
		}

		mockupBody.innerHTML = `
			<div class="wa-bubble">
				${mediaHeaderHtml}
				${headerHtml}
				<div class="wa-text-line">${formattedBody}</div>
				${footerHtml}
				<div class="wa-time-row">
					<span id="preview-time">12:00 PM</span>
				</div>
				${buttonsHtml}
			</div>
		`;
		mockupBody.scrollTop = mockupBody.scrollHeight;
	}

	updatePreviewTime();
	lucide.createIcons();
}

function updatePreviewTime() {
	const now = new Date();
	let hours = now.getHours();
	let minutes = now.getMinutes();
	const ampm = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12;
	hours = hours ? hours : 12;
	minutes = minutes < 10 ? '0' + minutes : minutes;
	const strTime = hours + ':' + minutes + ' ' + ampm;

	const timeEl = document.getElementById('preview-time');
	if (timeEl) {
		timeEl.innerHTML = strTime + ' <i data-lucide="check-check" style="width:11px; height:11px; color:#53bdeb; display:inline-block; vertical-align:middle; margin-left:2px;"></i>';
	}
	lucide.createIcons();
}

// --- Tab Controller ---
function showTab(tabId) {
	document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
	document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
	document.getElementById('btn-' + tabId).classList.add('active');
	document.getElementById('tab-' + tabId).classList.add('active');

	localStorage.setItem('wa-manage-active-tab', tabId);

	// Show progress banner only on sender tab
	const progressBanner = document.getElementById('compact-sending-progress');
	if (progressBanner) {
		progressBanner.style.display = (tabId === 'sender') ? 'block' : 'none';
	}

	if (tabId === 'dashboard') {
		loadStats();
	}
	if (tabId === 'inbox') {
		loadChats();
	}
	// Re-draw icons for active tabs
	setTimeout(() => { lucide.createIcons(); }, 50);
}

// Keyboard navigation for tabs (Left/Right arrow keys)
document.addEventListener('keydown', (e) => {
	// Only trigger if user is not typing in an input, textarea, or active editing fields
	const activeEl = document.activeElement;
	if (activeEl && (
		activeEl.tagName === 'INPUT' || 
		activeEl.tagName === 'TEXTAREA' || 
		activeEl.isContentEditable
	)) {
		return;
	}

	const tabs = ['sender', 'dashboard', 'inbox'];
	// Find active tab
	let activeIndex = -1;
	for (let i = 0; i < tabs.length; i++) {
		const btn = document.getElementById('btn-' + tabs[i]);
		if (btn && btn.classList.contains('active')) {
			activeIndex = i;
			break;
		}
	}

	if (activeIndex === -1) return;

	if (e.key === 'ArrowRight') {
		const nextIndex = (activeIndex + 1) % tabs.length;
		showTab(tabs[nextIndex]);
	} else if (e.key === 'ArrowLeft') {
		const prevIndex = (activeIndex - 1 + tabs.length) % tabs.length;
		showTab(tabs[prevIndex]);
	}
});

// --- Dashboard Statistics Fetcher ---
window.lastStatsCache = "";
window.lastRowsCache = "";
window.lastRepliesCache = "";

async function loadStats() {
	const c = document.getElementById('campaign').value;
	try {
		// Load campaign logs immediately
		loadCampaignLogs(c);

		const [stats, rows, replies] = await Promise.all([
			fetch('/stats?campaign=' + encodeURIComponent(c)).then(r => r.json()),
			fetch('/statuses?limit=50&campaign=' + encodeURIComponent(c)).then(r => r.json()),
			fetch('/api/replies?limit=50&campaign=' + encodeURIComponent(c)).then(r => r.json())
		]);

		const statsStr = JSON.stringify(stats);
		const rowsStr = JSON.stringify(rows);
		const repliesStr = JSON.stringify(replies);

		if (statsStr === window.lastStatsCache && rowsStr === window.lastRowsCache && repliesStr === window.lastRepliesCache) {
			setLiveStatus(true);
			return;
		}

		window.lastStatsCache = statsStr;
		window.lastRowsCache = rowsStr;
		window.lastRepliesCache = repliesStr;

		document.getElementById('t-total').textContent = num(stats.total);
		document.getElementById('t-sent').textContent = num(stats.sent);
		document.getElementById('t-delivered').textContent = num(stats.delivered);
		document.getElementById('t-read').textContent = num(stats.read);
		document.getElementById('t-failed').textContent = num(stats.failed);
		document.getElementById('t-clicks').textContent = num(stats.clicks);
		document.getElementById('t-stops').textContent = num(stats.stops);

		document.getElementById('s-total').textContent = 'total campaign items';
		document.getElementById('s-sent').textContent = 'accepted by meta';
		document.getElementById('s-delivered').textContent = stats.delivery_rate + ' delivery rate';
		document.getElementById('s-read').textContent = stats.read_rate + ' read rate';
		document.getElementById('s-failed').textContent = 'failed deliveries';

		const totalContacts = stats.total || 1;
		document.getElementById('s-clicks').textContent = pct(stats.clicks, totalContacts) + '.0% click rate';
		document.getElementById('s-stops').textContent = pct(stats.stops, totalContacts) + '.0% opt-out rate';

		const t = stats.total || 1;
		const bar = document.getElementById('bar');
		if (bar) {
			bar.innerHTML = '<div class="bar-read" style="width:' + pct(stats.read, t) + '%"></div>'
				+ '<div class="bar-delivered" style="width:' + pct(stats.delivered - stats.read, t) + '%"></div>'
				+ '<div class="bar-sent" style="width:' + pct(stats.sent - stats.delivered, t) + '%"></div>'
				+ '<div class="bar-failed" style="width:' + pct(stats.failed, t) + '%"></div>';
		}

		const tbody = document.getElementById('tbody');
		const iconMap = {
			'SENT': '<i data-lucide="send" style="width:12px; height:12px;"></i>',
			'DELIVERED': '<i data-lucide="check-check" style="width:12px; height:12px;"></i>',
			'READ': '<i data-lucide="eye" style="width:12px; height:12px;"></i>',
			'FAILED': '<i data-lucide="alert-circle" style="width:12px; height:12px;"></i>',
			'QUEUED': '<i data-lucide="clock" style="width:12px; height:12px;"></i>'
		};

		if (tbody) {
			if (rows && rows.length) {
				tbody.innerHTML = rows.map(r => '<tr><td>' + r.phone + '</td><td style="color:#64748b">' + r.template + '</td><td><span class="status-badge status-' + r.status + '">' + (iconMap[r.status] || '') + ' ' + r.status + '</span></td><td style="color:#64748b;font-size:11px">' + (r.sent_at || '').replace('T', ' ').slice(0, 19) + '</td></tr>').join('');
			} else {
				tbody.innerHTML = '<tr><td colspan=4 style="text-align:center;color:#64748b;padding:40px; font-weight:600;"><i data-lucide="info" style="width:18px; height:18px; display:inline-block; margin-bottom:8px; opacity:0.6;"></i><br>No messages found in campaign</td></tr>';
			}
		}

		// Update customer replies table
		const tbodyReplies = document.getElementById('tbody-replies');
		if (tbodyReplies) {
			if (replies && replies.length) {
				tbodyReplies.innerHTML = replies.map(r => {
					let typeBadgeClass = 'status-SENT'; // Blueish fallback
					if (r.msg_type === 'button' || r.msg_type === 'interactive') {
						typeBadgeClass = 'status-READ'; // Teal
					} else if (r.text.toLowerCase().includes('stop') || r.text.toLowerCase().includes('block')) {
						typeBadgeClass = 'status-FAILED'; // Red
					}

					return `<tr>
						<td>${r.phone}</td>
						<td><span class="status-badge ${typeBadgeClass}">${r.msg_type.toUpperCase()}</span></td>
						<td style="font-weight: 600;">${r.text || '[Empty reply payload]'}</td>
						<td style="color:#64748b;font-size:11px">${(r.timestamp || '').replace('T', ' ').slice(0, 19)}</td>
					</tr>`;
				}).join('');
			} else {
				tbodyReplies.innerHTML = '<tr><td colspan=4 style="text-align:center;color:#64748b;padding:30px; font-weight:600;"><i data-lucide="info" style="width:18px; height:18px; display:inline-block; margin-bottom:8px; opacity:0.6;"></i><br>No customer responses received yet</td></tr>';
			}
		}

		// Refresh dynamic Lucide icons
		lucide.createIcons();
		

		setLiveStatus(true);
	} catch (e) {
		console.error("Dashboard error:", e);
		setLiveStatus(false);
	}
}

// --- Sender Functionalities ---
// --- Custom Select Event Handlers ---
function renderCustomSelectOptions() {
	const listContainer = document.getElementById('custom-select-options-list');
	if (!listContainer) return;

	const hiddenInput = document.getElementById('field-template');
	const selectedVal = hiddenInput ? hiddenInput.value : 'all_rotation';

	let html = '';

	// Default option (Rotation)
	const isRotSelected = selectedVal === 'all_rotation' ? 'selected' : '';
	html += `
		<div class="custom-select-option ${isRotSelected}" data-value="all_rotation" onclick="selectCustomOption('all_rotation', '🚀 Smart Rotation')">
			<span>🚀 Smart Rotation</span>
			${isRotSelected ? '<i data-lucide="check" style="width:14px; height:14px;"></i>' : ''}
		</div>
	`;

	// Template options
	if (window.templatesCached && window.templatesCached.length > 0) {
		window.templatesCached.forEach(t => {
			const isSelected = selectedVal === t.name ? 'selected' : '';
			html += `
				<div class="custom-select-option ${isSelected}" data-value="${t.name}" onclick="selectCustomOption('${t.name}', '${t.name}')">
					<span>${t.name}</span>
					${isSelected ? '<i data-lucide="check" style="width:14px; height:14px;"></i>' : ''}
				</div>
			`;
		});
	}

	listContainer.innerHTML = html;
	lucide.createIcons();
}

function toggleDropdown() {
	const container = document.getElementById('template-select-container');
	if (container) {
		container.classList.toggle('open');
	}
}

function selectCustomOption(value, text) {
	const hiddenInput = document.getElementById('field-template');
	if (hiddenInput) {
		hiddenInput.value = value;
	}

	const labelEl = document.getElementById('custom-select-label');
	if (labelEl) {
		labelEl.innerHTML = text;
	}

	const container = document.getElementById('template-select-container');
	if (container) {
		container.classList.remove('open');
	}

	const searchInput = document.getElementById('custom-select-search');
	if (searchInput) {
		searchInput.value = '';
		searchInput.blur();
	}
	filterDropdownOptions('');

	renderCustomSelectOptions();
	updatePreview();
}

function filterDropdownOptions(query) {
	const lowercaseQuery = query.toLowerCase();
	const options = document.querySelectorAll('#custom-select-options-list .custom-select-option');
	options.forEach(opt => {
		const val = opt.getAttribute('data-value').toLowerCase();
		if (val.includes(lowercaseQuery) || val === 'all_rotation') {
			opt.style.display = 'flex';
		} else {
			opt.style.display = 'none';
		}
	});
}

function toggleCampaignDropdown(event) {
	if (event) event.stopPropagation();
	const container = document.getElementById('campaign-select-container');
	if (container) {
		container.classList.toggle('open');
	}
}

function selectCampaignOption(value, text) {
	const hiddenInput = document.getElementById('campaign');
	if (hiddenInput) {
		hiddenInput.value = value;
	}

	const labelEl = document.getElementById('campaign-select-label');
	if (labelEl) {
		labelEl.innerHTML = text;
	}

	const container = document.getElementById('campaign-select-container');
	if (container) {
		container.classList.remove('open');
	}

	const searchInput = document.getElementById('campaign-select-search');
	if (searchInput) {
		searchInput.value = '';
		searchInput.blur();
	}
	filterCampaignOptions('');

	// Toggle selected class
	const options = document.querySelectorAll('#campaign-select-options-list .custom-select-option');
	options.forEach(opt => {
		if (opt.getAttribute('data-value') === value) {
			opt.classList.add('selected');
			if (!opt.querySelector('.lucide-check')) {
				opt.innerHTML = `<span>${opt.querySelector('span').textContent}</span><i data-lucide="check" class="lucide-check" style="width:14px; height:14px; color:#10b981;"></i>`;
			}
		} else {
			opt.classList.remove('selected');
			const tick = opt.querySelector('.lucide-check');
			if (tick) tick.remove();
		}
	});
	lucide.createIcons();

	loadStats();
}

function filterCampaignOptions(query) {
	const lowercaseQuery = query.toLowerCase();
	const options = document.querySelectorAll('#campaign-select-options-list .custom-select-option');
	options.forEach(opt => {
		const val = opt.getAttribute('data-value').toLowerCase();
		if (val.includes(lowercaseQuery) || val === 'default') {
			opt.style.display = 'flex';
		} else {
			opt.style.display = 'none';
		}
	});
}

window.toggleCampaignDropdown = toggleCampaignDropdown;
window.selectCampaignOption = selectCampaignOption;
window.filterCampaignOptions = filterCampaignOptions;

document.addEventListener('click', function (event) {
	const container = document.getElementById('template-select-container');
	if (container && !container.contains(event.target)) {
		container.classList.remove('open');
		const searchInput = document.getElementById('custom-select-search');
		if (searchInput) {
			searchInput.blur();
		}
	}

	const campaignContainer = document.getElementById('campaign-select-container');
	if (campaignContainer && !campaignContainer.contains(event.target)) {
		campaignContainer.classList.remove('open');
		const searchInput = document.getElementById('campaign-select-search');
		if (searchInput) {
			searchInput.blur();
		}
	}
});

// --- Sender Functionalities ---
async function loadTemplates() {
	try {
		const res = await fetch('/api/templates');
		window.templatesCached = await res.json();

		// Build the custom options list
		renderCustomSelectOptions();

		// Load the saved configuration if it exists, otherwise render the default values
		const loaded = await loadSavedConfiguration(true);
		if (!loaded) {
			updatePreview();
		}

		showToast("Templates synced!", 'success');
		setLiveStatus(true);
	} catch (e) {
		console.error("Templates load error:", e);
		setLiveStatus(false);
		showToast("Sync failed!", 'error');
	}
}

function parseLogLineToHTML(line) {
	// Format: [20:11:23] 📬 917978754127 → delivered [wamid.HBgMOTE3OTc4Nz]
	const timeMatch = line.match(/^\[([\d:]+)\]/);
	const timeStr = timeMatch ? timeMatch[1] : '';
	let contentStr = timeMatch ? line.substring(timeMatch[0].length).trim() : line;

	// Extract emoji if present
	const emojiMatch = contentStr.match(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2705}\u{274C}\u{274E}\u2611\u26A0\u26A1\u23F3\u23F0\u23E9\u23F8\u23F9\u2934\u2935\u2192\u27A1]|\u2705|\u274c|\u274e)\s*(.*)$/u);

	let emoji = '';
	let msg = contentStr;
	if (emojiMatch) {
		emoji = emojiMatch[1];
		msg = emojiMatch[2];
	}

	// Check if it's a delivery status transition log:
	// e.g. "917978754127 → delivered [wamid.HBgMOTE3OTc4Nz]" or similar
	const arrowMatch = msg.match(/^([\d+]+)\s*→\s*(\w+)\s*(?:\[([^\]]+)\])?$/) || msg.match(/^([\d+]+)\s*→\s*(\w+)\s*$/);

	if (arrowMatch) {
		const phone = arrowMatch[1];
		const status = arrowMatch[2].toUpperCase();
		const msgId = arrowMatch[3] || '';

		let statusIcon = 'send';
		let statusColor = '#3b82f6';
		let statusBg = 'rgba(59,130,246,0.08)';

		if (status === 'DELIVERED') {
			statusIcon = 'check-check';
			statusColor = '#10b981';
			statusBg = 'rgba(16, 185, 129, 0.08)';
		} else if (status === 'READ') {
			statusIcon = 'eye';
			statusColor = '#0d9488';
			statusBg = 'rgba(13, 148, 136, 0.08)';
		} else if (status === 'FAILED') {
			statusIcon = 'alert-triangle';
			statusColor = '#ef4444';
			statusBg = 'rgba(239, 68, 68, 0.08)';
		} else if (status === 'SENT') {
			statusIcon = 'send';
			statusColor = '#3b82f6';
			statusBg = 'rgba(59, 130, 246, 0.08)';
		}

		let displayId = msgId || '';
		if (displayId.startsWith('wamid.')) {
			displayId = displayId.replace('wamid.', '');
		}
		if (displayId.length > 14) {
			displayId = displayId.substring(0, 8) + '...' + displayId.substring(displayId.length - 4);
		}

		return `
			<div class="log-card status-card" style="border-left: 2px solid ${statusColor};">
				<span class="log-time">${timeStr}</span>
				<span class="log-emoji">${emoji || '📬'}</span>
				<div class="log-details">
					<span class="log-phone">${phone}</span>
					<span class="log-arrow"><i data-lucide="arrow-right" style="width: 10px; height: 10px; color: #64748b;"></i></span>
					<span class="log-status-badge" style="color: ${statusColor}; background: ${statusBg}; border-color: ${statusColor}1e;">
						<i data-lucide="${statusIcon}" style="width: 10px; height: 10px; display: inline-block; vertical-align: middle; margin-right: 3px;"></i>
						${status}
					</span>
					${msgId ? `<span class="log-id copyable-wamid" onclick="copyToClipboard('${msgId}')" title="Click to copy: ${msgId}" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background: rgba(0,0,0,0.04); border-radius: 4px; transition: background 0.2s;"><i data-lucide="copy" style="width: 10px; height: 10px; opacity: 0.6;"></i>ID: ${displayId}</span>` : ''}
				</div>
			</div>
		`;
	}

	// Check if it's an incoming webhook log:
	// e.g. "Incoming from 917908325020: [text] Hello"
	const incomingMatch = msg.match(/^Incoming from ([\d+]+):\s*(.*)$/);
	if (incomingMatch || emoji === '💬') {
		const phone = incomingMatch ? incomingMatch[1] : (msg.match(/from ([\d+]+)/) ? msg.match(/from ([\d+]+)/)[1] : 'Webhook');
		const textContent = incomingMatch ? incomingMatch[2] : msg;

		return `
			<div class="log-card incoming-card" style="border-left: 2px solid #14b8a6; background: rgba(20, 184, 166, 0.02);">
				<span class="log-time">${timeStr}</span>
				<span class="log-emoji">${emoji || '💬'}</span>
				<div class="log-details">
					<span class="log-incoming-title">Incoming Chat</span>
					<span class="log-phone">${phone}</span>
					<span class="log-incoming-msg">${textContent}</span>
				</div>
			</div>
		`;
	}

	// Normal server/campaign log styling:
	let borderStyle = 'border-left: 2px solid #cbd5e1;';
	let cardBg = '';
	if (line.includes('✅') || line.includes('APPROVED')) {
		borderStyle = 'border-left: 2px solid #10b981;';
		cardBg = 'rgba(16, 185, 129, 0.02)';
	} else if (line.includes('❌') || line.includes('REJECTED') || line.includes('💀')) {
		borderStyle = 'border-left: 2px solid #ef4444;';
		cardBg = 'rgba(239, 68, 68, 0.02)';
	} else if (line.includes('🛑') || line.includes('🚫') || line.includes('⚠️') || line.includes('PAUSED')) {
		borderStyle = 'border-left: 2px solid #f59e0b;';
		cardBg = 'rgba(245, 158, 11, 0.02)';
	} else if (line.includes('🚀') || line.includes('Starting') || line.includes('Campaign ID:')) {
		borderStyle = 'border-left: 2px solid #3b82f6;';
		cardBg = 'rgba(59, 130, 246, 0.02)';
	}

	return `
		<div class="log-card info-card" style="${borderStyle} ${cardBg ? `background: ${cardBg};` : ''}">
			<span class="log-time">${timeStr}</span>
			<span class="log-emoji">${emoji || '⚙️'}</span>
			<span class="log-info-msg">${msg}</span>
		</div>
	`;
}

let eventSource = null;
let activeEventSourceCampaignId = null;
let loadedStaticLogsCampaignId = null;

function connectLogs() {
	if (eventSource) {
		eventSource.close();
	}
	const consoleBody = document.getElementById('console-body');
	if (consoleBody) {
		consoleBody.innerHTML = '';
	}
	const placeholder = document.getElementById('console-placeholder');
	if (placeholder) placeholder.remove();

	const dot = document.getElementById('console-status-dot');

	eventSource = new EventSource('/api/campaign-logs');

	eventSource.onopen = function () {
		if (dot) {
			dot.className = 'console-dot green';
		}
	};

	eventSource.onmessage = function (event) {
		const line = event.data;
		if (line.trim() === "") return;

		const parsedHtml = parseLogLineToHTML(line);

		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = parsedHtml;
		const logNode = tempDiv.firstElementChild;

		if (consoleBody) {
			consoleBody.appendChild(logNode);
			consoleBody.scrollTop = consoleBody.scrollHeight;
		}

		// Update newly added Lucide icons
		lucide.createIcons();
	};

	eventSource.onerror = function (e) {
		console.log("SSE log disconnected. Ready to reconnect.");
		if (dot) {
			dot.className = 'console-dot red';
		}
	};
}

async function loadCampaignLogs(campaignId) {
	try {
		const statusRes = await fetch('/api/campaign-status');
		const statusData = await statusRes.json();
		
		const consoleBody = document.getElementById('console-body');
		if (!consoleBody) return;
		
		const dot = document.getElementById('console-status-dot');
		
		if (statusData.running && statusData.campaign_id === campaignId) {
			loadedStaticLogsCampaignId = null;
			if (activeEventSourceCampaignId !== campaignId) {
				activeEventSourceCampaignId = campaignId;
				connectLogs();
			}
		} else {
			if (eventSource) {
				eventSource.close();
				eventSource = null;
				activeEventSourceCampaignId = null;
			}
			
			if (loadedStaticLogsCampaignId !== campaignId) {
				const res = await fetch('/api/get-campaign-logs?campaign=' + encodeURIComponent(campaignId));
				if (!res.ok) {
					if (dot) dot.className = 'console-dot red';
					return;
				}
				const logs = await res.json();
				
				consoleBody.innerHTML = '';
				if (logs && logs.length > 0) {
					logs.forEach(line => {
						const parsedHtml = parseLogLineToHTML(line);
						const tempDiv = document.createElement('div');
						tempDiv.innerHTML = parsedHtml;
						consoleBody.appendChild(tempDiv.firstElementChild);
					});
					consoleBody.scrollTop = consoleBody.scrollHeight;
					lucide.createIcons();
				} else {
					consoleBody.innerHTML = '<div class="console-placeholder" style="color: #64748b; text-align: center; padding-top: 120px; font-style: italic;">No logs recorded for this campaign.</div>';
				}
				loadedStaticLogsCampaignId = campaignId;
				if (dot) dot.className = 'console-dot green';
			} else {
				if (dot) dot.className = 'console-dot green';
			}
		}
	} catch (e) {
		console.error("Failed to load campaign logs:", e);
		const dot = document.getElementById('console-status-dot');
		if (dot) dot.className = 'console-dot red';
	}
}
// Track campaign progress timing for ETA calculation
let _campaignStartTime = null;
let _lastCampaignId = null;

async function checkCampaignStatus() {
	try {
		const res = await fetch('/api/campaign-status');
		const data = await res.json();

		const btnStart = document.getElementById('btn-start');
		if (btnStart) btnStart.disabled = data.running;

		const compactProgress = document.getElementById('compact-sending-progress');
		if (compactProgress) {
			const barEl = document.getElementById('compact-progress-bar');
			const sentEl = document.getElementById('compact-stat-sent');
			const remainingEl = document.getElementById('compact-stat-remaining');
			const speedEl = document.getElementById('compact-stat-speed');
			const etaEl = document.getElementById('compact-stat-eta');

			const activeId = data.running ? data.campaign_id : data.last_campaign_id;

			if (activeId) {
				// Track start time per campaign if it's currently running
				if (data.running) {
					if (_lastCampaignId !== data.campaign_id) {
						_campaignStartTime = Date.now();
						_lastCampaignId = data.campaign_id;
					}
				} else {
					_campaignStartTime = null;
					_lastCampaignId = null;
				}
				
				// Fetch real-time stats for the active/last campaign
				const statsRes = await fetch('/stats?campaign=' + encodeURIComponent(activeId));
				const stats = await statsRes.json();
				
				const sent = stats.sent || 0;
				const failed = stats.failed || 0;
				const processed = sent + failed;
				const total = stats.total || 0;
				const remaining = Math.max(0, total - processed);
				const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
				
				// Calculate speed and ETA based on backend stats
				const speed = stats.speed || 0;
				const speedText = speed > 0 ? `${speed}/min` : '–';

				let etaText = '–';
				if (remaining > 0 && speed > 0) {
					const etaSec = remaining / (speed / 60);
					if (etaSec < 60) {
						etaText = `${Math.ceil(etaSec)}s`;
					} else if (etaSec < 3600) {
						const m = Math.floor(etaSec / 60);
						const s = Math.ceil(etaSec % 60);
						etaText = `${m}m ${s}s`;
					} else {
						const h = Math.floor(etaSec / 3600);
						const m = Math.ceil((etaSec % 3600) / 60);
						etaText = `${h}h ${m}m`;
					}
				} else if (remaining === 0 && total > 0) {
					etaText = 'Done!';
				}

				if (barEl) barEl.style.width = `${percent}%`;
				if (sentEl) sentEl.textContent = processed;
				if (remainingEl) remainingEl.textContent = remaining;
				if (speedEl) speedEl.textContent = speedText;
				if (etaEl) etaEl.textContent = etaText;
			} else {
				// Idle state
				if (barEl) barEl.style.width = '0%';
				if (sentEl) sentEl.textContent = '0';
				if (remainingEl) remainingEl.textContent = '0';
				if (speedEl) speedEl.textContent = '–';
				if (etaEl) etaEl.textContent = '–';
				_campaignStartTime = null;
				_lastCampaignId = null;
			}
		}

		setLiveStatus(true);
	} catch (e) {
		console.error("Status check error:", e);
		setLiveStatus(false);
	}
}

function formatCampaignDate(date) {
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const month = months[date.getMonth()];
	const day = date.getDate();
	let hours = date.getHours();
	const minutes = date.getMinutes();
	const ampm = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12;
	hours = hours ? hours : 12; // the hour '0' should be '12'
	const minutesStr = minutes < 10 ? '0' + minutes : minutes;
	return `${month} ${day} ${hours}:${minutesStr} ${ampm}`;
}

function addCampaignOption(campaignId) {
	const listEl = document.getElementById('campaign-select-options-list');
	if (!listEl) return;

	let existing = listEl.querySelector(`.custom-select-option[data-value="${campaignId}"]`);
	if (!existing) {
		const opt = document.createElement('div');
		opt.className = 'custom-select-option';
		opt.setAttribute('data-value', campaignId);
		opt.onclick = () => selectCampaignOption(campaignId, campaignId);
		opt.innerHTML = `<span>${campaignId}</span>`;
		listEl.insertBefore(opt, listEl.firstChild);
	}
}

async function startCampaign() {
	const nameInput = document.getElementById('field-campaign-name').value;
	const name = nameInput.trim() !== "" ? nameInput : "Campaign";
	const template = document.getElementById('field-template').value;
	const var1 = document.getElementById('field-var1').value;
	const var2 = document.getElementById('field-var2').value;
	const var3 = document.getElementById('field-var3').value;
	const var4 = document.getElementById('field-var4').value;
	const buttonParam = document.getElementById('field-button-param').value;
	const workers = parseInt(document.getElementById('field-workers').value) || 40;

	// Format and clean manually pasted/typed numbers
	cleanAndValidateTextarea();
	updateNumbersCount();

	const numsRaw = document.getElementById('field-numbers').value;
	let numbers = [];
	if (numsRaw.trim() !== "") {
		numbers = numsRaw.split('\n').map(n => n.trim()).filter(n => n !== "");
	}

	const payload = {
		campaign_name: name,
		template: template,
		var1: var1,
		var2: var2,
		var3: var3,
		var4: var4,
		button_param: buttonParam,
		numbers: numbers,
		workers: workers
	};

	try {
		const res = await fetch('/api/start-campaign', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = await res.json();
		if (data.error) {
			showToast(data.error, 'error');
		} else {
			showToast("Campaign started!", 'success');
			connectLogs();
			
			// Format local date and register the new campaign ID in the select dropdown
			const dateStr = formatCampaignDate(new Date());
			const campaignId = `${name} - Send ${dateStr}`;
			addCampaignOption(campaignId);
			selectCampaignOption(campaignId, campaignId);
			
			setTimeout(checkCampaignStatus, 500);
		}
	} catch (e) {
		console.error("Start Campaign failed:", e);
		showToast("Start failed!", 'error');
	}
}


async function stopCampaign() {
	if (!confirm("Are you sure you want to stop the running campaign?")) {
		return;
	}
	try {
		const res = await fetch('/api/stop-campaign', { method: 'POST' });
		const data = await res.json();
		if (data.error) {
			showToast(data.error, 'error');
		} else {
			showToast("Campaign stopped!", 'warning');
		}
		setTimeout(checkCampaignStatus, 500);
	} catch (e) {
		console.error("Abort Campaign failed:", e);
		showToast("Stop failed!", 'error');
	}
}

// --- Server-Side message.txt Settings Persistence ---
async function saveConfiguration() {
	const config = {
		campaignName: document.getElementById('field-campaign-name').value,
		template: document.getElementById('field-template').value,
		var1: document.getElementById('field-var1').value,
		var2: document.getElementById('field-var2').value,
		var3: document.getElementById('field-var3').value,
		var4: document.getElementById('field-var4').value,
		buttonParam: document.getElementById('field-button-param').value,
		numbers: document.getElementById('field-numbers').value
	};

	try {
		const res = await fetch('/api/save-config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config)
		});
		const data = await res.json();
		if (data.success) {
			showToast("Settings saved to message.txt!", "success");
		} else {
			showToast("Failed to save to message.txt!", "error");
		}
	} catch (e) {
		console.error("Save config failed:", e);
		showToast("Save failed!", "error");
	}
}

async function loadSavedConfiguration(shouldUpdatePreview = true) {
	try {
		const res = await fetch('/api/load-config');
		const config = await res.json();

		if (!config || Object.keys(config).length === 0) return false;

		if (config.campaignName !== undefined) document.getElementById('field-campaign-name').value = config.campaignName;
		if (config.template !== undefined) {
			const hiddenInput = document.getElementById('field-template');
			if (hiddenInput) hiddenInput.value = config.template;
			const labelEl = document.getElementById('custom-select-label');
			if (labelEl) {
				labelEl.innerHTML = config.template === 'all_rotation' ? '🚀 Smart Rotation' : config.template;
			}
			renderCustomSelectOptions();
		}
		if (config.var1 !== undefined) document.getElementById('field-var1').value = config.var1;
		if (config.var2 !== undefined) document.getElementById('field-var2').value = config.var2;
		if (config.var3 !== undefined) document.getElementById('field-var3').value = config.var3;
		if (config.var4 !== undefined) document.getElementById('field-var4').value = config.var4;
		if (config.buttonParam !== undefined) document.getElementById('field-button-param').value = config.buttonParam;
		if (config.numbers !== undefined) {
			document.getElementById('field-numbers').value = config.numbers;
			updateNumbersCount();
		}

		if (shouldUpdatePreview) {
			updatePreview();
		}
		return true;
	} catch (e) {
		console.error("Error loading saved configuration:", e);
		return false;
	}
}

function clearConfiguration() {
	document.getElementById('field-campaign-name').value = '';
	
	const hiddenInput = document.getElementById('field-template');
	if (hiddenInput) hiddenInput.value = 'all_rotation';
	
	const labelEl = document.getElementById('custom-select-label');
	if (labelEl) {
		labelEl.innerHTML = '🚀 Smart Rotation';
	}
	renderCustomSelectOptions();

	document.getElementById('field-var1').value = '';
	document.getElementById('field-var2').value = '';
	document.getElementById('field-var3').value = '';
	document.getElementById('field-var4').value = '';
	document.getElementById('field-button-param').value = '';
	document.getElementById('field-numbers').value = '';
	
	// Remove media if any selected (silent call to removeSelectedMedia)
	if (window.selectedMedia) {
		if (window.selectedMedia.url) {
			URL.revokeObjectURL(window.selectedMedia.url);
		}
		window.selectedMedia = null;

		const content = document.getElementById('media-drop-content');
		if (content) {
			content.innerHTML = `
				<i data-lucide="image" class="drop-icon" style="width: 24px; height: 24px; color: #3b82f6; margin-bottom: 6px;"></i>
				<span class="drop-text" style="font-size: 11px;">Drag & Drop Media</span>
				<span class="drop-subtext" style="font-size: 9px; line-height: 1.2;">Images, Videos, PDF</span>
			`;
			lucide.createIcons();
		}

		const mediaInput = document.getElementById('media-input');
		if (mediaInput) mediaInput.value = '';
	}

	updateNumbersCount();
	updatePreview();
	showToast("Form cleared!", "success");
}

// --- File Drag & Drop + Parse Functionality ---
function setupDragAndDrop() {
	const dropZone = document.getElementById('file-drop-zone');
	const mediaZone = document.getElementById('media-drop-zone');
	const textarea = document.getElementById('field-numbers');

	if (textarea) {
		textarea.addEventListener('input', () => {
			updateNumbersCount();
			updatePreview();
		});
		textarea.addEventListener('blur', () => {
			cleanAndValidateTextarea();
			updateNumbersCount();
			updatePreview();
		});
		textarea.addEventListener('paste', () => {
			setTimeout(() => {
				cleanAndValidateTextarea();
				updateNumbersCount();
				updatePreview();
			}, 50);
		});
		// Run initial update on load
		updateNumbersCount();
	}

	if (dropZone) {
		['dragenter', 'dragover'].forEach(eventName => {
			dropZone.addEventListener(eventName, (e) => {
				e.preventDefault();
				dropZone.classList.add('dragover');
			}, false);
		});

		['dragleave', 'drop'].forEach(eventName => {
			dropZone.addEventListener(eventName, (e) => {
				e.preventDefault();
				dropZone.classList.remove('dragover');
			}, false);
		});

		dropZone.addEventListener('drop', (e) => {
			const dt = e.dataTransfer;
			const files = dt.files;
			if (files && files.length > 0) {
				handleFileDrop(files[0]);
			}
		}, false);
	}

	if (mediaZone) {
		['dragenter', 'dragover'].forEach(eventName => {
			mediaZone.addEventListener(eventName, (e) => {
				e.preventDefault();
				mediaZone.classList.add('dragover');
			}, false);
		});

		['dragleave', 'drop'].forEach(eventName => {
			mediaZone.addEventListener(eventName, (e) => {
				e.preventDefault();
				mediaZone.classList.remove('dragover');
			}, false);
		});

		mediaZone.addEventListener('drop', (e) => {
			const dt = e.dataTransfer;
			const files = dt.files;
			if (files && files.length > 0) {
				handleMediaDrop(files[0]);
			}
		}, false);
	}
}

function triggerFileSelect() {
	const fileInput = document.getElementById('file-input');
	if (fileInput) {
		fileInput.click();
	}
}

function handleFileSelect(event) {
	const files = event.target.files;
	if (files && files.length > 0) {
		handleFileDrop(files[0]);
	}
}

window.selectedMedia = null;

function triggerMediaSelect() {
	const mediaInput = document.getElementById('media-input');
	if (mediaInput) {
		mediaInput.click();
	}
}

function handleMediaSelect(event) {
	const files = event.target.files;
	if (files && files.length > 0) {
		handleMediaDrop(files[0]);
	}
}

function handleMediaDrop(file) {
	showToast(`Loaded media: ${file.name}`, 'success');

	// Create local object URL for preview
	const url = URL.createObjectURL(file);

	window.selectedMedia = {
		name: file.name,
		type: file.type,
		size: file.size,
		url: url
	};

	// Update drop zone display to show loaded file details
	const content = document.getElementById('media-drop-content');
	if (content) {
		content.style.position = 'relative';
		content.innerHTML = `
			<i data-lucide="file-check" class="drop-icon" style="width: 24px; height: 24px; color: #10b981; margin-bottom: 6px;"></i>
			<span class="drop-text" style="font-size: 10px; font-weight: 700; color: #0f172a; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</span>
			<span onclick="removeSelectedMedia(event)" style="font-size: 9px; color: #ef4444; margin-top: 4px; font-weight: 700; text-transform: uppercase; cursor: pointer; display: block; hover: opacity: 0.8;">[Remove]</span>
		`;
		lucide.createIcons();
	}

	updatePreview();
}

function removeSelectedMedia(event) {
	if (event) {
		event.stopPropagation();
	}

	if (window.selectedMedia && window.selectedMedia.url) {
		URL.revokeObjectURL(window.selectedMedia.url);
	}
	window.selectedMedia = null;

	const content = document.getElementById('media-drop-content');
	if (content) {
		content.innerHTML = `
			<i data-lucide="image" class="drop-icon" style="width: 24px; height: 24px; color: #3b82f6; margin-bottom: 6px;"></i>
			<span class="drop-text" style="font-size: 11px;">Drag & Drop Media</span>
			<span class="drop-subtext" style="font-size: 9px; line-height: 1.2;">Images, Videos, PDF</span>
		`;
		lucide.createIcons();
	}

	// Reset the media file input
	const mediaInput = document.getElementById('media-input');
	if (mediaInput) mediaInput.value = '';

	showToast("Media removed", "info");
	updatePreview();
}

window.triggerMediaSelect = triggerMediaSelect;
window.handleMediaSelect = handleMediaSelect;
window.removeSelectedMedia = removeSelectedMedia;

async function handleFileDrop(file) {
	showToast(`Processing ${file.name}...`, 'info');
	try {
		const numbers = await parseNumbersFromFile(file);
		if (numbers.length > 0) {
			const textarea = document.getElementById('field-numbers');
			if (textarea) {
				const existing = textarea.value.trim();
				let action = 'replace';
				if (existing.length > 0) {
					if (confirm(`Do you want to append ${numbers.length} numbers to the existing list? Click Cancel to overwrite instead.`)) {
						action = 'append';
					}
				}
				if (action === 'append') {
					textarea.value = existing + '\n' + numbers.join('\n');
				} else {
					textarea.value = numbers.join('\n');
				}
				showToast(`Successfully loaded ${numbers.length} numbers!`, 'success');
				updateNumbersCount();
				updatePreview();
			}
		} else {
			showToast("No valid phone numbers found in file.", 'warning');
		}
	} catch (err) {
		console.error("Error parsing file:", err);
		showToast(`Error parsing file: ${err.message}`, 'error');
	}

	const fileInput = document.getElementById('file-input');
	if (fileInput) fileInput.value = '';
}

function parseNumbersFromFile(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		const name = file.name.toLowerCase();

		if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
			reader.onload = function (e) {
				try {
					const data = new Uint8Array(e.target.result);
					if (typeof XLSX === 'undefined') {
						reject(new Error("Excel parser library is not loaded yet."));
						return;
					}
					const workbook = XLSX.read(data, { type: 'array' });
					const numbers = [];
					workbook.SheetNames.forEach(sheetName => {
						const worksheet = workbook.Sheets[sheetName];
						const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
						json.forEach(row => {
							if (!row || row.length === 0) return;
							let phone = '';
							let nameCandidate = '';

							row.forEach(cell => {
								if (cell === null || cell === undefined) return;
								const cellStr = String(cell).trim();
								if (cellStr === "") return;

								const cleaned = cleanPhoneNumber(cellStr);
								if (cleaned && !phone) {
									phone = cleaned;
								} else if (!cleaned && !nameCandidate) {
									// Make sure it looks like a name and not emails/numbers/short words
									if (cellStr.length > 1 && !cellStr.includes('@') && isNaN(cellStr)) {
										nameCandidate = cellStr;
									}
								}
							});

							if (phone) {
								if (nameCandidate) {
									numbers.push(`${phone}, ${nameCandidate}`);
								} else {
									numbers.push(phone);
								}
							}
						});
					});
					resolve(deduplicateArray(numbers));
				} catch (err) {
					reject(err);
				}
			};
			reader.onerror = () => reject(new Error("File reading error"));
			reader.readAsArrayBuffer(file);
		} else {
			reader.onload = function (e) {
				try {
					const text = e.target.result;
					const numbers = [];
					// Split by line breaks to get rows
					const lines = text.split(/\r?\n/);
					lines.forEach(line => {
						const trimmedLine = line.trim();
						if (trimmedLine === "") return;

						// Split by comma, semicolon, or tab
						const parts = trimmedLine.split(/[,;\t]+/);
						let phone = '';
						let nameCandidate = '';

						parts.forEach(part => {
							const trimmedPart = part.trim();
							if (trimmedPart === "") return;

							const cleaned = cleanPhoneNumber(trimmedPart);
							if (cleaned && !phone) {
								phone = cleaned;
							} else if (!cleaned && !nameCandidate) {
								if (trimmedPart.length > 1 && !trimmedPart.includes('@') && isNaN(trimmedPart)) {
									nameCandidate = trimmedPart;
								}
							}
						});

						if (phone) {
							if (nameCandidate) {
								numbers.push(`${phone}, ${nameCandidate}`);
							} else {
								numbers.push(phone);
							}
						}
					});
					resolve(deduplicateArray(numbers));
				} catch (err) {
					reject(err);
				}
			};
			reader.onerror = () => reject(new Error("File reading error"));
			reader.readAsText(file);
		}
	});
}

function cleanPhoneNumber(str) {
	let cleaned = str.replace(/[\s\-\(\)]/g, '');
	const hasPlus = cleaned.startsWith('+');
	cleaned = cleaned.replace(/\D/g, '');
	if (cleaned.length >= 10 && cleaned.length <= 15) {
		return cleaned;
	}
	return null;
}

function deduplicateArray(arr) {
	// Deduplicate by phone number only
	const seen = new Set();
	const result = [];
	arr.forEach(item => {
		const phone = item.split(',')[0].trim();
		if (!seen.has(phone)) {
			seen.add(phone);
			result.push(item);
		}
	});
	return result;
}

function cleanAndValidateTextarea() {
	const textarea = document.getElementById('field-numbers');
	if (!textarea) return;

	const val = textarea.value;
	if (val.trim() === "") return;

	const lines = val.split(/\r?\n/);
	const validLines = [];
	const invalidTokens = [];

	lines.forEach(line => {
		const trimmedLine = line.trim();
		if (trimmedLine === "") return;

		const parts = trimmedLine.split(/[,;\t]+/);
		let phone = '';
		let nameCandidate = '';

		parts.forEach(part => {
			const trimmedPart = part.trim();
			if (trimmedPart === "") return;

			const cleaned = cleanPhoneNumber(trimmedPart);
			if (cleaned && !phone) {
				phone = cleaned;
			} else if (!cleaned && !nameCandidate) {
				if (trimmedPart.length > 1 && !trimmedPart.includes('@') && isNaN(trimmedPart)) {
					nameCandidate = trimmedPart;
				}
			}
		});

		if (phone) {
			if (nameCandidate) {
				validLines.push(`${phone}, ${nameCandidate}`);
			} else {
				validLines.push(phone);
			}
		} else {
			invalidTokens.push(trimmedLine);
		}
	});

	textarea.value = validLines.join('\n');

	if (invalidTokens.length > 0) {
		showToast(`Removed ${invalidTokens.length} invalid items.`, 'warning');
	}
}

function updateNumbersCount() {
	const textarea = document.getElementById('field-numbers');
	const badge = document.getElementById('numbers-count-badge');
	if (!textarea || !badge) return;

	const val = textarea.value.trim();
	if (val === "") {
		badge.textContent = "0 numbers loaded";
		badge.style.color = "#475569";
		return;
	}

	const numbers = val.split('\n').map(n => n.trim()).filter(n => n !== "");
	badge.textContent = `${numbers.length} numbers loaded`;
	badge.style.color = "#10b981";
}

function saveTabsOrder() {
	const tabsContainer = document.querySelector('.tabs');
	if (!tabsContainer) return;

	const order = [...tabsContainer.querySelectorAll('.tab-btn')].map(btn => btn.id);
	localStorage.setItem('wa-manage-tabs-order', JSON.stringify(order));
}

function restoreTabsOrder() {
	const tabsContainer = document.querySelector('.tabs');
	if (!tabsContainer) return;

	const savedOrderStr = localStorage.getItem('wa-manage-tabs-order');
	if (!savedOrderStr) return;

	try {
		const savedOrder = JSON.parse(savedOrderStr);
		if (Array.isArray(savedOrder)) {
			savedOrder.forEach(id => {
				const btn = document.getElementById(id);
				if (btn && btn.parentNode === tabsContainer) {
					tabsContainer.appendChild(btn);
				}
			});
		}
	} catch (e) {
		console.error("Failed to restore tabs order:", e);
	}
}

function makeTabsDraggable() {
	const tabsContainer = document.querySelector('.tabs');
	if (!tabsContainer) return;

	tabsContainer.style.position = 'relative';
	tabsContainer.style.touchAction = 'none';

	const tabButtons = tabsContainer.querySelectorAll('.tab-btn');
	tabButtons.forEach(btn => {
		btn.style.position = 'relative';
		btn.style.touchAction = 'none';
		btn.style.userSelect = 'none';
		btn.style.webkitUserSelect = 'none';

		btn.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return; // Only left click / touch
			
			btn.setPointerCapture(e.pointerId);
			btn.classList.add('dragging');
			btn.style.zIndex = '100';
			btn.style.transition = 'none';

			let startX = e.clientX;
			let siblings = [...tabsContainer.querySelectorAll('.tab-btn')].filter(sib => sib !== btn);

			const onPointerMove = (moveEvent) => {
				const deltaX = moveEvent.clientX - startX;
				btn.style.transform = `translateX(${deltaX}px)`;

				const currentRect = btn.getBoundingClientRect();
				const currentMid = currentRect.left + currentRect.width / 2;

				for (let sib of siblings) {
					const sibRect = sib.getBoundingClientRect();
					const sibMid = sibRect.left + sibRect.width / 2;
					
					const btnIndex = [...tabsContainer.children].indexOf(btn);
					const sibIndex = [...tabsContainer.children].indexOf(sib);

					if (btnIndex < sibIndex && currentMid > sibMid) {
						const oldRect = btn.getBoundingClientRect();
						const sibOldRect = sib.getBoundingClientRect();

						tabsContainer.insertBefore(btn, sib.nextSibling);

						const sibNewRect = sib.getBoundingClientRect();
						const sibDiffX = sibOldRect.left - sibNewRect.left;
						sib.style.transition = 'none';
						sib.style.transform = `translateX(${sibDiffX}px)`;
						sib.offsetWidth; // force reflow
						sib.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
						sib.style.transform = '';

						const newRect = btn.getBoundingClientRect();
						startX += (newRect.left - oldRect.left);

						btn.style.transform = `translateX(${moveEvent.clientX - startX}px)`;
						break;
					} else if (btnIndex > sibIndex && currentMid < sibMid) {
						const oldRect = btn.getBoundingClientRect();
						const sibOldRect = sib.getBoundingClientRect();

						tabsContainer.insertBefore(btn, sib);

						const sibNewRect = sib.getBoundingClientRect();
						const sibDiffX = sibOldRect.left - sibNewRect.left;
						sib.style.transition = 'none';
						sib.style.transform = `translateX(${sibDiffX}px)`;
						sib.offsetWidth; // force reflow
						sib.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
						sib.style.transform = '';

						const newRect = btn.getBoundingClientRect();
						startX += (newRect.left - oldRect.left);

						btn.style.transform = `translateX(${moveEvent.clientX - startX}px)`;
						break;
					}
				}

				siblings = [...tabsContainer.querySelectorAll('.tab-btn')].filter(sib => sib !== btn);
			};

			const onPointerUp = (upEvent) => {
				btn.releasePointerCapture(upEvent.pointerId);
				btn.classList.remove('dragging');
				btn.style.zIndex = '';
				btn.style.transform = '';
				btn.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
				
				btn.removeEventListener('pointermove', onPointerMove);
				btn.removeEventListener('pointerup', onPointerUp);
				btn.removeEventListener('pointercancel', onPointerUp);

				siblings.forEach(sib => {
					sib.style.transition = '';
					sib.style.transform = '';
				});

				saveTabsOrder();
			};

			btn.addEventListener('pointermove', onPointerMove);
			btn.addEventListener('pointerup', onPointerUp);
			btn.addEventListener('pointercancel', onPointerUp);
		});
	});
}

// --- Init loaders ---
restoreTabsOrder();
const savedTab = localStorage.getItem('wa-manage-active-tab');
if (savedTab) {
	showTab(savedTab);
}
lucide.createIcons();
setupDragAndDrop();
makeTabsDraggable();
loadSavedConfiguration(false);
loadStats();
loadTemplates();
checkCampaignStatus();

setInterval(loadStats, 5000);
setInterval(checkCampaignStatus, 3000);

// --- INBOX TAB IMPLEMENTATION ---
window.activeChatPhone = "";
window.activeChatName = "";
window.isInboxSending = false;

window.inboxFilter = window.inboxFilter || 'all';

function setInboxFilter(filter) {
	window.inboxFilter = filter;
	loadChats();
}

async function loadChats() {
	try {
		const res = await fetch('/api/chats');
		if (!res.ok) return;
		const chats = await res.json();

		const totalMessages = res.headers.get("X-Total-Messages") || 0;
		const totalContacts = res.headers.get("X-Total-Contacts") || 0;
		const totalUnread = chats.reduce((sum, chat) => sum + (chat.unread_count || 0), 0);

		const statsBadges = document.getElementById('chats-stats-badges');
		if (statsBadges) {
			const allActive = window.inboxFilter === 'all' ? ' active' : '';
			const unreadActive = window.inboxFilter === 'unread' ? ' active' : '';

			let badgesHtml = `
				<div class="chats-badge${allActive}" onclick="event.stopPropagation(); setInboxFilter('all')" title="All Chats">
					All (${chats.length})
				</div>
			`;
			
			if (totalUnread > 0) {
				badgesHtml += `
					<div class="chats-badge${unreadActive} red-alert" onclick="event.stopPropagation(); setInboxFilter('unread')" title="Unread Chats">
						Unread (${totalUnread})
					</div>
				`;
			} else {
				badgesHtml += `
					<div class="chats-badge${unreadActive}" onclick="event.stopPropagation(); setInboxFilter('unread')" title="Unread Chats">
						Unread (0)
					</div>
				`;
			}

			badgesHtml += `
				<div class="chats-badge" title="Total Saved Contacts">
					Contacts (${totalContacts})
				</div>
			`;
			statsBadges.innerHTML = badgesHtml;
		}

		const listEl = document.getElementById('inbox-contacts-list');
		if (!listEl) return;

		// Filter list
		const chatsToShow = chats.filter(chat => {
			if (window.inboxFilter === 'unread') {
				return chat.unread_count > 0;
			}
			return true;
		});

		if (chatsToShow.length === 0) {
			listEl.innerHTML = `<div style="text-align:center;color:#64748b;padding:30px;font-style:italic;">No chats available</div>`;
			return;
		}

		let html = "";
		chatsToShow.forEach(chat => {
			const activeClass = chat.phone === window.activeChatPhone ? " active" : "";
			const snippet = chat.text || "[No message]";
			const directionIcon = chat.direction === "outgoing" ? "📤" : "📥";

			// Try to format date
			let timeStr = "";
			if (chat.last_time) {
				const date = new Date(chat.last_time);
				timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			}

			const displayTitle = chat.name ? chat.name : chat.phone;
			const displayPhone = chat.name ? `<span style="font-weight:normal; font-size:11px; color:#64748b; margin-left:6px;">(${chat.phone})</span>` : "";
			const nameArg = chat.name ? chat.name.replace(/'/g, "\\'") : "";

			const unreadBadge = (chat.unread_count > 0 && chat.phone !== window.activeChatPhone)
				? `<span style="background:#10b981; color:#ffffff; font-size:10px; font-weight:700; border-radius:10px; padding:2px 6px; min-width:18px; text-align:center; height:18px; line-height:14px; box-shadow: 0 2px 5px rgba(16,185,129,0.3);">${chat.unread_count}</span>`
				: "";

			html += `
				<div class="inbox-contact-item${activeClass}" onclick="selectChat('${chat.phone}', '${nameArg}')" style="position: relative;">
					<div class="inbox-contact-phone" style="display:flex; justify-content:space-between; align-items:center;">
						<span>${displayTitle}${displayPhone}</span>
						<div style="display:flex; align-items:center; gap:6px;">
							${unreadBadge}
							<button class="chat-delete-btn" onclick="event.stopPropagation(); deleteChat('${chat.phone}')" title="Delete Chat">
								<i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
							</button>
						</div>
					</div>
					<div class="inbox-contact-snippet">${directionIcon} ${snippet}</div>
					<div class="inbox-contact-time">${timeStr}</div>
				</div>
			`;
		});

		listEl.innerHTML = html;
		lucide.createIcons();
	} catch (e) {
		console.error("Failed to load chats:", e);
	}
}

async function selectChat(phone, name = "") {
	window.activeChatPhone = phone;
	window.activeChatName = name;

	// Update active classes in list
	document.querySelectorAll('.inbox-contact-item').forEach(item => {
		const phoneEl = item.querySelector('.inbox-contact-phone');
		if (phoneEl && (phoneEl.textContent.includes(phone) || phoneEl.textContent.trim() === phone)) {
			item.classList.add('active');

			// Instantly remove unread count badge from UI for immediate visual feedback
			const badge = phoneEl.querySelector('span[style*="background:#10b981"]');
			if (badge) {
				badge.remove();
			}
		} else {
			item.classList.remove('active');
		}
	});

	// Show input area
	const inputArea = document.getElementById('inbox-chat-input-area');
	if (inputArea) inputArea.style.display = 'flex';

	// Set header
	const headerEl = document.getElementById('inbox-chat-header');
	if (headerEl) {
		const displayHeaderName = name ? `${name} (${phone})` : phone;
		const nameArg = name ? name.replace(/'/g, "\\'") : "";
		headerEl.innerHTML = `
			<div style="display:flex; align-items:center; gap:8px; width: 100%;">
				<div style="width:10px; height:10px; border-radius:50%; background:#10b981; shrink:0;"></div>
				<span style="font-weight:700;color:#1e293b;margin-right:12px;">${displayHeaderName}</span>
				<button class="btn" onclick="editActiveContactName('${phone}', '${nameArg}')" style="padding:4px 8px; font-size:10px; background:rgba(0,0,0,0.03); border:none; box-shadow:none; color:#64748b; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:4px; height:24px;" title="Edit Name">
					<i data-lucide="pencil" style="width:10px; height:10px;"></i> Edit Name
				</button>
			</div>
		`;
		lucide.createIcons();
	}

	await loadChatHistory(phone);
}

async function loadChatHistory(phone) {
	if (!phone) return;
	try {
		const res = await fetch('/api/chat-history?phone=' + encodeURIComponent(phone));
		if (!res.ok) return;
		const history = await res.json();

		const msgsEl = document.getElementById('inbox-chat-messages');
		if (!msgsEl) return;

		if (history.length === 0) {
			msgsEl.innerHTML = `<div style="text-align:center;color:#64748b;padding:50px 30px;font-style:italic;">No messages found</div>`;
			return;
		}

		let html = "";
		history.forEach(msg => {
			const dirClass = msg.direction === "outgoing" ? "outgoing" : "incoming";
			let timeStr = "";
			if (msg.timestamp) {
				const date = new Date(msg.timestamp);
				timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			}

			html += `
				<div class="inbox-msg-bubble ${dirClass}">
					<div>${msg.text}</div>
					<span class="inbox-msg-time">${timeStr}</span>
				</div>
			`;
		});

		msgsEl.innerHTML = html;
		// Scroll to bottom
		msgsEl.scrollTop = msgsEl.scrollHeight;
	} catch (e) {
		console.error("Failed to load chat history:", e);
	}
}

async function sendInboxMessage() {
	const textEl = document.getElementById('inbox-message-text');
	if (!textEl) return;
	const text = textEl.value.trim();
	const phone = window.activeChatPhone;

	if (!text || !phone) return;

	// Clear the textarea immediately for optimistic feel
	textEl.value = "";
	textEl.focus();

	window.isInboxSending = true;

	// Create optimistic message bubble
	const msgsEl = document.getElementById('inbox-chat-messages');
	const tempMsgId = "opt-msg-" + Date.now();

	// Remove placeholders if visible
	if (msgsEl.innerHTML.includes("No messages found") || msgsEl.innerHTML.includes("No active chat")) {
		msgsEl.innerHTML = "";
	}

	const date = new Date();
	const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	const optBubbleHtml = `
		<div class="inbox-msg-bubble outgoing" id="${tempMsgId}" style="opacity: 0.7;">
			<div>${text}</div>
			<span class="inbox-msg-time">${timeStr} <span class="sending-status">🕒</span></span>
		</div>
	`;

	msgsEl.insertAdjacentHTML('beforeend', optBubbleHtml);
	msgsEl.scrollTop = msgsEl.scrollHeight;

	try {
		const res = await fetch('/api/send-message', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ phone, text })
		});

		if (res.ok) {
			const bubble = document.getElementById(tempMsgId);
			if (bubble) {
				bubble.style.opacity = "1";
				const statusEl = bubble.querySelector('.sending-status');
				if (statusEl) statusEl.textContent = "✓";
			}
			await loadChats();
		} else {
			const err = await res.json();
			showToast("Failed to send: " + (err.error || "Unknown error"), "error");
			const bubble = document.getElementById(tempMsgId);
			if (bubble) {
				bubble.style.background = "#ef4444";
				const statusEl = bubble.querySelector('.sending-status');
				if (statusEl) statusEl.textContent = "⚠️ Failed";
			}
		}
	} catch (e) {
		console.error("Send message failed:", e);
		showToast("Send message failed!", "error");
		const bubble = document.getElementById(tempMsgId);
		if (bubble) {
			bubble.style.background = "#ef4444";
			const statusEl = bubble.querySelector('.sending-status');
			if (statusEl) statusEl.textContent = "⚠️ Failed";
		}
	} finally {
		window.isInboxSending = false;
	}
}

function handleInboxKeydown(event) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		sendInboxMessage();
	}
}

async function pollInboxData() {
	await loadChats();
	if (window.activeChatPhone && !window.isInboxSending) {
		await loadChatHistory(window.activeChatPhone);
	}
}

function filterChats(query) {
	const q = query.trim().toLowerCase();
	document.querySelectorAll('.inbox-contact-item').forEach(item => {
		const phoneEl = item.querySelector('.inbox-contact-phone');
		const snippetEl = item.querySelector('.inbox-contact-snippet');
		const phone = phoneEl ? phoneEl.textContent.toLowerCase() : "";
		const snippet = snippetEl ? snippetEl.textContent.toLowerCase() : "";
		if (phone.includes(q) || snippet.includes(q)) {
			item.style.display = 'flex';
		} else {
			item.style.display = 'none';
		}
	});
}

async function saveContactName(phone, name) {
	try {
		const res = await fetch('/api/save-contact', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ phone, name })
		});
		if (res.ok) {
			showToast("Contact name saved!", "success");
			await loadChats();
		} else {
			showToast("Failed to save contact name", "error");
		}
	} catch (e) {
		console.error("Save contact name failed:", e);
	}
}

// Beautiful Custom Dialog Prompt instead of native browser prompt
function showCustomPrompt(title, placeholder, defaultValue = '', type = 'text') {
	return new Promise((resolve) => {
		// Create modal overlay
		const overlay = document.createElement('div');
		overlay.style.position = 'fixed';
		overlay.style.top = '0';
		overlay.style.left = '0';
		overlay.style.width = '100vw';
		overlay.style.height = '100vh';
		overlay.style.background = 'rgba(15, 23, 42, 0.4)';
		overlay.style.backdropFilter = 'blur(8px)';
		overlay.style.webkitBackdropFilter = 'blur(8px)';
		overlay.style.zIndex = '999999';
		overlay.style.display = 'flex';
		overlay.style.alignItems = 'center';
		overlay.style.justifyContent = 'center';
		overlay.style.padding = '24px';
		overlay.style.opacity = '0';
		overlay.style.transition = 'opacity 0.2s ease';

		// Create modal card
		const card = document.createElement('div');
		card.style.width = '100%';
		card.style.maxWidth = '400px';
		card.style.background = '#ffffff';
		card.style.border = '1px solid rgba(0, 0, 0, 0.08)';
		card.style.borderRadius = '16px';
		card.style.overflow = 'hidden';
		card.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';
		card.style.transform = 'scale(0.95)';
		card.style.transition = 'transform 0.2s ease';
		card.style.display = 'flex';
		card.style.flexDirection = 'column';

		// Header
		const header = document.createElement('div');
		header.style.padding = '16px 20px';
		header.style.borderBottom = '1px solid rgba(0, 0, 0, 0.05)';
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '10px';

		const titleEl = document.createElement('h3');
		titleEl.textContent = title;
		titleEl.style.margin = '0';
		titleEl.style.fontSize = '15px';
		titleEl.style.fontWeight = '700';
		titleEl.style.color = '#0f172a';
		header.appendChild(titleEl);
		card.appendChild(header);

		// Body
		const body = document.createElement('div');
		body.style.padding = '20px';
		body.style.display = 'flex';
		body.style.flexDirection = 'column';
		body.style.gap = '12px';

		const input = document.createElement('input');
		input.type = type;
		input.placeholder = placeholder;
		input.value = defaultValue;
		input.style.width = '100%';
		input.style.height = '42px';
		input.style.padding = '8px 12px';
		input.style.fontSize = '14px';
		input.style.borderRadius = '8px';
		input.style.border = '1px solid rgba(0, 0, 0, 0.15)';
		input.style.outline = 'none';
		input.style.background = '#f8fafc';
		input.style.transition = 'border-color 0.15s ease, box-shadow 0.15s ease';
		
		// Internal helper for input styles
		const applyFocusStyles = () => {
			input.style.borderColor = '#10b981';
			input.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.1)';
		};
		const applyBlurStyles = () => {
			input.style.borderColor = 'rgba(0, 0, 0, 0.15)';
			input.style.boxShadow = 'none';
		};
		input.addEventListener('focus', applyFocusStyles);
		input.addEventListener('blur', applyBlurStyles);
		
		body.appendChild(input);
		card.appendChild(body);

		// Footer / Buttons
		const footer = document.createElement('div');
		footer.style.padding = '12px 20px';
		footer.style.background = '#f8fafc';
		footer.style.borderTop = '1px solid rgba(0, 0, 0, 0.05)';
		footer.style.display = 'flex';
		footer.style.justifyContent = 'flex-end';
		footer.style.gap = '8px';

		const btnCancel = document.createElement('button');
		btnCancel.textContent = 'Cancel';
		btnCancel.style.padding = '8px 16px';
		btnCancel.style.fontSize = '13px';
		btnCancel.style.fontWeight = '600';
		btnCancel.style.borderRadius = '8px';
		btnCancel.style.border = '1px solid rgba(0, 0, 0, 0.08)';
		btnCancel.style.background = '#ffffff';
		btnCancel.style.color = '#334155';
		btnCancel.style.cursor = 'pointer';
		btnCancel.style.transition = 'background-color 0.15s ease';
		btnCancel.addEventListener('mouseenter', () => btnCancel.style.backgroundColor = '#f1f5f9');
		btnCancel.addEventListener('mouseleave', () => btnCancel.style.backgroundColor = '#ffffff');

		const btnConfirm = document.createElement('button');
		btnConfirm.textContent = 'Confirm';
		btnConfirm.style.padding = '8px 16px';
		btnConfirm.style.fontSize = '13px';
		btnConfirm.style.fontWeight = '600';
		btnConfirm.style.borderRadius = '8px';
		btnConfirm.style.border = 'none';
		btnConfirm.style.background = '#10b981';
		btnConfirm.style.color = '#ffffff';
		btnConfirm.style.cursor = 'pointer';
		btnConfirm.style.transition = 'background-color 0.15s ease';
		btnConfirm.addEventListener('mouseenter', () => btnConfirm.style.backgroundColor = '#0d9488');
		btnConfirm.addEventListener('mouseleave', () => btnConfirm.style.backgroundColor = '#10b981');

		footer.appendChild(btnCancel);
		footer.appendChild(btnConfirm);
		card.appendChild(footer);
		overlay.appendChild(card);
		document.body.appendChild(overlay);

		// Animate in
		setTimeout(() => {
			overlay.style.opacity = '1';
			card.style.transform = 'scale(1)';
		}, 10);

		input.focus();
		if (defaultValue) {
			input.setSelectionRange(0, defaultValue.length);
		}

		// Close functions
		const close = (value) => {
			overlay.style.opacity = '0';
			card.style.transform = 'scale(0.95)';
			setTimeout(() => {
				document.body.removeChild(overlay);
				resolve(value);
			}, 200);
		};

		btnCancel.addEventListener('click', () => close(null));
		btnConfirm.addEventListener('click', () => close(input.value));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				close(input.value);
			} else if (e.key === 'Escape') {
				close(null);
			}
		});
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) {
				close(null);
			}
		});
	});
}

async function editActiveContactName(phone, currentName) {
	const newName = await showCustomPrompt("Edit Contact Name", "Enter name for this contact:", currentName);
	if (newName === null) return; // user cancelled

	await saveContactName(phone, newName.trim());
	selectChat(phone, newName.trim());
}

async function startNewChat() {
	const searchInput = document.getElementById('inbox-search-input');
	const rawPhone = searchInput ? searchInput.value.trim() : "";

	let phone = rawPhone.replace(/\D/g, ''); // strip non-digits
	if (!phone) {
		const promptVal = await showCustomPrompt("New Chat", "Enter phone number with country code (e.g. 91XXXXXXXXXX):");
		if (promptVal) {
			phone = promptVal.replace(/\D/g, '');
		}
	}

	if (!phone || phone.length < 10 || phone.length > 15) {
		showToast("Please enter a valid phone number (10-15 digits with country code)", "error");
		return;
	}

	const name = await showCustomPrompt("Contact Name", "Enter contact name (optional):") || "";
	if (name.trim()) {
		await saveContactName(phone, name.trim());
	}

	selectChat(phone, name.trim());
	if (searchInput) searchInput.value = "";
}

// Custom confirmation dialog
function showCustomConfirm(title, message) {
	return new Promise((resolve) => {
		// Create modal overlay
		const overlay = document.createElement('div');
		overlay.style.position = 'fixed';
		overlay.style.top = '0';
		overlay.style.left = '0';
		overlay.style.width = '100vw';
		overlay.style.height = '100vh';
		overlay.style.background = 'rgba(15, 23, 42, 0.4)';
		overlay.style.backdropFilter = 'blur(8px)';
		overlay.style.webkitBackdropFilter = 'blur(8px)';
		overlay.style.zIndex = '999999';
		overlay.style.display = 'flex';
		overlay.style.alignItems = 'center';
		overlay.style.justifyContent = 'center';
		overlay.style.padding = '24px';
		overlay.style.opacity = '0';
		overlay.style.transition = 'opacity 0.2s ease';

		// Create modal card
		const card = document.createElement('div');
		card.style.width = '100%';
		card.style.maxWidth = '400px';
		card.style.background = '#ffffff';
		card.style.border = '1px solid rgba(0, 0, 0, 0.08)';
		card.style.borderRadius = '16px';
		card.style.overflow = 'hidden';
		card.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';
		card.style.transform = 'scale(0.95)';
		card.style.transition = 'transform 0.2s ease';
		card.style.display = 'flex';
		card.style.flexDirection = 'column';

		// Header
		const header = document.createElement('div');
		header.style.padding = '16px 20px';
		header.style.borderBottom = '1px solid rgba(0, 0, 0, 0.05)';
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '10px';

		const titleEl = document.createElement('h3');
		titleEl.textContent = title;
		titleEl.style.margin = '0';
		titleEl.style.fontSize = '15px';
		titleEl.style.fontWeight = '700';
		titleEl.style.color = '#ef4444';
		header.appendChild(titleEl);
		card.appendChild(header);

		// Body
		const body = document.createElement('div');
		body.style.padding = '20px';
		body.style.fontSize = '14px';
		body.style.color = '#334155';
		body.style.lineHeight = '1.5';
		body.textContent = message;
		card.appendChild(body);

		// Footer / Buttons
		const footer = document.createElement('div');
		footer.style.padding = '12px 20px';
		footer.style.background = '#f8fafc';
		footer.style.borderTop = '1px solid rgba(0, 0, 0, 0.05)';
		footer.style.display = 'flex';
		footer.style.justifyContent = 'flex-end';
		footer.style.gap = '8px';

		const btnCancel = document.createElement('button');
		btnCancel.textContent = 'Cancel';
		btnCancel.style.padding = '8px 16px';
		btnCancel.style.fontSize = '13px';
		btnCancel.style.fontWeight = '600';
		btnCancel.style.borderRadius = '8px';
		btnCancel.style.border = '1px solid rgba(0, 0, 0, 0.08)';
		btnCancel.style.background = '#ffffff';
		btnCancel.style.color = '#334155';
		btnCancel.style.cursor = 'pointer';
		btnCancel.style.transition = 'background-color 0.15s ease';
		btnCancel.addEventListener('mouseenter', () => btnCancel.style.backgroundColor = '#f1f5f9');
		btnCancel.addEventListener('mouseleave', () => btnCancel.style.backgroundColor = '#ffffff');

		const btnConfirm = document.createElement('button');
		btnConfirm.textContent = 'Delete';
		btnConfirm.style.padding = '8px 16px';
		btnConfirm.style.fontSize = '13px';
		btnConfirm.style.fontWeight = '600';
		btnConfirm.style.borderRadius = '8px';
		btnConfirm.style.border = 'none';
		btnConfirm.style.background = '#ef4444';
		btnConfirm.style.color = '#ffffff';
		btnConfirm.style.cursor = 'pointer';
		btnConfirm.style.transition = 'background-color 0.15s ease';
		btnConfirm.addEventListener('mouseenter', () => btnConfirm.style.backgroundColor = '#dc2626');
		btnConfirm.addEventListener('mouseleave', () => btnConfirm.style.backgroundColor = '#ef4444');

		footer.appendChild(btnCancel);
		footer.appendChild(btnConfirm);
		card.appendChild(footer);
		overlay.appendChild(card);
		document.body.appendChild(overlay);

		// Animate in
		setTimeout(() => {
			overlay.style.opacity = '1';
			card.style.transform = 'scale(1)';
		}, 10);

		// Close functions
		const close = (value) => {
			overlay.style.opacity = '0';
			card.style.transform = 'scale(0.95)';
			setTimeout(() => {
				document.body.removeChild(overlay);
				resolve(value);
			}, 200);
		};

		btnCancel.addEventListener('click', () => close(false));
		btnConfirm.addEventListener('click', () => close(true));
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) {
				close(false);
			}
		});

		// keyboard handlers
		const keyHandler = (e) => {
			if (e.key === 'Escape') {
				close(false);
				document.removeEventListener('keydown', keyHandler);
			} else if (e.key === 'Enter') {
				close(true);
				document.removeEventListener('keydown', keyHandler);
			}
		};
		document.addEventListener('keydown', keyHandler);
	});
}

// Delete chat function
async function deleteChat(phone) {
	try {
		const res = await fetch('/api/delete-chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ phone })
		});
		if (res.ok) {
			showToast("Chat deleted successfully", "success");
			if (window.activeChatPhone === phone) {
				window.activeChatPhone = "";
				window.activeChatName = "";
				// Clear message area
				const msgsEl = document.getElementById('inbox-chat-messages');
				if (msgsEl) msgsEl.innerHTML = `<div style="text-align:center;color:#64748b;padding:100px 30px;font-style:italic;">No active chat selected</div>`;
				const inputArea = document.getElementById('inbox-chat-input-area');
				if (inputArea) inputArea.style.display = 'none';
				const headerEl = document.getElementById('inbox-chat-header');
				if (headerEl) headerEl.innerHTML = `<span style="font-weight:600;color:#0f172a;">Select a chat to start messaging</span>`;
			}
			await loadChats();
		} else {
			showToast("Failed to delete chat", "error");
		}
	} catch (e) {
		console.error("Delete chat failed:", e);
		showToast("Delete chat failed", "error");
	}
}

// Delete all chats function
async function deleteAllChats() {
	const confirmDelete = await showCustomConfirm("Clear All Chats", "Are you sure you want to delete ALL chats, messages, and contact logs? This action is permanent and cannot be undone.");
	if (!confirmDelete) return;

	try {
		const res = await fetch('/api/delete-all-chats', {
			method: 'POST'
		});
		if (res.ok) {
			showToast("All chats deleted successfully", "success");
			window.activeChatPhone = "";
			window.activeChatName = "";
			// Clear message area
			const msgsEl = document.getElementById('inbox-chat-messages');
			if (msgsEl) msgsEl.innerHTML = `<div style="text-align:center;color:#64748b;padding:100px 30px;font-style:italic;">No active chat selected</div>`;
			const inputArea = document.getElementById('inbox-chat-input-area');
			if (inputArea) inputArea.style.display = 'none';
			const headerEl = document.getElementById('inbox-chat-header');
			if (headerEl) headerEl.innerHTML = `<span style="font-weight:600;color:#0f172a;">Select a chat to start messaging</span>`;
			await loadChats();
		} else {
			showToast("Failed to delete all chats", "error");
		}
	} catch (e) {
		console.error("Delete all chats failed:", e);
		showToast("Delete all chats failed", "error");
	}
}

// Register global functions to window
window.loadChats = loadChats;
window.selectChat = selectChat;
window.sendInboxMessage = sendInboxMessage;
window.handleInboxKeydown = handleInboxKeydown;
window.filterChats = filterChats;
window.startNewChat = startNewChat;
window.saveContactName = saveContactName;
window.editActiveContactName = editActiveContactName;
window.deleteChat = deleteChat;
window.deleteAllChats = deleteAllChats;
window.setInboxFilter = setInboxFilter;

// Polling for inbox
setInterval(() => {
	const inboxTab = document.getElementById('tab-inbox');
	if (inboxTab && inboxTab.classList.contains('active')) {
		pollInboxData();
	}
}, 3000);