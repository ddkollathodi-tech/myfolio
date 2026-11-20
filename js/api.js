// ============================================================================
// MyFolioAI - Cloud Synchronization & Google Sheets API Engine (js/api.js)
// Integrates: Token Handshake Auth, ID-Based Offline Merge (Ledger & Donations),
//             Quotes Sheet Sync, Blocking Sync Overlay with Confirmation Flash,
//             15s/28s Timeout & Work Offline Fail-Safe, and Database Backup.
// ============================================================================

const QUOTES_STORAGE_KEY = 'MYFOLIOAI_QUOTES_LIST';

let activeSyncAbortController = null;
let syncOfflineBtnTimer = null;
let syncResultDismissTimer = null;
let activeBackupAbortController = null;
let backupOfflineBtnTimer = null;

function showCloudSyncOverlay() {
  const overlay = document.getElementById('cloudSyncOverlay');
  const offlineBtn = document.getElementById('syncWorkOfflineBtn');
  const animRow = document.getElementById('syncOverlayAnimRow');
  const resultRow = document.getElementById('syncOverlayResultRow');
  if (!overlay) return;

  if (syncResultDismissTimer) {
    clearTimeout(syncResultDismissTimer);
    syncResultDismissTimer = null;
  }

  if (animRow) animRow.classList.remove('hidden');
  if (resultRow) resultRow.classList.add('hidden');

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

function finishCloudSyncOverlay(isSuccess) {
  const overlay = document.getElementById('cloudSyncOverlay');
  const offlineBtn = document.getElementById('syncWorkOfflineBtn');
  const animRow = document.getElementById('syncOverlayAnimRow');
  const resultRow = document.getElementById('syncOverlayResultRow');
  const badgeEl = document.getElementById('syncOverlayResultBadge');
  const labelEl = document.getElementById('syncOverlayResultLabel');

  if (syncOfflineBtnTimer) {
    clearTimeout(syncOfflineBtnTimer);
    syncOfflineBtnTimer = null;
  }
  if (offlineBtn) {
    offlineBtn.classList.add('hidden', 'opacity-0');
  }

  if (!overlay || overlay.classList.contains('hidden')) return;

  if (animRow) animRow.classList.add('hidden');
  if (resultRow) resultRow.classList.remove('hidden');

  if (badgeEl && labelEl) {
    if (isSuccess) {
      badgeEl.className = 'h-11 w-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-2xs';
      badgeEl.innerHTML = `<i data-lucide="check" class="w-6 h-6 stroke-[2.75]"></i>`;
      labelEl.className = 'text-sm font-extrabold text-emerald-700 dark:text-emerald-400 tracking-tight';
      labelEl.innerText = 'Synced';
    } else {
      badgeEl.className = 'h-11 w-11 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-500/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shadow-2xs';
      badgeEl.innerHTML = `<i data-lucide="x" class="w-6 h-6 stroke-[2.75]"></i>`;
      labelEl.className = 'text-sm font-extrabold text-rose-600 dark:text-rose-400 tracking-tight';
      labelEl.innerText = 'Not Synced';
    }
    if (typeof refreshIcons === 'function') refreshIcons();
    else if (window.lucide) lucide.createIcons();
  }

  if (syncResultDismissTimer) clearTimeout(syncResultDismissTimer);
  syncResultDismissTimer = setTimeout(() => {
    syncResultDismissTimer = null;
    hideCloudSyncOverlay();
  }, 750);
}

function hideCloudSyncOverlay() {
  const overlay = document.getElementById('cloudSyncOverlay');
  const offlineBtn = document.getElementById('syncWorkOfflineBtn');
  if (syncOfflineBtnTimer) {
    clearTimeout(syncOfflineBtnTimer);
    syncOfflineBtnTimer = null;
  }
  if (syncResultDismissTimer) {
    clearTimeout(syncResultDismissTimer);
    syncResultDismissTimer = null;
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

// Database Backup Blocking Overlay Helpers
function showDatabaseBackupOverlay() {
  const overlay = document.getElementById('databaseBackupOverlay');
  const offlineBtn = document.getElementById('backupWorkOfflineBtn');
  if (!overlay) return;

  overlay.classList.remove('hidden');

  if (offlineBtn) {
    offlineBtn.classList.add('hidden', 'opacity-0');
    if (backupOfflineBtnTimer) clearTimeout(backupOfflineBtnTimer);
    // Reveal "Dismiss / Cancel" escape hatch after 4 seconds
    backupOfflineBtnTimer = setTimeout(() => {
      offlineBtn.classList.remove('hidden');
      requestAnimationFrame(() => offlineBtn.classList.remove('opacity-0'));
    }, 4000);
  }
}

function hideDatabaseBackupOverlay() {
  const overlay = document.getElementById('databaseBackupOverlay');
  const offlineBtn = document.getElementById('backupWorkOfflineBtn');
  if (backupOfflineBtnTimer) {
    clearTimeout(backupOfflineBtnTimer);
    backupOfflineBtnTimer = null;
  }
  if (offlineBtn) {
    offlineBtn.classList.add('hidden', 'opacity-0');
  }
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function cancelBackupAndDismiss() {
  if (activeBackupAbortController) {
    try {
      activeBackupAbortController.abort();
    } catch (e) {}
    activeBackupAbortController = null;
  }
  hideDatabaseBackupOverlay();
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

  // Toggle centered blocking sync overlay with brief completion indicator
  if (cloudScriptUrl && status === 'Syncing') {
    showCloudSyncOverlay();
  } else if (status === 'Synced') {
    finishCloudSyncOverlay(true);
  } else if (status === 'Not synced' || status === 'Sync error') {
    finishCloudSyncOverlay(false);
  } else if (!syncResultDismissTimer) {
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
  const timeoutId = setTimeout(() => controller.abort('Google Sheets sync timed out'), 28000);

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

    // 9. Process Quotes Sheet
    if (data && Array.isArray(data.quotes) && data.quotes.length > 0) {
      localStorage.setItem(QUOTES_STORAGE_KEY, JSON.stringify(data.quotes));
      if (typeof initHomeQuotesTicker === 'function') {
        initHomeQuotesTicker(data.quotes);
      }
    }

    updateSyncUI('Synced');
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

    updateSyncUI('Synced');
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

async function triggerManualDatabaseBackup() {
  closeSettingsDropdown();
  if (!cloudScriptUrl) {
    openBackupResultModal(
      false,
      'Google Sheet Not Linked',
      'Please connect your Google Apps Script Web App Deployment URL before running a database backup.'
    );
    return;
  }

  const iconEl = document.getElementById('backupStatusIcon');
  if (iconEl) {
    iconEl.innerHTML = `<i data-lucide="loader-circle" class="w-3.5 h-3.5 text-amber-500 animate-spin inline-block"></i>`;
    refreshIcons();
  }

  // Cancel any stale backup request
  if (activeBackupAbortController) {
    try { activeBackupAbortController.abort(); } catch (e) {}
  }

  const controller = new AbortController();
  activeBackupAbortController = controller;
  const timeoutId = setTimeout(() => {
    try { controller.abort(); } catch (e) {}
  }, 25000); // 25s timeout for drive file creation

  showDatabaseBackupOverlay();

  try {
    const json = await sendToSheet({ action: "triggerDatabaseBackup" }, true);
    if (json && json.status === 'success') {
      const backupTime = json.details && json.details.backupTime ? json.details.backupTime : null;
      recordBackupTimestamp(backupTime);

      if (iconEl) {
        iconEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>`;
      }
      openBackupResultModal(
        true,
        'Vault Backup Complete',
        'A timestamped copy of your database has been safely archived in your Google Drive vault folder.',
        json.details || null
      );
    } else {
      throw new Error((json && (json.message || json.error)) || 'Unknown error');
    }
  } catch (err) {
    if (iconEl) {
      iconEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 inline-block" title="Backup failed"></span>`;
    }
    openBackupResultModal(
      false,
      'Database Backup Failed',
      err.message || String(err)
    );
  } finally {
    clearTimeout(timeoutId);
    if (activeBackupAbortController === controller) {
      activeBackupAbortController = null;
    }
    hideDatabaseBackupOverlay();
  }
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
