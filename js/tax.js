// ============================================================================
// MyFolioAI - Indian Capital Gains Tax & Planning Cockpit (js/tax.js)
// Post-July 2024 Regime, Section 111A, Section 112A, Set-Offs & Advance Tax
// ============================================================================

function getTaxEngineSnapshot() {
return typeof getCachedEngineData === 'function' ? getCachedEngineData() : computeEngine();
}

function populateTaxFyOptions(fyRealized) {
const select = document.getElementById('taxFyFilter');
if (!select) return;
const currentSelected = select.value;

const currentFy = getFinancialYear(todayLocalISO());
const sortedFys = Array.from(new Set([currentFy, ...Object.keys(fyRealized || {})])).sort().reverse();
const sig = sortedFys.join('|');

if (select.dataset.optionsSig !== sig) {
select.innerHTML = sortedFys.map(fy => `<option value="${esc(fy)}">${esc(fy)}</option>`).join('');
select.dataset.optionsSig = sig;
}

select.value = (currentSelected && sortedFys.includes(currentSelected)) ? currentSelected : currentFy;
}

function setTaxAccountFilter(acct) {
currentTaxAccountFilter = acct;
['Me', 'Wife', 'Mom', 'Brother', 'ALL'].forEach(key => {
const btn = document.getElementById(`taxAcctBtn-${key}`);
if (!btn) return;
if (key === acct) {
btn.className = 'px-2.5 py-1 rounded-md transition-all bg-white dark:bg-gray-900 text-slate-900 dark:text-white shadow-xs font-semibold';
} else {
btn.className = 'px-2.5 py-1 rounded-md transition-all text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white font-medium';
}
});
renderTaxView();
}

function toggleCurrentAccountExemption() {
const acct = currentTaxAccountFilter === 'ALL' ? 'Wife' : currentTaxAccountFilter;
const key = `taxToggle_${acct}`;
const isCurrentlyLow = appSettings[key] === 'true';
const newVal = isCurrentlyLow ? 'false' : 'true';

appSettings[key] = newVal;
saveJsonStorage(SETTINGS_STORAGE_KEY, appSettings);

sendToSheet({
action: 'saveSettings',
settings: { [key]: newVal }
});

renderTaxView();
}

const TAX_CHALLAN_LOGS_STORAGE_KEY = 'MYFOLIOAI_TAX_CHALLAN_LOGS';
let taxChallanLogs = loadJsonStorage(TAX_CHALLAN_LOGS_STORAGE_KEY, []);
if (!Array.isArray(taxChallanLogs)) taxChallanLogs = [];

function getTaxChallanKey(fy, account, quarter) {
  return `${fy}__${account}__${quarter}`;
}

function clearFieldValidationError(el) {
  if (!el) return;
  el.classList.remove('border-rose-500', 'ring-1', 'ring-rose-500');
  const errEl = document.getElementById(`err-${el.id}`);
  if (errEl) errEl.classList.add('hidden');
}

function setFieldValidationError(el, msg) {
  if (!el) return;
  el.classList.add('border-rose-500', 'ring-1', 'ring-rose-500');
  const errEl = document.getElementById(`err-${el.id}`);
  if (errEl) {
    if (msg) errEl.innerText = msg;
    errEl.classList.remove('hidden');
  }
}

function populateTaxChallanFyOptions(selectedFy) {
  const sel = document.getElementById('taxChallanFy');
  if (!sel) return;
  const currentFy = getFinancialYear(todayLocalISO());
  const taxFySel = document.getElementById('taxFyFilter');
  const fys = Array.from(new Set([
    currentFy,
    taxFySel ? taxFySel.value : '',
    ...Object.keys(getTaxEngineSnapshot().fyRealized || {}),
    ...taxChallanLogs.map(c => c.fy)
  ].filter(Boolean))).sort().reverse();

  sel.innerHTML = fys.map(fy => `<option value="${esc(fy)}">${esc(fy)}</option>`).join('');
  sel.value = (selectedFy && fys.includes(selectedFy)) ? selectedFy : (taxFySel && taxFySel.value ? taxFySel.value : currentFy);
}

function openRecordTaxPaidModal(editId = null, defaults = {}) {
  const modal = document.getElementById('recordTaxPaidModal');
  const form = document.getElementById('taxChallanForm');
  if (!modal || !form) return;

  ['taxChallanDate', 'taxChallanFy', 'taxChallanAccount', 'taxChallanQuarter', 'taxChallanBsr', 'taxChallanAmount'].forEach(id => {
    clearFieldValidationError(document.getElementById(id));
  });

  const titleEl = document.getElementById('taxChallanModalTitle');
  const submitBtn = document.getElementById('taxChallanSubmitBtn');
  const idInput = document.getElementById('taxChallanEditingId');

  const existing = editId ? taxChallanLogs.find(c => String(c.id) === String(editId)) : null;
  populateTaxChallanFyOptions(existing ? existing.fy : defaults.fy);

  if (existing) {
    if (titleEl) titleEl.innerText = 'Edit Tax Challan';
    if (submitBtn) submitBtn.innerText = 'Update Challan';
    if (idInput) idInput.value = existing.id;
    document.getElementById('taxChallanDate').value = existing.date || todayLocalISO();
    document.getElementById('taxChallanFy').value = existing.fy;
    document.getElementById('taxChallanAccount').value = existing.account;
    document.getElementById('taxChallanQuarter').value = existing.quarter;
    document.getElementById('taxChallanBsr').value = existing.bsr || '';
    document.getElementById('taxChallanAmount').value = existing.amount;
  } else {
    if (titleEl) titleEl.innerText = 'Record Tax Paid (Challan)';
    if (submitBtn) submitBtn.innerText = 'Save Challan';
    if (idInput) idInput.value = '';
    document.getElementById('taxChallanDate').value = defaults.date || todayLocalISO();
    const acctDefault = (defaults.account && defaults.account !== 'ALL')
      ? defaults.account
      : '';
    document.getElementById('taxChallanAccount').value = acctDefault;
    document.getElementById('taxChallanQuarter').value = defaults.quarter || 'Q1';
    document.getElementById('taxChallanBsr').value = '';
    document.getElementById('taxChallanAmount').value = '';
  }

  modal.classList.remove('hidden');
  if (typeof refreshIcons === 'function') refreshIcons();
}

function closeRecordTaxPaidModal() {
  const modal = document.getElementById('recordTaxPaidModal');
  if (modal) modal.classList.add('hidden');
}

function applyRemoteTaxChallans(remoteRows) {
  if (!Array.isArray(remoteRows)) return;

  const normalizedRemote = remoteRows
    .filter(r => r && (r.date || r.fy || r.amount))
    .map((r, idx) => {
      const cleanId = String(r.id || '').trim() || `TCH_SHEET_${idx}_${String(r.date || '').trim()}_${Number(r.amount || 0)}`;
      return {
        id: cleanId,
        date: String(r.date || '').trim(),
        fy: String(r.fy || '').trim(),
        account: String(r.account || 'Me').trim(),
        quarter: String(r.quarter || 'Q1').trim(),
        bsr: String(r.bsr || '').trim(),
        amount: Number(Number(r.amount || 0).toFixed(2))
      };
    });

  const serverIds = new Set(normalizedRemote.map(r => String(r.id || '').trim()).filter(Boolean));

  const offlinePending = (Array.isArray(taxChallanLogs) ? taxChallanLogs : []).filter(item => {
    const lid = String(item && item.id || '').trim();
    return item && item._pendingSync === true && lid && !serverIds.has(lid);
  });

  offlinePending.forEach(entry => {
    if (typeof cloudScriptUrl !== 'undefined' && cloudScriptUrl && typeof sendToSheet === 'function') {
      const cleanEntry = { ...entry };
      delete cleanEntry._pendingSync;
      sendToSheet({ action: 'addTaxChallan', challan: cleanEntry }).then(ok => {
        if (ok) {
          entry._pendingSync = false;
          saveJsonStorage(TAX_CHALLAN_LOGS_STORAGE_KEY, taxChallanLogs);
        }
      });
    }
  });

  taxChallanLogs = [...normalizedRemote, ...offlinePending];
  recalculateTaxChallansRollup();

  if (typeof populateTaxFyOptions === 'function') {
    const snap = typeof getTaxEngineSnapshot === 'function' ? getTaxEngineSnapshot() : null;
    const fyMap = { ...((snap && snap.fyRealized) || {}) };
    taxChallanLogs.forEach(c => {
      if (c.fy && !fyMap[c.fy]) fyMap[c.fy] = { gain: 0 };
    });
    populateTaxFyOptions(fyMap);
  }

  if (typeof activeTabKey !== 'undefined' && activeTabKey === 'taxPnl' && typeof renderTaxView === 'function') {
    renderTaxView();
  }
}

function recalculateTaxChallansRollup() {
  const nextMap = {};
  taxChallanLogs.forEach(item => {
    if (!item || !item.fy || !item.account || !item.quarter) return;
    const key = getTaxChallanKey(String(item.fy).trim(), String(item.account).trim(), String(item.quarter).trim());
    const cur = Number(nextMap[key] || 0);
    nextMap[key] = Number((cur + Number(item.amount || 0)).toFixed(2));
  });

  taxPaidChallans = nextMap;
  saveJsonStorage(TAX_CHALLANS_KEY, taxPaidChallans);
  saveJsonStorage(TAX_CHALLAN_LOGS_STORAGE_KEY, taxChallanLogs);
}

function handleTaxChallanSubmit(event) {
  if (event) event.preventDefault();

  const dateEl = document.getElementById('taxChallanDate');
  const fyEl = document.getElementById('taxChallanFy');
  const acctEl = document.getElementById('taxChallanAccount');
  const qEl = document.getElementById('taxChallanQuarter');
  const bsrEl = document.getElementById('taxChallanBsr');
  const amtEl = document.getElementById('taxChallanAmount');
  const editIdEl = document.getElementById('taxChallanEditingId');

  const dateVal = dateEl ? String(dateEl.value || '').trim() : '';
  const fyVal = fyEl ? String(fyEl.value || '').trim() : '';
  const acctVal = acctEl ? String(acctEl.value || '').trim() : '';
  const qVal = qEl ? String(qEl.value || '').trim() : '';
  const bsrVal = bsrEl ? String(bsrEl.value || '').trim() : '';
  const amtVal = amtEl ? Number(amtEl.value) : NaN;

  [dateEl, fyEl, acctEl, qEl, bsrEl, amtEl].forEach(clearFieldValidationError);

  let hasError = false;
  if (!dateVal) { setFieldValidationError(dateEl, 'Challan date is required'); hasError = true; }
  if (!fyVal) { setFieldValidationError(fyEl, 'Financial year is required'); hasError = true; }
  if (!acctVal) { setFieldValidationError(acctEl, 'Account is required'); hasError = true; }
  if (!qVal) { setFieldValidationError(qEl, 'Quarter is required'); hasError = true; }
  if (!bsrVal) { setFieldValidationError(bsrEl, 'BSR code is required'); hasError = true; }
  if (!Number.isFinite(amtVal) || amtVal <= 0) {
    setFieldValidationError(amtEl, 'Enter a valid tax amount greater than ₹0');
    hasError = true;
  }

  if (hasError) return;

  const roundedAmt = Number(amtVal.toFixed(2));
  const editingId = editIdEl ? String(editIdEl.value || '').trim() : '';

  if (editingId) {
    const idx = taxChallanLogs.findIndex(c => String(c.id) === editingId);
    if (idx !== -1) {
      const updatedEntry = {
        ...taxChallanLogs[idx],
        date: dateVal,
        fy: fyVal,
        account: acctVal,
        quarter: qVal,
        bsr: bsrVal,
        amount: roundedAmt
      };
      taxChallanLogs[idx] = updatedEntry;
      recalculateTaxChallansRollup();

      if (typeof cloudScriptUrl !== 'undefined' && cloudScriptUrl && typeof sendToSheet === 'function') {
        sendToSheet({ action: 'updateTaxChallan', challan: updatedEntry });
      }
    }
  } else {
    const newEntry = {
      id: `TCH_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date: dateVal,
      fy: fyVal,
      account: acctVal,
      quarter: qVal,
      bsr: bsrVal,
      amount: roundedAmt
    };
    taxChallanLogs.unshift(newEntry);
    recalculateTaxChallansRollup();

    if (typeof cloudScriptUrl !== 'undefined' && cloudScriptUrl && typeof sendToSheet === 'function') {
      sendToSheet({ action: 'addTaxChallan', challan: newEntry }).then(ok => {
        if (!ok) {
          newEntry._pendingSync = true;
          saveJsonStorage(TAX_CHALLAN_LOGS_STORAGE_KEY, taxChallanLogs);
        }
      });
    }
  }

  closeRecordTaxPaidModal();
  renderTaxView();
  if (typeof renderDashboardTrendChart === 'function' && selectedDashboardMetric === 'currentFy') {
    renderDashboardTrendChart(getTaxEngineSnapshot());
  }
}

function authorizeTaxChallanAction(actionType, challanId) {
  const targetChallan = taxChallanLogs.find(c => String(c.id) === String(challanId));
  if (!targetChallan) return;

  const runAction = () => {
    if (actionType === 'edit') {
      openRecordTaxPaidModal(challanId);
    } else if (actionType === 'delete') {
      taxChallanLogs = taxChallanLogs.filter(c => String(c.id) !== String(challanId));
      recalculateTaxChallansRollup();

      if (typeof cloudScriptUrl !== 'undefined' && cloudScriptUrl && typeof sendToSheet === 'function') {
        sendToSheet({ action: 'deleteTaxChallan', id: targetChallan.id });
      }

      renderTaxView();
      if (typeof renderDashboardTrendChart === 'function' && selectedDashboardMetric === 'currentFy') {
        renderDashboardTrendChart(getTaxEngineSnapshot());
      }
    }
  };

  if (typeof openPinVerifyModal === 'function') {
    openPinVerifyModal(
      actionType === 'edit' ? 'Authorize Edit Challan' : 'Authorize Delete Challan',
      'Enter your 4-digit Master PIN to proceed',
      runAction
    );
  } else {
    runAction();
  }
}

function renderTaxChallansLog(targetFy, accountFilter) {
  const tbody = document.getElementById('taxChallansLogTableBody');
  const countBadge = document.getElementById('taxChallansLogCount');
  if (!tbody) return;

  const filtered = taxChallanLogs.filter(c => {
    if (!c) return false;
    if (targetFy && c.fy !== targetFy) return false;
    if (accountFilter && accountFilter !== 'ALL' && c.account !== accountFilter) return false;
    return true;
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  if (countBadge) {
    countBadge.innerText = `${filtered.length} Challan${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400 dark:text-gray-500 font-medium">No tax challans recorded for ${esc(targetFy)}${accountFilter !== 'ALL' ? ` (${esc(accountFilter)})` : ''}. Click <b>+ Record Tax Paid</b> to add one.</td></tr>`;
    return;
  }

  const maskClass = typeof getMaskClass === 'function' ? getMaskClass('taxPnl') : '';
  tbody.innerHTML = filtered.map(c => `
    <tr class="hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60">
      <td class="py-2.5 px-3 tabular-nums text-slate-600 dark:text-gray-300 font-medium">${esc(c.date)}</td>
      <td class="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">${esc(c.fy)}</td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-gray-700">${esc(c.account)}</span></td>
      <td class="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">${esc(c.quarter)}</td>
      <td class="py-2.5 px-3 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">${esc(c.bsr)}</td>
      <td class="py-2.5 px-3 text-right tabular-nums font-bold text-rose-600 dark:text-rose-400 ${maskClass}">${formatINR(c.amount)}</td>
      <td class="py-2.5 px-3 text-center whitespace-nowrap space-x-1.5">
        <button type="button" onclick="authorizeTaxChallanAction('edit', '${esc(c.id)}')" class="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-[11px] font-bold transition">Edit</button>
        <button type="button" onclick="authorizeTaxChallanAction('delete', '${esc(c.id)}')" class="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 text-[11px] font-bold transition">Delete</button>
      </td>
    </tr>
  `).join('');
}

function recordTaxChallan(fy, acct, qKey) {
  openRecordTaxPaidModal(null, { fy, account: acct, quarter: qKey });
}

function renderTaxView() {
const fySelect = document.getElementById('taxFyFilter');
if (!fySelect) return;
const targetFy = fySelect.value || getFinancialYear(todayLocalISO());

const data = getTaxEngineSnapshot();
const allLotsForFy = data.taxClosedLots.filter(l => l.fy === targetFy);

const activeAccounts = currentTaxAccountFilter === 'ALL' ? CALIB_ACCOUNTS : [currentTaxAccountFilter];

const basicExemptionCap = typeof TAX_BASIC_EXEMPTION_LIMIT === 'number' ? TAX_BASIC_EXEMPTION_LIMIT : 400000;
const ltcgExemptionCap = typeof TAX_LTCG_EXEMPTION_LIMIT === 'number' ? TAX_LTCG_EXEMPTION_LIMIT : 125000;
const stcgRate = typeof TAX_STCG_RATE === 'number' ? TAX_STCG_RATE : 0.2080;
const ltcgRate = typeof TAX_LTCG_RATE === 'number' ? TAX_LTCG_RATE : 0.1300;
const stcgRateLabel = `${(stcgRate * 100).toFixed(2)}%`;
const ltcgRateLabel = `${(ltcgRate * 100).toFixed(2)}%`;
const basicExemptionCompact = formatCompactIndian(basicExemptionCap);

let stcgGrossGain = 0;
let stcgGrossLoss = 0;
let ltcgGrossGain = 0;
let ltcgGrossLoss = 0;
let totalStclOffset = 0;
let totalLtclOffset = 0;
let stcgShortfallAbsorbed = 0;
let ltcgShortfallAbsorbed = 0;
let exemptionClaimed = 0;
let taxableStcg = 0;
let taxableLtcg = 0;
let stcgTax = 0;
let ltcgTax = 0;
const quarterGains = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };

activeAccounts.forEach(acct => {
const lots = allLotsForFy.filter(l => l.account === acct);
const isLowIncome = appSettings[`taxToggle_${acct}`] === 'true';

let aStcgGain = 0, aStcgLoss = 0, aLtcgGain = 0, aLtcgLoss = 0;
lots.forEach(lot => {
quarterGains[lot.quarter] += lot.gain;
if (lot.isLtcg) {
if (lot.gain > 0) aLtcgGain += lot.gain;
else aLtcgLoss += Math.abs(lot.gain);
} else {
if (lot.gain > 0) aStcgGain += lot.gain;
else aStcgLoss += Math.abs(lot.gain);
}
});

stcgGrossGain += aStcgGain;
stcgGrossLoss += aStcgLoss;
ltcgGrossGain += aLtcgGain;
ltcgGrossLoss += aLtcgLoss;

// Set-off cascade per account
const aStclOffStcg = Math.min(aStcgGain, aStcgLoss);
let aNetStcg = aStcgGain - aStclOffStcg;
let aRemStcl = aStcgLoss - aStclOffStcg;

const aLtclOffLtcg = Math.min(aLtcgGain, aLtcgLoss);
let aNetLtcg = aLtcgGain - aLtclOffLtcg;

const aStclOffLtcg = Math.min(aNetLtcg, aRemStcl);
aNetLtcg -= aStclOffLtcg;

totalStclOffset += (aStclOffStcg + aStclOffLtcg);
totalLtclOffset += aLtclOffLtcg;

let aStcgShortfall = 0;
let aLtcgShortfall = 0;
if (isLowIncome) {
aStcgShortfall = Math.min(aNetStcg, basicExemptionCap);
aLtcgShortfall = Math.min(aNetLtcg, basicExemptionCap - aStcgShortfall);
}
stcgShortfallAbsorbed += aStcgShortfall;
ltcgShortfallAbsorbed += aLtcgShortfall;

const aFinStcg = Math.max(0, aNetStcg - aStcgShortfall);
const aFinLtcg = Math.max(0, aNetLtcg - aLtcgShortfall);

const aExemption = Math.min(ltcgExemptionCap, aFinLtcg);
const aTaxableLtcg = Math.max(0, aFinLtcg - aExemption);

exemptionClaimed += aExemption;
taxableStcg += aFinStcg;
taxableLtcg += aTaxableLtcg;

stcgTax += aFinStcg * stcgRate;
ltcgTax += aTaxableLtcg * ltcgRate;
});

const totalTaxLiability = Math.round(stcgTax + ltcgTax);

const activeAcctForToggle = currentTaxAccountFilter === 'ALL' ? 'Wife' : currentTaxAccountFilter;
const isLowIncomeActive = appSettings[`taxToggle_${activeAcctForToggle}`] === 'true';

const toggleBtn = document.getElementById('taxLowIncomeToggleBtn');
const toggleText = document.getElementById('taxLowIncomeToggleText');
const toggleBadge = document.getElementById('taxToggleBadge');
const explainer = document.getElementById('taxToggleExplainer');

if (isLowIncomeActive) {
if (toggleBtn) toggleBtn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white';
if (toggleText) toggleText.innerText = `Zero / Low Income (< ${basicExemptionCompact})`;
if (toggleBadge) {
toggleBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
toggleBadge.innerText = `Active (${basicExemptionCompact} Absorbed)`;
}
if (explainer) explainer.innerText = `Absorbs up to ${formatINR(basicExemptionCap, 0)} capital gains against the Basic Exemption Limit. STCG absorbed first (saving ${stcgRateLabel}), remaining absorbs LTCG (saving ${ltcgRateLabel}).`;
} else {
if (toggleBtn) toggleBtn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 bg-slate-200 dark:bg-gray-800 hover:bg-slate-300 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-300';
if (toggleText) toggleText.innerText = 'Regular Salary / Income';
if (toggleBadge) {
toggleBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-500 border border-slate-200 dark:border-gray-700';
toggleBadge.innerText = 'Standard Regime';
}
if (explainer) explainer.innerText = 'Standard earner status: Capital gains are subject to flat statutory tax rates from Rupee One.';
}

const matrixTbody = document.getElementById('taxComputationTableBody');
if (matrixTbody) {
matrixTbody.innerHTML = `
<tr class="hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60">
<td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">
<span>Short-Term Capital Gains (STCG)</span>
<span class="block text-[11px] text-slate-500 font-normal">Holding period &le; 365 Days (Sec 111A)</span>
</td>
<td class="py-3 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">${formatINR(stcgGrossGain)}</td>
<td class="py-3 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400 font-semibold">${formatINR(stcgGrossLoss)}</td>
<td class="py-3 px-3 text-right tabular-nums text-blue-600 dark:text-blue-400 font-semibold">${formatINR(totalStclOffset)}</td>
<td class="py-3 px-3 text-right tabular-nums text-purple-600 dark:text-purple-400 font-semibold">-${formatINR(stcgShortfallAbsorbed)}</td>
<td class="py-3 px-3 text-right tabular-nums text-slate-400">₹0.00</td>
<td class="py-3 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-white">${formatINR(taxableStcg)}</td>
<td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">${stcgRateLabel}</span></td>
<td class="py-3 px-4 text-right tabular-nums font-extrabold text-rose-600 dark:text-rose-400">${formatINR(stcgTax)}</td>
</tr>
<tr class="hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60">
<td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">
<span>Long-Term Capital Gains (LTCG)</span>
<span class="block text-[11px] text-slate-500 font-normal">Holding period &gt; 365 Days (Sec 112A)</span>
</td>
<td class="py-3 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">${formatINR(ltcgGrossGain)}</td>
<td class="py-3 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400 font-semibold">${formatINR(ltcgGrossLoss)}</td>
<td class="py-3 px-3 text-right tabular-nums text-blue-600 dark:text-blue-400 font-semibold">${formatINR(totalLtclOffset)}</td>
<td class="py-3 px-3 text-right tabular-nums text-purple-600 dark:text-purple-400 font-semibold">-${formatINR(ltcgShortfallAbsorbed)}</td>
<td class="py-3 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400 font-semibold">-${formatINR(exemptionClaimed)}</td>
<td class="py-3 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-white">${formatINR(taxableLtcg)}</td>
<td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">${ltcgRateLabel}</span></td>
<td class="py-3 px-4 text-right tabular-nums font-extrabold text-rose-600 dark:text-rose-400">${formatINR(ltcgTax)}</td>
</tr>
<tr class="bg-slate-50/70 dark:bg-gray-950/60 font-bold border-t border-slate-200 dark:border-gray-700">
<td class="py-3 px-4 text-slate-900 dark:text-white uppercase tracking-wider text-xs">Total Net Position</td>
<td class="py-3 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">${formatINR(stcgGrossGain + ltcgGrossGain)}</td>
<td class="py-3 px-3 text-right tabular-nums text-rose-600 dark:text-rose-400">${formatINR(stcgGrossLoss + ltcgGrossLoss)}</td>
<td class="py-3 px-3 text-right tabular-nums text-blue-600 dark:text-blue-400">${formatINR(totalStclOffset + totalLtclOffset)}</td>
<td class="py-3 px-3 text-right tabular-nums text-purple-600 dark:text-purple-400 font-semibold">-${formatINR(stcgShortfallAbsorbed + ltcgShortfallAbsorbed)}</td>
<td class="py-3 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">-${formatINR(exemptionClaimed)}</td>
<td class="py-3 px-3 text-right tabular-nums text-slate-900 dark:text-white">${formatINR(taxableStcg + taxableLtcg)}</td>
<td class="py-3 px-3 text-center text-slate-400 text-xs">—</td>
<td class="py-3 px-4 text-right tabular-nums text-base text-rose-600 dark:text-rose-400">${formatINR(totalTaxLiability)}</td>
</tr>
`;
}

renderTaxHarvestingRadar(data, exemptionClaimed, ltcgExemptionCap);

// Advance Tax Schedule Calculation
const advTbody = document.getElementById('advanceTaxTableBody');
if (advTbody) {
advTbody.innerHTML = '';

const quarterConfig = [
{ key: 'Q1', title: 'Q1 (Apr 1 – Jun 15)', pct: 0.15 },
{ key: 'Q2', title: 'Q2 (Jun 16 – Sep 15)', pct: 0.45 },
{ key: 'Q3', title: 'Q3 (Sep 16 – Dec 15)', pct: 0.75 },
{ key: 'Q4', title: 'Q4 (Dec 16 – Mar 15)', pct: 1.00 }
];

let cumulativeTaxAccrued = 0;
let cumulativePaid = 0;
let totalPaidAllQuarters = 0;

quarterConfig.forEach(q => {
const qGains = Math.max(0, quarterGains[q.key]);
const approxQTax = (qGains / Math.max(1, (stcgGrossGain + ltcgGrossGain))) * totalTaxLiability;
cumulativeTaxAccrued = Math.min(totalTaxLiability, cumulativeTaxAccrued + approxQTax);

const statutoryMinDue = Math.round(totalTaxLiability * q.pct);
const actualPaid = currentTaxAccountFilter === 'ALL'
  ? CALIB_ACCOUNTS.reduce((sum, a) => sum + Number(taxPaidChallans[getTaxChallanKey(targetFy, a, q.key)] || 0), 0)
  : Number(taxPaidChallans[getTaxChallanKey(targetFy, currentTaxAccountFilter, q.key)] || 0);
totalPaidAllQuarters += actualPaid;
cumulativePaid += actualPaid;

const remainingToPay = Math.max(0, statutoryMinDue - cumulativePaid);
const excessPaid = Math.max(0, cumulativePaid - statutoryMinDue);

let statusBadge = '';
if (totalTaxLiability === 0) {
statusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-500">Nil Liability</span>`;
} else if (remainingToPay === 0) {
statusBadge = excessPaid > 0
? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-200">+${formatCompactIndian(excessPaid)} Rolled Over</span>`
: `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200">Paid in Full</span>`;
} else {
statusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200">${formatINR(remainingToPay, 0)} Due</span>`;
}

const tr = document.createElement('tr');
tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60';
tr.innerHTML = `
<td class="py-2.5 px-3 font-bold text-slate-900 dark:text-white">${q.key}</td>
<td class="py-2.5 px-3 text-slate-500 dark:text-gray-400 text-xs">${q.title}</td>
<td class="py-2.5 px-3 text-right tabular-nums text-slate-600 dark:text-gray-300">${formatINR(cumulativeTaxAccrued)}</td>
<td class="py-2.5 px-3 text-center"><span class="px-1.5 py-0.5 rounded font-mono text-[11px] bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 font-bold">${Math.round(q.pct * 100)}%</span></td>
<td class="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white">${formatINR(statutoryMinDue)}</td>
<td class="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400 cursor-pointer hover:underline" onclick="recordTaxChallan('${targetFy}', '${currentTaxAccountFilter}', '${q.key}', ${actualPaid})" title="Click to update challan">${formatINR(actualPaid)}</td>
<td class="py-2.5 px-3 text-right tabular-nums font-bold ${remainingToPay > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}">${formatINR(remainingToPay)}</td>
<td class="py-2.5 px-4 text-center">${statusBadge}</td>
`;
advTbody.appendChild(tr);
});

const summaryBadge = document.getElementById('advanceTaxSummaryBadge');
if (summaryBadge) {
const netYearBalance = totalTaxLiability - totalPaidAllQuarters;
if (netYearBalance <= 0 && totalTaxLiability > 0) {
summaryBadge.className = 'text-xs font-bold px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800';
summaryBadge.innerText = totalPaidAllQuarters > totalTaxLiability
? `Surplus Advance Tax: +${formatINR(totalPaidAllQuarters - totalTaxLiability)} (Refundable at ITR)`
: 'Advance Tax 100% Cleared';
} else if (totalTaxLiability === 0) {
summaryBadge.className = 'text-xs font-bold px-3 py-1 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300';
summaryBadge.innerText = 'No Tax Liability for this Financial Year';
} else {
summaryBadge.className = 'text-xs font-bold px-3 py-1 rounded-lg bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800';
summaryBadge.innerText = `Net Pending Tax: ${formatINR(netYearBalance)}`;
}
}
}

renderTaxChallansLog(targetFy, currentTaxAccountFilter);

// Closed Lots Tax Audit Trail
const auditTbody = document.getElementById('taxAuditTableBody');
const countBadge = document.getElementById('taxAuditCount');
const fyLotsForAudit = currentTaxAccountFilter === 'ALL'
? data.taxClosedLots.filter(l => l.fy === targetFy)
: data.taxClosedLots.filter(l => l.fy === targetFy && l.account === currentTaxAccountFilter);
if (countBadge) countBadge.innerText = `${fyLotsForAudit.length} Lots`;

if (auditTbody) {
auditTbody.innerHTML = '';
if (fyLotsForAudit.length === 0) {
auditTbody.innerHTML = `<tr><td colspan="11" class="text-center py-6 text-slate-400 dark:text-gray-500 font-medium">No sales recorded for ${targetFy} in this account filter.</td></tr>`;
return;
}

[...fyLotsForAudit].reverse().forEach(lot => {
const isPos = lot.gain >= 0;
const tr = document.createElement('tr');
tr.className = 'hover:bg-slate-50 dark:hover:bg-gray-800/40 border-b border-slate-100 dark:border-gray-800/60';
tr.innerHTML = `
<td class="py-2 px-3 tabular-nums text-slate-500 dark:text-gray-400">${lot.sellDate}</td>
<td class="py-2 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700">${lot.account}</span></td>
<td class="py-2 px-3 font-semibold text-slate-900 dark:text-white">${lot.stock}</td>
<td class="py-2 px-2 text-right tabular-nums">${lot.qty}</td>
<td class="py-2 px-3 text-right tabular-nums text-slate-500 dark:text-gray-400">${lot.buyDate}</td>
<td class="py-2 px-2 text-right tabular-nums text-slate-600 dark:text-gray-300 font-mono">${lot.days}d</td>
<td class="py-2 px-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${lot.isLtcg ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800' : 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'}">${lot.isLtcg ? 'LTCG' : 'STCG'}</span></td>
<td class="py-2 px-3 text-right tabular-nums text-slate-500 dark:text-gray-400">${formatINR(lot.costBasis)}</td>
<td class="py-2 px-3 text-right tabular-nums">${formatINR(lot.proceeds)}</td>
<td class="py-2 px-3 text-right tabular-nums font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">${isPos ? '+' : ''}${formatINR(lot.gain)}</td>
<td class="py-2 px-2 text-center font-bold text-slate-500">${lot.quarter}</td>
`;
auditTbody.appendChild(tr);
});
}
}

function renderTaxHarvestingRadar(data, exemptionClaimedSoFar, ltcgExemptionCap = 125000) {
const activeAccounts = currentTaxAccountFilter === 'ALL' ? CALIB_ACCOUNTS : [currentTaxAccountFilter];
const maxExemptionRoom = activeAccounts.length * ltcgExemptionCap;
const unusedRoom = Math.max(0, maxExemptionRoom - exemptionClaimedSoFar);

const roomEl = document.getElementById('harvestLtcgRoomVal');
if (roomEl) roomEl.innerText = `${formatINR(unusedRoom, 0)} available`;

let openLots = data.openLots || [];
if (currentTaxAccountFilter !== 'ALL') {
openLots = openLots.filter(l => l.account === currentTaxAccountFilter);
}

const today = new Date();
const profitCandidates = [];
const lossCandidates = [];

openLots.forEach(lot => {
const livePrice = (marketPrices[lot.stock] ? marketPrices[lot.stock].ltp : null) || (savedManualPrices[lot.stock] ? savedManualPrices[lot.stock].ltp : lot.price);
const lotCost = lot.qty * lot.price;
const currentVal = lot.qty * livePrice;
const unrealized = currentVal - lotCost;

const buyD = parseLocalDate(lot.date);
const diffDays = Math.ceil(Math.abs(today - buyD) / (1000 * 60 * 60 * 24));
const isLtcg = diffDays > 365;

if (unrealized > 0 && isLtcg) {
profitCandidates.push({
stock: lot.stock,
qty: lot.qty,
cost: lot.price,
ltp: livePrice,
gain: unrealized,
days: diffDays,
account: lot.account
});
} else if (unrealized < 0) {
lossCandidates.push({
stock: lot.stock,
qty: lot.qty,
cost: lot.price,
ltp: livePrice,
loss: Math.abs(unrealized),
days: diffDays,
isLtcg: isLtcg,
account: lot.account
});
}
});

const profitList = document.getElementById('profitHarvestList');
const profitBadge = document.getElementById('profitHarvestCountBadge');
const maskClass = getMaskClass('taxPnl');

if (profitList && profitBadge) {
profitList.innerHTML = '';
profitBadge.innerText = `${profitCandidates.length} lot(s)`;

if (profitCandidates.length === 0) {
profitList.innerHTML = `<div class="text-slate-400 dark:text-gray-500 py-3 text-center">No open LTCG profit lots available to reset.</div>`;
} else {
profitCandidates.sort((a, b) => b.gain - a.gain).forEach(c => {
const row = document.createElement('div');
row.className = 'flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800';
row.innerHTML = `
<div>
<div class="font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
<span>${c.stock}</span>
<span class="text-[10px] font-semibold text-slate-400">(${c.days}d • ${c.account})</span>
</div>
<div class="text-[11px] text-slate-500 dark:text-gray-400 ${maskClass}">${c.qty} shs @ ₹${c.cost.toFixed(1)} &rarr; LTP ₹${c.ltp.toFixed(1)}</div>
</div>
<div class="text-right">
<span class="font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums ${maskClass}">+${formatINR(c.gain, 0)}</span>
<span class="block text-[10px] text-slate-400">Tax-Free Room</span>
</div>
`;
profitList.appendChild(row);
});
}
}

const lossList = document.getElementById('lossHarvestList');
const lossBadge = document.getElementById('lossHarvestCountBadge');
if (lossList && lossBadge) {
lossList.innerHTML = '';
lossBadge.innerText = `${lossCandidates.length} lot(s)`;

if (lossCandidates.length === 0) {
lossList.innerHTML = `<div class="text-slate-400 dark:text-gray-500 py-3 text-center">No open positions sitting at a paper loss.</div>`;
} else {
lossCandidates.sort((a, b) => b.loss - a.loss).forEach(c => {
const row = document.createElement('div');
row.className = 'flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800';
row.innerHTML = `
<div>
<div class="font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
<span>${c.stock}</span>
<span class="text-[10px] font-semibold text-slate-400">(${c.days}d • ${c.isLtcg ? 'LTCG' : 'STCG'} • ${c.account})</span>
</div>
<div class="text-[11px] text-slate-500 dark:text-gray-400 ${maskClass}">${c.qty} shs @ ₹${c.cost.toFixed(1)} &rarr; LTP ₹${c.ltp.toFixed(1)}</div>
</div>
<div class="text-right">
<span class="font-extrabold text-rose-600 dark:text-rose-400 tabular-nums ${maskClass}">-${formatINR(c.loss, 0)}</span>
<span class="block text-[10px] text-slate-400">Offset Capacity</span>
</div>
`;
lossList.appendChild(row);
});
}
}
}
