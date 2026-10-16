// ============================================================================
// MyFolioAI - Configuration, Shared State & Utility Formatters (config.js)
// ============================================================================

// LocalStorage & SessionStorage Keys
const THEME_KEY = 'MYFOLIOAI_THEME';
const STORAGE_KEY = 'MYFOLIOAI_TRANSACTIONS';
const SCRIPT_URL_KEY = 'MYFOLIOAI_SCRIPT_URL';
const API_TOKEN_STORAGE_KEY = 'MYFOLIOAI_API_TOKEN'; // Secret Handshake Token
const MANUAL_PRICES_KEY = 'MYFOLIOAI_MANUAL_PRICES';
const CHART_HISTORY_KEY = 'MYFOLIOAI_CHART_HISTORY';
const STOCK_MASTER_KEY = 'MYFOLIOAI_STOCK_MASTER';
const GOALS_STORAGE_KEY = 'MYFOLIOAI_GOALS';
const TAX_PAID_KEY = 'MYFOLIOAI_TAX_PAID';
const SETTINGS_STORAGE_KEY = 'MYFOLIOAI_SETTINGS';
const LAST_PRICE_UPDATE_KEY = 'MYFOLIOAI_LAST_PRICE_UPDATE';
const KPI_MASK_STATES_KEY = 'MYFOLIOAI_KPI_MASK_STATES';
const TAB_MASK_STATES_KEY = 'MYFOLIOAI_TAB_MASK_STATES'; // Stealth Tab Masks
const CASH_CALIB_KEY = 'MYFOLIOAI_CASH_CALIBRATION';

// Core Account Definitions
const CALIB_ACCOUNTS = ['Me', 'Wife', 'Mom', 'Brother'];
const PAGE_SIZE = 12;

// ---------------- SHARED RUNTIME STATE ----------------
let transactions = [];
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
  if (localSettings) {
    Object.assign(appSettings, localSettings);
    delete appSettings.cashOffsets;
  }
} catch (e) {}

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

let marketPrices = Object.assign({
  'RELIANCE': { ltp: 2980.50, prevClose: 2950.00 },
  'TCS': { ltp: 4210.00, prevClose: 4185.00 },
  'HDFCBANK': { ltp: 1680.25, prevClose: 1675.00 },
  'INFY': { ltp: 1895.00, prevClose: 1910.00 }
}, savedManualPrices);

// Active View & Filter State
let currentHoldingsAccountFilter = 'ALL';
let currentTaxAccountFilter = 'Me';
let currentChartRange = 'TTM';
let currentChartView = 'trajectory'; // 'trajectory' | 'roc'
const ROC_TARGET_MONTHLY_RATE = 0.02; // 2% per month compound baseline

// Stealth Masking State (All blurred by default)
let tabMaskStates = {
  chart: true,        // Chart Y-axis ticks & tooltip numbers
  holdings: true,     // Holdings table (qty, wap, invested, current, p&l) + cash badge
  closedTrades: true, // Closed trades quantities, proceeds & gains
  fyBreakdown: true,  // FY P&L cards & summary table
  ledger: true,       // Tradebook & Ledger numeric columns
  bankLedger: true,   // Bank Ledger numeric columns
  taxPnl: true        // Tax Cockpit gains & advance tax numbers
};

// Cloud Sync & Handshake State
let cloudScriptUrl = localStorage.getItem(SCRIPT_URL_KEY) || '';
let apiToken = localStorage.getItem(API_TOKEN_STORAGE_KEY) || '';

// Table Pagination & Sorting Pointers
let closedTradesCurrentPage = 1;
let ledgerCurrentPage = 1;
let bankLedgerCurrentPage = 1;
let ledgerSearchTerm = '';
let holdingsSort = { key: 'currentVal', dir: 'desc' };
let closedSort = { key: 'netPnL', dir: 'desc' };

// ---------------- UTILITY & FORMATTING FUNCTIONS ----------------

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
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return month >= 4 ? `FY ${year}-${String(year + 1).slice(-2)}` : `FY ${year - 1}-${String(year).slice(-2)}`;
}

function getTaxQuarter(dateStr) {
  const d = new Date(dateStr);
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
