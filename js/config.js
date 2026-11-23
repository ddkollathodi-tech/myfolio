// ============================================================================
// MyFolioAI - Configuration, Shared Constants & Utility Formatters (js/config.js)
// ============================================================================

// LocalStorage Keys
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
const SETTINGS_STORAGE_KEY = 'MYFOLIOAI_SETTINGS';
const LAST_PRICE_UPDATE_KEY = 'MYFOLIOAI_LAST_PRICE_UPDATE';
const LAST_BACKUP_TIME_KEY = 'MYFOLIOAI_LAST_BACKUP_TIME';
const CASH_CALIB_KEY = 'MYFOLIOAI_CASH_CALIBRATION';
const DONATIONS_STORAGE_KEY = 'MYFOLIOAI_DONATIONS';

// Core Account & Layout Constants
const CALIB_ACCOUNTS = ['Me', 'Wife', 'Mom', 'Brother'];
const PAGE_SIZE = 12;

// Compounding & Indian Capital Gains Tax Constants (Post-July 2024 Regime)
const ROC_TARGET_MONTHLY_RATE = 0.02; // 2% per month compound baseline
const TAX_BASIC_EXEMPTION_LIMIT = 400000; // ₹4,00,000 basic exemption shortfall cap
const TAX_LTCG_EXEMPTION_LIMIT = 125000; // ₹1,25,000 Sec 112A exemption limit
const TAX_STCG_RATE = 0.2080; // 20.80% Sec 111A
const TAX_LTCG_RATE = 0.1300; // 13.00% Sec 112A

// ---------------- SHARED RUNTIME STATE ----------------
let transactions = [];
let donations = [];
try {
  donations = JSON.parse(localStorage.getItem(DONATIONS_STORAGE_KEY)) || [];
} catch (e) {
  donations = [];
}

let chartHistoryRecords = [];
try {
  chartHistoryRecords = JSON.parse(localStorage.getItem(CHART_HISTORY_KEY)) || [];
} catch (e) {
  chartHistoryRecords = [];
}

let stockMasterList = [];
try {
  stockMasterList = JSON.parse(localStorage.getItem(STOCK_MASTER_KEY)) || [];
} catch (e) {
  stockMasterList = [];
}

let sectorsList = [];
try {
  sectorsList = JSON.parse(localStorage.getItem(SECTORS_LIST_KEY)) || [];
} catch (e) {
  sectorsList = [];
}

let milestoneGoals = {
  netWorth: 10000000,
  netInvested: 5000000,
  lifetimePnL: 2500000,
  currentFyPnL: 1000000,
  xirr: 25
};
try {
  const localGoals = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY));
  if (localGoals) Object.assign(milestoneGoals, localGoals);
} catch (e) {}

let appSettings = {
  pinHash: '',
  taxToggle_Me: 'false',
  taxToggle_Wife: 'true',
  taxToggle_Mom: 'true',
  taxToggle_Brother: 'false'
};
try {
  const localSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
  if (localSettings) Object.assign(appSettings, localSettings);
} catch (e) {}

// Strict Runtime Isolation of Cash Calibration State
let cashCalibration = {
  offsets: { 'Me': 0, 'Wife': 0, 'Mom': 0, 'Brother': 0 },
  records: {}
};
try {
  const localCalib = JSON.parse(localStorage.getItem(CASH_CALIB_KEY));
  if (localCalib && typeof localCalib === 'object') {
    if (localCalib.offsets && typeof localCalib.offsets === 'object') {
      Object.assign(cashCalibration.offsets, localCalib.offsets);
    }
    if (localCalib.records && typeof localCalib.records === 'object') {
      cashCalibration.records = localCalib.records;
    }
  }
} catch (e) {}

let taxPaidChallans = {};
try {
  taxPaidChallans = JSON.parse(localStorage.getItem(TAX_PAID_KEY)) || {};
} catch (e) {
  taxPaidChallans = {};
}

let savedManualPrices = {};
try {
  savedManualPrices = JSON.parse(localStorage.getItem(MANUAL_PRICES_KEY)) || {};
} catch (e) {
  savedManualPrices = {};
}

// Live Market Prices (falls back cleanly to WAP when unpriced)
let marketPrices = Object.assign({}, savedManualPrices);

// Active View & Filter State
let currentHoldingsAccountFilter = 'ALL';
let currentTaxAccountFilter = 'Me';
let currentPurificationAccountFilter = 'ALL';
let currentPurificationFyFilter = 'ALL';
let currentChartRange = 'TTM';
let currentChartView = 'trajectory'; // 'trajectory' | 'roc'

// Stealth Masking State (All blurred by default)
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

function getCalibOffset(acct) {
  const v = Number(cashCalibration.offsets && cashCalibration.offsets[acct]);
  return isNaN(v) ? 0 : v;
}

function formatINR(val, decimals = 2) {
  if (val === null || isNaN(val)) return '₹0.00';
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  const parts = absVal.toFixed(decimals).split('.');
  let integerPart = parts[0];
  const decimalPart = parts[1] ? '.' + parts[1] : '';

  let lastThree = integerPart.substring(integerPart.length - 3);
  let otherNumbers = integerPart.substring(0, integerPart.length - 3);
  if (otherNumbers !== '') lastThree = ',' + lastThree;
  const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
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

  if ((m === 4) || (m === 5) || (m === 6 && day <= 15)) return 'Q1';
  if ((m === 6 && day > 15) || (m === 7) || (m === 8) || (m === 9 && day <= 15)) return 'Q2';
  if ((m === 9 && day > 15) || (m === 10) || (m === 11) || (m === 12 && day <= 15)) return 'Q3';
  return 'Q4';
}

function formatToSheetDateStr(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}
