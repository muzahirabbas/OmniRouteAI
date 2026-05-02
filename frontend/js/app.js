/**
 * OmniRouteAI Dashboard — Main Application Logic
 *
 * Handles page routing, data rendering, and user interactions.
 */

// ─── Global State ───────────────────────────────────────────────────
let stagedFiles = [];
let ollamaStagedFiles = [];
let mediaRecorder = null;
let audioChunks = [];

// ─── Provider Info Data ───────────────────────────────────────────────
const PROVIDER_INFO = {
  qoder: {
    title: 'Qoder CLI',
    description: 'AI coding assistant with built-in authentication',
    setup: [
      '1. Install: npm install -g @qoder-ai/qodercli',
      '2. Get token: https://qoder.com/account/integrations',
      '3. Add to local-daemon/.env file:',
      '   QODER_PERSONAL_ACCESS_TOKEN=your_token',
      '4. Restart daemon to apply'
    ],
    website: 'https://qoder.com'
  },
  codex: {
    title: 'OpenAI Codex',
    description: 'OpenAI\'s CLI coding assistant',
    setup: [
      '1. Install: npm install -g @openai/codex',
      '2. Login: Run codex and authenticate via OAuth',
      '3. Token is auto-harvested from ~/.codex/auth.json'
    ],
    website: 'https://openai.com/codex'
  },
  cline: {
    title: 'Cline',
    description: 'AI coding assistant with Claude integration',
    setup: [
      '1. Install: npm install -g cline',
      '2. Login via OAuth in the CLI',
      '3. Token is auto-harvested from ~/.cline/data/secrets.json'
    ],
    website: 'https://cline.com'
  },
  opencode: {
    title: 'OpenCode',
    description: 'Direct CLI - no auth needed, works out of the box',
    setup: [
      '1. Install: npm install -g opencode-ai',
      '2. Run: opencode and use /models to select',
      '3. Free models: minimax-m2.5-free, mimo-v2-pro-free, gpt-5.4-nano',
      '4. Works immediately - no login required!',
      '5. Can also use opencode_zen for API access with your own key'
    ],
    website: 'https://opencode.ai'
  },
  opencode_zen: {
    title: 'OpenCode Zen',
    description: 'OpenCode\'s model gateway - direct API access',
    setup: [
      '1. Get API key: https://opencode.ai/zen',
      '2. Add to .env: OPENCODE_ZEN_API_KEY=your_key',
      '3. Free models: minimax-m2.5-free, mimo-v2-pro-free',
      '4. Paid models: GPT-5, Claude, Gemini, Kimi, etc.'
    ],
    website: 'https://opencode.ai/zen'
  },
  zai: {
    title: 'ZAI CLI',
    description: 'AI coding assistant from ZAIBenchmark',
    setup: [
      '1. Install: npm install -g zai-cli',
      '2. Login: Run zai auth login',
      '3. Token is auto-harvested from config file'
    ],
    website: 'https://z.ai'
  },
  grok: {
    title: 'Grok CLI',
    description: 'xAI\'s CLI coding assistant',
    setup: [
      '1. Install: curl -s https://x.ai/xai-cli | bash',
      '2. Login: Run xai-cli and authenticate',
      '3. Check ~/.config/grok-cli for auth files'
    ],
    website: 'https://x.ai'
  },
  kiro: {
    title: 'Kiro CLI',
    description: 'AI IDE with CLI access',
    setup: [
      '1. Download Kiro IDE from https://kiro.ai',
      '2. Login via Kiro IDE (device-flow)',
      '3. Tokens stored in SQLite - cannot harvest'
    ],
    website: 'https://kiro.ai'
  },
  kimi: {
    title: 'Kimi',
    description: 'Moonshot AI\'s CLI assistant',
    setup: [
      '1. Install: npm install -g @moonshot-dev/kimi-cli',
      '2. Login: Run kimi auth login',
      '3. Uses device-flow authentication'
    ],
    website: 'https://kimi.moonshot.cn'
  },
  copilot: {
    title: 'GitHub Copilot',
    description: 'AI pair programming from GitHub',
    setup: [
      '1. Install gh CLI: brew install gh',
      '2. Login: gh auth login',
      '3. Enable copilot: gh copilot auth login'
    ],
    website: 'https://github.com/features/copilot'
  },
  ollama: {
    title: 'Ollama',
    description: 'Local AI models - runs offline on your machine',
    setup: [
      '1. Install: curl -fsSL https://ollama.com/install.sh | sh',
      '2. Start: ollama serve',
      '3. Pull model: ollama pull llama3.2',
      '4. Works completely offline!'
    ],
    website: 'https://ollama.com'
  }
};

// ─── Global Error Handlers ──────────────────────────────────────────────

window.onerror = function(msg, url, line, col, err) {
  console.error('Uncaught error:', msg, 'at', url, ':' + line);
  showToast('error', `Error: ${msg}`);
  return false;
};

window.onunhandledrejection = function(event) {
  console.error('Unhandled promise rejection:', event.reason);
  showToast('error', `Operation failed: ${event.reason?.message || event.reason}`);
};

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

  // Thinking toggle click handler - delegate from chat window
  document.getElementById('chat-window').addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.thinking-toggle');
    if (!toggleBtn) return;
    
    const contentDiv = toggleBtn.nextElementSibling;
    if (contentDiv && contentDiv.classList.contains('thinking-content')) {
      contentDiv.classList.toggle('expanded');
      toggleBtn.classList.toggle('expanded');
    }
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
  window._healthCheckInterval = setInterval(checkHealth, 30000);
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

  // Cleanup: clear health check interval when leaving any page
  if (window._healthCheckInterval) {
    clearInterval(window._healthCheckInterval);
    window._healthCheckInterval = null;
  }

  // Load page data
  switch (page) {
    case 'overview': refreshOverview(); break;
    case 'providers': refreshProviders(); break;
    case 'keys': refreshKeys(); break;
    case 'logs': refreshLogs(); break;
    case 'stats': 
      refreshStatsPage(); 
      loadStatsProviders();
      setTimeout(() => loadStatsChart(7), 500);
      break;
    case 'search-providers': refreshSearchProviders(); break;
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
          <span class="provider-name">${escapeHTML(p.name)}</span>
          <span class="badge ${p.disabled ? 'badge-error' : 'badge-success'}">
            ${p.disabled ? 'Disabled' : 'Active'}
          </span>
        </div>
        <div class="provider-meta">
          <div class="provider-meta-row">
            <span>Priority</span>
            <span class="provider-meta-value">${escapeHTML(String(p.priority))}</span>
          </div>
          <div class="provider-meta-row">
            <span>Weight</span>
            <span class="provider-meta-value">${escapeHTML(String(p.weight))}</span>
          </div>
          <div class="provider-meta-row">
            <span>Error Rate</span>
            <span class="provider-meta-value ${p.errorRate > 30 ? 'text-error' : ''}">${escapeHTML(String(p.errorRate))}%</span>
          </div>
          <div class="provider-meta-row">
            <span>API Keys</span>
            <span class="provider-meta-value">${escapeHTML(String(p.keyCount || 0))} registered</span>
          </div>
          <div class="provider-meta-row" style="margin-top: 0.25rem; border-top: 1px solid var(--border-subtle); padding-top: 0.5rem;">
            <span>Default Model</span>
            <span class="provider-meta-value" style="color: var(--text-accent); font-family: monospace; font-size: 0.75rem;">${escapeHTML(p.default_model || '—')}</span>
          </div>
        </div>
        <div class="capabilities-container">
          ${(p.features || []).map(f => `<span class="capability-tag tag-${f}">${escapeHTML(f)}</span>`).join('')}
          ${p.supports_reasoning ? '<span class="capability-tag tag-reasoning">reasoning</span>' : ''}
        </div>
        <div class="provider-actions">
          <button class="btn btn-sm btn-secondary"
            data-provider='${escapeHTML(JSON.stringify(p))}'
            onclick="const p = JSON.parse(this.dataset.provider); openEditProviderModal(p.name, p.priority, p.weight, p.models, p.default_model || '')">
            ✏️ Edit
          </button>
          <button class="btn btn-sm ${p.disabled ? 'btn-primary' : 'btn-danger'}"
            data-name="${escapeHTML(p.name)}"
            data-action="toggle"
            data-disabled="${!p.disabled}"
            onclick="toggleProvider(this.dataset.name, this.dataset.disabled === 'true')">
            ${p.disabled ? '✅ Enable' : '🚫 Disable'}
          </button>
          <button class="btn btn-sm btn-danger"
            data-name="${escapeHTML(p.name)}"
            data-action="delete"
            onclick="deleteProvider(this.dataset.name)">
            🗑️ Delete
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load: ${escapeHTML(err.message)}</div>`;
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
  
  const showInactive = document.getElementById('playground-show-inactive')?.checked;

  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const currentValue = el.value;
    let html = '';
    
    // Filter providers for playground if inactive are hidden
    let filteredProviders = providers;
    if (id === 'playground-provider' && !showInactive) {
      filteredProviders = providers.filter(p => !p.disabled);
    }

    const cloudProviders = filteredProviders.filter(p => p.type !== 'local_http');
    const localProviders = filteredProviders.filter(p => p.type === 'local_http');

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
  const btn = document.querySelector(`[data-name="${name}"][data-action="toggle"]`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    await API.toggleProvider(name, disabled);
    
    // Instant UI update - only target toggle button (not delete)
    if (btn) {
      const newDisabled = !disabled;
      btn.dataset.disabled = newDisabled;
      btn.className = `btn btn-sm ${newDisabled ? 'btn-primary' : 'btn-danger'}`;
      btn.textContent = newDisabled ? '✅ Enable' : '🚫 Disable';
      
      // Also update the badge in the same card
      const card = btn.closest('.provider-card');
      if (card) {
        const badge = card.querySelector('.badge');
        if (badge) {
          badge.className = `badge ${newDisabled ? 'badge-error' : 'badge-success'}`;
          badge.textContent = newDisabled ? 'Disabled' : 'Active';
        }
      }
    }
    
    showToast('success', `Provider ${name} ${disabled ? 'disabled' : 'enabled'}`);
    await refreshProviders(true);
  } catch (err) {
    showToast('error', err.message);
    if (btn) { btn.disabled = false; btn.textContent = disabled ? '✅ Enable' : '🚫 Disable'; }
  }
}

async function deleteProvider(name) {
  if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
    return;
  }
  
  // Disable all delete buttons to prevent double deletes
  document.querySelectorAll('button[data-action="delete"]').forEach(b => b.disabled = true);
  
  try {
    await API.deleteProvider(name);
    showToast('success', `Provider ${name} deleted`);
    await refreshProviders(true);
  } catch (err) {
    showToast('error', err.message);
    await refreshProviders(true); // Refresh to restore button states
  }
}

function openAddCustomProviderModal() {
  document.getElementById('form-add-custom-provider').reset();
  document.getElementById('custom-provider-models').value = '';
  document.getElementById('custom-provider-models-list').innerHTML = '';
  updateCustomProviderEndpointHint();
  document.getElementById('modal-add-custom-provider').classList.add('active');
}

function updateCustomProviderEndpointHint() {
  const type = document.getElementById('custom-provider-type').value;
  const hint = document.getElementById('custom-endpoint-hint');
  const endpointInput = document.getElementById('custom-provider-endpoint');
  
  if (type === 'custom_openai') {
    hint.textContent = 'Use OpenAI-compatible endpoint (e.g., https://api.openrouter.ai/v1/chat/completions)';
    if (!endpointInput.value) {
      endpointInput.placeholder = 'https://api.openrouter.ai/v1/chat/completions';
    }
  } else {
    hint.textContent = 'Use Anthropic-compatible endpoint (e.g., https://api.anthropic.com/v1/messages)';
    if (!endpointInput.value) {
      endpointInput.placeholder = 'https://api.anthropic.com/v1/messages';
    }
  }
}

async function fetchCustomProviderModels() {
  const typeEl = document.getElementById('custom-provider-type');
  const endpointEl = document.getElementById('custom-provider-endpoint');
  const apiKeyEl = document.getElementById('custom-provider-apikey');
  const modelsList = document.getElementById('custom-provider-models-list');

  if (!typeEl || !endpointEl || !apiKeyEl || !modelsList) {
    showToast('error', 'Form elements not found');
    return;
  }

  const type = typeEl.value;
  const endpoint = endpointEl.value.trim();
  const apiKey = apiKeyEl.value.trim();
  
  if (!endpoint) {
    showToast('error', 'Please enter an endpoint URL first');
    return;
  }
  
  modelsList.innerHTML = '<div class="spinner"></div> Fetching models...';
  
  try {
    let modelsUrl;
    if (type === 'custom_openai') {
      modelsUrl = endpoint.replace('/chat/completions', '/models');
    } else {
      modelsUrl = endpoint.replace('/v1/messages', '/models');
    }
    
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      if (type === 'custom_openai') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        headers['x-api-key'] = apiKey;
      }
    }
    
    const response = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    let models = [];
    
    if (type === 'custom_openai') {
      models = data.data?.map(m => m.id) || [];
    } else {
      models = data.models?.map(m => m.id) || [];
    }
    
    if (!models.length) throw new Error('No models found');
    
    document.getElementById('custom-provider-models').value = models.join(', ');
    
    modelsList.innerHTML = models.slice(0, 20).map(m => 
      `<span class="model-tag">${m}</span>`
    ).join('') + (models.length > 20 ? `<span class="model-tag">+${models.length - 20} more</span>` : '');
    
  } catch (err) {
    modelsList.innerHTML = `<div class="empty-state" style="color: var(--color-danger);">Failed to fetch: ${err.message}</div>`;
  }
}

async function saveCustomProvider() {
  const nameEl = document.getElementById('custom-provider-name');
  const typeEl = document.getElementById('custom-provider-type');
  const endpointEl = document.getElementById('custom-provider-endpoint');
  const apiKeyEl = document.getElementById('custom-provider-apikey');
  const priorityEl = document.getElementById('custom-provider-priority');
  const weightEl = document.getElementById('custom-provider-weight');
  const modelsEl = document.getElementById('custom-provider-models');

  if (!nameEl || !typeEl || !endpointEl || !apiKeyEl || !priorityEl || !weightEl || !modelsEl) {
    showToast('error', 'Form elements not found');
    return;
  }

  const name = nameEl.value.trim();
  const type = typeEl.value;
  const endpoint = endpointEl.value.trim();
  const apiKey = apiKeyEl.value.trim();
  const priority = parseInt(priorityEl.value) || 50;
  const weight = parseInt(weightEl.value) || 10;
  const models = modelsEl.value.trim()
    .split(',').map(m => m.trim()).filter(m => m);
  
  if (!name || !endpoint) {
    showToast('error', 'Name and endpoint are required');
    return;
  }
  
  try {
    await API.addCustomProvider({ name, type, endpoint, apiKey, priority, weight, models });
    showToast('success', `Provider ${name} added`);
    closeModal('add-custom-provider');
    await refreshProviders(true);
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
  const modelSearch = document.getElementById('playground-model-search');
  if (!modelSelect) return;

  // Clear current options
  modelSelect.innerHTML = '<option value="auto">Auto/Default</option>';

  if (window.allProviders) {
    if (providerName === 'auto') {
      // Collect all unique models from all active providers
      const allModels = new Set();
      window.allProviders.forEach(p => {
        if (!p.disabled && p.models) {
          p.models.forEach(m => allModels.add(m));
        }
      });
      
      Array.from(allModels).sort().forEach(m => {
        modelSelect.innerHTML += `<option value="${m}">${m}</option>`;
      });
    } else {
      const provider = window.allProviders.find(p => p.name === providerName);
      if (provider && provider.models && provider.models.length) {
        provider.models.sort().forEach(m => {
          modelSelect.innerHTML += `<option value="${m}">${m}</option>`;
        });
      }
    }
  }

  // Special case for local Ollama: try to fetch actual models from daemon
  if (providerName === 'ollama_local_bridge' || providerName === 'ollama') {
    fetchOllamaModelsForPlayground(modelSelect);
  }

  // Always add custom option
  modelSelect.innerHTML += '<option value="custom">Custom...</option>';

  // Reset to auto and hide input group
  modelSelect.value = 'auto';
  if (modelSearch) modelSearch.value = 'Auto/Default';
  if (inputGroup) inputGroup.style.display = 'none';
  
  // Re-filter results to show full list on next focus
  if (typeof filterPlaygroundModels === 'function') filterPlaygroundModels();
}

/**
 * Fetch actual models from local Ollama daemon for the playground dropdown.
 */
async function fetchOllamaModelsForPlayground(selectEl) {
  try {
    const data = await API.daemonRequest('/ollama/models');
    if (data.models && data.models.length > 0) {
      // Find the "Custom..." and "Auto" options to preserve them
      const hasCustom = selectEl.querySelector('option[value="custom"]');
      
      // Filter out duplicates that might already be there from static config
      const existingValues = new Set(['auto', 'custom']);
      
      // Clear and re-populate (preserving Auto/Default)
      let html = '<option value="auto">Auto Router (Detected Models)</option>';
      
      data.models.forEach(m => {
        if (!existingValues.has(m.name)) {
          html += `<option value="${m.name}">${m.name}</option>`;
          existingValues.add(m.name);
        }
      });
      
      html += '<option value="custom">Custom...</option>';
      
      // Only update if we are still on Ollama (user might have switched away)
      const providerSelect = document.getElementById('playground-provider');
      if (providerSelect && (providerSelect.value === 'ollama_local_bridge' || providerSelect.value === 'ollama')) {
        const currentVal = selectEl.value;
        selectEl.innerHTML = html;
        // Restore value if it's still valid
        if (existingValues.has(currentVal)) {
          selectEl.value = currentVal;
        } else {
          selectEl.value = 'auto';
        }
        
        if (typeof filterPlaygroundModels === 'function') filterPlaygroundModels();
      }
    }
  } catch (err) {
    console.warn('Failed to fetch dynamic Ollama models:', err);
  }
}

/**
 * Show model results dropdown
 */
function showModelResults() {
  const results = document.getElementById('playground-model-results');
  if (results) {
    results.classList.add('active');
    filterPlaygroundModels();
  }
}

/**
 * Filter models for the custom searchable dropdown
 */
function filterPlaygroundModels() {
  const searchInput = document.getElementById('playground-model-search');
  const resultsContainer = document.getElementById('playground-model-results');
  const modelSelect = document.getElementById('playground-model-select');
  
  if (!searchInput || !resultsContainer || !modelSelect) return;
  
  const clearBtn = document.getElementById('playground-model-clear');
  const query = searchInput.value.toLowerCase().trim();
  
  // Toggle clear button
  if (clearBtn) {
    if (query !== '') clearBtn.classList.add('active');
    else clearBtn.classList.remove('active');
  }

  const options = Array.from(modelSelect.options);
  
  let html = '';
  let matchCount = 0;
  
  options.forEach(opt => {
    if (opt.disabled) {
      html += `<div class="search-result-group">${opt.text}</div>`;
      return;
    }
    
    if (opt.text.toLowerCase().includes(query) || query === '') {
      const isSelected = modelSelect.value === opt.value;
      html += `
        <div class="search-result-item ${isSelected ? 'selected' : ''}" onclick="selectPlaygroundModel('${opt.value}', '${opt.text}')">
          <span>${opt.text}</span>
          ${isSelected ? '<span>✓</span>' : ''}
        </div>
      `;
      matchCount++;
    }
  });
  
  if (matchCount === 0) {
    html = '<div class="empty-state">No models found</div>';
  }
  
  resultsContainer.innerHTML = html;
}

/**
 * Handle selection from the custom dropdown
 */
function selectPlaygroundModel(value, text) {
  const modelSelect = document.getElementById('playground-model-select');
  const modelSearch = document.getElementById('playground-model-search');
  const resultsContainer = document.getElementById('playground-model-results');
  
  if (!modelSelect || !modelSearch || !resultsContainer) return;
  
  modelSelect.value = value;
  modelSearch.value = text;
  resultsContainer.classList.remove('active');
  
  // Trigger original change handler
  handlePlaygroundModelChange();
}

/**
 * Clear the model search input
 */
function clearPlaygroundModelSearch() {
  const modelSearch = document.getElementById('playground-model-search');
  const modelSelect = document.getElementById('playground-model-select');
  if (!modelSearch || !modelSelect) return;
  
  modelSearch.value = '';
  modelSelect.value = 'auto';
  filterPlaygroundModels();
  modelSearch.focus();
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
  const btn = document.getElementById('seed-defaults-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Seeding...'; }
  try {
    const result = await API.seedProviders();
    showToast('success', `Seeded ${result.seeded} default providers`);
    await refreshProviders(true);
    refreshOverview();
  } catch (err) {
    showToast('error', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Seed Defaults'; }
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
  
  // Clean up edit-provider modal state
  if (id === 'edit-provider') {
    window._currentEditingModels = [];
    window._discoveredModels = [];
  }
  
  if (id === 'device-flow') {
    if (window._deviceFlowPolling) {
      clearInterval(window._deviceFlowPolling);
    }
    const tool = window._currentDeviceFlowTool;
    if (tool) {
      API.daemonRequest(`/auth/${tool}/callback-server`, { method: 'DELETE' }).catch(() => {});
      window._currentDeviceFlowTool = null;
    }
  }
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
    await refreshProviders(true);
    if (window.allProviders) syncProviderDropdowns(window.allProviders);
    refreshOverview();
  } catch (err) {
    showToast('error', `Update failed: ${err.message}`);
  }
}

// ─── API Keys Page ───────────────────────────────────────────────────

async function refreshKeys(force = false) {
  const provider = document.getElementById('key-view-provider').value;
  const tbody = document.getElementById('keys-body');

  if (!provider) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Select a provider above.</td></tr>';
    return;
  }

  try {
    // Fetch current stats and historical data in parallel
    const [data, historyData] = await Promise.all([
      API.getKeys(provider, { forceRefresh: force }),
      API.getKeysHistory(provider, 7).catch(() => ({ history: [] }))
    ]);
    
    const historyMap = {};
    if (historyData?.history) {
      historyData.history.forEach(day => {
        day.keys?.forEach(k => {
          if (!historyMap[k.apiKey]) historyMap[k.apiKey] = { totalIn: 0, totalOut: 0, totalReq: 0 };
          historyMap[k.apiKey].totalIn += k.tokensIn || 0;
          historyMap[k.apiKey].totalOut += k.tokensOut || 0;
          historyMap[k.apiKey].totalReq += k.requests || 0;
        });
      });
    }

    if (!data.keys?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No keys registered for ${provider}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.keys.map((k) => {
      let metaLabel = '';
      if (k.metadata?.accountId) metaLabel = `<div class="form-hint" style="font-size: 0.7rem; color: var(--color-primary);">Account: ${escapeHTML(k.metadata.accountId)}</div>`;
      if (k.metadata?.projectId) {
        const region = k.metadata.region || 'us-central1';
        metaLabel = `<div class="form-hint" style="font-size: 0.7rem; color: var(--color-success);">Project: ${escapeHTML(k.metadata.projectId)} | Region: ${escapeHTML(region)}</div>`;
      }

      const hist = historyMap[k.fullKey];
      const histLabel = hist ? `<div class="form-hint" style="font-size: 0.65rem; color: var(--text-muted);">7d: ${escapeHTML(String(hist.totalReq))} req, ${escapeHTML(String(hist.totalIn.toLocaleString()))}/${escapeHTML(String(hist.totalOut.toLocaleString()))} tok</div>` : '';

      return `
        <tr>
          <td class="mono">
            <div>${escapeHTML(k.key)}</div>
            ${metaLabel}
            ${histLabel}
          </td>
          <td>${escapeHTML(String(k.usage))}</td>
          <td>${escapeHTML(String(k.tokensIn || 0))} / ${escapeHTML(String(k.tokensOut || 0))}</td>
          <td>${escapeHTML(String(k.rpm))}</td>
          <td><span class="badge ${k.disabled ? 'badge-error' : 'badge-success'}">
            ${k.disabled ? 'Disabled' : 'Active'}
          </span></td>
          <td>
            <button class="btn btn-sm ${k.disabled ? 'btn-primary' : 'btn-danger'}"
              onclick="toggleKey('${escapeHTML(provider)}', '${escapeHTML(k.fullKey)}', ${!k.disabled})">
              ${k.disabled ? 'Enable' : 'Disable'}
            </button>
            <button class="btn btn-sm btn-ghost" onclick="removeKey('${escapeHTML(provider)}', '${escapeHTML(k.fullKey)}')">🗑</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHTML(err.message)}</td></tr>`;
  }
}

function handleKeyProviderChange() {
  const provider = document.getElementById('key-provider-select').value;
  const metadataEl = document.getElementById('metadata-fields');
  const metadataContent = document.getElementById('metadata-fields-content');

  // Reset
  metadataEl.style.display = 'none';
  metadataContent.innerHTML = '';

  if (provider === 'cloudflare') {
    metadataEl.style.display = 'block';
    metadataContent.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Cloudflare Account ID</label>
        <input type="text" id="meta-accountId" class="input" style="width: 100%;" placeholder="e.g. 5e7... (Find in CF dashboard)">
      </div>
    `;
  } else if (provider === 'vertex') {
    metadataEl.style.display = 'block';
    metadataContent.innerHTML = `
      <div style="display: flex; gap: 1rem;">
        <div class="form-group" style="margin-bottom: 0; flex: 2;">
          <label class="form-label">Google Cloud Project ID</label>
          <input type="text" id="meta-projectId" class="input" style="width: 100%;" placeholder="e.g. my-gemini-project-123">
        </div>
        <div class="form-group" style="margin-bottom: 0; flex: 1;">
          <label class="form-label">Region (Default: us-central1)</label>
          <input type="text" id="meta-region" class="input" style="width: 100%;" placeholder="us-central1">
        </div>
      </div>
    `;
  }
}

async function addKey() {
  const provider = document.getElementById('key-provider-select').value;
  const keyInput = document.getElementById('key-input');
  const addBtn = document.getElementById('add-key-btn');
  const key = keyInput.value.trim();

  if (!provider) {
    showToast('warning', 'Please select a provider first');
    return;
  }
  if (!key) {
    showToast('warning', 'Please enter an API key');
    return;
  }

  // Scrape metadata
  const metadata = {};
  const metaAccount = document.getElementById('meta-accountId');
  const metaProject = document.getElementById('meta-projectId');
  const metaRegion = document.getElementById('meta-region');
  if (metaAccount) metadata.accountId = metaAccount.value.trim();
  if (metaProject) metadata.projectId = metaProject.value.trim();
  if (metaRegion && metadata.projectId) metadata.region = metaRegion.value.trim() || 'us-central1';

  if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding...'; }
  try {
    await API.addKey(provider, key, metadata);
    keyInput.value = '';
    
    // Clear metadata fields if any
    if (metaAccount) metaAccount.value = '';
    if (metaProject) metaProject.value = '';

    showToast('success', `Key added to ${provider}`);

    // Refresh if viewing same provider
    document.getElementById('key-view-provider').value = provider;
    refreshKeys();
  } catch (err) {
    showToast('error', err.message);
  } finally {
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add Key'; }
  }
}

async function removeKey(provider, key) {
  if (!confirm('Remove this API key?')) return;

  const btn = document.querySelector(`button[onclick*="removeKey('${provider}', '"]`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    await API.removeKey(provider, key);
    showToast('success', 'Key removed');
    refreshKeys();
  } catch (err) {
    showToast('error', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗑'; }
  }
}

async function toggleKey(provider, key, disabled) {
  const btn = document.querySelector(`button[onclick*="toggleKey('${provider}', '"]`);
  if (btn) { btn.disabled = true; }

  try {
    await API.toggleKey(provider, key, disabled);
    showToast('success', `Key ${disabled ? 'disabled' : 'enabled'}`);
    refreshKeys();
  } catch (err) {
    showToast('error', err.message);
  } finally {
    if (btn) { btn.disabled = false; }
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
          <td class="mono" title="${escapeHTML(log.request_id)}">${escapeHTML((log.request_id || '').slice(0, 8))}...</td>
          <td>${escapeHTML(log.provider)}</td>
          <td class="mono">${escapeHTML(log.model || '—')}</td>
          <td><span class="badge ${getStatusBadge(log.status)}">${escapeHTML(log.status)}</span></td>
          <td>${escapeHTML(log.latency ? log.latency + 'ms' : '—')}</td>
          <td>${log.tokens ? `${escapeHTML(String(log.tokens.input || 0))}/${escapeHTML(String(log.tokens.output || 0))}` : '—'}</td>
          <td class="error-msg-cell ${isError ? 'text-error' : ''}">${escapeHTML(errorMsg)}</td>
        </tr>
        ${isError ? `
          <tr id="error-row-${index}" class="error-detail-row">
            <td colspan="8">
              <div class="error-content">${escapeHTML(log.error)}</div>
            </td>
          </tr>
        ` : ''}
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${escapeHTML(err.message)}</td></tr>`;
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

async function clearCache() {
  try {
    const result = await API.clearCache();
    AppCache.clear();
    const successMsg = result.message || 'All cached entries have been purged.';
    showToast('success', successMsg);
  } catch (err) {
    showToast('error', `Failed to clear cache: ${err.message}`);
  }
}

async function refreshProvidersFromDb() {
  if (!confirm('Sync all providers and keys from Firestore now? This will reset all usage counters to zero.')) return;
  
  const btn = document.querySelector('button[onclick="refreshProvidersFromDb()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  
  try {
    showToast('info', 'Syncing from Firestore...');
    const result = await API.refreshProvidersFromDb();
    showToast('success', `Sync complete! ${result.providersRefreshed} providers refreshed.`);
    
    // Refresh the local views too
    refreshOverview(true);
    refreshProviders(true);
    refreshSearchProviders(true);
  } catch (err) {
    showToast('error', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync All From Firestore'; }
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

    // History table with collapsible rows
    const histBody = document.getElementById('stats-history-body');
    if (history.history?.length) {
      histBody.innerHTML = history.history.map((day, idx) => {
        const flatDay = flattenObject(day);
        
        const requests = flatDay['requests:total'] || flatDay['requests.total'] || flatDay.requests || 0;
        const inputTokens = flatDay['tokens:input:total'] || flatDay['tokens_input_total'] || flatDay['tokens.input.total'] || 0;
        const outputTokens = flatDay['tokens:output:total'] || flatDay['tokens_output_total'] || flatDay['tokens.output.total'] || 0;
        
        const inputCost = (inputTokens / 1000 * 0.001).toFixed(4);
        const outputCost = (outputTokens / 1000 * 0.002).toFixed(4);
        const totalCost = (parseFloat(inputCost) + parseFloat(outputCost)).toFixed(4);
        
        // Build provider breakdown from flat day data
        let providerBreakdown = '';
        const providerKeys = Object.keys(flatDay).filter(k => k.startsWith('requests:') && !k.includes('total'));
        if (providerKeys.length > 0) {
          providerBreakdown = providerKeys.map(pk => {
            const providerName = pk.replace('requests:', '');
            const reqCount = flatDay[pk] || 0;
            const inKey = `tokens:input:${providerName}`;
            const outKey = `tokens:output:${providerName}`;
            const inTokens = flatDay[inKey] || 0;
            const outTokens = flatDay[outKey] || 0;
            return `<tr><td>${providerName}</td><td>${reqCount}</td><td>${inTokens.toLocaleString()}</td><td>${outTokens.toLocaleString()}</td></tr>`;
          }).join('');
        } else {
          providerBreakdown = '<tr><td colspan="4" class="empty-state" style="padding: 0.5rem;">No provider breakdown available</td></tr>';
        }
        
        const dateKey = flatDay.date || day.date;
        
        return `
          <tr class="history-row" onclick="toggleHistoryRow('${dateKey}')" style="cursor: pointer;">
            <td id="hist-icon-${dateKey}" style="font-size: 0.8rem;">▶</td>
            <td><strong>${dateKey}</strong></td>
            <td>${typeof requests === 'number' ? requests.toLocaleString() : requests}</td>
            <td>${inputTokens.toLocaleString()}</td>
            <td>${outputTokens.toLocaleString()}</td>
            <td>$${totalCost}</td>
          </tr>
          <tr id="hist-details-${dateKey}" class="history-details" style="display: none;">
            <td colspan="6" style="padding: 0; background: var(--bg-card-secondary);">
              <div style="padding: 1rem;">
                <h4 style="margin: 0 0 0.75rem 0; font-size: 0.9rem; color: var(--text-secondary);">Provider Breakdown</h4>
                <table class="data-table" style="font-size: 0.85rem;">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Requests</th>
                      <th>Input Tokens</th>
                      <th>Output Tokens</th>
                    </tr>
                  </thead>
                  <tbody>${providerBreakdown}</tbody>
                </table>
                <div style="margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-muted);">
                  <span>Aggregated: ${flatDay.aggregated_at || 'N/A'}</span>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      histBody.innerHTML = '<tr><td colspan="6" class="empty-state">No historical data yet. Run "Aggregate Now" to save today\'s stats.</td></tr>';
    }
  } catch (err) {
    showToast('error', `Stats failed: ${err.message}`);
  }
}

function toggleHistoryRow(dateKey) {
  const detailsRow = document.getElementById(`hist-details-${dateKey}`);
  const icon = document.getElementById(`hist-icon-${dateKey}`);
  if (detailsRow) {
    const isHidden = detailsRow.style.display === 'none';
    detailsRow.style.display = isHidden ? 'table-row' : 'none';
    if (icon) {
      icon.textContent = isHidden ? '▼' : '▶';
    }
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

let statsChart = null;

async function onStatsTimeframeChange() {
  const timeframe = document.getElementById('stats-timeframe').value;
  const customRange = document.getElementById('stats-custom-range');
  const applyBtn = document.getElementById('stats-apply-custom');
  
  if (timeframe === 'custom') {
    customRange.style.display = 'flex';
    applyBtn.style.display = 'inline-block';
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    document.getElementById('stats-end-date').value = today.toISOString().split('T')[0];
    document.getElementById('stats-start-date').value = thirtyDaysAgo.toISOString().split('T')[0];
  } else {
    customRange.style.display = 'none';
    applyBtn.style.display = 'none';
    await loadStatsChart(parseInt(timeframe, 10));
  }
}

async function onStatsProviderChange() {
  const timeframe = document.getElementById('stats-timeframe').value;
  const days = timeframe === 'custom' ? null : parseInt(timeframe, 10);
  await loadStatsChart(days);
}

async function applyStatsCustomRange() {
  const startDate = document.getElementById('stats-start-date').value;
  const endDate = document.getElementById('stats-end-date').value;
  if (!startDate || !endDate) {
    showToast('error', 'Please select both start and end dates');
    return;
  }
  await loadStatsChart(null, startDate, endDate);
}

async function loadStatsChart(days = 7, startDate = null, endDate = null) {
  const provider = document.getElementById('stats-provider-filter').value;
  
  let data;
  if (startDate && endDate) {
    data = await API.getStatsHistoryFiltered({ startDate, endDate, provider });
  } else {
    data = await API.getStatsHistoryFiltered({ days, provider });
  }
  
  if (!data.history || data.history.length === 0) {
    showToast('error', 'No data available for selected timeframe');
    return;
  }
  
  renderStatsChart(data.history);
}

function renderStatsChart(history) {
  const ctx = document.getElementById('stats-chart').getContext('2d');
  
  const labels = history.map(h => h.date);
  const tokensIn = history.map(h => h.tokensIn);
  const tokensOut = history.map(h => h.tokensOut);
  const tokensTotal = history.map(h => h.tokensTotal);
  
  if (statsChart) {
    statsChart.destroy();
  }
  
  statsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Tokens In',
          data: tokensIn,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: 'Tokens Out',
          data: tokensOut,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: 'Total Tokens',
          data: tokensTotal,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 20,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            callback: function(value) {
              if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
              if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
              return value;
            },
          },
        },
      },
    },
  });
  
  const totalIn = tokensIn.reduce((a, b) => a + b, 0);
  const totalOut = tokensOut.reduce((a, b) => a + b, 0);
  const totalAll = totalIn + totalOut;
  
  document.getElementById('stats-totals').style.display = 'block';
  document.getElementById('stats-total-in').textContent = totalIn.toLocaleString();
  document.getElementById('stats-total-out').textContent = totalOut.toLocaleString();
  document.getElementById('stats-total-all').textContent = totalAll.toLocaleString();
}

async function loadStatsProviders() {
  try {
    const response = await API.getProviders();
    const providers = response.providers || response;
    const select = document.getElementById('stats-provider-filter');
    const currentVal = select.value;
    select.innerHTML = '<option value="all">All Providers</option>';
    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    select.value = currentVal;
  } catch (err) {
    console.error('Failed to load providers for stats filter:', err);
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

async function processOllamaFiles(files) {
  if (!files) return;
  
  for (const file of files) {
    // Only support images for Ollama vision models for now
    if (!file.type.startsWith('image/')) {
        showToast('warning', 'Ollama playground only supports image attachments.');
        continue;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1];
      ollamaStagedFiles.push({
        name: file.name,
        type: 'image',
        media_type: file.type,
        base64: base64,
        size: file.size
      });
      renderOllamaStagedFiles();
    };
    reader.readAsDataURL(file);
  }
}

function renderOllamaStagedFiles() {
  const container = document.getElementById('ollama-staged-files');
  if (!container) return;
  
  container.innerHTML = '';
  if (ollamaStagedFiles.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'flex';
  ollamaStagedFiles.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `
      <span class="file-chip-icon">🖼️</span>
      <span class="file-chip-name text-truncate" style="max-width: 100px;">${file.name}</span>
      <span class="file-chip-remove" onclick="removeOllamaStagedFile(${index})">×</span>
    `;
    container.appendChild(chip);
  });
}

function removeOllamaStagedFile(index) {
  ollamaStagedFiles.splice(index, 1);
  renderOllamaStagedFiles();
}

let _isOllamaSending = false;
async function sendOllamaMessage() {
  if (_isOllamaSending) return;
  const inputEl = document.getElementById('ollama-chat-input');
  const chatWindow = document.getElementById('ollama-chat-window');
  const modelSelect = document.getElementById('ollama-model-select');
  const prompt = inputEl.value.trim();

  if (!prompt && ollamaStagedFiles.length === 0) return;

  _isOllamaSending = true;
  document.getElementById('ollama-send-btn').disabled = true;

  const model = modelSelect.value || 'llama3';
  const filesToSend = [...ollamaStagedFiles];

  // Add user message
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  
  // Render text
  if (prompt) {
    const textSpan = document.createElement('div');
    textSpan.textContent = prompt;
    userMsg.appendChild(textSpan);
  }

  // Render images
  if (filesToSend.length > 0) {
    const imgContainer = document.createElement('div');
    imgContainer.style.display = 'flex';
    imgContainer.style.gap = '0.5rem';
    imgContainer.style.marginTop = '0.5rem';
    imgContainer.style.flexWrap = 'wrap';

    filesToSend.forEach(f => {
      const img = document.createElement('img');
      img.src = `data:${f.media_type};base64,${f.base64}`;
      img.style.width = '60px';
      img.style.height = '60px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '4px';
      img.style.border = '1px solid var(--border-color)';
      imgContainer.appendChild(img);
    });
    userMsg.appendChild(imgContainer);
  }

  chatWindow.appendChild(userMsg);
  
  // Clear input and staged files
  inputEl.value = '';
  ollamaStagedFiles = [];
  renderOllamaStagedFiles();

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
      body: JSON.stringify({ 
        prompt, 
        model,
        images: filesToSend.length > 0 ? filesToSend.map(f => f.base64) : undefined
      }),
    });

    botMsg.classList.remove('thinking');
    botMsg.textContent = ''; // Clear "Thinking..." placeholder
    if (data.error) {
      botMsg.classList.add('error');
      botMsg.textContent = data.error;
      if (data.hint) {
        const hintEl = document.createElement('div');
        hintEl.className = 'chat-meta hint';
        hintEl.style.color = 'var(--text-warning)';
        hintEl.style.marginTop = '0.5rem';
        hintEl.style.fontSize = '0.85rem';
        hintEl.style.fontStyle = 'italic';
        hintEl.innerHTML = `💡 <strong>Hint:</strong> ${data.hint}`;
        botMsg.appendChild(hintEl);
      }
    } else {
      botMsg.textContent = data.output || '(empty response)';
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      const tokens = data.tokens || {};
      const inputTok = tokens.input || 0;
      const outputTok = tokens.output || 0;
      const reasoningTok = tokens.reasoning || 0;
      meta.textContent = `Model: ${data.model || model} · Tokens: ${inputTok}→${outputTok}${reasoningTok > 0 ? ` (${reasoningTok} reasoning)` : ''}`;
      botMsg.appendChild(meta);
    }
  } catch (err) {
    botMsg.classList.remove('thinking');
    botMsg.classList.add('error');
    botMsg.textContent = `Connection failed: ${err.message}`;
  } finally {
    _isOllamaSending = false;
    document.getElementById('ollama-send-btn').disabled = false;
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
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
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHTML(message)}</span>`;

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

let _isSending = false;
let _currentStreamController = null;

async function sendMessage() {
  if (_isSending) return;
  const inputEl = document.getElementById('chat-input');
  const chatWindow = document.getElementById('chat-window');
  const chatInput = document.getElementById('chat-input');
  let prompt = chatInput.value.trim();

  // If no text but files are staged, allow sending with a default prompt
  if (!prompt && stagedFiles.length > 0) {
    prompt = "Please analyze this media.";
  }

  if (!prompt) return;

  _isSending = true;
  const sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;
  sendBtn.textContent = '...';

  // Capture staged files locally so we can clear the global UI state immediately
  const filesToSend = [...stagedFiles];

  // Add user message to UI
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  userMsg.textContent = prompt;
  
  // Append any attached media to the bubble (using our local copy)
  if (filesToSend.length > 0) {
    for (const file of filesToSend) {
      if (file.type === 'image') {
        const img = document.createElement('img');
        img.src = file.preview;
        userMsg.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'chat-media-attachment';
        placeholder.innerHTML = `<span>${file.type === 'audio' ? '🎵' : '🎬'}</span><small>${file.name}</small>`;
        userMsg.appendChild(placeholder);
      }
    }
  }

  chatWindow.appendChild(userMsg);
  
  // Clear input and global staged files immediately for a snappy feel
  inputEl.value = '';
  stagedFiles = [];
  renderStagedImages();
  
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
    const streamToggle     = document.getElementById('stream-toggle');
    const thinkingToggle   = document.getElementById('thinking-toggle');
    const reasoningEffort  = document.getElementById('reasoning-effort');

    if (!providerSelector || !modelSelector) {
      throw new Error('Playground controls not available');
    }
    
    const provider = providerSelector.value;
    let model = 'auto';

    if (modelSelector.value === 'custom') {
      if (customModelInput) {
        model = customModelInput.value.trim() || 'auto';
      } else {
        model = 'auto';
      }
    } else {
      model = modelSelector.value;
    }

    const useStream = streamToggle ? streamToggle.checked : false;
    const useThinking = thinkingToggle ? thinkingToggle.checked : false;
    const reasoningEffortValue = reasoningEffort ? reasoningEffort.value : 'medium';
    
    const payload = {};
    
    // Add reasoning/thinking parameters if enabled
    if (useThinking) {
      payload.reasoningEffort = reasoningEffortValue;
      payload.thinkingBudget = reasoningEffortValue === 'none' ? 0 : 1024;
    }
    
    // Construct multimodal prompt using our local copy of files
    if (filesToSend.length > 0) {
      payload.prompt = [{ type: 'text', text: prompt }];
      for (const file of filesToSend) {
        payload.prompt.push({
          type: file.type, // 'image', 'audio', or 'video'
          media_type: file.media_type,
          data: file.base64
        });
      }
    } else {
      payload.prompt = prompt;
    }

    if (model && model !== 'auto') payload.model = model;
    if (provider && provider !== 'auto') payload.provider = provider;

    // LOCAL providers: intercept and route directly to user's local daemon
    const isLocalProvider = provider && (
      provider.endsWith('_local') ||
      provider.endsWith('_local_bridge') ||
      provider === 'ollama_local_bridge' ||
      provider === 'ollama'
    );

    let res, data;

    if (isLocalProvider) {
      // Local providers don't support streaming through the daemon API
      try {
        let daemonPath;
        if (provider === 'ollama_local_bridge' || provider === 'ollama_local' || provider === 'ollama') {
          daemonPath = '/ollama';
        } else {
          daemonPath = '/' + provider.replace(/_cli_local$|_local_bridge$|_local$/, '');
        }

        data = await API.daemonRequest(daemonPath, {
          method: 'POST',
          body: JSON.stringify({ prompt: payload.prompt, model: model !== 'auto' ? model : undefined })
        });
        res = { ok: true, status: 200 };
      } catch (err) {
        res = { ok: false, status: 502 };
        data = { error: err.message };
      }
    } else if (useStream) {
      // STREAMING: Use fetch with proper headers for SSE
      try {
        const streamBody = { ...payload, stream: true };
        const apiKey = await API.getApiKey();
        
        const response = await API.streamRequest('/v1/chat/completions', streamBody);

        if (!response.ok) {
          res = response;
          data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        } else {
          // Handle SSE streaming
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let streamingContent = '';
          let streamingReasoningDiv = null;
          let streamingReasoningContent = '';

          if (reader) {
            botMsg.classList.remove('thinking');
            botMsg.classList.add('streaming');
            botMsg.innerHTML = '<span class="stream-cursor">▊</span>';

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed || !trimmed.startsWith('data: ')) continue;
                  
                  const jsonStr = trimmed.slice(6);
                  if (jsonStr === '[DONE]') continue;
                  
                  try {
                    const chunk = JSON.parse(jsonStr);
                    
                    // Handle chunk content - support both OmniRoute custom format and OpenAI format
                    const content = chunk.content || chunk.choices?.[0]?.delta?.content;
                    if (content) {
                      streamingContent += content;
                      // Don't overwrite innerHTML - it erases thinking container
                      // Insert content before cursor, preserving thinking at top
                      const cursor = botMsg.querySelector('.stream-cursor');
                      const contentHtml = renderMessageContent(content);
                      if (cursor) {
                        cursor.insertAdjacentHTML('beforebegin', contentHtml);
                      } else {
                        // No cursor yet, append to end
                        botMsg.insertAdjacentHTML('beforeend', contentHtml + '<span class="stream-cursor">▊</span>');
                      }
                      chatWindow.scrollTop = chatWindow.scrollHeight;
                    }
                    
                    // Handle reasoning content - support both formats
                    const reasoning = chunk.reasoning !== undefined ? chunk.reasoning : chunk.choices?.[0]?.delta?.reasoning;
                    if (reasoning !== undefined) {
                      if (!streamingReasoningDiv) {
                        streamingReasoningDiv = document.createElement('div');
                        streamingReasoningDiv.className = 'thinking-container streaming';
                        streamingReasoningDiv.innerHTML = `
                          <div class="thinking-toggle">
                            <span class="thinking-icon">💭</span>
                            <span>Reasoning</span>
                            <span class="thinking-arrow">▼</span>
                          </div>
                          <div class="thinking-content expanded streaming-reasoning-content"></div>
                        `;
                        // Insert at the beginning of bot message
                        botMsg.insertBefore(streamingReasoningDiv, botMsg.firstChild);
                      }
                      streamingReasoningContent += reasoning;
                      const reasoningContentDiv = streamingReasoningDiv.querySelector('.streaming-reasoning-content');
                      if (reasoningContentDiv) {
                        reasoningContentDiv.innerHTML = renderMessageContent(streamingReasoningContent);
                      }
                    }
                    
                    // Handle done signal (OmniRoute sends {done: true, provider: "...", model: "..."})
                    if (chunk.done) {
                      // Extract thinking content - support both OmniRoute and OpenAI formats
                      const thinkingContent = chunk.thinking || streamingReasoningContent || chunk.choices?.[0]?.delta?.reasoning || '';
                      if (thinkingContent) {
                        const thinkingDiv = document.createElement('div');
                        thinkingDiv.className = 'thinking-container streaming';
                        thinkingDiv.innerHTML = `
                          <div class="thinking-toggle">
                            <span class="thinking-icon">💭</span>
                            <span>Thinking</span>
                            <span class="thinking-arrow">▼</span>
                          </div>
                          <div class="thinking-content expanded">${renderMessageContent(thinkingContent)}</div>
                        `;
                        // Insert thinking at the beginning
                        botMsg.insertBefore(thinkingDiv, botMsg.firstChild);
                      }

                      // Extract metadata from final chunk
                      if (chunk.provider || chunk.model) {
                        const meta = document.createElement('div');
                        meta.className = 'chat-meta-container';
                        meta.innerHTML = `
                          ${chunk.provider ? `<span class="meta-item"><span class="meta-label">Provider:</span> ${chunk.provider}</span>` : ''}
                          ${chunk.model ? `<span class="meta-item"><span class="meta-label">Model:</span> ${chunk.model}</span>` : ''}
                        `;
                        botMsg.appendChild(meta);
                      }
                      // Include accumulated reasoning content from streaming
                      data = { 
                        output: streamingContent, 
                        provider: chunk.provider, 
                        model: chunk.model, 
                        thinking: chunk.thinking || streamingReasoningContent || null 
                      };
                    }
                  } catch (err) {
                    console.error('SSE parse error:', err);
                  }
                }
              }
            } catch (err) {
              // Stream ended or error
            }

            botMsg.classList.remove('streaming');
            // Remove cursor
            if (botMsg.innerHTML.includes('stream-cursor')) {
              botMsg.innerHTML = botMsg.innerHTML.replace('<span class="stream-cursor">▊</span>', '');
            }
            
            // Set res for later checks
            res = response;
          }
        }
      } catch (err) {
        res = { ok: false, status: 500 };
        data = { error: err.message };
      }
    } else {
      // NON-STREAMING: Original behavior
      const base = API.getBaseUrl();
      const apiKey = await API.getApiKey();
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      try {
        data = await API.request('/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        res = { ok: true, status: 200 };
      } catch (err) {
        res = { ok: false, status: 502 };
        data = { error: err.message };
      }
    }

    // Process response (for non-streaming or stream errors)
    if (!useStream || !res.ok) {
      botMsg.classList.remove('thinking');
      botMsg.textContent = ''; // Clear the "Thinking..." placeholder text
      if (!res.ok || data.error) {
        botMsg.classList.add('error');
        botMsg.innerHTML = `<div class="error-header">Error (${res.status})</div><div class="error-body">${data.message || data.error || 'Unknown error'}</div>`;
      } else {
        // Show thinking dropdown whenever there's thinking content (regardless of toggle)
        // Also support OpenAI format: data.choices[0].message.reasoning
        const thinkingContent = data.thinking || data.choices?.[0]?.message?.reasoning || '';
        
        // Get content - prioritize output field
        let content = data.output || data.choices?.[0]?.message?.content || '';
        
        // If thinking exists and output contains thinking-like content at start, strip it
        if (thinkingContent && content) {
          const thinkingTrimmed = thinkingContent.trim();
          const contentTrimmed = content.trim();
          // If output starts with thinking content, remove it
          if (contentTrimmed.startsWith(thinkingTrimmed.substring(0, 50))) {
            content = contentTrimmed.replace(thinkingTrimmed, '').trim();
          }
        }
        
        if (thinkingContent) {
          const thinkingDiv = document.createElement('div');
          thinkingDiv.className = 'thinking-container';
          thinkingDiv.innerHTML = `
            <div class="thinking-toggle">
              <span class="thinking-icon">💭</span>
              <span>Thinking</span>
              <span class="thinking-arrow">▼</span>
            </div>
            <div class="thinking-content expanded">${renderMessageContent(thinkingContent)}</div>
          `;
          botMsg.appendChild(thinkingDiv);
        }

        // Always show content if it exists (after stripping thinking)
        if (content) {
          botMsg.innerHTML += renderMessageContent(content);
        } else if (!thinkingContent) {
          // Only show this if there's NO thinking and NO content
          botMsg.innerHTML += '<em class="text-muted">Response received but no text output was provided.</em>';
        }

        // Add metadata (always show if available, even on error)
        if (data.provider || data.model || data.request_id || data.tokens) {
          const meta = document.createElement('div');
          meta.className = 'chat-meta-container';
          
          const providerInfo = data.provider ? `<span class="meta-item"><span class="meta-label">Provider:</span> ${data.provider}</span>` : '';
          const modelInfo    = data.model ? `<span class="meta-item"><span class="meta-label">Model:</span> ${data.model}</span>` : '';
          const requestId    = data.request_id ? `<span class="meta-item meta-id" title="${data.request_id}"><span class="meta-label">ID:</span> ${data.request_id.slice(0, 8)}...</span>` : '';
          
          // Add token information (input, output, reasoning)
          const tokens = data.tokens || {};
          const inputTok = tokens.input || 0;
          const outputTok = tokens.output || 0;
          const reasoningTok = tokens.reasoning || 0;
          const tokenInfo = `<span class="meta-item"><span class="meta-label">Tokens:</span> ${inputTok}→${outputTok}${reasoningTok > 0 ? ` (${reasoningTok} reasoning)` : ''}</span>`;
          
          meta.innerHTML = `${providerInfo}${modelInfo}${requestId}${tokenInfo}`;
          botMsg.appendChild(meta);
        }
      }
    }
  } catch (err) {
    botMsg.classList.remove('thinking');
    botMsg.classList.add('error');
    botMsg.textContent = `Connection Failed: ${err.message}`;
  } finally {
    _isSending = false;
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
}

function clearChat() {
  const chatWindow = document.getElementById('chat-window');
  chatWindow.innerHTML = '<div class="chat-message bot">Window cleared. How can I help you?</div>';
}

// ─── Multimodal Helpers ─────────────────────────────────────────────

async function handleImageUpload(input) {
  if (!input.files || input.files.length === 0) return;
  
  for (const file of input.files) {
    const isImage = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    const isVideo = file.type.startsWith('video/');
    
    if (isImage || isAudio || isVideo) {
      await processFile(file);
    }
  }
  input.value = ''; // Reset input
}

async function handlePaste(e) {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      await processFile(file);
    }
  }
}

async function processFile(file) {
  // Deep Audit: Validate MIME types before staging to prevent 400 errors
  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/');
  const isVideo = file.type.startsWith('video/');

  if (!isImage && !isAudio && !isVideo) {
    showToast('warning', `Unsupported file type: ${file.type || 'unknown'}`);
    return;
  }

  // Check for specific obscure types that often fail across providers
  const problematicTypes = ['image/bmp', 'image/tiff', 'audio/aac'];
  if (problematicTypes.includes(file.type)) {
    showToast('warning', `Format ${file.type} may not be supported by all AI models.`);
  }

  const base64Raw = await fileToBase64(file);
  const base64 = base64Raw.split(',')[1];
  
  let type = 'image';
  let preview = base64Raw;
  
  if (file.type.startsWith('audio/')) {
    type    = 'audio';
    preview = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOSAxOGgyYTMgMyAwIDAgMCIDMtM1YyYTQgNCAwIDAgMC00IDRoNCIvPjxwYXRoIGQ9Ik0xOSAxMGgtMS41Ii8+PHBhdGggZD0iTTcgMTBoLTEuNSIvPjxwYXRoIGQ9Ik0xMSAxOWg0Ii8+PC9zdmc+'; // generic musical-note icon
  } else if (file.type.startsWith('video/')) {
    type    = 'video';
    preview = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIyIiB5PSIyIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHJ4PSIyLjEzIi8+PHBhdGggZD0iTTcgMmwtNCA0Ii8+PHBhdGggZD0iTTcgMjJsLTQgLTQiLz48cGF0aCBkPSJNMjIgN2wtNCA0Ii8+PHBhdGggZD0iTTIyIDE3bC00IC00Ii8+PC9zdmc+'; // generic clapperboard icon
  }

  stagedFiles.push({
    name: file.name,
    type,
    media_type: file.type,
    size: file.size,
    base64,
    preview
  });
  renderStagedImages();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

function renderStagedImages() {
  const container = document.getElementById('staged-images');
  if (!container) return;
  
  container.innerHTML = stagedFiles.map((file, index) => `
    <div class="staged-image">
      <img src="${file.preview}" alt="preview">
      <button class="remove-btn" onclick="removeStagedImage(${index})">✕</button>
    </div>
  `).join('');
}

window.removeStagedImage = function(index) {
  stagedFiles.splice(index, 1);
  renderStagedImages();
};

function sanitizeUrl(url) {
  const blocked = ['javascript:', 'data:', 'vbscript:'];
  const lower = url.toLowerCase().trim();
  if (blocked.some(b => lower.startsWith(b))) {
    return '';
  }
  return url;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    const prompt = e.target.value.trim();
    // Allow enter if text is present OR files are staged
    if (prompt || stagedFiles.length > 0) {
      e.preventDefault();
      sendMessage();
    }
  }
}

/**
 * Smart Message Renderer for Multimodal AI responses.
 * Detects Markdown images, audio/video links, code blocks and renders them as HTML elements.
 */
function renderMessageContent(content) {
  if (!content) return '';
  
  // Escape HTML first to prevent XSS (but preserve markdown chars)
  let escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks ```...``` - must be before other formatting
  escaped = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="code-block"><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
  });

  // Inline code `code`
  escaped = escaped.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // Bold **text** or __text__
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic *text* or _text_ (but not ** or __)
  escaped = escaped.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  escaped = escaped.replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '<em>$1</em>');

  // Headers # ## ###
  escaped = escaped.replace(/^### (.*)$/gm, '<h4>$1</h4>');
  escaped = escaped.replace(/^## (.*)$/gm, '<h3>$1</h3>');
  escaped = escaped.replace(/^# (.*)$/gm, '<h2>$1</h2>');

  // Unordered lists - lines starting with - or * (not **)
  escaped = escaped.replace(/^[\-\*] (?!(?:\*\*|__))(.*)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> elements in <ul>
  escaped = escaped.replace(/(<li>.*<\/li>\n?)+/g, (match) => '<ul class="md-list">' + match + '</ul>');

  // Ordered lists 1. 2. etc
  escaped = escaped.replace(/^\d+\. (.*)$/gm, '<li class="ordered">$1</li>');

  // Links [text](url)
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => `<a href="${sanitizeUrl(url)}" target="_blank" class="chat-link">${text}</a>`);

  // Basic Markdown Images
  // ![alt](url) -> <img src="url" alt="alt">
  escaped = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => `<img src="${sanitizeUrl(url)}" alt="${alt}" class="chat-response-media">`);
  
  // Markdown Audio Link: [audio](url) -> <audio controls src="url"></audio>
  escaped = escaped.replace(/\[audio\]\(([^)]+)\)/g, (match, url) => `<audio controls src="${sanitizeUrl(url)}" class="chat-response-media"></audio>`);
  
  // Markdown Video Link: [video](url) -> <video controls src="url"></video>
  escaped = escaped.replace(/\[video\]\(([^)]+)\)/g, (match, url) => `<video controls src="${sanitizeUrl(url)}" class="chat-response-media"></video>`);

  // Horizontal rule ---
  escaped = escaped.replace(/^---$/gm, '<hr class="md-hr">');

  // Blockquotes > text
  escaped = escaped.replace(/^&gt; (.*)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');

  // Newline to <br> but preserve paragraph breaks
  escaped = escaped.replace(/\n\n/g, '</p><p class="md-paragraph">');
  escaped = escaped.replace(/\n/g, '<br>');
  
  // Wrap in paragraph if not already wrapped
  if (!escaped.startsWith('<h') && !escaped.startsWith('<ul') && !escaped.startsWith('<ol') && !escaped.startsWith('<pre') && !escaped.startsWith('<blockquote')) {
    escaped = '<p class="md-paragraph">' + escaped + '</p>';
  }

  return escaped;
}

// ─── Local Auth Page ────────────────────────────────────────────────
window._deviceFlowPolling = null;

async function refreshLocalAuth(force = false) {
  const container = document.getElementById('local-auth-list');
  const tbody = document.getElementById('local-auth-body');

  try {
    const statusPath = force ? '/auth/oauth-status?force=true' : '/auth/oauth-status';
    const [data, envData] = await Promise.all([
      API.daemonRequest(statusPath),
      API.daemonRequest('/v1/env')
    ]);
    const providers = data.providers || {};
    
    // Also check MITM status
    const mitmEl = document.getElementById('mitm-status');
    if (mitmEl) {
      const isMitm = envData.env?.MITM_PROXY === 'true' || envData.cwd?.includes('MITM');
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
          actionBtn = `
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" onclick="handleWebLogin('${id}')">OAuth Login</button>
              ${id === 'cline' ? `<button class="btn btn-sm btn-outline" title="Paste redirect URL if browser stuck" onclick="promptManualCallback('${id}')">🔗</button>` : ''}
            </div>
          `;
        } else if (p.method === 'device-flow') {
          actionBtn = `<button class="btn btn-sm btn-primary" onclick="handleWebLogin('${id}')">Connect</button>`;
        } else if (p.method === 'sqlite-import') {
          actionBtn = `<button class="btn btn-sm btn-secondary" onclick="handleWebLogin('${id}')">Import from Cursor</button>`;
        } else if (p.method === 'harvested') {
          if (p.active) {
            actionBtn = `<button class="btn btn-sm btn-danger" onclick="logoutLocalTool('${id}')">Logout</button>`;
          } else {
            actionBtn = `<button class="btn btn-sm btn-secondary" onclick="loginTerminal('${id}')">CLI Login Required</button>`;
          }
        } else if (p.method === 'none') {
          // Direct CLI - no auth needed, just install and use
          actionBtn = `<button class="btn btn-sm btn-primary" onclick="showProviderInfo('${id}')">How to Use</button>`;
        } else {
          actionBtn = `<button class="btn btn-sm btn-secondary" onclick="loginTerminal('${id}')">CLI Auth</button>`;
        }
      }

      const infoBtn = PROVIDER_INFO[id] || PROVIDER_INFO[id.replace('-', '_')] 
        ? `<button class="btn btn-sm btn-ghost" title="Setup Info" onclick="showProviderInfo('${id}')">ℹ️</button>` 
        : '';

      // Determine status display based on method
      let statusDisplay = '';
      if (p.method === 'none') {
        statusDisplay = '<span class="badge badge-info">Direct CLI</span>';
      } else if (p.active) {
        statusDisplay = `<span class="badge ${p.active ? 'badge-success' : 'badge-ghost'}">
          ${p.active ? (p.method === 'harvested' ? 'Harvested' : 'Connected') : 'Disconnected'}
        </span>`;
      } else {
        statusDisplay = '<span class="badge badge-ghost">Disconnected</span>';
      }

      return `
        <tr>
          <td><strong>${p.name || id}</strong></td>
          <td>${p.method}</td>
          <td>${statusDisplay}</td>
          <td class="text-muted" style="font-size: 0.82rem;">${p.active ? expiry : '—'}</td>
          <td>${infoBtn}${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Connection failed: ${err.message}</td></tr>`;
  }
}

async function promptManualCallback(toolId) {
  const url = prompt(`Paste the full URL from your browser's address bar (it should contain 'code=...')`);
  if (!url) return;

  try {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');

    if (!code) {
      showToast('error', 'URL does not contain a "code" parameter');
      return;
    }

    showToast('info', `Manually submitting OAuth code for ${toolId}...`);
    // Hits the daemon's callback directly as if the redirect worked
    await API.daemonRequest(`/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || 'none')}`);
    showToast('success', `${toolId} login successful!`);
    await refreshLocalAuth(); // Refresh the list
  } catch (err) {
    showToast('error', `Invalid URL: ${err.message}`);
  }
}

function showProviderInfo(providerId) {
  let info = PROVIDER_INFO[providerId];
  if (!info) {
    info = PROVIDER_INFO[providerId.replace('-', '_')];
  }
  if (!info) {
    showToast('info', 'No setup info available for this provider');
    return;
  }

  const modalHtml = `
    <div class="modal-overlay active" id="modal-provider-info">
      <div class="modal" style="max-width: 500px;">
        <div class="modal-header">
          <h3>${info.title}</h3>
          <button class="modal-close" onclick="closeProviderInfoModal()">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-muted" style="margin-bottom: 1rem;">${info.description}</p>
          <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
            <strong style="display: block; margin-bottom: 0.5rem;">Setup Instructions:</strong>
            <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.9rem;">
              ${info.setup.map(step => `<li style="margin-bottom: 0.25rem;">${step}</li>`).join('')}
            </ul>
          </div>
          ${info.website ? `<a href="${info.website}" target="_blank" class="btn btn-sm btn-primary">Visit Website</a>` : ''}
        </div>
      </div>
    </div>
  `;

  // Remove existing modal if any
  const existing = document.getElementById('modal-provider-info');
  if (existing) existing.remove();

  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Add close handlers
  document.querySelector('#modal-provider-info .modal-overlay').addEventListener('click', closeProviderInfoModal);
}

function closeProviderInfoModal() {
  const modal = document.getElementById('modal-provider-info');
  if (modal) modal.remove();
}

async function harvestLocalTokens() {
  try {
    showToast('info', 'Scanning local filesystem for AI sessions...');
    const res = await API.daemonRequest('/auth/harvest', { method: 'POST' });
    const count = Object.keys(res.sessions || {}).length;
    showToast('success', `Harvest complete! Found ${count} active sessions.`);
    refreshLocalAuth(true);
  } catch (err) {
    showToast('error', `Harvest failed: ${err.message}`);
  }
}

async function handleWebLogin(tool) {
  try {
    const flow = await API.daemonRequest(`/auth/${tool}/login`, { method: 'POST' });
    
    if (flow.method === 'oauth') {
      showToast('info', 'OAuth login opened in your browser...');
      
      if (window._deviceFlowPolling) clearInterval(window._deviceFlowPolling);
      window._currentDeviceFlowTool = tool;
      let pollCount = 0;
      window._deviceFlowPolling = setInterval(async () => {
        pollCount++;
        const statusRes = await API.daemonRequest(`/auth/${tool}/callback-status`, { forceRefresh: true });
        console.log(`[OAuth] Poll ${pollCount} for ${tool}:`, statusRes);
        if (statusRes.status === 'success') {
          clearInterval(window._deviceFlowPolling);
          showToast('success', `${tool} successfully authenticated!`);
          refreshLocalAuth();
        }
      }, 2000);
      
    } else if (flow.method === 'device-flow') {
      document.getElementById('df-code-display').textContent = flow.userCode;
      document.getElementById('df-url-link').href = flow.verificationUrl;
      document.getElementById('df-status-text').textContent = 'Waiting for approval...';
      document.getElementById('modal-device-flow').classList.add('active');
      
      if (window._deviceFlowPolling) clearInterval(window._deviceFlowPolling);
      window._currentDeviceFlowTool = tool;
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
    console.log(`[pollDeviceLogin] Polling ${tool}...`);
    const res = await API.daemonRequest(`/auth/${tool}/poll`, { forceRefresh: true });
    console.log(`[pollDeviceLogin] Response for ${tool}:`, res);
    
    if (res.interval) {
      console.log(`[pollDeviceLogin] Updating interval to ${res.interval}ms`);
      if (window._deviceFlowPolling) clearInterval(window._deviceFlowPolling);
      window._deviceFlowPolling = setInterval(() => pollDeviceLogin(tool), res.interval);
      document.getElementById('df-status-text').textContent = `Please wait ${Math.round(res.interval/1000)}s between requests...`;
      return;
    }
    if (res.status === 'success') {
      clearInterval(window._deviceFlowPolling);
      closeModal('device-flow');
      API.daemonRequest(`/auth/${tool}/callback-server`, { method: 'DELETE' }).catch(() => {});
      showToast('success', `Successfully connected to ${tool}!`);
      refreshLocalAuth();
    } else if (res.status === 'expired') {
      clearInterval(window._deviceFlowPolling);
      document.getElementById('df-status-text').textContent = 'Code expired. Please try again.';
      document.getElementById('df-status-text').className = 'text-error';
      API.daemonRequest(`/auth/${tool}/callback-server`, { method: 'DELETE' }).catch(() => {});
    } else if (res.status === 'error') {
      clearInterval(window._deviceFlowPolling);
      const errMsg = res.message || 'Unknown error';
      document.getElementById('df-status-text').textContent = `Error: ${errMsg}`;
      document.getElementById('df-status-text').className = 'text-error';
      showToast('error', `${tool} login failed: ${errMsg}`);
      API.daemonRequest(`/auth/${tool}/callback-server`, { method: 'DELETE' }).catch(() => {});
    } else if (res.status === 'pending') {
      // Still waiting, do nothing
    }
  } catch (err) {
    // Silent fail on network errors
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

// ─── Native Audio Recording ────────────────────────────────────────

window.toggleRecording = async function() {
  const container = document.getElementById('chat-controls-container');
  const isRecording = container.classList.toggle('recording-active');

  if (isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
};

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const file = new File([audioBlob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
      await processFile(file);
      
      // Stop all tracks to release mic
      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
  } catch (err) {
    console.error('Mic access denied:', err);
    showToast('error', 'Microphone access denied or not available.');
    document.getElementById('chat-controls-container').classList.remove('recording-active');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// ─── Search Providers Page ───────────────────────────────────────────

async function refreshSearchProviders(force = false) {
  const container = document.getElementById('search-providers-list');
  try {
    const data = await API.getSearchProviders({ forceRefresh: force });
    const providers = data.providers || [];

    if (providers.length === 0) {
      container.innerHTML = '<div class="empty-state">No search providers found. Click "Seed Defaults" to add.</div>';
      return;
    }

    container.innerHTML = providers.map(p => {
      const statusBadge = p.disabled 
        ? '<span class="badge badge-error">Disabled</span>' 
        : '<span class="badge badge-success">Active</span>';
      
      return `
        <div class="provider-card">
          <div class="provider-header">
            <div class="provider-title">
              <h4>${escapeHTML(p.name)}</h4>
              ${statusBadge}
            </div>
            <div class="provider-meta">
              <span class="text-muted">Priority: ${escapeHTML(String(p.priority || '—'))}</span>
              <span class="text-muted">Weight: ${escapeHTML(String(p.weight || '—'))}</span>
              <span class="text-muted">Keys: ${escapeHTML(String(p.keyCount || 0))}</span>
            </div>
          </div>
          <div class="provider-details">
            <p class="text-muted" style="font-size: 0.85rem; margin: 0.5rem 0;">
              ${escapeHTML(p.features?.join(', ') || 'No features')}
            </p>
            <p class="text-muted" style="font-size: 0.8rem;">
              Free tier: ${escapeHTML(p.freeTier || 'N/A')}
            </p>
            ${p.errorRate !== undefined ? `
              <p class="text-muted" style="font-size: 0.8rem;">
                Error rate: ${escapeHTML(String(p.errorRate))}%
              </p>
            ` : ''}
          </div>
          <div class="provider-actions">
            <button class="btn btn-sm btn-ghost" onclick="toggleSearchProvider('${escapeHTML(p.name)}', ${!p.disabled})">
              ${p.disabled ? 'Enable' : 'Disable'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Populate dropdowns
    const select = document.getElementById('search-key-provider-select');
    const viewSelect = document.getElementById('search-key-view-provider');
    if (select) {
      select.innerHTML = '<option value="">Select Search Provider</option>' + 
        providers.map(p => `<option value="${escapeHTML(p.name)}">${escapeHTML(p.name)}</option>`).join('');
    }
    if (viewSelect) {
      viewSelect.innerHTML = '<option value="" disabled selected>Filter by provider...</option>' +
        providers.map(p => `<option value="${escapeHTML(p.name)}">${escapeHTML(p.name)}</option>`).join('');
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state text-error">Error: ${escapeHTML(err.message)}</div>`;
  }
}

async function toggleSearchProvider(name, disabled) {
  try {
    await API.toggleSearchProvider(name, disabled);
    showToast('success', `Search provider ${name} ${disabled ? 'disabled' : 'enabled'}`);
    refreshSearchProviders(true);
  } catch (err) {
    showToast('error', err.message);
  }
}

async function seedSearchProviders() {
  try {
    await API.seedSearchProviders();
    showToast('success', 'Search providers seeded');
    refreshSearchProviders(true);
  } catch (err) {
    showToast('error', err.message);
  }
}

function handleSearchKeyProviderChange() {
  const provider = document.getElementById('search-key-provider-select').value;
  const metadataDiv = document.getElementById('search-metadata-fields');
  const metadataContent = document.getElementById('search-metadata-fields-content');
  
  if (!provider) {
    metadataDiv.style.display = 'none';
    return;
  }

  // Google PSE needs Search Engine ID
  if (provider === 'google-pse') {
    metadataContent.innerHTML = `
      <div class="form-group" style="margin-bottom: 0.5rem;">
        <label class="form-label">Search Engine ID (cx)</label>
        <input type="text" id="meta-search-engine-id" class="input" placeholder="Enter your Google Search Engine ID">
        <small class="form-hint">Get from https://programmablesearchengine.google.com/</small>
      </div>
    `;
    metadataDiv.style.display = 'block';
  } else {
    metadataDiv.style.display = 'none';
  }
}

async function addSearchKey() {
  const provider = document.getElementById('search-key-provider-select').value;
  const keyInput = document.getElementById('search-key-input');
  const key = keyInput.value.trim();

  if (!provider) {
    showToast('warning', 'Please select a search provider first');
    return;
  }
  if (!key) {
    showToast('warning', 'Please enter an API key');
    return;
  }

  const metadata = {};
  const metaSearchEngineId = document.getElementById('meta-search-engine-id');
  if (metaSearchEngineId) metadata.searchEngineId = metaSearchEngineId.value.trim();

  try {
    await API.addSearchKey(provider, key, metadata);
    keyInput.value = '';
    showToast('success', `Key added to ${provider}`);
    document.getElementById('search-key-view-provider').value = provider;
    refreshSearchKeys();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function refreshSearchKeys() {
  const provider = document.getElementById('search-key-view-provider').value;
  const tbody = document.getElementById('search-keys-body');

  if (!provider) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Select a provider</td></tr>';
    return;
  }

  try {
    const data = await API.getSearchKeys(provider);
    const keys = data.keys || [];

    if (keys.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No API keys for this provider</td></tr>';
      return;
    }

    tbody.innerHTML = keys.map(k => `
      <tr>
        <td class="mono">${k.key}</td>
        <td>${k.usage || 0}</td>
        <td>${k.rpm || 0}</td>
        <td>
          <span class="badge ${k.disabled ? 'badge-error' : 'badge-success'}">
            ${k.disabled ? 'Disabled' : 'Active'}
          </span>
        </td>
        <td>
          <button class="btn btn-sm btn-ghost" onclick="toggleSearchKey('${provider}', '${k.fullKey}', ${!k.disabled})">
            ${k.disabled ? 'Enable' : 'Disable'}
          </button>
          <button class="btn btn-sm btn-ghost text-error" onclick="removeSearchKey('${provider}', '${k.fullKey}')">
            🗑
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state text-error">Error: ${err.message}</td></tr>`;
  }
}

async function removeSearchKey(provider, key) {
  if (!confirm('Remove this API key?')) return;

  try {
    await API.removeSearchKey(provider, key);
    showToast('success', 'Key removed');
    refreshSearchKeys();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function toggleSearchKey(provider, key, disabled) {
  try {
    await API.toggleSearchKey(provider, key, disabled);
    showToast('success', `Key ${disabled ? 'disabled' : 'enabled'}`);
    refreshSearchKeys();
  } catch (err) {
    showToast('error', err.message);
  }
}