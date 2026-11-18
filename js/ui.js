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

/* ---------------- ROTATING HEADER INFO TICKER (POINT 1) ---------------- */
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

/* ---------------- APPLICATION INITIALIZATION ---------------- */
function init() {
  initTheme();
  initTabMaskStates();
  buildDynamicAccountControls();
  updateSyncUI();
  renderLastPriceTimestamp();
  renderLastBackupTimestamp();
  initHeaderInfoTicker();
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
  if (tabKey === 'chart') {
    if (multiChartInstance) multiChartInstance.update('none');
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
  if (!formatted) {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    formatted = `${dd} - ${mm}, ${hh}:${min}`;
  } else {
    // Strip out any year patterns like "-26", "/26", "-2026", "/2026" if sent from the cloud
    formatted = String(formatted).replace(/[-/]\d{2,4}/g, '');
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

/* ---------------- MASTER RECALCULATE & RENDER ---------------- */
function recalculateAndRender() {
  bumpTxVersion();
  const data = getCachedEngineData();

  // Card 1: Total Net Worth
  document.getElementById('kpiNetWorth').innerText = formatINR(data.netWorth);
  document.getElementById('subPortfolioVal').innerText = formatCompactIndian(data.totalPortfolioVal);
  document.getElementById('subCashVal').innerText = formatCompactIndian(data.cashBalance);

  const nwTarget = milestoneGoals.netWorth || 10000000;
  const nwPct = nwTarget > 0 ? Math.min(100, Math.max(0, (data.netWorth / nwTarget) * 100)) : 0;
  const nwRem = Math.max(0, nwTarget - data.netWorth);
  document.getElementById('kpiNetWorthPct').innerText = `${nwPct.toFixed(2)}%`;
  document.getElementById('kpiNetWorthRem').innerText = nwRem > 0 ? `${formatCompactIndian(nwRem)} left` : 'Achieved';
  document.getElementById('kpiNetWorthBar').style.width = `${nwPct}%`;

  // Card 2: Net Invested
  document.getElementById('kpiNetInvested').innerText = formatINR(data.netInvested);
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
    invRemEl.className = 'text-rose-600 dark:text-rose-400 font-bold transition-all duration-200';
    invPctEl.className = 'text-rose-600 dark:text-rose-400 font-bold';
    invBarEl.className = 'bg-gradient-to-r from-rose-600 to-rose-400 h-1.5 rounded-full transition-all duration-500';
  } else {
    invPctEl.innerText = `${invPct.toFixed(2)}%`;
    const invRem = invTarget - data.netInvested;
    invRemEl.innerText = invRem > 0 ? `${formatCompactIndian(invRem)} left` : 'Achieved';
    invRemEl.className = 'text-slate-500 dark:text-slate-400 transition-all duration-200';
    invPctEl.className = 'text-emerald-600 dark:text-emerald-400 font-bold';
    invBarEl.className = 'bg-gradient-to-r from-emerald-600 to-emerald-400 h-1.5 rounded-full transition-all duration-500';
  }
  invBarEl.style.width = `${displayPct}%`;

  // Card 3: Lifetime P&L
  const lifeEl = document.getElementById('kpiLifetimePnL');
  lifeEl.innerText = formatINR(data.lifetimePnL);
  lifeEl.className = `text-xl font-bold tracking-tight tabular-nums leading-none mt-1 transition-all duration-200 ${data.lifetimePnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const lifePctEl = document.getElementById('kpiLifetimePnLPct');
  lifePctEl.innerText = `${data.lifetimePnL >= 0 ? '+' : ''}${data.lifetimePnLPct.toFixed(2)}%`;
  lifePctEl.className = `mt-2 text-[11px] font-semibold ${data.lifetimePnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const pnlTarget = milestoneGoals.lifetimePnL || 2500000;
  const lifeTargetPct = pnlTarget > 0 ? Math.min(100, Math.max(0, (data.lifetimePnL / pnlTarget) * 100)) : 0;
  const lifeRem = Math.max(0, pnlTarget - data.lifetimePnL);
  document.getElementById('kpiLifetimeTargetPct').innerText = `${lifeTargetPct.toFixed(2)}%`;
  document.getElementById('kpiLifetimeTargetRem').innerText = lifeRem > 0 ? `${formatCompactIndian(lifeRem)} left` : 'Achieved';
  document.getElementById('kpiLifetimeBar').style.width = `${lifeTargetPct}%`;

  // Card 4: Current FY Realized & Unrealized
  const curFy = getFinancialYear(todayLocalISO());
  document.getElementById('kpiCurrentFyCardTitle').innerText = curFy;
  const curFyData = data.fyRealized[curFy] || { gain: 0 };

  const curFyEl = document.getElementById('kpiCurrentFyPnL');
  curFyEl.innerText = formatINR(curFyData.gain);
  curFyEl.className = `text-sm font-bold tabular-nums transition-all duration-200 ${curFyData.gain >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`;

  const curFyUnrealEl = document.getElementById('kpiCurrentFyUnrealized');
  curFyUnrealEl.innerText = formatINR(data.totalUnrealizedPnL);
  curFyUnrealEl.className = `text-sm font-bold tabular-nums transition-all duration-200 ${data.totalUnrealizedPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const fyTarget = milestoneGoals.currentFyPnL || 1000000;
  const fyPct = fyTarget > 0 ? Math.min(100, Math.max(0, (curFyData.gain / fyTarget) * 100)) : 0;
  const fyRem = Math.max(0, fyTarget - curFyData.gain);
  document.getElementById('kpiCurrentFyPct').innerText = `${fyPct.toFixed(2)}%`;
  document.getElementById('kpiCurrentFyRem').innerText = fyRem > 0 ? `${formatCompactIndian(fyRem)} left` : 'Achieved';
  document.getElementById('kpiCurrentFyBar').style.width = `${fyPct}%`;

  // Card 5: Annualized XIRR & Inception Date
  const xirrValid = data.xirrValue !== null && data.xirrValue !== undefined && !isNaN(data.xirrValue);
  document.getElementById('kpiXIRR').innerText = xirrValid ? `${data.xirrValue.toFixed(2)}%` : '—';
  const xirrTarget = milestoneGoals.xirr || 25;
  const xirrProgress = (xirrValid && xirrTarget > 0) ? Math.min(100, Math.max(0, (data.xirrValue / xirrTarget) * 100)) : 0;
  const xirrRem = xirrValid ? Math.max(0, xirrTarget - data.xirrValue) : xirrTarget;
  document.getElementById('kpiXirrPct').innerText = xirrValid ? `${xirrProgress.toFixed(2)}%` : '—';
  document.getElementById('kpiXirrRem').innerText = !xirrValid ? '< 90d period' : (xirrRem > 0 ? `${xirrRem.toFixed(2)}% left` : 'Achieved');
  document.getElementById('kpiXirrBar').style.width = `${xirrProgress}%`;

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
  renderTtmTable(data);
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
      btn.className = 'px-2.5 py-1 rounded-md transition-all bg-white dark:bg-[#131722] text-slate-900 dark:text-white shadow-2xs font-semibold';
    } else {
      btn.className = 'px-2.5 py-1 rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium';
    }
  });
  renderHoldings(getCachedEngineData());
  refreshIcons();
}

function renderHoldings(data) {
  const tbody = document.getElementById('holdingsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const maskClass = getMaskClass('holdings');

  let filteredHoldings = [];
  if (currentHoldingsAccountFilter === 'ALL') {
    filteredHoldings = [...data.holdings];
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
        totalFilteredPortVal += curVal;

        filteredHoldings.push({
          stock,
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

  document.getElementById('holdingsCount').innerText = `${filteredHoldings.length} Open Positions`;

  // Liquid Cash Available Badge
  const cashBadgeVal = document.getElementById('holdingsCashBadgeVal');
  const cashBadgeLabel = document.getElementById('holdingsCashBadgeLabel');
  const cashBadgeContainer = document.getElementById('holdingsCashBadge');

  let cashAmt = 0;
  if (currentHoldingsAccountFilter === 'ALL') {
    cashAmt = data.cashBalance;
    cashBadgeLabel.innerText = 'Cash Available (Combined):';
    cashBadgeContainer.removeAttribute('title');
  } else {
    const acct = currentHoldingsAccountFilter;
    cashAmt = data.accountCashMap[acct] || 0;
    cashBadgeLabel.innerText = `Cash Available (${acct}):`;
    const rec = cashCalibration.records && cashCalibration.records[acct];
    if (rec && rec.date) {
      cashBadgeContainer.title = `Calibrated baseline • last calibrated on ${rec.date}`;
    } else {
      cashBadgeContainer.title = 'Not calibrated yet. Use Settings → Cash Calibration.';
    }
  }

  cashBadgeVal.innerText = formatINR(cashAmt);
  cashBadgeVal.className = `tabular-nums font-mono font-extrabold text-sm ${cashAmt >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}`;

  // Win / Loss bar
  const profitPositions = filteredHoldings.filter(h => h.pnlVal >= 0);
  const lossPositions = filteredHoldings.filter(h => h.pnlVal < 0);
  const profitSum = profitPositions.reduce((acc, h) => acc + h.pnlVal, 0);
  const lossSum = lossPositions.reduce((acc, h) => acc + h.pnlVal, 0);
  const totalCount = filteredHoldings.length;
  const winRate = totalCount > 0 ? Math.round((profitPositions.length / totalCount) * 100) : 0;

  document.getElementById('holdingsProfitSummary').innerHTML = `${profitPositions.length} Green <span class="${maskClass}">(+${formatCompactIndian(profitSum)})</span>`;
  document.getElementById('holdingsLossSummary').innerHTML = `${lossPositions.length} Red <span class="${maskClass}">(${formatCompactIndian(lossSum)})</span>`;
  document.getElementById('holdingsWinRateBadge').innerText = `Win Rate: ${winRate}%`;
  document.getElementById('holdingsWinBar').style.width = `${winRate}%`;
  document.getElementById('holdingsLossBar').style.width = `${100 - winRate}%`;

  updateSortHeaderIcons('holdings', holdingsSort, ['stock', 'investedVal', 'currentVal', 'pnlVal']);

  if (filteredHoldings.length === 0) {
    const label = currentHoldingsAccountFilter === 'ALL' ? 'Combined Portfolio' : esc(currentHoldingsAccountFilter);
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400 dark:text-slate-500 font-medium">No active holdings for ${label}.</td></tr>`;
    return;
  }

  const sorted = [...filteredHoldings].sort((a, b) => {
    const valA = a[holdingsSort.key];
    const valB = b[holdingsSort.key];
    if (typeof valA === 'string') {
      return holdingsSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return holdingsSort.dir === 'asc' ? valA - valB : valB - valA;
  });

  sorted.forEach(h => {
    const isPos = h.pnlVal >= 0;
    const safeStock = esc(h.stock);
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
    tr.innerHTML = `
      <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${safeStock}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${h.qty}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300">${formatINR(h.wap)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white cursor-pointer hover:underline" data-action="override-ltp" data-stock="${safeStock}" data-ltp="${h.ltp}" title="Click to override LTP">${formatINR(h.ltp)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 ${maskClass}">${formatINR(h.investedVal)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white ${maskClass}">${formatINR(h.currentVal)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-300">
        <span>${h.weightPct.toFixed(1)}%</span>
        <div class="w-full bg-slate-200 dark:bg-slate-700 h-1 rounded-full mt-1">
          <div class="bg-blue-600 h-1 rounded-full" style="width: ${Math.min(100, h.weightPct)}%"></div>
        </div>
      </td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
        ${isPos ? '+' : ''}${formatINR(h.pnlVal)}
        <span class="text-[11px] block opacity-85">(${isPos ? '+' : ''}${h.pnlPct.toFixed(2)}%)</span>
      </td>
      <td class="py-3 px-4 text-center">
        <button data-action="quick-sell" data-stock="${safeStock}" data-qty="${h.qty}" data-ltp="${h.ltp}" class="px-2.5 py-1 text-[11px] font-semibold rounded bg-rose-50 dark:bg-rose-600/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-600/30 border border-rose-200 dark:border-rose-500/30 transition shadow-2xs">Sell</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  filterHoldingsTable();
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

/* ---------------- CLOSED TRADES TABLE ---------------- */
function renderClosedTrades(closedTrades) {
  const tbody = document.getElementById('closedTradesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const maskClass = getMaskClass('closedTrades');
  updateSortHeaderIcons('closed', closedSort, ['stock', 'totalCostBasis', 'totalProceeds', 'netPnL', 'retPct']);

  if (closedTrades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400 dark:text-slate-500 font-medium">No closed trades recorded yet.</td></tr>`;
    document.getElementById('closedPaginationContainer').classList.add('hidden');
    return;
  }
  document.getElementById('closedPaginationContainer').classList.remove('hidden');

  const sorted = [...closedTrades].sort((a, b) => {
    const valA = a[closedSort.key];
    const valB = b[closedSort.key];
    if (typeof valA === 'string') {
      return closedSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return closedSort.dir === 'asc' ? valA - valB : valB - valA;
  });

  const totalItems = sorted.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (closedTradesCurrentPage > totalPages) closedTradesCurrentPage = totalPages;

  const startIndex = (closedTradesCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
  const pageSlice = sorted.slice(startIndex, endIndex);

  document.getElementById('closedPageInfo').innerText = `Showing ${startIndex + 1}–${endIndex} of ${totalItems} entries`;

  const jumpInput = document.getElementById('closedJumpInput');
  const totalLabel = document.getElementById('closedTotalPagesLabel');
  if (jumpInput) {
    jumpInput.value = closedTradesCurrentPage;
    jumpInput.max = totalPages;
  }
  if (totalLabel) totalLabel.innerText = `of ${totalPages}`;

  document.getElementById('closedPrevBtn').disabled = closedTradesCurrentPage <= 1;
  document.getElementById('closedNextBtn').disabled = closedTradesCurrentPage >= totalPages;

  pageSlice.forEach(c => {
    const avgBuy = c.totalQty > 0 ? (c.totalCostBasis / c.totalQty) : 0;
    const avgSell = c.totalQty > 0 ? (c.totalProceeds / c.totalQty) : 0;
    const isPos = c.netPnL >= 0;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
    tr.innerHTML = `
      <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${esc(c.stock)}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${c.totalQty}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400">${formatINR(avgBuy)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300">${formatINR(avgSell)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 ${maskClass}">${formatINR(c.totalCostBasis)}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${formatINR(c.totalProceeds)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isPos ? '+' : ''}${formatINR(c.netPnL)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isPos ? '+' : ''}${c.retPct.toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  });
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
  const totalPages = Math.ceil(getCachedEngineData().closedTrades.length / PAGE_SIZE);
  if (closedTradesCurrentPage < totalPages) {
    closedTradesCurrentPage++;
    renderClosedTrades(getCachedEngineData().closedTrades);
  }
}

function jumpToClosedPage(val) {
  const totalPages = Math.ceil(getCachedEngineData().closedTrades.length / PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  closedTradesCurrentPage = target;
  renderClosedTrades(getCachedEngineData().closedTrades);
}

/* ---------------- FINANCIAL YEAR SUMMARY ---------------- */
function renderFY(fyRealized) {
  const cards = document.getElementById('fyCardsContainer');
  const tbody = document.getElementById('fySummaryTableBody');
  if (!cards || !tbody) return;
  cards.innerHTML = '';
  tbody.innerHTML = '';

  const maskClass = getMaskClass('fyBreakdown');

  Object.keys(fyRealized).sort().reverse().forEach(fy => {
    const item = fyRealized[fy];
    const isPos = item.gain >= 0;
    const retPct = item.costBasis > 0 ? (item.gain / item.costBasis) * 100 : 0;

    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-[#131722] border border-slate-200 dark:border-[#222836] rounded-xl p-4 shadow-2xs transition-colors';
    card.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
        <span class="font-bold text-slate-900 dark:text-white">${esc(fy)}</span>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-300">FIFO</span>
      </div>
      <div class="flex items-baseline justify-between mt-1.5">
        <span class="text-lg font-bold tabular-nums ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPos ? '+' : ''}${formatINR(item.gain)}
        </span>
        <span class="text-base font-bold tabular-nums text-right ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isPos ? '+' : ''}${retPct.toFixed(2)}%
        </span>
      </div>
      <div class="mt-2.5 text-[11px] space-y-1 text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-[#222836] pt-2">
        <div class="flex justify-between"><span>Sales:</span> <span class="text-slate-800 dark:text-slate-200 font-medium ${maskClass}">${formatINR(item.sellProceeds)}</span></div>
        <div class="flex justify-between"><span>Cost:</span> <span class="text-slate-800 dark:text-slate-200 font-medium ${maskClass}">${formatINR(item.costBasis)}</span></div>
      </div>
    `;
    cards.appendChild(card);

    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-100 dark:border-[#222836]/80';
    tr.innerHTML = `
      <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${esc(fy)}</td>
      <td class="py-3 px-4 text-right tabular-nums ${maskClass}">${formatINR(item.sellProceeds)}</td>
      <td class="py-3 px-4 text-right tabular-nums text-slate-500 dark:text-slate-400 ${maskClass}">${formatINR(item.costBasis)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isPos ? '+' : ''}${formatINR(item.gain)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isPos ? '+' : ''}${retPct.toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---------------- TRADEBOOK LEDGER TABLE ---------------- */
function getFilteredLedgerEntries(ledgerEntries) {
  const reversed = [...ledgerEntries].reverse();
  if (!ledgerSearchTerm) return reversed;
  return reversed.filter(tx =>
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

function renderLedger(ledgerEntries) {
  const tbody = document.getElementById('txTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const maskClass = getMaskClass('ledger');
  const list = getFilteredLedgerEntries(ledgerEntries);

  document.getElementById('ledgerCountBadge').innerText = `${list.length} Entries`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400 font-medium">No matching transactions found.</td></tr>`;
    document.getElementById('ledgerPaginationContainer').classList.add('hidden');
    return;
  }
  document.getElementById('ledgerPaginationContainer').classList.remove('hidden');

  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (ledgerCurrentPage > totalPages) ledgerCurrentPage = totalPages;

  const startIndex = (ledgerCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
  const pageSlice = list.slice(startIndex, endIndex);

  document.getElementById('ledgerPageInfo').innerText = `Showing ${startIndex + 1}–${endIndex} of ${totalItems} entries`;

  const jumpInput = document.getElementById('ledgerJumpInput');
  const totalLabel = document.getElementById('ledgerTotalPagesLabel');
  if (jumpInput) {
    jumpInput.value = ledgerCurrentPage;
    jumpInput.max = totalPages;
  }
  if (totalLabel) totalLabel.innerText = `of ${totalPages}`;

  document.getElementById('ledgerPrevBtn').disabled = ledgerCurrentPage <= 1;
  document.getElementById('ledgerNextBtn').disabled = ledgerCurrentPage >= totalPages;

  const badgeColors = {
    'BUY': 'bg-blue-50 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700/40',
    'SELL': 'bg-rose-50 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700/40',
    'DEPOSIT': 'bg-emerald-50 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/40',
    'WITHDRAWAL': 'bg-amber-50 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/40',
    'FEES': 'bg-slate-100 dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#222836]',
    'BONUS': 'bg-purple-50 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700/40',
    'SPLIT': 'bg-indigo-50 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/40',
    'DEMERGER': 'bg-cyan-50 dark:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-700/40'
  };

  pageSlice.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
    tr.innerHTML = `
      <td class="py-2.5 px-4 tabular-nums text-slate-500 dark:text-slate-400">${esc(tx.date)}</td>
      <td class="py-2.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#222836]">${esc(tx.account || 'Unassigned')}</span></td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColors[tx.type] || badgeColors['FEES']}">${esc(tx.type)}</span></td>
      <td class="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">${esc(tx.stock) || '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums">${tx.qty || '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums">${tx.price ? formatINR(tx.price) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400 ${maskClass}">${tx.cashOut > 0 ? '-' + formatINR(tx.cashOut) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 ${maskClass}">${tx.cashIn > 0 ? '+' + formatINR(tx.cashIn) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white ${maskClass}">${formatINR(tx.runningCash)}</td>
      <td class="py-2.5 px-4 text-slate-500 dark:text-slate-400 truncate max-w-xs">${esc(tx.remarks)}</td>
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
  const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
  if (ledgerCurrentPage < totalPages) {
    ledgerCurrentPage++;
    renderLedger(getCachedEngineData().ledgerEntries);
  }
}

function jumpToLedgerPage(val) {
  const list = getFilteredLedgerEntries(getCachedEngineData().ledgerEntries);
  const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  ledgerCurrentPage = target;
  renderLedger(getCachedEngineData().ledgerEntries);
}

/* ---------------- BANK LEDGER TABLE ---------------- */
function renderBankLedger(bankEntries) {
  const tbody = document.getElementById('bankLedgerTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const maskClass = getMaskClass('bankLedger');
  const list = [...bankEntries].reverse();

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400 font-medium">No bank ledger transactions recorded yet.</td></tr>`;
    document.getElementById('bankLedgerPaginationContainer').classList.add('hidden');
    return;
  }
  document.getElementById('bankLedgerPaginationContainer').classList.remove('hidden');

  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (bankLedgerCurrentPage > totalPages) bankLedgerCurrentPage = totalPages;

  const startIndex = (bankLedgerCurrentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
  const pageSlice = list.slice(startIndex, endIndex);

  document.getElementById('bankLedgerPageInfo').innerText = `Showing ${startIndex + 1}–${endIndex} of ${totalItems} entries`;

  const jumpInput = document.getElementById('bankLedgerJumpInput');
  const totalLabel = document.getElementById('bankLedgerTotalPagesLabel');
  if (jumpInput) {
    jumpInput.value = bankLedgerCurrentPage;
    jumpInput.max = totalPages;
  }
  if (totalLabel) totalLabel.innerText = `of ${totalPages}`;

  document.getElementById('bankLedgerPrevBtn').disabled = bankLedgerCurrentPage <= 1;
  document.getElementById('bankLedgerNextBtn').disabled = bankLedgerCurrentPage >= totalPages;

  pageSlice.forEach(b => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-[#1A1F2E]/50 border-b border-slate-100 dark:border-[#222836]/80 transition-colors';
    tr.innerHTML = `
      <td class="py-2.5 px-4 tabular-nums text-slate-500 dark:text-slate-400">${esc(b.date)}</td>
      <td class="py-2.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-[#1A1F2E] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#222836]">${esc(b.account || 'Unassigned')}</span></td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${b.type === 'DEPOSIT' ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'}">${esc(b.type)}</span></td>
      <td class="py-2.5 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 ${maskClass}">${b.deposit > 0 ? formatINR(b.deposit) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400 ${maskClass}">${b.withdrawal > 0 ? formatINR(b.withdrawal) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white ${maskClass}">${formatINR(b.corpus)}</td>
      <td class="py-2.5 px-4 text-slate-500 dark:text-slate-400">${esc(b.remarks)}</td>
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
  const totalPages = Math.ceil(getCachedEngineData().bankEntries.length / PAGE_SIZE);
  if (bankLedgerCurrentPage < totalPages) {
    bankLedgerCurrentPage++;
    renderBankLedger(getCachedEngineData().bankEntries);
  }
}

function jumpToBankLedgerPage(val) {
  const totalPages = Math.ceil(getCachedEngineData().bankEntries.length / PAGE_SIZE) || 1;
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

  // Filter strictly to profitable closed lots (gain > 0)
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

  // Profitable closed lots only (gain > 0)
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

  // 1. Update 3 Purification KPI Cards
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

  // 2. Render Table A: Profit-Only Paginated Purification Breakdown (Newest first)
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

  // 3. Render Table B: Recorded Donations Log (Newest first)
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

  // Tab 1: Summary Dashboard
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

  // Tab 2: Holdings
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

  // Tab 3: Closed Trades
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

  // Tab 4: Tradebook
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

  // Tab 5: Tax Audit
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

  // Tab 6: Bank Ledger
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

  // Tab 7 & 8: Unified Checkpoint History & RoC Curves
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

  // Tab 9: Purification Ledger (Profitable Trades Only)
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

  // Tab 10: Recorded Donations
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

function renderChart(computed) {
  const canvas = document.getElementById('multiCurveChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const isDark = document.documentElement.classList.contains('dark');
  const horizontalGridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : '#E9EDF3';
  const zeroLineColor = isDark ? 'rgba(255, 255, 255, 0.25)' : '#CBD5E1';
  const tickColor = isDark ? '#94A3B8' : '#64748B';
  const chartHeight = canvas.parentElement ? (canvas.parentElement.clientHeight || 430) : 430;

  const fourPoints = computeRocFourCurves(computed);
  let displayPoints = fourPoints;
  if (currentChartRange === 'TTM' && fourPoints.length > 12) {
    displayPoints = fourPoints.slice(-12);
  }

  const labels = displayPoints.length > 0 ? displayPoints.map(p => p.date) : ['No Data'];
  const datasets = displayPoints.length > 0
    ? buildChartDatasets(ctx, chartHeight, isDark, displayPoints)
    : buildChartDatasets(ctx, chartHeight, isDark, [{ portfolioValue: 0, netCapital: 0, profit: 0, actualVal: 0, netCapBase: 0, pureTarget: 0, ratchetTarget: 0 }]);

  // Update existing chart in place to prevent canvas flicker and memory churn
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
  if (btnChart) btnChart.className = inactiveClasses;
  if (btnProd) btnProd.className = inactiveClasses;

  closeAllTopDropdowns();

  if (view === 'home') {
    if (homeEl) homeEl.classList.remove('hidden');
  } else if (view === 'dashboard') {
    if (dashEl) dashEl.classList.remove('hidden');
    if (btnDash) btnDash.className = activeClasses;
  } else if (view === 'chart') {
    if (chartEl) chartEl.classList.remove('hidden');
    if (btnChart) btnChart.className = activeClasses;
    const data = getCachedEngineData();
    renderChartLegend();
    renderChart(data);
    renderTtmTable(data);
  } else if (view === 'portfolio') {
    if (portEl) portEl.classList.remove('hidden');
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

  const activeClasses = 'px-3.5 py-2 rounded-xl transition bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/60 flex items-center space-x-2';
  const inactiveClasses = 'px-3.5 py-2 rounded-xl transition text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A1F2E] flex items-center space-x-2';

  if (homeEl) homeEl.classList.add('hidden');
  if (dashEl) dashEl.classList.add('hidden');
  if (chartEl) chartEl.classList.add('hidden');
  if (portEl) portEl.classList.add('hidden');
  if (prodEl) prodEl.classList.add('hidden');

  if (btnDash) btnDash.className = inactiveClasses;
  if (btnChart) btnChart.className = inactiveClasses;
  if (btnProd) btnProd.className = inactiveClasses;

  if (subTabKey === 'holdings') {
    if (portEl) portEl.classList.remove('hidden');
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

// Keep backward compatibility for legacy switchTab calls if any
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

  // Show mandatory Debt-to-Asset % input only for SELL transactions
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

  // Mandatory Debt-to-Asset (%) validation for SELL transactions
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

  // If editing an existing transaction, check FIFO integrity and gate behind Master PIN
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

  // New transaction creation
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

// 1. PIN Settings Modal
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

// 2. Custom In-App Backup Status Modal & Trigger
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

// 3. Cash Calibration Modal
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

// 4. Stock Master Modal
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
