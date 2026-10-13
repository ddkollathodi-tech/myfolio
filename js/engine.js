// ============================================================================
// MyFolioAI - Financial Calculation Core Engine (engine.js)
// FIFO Accounting, WAP Holdings, Corporate Actions, XIRR & Cash Calibration
// ============================================================================

function computeEngine() {
  const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

  let cashBalance = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;

  // Track raw tagged liquid cash balances per account
  const rawAccountCashMap = { 'Me': 0, 'Wife': 0, 'Mom': 0, 'Brother': 0 };

  const inventory = {};
  const fyRealized = {};
  const closedTradesMap = {};

  const ledgerEntries = [];
  const bankEntries = [];
  const taxClosedLots = [];

  sortedTx.forEach(tx => {
    const fy = getFinancialYear(tx.date);
    const acct = tx.account || 'Unassigned';
    const invKey = `${acct}__${tx.stock}`;

    if (!fyRealized[fy]) fyRealized[fy] = { sellProceeds: 0, costBasis: 0, gain: 0 };
    if (!rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] = 0;

    const amt = Number(tx.amount || 0);
    const qty = Number(tx.qty || 0);
    const price = Number(tx.price || 0);
    let cashIn = 0;
    let cashOut = 0;

    switch (tx.type) {
      case 'DEPOSIT':
        cashIn = amt;
        cashBalance += amt;
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] += amt;
        totalDeposits += amt;
        bankEntries.push({ 
          date: tx.date, 
          account: acct, 
          type: 'DEPOSIT', 
          deposit: amt, 
          withdrawal: 0, 
          corpus: totalDeposits - totalWithdrawals, 
          remarks: tx.remarks 
        });
        break;

      case 'WITHDRAWAL':
        cashOut = amt;
        cashBalance -= amt;
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] -= amt;
        totalWithdrawals += amt;
        bankEntries.push({ 
          date: tx.date, 
          account: acct, 
          type: 'WITHDRAWAL', 
          deposit: 0, 
          withdrawal: amt, 
          corpus: totalDeposits - totalWithdrawals, 
          remarks: tx.remarks 
        });
        break;

      case 'FEES':
        cashOut = amt;
        cashBalance -= amt;
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] -= amt;
        break;

      case 'BUY':
        cashOut = amt;
        cashBalance -= amt;
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] -= amt;
        if (!inventory[invKey]) inventory[invKey] = [];
        inventory[invKey].push({ 
          qty: qty, 
          price: price, 
          date: tx.date, 
          account: acct, 
          stock: tx.stock 
        });
        break;

      case 'BONUS':
        // Section 55(2)(aa): Cost of bonus shares is zero; date is the allotment date
        if (!inventory[invKey]) inventory[invKey] = [];
        inventory[invKey].push({
          qty: qty,
          price: 0,
          date: tx.date,
          account: acct,
          stock: tx.stock
        });
        break;

      case 'SPLIT':
        // Splits proportionally increase quantity and reduce purchase price per lot
        // Preserves original acquisition dates for tax holding duration
        if (inventory[invKey] && inventory[invKey].length > 0 && qty > 0 && price > 0) {
          const splitMultiplier = qty / price; // e.g., 10 / 1 = 10x
          inventory[invKey].forEach(lot => {
            lot.qty = lot.qty * splitMultiplier;
            lot.price = lot.price / splitMultiplier;
          });
        }
        break;

      case 'DEMERGER':
        // Demerger cost-apportionment: price represents the fraction of cost retained (e.g. 0.90 for 90%)
        // The spun-off stock is recorded separately as a BUY carrying the remaining cost fraction
        if (inventory[invKey] && inventory[invKey].length > 0 && price > 0) {
          inventory[invKey].forEach(lot => {
            lot.price = lot.price * price;
          });
        }
        break;

      case 'SELL': {
        cashIn = amt;
        cashBalance += amt;
        if (rawAccountCashMap.hasOwnProperty(acct)) rawAccountCashMap[acct] += amt;
        let qtyToSell = qty;
        const sellPrice = price;
        let costOfSoldShares = 0;

        if (inventory[invKey]) {
          while (qtyToSell > 0 && inventory[invKey].length > 0) {
            const oldestLot = inventory[invKey][0];
            const consumedQty = Math.min(qtyToSell, oldestLot.qty);
            const lotCost = consumedQty * oldestLot.price;
            const lotProceeds = consumedQty * sellPrice;
            const lotGain = lotProceeds - lotCost;

            const buyD = new Date(oldestLot.date);
            const sellD = new Date(tx.date);
            const diffTime = Math.abs(sellD - buyD);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const isLtcg = diffDays > 365;

            taxClosedLots.push({
              sellDate: tx.date,
              buyDate: oldestLot.date,
              account: acct,
              stock: tx.stock,
              qty: consumedQty,
              buyPrice: oldestLot.price,
              sellPrice: sellPrice,
              costBasis: lotCost,
              proceeds: lotProceeds,
              gain: lotGain,
              days: diffDays,
              isLtcg: isLtcg,
              fy: fy,
              quarter: getTaxQuarter(tx.date)
            });

            costOfSoldShares += lotCost;
            qtyToSell -= consumedQty;
            oldestLot.qty -= consumedQty;

            if (oldestLot.qty <= 0) {
              inventory[invKey].shift();
            }
          }
        }

        const realizedProceeds = qty * sellPrice;
        const realizedGain = realizedProceeds - costOfSoldShares;

        fyRealized[fy].sellProceeds += realizedProceeds;
        fyRealized[fy].costBasis += costOfSoldShares;
        fyRealized[fy].gain += realizedGain;

        if (!closedTradesMap[tx.stock]) {
          closedTradesMap[tx.stock] = { 
            stock: tx.stock, 
            totalQty: 0, 
            totalCostBasis: 0, 
            totalProceeds: 0, 
            netPnL: 0 
          };
        }
        closedTradesMap[tx.stock].totalQty += qty;
        closedTradesMap[tx.stock].totalCostBasis += costOfSoldShares;
        closedTradesMap[tx.stock].totalProceeds += realizedProceeds;
        closedTradesMap[tx.stock].netPnL += realizedGain;
        break;
      }
    }

    ledgerEntries.push({
      id: tx.id,
      date: tx.date,
      account: acct,
      type: tx.type,
      stock: tx.stock,
      qty: tx.qty,
      price: tx.price,
      cashOut,
      cashIn,
      runningCash: cashBalance,
      remarks: tx.remarks
    });
  });

  const openLots = [];
  const stockAggregateMap = {};

  Object.keys(inventory).forEach(key => {
    const lots = inventory[key];
    lots.forEach(lot => {
      if (lot.qty > 0) {
        openLots.push(lot);
        if (!stockAggregateMap[lot.stock]) {
          stockAggregateMap[lot.stock] = { totalQty: 0, totalCost: 0 };
        }
        stockAggregateMap[lot.stock].totalQty += lot.qty;
        stockAggregateMap[lot.stock].totalCost += (lot.qty * lot.price);
      }
    });
  });

  let totalPortfolioVal = 0;
  let totalPortfolioInvested = 0;

  Object.keys(stockAggregateMap).forEach(stock => {
    const item = stockAggregateMap[stock];
    if (item.totalQty > 0) {
      const wap = item.totalCost / item.totalQty;
      const liveData = marketPrices[stock] || savedManualPrices[stock] || { ltp: wap, prevClose: wap };
      totalPortfolioVal += (item.totalQty * liveData.ltp);
      totalPortfolioInvested += item.totalCost;
    }
  });

  const holdings = [];
  Object.keys(stockAggregateMap).forEach(stock => {
    const item = stockAggregateMap[stock];
    if (item.totalQty > 0) {
      const wap = item.totalCost / item.totalQty;
      const liveData = marketPrices[stock] || savedManualPrices[stock] || { ltp: wap, prevClose: wap };
      const ltp = liveData.ltp;

      const currentVal = item.totalQty * ltp;
      const investedVal = item.totalCost;
      const pnlVal = currentVal - investedVal;
      const pnlPct = investedVal > 0 ? (pnlVal / investedVal) * 100 : 0;
      const weightPct = totalPortfolioVal > 0 ? (currentVal / totalPortfolioVal) * 100 : 0;

      holdings.push({ 
        stock, 
        qty: item.totalQty, 
        wap, 
        ltp, 
        investedVal, 
        currentVal, 
        pnlVal, 
        pnlPct, 
        weightPct 
      });
    }
  });

  const totalUnrealizedPnL = totalPortfolioVal - totalPortfolioInvested;

  // Calibrated per-account cash (Raw Tagged Cash + Cash_Calibration Sheet Offset)
  const calibratedAccountCashMap = {};
  CALIB_ACCOUNTS.forEach(acct => {
    calibratedAccountCashMap[acct] = (rawAccountCashMap[acct] || 0) + getCalibOffset(acct);
  });

  const netInvested = totalDeposits - totalWithdrawals;
  const netWorth = totalPortfolioVal + cashBalance;
  const lifetimePnL = netWorth - netInvested;
  const lifetimePnLPct = netInvested > 0 ? (lifetimePnL / netInvested) * 100 : 0;
  const xirrValue = calculateXIRR(sortedTx, netWorth);

  const closedTrades = Object.values(closedTradesMap).map(c => ({
    ...c,
    retPct: c.totalCostBasis > 0 ? (c.netPnL / c.totalCostBasis) * 100 : 0
  }));

  return {
    cashBalance,
    rawAccountCashMap,
    accountCashMap: calibratedAccountCashMap,
    totalDeposits,
    totalWithdrawals,
    netInvested,
    totalPortfolioVal,
    totalPortfolioInvested,
    totalUnrealizedPnL,
    netWorth,
    lifetimePnL,
    lifetimePnLPct,
    xirrValue,
    holdings,
    openLots,
    fyRealized,
    closedTrades,
    ledgerEntries,
    bankEntries,
    taxClosedLots,
    sortedTx
  };
}

/* ---------------- NUMERICAL ROOT FINDING: XIRR ---------------- */
function calculateXIRR(sortedTx, terminalNetWorth) {
  const cashFlows = [];
  sortedTx.forEach(tx => {
    const d = new Date(tx.date);
    const amt = Number(tx.amount || 0);
    if (tx.type === 'DEPOSIT') cashFlows.push({ date: d, amount: -amt });
    else if (tx.type === 'WITHDRAWAL') cashFlows.push({ date: d, amount: amt });
  });

  if (terminalNetWorth > 0) cashFlows.push({ date: new Date(), amount: terminalNetWorth });
  if (cashFlows.length < 2) return 0;

  const d0 = cashFlows[0].date;
  function npv(r) { 
    return cashFlows.reduce((acc, c) => acc + c.amount / Math.pow(1 + r, (c.date - d0) / (365 * 86400000)), 0); 
  }
  function dNpv(r) {
    const msPerYear = 365 * 86400000;
    return cashFlows.reduce((acc, c) => {
      const t = (c.date - d0) / msPerYear;
      return acc - (t * c.amount) / Math.pow(1 + r, t + 1);
    }, 0);
  }

  let rate = 0.12;
  for (let i = 0; i < 40; i++) {
    const f = npv(rate);
    const df = dNpv(rate);
    if (Math.abs(df) < 1e-7) break;
    const next = rate - f / df;
    if (Math.abs(next - rate) < 1e-5) return next * 100;
    rate = next;
  }
  return isNaN(rate) ? 0 : rate * 100;
}
