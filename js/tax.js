// ============================================================================
// MyFolioAI - Indian Capital Gains Tax & Planning Cockpit (tax.js)
// Post-July 2024 Regime, Section 111A, Section 112A, Set-Offs & Advance Tax
// ============================================================================

function populateTaxFyOptions(fyRealized) {
  const select = document.getElementById('taxFyFilter');
  if (!select) return;
  const currentSelected = select.value;
  select.innerHTML = '';

  const currentFy = getFinancialYear(new Date().toISOString().split('T')[0]);
  const availableFys = new Set([currentFy, ...Object.keys(fyRealized)]);

  Array.from(availableFys).sort().reverse().forEach(fy => {
    const opt = document.createElement('option');
    opt.value = fy;
    opt.innerText = fy;
    select.appendChild(opt);
  });

  if (currentSelected && availableFys.has(currentSelected)) {
    select.value = currentSelected;
  } else {
    select.value = currentFy;
  }
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
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));

  if (typeof sendToSheet === 'function') {
    sendToSheet({
      action: "saveSettings",
      settings: { [key]: newVal }
    });
  }

  renderTaxView();
}

function recordTaxChallan(fy, acct, qKey, currentPaid) {
  const input = prompt(`Enter total advance tax challan amount paid for ${qKey} (${fy} - ${acct}):`, currentPaid || 0);
  if (input !== null && !isNaN(Number(input))) {
    const val = Math.max(0, Number(input));
    const key = `${fy}__${acct}__${qKey}`;
    taxPaidChallans[key] = val;
    localStorage.setItem(TAX_PAID_KEY, JSON.stringify(taxPaidChallans));
    renderTaxView();
  }
}

function renderTaxView() {
  const fySelect = document.getElementById('taxFyFilter');
  if (!fySelect) return;
  const targetFy = fySelect.value || getFinancialYear(new Date().toISOString().split('T')[0]);

  const data = computeEngine();
  let lots = data.taxClosedLots.filter(l => l.fy === targetFy);

  if (currentTaxAccountFilter !== 'ALL') {
    lots = lots.filter(l => l.account === currentTaxAccountFilter);
  }

  const activeAcct = currentTaxAccountFilter === 'ALL' ? 'Wife' : currentTaxAccountFilter;
  const isLowIncome = appSettings[`taxToggle_${activeAcct}`] === 'true';

  const toggleBtn = document.getElementById('taxLowIncomeToggleBtn');
  const toggleText = document.getElementById('taxLowIncomeToggleText');
  const toggleBadge = document.getElementById('taxToggleBadge');
  const explainer = document.getElementById('taxToggleExplainer');

  if (isLowIncome) {
    if (toggleBtn) toggleBtn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white';
    if (toggleText) toggleText.innerText = 'Zero / Low Income (< ₹3L)';
    if (toggleBadge) {
      toggleBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
      toggleBadge.innerText = 'Active (₹3L Absorbed)';
    }
    if (explainer) explainer.innerText = `Absorbs up to ₹3,00,000 capital gains against the Basic Exemption Limit. STCG absorbed first (saving 20.80%), remaining absorbs LTCG (saving 13%).`;
  } else {
    if (toggleBtn) toggleBtn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-xs flex items-center space-x-1.5 bg-slate-200 dark:bg-gray-800 hover:bg-slate-300 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-300';
    if (toggleText) toggleText.innerText = 'Regular Salary / Income';
    if (toggleBadge) {
      toggleBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-500 border border-slate-200 dark:border-gray-700';
      toggleBadge.innerText = 'Standard Regime';
    }
    if (explainer) explainer.innerText = `Standard earner status: Capital gains are subject to flat statutory tax rates from Rupee One.`;
  }

  let stcgGrossGain = 0;
  let stcgGrossLoss = 0;
  let ltcgGrossGain = 0;
  let ltcgGrossLoss = 0;

  const quarterGains = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };

  lots.forEach(lot => {
    quarterGains[lot.quarter] += lot.gain;
    if (lot.isLtcg) {
      if (lot.gain > 0) ltcgGrossGain += lot.gain;
      else ltcgGrossLoss += Math.abs(lot.gain);
    } else {
      if (lot.gain > 0) stcgGrossGain += lot.gain;
      else stcgGrossLoss += Math.abs(lot.gain);
    }
  });

  // Statutory Set-Off Cascade
  const stclOffsetAgainstStcg = Math.min(stcgGrossGain, stcgGrossLoss);
  let netStcgAfterInternal = stcgGrossGain - stclOffsetAgainstStcg;
  let remainingStcl = stcgGrossLoss - stclOffsetAgainstStcg;

  const ltclOffsetAgainstLtcg = Math.min(ltcgGrossGain, ltcgGrossLoss);
  let netLtcgAfterInternal = ltcgGrossGain - ltclOffsetAgainstLtcg;
  let remainingLtcl = ltcgGrossLoss - ltclOffsetAgainstLtcg;

  const stclOffsetAgainstLtcg = Math.min(netLtcgAfterInternal, remainingStcl);
  netLtcgAfterInternal -= stclOffsetAgainstLtcg;
  remainingStcl -= stclOffsetAgainstLtcg;

  const totalStclOffset = stclOffsetAgainstStcg + stclOffsetAgainstLtcg;
  const totalLtclOffset = ltclOffsetAgainstLtcg;

  // Basic Exemption Shortfall Absorption
  let stcgShortfallAbsorbed = 0;
  let ltcgShortfallAbsorbed = 0;

  if (isLowIncome) {
    const totalShortfallCapacity = 300000;
    stcgShortfallAbsorbed = Math.min(netStcgAfterInternal, totalShortfallCapacity);
    const remainingShortfall = totalShortfallCapacity - stcgShortfallAbsorbed;
    ltcgShortfallAbsorbed = Math.min(netLtcgAfterInternal, remainingShortfall);
  }

  const netStcgAfterShortfall = Math.max(0, netStcgAfterInternal - stcgShortfallAbsorbed);
  const netLtcgAfterShortfall = Math.max(0, netLtcgAfterInternal - ltcgShortfallAbsorbed);

  const maxExemptionAllowed = currentTaxAccountFilter === 'ALL' ? 500000 : 125000;
  const exemptionClaimed = Math.min(maxExemptionAllowed, netLtcgAfterShortfall);
  const taxableLtcg = Math.max(0, netLtcgAfterShortfall - exemptionClaimed);
  const taxableStcg = netStcgAfterShortfall;

  const stcgTax = taxableStcg * 0.2080;
  const ltcgTax = taxableLtcg * 0.1300;
  const totalTaxLiability = Math.round(stcgTax + ltcgTax);

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
        <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">20.80%</span></td>
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
        <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">13.00%</span></td>
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

  renderTaxHarvestingRadar(data, exemptionClaimed);

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
      const challanKey = `${targetFy}__${currentTaxAccountFilter}__${q.key}`;
      const actualPaid = taxPaidChallans[challanKey] || 0;
      totalPaidAllQuarters += actualPaid;
      cumulativePaid += actualPaid;

      const remainingToPay = Math.max(0, statutoryMinDue - cumulativePaid);
      const excessPaid = Math.max(0, cumulativePaid - statutoryMinDue);

      let statusBadge = '';
      if (totalTaxLiability === 0) {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-gray-800 text-slate-500">Nil Liability</span>`;
      } else if (remainingToPay === 0) {
        statusBadge = excessPaid > 0 
          ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-200">+₹${formatCompactIndian(excessPaid)} Rolled Over</span>`
          : `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200">Paid in Full</span>`;
      } else {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200">₹${formatINR(remainingToPay, 0)} Due</span>`;
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
          : `Advance Tax 100% Cleared`;
      } else if (totalTaxLiability === 0) {
        summaryBadge.className = 'text-xs font-bold px-3 py-1 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300';
        summaryBadge.innerText = 'No Tax Liability for this Financial Year';
      } else {
        summaryBadge.className = 'text-xs font-bold px-3 py-1 rounded-lg bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800';
        summaryBadge.innerText = `Net Pending Tax: ${formatINR(netYearBalance)}`;
      }
    }
  }

  // Closed Lots Tax Audit Trail
  const auditTbody = document.getElementById('taxAuditTableBody');
  const countBadge = document.getElementById('taxAuditCount');
  if (countBadge) countBadge.innerText = `${lots.length} Closed Lots`;

  if (auditTbody) {
    auditTbody.innerHTML = '';
    if (lots.length === 0) {
      auditTbody.innerHTML = `<tr><td colspan="11" class="text-center py-6 text-slate-400 dark:text-gray-500 font-medium">No sales recorded for ${targetFy} in this account filter.</td></tr>`;
      return;
    }

    [...lots].reverse().forEach(lot => {
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

function renderTaxHarvestingRadar(data, exemptionClaimedSoFar) {
  const maxExemptionRoom = currentTaxAccountFilter === 'ALL' ? 500000 : 125000;
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

    const buyD = new Date(lot.date);
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
            <div class="text-[11px] text-slate-500 dark:text-gray-400">${c.qty} shs @ ₹${c.cost.toFixed(1)} &rarr; LTP ₹${c.ltp.toFixed(1)}</div>
          </div>
          <div class="text-right">
            <span class="font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">+${formatINR(c.gain, 0)}</span>
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
            <div class="text-[11px] text-slate-500 dark:text-gray-400">${c.qty} shs @ ₹${c.cost.toFixed(1)} &rarr; LTP ₹${c.ltp.toFixed(1)}</div>
          </div>
          <div class="text-right">
            <span class="font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">-${formatINR(c.loss, 0)}</span>
            <span class="block text-[10px] text-slate-400">Offset Capacity</span>
          </div>
        `;
        lossList.appendChild(row);
      });
    }
  }
}
