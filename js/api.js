// ============================================================================
// MyFolioAI - Cloud Synchronization & Google Sheets API Engine (js/api.js)
// Integrates: Token Handshake Auth, ID-Based Offline Merge (Ledger & Donations),
//             Blocking Sync Overlay with 15s Timeout & Work Offline Fail-Safe
// ============================================================================

let activeSyncAbortController = null;
let syncOfflineBtnTimer = null;

function showCloudSyncOverlay() {
  const overlay = document.getElementById('cloudSyncOverlay');
  const offlineBtn = document.getElementById('syncWorkOfflineBtn');
  if (!overlay) return;

  overlay.classList.remove('hidden');

  if (offlineBtn) {
    offlineBtn.classList.add('hidden', 'opacity-0');
    if (syncOfflineBtnTimer) clearTimeout(syncOfflineBtnTimer);
    // Reveal "Work Offline" escape hatch after 4 seconds on slow connections
    syncOfflineBtnTimer = setTimeout(() => {
      offlineBtn.classList.remove('hidden');
      requestAnimationFrame(() => offlineBtn.classList.remove('opacity-0'));
    }, 4000);
  }
}

function hideCloudSyncOverlay() {
  const overlay = document.getElementById('cloudSyncOverlay');
  const offlineBtn = document.getElementById('syncWorkOfflineBtn');
  if (syncOfflineBtnTimer) {
    clearTimeout(syncOfflineBtnTimer);
    syncOfflineBtnTimer = null;
  }
  if (offlineBtn) {
    offlineBtn.classList.add('hidden', 'opacity-0');
  }
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function cancelSyncAndWorkOffline() {
  if (activeSyncAbortController) {
    try {
      activeSyncAbortController.abort();
    } catch (e) {}
    activeSyncAbortController = null;
  }
  hideCloudSyncOverlay();
  updateSyncUI('Not synced');
  if (typeof recalculateAndRender === 'function') {
    recalculateAndRender();
  }
}

function updateSyncUI(status) {
  const syncDot = document.getElementById('syncDot');
  const syncStatus = document.getElementById('syncStatus');

  if (syncDot && syncStatus) {
    if (cloudScriptUrl) {
      if (status === 'Syncing') {
        syncStatus.innerText = 'Syncing';
        syncDot.innerHTML = `<i data-lucide="loader-circle" class="w-3.5 h-3.5 text-amber-500 animate-spin inline-block"></i>`;
      } else if (status === 'Not synced' || status === 'Sync error') {
        syncStatus.innerText = status;
        syncDot.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>`;
      } else {
        syncStatus.innerText = 'Synced';
        syncDot.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>`;
      }
    } else {
      syncStatus.innerText = 'Not synced';
      syncDot.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>`;
    }
  }

  // Toggle centered blocking sync overlay alongside top-bar status pill
  if (cloudScriptUrl && status === 'Syncing') {
    showCloudSyncOverlay();
  } else {
    hideCloudSyncOverlay();
  }

  if (typeof refreshIcons === 'function') refreshIcons();
  else if (window.lucide) lucide.createIcons();
}

function mergeLedgerById(incomingLedger) {
  const serverIds = new Set(
    incomingLedger
      .map(tx => String(tx.id || '').trim())
      .filter(Boolean)
  );

  // Preserve any local offline transactions whose IDs have not yet reached the sheet
  const unsyncedLocal = (Array.isArray(transactions) ? transactions : []).filter(tx => {
    const localId = String(tx.id || '').trim();
    return localId && !serverIds.has(localId);
  });

  // Push any unsynced local entries up in the background
  unsyncedLocal.forEach(tx => {
    sendToSheet({ action: 'addTransaction', transaction: tx });
  });

  return [...incomingLedger, ...unsyncedLocal];
}

function mergeDonationsById(incomingDonations) {
  const serverIds = new Set(
    incomingDonations
      .map(d => String(d.id || '').trim())
      .filter(Boolean)
  );

  // Preserve any local offline donations whose IDs have not yet reached the Donations sheet
  const unsyncedLocal = (Array.isArray(donations) ? donations : []).filter(d => {
    const localId = String(d.id || '').trim();
    return localId && !serverIds.has(localId);
  });

  unsyncedLocal.forEach(d => {
    sendToSheet({ action: 'addDonation', donation: d });
  });

  return [...incomingDonations, ...unsyncedLocal];
}

async function fetchFromGoogleSheet() {
  if (!cloudScriptUrl) return false;

  // Cancel any stale in-flight request before starting a fresh sync
  if (activeSyncAbortController) {
    try { activeSyncAbortController.abort(); } catch (e) {}
  }

  const controller = new AbortController();
  activeSyncAbortController = controller;
  const timeoutId = setTimeout(() => {
    try { controller.abort(); } catch (e) {}
  }, 15000); // 15-second hard timeout fail-safe

  updateSyncUI('Syncing');

  try {
    let url = `${cloudScriptUrl}?action=getAll`;
    if (apiToken) {
      url += `&token=${encodeURIComponent(apiToken)}`;
    }

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data && data.status === 'error') {
      updateSyncUI('Not synced');
      if (String(data.message || '').includes('Unauthorized')) {
        alert('Authentication Failed: The API Secret Token does not match your Google Apps Script configuration.');
      }
      return false;
    }

    // 1. Merge Transactions by ID (prevents wiping unsynced offline entries)
    let incomingLedger = [];
    if (data && Array.isArray(data.ledger)) {
      incomingLedger = data.ledger;
    } else if (Array.isArray(data)) {
      incomingLedger = data;
    }

    if (incomingLedger.length > 0 || transactions.length === 0) {
      transactions = mergeLedgerById(incomingLedger);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    }

    // 2. Process Isolated Purification Donations Sheet
    if (data && Array.isArray(data.donations)) {
      donations = mergeDonationsById(data.donations);
      localStorage.setItem(DONATIONS_STORAGE_KEY, JSON.stringify(donations));
    }

    // 3. Process Performance History
    if (data && Array.isArray(data.chartHistory)) {
      chartHistoryRecords = data.chartHistory;
      localStorage.setItem(CHART_HISTORY_KEY, JSON.stringify(chartHistoryRecords));
    }

    // 4. Process Custom / Manual Prices & Extract Latest Timestamp from Prices Sheet
    if (data && data.customPrices && typeof data.customPrices === 'object') {
      savedManualPrices = Object.assign({}, data.customPrices);
      marketPrices = Object.assign({}, savedManualPrices);
      localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));

      let latestPriceTime = '';
      Object.values(data.customPrices).forEach(pObj => {
        if (pObj && pObj.lastUpdated && String(pObj.lastUpdated) > latestPriceTime) {
          latestPriceTime = String(pObj.lastUpdated);
        }
      });

      if (latestPriceTime) {
        localStorage.setItem(LAST_PRICE_UPDATE_KEY, latestPriceTime);
      } else if (!localStorage.getItem(LAST_PRICE_UPDATE_KEY)) {
        localStorage.setItem(LAST_PRICE_UPDATE_KEY, 'Not refreshed yet');
      }

      if (typeof renderLastPriceTimestamp === 'function') {
        renderLastPriceTimestamp();
      }
    }

    // 5. Process Stock Master
    if (data && Array.isArray(data.stockMaster)) {
      stockMasterList = data.stockMaster;
      localStorage.setItem(STOCK_MASTER_KEY, JSON.stringify(stockMasterList));
      if (typeof updateStockAutocompleteOptions === 'function') {
        updateStockAutocompleteOptions();
      }
    }

    // 6. Process Milestone Goals
    if (data && data.goals && typeof data.goals === 'object') {
      milestoneGoals = Object.assign(milestoneGoals, data.goals);
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(milestoneGoals));
    }

    // 7. Process Settings & PIN Hash
    if (data && data.settings && typeof data.settings === 'object') {
      appSettings = Object.assign(appSettings, data.settings);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));

      const cloudBackupTime = data.settings.lastDatabaseBackup;
      if (cloudBackupTime && cloudBackupTime !== 'Not backed up yet') {
        localStorage.setItem('MYFOLIOAI_LAST_BACKUP_TIME', cloudBackupTime);
      } else if (!localStorage.getItem('MYFOLIOAI_LAST_BACKUP_TIME')) {
        localStorage.setItem('MYFOLIOAI_LAST_BACKUP_TIME', 'Not backed up yet');
      }

      if (typeof renderLastBackupTimestamp === 'function') {
        renderLastBackupTimestamp();
      }

      if (typeof checkGatekeeperState === 'function') {
        checkGatekeeperState();
      }
    }

    // 8. Process Cash Calibration Map
    if (data && data.cashCalibration && typeof data.cashCalibration === 'object') {
      if (data.cashCalibration.offsets) {
        cashCalibration.offsets = Object.assign(cashCalibration.offsets, data.cashCalibration.offsets);
      }
      if (data.cashCalibration.records) {
        cashCalibration.records = data.cashCalibration.records;
      }
      localStorage.setItem(CASH_CALIB_KEY, JSON.stringify(cashCalibration));
    }

    updateSyncUI(null);
    if (typeof recalculateAndRender === 'function') {
      recalculateAndRender();
    }
    return true;
  } catch (err) {
    console.error('Failed to sync with Google Sheet:', err);
    updateSyncUI('Not synced');
    if (typeof recalculateAndRender === 'function') {
      recalculateAndRender();
    }
    return false;
  } finally {
    clearTimeout(timeoutId);
    if (activeSyncAbortController === controller) {
      activeSyncAbortController = null;
    }
    // Guarantee the blocking sync overlay is always dismissed
    hideCloudSyncOverlay();
  }
}

async function sendToSheet(payload, returnJson = false) {
  if (!cloudScriptUrl) return null;

  try {
    const bodyObj = Object.assign({}, payload);
    if (apiToken) {
      bodyObj.token = apiToken;
    }

    // Use text/plain simple CORS request so GAS returns a readable JSON response
    const response = await fetch(cloudScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyObj)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (result && result.status === 'error') {
      console.error('Google Sheet write rejected:', result.message || result.error);
      updateSyncUI('Sync error');
      if (returnJson) return result;
      return null;
    }

    updateSyncUI(null);
    return returnJson ? result : true;
  } catch (err) {
    console.error('sendToSheet failed:', err);
    updateSyncUI('Sync error');
    if (returnJson) {
      return { status: 'error', message: err.toString() };
    }
    return null;
  }
}

function persistManualPrice(stock, ltp) {
  const sym = stock.toUpperCase().trim();
  const priceObj = { ltp: ltp };
  savedManualPrices[sym] = priceObj;
  marketPrices[sym] = priceObj;

  localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
  if (typeof recordPriceUpdateTimestamp === 'function') {
    recordPriceUpdateTimestamp();
  }

  sendToSheet({
    action: 'savePrices',
    prices: { [sym]: priceObj }
  });
}

function openSyncModal() {
  const urlInput = document.getElementById('scriptUrlInput');
  const tokenInput = document.getElementById('apiTokenInput');
  if (urlInput) urlInput.value = cloudScriptUrl || '';
  if (tokenInput) tokenInput.value = apiToken || '';
  document.getElementById('syncModal').classList.remove('hidden');
}

function closeSyncModal() {
  document.getElementById('syncModal').classList.add('hidden');
}

function saveAndFetchCloud() {
  const urlInput = document.getElementById('scriptUrlInput');
  const tokenInput = document.getElementById('apiTokenInput');

  const newUrl = urlInput ? urlInput.value.trim() : '';
  const newToken = tokenInput ? tokenInput.value.trim() : '';

  cloudScriptUrl = newUrl;
  apiToken = newToken;

  localStorage.setItem(SCRIPT_URL_KEY, cloudScriptUrl);
  localStorage.setItem(API_TOKEN_STORAGE_KEY, apiToken);

  closeSyncModal();
  updateSyncUI('Syncing');

  if (cloudScriptUrl) {
    fetchFromGoogleSheet();
  } else {
    updateSyncUI();
    if (typeof recalculateAndRender === 'function') {
      recalculateAndRender();
    }
  }
}

function disconnectCloudSync() {
  if (confirm('Disconnect from Google Sheets? (Your local cache remains intact)')) {
    cloudScriptUrl = '';
    apiToken = '';
    localStorage.removeItem(SCRIPT_URL_KEY);
    localStorage.removeItem(API_TOKEN_STORAGE_KEY);
    closeSyncModal();
    updateSyncUI();
  }
}
