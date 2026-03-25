/**
 * OmniRouteAI Dashboard — Main Application Logic
 *
 * Handles page routing, data rendering, and user interactions.
 */

// ─── Navigation ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Nav links
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
    });
  });

  // Mobile toggle
  document.getElementById('mobile-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Load settings into form
  loadSettingsForm();

  // Initial page load
  navigateTo('overview');

  // Health check on load
  checkHealth();
  // Auto-refresh health every 30s
  setInterval(checkHealth, 30000);
});

function navigateTo(page) {
  // Update nav
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  // Update pages
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  // Load page data
  switch (page) {
    case 'overview': refreshOverview(); break;
    case 'providers': refreshProviders(); break;
    case 'keys': refreshKeys(); break;
    case 'logs': refreshLogs(); break;
    case 'stats': refreshStatsPage(); break;
  }
}

// ─── Health Check ────────────────────────────────────────────────────

async function checkHealth() {
  const dot = document.querySelector('.health-dot');
  const text = document.querySelector('.health-text');

  try {
    const data = await API.getHealth();
    dot.className = 'health-dot ' + (data.status === 'healthy' ? 'healthy' : 'degraded');
    text.textContent = data.status === 'healthy' ? 'All systems operational' : 'Degraded';
  } catch {
    dot.className = 'health-dot error';
    text.textContent = 'Disconnected';
  }
}

// ─── Overview Page ───────────────────────────────────────────────────

async function refreshOverview() {
  try {
    const [health, overview] = await Promise.all([
      API.getHealth(),
      API.getOverview(),
    ]);

    document.getElementById('stat-total-requests').textContent =
      (overview.stats?.totalRequests || 0).toLocaleString();
    document.getElementById('stat-active-providers').textContent =
      `${overview.activeProviders} / ${overview.totalProviders}`;
    document.getElementById('stat-system-status').textContent =
      health.status === 'healthy' ? '✅ Healthy' : '⚠️ Degraded';
    document.getElementById('stat-uptime').textContent =
      formatUptime(health.uptime);

    // Provider health table
    const tbody = document.getElementById('overview-providers-body');
    if (overview.providerHealth?.length) {
      tbody.innerHTML = overview.providerHealth.map((p) => `
        <tr>
          <td><strong>${p.name}</strong></td>
          <td><span class="badge ${p.status === 'active' ? 'badge-success' : 'badge-error'}">
            ${p.status}
          </span></td>
          <td>${p.errorRate}%</td>
          <td>${(p.models || []).map((m) => `<span class="model-tag">${m}</span>`).join(' ')}</td>
          <td>${p.priority}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No providers configured. Go to Settings → Seed Defaults.</td></tr>';
    }
  } catch (err) {
    showToast('error', `Overview failed: ${err.message}`);
  }
}

// ─── Providers Page ──────────────────────────────────────────────────

async function refreshProviders() {
  const container = document.getElementById('providers-list');

  try {
    const data = await API.getProviders();
    if (!data.providers?.length) {
      container.innerHTML = '<div class="empty-state">No providers. Click "Seed Defaults" to add default providers.</div>';
      return;
    }

    container.innerHTML = data.providers.map((p) => `
      <div class="provider-card">
        <div class="provider-header">
          <span class="provider-name">${p.name}</span>
          <span class="badge ${p.disabled ? 'badge-error' : 'badge-success'}">
            ${p.disabled ? 'Disabled' : 'Active'}
          </span>
        </div>
        <div class="provider-meta">
          <div class="provider-meta-row">
            <span>Priority</span>
            <span class="provider-meta-value">${p.priority}</span>
          </div>
          <div class="provider-meta-row">
            <span>Weight</span>
            <span class="provider-meta-value">${p.weight}</span>
          </div>
          <div class="provider-meta-row">
            <span>Error Rate</span>
            <span class="provider-meta-value ${p.errorRate > 30 ? 'text-error' : ''}">${p.errorRate}%</span>
          </div>
          <div class="provider-meta-row">
            <span>API Keys</span>
            <span class="provider-meta-value">${p.keyCount || 0} registered</span>
          </div>
        </div>
        <div class="provider-models">
          ${(p.models || []).map((m) => `<span class="model-tag">${m}</span>`).join('')}
        </div>
        <div class="provider-actions">
          <button class="btn btn-sm btn-secondary"
            onclick="openEditProviderModal('${p.name}', ${p.priority}, ${p.weight}, ${JSON.stringify(p.models).replace(/"/g, '&quot;')}, '${p.default_model || ''}')">
            ✏️ Edit
          </button>
          <button class="btn btn-sm ${p.disabled ? 'btn-primary' : 'btn-danger'}"
            onclick="toggleProvider('${p.name}', ${!p.disabled})">
            ${p.disabled ? '✅ Enable' : '🚫 Disable'}
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load: ${err.message}</div>`;
  }
}

async function toggleProvider(name, disabled) {
  try {
    await API.toggleProvider(name, disabled);
    showToast('success', `Provider ${name} ${disabled ? 'disabled' : 'enabled'}`);
    refreshProviders();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function seedProviders() {
  try {
    const result = await API.seedProviders();
    showToast('success', `Seeded ${result.seeded} default providers`);
    refreshProviders();
    refreshOverview();
  } catch (err) {
    showToast('error', err.message);
  }
}

// ─── Provider Modal ──────────────────────────────────────────────────

function openEditProviderModal(name, priority, weight, models, defaultModel) {
  document.getElementById('edit-provider-title').textContent = `Edit Provider: ${name}`;
  document.getElementById('edit-provider-name').value = name;
  document.getElementById('edit-provider-priority').value = priority;
  document.getElementById('edit-provider-weight').value = weight;

  const modelSelect = document.getElementById('edit-provider-default-model');
  modelSelect.innerHTML = models.map(m => `
    <option value="${m}" ${m === defaultModel ? 'selected' : ''}>${m}</option>
  `).join('');

  document.getElementById('modal-edit-provider').classList.add('active');
}

function closeModal(id) {
  document.getElementById(`modal-${id}`).classList.remove('active');
}

async function saveProviderConfig() {
  const name = document.getElementById('edit-provider-name').value;
  const priority = parseInt(document.getElementById('edit-provider-priority').value, 10);
  const weight = parseInt(document.getElementById('edit-provider-weight').value, 10);
  const default_model = document.getElementById('edit-provider-default-model').value;

  try {
    await API.updateProvider(name, { priority, weight, default_model });
    showToast('success', `Provider ${name} updated successfully`);
    closeModal('edit-provider');
    refreshProviders();
    refreshOverview();
  } catch (err) {
    showToast('error', `Update failed: ${err.message}`);
  }
}

// ─── API Keys Page ───────────────────────────────────────────────────

async function refreshKeys() {
  const provider = document.getElementById('key-view-provider').value;
  const tbody = document.getElementById('keys-body');

  try {
    const data = await API.getKeys(provider);
    if (!data.keys?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No keys registered for ${provider}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.keys.map((k) => `
      <tr>
        <td class="mono">${k.key}</td>
        <td>${k.usage}</td>
        <td>${k.rpm}</td>
        <td><span class="badge ${k.disabled ? 'badge-error' : 'badge-success'}">
          ${k.disabled ? 'Disabled' : 'Active'}
        </span></td>
        <td>
          <button class="btn btn-sm ${k.disabled ? 'btn-primary' : 'btn-danger'}"
            onclick="toggleKey('${provider}', '${k.fullKey}', ${!k.disabled})">
            ${k.disabled ? 'Enable' : 'Disable'}
          </button>
          <button class="btn btn-sm btn-ghost" onclick="removeKey('${provider}', '${k.fullKey}')">🗑</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${err.message}</td></tr>`;
  }
}

async function addKey() {
  const provider = document.getElementById('key-provider-select').value;
  const keyInput = document.getElementById('key-input');
  const key = keyInput.value.trim();

  if (!key) {
    showToast('warning', 'Please enter an API key');
    return;
  }

  try {
    await API.addKey(provider, key);
    keyInput.value = '';
    showToast('success', `Key added to ${provider}`);

    // Refresh if viewing same provider
    document.getElementById('key-view-provider').value = provider;
    refreshKeys();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function removeKey(provider, key) {
  if (!confirm('Remove this API key?')) return;

  try {
    await API.removeKey(provider, key);
    showToast('success', 'Key removed');
    refreshKeys();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function toggleKey(provider, key, disabled) {
  try {
    await API.toggleKey(provider, key, disabled);
    showToast('success', `Key ${disabled ? 'disabled' : 'enabled'}`);
    refreshKeys();
  } catch (err) {
    showToast('error', err.message);
  }
}

// ─── Logs Page ───────────────────────────────────────────────────────

async function refreshLogs() {
  const provider = document.getElementById('log-filter-provider').value;
  const status = document.getElementById('log-filter-status').value;
  const limit = document.getElementById('log-limit').value;
  const tbody = document.getElementById('logs-body');

  try {
    const data = await API.getLogs({ provider, status, limit });
    if (!data.logs?.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No logs found</td></tr>';
      return;
    }

    tbody.innerHTML = data.logs.map((log) => `
      <tr>
        <td class="text-muted">${formatTime(log.timestamp)}</td>
        <td class="mono">${(log.request_id || '').slice(0, 8)}...</td>
        <td>${log.provider}</td>
        <td class="mono">${log.model || '—'}</td>
        <td><span class="badge ${getStatusBadge(log.status)}">${log.status}</span></td>
        <td>${log.latency ? log.latency + 'ms' : '—'}</td>
        <td>${log.tokens ? `${log.tokens.input || 0}/${log.tokens.output || 0}` : '—'}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${err.message}</td></tr>`;
  }
}

async function flushLogs() {
  try {
    await API.flushLogs();
    showToast('success', 'Log buffer flushed to Firestore');
    refreshLogs();
  } catch (err) {
    showToast('error', err.message);
  }
}

// ─── Stats Page ──────────────────────────────────────────────────────

async function refreshStatsPage() {
  try {
    const [current, history] = await Promise.all([
      API.getStats(),
      API.getStatsHistory(14),
    ]);

    // Today's stats
    const stats = current.stats || {};
    document.getElementById('stat-day-requests').textContent =
      (stats['requests:total'] || 0).toLocaleString();

    // Aggregate input/output tokens across providers
    let inputTokens = 0;
    let outputTokens = 0;
    for (const [key, value] of Object.entries(stats)) {
      if (key.startsWith('tokens:input:')) inputTokens += value;
      if (key.startsWith('tokens:output:')) outputTokens += value;
    }
    document.getElementById('stat-day-input-tokens').textContent = inputTokens.toLocaleString();
    document.getElementById('stat-day-output-tokens').textContent = outputTokens.toLocaleString();

    // History table
    const histBody = document.getElementById('stats-history-body');
    if (history.history?.length) {
      histBody.innerHTML = history.history.map((day) => {
        const details = Object.entries(day)
          .filter(([k]) => !['date', 'aggregated_at', 'id'].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');

        return `
          <tr>
            <td>${day.date}</td>
            <td>${day['requests:total'] || '—'}</td>
            <td class="text-muted" style="font-size:0.78rem">${details || '—'}</td>
          </tr>
        `;
      }).join('');
    } else {
      histBody.innerHTML = '<tr><td colspan="3" class="empty-state">No historical data yet. Run "Aggregate Now" to save today\'s stats.</td></tr>';
    }
  } catch (err) {
    showToast('error', `Stats failed: ${err.message}`);
  }
}

async function aggregateStats() {
  try {
    await API.aggregateStats();
    showToast('success', 'Stats aggregated and saved to Firestore');
    refreshStatsPage();
  } catch (err) {
    showToast('error', err.message);
  }
}

// ─── Settings Page ───────────────────────────────────────────────────

function loadSettingsForm() {
  document.getElementById('settings-api-url').value = API.getBaseUrl();
  
  // Show encryption status
  const isEncrypted = API.isEncryptionEnabled();
  const apiKeyInput = document.getElementById('settings-api-key');
  apiKeyInput.value = ''; // Don't show the key
  apiKeyInput.placeholder = isEncrypted ? '•••••••••••• (encrypted)' : 'Enter API key...';
  
  // Show encryption checkbox
  let encryptionHtml = `
    <div class="form-group" style="margin-top: 1rem;">
      <label class="form-label">
        <input type="checkbox" id="settings-encryption" ${isEncrypted ? 'checked' : ''}>
        Encrypt API key storage (recommended)
      </label>
      <small class="form-hint">
        When enabled, your API key is encrypted with a passphrase. 
        The passphrase is NOT stored and must be entered each session.
      </small>
    </div>
    <div class="form-group" id="passphrase-group" style="display: ${isEncrypted ? 'block' : 'none'};">
      <label class="form-label">Passphrase</label>
      <input type="password" id="settings-passphrase" class="input" placeholder="Enter a strong passphrase">
      <small class="form-hint">This passphrase encrypts your API key. Don't forget it!</small>
    </div>
  `;
  
  // Insert encryption options after API key field
  const apiKeyGroup = document.getElementById('settings-api-key').closest('.form-group');
  const existingEncryption = apiKeyGroup.parentElement.querySelector('#encryption-options');
  if (existingEncryption) existingEncryption.remove();
  
  const encryptionContainer = document.createElement('div');
  encryptionContainer.id = 'encryption-options';
  encryptionContainer.innerHTML = encryptionHtml;
  apiKeyGroup.parentElement.insertBefore(encryptionContainer, apiKeyGroup.nextSibling);
  
  // Toggle passphrase field visibility
  document.getElementById('settings-encryption').addEventListener('change', (e) => {
    document.getElementById('passphrase-group').style.display = e.target.checked ? 'block' : 'none';
  });
}

function saveSettings() {
  const url = document.getElementById('settings-api-url').value.trim();
  const key = document.getElementById('settings-api-key').value.trim();
  const useEncryption = document.getElementById('settings-encryption')?.checked || false;
  const passphrase = document.getElementById('settings-passphrase')?.value.trim() || '';
  
  // Validate encryption settings
  if (useEncryption && !passphrase) {
    showToast('warning', 'Please enter a passphrase to enable encryption');
    return;
  }
  
  if (useEncryption && passphrase.length < 8) {
    showToast('warning', 'Passphrase must be at least 8 characters');
    return;
  }
  
  API.saveSettings(url, key, { useEncryption, passphrase });
  showToast('success', 'Settings saved' + (useEncryption ? ' (encrypted)' : ''));
  checkHealth();
}

async function testConnection() {
  const statusEl = document.getElementById('connection-status');
  statusEl.textContent = 'Testing connection...';

  try {
    const health = await API.getHealth();
    statusEl.textContent = JSON.stringify(health, null, 2);
    showToast('success', `Connected! Status: ${health.status}`);
  } catch (err) {
    statusEl.textContent = `ERROR: ${err.message}`;
    showToast('error', `Connection failed: ${err.message}`);
  }
}

// ─── Toast Notifications ─────────────────────────────────────────────

function showToast(type, message) {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getStatusBadge(status) {
  switch (status) {
    case 'success': return 'badge-success';
    case 'error': return 'badge-error';
    case 'cache_hit': return 'badge-info';
    default: return 'badge-warning';
  }
}
// ─── AI Playground ───────────────────────────────────────────────────

async function sendMessage() {
  const inputEl = document.getElementById('chat-input');
  const chatWindow = document.getElementById('chat-window');
  const provider = document.getElementById('playground-provider').value;
  const model = document.getElementById('playground-model').value || 'auto';
  const prompt = inputEl.value.trim();

  if (!prompt) return;

  // Add user message to UI
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  userMsg.textContent = prompt;
  chatWindow.appendChild(userMsg);
  
  // Clear input
  inputEl.value = '';
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // Add thinking indicator
  const botMsg = document.createElement('div');
  botMsg.className = 'chat-message bot thinking';
  botMsg.textContent = 'Thinking...';
  chatWindow.appendChild(botMsg);

  try {
    const providerSelector = document.getElementById('playground-provider');
    const modelInput       = document.getElementById('playground-model');
    
    const provider = providerSelector ? providerSelector.value : 'auto';
    const model    = modelInput ? modelInput.value.trim() : 'auto';

    const payload = { prompt };
    if (model && model !== 'auto') payload.model = model;
    if (provider && provider !== 'auto') payload.provider = provider;

    const base = API.getBaseUrl();
    const apiKey = API.getApiKey();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    botMsg.classList.remove('thinking');
    if (!res.ok || data.error) {
       botMsg.classList.add('error');
       botMsg.textContent = `Error (${res.status}): ${data.message || data.error || 'Unknown error'}`;
    } else {
       botMsg.textContent = data.output || JSON.stringify(data);
       // Add metadata
       const meta = document.createElement('div');
       meta.className = 'chat-meta';
       meta.textContent = `Provider: ${data.provider || 'unknown'} · Model: ${data.model || 'auto'}`;
       botMsg.appendChild(meta);
    }
  } catch (err) {
    botMsg.classList.remove('thinking');
    botMsg.classList.add('error');
    botMsg.textContent = `Connection Failed: ${err.message}`;
  }

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function clearChat() {
  const chatWindow = document.getElementById('chat-window');
  chatWindow.innerHTML = '<div class="chat-message bot">Window cleared. How can I help you?</div>';
}

// Global enter handler for chat
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
