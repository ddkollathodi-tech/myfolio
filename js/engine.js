// ============================================================================
// MyFolioAI - Computational Portfolio Engine & 4-Curve Math (js/engine.js)
// Integrates: Strict FIFO, Corporate Actions, Cash Calibration, XIRR,
//             Multi-Account Segregation, Tax Audit Trail, Purification Math &
//             Time-Normalized 4-Curve RoC
// ============================================================================

function computeEngine(txListOverride) {
  const sourceList = Array.isArray(txListOverride) ? txListOverride : transactions;

  // Preserve original sheet/entry sequence order as tie-breaker for same-day entries
  const sortedTx = sourceList
    .map((tx, idx) => ({ tx, idx }))
    .sort((a, b) => {
      const da = new Date(a.tx.date).getTime();
      const db = new Date(b.tx.date).getTime();
      if (da !== db) return da - db;
      return a.idx - b.idx;
    })
    .map(item => item.tx);

  const openLots = [];
  const closedTradesMap = {};
  const fyRealized = {};
  const taxClosedLots = [];
  const purificationLots = [];

  let runningCash = 0;
  let netInvested = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;

  // Raw Tagged Cash per Account (Pre-Calibration)
  const rawAccountCashMap = { 'Me': 0, 'Wife': 0, 'Mom': 0, 'Brother': 0 };

  const ledgerEntries = [];
  const bankEntries = [];

  sortedTx.forEach((tx, seqIdx) => {
    const amt = Number(tx.amount || 0);
    const qty = Number(tx.qty || 0);
    const price = Number(tx.price || 0);
    const stock = (tx.stock || '').toUpperCase().trim();
    const acct = tx.account || 'Unassigned';

    let cashIn = 0;
    let cashOut = 0;

    switch (tx.type) {
      case 'DEPOSIT':
        runningCash += amt;
        netInvested += amt;
        totalDeposits += amt;
        cashIn = amt;
        if (Object.prototype.hasOwnProperty.call(rawAccountCashMap, acct)) {
          rawAccountCashMap[acct] += amt;
        }
        bankEntries.push({
          date: tx.date,
          account: acct,
          type: 'DEPOSIT',
          deposit: amt,
          withdrawal: 0,
          corpus: netInvested,
          remarks: tx.remarks || 'Capital Inflow'
        });
        break;

      case 'WITHDRAWAL':
        runningCash -= amt;
        netInvested -= amt;
        totalWithdrawals += amt;
        cashOut = amt;
        if (Object.prototype.hasOwnProperty.call(rawAccountCashMap, acct)) {
          rawAccountCashMap[acct] -= amt;
        }
        bankEntries.push({
          date: tx.date,
          account: acct,
          type: 'WITHDRAWAL',
          deposit: 0,
          withdrawal: amt,
          corpus: netInvested,
          remarks: tx.remarks || 'Capital Outflow'
        });
        break;

      case 'FEES':
        runningCash -= amt;
        cashOut = amt;
        if (Object.prototype.hasOwnProperty.call(rawAccountCashMap, acct)) {
          rawAccountCashMap[acct] -= amt;
        }
        break;

      case 'BUY': {
        const buyCost = amt > 0 ? amt : (qty * price);
        runningCash -= buyCost;
        cashOut = buyCost;
        if (Object.prototype.hasOwnProperty.call(rawAccountCashMap, acct)) {
          rawAccountCashMap[acct] -= buyCost;
        }

        openLots.push({
          id: tx.id || `LOT_${seqIdx}`,
          date: tx.date,
          stock: stock,
          qty: qty,
          price: price > 0 ? price : (buyCost / (qty || 1)),
          account: acct
        });
        break;
      }

      case 'SELL': {
        const sellProceeds = amt > 0 ? amt : (qty * price);
        runningCash += sellProceeds;
        cashIn = sellProceeds;
        if (Object.prototype.hasOwnProperty.call(rawAccountCashMap, acct)) {
          rawAccountCashMap[acct] += sellProceeds;
        }

        let remQtyToSell = qty;
        const effectiveSellPrice = price > 0 ? price : (sellProceeds / (qty || 1));

        // Parse Debt-to-Asset % (0 for historical/NA entries)
        const rawDebt = tx.debtToAsset;
        const parsedDebt = (rawDebt !== undefined && rawDebt !== null && String(rawDebt).trim() !== '' && String(rawDebt).trim().toUpperCase() !== 'NA')
          ? Math.max(0, Number(rawDebt) || 0)
          : 0;

        for (let i = 0; i < openLots.length && remQtyToSell > 0; i++) {
          const lot = openLots[i];
          if (lot.stock === stock && lot.account === acct && lot.qty > 0) {
            const matchedQty = Math.min(lot.qty, remQtyToSell);
            const costBasis = matchedQty * lot.price;
            const proceeds = matchedQty * effectiveSellPrice;
            const gain = proceeds - costBasis;

            lot.qty -= matchedQty;
            remQtyToSell -= matchedQty;

            if (!closedTradesMap[stock]) {
              closedTradesMap[stock] = { stock, totalQty: 0, totalCostBasis: 0, totalProceeds: 0, netPnL: 0 };
            }
            closedTradesMap[stock].totalQty += matchedQty;
            closedTradesMap[stock].totalCostBasis += costBasis;
            closedTradesMap[stock].totalProceeds += proceeds;
            closedTradesMap[stock].netPnL += gain;

            const fy = getFinancialYear(tx.date);
            if (!fyRealized[fy]) {
              fyRealized[fy] = { fy, sellProceeds: 0, costBasis: 0, gain: 0, closedTradeCount: 0 };
            }
            fyRealized[fy].sellProceeds += proceeds;
            fyRealized[fy].costBasis += costBasis;
            fyRealized[fy].gain += gain;
            fyRealized[fy].closedTradeCount += 1;

            const buyD = new Date(lot.date);
            const sellD = new Date(tx.date);
            const holdingDays = Math.max(0, Math.round((sellD - buyD) / (1000 * 60 * 60 * 24)));
            const isLtcg = holdingDays > 365;

            taxClosedLots.push({
              sellDate: tx.date,
              buyDate: lot.date,
              account: acct,
              stock: stock,
              qty: matchedQty,
              days: holdingDays,
              isLtcg: isLtcg,
              costBasis: costBasis,
              proceeds: proceeds,
              gain: gain,
              quarter: getTaxQuarter(tx.date),
              fy: fy
            });

            // Purification / Donation Obligation (only on positive realized gain)
            const purificationDue = gain > 0 ? (gain * (parsedDebt / 100)) : 0;

            purificationLots.push({
              txId: tx.id || '',
              sellDate: tx.date,
              buyDate: lot.date,
              account: acct,
              stock: stock,
              qty: matchedQty,
              costBasis: costBasis,
              proceeds: proceeds,
              gain: gain,
              debtToAsset: parsedDebt,
              purificationDue: purificationDue,
              fy: fy
            });
          }
        }
        break;
      }

      case 'BONUS':
        openLots.push({
          id: tx.id || `LOT_${seqIdx}`,
          date: tx.date,
          stock: stock,
          qty: qty,
          price: 0,
          account: acct
        });
        break;

      case 'SPLIT': {
        const effectiveOldPrice = price > 0 ? price : 1;
        const splitRatio = qty > 0 ? (qty / effectiveOldPrice) : 1;
        openLots.forEach(lot => {
          if (lot.stock === stock && lot.account === acct) {
            lot.qty = lot.qty * splitRatio;
            lot.price = lot.price / splitRatio;
          }
        });
        break;
      }

      case 'DEMERGER':
        openLots.push({
          id: tx.id || `LOT_${seqIdx}`,
          date: tx.date,
          stock: stock,
          qty: qty,
          price: price,
          account: acct
        });
        break;
    }

    ledgerEntries.push({
      id: tx.id || '',
      date: tx.date,
      account: acct,
      type: tx.type,
      stock: tx.stock || '',
      qty: tx.qty || '',
      price: tx.price || '',
      cashOut: cashOut,
      cashIn: cashIn,
      runningCash: runningCash,
      remarks: tx.remarks || '',
      debtToAsset: tx.type === 'SELL' ? Number(tx.debtToAsset || 0) : 'NA'
    });
  });

  // Effective Calibrated Account Cash Map (Display-isolated per account)
  const accountCashMap = {};
  CALIB_ACCOUNTS.forEach(acct => {
    accountCashMap[acct] = (rawAccountCashMap[acct] || 0) + getCalibOffset(acct);
  });

  // Total Open Holdings Value & Unrealized P&L
  let totalPortfolioVal = 0;
  let totalUnrealizedPnL = 0;

  const holdings = [];
  const activeLots = openLots.filter(l => l.qty > 0);

  const stockGroup = {};
  activeLots.forEach(l => {
    if (!stockGroup[l.stock]) stockGroup[l.stock] = { qty: 0, cost: 0 };
    stockGroup[l.stock].qty += l.qty;
    stockGroup[l.stock].cost += (l.qty * l.price);
  });

  Object.keys(stockGroup).forEach(stock => {
    const item = stockGroup[stock];
    if (item.qty > 0) {
      const wap = item.cost / item.qty;
      const liveData = marketPrices[stock];
      const ltp = (liveData && Number(liveData.ltp) > 0) ? Number(liveData.ltp) : wap;
      const curVal = item.qty * ltp;
      const invVal = item.cost;
      const pnlVal = curVal - invVal;
      const pnlPct = invVal > 0 ? (pnlVal / invVal) * 100 : 0;

      totalPortfolioVal += curVal;
      totalUnrealizedPnL += pnlVal;

      holdings.push({
        stock,
        qty: item.qty,
        wap,
        ltp,
        investedVal: invVal,
        currentVal: curVal,
        pnlVal,
        pnlPct
      });
    }
  });

  holdings.forEach(h => {
    h.weightPct = totalPortfolioVal > 0 ? (h.currentVal / totalPortfolioVal) * 100 : 0;
  });

  // Net Worth & Lifetime P&L
  const netWorth = runningCash + totalPortfolioVal;
  const lifetimePnL = netWorth - netInvested;
  const lifetimePnLPct = netInvested > 0 ? (lifetimePnL / netInvested) * 100 : 0;

  // Closed Trades List
  const closedTrades = Object.values(closedTradesMap).map(c => {
    const retPct = c.totalCostBasis > 0 ? (c.netPnL / c.totalCostBasis) * 100 : 0;
    return { ...c, retPct };
  });

  // Accurate Cash-Flow XIRR Calculation
  const cashFlows = [];
  sortedTx.forEach(t => {
    const amt = Number(t.amount || 0);
    if (t.type === 'DEPOSIT') {
      cashFlows.push({ date: new Date(t.date), amount: -amt });
    } else if (t.type === 'WITHDRAWAL') {
      cashFlows.push({ date: new Date(t.date), amount: amt });
    }
  });

  if (netWorth > 0) {
    cashFlows.push({ date: new Date(), amount: netWorth });
  }

  const xirrValue = calculateAccurateXIRR(cashFlows);

  return {
    netWorth,
    netInvested,
    totalDeposits,
    totalWithdrawals,
    cashBalance: runningCash,
    totalPortfolioVal,
    totalUnrealizedPnL,
    lifetimePnL,
    lifetimePnLPct,
    xirrValue,
    rawAccountCashMap,
    accountCashMap,
    holdings,
    openLots: activeLots,
    closedTrades,
    fyRealized,
    taxClosedLots,
    purificationLots,
    ledgerEntries,
    bankEntries,
    sortedTx
  };
}

// ----------------------------------------------------------------------------
// TIME-NORMALIZED 4-CURVE COMPOUNDING & ROC CALCULATIONS
// ----------------------------------------------------------------------------
function getElapsedMonths(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return 1;
  const d1 = dateStr1 === 'Current' ? new Date() : new Date(dateStr1);
  const d2 = dateStr2 === 'Current' ? new Date() : new Date(dateStr2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;

  // For live 'Current' checkpoint, compute exact fractional months elapsed
  if (dateStr1 === 'Current' || dateStr2 === 'Current') {
    const diffDays = Math.max(0, (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays / 30.4375;
  }

  const diffYears = d2.getFullYear() - d1.getFullYear();
  const diffMonths = d2.getMonth() - d1.getMonth();
  return Math.max(1, diffYears * 12 + diffMonths);
}

function computeRocFourCurves(computed) {
  const points = [];

  if (Array.isArray(chartHistoryRecords) && chartHistoryRecords.length > 0) {
    const sorted = [...chartHistoryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach(r => {
      if (!r.date) return;
      points.push({
        date: r.date,
        portfolioValue: Number(r.portfolioValue || 0),
        netCapital: Number(r.netCapital || 0),
        profit: Number(r.profit || 0)
      });
    });
  }

  if (computed) {
    points.push({
      date: 'Current',
      portfolioValue: Math.round(computed.netWorth || 0),
      netCapital: Math.round(computed.netInvested || 0),
      profit: Math.round(computed.lifetimePnL || 0)
    });
  }

  if (points.length === 0) return [];

  const monthlyRate = ROC_TARGET_MONTHLY_RATE;
  let prevPureTarget = points[0].netCapital;
  let prevRatchetTarget = points[0].netCapital;

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = i > 0 ? points[i - 1] : null;

    const deltaCapital = prev ? (curr.netCapital - prev.netCapital) : 0;
    const deltaMonths = prev ? getElapsedMonths(prev.date, curr.date) : 1;
    const compoundFactor = Math.pow(1 + monthlyRate, deltaMonths);

    // Curve 1: Actual Track
    const actualVal = curr.portfolioValue;

    // Curve 2: Contributed Capital Base
    const netCapBase = curr.netCapital;

    // Curve 3: Time-Normalized Compound Hurdle
    let pureTarget = 0;
    if (i === 0) {
      pureTarget = netCapBase;
    } else {
      pureTarget = Math.round((prevPureTarget * compoundFactor) + deltaCapital);
    }
    prevPureTarget = pureTarget;

    // Curve 4: Aggressive Ratchet Target (Time-Normalized)
    let ratchetTarget = 0;
    if (i === 0) {
      ratchetTarget = netCapBase;
    } else {
      const peakBase = Math.max(prevRatchetTarget, prev.portfolioValue);
      ratchetTarget = Math.round((peakBase * compoundFactor) + deltaCapital);
    }
    prevRatchetTarget = ratchetTarget;

    const deltaProfit = prev ? (curr.profit - prev.profit) : 0;
    const startCapital = prev ? prev.portfolioValue : netCapBase;
    const rocPct = startCapital > 0 ? (deltaProfit / startCapital) * 100 : 0;
    const pureGap = actualVal - pureTarget;
    const ratchetDeficit = actualVal - ratchetTarget;

    curr.actualVal = actualVal;
    curr.netCapBase = netCapBase;
    curr.pureTarget = pureTarget;
    curr.ratchetTarget = ratchetTarget;
    curr.deltaProfit = deltaProfit;
    curr.rocPct = rocPct;
    curr.pureGap = pureGap;
    curr.ratchetDeficit = ratchetDeficit;
    curr.startCapital = startCapital;
  }

  return points;
}

// ----------------------------------------------------------------------------
// ACCURATE CASH-FLOW XIRR (NEWTON-RAPHSON + BISECTION FALLBACK)
// ----------------------------------------------------------------------------
function calculateAccurateXIRR(cashFlows) {
  if (!cashFlows || cashFlows.length < 2) return null;

  const hasNegative = cashFlows.some(cf => cf.amount < 0);
  const hasPositive = cashFlows.some(cf => cf.amount > 0);
  if (!hasNegative || !hasPositive) return null;

  const t0 = cashFlows[0].date.getTime();
  const tLast = cashFlows[cashFlows.length - 1].date.getTime();
  const totalDays = (tLast - t0) / (1000 * 60 * 60 * 24);

  // Suppress annualized distortion for investment durations shorter than 90 days
  if (totalDays < 90) return null;

  function xnpv(rate) {
    return cashFlows.reduce((acc, cf) => {
      const years = (cf.date.getTime() - t0) / (1000 * 60 * 60 * 24 * 365);
      return acc + (cf.amount / Math.pow(1 + rate, years));
    }, 0);
  }

  function xnpvPrime(rate) {
    return cashFlows.reduce((acc, cf) => {
      const years = (cf.date.getTime() - t0) / (1000 * 60 * 60 * 24 * 365);
      if (years === 0) return acc;
      return acc - (years * cf.amount / Math.pow(1 + rate, years + 1));
    }, 0);
  }

  // Primary solver: Newton-Raphson
  let rate = 0.15;
  for (let i = 0; i < 100; i++) {
    const fVal = xnpv(rate);
    const fDeriv = xnpvPrime(rate);
    if (Math.abs(fDeriv) < 1e-10) break;
    const nextRate = rate - fVal / fDeriv;
    if (Math.abs(nextRate - rate) < 1e-7 && nextRate > -0.9999 && nextRate < 100) {
      return nextRate * 100;
    }
    rate = nextRate;
    if (rate <= -0.9999) rate = -0.99;
  }

  // Fallback solver: Bisection search across [-0.95, 10.0]
  let low = -0.95;
  let high = 10.0;
  let fLow = xnpv(low);
  let fHigh = xnpv(high);
  if (fLow * fHigh <= 0) {
    for (let j = 0; j < 100; j++) {
      const mid = (low + high) / 2;
      const fMid = xnpv(mid);
      if (Math.abs(fMid) < 1e-6 || (high - low) / 2 < 1e-7) {
        return mid * 100;
      }
      if (fLow * fMid < 0) {
        high = mid;
        fHigh = fMid;
      } else {
        low = mid;
        fLow = fMid;
      }
    }
  }

  return null;
}
