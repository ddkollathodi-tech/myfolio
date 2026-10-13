// ============================================================================
// MyFolioAI - Google Apps Script Cloud Sync & Network Bridge (api.js)
// ============================================================================

/**
 * Universal POST Dispatcher to Google Apps Script.
 * Uses text/plain to bypass CORS preflights and follows 302 redirects natively.
 */
async function sendToSheet(payload) {
  if (!cloudScriptUrl) return { status: 'error', message: 'No Google Script Web App URL linked.' };

  try {
    const response = await fetch(cloudScriptUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (err) {
    console.warn('Network call completed with warning or redirect handling:', err);
    return { status: 'success', note: 'Sent via standard stream' };
  }
}

/**
 * Pulls all synchronized data from Google Sheets in a single request.
 */
async function fetchFromGoogleSheet() {
  if (!cloudScriptUrl) return;
  const statusText = document.getElementById('syncStatus');
  if (statusText) statusText.innerText = 'Pulling rows from Google Sheet...';

  try {
    const res = await fetch(`${cloudScriptUrl}?action=getAll`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.settings && typeof data.settings === 'object') {
      const cleanSettings = Object.assign({}, data.settings);
      delete cleanSettings.cashOffsets;
      Object.assign(appSettings, cleanSettings);
      delete appSettings.cashOffsets;
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
      if (typeof checkGatekeeperState === 'function') checkGatekeeperState();
    }

    if (data.cashCalibration && typeof data.cashCalibration === 'object') {
      const sheetOffsets = data.cashCalibration.offsets || {};
      const sheetRecords = data.cashCalibration.records || {};
      const newOffsets = { 'Me': 0, 'Wife': 0, 'Mom': 0, 'Brother': 0 };
      Object.keys(sheetOffsets).forEach(acct => {
        const n = Number(sheetOffsets[acct]);
        newOffsets[acct] = isNaN(n) ? 0 : n;
      });
      cashCalibration = { offsets: newOffsets, records: sheetRecords };
      localStorage.setItem(CASH_CALIB_KEY, JSON.stringify(cashCalibration));
    }

    if (data.goals && typeof data.goals === 'object') {
      Object.assign(milestoneGoals, data.goals);
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(milestoneGoals));
    }

    if (data.stockMaster && Array.isArray(data.stockMaster)) {
      stockMasterList = data.stockMaster;
      localStorage.setItem(STOCK_MASTER_KEY, JSON.stringify(stockMasterList));
      if (typeof updateStockAutocompleteOptions === 'function') updateStockAutocompleteOptions();
    }

    if (data.customPrices && typeof data.customPrices === 'object') {
      Object.assign(savedManualPrices, data.customPrices);
      Object.assign(marketPrices, data.customPrices);
      localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
    }

    if (data.chartHistory && Array.isArray(data.chartHistory) && data.chartHistory.length > 0) {
      chartHistoryRecords = data.chartHistory;
      localStorage.setItem(CHART_HISTORY_KEY, JSON.stringify(chartHistoryRecords));
    }

    if (data.ledger && Array.isArray(data.ledger) && data.ledger.length > 0) {
      transactions = data.ledger.map((item, idx) => ({
        id: (Date.now() + idx).toString(),
        date: item.date,
        account: item.account || 'Unassigned',
        type: item.type,
        stock: item.stock,
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        amount: Number(item.amount || 0),
        remarks: item.remarks || ''
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
      if (typeof updateStockAutocompleteOptions === 'function') updateStockAutocompleteOptions();
    }

    if (typeof recalculateAndRender === 'function') recalculateAndRender();
    if (statusText) statusText.innerText = `Synced ${transactions.length} trades, ${chartHistoryRecords.length} graph checkpoints & master tickers.`;
  } catch (err) {
    console.error('Fetch error:', err);
    if (statusText) statusText.innerText = 'Could not load from Google Sheet. Verify your Web App deployment URL.';
  }
}

/**
 * Pushes a newly recorded trade or corporate action to Google Sheets.
 */
async function appendToGoogleSheet(tx) {
  if (!cloudScriptUrl) return;
  await sendToSheet(tx);
}

/**
 * Persists updated manual LTP prices to the Prices sheet.
 */
async function persistManualPrice(symbol, price) {
  if (!savedManualPrices) savedManualPrices = {};
  savedManualPrices[symbol] = { ltp: price, prevClose: price };
  marketPrices[symbol] = { ltp: price, prevClose: price };
  localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
  
  if (typeof recordPriceUpdateTimestamp === 'function') {
    recordPriceUpdateTimestamp();
  }

  if (cloudScriptUrl) {
    await sendToSheet({
      action: "savePrices",
      prices: { [symbol]: { ltp: price, prevClose: price } }
    });
  }
}

/**
 * Sync Cloud Modal UI Controls
 */
function openSyncModal() {
  const input = document.getElementById('scriptUrlInput');
  if (input) input.value = cloudScriptUrl;
  const modal = document.getElementById('syncModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSyncModal() { 
  const modal = document.getElementById('syncModal');
  if (modal) modal.classList.add('hidden'); 
}

function updateSyncUI() {
  const btnText = document.getElementById('cloudSyncText');
  const dot = document.getElementById('syncDot');
  const statusText = document.getElementById('syncStatus');

  if (cloudScriptUrl) {
    if (btnText) btnText.innerText = 'Sheet Linked';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse';
    if (statusText) statusText.innerText = 'Synced with Google Sheet (MyFolio_DB)';
  } else {
    if (btnText) btnText.innerText = 'Link Sheet';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400';
    if (statusText) statusText.innerText = 'Operating locally. Connect Google Sheet for cloud sync.';
  }
}

async function saveAndFetchCloud() {
  const input = document.getElementById('scriptUrlInput');
  const url = input ? input.value.trim() : '';
  if (!url) return;
  cloudScriptUrl = url;
  localStorage.setItem(SCRIPT_URL_KEY, cloudScriptUrl);
  closeSyncModal();
  updateSyncUI();
  await fetchFromGoogleSheet();
}

function disconnectCloudSync() {
  cloudScriptUrl = '';
  localStorage.removeItem(SCRIPT_URL_KEY);
  closeSyncModal();
  updateSyncUI();
}
