// ============================================================================
// MyFolioAI - UI Controller, Renderers, Chart & Event Handlers (js/ui.js)
// ============================================================================

let multiChartInstance = null;
let currentEditingGoalKey = null;
let currentPendingMonthEndDateStr = null;
let activeTabKey = 'holdings';
let pendingPinActionCallback = null;
let headerTickerInterval = null;
let headerTickerStep = 0;

// Memoization & Dirty-Tab Tracking
let txVersion = 0;
let cachedEngineVersion = -1;
let cachedEngineResult = null;
let dirtyTabs = {
  holdings: true,
  closedTrades: true,
  fyBreakdown: true,
  transactions: true,
  bankLedger: true,
  taxPnl: true,
  purification: true
};

let iconRefreshQueued = false;

/* ---------------- CORE HELPERS: ESCAPING & MEMOIZATION ---------------- */
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bumpTxVersion() {
  txVersion++;
  Object.keys(dirtyTabs).forEach(k => { dirtyTabs[k] = true; });
}

function getCachedEngineData() {
  if (cachedEngineResult && cachedEngineVersion === txVersion) {
    return cachedEngineResult;
  }
  cachedEngineResult = computeEngine();
  cachedEngineVersion = txVersion;
  return cachedEngineResult;
}

function refreshIcons() {
  if (iconRefreshQueued) return;
  iconRefreshQueued = true;
  requestAnimationFrame(() => {
    iconRefreshQueued = false;
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  });
}

/* ---------------- ROTATING HEADER INFO TICKER ---------------- */
function initHeaderInfoTicker() {
  if (headerTickerInterval) clearInterval(headerTickerInterval);
  updateHeaderTickerDisplay();
  headerTickerInterval = setInterval(() => {
    headerTickerStep = (headerTickerStep + 1) % 3;
    updateHeaderTickerDisplay();
  }, 4000);
}

function updateHeaderTickerDisplay() {
  const container = document.getElementById('tickerActiveItem');
  if (!container) return;

  const syncStatusEl = document.getElementById('syncStatus');
  const rawSyncText = syncStatusEl ? syncStatusEl.innerText.trim() : '';

  let mappedSyncText = 'Sheet Synced';
  let dotColor = 'bg-emerald-500 dark:bg-emerald-400';

  if (rawSyncText === 'Syncing' || rawSyncText === 'Sheet Syncing') {
    mappedSyncText = 'Sheet Syncing';
    dotColor = 'bg-amber-500 animate-pulse';
  } else if (rawSyncText === 'Not synced' || rawSyncText === 'Sync error' || rawSyncText === 'Sheet Not Synced' || !cloudScriptUrl) {
    mappedSyncText = 'Sheet Not Synced';
    dotColor = 'bg-rose-500';
  } else {
    mappedSyncText = 'Sheet Synced';
    dotColor = 'bg-emerald-500 dark:bg-emerald-400';
  }

  const priceTime = localStorage.getItem(LAST_PRICE_UPDATE_KEY) || 'Not refreshed yet';
  const backupTime = localStorage.getItem('MYFOLIOAI_LAST_BACKUP_TIME') || 'Not backed up yet';

  let html = '';
  if (headerTickerStep === 0) {
    html = `
      <span id="syncDot" class="inline-flex items-center shrink-0"><span class="w-2 h-2 rounded-full ${dotColor} inline-block"></span></span>
      <span id="syncStatus" class="font-semibold text-slate-700 dark:text-slate-200 animate-ticker">${esc(mappedSyncText)}</span>
    `;
  } else if (headerTickerStep === 1) {
    html = `
      <span id="syncDot" class="hidden"></span>
      <span id="syncStatus" class="hidden">${esc(mappedSyncText)}</span>
      <span class="flex items-center space-x-1.5 text-slate-600 dark:text-slate-300 animate-ticker">
        <i data-lucide="tag" class="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0"></i>
        <span>Last Prices : <b class="text-slate-800 dark:text-slate-100 font-semibold tabular-nums">${esc(priceTime)}</b></span>
      </span>
    `;
  } else {
    html = `
      <span id="syncDot" class="hidden"></span>
      <span id="syncStatus" class="hidden">${esc(mappedSyncText)}</span>
      <span class="flex items-center space-x-1.5 text-slate-600 dark:text-slate-300 animate-ticker">
        <i data-lucide="database-backup" class="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"></i>
        <span>Last Data Backup : <b class="text-slate-800 dark:text-slate-100 font-semibold tabular-nums">${esc(backupTime)}</b></span>
      </span>
    `;
  }

  container.innerHTML = html;
  refreshIcons();
}

/* ---------------- HOME SCREEN ROTATING QUOTES TICKER ---------------- */
const DEFAULT_HOME_QUOTES = [
  { quote: "Rule No. 1: Never lose money. Rule No. 2: Never forget rule No. 1.", author: "Warren Buffett" },
  { quote: "Compound interest is the eighth wonder of the world. He who understands it, earns it; he who doesn't, pays it.", author: "Albert Einstein" },
  { quote: "The big money is not in the buying and selling, but in the waiting.", author: "Charlie Munger" },
  { quote: "Price is what you pay. Value is what you get.", author: "Warren Buffett" }
];

let homeQuotesList = [...DEFAULT_HOME_QUOTES];
let homeQuoteIndex = 0;
let homeQuoteInterval = null;
let homeQuoteFadeTimeout = null;

function initHomeQuotesTicker(incomingQuotes) {
  if (Array.isArray(incomingQuotes) && incomingQuotes.length > 0) {
    homeQuotesList = incomingQuotes.filter(q => q && q.quote);
  } else {
    try {
      const storageKey = typeof QUOTES_STORAGE_KEY !== 'undefined' ? QUOTES_STORAGE_KEY : 'MYFOLIOAI_QUOTES_LIST';
      const cached = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(cached) && cached.length > 0) {
        homeQuotesList = cached.filter(q => q && q.quote);
      }
    } catch (e) {}
  }

  if (homeQuotesList.length === 0) {
    homeQuotesList = [...DEFAULT_HOME_QUOTES];
  }

  if (homeQuoteIndex >= homeQuotesList.length) {
    homeQuoteIndex = 0;
  }

  renderCurrentHomeQuote(false);

  if (homeQuoteInterval) clearInterval(homeQuoteInterval);
  if (homeQuotesList.length > 1) {
    homeQuoteInterval = setInterval(() => {
      homeQuoteIndex = (homeQuoteIndex + 1) % homeQuotesList.length;
      renderCurrentHomeQuote(true);
    }, 18000);
  }
}

function renderCurrentHomeQuote(animate = true) {
  const quoteEl = document.getElementById('homeQuoteText');
  const authorEl = document.getElementById('homeQuoteAuthor');
  const wrapEl = document.getElementById('homeQuoteRotatorItem');
  if (!quoteEl || !authorEl || homeQuotesList.length === 0) return;

  const item = homeQuotesList[homeQuoteIndex] || homeQuotesList[0];
  if (homeQuoteFadeTimeout) {
    clearTimeout(homeQuoteFadeTimeout);
    homeQuoteFadeTimeout = null;
  }

  if (animate && wrapEl) {
    wrapEl.style.opacity = '0';
    homeQuoteFadeTimeout = setTimeout(() => {
      quoteEl.innerText = `“${item.quote}”`;
      authorEl.innerText = `${item.author || 'Unknown'}`;
      wrapEl.style.opacity = '1';
      homeQuoteFadeTimeout = null;
    }, 180);
  } else {
    quoteEl.innerText = `“${item.quote}”`;
    authorEl.innerText = `${item.author || 'Unknown'}`;
    if (wrapEl) wrapEl.style.opacity = '1';
  }
}

/* ---------------- APPLICATION INITIALIZATION ---------------- */
function init() {
  initTheme();
  initTabMaskStates();
  buildDynamicAccountControls();
  updateSyncUI();
  renderLastPriceTimestamp();
  renderLastBackupTimestamp();
  initHeaderInfoTicker();
  initHomeQuotesTicker();
  initAutoLockEngine();
  initKeyboardPinListener();
  resetKpiMasksToDefault();

  const savedTx = localStorage.getItem(STORAGE_KEY);
  if (savedTx) {
    try { transactions = JSON.parse(savedTx); } catch (e) { transactions = []; }
  }
  const savedDonations = localStorage.getItem(DONATIONS_STORAGE_KEY);
  if (savedDonations) {
    try { donations = JSON.parse(savedDonations); } catch (e) { donations = []; }
  }
  bumpTxVersion();

  updateStockAutocompleteOptions();
  checkGatekeeperState();

  if (cloudScriptUrl) {
    fetchFromGoogleSheet();
  } else {
    recalculateAndRender();
  }
}

function buildDynamicAccountControls() {
  const accounts = ['ALL', ...CALIB_ACCOUNTS];

  const filterGroup = document.getElementById('holdingsAccountFilterGroup');
  if (filterGroup) {
    filterGroup.innerHTML = accounts.map(acct => {
      const label = acct === 'ALL' ? 'Combined' : esc(acct);
      const isSelected = acct === currentHoldingsAccountFilter;
      const cls = isSelected
        ? 'px-2.5 py-1 rounded-md transition-all bg-white dark:bg-[#131722] text-slate-900 dark:text-white shadow-2xs font-semibold'
        : 'px-2.5 py-1 rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium';
      return `<button onclick="setHoldingsAccountFilter('${esc(acct)}')" id="holdingsAcctBtn-${esc(acct)}" class="${cls}">${label}</button>`;
    }).join('');
  }

  const purifFilterGroup = document.getElementById('purificationAccountFilterGroup');
  if (purifFilterGroup) {
    purifFilterGroup.innerHTML = accounts.map(acct => {
      const label = acct === 'ALL' ? 'Combined' : esc(acct);
      const isSelected = acct === currentPurificationAccountFilter;
      const cls = isSelected
        ? 'px-2.5 py-1 rounded-md transition-all bg-white dark:bg-[#131722] text-slate-900 dark:text-white shadow-2xs font-semibold'
        : 'px-2.5 py-1 rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium';
      return `<button onclick="setPurificationAccountFilter('${esc(acct)}')" id="purifAcctBtn-${esc(acct)}" class="${cls}">${label}</button>`;
    }).join('');
  }

  const chartAcctSelect = document.getElementById('chartAccountSelect');
  if (chartAcctSelect) {
    const prevAcct = chartAcctSelect.value || 'ALL';
    chartAcctSelect.innerHTML = `<option value="ALL">Combined</option>` +
      CALIB_ACCOUNTS.map(acct => `<option value="${esc(acct)}">${esc(acct)}</option>`).join('');
    chartAcctSelect.value = (prevAcct === 'ALL' || CALIB_ACCOUNTS.includes(prevAcct)) ? prevAcct : 'ALL';
  }

  const acctOptionsHtml = `<option value="">Select Account</option>` +
    CALIB_ACCOUNTS.map(acct => `<option value="${esc(acct)}">${esc(acct)}</option>`).join('');

  const txAccountSelect = document.getElementById('txAccount');
  if (txAccountSelect) txAccountSelect.innerHTML = acctOptionsHtml;

  const donationAccountSelect = document.getElementById('donationAccount');
  if (donationAccountSelect) donationAccountSelect.innerHTML = acctOptionsHtml;
}

/* ---------------- STEALTH MASKING SYSTEM ---------------- */
function initTabMaskStates() {
  tabMaskStates = {
    dashboard: true,
    chart: true,
    holdings: true,
    closedTrades: true,
    fyBreakdown: true,
    ledger: true,
    bankLedger: true,
    taxPnl: true,
    purification: true
  };
  Object.keys(tabMaskStates).forEach(k => updateTabMaskIcon(k));
}

function toggleTabMask(tabKey) {
  if (!Object.prototype.hasOwnProperty.call(tabMaskStates, tabKey)) return;
  tabMaskStates[tabKey] = !tabMaskStates[tabKey];
  updateTabMaskIcon(tabKey);

  const data = getCachedEngineData();
  if (tabKey === 'dashboard') {
    if (typeof kpiMaskStates !== 'undefined') {
      kpiMaskStates.netWorth = tabMaskStates.dashboard;
      kpiMaskStates.netInvested = tabMaskStates.dashboard;
      kpiMaskStates.lifetimePnL = tabMaskStates.dashboard;
      kpiMaskStates.currentFy = tabMaskStates.dashboard;
    }
    if (typeof applyAllKpiMasks === 'function') applyAllKpiMasks();
    renderDashboardTrendChart(data);
  } else if (tabKey === 'chart') {
    if (multiChartInstance) multiChartInstance.update('none');
    renderCurveInsights(data);
    renderTtmTable(data);
  } else if (tabKey === 'holdings') {
    renderHoldings(data);
  } else if (tabKey === 'closedTrades') {
    renderClosedTrades(data.closedTrades);
  } else if (tabKey === 'fyBreakdown') {
    renderFY(data.fyRealized);
  } else if (tabKey === 'ledger') {
    renderLedger(data.ledgerEntries);
  } else if (tabKey === 'bankLedger') {
    renderBankLedger(data.bankEntries);
  } else if (tabKey === 'taxPnl') {
    renderTaxView();
  } else if (tabKey === 'purification') {
    renderPurificationView(data);
  }
  refreshIcons();
}

function updateTabMaskIcon(tabKey) {
  const icon = document.getElementById(`maskToggleIcon-${tabKey}`);
  if (!icon) return;
  icon.setAttribute('data-lucide', tabMaskStates[tabKey] ? 'eye-off' : 'eye');
}

function getMaskClass(tabKey) {
  return tabMaskStates[tabKey] ? 'privacy-blurred' : 'mask-transition';
}

/* ---------------- THEME TOGGLE ---------------- */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const isDark = saved ? saved === 'dark' : false;
  applyTheme(isDark);
}

function toggleTheme(e) {
  if (e) e.stopPropagation();
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(!isDark);
}

function applyTheme(isDark) {
  const root = document.documentElement;
  const themeIcon = document.getElementById('settingsThemeIcon');
  const themeLabel = document.getElementById('settingsThemeLabel');
  const themePill = document.getElementById('settingsThemePill');

  if (isDark) {
    root.classList.add('dark');
    localStorage.setItem(THEME_KEY, 'dark');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', 'moon');
      themeIcon.className = 'w-4 h-4 text-indigo-400';
    }
    if (themeLabel) themeLabel.innerText = 'Dark';
    if (themePill) {
      themePill.className = 'w-7 h-4 bg-emerald-600 rounded-full flex items-center justify-end p-0.5 transition-colors';
    }
  } else {
    root.classList.remove('dark');
    localStorage.setItem(THEME_KEY, 'light');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', 'sun');
      themeIcon.className = 'w-4 h-4 text-amber-500';
    }
    if (themeLabel) themeLabel.innerText = 'Light';
    if (themePill) {
      themePill.className = 'w-7 h-4 bg-slate-300 rounded-full flex items-center justify-start p-0.5 transition-colors';
    }
  }

  refreshIcons();

  if (multiChartInstance) {
    multiChartInstance.destroy();
    multiChartInstance = null;
    renderChart(getCachedEngineData());
  }
}

/* ---------------- TIMESTAMP MANAGEMENT ---------------- */
function recordPriceUpdateTimestamp(customDate) {
  const d = customDate || new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');

  const formatted = `${day}-${month}, ${hours}:${mins}`;
  localStorage.setItem(LAST_PRICE_UPDATE_KEY, formatted);
  renderLastPriceTimestamp();
}

function renderLastPriceTimestamp() {
  const val = localStorage.getItem(LAST_PRICE_UPDATE_KEY);
  const el = document.getElementById('lastSyncedTime');
  if (el) el.innerText = val || 'Not refreshed yet';
  if (headerTickerStep === 1) updateHeaderTickerDisplay();
}

function recordBackupTimestamp(customStr) {
  let formatted = customStr;

  if (formatted) {
    const matches = String(formatted).match(/\d+/g);
    if (matches && matches.length >= 4) {
      const dd = matches[0];
      const mm = matches[1];
      const hh = matches[matches.length - 2];
      const min = matches[matches.length - 1];
      formatted = `${dd}-${mm}, ${hh}:${min}`;
    }
  }

  if (!formatted || formatted.includes('undefined')) {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    formatted = `${dd}-${mm}, ${hh}:${min}`;
  }

  localStorage.setItem('MYFOLIOAI_LAST_BACKUP_TIME', formatted);
  renderLastBackupTimestamp();
}

function renderLastBackupTimestamp() {
  const val = localStorage.getItem('MYFOLIOAI_LAST_BACKUP_TIME');
  const el = document.getElementById('lastBackupTime');
  if (el) el.innerText = val || 'Not backed up yet';
  if (headerTickerStep === 2) updateHeaderTickerDisplay();
}

/* ---------------- AUTOCOMPLETE SUGGESTIONS ---------------- */
function updateStockAutocompleteOptions() {
  const datalist = document.getElementById('stockSuggestionsList');
  if (!datalist) return;
  datalist.innerHTML = '';

  const seen = new Set();
  stockMasterList.forEach(item => {
    const sym = (item.symbol || '').toUpperCase().trim();
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      const opt = document.createElement('option');
      opt.value = sym;
      opt.label = item.name ? `${item.name}` : sym;
      datalist.appendChild(opt);
    }
  });

  transactions.forEach(t => {
    if (t.stock) {
      const sym = t.stock.toUpperCase().trim();
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        const opt = document.createElement('option');
        opt.value = sym;
        datalist.appendChild(opt);
      }
    }
  });
}

let portAllocationMode = 'sector'; // 'sector' | 'stock'
let portAllocationChartInstance = null;

function getStockMeta(symbol) {
  const sym = String(symbol || '').toUpperCase().trim();
  const found = (typeof stockMasterList !== 'undefined' && Array.isArray(stockMasterList))
    ? stockMasterList.find(item => String(item.symbol || '').toUpperCase().trim() === sym)
    : null;

  return {
    name: (found && found.name) ? String(found.name).trim() : sym,
    sector: (found && found.sector && String(found.sector).trim()) ? String(found.sector).trim() : 'Others'
  };
}

function getSectorBadgeClasses(sector) {
  const key = String(sector || 'Others').toLowerCase();
  if (key.includes('capital')) return 'port-sector-badge bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60';
  if (key.includes('power') || key.includes('utilit')) return 'port-sector-badge bg-cyan-50 dark:bg-cyan-950/70 text-cyan-700 dark:text-cyan-300 border border-cyan-200/80 dark:border-cyan-800/60';
  if (key.includes('engineer')) return 'port-sector-badge bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/60';
  if (key.includes('financ') || key.includes('bank')) return 'port-sector-badge bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60';
  if (key.includes('chem')) return 'port-sector-badge bg-pink-50 dark:bg-pink-950/70 text-pink-700 dark:text-pink-300 border border-pink-200/80 dark:border-pink-800/60';
  if (key.includes('it') || key.includes('tech')) return 'port-sector-badge bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60';
  return 'port-sector-badge bg-slate-100 dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-[#222836]';
}

function handlePortfolioSortSelect(val) {
  const [key, dir] = String(val || 'weightPct-desc').split('-');
  holdingsSort = { key: key || 'weightPct', dir: dir || 'desc' };
  renderHoldings(getCachedEngineData());
  refreshIcons();
}

function setPortfolioAllocationMode(mode) {
  portAllocationMode = mode === 'stock' ? 'stock' : 'sector';
  const secBtn = document.getElementById('portAllocTab-sector');
  const stkBtn = document.getElementById('portAllocTab-stock');
  const activeCls = 'port-alloc-pill-active px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition';
  const inactiveCls = 'px-3 py-1.5 rounded-lg flex items-center space-x-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition';

  if (secBtn) secBtn.className = portAllocationMode === 'sector' ? activeCls : inactiveCls;
  if (stkBtn) stkBtn.className = portAllocationMode === 'stock' ? activeCls : inactiveCls;

  renderHoldings(getCachedEngineData());
  refreshIcons();
}

function togglePortBreakdownCollapse() {
  const wrap = document.getElementById('portBreakdownBodyWrap');
  const chev = document.getElementById('portBreakdownChevron');
  if (!wrap) return;
  const hidden = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden', !hidden);
  if (chev) chev.classList.toggle('rotate-180', hidden);
}

/* ---------------- MASTER RECALCULATE & RENDER ---------------- */
function recalculateAndRender() {
  bumpTxVersion();
  const data = getCachedEngineData();

  if (typeof tabMaskStates !== 'undefined' && typeof tabMaskStates.dashboard === 'boolean' && typeof kpiMaskStates !== 'undefined') {
    kpiMaskStates.netWorth = tabMaskStates.dashboard;
    kpiMaskStates.netInvested = tabMaskStates.dashboard;
    kpiMaskStates.lifetimePnL = tabMaskStates.dashboard;
    kpiMaskStates.currentFy = tabMaskStates.dashboard;
  }

  // Card 1: Total Net Worth
  document.getElementById('kpiNetWorth').innerText = formatINR(data.netWorth);
  document.getElementById('subPortfolioVal').innerText = formatCompactIndian(data.totalPortfolioVal);
  document.getElementById('subCashVal').innerText = formatCompactIndian(data.cashBalance);

  const nwTarget = milestoneGoals.netWorth || 10000000;
  const nwPct = nwTarget > 0 ? Math.min(100, Math.max(0, (data.netWorth / nwTarget) * 100)) : 0;
  const nwRem = Math.max(0, nwTarget - data.netWorth);
  document.getElementById('kpiNetWorthPct').innerText = `${nwPct.toFixed(2)}%`;
  document.getElementById('kpiNetWorthPct').className = 'dash-slot-meta text-blue-700 dark:text-blue-400 ml-1';
  document.getElementById('kpiNetWorthRem').innerText = nwRem > 0 ? `${formatCompactIndian(nwRem)} left` : 'Achieved';
  document.getElementById('kpiNetWorthRem').className = 'dash-slot-meta text-slate-600 dark:text-slate-400 truncate transition-all duration-200';
  const nwBarEl = document.getElementById('kpiNetWorthBar');
  nwBarEl.className = 'dash-slot-progress-fill bg-blue-700 h-1.5 rounded-full transition-all duration-500';
  nwBarEl.style.width = `${nwPct}%`;

  // Card 2: Net Invested
  const invValEl = document.getElementById('kpiNetInvested');
  invValEl.innerText = formatINR(data.netInvested);
  invValEl.className = 'dash-slot-value text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight leading-tight transition-all duration-200 text-rose-600 dark:text-rose-400';

  const invTarget = milestoneGoals.netInvested || 5000000;
  const isExcessInvested = data.netInvested > invTarget;
  const invPct = invTarget > 0 ? (data.netInvested / invTarget) * 100 : 0;
  const displayPct = Math.min(100, invPct);

  const invBarEl = document.getElementById('kpiNetInvestedBar');
  const invPctEl = document.getElementById('kpiNetInvestedPct');
  const invRemEl = document.getElementById('kpiNetInvestedRem');

  if (isExcessInvested) {
    const excessAmt = data.netInvested - invTarget;
    const excessPct = invPct - 100;
    invPctEl.innerText = `${excessPct.toFixed(2)}% excess invested`;
    invRemEl.innerText = `${formatCompactIndian(excessAmt)} excess`;
    invRemEl.className = 'dash-slot-meta text-rose-600 dark:text-rose-400 font-bold transition-all duration-200';
    invPctEl.className = 'dash-slot-meta text-rose-600 dark:text-rose-400 font-bold';
    invBarEl.className = 'dash-slot-progress-fill bg-gradient-to-r from-rose-600 to-rose-400 h-1.5 rounded-full transition-all duration-500';
  } else {
    invPctEl.innerText = `${invPct.toFixed(2)}%`;
    const invRem = invTarget - data.netInvested;
    invRemEl.innerText = invRem > 0 ? `${formatCompactIndian(invRem)} left` : 'Achieved';
    invRemEl.className = 'dash-slot-meta text-slate-600 dark:text-slate-400 transition-all duration-200';
    invPctEl.className = 'dash-slot-meta text-rose-600 dark:text-rose-400 font-bold';
    invBarEl.className = 'dash-slot-progress-fill bg-gradient-to-r from-rose-600 to-rose-500 h-1.5 rounded-full transition-all duration-500';
  }
  invBarEl.style.width = `${displayPct}%`;

  // Card 3: Lifetime P&L
  const lifeEl = document.getElementById('kpiLifetimePnL');
  lifeEl.innerText = formatINR(data.lifetimePnL);
  lifeEl.className = `dash-slot-value text-xl sm:text-2xl font-extrabold tracking-tight tabular-nums leading-tight transition-all duration-200 ${data.lifetimePnL >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const lifePctEl = document.getElementById('kpiLifetimePnLPct');
  lifePctEl.innerText = `${data.lifetimePnL >= 0 ? '+' : ''}${data.lifetimePnLPct.toFixed(2)}%`;
  lifePctEl.className = `dash-slot-sub mt-1.5 text-[11px] font-bold leading-snug truncate ${data.lifetimePnL >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const pnlTarget = milestoneGoals.lifetimePnL || 2500000;
  const lifeTargetPct = pnlTarget > 0 ? Math.min(100, Math.max(0, (data.lifetimePnL / pnlTarget) * 100)) : 0;
  const lifeRem = Math.max(0, pnlTarget - data.lifetimePnL);
  document.getElementById('kpiLifetimeTargetPct').innerText = `${lifeTargetPct.toFixed(2)}%`;
  document.getElementById('kpiLifetimeTargetPct').className = 'dash-slot-meta text-emerald-700 dark:text-emerald-400 ml-1';
  document.getElementById('kpiLifetimeTargetRem').innerText = lifeRem > 0 ? `${formatCompactIndian(lifeRem)} left` : 'Achieved';
  document.getElementById('kpiLifetimeTargetRem').className = 'dash-slot-meta text-slate-600 dark:text-slate-400 truncate transition-all duration-200';
  const lifeBarEl = document.getElementById('kpiLifetimeBar');
  lifeBarEl.className = 'dash-slot-progress-fill bg-emerald-600 h-1.5 rounded-full transition-all duration-500';
  lifeBarEl.style.width = `${lifeTargetPct}%`;

  // Card 4: Current FY Realized & Unrealized
  const curFy = getFinancialYear(todayLocalISO());
  document.getElementById('kpiCurrentFyCardTitle').innerText = curFy;
  const curFyData = data.fyRealized[curFy] || { gain: 0 };

  const curFyEl = document.getElementById('kpiCurrentFyPnL');
  curFyEl.innerText = formatINR(curFyData.gain);
  curFyEl.className = `dash-slot-value text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight leading-tight transition-all duration-200 ${curFyData.gain >= 0 ? 'text-purple-600 dark:text-purple-400' : 'text-rose-600 dark:text-rose-400'}`;

  const curFyUnrealEl = document.getElementById('kpiCurrentFyUnrealized');
  curFyUnrealEl.innerText = formatINR(data.totalUnrealizedPnL);
  curFyUnrealEl.className = `dash-slot-sub font-semibold tabular-nums transition-all duration-200 ${data.totalUnrealizedPnL >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const fyTarget = milestoneGoals.currentFyPnL || 1000000;
  const fyPct = fyTarget > 0 ? Math.min(100, Math.max(0, (curFyData.gain / fyTarget) * 100)) : 0;
  const fyRem = Math.max(0, fyTarget - curFyData.gain);

  const fyPctEl = document.getElementById('kpiCurrentFyPct');
  const fyRemEl = document.getElementById('kpiCurrentFyRem');
  const fyBarEl = document.getElementById('kpiCurrentFyBar');

  fyPctEl.innerText = `${fyPct.toFixed(2)}%`;
  fyPctEl.className = 'dash-slot-meta text-purple-600 dark:text-purple-400 ml-1';
  fyRemEl.innerText = fyRem > 0 ? `${formatCompactIndian(fyRem)} left` : 'Achieved';
  fyRemEl.className = 'dash-slot-meta text-slate-600 dark:text-slate-400 truncate transition-all duration-200';
  fyBarEl.className = 'dash-slot-progress-fill bg-purple-600 h-1.5 rounded-full transition-all duration-500';
  fyBarEl.style.width = `${fyPct}%`;

  // Card 5: Annualized XIRR & Inception Date
  const xirrValid = data.xirrValue !== null && data.xirrValue !== undefined && !isNaN(data.xirrValue);
  document.getElementById('kpiXIRR').innerText = xirrValid ? `${data.xirrValue.toFixed(2)}%` : '—';
  const xirrTarget = milestoneGoals.xirr || 25;
  const xirrProgress = (xirrValid && xirrTarget > 0) ? Math.min(100, Math.max(0, (data.xirrValue / xirrTarget) * 100)) : 0;
  const xirrRem = xirrValid ? Math.max(0, xirrTarget - data.xirrValue) : xirrTarget;
  document.getElementById('kpiXirrPct').innerText = xirrValid ? `${xirrProgress.toFixed(2)}%` : '—';
  document.getElementById('kpiXirrPct').className = 'dash-slot-meta text-slate-800 dark:text-slate-300 ml-1';
  document.getElementById('kpiXirrRem').innerText = !xirrValid ? '< 90d period' : (xirrRem > 0 ? `${xirrRem.toFixed(2)}% left` : 'Achieved');
  document.getElementById('kpiXirrRem').className = 'dash-slot-meta text-slate-600 dark:text-slate-400 truncate';
  const xirrBarEl = document.getElementById('kpiXirrBar');
  xirrBarEl.className = 'dash-slot-progress-fill bg-[#13357A] h-1.5 rounded-full transition-all duration-500';
  xirrBarEl.style.width = `${xirrProgress}%`;

  const inceptionEl = document.getElementById('kpiXirrInception');
  if (inceptionEl) {
    const capitalTxs = data.sortedTx.filter(t => t.type === 'DEPOSIT' || t.type === 'BUY');
    if (capitalTxs.length > 0 && capitalTxs[0].date) {
      const d = new Date(capitalTxs[0].date);
      if (!isNaN(d.getTime())) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        inceptionEl.innerText = `Since ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      } else {
        inceptionEl.innerText = 'Since —';
      }
    } else {
      inceptionEl.innerText = 'Since —';
    }
  }

  applyAllKpiMasks();
  populateTaxFyOptions(data.fyRealized);
  populatePurificationFyOptions(data.purificationLots);
  renderActiveTabOnly(data);
  renderChartLegend();
  renderChart(data);
  renderCurveInsights(data);
  renderTtmTable(data);
  renderDashboardTrendChart(data);
  updateHeaderTickerDisplay();
  refreshIcons();
}

function renderActiveTabOnly(data) {
  const engineData = data || getCachedEngineData();
  if (activeTabKey === 'holdings') {
    renderHoldings(engineData);
    dirtyTabs.holdings = false;
  } else if (activeTabKey === 'closedTrades') {
    renderClosedTrades(engineData.closedTrades);
    dirtyTabs.closedTrades = false;
  } else if (activeTabKey === 'fyBreakdown') {
    renderFY(engineData.fyRealized);
    dirtyTabs.fyBreakdown = false;
  } else if (activeTabKey === 'transactions') {
    renderLedger(engineData.ledgerEntries);
    dirtyTabs.transactions = false;
  } else if (activeTabKey === 'bankLedger') {
    renderBankLedger(engineData.bankEntries);
    dirtyTabs.bankLedger = false;
  } else if (activeTabKey === 'taxPnl') {
    renderTaxView();
    dirtyTabs.taxPnl = false;
  } else if (activeTabKey === 'purification') {
    renderPurificationView(engineData);
    dirtyTabs.purification = false;
  }
}

/* ---------------- ACTIVE HOLDINGS TABLE ---------------- */
function setHoldingsAccountFilter(acct) {
  currentHoldingsAccountFilter = acct;
  ['ALL', ...CALIB_ACCOUNTS].forEach(key => {
    const btn = document.getElementById(`holdingsAcctBtn-${key}`);
    if (!btn) return;
    if (key === acct) {
      btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-[#0B1F4C] dark:bg-blue-600 text-white shadow-2xs flex items-center space-x-1.5';
    } else {
      btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all bg-white dark:bg-[#131722] text-slate-600 dark:text-slate-300 border border-slate-200/90 dark:border-[#222836] hover:bg-slate-50 dark:hover:bg-[#1A1F2E] flex items-center space-x-1.5';
    }
  });
  renderHoldings(getCachedEngineData());
  refreshIcons();
}

function renderHoldings(data) {
  const tbody = document.getElementById('holdingsTableBody');
  const tfoot = document.getElementById('holdingsTableFooter');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';

  const maskClass = getMaskClass('holdings');
  const isCombined = currentHoldingsAccountFilter === 'ALL';

  let filteredHoldings = [];
  if (isCombined) {
    filteredHoldings = data.holdings.map(h => {
      const meta = getStockMeta(h.stock);
      return { ...h, companyName: meta.name, sector: meta.sector };
    });
  } else {
    const relevantLots = data.openLots.filter(l => l.account === currentHoldingsAccountFilter);
    const aggMap = {};
    let totalFilteredPortVal = 0;

    relevantLots.forEach(lot => {
      if (!aggMap[lot.stock]) aggMap[lot.stock] = { totalQty: 0, totalCost: 0 };
      aggMap[lot.stock].totalQty += lot.qty;
      aggMap[lot.stock].totalCost += (lot.qty * lot.price);
    });

    Object.keys(aggMap).forEach(stock => {
      const item = aggMap[stock];
      if (item.totalQty > 0) {
        const wap = item.totalCost / item.totalQty;
        const liveData = marketPrices[stock];
        const ltp = (liveData && Number(liveData.ltp) > 0) ? Number(liveData.ltp) : wap;
        const curVal = item.totalQty * ltp;
        const invVal = item.totalCost;
        const pnlVal = curVal - invVal;
        const pnlPct = invVal > 0 ? (pnlVal / invVal) * 100 : 0;
        const meta = getStockMeta(stock);
        totalFilteredPortVal += curVal;

        filteredHoldings.push({
          stock,
          companyName: meta.name,
          sector: meta.sector,
          qty: item.totalQty,
          wap,
          ltp,
          investedVal: invVal,
          currentVal: curVal,
          pnlVal,
          pnlPct
        });
      }
    });

    filteredHoldings.forEach(h => {
      h.weightPct = totalFilteredPortVal > 0 ? (h.currentVal / totalFilteredPortVal) * 100 : 0;
    });
  }

  const totalEqVal = filteredHoldings.reduce((s, h) => s + Number(h.currentVal || 0), 0);
  const totalInvVal = filteredHoldings.reduce((s, h) => s + Number(h.investedVal || 0), 0);
  const totalUnrelPnl = totalEqVal - totalInvVal;
  const totalUnrelPct = totalInvVal > 0 ? (totalUnrelPnl / totalInvVal) * 100 : 0;
  const cashAmt = isCombined
    ? Number(data.cashBalance || 0)
    : Number((data.accountCashMap && data.accountCashMap[currentHoldingsAccountFilter]) || 0);

  const mktEl = document.getElementById('portKpiMarketVal');
  const invEl = document.getElementById('portKpiInvestedVal');
  const pnlEl = document.getElementById('portKpiUnrealizedVal');
  const pnlPctEl = document.getElementById('portKpiUnrealizedPct');
  const cashBadgeVal = document.getElementById('holdingsCashBadgeVal');
  const cashBadgeLabel = document.getElementById('holdingsCashBadgeLabel');

  if (mktEl) {
    mktEl.innerText = formatINR(totalEqVal, 0);
    mktEl.className = `text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums tracking-tight ${maskClass}`;
  }
  if (invEl) {
    invEl.innerText = formatINR(totalInvVal, 0);
    invEl.className = `text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums tracking-tight ${maskClass}`;
  }
  if (pnlEl) {
    const isPos = totalUnrelPnl >= 0;
    pnlEl.innerText = `${isPos ? '+' : ''}${formatINR(totalUnrelPnl, 0)}`;
    pnlEl.className = `text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight ${isPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}`;
  }
  if (pnlPctEl) {
    const isPos = totalUnrelPct >= 0;
    pnlPctEl.innerText = `${isPos ? '+' : ''}${totalUnrelPct.toFixed(2)}%`;
    pnlPctEl.className = `px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${isPos ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'}`;
  }
  if (cashBadgeLabel) {
    cashBadgeLabel.innerText = isCombined ? 'Available Cash' : `Available Cash (${currentHoldingsAccountFilter})`;
  }
  if (cashBadgeVal) {
    cashBadgeVal.innerText = formatINR(cashAmt, 0);
    cashBadgeVal.className = `text-xl sm:text-2xl font-extrabold tabular-nums tracking-tight ${cashAmt >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-600 dark:text-rose-400'} ${maskClass}`;
  }

  document.getElementById('holdingsCount').innerText = `${filteredHoldings.length} Open Positions`;

  const profitPositions = filteredHoldings.filter(h => h.pnlVal >= 0);
  const lossPositions = filteredHoldings.filter(h => h.pnlVal < 0);
  const totalCount = filteredHoldings.length;
  const winRate = totalCount > 0 ? Math.round((profitPositions.length / totalCount) * 100) : 0;

  document.getElementById('holdingsProfitSummary').innerText = `${profitPositions.length} Green`;
  document.getElementById('holdingsLossSummary').innerText = `${lossPositions.length} Red`;
  document.getElementById('holdingsWinRateBadge').innerText = `Win Rate: ${winRate}%`;
  document.getElementById('holdingsWinBar').style.width = `${winRate}%`;
  document.getElementById('holdingsLossBar').style.width = `${100 - winRate}%`;

  updateSortHeaderIcons('holdings', holdingsSort, ['stock', 'investedVal', 'currentVal', 'pnlVal']);

  if (filteredHoldings.length === 0) {
    const label = isCombined ? 'Combined Portfolio' : esc(currentHoldingsAccountFilter);
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-400 dark:text-slate-500 font-medium">No active holdings for ${label}.</td></tr>`;
  } else {
    const sorted = [...filteredHoldings].sort((a, b) => {
      const valA = a[holdingsSort.key];
      const valB = b[holdingsSort.key];
      if (typeof valA === 'string') {
        return holdingsSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return holdingsSort.dir === 'asc' ? valA - valB : valB - valA;
    });

    sorted.forEach((h, idx) => {
      const isPos = h.pnlVal >= 0;
      const safeStock = esc(h.stock);
      const safeCompany = esc(h.companyName || h.stock);
      const safeSector = esc(h.sector || 'Others');
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 transition-colors';
      tr.innerHTML = `
        <td class="py-3 px-3 w-10 text-slate-400 font-semibold tabular-nums">${idx + 1}</td>
        <td class="py-3 px-3">
          <div class="font-bold text-slate-900 dark:text-white leading-tight">${safeStock}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]">${safeCompany}</div>
        </td>
        <td class="py-3 px-3"><span class="${getSectorBadgeClasses(safeSector)}">${safeSector}</span></td>
        <td class="py-3 px-3 text-right tabular-nums font-semibold ${maskClass}">${h.qty}</td>
        <td class="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300">${formatINR(h.wap)}</td>
        <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white cursor-pointer hover:underline" data-action="override-ltp" data-stock="${safeStock}" data-ltp="${h.ltp}" title="Click to override LTP">${formatINR(h.ltp)}</td>
        <td class="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-slate-400 ${maskClass}">${formatINR(h.investedVal, 0)}</td>
        <td class="py-3 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-white ${maskClass}">${formatINR(h.currentVal, 0)}</td>
        <td class="py-3 px-3 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPos ? '+' : ''}${formatINR(h.pnlVal, 0)}
          <span class="text-[10.5px] font-semibold">(${isPos ? '+' : ''}${h.pnlPct.toFixed(2)}%)</span>
        </td>
        <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-300">
          <div class="flex items-center justify-end space-x-2">
            <span>${h.weightPct.toFixed(1)}%</span>
            <span class="w-10 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden inline-block">
              <span class="bg-blue-600 h-1.5 rounded-full block" style="width: ${Math.min(100, h.weightPct)}%"></span>
            </span>
          </div>
        </td>
        <td class="py-3 px-3 text-center">
          <button data-action="quick-sell" data-stock="${safeStock}" data-qty="${h.qty}" data-ltp="${h.ltp}" class="px-3 py-1 text-[11px] font-bold rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800/70 transition">Sell</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (tfoot) {
      const isPosTotal = totalUnrelPnl >= 0;
      tfoot.innerHTML = `
        <tr>
          <td colspan="6" class="py-3 px-3 text-slate-900 dark:text-white">Total (${filteredHoldings.length} ${filteredHoldings.length === 1 ? 'Holding' : 'Holdings'})</td>
          <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${formatINR(totalInvVal, 0)}</td>
          <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${formatINR(totalEqVal, 0)}</td>
          <td class="py-3 px-3 text-right tabular-nums ${isPosTotal ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isPosTotal ? '+' : ''}${formatINR(totalUnrelPnl, 0)} (${isPosTotal ? '+' : ''}${totalUnrelPct.toFixed(2)}%)</td>
          <td class="py-3 px-3 text-right tabular-nums">100.0%</td>
          <td class="py-3 px-3"></td>
        </tr>
      `;
    }
  }

  renderPortfolioCashCard(data, cashAmt, maskClass);
  renderPortfolioAllocation(filteredHoldings, totalEqVal, maskClass);
  filterHoldingsTable();
}

function renderPortfolioCashCard(data, activeCashAmt, maskClass) {
  const titleEl = document.getElementById('portCashCardTitle');
  const bodyEl = document.getElementById('portCashCardBody');
  if (!bodyEl) return;

  const isCombined = currentHoldingsAccountFilter === 'ALL';
  if (isCombined) {
    if (titleEl) titleEl.innerText = 'Cash Distribution (Combined)';
    const rowsHtml = CALIB_ACCOUNTS.map(acct => {
      const val = Number((data.accountCashMap && data.accountCashMap[acct]) || 0);
      return `
        <div class="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 dark:bg-[#0A0C10]/50 border border-slate-100 dark:border-[#222836]">
          <span class="font-semibold text-slate-700 dark:text-slate-200">${esc(acct)}</span>
          <span class="font-extrabold tabular-nums text-slate-900 dark:text-white ${maskClass}">${formatINR(val, 0)}</span>
        </div>
      `;
    }).join('');

    bodyEl.innerHTML = `
      <div class="space-y-2">${rowsHtml}</div>
      <div class="flex items-center justify-between py-2.5 px-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/70 dark:border-blue-900/50 font-extrabold text-slate-900 dark:text-white">
        <span>Total Cash</span>
        <span class="tabular-nums text-sm ${maskClass}">${formatINR(activeCashAmt, 0)}</span>
      </div>
    `;
  } else {
    const acct = currentHoldingsAccountFilter;
    if (titleEl) titleEl.innerText = `Account Cash (${esc(acct)})`;

    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStartIso = `${fyStartYear}-04-01`;

    let depositsYtd = 0;
    let withdrawalsYtd = 0;
    (transactions || []).forEach(tx => {
      if ((tx.account || '') !== acct) return;
      if (String(tx.date || '') >= fyStartIso) {
        if (tx.type === 'DEPOSIT') depositsYtd += Number(tx.amount || 0);
        if (tx.type === 'WITHDRAWAL') withdrawalsYtd += Number(tx.amount || 0);
      }
    });

    const baselineCash = getCalibOffset(acct);

    bodyEl.innerHTML = `
      <div class="space-y-2.5 py-1">
        <div class="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-[#222836]">
          <span class="text-slate-500 dark:text-slate-400 font-medium">Opening / Baseline Cash</span>
          <span class="font-bold tabular-nums text-slate-800 dark:text-slate-200 ${maskClass}">${formatINR(baselineCash, 0)}</span>
        </div>
        <div class="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-[#222836]">
          <span class="text-slate-500 dark:text-slate-400 font-medium">Deposits (YTD)</span>
          <span class="font-bold tabular-nums text-emerald-600 dark:text-emerald-400 ${maskClass}">+${formatINR(depositsYtd, 0)}</span>
        </div>
        <div class="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-[#222836]">
          <span class="text-slate-500 dark:text-slate-400 font-medium">Withdrawals (YTD)</span>
          <span class="font-bold tabular-nums text-rose-600 dark:text-rose-400 ${maskClass}">-${formatINR(withdrawalsYtd, 0)}</span>
        </div>
        <div class="flex items-center justify-between py-2.5 px-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/70 dark:border-blue-900/50 font-extrabold text-slate-900 dark:text-white mt-2">
          <span>Available Cash</span>
          <span class="tabular-nums text-sm ${maskClass}">${formatINR(activeCashAmt, 0)}</span>
        </div>
      </div>
    `;
  }
}

function renderPortfolioAllocation(holdingsList, totalEqVal, maskClass) {
  const canvas = document.getElementById('portfolioAllocationChart');
  const legendEl = document.getElementById('portAllocationLegend');
  const tbody = document.getElementById('portBreakdownTableBody');
  const tfoot = document.getElementById('portBreakdownTableFoot');
  const titleEl = document.getElementById('portBreakdownTitle');
  const colLabelEl = document.getElementById('portBreakdownColLabel');
  const centerValEl = document.getElementById('portDonutCenterVal');
  if (!canvas) return;

  if (centerValEl) {
    centerValEl.innerText = formatINR(totalEqVal, 0);
    centerValEl.className = `text-sm font-extrabold text-slate-900 dark:text-white tabular-nums ${maskClass}`;
  }

  const isSector = portAllocationMode === 'sector';
  if (titleEl) titleEl.innerText = isSector ? 'Sector Breakdown' : 'Stock Breakdown';
  if (colLabelEl) colLabelEl.innerText = isSector ? 'Sector' : 'Stock';

  const groupMap = {};
  (holdingsList || []).forEach(h => {
    const k = isSector ? (h.sector || 'Others') : h.stock;
    groupMap[k] = (groupMap[k] || 0) + Number(h.currentVal || 0);
  });

  const entries = Object.keys(groupMap)
    .map(name => ({
      name,
      value: groupMap[name],
      weight: totalEqVal > 0 ? (groupMap[name] / totalEqVal) * 100 : 0
    }))
    .sort((a, b) => b.value - a.value);

  const palette = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#64748B'];

  if (legendEl) {
    legendEl.innerHTML = entries.slice(0, 6).map((item, idx) => {
      const c = palette[idx % palette.length];
      return `
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center space-x-2 truncate text-slate-700 dark:text-slate-200 font-semibold">
            <span class="w-2.5 h-2.5 rounded-xs shrink-0" style="background-color:${c}"></span>
            <span class="truncate">${esc(item.name)}</span>
          </span>
          <span class="font-bold tabular-nums text-slate-900 dark:text-white shrink-0">${item.weight.toFixed(1)}%</span>
        </div>
      `;
    }).join('');
  }

  if (tbody) {
    tbody.innerHTML = entries.map(item => `
      <tr>
        <td class="py-1.5 pr-2 font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[130px]">${esc(item.name)}</td>
        <td class="py-1.5 px-2 text-right tabular-nums ${maskClass}">${formatINR(item.value, 0)}</td>
        <td class="py-1.5 pl-2 text-right tabular-nums font-semibold">${item.weight.toFixed(1)}%</td>
      </tr>
    `).join('');
  }

  if (tfoot) {
    tfoot.innerHTML = `
      <tr>
        <td class="py-2 pr-2">Total</td>
        <td class="py-2 px-2 text-right tabular-nums ${maskClass}">${formatINR(totalEqVal, 0)}</td>
        <td class="py-2 pl-2 text-right tabular-nums">100.0%</td>
      </tr>
    `;
  }

  const ctx = canvas.getContext('2d');
  const labels = entries.map(e => e.name);
  const values = entries.map(e => e.value);
  const colors = entries.map((_, idx) => palette[idx % palette.length]);
  const isDark = document.documentElement.classList.contains('dark');

  if (portAllocationChartInstance) {
    portAllocationChartInstance.data.labels = labels;
    portAllocationChartInstance.data.datasets[0].data = values;
    portAllocationChartInstance.data.datasets[0].backgroundColor = colors;
    portAllocationChartInstance.data.datasets[0].borderColor = isDark ? '#131722' : '#FFFFFF';
    portAllocationChartInstance.update('none');
    return;
  }

  portAllocationChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: isDark ? '#131722' : '#FFFFFF',
        borderWidth: 2,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: function(context) {
            const { chart, tooltip } = context;
            const el = document.getElementById('portAllocTooltip');
            if (!el) return;
            if (tooltip.opacity === 0) {
              el.style.opacity = '0';
              return;
            }
            const dp = tooltip.dataPoints && tooltip.dataPoints[0];
            if (dp) {
              const item = entries[dp.dataIndex];
              const dot = colors[dp.dataIndex] || '#2563EB';
              el.innerHTML = `
                <div class="flex items-center space-x-1.5 font-bold text-slate-900 dark:text-white">
                  <span class="w-2 h-2 rounded-full inline-block" style="background:${dot}"></span>
                  <span>${esc(item.name)}:</span>
                  <span class="font-mono ${maskClass}">${formatINR(item.value, 0)}</span>
                  <span class="text-slate-500">(${item.weight.toFixed(1)}%)</span>
                </div>
              `;
            }
            el.style.opacity = '1';
            el.style.left = Math.min(chart.width - 140, Math.max(8, tooltip.caretX + 10)) + 'px';
            el.style.top = Math.max(8, tooltip.caretY - 16) + 'px';
          }
        }
      }
    }
  });
}

// Event delegation for Holdings table (XSS-safe)
document.addEventListener('click', (e) => {
  const overrideCell = e.target.closest('[data-action="override-ltp"]');
  if (overrideCell) {
    manualOverridePrice(overrideCell.dataset.stock, Number(overrideCell.dataset.ltp));
    return;
  }
  const sellBtn = e.target.closest('[data-action="quick-sell"]');
  if (sellBtn) {
    quickSellModal(sellBtn.dataset.stock, Number(sellBtn.dataset.qty), Number(sellBtn.dataset.ltp));
  }
});

function handleHoldingsSort(key) {
  if (holdingsSort.key === key) {
    holdingsSort.dir = holdingsSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    holdingsSort.key = key;
    holdingsSort.dir = 'desc';
  }
  renderHoldings(getCachedEngineData());
  refreshIcons();
}

function filterHoldingsTable() {
  const searchEl = document.getElementById('holdingsSearch');
  const q = (searchEl ? searchEl.value : '').toLowerCase();
  document.querySelectorAll('#holdingsTableBody tr').forEach(r => {
    r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

const PROD_SUBVIEW_PAGE_SIZE = 10;

let closedSearchQuery = '';
let ledgerFilters = { account: 'ALL', type: 'ALL', fy: 'ALL', dateRange: 'ALL', sortKey: null, sortDir: 'desc' };
let bankLedgerFilters = { search: '', account: 'ALL', type: 'ALL', fy: 'ALL', dateRange: 'ALL', sortKey: null, sortDir: 'desc' };

function populateProdSubViewFilters(data) {
  const fySet = new Set();
  (data && Array.isArray(data.ledgerEntries) ? data.ledgerEntries : []).forEach(e => {
    if (e.date) fySet.add(getFinancialYear(e.date));
  });
  (data && Array.isArray(data.bankEntries) ? data.bankEntries : []).forEach(e => {
    if (e.date) fySet.add(getFinancialYear(e.date));
  });
  const sortedFys = Array.from(fySet).sort().reverse();
  const fyOptionsHtml = `<option value="ALL">All FY</option>` + sortedFys.map(fy => `<option value="${esc(fy)}">${esc(fy)}</option>`).join('');

  const acctSet = new Set([...(typeof CALIB_ACCOUNTS !== 'undefined' ? CALIB_ACCOUNTS : [])]);
  (typeof transactions !== 'undefined' && Array.isArray(transactions) ? transactions : []).forEach(tx => {
    if (tx.account) acctSet.add(String(tx.account).trim());
  });
  const acctOptionsHtml = `<option value="ALL">All Accounts</option>` + Array.from(acctSet).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

  ['ledgerAccountFilter', 'bankAccountFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const prev = el.value || 'ALL';
      el.innerHTML = acctOptionsHtml;
      el.value = prev;
    }
  });

  ['ledgerFyFilter', 'bankFyFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const prev = el.value || 'ALL';
      el.innerHTML = fyOptionsHtml;
      el.value = prev;
    }
  });
}

function isWithinDateRange(dateStr, rangeKey) {
  if (!rangeKey || rangeKey === 'ALL') return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  const daysMap = { '30D': 30, '90D': 90, '1Y': 365 };
  const days = daysMap[rangeKey] || 365;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

function handleClosedSearch() {
  const inp = document.getElementById('closedSearchInput');
  closedSearchQuery = (inp ? inp.value : '').trim().toLowerCase();
  if (typeof closedTradesCurrentPage !== 'undefined') closedTradesCurrentPage = 1;
  renderClosedTrades(getCachedEngineData().closedTrades);
  refreshIcons();
}

/* ---------------- CLOSED TRADES BOOK ---------------- */
function renderClosedTrades(closedTrades) {
  const tbody = document.getElementById('closedTradesTableBody');
  const tfoot = document.getElementById('closedTradesTableFooter');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';

  const engineData = getCachedEngineData();
  const allClosedLots = Array.isArray(engineData.closedLots) ? engineData.closedLots : (Array.isArray(engineData.taxClosedLots) ? engineData.taxClosedLots : []);
  const maskClass = getMaskClass('closedTrades');
  updateSortHeaderIcons('closed', closedSort, ['stock', 'totalCostBasis', 'totalProceeds', 'netPnL', 'retPct']);

  const hasClosedLots = allClosedLots.length > 0;
  const totalTradesCount = hasClosedLots ? allClosedLots.length : (closedTrades || []).length;
  const winTradesCount = hasClosedLots
    ? allClosedLots.filter(l => Number(l.gain ?? l.pnl ?? 0) > 0).length
    : (closedTrades || []).filter(c => Number(c.netPnL || 0) > 0).length;
  const lossTradesCount = hasClosedLots
    ? allClosedLots.filter(l => Number(l.gain ?? l.pnl ?? 0) < 0).length
    : (closedTrades || []).filter(c => Number(c.netPnL || 0) < 0).length;

  const winPct = totalTradesCount > 0 ? (winTradesCount / totalTradesCount) * 100 : 0;
  const lossPct = totalTradesCount > 0 ? (lossTradesCount / totalTradesCount) * 100 : 0;

  const overallCost = (closedTrades || []).reduce((s, r) => s + Number(r.totalCostBasis || 0), 0);
  const overallProceeds = (closedTrades || []).reduce((s, r) => s + Number(r.totalProceeds || 0), 0);
  const overallPnl = overallProceeds - overallCost;
  const overallRetPct = overallCost > 0 ? (overallPnl / overallCost) * 100 : 0;

  const totTradesEl = document.getElementById('closedKpiTotalTrades');
  const winCntEl = document.getElementById('closedKpiWinCount');
  const winPctEl = document.getElementById('closedKpiWinPct');
  const lossCntEl = document.getElementById('closedKpiLossCount');
  const lossPctEl = document.getElementById('closedKpiLossPct');
  const totPnlEl = document.getElementById('closedKpiTotalPnl');
  const totRetEl = document.getElementById('closedKpiTotalRetPct');

  if (totTradesEl) totTradesEl.innerText = String(totalTradesCount);
  if (winCntEl) winCntEl.innerText = String(winTradesCount);
  if (winPctEl) winPctEl.innerText = `${winPct.toFixed(2)}%`;
  if (lossCntEl) lossCntEl.innerText = String(lossTradesCount);
  if (lossPctEl) lossPctEl.innerText = `${lossPct.toFixed(2)}%`;
  if (totPnlEl) {
    totPnlEl.innerText = `${overallPnl >= 0 ? '+' : ''}${formatINR(overallPnl)}`;
    totPnlEl.className = `text-base font-extrabold tabular-nums ${maskClass} ${overallPnl >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;
  }
  if (totRetEl) {
    totRetEl.innerText = `${overallRetPct >= 0 ? '+' : ''}${overallRetPct.toFixed(2)}%`;
    totRetEl.className = `text-xs font-extrabold tabular-nums ${overallRetPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;
  }

  const baseList = (closedTrades || []).filter(item => {
    if (!closedSearchQuery) return true;
    const meta = typeof getStockMeta === 'function' ? getStockMeta(item.stock) : { name: '' };
    return String(item.stock || '').toLowerCase().includes(closedSearchQuery) ||
      String(meta.name || '').toLowerCase().includes(closedSearchQuery);
  });

  if (baseList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 dark:text-slate-500 font-medium">No closed trades recorded yet.</td></tr>`;
    const pagEl = document.getElementById('closedPaginationContainer');
    if (pagEl) pagEl.classList.add('hidden');
    return;
  }
  const pagEl = document.getElementById('closedPaginationContainer');
  if (pagEl) pagEl.classList.remove('hidden');

  const sorted = [...baseList].sort((a, b) => {
    const valA = a[closedSort.key];
    const valB = b[closedSort.key];
    if (typeof valA === 'string') {
      return closedSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return closedSort.dir === 'asc' ? valA - valB : valB - valA;
  });

  const totalItems = sorted.length;
  const totalPages = Math.ceil(totalItems / PROD_SUBVIEW_PAGE_SIZE) || 1;
  if (closedTradesCurrentPage > totalPages) closedTradesCurrentPage = totalPages;

  const startIndex = (closedTradesCurrentPage - 1) * PROD_SUBVIEW_PAGE_SIZE;
  const endIndex = Math.min(startIndex + PROD_SUBVIEW_PAGE_SIZE, totalItems);
  const pageSlice = sorted.slice(startIndex, endIndex);

  const infoEl = document.getElementById('closedPageInfo');
  if (infoEl) infoEl.innerText = `Showing ${startIndex + 1} – ${endIndex} of ${totalItems} stocks`;

  const jumpInput = document.getElementById('closedJumpInput');
  const totalLabel = document.getElementById('closedTotalPagesLabel');
  if (jumpInput) {
    jumpInput.value = closedTradesCurrentPage;
    jumpInput.max = totalPages;
  }
  if (totalLabel) totalLabel.innerText = `of ${totalPages}`;

  const prevBtn = document.getElementById('closedPrevBtn');
  const nextBtn = document.getElementById('closedNextBtn');
  if (prevBtn) prevBtn.disabled = closedTradesCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = closedTradesCurrentPage >= totalPages;

  pageSlice.forEach(c => {
    const qty = Number(c.totalQty || 0);
    const avgBuy = qty > 0 ? (Number(c.totalCostBasis || 0) / qty) : 0;
    const avgSell = qty > 0 ? (Number(c.totalProceeds || 0) / qty) : 0;
    const isPos = Number(c.netPnL || 0) >= 0;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
    tr.innerHTML = `
      <td class="py-3 px-4 font-extrabold text-slate-900 dark:text-white">${esc(c.stock)}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${qty}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400">${formatINR(avgBuy)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300">${formatINR(avgSell)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 ${maskClass}">${formatINR(c.totalCostBasis)}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${formatINR(c.totalProceeds)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-extrabold ${isPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isPos ? '+' : ''}${formatINR(c.netPnL)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-extrabold ${isPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isPos ? '+' : ''}${Number(c.retPct || 0).toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  });

  if (tfoot) {
    const isTotPos = overallPnl >= 0;
    tfoot.innerHTML = `
      <tr>
        <td class="py-3 px-4">Total (${baseList.length} ${baseList.length === 1 ? 'Stock' : 'Stocks'})</td>
        <td colspan="3"></td>
        <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${formatINR(overallCost)}</td>
        <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${formatINR(overallProceeds)}</td>
        <td class="py-3 px-4 text-right tabular-nums ${isTotPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isTotPos ? '+' : ''}${formatINR(overallPnl)}</td>
        <td class="py-3 px-4 text-right tabular-nums ${isTotPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isTotPos ? '+' : ''}${overallRetPct.toFixed(2)}%</td>
      </tr>
    `;
  }
}

function handleClosedSort(key) {
  if (closedSort.key === key) {
    closedSort.dir = closedSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    closedSort.key = key;
    closedSort.dir = 'desc';
  }
  closedTradesCurrentPage = 1;
  renderClosedTrades(getCachedEngineData().closedTrades);
  refreshIcons();
}

function prevClosedPage() {
  if (closedTradesCurrentPage > 1) {
    closedTradesCurrentPage--;
    renderClosedTrades(getCachedEngineData().closedTrades);
  }
}

function nextClosedPage() {
  const totalPages = Math.ceil(getCachedEngineData().closedTrades.length / PROD_SUBVIEW_PAGE_SIZE);
  if (closedTradesCurrentPage < totalPages) {
    closedTradesCurrentPage++;
    renderClosedTrades(getCachedEngineData().closedTrades);
  }
}

function jumpToClosedPage(val) {
  const totalPages = Math.ceil(getCachedEngineData().closedTrades.length / PROD_SUBVIEW_PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  closedTradesCurrentPage = target;
  renderClosedTrades(getCachedEngineData().closedTrades);
}

/* ---------------- FINANCIAL YEAR P&L (FIFO) ---------------- */
function renderFY(fyRealized) {
  const tbody = document.getElementById('fySummaryTableBody');
  const tfoot = document.getElementById('fySummaryTableFooter');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (tfoot) tfoot.innerHTML = '';

  const engineData = getCachedEngineData();
  const allClosedLots = Array.isArray(engineData.closedLots) ? engineData.closedLots : (Array.isArray(engineData.taxClosedLots) ? engineData.taxClosedLots : []);
  const maskClass = getMaskClass('fyBreakdown');
  const activeFy = getFinancialYear(todayLocalISO());

  const fyTradeCountMap = {};
  allClosedLots.forEach(lot => {
    const fy = lot.fy || (lot.sellDate ? getFinancialYear(lot.sellDate) : activeFy);
    fyTradeCountMap[fy] = (fyTradeCountMap[fy] || 0) + 1;
  });

  const fys = Object.keys(fyRealized || {}).sort().reverse();
  let sumCost = 0;
  let sumProceeds = 0;
  let sumGain = 0;
  let sumClosedTrades = 0;

  fys.forEach(fy => {
    const item = fyRealized[fy] || {};
    const costVal = Number(item.costBasis ?? item.cost ?? 0);
    const procVal = Number(item.sellProceeds ?? item.proceeds ?? 0);
    const gainVal = Number(item.gain ?? 0);
    const tradeCnt = Number(item.closedTradeCount ?? fyTradeCountMap[fy] ?? 0);
    sumCost += costVal;
    sumProceeds += procVal;
    sumGain += gainVal;
    sumClosedTrades += tradeCnt;
  });

  const overallRetPct = sumCost > 0 ? (sumGain / sumCost) * 100 : 0;

  const totPnlEl = document.getElementById('fyKpiTotalPnl');
  const yrsEl = document.getElementById('fyKpiYearsCount');
  const tradesEl = document.getElementById('fyKpiClosedTradesCount');
  const retEl = document.getElementById('fyKpiOverallReturn');

  if (totPnlEl) {
    totPnlEl.innerText = formatINR(sumGain);
    totPnlEl.className = `text-xl sm:text-2xl font-extrabold tabular-nums leading-tight ${maskClass} ${sumGain >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;
  }
  if (yrsEl) yrsEl.innerText = String(fys.length);
  if (tradesEl) tradesEl.innerText = String(sumClosedTrades);
  if (retEl) {
    retEl.innerText = `${overallRetPct >= 0 ? '+' : ''}${overallRetPct.toFixed(2)}%`;
    retEl.className = `text-base font-extrabold tabular-nums leading-tight ${overallRetPct >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;
  }

  if (fys.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400 dark:text-slate-500 font-medium">No realized gains recorded across any Financial Year yet.</td></tr>`;
    return;
  }

  fys.forEach(fy => {
    const item = fyRealized[fy] || {};
    const costVal = Number(item.costBasis ?? item.cost ?? 0);
    const procVal = Number(item.sellProceeds ?? item.proceeds ?? 0);
    const gainVal = Number(item.gain ?? 0);
    const tradeCnt = Number(item.closedTradeCount ?? fyTradeCountMap[fy] ?? 0);
    const isPos = gainVal >= 0;
    const retPct = costVal > 0 ? (gainVal / costVal) * 100 : 0;
    const isCurrent = fy === activeFy;

    const tr = document.createElement('tr');
    tr.className = isCurrent
      ? 'bg-blue-50/45 dark:bg-blue-950/20 hover:bg-blue-50/80 dark:hover:bg-blue-950/35 transition-colors'
      : 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 transition-colors';
    tr.innerHTML = `
      <td class="py-3 px-4 font-extrabold text-slate-900 dark:text-white">
        <div class="flex items-center space-x-2">
          <span>${esc(fy)}</span>
          ${isCurrent ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">Current FY</span>' : ''}
        </div>
      </td>
      <td class="py-3 px-4 text-center tabular-nums font-semibold ${maskClass}">${tradeCnt}</td>
      <td class="py-3 px-4 text-right tabular-nums ${maskClass}">${formatINR(costVal)}</td>
      <td class="py-3 px-4 text-right tabular-nums ${maskClass}">${formatINR(procVal)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-extrabold ${isPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
        ${isPos ? '+' : ''}${formatINR(gainVal)}
      </td>
      <td class="py-3 px-4 text-right tabular-nums font-extrabold ${isPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
        ${isPos ? '+' : ''}${retPct.toFixed(2)}%
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (tfoot) {
    const isTotPos = sumGain >= 0;
    tfoot.innerHTML = `
      <tr>
        <td class="py-3 px-4">Total</td>
        <td class="py-3 px-4 text-center tabular-nums ${maskClass}">${sumClosedTrades}</td>
        <td class="py-3 px-4 text-right tabular-nums ${maskClass}">${formatINR(sumCost)}</td>
        <td class="py-3 px-4 text-right tabular-nums ${maskClass}">${formatINR(sumProceeds)}</td>
        <td class="py-3 px-4 text-right tabular-nums ${isTotPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isTotPos ? '+' : ''}${formatINR(sumGain)}</td>
        <td class="py-3 px-4 text-right tabular-nums ${isTotPos ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isTotPos ? '+' : ''}${overallRetPct.toFixed(2)}%</td>
      </tr>
    `;
  }
}

/* ---------------- TRADEBOOK & CASH LEDGER ---------------- */
function getFilteredLedgerEntries(ledgerEntries) {
  let list = Array.isArray(ledgerEntries) ? [...ledgerEntries].reverse() : [];
  if (ledgerFilters.account !== 'ALL') {
    list = list.filter(tx => (tx.account || '') === ledgerFilters.account);
  }
  if (ledgerFilters.type !== 'ALL') {
    list = list.filter(tx => String(tx.type || '').toUpperCase() === ledgerFilters.type);
  }
  if (ledgerFilters.fy !== 'ALL') {
    list = list.filter(tx => tx.date && getFinancialYear(tx.date) === ledgerFilters.fy);
  }
  if (ledgerFilters.dateRange !== 'ALL') {
    list = list.filter(tx => isWithinDateRange(tx.date, ledgerFilters.dateRange));
  }
  if (!ledgerSearchTerm) return list;
  return list.filter(tx =>
    (tx.stock && tx.stock.toLowerCase().includes(ledgerSearchTerm)) ||
    (tx.type && tx.type.toLowerCase().includes(ledgerSearchTerm)) ||
    (tx.account && tx.account.toLowerCase().includes(ledgerSearchTerm)) ||
    (tx.remarks && tx.remarks.toLowerCase().includes(ledgerSearchTerm))
  );
}

function handleLedgerSearch() {
  ledgerSearchTerm = (document.getElementById('ledgerSearchInput').value || '').toLowerCase().trim();
  ledgerCurrentPage = 1;
  renderLedger(getCachedEngineData().ledgerEntries);
}

function applyLedgerFilters() {
  const acctEl = document.getElementById('ledgerAccountFilter');
  const typeEl = document.getElementById('ledgerTypeFilter');
  const fyEl = document.getElementById('ledgerFyFilter');
  const dateEl = document.getElementById('ledgerDateFilter');
  ledgerFilters.account = acctEl ? acctEl.value : 'ALL';
  ledgerFilters.type = typeEl ? typeEl.value : 'ALL';
  ledgerFilters.fy = fyEl ? fyEl.value : 'ALL';
  ledgerFilters.dateRange = dateEl ? dateEl.value : 'ALL';
  ledgerCurrentPage = 1;
  renderLedger(getCachedEngineData().ledgerEntries);
  refreshIcons();
}

function toggleLedgerSort(key) {
  if (ledgerFilters.sortKey === key) {
    ledgerFilters.sortDir = ledgerFilters.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    ledgerFilters.sortKey = key;
    ledgerFilters.sortDir = key === 'date' ? 'desc' : 'asc';
  }
  renderLedger(getCachedEngineData().ledgerEntries);
}

function renderLedger(ledgerEntries) {
  const tbody = document.getElementById('txTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const engineData = getCachedEngineData();
  populateProdSubViewFilters(engineData);

  const maskClass = getMaskClass('ledger');
  let list = getFilteredLedgerEntries(ledgerEntries);

  if (ledgerFilters.sortKey) {
    const k = ledgerFilters.sortKey;
    const dir = ledgerFilters.sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => String(a[k] || '').localeCompare(String(b[k] || '')) * dir);
  }

  const badgeEl = document.getElementById('ledgerCountBadge');
  if (badgeEl) badgeEl.innerText = `${list.length} Entries`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-medium">No matching transactions found.</td></tr>`;
    const pagEl = document.getElementById('ledgerPaginationContainer');
    if (pagEl) pagEl.classList.add('hidden');
    return;
  }
  const pagEl = document.getElementById('ledgerPaginationContainer');
  if (pagEl) pagEl.classList.remove('hidden');

  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / PROD_SUBVIEW_PAGE_SIZE) || 1;
  if (ledgerCurrentPage > totalPages) ledgerCurrentPage = totalPages;

  const startIndex = (ledgerCurrentPage - 1) * PROD_SUBVIEW_PAGE_SIZE;
  const endIndex = Math.min(startIndex + PROD_SUBVIEW_PAGE_SIZE, totalItems);
  const pageSlice = list.slice(startIndex, endIndex);

  const infoEl = document.getElementById('ledgerPageInfo');
  if (infoEl) infoEl.innerText = `Showing ${startIndex + 1} – ${endIndex} of ${totalItems} entries`;

  const jumpInput = document.getElementById('ledgerJumpInput');
  const totalLabel = document.getElementById('ledgerTotalPagesLabel');
  if (jumpInput) {
    jumpInput.value = ledgerCurrentPage;
    jumpInput.max = totalPages;
  }
  if (totalLabel) totalLabel.innerText = `of ${totalPages}`;

  const prevBtn = document.getElementById('ledgerPrevBtn');
  const nextBtn = document.getElementById('ledgerNextBtn');
  if (prevBtn) prevBtn.disabled = ledgerCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = ledgerCurrentPage >= totalPages;

  const typeColorMap = {
    'BUY': 'text-blue-700 dark:text-blue-400 font-bold',
    'SELL': 'text-indigo-700 dark:text-indigo-400 font-bold',
    'DEPOSIT': 'text-emerald-700 dark:text-emerald-400 font-bold',
    'WITHDRAWAL': 'text-rose-600 dark:text-rose-400 font-bold',
    'FEES': 'text-rose-600 dark:text-rose-400 font-bold',
    'BONUS': 'text-purple-700 dark:text-purple-400 font-bold',
    'SPLIT': 'text-indigo-700 dark:text-indigo-400 font-bold',
    'DEMERGER': 'text-cyan-700 dark:text-cyan-400 font-bold'
  };

  pageSlice.forEach(tx => {
    const t = String(tx.type || '').toUpperCase();
    const isOutflow = t === 'WITHDRAWAL' || t === 'FEES' || Number(tx.cashOut || 0) > 0;
    const isInflow = t === 'DEPOSIT' || Number(tx.cashIn || 0) > 0;
    const rowTintClass = isOutflow
      ? 'ledger-row-outflow'
      : (isInflow ? 'ledger-row-inflow' : 'ledger-row-trade');

    const tr = document.createElement('tr');
    tr.className = `${rowTintClass} hover:brightness-[0.98] dark:hover:brightness-110 border-b border-slate-100 dark:border-[#222836]/80 transition-colors`;
    tr.innerHTML = `
      <td class="py-2.5 px-4 tabular-nums font-medium text-slate-800 dark:text-slate-200">${esc(tx.date)}</td>
      <td class="py-2.5 px-2 font-medium text-slate-700 dark:text-slate-300">${esc(tx.account || 'Unassigned')}</td>
      <td class="py-2.5 px-3 ${typeColorMap[t] || 'text-slate-700 dark:text-slate-300 font-semibold'}">${esc(t)}</td>
      <td class="py-2.5 px-3 font-bold text-slate-900 dark:text-white">${esc(tx.stock) || '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums">${tx.qty || '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums">${tx.price ? formatINR(tx.price) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-bold text-rose-600 dark:text-rose-400 ${maskClass}">${Number(tx.cashOut || 0) > 0 ? '-' + formatINR(tx.cashOut) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-400 ${maskClass}">${Number(tx.cashIn || 0) > 0 ? '+' + formatINR(tx.cashIn) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-extrabold text-slate-900 dark:text-white ${maskClass}">${formatINR(tx.runningCash)}</td>
      <td class="py-2.5 px-4 text-slate-600 dark:text-slate-300 truncate max-w-xs">${esc(tx.remarks) || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function prevLedgerPage() {
  if (ledgerCurrentPage > 1) {
    ledgerCurrentPage--;
    renderLedger(getCachedEngineData().ledgerEntries);
  }
}

function nextLedgerPage() {
  const list = getFilteredLedgerEntries(getCachedEngineData().ledgerEntries);
  const totalPages = Math.ceil(list.length / PROD_SUBVIEW_PAGE_SIZE) || 1;
  if (ledgerCurrentPage < totalPages) {
    ledgerCurrentPage++;
    renderLedger(getCachedEngineData().ledgerEntries);
  }
}

function jumpToLedgerPage(val) {
  const list = getFilteredLedgerEntries(getCachedEngineData().ledgerEntries);
  const totalPages = Math.ceil(list.length / PROD_SUBVIEW_PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  ledgerCurrentPage = target;
  renderLedger(getCachedEngineData().ledgerEntries);
}

/* ---------------- BANK LEDGER TABLE ---------------- */
function getFilteredBankEntries(bankEntries) {
  let list = Array.isArray(bankEntries) ? [...bankEntries].reverse() : [];
  if (bankLedgerFilters.account !== 'ALL') {
    list = list.filter(b => (b.account || '') === bankLedgerFilters.account);
  }
  if (bankLedgerFilters.type !== 'ALL') {
    list = list.filter(b => String(b.type || '').toUpperCase() === bankLedgerFilters.type);
  }
  if (bankLedgerFilters.fy !== 'ALL') {
    list = list.filter(b => b.date && getFinancialYear(b.date) === bankLedgerFilters.fy);
  }
  if (bankLedgerFilters.dateRange !== 'ALL') {
    list = list.filter(b => isWithinDateRange(b.date, bankLedgerFilters.dateRange));
  }
  if (bankLedgerFilters.search) {
    list = list.filter(b =>
      String(b.remarks || '').toLowerCase().includes(bankLedgerFilters.search) ||
      String(b.account || '').toLowerCase().includes(bankLedgerFilters.search) ||
      String(b.type || '').toLowerCase().includes(bankLedgerFilters.search)
    );
  }
  if (bankLedgerFilters.sortKey) {
    const k = bankLedgerFilters.sortKey;
    const dir = bankLedgerFilters.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => String(a[k] || '').localeCompare(String(b[k] || '')) * dir);
  }
  return list;
}

function applyBankLedgerFilters() {
  const searchEl = document.getElementById('bankLedgerSearchInput');
  const acctEl = document.getElementById('bankAccountFilter');
  const typeEl = document.getElementById('bankTypeFilter');
  const fyEl = document.getElementById('bankFyFilter');
  const dateEl = document.getElementById('bankDateFilter');

  bankLedgerFilters.search = (searchEl ? searchEl.value : '').trim().toLowerCase();
  bankLedgerFilters.account = acctEl ? acctEl.value : 'ALL';
  bankLedgerFilters.type = typeEl ? typeEl.value : 'ALL';
  bankLedgerFilters.fy = fyEl ? fyEl.value : 'ALL';
  bankLedgerFilters.dateRange = dateEl ? dateEl.value : 'ALL';
  bankLedgerCurrentPage = 1;
  renderBankLedger(getCachedEngineData().bankEntries);
  refreshIcons();
}

function toggleBankLedgerSort(key) {
  if (bankLedgerFilters.sortKey === key) {
    bankLedgerFilters.sortDir = bankLedgerFilters.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    bankLedgerFilters.sortKey = key;
    bankLedgerFilters.sortDir = key === 'date' ? 'desc' : 'asc';
  }
  renderBankLedger(getCachedEngineData().bankEntries);
}

function renderBankLedger(bankEntries) {
  const tbody = document.getElementById('bankLedgerTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const engineData = getCachedEngineData();
  populateProdSubViewFilters(engineData);

  const maskClass = getMaskClass('bankLedger');
  const list = getFilteredBankEntries(bankEntries);

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-medium">No bank ledger transactions recorded yet.</td></tr>`;
    const pagEl = document.getElementById('bankLedgerPaginationContainer');
    if (pagEl) pagEl.classList.add('hidden');
    return;
  }
  const pagEl = document.getElementById('bankLedgerPaginationContainer');
  if (pagEl) pagEl.classList.remove('hidden');

  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / PROD_SUBVIEW_PAGE_SIZE) || 1;
  if (bankLedgerCurrentPage > totalPages) bankLedgerCurrentPage = totalPages;

  const startIndex = (bankLedgerCurrentPage - 1) * PROD_SUBVIEW_PAGE_SIZE;
  const endIndex = Math.min(startIndex + PROD_SUBVIEW_PAGE_SIZE, totalItems);
  const pageSlice = list.slice(startIndex, endIndex);

  const infoEl = document.getElementById('bankLedgerPageInfo');
  if (infoEl) infoEl.innerText = `Showing ${startIndex + 1} – ${endIndex} of ${totalItems} entries`;

  const jumpInput = document.getElementById('bankLedgerJumpInput');
  const totalLabel = document.getElementById('bankLedgerTotalPagesLabel');
  if (jumpInput) {
    jumpInput.value = bankLedgerCurrentPage;
    jumpInput.max = totalPages;
  }
  if (totalLabel) totalLabel.innerText = `of ${totalPages}`;

  const prevBtn = document.getElementById('bankLedgerPrevBtn');
  const nextBtn = document.getElementById('bankLedgerNextBtn');
  if (prevBtn) prevBtn.disabled = bankLedgerCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = bankLedgerCurrentPage >= totalPages;

  pageSlice.forEach(b => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
    tr.innerHTML = `
      <td class="py-2.5 px-4 tabular-nums font-medium text-slate-800 dark:text-slate-200">${esc(b.date)}</td>
      <td class="py-2.5 px-2 font-medium text-slate-700 dark:text-slate-300">${esc(b.account || 'Unassigned')}</td>
      <td class="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">${esc(b.type)}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-400 ${maskClass}">${Number(b.deposit || 0) > 0 ? formatINR(b.deposit) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-bold text-rose-600 dark:text-rose-400 ${maskClass}">${Number(b.withdrawal || 0) > 0 ? formatINR(b.withdrawal) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-extrabold text-slate-900 dark:text-white ${maskClass}">${formatINR(b.corpus)}</td>
      <td class="py-2.5 px-4 text-slate-600 dark:text-slate-300">${esc(b.remarks) || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function prevBankLedgerPage() {
  if (bankLedgerCurrentPage > 1) {
    bankLedgerCurrentPage--;
    renderBankLedger(getCachedEngineData().bankEntries);
  }
}

function nextBankLedgerPage() {
  const list = getFilteredBankEntries(getCachedEngineData().bankEntries);
  const totalPages = Math.ceil(list.length / PROD_SUBVIEW_PAGE_SIZE);
  if (bankLedgerCurrentPage < totalPages) {
    bankLedgerCurrentPage++;
    renderBankLedger(getCachedEngineData().bankEntries);
  }
}

function jumpToBankLedgerPage(val) {
  const list = getFilteredBankEntries(getCachedEngineData().bankEntries);
  const totalPages = Math.ceil(list.length / PROD_SUBVIEW_PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  bankLedgerCurrentPage = target;
  renderBankLedger(getCachedEngineData().bankEntries);
}

/* ---------------- TAB 7: PURIFICATION & DONATIONS VIEW ---------------- */
function togglePurificationTableAccordion() {
  const container = document.getElementById('purifTableContainer');
  const chevron = document.getElementById('purifAccordionChevron');
  if (!container) return;
  const isHidden = container.classList.contains('hidden');
  container.classList.toggle('hidden', !isHidden);
  if (chevron) chevron.classList.toggle('rotate-180', isHidden);
}

function getFilteredProfitablePurificationLots(engineData) {
  const source = engineData || getCachedEngineData();
  const acctFilter = currentPurificationAccountFilter || 'ALL';
  const fyFilter = currentPurificationFyFilter || 'ALL';

  return (source.purificationLots || []).filter(lot => {
    if (Number(lot.gain || 0) <= 0) return false;
    if (acctFilter !== 'ALL' && lot.account !== acctFilter) return false;
    if (fyFilter !== 'ALL' && lot.fy !== fyFilter) return false;
    return true;
  });
}

function prevPurifPage() {
  if (purificationLotsCurrentPage > 1) {
    purificationLotsCurrentPage--;
    renderPurificationView(getCachedEngineData());
  }
}

function nextPurifPage() {
  const list = getFilteredProfitablePurificationLots(getCachedEngineData());
  const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
  if (purificationLotsCurrentPage < totalPages) {
    purificationLotsCurrentPage++;
    renderPurificationView(getCachedEngineData());
  }
}

function jumpToPurifPage(val) {
  const list = getFilteredProfitablePurificationLots(getCachedEngineData());
  const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  purificationLotsCurrentPage = target;
  renderPurificationView(getCachedEngineData());
}

function populatePurificationFyOptions(purificationLots) {
  const select = document.getElementById('purificationFyFilter');
  if (!select) return;

  const fySet = new Set();
  (purificationLots || []).forEach(lot => { if (lot.fy) fySet.add(lot.fy); });
  (donations || []).forEach(d => { if (d.date) fySet.add(getFinancialYear(d.date)); });

  const sortedFys = Array.from(fySet).sort().reverse();
  const prevVal = currentPurificationFyFilter || 'ALL';

  select.innerHTML = `<option value="ALL">All Financial Years</option>` +
    sortedFys.map(fy => `<option value="${esc(fy)}">${esc(fy)}</option>`).join('');

  select.value = (prevVal === 'ALL' || fySet.has(prevVal)) ? prevVal : 'ALL';
  currentPurificationFyFilter = select.value;
}

function setPurificationFyFilter(fy) {
  currentPurificationFyFilter = fy || 'ALL';
  purificationLotsCurrentPage = 1;
  renderPurificationView(getCachedEngineData());
  refreshIcons();
}

function setPurificationAccountFilter(acct) {
  currentPurificationAccountFilter = acct;
  purificationLotsCurrentPage = 1;
  ['ALL', ...CALIB_ACCOUNTS].forEach(key => {
    const btn = document.getElementById(`purifAcctBtn-${key}`);
    if (!btn) return;
    if (key === acct) {
      btn.className = 'px-2.5 py-1 rounded-md transition-all bg-white dark:bg-[#131722] text-slate-900 dark:text-white shadow-2xs font-semibold';
    } else {
      btn.className = 'px-2.5 py-1 rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium';
    }
  });
  renderPurificationView(getCachedEngineData());
  refreshIcons();
}

function renderPurificationView(data) {
  const engineData = data || getCachedEngineData();
  const maskClass = getMaskClass('purification');

  const acctFilter = currentPurificationAccountFilter || 'ALL';
  const fyFilter = currentPurificationFyFilter || 'ALL';

  const profitableLots = getFilteredProfitablePurificationLots(engineData);

  const filteredDonations = (donations || []).filter(d => {
    if (acctFilter !== 'ALL' && d.account !== acctFilter) return false;
    if (fyFilter !== 'ALL' && getFinancialYear(d.date) !== fyFilter) return false;
    return true;
  });

  let totalPositiveGain = 0;
  let totalPurifDue = 0;
  profitableLots.forEach(lot => {
    totalPositiveGain += Number(lot.gain || 0);
    totalPurifDue += Number(lot.purificationDue || 0);
  });

  const totalDonated = filteredDonations.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const remainingDue = totalPurifDue - totalDonated;

  const dueEl = document.getElementById('purifTotalDueVal');
  const profitSubEl = document.getElementById('purifTotalProfitSub');
  if (dueEl) {
    dueEl.innerText = formatINR(totalPurifDue);
    dueEl.className = `text-2xl font-extrabold text-amber-600 dark:text-amber-400 tabular-nums ${maskClass}`;
  }
  if (profitSubEl) {
    profitSubEl.innerHTML = `From <span class="${maskClass} font-semibold">${formatINR(totalPositiveGain)}</span> positive realized profit`;
  }

  const donatedEl = document.getElementById('purifTotalDonatedVal');
  const countSubEl = document.getElementById('purifDonationCountSub');
  if (donatedEl) {
    donatedEl.innerText = formatINR(totalDonated);
    donatedEl.className = `text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums ${maskClass}`;
  }
  if (countSubEl) {
    countSubEl.innerText = `${filteredDonations.length} donation ${filteredDonations.length === 1 ? 'entry' : 'entries'} recorded`;
  }

  const remEl = document.getElementById('purifRemainingVal');
  const statusSubEl = document.getElementById('purifStatusSub');
  if (remEl) {
    if (remainingDue > 0.005) {
      remEl.innerText = formatINR(remainingDue);
      remEl.className = `text-2xl font-extrabold text-rose-600 dark:text-rose-400 tabular-nums ${maskClass}`;
      if (statusSubEl) statusSubEl.innerText = 'Pending purification donation balance';
    } else if (remainingDue < -0.005) {
      remEl.innerText = `+${formatINR(Math.abs(remainingDue))}`;
      remEl.className = `text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums ${maskClass}`;
      if (statusSubEl) statusSubEl.innerText = 'Surplus donated above obligation';
    } else {
      remEl.innerText = '₹0.00';
      remEl.className = `text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums ${maskClass}`;
      if (statusSubEl) statusSubEl.innerText = 'Fully purified & settled';
    }
  }

  const lotsBadge = document.getElementById('purifLotsCountBadge');
  if (lotsBadge) lotsBadge.innerText = `${profitableLots.length} Profitable Lots`;

  const lotsTbody = document.getElementById('purificationLotsTableBody');
  const pagContainer = document.getElementById('purifPaginationContainer');
  if (lotsTbody) {
    lotsTbody.innerHTML = '';
    const displayLots = [...profitableLots].reverse();

    if (displayLots.length === 0) {
      lotsTbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400 dark:text-slate-500 font-medium">No profit-making closed SELL lots matching the selected filter.</td></tr>`;
      if (pagContainer) pagContainer.classList.add('hidden');
    } else {
      if (pagContainer) pagContainer.classList.remove('hidden');

      const totalItems = displayLots.length;
      const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
      if (purificationLotsCurrentPage > totalPages) purificationLotsCurrentPage = totalPages;

      const startIndex = (purificationLotsCurrentPage - 1) * PAGE_SIZE;
      const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
      const pageSlice = displayLots.slice(startIndex, endIndex);

      const pageInfoEl = document.getElementById('purifPageInfo');
      if (pageInfoEl) pageInfoEl.innerText = `Showing ${startIndex + 1}–${endIndex} of ${totalItems} profitable entries`;

      const jumpInput = document.getElementById('purifJumpInput');
      const totalLabel = document.getElementById('purifTotalPagesLabel');
      if (jumpInput) {
        jumpInput.value = purificationLotsCurrentPage;
        jumpInput.max = totalPages;
      }
      if (totalLabel) totalLabel.innerText = `of ${totalPages}`;

      const prevBtn = document.getElementById('purifPrevBtn');
      const nextBtn = document.getElementById('purifNextBtn');
      if (prevBtn) prevBtn.disabled = purificationLotsCurrentPage <= 1;
      if (nextBtn) nextBtn.disabled = purificationLotsCurrentPage >= totalPages;

      pageSlice.forEach(lot => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
        tr.innerHTML = `
          <td class="py-2.5 px-3 tabular-nums text-slate-500 dark:text-slate-400">${esc(lot.sellDate)}</td>
          <td class="py-2.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#222836]">${esc(lot.account)}</span></td>
          <td class="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">${esc(lot.stock)}</td>
          <td class="py-2.5 px-2 text-right tabular-nums">${lot.qty}</td>
          <td class="py-2.5 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 ${maskClass}">${formatINR(lot.costBasis)}</td>
          <td class="py-2.5 px-3 text-right tabular-nums ${maskClass}">${formatINR(lot.proceeds)}</td>
          <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 ${maskClass}">+${formatINR(lot.gain)}</td>
          <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-teal-600 dark:text-teal-400">${Number(lot.debtToAsset || 0).toFixed(2)}%</td>
          <td class="py-2.5 px-3 text-right tabular-nums font-bold text-amber-600 dark:text-amber-400 ${maskClass}">${formatINR(lot.purificationDue)}</td>
        `;
        lotsTbody.appendChild(tr);
      });
    }
  }

  const donTbody = document.getElementById('donationsLogTableBody');
  if (donTbody) {
    donTbody.innerHTML = '';
    const sortedDonations = [...filteredDonations].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedDonations.length === 0) {
      donTbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400 dark:text-slate-500 font-medium">No donations recorded yet. Click "+ Record Donation" to log a contribution.</td></tr>`;
    } else {
      sortedDonations.forEach(don => {
        const donId = esc(String(don.id || ''));
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
        tr.innerHTML = `
          <td class="py-2.5 px-3 tabular-nums text-slate-500 dark:text-slate-400">${esc(don.date)}</td>
          <td class="py-2.5 px-3"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#222836]">${esc(don.account)}</span></td>
          <td class="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400 ${maskClass}">${formatINR(don.amount)}</td>
          <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300">${esc(don.remarks)}</td>
          <td class="py-2.5 px-3 text-center">
            <button data-donation-delete-id="${donId}" class="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 text-[11px] font-bold transition">Delete</button>
          </td>
        `;
        donTbody.appendChild(tr);
      });
    }
  }
}

// Event delegation for Deleting a Donation record (PIN-gated)
document.addEventListener('click', (e) => {
  const delBtn = e.target.closest('[data-donation-delete-id]');
  if (!delBtn) return;
  const donId = delBtn.dataset.donationDeleteId;
  const targetDon = donations.find(d => String(d.id) === donId);
  if (!targetDon) return;

  requestPinAuthorization(
    'Authorize Donation Deletion',
    `Enter Master PIN to delete donation of ${formatINR(targetDon.amount)} (${targetDon.account}) on ${targetDon.date}`,
    () => {
      const idx = donations.findIndex(d => String(d.id) === String(targetDon.id));
      if (idx >= 0) {
        donations.splice(idx, 1);
      }
      localStorage.setItem(DONATIONS_STORAGE_KEY, JSON.stringify(donations));
      sendToSheet({ action: 'deleteDonation', id: targetDon.id });
      renderPurificationView(getCachedEngineData());
      refreshIcons();
    }
  );
});

function openRecordDonationModal() {
  const modal = document.getElementById('recordDonationModal');
  if (!modal) return;
  document.getElementById('donationForm').reset();
  document.getElementById('donationDate').value = todayLocalISO();

  const acctSelect = document.getElementById('donationAccount');
  if (acctSelect) {
    acctSelect.value = (currentPurificationAccountFilter && currentPurificationAccountFilter !== 'ALL')
      ? currentPurificationAccountFilter
      : '';
  }

  modal.classList.remove('hidden');
  refreshIcons();
}

function closeRecordDonationModal() {
  const modal = document.getElementById('recordDonationModal');
  if (modal) modal.classList.add('hidden');
}

function handleDonationSubmit(e) {
  e.preventDefault();
  const date = document.getElementById('donationDate').value;
  const account = document.getElementById('donationAccount').value.trim();
  const amount = Number(document.getElementById('donationAmount').value || 0);
  const remarks = document.getElementById('donationRemarks').value.trim();

  if (!date || !account || amount <= 0 || !remarks) return;

  const newDonation = {
    id: `DON_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date,
    account,
    amount,
    remarks
  };

  donations.push(newDonation);
  localStorage.setItem(DONATIONS_STORAGE_KEY, JSON.stringify(donations));
  sendToSheet({ action: 'addDonation', donation: newDonation });

  closeRecordDonationModal();
  populatePurificationFyOptions(getCachedEngineData().purificationLots);
  renderPurificationView(getCachedEngineData());
  refreshIcons();
}

/* ---------------- DYNAMIC HEADER LEGEND & VIEW SWITCHER ---------------- */
function getRocRateLabel() {
  const pct = ((typeof ROC_TARGET_MONTHLY_RATE === 'number' ? ROC_TARGET_MONTHLY_RATE : 0.02) * 100)
    .toFixed(2)
    .replace(/\.00$/, '');
  return `${pct}%`;
}

function renderChartLegend() {
  const container = document.getElementById('chartLegendContainer');
  if (!container) return;
  const rateLbl = getRocRateLabel();

  if (currentChartView === 'roc') {
    container.innerHTML = `
      <span class="inline-flex items-center text-slate-600 dark:text-slate-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-blue-600 mr-1.5 ring-2 ring-blue-500/20"></span>Actual Track
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-slate-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-rose-600 mr-1.5 ring-2 ring-rose-500/20"></span>Capital Base
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-slate-300 font-medium">
        <span class="w-2.5 h-0.5 border-t-2 border-dotted border-amber-500 mr-1.5"></span>Pure ${rateLbl} Hurdle
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-slate-300 font-medium">
        <span class="w-2.5 h-0.5 border-t-2 border-dashed border-purple-600 mr-1.5"></span>Extreme Target
      </span>
    `;
  } else {
    container.innerHTML = `
      <span class="inline-flex items-center text-slate-600 dark:text-slate-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-blue-600 mr-1.5 ring-2 ring-blue-500/20"></span>Net Worth
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-slate-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-rose-600 mr-1.5 ring-2 ring-rose-500/20"></span>My Capital
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-slate-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-emerald-600 mr-1.5 ring-2 ring-emerald-500/20"></span>Profit
      </span>
    `;
  }
}

function toggleChartViewDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('chartViewDropdownMenu');
  const chevron = document.getElementById('chartViewChevron');
  if (!menu) return;

  const isHidden = menu.classList.contains('hidden');
  closeAllTopDropdowns();
  menu.classList.toggle('hidden', !isHidden);
  if (chevron) chevron.classList.toggle('rotate-180', isHidden);
}

function closeChartViewDropdown() {
  const menu = document.getElementById('chartViewDropdownMenu');
  const chevron = document.getElementById('chartViewChevron');
  if (menu) menu.classList.add('hidden');
  if (chevron) chevron.classList.remove('rotate-180');
}

function switchChartView(view) {
  currentChartView = view;
  const label = document.getElementById('currentChartViewLabel');
  if (label) {
    label.innerText = view === 'roc' ? 'Monthly RoC Curve' : 'Performance Trajectory';
  }
  closeChartViewDropdown();
  renderChartLegend();
  const data = getCachedEngineData();
  renderChart(data);
  renderCurveInsights(data);
  renderTtmTable(data);
}

/* ---------------- TTM BREAKDOWN ACCORDION ---------------- */
function toggleTtmTableAccordion() {
  const container = document.getElementById('ttmTableContainer');
  const chevron = document.getElementById('ttmAccordionChevron');
  const isHidden = container.classList.contains('hidden');
  container.classList.toggle('hidden', !isHidden);
  if (chevron) chevron.classList.toggle('rotate-180', isHidden);
}

function renderTtmTable(computed) {
  const thead = document.getElementById('ttmTableHead');
  const tbody = document.getElementById('ttmTableBody');
  const titleEl = document.getElementById('ttmAccordionTitle');
  if (!thead || !tbody) return;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  const maskClass = getMaskClass('chart');
  const fourCurvePoints = computeRocFourCurves(computed);

  if (currentChartView === 'roc') {
    const rateLbl = getRocRateLabel();
    if (titleEl) titleEl.innerText = 'Monthly RoC & 4-Curve Milestone Ledger';

    thead.innerHTML = `
      <tr>
        <th class="py-2.5 px-3 font-bold">Checkpoint</th>
        <th class="py-2.5 px-3 text-right font-bold">Initial Capital</th>
        <th class="py-2.5 px-3 text-right font-bold">Close Value</th>
        <th class="py-2.5 px-3 text-right font-bold">Monthly P&amp;L</th>
        <th class="py-2.5 px-3 text-right font-bold">Monthly RoC</th>
        <th class="py-2.5 px-3 text-right font-bold">Pure ${rateLbl} Target</th>
        <th class="py-2.5 px-3 text-right font-bold">Pure ${rateLbl} Gap</th>
        <th class="py-2.5 px-3 text-right font-bold">Extreme Target</th>
        <th class="py-2.5 px-3 text-right font-bold">Extreme Deficit</th>
        <th class="py-2.5 px-3 text-right font-bold">Recovery %</th>
      </tr>
    `;

    if (!fourCurvePoints || fourCurvePoints.length < 2) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-slate-400 font-bold">Need at least 2 checkpoints to compute Monthly RoC metrics.</td></tr>`;
      return;
    }

    const rows = fourCurvePoints.slice(-13).slice(1).reverse();

    rows.forEach(r => {
      const isPosProfit = r.deltaProfit >= 0;
      const isPosGap = r.pureGap >= 0;
      const isPosRatchet = r.ratchetDeficit >= 0;

      let recoveryPct = 0;
      if (r.ratchetDeficit < 0 && r.actualVal > 0) {
        recoveryPct = (Math.abs(r.ratchetDeficit) / r.actualVal) * 100;
      }

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 font-bold';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-bold text-slate-900 dark:text-white">${esc(r.date)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300 font-bold ${maskClass}">${formatINR(r.startCapital, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-white ${maskClass}">${formatINR(r.actualVal, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPosProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPosProfit ? '+' : ''}${formatINR(r.deltaProfit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPosProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isPosProfit ? '+' : ''}${r.rocPct.toFixed(2)}%
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold text-amber-600 dark:text-amber-400 ${maskClass}">${formatINR(r.pureTarget, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPosGap ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPosGap ? '+' : ''}${formatINR(r.pureGap, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold text-purple-600 dark:text-purple-400 ${maskClass}">${formatINR(r.ratchetTarget, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPosRatchet ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPosRatchet ? '+' : ''}${formatINR(r.ratchetDeficit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold text-purple-600 dark:text-purple-400">
          ${recoveryPct > 0 ? recoveryPct.toFixed(2) + '%' : '—'}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } else {
    if (titleEl) titleEl.innerText = 'Trailing 12-Months (TTM) Performance Ledger';

    thead.innerHTML = `
      <tr>
        <th class="py-2.5 px-3 font-bold">Checkpoint</th>
        <th class="py-2.5 px-3 text-right font-bold">Portfolio Value</th>
        <th class="py-2.5 px-3 text-right font-bold">Net Capital</th>
        <th class="py-2.5 px-3 text-right font-bold">Cumulative P&amp;L</th>
        <th class="py-2.5 px-3 text-right font-bold">Cumulative RoC</th>
        <th class="py-2.5 px-3 text-right font-bold">Period P&amp;L</th>
        <th class="py-2.5 px-3 text-right font-bold">Return %</th>
      </tr>
    `;

    if (!fourCurvePoints || fourCurvePoints.length < 2) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-400 font-bold">Need at least 2 checkpoints to compute trailing monthly deltas.</td></tr>`;
      return;
    }

    const ttmRecords = fourCurvePoints.slice(-13);
    const rows = [];

    for (let i = 1; i < ttmRecords.length; i++) {
      const curr = ttmRecords[i];
      const prev = ttmRecords[i - 1];

      const deltaProfit = curr.profit - prev.profit;
      const monthlyReturnPct = prev.portfolioValue > 0 ? (deltaProfit / prev.portfolioValue) * 100 : 0;
      const cumReturnOnCapPct = curr.netCapital > 0 ? (curr.profit / curr.netCapital) * 100 : 0;

      rows.push({
        date: curr.date,
        portVal: curr.portfolioValue,
        netCap: curr.netCapital,
        deltaProfit,
        monthlyReturnPct,
        cumProfit: curr.profit,
        cumReturnOnCapPct
      });
    }

    rows.reverse().forEach(r => {
      const isPos = r.deltaProfit >= 0;
      const isCumPos = r.cumProfit >= 0;
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 font-bold';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-bold text-slate-900 dark:text-white">${esc(r.date)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold text-slate-700 dark:text-slate-300 ${maskClass}">${formatINR(r.portVal, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold text-slate-500 dark:text-slate-400 ${maskClass}">${formatINR(r.netCap, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isCumPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isCumPos ? '+' : ''}${formatINR(r.cumProfit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isCumPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isCumPos ? '+' : ''}${r.cumReturnOnCapPct.toFixed(2)}%
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPos ? '+' : ''}${formatINR(r.deltaProfit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isPos ? '+' : ''}${r.monthlyReturnPct.toFixed(2)}%
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
}

/* ---------------- MULTI-TAB EXCEL EXPORT (.XLSX) ---------------- */
function exportPortfolioToExcel() {
  if (typeof XLSX === 'undefined') return;

  const data = getCachedEngineData();
  const wb = XLSX.utils.book_new();

  function formatWorksheet(ws, colWidths) {
    if (!ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);

    if (colWidths) {
      ws['!cols'] = colWidths.map(w => ({ wch: w }));
    }

    const thinBorder = {
      top: { style: "thin", color: { rgb: "CBD5E1" } },
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
      left: { style: "thin", color: { rgb: "CBD5E1" } },
      right: { style: "thin", color: { rgb: "CBD5E1" } }
    };

    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        ws[cellAddress].s.border = thinBorder;
        ws[cellAddress].s.alignment = {
          wrapText: true,
          vertical: "center",
          horizontal: R === 0 ? "center" : "left"
        };

        if (R === 0) {
          ws[cellAddress].s.font = { name: "Inter", sz: 11, bold: true, color: { rgb: "FFFFFF" } };
          ws[cellAddress].s.fill = { fgColor: { rgb: "0F172A" } };
        } else {
          ws[cellAddress].s.font = { name: "Inter", sz: 10, color: { rgb: "1E293B" } };
        }

        if (typeof ws[cellAddress].v === 'number') {
          ws[cellAddress].z = "0.00";
        }
      }
    }
  }

  const summaryRows = [
    { "Metric": "Total Net Worth", "Value": Number(data.netWorth) },
    { "Metric": "Contributed Corpus (Net Invested)", "Value": Number(data.netInvested) },
    { "Metric": "Total Portfolio Valuation", "Value": Number(data.totalPortfolioVal) },
    { "Metric": "Total Cash Balance", "Value": Number(data.cashBalance) },
    { "Metric": "Lifetime P&L", "Value": Number(data.lifetimePnL) },
    { "Metric": "Lifetime P&L (%)", "Value": Number(data.lifetimePnLPct.toFixed(2)) },
    { "Metric": "Annualized XIRR (%)", "Value": data.xirrValue !== null ? Number(data.xirrValue.toFixed(2)) : 0 }
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  formatWorksheet(wsSummary, [38, 22]);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary Dashboard");

  const holdingsRows = data.holdings.map(h => ({
    "Stock Ticker": h.stock,
    "Quantity": Number(h.qty),
    "Average Cost (WAP)": Number(h.wap),
    "Current LTP": Number(h.ltp),
    "Invested Value": Number(h.investedVal),
    "Current Value": Number(h.currentVal),
    "Weight (%)": Number(h.weightPct.toFixed(2)),
    "Unrealized P&L": Number(h.pnlVal),
    "Return (%)": Number(h.pnlPct.toFixed(2))
  }));
  const wsHoldings = XLSX.utils.json_to_sheet(holdingsRows);
  formatWorksheet(wsHoldings, [16, 12, 18, 14, 16, 16, 12, 16, 12]);
  XLSX.utils.book_append_sheet(wb, wsHoldings, "Active Holdings");

  const closedRows = data.closedTrades.map(c => ({
    "Stock Ticker": c.stock,
    "Total Sold Qty": Number(c.totalQty),
    "Total Cost Basis": Number(c.totalCostBasis),
    "Total Proceeds": Number(c.totalProceeds),
    "Net Realized P&L": Number(c.netPnL),
    "Realized Return (%)": Number(c.retPct.toFixed(2))
  }));
  const wsClosed = XLSX.utils.json_to_sheet(closedRows);
  formatWorksheet(wsClosed, [16, 16, 18, 18, 18, 16]);
  XLSX.utils.book_append_sheet(wb, wsClosed, "Closed Trades");

  const tradebookRows = data.ledgerEntries.map(l => ({
    "Date": l.date,
    "Account": l.account,
    "Type": l.type,
    "Stock": l.stock,
    "Qty": Number(l.qty || 0),
    "Price": Number(l.price || 0),
    "Cash Out": Number(l.cashOut || 0),
    "Cash In": Number(l.cashIn || 0),
    "Running Cash Balance": Number(l.runningCash || 0),
    "Debt_To_Asset": l.debtToAsset,
    "Remarks": l.remarks
  }));
  const wsTradebook = XLSX.utils.json_to_sheet(tradebookRows);
  formatWorksheet(wsTradebook, [14, 12, 14, 16, 12, 14, 14, 14, 20, 15, 25]);
  XLSX.utils.book_append_sheet(wb, wsTradebook, "Tradebook & Ledger");

  const taxRows = data.taxClosedLots.map(t => ({
    "Sell Date": t.sellDate,
    "Buy Date (FIFO)": t.buyDate,
    "Account": t.account,
    "Stock": t.stock,
    "Qty": Number(t.qty),
    "Holding Days": Number(t.days),
    "Tax Class": t.isLtcg ? 'LTCG' : 'STCG',
    "Cost Basis": Number(t.costBasis),
    "Proceeds": Number(t.proceeds),
    "Realized Gain/Loss": Number(t.gain),
    "Quarter": t.quarter,
    "Financial Year": t.fy
  }));
  const wsTax = XLSX.utils.json_to_sheet(taxRows);
  formatWorksheet(wsTax, [14, 14, 12, 16, 10, 14, 12, 16, 16, 18, 12, 14]);
  XLSX.utils.book_append_sheet(wb, wsTax, "Tax Audit Trail");

  const bankRows = data.bankEntries.map(b => ({
    "Date": b.date,
    "Account": b.account,
    "Type": b.type,
    "Deposit In": Number(b.deposit || 0),
    "Withdrawal Out": Number(b.withdrawal || 0),
    "Net Contributed Corpus": Number(b.corpus || 0),
    "Remarks": b.remarks
  }));
  const wsBank = XLSX.utils.json_to_sheet(bankRows);
  formatWorksheet(wsBank, [14, 12, 14, 16, 16, 22, 25]);
  XLSX.utils.book_append_sheet(wb, wsBank, "Bank Ledger");

  const fourCurvePoints = computeRocFourCurves(data);
  const trajectoryHistory = fourCurvePoints.map(p => ({
    "Checkpoint Date": p.date,
    "Portfolio Value": Number(p.portfolioValue || 0),
    "Net Capital": Number(p.netCapital || 0),
    "Profit": Number(p.profit || 0)
  }));
  const wsTrajectory = XLSX.utils.json_to_sheet(trajectoryHistory);
  formatWorksheet(wsTrajectory, [18, 18, 16, 16]);
  XLSX.utils.book_append_sheet(wb, wsTrajectory, "Performance Trajectory");

  const rateLbl = getRocRateLabel();
  const rocRows = fourCurvePoints.map(p => ({
    "Checkpoint": p.date,
    "Start Capital": Number(p.startCapital),
    "Actual Value": Number(p.actualVal),
    "Net Capital Base": Number(p.netCapBase),
    "Monthly P&L (Delta Profit)": Number(p.deltaProfit),
    "Monthly RoC (%)": Number(p.rocPct.toFixed(2)),
    [`Pure ${rateLbl} Target`]: Number(p.pureTarget),
    [`Pure ${rateLbl} Gap`]: Number(p.pureGap),
    "Extreme Target": p.ratchetTarget !== null ? Number(p.ratchetTarget) : 0,
    "Extreme Deficit": Number(p.ratchetDeficit)
  }));
  const wsRoc = XLSX.utils.json_to_sheet(rocRows);
  formatWorksheet(wsRoc, [16, 16, 16, 16, 22, 16, 16, 16, 16, 16]);
  XLSX.utils.book_append_sheet(wb, wsRoc, "Monthly RoC & Extreme Target");

  const purifRows = (data.purificationLots || [])
    .filter(p => Number(p.gain || 0) > 0)
    .map(p => ({
      "Sell Date": p.sellDate,
      "Account": p.account,
      "Stock": p.stock,
      "Qty": Number(p.qty),
      "Cost Basis": Number(p.costBasis),
      "Proceeds": Number(p.proceeds),
      "Realized Profit": Number(p.gain),
      "Debt to Asset (%)": Number(p.debtToAsset || 0),
      "Purification Due": Number(p.purificationDue || 0),
      "Financial Year": p.fy
    }));
  const wsPurif = XLSX.utils.json_to_sheet(purifRows);
  formatWorksheet(wsPurif, [14, 12, 16, 10, 16, 16, 18, 16, 18, 14]);
  XLSX.utils.book_append_sheet(wb, wsPurif, "Purification Ledger");

  const donRows = (donations || []).map(d => ({
    "Date": d.date,
    "Account": d.account,
    "Donated Amount": Number(d.amount || 0),
    "Remarks": d.remarks
  }));
  const wsDon = XLSX.utils.json_to_sheet(donRows);
  formatWorksheet(wsDon, [14, 14, 18, 32]);
  XLSX.utils.book_append_sheet(wb, wsDon, "Purification Donations");

  XLSX.writeFile(wb, `MyFolioAI_Portfolio_Report_${todayLocalISO()}.xlsx`);
}

/* ---------------- CUSTOM HTML TOOLTIP & IN-PLACE CHART RENDERER ---------------- */
function customHtmlTooltipHandler(context) {
  const { chart, tooltip } = context;
  const tooltipEl = document.getElementById('chartCustomTooltip');
  if (!tooltipEl) return;

  if (tooltip.opacity === 0) {
    tooltipEl.style.opacity = '0';
    return;
  }

  const isMasked = !!tabMaskStates.chart;
  const maskClass = isMasked ? 'privacy-blurred' : '';

  if (tooltip.body) {
    const titleLines = tooltip.title || [];
    let innerHtml = '<div class="space-y-1.5">';

    titleLines.forEach(title => {
      innerHtml += `<div class="font-bold text-slate-900 dark:text-white pb-1 border-b border-slate-100 dark:border-[#222836] text-[11.5px]">${esc(title)}</div>`;
    });

    innerHtml += '<div class="space-y-1 pt-0.5">';
    tooltip.dataPoints.forEach(dp => {
      const dataset = chart.data.datasets[dp.datasetIndex];
      const color = dataset.borderColor || '#2563eb';
      const label = dataset.label || '';
      const rawVal = dp.raw || 0;
      const formattedVal = formatINR(rawVal, 0);

      let variationHtml = '';
      if ((label === 'Profit' || label === 'Actual Track' || label === 'My Capital') && dp.dataIndex > 0) {
        const datasetData = dataset.data;
        const currVal = datasetData[dp.dataIndex];
        const prevVal = datasetData[dp.dataIndex - 1];
        if (currVal !== undefined && prevVal !== undefined) {
          const delta = currVal - prevVal;
          const isPos = delta >= 0;
          const formattedDelta = formatINR(Math.abs(delta), 0);
          variationHtml = ` <span class="text-[10px] font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">(${isPos ? '+' : '-'}${formattedDelta})</span>`;
        }
      }

      innerHtml += `
        <div class="flex items-center justify-between space-x-3 text-[11px]">
          <span class="flex items-center text-slate-600 dark:text-slate-300">
            <span class="w-2 h-2 rounded-full mr-1.5" style="background-color: ${color}"></span>
            <span>${esc(label)}:</span>
          </span>
          <span class="font-mono font-bold text-slate-900 dark:text-white tabular-nums ${maskClass}">
            ${formattedVal}${variationHtml}
          </span>
        </div>
      `;
    });
    innerHtml += '</div></div>';
    tooltipEl.innerHTML = innerHtml;
  }

  const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
  const chartCanvasWidth = chart.width;
  const chartCanvasHeight = chart.height;
  const dataIndex = tooltip.dataPoints && tooltip.dataPoints.length > 0 ? tooltip.dataPoints[0].dataIndex : 0;
  const totalPoints = chart.data.labels ? chart.data.labels.length : 10;

  const isTtmMode = currentChartRange === 'TTM' || totalPoints <= 13;
  const edgeThreshold = isTtmMode ? 3 : 5;
  const isNearRightEdge = dataIndex >= totalPoints - edgeThreshold;

  tooltipEl.style.opacity = '1';

  const tooltipWidth = tooltipEl.offsetWidth || 210;
  const tooltipHeight = tooltipEl.offsetHeight || 120;
  const caretX = tooltip.caretX;
  const caretY = tooltip.caretY;

  const willOverflowRight = (caretX + tooltipWidth + 24) > chartCanvasWidth;
  tooltipEl.style.left = (isNearRightEdge || willOverflowRight)
    ? (positionX + caretX - tooltipWidth - 12) + 'px'
    : (positionX + caretX + 12) + 'px';

  const willOverflowBottom = (caretY + tooltipHeight + 16) > chartCanvasHeight;
  tooltipEl.style.top = willOverflowBottom
    ? (positionY + caretY - tooltipHeight - 12) + 'px'
    : (positionY + caretY - 12) + 'px';
}

const yAxisIndividualBlurPlugin = {
  id: 'yAxisIndividualBlur',
  afterDraw(chart) {
    if (!tabMaskStates || !tabMaskStates.chart) return;
    const { ctx, scales } = chart;
    const yAxis = scales.y;
    if (!yAxis) return;

    ctx.save();
    const isDark = document.documentElement.classList.contains('dark');

    yAxis.ticks.forEach((tick, index) => {
      const y = yAxis.getPixelForTick(index);
      const xStart = yAxis.left + 2;
      const xEnd = yAxis.right - 4;
      const boxWidth = xEnd - xStart;
      const boxHeight = 16;
      const boxY = y - (boxHeight / 2);

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(xStart, boxY, boxWidth, boxHeight, 4);
      } else {
        ctx.rect(xStart, boxY, boxWidth, boxHeight);
      }
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)';
      ctx.filter = 'blur(6px)';
      ctx.fill();
    });
    ctx.restore();
  }
};

function setChartRange(range) {
  currentChartRange = range;
  const ttmBtn = document.getElementById('chartRangeBtn-TTM');
  const allBtn = document.getElementById('chartRangeBtn-ALL');

  const activeClasses = 'bg-white dark:bg-[#131722] text-slate-900 dark:text-white shadow-2xs font-semibold';
  const inactiveClasses = 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium';

  if (ttmBtn && allBtn) {
    if (range === 'TTM') {
      ttmBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${activeClasses}`;
      allBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${inactiveClasses}`;
    } else {
      allBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${activeClasses}`;
      ttmBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${inactiveClasses}`;
    }
  }

  renderChart(getCachedEngineData());
}

function buildChartDatasets(ctx, chartHeight, isDark, displayPoints) {
  const pointBorder = isDark ? '#131722' : '#FFFFFF';
  const blueGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
  blueGradient.addColorStop(0, isDark ? 'rgba(37, 99, 235, 0.20)' : 'rgba(37, 99, 235, 0.15)');
  blueGradient.addColorStop(0.5, isDark ? 'rgba(37, 99, 235, 0.05)' : 'rgba(37, 99, 235, 0.03)');
  blueGradient.addColorStop(1, 'rgba(37, 99, 235, 0.00)');

  const baseLine = (label, data, color, opts = {}) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: opts.bg || 'transparent',
    fill: !!opts.fill,
    borderWidth: opts.width || 2.0,
    borderDash: opts.dash || [],
    cubicInterpolationMode: 'monotone',
    pointRadius: opts.radius || 3.5,
    pointHoverRadius: 5.5,
    pointBackgroundColor: color,
    pointBorderColor: pointBorder,
    pointBorderWidth: 1.5,
    order: opts.order || 1
  });

  if (currentChartView === 'roc') {
    const rateLbl = getRocRateLabel();
    return [
      baseLine('Actual Track', displayPoints.map(p => p.actualVal), '#2563eb', { bg: blueGradient, fill: true, width: 2.4, order: 1 }),
      baseLine('Capital Base', displayPoints.map(p => p.netCapBase), '#dc2626', { order: 2 }),
      baseLine(`Pure ${rateLbl} Hurdle`, displayPoints.map(p => p.pureTarget), '#f59e0b', { dash: [3, 3], radius: 3.0, order: 3 }),
      baseLine('Extreme Target', displayPoints.map(p => p.ratchetTarget), '#9333ea', { dash: [6, 4], order: 4 })
    ];
  }

  const greenGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
  greenGradient.addColorStop(0, isDark ? 'rgba(22, 163, 74, 0.14)' : 'rgba(22, 163, 74, 0.10)');
  greenGradient.addColorStop(0.5, isDark ? 'rgba(22, 163, 74, 0.04)' : 'rgba(22, 163, 74, 0.03)');
  greenGradient.addColorStop(1, 'rgba(22, 163, 74, 0.00)');

  return [
    baseLine('Net Worth', displayPoints.map(p => p.portfolioValue), '#2563eb', { bg: blueGradient, fill: true, width: 2.2, order: 1 }),
    baseLine('My Capital', displayPoints.map(p => p.netCapital), '#dc2626', { order: 2 }),
    baseLine('Profit', displayPoints.map(p => p.profit), '#16a34a', { bg: greenGradient, fill: true, dash: [4, 4], order: 3 })
  ];
}

let selectedChartPeriod = '1Y'; // '6M' | '1Y' | '3Y' | '5Y' | 'ALL'
let selectedChartAccount = 'ALL'; // 'ALL' | account name
let chartExpandedMode = false;

function setChartAccountFilter(acct) {
  selectedChartAccount = acct || 'ALL';
  const data = getCachedEngineData();
  renderChart(data);
  renderCurveInsights(data);
  renderTtmTable(data);
  refreshIcons();
}

function setChartMetricMode(mode) {
  currentChartView = mode === 'roc' ? 'roc' : 'trajectory';

  const perfBtn = document.getElementById('chartMetricBtn-trajectory');
  const rocBtn = document.getElementById('chartMetricBtn-roc');
  const activeCls = 'chart-metric-pill-active w-32 justify-center px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer';
  const inactiveCls = 'w-32 justify-center px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#222836] bg-white dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#232A3B] text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer';

  if (perfBtn) perfBtn.className = currentChartView === 'trajectory' ? activeCls : inactiveCls;
  if (rocBtn) rocBtn.className = currentChartView === 'roc' ? activeCls : inactiveCls;

  const titleEl = document.getElementById('currentChartViewLabel');
  const subEl = document.getElementById('chartCardSubtitle');
  const iconEl = document.getElementById('chartCardTitleIcon');
  const badgeEl = document.getElementById('curveInsightsModeBadge');

  if (currentChartView === 'roc') {
    if (titleEl) titleEl.innerText = 'Target Curve';
    if (subEl) subEl.innerText = 'Actual monthly RoC vs. hurdle & extreme target';
    if (iconEl) iconEl.setAttribute('data-lucide', 'target');
    if (badgeEl) badgeEl.innerText = 'Target Curve';
  } else {
    if (titleEl) titleEl.innerText = 'Performance Curve';
    if (subEl) subEl.innerText = 'Net worth, invested capital & profit trajectory';
    if (iconEl) iconEl.setAttribute('data-lucide', 'trending-up');
    if (badgeEl) badgeEl.innerText = 'Performance';
  }

  renderChartLegend();
  const data = getCachedEngineData();
  renderChart(data);
  renderCurveInsights(data);
  renderTtmTable(data);
  refreshIcons();
}

function setChartPeriod(period) {
  selectedChartPeriod = period || '1Y';
  currentChartRange = selectedChartPeriod === 'ALL' ? 'ALL' : 'TTM';

  document.querySelectorAll('#chartPeriodPills .chart-period-btn').forEach(btn => {
    const isActive = btn.dataset.chartPeriod === selectedChartPeriod;
    btn.className = isActive
      ? 'chart-period-btn chart-period-pill-active px-3 py-1 rounded-lg transition'
      : 'chart-period-btn px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition';
  });

  const data = getCachedEngineData();
  renderChart(data);
  renderCurveInsights(data);
}

function toggleChartExpandFocus() {
  chartExpandedMode = !chartExpandedMode;
  const wrap = document.getElementById('multiChartCanvasWrap');
  if (!wrap) return;
  wrap.className = chartExpandedMode
    ? 'h-[450px] lg:h-[510px] w-full relative overflow-hidden transition-all duration-200'
    : 'h-[340px] lg:h-[370px] w-full relative overflow-hidden transition-all duration-200';
  if (multiChartInstance) {
    setTimeout(() => multiChartInstance.resize(), 60);
  }
}

function getFilteredChartPoints(computed) {
  const allPts = computeRocFourCurves(computed);
  if (!Array.isArray(allPts) || allPts.length === 0) return [];

  if (selectedChartPeriod === 'ALL') return allPts;

  const monthsMap = { '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60 };
  const monthsBack = monthsMap[selectedChartPeriod] || 12;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);

  const ranged = allPts.filter(pt => {
    if (pt.date === 'Current') return true;
    const d = new Date(pt.date);
    return !isNaN(d.getTime()) && d >= cutoff;
  });

  if (ranged.length > 0) return ranged;
  return selectedChartPeriod === '1Y' ? allPts.slice(-12) : allPts.slice(-6);
}

function renderCurveInsights(computed) {
  const container = document.getElementById('curveInsightsList');
  if (!container) return;

  const maskClass = getMaskClass('chart');
  const pts = getFilteredChartPoints(computed || getCachedEngineData());

  if (!pts || pts.length === 0) {
    container.innerHTML = `<div class="py-8 text-center text-xs text-slate-400 font-medium">No checkpoint data available for this period.</div>`;
    return;
  }

  if (currentChartView === 'roc') {
    const rocPts = pts.slice(1);
    const targetMonthlyPct = ((typeof ROC_TARGET_MONTHLY_RATE === 'number' ? ROC_TARGET_MONTHLY_RATE : 0.02) * 100);

    let bestItem = null;
    let worstItem = null;
    let sumRoc = 0;
    let achievedCount = 0;

    rocPts.forEach(p => {
      const r = Number(p.rocPct || 0);
      sumRoc += r;
      if (r >= targetMonthlyPct) achievedCount++;
      if (!bestItem || r > bestItem.val) bestItem = { val: r, label: p.date };
      if (!worstItem || r < worstItem.val) worstItem = { val: r, label: p.date };
    });

    const totalMonths = rocPts.length;
    const avgRoc = totalMonths > 0 ? (sumRoc / totalMonths) : 0;
    const achPct = totalMonths > 0 ? ((achievedCount / totalMonths) * 100).toFixed(1) : '0.0';
    const deviationPp = avgRoc - targetMonthlyPct;

    const rows = [
      {
        icon: 'award',
        iconWrap: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400',
        title: 'Best ROC Month',
        sub: bestItem ? bestItem.label : '—',
        valHtml: `<span class="text-emerald-600 dark:text-emerald-400 font-extrabold tabular-nums">${bestItem ? `${bestItem.val >= 0 ? '+' : ''}${bestItem.val.toFixed(2)}%` : '—'}</span>`
      },
      {
        icon: 'trending-down',
        iconWrap: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400',
        title: 'Worst ROC Month',
        sub: worstItem ? worstItem.label : '—',
        valHtml: `<span class="text-rose-600 dark:text-rose-400 font-extrabold tabular-nums">${worstItem ? `${worstItem.val >= 0 ? '+' : ''}${worstItem.val.toFixed(2)}%` : '—'}</span>`
      },
      {
        icon: 'check-circle-2',
        iconWrap: 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400',
        title: 'Target Achievement',
        sub: `Hurdle: ${targetMonthlyPct.toFixed(2)}% / mo`,
        valHtml: `<span class="text-slate-900 dark:text-white font-extrabold tabular-nums">${achievedCount} / ${totalMonths} (${achPct}%)</span>`
      },
      {
        icon: 'percent',
        iconWrap: 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400',
        title: 'Average Monthly ROC',
        sub: `Across ${totalMonths} period steps`,
        valHtml: `<span class="text-slate-900 dark:text-white font-extrabold tabular-nums">${avgRoc >= 0 ? '+' : ''}${avgRoc.toFixed(2)}%</span>`
      },
      {
        icon: 'sliders-horizontal',
        iconWrap: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400',
        title: 'Target Deviation',
        sub: 'Spread vs. monthly hurdle',
        valHtml: `<span class="${deviationPp >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} font-extrabold tabular-nums">${deviationPp >= 0 ? '+' : ''}${deviationPp.toFixed(2)} pp</span>`
      }
    ];

    container.innerHTML = rows.map(r => `
      <div class="py-2.5 flex items-center justify-between gap-2">
        <div class="flex items-center space-x-2.5 min-w-0">
          <span class="h-8 w-8 rounded-xl ${r.iconWrap} flex items-center justify-center shrink-0">
            <i data-lucide="${r.icon}" class="w-4 h-4"></i>
          </span>
          <div class="min-w-0">
            <div class="text-xs font-bold text-slate-900 dark:text-white truncate">${esc(r.title)}</div>
            <div class="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">${esc(r.sub)}</div>
          </div>
        </div>
        <div class="text-right text-xs shrink-0">${r.valHtml}</div>
      </div>
    `).join('');

    refreshIcons();
    return;
  }

  let highestVal = -Infinity;
  let lowestVal = Infinity;
  let peakSoFar = -Infinity;
  let maxDrawdownPct = 0;
  let bestGainAmt = -Infinity;
  let bestGainPeriod = '—';
  let bestGainPct = 0;

  pts.forEach((p, idx) => {
    const val = Number(p.portfolioValue || 0);
    if (val > highestVal) highestVal = val;
    if (val < lowestVal) lowestVal = val;
    if (val > peakSoFar) peakSoFar = val;

    if (peakSoFar > 0) {
      const dd = ((val - peakSoFar) / peakSoFar) * 100;
      if (dd < maxDrawdownPct) maxDrawdownPct = dd;
    }

    if (idx > 0) {
      const prev = pts[idx - 1];
      const prevVal = Number(prev.portfolioValue || 0);
      const diff = val - prevVal;
      if (diff > bestGainAmt) {
        bestGainAmt = diff;
        bestGainPeriod = `${prev.date} → ${p.date}`;
        bestGainPct = prevVal > 0 ? (diff / prevVal) * 100 : 0;
      }
    }
  });

  const firstVal = Number(pts[0].portfolioValue || 0);
  const lastVal = Number(pts[pts.length - 1].portfolioValue || 0);
  const periodRetPct = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;

  const perfRows = [
    {
      icon: 'trophy',
      iconWrap: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400',
      title: 'Highest Net Worth',
      sub: 'Maximum portfolio value in selected period',
      valHtml: `<span class="text-slate-900 dark:text-white font-extrabold tabular-nums ${maskClass}">${formatINR(highestVal === -Infinity ? 0 : highestVal, 0)}</span>`
    },
    {
      icon: 'trending-down',
      iconWrap: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400',
      title: 'Lowest Net Worth',
      sub: 'Minimum portfolio value in selected period',
      valHtml: `<span class="text-slate-900 dark:text-white font-extrabold tabular-nums ${maskClass}">${formatINR(lowestVal === Infinity ? 0 : lowestVal, 0)}</span>`
    },
    {
      icon: 'trending-up',
      iconWrap: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400',
      title: 'Best Growth Period',
      sub: bestGainAmt > -Infinity ? `${bestGainPeriod}` : 'Largest increase between two points',
      valHtml: bestGainAmt > -Infinity
        ? `<div><span class="text-emerald-600 dark:text-emerald-400 font-extrabold tabular-nums ${maskClass}">+${formatINR(bestGainAmt, 0)}</span><div class="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">(+${bestGainPct.toFixed(1)}%)</div></div>`
        : `<span class="text-slate-400 font-bold">—</span>`
    },
    {
      icon: 'activity',
      iconWrap: 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400',
      title: 'Maximum Drawdown',
      sub: 'Peak-to-trough decline in period',
      valHtml: `<span class="text-rose-600 dark:text-rose-400 font-extrabold tabular-nums">${maxDrawdownPct.toFixed(2)}%</span>`
    },
    {
      icon: 'calendar',
      iconWrap: 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400',
      title: 'Period Return',
      sub: 'Net worth change over selected period',
      valHtml: `<span class="${periodRetPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} font-extrabold tabular-nums">${periodRetPct >= 0 ? '+' : ''}${periodRetPct.toFixed(2)}%</span>`
    }
  ];

  container.innerHTML = perfRows.map(r => `
    <div class="py-2.5 flex items-center justify-between gap-2">
      <div class="flex items-center space-x-2.5 min-w-0">
        <span class="h-8 w-8 rounded-xl ${r.iconWrap} flex items-center justify-center shrink-0">
          <i data-lucide="${r.icon}" class="w-4 h-4"></i>
        </span>
        <div class="min-w-0">
          <div class="text-xs font-bold text-slate-900 dark:text-white truncate">${esc(r.title)}</div>
          <div class="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">${esc(r.sub)}</div>
        </div>
      </div>
      <div class="text-right text-xs shrink-0">${r.valHtml}</div>
    </div>
  `).join('');

  refreshIcons();
}

function renderChart(computed) {
  const canvas = document.getElementById('multiCurveChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const isDark = document.documentElement.classList.contains('dark');
  const horizontalGridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : '#E9EDF3';
  const zeroLineColor = isDark ? 'rgba(255, 255, 255, 0.25)' : '#CBD5E1';
  const tickColor = isDark ? '#94A3B8' : '#64748B';
  const chartHeight = canvas.parentElement ? (canvas.parentElement.clientHeight || 430) : 430;

  const displayPoints = getFilteredChartPoints(computed);

  const labels = displayPoints.length > 0 ? displayPoints.map(p => p.date) : ['No Data'];
  const datasets = displayPoints.length > 0
    ? buildChartDatasets(ctx, chartHeight, isDark, displayPoints)
    : buildChartDatasets(ctx, chartHeight, isDark, [{ portfolioValue: 0, netCapital: 0, profit: 0, actualVal: 0, netCapBase: 0, pureTarget: 0, ratchetTarget: 0 }]);

  if (multiChartInstance) {
    multiChartInstance.data.labels = labels;
    multiChartInstance.data.datasets = datasets;
    multiChartInstance.update('none');
    return;
  }

  multiChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'],
      onHover: (event, chartElement) => {
        if (event.type === 'touchmove' && (!chartElement || chartElement.length === 0)) {
          const tooltipEl = document.getElementById('chartCustomTooltip');
          if (tooltipEl) tooltipEl.style.opacity = '0';
        }
      },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: customHtmlTooltipHandler
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: tickColor,
            font: { family: "'Inter', sans-serif", size: 10.5, weight: '500' },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            padding: 6,
            callback: function(val) {
              return this.getLabelForValue(val);
            }
          }
        },
        y: {
          border: { display: false },
          grid: {
            color: function(scaleCtx) {
              if (scaleCtx.tick && scaleCtx.tick.value === 0) return zeroLineColor;
              return horizontalGridColor;
            },
            lineWidth: function(scaleCtx) { return (scaleCtx.tick && scaleCtx.tick.value === 0) ? 1.2 : 0.6; }
          },
          ticks: {
            color: function() {
              return (tabMaskStates && tabMaskStates.chart) ? 'transparent' : tickColor;
            },
            font: { family: "'Inter', sans-serif", size: 11 },
            padding: 8,
            callback: function(val) {
              return formatINR(val, 0);
            }
          }
        }
      }
    },
    plugins: [yAxisIndividualBlurPlugin]
  });
}

/* ---------------- DROPDOWN AUTO-COLLAPSE MANAGER ---------------- */
function closeAllTopDropdowns(exceptId = null) {
  if (exceptId !== 'txDropdownMenu') {
    closeTxDropdown();
  }
  if (exceptId !== 'productsDropdownMenu') {
    closeProductsDropdown();
  }
  if (exceptId !== 'settingsDropdownMenu') {
    closeSettingsDropdown();
  }
  if (exceptId !== 'chartViewDropdownMenu') {
    closeChartViewDropdown();
  }
}

/* ---------------- HERO VIEW SWITCHING & PRODUCTS DROPDOWN ---------------- */
function switchMainView(view) {
  const homeEl = document.getElementById('mainViewHome');
  const dashEl = document.getElementById('mainViewDashboard');
  const chartEl = document.getElementById('mainViewChart');
  const portEl = document.getElementById('mainViewPortfolio');
  const prodEl = document.getElementById('mainViewProducts');

  const btnDash = document.getElementById('navLink-dashboard');
  const btnPort = document.getElementById('navLink-portfolio');
  const btnChart = document.getElementById('navLink-chart');
  const btnProd = document.getElementById('navLink-products');

  const activeClasses = 'px-3.5 py-2 rounded-xl transition bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/60 flex items-center space-x-2';
  const inactiveClasses = 'px-3.5 py-2 rounded-xl transition text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A1F2E] flex items-center space-x-2';

  if (homeEl) homeEl.classList.add('hidden');
  if (dashEl) dashEl.classList.add('hidden');
  if (chartEl) chartEl.classList.add('hidden');
  if (portEl) portEl.classList.add('hidden');
  if (prodEl) prodEl.classList.add('hidden');

  if (btnDash) btnDash.className = inactiveClasses;
  if (btnPort) btnPort.className = inactiveClasses;
  if (btnChart) btnChart.className = inactiveClasses;
  if (btnProd) btnProd.className = inactiveClasses;

  closeAllTopDropdowns();

  if (view === 'home') {
    if (homeEl) homeEl.classList.remove('hidden');
    renderCurrentHomeQuote(false);
  } else if (view === 'dashboard') {
    if (dashEl) dashEl.classList.remove('hidden');
    if (btnDash) btnDash.className = activeClasses;
    if (typeof selectDashboardMetric === 'function') {
      selectDashboardMetric(selectedDashboardMetric || 'netWorth');
    } else if (typeof renderDashboardTrendChart === 'function') {
      renderDashboardTrendChart(getCachedEngineData());
    }
  } else if (view === 'chart') {
    if (chartEl) chartEl.classList.remove('hidden');
    if (btnChart) btnChart.className = activeClasses;
    const data = getCachedEngineData();
    renderChartLegend();
    renderChart(data);
    renderCurveInsights(data);
    renderTtmTable(data);
  } else if (view === 'portfolio') {
    if (portEl) portEl.classList.remove('hidden');
    if (btnPort) btnPort.className = activeClasses;
    switchSubTab('holdings');
  }
  refreshIcons();
}

function switchSubTab(subTabKey) {
  activeTabKey = subTabKey;
  const homeEl = document.getElementById('mainViewHome');
  const prodEl = document.getElementById('mainViewProducts');
  const portEl = document.getElementById('mainViewPortfolio');
  const dashEl = document.getElementById('mainViewDashboard');
  const chartEl = document.getElementById('mainViewChart');

  const btnChart = document.getElementById('navLink-chart');
  const btnProd = document.getElementById('navLink-products');
  const btnDash = document.getElementById('navLink-dashboard');
  const btnPort = document.getElementById('navLink-portfolio');

  const activeClasses = 'px-3.5 py-2 rounded-xl transition bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/60 flex items-center space-x-2';
  const inactiveClasses = 'px-3.5 py-2 rounded-xl transition text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A1F2E] flex items-center space-x-2';

  if (homeEl) homeEl.classList.add('hidden');
  if (dashEl) dashEl.classList.add('hidden');
  if (chartEl) chartEl.classList.add('hidden');
  if (portEl) portEl.classList.add('hidden');
  if (prodEl) prodEl.classList.add('hidden');

  if (btnDash) btnDash.className = inactiveClasses;
  if (btnPort) btnPort.className = inactiveClasses;
  if (btnChart) btnChart.className = inactiveClasses;
  if (btnProd) btnProd.className = inactiveClasses;

  if (subTabKey === 'holdings') {
    if (portEl) portEl.classList.remove('hidden');
    if (btnPort) btnPort.className = activeClasses;
  } else {
    if (prodEl) prodEl.classList.remove('hidden');
    if (btnProd) btnProd.className = activeClasses;

    ['closedTrades', 'fyBreakdown', 'transactions', 'bankLedger', 'taxPnl', 'purification'].forEach(id => {
      const el = document.getElementById(`tabContent-${id}`);
      if (el) el.classList.add('hidden');
    });

    const activeContent = document.getElementById(`tabContent-${subTabKey}`);
    if (activeContent) activeContent.classList.remove('hidden');
  }

  closeAllTopDropdowns();

  if (subTabKey === 'taxPnl') {
    setTaxAccountFilter(currentTaxAccountFilter || 'Me');
    dirtyTabs.taxPnl = false;
  } else if (dirtyTabs[subTabKey]) {
    renderActiveTabOnly(getCachedEngineData());
  }
  refreshIcons();
}

function toggleProductsDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('productsDropdownMenu');
  const chevron = document.getElementById('productsDropdownChevron');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  closeAllTopDropdowns('productsDropdownMenu');
  menu.classList.toggle('hidden', !isHidden);
  if (chevron) chevron.classList.toggle('rotate-180', isHidden);
}

function closeProductsDropdown() {
  const menu = document.getElementById('productsDropdownMenu');
  const chevron = document.getElementById('productsDropdownChevron');
  if (menu) menu.classList.add('hidden');
  if (chevron) chevron.classList.remove('rotate-180');
}

function closeTxDropdown() {
  const menu = document.getElementById('txDropdownMenu');
  const chevron = document.getElementById('txDropdownChevron');
  if (menu) menu.classList.add('hidden');
  if (chevron) chevron.classList.remove('rotate-180');
  closeCorpActionSubmenu();
}

function switchTab(t) {
  if (t === 'holdings') {
    switchMainView('portfolio');
  } else {
    switchSubTab(t);
  }
}

/* ---------------- RECORD / EDIT TRANSACTION & CORPORATE ACTIONS ---------------- */
function toggleTxDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('txDropdownMenu');
  const chevron = document.getElementById('txDropdownChevron');
  const isHidden = menu.classList.contains('hidden');

  closeAllTopDropdowns('txDropdownMenu');

  if (isHidden) {
    menu.classList.remove('hidden');
    menu.classList.add('max-h-[65vh]', 'overflow-y-auto', 'custom-scroll');
    if (chevron) chevron.classList.add('rotate-180');
  } else {
    menu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
    closeCorpActionSubmenu();
  }
}

function toggleCorpActionSubmenu(e) {
  if (e) e.stopPropagation();
  const submenu = document.getElementById('corpActionSubmenu');
  const chevron = document.getElementById('corpSubmenuChevron');
  if (!submenu) return;

  const isHidden = submenu.classList.contains('hidden');
  submenu.classList.toggle('hidden', !isHidden);
  if (chevron) chevron.classList.toggle('rotate-90', isHidden);
}

function closeCorpActionSubmenu() {
  const submenu = document.getElementById('corpActionSubmenu');
  const chevron = document.getElementById('corpSubmenuChevron');
  if (submenu) submenu.classList.add('hidden');
  if (chevron) chevron.classList.remove('rotate-90');
}

function selectDropdownPreset(type) {
  closeAllTopDropdowns();
  openPresetModal(type);
}

function openPresetModal(type, existingTx = null) {
  document.getElementById('txModal').classList.remove('hidden');
  document.getElementById('txEditingId').value = existingTx ? (existingTx.id || '') : '';
  document.getElementById('txDate').value = existingTx ? existingTx.date : todayLocalISO();
  document.getElementById('txType').value = existingTx ? existingTx.type : type;

  const accountSelect = document.getElementById('txAccount');
  if (accountSelect) {
    accountSelect.value = existingTx ? (existingTx.account || '') : '';
    accountSelect.classList.remove('border-rose-500', 'ring-1', 'ring-rose-500');
  }

  clearInlineTxWarnings();
  const activeType = existingTx ? existingTx.type : type;
  document.getElementById('modalTitle').innerText = existingTx ? `Edit ${activeType} Entry` : `Record ${activeType}`;
  document.getElementById('txSubmitBtn').innerText = existingTx ? 'Authorize & Update' : 'Save Entry';
  toggleFormFields();

  if (existingTx) {
    document.getElementById('txStock').value = existingTx.stock || '';
    document.getElementById('txQty').value = existingTx.qty || '';
    document.getElementById('txPrice').value = existingTx.price || '';
    document.getElementById('txAmount').value = existingTx.amount || '';
    document.getElementById('txRemarks').value = existingTx.remarks || '';
    const debtInp = document.getElementById('txDebtToAsset');
    if (debtInp) {
      debtInp.value = (existingTx.type === 'SELL' && existingTx.debtToAsset !== undefined && existingTx.debtToAsset !== 'NA')
        ? existingTx.debtToAsset
        : '';
    }
  }
}

function clearInlineTxWarnings() {
  ['txAccount', 'txStock', 'txQty', 'txPrice', 'txAmount', 'txDebtToAsset', 'txRemarks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('border-rose-500', 'ring-1', 'ring-rose-500');
  });
  document.querySelectorAll('.inline-tx-warning').forEach(el => el.remove());
}

function showInlineError(inputElement, message) {
  if (!inputElement) return;
  inputElement.classList.add('border-rose-500', 'ring-1', 'ring-rose-500');

  let existingWarning = inputElement.parentElement.querySelector('.inline-tx-warning');
  if (!existingWarning) {
    existingWarning = document.createElement('div');
    existingWarning.className = 'inline-tx-warning text-[10.5px] text-rose-500 dark:text-rose-400 font-semibold mt-1';
    inputElement.parentElement.appendChild(existingWarning);
  }
  existingWarning.innerText = message;
}

function closeTransactionModal() {
  document.getElementById('txModal').classList.add('hidden');
  document.getElementById('txEditingId').value = '';
  clearInlineTxWarnings();
  document.getElementById('txForm').reset();
}

function toggleFormFields() {
  const type = document.getElementById('txType').value;
  const isStock = ['BUY', 'SELL', 'BONUS', 'SPLIT', 'DEMERGER'].includes(type);
  const stockFields = document.getElementById('stockFields');
  const qtyLabel = document.getElementById('txQtyLabel');
  const priceLabel = document.getElementById('txPriceLabel');
  const priceInput = document.getElementById('txPrice');
  const amtInput = document.getElementById('txAmount');
  const amtGroup = document.getElementById('txAmountFieldGroup');
  const debtGroup = document.getElementById('txDebtToAssetGroup');
  const debtInp = document.getElementById('txDebtToAsset');

  if (stockFields) stockFields.style.display = isStock ? 'grid' : 'none';

  if (debtGroup && amtGroup) {
    if (type === 'SELL') {
      debtGroup.classList.remove('hidden');
      amtGroup.classList.remove('sm:col-span-2');
      if (debtInp) debtInp.required = true;
    } else {
      debtGroup.classList.add('hidden');
      amtGroup.classList.add('sm:col-span-2');
      if (debtInp) {
        debtInp.required = false;
        debtInp.value = '';
      }
    }
  }

  if (type === 'BONUS') {
    qtyLabel.innerText = 'Bonus Shares Allotted';
    priceLabel.innerText = 'Cost Per Share (₹)';
    priceInput.value = '0';
    priceInput.disabled = true;
    amtInput.value = '0';
    amtInput.disabled = true;
  } else if (type === 'SPLIT') {
    qtyLabel.innerText = 'New Ratio (e.g. 10)';
    priceLabel.innerText = 'Old Ratio (e.g. 1)';
    priceInput.disabled = false;
    amtInput.disabled = false;
  } else if (type === 'DEMERGER') {
    qtyLabel.innerText = 'Shares Apportioned';
    priceLabel.innerText = 'Cost Retained (e.g. 0.90)';
    priceInput.disabled = false;
    amtInput.disabled = false;
  } else {
    qtyLabel.innerText = 'Quantity';
    priceLabel.innerText = 'Price / Share (₹)';
    priceInput.disabled = false;
    amtInput.disabled = false;
  }
}

function autoComputeAmount() {
  const type = document.getElementById('txType').value;
  if (type === 'BONUS') {
    document.getElementById('txPrice').value = '0';
    document.getElementById('txAmount').value = '0';
    return;
  }
  const qty = Number(document.getElementById('txQty').value || 0);
  const price = Number(document.getElementById('txPrice').value || 0);
  if (qty && price) document.getElementById('txAmount').value = (qty * price).toFixed(2);
}

function wouldCauseOversell(proposedTxList, targetStock, targetAccount) {
  const sorted = proposedTxList
    .map((tx, idx) => ({ tx, idx }))
    .sort((a, b) => {
      const da = new Date(a.tx.date).getTime();
      const db = new Date(b.tx.date).getTime();
      if (da !== db) return da - db;
      return a.idx - b.idx;
    })
    .map(item => item.tx);

  let runningQty = 0;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if ((t.stock || '').toUpperCase().trim() !== targetStock || (t.account || 'Unassigned') !== targetAccount) continue;
    const q = Number(t.qty || 0);
    if (t.type === 'BUY' || t.type === 'BONUS' || t.type === 'DEMERGER') {
      runningQty += q;
    } else if (t.type === 'SPLIT') {
      const oldP = Number(t.price || 0) > 0 ? Number(t.price) : 1;
      const ratio = q > 0 ? (q / oldP) : 1;
      runningQty *= ratio;
    } else if (t.type === 'SELL') {
      runningQty -= q;
      if (runningQty < -1e-6) return true;
    }
  }
  return false;
}

function handleTransactionSubmit(e) {
  e.preventDefault();
  clearInlineTxWarnings();

  const editingId = document.getElementById('txEditingId').value.trim();
  const type = document.getElementById('txType').value;
  const accountSelect = document.getElementById('txAccount');
  const account = accountSelect ? accountSelect.value.trim() : '';
  const stockInput = document.getElementById('txStock');
  const stock = stockInput ? stockInput.value.trim().toUpperCase() : '';
  const qtyInput = document.getElementById('txQty');
  const qty = Number(qtyInput ? qtyInput.value || 0 : 0);
  const priceInput = document.getElementById('txPrice');
  const price = Number(priceInput ? priceInput.value || 0 : 0);
  const amtInput = document.getElementById('txAmount');
  let amount = Number(amtInput ? amtInput.value || 0 : 0);
  const debtInput = document.getElementById('txDebtToAsset');
  const rawDebtStr = debtInput ? debtInput.value.trim() : '';
  const remarksInput = document.getElementById('txRemarks');
  const remarks = remarksInput ? remarksInput.value.trim() : '';
  const date = document.getElementById('txDate').value;

  if (!account) {
    showInlineError(accountSelect, 'Please select an account.');
    return;
  }

  const isStock = ['BUY', 'SELL', 'BONUS', 'SPLIT', 'DEMERGER'].includes(type);
  if (isStock && !stock) {
    showInlineError(stockInput, 'Stock ticker symbol is required.');
    return;
  }

  if (isStock && type !== 'DEMERGER' && (!qty || qty <= 0)) {
    showInlineError(qtyInput, 'Valid quantity is required.');
    return;
  }

  if (['BUY', 'SELL'].includes(type) && (!price || price <= 0)) {
    showInlineError(priceInput, 'Price per share is required.');
    return;
  }

  let debtToAssetVal = 'NA';
  if (type === 'SELL') {
    const parsedDebt = Number(rawDebtStr);
    if (rawDebtStr === '' || isNaN(parsedDebt) || parsedDebt < 0 || parsedDebt > 100) {
      showInlineError(debtInput, 'Enter Debt to Total Assets % (0 to 100).');
      return;
    }
    debtToAssetVal = parsedDebt;
  }

  if (type === 'FEES' && (!amount || amount <= 0)) {
    showInlineError(amtInput, 'Total fee amount is mandatory.');
    return;
  }

  if (!remarks) {
    showInlineError(remarksInput, 'Remarks / reference is mandatory.');
    return;
  }

  if (['BUY', 'SELL'].includes(type) && !amount) amount = qty * price;
  if (type === 'BONUS') amount = 0;

  const baseTransactions = editingId
    ? transactions.filter(t => String(t.id) !== editingId)
    : transactions;
  const checkEngine = computeEngine(baseTransactions);

  if (type === 'SELL') {
    let availableQty = 0;
    checkEngine.openLots.forEach(lot => {
      if (lot.stock === stock && lot.account === account) {
        availableQty += lot.qty;
      }
    });

    if (qty > availableQty) {
      showInlineError(qtyInput, `Overselling error: Only ${availableQty} shares available in open lots.`);
      return;
    }
  }

  if (type === 'BUY') {
    const cashAvailable = checkEngine.accountCashMap[account] || 0;
    if (amount > cashAvailable) {
      showInlineError(amtInput, `Insufficient cash: Account balance is ${formatINR(cashAvailable)}.`);
      return;
    }
  }

  if (type === 'WITHDRAWAL') {
    const cashAvailable = checkEngine.accountCashMap[account] || 0;
    if (amount > cashAvailable) {
      showInlineError(amtInput, `Insufficient cash for withdrawal: Available balance is ${formatINR(cashAvailable)}.`);
      return;
    }
  }

  if (type === 'FEES') {
    const cashAvailable = checkEngine.accountCashMap[account] || 0;
    const projectedCash = cashAvailable - amount;
    if (projectedCash < -2000) {
      showInlineError(amtInput, `Warning: This fee plunges account balance to ${formatINR(projectedCash)} (exceeds -₹2,000 limit).`);
      return;
    }
    if (amount > 2000 && !confirm(`High Fee Alert: You are recording a fee of ${formatINR(amount)}. Proceed?`)) {
      return;
    }
  }

  if (editingId) {
    const updatedTx = {
      id: editingId,
      date,
      account,
      type,
      stock,
      qty,
      price,
      amount,
      remarks,
      debtToAsset: debtToAssetVal
    };

    const proposedList = transactions.map(t => (String(t.id) === editingId ? updatedTx : t));
    if (isStock && wouldCauseOversell(proposedList, stock, account)) {
      if (!confirm(`Warning: Updating this ${type} entry reduces available shares below later SELL orders for ${stock} (${account}). Continue anyway?`)) {
        return;
      }
    }

    requestPinAuthorization(
      'Authorize Transaction Edit',
      `Enter Master PIN to update ${type} (${stock || account})`,
      () => {
        const idx = transactions.findIndex(t => String(t.id) === editingId);
        if (idx >= 0) {
          transactions[idx] = updatedTx;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
        sendToSheet({ action: 'updateTransaction', transaction: updatedTx });

        updateStockAutocompleteOptions();
        closeTransactionModal();
        recalculateAndRender();
        if (!document.getElementById('recentTxModal').classList.contains('hidden')) {
          renderRecentTransactionsTable();
        }
      }
    );
    return;
  }

  const newEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date,
    account,
    type,
    stock,
    qty,
    price,
    amount,
    remarks,
    debtToAsset: debtToAssetVal
  };

  transactions.push(newEntry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  sendToSheet({ action: 'addTransaction', transaction: newEntry });

  updateStockAutocompleteOptions();
  closeTransactionModal();
  recalculateAndRender();
}

function quickSellModal(stock, maxQty, currentPrice) {
  openPresetModal('SELL');
  document.getElementById('txStock').value = stock;

  let targetQty = maxQty;
  if (currentHoldingsAccountFilter && currentHoldingsAccountFilter !== 'ALL') {
    const acctSelect = document.getElementById('txAccount');
    if (acctSelect) acctSelect.value = currentHoldingsAccountFilter;

    const data = getCachedEngineData();
    targetQty = data.openLots
      .filter(l => l.stock === stock && l.account === currentHoldingsAccountFilter)
      .reduce((sum, l) => sum + l.qty, 0);
  }

  document.getElementById('txQty').value = targetQty;
  document.getElementById('txPrice').value = currentPrice;
  document.getElementById('txAmount').value = (targetQty * currentPrice).toFixed(2);
  document.getElementById('txRemarks').value = 'Liquidation';
}

function manualOverridePrice(stock, cur) {
  const p = prompt(`Set LTP (₹) for ${stock}:`, cur);
  if (p !== null && p.trim() !== '' && !isNaN(Number(p)) && Number(p) > 0) {
    persistManualPrice(stock, Number(p));
    recalculateAndRender();
  }
}

/* ---------------- LAST 10 TRANSACTIONS & PIN-GATED EDIT / DELETE ---------------- */
function openRecentTransactionsModal() {
  closeAllTopDropdowns();
  renderRecentTransactionsTable();
  document.getElementById('recentTxModal').classList.remove('hidden');
  refreshIcons();
}

function closeRecentTransactionsModal() {
  document.getElementById('recentTxModal').classList.add('hidden');
}

function renderRecentTransactionsTable() {
  const tbody = document.getElementById('recentTxTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const recentTen = [...transactions].slice(-10).reverse();

  if (recentTen.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400 font-medium">No transactions recorded yet.</td></tr>`;
    return;
  }

  recentTen.forEach(tx => {
    const txId = esc(String(tx.id || ''));
    const debtDisplay = tx.type === 'SELL' ? `${Number(tx.debtToAsset || 0).toFixed(2)}%` : 'NA';
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80';
    tr.innerHTML = `
      <td class="py-2.5 px-3 tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">${esc(tx.date)}</td>
      <td class="py-2.5 px-2 font-semibold text-slate-700 dark:text-slate-300">${esc(tx.account || 'Unassigned')}</td>
      <td class="py-2.5 px-2 font-bold text-slate-900 dark:text-white">${esc(tx.type)}</td>
      <td class="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">${esc(tx.stock) || '—'}</td>
      <td class="py-2.5 px-2 text-right tabular-nums">${tx.qty || '—'}</td>
      <td class="py-2.5 px-2 text-right tabular-nums">${tx.price ? formatINR(tx.price) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white">${formatINR(tx.amount || 0)}</td>
      <td class="py-2.5 px-2 text-right tabular-nums text-xs ${tx.type === 'SELL' ? 'font-semibold text-teal-600 dark:text-teal-400' : 'text-slate-400'}">${debtDisplay}</td>
      <td class="py-2.5 px-3 text-slate-500 dark:text-slate-400 truncate max-w-[160px]" title="${esc(tx.remarks)}">${esc(tx.remarks)}</td>
      <td class="py-2.5 px-3 text-center whitespace-nowrap space-x-1.5">
        <button data-tx-action="edit" data-tx-id="${txId}" class="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-[11px] font-bold transition">Edit</button>
        <button data-tx-action="delete" data-tx-id="${txId}" class="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 text-[11px] font-bold transition">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Event delegation for Last 10 Transactions modal buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tx-action]');
  if (!btn) return;
  const txId = btn.dataset.txId;
  const action = btn.dataset.txAction;
  const targetTx = transactions.find(t => String(t.id) === txId);
  if (!targetTx) return;

  if (action === 'edit') {
    openPresetModal(targetTx.type, targetTx);
  } else if (action === 'delete') {
    initiatePinGatedDelete(targetTx);
  }
});

function initiatePinGatedDelete(targetTx) {
  const isStock = ['BUY', 'SELL', 'BONUS', 'SPLIT', 'DEMERGER'].includes(targetTx.type);
  const proposedList = transactions.filter(t => String(t.id) !== String(targetTx.id));
  if (isStock && targetTx.stock && wouldCauseOversell(proposedList, targetTx.stock.toUpperCase().trim(), targetTx.account || 'Unassigned')) {
    if (!confirm(`Warning: Deleting this ${targetTx.type} entry will leave insufficient shares for later SELL orders of ${targetTx.stock} (${targetTx.account}). Continue anyway?`)) {
      return;
    }
  }

  requestPinAuthorization(
    'Authorize Deletion',
    `Enter Master PIN to delete ${targetTx.type} (${targetTx.stock || targetTx.account}) on ${targetTx.date}`,
    () => {
      const idx = transactions.findIndex(t => String(t.id) === String(targetTx.id));
      if (idx >= 0) {
        transactions.splice(idx, 1);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
      sendToSheet({ action: 'deleteTransaction', id: targetTx.id });

      recalculateAndRender();
      renderRecentTransactionsTable();
    }
  );
}

function requestPinAuthorization(title, desc, onSuccessCallback) {
  if (!appSettings.pinHash) {
    if (typeof onSuccessCallback === 'function') onSuccessCallback();
    return;
  }

  pendingPinActionCallback = onSuccessCallback;
  document.getElementById('pinVerifyTitle').innerText = title || 'Authorize Action';
  document.getElementById('pinVerifyDesc').innerText = desc || 'Enter your 4-digit Master PIN to confirm';

  const inp = document.getElementById('pinVerifyInput');
  const err = document.getElementById('pinVerifyError');
  if (inp) inp.value = '';
  if (err) err.classList.add('opacity-0');

  document.getElementById('pinVerifyModal').classList.remove('hidden');
  refreshIcons();
  if (inp) setTimeout(() => inp.focus(), 50);
}

function closePinVerifyModal() {
  document.getElementById('pinVerifyModal').classList.add('hidden');
  pendingPinActionCallback = null;
}

async function submitPinVerifyChallenge(e) {
  e.preventDefault();
  const inp = document.getElementById('pinVerifyInput');
  const err = document.getElementById('pinVerifyError');
  const entered = inp ? inp.value.trim() : '';

  if (entered.length !== 4) {
    if (err) {
      err.innerText = 'Enter all 4 digits.';
      err.classList.remove('opacity-0');
    }
    return;
  }

  const candidateHash = await sha256Hex(entered);
  if (candidateHash !== appSettings.pinHash) {
    if (err) {
      err.innerText = 'Incorrect Master PIN.';
      err.classList.remove('opacity-0');
    }
    if (inp) {
      inp.value = '';
      inp.focus();
    }
    return;
  }

  const callback = pendingPinActionCallback;
  closePinVerifyModal();
  if (typeof callback === 'function') {
    callback();
  }
}

function updateSortHeaderIcons(prefix, currentSort, columns) {
  columns.forEach(col => {
    const el = document.getElementById(`sortIcon-${prefix}-${col}`);
    if (!el) return;
    if (currentSort.key === col) {
      el.innerHTML = currentSort.dir === 'desc'
        ? `<i data-lucide="chevron-down" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 inline"></i>`
        : `<i data-lucide="chevron-up" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 inline"></i>`;
    } else {
      el.innerHTML = `<i data-lucide="chevrons-up-down" class="w-3.5 h-3.5 text-slate-700 dark:text-slate-300 inline opacity-90"></i>`;
    }
  });
}

/* ---------------- MANUAL LTP ENTRY MODAL ---------------- */
function openLivePricesModal() {
  closeAllTopDropdowns();
  const modal = document.getElementById('livePricesModal');
  const container = document.getElementById('livePricesContainer');
  container.innerHTML = '';

  const data = getCachedEngineData();
  const openHoldings = data.holdings;

  if (openHoldings.length === 0) {
    container.innerHTML = `<div class="text-slate-400 dark:text-slate-500 py-4 text-center">No open holdings available to update.</div>`;
  } else {
    openHoldings.forEach(h => {
      const curPrice = savedManualPrices[h.stock] ? savedManualPrices[h.stock].ltp : h.ltp;
      const safeStock = esc(h.stock);
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 bg-slate-100 dark:bg-[#1A1F2E] rounded-xl border border-slate-200 dark:border-[#222836]';
      row.innerHTML = `
        <div>
          <div class="font-bold text-slate-900 dark:text-white">${safeStock}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">Qty: ${h.qty} • Cost: ${formatINR(h.wap)}</div>
        </div>
        <div class="flex items-center space-x-1.5">
          <span class="text-xs text-slate-500 dark:text-slate-400">₹</span>
          <input type="number" step="0.05" data-symbol="${safeStock}" data-orig="${Number(curPrice).toFixed(2)}" value="${Number(curPrice).toFixed(2)}" class="w-28 bg-white dark:bg-[#131722] border border-slate-300 dark:border-[#222836] rounded-lg p-1.5 text-slate-900 dark:text-white mono-font text-xs text-right focus:outline-none focus:border-emerald-500 font-bold">
        </div>
      `;
      container.appendChild(row);
    });
  }

  modal.classList.remove('hidden');
}

function closeLivePricesModal() {
  document.getElementById('livePricesModal').classList.add('hidden');
}

function saveAllLivePrices() {
  const inputs = document.querySelectorAll('#livePricesContainer input');
  const changedPrices = {};

  inputs.forEach(inp => {
    const sym = inp.dataset.symbol;
    const orig = Number(inp.dataset.orig);
    const val = Number(inp.value);
    if (sym && !isNaN(val) && val > 0 && val !== orig) {
      changedPrices[sym] = { ltp: val };
      savedManualPrices[sym] = { ltp: val };
      marketPrices[sym] = { ltp: val };
    }
  });

  if (Object.keys(changedPrices).length > 0) {
    localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
    recordPriceUpdateTimestamp();

    if (cloudScriptUrl) {
      sendToSheet({ action: "savePrices", prices: changedPrices });
    }
  }

  closeLivePricesModal();
  recalculateAndRender();
}

/* ---------------- MILESTONE GOALS MODAL ---------------- */
const GOAL_CONFIGS = {
  netWorth: { title: 'Net Worth Target', desc: 'Set your total portfolio net worth target milestone.', prefix: '₹' },
  netInvested: { title: 'Net Invested Target', desc: 'Set your target total contributed capital corpus.', prefix: '₹' },
  lifetimePnL: { title: 'Lifetime Profit Target', desc: 'Set your all-time cumulative portfolio profit target.', prefix: '₹' },
  currentFyPnL: { title: 'Current FY Realized Profit Target', desc: 'Set your strict FIFO realized profit target for the current financial year.', prefix: '₹' },
  xirr: { title: 'Annualized XIRR Target', desc: 'Set your target annualized cash-flow hurdle percentage.', prefix: '%' }
};

function openGoalModal(key) {
  const config = GOAL_CONFIGS[key];
  if (!config) return;
  currentEditingGoalKey = key;

  document.getElementById('goalModalTitle').innerText = config.title;
  document.getElementById('goalModalDesc').innerText = config.desc;
  document.getElementById('goalInputPrefix').innerText = config.prefix;
  document.getElementById('goalModalInput').value = milestoneGoals[key] || 0;

  document.getElementById('goalModal').classList.remove('hidden');
}

function closeGoalModal() {
  document.getElementById('goalModal').classList.add('hidden');
  currentEditingGoalKey = null;
}

function saveGoalMilestone() {
  if (!currentEditingGoalKey) return;
  const val = Number(document.getElementById('goalModalInput').value);
  if (isNaN(val) || val <= 0) return;

  milestoneGoals[currentEditingGoalKey] = val;
  localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(milestoneGoals));

  if (cloudScriptUrl) {
    sendToSheet({
      action: "saveGoals",
      goals: { [currentEditingGoalKey]: val }
    });
  }

  closeGoalModal();
  recalculateAndRender();
}

/* ---------------- ALL PORTFOLIO TARGETS MODAL (PIN-GATED) ---------------- */
function openAllTargetsModal() {
  const modal = document.getElementById('allTargetsModal');
  if (!modal) return;

  document.getElementById('targetInput-netWorth').value = milestoneGoals.netWorth || 0;
  document.getElementById('targetInput-netInvested').value = milestoneGoals.netInvested || 0;
  document.getElementById('targetInput-lifetimePnL').value = milestoneGoals.lifetimePnL || 0;
  document.getElementById('targetInput-currentFyPnL').value = milestoneGoals.currentFyPnL || 0;
  document.getElementById('targetInput-xirr').value = milestoneGoals.xirr || 0;

  modal.classList.remove('hidden');
  refreshIcons();
}

function closeAllTargetsModal() {
  const modal = document.getElementById('allTargetsModal');
  if (modal) modal.classList.add('hidden');
}

function saveAllTargetsWithPin() {
  const keys = ['netWorth', 'netInvested', 'lifetimePnL', 'currentFyPnL', 'xirr'];
  const nextGoals = {};

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const inp = document.getElementById(`targetInput-${k}`);
    const val = Number(inp ? inp.value : 0);
    if (isNaN(val) || val <= 0) return;
    nextGoals[k] = val;
  }

  requestPinAuthorization(
    'Authorize Target Changes',
    'Enter your 4-digit Master PIN to update portfolio targets',
    () => {
      Object.assign(milestoneGoals, nextGoals);
      localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(milestoneGoals));

      if (cloudScriptUrl) {
        sendToSheet({
          action: 'saveGoals',
          goals: nextGoals
        });
      }

      closeAllTargetsModal();
      recalculateAndRender();
    }
  );
}

/* ---------------- AUTOMATIC MONTH-END REVIEW MODAL ---------------- */
function getPrecedingMonthEndDate() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 0);
}

function checkPendingMonthEndSnapshot() {
  const isSessionUnlocked = sessionStorage.getItem('MYFOLIOAI_UNLOCKED') === 'true';
  if (!isSessionUnlocked) return;
  if (!transactions || transactions.length === 0) return;

  const lastMonthEnd = getPrecedingMonthEndDate();
  const targetDateStr = formatToSheetDateStr(lastMonthEnd);

  const alreadyExists = chartHistoryRecords.some(r => {
    const checkD = String(r.date || '').trim();
    return checkD.toLowerCase() === targetDateStr.toLowerCase();
  });

  if (!alreadyExists) {
    openMonthEndReviewModal(lastMonthEnd, targetDateStr);
  }
}

function openMonthEndReviewModal(cutoffDate, targetDateStr) {
  const isSessionUnlocked = sessionStorage.getItem('MYFOLIOAI_UNLOCKED') === 'true';
  if (!isSessionUnlocked) return;

  currentPendingMonthEndDateStr = targetDateStr;
  document.getElementById('monthEndDateDisplay').innerText = targetDateStr;
  document.getElementById('monthEndModalSubtitle').innerText = `Provide closing prices as of ${targetDateStr}`;

  const cutoffTime = new Date(cutoffDate.getFullYear(), cutoffDate.getMonth(), cutoffDate.getDate(), 23, 59, 59);
  const pastTxs = transactions.filter(t => new Date(t.date) <= cutoffTime);

  const inv = {};
  let netCap = 0;
  let cash = 0;

  pastTxs.forEach(t => {
    const amt = Number(t.amount || 0);
    if (t.type === 'DEPOSIT') { netCap += amt; cash += amt; }
    else if (t.type === 'WITHDRAWAL') { netCap -= amt; cash -= amt; }
    else if (t.type === 'FEES') { cash -= amt; }
    else if (t.type === 'BUY') {
      cash -= amt;
      if (!inv[t.stock]) inv[t.stock] = 0;
      inv[t.stock] += Number(t.qty || 0);
    } else if (t.type === 'SELL') {
      cash += amt;
      if (!inv[t.stock]) inv[t.stock] = 0;
      inv[t.stock] -= Number(t.qty || 0);
    } else if (t.type === 'BONUS') {
      if (!inv[t.stock]) inv[t.stock] = 0;
      inv[t.stock] += Number(t.qty || 0);
    }
  });

  const openHoldings = Object.keys(inv).filter(s => inv[s] > 0).map(s => ({ stock: s, qty: inv[s] }));
  const container = document.getElementById('monthEndHoldingsContainer');
  container.innerHTML = '';

  if (openHoldings.length === 0) {
    container.innerHTML = `<div class="text-slate-400 py-3 text-center">No open positions as of ${esc(targetDateStr)}.</div>`;
  } else {
    openHoldings.forEach(h => {
      const curPrice = savedManualPrices[h.stock] ? savedManualPrices[h.stock].ltp : (marketPrices[h.stock] ? marketPrices[h.stock].ltp : 0);
      const safeStock = esc(h.stock);
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 bg-slate-100 dark:bg-[#1A1F2E] rounded-xl border border-slate-200 dark:border-[#222836]';
      row.innerHTML = `
        <div>
          <div class="font-bold text-slate-900 dark:text-white">${safeStock}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">Qty at month-end: ${h.qty} shares</div>
        </div>
        <div class="flex items-center space-x-1.5">
          <span class="text-xs text-slate-500">₹</span>
          <input type="number" step="0.05" data-qty="${h.qty}" value="${Number(curPrice).toFixed(2)}" class="w-28 bg-white dark:bg-[#131722] border border-slate-300 dark:border-[#222836] rounded-lg p-1.5 text-slate-900 dark:text-white mono-font text-xs text-right focus:outline-none focus:border-blue-500 font-bold" oninput="recalcMonthEndModal(${netCap}, ${cash})">
        </div>
      `;
      container.appendChild(row);
    });
  }

  recalcMonthEndModal(netCap, cash);
  document.getElementById('monthEndReviewModal').classList.remove('hidden');
}

function recalcMonthEndModal(netCap, cash) {
  let stockVal = 0;
  document.querySelectorAll('#monthEndHoldingsContainer input').forEach(inp => {
    const qty = Number(inp.getAttribute('data-qty') || 0);
    const p = Number(inp.value || 0);
    stockVal += (qty * p);
  });

  const portVal = cash + stockVal;
  const profit = portVal - netCap;

  document.getElementById('meModalStockVal').innerText = formatINR(stockVal);
  document.getElementById('meModalCash').innerText = formatCompactIndian(cash);
  document.getElementById('meModalNetCap').innerText = formatCompactIndian(netCap);
  document.getElementById('meModalPortVal').innerText = formatINR(portVal);
  document.getElementById('meModalProfit').innerText = formatINR(profit);
}

function closeMonthEndModal() {
  document.getElementById('monthEndReviewModal').classList.add('hidden');
}

function commitMonthEndSnapshot() {
  if (!currentPendingMonthEndDateStr) return;

  const dateStr = currentPendingMonthEndDateStr;
  const lastMonthEnd = getPrecedingMonthEndDate();
  const cutoffTime = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), lastMonthEnd.getDate(), 23, 59, 59);
  const pastTxs = transactions.filter(t => new Date(t.date) <= cutoffTime);

  let netCap = 0;
  let cash = 0;
  pastTxs.forEach(t => {
    const amt = Number(t.amount || 0);
    if (t.type === 'DEPOSIT') { netCap += amt; cash += amt; }
    else if (t.type === 'WITHDRAWAL') { netCap -= amt; cash -= amt; }
    else if (t.type === 'FEES') { cash -= amt; }
    else if (t.type === 'BUY') { cash -= amt; }
    else if (t.type === 'SELL') { cash += amt; }
  });

  let stockVal = 0;
  document.querySelectorAll('#monthEndHoldingsContainer input').forEach(inp => {
    const qty = Number(inp.getAttribute('data-qty') || 0);
    const p = Number(inp.value || 0);
    stockVal += (qty * p);
  });

  const portVal = cash + stockVal;
  const profit = portVal - netCap;

  const snapshotPayload = {
    action: "recordSnapshot",
    date: dateStr,
    netCapital: Math.round(netCap),
    cash: Math.round(cash),
    stockVal: Math.round(stockVal),
    portfolioVal: Math.round(portVal),
    profit: Math.round(profit)
  };

  if (cloudScriptUrl) {
    sendToSheet(snapshotPayload);
  }

  chartHistoryRecords.push({
    date: dateStr,
    netCapital: Math.round(netCap),
    cash: Math.round(cash),
    stocks: Math.round(stockVal),
    portfolioValue: Math.round(portVal),
    profit: Math.round(profit)
  });
  localStorage.setItem(CHART_HISTORY_KEY, JSON.stringify(chartHistoryRecords));

  closeMonthEndModal();
  recalculateAndRender();
}

/* ---------------- SETTINGS DROPDOWN & MODALS ---------------- */
function toggleSettingsDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('settingsDropdownMenu');
  const chevron = document.getElementById('settingsDropdownChevron');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  closeAllTopDropdowns('settingsDropdownMenu');
  menu.classList.toggle('hidden', !isHidden);
  if (chevron) chevron.classList.toggle('rotate-180', isHidden);
}

function closeSettingsDropdown() {
  const menu = document.getElementById('settingsDropdownMenu');
  const chevron = document.getElementById('settingsDropdownChevron');
  if (menu) menu.classList.add('hidden');
  if (chevron) chevron.classList.remove('rotate-180');
}

function openPinSettingsModal() {
  closeAllTopDropdowns();
  document.getElementById('settingsCurrentPin').value = '';
  document.getElementById('settingsNewPin').value = '';
  document.getElementById('settingsConfirmPin').value = '';
  const pinMsg = document.getElementById('settingsPinMsg');
  if (pinMsg) {
    pinMsg.innerText = '';
    pinMsg.classList.add('opacity-0');
  }

  const curGroup = document.getElementById('currentPinFieldGroup');
  if (curGroup) {
    curGroup.classList.toggle('hidden', !appSettings.pinHash);
  }

  document.getElementById('pinSettingsModal').classList.remove('hidden');
}

function closePinSettingsModal() {
  document.getElementById('pinSettingsModal').classList.add('hidden');
}

async function updatePinFromSettings() {
  const curPin = document.getElementById('settingsCurrentPin').value.trim();
  const newPin = document.getElementById('settingsNewPin').value.trim();
  const confirmPin = document.getElementById('settingsConfirmPin').value.trim();
  const msg = document.getElementById('settingsPinMsg');

  msg.classList.remove('opacity-0', 'text-emerald-500', 'text-rose-500');

  if (appSettings.pinHash) {
    const testHash = await sha256Hex(curPin);
    if (testHash !== appSettings.pinHash) {
      msg.innerText = 'Current PIN is incorrect.';
      msg.classList.add('text-rose-500');
      return;
    }
  }

  if (newPin.length !== 4 || isNaN(Number(newPin))) {
    msg.innerText = 'New PIN must be exactly 4 numeric digits.';
    msg.classList.add('text-rose-500');
    return;
  }

  if (newPin !== confirmPin) {
    msg.innerText = 'New PIN and confirmation do not match.';
    msg.classList.add('text-rose-500');
    return;
  }

  const newHash = await sha256Hex(newPin);
  appSettings.pinHash = newHash;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));

  if (cloudScriptUrl) {
    sendToSheet({ action: "setPinHash", pinHash: newHash });
  }

  msg.innerText = 'PIN updated successfully!';
  msg.classList.add('text-emerald-500');
  setTimeout(() => closePinSettingsModal(), 1200);
}

function openBackupResultModal(isSuccess, title, message, details = null) {
  const modal = document.getElementById('backupResultModal');
  if (!modal) return;

  const iconWrap = document.getElementById('backupModalIconWrap');
  const iconEl = document.getElementById('backupModalIcon');
  const titleEl = document.getElementById('backupModalTitle');
  const msgEl = document.getElementById('backupModalMessage');
  const metaEl = document.getElementById('backupModalMeta');

  if (titleEl) titleEl.innerText = title;
  if (msgEl) msgEl.innerText = message;

  if (iconWrap && iconEl) {
    if (isSuccess) {
      iconWrap.className = 'h-12 w-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400';
      iconEl.setAttribute('data-lucide', 'check-circle-2');
    } else {
      iconWrap.className = 'h-12 w-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400';
      iconEl.setAttribute('data-lucide', 'alert-triangle');
    }
  }

  if (metaEl) {
    if (isSuccess && details) {
      metaEl.classList.remove('hidden');
      metaEl.innerHTML = `
        <div class="flex justify-between"><span>Snapshot File:</span> <b class="text-slate-800 dark:text-slate-200">${esc(details.backupName || 'MyFolio_DB_Backup')}</b></div>
        <div class="flex justify-between"><span>Completed At:</span> <b class="text-slate-800 dark:text-slate-200">${esc(details.backupTime || '')}</b></div>
        <div class="flex justify-between"><span>Rolling Vault Slots:</span> <b class="text-emerald-600 dark:text-emerald-400">${esc(String(details.totalStored || 1))} / 4 stored</b></div>
      `;
    } else {
      metaEl.classList.add('hidden');
      metaEl.innerHTML = '';
    }
  }

  modal.classList.remove('hidden');
  refreshIcons();
}

function closeBackupResultModal() {
  const modal = document.getElementById('backupResultModal');
  if (modal) modal.classList.add('hidden');
}

function openCashCalibrateModal() {
  closeAllTopDropdowns();
  renderCashCalibrateRows();
  document.getElementById('cashCalibrateModal').classList.remove('hidden');
}

function closeCashCalibrateModal() {
  document.getElementById('cashCalibrateModal').classList.add('hidden');
}

function renderCashCalibrateRows() {
  const container = document.getElementById('cashCalibrateRows');
  if (!container) return;
  container.innerHTML = '';

  const data = getCachedEngineData();

  CALIB_ACCOUNTS.forEach(acct => {
    const rawCash = data.rawAccountCashMap[acct] || 0;
    const currentEffective = data.accountCashMap[acct] || 0;
    const offset = getCalibOffset(acct);
    const rec = cashCalibration.records && cashCalibration.records[acct];
    const lastDate = rec && rec.date ? rec.date : null;
    const safeAcct = esc(acct);

    const row = document.createElement('div');
    row.className = 'p-3 bg-slate-50 dark:bg-[#0A0C10]/70 rounded-xl border border-slate-200 dark:border-[#222836] flex flex-wrap items-center justify-between gap-2.5';
    row.innerHTML = `
      <div>
        <div class="font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
          <span>${safeAcct}</span>
          <span class="text-[10px] text-slate-400 font-medium">(Raw Tagged: ${formatINR(rawCash)})</span>
        </div>
        <div class="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
          Active Offset: <span class="font-mono ${offset >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}">${offset >= 0 ? '+' : ''}${formatINR(offset)}</span>
        </div>
        <div class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          ${lastDate ? `Last calibrated: ${esc(lastDate)}` : 'Not calibrated yet'}
        </div>
      </div>
      <div class="flex items-center space-x-1.5">
        <span class="text-xs font-semibold text-slate-500">₹</span>
        <input
          type="number"
          step="0.01"
          id="calibrateInp_${safeAcct}"
          data-raw="${rawCash}"
          value="${Number(currentEffective).toFixed(2)}"
          placeholder="0.00"
          class="w-32 bg-white dark:bg-[#131722] border border-slate-300 dark:border-[#222836] rounded-lg p-1.5 text-slate-900 dark:text-white mono-font text-xs text-right font-bold focus:outline-none focus:border-emerald-500"
        >
      </div>
    `;
    container.appendChild(row);
  });
}

function saveCashCalibration() {
  const todayStr = todayLocalISO();
  const payload = {};
  const newOffsets = Object.assign({}, cashCalibration.offsets);
  const newRecords = Object.assign({}, cashCalibration.records);

  CALIB_ACCOUNTS.forEach(acct => {
    const inp = document.getElementById(`calibrateInp_${acct}`);
    if (!inp) return;

    const raw = Number(inp.getAttribute('data-raw') || 0);
    const targetActual = Number(inp.value || 0);
    const computedOffset = Number((targetActual - raw).toFixed(2));

    newOffsets[acct] = computedOffset;
    newRecords[acct] = {
      date: todayStr,
      calibratedCash: targetActual,
      rawTaggedCash: raw,
      offset: computedOffset
    };

    payload[acct] = {
      calibratedCash: targetActual,
      rawTaggedCash: raw,
      computedOffset: computedOffset
    };
  });

  cashCalibration = { offsets: newOffsets, records: newRecords };
  localStorage.setItem(CASH_CALIB_KEY, JSON.stringify(cashCalibration));

  if (cloudScriptUrl) {
    sendToSheet({ action: "saveCalibration", calibration: payload });
  }

  closeCashCalibrateModal();
  recalculateAndRender();
}

function openStockMasterModal() {
  closeAllTopDropdowns();
  document.getElementById('smSymbolInput').value = '';
  document.getElementById('smNameInput').value = '';
  const msg = document.getElementById('smStatusMsg');
  if (msg) {
    msg.innerText = '';
    msg.classList.add('opacity-0');
  }
  document.getElementById('stockMasterModal').classList.remove('hidden');
}

function closeStockMasterModal() {
  document.getElementById('stockMasterModal').classList.add('hidden');
}

function handleAddStockMasterSubmit(e) {
  e.preventDefault();
  const symInput = document.getElementById('smSymbolInput');
  const nameInput = document.getElementById('smNameInput');
  const msg = document.getElementById('smStatusMsg');

  const symbol = symInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!symbol) return;

  const existingIndex = stockMasterList.findIndex(item => (item.symbol || '').toUpperCase() === symbol);
  if (existingIndex >= 0) {
    stockMasterList[existingIndex].name = name;
  } else {
    stockMasterList.push({ symbol: symbol, name: name });
  }

  localStorage.setItem(STOCK_MASTER_KEY, JSON.stringify(stockMasterList));
  updateStockAutocompleteOptions();

  if (cloudScriptUrl) {
    sendToSheet({
      action: "addStockMaster",
      symbol: symbol,
      name: name
    });
  }

  msg.innerText = `Added ${symbol} to Master!`;
  msg.classList.remove('opacity-0');

  setTimeout(() => {
    closeStockMasterModal();
  }, 1000);
}

/* ---------------- GLOBAL OUTSIDE CLICK LISTENER ---------------- */
window.addEventListener('click', function(e) {
  const txDropdown = document.getElementById('txDropdownContainer');
  if (txDropdown && !txDropdown.contains(e.target)) {
    closeTxDropdown();
  }

  const settingsDropdown = document.getElementById('settingsDropdownContainer');
  if (settingsDropdown && !settingsDropdown.contains(e.target)) {
    closeSettingsDropdown();
  }

  const chartViewDropdown = document.getElementById('chartViewSwitcherContainer');
  if (chartViewDropdown && !chartViewDropdown.contains(e.target)) {
    closeChartViewDropdown();
  }

  const productsDropdown = document.getElementById('productsDropdownContainer');
  if (productsDropdown && !productsDropdown.contains(e.target)) {
    closeProductsDropdown();
  }
});

window.addEventListener('DOMContentLoaded', init);

/* ============================================================================
   DASHBOARD SESSION METRIC SELECTOR & TREND CHART (ISOLATED)
   ============================================================================ */
let dashboardChartInstance = null;
let selectedDashboardMetric = 'netWorth'; // 'netWorth' | 'netInvested' | 'lifetimePnL' | 'currentFy' | 'xirr'
let dashboardChartRange = 'ALL'; // '6M' | '1Y' | '3Y' | '5Y' | 'ALL'

const DASHBOARD_METRIC_META = {
  netWorth: {
    title: 'Total Net Worth – Trend',
    shortLabel: 'Total Net Worth',
    subtitle: 'Portfolio value over time',
    icon: 'trending-up',
    color: '#1D4ED8',
    rgba: '29, 78, 216',
    isPercent: false
  },
  netInvested: {
    title: 'Net Invested – Trend',
    shortLabel: 'Net Invested',
    subtitle: 'Contributed capital corpus over time',
    icon: 'layers',
    color: '#E11D48',
    rgba: '225, 29, 72',
    isPercent: false
  },
  lifetimePnL: {
    title: 'Lifetime P&L – Trend',
    shortLabel: 'Lifetime P&L',
    subtitle: 'Cumulative profit and loss progression',
    icon: 'award',
    color: '#059669',
    rgba: '5, 150, 105',
    isPercent: false
  },
  currentFy: {
    title: 'FY P&L – Trend',
    shortLabel: 'FY P&L',
    subtitle: 'Financial year realized & unrealized performance',
    icon: 'calendar',
    color: '#9333EA',
    rgba: '147, 51, 234',
    isPercent: false
  },
  xirr: {
    title: 'Annualized XIRR – Trend',
    shortLabel: 'Annualized XIRR',
    subtitle: 'Cash-flow annualized return trajectory',
    icon: 'percent',
    color: '#13357A',
    rgba: '19, 53, 122',
    isPercent: true
  }
};

const dashboardYAxisBlurPlugin = {
  id: 'dashboardYAxisBlur',
  afterDraw(chart) {
    const meta = DASHBOARD_METRIC_META[selectedDashboardMetric] || DASHBOARD_METRIC_META.netWorth;
    if (!tabMaskStates || !tabMaskStates.dashboard || meta.isPercent) return;
    const { ctx, scales } = chart;
    const yAxis = scales.y;
    if (!yAxis) return;

    ctx.save();
    const isDark = document.documentElement.classList.contains('dark');
    yAxis.ticks.forEach((tick, index) => {
      const y = yAxis.getPixelForTick(index);
      const xStart = yAxis.left + 2;
      const xEnd = yAxis.right - 4;
      const boxWidth = xEnd - xStart;
      const boxHeight = 16;
      const boxY = y - (boxHeight / 2);

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(xStart, boxY, boxWidth, boxHeight, 4);
      } else {
        ctx.rect(xStart, boxY, boxWidth, boxHeight);
      }
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)';
      ctx.filter = 'blur(6px)';
      ctx.fill();
    });
    ctx.restore();
  }
};

function dashboardCustomTooltipHandler(context) {
  const { chart, tooltip } = context;
  const tooltipEl = document.getElementById('dashboardChartTooltip');
  if (!tooltipEl) return;

  if (tooltip.opacity === 0) {
    tooltipEl.style.opacity = '0';
    return;
  }

  const meta = DASHBOARD_METRIC_META[selectedDashboardMetric] || DASHBOARD_METRIC_META.netWorth;
  const maskClass = (tabMaskStates && tabMaskStates.dashboard && !meta.isPercent) ? 'privacy-blurred' : '';

  if (tooltip.body) {
    const titleLines = tooltip.title || [];
    let innerHtml = '<div class="space-y-1.5">';

    titleLines.forEach(title => {
      innerHtml += `<div class="font-bold text-slate-900 dark:text-white pb-1 border-b border-slate-100 dark:border-[#222836] text-[11.5px]">${esc(title)}</div>`;
    });

    innerHtml += '<div class="space-y-1 pt-0.5">';
    tooltip.dataPoints.forEach(dp => {
      const dataset = chart.data.datasets[dp.datasetIndex];
      const dotColor = dataset.borderColor || meta.color;
      const rawVal = dp.raw !== undefined ? Number(dp.raw) : 0;
      const formattedVal = meta.isPercent ? `${rawVal.toFixed(2)}%` : formatINR(rawVal, 0);

      let variationHtml = '';
      if (dp.dataIndex > 0) {
        const prevVal = Number(dataset.data[dp.dataIndex - 1] || 0);
        const delta = rawVal - prevVal;
        const isPos = delta >= 0;
        const formattedDelta = meta.isPercent
          ? `${Math.abs(delta).toFixed(2)}%`
          : formatINR(Math.abs(delta), 0);
        variationHtml = ` <span class="text-[10px] font-semibold ${maskClass} ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">(${isPos ? '+' : '-'}${formattedDelta})</span>`;
      }

      innerHtml += `
        <div class="flex items-center justify-between space-x-3 text-[11px]">
          <span class="flex items-center text-slate-600 dark:text-slate-300">
            <span class="w-2 h-2 rounded-full mr-1.5 inline-block shrink-0" style="background-color: ${dotColor}"></span>
            <span>${esc(meta.shortLabel)}:</span>
          </span>
          <span class="font-mono font-bold text-slate-900 dark:text-white tabular-nums ${maskClass}">
            ${formattedVal}${variationHtml}
          </span>
        </div>
      `;
    });
    innerHtml += '</div></div>';
    tooltipEl.innerHTML = innerHtml;
  }

  const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
  const chartCanvasWidth = chart.width;
  const chartCanvasHeight = chart.height;
  const dataIndex = tooltip.dataPoints && tooltip.dataPoints.length > 0 ? tooltip.dataPoints[0].dataIndex : 0;
  const totalPoints = chart.data.labels ? chart.data.labels.length : 10;
  const isNearRightEdge = dataIndex >= totalPoints - 3;

  tooltipEl.style.opacity = '1';

  const tooltipWidth = tooltipEl.offsetWidth || 210;
  const tooltipHeight = tooltipEl.offsetHeight || 90;
  const caretX = tooltip.caretX;
  const caretY = tooltip.caretY;

  const willOverflowRight = (caretX + tooltipWidth + 24) > chartCanvasWidth;
  tooltipEl.style.left = (isNearRightEdge || willOverflowRight)
    ? (positionX + caretX - tooltipWidth - 12) + 'px'
    : (positionX + caretX + 12) + 'px';

  const willOverflowBottom = (caretY + tooltipHeight + 16) > chartCanvasHeight;
  tooltipEl.style.top = willOverflowBottom
    ? (positionY + caretY - tooltipHeight - 12) + 'px'
    : (positionY + caretY - 12) + 'px';
}

function renderDashboardTrendChart(computed) {
  const canvas = document.getElementById('dashboardMetricChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const meta = DASHBOARD_METRIC_META[selectedDashboardMetric] || DASHBOARD_METRIC_META.netWorth;
  const isDark = document.documentElement.classList.contains('dark');
  const tickColor = isDark ? '#94A3B8' : '#64748B';
  const shouldMaskY = !!(tabMaskStates && tabMaskStates.dashboard && !meta.isPercent);
  const series = buildDashboardMetricSeries(computed || getCachedEngineData());

  const labels = series.map(s => s.label);
  const values = series.map(s => s.value);

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement ? canvas.parentElement.clientHeight : 340);
  gradient.addColorStop(0, isDark ? `rgba(${meta.rgba}, 0.24)` : `rgba(${meta.rgba}, 0.18)`);
  gradient.addColorStop(1, `rgba(${meta.rgba}, 0.01)`);

  const dataset = {
    label: meta.shortLabel,
    data: values,
    borderColor: meta.color,
    backgroundColor: gradient,
    fill: true,
    borderWidth: 2.25,
    tension: 0.2,
    pointRadius: values.length <= 14 ? 3.5 : 1.5,
    pointHoverRadius: 5.5,
    pointBackgroundColor: meta.color,
    pointBorderColor: isDark ? '#131722' : '#FFFFFF',
    pointBorderWidth: 1.5
  };

  if (dashboardChartInstance) {
    dashboardChartInstance.data.labels = labels;
    dashboardChartInstance.data.datasets = [dataset];
    dashboardChartInstance.options.scales.y.ticks.color = shouldMaskY ? 'transparent' : tickColor;
    dashboardChartInstance.options.scales.y.ticks.callback = (v) => meta.isPercent ? `${Number(v).toFixed(1)}%` : formatCompactIndian(v);
    dashboardChartInstance.update('none');
    return;
  }

  dashboardChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [dataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'],
      onHover: (event, chartElement) => {
        if (event.type === 'touchmove' && (!chartElement || chartElement.length === 0)) {
          const tooltipEl = document.getElementById('dashboardChartTooltip');
          if (tooltipEl) tooltipEl.style.opacity = '0';
        }
      },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: dashboardCustomTooltipHandler
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: tickColor,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            font: { family: "'Inter', sans-serif", size: 11 }
          }
        },
        y: {
          border: { display: false },
          grid: { color: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' },
          ticks: {
            color: shouldMaskY ? 'transparent' : tickColor,
            font: { family: "'Inter', sans-serif", size: 11 },
            callback: (v) => meta.isPercent ? `${Number(v).toFixed(1)}%` : formatCompactIndian(v)
          }
        }
      }
    },
    plugins: [dashboardYAxisBlurPlugin]
  });
}

function selectDashboardMetric(metricKey) {
  if (!DASHBOARD_METRIC_META[metricKey]) return;
  selectedDashboardMetric = metricKey;

  const metricOrder = ['netWorth', 'netInvested', 'lifetimePnL', 'currentFy', 'xirr'];
  const activeIdx = metricOrder.indexOf(metricKey);

  metricOrder.forEach((key, idx) => {
    const slot = document.getElementById(`dashSlot-${key}`);
    if (slot) {
      const isSelected = key === metricKey;
      slot.classList.toggle('is-active', isSelected);
      slot.classList.remove('slant-left', 'slant-right', 'slant-both', 'hide-left-divider', 'hide-right-divider');

      if (isSelected) {
        if (idx === 0) {
          slot.classList.add('slant-right', 'hide-right-divider');
        } else if (idx === metricOrder.length - 1) {
          slot.classList.add('slant-left', 'hide-left-divider');
        } else {
          slot.classList.add('slant-both', 'hide-left-divider', 'hide-right-divider');
        }
      } else if (activeIdx !== -1) {
        if (idx === activeIdx + 1) {
          slot.classList.add('hide-left-divider');
        }
      }
    }
  });

  const meta = DASHBOARD_METRIC_META[metricKey];
  const titleEl = document.getElementById('dashboardTrendTitle');
  const subEl = document.getElementById('dashboardTrendSubtitle');
  const iconEl = document.getElementById('dashboardTrendIcon');

  if (titleEl) titleEl.innerText = meta.title;
  if (subEl) subEl.innerText = meta.subtitle;
  if (iconEl) iconEl.setAttribute('data-lucide', meta.icon);

  refreshIcons();
  renderDashboardTrendChart(getCachedEngineData());
}

function setDashboardChartRange(range) {
  dashboardChartRange = range;
  document.querySelectorAll('#dashboardRangePills .dash-range-btn').forEach(btn => {
    const active = btn.dataset.dashRange === range;
    btn.className = active
      ? 'dash-range-btn px-2.5 py-1 rounded-lg bg-[#0B1F4C] dark:bg-blue-600 text-white shadow-2xs transition'
      : 'dash-range-btn px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition';
  });
  renderDashboardTrendChart(getCachedEngineData());
}

function filterPointsByDashboardRange(points, range) {
  if (!Array.isArray(points) || points.length === 0 || range === 'ALL') return points;

  const monthsMap = { '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60 };
  const monthsBack = monthsMap[range];
  if (!monthsBack) return points;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);

  const filtered = points.filter(pt => {
    if (pt.date === 'Current') return true;
    const d = new Date(pt.date);
    return !isNaN(d.getTime()) && d >= cutoff;
  });

  return filtered.length > 0 ? filtered : points.slice(-2);
}

function buildDashboardMetricSeries(computed) {
  const basePoints = computeRocFourCurves(computed);
  const ranged = filterPointsByDashboardRange(basePoints, dashboardChartRange);

  return ranged.map((pt, idx) => {
    let val = 0;
    if (selectedDashboardMetric === 'netWorth') {
      val = pt.portfolioValue;
    } else if (selectedDashboardMetric === 'netInvested') {
      val = pt.netCapital;
    } else if (selectedDashboardMetric === 'lifetimePnL') {
      val = pt.profit;
    } else if (selectedDashboardMetric === 'currentFy') {
      val = idx === ranged.length - 1 ? Number(computed.totalUnrealizedPnL || 0) + Number((computed.fyRealized[getFinancialYear(todayLocalISO())] || {}).gain || 0) : pt.profit;
    } else if (selectedDashboardMetric === 'xirr') {
      const yearsElapsed = Math.max(0.25, (idx + 1) / 12);
      const ratio = pt.netCapital > 0 ? (pt.portfolioValue / pt.netCapital) : 1;
      val = idx === ranged.length - 1 && computed.xirrValue !== null && !isNaN(computed.xirrValue)
        ? Number(computed.xirrValue.toFixed(2))
        : Number(((Math.pow(Math.max(0.1, ratio), 1 / yearsElapsed) - 1) * 100).toFixed(2));
    }

    return { label: pt.date, value: val };
  });
}
