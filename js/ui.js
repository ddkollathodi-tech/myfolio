// ============================================================================
// MyFolioAI - UI Controller, Renderers, Chart & Event Handlers (ui.js)
// ============================================================================

let multiChartInstance = null;
let currentEditingGoalKey = null;
let currentPendingMonthEndDateStr = null;
let pendingCodeBackupType = null; // 'frontend' | 'backend' during PIN prompt

/* ---------------- APPLICATION INITIALIZATION ---------------- */
function init() {
  initTheme();
  initTabMaskStates();
  ensureChartDomElements();
  updateSyncUI();
  renderLastPriceTimestamp();
  renderLastBackupTimestamp();
  initAutoLockEngine();
  initKeyboardPinListener();
  resetKpiMasksToDefault();

  const savedTx = localStorage.getItem(STORAGE_KEY);
  if (savedTx) {
    try { transactions = JSON.parse(savedTx); } catch (e) { transactions = []; }
  }

  updateStockAutocompleteOptions();
  checkGatekeeperState();

  if (cloudScriptUrl) {
    fetchFromGoogleSheet();
  } else {
    recalculateAndRender();
  }
}

/* ---------------- STEALTH MASKING SYSTEM (POINT 5) ---------------- */
function initTabMaskStates() {
  // POINT 5: Enforce blur-by-default across all privacy tabs on every login and refresh
  tabMaskStates = {
    chart: true,
    holdings: true,
    closedTrades: true,
    fyBreakdown: true,
    ledger: true,
    bankLedger: true,
    taxPnl: true
  };
  localStorage.setItem(TAB_MASK_STATES_KEY, JSON.stringify(tabMaskStates));

  Object.keys(tabMaskStates).forEach(k => updateTabMaskIcon(k));
  syncYAxisBlurOverlay();
}

function toggleTabMask(tabKey) {
  if (!tabMaskStates.hasOwnProperty(tabKey)) return;
  tabMaskStates[tabKey] = !tabMaskStates[tabKey];
  localStorage.setItem(TAB_MASK_STATES_KEY, JSON.stringify(tabMaskStates));
  updateTabMaskIcon(tabKey);

  const data = computeEngine();
  if (tabKey === 'chart') {
    syncYAxisBlurOverlay();
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
  }
  if (window.lucide) lucide.createIcons();
}

function updateTabMaskIcon(tabKey) {
  const icon = document.getElementById(`maskToggleIcon-${tabKey}`);
  if (!icon) return;
  const isMasked = !!tabMaskStates[tabKey];
  icon.setAttribute('data-lucide', isMasked ? 'eye-off' : 'eye');
}

function getMaskClass(tabKey) {
  return tabMaskStates[tabKey] ? 'blurred-mask' : 'mask-transition';
}

function ensureChartDomElements() {
  const canvas = document.getElementById('multiCurveChart');
  if (!canvas || !canvas.parentElement) return;
  const wrapper = canvas.parentElement;

  if (!document.getElementById('chartYAxisBlurOverlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'chartYAxisBlurOverlay';
    overlay.className = 'absolute top-0 left-0 pointer-events-none transition-all duration-200 z-10 hidden';
    overlay.style.cssText = 'width: 65px; height: calc(100% - 28px); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); background: rgba(255,255,255,0.06);';
    wrapper.appendChild(overlay);
  }

  if (!document.getElementById('chartCustomTooltip')) {
    const tooltipEl = document.createElement('div');
    tooltipEl.id = 'chartCustomTooltip';
    tooltipEl.className = 'pointer-events-none absolute z-30 rounded-xl border border-slate-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 shadow-xl backdrop-blur-md p-3 text-xs transition-opacity duration-150 opacity-0 min-w-[200px]';
    wrapper.appendChild(tooltipEl);
  }
}

function syncYAxisBlurOverlay() {
  ensureChartDomElements();
  const overlay = document.getElementById('chartYAxisBlurOverlay');
  if (!overlay) return;
  if (tabMaskStates.chart) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

/* ---------------- THEME TOGGLE (POINT 3: Default Light Mode) ---------------- */
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

  if (window.lucide) lucide.createIcons();

  if (multiChartInstance) {
    renderChart(computeEngine());
  }
}

/* ---------------- TIMESTAMP MANAGEMENT ---------------- */
function recordPriceUpdateTimestamp(customDate) {
  const d = customDate || new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');

  const formatted = `${day}-${month}-${year}, ${hours}:${mins}`;
  localStorage.setItem(LAST_PRICE_UPDATE_KEY, formatted);
  renderLastPriceTimestamp();
}

function renderLastPriceTimestamp() {
  const val = localStorage.getItem(LAST_PRICE_UPDATE_KEY);
  const el = document.getElementById('lastSyncedTime');
  if (el) {
    el.innerText = val || 'Not refreshed yet';
  }
}

function recordBackupTimestamp(customStr) {
  const formatted = customStr || `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getFullYear()).slice(-2)}, ${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  localStorage.setItem('MYFOLIOAI_LAST_BACKUP_TIME', formatted);
  renderLastBackupTimestamp();
}

function renderLastBackupTimestamp() {
  const val = localStorage.getItem('MYFOLIOAI_LAST_BACKUP_TIME');
  const el = document.getElementById('lastBackupTime');
  if (el) {
    el.innerText = val || 'Not backed up yet';
  }
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
  const data = computeEngine();

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
  const invPct = invTarget > 0 ? Math.min(100, Math.max(0, (data.netInvested / invTarget) * 100)) : 0;
  const invRem = Math.max(0, invTarget - data.netInvested);
  document.getElementById('kpiNetInvestedPct').innerText = `${invPct.toFixed(2)}%`;
  document.getElementById('kpiNetInvestedRem').innerText = invRem > 0 ? `${formatCompactIndian(invRem)} left` : 'Achieved';
  document.getElementById('kpiNetInvestedBar').style.width = `${invPct}%`;

  // Card 3: Lifetime P&L
  const lifeEl = document.getElementById('kpiLifetimePnL');
  lifeEl.innerText = formatINR(data.lifetimePnL);
  lifeEl.className = `text-2xl font-bold tracking-tight tabular-nums transition-all duration-200 ${data.lifetimePnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const lifePctEl = document.getElementById('kpiLifetimePnLPct');
  lifePctEl.innerText = `${data.lifetimePnL >= 0 ? '+' : ''}${data.lifetimePnLPct.toFixed(2)}%`;
  lifePctEl.className = `mt-1 text-[11px] font-semibold ${data.lifetimePnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  const pnlTarget = milestoneGoals.lifetimePnL || 2500000;
  const lifeTargetPct = pnlTarget > 0 ? Math.min(100, Math.max(0, (data.lifetimePnL / pnlTarget) * 100)) : 0;
  const lifeRem = Math.max(0, pnlTarget - data.lifetimePnL);
  document.getElementById('kpiLifetimeTargetPct').innerText = `${lifeTargetPct.toFixed(2)}%`;
  document.getElementById('kpiLifetimeTargetRem').innerText = lifeRem > 0 ? `${formatCompactIndian(lifeRem)} left` : 'Achieved';
  document.getElementById('kpiLifetimeBar').style.width = `${lifeTargetPct}%`;

  // Card 4: Current FY Realized & Unrealized
  const curFy = getFinancialYear(new Date().toISOString().split('T')[0]);
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
  document.getElementById('kpiXIRR').innerText = `${data.xirrValue.toFixed(2)}%`;
  const xirrTarget = milestoneGoals.xirr || 25;
  const xirrProgress = xirrTarget > 0 ? Math.min(100, Math.max(0, (data.xirrValue / xirrTarget) * 100)) : 0;
  const xirrRem = Math.max(0, xirrTarget - data.xirrValue);
  document.getElementById('kpiXirrPct').innerText = `${xirrProgress.toFixed(2)}%`;
  document.getElementById('kpiXirrRem').innerText = xirrRem > 0 ? `${xirrRem.toFixed(2)}% left` : 'Achieved';
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
  renderHoldings(data);
  renderClosedTrades(data.closedTrades);
  renderFY(data.fyRealized);
  renderLedger(data.ledgerEntries);
  renderBankLedger(data.bankEntries);
  populateTaxFyOptions(data.fyRealized);
  renderTaxView();
  renderChartLegend();
  renderChart(data);
  syncYAxisBlurOverlay();
  renderTtmTable(data);

  if (window.lucide) lucide.createIcons();
}

/* ---------------- ACTIVE HOLDINGS TABLE ---------------- */
function setHoldingsAccountFilter(acct) {
  currentHoldingsAccountFilter = acct;
  ['ALL', 'Me', 'Wife', 'Mom', 'Brother'].forEach(key => {
    const btn = document.getElementById(`holdingsAcctBtn-${key}`);
    if (!btn) return;
    if (key === acct) {
      btn.className = 'px-2.5 py-1 rounded-md transition-all bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-xs font-semibold';
    } else {
      btn.className = 'px-2.5 py-1 rounded-md transition-all text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white font-medium';
    }
  });
  renderHoldings(computeEngine());
}

function renderHoldings(data) {
  const tbody = document.getElementById('holdingsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const maskClass = getMaskClass('holdings');

  let relevantLots = data.openLots;
  if (currentHoldingsAccountFilter !== 'ALL') {
    relevantLots = relevantLots.filter(l => l.account === currentHoldingsAccountFilter);
  }

  const aggMap = {};
  let totalFilteredPortVal = 0;
  let totalFilteredInvested = 0;

  relevantLots.forEach(lot => {
    if (!aggMap[lot.stock]) {
      aggMap[lot.stock] = { totalQty: 0, totalCost: 0 };
    }
    aggMap[lot.stock].totalQty += lot.qty;
    aggMap[lot.stock].totalCost += (lot.qty * lot.price);
  });

  const filteredHoldings = [];
  Object.keys(aggMap).forEach(stock => {
    const item = aggMap[stock];
    if (item.totalQty > 0) {
      const wap = item.totalCost / item.totalQty;
      const liveData = marketPrices[stock] || savedManualPrices[stock] || { ltp: wap, prevClose: wap };
      const ltp = liveData.ltp;
      const curVal = item.totalQty * ltp;
      const invVal = item.totalCost;
      const pnlVal = curVal - invVal;
      const pnlPct = invVal > 0 ? (pnlVal / invVal) * 100 : 0;

      totalFilteredPortVal += curVal;
      totalFilteredInvested += invVal;

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
  // POINT 7: Dynamic green/red font color keeping neutral grey card background
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
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400 dark:text-gray-500 font-medium">No active holdings for ${currentHoldingsAccountFilter === 'ALL' ? 'Combined Portfolio' : currentHoldingsAccountFilter}.</td></tr>`;
    return;
  }

  const sorted = [...filteredHoldings].sort((a, b) => {
    let valA = a[holdingsSort.key];
    let valB = b[holdingsSort.key];

    if (typeof valA === 'string') {
      return holdingsSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return holdingsSort.dir === 'asc' ? valA - valB : valB - valA;
  });

  sorted.forEach(h => {
    const isPos = h.pnlVal >= 0;
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60 transition-colors';
    tr.innerHTML = `
      <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${h.stock}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${h.qty}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-gray-300">${formatINR(h.wap)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white cursor-pointer hover:underline" onclick="manualOverridePrice('${h.stock}', ${h.ltp})" title="Click to override LTP">${formatINR(h.ltp)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-gray-400 ${maskClass}">${formatINR(h.investedVal)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white ${maskClass}">${formatINR(h.currentVal)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold text-slate-700 dark:text-gray-300">
        <span>${h.weightPct.toFixed(1)}%</span>
        <div class="w-full bg-slate-200 dark:bg-gray-700 h-1 rounded-full mt-1">
          <div class="bg-blue-600 h-1 rounded-full" style="width: ${Math.min(100, h.weightPct)}%"></div>
        </div>
      </td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
        ${isPos ? '+' : ''}${formatINR(h.pnlVal)}
        <span class="text-[11px] block opacity-85">(${isPos ? '+' : ''}${h.pnlPct.toFixed(2)}%)</span>
      </td>
      <td class="py-3 px-4 text-center">
        <button onclick="quickSellModal('${h.stock}', ${h.qty}, ${h.ltp})" class="px-2.5 py-1 text-[11px] font-semibold rounded bg-rose-50 dark:bg-rose-600/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-600/30 border border-rose-200 dark:border-rose-500/30 transition shadow-2xs">Sell</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  filterHoldingsTable();
}

function handleHoldingsSort(key) {
  if (holdingsSort.key === key) {
    holdingsSort.dir = holdingsSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    holdingsSort.key = key;
    holdingsSort.dir = 'desc';
  }
  renderHoldings(computeEngine());
}

function filterHoldingsTable() {
  const q = (document.getElementById('holdingsSearch').value || '').toLowerCase();
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
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400 dark:text-gray-500 font-medium">No closed trades recorded yet.</td></tr>`;
    document.getElementById('closedPaginationContainer').classList.add('hidden');
    return;
  }
  document.getElementById('closedPaginationContainer').classList.remove('hidden');

  const sorted = [...closedTrades].sort((a, b) => {
    let valA = a[closedSort.key];
    let valB = b[closedSort.key];

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
    const retPct = c.retPct;
    const isPos = c.netPnL >= 0;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60 transition-colors';
    tr.innerHTML = `
      <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${c.stock}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${c.totalQty}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-gray-400">${formatINR(avgBuy)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-gray-300">${formatINR(avgSell)}</td>
      <td class="py-3 px-3 text-right tabular-nums text-slate-500 dark:text-gray-400 ${maskClass}">${formatINR(c.totalCostBasis)}</td>
      <td class="py-3 px-3 text-right tabular-nums ${maskClass}">${formatINR(c.totalProceeds)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isPos ? '+' : ''}${formatINR(c.netPnL)}</td>
      <td class="py-3 px-3 text-right tabular-nums font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isPos ? '+' : ''}${retPct.toFixed(2)}%</td>
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
  renderClosedTrades(computeEngine().closedTrades);
}

function prevClosedPage() {
  if (closedTradesCurrentPage > 1) {
    closedTradesCurrentPage--;
    renderClosedTrades(computeEngine().closedTrades);
  }
}

function nextClosedPage() {
  const totalPages = Math.ceil(computeEngine().closedTrades.length / PAGE_SIZE);
  if (closedTradesCurrentPage < totalPages) {
    closedTradesCurrentPage++;
    renderClosedTrades(computeEngine().closedTrades);
  }
}

function jumpToClosedPage(val) {
  const totalPages = Math.ceil(computeEngine().closedTrades.length / PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  closedTradesCurrentPage = target;
  renderClosedTrades(computeEngine().closedTrades);
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
    card.className = 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl p-4 shadow-xs transition-colors';
    card.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-500 dark:text-gray-400 mb-1">
        <span class="font-bold text-slate-900 dark:text-white">${fy}</span>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300">FIFO</span>
      </div>
      <div class="flex items-baseline justify-between mt-1.5">
        <span class="text-lg font-bold tabular-nums ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPos ? '+' : ''}${formatINR(item.gain)}
        </span>
        <span class="text-base font-bold tabular-nums text-right ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isPos ? '+' : ''}${retPct.toFixed(2)}%
        </span>
      </div>
      <div class="mt-2.5 text-[11px] space-y-1 text-slate-500 dark:text-gray-400 border-t border-slate-100 dark:border-gray-800 pt-2">
        <div class="flex justify-between"><span>Sales:</span> <span class="text-slate-800 dark:text-gray-200 font-medium ${maskClass}">${formatINR(item.sellProceeds)}</span></div>
        <div class="flex justify-between"><span>Cost:</span> <span class="text-slate-800 dark:text-gray-200 font-medium ${maskClass}">${formatINR(item.costBasis)}</span></div>
      </div>
    `;
    cards.appendChild(card);

    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-100 dark:border-gray-800/60';
    tr.innerHTML = `
      <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${fy}</td>
      <td class="py-3 px-4 text-right tabular-nums ${maskClass}">${formatINR(item.sellProceeds)}</td>
      <td class="py-3 px-4 text-right tabular-nums text-slate-500 dark:text-gray-400 ${maskClass}">${formatINR(item.costBasis)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">${isPos ? '+' : ''}${formatINR(item.gain)}</td>
      <td class="py-3 px-4 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isPos ? '+' : ''}${retPct.toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---------------- TRADEBOOK LEDGER TABLE ---------------- */
function handleLedgerSearch() {
  ledgerSearchTerm = (document.getElementById('ledgerSearchInput').value || '').toLowerCase().trim();
  ledgerCurrentPage = 1;
  renderLedger(computeEngine().ledgerEntries);
}

function renderLedger(ledgerEntries) {
  const tbody = document.getElementById('txTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const maskClass = getMaskClass('ledger');
  let list = [...ledgerEntries].reverse();
  if (ledgerSearchTerm) {
    list = list.filter(tx => 
      (tx.stock && tx.stock.toLowerCase().includes(ledgerSearchTerm)) ||
      (tx.type && tx.type.toLowerCase().includes(ledgerSearchTerm)) ||
      (tx.account && tx.account.toLowerCase().includes(ledgerSearchTerm)) ||
      (tx.remarks && tx.remarks.toLowerCase().includes(ledgerSearchTerm))
    );
  }

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
    'FEES': 'bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border-slate-300 dark:border-gray-700',
    'BONUS': 'bg-purple-50 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700/40',
    'SPLIT': 'bg-indigo-50 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/40',
    'DEMERGER': 'bg-cyan-50 dark:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-700/40'
  };

  pageSlice.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60 transition-colors';
    tr.innerHTML = `
      <td class="py-2.5 px-4 tabular-nums text-slate-500 dark:text-gray-400">${tx.date}</td>
      <td class="py-2.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700">${tx.account || 'Unassigned'}</span></td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColors[tx.type] || badgeColors['FEES']}">${tx.type}</span></td>
      <td class="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">${tx.stock || '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums">${tx.qty || '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums">${tx.price ? formatINR(tx.price) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400 ${maskClass}">${tx.cashOut > 0 ? '-' + formatINR(tx.cashOut) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 ${maskClass}">${tx.cashIn > 0 ? '+' + formatINR(tx.cashIn) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white ${maskClass}">${formatINR(tx.runningCash)}</td>
      <td class="py-2.5 px-4 text-slate-500 dark:text-gray-400 truncate max-w-xs">${tx.remarks || ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function prevLedgerPage() {
  if (ledgerCurrentPage > 1) {
    ledgerCurrentPage--;
    renderLedger(computeEngine().ledgerEntries);
  }
}

function nextLedgerPage() {
  const filteredCount = computeEngine().ledgerEntries.length;
  const totalPages = Math.ceil(filteredCount / PAGE_SIZE);
  if (ledgerCurrentPage < totalPages) {
    ledgerCurrentPage++;
    renderLedger(computeEngine().ledgerEntries);
  }
}

function jumpToLedgerPage(val) {
  let list = computeEngine().ledgerEntries;
  if (ledgerSearchTerm) {
    list = list.filter(tx => 
      (tx.stock && tx.stock.toLowerCase().includes(ledgerSearchTerm)) ||
      (tx.type && tx.type.toLowerCase().includes(ledgerSearchTerm)) ||
      (tx.account && tx.account.toLowerCase().includes(ledgerSearchTerm)) ||
      (tx.remarks && tx.remarks.toLowerCase().includes(ledgerSearchTerm))
    );
  }
  const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  ledgerCurrentPage = target;
  renderLedger(computeEngine().ledgerEntries);
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
    tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60 transition-colors';
    tr.innerHTML = `
      <td class="py-2.5 px-4 tabular-nums text-slate-500 dark:text-gray-400">${b.date}</td>
      <td class="py-2.5 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700">${b.account || 'Unassigned'}</span></td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${b.type === 'DEPOSIT' ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'}">${b.type}</span></td>
      <td class="py-2.5 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 ${maskClass}">${b.deposit > 0 ? formatINR(b.deposit) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400 ${maskClass}">${b.withdrawal > 0 ? formatINR(b.withdrawal) : '—'}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white ${maskClass}">${formatINR(b.corpus)}</td>
      <td class="py-2.5 px-4 text-slate-500 dark:text-gray-400">${b.remarks || ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function prevBankLedgerPage() {
  if (bankLedgerCurrentPage > 1) {
    bankLedgerCurrentPage--;
    renderBankLedger(computeEngine().bankEntries);
  }
}

function nextBankLedgerPage() {
  const totalPages = Math.ceil(computeEngine().bankEntries.length / PAGE_SIZE);
  if (bankLedgerCurrentPage < totalPages) {
    bankLedgerCurrentPage++;
    renderBankLedger(computeEngine().bankEntries);
  }
}

function jumpToBankLedgerPage(val) {
  const totalPages = Math.ceil(computeEngine().bankEntries.length / PAGE_SIZE) || 1;
  let target = parseInt(val, 10);
  if (isNaN(target) || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  bankLedgerCurrentPage = target;
  renderBankLedger(computeEngine().bankEntries);
}

/* ---------------- DYNAMIC HEADER LEGEND RENDERER (POINT 4: Extreme Target) ---------------- */
function renderChartLegend() {
  const container = document.getElementById('chartLegendContainer');
  if (!container) return;

  if (currentChartView === 'roc') {
    container.innerHTML = `
      <span class="inline-flex items-center text-slate-600 dark:text-gray-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-blue-600 mr-1.5 ring-2 ring-blue-500/20"></span>Actual Track
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-gray-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-rose-600 mr-1.5 ring-2 ring-rose-500/20"></span>Capital Base
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-gray-300 font-medium">
        <span class="w-2.5 h-0.5 border-t-2 border-dotted border-amber-500 mr-1.5"></span>Pure 2% Hurdle
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-gray-300 font-medium">
        <span class="w-2.5 h-0.5 border-t-2 border-dashed border-purple-600 mr-1.5"></span>Extreme Target
      </span>
    `;
  } else {
    container.innerHTML = `
      <span class="inline-flex items-center text-slate-600 dark:text-gray-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-blue-600 mr-1.5 ring-2 ring-blue-500/20"></span>Net Worth
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-gray-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-rose-600 mr-1.5 ring-2 ring-rose-500/20"></span>My Capital
      </span>
      <span class="inline-flex items-center text-slate-600 dark:text-gray-300 font-medium">
        <span class="w-2 h-2 rounded-full bg-emerald-600 mr-1.5 ring-2 ring-emerald-500/20"></span>Profit
      </span>
    `;
  }
}

/* ---------------- VIEW SWITCHER DROPDOWN ---------------- */
function toggleChartViewDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('chartViewDropdownMenu');
  const chevron = document.getElementById('chartViewChevron');
  if (!menu) return;

  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    menu.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
  } else {
    menu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
  }
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
  const data = computeEngine();
  renderChart(data);
  syncYAxisBlurOverlay();
  renderTtmTable(data);
}

/* ---------------- TTM BREAKDOWN ACCORDION ---------------- */
function toggleTtmTableAccordion() {
  const container = document.getElementById('ttmTableContainer');
  const chevron = document.getElementById('ttmAccordionChevron');
  const isHidden = container.classList.contains('hidden');

  if (isHidden) {
    container.classList.remove('hidden');
    chevron.classList.add('rotate-180');
  } else {
    container.classList.add('hidden');
    chevron.classList.remove('rotate-180');
  }
}

function renderTtmTable(computed) {
  const thead = document.getElementById('ttmTableHead');
  const tbody = document.getElementById('ttmTableBody');
  const titleEl = document.getElementById('ttmAccordionTitle');
  if (!thead || !tbody) return;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  const maskClass = getMaskClass('chart');

  if (currentChartView === 'roc') {
    if (titleEl) titleEl.innerText = 'Monthly RoC & 4-Curve Milestone Ledger';

    thead.innerHTML = `
      <tr>
        <th class="py-2.5 px-3 font-semibold">Checkpoint</th>
        <th class="py-2.5 px-3 text-right font-semibold">Start Capital</th>
        <th class="py-2.5 px-3 text-right font-semibold">Actual Value</th>
        <th class="py-2.5 px-3 text-right font-semibold">Monthly P&L</th>
        <th class="py-2.5 px-3 text-right font-semibold">Monthly RoC</th>
        <th class="py-2.5 px-3 text-right font-semibold">Pure 2% Target</th>
        <th class="py-2.5 px-3 text-right font-semibold">Pure 2% Gap</th>
        <th class="py-2.5 px-3 text-right font-semibold">Extreme Target</th>
        <th class="py-2.5 px-3 text-right font-semibold">Extreme Deficit</th>
        <th class="py-2.5 px-3 text-right font-semibold">Recovery %</th>
      </tr>
    `;

    const fourCurvePoints = computeRocFourCurves(computed);
    if (!fourCurvePoints || fourCurvePoints.length < 2) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-slate-400">Need at least 2 checkpoints to compute Monthly RoC metrics.</td></tr>`;
      return;
    }

    const ttmPoints = fourCurvePoints.slice(-13);
    const rows = ttmPoints.slice(1).reverse();

    rows.forEach(r => {
      const isPosProfit = r.deltaProfit >= 0;
      const isPosGap = r.pureGap >= 0;
      const isPosRatchet = r.ratchetDeficit >= 0;

      let recoveryPct = 0;
      if (r.ratchetDeficit < 0 && r.actualVal > 0) {
        recoveryPct = (Math.abs(r.ratchetDeficit) / r.actualVal) * 100;
      }

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">${r.date}</td>
        <td class="py-2.5 px-3 text-right tabular-nums text-slate-500 ${maskClass}">${formatINR(r.startCapital, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white ${maskClass}">${formatINR(r.actualVal, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPosProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPosProfit ? '+' : ''}${formatINR(r.deltaProfit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-semibold ${isPosProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isPosProfit ? '+' : ''}${r.rocPct.toFixed(2)}%
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400 ${maskClass}">${formatINR(r.pureTarget, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPosGap ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPosGap ? '+' : ''}${formatINR(r.pureGap, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums text-purple-600 dark:text-purple-400 ${maskClass}">${formatINR(r.ratchetTarget, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPosRatchet ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPosRatchet ? '+' : ''}${formatINR(r.ratchetDeficit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">
          ${recoveryPct > 0 ? recoveryPct.toFixed(2) + '%' : '—'}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } else {
    if (titleEl) titleEl.innerText = 'Trailing 12-Months (TTM) Performance Ledger';

    thead.innerHTML = `
      <tr>
        <th class="py-2.5 px-3 font-semibold">Checkpoint</th>
        <th class="py-2.5 px-3 text-right font-semibold">Portfolio Value</th>
        <th class="py-2.5 px-3 text-right font-semibold">Net Capital</th>
        <th class="py-2.5 px-3 text-right font-semibold">Period P&L</th>
        <th class="py-2.5 px-3 text-right font-semibold">Return %</th>
        <th class="py-2.5 px-3 text-right font-semibold">Cumulative P&L</th>
        <th class="py-2.5 px-3 text-right font-semibold">Cumulative RoC</th>
      </tr>
    `;

    let history = [...chartHistoryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (computed) {
      history.push({
        date: 'Current',
        portfolioValue: computed.netWorth,
        netCapital: computed.netInvested,
        profit: computed.lifetimePnL
      });
    }

    if (history.length < 2) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-400">Need at least 2 checkpoints to compute trailing monthly deltas.</td></tr>`;
      return;
    }

    const ttmRecords = history.slice(-13);
    const rows = [];

    for (let i = 1; i < ttmRecords.length; i++) {
      const curr = ttmRecords[i];
      const prev = ttmRecords[i - 1];

      const deltaProfit = Number(curr.profit || 0) - Number(prev.profit || 0);
      const prevPortVal = Number(prev.portfolioValue || 0);
      const monthlyReturnPct = prevPortVal > 0 ? (deltaProfit / prevPortVal) * 100 : 0;
      
      const currNetCap = Number(curr.netCapital || 0);
      const currCumProfit = Number(curr.profit || 0);
      const cumReturnOnCapPct = currNetCap > 0 ? (currCumProfit / currNetCap) * 100 : 0;

      rows.push({
        date: curr.date,
        portVal: curr.portfolioValue,
        netCap: currNetCap,
        deltaProfit,
        monthlyReturnPct,
        cumProfit: currCumProfit,
        cumReturnOnCapPct
      });
    }

    rows.reverse().forEach(r => {
      const isPos = r.deltaProfit >= 0;
      const isCumPos = r.cumProfit >= 0;
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60';
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">${r.date}</td>
        <td class="py-2.5 px-3 text-right tabular-nums ${maskClass}">${formatINR(r.portVal, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums text-slate-500 ${maskClass}">${formatINR(r.netCap, 0)}</td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isPos ? '+' : ''}${formatINR(r.deltaProfit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-semibold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isPos ? '+' : ''}${r.monthlyReturnPct.toFixed(2)}%
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums ${isCumPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} ${maskClass}">
          ${isCumPos ? '+' : ''}${formatINR(r.cumProfit, 0)}
        </td>
        <td class="py-2.5 px-3 text-right tabular-nums font-bold ${isCumPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
          ${isCumPos ? '+' : ''}${r.cumReturnOnCapPct.toFixed(2)}%
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
}

/* ---------------- MULTI-TAB EXCEL EXPORT (.XLSX) ---------------- */
function exportPortfolioToExcel() {
  if (typeof XLSX === 'undefined') return;

  const data = computeEngine();
  const wb = XLSX.utils.book_new();

  // Tab 1: Summary Dashboard
  const summaryRows = [
    { "Metric": "Total Net Worth", "Value": data.netWorth },
    { "Metric": "Contributed Corpus (Net Invested)", "Value": data.netInvested },
    { "Metric": "Total Portfolio Valuation", "Value": data.totalPortfolioVal },
    { "Metric": "Total Cash Balance", "Value": data.cashBalance },
    { "Metric": "Lifetime P&L", "Value": data.lifetimePnL },
    { "Metric": "Lifetime P&L (%)", "Value": Number(data.lifetimePnLPct.toFixed(2)) },
    { "Metric": "Annualized XIRR (%)", "Value": Number(data.xirrValue.toFixed(2)) }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary Dashboard");

  // Tab 2: Holdings
  const holdingsRows = data.holdings.map(h => ({
    "Stock Ticker": h.stock,
    "Quantity": h.qty,
    "Average Cost (WAP)": h.wap,
    "Current LTP": h.ltp,
    "Invested Value": h.investedVal,
    "Current Value": h.currentVal,
    "Weight (%)": Number(h.weightPct.toFixed(2)),
    "Unrealized P&L": h.pnlVal,
    "Return (%)": Number(h.pnlPct.toFixed(2))
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(holdingsRows), "Active Holdings");

  // Tab 3: Closed Trades
  const closedRows = data.closedTrades.map(c => ({
    "Stock Ticker": c.stock,
    "Total Sold Qty": c.totalQty,
    "Total Cost Basis": c.totalCostBasis,
    "Total Proceeds": c.totalProceeds,
    "Net Realized P&L": c.netPnL,
    "Realized Return (%)": Number(c.retPct.toFixed(2))
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(closedRows), "Closed Trades");

  // Tab 4: Tradebook
  const tradebookRows = data.ledgerEntries.map(l => ({
    "Date": l.date,
    "Account": l.account,
    "Type": l.type,
    "Stock": l.stock,
    "Qty": l.qty,
    "Price": l.price,
    "Cash Out": l.cashOut,
    "Cash In": l.cashIn,
    "Running Cash Balance": l.runningCash,
    "Remarks": l.remarks
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tradebookRows), "Tradebook & Ledger");

  // Tab 5: Tax Audit
  const taxRows = data.taxClosedLots.map(t => ({
    "Sell Date": t.sellDate,
    "Buy Date (FIFO)": t.buyDate,
    "Account": t.account,
    "Stock": t.stock,
    "Qty": t.qty,
    "Holding Days": t.days,
    "Tax Class": t.isLtcg ? 'LTCG' : 'STCG',
    "Cost Basis": t.costBasis,
    "Proceeds": t.proceeds,
    "Realized Gain/Loss": t.gain,
    "Quarter": t.quarter,
    "Financial Year": t.fy
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taxRows), "Tax Audit Trail");

  // Tab 6: Bank Ledger
  const bankRows = data.bankEntries.map(b => ({
    "Date": b.date,
    "Account": b.account,
    "Type": b.type,
    "Deposit In": b.deposit,
    "Withdrawal Out": b.withdrawal,
    "Net Contributed Corpus": b.corpus,
    "Remarks": b.remarks
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bankRows), "Bank Ledger");

  // Tab 7: Performance Trajectory
  let trajectoryHistory = [];
  if (Array.isArray(chartHistoryRecords)) {
    trajectoryHistory = [...chartHistoryRecords].sort((a, b) => new Date(a.date) - new Date(b.date)).map(r => ({
      "Checkpoint Date": r.date,
      "Portfolio Value": Number(r.portfolioValue || 0),
      "Net Capital": Number(r.netCapital || 0),
      "Profit": Number(r.profit || 0)
    }));
  }
  trajectoryHistory.push({
    "Checkpoint Date": "Current",
    "Portfolio Value": Math.round(data.netWorth || 0),
    "Net Capital": Math.round(data.netInvested || 0),
    "Profit": Math.round(data.lifetimePnL || 0)
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trajectoryHistory), "Performance Trajectory");

  // Tab 8: Monthly RoC & Extreme Target
  const fourCurvePoints = computeRocFourCurves(data);
  const rocRows = fourCurvePoints.map(p => ({
    "Checkpoint": p.date,
    "Start Capital": p.startCapital,
    "Actual Value": p.actualVal,
    "Net Capital Base": p.netCapBase,
    "Monthly P&L (Delta Profit)": p.deltaProfit,
    "Monthly RoC (%)": Number(p.rocPct.toFixed(2)),
    "Pure 2% Target": p.pureTarget,
    "Pure 2% Gap": p.pureGap,
    "Extreme Target": p.ratchetTarget !== null ? p.ratchetTarget : "",
    "Extreme Deficit": p.ratchetDeficit
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rocRows), "Monthly RoC & Extreme Target");

  const todayStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `MyFolioAI_Portfolio_Report_${todayStr}.xlsx`);
}

/* ---------------- CUSTOM HTML TOOLTIP HANDLER (POINT 5 & 6) ---------------- */
function customHtmlTooltipHandler(context) {
  const { chart, tooltip } = context;
  ensureChartDomElements();
  const tooltipEl = document.getElementById('chartCustomTooltip');

  if (!tooltipEl) return;

  if (tooltip.opacity === 0) {
    tooltipEl.style.opacity = '0';
    return;
  }

  const isMasked = !!tabMaskStates.chart;
  const maskClass = isMasked ? 'blurred-mask' : '';

  if (tooltip.body) {
    const titleLines = tooltip.title || [];
    let innerHtml = '<div class="space-y-1.5">';

    titleLines.forEach(title => {
      innerHtml += `<div class="font-bold text-slate-900 dark:text-white pb-1 border-b border-slate-100 dark:border-gray-800 text-[11.5px]">${title}</div>`;
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
          <span class="flex items-center text-slate-600 dark:text-gray-300">
            <span class="w-2 h-2 rounded-full mr-1.5" style="background-color: ${color}"></span>
            <span>${label}:</span>
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
  if (isNearRightEdge || willOverflowRight) {
    tooltipEl.style.left = (positionX + caretX - tooltipWidth - 12) + 'px';
  } else {
    tooltipEl.style.left = (positionX + caretX + 12) + 'px';
  }
  
  const willOverflowBottom = (caretY + tooltipHeight + 16) > chartCanvasHeight;
  if (willOverflowBottom) {
    tooltipEl.style.top = (positionY + caretY - tooltipHeight - 12) + 'px';
  } else {
    tooltipEl.style.top = (positionY + caretY - 12) + 'px';
  }
}

/* ---------------- PERFORMANCE & 4-CURVE CHART RENDERER (POINT 6) ---------------- */
function setChartRange(range) {
  currentChartRange = range;
  const ttmBtn = document.getElementById('chartRangeBtn-TTM');
  const allBtn = document.getElementById('chartRangeBtn-ALL');

  const activeClasses = 'bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-xs font-semibold';
  const inactiveClasses = 'text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 font-medium';

  if (ttmBtn && allBtn) {
    if (range === 'TTM') {
      ttmBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${activeClasses}`;
      allBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${inactiveClasses}`;
    } else {
      allBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${activeClasses}`;
      ttmBtn.className = `px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${inactiveClasses}`;
    }
  }

  renderChart(computeEngine());
}

function renderChart(computed) {
  const canvas = document.getElementById('multiCurveChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (multiChartInstance) multiChartInstance.destroy();

  const isDark = document.documentElement.classList.contains('dark');
  const horizontalGridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : '#E9EDF3';
  const zeroLineColor = isDark ? 'rgba(255, 255, 255, 0.25)' : '#CBD5E1';
  const tickColor = isDark ? '#94A3B8' : '#64748B';
  const chartHeight = canvas.parentElement ? (canvas.parentElement.clientHeight || 330) : 330;

  const externalTooltipOptions = {
    enabled: false,
    external: customHtmlTooltipHandler
  };

  if (currentChartView === 'roc') {
    const fourPoints = computeRocFourCurves(computed);
    let displayPoints = fourPoints;

    if (currentChartRange === 'TTM' && fourPoints.length > 12) {
      displayPoints = fourPoints.slice(-12);
    }

    const labels = displayPoints.length > 0 ? displayPoints.map(p => p.date) : ['No Data'];
    const actualTrackData = displayPoints.map(p => p.actualVal);
    const netCapBaseData = displayPoints.map(p => p.netCapBase);
    const pureTargetData = displayPoints.map(p => p.pureTarget);
    const ratchetTargetData = displayPoints.map(p => p.ratchetTarget);

    const blueGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    blueGradient.addColorStop(0, isDark ? 'rgba(37, 99, 235, 0.20)' : 'rgba(37, 99, 235, 0.15)');
    blueGradient.addColorStop(0.5, isDark ? 'rgba(37, 99, 235, 0.05)' : 'rgba(37, 99, 235, 0.03)');
    blueGradient.addColorStop(1, 'rgba(37, 99, 235, 0.00)');

    multiChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Actual Track',
            data: actualTrackData,
            borderColor: '#2563eb',
            backgroundColor: blueGradient,
            fill: true,
            borderWidth: 2.4,
            cubicInterpolationMode: 'monotone',
            pointRadius: 3.5,
            pointHoverRadius: 5.5,
            pointBackgroundColor: '#2563eb',
            pointBorderColor: isDark ? '#111827' : '#FFFFFF',
            pointBorderWidth: 1.5,
            order: 1
          },
          {
            label: 'Capital Base',
            data: netCapBaseData,
            borderColor: '#dc2626',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 2.0,
            cubicInterpolationMode: 'monotone',
            pointRadius: 3.5,
            pointHoverRadius: 5.5,
            pointBackgroundColor: '#dc2626',
            pointBorderColor: isDark ? '#111827' : '#FFFFFF',
            pointBorderWidth: 1.5,
            order: 2
          },
          {
            label: 'Pure 2% Hurdle',
            data: pureTargetData,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 2.0,
            borderDash: [3, 3],
            cubicInterpolationMode: 'monotone',
            pointRadius: 3.0,
            pointHoverRadius: 5.0,
            pointBackgroundColor: '#f59e0b',
            pointBorderColor: isDark ? '#111827' : '#FFFFFF',
            pointBorderWidth: 1.5,
            order: 3
          },
          {
            label: 'Extreme Target',
            data: ratchetTargetData,
            borderColor: '#9333ea',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 2.0,
            borderDash: [6, 4],
            cubicInterpolationMode: 'monotone',
            pointRadius: 3.5,
            pointHoverRadius: 5.5,
            pointBackgroundColor: '#9333ea',
            pointBorderColor: isDark ? '#111827' : '#FFFFFF',
            pointBorderWidth: 1.5,
            order: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // POINT 6: Mobile touch-device event configuration to dismiss tooltips on outside tap or scroll
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
          tooltip: externalTooltipOptions
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
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
            grid: {
              color: function(scaleCtx) {
                if (scaleCtx.tick && scaleCtx.tick.value === 0) return zeroLineColor;
                return horizontalGridColor;
              },
              lineWidth: function(scaleCtx) { return (scaleCtx.tick && scaleCtx.tick.value === 0) ? 1.2 : 0.6; },
              drawBorder: false
            },
            ticks: {
              color: tickColor,
              font: { family: "'Inter', sans-serif", size: 11 },
              padding: 8,
              callback: function(val) {
                return formatINR(val, 0);
              }
            }
          }
        }
      }
    });

    return;
  }

  let allPoints = [];

  if (Array.isArray(chartHistoryRecords) && chartHistoryRecords.length > 0) {
    const sortedHistory = [...chartHistoryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
    sortedHistory.forEach(r => {
      if (!r.date) return;
      allPoints.push({
        label: r.date,
        netWorth: Number(r.portfolioValue || 0),
        invested: Number(r.netCapital || 0),
        profit: Number(r.profit || 0)
      });
    });
  }

  if (computed) {
    allPoints.push({
      label: 'Today',
      netWorth: Math.round(computed.netWorth || 0),
      invested: Math.round(computed.netInvested || 0),
      profit: Math.round(computed.lifetimePnL || 0)
    });
  }

  for (let i = 0; i < allPoints.length; i++) {
    if (i === 0) {
      allPoints[i].deltaProfit = null;
    } else {
      allPoints[i].deltaProfit = allPoints[i].profit - allPoints[i - 1].profit;
    }
  }

  let displayPoints = allPoints;
  if (currentChartRange === 'TTM' && allPoints.length > 12) {
    displayPoints = allPoints.slice(-12);
  }

  const labels = displayPoints.length > 0 ? displayPoints.map(p => p.date || p.label) : ['No Data'];
  const netWorthData = displayPoints.length > 0 ? displayPoints.map(p => p.netWorth) : [0];
  const investedData = displayPoints.length > 0 ? displayPoints.map(p => p.invested) : [0];
  const profitData = displayPoints.length > 0 ? displayPoints.map(p => p.profit) : [0];

  const blueGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
  blueGradient.addColorStop(0, isDark ? 'rgba(37, 99, 235, 0.18)' : 'rgba(37, 99, 235, 0.14)');
  blueGradient.addColorStop(0.5, isDark ? 'rgba(37, 99, 235, 0.05)' : 'rgba(37, 99, 235, 0.04)');
  blueGradient.addColorStop(1, 'rgba(37, 99, 235, 0.00)');

  const greenGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
  greenGradient.addColorStop(0, isDark ? 'rgba(22, 163, 74, 0.14)' : 'rgba(22, 163, 74, 0.10)');
  greenGradient.addColorStop(0.5, isDark ? 'rgba(22, 163, 74, 0.04)' : 'rgba(22, 163, 74, 0.03)');
  greenGradient.addColorStop(1, 'rgba(22, 163, 74, 0.00)');

  multiChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Net Worth',
          data: netWorthData,
          borderColor: '#2563eb',
          backgroundColor: blueGradient,
          fill: true,
          borderWidth: 2.2,
          cubicInterpolationMode: 'monotone',
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#2563eb',
          pointBorderColor: isDark ? '#111827' : '#FFFFFF',
          pointBorderWidth: 1.5,
          order: 1
        },
        {
          label: 'My Capital',
          data: investedData,
          borderColor: '#dc2626',
          backgroundColor: 'transparent',
          fill: false,
          borderWidth: 2.0,
          cubicInterpolationMode: 'monotone',
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#dc2626',
          pointBorderColor: isDark ? '#111827' : '#FFFFFF',
          pointBorderWidth: 1.5,
          order: 2
        },
        {
          label: 'Profit',
          data: profitData,
          borderColor: '#16a34a',
          backgroundColor: greenGradient,
          fill: true,
          borderWidth: 2.0,
          borderDash: [4, 4],
          cubicInterpolationMode: 'monotone',
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#16a34a',
          pointBorderColor: isDark ? '#111827' : '#FFFFFF',
          pointBorderWidth: 1.5,
          order: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // POINT 6: Mobile touch-device event configuration to dismiss tooltips on outside tap or scroll
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
        tooltip: externalTooltipOptions
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
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
          grid: {
            color: function(scaleCtx) {
              if (scaleCtx.tick && scaleCtx.tick.value === 0) return zeroLineColor;
              return horizontalGridColor;
            },
            lineWidth: function(scaleCtx) { return (scaleCtx.tick && scaleCtx.tick.value === 0) ? 1.2 : 0.6; },
            drawBorder: false
          },
          ticks: {
            color: tickColor,
            font: { family: "'Inter', sans-serif", size: 11 },
            padding: 8,
            callback: function(val) {
              return formatINR(val, 0);
            }
          }
        }
      }
    }
  });
}

/* ---------------- RECORD TRANSACTION & CORPORATE ACTIONS (POINT 2) ---------------- */
function toggleTxDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('txDropdownMenu');
  const chevron = document.getElementById('txDropdownChevron');
  const isHidden = menu.classList.contains('hidden');

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
  if (isHidden) {
    submenu.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-90');
  } else {
    submenu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-90');
  }
}

function closeCorpActionSubmenu() {
  const submenu = document.getElementById('corpActionSubmenu');
  const chevron = document.getElementById('corpSubmenuChevron');
  if (submenu) submenu.classList.add('hidden');
  if (chevron) chevron.classList.remove('rotate-90');
}

function selectDropdownPreset(type) {
  const menu = document.getElementById('txDropdownMenu');
  const chevron = document.getElementById('txDropdownChevron');
  if (menu) menu.classList.add('hidden');
  if (chevron) chevron.classList.remove('rotate-180');
  closeCorpActionSubmenu();
  openPresetModal(type);
}

function openPresetModal(type) {
  document.getElementById('txEditingId').value = '';
  document.getElementById('txModal').classList.remove('hidden');
  document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('txType').value = type;
  document.getElementById('txAccount').value = 'Me';
  document.getElementById('modalTitle').innerText = `Record ${type}`;
  toggleFormFields();
}

function closeTransactionModal() {
  document.getElementById('txEditingId').value = '';
  document.getElementById('txModal').classList.add('hidden');
  document.getElementById('txForm').reset();
}

function toggleFormFields() {
  const type = document.getElementById('txType').value;
  const isStock = ['BUY', 'SELL', 'BONUS', 'SPLIT', 'DEMERGER'].includes(type);
  const stockFields = document.getElementById('stockFields');
  const qtyLabel = document.getElementById('txQtyLabel');
  const priceLabel = document.getElementById('txPriceLabel');
  const qtyInput = document.getElementById('txQty');
  const priceInput = document.getElementById('txPrice');
  const amtInput = document.getElementById('txAmount');

  if (stockFields) stockFields.style.display = isStock ? 'grid' : 'none';

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

async function handleTransactionSubmit(e) {
  e.preventDefault();
  const type = document.getElementById('txType').value;
  const account = document.getElementById('txAccount').value;
  const stock = document.getElementById('txStock').value.trim().toUpperCase();
  const qty = Number(document.getElementById('txQty').value || 0);
  const price = Number(document.getElementById('txPrice').value || 0);
  let amount = Number(document.getElementById('txAmount').value || 0);
  const remarks = document.getElementById('txRemarks').value;
  const date = document.getElementById('txDate').value;

  if (['BUY', 'SELL'].includes(type) && !amount) amount = qty * price;
  if (type === 'BONUS') amount = 0;

  const newEntry = {
    id: Date.now().toString(),
    date,
    account,
    type,
    stock,
    qty,
    price,
    amount,
    remarks
  };

  transactions.push(newEntry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  appendToGoogleSheet(newEntry);

  updateStockAutocompleteOptions();
  closeTransactionModal();
  recalculateAndRender();
}

function quickSellModal(stock, maxQty, currentPrice) {
  openPresetModal('SELL');
  document.getElementById('txStock').value = stock;
  document.getElementById('txQty').value = maxQty;
  document.getElementById('txPrice').value = currentPrice;
  document.getElementById('txAmount').value = (maxQty * currentPrice).toFixed(2);
  document.getElementById('txRemarks').value = 'Liquidation';
}

function manualOverridePrice(stock, cur) {
  const p = prompt(`Set LTP (₹) for ${stock}:`, cur);
  if (p && !isNaN(Number(p))) {
    persistManualPrice(stock, Number(p));
    recalculateAndRender();
  }
}

/* ---------------- NAVIGATION TABS ---------------- */
function switchTab(t) {
  ['holdings', 'closedTrades', 'fyBreakdown', 'transactions', 'bankLedger', 'taxPnl'].forEach(id => {
    const el = document.getElementById(`tabContent-${id}`);
    const btn = document.getElementById(`tabBtn-${id}`);
    if (el) el.classList.add('hidden');
    if (btn) btn.className = 'tab-btn px-4 py-2.5 text-xs font-semibold border-b-2 border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 flex items-center space-x-2 whitespace-nowrap';
  });

  const activeContent = document.getElementById(`tabContent-${t}`);
  const activeBtn = document.getElementById(`tabBtn-${t}`);
  if (activeContent) activeContent.classList.remove('hidden');
  if (activeBtn) activeBtn.className = 'tab-btn px-4 py-2.5 text-xs font-semibold border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 flex items-center space-x-2 whitespace-nowrap';

  if (t === 'taxPnl') {
    setTaxAccountFilter(currentTaxAccountFilter || 'Me');
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
      el.innerHTML = `<i data-lucide="chevrons-up-down" class="w-3.5 h-3.5 text-slate-700 dark:text-gray-300 inline opacity-90"></i>`;
    }
  });
  if (window.lucide) lucide.createIcons();
}

/* ---------------- MANUAL LTP ENTRY MODAL ---------------- */
function openLivePricesModal() {
  const modal = document.getElementById('livePricesModal');
  const container = document.getElementById('livePricesContainer');
  container.innerHTML = '';

  const data = computeEngine();
  const openHoldings = data.holdings;

  if (openHoldings.length === 0) {
    container.innerHTML = `<div class="text-slate-400 dark:text-gray-500 py-4 text-center">No open holdings available to update.</div>`;
  } else {
    openHoldings.forEach(h => {
      const curPrice = savedManualPrices[h.stock] ? savedManualPrices[h.stock].ltp : h.ltp;
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 bg-slate-100 dark:bg-gray-800/80 rounded-xl border border-slate-200 dark:border-gray-700/80';
      row.innerHTML = `
        <div>
          <div class="font-bold text-slate-900 dark:text-white">${h.stock}</div>
          <div class="text-[11px] text-slate-500 dark:text-gray-400">Qty: ${h.qty} • Cost: ${formatINR(h.wap)}</div>
        </div>
        <div class="flex items-center space-x-1.5">
          <span class="text-xs text-slate-500 dark:text-gray-400">₹</span>
          <input type="number" step="0.05" id="livePriceInp_${h.stock}" value="${Number(curPrice).toFixed(2)}" class="w-28 bg-white dark:bg-gray-900 border border-slate-300 dark:border-gray-600 rounded-lg p-1.5 text-slate-900 dark:text-white mono-font text-xs text-right focus:outline-none focus:border-emerald-500 font-bold">
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

async function saveAllLivePrices() {
  const inputs = document.querySelectorAll('#livePricesContainer input');
  const batchPrices = {};

  inputs.forEach(inp => {
    const sym = inp.id.replace('livePriceInp_', '');
    const val = Number(inp.value);
    if (!isNaN(val) && val > 0) {
      batchPrices[sym] = { ltp: val, prevClose: val };
      savedManualPrices[sym] = { ltp: val, prevClose: val };
      marketPrices[sym] = { ltp: val, prevClose: val };
    }
  });

  localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
  recordPriceUpdateTimestamp();

  if (cloudScriptUrl && Object.keys(batchPrices).length > 0) {
    sendToSheet({ action: "savePrices", prices: batchPrices });
  }

  closeLivePricesModal();
  recalculateAndRender();
}

/* ---------------- MILESTONE GOALS MODAL ---------------- */
const GOAL_CONFIGS = {
  netWorth: { title: 'Net Worth Target', desc: 'Set your total portfolio net worth target milestone.', prefix: '₹', isCurrency: true },
  netInvested: { title: 'Net Invested Target', desc: 'Set your target total contributed capital corpus.', prefix: '₹', isCurrency: true },
  lifetimePnL: { title: 'Lifetime Profit Target', desc: 'Set your all-time cumulative portfolio profit target.', prefix: '₹', isCurrency: true },
  currentFyPnL: { title: 'Current FY Realized Profit Target', desc: 'Set your strict FIFO realized profit target for the current financial year.', prefix: '₹', isCurrency: true },
  xirr: { title: 'Annualized XIRR Target', desc: 'Set your target annualized cash-flow hurdle percentage.', prefix: '%', isCurrency: false }
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

async function saveGoalMilestone() {
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
    container.innerHTML = `<div class="text-slate-400 py-3 text-center">No open positions as of ${targetDateStr}.</div>`;
  } else {
    openHoldings.forEach(h => {
      const curPrice = savedManualPrices[h.stock] ? savedManualPrices[h.stock].ltp : (marketPrices[h.stock] ? marketPrices[h.stock].ltp : 0);
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 bg-slate-100 dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700';
      row.innerHTML = `
        <div>
          <div class="font-bold text-slate-900 dark:text-white">${h.stock}</div>
          <div class="text-[11px] text-slate-500 dark:text-gray-400">Qty at month-end: ${h.qty} shares</div>
        </div>
        <div class="flex items-center space-x-1.5">
          <span class="text-xs text-slate-500">₹</span>
          <input type="number" step="0.05" id="mePrice_${h.stock}" data-qty="${h.qty}" value="${Number(curPrice).toFixed(2)}" class="w-28 bg-white dark:bg-gray-900 border border-slate-300 dark:border-gray-600 rounded-lg p-1.5 text-slate-900 dark:text-white mono-font text-xs text-right focus:outline-none focus:border-blue-500 font-bold" oninput="recalcMonthEndModal(${netCap}, ${cash})">
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
  document.getElementById('meModalStockVal').className = 'text-slate-900 dark:text-white font-bold tabular-nums';
  document.getElementById('meModalCash').innerText = formatCompactIndian(cash);
  document.getElementById('meModalNetCap').innerText = formatCompactIndian(netCap);
  document.getElementById('meModalPortVal').innerText = formatINR(portVal);
  document.getElementById('meModalProfit').innerText = formatINR(profit);
}

function closeMonthEndModal() {
  document.getElementById('monthEndReviewModal').classList.add('hidden');
}

async function commitMonthEndSnapshot() {
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
  const batchPrices = {};

  document.querySelectorAll('#monthEndHoldingsContainer input').forEach(inp => {
    const sym = inp.id.replace('mePrice_', '');
    const qty = Number(inp.getAttribute('data-qty') || 0);
    const p = Number(inp.value || 0);
    stockVal += (qty * p);

    if (p > 0) {
      batchPrices[sym] = { ltp: p, prevClose: p };
      savedManualPrices[sym] = { ltp: p, prevClose: p };
      marketPrices[sym] = { ltp: p, prevClose: p };
    }
  });

  localStorage.setItem(MANUAL_PRICES_KEY, JSON.stringify(savedManualPrices));
  recordPriceUpdateTimestamp();

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
    if (Object.keys(batchPrices).length > 0) {
      sendToSheet({ action: "savePrices", prices: batchPrices });
    }
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

/* ---------------- SETTINGS DROPDOWN & BACKUP / PIN GATEKEEPERS (POINT 9 & 10) ---------------- */
function toggleSettingsDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('settingsDropdownMenu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}

function closeSettingsDropdown() {
  const menu = document.getElementById('settingsDropdownMenu');
  if (menu) menu.classList.add('hidden');
}

// 1. PIN Settings Modal
function openPinSettingsModal() {
  closeSettingsDropdown();
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
    if (!appSettings.pinHash) curGroup.classList.add('hidden');
    else curGroup.classList.remove('hidden');
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

// 2. Manual Backup Triggers (POINT 9 & 10: PIN Gatekeeper for Code Backups)
async function triggerManualDatabaseBackup() {
  closeSettingsDropdown();
  if (!cloudScriptUrl) {
    alert('Google Sheets Sync is not connected. Please connect your Web App Deployment URL first.');
    return;
  }

  if (confirm('Execute manual backup of your Google Sheet database to the MyFolio_Vault_Backups folder?')) {
    updateSyncUI('Backing up database...', false);
    try {
      let url = `${cloudScriptUrl}?action=triggerDatabaseBackup`;
      if (apiToken) url += `&token=${encodeURIComponent(apiToken)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.status === 'success') {
        const backupTime = json.details && json.details.backupTime ? json.details.backupTime : null;
        if (backupTime) {
          recordBackupTimestamp(backupTime);
        } else {
          recordBackupTimestamp();
        }
        alert('Database backup created successfully in your Google Drive vault folder!');
        updateSyncUI('Database backup complete.', false);
      } else {
        throw new Error(json.message || 'Unknown error');
      }
    } catch (err) {
      alert('Database backup failed: ' + err.toString());
      updateSyncUI('Database backup failed.', true);
    }
  }
}

function triggerManualCodeBackup(type) {
  closeSettingsDropdown();
  pendingCodeBackupType = type;

  // POINT 10: Prompt for master security PIN verification before proceeding with code backup
  const pinPrompt = prompt(`Enter your 4-digit Master Security PIN to authorize ${type.toUpperCase()} Code Backup:`);
  if (!pinPrompt) {
    pendingCodeBackupType = null;
    return;
  }

  sha256Hex(pinPrompt.trim()).then(candidateHash => {
    if (appSettings.pinHash && candidateHash === appSettings.pinHash) {
      executeCodeBackupDownload(pendingCodeBackupType);
    } else {
      alert('Incorrect Security PIN. Code backup cancelled.');
    }
    pendingCodeBackupType = null;
  });
}

function executeCodeBackupDownload(type) {
  const todayStr = new Date().toISOString().split('T')[0];

  if (type === 'frontend') {
    // Download partitioned Frontend/UI splits as separate .txt files
    const fileSplits = {
      "index.txt": document.documentElement.outerHTML,
      "styles.txt": "(Consult your modular CSS file or repository styles)",
      "config.txt": "(Global configuration and storage keys)",
      "gatekeeper.txt": "(PIN lock and session security engine)",
      "api.txt": "(Cloud sync and Google Sheets API engine)",
      "engine.txt": "(Portfolio calculation and XIRR engine)",
      "tax.txt": "(Capital gains tax and advance tax module)",
      "ui.txt": "(UI controller and renderers)"
    };

    Object.keys(fileSplits).forEach((filename, idx) => {
      setTimeout(() => {
        const content = fileSplits[filename];
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MyFolioAI_${filename}_${todayStr}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, idx * 250);
    });

    alert('Frontend code archives downloaded successfully as separate .txt splits!');
  } else if (type === 'backend') {
    const fileName = `MyFolioAI_Backend.txt_${todayStr}.txt`;
    const content = `// MyFolio.AI Backend Code Snapshot - ${todayStr}\n// Exported securely from MyFolio.AI Vault\n\n` + (typeof runWeeklySundayBackup === 'function' ? runWeeklySundayBackup.toString() : '');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('BACKEND code archive downloaded successfully as Backend.txt!');
  }
}

// 3. Cash Calibration Modal
function openCashCalibrateModal() {
  closeSettingsDropdown();
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

  const data = computeEngine();

  CALIB_ACCOUNTS.forEach(acct => {
    const rawCash = data.rawAccountCashMap[acct] || 0;
    const currentEffective = data.accountCashMap[acct] || 0;
    const offset = getCalibOffset(acct);
    const rec = cashCalibration.records && cashCalibration.records[acct];
    const lastDate = rec && rec.date ? rec.date : null;

    const row = document.createElement('div');
    row.className = 'p-3 bg-slate-50 dark:bg-gray-950/70 rounded-xl border border-slate-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2.5';
    row.innerHTML = `
      <div>
        <div class="font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
          <span>${acct}</span>
          <span class="text-[10px] text-slate-400 font-medium">(Raw Tagged: ${formatINR(rawCash)})</span>
        </div>
        <div class="text-[10.5px] text-slate-500 dark:text-gray-400 mt-0.5">
          Active Offset: <span class="font-mono ${offset >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}">${offset >= 0 ? '+' : ''}${formatINR(offset)}</span>
        </div>
        <div class="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">
          ${lastDate ? `Last calibrated: ${lastDate}` : 'Not calibrated yet'}
        </div>
      </div>
      <div class="flex items-center space-x-1.5">
        <span class="text-xs font-semibold text-slate-500">₹</span>
        <input 
          type="number" 
          step="0.01" 
          id="calibrateInp_${acct}" 
          data-raw="${rawCash}" 
          value="${Number(currentEffective).toFixed(2)}" 
          placeholder="0.00"
          class="w-32 bg-white dark:bg-gray-900 border border-slate-300 dark:border-gray-700 rounded-lg p-1.5 text-slate-900 dark:text-white mono-font text-xs text-right font-bold focus:outline-none focus:border-emerald-500"
        >
      </div>
    `;
    container.appendChild(row);
  });
}

async function saveCashCalibration() {
  const todayStr = new Date().toISOString().split('T')[0];
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
  closeSettingsDropdown();
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

async function handleAddStockMasterSubmit(e) {
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
  const txMenu = document.getElementById('txDropdownMenu');
  const txChevron = document.getElementById('txDropdownChevron');
  if (txDropdown && !txDropdown.contains(e.target) && txMenu && !txMenu.classList.contains('hidden')) {
    txMenu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
    closeCorpActionSubmenu();
  }

  const settingsDropdown = document.getElementById('settingsDropdownContainer');
  const settingsMenu = document.getElementById('settingsDropdownMenu');
  if (settingsDropdown && !settingsDropdown.contains(e.target) && settingsMenu && !settingsMenu.classList.contains('hidden')) {
    settingsMenu.classList.add('hidden');
  }

  const chartViewDropdown = document.getElementById('chartViewSwitcherContainer');
  const chartMenu = document.getElementById('chartViewDropdownMenu');
  const chartChevron = document.getElementById('chartViewChevron');
  if (chartViewDropdown && !chartViewDropdown.contains(e.target) && chartMenu && !chartMenu.classList.contains('hidden')) {
    chartMenu.classList.add('hidden');
    if (chartChevron) chartChevron.classList.remove('rotate-180');
  }
});

window.addEventListener('DOMContentLoaded', init);
