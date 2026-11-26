// ============================================================================
// MyFolioAI - Configuration, Shared Constants & Utility Formatters (js/config.js)
// ============================================================================

const THEME_KEY = 'MYFOLIOAI_THEME';
const STORAGE_KEY = 'MYFOLIOAI_TRANSACTIONS';
const SCRIPT_URL_KEY = 'MYFOLIOAI_SCRIPT_URL';
const API_TOKEN_STORAGE_KEY = 'MYFOLIOAI_API_TOKEN';
const MANUAL_PRICES_KEY = 'MYFOLIOAI_MANUAL_PRICES';
const CHART_HISTORY_KEY = 'MYFOLIOAI_CHART_HISTORY';
const STOCK_MASTER_KEY = 'MYFOLIOAI_STOCK_MASTER';
const SECTORS_LIST_KEY = 'MYFOLIOAI_SECTORS_LIST';
const GOALS_STORAGE_KEY = 'MYFOLIOAI_GOALS';
const TAX_PAID_KEY = 'MYFOLIOAI_TAX_PAID';
const TAX_CHALLANS_KEY = 'MYFOLIOAI_TAX_CHALLANS';
const SETTINGS_STORAGE_KEY = 'MYFOLIOAI_SETTINGS';
const LAST_PRICE_UPDATE_KEY = 'MYFOLIOAI_LAST_PRICE_UPDATE';
const LAST_BACKUP_TIME_KEY = 'MYFOLIOAI_LAST_BACKUP_TIME';
const CASH_CALIB_KEY = 'MYFOLIOAI_CASH_CALIBRATION';
const DONATIONS_STORAGE_KEY = 'MYFOLIOAI_DONATIONS';

const CALIB_ACCOUNTS = ['Me', 'Wife', 'Mom', 'Brother'];
const PAGE_SIZE = 12;

// Post-July 2024 Indian Capital Gains & Compounding Constants
const ROC_TARGET_MONTHLY_RATE = 0.02;
const TAX_BASIC_EXEMPTION_LIMIT = 400000;
const TAX_LTCG_EXEMPTION_LIMIT = 125000;
const TAX_STCG_RATE = 0.2080;
const TAX_LTCG_RATE = 0.1300;

function loadJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------------- SHARED RUNTIME STATE ----------------
let transactions = [];
let donations = loadJsonStorage(DONATIONS_STORAGE_KEY, []);
let chartHistoryRecords = loadJsonStorage(CHART_HISTORY_KEY, []);
let stockMasterList = loadJsonStorage(STOCK_MASTER_KEY, []);
let sectorsList = loadJsonStorage(SECTORS_LIST_KEY, []);

let milestoneGoals = Object.assign({
  netWorth: 10000000,
  netInvested: 5000000,
  lifetimePnL: 2500000,
  currentFyPnL: 1000000,
  xirr: 25
}, loadJsonStorage(GOALS_STORAGE_KEY, {}));

let appSettings = Object.assign({
  pinHash: '',
  taxToggle_Me: 'false',
  taxToggle_Wife: 'true',
  taxToggle_Mom: 'true',
  taxToggle_Brother: 'false'
}, loadJsonStorage(SETTINGS_STORAGE_KEY, {}));

let cashCalibration = {
  offsets: { 'Me': 0, 'Wife': 0, 'Mom': 0, 'Brother': 0 },
  records: {}
};
const localCalib = loadJsonStorage(CASH_CALIB_KEY, null);
if (localCalib && typeof localCalib === 'object') {
  if (localCalib.offsets && typeof localCalib.offsets === 'object') {
    Object.assign(cashCalibration.offsets, localCalib.offsets);
  }
  if (localCalib.records && typeof localCalib.records === 'object') {
    cashCalibration.records = localCalib.records;
  }
}

let taxPaidChallans = loadJsonStorage(TAX_PAID_KEY, {});
let savedManualPrices = loadJsonStorage(MANUAL_PRICES_KEY, {});
let marketPrices = Object.assign({}, savedManualPrices);

// Active View & Filter State
let currentHoldingsAccountFilter = 'ALL';
let currentTaxAccountFilter = 'Me';
let currentPurificationAccountFilter = 'ALL';
let currentPurificationFyFilter = 'ALL';
let currentChartView = 'trajectory';

// Stealth Masking State
let tabMaskStates = {
  chart: true,
  holdings: true,
  closedTrades: true,
  fyBreakdown: true,
  ledger: true,
  bankLedger: true,
  taxPnl: true,
  purification: true
};

// Cloud Sync & Handshake State
let cloudScriptUrl = localStorage.getItem(SCRIPT_URL_KEY) || '';
let apiToken = localStorage.getItem(API_TOKEN_STORAGE_KEY) || '';

// Table Pagination & Sorting Pointers
let closedTradesCurrentPage = 1;
let ledgerCurrentPage = 1;
let bankLedgerCurrentPage = 1;
let purificationLotsCurrentPage = 1;
let purificationLogCurrentPage = 1;
let ledgerSearchTerm = '';
let holdingsSort = { key: 'currentVal', dir: 'desc' };
let closedSort = { key: 'netPnL', dir: 'desc' };

// ---------------- UTILITY & FORMATTING FUNCTIONS ----------------

function todayLocalISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateVal) {
  if (!dateVal) return new Date(NaN);
  if (dateVal instanceof Date) return new Date(dateVal.getTime());
  const str = String(dateVal).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }
  return new Date(str);
}

function formatShortTimestamp(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}-${month}, ${hours}:${mins}`;
}

function getCalibOffset(acct) {
  const v = Number(cashCalibration.offsets && cashCalibration.offsets[acct]);
  return isNaN(v) ? 0 : v;
}

function formatINR(val, decimals = 2) {
  if (val === null || isNaN(val)) return '₹0.00';
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  const parts = absVal.toFixed(decimals).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1] ? '.' + parts[1] : '';

  const lastThree = integerPart.substring(integerPart.length - 3);
  const otherNumbers = integerPart.substring(0, integerPart.length - 3);
  const formatted = (otherNumbers !== '' ? otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + lastThree;
  return (isNegative ? '-₹' : '₹') + formatted + decimalPart;
}

function formatCompactIndian(val) {
  if (val === null || isNaN(val)) return '₹0';
  const absVal = Math.abs(val);
  const isNeg = val < 0;
  let formatted = '';

  if (absVal >= 10000000) {
    formatted = (absVal / 10000000).toFixed(2) + ' Cr';
  } else if (absVal >= 100000) {
    formatted = (absVal / 100000).toFixed(2) + ' L';
  } else {
    formatted = formatINR(absVal, 0).replace('₹', '');
  }

  return (isNeg ? '-₹' : '₹') + formatted;
}

function getFinancialYear(dateStr) {
  const d = parseLocalDate(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return month >= 4 ? `FY ${year}-${String(year + 1).slice(-2)}` : `FY ${year - 1}-${String(year).slice(-2)}`;
}

function getTaxQuarter(dateStr) {
  const d = parseLocalDate(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();

  if (m === 4 || m === 5 || (m === 6 && day <= 15)) return 'Q1';
  if ((m === 6 && day > 15) || m === 7 || m === 8 || (m === 9 && day <= 15)) return 'Q2';
  if ((m === 9 && day > 15) || m === 10 || m === 11 || (m === 12 && day <= 15)) return 'Q3';
  return 'Q4';
}

function formatToSheetDateStr(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}
