// ============================================================================
// MyFolioAI - Cloud Synchronization & Google Sheets API Engine (api.js)
// Integrates: Token Handshake Auth, Cross-Device Sync, Offline Cache & Modals
// ============================================================================

function updateSyncUI(status, isError) {
  const syncDot = document.getElementById('syncDot');
  const syncStatus = document.getElementById('syncStatus');
  const cloudSyncText = document.getElementById('cloudSyncText');

  if (!syncDot || !syncStatus || !cloudSyncText) return;

  if (cloudScriptUrl) {
    cloudSyncText.innerText = 'Sheet Linked';
    if (status) {
      syncStatus.innerText = status;
      syncDot.className = isError
        ? 'w-2 h-2 rounded-full bg-rose-500 animate-pulse'
        : 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    } else {
      syncStatus.innerText = 'Connected & synchronized.';
      syncDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    }
  } else {
    cloudSyncText.innerText = 'Connect Sheet';
    syncStatus.innerText = 'Running on local cache only.';
    syncDot.className = 'w-2 h-2 rounded-full bg-amber-500';
  }
}

async function fetchFromGoogleSheet() {
  if (!cloudScriptUrl) return;

  updateSyncUI('Syncing with Google Sheets...', false);

  try {
    let url = `${cloudScriptUrl}?action=getAll`;
    if (apiToken) {
      url += `&token=${encodeURIComponent(apiToken)}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data && data.status === 'error' && String(data.message).includes('Unauthorized')) {
      updateSyncUI('Auth Error: Invalid API Secret Token', true);
      alert('Authentication Failed: The API Secret Token does not match your Google Apps Script configuration.');
      return;
    }

    // 1. Process Ledger
    if (data && Array.isArray(data.ledger)) {
      transactions = data.ledger;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } else if (Array.isArray(data)) {
      transactions = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    }

    // 2. Process Performance History
    if (data && Array.isArray(data.chartHistory)) {
      chartHistoryRecords = data.chartHistory;
      localStorage.setItem(CHART_HISTORY_KEY, JSON.stringify(chartHistoryRecords));
    }

    // 3. Process Custom / Manual Prices
    if (data && data.customPrices && typeof data.customPrices === 'object') {
      savedManualPrices = Object.assign(savedManualPrices, data.customPrices);
      marketPrices = Object.assign(marketPrices, savedManualPrices);
      localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
    }

    // 4. Process Stock Master
    if (data && Array.isArray(data.stockMaster)) {
      stockMasterList = data.stockMaster;
      localStorage.setItem(STOCK_MASTER_KEY, JSON.stringify(stockMasterList));
      if (typeof updateStockAutocompleteOptions === 'function') {
        updateStockAutocompleteOptions();
      }
    }

    // 5. Process Milestone Goals
    if (data && data.goals && typeof data.goals === 'object') {
      milestoneGoals = Object.assign(milestoneGoals, data.goals);
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(milestoneGoals));
    }

    // 6. Process Settings & PIN Hash (Strictly filtered to avoid offset pollution)
    if (data && data.settings && typeof data.settings === 'object') {
      delete data.settings.cashOffsets;
      appSettings = Object.assign(appSettings, data.settings);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
      if (typeof checkGatekeeperState === 'function') {
        checkGatekeeperState();
      }
    }

    // 7. Process Cash Calibration Map Independently (POINT 6)
    if (data && data.cashCalibration && typeof data.cashCalibration === 'object') {
      if (data.cashCalibration.offsets) {
        cashCalibration.offsets = Object.assign(cashCalibration.offsets, data.cashCalibration.offsets);
      }
      if (data.cashCalibration.records) {
        cashCalibration.records = data.cashCalibration.records;
      }
      localStorage.setItem(CASH_CALIB_KEY, JSON.stringify(cashCalibration));
    }

    updateSyncUI('Synced with Google Sheet.', false);
    if (typeof recalculateAndRender === 'function') {
      recalculateAndRender();
    }

    if (typeof checkPendingMonthEndSnapshot === 'function') {
      checkPendingMonthEndSnapshot();
    }

  } catch (err) {
    console.error('Failed to sync with Google Sheet:', err);
    updateSyncUI('Sync failed (offline cache active).', true);
    if (typeof recalculateAndRender === 'function') {
      recalculateAndRender();
    }
  }
}

async function sendToSheet(payload) {
  if (!cloudScriptUrl) return;

  try {
    if (apiToken) {
      payload.token = apiToken;
    }

    await fetch(cloudScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Background sendToSheet failed:', err);
  }
}

async function appendToGoogleSheet(txData) {
  await sendToSheet(txData);
}

function persistManualPrice(stock, ltp) {
  const sym = stock.toUpperCase().trim();
  const priceObj = { ltp: ltp, prevClose: ltp };
  savedManualPrices[sym] = priceObj;
  marketPrices[sym] = priceObj;

  localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
  if (typeof recordPriceUpdateTimestamp === 'function') {
    recordPriceUpdateTimestamp();
  }

  sendToSheet({
    action: "savePrices",
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
  updateSyncUI('Connecting...', false);

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
