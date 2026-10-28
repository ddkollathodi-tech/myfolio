// ============================================================================
// MyFolioAI - UI Controller Part 1: Core Dashboard, Holdings & FY P&L (ui-core.js)
// ============================================================================

let multiChartInstance = null;
let currentEditingGoalKey = null;
let currentPendingMonthEndDateStr = null;

/* ---------------- APPLICATION INITIALIZATION ---------------- */
function init() {
  initTheme();
  initTabMaskStates();
  ensureChartDomElements();
  updateSyncUI();
  renderLastPriceTimestamp();
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

/* ---------------- STEALTH MASKING SYSTEM ---------------- */
function initTabMaskStates() {
  try {
    const saved = localStorage.getItem(TAB_MASK_STATES_KEY);
    if (saved) {
      tabMaskStates = Object.assign(tabMaskStates, JSON.parse(saved));
    }
  } catch (e) {}

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

/* ---------------- THEME TOGGLE ---------------- */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const isDark = saved ? saved === 'dark' : true;
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
