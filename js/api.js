// ============================================================================

// MyFolioAI - Cloud Synchronization & Google Sheets API Engine (js/api.js)

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

refreshIcons();

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

try { activeSyncAbortController.abort(); } catch (e) {}

activeSyncAbortController = null;

}

hideCloudSyncOverlay();

updateSyncUI('Not synced');

recalculateAndRender();

}



function showDatabaseBackupOverlay() {

const overlay = document.getElementById('databaseBackupOverlay');

const offlineBtn = document.getElementById('backupWorkOfflineBtn');

if (!overlay) return;



overlay.classList.remove('hidden');



if (offlineBtn) {

offlineBtn.classList.add('hidden', 'opacity-0');

if (backupOfflineBtnTimer) clearTimeout(backupOfflineBtnTimer);

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

try { activeBackupAbortController.abort(); } catch (e) {}

activeBackupAbortController = null;

}

hideDatabaseBackupOverlay();

}



let currentSyncState = 'Not synced';



function updateSyncUI(status) {

if (status) {

currentSyncState = status;

} else if (!cloudScriptUrl) {

currentSyncState = 'Not synced';

}



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



if (cloudScriptUrl && status === 'Syncing') {

showCloudSyncOverlay();

} else if (status === 'Synced') {

finishCloudSyncOverlay(true);

} else if (status === 'Not synced' || status === 'Sync error') {

finishCloudSyncOverlay(false);

} else if (!syncResultDismissTimer) {

hideCloudSyncOverlay();

}



refreshIcons();

}



function mergeRecordsById(incomingList, localList, actionName, payloadKey) {

const incoming = Array.isArray(incomingList) ? incomingList : [];

const serverIds = new Set(

incoming.map(item => String(item && item.id || '').trim()).filter(Boolean)

);



const unsyncedLocal = (Array.isArray(localList) ? localList : []).filter(item => {

const localId = String(item && item.id || '').trim();

return localId && !serverIds.has(localId);

});



unsyncedLocal.forEach(entry => {

sendToSheet({ action: actionName, [payloadKey]: entry });

});



return [...incoming, ...unsyncedLocal];

}



function mergeLedgerById(incomingLedger) {

return mergeRecordsById(incomingLedger, transactions, 'addTransaction', 'transaction');

}



function mergeDonationsById(incomingDonations) {

return mergeRecordsById(incomingDonations, donations, 'addDonation', 'donation');

}



async function fetchFromGoogleSheet() {

if (!cloudScriptUrl) return false;



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



let incomingLedger = [];

if (data && Array.isArray(data.ledger)) {

incomingLedger = data.ledger;

} else if (Array.isArray(data)) {

incomingLedger = data;

}



if (incomingLedger.length > 0 || transactions.length === 0) {

transactions = mergeLedgerById(incomingLedger);

saveJsonStorage(STORAGE_KEY, transactions);

}



if (data && Array.isArray(data.donations)) {

donations = mergeDonationsById(data.donations);

saveJsonStorage(DONATIONS_STORAGE_KEY, donations);

}



if (data && Array.isArray(data.chartHistory)) {

chartHistoryRecords = data.chartHistory;

saveJsonStorage(CHART_HISTORY_KEY, chartHistoryRecords);

}



if (data && data.customPrices && typeof data.customPrices === 'object') {

savedManualPrices = Object.assign({}, data.customPrices);

marketPrices = Object.assign({}, savedManualPrices);

saveJsonStorage(MANUAL_PRICES_KEY, savedManualPrices);



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



renderLastPriceTimestamp();

}



if (data && Array.isArray(data.stockMaster)) {

stockMasterList = data.stockMaster;

saveJsonStorage(STOCK_MASTER_KEY, stockMasterList);

updateStockAutocompleteOptions();

}



if (data && Array.isArray(data.sectors)) {

sectorsList = data.sectors;

saveJsonStorage(SECTORS_LIST_KEY, sectorsList);

updateSectorAutocompleteOptions();

}



if (data && data.goals && typeof data.goals === 'object') {

milestoneGoals = Object.assign(milestoneGoals, data.goals);

saveJsonStorage(GOALS_STORAGE_KEY, milestoneGoals);

}



if (data && data.settings && typeof data.settings === 'object') {

appSettings = Object.assign(appSettings, data.settings);

saveJsonStorage(SETTINGS_STORAGE_KEY, appSettings);



const cloudBackupTime = data.settings.lastDatabaseBackup;

if (cloudBackupTime && cloudBackupTime !== 'Not backed up yet') {

localStorage.setItem(LAST_BACKUP_TIME_KEY, cloudBackupTime);

} else if (!localStorage.getItem(LAST_BACKUP_TIME_KEY)) {

localStorage.setItem(LAST_BACKUP_TIME_KEY, 'Not backed up yet');

}



renderLastBackupTimestamp();

checkGatekeeperState();

}



if (data && data.cashCalibration && typeof data.cashCalibration === 'object') {

if (data.cashCalibration.offsets) {

cashCalibration.offsets = Object.assign(cashCalibration.offsets, data.cashCalibration.offsets);

}

if (data.cashCalibration.records) {

cashCalibration.records = data.cashCalibration.records;

}

saveJsonStorage(CASH_CALIB_KEY, cashCalibration);

}



if (data && Array.isArray(data.quotes) && data.quotes.length > 0) {

saveJsonStorage(QUOTES_STORAGE_KEY, data.quotes);

initHomeQuotesTicker(data.quotes);

}



updateSyncUI('Synced');

recalculateAndRender(true);

return true;

} catch (err) {

console.error('Failed to sync with Google Sheet:', err);

updateSyncUI('Not synced');

recalculateAndRender(true);

return false;

} finally {

clearTimeout(timeoutId);

if (activeSyncAbortController === controller) {

activeSyncAbortController = null;

}

}

}



async function sendToSheet(payload, returnJson = false, signal = null) {

if (!cloudScriptUrl) return null;



try {

const bodyObj = Object.assign({}, payload);

if (apiToken) {

bodyObj.token = apiToken;

}



const fetchOptions = {

method: 'POST',

headers: { 'Content-Type': 'text/plain;charset=utf-8' },

body: JSON.stringify(bodyObj)

};

if (signal) {

fetchOptions.signal = signal;

}



const response = await fetch(cloudScriptUrl, fetchOptions);

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



saveJsonStorage(MANUAL_PRICES_KEY, savedManualPrices);

recordPriceUpdateTimestamp();



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



if (activeBackupAbortController) {

try { activeBackupAbortController.abort(); } catch (e) {}

}



const controller = new AbortController();

activeBackupAbortController = controller;

const timeoutId = setTimeout(() => {

try { controller.abort(); } catch (e) {}

}, 25000);



showDatabaseBackupOverlay();



try {

const json = await sendToSheet({ action: 'triggerDatabaseBackup' }, true, controller.signal);

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
