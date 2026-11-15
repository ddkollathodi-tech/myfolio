// ============================================================================
// MyFolioAI - Cloud Synchronization & Google Sheets API Engine (api.js)
// ============================================================================

function updateSyncUI(status) {
  const syncDot = document.getElementById('syncDot');
  const syncStatus = document.getElementById('syncStatus');

  if (!syncDot || !syncStatus) return;

  if (cloudScriptUrl) {
    if (status) {
      syncStatus.innerText = status;
      syncDot.innerHTML = `<i data-lucide="loader-circle" class="w-3.5 h-3.5 text-amber-500 animate-spin inline-block"></i>`;
    } else {
      syncStatus.innerText = 'Synced';
      syncDot.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>`;
    }
  } else {
    syncStatus.innerText = 'Not synced';
    syncDot.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>`;
  }

  refreshIcons(syncDot);
}

async function fetchFromGoogleSheet() {
  if (!cloudScriptUrl) return false;

  updateSyncUI('Syncing');

  try {
    let url = `${cloudScriptUrl}?action=getAll`;
    if (apiToken) {
      url += `&token=${encodeURIComponent(apiToken)}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (!data || data.status === 'error') {
      const msg = (data && data.message) || 'Unknown sync error';
      updateSyncUI('Not synced');
      if (String(msg).includes('Unauthorized')) {
        alert('Authentication Failed: The API Secret Token does not match your Google Apps Script configuration.');
      }
      return false;
    }

    // 1. Merge Transactions by ID so local offline entries are never overwritten
    const incomingLedger = Array.isArray(data.ledger) ? data.ledger : [];
    if (incomingLedger.length > 0 || transactions.length === 0) {
      const serverIds = new Set(incomingLedger.map(t => String(t.id)));
      const localUnsynced = transactions.filter(t => t.id && !serverIds.has(String(t.id)));
      transactions = [...incomingLedger, ...localUnsynced];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
      bumpTxVersion();

      // Push any offline-queued entries up to the sheet
      localUnsynced.forEach(unsyncedTx => {
        sendToSheet(Object.assign({ action: 'addTransaction' }, unsyncedTx));
      });
    }

    // 2. Process Performance History
    if (Array.isArray(data.chartHistory)) {
      chartHistoryRecords = data.chartHistory;
      localStorage.setItem(CHART_HISTORY_KEY, JSON.stringify(chartHistoryRecords));
    }

    // 3. Process Custom / Manual Prices
    if (data.customPrices && typeof data.customPrices === 'object') {
      savedManualPrices = Object.assign({}, savedManualPrices, data.customPrices);
      marketPrices = Object.assign({}, marketPrices, savedManualPrices);
      localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));

      let latestPriceTime = '';
      Object.values(data.customPrices).forEach(pObj => {
        if (pObj && pObj.lastUpdated) {
          latestPriceTime = pObj.lastUpdated;
        }
      });

      if (latestPriceTime) {
        localStorage.setItem(LAST_PRICE_UPDATE_KEY, latestPriceTime);
      } else if (!localStorage.getItem(LAST_PRICE_UPDATE_KEY)) {
        localStorage.setItem(LAST_PRICE_UPDATE_KEY, 'Not refreshed yet');
      }
      renderLastPriceTimestamp();
    }

    // 4. Process Stock Master
    if (Array.isArray(data.stockMaster)) {
      stockMasterList = data.stockMaster;
      localStorage.setItem(STOCK_MASTER_KEY, JSON.stringify(stockMasterList));
      updateStockAutocompleteOptions();
    }

    // 5. Process Milestone Goals
    if (data.goals && typeof data.goals === 'object') {
      milestoneGoals = Object.assign(milestoneGoals, data.goals);
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(milestoneGoals));
    }

    // 6. Process Settings & PIN Hash
    if (data.settings && typeof data.settings === 'object') {
      appSettings = Object.assign(appSettings, data.settings);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));

      const cloudBackupTime = data.settings.lastDatabaseBackup;
      if (cloudBackupTime && cloudBackupTime !== 'Not backed up yet') {
        localStorage.setItem(LAST_BACKUP_TIME_KEY, cloudBackupTime);
      } else if (!localStorage.getItem(LAST_BACKUP_TIME_KEY)) {
        localStorage.setItem(LAST_BACKUP_TIME_KEY, 'Not backed up yet');
      }
      renderLastBackupTimestamp();

      // Re-evaluate gatekeeper only if currently unlocked or if not mid-PIN entry
      if (sessionStorage.getItem('MYFOLIOAI_UNLOCKED') === 'true' || enteredPin.length === 0) {
        checkGatekeeperState();
      }
    }

    // 7. Process Cash Calibration Map
    if (data.cashCalibration && typeof data.cashCalibration === 'object') {
      if (data.cashCalibration.offsets) {
        Object.assign(cashCalibration.offsets, data.cashCalibration.offsets);
      }
      if (data.cashCalibration.records) {
        cashCalibration.records = data.cashCalibration.records;
      }
      localStorage.setItem(CASH_CALIB_KEY, JSON.stringify(cashCalibration));
    }

    updateSyncUI(null);
    recalculateAndRender();
    return true;

  } catch (err) {
    console.error('Failed to sync with Google Sheet:', err);
    updateSyncUI('Not synced');
    recalculateAndRender();
    return false;
  }
}

async function sendToSheet(payload) {
  if (!cloudScriptUrl) return { status: 'offline' };

  try {
    const bodyObj = Object.assign({}, payload);
    if (apiToken) {
      bodyObj.token = apiToken;
    }

    // Simple CORS POST using text/plain avoids preflight and lets GAS return readable JSON
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
      console.error('Google Sheet API error:', result.message);
      updateSyncUI('Sync error');
    } else {
      updateSyncUI(null);
    }
    return result;
  } catch (err) {
    console.error('Background sendToSheet failed:', err);
    updateSyncUI('Not synced');
    return { status: 'error', message: err.toString() };
  }
}

function persistManualPrice(stock, ltp) {
  const sym = stock.toUpperCase().trim();
  const priceObj = { ltp: ltp };
  savedManualPrices[sym] = priceObj;
  marketPrices[sym] = priceObj;

  localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
  recordPriceUpdateTimestamp();

  sendToSheet({
    action: "savePrices",
    prices: { [sym]: priceObj }
  });
}

function openSyncModal() {
  closeSettingsDropdown();
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

  cloudScriptUrl = urlInput ? urlInput.value.trim() : '';
  apiToken = tokenInput ? tokenInput.value.trim() : '';

  localStorage.setItem(SCRIPT_URL_KEY, cloudScriptUrl);
  localStorage.setItem(API_TOKEN_STORAGE_KEY, apiToken);

  closeSyncModal();
  updateSyncUI('Syncing');

  if (cloudScriptUrl) {
    fetchFromGoogleSheet();
  } else {
    updateSyncUI();
    recalculateAndRender();
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
