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
  loadDaemonSettings();

  // Initial page load
  navigateTo('overview');
  
  // Refresh providers once early to populate dropdowns across all tabs
  refreshProviders();

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

  // Cleanup: clear Ollama log auto-refresh when leaving that page
  if (window._ollamaLogTimer) {
    clearInterval(window._ollamaLogTimer);
    window._ollamaLogTimer = null;
  }

  // Load page data
  switch (page) {
    case 'overview': refreshOverview(); break;
    case 'providers': refreshProviders(); break;
    case 'keys': refreshKeys(); break;
    case 'logs': refreshLogs(); break;
    case 'stats': refreshStatsPage(); break;
    case 'ollama': initOllamaPage(); break;
    case 'local-auth': refreshLocalAuth(); break;
    case 'playground': /* playground is self-contained, no refresh needed */ break;
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

async function refreshOverview(force = false) {
  try {
    const opts = { forceRefresh: force };
    const [health, overview] = await Promise.all([
      API.getHealth(opts),
      API.getOverview(opts),
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

async function refreshProviders(force = false) {
  const container = document.getElementById('providers-list');

  try {
    const data = await API.getProviders({ forceRefresh: force });
    const providers = data.providers || [];
    window.allProviders = providers;
    
    // Dynamically update all select dropdowns that list providers
    syncProviderDropdowns(providers);

    if (!providers.length) {
      container.innerHTML = '<div class="empty-state">No providers. Click "Seed Defaults" to add default providers.</div>';
      return;
    }

    container.innerHTML = providers.map((p) => `
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

/**
 * Update all 4 selection dropdowns to match the current provider set.
 */
function syncProviderDropdowns(providers) {
  const selects = [
    'key-provider-select',
    'key-view-provider',
    'log-filter-provider',
    'playground-provider'
  ];

  providers.sort((a, b) => a.name.localeCompare(b.name));

  const cloudProviders = providers.filter(p => p.type !== 'local_http');
  const localProviders = providers.filter(p => p.type === 'local_http');

  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const currentValue = el.value;
    let html = '';

    // Specialized "Auto" or "All" options for specific select boxes
    if (id === 'log-filter-provider') html += '<option value="">All Providers</option>';
    if (id === 'playground-provider') html += '<option value="auto">Auto Router (All Providers)</option>';

    if (cloudProviders.length) {
      html += '<option disabled>── Cloud Providers ──</option>';
      cloudProviders.forEach(p => {
        html += `<option value="${p.name}">${p.name.charAt(0).toUpperCase() + p.name.slice(1)}</option>`;
      });
    }

    if (localProviders.length) {
      html += '<option disabled>── Local CLI Daemons ──</option>';
      localProviders.forEach(p => {
        html += `<option value="${p.name}">${p.name.split('_')[0].charAt(0).toUpperCase() + p.name.split('_')[0].slice(1)} CLI (Local)</option>`;
      });
    }

    el.innerHTML = html;
    
    // Restore selection if it still exists
    if ([...el.options].some(o => o.value === currentValue)) {
      el.value = currentValue;
    }
  });
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

/**
 * Populate the playground model selector based on the selected provider.
 */
function updatePlaygroundModels(providerName) {
  const modelSelect = document.getElementById('playground-model-select');
  const inputGroup = document.getElementById('playground-model-input-group');
  if (!modelSelect) return;

  // Clear current options
  modelSelect.innerHTML = '<option value="auto">Auto/Default</option>';

  if (providerName !== 'auto' && window.allProviders) {
    const provider = window.allProviders.find(p => p.name === providerName);
    if (provider && provider.models && provider.models.length) {
      provider.models.sort().forEach(m => {
        modelSelect.innerHTML += `<option value="${m}">${m}</option>`;
      });
    }
  }

  // Always add custom option
  modelSelect.innerHTML += '<option value="custom">Custom...</option>';

  // Reset to auto and hide input group
  modelSelect.value = 'auto';
  if (inputGroup) inputGroup.style.display = 'none';
}

/**
 * Handle model select changes (show/hide custom input).
 */
function handlePlaygroundModelChange() {
  const modelSelect = document.getElementById('playground-model-select');
  const inputGroup = document.getElementById('playground-model-input-group');
  if (!modelSelect || !inputGroup) return;

  if (modelSelect.value === 'custom') {
    inputGroup.style.display = 'block';
    document.getElementById('playground-model').focus();
  } else {
    inputGroup.style.display = 'none';
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

// Global array to track models being edited for a provider
window._currentEditingModels = [];

function openEditProviderModal(name, priority, weight, models, defaultModel) {
  document.getElementById('edit-provider-title').textContent = `Edit Provider: ${name}`;
  document.getElementById('edit-provider-name').value = name;
  document.getElementById('edit-provider-priority').value = priority;
  document.getElementById('edit-provider-weight').value = weight;

  // Clone models array for editing
  window._currentEditingModels = Array.isArray(models) ? [...models] : [];

  // Reset discovery UI
  window._discoveredModels = [];
  const discoveryContainer = document.getElementById('discovery-container');
  if (discoveryContainer) discoveryContainer.style.display = 'none';
  const discoveryList = document.getElementById('discovery-list');
  if (discoveryList) discoveryList.innerHTML = '<div class="empty-state">Click fetch to discover models.</div>';
  const searchInput = document.getElementById('discovery-search');
  if (searchInput) searchInput.value = '';
  const errorEl = document.getElementById('discovery-error');
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

  // Initial render of models list & select
  const modelSelect = document.getElementById('edit-provider-default-model');
  renderProviderModelControls(modelSelect, window._currentEditingModels, defaultModel);

  document.getElementById('modal-edit-provider').classList.add('active');
}

/**
 * Combined renderer for the default model select AND the visual model tag list.
 */
function renderProviderModelControls(selectElement, models, defaultModel) {
  // 1. Update Select Dropdown
  selectElement.innerHTML = models.map(m => `
    <option value="${m}" ${m === defaultModel ? 'selected' : ''}>${m}</option>
  `).join('');

  // 2. Update Visual Tag List with Remove Buttons
  const listEl = document.getElementById('edit-provider-models-list');
  if (listEl) {
    if (!models.length) {
      listEl.innerHTML = '<div class="empty-state" style="width: 100%; text-align: center; color: var(--text-muted); padding: 0.5rem; font-size: 0.9rem;">No models active</div>';
    } else {
      listEl.innerHTML = models.map(m => `
        <div class="model-tag" style="background: var(--color-primary); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 6px;">
          ${m}
          <span style="cursor: pointer; font-weight: bold; font-size: 1rem; line-height: 1;" onclick="removeProviderModel('${m}')">&times;</span>
        </div>
      `).join('');
    }
  }
}

function removeProviderModel(modelId) {
  window._currentEditingModels = window._currentEditingModels.filter(m => m !== modelId);
  const modelSelect = document.getElementById('edit-provider-default-model');
  const currentDefault = modelSelect.value;
  renderProviderModelControls(modelSelect, window._currentEditingModels, currentDefault);
  
  // Also refresh discovery list if icons/status needs to update
  if (typeof filterDiscoveredModels === 'function') filterDiscoveredModels();
}

function addProviderModel() {
  const input = document.getElementById('edit-provider-new-model');
  const model = input.value.trim();
  
  if (!model) {
    showToast('warning', 'Please enter a model name');
    return;
  }
  
  if (window._currentEditingModels.includes(model)) {
    showToast('warning', 'Model already exists');
    input.value = '';
    return;
  }
  
  window._currentEditingModels.push(model);
  renderProviderModelControls(
    document.getElementById('edit-provider-default-model'),
    window._currentEditingModels,
    model
  );
  input.value = '';
  showToast('success', `Model "${model}" added`);
}

/**
 * Model Harvester Logic
 */
window._discoveredModels = [];

async function fetchProviderModels() {
  const name = document.getElementById('edit-provider-name').value;
  const btnText = document.getElementById('fetch-models-btn-text');
  const spinner = document.getElementById('fetch-models-spinner');
  const container = document.getElementById('discovery-container');
  const errorEl = document.getElementById('discovery-error');

  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

  if (!name) return;

  try {
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';

    const result = await API.request('/api/admin/providers/fetch-models', {
      method: 'POST',
      body: JSON.stringify({ providerName: name })
    });

    if (result.success === false) {
      throw new Error(result.error || 'Discovery failed');
    }

    window._discoveredModels = result.models || [];
    container.style.display = 'block';
    renderDiscoveredModels(window._discoveredModels);
    
    showToast('success', `Discovered ${window._discoveredModels.length} models for ${name}`);
  } catch (err) {
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = `❌ ${err.message}`;
    }
    showToast('error', err.message);
  } finally {
    btnText.style.display = 'inline';
    spinner.style.display = 'none';
  }
}

function renderDiscoveredModels(models) {
  const el = document.getElementById('discovery-list');
  if (!el) return;

  if (!models.length) {
    el.innerHTML = '<div class="empty-state">No models found on this endpoint.</div>';
    return;
  }

  el.innerHTML = models.map(m => {
    const isAdded = window._currentEditingModels.includes(m);
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.4rem; border-bottom: 1px solid var(--border-color); font-size: 0.85rem;">
        <span style="font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">${m}</span>
        <button type="button" class="btn btn-xs ${isAdded ? 'btn-ghost' : 'btn-secondary'}" 
                onclick="addDiscoveredModel('${m}')" ${isAdded ? 'disabled' : ''}>
          ${isAdded ? 'Added' : '+ Add'}
        </button>
      </div>
    `;
  }).join('');
}

function filterDiscoveredModels() {
  const query = document.getElementById('discovery-search').value.toLowerCase();
  const filtered = window._discoveredModels.filter(m => m.toLowerCase().includes(query));
  renderDiscoveredModels(filtered);
}

function addDiscoveredModel(modelId) {
  if (!window._currentEditingModels.includes(modelId)) {
    window._currentEditingModels.push(modelId);
    // Update the default model select and visual list
    const modelSelect = document.getElementById('edit-provider-default-model');
    const currentValue = modelSelect.value;
    renderProviderModelControls(modelSelect, window._currentEditingModels, currentValue);
    // Refresh discovery list to show "Added" status
    filterDiscoveredModels(); 
  }
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
    await API.updateProvider(name, { 
      priority, 
      weight, 
      default_model,
      models: window._currentEditingModels 
    });
    showToast('success', `Provider ${name} updated successfully`);
    closeModal('edit-provider');
    refreshProviders();
    refreshOverview();
  } catch (err) {
    showToast('error', `Update failed: ${err.message}`);
  }
}

// ─── API Keys Page ───────────────────────────────────────────────────

async function refreshKeys(force = false) {
  const provider = document.getElementById('key-view-provider').value;
  const tbody = document.getElementById('keys-body');

  try {
    const data = await API.getKeys(provider, { forceRefresh: force });
    if (!data.keys?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No keys registered for ${provider}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.keys.map((k) => `
      <tr>
        <td class="mono">${k.key}</td>
        <td>${k.usage}</td>
        <td>${k.tokensIn || 0} / ${k.tokensOut || 0}</td>
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

async function refreshLogs(force = false) {
  const provider = document.getElementById('log-filter-provider').value;
  const status = document.getElementById('log-filter-status').value;
  const limit = document.getElementById('log-limit').value;
  const tbody = document.getElementById('logs-body');

  // Map 'all' or empty string to '' so backend returns all statuses
  const effectiveStatus = status === 'all' || status === '' ? '' : status;

  try {
    const data = await API.getLogs({ provider, status: effectiveStatus, limit, forceRefresh: force });
    if (!data.logs?.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No logs found</td></tr>';
      return;
    }

    tbody.innerHTML = data.logs.map((log, index) => {
      const isError = log.status === 'error';
      const rowClass = isError ? 'log-row-error' : '';
      const errorMsg = log.error || '—';
      
      return `
        <tr class="${rowClass}" onclick="${isError ? `toggleErrorRow(${index})` : ''}">
          <td class="text-muted">${formatTime(log.timestamp)}</td>
          <td class="mono" title="${log.request_id}">${(log.request_id || '').slice(0, 8)}...</td>
          <td>${log.provider}</td>
          <td class="mono">${log.model || '—'}</td>
          <td><span class="badge ${getStatusBadge(log.status)}">${log.status}</span></td>
          <td>${log.latency ? log.latency + 'ms' : '—'}</td>
          <td>${log.tokens ? `${log.tokens.input || 0}/${log.tokens.output || 0}` : '—'}</td>
          <td class="error-msg-cell ${isError ? 'text-error' : ''}">${errorMsg}</td>
        </tr>
        ${isError ? `
          <tr id="error-row-${index}" class="error-detail-row">
            <td colspan="8">
              <div class="error-content">${log.error}</div>
            </td>
          </tr>
        ` : ''}
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${err.message}</td></tr>`;
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

/**
 * Recursively flatten a nested object into dot-notation keys.
 * e.g. { requests: { total: 5 } } → { 'requests.total': 5 }
 */
function flattenObject(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

async function refreshStatsPage(force = false) {
  try {
    const opts = { forceRefresh: force };
    const [current, history] = await Promise.all([
      API.getStats(opts),
      API.getStatsHistory(14, opts),
    ]);

    // Today's stats
    const stats = current.stats || {};
    document.getElementById('stat-day-requests').textContent =
      (stats['requests:total'] || 0).toLocaleString();

    // Aggregate input/output tokens across providers
    let inputTokens = 0;
    let outputTokens = 0;
    const providerStats = {}; // { provider: { requests, in, out } }

    for (const [key, value] of Object.entries(stats)) {
      if (key.startsWith('tokens:input:')) {
        inputTokens += value;
        const p = key.replace('tokens:input:', '');
        if (!providerStats[p]) providerStats[p] = { requests: 0, in: 0, out: 0 };
        providerStats[p].in = value;
      }
      if (key.startsWith('tokens:output:')) {
        outputTokens += value;
        const p = key.replace('tokens:output:', '');
        if (!providerStats[p]) providerStats[p] = { requests: 0, in: 0, out: 0 };
        providerStats[p].out = value;
      }
      if (key.startsWith('requests:')) {
        const p = key.replace('requests:', '');
        if (p === 'total') continue;
        if (!providerStats[p]) providerStats[p] = { requests: 0, in: 0, out: 0 };
        providerStats[p].requests = value;
      }
    }
    document.getElementById('stat-day-input-tokens').textContent = inputTokens.toLocaleString();
    document.getElementById('stat-day-output-tokens').textContent = outputTokens.toLocaleString();

    // Provider Breakdown table
    const providerBody = document.getElementById('stats-provider-body');
    const sortedProviders = Object.entries(providerStats).sort((a, b) => b[1].requests - a[1].requests);
    
    if (sortedProviders.length) {
      providerBody.innerHTML = sortedProviders.map(([name, s]) => `
        <tr>
          <td><strong>${name}</strong></td>
          <td>${s.requests.toLocaleString()}</td>
          <td>${s.in.toLocaleString()}</td>
          <td>${s.out.toLocaleString()}</td>
        </tr>
      `).join('');
    } else {
      providerBody.innerHTML = '<tr><td colspan="4" class="empty-state">No requests recorded yet today.</td></tr>';
    }

    // History table
    const histBody = document.getElementById('stats-history-body');
    if (history.history?.length) {
      histBody.innerHTML = history.history.map((day) => {
        // Flatten the day object to handle both nested and flat formats
        const flatDay = flattenObject(day);
        
        const details = Object.entries(flatDay)
          .filter(([k]) => !['date', 'aggregated_at', 'id'].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');

        return `
          <tr>
            <td>${flatDay.date || day.date}</td>
            <td>${flatDay['requests:total'] || flatDay['requests.total'] || '—'}</td>
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
  
  // Show encryption status and key presence
  const isEncrypted = API.isEncryptionEnabled();
  const hasPlainKey = !!localStorage.getItem('omniroute_api_key');
  const apiKeyInput = document.getElementById('settings-api-key');
  
  apiKeyInput.value = ''; // Don't show the key
  
  if (isEncrypted) {
    apiKeyInput.placeholder = '•••••••••••• (encrypted & saved)';
  } else if (hasPlainKey) {
    apiKeyInput.placeholder = '•••••••••••• (plain & saved)';
  } else {
    apiKeyInput.placeholder = 'Enter API key...';
  }
  
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

  loadDaemonSettings();
}

async function saveSettings() {
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
  
  // Only update API key if value entered (prevents overwriting with empty string)
  await API.saveSettings(url, key || null, { useEncryption, passphrase });
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

// ─── Ollama Playground Page ─────────────────────────────────────────

let _ollamaLogTimer = null;

function initOllamaPage() {
  refreshOllamaHealth();
  loadOllamaModels();
  refreshOllamaLogs();
  // Auto-refresh daemon logs every 10s
  if (_ollamaLogTimer) clearInterval(_ollamaLogTimer);
  _ollamaLogTimer = setInterval(refreshOllamaLogs, 10000);
  window._ollamaLogTimer = _ollamaLogTimer;
}

async function refreshOllamaHealth(force = false) {
  const daemonChip = document.getElementById('ollama-chip-daemon');
  const serverChip = document.getElementById('ollama-chip-server');
  const hint = document.getElementById('ollama-hint');

  // Reset to checking
  setChipStatus(daemonChip, 'checking', 'Daemon Bridge');
  setChipStatus(serverChip, 'checking', 'Ollama (11434)');

  try {
    const data = await API.daemonRequest('/ollama/health', { forceRefresh: force });
    // Daemon responded
    setChipStatus(daemonChip, 'running', 'Daemon Bridge');

    if (data.status === 'running') {
      setChipStatus(serverChip, 'running', `Ollama (${data.models?.length || 0} models)`);
      hint.style.display = 'none';
    } else {
      setChipStatus(serverChip, 'offline', 'Ollama (11434)');
      hint.style.display = 'block';
      hint.textContent = `⚠️ Ollama server is not responding on 127.0.0.1:11434. Try: ollama serve — ${data.error || 'unreachable'}`;
    }
  } catch (err) {
    setChipStatus(daemonChip, 'offline', 'Daemon Bridge');
    setChipStatus(serverChip, 'offline', 'Ollama (11434)');
    hint.style.display = 'block';
    hint.textContent = `⚠️ Cannot reach daemon: ${err.message}. Is the local daemon running?`;
  }
}

function setChipStatus(chip, status, label) {
  const dot = chip.querySelector('.status-chip-dot');
  const text = chip.querySelector('span:last-child');
  chip.className = `status-chip status-${status}`;
  text.textContent = label;
}

async function loadOllamaModels(force = false) {
  const select = document.getElementById('ollama-model-select');
  select.innerHTML = '<option value="">Loading...</option>';

  try {
    const data = await API.daemonRequest('/ollama/models', { forceRefresh: force });
    if (data.models?.length) {
      select.innerHTML = data.models.map(m =>
        `<option value="${m.name}">${m.name}</option>`
      ).join('');
    } else {
      select.innerHTML = '<option value="">No models found</option>';
      if (data.error) {
        showToast('warning', `Models: ${data.error}`);
      }
    }
  } catch (err) {
    select.innerHTML = '<option value="">Error loading models</option>';
    showToast('error', `Models fetch failed: ${err.message}`);
  }
}

async function sendOllamaMessage() {
  const inputEl = document.getElementById('ollama-chat-input');
  const chatWindow = document.getElementById('ollama-chat-window');
  const modelSelect = document.getElementById('ollama-model-select');
  const prompt = inputEl.value.trim();

  if (!prompt) return;

  const model = modelSelect.value || 'llama3';

  // Add user message
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  userMsg.textContent = prompt;
  chatWindow.appendChild(userMsg);
  inputEl.value = '';
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // Thinking indicator
  const botMsg = document.createElement('div');
  botMsg.className = 'chat-message bot thinking';
  botMsg.textContent = 'Thinking...';
  chatWindow.appendChild(botMsg);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    const data = await API.daemonRequest('/ollama', {
      method: 'POST',
      body: JSON.stringify({ prompt, model }),
    });

    botMsg.classList.remove('thinking');
    if (data.error) {
      botMsg.classList.add('error');
      botMsg.textContent = data.error;
      if (data.hint) {
        const hintEl = document.createElement('div');
        hintEl.className = 'chat-meta';
        hintEl.textContent = data.hint;
        botMsg.appendChild(hintEl);
      }
    } else {
      botMsg.textContent = data.output || '(empty response)';
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = `Model: ${data.model || model} · Tokens: ${data.tokens?.input || 0}→${data.tokens?.output || 0}`;
      botMsg.appendChild(meta);
    }
  } catch (err) {
    botMsg.classList.remove('thinking');
    botMsg.classList.add('error');
    botMsg.textContent = `Connection failed: ${err.message}`;
  }

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function refreshOllamaLogs(force = false) {
  const logEl = document.getElementById('ollama-logs');
  const filterOllama = document.getElementById('ollama-log-filter')?.checked ?? true;

  try {
    const data = await API.daemonRequest('/logs?limit=200', { forceRefresh: force });
    let entries = data.logs || [];

    if (filterOllama) {
      entries = entries.filter(e =>
        e.tool === 'ollama' ||
        (e.msg && e.msg.toLowerCase().includes('ollama')) ||
        (e.msg && e.msg.includes('11434'))
      );
    }

    const last50 = entries.slice(-50);
    if (last50.length === 0) {
      logEl.textContent = filterOllama ? 'No Ollama-related log entries found.' : 'No log entries found.';
      return;
    }

    logEl.textContent = last50.map(e => {
      if (e.raw) return e.raw;
      const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '?';
      const lvl = (e.level || 'info').toUpperCase();
      return `[${ts}] ${lvl} ${e.msg || ''}${e.error ? ' | error=' + e.error : ''}${e.duration ? ' | ' + e.duration + 'ms' : ''}`;
    }).join('\n');

    logEl.scrollTop = logEl.scrollHeight;
  } catch (err) {
    logEl.textContent = `Failed to load logs: ${err.message}`;
  }
}

// ─── Backend Settings ─────────────────────────────────────────────────

function loadSettingsForm() {
  const urlInput = document.getElementById('settings-api-url');
  const encryptionCheck = document.getElementById('settings-use-encryption');
  if (urlInput) urlInput.value = API.getBaseUrl();
  if (encryptionCheck) encryptionCheck.checked = API.isEncryptionEnabled();
}

async function saveSettings() {
  const url = document.getElementById('settings-api-url')?.value || '';
  const key = document.getElementById('settings-api-key')?.value || '';
  const useEncryption = document.getElementById('settings-use-encryption')?.checked || false;
  const passphrase = document.getElementById('settings-encryption-passphrase')?.value || '';

  try {
    await API.saveSettings(url, key, { useEncryption, passphrase });
    showToast('success', 'Settings saved!');
    if (document.getElementById('settings-api-key')) document.getElementById('settings-api-key').value = '';
    checkHealth();
  } catch (err) {
    showToast('error', `Save failed: ${err.message}`);
  }
}

async function testConnection() {
  const statusEl = document.getElementById('connection-status');
  statusEl.textContent = 'Testing...';
  try {
    const data = await API.getHealth();
    statusEl.textContent = JSON.stringify(data, null, 2);
    showToast('success', 'Backend connected!');
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
    showToast('error', `Connection failed: ${err.message}`);
  }
}

// ─── Daemon Settings ─────────────────────────────────────────────────

function loadDaemonSettings() {
  const tokenInput = document.getElementById('settings-daemon-token');
  const urlInput = document.getElementById('settings-daemon-url');
  if (tokenInput) {
    const saved = localStorage.getItem('daemonToken');
    if (saved) {
      tokenInput.value = '';
      tokenInput.placeholder = '•••••••• (saved)';
    }
  }
  if (urlInput) {
    urlInput.value = (localStorage.getItem('daemonUrl') || 'http://127.0.0.1:5059').replace('localhost', '127.0.0.1');
  }
}

function saveDaemonSettings() {
  const token = document.getElementById('settings-daemon-token').value.trim();
  const url = document.getElementById('settings-daemon-url').value.trim();

  if (token) localStorage.setItem('daemonToken', token);
  if (url) localStorage.setItem('daemonUrl', url);

  showToast('success', 'Daemon settings saved');
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
    const modelSelector    = document.getElementById('playground-model-select');
    const customModelInput = document.getElementById('playground-model');
    
    const provider = providerSelector ? providerSelector.value : 'auto';
    let model = 'auto';

    if (modelSelector) {
        if (modelSelector.value === 'custom') {
            model = customModelInput ? customModelInput.value.trim() : 'auto';
        } else {
            model = modelSelector.value;
        }
    }

    const payload = { prompt };
    if (model && model !== 'auto') payload.model = model;
    if (provider && provider !== 'auto') payload.provider = provider;

    let res, data;

    // LOCAL providers: intercept and route directly to user's local daemon
    const isLocalProvider = provider && (
      provider.endsWith('_local') ||
      provider.endsWith('_local_bridge') ||
      provider === 'ollama_local_bridge' ||
      provider === 'ollama'
    );

    if (isLocalProvider) {
      try {
        // Map provider name to its daemon route
        let daemonPath;
        if (provider === 'ollama_local_bridge' || provider === 'ollama_local' || provider === 'ollama') {
          daemonPath = '/ollama';
        } else {
          // e.g. gemini_cli_local -> /gemini, qwen_cli_local -> /qwen
          daemonPath = '/' + provider.replace(/_cli_local$|_local_bridge$|_local$/, '');
        }

        data = await API.daemonRequest(daemonPath, {
          method: 'POST',
          body: JSON.stringify({ prompt, model: model !== 'auto' ? model : undefined })
        });
        res = { ok: true, status: 200 };
      } catch (err) {
        res = { ok: false, status: 502 };
        data = { error: err.message };
      }
    } else {
      // Cloud providers: route through the backend
      const base = API.getBaseUrl();
      const apiKey = await API.getApiKey();
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      data = await res.json();
    }

    botMsg.classList.remove('thinking');
    if (!res.ok || data.error) {
       botMsg.classList.add('error');
       botMsg.textContent = `Error (${res.status}): ${data.message || data.error || 'Unknown error'}`;
    } else {
       botMsg.textContent = data.output || JSON.stringify(data);
    }

    // Add metadata (always show if available, even on error)
    if (data.provider || data.model) {
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

// ─── Local Auth Page ────────────────────────────────────────────────
window._deviceFlowPolling = null;

async function refreshLocalAuth(force = false) {
  const container = document.getElementById('local-auth-list');
  const tbody = document.getElementById('local-auth-body');

  try {
    const data = await API.daemonRequest('/auth/oauth-status', { forceRefresh: force });
    const providers = data.providers || {};
    
    // Also check MITM status
    const envData = await API.daemonRequest('/v1/env');
    const mitmEl = document.getElementById('mitm-status');
    if (mitmEl) {
      const isMitm = envData.path?.includes('5060') || envData.cwd?.includes('MITM'); // heuristic
      mitmEl.textContent = isMitm ? 'Active' : 'Inactive';
      mitmEl.className = `badge ${isMitm ? 'badge-success' : 'badge-ghost'}`;
    }

    if (Object.keys(providers).length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No local tools configured in daemon.</td></tr>';
      return;
    }

    tbody.innerHTML = Object.entries(providers).map(([id, p]) => {
      const expiry = p.expires ? new Date(p.expires).toLocaleString() : 'Never';
      
      let actionBtn = '';
      if (p.active) {
        actionBtn = `<button class="btn btn-sm btn-danger" onclick="logoutLocalTool('${id}')">Logout</button>`;
      } else {
        if (p.method === 'oauth') {
          actionBtn = `<button class="btn btn-sm btn-primary" onclick="handleWebLogin('${id}')">OAuth Login</button>`;
        } else if (p.method === 'device-flow') {
          actionBtn = `<button class="btn btn-sm btn-primary" onclick="handleWebLogin('${id}')">Connect</button>`;
        } else if (p.method === 'sqlite-import') {
          actionBtn = `<button class="btn btn-sm btn-secondary" onclick="handleWebLogin('${id}')">Import from Cursor</button>`;
        } else if (p.method === 'harvested') {
          actionBtn = `<button class="btn btn-sm btn-ghost" disabled>Passive Scan Only</button>`;
        } else {
          actionBtn = `<button class="btn btn-sm btn-secondary" onclick="loginTerminal('${id}')">CLI Auth</button>`;
        }
      }

      return `
        <tr>
          <td><strong>${p.name || id}</strong></td>
          <td>${p.method}</td>
          <td>
            <span class="badge ${p.active ? 'badge-success' : 'badge-ghost'}">
              ${p.active ? 'Connected' : 'Disconnected'}
            </span>
          </td>
          <td class="text-muted" style="font-size: 0.82rem;">${p.active ? expiry : '—'}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Connection failed: ${err.message}</td></tr>`;
  }
}

async function harvestLocalTokens() {
  try {
    showToast('info', 'Scanning local filesystem for AI sessions...');
    const res = await API.daemonRequest('/auth/harvest', { method: 'POST' });
    showToast('success', `Harvest complete! Found ${res.sessions?.length || 0} active sessions.`);
    refreshLocalAuth();
  } catch (err) {
    showToast('error', `Harvest failed: ${err.message}`);
  }
}

async function handleWebLogin(tool) {
  try {
    const flow = await API.daemonRequest(`/auth/${tool}/login`, { method: 'POST' });
    
    if (flow.method === 'oauth') {
      showToast('info', 'Opening OAuth login in your browser...');
      
      // Auto-poll to see if it finishes (we don't get a webhook back reliably on frontend, backend handles callback)
      if (window._deviceFlowPolling) clearInterval(window._deviceFlowPolling);
      window._deviceFlowPolling = setInterval(async () => {
         const d = await API.daemonRequest('/auth/oauth-status');
         if (d.providers[tool]?.active) {
            clearInterval(window._deviceFlowPolling);
            showToast('success', `${tool} successfully authenticated via OAuth!`);
            refreshLocalAuth();
         }
      }, 3000);
      
    } else if (flow.method === 'device-flow') {
      document.getElementById('df-code-display').textContent = flow.userCode;
      document.getElementById('df-url-link').href = flow.verificationUrl;
      document.getElementById('df-status-text').textContent = 'Waiting for approval...';
      document.getElementById('modal-device-flow').classList.add('active');
      
      if (window._deviceFlowPolling) clearInterval(window._deviceFlowPolling);
      window._deviceFlowPolling = setInterval(() => pollDeviceLogin(tool), flow.interval || 5000);
      
    } else if (flow.method === 'sqlite-import') {
      if (flow.success) {
         showToast('success', `Imported token successfully from Cursor!`);
         refreshLocalAuth();
      }
    } else {
      showToast('success', `Auth initiated via fallback: ${flow.message || 'Check terminal'}`);
    }
  } catch (err) {
    showToast('error', `Login failed: ${err.message}`);
  }
}

async function startDeviceLogin(tool) {
  // Kept for backward compat backwards calls, routes to the unified handler
  return handleWebLogin(tool);
}

async function pollDeviceLogin(tool) {
  try {
    const res = await API.daemonRequest(`/auth/${tool}/poll`);
    if (res.status === 'success') {
      clearInterval(window._deviceFlowPolling);
      closeModal('device-flow');
      showToast('success', `Successfully connected to ${tool}!`);
      refreshLocalAuth();
    } else if (res.status === 'expired') {
      clearInterval(window._deviceFlowPolling);
      document.getElementById('df-status-text').textContent = 'Code expired. Please try again.';
      document.getElementById('df-status-text').className = 'text-error';
    }
  } catch (err) {
    // Silent fail on polling errors (usually timeout)
  }
}

async function logoutLocalTool(tool) {
  if (!confirm(`Are you sure you want to disconnect ${tool}?`)) return;
  try {
    await API.daemonRequest(`/auth/${tool}`, { method: 'DELETE' });
    showToast('success', `${tool} disconnected.`);
    refreshLocalAuth();
  } catch (err) {
    showToast('error', `Logout failed: ${err.message}`);
  }
}

function loginTerminal(tool) {
  showToast('info', `Please run '${tool} auth login' in your terminal.`);
}

// Global enter handler for chat
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  if (e.target.id === 'ollama-chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendOllamaMessage();
  }
});

/**
 * Toggle the visibility of detailed error rows in the Logs table.
 * @param {number} index - Index of the log entry.
 */
window.toggleErrorRow = function(index) {
  const row = document.getElementById(`error-row-${index}`);
  if (row) {
    row.classList.toggle('active');
  }
};
