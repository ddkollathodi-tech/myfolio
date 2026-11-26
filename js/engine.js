// ============================================================================
// MyFolioAI - Computational Portfolio Engine & 4-Curve Math (js/engine.js)
// ============================================================================

function computeEngine(txListOverride) {
  const sourceList = Array.isArray(txListOverride) ? txListOverride : transactions;

  const sortedTx = sourceList
    .map((tx, idx) => ({ tx, idx }))
    .sort((a, b) => {
      const da = parseLocalDate(a.tx.date).getTime();
      const db = parseLocalDate(b.tx.date).getTime();
      if (da !== db) return da - db;
      return a.idx - b.idx;
    })
    .map(item => item.tx);

  const openLots = [];
  const fifoQueues = Object.create(null);

  function pushFifoLot(lot) {
    openLots.push(lot);
    const key = `${lot.account}::${lot.stock}`;
    if (!fifoQueues[key]) {
      fifoQueues[key] = { list: [], cursor: 0 };
    }
    fifoQueues[key].list.push(lot);
  }
  const closedTradesMap = {};
  const fyRealized = {};
  const taxClosedLots = [];
  const purificationLots = [];

  let runningCash = 0;
  let netInvested = 0;

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

        pushFifoLot({
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

        const rawDebt = tx.debtToAsset;
        const parsedDebt = (rawDebt !== undefined && rawDebt !== null && String(rawDebt).trim() !== '' && String(rawDebt).trim().toUpperCase() !== 'NA')
          ? Math.max(0, Number(rawDebt) || 0)
          : 0;

        const queue = fifoQueues[`${acct}::${stock}`];
        if (queue) {
          while (queue.cursor < queue.list.length && remQtyToSell > 0) {
            const lot = queue.list[queue.cursor];
            if (lot.qty <= 0) {
              queue.cursor++;
              continue;
            }

            const matchedQty = Math.min(lot.qty, remQtyToSell);
            const costBasis = matchedQty * lot.price;
            const proceeds = matchedQty * effectiveSellPrice;
            const gain = proceeds - costBasis;

            lot.qty -= matchedQty;
            remQtyToSell -= matchedQty;
            if (lot.qty <= 0) {
              queue.cursor++;
            }

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

            const buyD = parseLocalDate(lot.date);
            const sellD = parseLocalDate(tx.date);
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
        pushFifoLot({
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
        pushFifoLot({
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

  const accountCashMap = {};
  CALIB_ACCOUNTS.forEach(acct => {
    accountCashMap[acct] = (rawAccountCashMap[acct] || 0) + getCalibOffset(acct);
  });

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

  const netWorth = runningCash + totalPortfolioVal;
  const lifetimePnL = netWorth - netInvested;
  const lifetimePnLPct = netInvested > 0 ? (lifetimePnL / netInvested) * 100 : 0;

  const closedTrades = Object.values(closedTradesMap).map(c => {
    const retPct = c.totalCostBasis > 0 ? (c.netPnL / c.totalCostBasis) * 100 : 0;
    return { ...c, retPct };
  });

  const cashFlows = [];
  sortedTx.forEach(t => {
    const amt = Number(t.amount || 0);
    if (t.type === 'DEPOSIT') {
      cashFlows.push({ date: parseLocalDate(t.date), amount: -amt });
    } else if (t.type === 'WITHDRAWAL') {
      cashFlows.push({ date: parseLocalDate(t.date), amount: amt });
    }
  });

  if (netWorth > 0) {
    cashFlows.push({ date: new Date(), amount: netWorth });
  }

  const xirrValue = calculateAccurateXIRR(cashFlows);

  return {
    netWorth,
    netInvested,
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
  const d1 = dateStr1 === 'Current' ? new Date() : parseLocalDate(dateStr1);
  const d2 = dateStr2 === 'Current' ? new Date() : parseLocalDate(dateStr2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;

  if (dateStr1 === 'Current' || dateStr2 === 'Current') {
    const diffDays = Math.max(0, (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays / 30.4375;
  }

  const diffYears = d2.getFullYear() - d1.getFullYear();
  const diffMonths = d2.getMonth() - d1.getMonth();
  return Math.max(1, diffYears * 12 + diffMonths);
}

let cachedRocVersion = -1;
let cachedRocHistoryLen = -1;
let cachedRocIsOverride = false;
let cachedRocPoints = null;

function computeRocFourCurves(computed) {
  const isDefaultSnapshot = !computed || computed === cachedEngineResult;
  const histLen = Array.isArray(chartHistoryRecords) ? chartHistoryRecords.length : 0;
  if (
    isDefaultSnapshot &&
    !cachedRocIsOverride &&
    cachedRocPoints &&
    cachedRocVersion === cachedEngineVersion &&
    cachedRocHistoryLen === histLen
  ) {
    return cachedRocPoints;
  }

  const points = [];

  if (Array.isArray(chartHistoryRecords) && chartHistoryRecords.length > 0) {
    const sorted = [...chartHistoryRecords].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
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

    const actualVal = curr.portfolioValue;
    const netCapBase = curr.netCapital;

    const pureTarget = i === 0
      ? netCapBase
      : Math.round((prevPureTarget * compoundFactor) + deltaCapital);
    prevPureTarget = pureTarget;

    const ratchetTarget = i === 0
      ? netCapBase
      : Math.round((Math.max(prevRatchetTarget, prev.portfolioValue) * compoundFactor) + deltaCapital);
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

  if (isDefaultSnapshot) {
    cachedRocVersion = cachedEngineVersion;
    cachedRocHistoryLen = histLen;
    cachedRocIsOverride = false;
    cachedRocPoints = points;
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

  let low = -0.95;
  const high = 10.0;
  const fLow = xnpv(low);
  const fHigh = xnpv(high);
  if (fLow * fHigh <= 0) {
    let hi = high;
    for (let j = 0; j < 100; j++) {
      const mid = (low + hi) / 2;
      const fMid = xnpv(mid);
      if (Math.abs(fMid) < 1e-6 || (hi - low) / 2 < 1e-7) {
        return mid * 100;
      }
      if (fLow * fMid < 0) {
        hi = mid;
      } else {
        low = mid;
      }
    }
  }

  return null;
}

function computeHistoricalXirrSeries(points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const sortedTx = sortTransactionsChronologically(transactions);
  const now = new Date();

  return points.map(pt => {
    const isCurrent = pt.date === 'Current';
    const ptDate = isCurrent ? now : parseLocalDate(pt.date);
    if (isNaN(ptDate.getTime())) {
      return { label: pt.date, value: null };
    }

    const cutoffTime = isCurrent
      ? now.getTime()
      : new Date(ptDate.getFullYear(), ptDate.getMonth(), ptDate.getDate(), 23, 59, 59).getTime();

    const flows = [];
    for (let i = 0; i < sortedTx.length; i++) {
      const tx = sortedTx[i];
      const txDate = parseLocalDate(tx.date);
      if (isNaN(txDate.getTime()) || txDate.getTime() > cutoffTime) continue;

      const amt = Number(tx.amount || 0);
      if (tx.type === 'DEPOSIT' && amt !== 0) {
        flows.push({ date: txDate, amount: -Math.abs(amt) });
      } else if (tx.type === 'WITHDRAWAL' && amt !== 0) {
        flows.push({ date: txDate, amount: Math.abs(amt) });
      }
    }

    const endVal = Number(pt.portfolioValue || 0);
    if (endVal > 0 && flows.length > 0) {
      flows.push({ date: isCurrent ? now : ptDate, amount: endVal });
    }

    const xirr = calculateAccurateXIRR(flows);
    return {
      label: pt.date,
      value: (xirr !== null && !isNaN(xirr)) ? Number(xirr.toFixed(2)) : null
    };
  });
}
