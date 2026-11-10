// ============================================================================
// MyFolioAI - Cloud Synchronization & Google Sheets API Engine (api.js)
// Integrates: Token Handshake Auth, Permanent UUID Backfill, Master-Source Sync & Modals
// ============================================================================

// Helper to generate secure UUID v4 for permanent transaction identity
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Ensure every transaction has an immutable transactionId, mirrored legacy id, timestamps, and status
function ensureTransactionIdentity(txList) {
  if (!Array.isArray(txList)) return [];
  let modified = false;
  const processed = txList.map(tx => {
    let tId = tx.transactionId || tx.id;
    if (!tId) {
      tId = generateUUID();
      modified = true;
    }
    return {
      transactionId: tId,
      id: tId, // Mirror as id for absolute backward compatibility with UI and storage tables
      date: tx.date || new Date().toISOString().split('T')[0],
      account: tx.account || 'Me',
      type: tx.type || 'BUY',
      stock: (tx.stock || '').toUpperCase().trim(),
      qty: Number(tx.qty || 0),
      price: Number(tx.price || 0),
      amount: Number(tx.amount || 0),
      remarks: tx.remarks || '',
      createdAt: tx.createdAt || new Date().toISOString(),
      updatedAt: tx.updatedAt || new Date().toISOString(),
      status: tx.status || 'active'
    };
  });
  return { processed, modified };
}

function updateSyncUI(status, isError) {
  const syncDot = document.getElementById('syncDot');
  const syncStatus = document.getElementById('syncStatus');
  const cloudSyncText = document.getElementById('cloudSyncText');

  if (!syncDot || !syncStatus) return;
  if (cloudSyncText) {
    cloudSyncText.innerText = cloudScriptUrl ? 'Sheet Linked' : 'Connect Sheet';
  }

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

  if (window.lucide) lucide.createIcons();
}

async function fetchFromGoogleSheet() {
  if (!cloudScriptUrl) return;

  updateSyncUI('Syncing', false);

  try {
    let url = `${cloudScriptUrl}?action=getAll`;
    if (apiToken) {
      url += `&token=${encodeURIComponent(apiToken)}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data && data.status === 'error' && String(data.message).includes('Unauthorized')) {
      updateSyncUI('Not synced', true);
      alert('Authentication Failed: The API Secret Token does not match your Google Apps Script configuration.');
      return;
    }

    // 1. Process & Backfill Ledger Transactions with Permanent IDs
    let rawIncoming = [];
    if (data && Array.isArray(data.ledger)) {
      rawIncoming = data.ledger;
    } else if (Array.isArray(data)) {
      rawIncoming = data;
    }

    const { processed: incomingLedger, modified: ledgerBackfilled } = ensureTransactionIdentity(rawIncoming);

    if (incomingLedger.length > 0) {
      // Google Sheet is the master source: incoming server ledger dictates active state directly
      transactions = incomingLedger;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
      
      if (ledgerBackfilled) {
        console.log('[Migration] Historical transactions backfilled with permanent transactionIds.');
      }
    } else if (transactions.length > 0 && incomingLedger.length === 0) {
      console.warn('Server ledger empty during sync; preserving local session cache.');
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

    // 6. Process Settings & PIN Hash
    if (data && data.settings && typeof data.settings === 'object') {
      delete data.settings.cashOffsets;
      appSettings = Object.assign(appSettings, data.settings);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));

      // CLEAN TIMESTAMP NORMALIZER FOR CROSS-DEVICE FORMAT CONSISTENCY
      let cloudBackupTime = data.settings.lastDatabaseBackup;
      if (cloudBackupTime && cloudBackupTime !== 'Not backed up yet') {
        cloudBackupTime = cloudBackupTime.replace(/\//g, '-');
        if (cloudBackupTime.includes('T') || cloudBackupTime.length > 20) {
          const parsedDate = new Date(cloudBackupTime);
          if (!isNaN(parsedDate.getTime())) {
            const dd = String(parsedDate.getDate()).padStart(2, '0');
            const mm = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const yy = String(parsedDate.getFullYear()).slice(-2);
            const hh = String(parsedDate.getHours()).padStart(2, '0');
            const min = String(parsedDate.getMinutes()).padStart(2, '0');
            cloudBackupTime = `${dd}-${mm}-${yy}, ${hh}:${min}`;
          }
        }
        localStorage.setItem('MYFOLIOAI_LAST_BACKUP_TIME', cloudBackupTime);
      } else {
        const existingLocalBackup = localStorage.getItem('MYFOLIOAI_LAST_BACKUP_TIME');
        if (!existingLocalBackup) {
          localStorage.setItem('MYFOLIOAI_LAST_BACKUP_TIME', 'Not backed up yet');
        }
      }
      
      if (typeof renderLastBackupTimestamp === 'function') {
        renderLastBackupTimestamp();
      }

      if (typeof checkGatekeeperState === 'function') {
        checkGatekeeperState();
      }
    }

    // 7. Process Cash Calibration Map
    if (data && data.cashCalibration && typeof data.cashCalibration === 'object') {
      if (data.cashCalibration.offsets) {
        cashCalibration.offsets = Object.assign(cashCalibration.offsets, data.cashCalibration.offsets);
      }
      if (data.cashCalibration.records) {
        cashCalibration.records = data.cashCalibration.records;
      }
      localStorage.setItem(CASH_CALIB_KEY, JSON.stringify(cashCalibration));
    }

    updateSyncUI(null, false);
    if (typeof recalculateAndRender === 'function') {
      recalculateAndRender();
    }

    if (typeof checkPendingMonthEndSnapshot === 'function') {
      checkPendingMonthEndSnapshot();
    }

  } catch (err) {
    console.error('Failed to sync with Google Sheet:', err);
    updateSyncUI('Not synced', true);
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

    // Ensure payload transaction has permanent identity fields attached
    if (payload.action === 'appendTx' && payload.tx) {
      const { processed } = ensureTransactionIdentity([payload.tx]);
      payload.tx = processed[0];
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
  // Guarantee transaction object has its permanent ID before sending
  const { processed } = ensureTransactionIdentity([txData]);
  await sendToSheet({
    action: 'appendTx',
    tx: processed[0]
  });
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
  updateSyncUI('Syncing', false);

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
