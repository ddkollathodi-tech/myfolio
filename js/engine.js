// ============================================================================
// MyFolioAI - Computational Portfolio Engine & 4-Curve Math (engine.js)
// Integrates: Strict FIFO, Corporate Actions, Cash Calibration, XIRR, 
//             Multi-Account Segregation, Tax Audit Trail & 4-Curve RoC
// ============================================================================

function computeEngine() {
  const sortedTx = [...transactions].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (da !== db) return da - db;
    return (a.id || '').localeCompare(b.id || '');
  });

  const openLots = [];
  const closedTradesMap = {};
  const fyRealized = {};
  const taxClosedLots = [];

  let runningCash = 0;
  let netInvested = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;

  // Raw Tagged Cash per Account (Pre-Calibration)
  const rawAccountCashMap = { 'Me': 0, 'Wife': 0, 'Mom': 0, 'Brother': 0 };

  const ledgerEntries = [];
  const bankEntries = [];

  sortedTx.forEach(tx => {
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
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] += amt;
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
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] -= amt;
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
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] -= amt;
        break;

      case 'BUY': {
        const buyCost = amt > 0 ? amt : (qty * price);
        runningCash -= buyCost;
        cashOut = buyCost;
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] -= buyCost;

        openLots.push({
          id: tx.id || String(Math.random()),
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
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] += sellProceeds;

        let remQtyToSell = qty;
        const effectiveSellPrice = price > 0 ? price : (sellProceeds / (qty || 1));

        for (let i = 0; i < openLots.length && remQtyToSell > 0; i++) {
          const lot = openLots[i];
          if (lot.stock === stock && lot.account === acct && lot.qty > 0) {
            const matchedQty = Math.min(lot.qty, remQtyToSell);
            const costBasis = matchedQty * lot.price;
            const proceeds = matchedQty * effectiveSellPrice;
            const gain = proceeds - costBasis;

            lot.qty -= matchedQty;
            remQtyToSell -= matchedQty;

            // Update Closed Trades Aggregation
            if (!closedTradesMap[stock]) {
              closedTradesMap[stock] = { stock, totalQty: 0, totalCostBasis: 0, totalProceeds: 0, netPnL: 0 };
            }
            closedTradesMap[stock].totalQty += matchedQty;
            closedTradesMap[stock].totalCostBasis += costBasis;
            closedTradesMap[stock].totalProceeds += proceeds;
            closedTradesMap[stock].netPnL += gain;

            // Financial Year Bucket
            const fy = getFinancialYear(tx.date);
            if (!fyRealized[fy]) {
              fyRealized[fy] = { fy, sellProceeds: 0, costBasis: 0, gain: 0 };
            }
            fyRealized[fy].sellProceeds += proceeds;
            fyRealized[fy].costBasis += costBasis;
            fyRealized[fy].gain += gain;

            // Tax Lot Details (STCG vs LTCG)
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
          }
        }
        break;
      }

      case 'BONUS':
        openLots.push({
          id: tx.id || String(Math.random()),
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
          id: tx.id || String(Math.random()),
          date: tx.date,
          stock: stock,
          qty: qty,
          price: price,
          account: acct
        });
        break;
    }

    ledgerEntries.push({
      date: tx.date,
      account: acct,
      type: tx.type,
      stock: tx.stock || '',
      qty: tx.qty || '',
      price: tx.price || '',
      cashOut: cashOut,
      cashIn: cashIn,
      runningCash: runningCash,
      remarks: tx.remarks || ''
    });
  });

  // Effective Calibrated Account Cash Map
  const accountCashMap = {};
  CALIB_ACCOUNTS.forEach(acct => {
    accountCashMap[acct] = (rawAccountCashMap[acct] || 0) + getCalibOffset(acct);
  });

  // Total Open Holdings Value & Unrealized P&L
  let totalPortfolioVal = 0;
  let totalUnrealizedPnL = 0;
  let totalOpenInvested = 0;

  const holdings = [];
  const activeLots = openLots.filter(l => l.qty > 0);

  // Group by Stock
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
      const liveData = marketPrices[stock] || savedManualPrices[stock] || { ltp: wap, prevClose: wap };
      const ltp = liveData.ltp;
      const curVal = item.qty * ltp;
      const invVal = item.cost;
      const pnlVal = curVal - invVal;
      const pnlPct = invVal > 0 ? (pnlVal / invVal) * 100 : 0;

      totalPortfolioVal += curVal;
      totalUnrealizedPnL += pnlVal;
      totalOpenInvested += invVal;

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
    totalOpenInvested,
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
    ledgerEntries,
    bankEntries,
    sortedTx
  };
}

// ----------------------------------------------------------------------------
// 4-CURVE COMPOUNDING ENGINE & ROC CALCULATIONS (HIGH-WATER MARK RATCHET)
// ----------------------------------------------------------------------------
function computeRocFourCurves(computed) {
  const points = [];

  // 1. Gather all historical checkpoints[cite: 3]
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

  // 2. Append live today checkpoint[cite: 3]
  if (computed) {
    points.push({
      date: 'Current',
      portfolioValue: Math.round(computed.netWorth || 0),
      netCapital: Math.round(computed.netInvested || 0),
      profit: Math.round(computed.lifetimePnL || 0)
    });
  }

  if (points.length === 0) return [];

  // 3. Compute Recursive 4 Curves[cite: 3]
  const rate = ROC_TARGET_MONTHLY_RATE; // 2% per month[cite: 3]
  let prevPureTarget = points[0].netCapital;
  let prevRatchetTarget = points[0].netCapital;

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = i > 0 ? points[i - 1] : null;

    // Delta Capital Injected this period[cite: 3]
    const deltaCapital = prev ? (curr.netCapital - prev.netCapital) : 0;

    // Curve 1: Actual Track[cite: 3]
    const actualVal = curr.portfolioValue;

    // Curve 2: Contributed Capital Base[cite: 3]
    const netCapBase = curr.netCapital;

    // Curve 3: Pure 2% Compound Hurdle[cite: 3]
    let pureTarget = 0;
    if (i === 0) {
      pureTarget = netCapBase;
    } else {
      pureTarget = Math.round((prevPureTarget * (1 + rate)) + deltaCapital);
    }
    prevPureTarget = pureTarget;

    // Curve 4: Aggressive Ratchet Target (High-Water Mark Recovery Engine)
    let ratchetTarget = 0;
    if (i === 0) {
      ratchetTarget = netCapBase;
    } else {
      // Protects peak performance baseline: locks onto max of prior ratchet target or prior portfolio peak
      const highWaterMark = Math.max(prevRatchetTarget, prev.portfolioValue);
      ratchetTarget = Math.round((highWaterMark * (1 + rate)) + deltaCapital);
    }
    prevRatchetTarget = ratchetTarget;

    // RoC Analytics for the month[cite: 3]
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
// ACCURATE CASH-FLOW XIRR (NEWTON-RAPHSON)
// ----------------------------------------------------------------------------
function calculateAccurateXIRR(cashFlows) {
  if (cashFlows.length < 2) return 0.0;

  const hasNegative = cashFlows.some(cf => cf.amount < 0);
  const hasPositive = cashFlows.some(cf => cf.amount > 0);
  if (!hasNegative || !hasPositive) return 0.0;

  const t0 = cashFlows[0].date.getTime();

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

  let rate = 0.15;
  for (let i = 0; i < 100; i++) {
    const fVal = xnpv(rate);
    const fDeriv = xnpvPrime(rate);
    if (Math.abs(fDeriv) < 1e-10) break;
    const nextRate = rate - fVal / fDeriv;
    if (Math.abs(nextRate - rate) < 1e-7) {
      return nextRate * 100;
    }
    rate = nextRate;
    if (rate <= -0.9999) rate = -0.99;
  }
  return isNaN(rate) ? 0.0 : rate * 100;
}
