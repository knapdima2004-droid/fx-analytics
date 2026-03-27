import * as XLSX from 'xlsx';
import type { OHLCBar } from '@/types';

interface Trade {
  type: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPips: number;
}

interface SimResult {
  trades: Trade[];
  equity: { time: string; balance: number }[];
  finalBalance: number;
  totalPnl: number;
  totalPnlPct: number;
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
}

interface ReportMeta {
  pair: string;
  timeframe: string;
  strategy: string;
  strategyDesc: string;
  initialBalance: number;
  lotSize: string;
  afStep: number;
  afMax: number;
  dateRange: string;
  generatedAt: string;
}

/* ── Excel Export ─────────────────────────────────────────────── */

export function exportExcel(result: SimResult, meta: ReportMeta, ohlcData?: OHLCBar[]): void {
  const wb = XLSX.utils.book_new();

  addDashboard(wb, result, meta);
  addConfiguration(wb, meta);
  addPerformance(wb, result, meta);
  addTradeHistory(wb, result, meta);
  addEquityCurve(wb, result, meta);
  addMonthly(wb, result);
  addTradeAnalysis(wb, result);
  addRiskAnalysis(wb, result, meta);
  if (ohlcData && ohlcData.length > 0) addPriceData(wb, ohlcData);
  addConclusion(wb, result, meta);

  const filename = `FX_Report_${meta.pair.replace('/', '')}_${meta.strategy.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/* ── Sheet 1: Dashboard ──────────────────────────────────────── */

function addDashboard(wb: XLSX.WorkBook, r: SimResult, meta: ReportMeta) {
  const d = [
    ['FX Analytics — Strategy Test Report'],
    [`${meta.pair} | ${meta.timeframe} | ${meta.strategy} | ${meta.dateRange} | Generated: ${meta.generatedAt}`],
    [],
    [r.totalTrades, r2(r.winRate) + '%', r2(r.profitFactor), r2(r.maxDrawdownPct) + '%',
     r.avgWin !== 0 && r.avgLoss !== 0 ? r2(Math.abs(r.avgWin / r.avgLoss)) : 'N/A',
     r2(r.totalPnlPct) + '%', '$' + r2(r.totalPnl), '$' + r2(r.finalBalance)],
    ['TOTAL TRADES', 'WIN RATE', 'PROFIT FACTOR', 'MAX DRAWDOWN', 'REWARD/RISK', 'RETURN %', 'NET P/L', 'FINAL BALANCE'],
    [],
    [],
    ['Trade #', 'Balance ($)'],
    ...r.equity.map((e, i) => [i, e.balance]),
    [],
    [],
    ['Month', 'P/L ($)', 'Trades', 'Win Rate (%)'],
  ];
  const monthlyMap = buildMonthly(r);
  Array.from(monthlyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([month, m]) => {
    d.push([month, r2(m.pnl), m.trades, r2(m.winRate)]);
  });
  const ws = XLSX.utils.aoa_to_sheet(d);
  ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Dashboard');
}

/* ── Sheet 2: Configuration ──────────────────────────────────── */

function addConfiguration(wb: XLSX.WorkBook, meta: ReportMeta) {
  const d = [
    ['Strategy Configuration'],
    [],
    ['Parameter', 'Value'],
    ['Currency Pair', meta.pair],
    ['Timeframe', meta.timeframe],
    ['Strategy', meta.strategy],
    ['Description', meta.strategyDesc],
    ['Date Range', meta.dateRange],
    ['Initial Balance', '$' + meta.initialBalance.toLocaleString()],
    ['Lot Size', meta.lotSize],
    [],
    ['Parabolic SAR Parameters'],
    [],
    ['Parameter', 'Value', 'Description'],
    ['AF Step (Acceleration Factor)', meta.afStep, 'Initial acceleration factor, added on each new extreme point'],
    ['AF Max', meta.afMax, 'Maximum acceleration factor cap'],
    [],
    ['Strategy Rules'],
    [],
    ['Rule', 'Description'],
  ];
  if (meta.strategy.includes('SAR') && !meta.strategy.includes('+')) {
    d.push(['Entry BUY', 'When SAR dots flip from above to below price (bullish reversal)']);
    d.push(['Entry SELL', 'When SAR dots flip from below to above price (bearish reversal)']);
    d.push(['Exit', 'On opposite SAR signal (always in market)']);
    d.push(['Filter', 'None — trades every signal']);
  } else if (meta.strategy.includes('SMA')) {
    d.push(['Trend Filter', 'SMA 200 (Simple Moving Average, 200 periods)']);
    d.push(['Entry BUY', 'SAR bullish flip AND price is above SMA 200 (uptrend confirmed)']);
    d.push(['Entry SELL', 'SAR bearish flip AND price is below SMA 200 (downtrend confirmed)']);
    d.push(['Filtered Signal', 'If SAR signal goes against SMA trend → close position but do NOT open new one']);
    d.push(['Rationale', 'SMA 200 filters out whipsaw signals in ranging/sideways markets']);
  } else if (meta.strategy.includes('ADX')) {
    d.push(['Trend Filter', 'ADX (Average Directional Index, period 14)']);
    d.push(['ADX Threshold', 'ADX > 25 required (strong trend confirmation)']);
    d.push(['Direction', 'DI+ > DI- = uptrend (BUY only), DI- > DI+ = downtrend (SELL only)']);
    d.push(['Entry BUY', 'SAR bullish flip AND ADX > 25 AND DI+ > DI-']);
    d.push(['Entry SELL', 'SAR bearish flip AND ADX > 25 AND DI- > DI+']);
    d.push(['Filtered Signal', 'If ADX < 25 (weak trend) → no new trades opened']);
    d.push(['Rationale', 'ADX eliminates trades during flat/ranging markets entirely']);
  }
  d.push([]);
  d.push(['Formula Reference']);
  d.push([]);
  d.push(['Indicator', 'Formula']);
  d.push(['Parabolic SAR', 'SAR(i) = SAR(i-1) + AF × (EP - SAR(i-1))']);
  d.push(['SMA(n)', 'SMA = (1/n) × Σ Close(i) for i = t-n+1 to t']);
  d.push(['ADX', 'ADX = Wilder smooth of DX; DX = |DI+ - DI-| / (DI+ + DI-) × 100']);
  d.push(['+DI / -DI', '+DI = smoothed(+DM) / ATR × 100; -DI = smoothed(-DM) / ATR × 100']);
  d.push(['P/L Calculation', 'P/L = direction × (exitPrice - entryPrice) × lotUnits']);
  d.push(['Pip Value', '1 pip = 0.0001 (major pairs), 0.01 (JPY pairs)']);

  const ws = XLSX.utils.aoa_to_sheet(d);
  ws['!cols'] = [{ wch: 30 }, { wch: 40 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Configuration');
}

/* ── Sheet 3: Performance ────────────────────────────────────── */

function addPerformance(wb: XLSX.WorkBook, r: SimResult, meta: ReportMeta) {
  const avgTradePnl = r.totalTrades > 0 ? r.totalPnl / r.totalTrades : 0;
  const avgHoldBars = r.trades.length > 0
    ? r.trades.reduce((sum, t) => {
        const e = parseTs(t.entryTime), x = parseTs(t.exitTime);
        return sum + (x - e);
      }, 0) / r.trades.length / 3600000
    : 0;

  const d = [
    ['Performance Summary'],
    [],
    ['RETURNS'],
    ['Metric', 'Value'],
    ['Initial Balance', '$' + meta.initialBalance.toLocaleString()],
    ['Final Balance', '$' + r2(r.finalBalance)],
    ['Net Profit/Loss', '$' + r2(r.totalPnl)],
    ['Return (%)', r2(r.totalPnlPct) + '%'],
    [],
    ['TRADE STATISTICS'],
    ['Metric', 'Value'],
    ['Total Trades', r.totalTrades],
    ['Winning Trades', r.wins],
    ['Losing Trades', r.losses],
    ['Win Rate', r2(r.winRate) + '%'],
    ['Average Trade P/L', '$' + r2(avgTradePnl)],
    ['Avg Holding Time', r2(avgHoldBars) + ' hours'],
    [],
    ['PROFIT METRICS'],
    ['Metric', 'Value'],
    ['Profit Factor', r.profitFactor === Infinity ? 'N/A (no losses)' : r2(r.profitFactor)],
    ['Average Win (pips)', '+' + r.avgWin],
    ['Average Loss (pips)', r.avgLoss.toString()],
    ['Best Trade (pips)', '+' + r.bestTrade],
    ['Worst Trade (pips)', r.worstTrade.toString()],
    ['Reward/Risk Ratio', r.avgLoss !== 0 ? r2(Math.abs(r.avgWin / r.avgLoss)) : 'N/A'],
    ['Expected Payoff (pips/trade)', r.totalTrades > 0 ? r2(r.trades.reduce((s, t) => s + t.pnlPips, 0) / r.totalTrades) : 0],
    [],
    ['RISK METRICS'],
    ['Metric', 'Value'],
    ['Max Drawdown (%)', r2(r.maxDrawdownPct) + '%'],
    ['Max Drawdown ($)', '$' + r2(computeMaxDrawdownDollar(r, meta.initialBalance))],
    ['Recovery Factor', r.maxDrawdownPct > 0 ? r2(Math.abs(r.totalPnlPct / r.maxDrawdownPct)) : 'N/A'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(d);
  ws['!cols'] = [{ wch: 28 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Performance');
}

/* ── Sheet 4: Trade History ──────────────────────────────────── */

function addTradeHistory(wb: XLSX.WorkBook, r: SimResult, meta: ReportMeta) {
  const header = ['#', 'Type', 'Entry Time', 'Exit Time', 'Entry Price', 'Exit Price',
    'P/L ($)', 'P/L (pips)', 'Cumulative P/L ($)', 'Balance ($)', 'Duration (h)'];
  const rows: (string | number)[][] = [];
  let cumPnl = 0;
  let bal = meta.initialBalance;
  r.trades.forEach((t, i) => {
    cumPnl += t.pnl;
    bal += t.pnl;
    const dur = (parseTs(t.exitTime) - parseTs(t.entryTime)) / 3600000;
    rows.push([
      i + 1, t.type, fmtTs(t.entryTime), fmtTs(t.exitTime),
      r5(t.entryPrice), r5(t.exitPrice),
      r2(t.pnl), t.pnlPips, r2(cumPnl), r2(bal), r2(dur),
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [
    { wch: 5 }, { wch: 6 }, { wch: 20 }, { wch: 20 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Trade History');
}

/* ── Sheet 5: Equity Curve ───────────────────────────────────── */

function addEquityCurve(wb: XLSX.WorkBook, r: SimResult, meta: ReportMeta) {
  const header = ['Trade #', 'Time', 'Balance ($)', 'Drawdown ($)', 'Drawdown (%)', 'P/L This Trade ($)'];
  const rows: (string | number)[][] = [];
  let peak = meta.initialBalance;
  let prevBal = meta.initialBalance;
  r.equity.forEach((e, i) => {
    if (e.balance > peak) peak = e.balance;
    const dd = peak - e.balance;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    rows.push([i, e.time, e.balance, r2(dd), r2(ddPct), r2(e.balance - prevBal)]);
    prevBal = e.balance;
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Equity Curve');
}

/* ── Sheet 6: Monthly Analysis ───────────────────────────────── */

function addMonthly(wb: XLSX.WorkBook, r: SimResult) {
  const monthlyMap = buildMonthly(r);
  const header = ['Month', 'P/L ($)', 'P/L (pips)', 'Trades', 'Wins', 'Losses', 'Win Rate (%)',
    'Avg Win (pips)', 'Avg Loss (pips)', 'Best (pips)', 'Worst (pips)', 'Profit Factor'];
  const rows = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => {
      const gp = m.winPips.reduce((a, b) => a + b, 0);
      const gl = Math.abs(m.lossPips.reduce((a, b) => a + b, 0));
      return [
        month, r2(m.pnl), r2(m.totalPips), m.trades, m.wins, m.trades - m.wins,
        r2(m.winRate),
        m.winPips.length > 0 ? r2(m.winPips.reduce((a, b) => a + b, 0) / m.winPips.length) : 0,
        m.lossPips.length > 0 ? r2(m.lossPips.reduce((a, b) => a + b, 0) / m.lossPips.length) : 0,
        m.best, m.worst,
        gl > 0 ? r2(gp / gl) : (gp > 0 ? '∞' : 0),
      ];
    });

  const totals = ['TOTAL', r2(r.totalPnl), r2(r.trades.reduce((s, t) => s + t.pnlPips, 0)),
    r.totalTrades, r.wins, r.losses, r2(r.winRate), r.avgWin, r.avgLoss, r.bestTrade, r.worstTrade,
    r.profitFactor === Infinity ? '∞' : r2(r.profitFactor)];

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows, [], totals]);
  ws['!cols'] = Array(12).fill({ wch: 13 });
  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Analysis');
}

/* ── Sheet 7: Trade Analysis ─────────────────────────────────── */

function addTradeAnalysis(wb: XLSX.WorkBook, r: SimResult) {
  const d: (string | number)[][] = [
    ['Trade Distribution Analysis'],
    [],
    ['P/L Distribution (pips)'],
    ['Metric', 'Value'],
  ];

  const pips = r.trades.map(t => t.pnlPips).sort((a, b) => a - b);
  if (pips.length > 0) {
    const mean = pips.reduce((a, b) => a + b, 0) / pips.length;
    const variance = pips.reduce((s, p) => s + (p - mean) ** 2, 0) / pips.length;
    const stddev = Math.sqrt(variance);
    d.push(['Mean', r2(mean)]);
    d.push(['Std Deviation', r2(stddev)]);
    d.push(['Median', r2(pips[Math.floor(pips.length / 2)])]);
    d.push(['Min', pips[0]]);
    d.push(['Max', pips[pips.length - 1]]);
    d.push(['P10', r2(pips[Math.floor(pips.length * 0.1)])]);
    d.push(['P25', r2(pips[Math.floor(pips.length * 0.25)])]);
    d.push(['P75', r2(pips[Math.floor(pips.length * 0.75)])]);
    d.push(['P90', r2(pips[Math.floor(pips.length * 0.9)])]);
    d.push(['Skewness', r2(computeSkewness(pips))]);
    d.push(['Kurtosis', r2(computeKurtosis(pips))]);
  }

  d.push([]);
  d.push(['Consecutive Wins/Losses']);
  d.push(['Metric', 'Value']);

  const { maxConsecWins, maxConsecLosses, avgConsecWins, avgConsecLosses } = computeStreaks(r.trades);
  d.push(['Max Consecutive Wins', maxConsecWins]);
  d.push(['Max Consecutive Losses', maxConsecLosses]);
  d.push(['Avg Consecutive Wins', r2(avgConsecWins)]);
  d.push(['Avg Consecutive Losses', r2(avgConsecLosses)]);

  d.push([]);
  d.push(['BUY vs SELL Breakdown']);
  d.push(['Type', 'Trades', 'Wins', 'Losses', 'Win Rate (%)', 'Total P/L ($)', 'Avg P/L (pips)']);
  const buys = r.trades.filter(t => t.type === 'BUY');
  const sells = r.trades.filter(t => t.type === 'SELL');
  const buyWins = buys.filter(t => t.pnl > 0).length;
  const sellWins = sells.filter(t => t.pnl > 0).length;
  d.push(['BUY', buys.length, buyWins, buys.length - buyWins,
    buys.length > 0 ? r2((buyWins / buys.length) * 100) : 0,
    r2(buys.reduce((s, t) => s + t.pnl, 0)),
    buys.length > 0 ? r2(buys.reduce((s, t) => s + t.pnlPips, 0) / buys.length) : 0]);
  d.push(['SELL', sells.length, sellWins, sells.length - sellWins,
    sells.length > 0 ? r2((sellWins / sells.length) * 100) : 0,
    r2(sells.reduce((s, t) => s + t.pnl, 0)),
    sells.length > 0 ? r2(sells.reduce((s, t) => s + t.pnlPips, 0) / sells.length) : 0]);

  d.push([]);
  d.push(['P/L Histogram (pips ranges)']);
  d.push(['Range', 'Count', 'Percentage (%)']);
  const ranges = [
    ['-∞', -50], [-50, -30], [-30, -20], [-20, -10], [-10, 0],
    [0, 10], [10, 20], [20, 30], [30, 50], [50, '∞'],
  ] as const;
  ranges.forEach(([lo, hi]) => {
    const count = pips.filter(p => {
      const above = lo === '-∞' ? true : p >= (lo as number);
      const below = hi === '∞' ? true : p < (hi as number);
      return above && below;
    }).length;
    d.push([`${lo} to ${hi}`, count, pips.length > 0 ? r2((count / pips.length) * 100) : 0]);
  });

  const ws = XLSX.utils.aoa_to_sheet(d);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Trade Analysis');
}

/* ── Sheet 8: Risk Analysis ──────────────────────────────────── */

function addRiskAnalysis(wb: XLSX.WorkBook, r: SimResult, meta: ReportMeta) {
  const d: (string | number)[][] = [
    ['Risk Analysis'],
    [],
    ['Drawdown Analysis'],
    ['Metric', 'Value'],
    ['Max Drawdown (%)', r2(r.maxDrawdownPct) + '%'],
    ['Max Drawdown ($)', '$' + r2(computeMaxDrawdownDollar(r, meta.initialBalance))],
    ['Recovery Factor', r.maxDrawdownPct > 0 ? r2(Math.abs(r.totalPnlPct / r.maxDrawdownPct)) : 'N/A'],
  ];

  const drawdowns = computeDrawdownPeriods(r, meta.initialBalance);
  if (drawdowns.length > 0) {
    d.push([]);
    d.push(['Top 5 Drawdown Periods']);
    d.push(['#', 'Peak Balance', 'Trough Balance', 'Drawdown ($)', 'Drawdown (%)', 'Start Trade #', 'End Trade #', 'Duration (trades)']);
    drawdowns.slice(0, 5).forEach((dd, i) => {
      d.push([i + 1, r2(dd.peak), r2(dd.trough), r2(dd.drawdown), r2(dd.drawdownPct) + '%',
        dd.startIdx, dd.endIdx, dd.endIdx - dd.startIdx]);
    });
  }

  d.push([]);
  d.push(['P/L Volatility']);
  const pnls = r.trades.map(t => t.pnl);
  if (pnls.length > 1) {
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
    const stddev = Math.sqrt(variance);
    d.push(['Metric', 'Value']);
    d.push(['Avg P/L per trade ($)', '$' + r2(mean)]);
    d.push(['Std Dev of P/L ($)', '$' + r2(stddev)]);
    d.push(['Sharpe-like Ratio (mean/stddev)', stddev > 0 ? r2(mean / stddev) : 'N/A']);
  }

  d.push([]);
  d.push(['Equity High-Water Marks']);
  d.push(['Trade #', 'Balance ($)', 'Is New High', 'Drawdown from Peak (%)']);
  let peak = meta.initialBalance;
  r.equity.forEach((e, i) => {
    const isNew = e.balance > peak;
    if (isNew) peak = e.balance;
    const dd = peak > 0 ? ((peak - e.balance) / peak) * 100 : 0;
    d.push([i, r2(e.balance), isNew ? 'YES' : '', r2(dd) + '%']);
  });

  const ws = XLSX.utils.aoa_to_sheet(d);
  ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Risk Analysis');
}

/* ── Sheet 9: Price Data ─────────────────────────────────────── */

function addPriceData(wb: XLSX.WorkBook, ohlc: OHLCBar[]) {
  const header = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume', 'Change', 'Change (%)', 'Log Return', 'Range (H-L)'];
  const rows = ohlc.map((b, i) => {
    const prev = i > 0 ? ohlc[i - 1].close : b.close;
    const change = b.close - prev;
    const changePct = prev !== 0 ? (change / prev) * 100 : 0;
    const logRet = prev > 0 && b.close > 0 ? Math.log(b.close / prev) : 0;
    return [
      fmtTs(b.time), r5(b.open), r5(b.high), r5(b.low), r5(b.close),
      b.volume || '', r5(change), r2(changePct) + '%', r2(logRet * 100) + '%', r5(b.high - b.low),
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Price Data');
}

/* ── Sheet 10: Conclusion ────────────────────────────────────── */

function addConclusion(wb: XLSX.WorkBook, r: SimResult, meta: ReportMeta) {
  const verdict = r.profitFactor >= 1.5 ? 'Strong' : r.profitFactor >= 1.0 ? 'Moderate' : r.profitFactor >= 0.8 ? 'Weak' : 'Unprofitable';
  const rrRatio = r.avgLoss !== 0 ? Math.abs(r.avgWin / r.avgLoss) : 0;
  const expectancy = r.totalTrades > 0 ? r.trades.reduce((s, t) => s + t.pnlPips, 0) / r.totalTrades : 0;

  const d: (string | number)[][] = [
    ['Conclusion'],
    [],
    ['Key Findings'],
    ['•', `Strategy: ${meta.strategy} on ${meta.pair} (${meta.timeframe})`],
    ['•', `Period analyzed: ${meta.dateRange}`],
    ['•', `Total trades executed: ${r.totalTrades}`],
    ['•', `Net result: $${r2(r.totalPnl)} (${r2(r.totalPnlPct)}%)`],
    ['•', `Win rate: ${r2(r.winRate)}% (${r.wins}W / ${r.losses}L)`],
    ['•', `Profit Factor: ${r.profitFactor === Infinity ? '∞' : r2(r.profitFactor)}`],
    ['•', `Max Drawdown: ${r2(r.maxDrawdownPct)}%`],
    ['•', `Reward/Risk ratio: ${r2(rrRatio)}`],
    ['•', `Expected payoff per trade: ${r2(expectancy)} pips`],
    [],
    ['Strategy Assessment'],
    ['Metric', 'Value', 'Rating'],
    ['Profitability', r.totalPnl >= 0 ? 'Profitable' : 'Unprofitable', r.totalPnl >= 0 ? 'PASS' : 'FAIL'],
    ['Win Rate', r2(r.winRate) + '%', r.winRate >= 50 ? 'Good' : r.winRate >= 40 ? 'Fair' : 'Poor'],
    ['Profit Factor', r.profitFactor === Infinity ? '∞' : r2(r.profitFactor), r.profitFactor >= 1.5 ? 'Good' : r.profitFactor >= 1 ? 'Fair' : 'Poor'],
    ['Risk/Reward', r2(rrRatio), rrRatio >= 2 ? 'Good' : rrRatio >= 1 ? 'Fair' : 'Poor'],
    ['Max Drawdown', r2(r.maxDrawdownPct) + '%', r.maxDrawdownPct <= 10 ? 'Good' : r.maxDrawdownPct <= 20 ? 'Fair' : 'Poor'],
    ['Expectancy', r2(expectancy) + ' pips', expectancy > 0 ? 'Positive' : 'Negative'],
    [],
    ['Overall Verdict', verdict],
    [],
    ['Notes'],
    ['•', 'Past performance does not guarantee future results.'],
    ['•', 'Strategy was tested on historical data; live trading may differ due to slippage, spread, and latency.'],
    ['•', 'Consider combining with other filters or risk management rules for improved results.'],
    ['•', r.winRate < 40 ? 'Low win rate may be compensated by high reward/risk ratio (trend-following characteristic).' : 'Win rate is within acceptable range for this strategy type.'],
    [],
    ['Report generated by FX Analytics'],
    ['Generated', meta.generatedAt],
  ];
  const ws = XLSX.utils.aoa_to_sheet(d);
  ws['!cols'] = [{ wch: 20 }, { wch: 50 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Conclusion');
}

/* ── HTML Export ──────────────────────────────────────────────── */

export function exportHTML(result: SimResult, meta: ReportMeta): void {
  const pnlColor = result.totalPnl >= 0 ? '#22c55e' : '#ef4444';
  const wrColor = result.winRate >= 50 ? '#22c55e' : '#ef4444';
  const rrRatio = result.avgLoss !== 0 ? r2(Math.abs(result.avgWin / result.avgLoss)) : 'N/A';

  let runBal = meta.initialBalance;
  const tradeRows = result.trades.map((t, i) => {
    runBal += t.pnl;
    const c = t.pnl >= 0 ? '#22c55e' : '#ef4444';
    return `<tr>
      <td>${i + 1}</td>
      <td style="color:${t.type === 'BUY' ? '#22c55e' : '#ef4444'};font-weight:600">${t.type}</td>
      <td>${fmtTs(t.entryTime)}</td><td>${fmtTs(t.exitTime)}</td>
      <td>${r5(t.entryPrice)}</td><td>${r5(t.exitPrice)}</td>
      <td style="color:${c};font-weight:600">${t.pnl >= 0 ? '+' : ''}${r2(t.pnl)}</td>
      <td style="color:${c}">${t.pnlPips}p</td>
      <td>${r2(runBal)}</td>
    </tr>`;
  }).join('');

  const monthlyMap = buildMonthly(result);
  const monthlyRows = Array.from(monthlyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
    const c = m.pnl >= 0 ? '#22c55e' : '#ef4444';
    return `<tr><td>${month}</td><td style="color:${c};font-weight:600">${m.pnl >= 0 ? '+' : ''}$${r2(m.pnl)}</td><td>${m.trades}</td><td>${r2(m.winRate)}%</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FX Analytics Report — ${meta.pair} ${meta.strategy}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px;line-height:1.5}
  h1{font-size:20px;margin-bottom:4px;color:#58a6ff}
  h2{font-size:14px;text-transform:uppercase;color:#8b949e;letter-spacing:1px;margin:24px 0 8px;border-bottom:1px solid #21262d;padding-bottom:4px}
  .sub{color:#8b949e;font-size:12px;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-width:800px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:12px}
  .card .l{font-size:10px;color:#8b949e;text-transform:uppercase}.card .v{font-size:18px;font-weight:700;font-family:'SF Mono',Consolas,monospace;margin-top:2px}
  .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;max-width:900px}
  .stat{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px}.stat .l{font-size:9px;color:#8b949e;text-transform:uppercase}.stat .v{font-size:13px;font-weight:600;font-family:monospace}
  table{width:100%;border-collapse:collapse;font-size:11px;font-family:monospace;margin-top:8px}
  th{text-align:left;padding:6px 8px;background:#161b22;border-bottom:2px solid #21262d;color:#8b949e;font-size:9px;text-transform:uppercase}
  td{padding:5px 8px;border-bottom:1px solid #21262d}tr:hover td{background:#1c2128}
  .cg{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 24px;font-size:12px;max-width:500px}.cg .k{color:#8b949e}.cg .v{font-family:monospace}
  @media print{body{background:#fff;color:#000}th{background:#f0f0f0}td{border-color:#ddd}.card,.stat{border-color:#ddd;background:#f9f9f9}}
</style></head><body>
<h1>FX Analytics — Strategy Test Report</h1>
<p class="sub">${meta.pair} · ${meta.timeframe} · ${meta.strategy} · ${meta.dateRange}</p>
<h2>Performance</h2>
<div class="grid">
  <div class="card"><div class="l">Net P/L</div><div class="v" style="color:${pnlColor}">${result.totalPnl >= 0 ? '+' : ''}$${r2(result.totalPnl)}</div></div>
  <div class="card"><div class="l">Return</div><div class="v" style="color:${pnlColor}">${result.totalPnlPct >= 0 ? '+' : ''}${r2(result.totalPnlPct)}%</div></div>
  <div class="card"><div class="l">Final Balance</div><div class="v">$${r2(result.finalBalance)}</div></div>
  <div class="card"><div class="l">Win Rate</div><div class="v" style="color:${wrColor}">${r2(result.winRate)}%</div></div>
</div>
<h2>Statistics</h2>
<div class="stats">
  <div class="stat"><div class="l">Trades</div><div class="v">${result.totalTrades}</div></div>
  <div class="stat"><div class="l">Wins</div><div class="v" style="color:#22c55e">${result.wins}</div></div>
  <div class="stat"><div class="l">Losses</div><div class="v" style="color:#ef4444">${result.losses}</div></div>
  <div class="stat"><div class="l">Profit Factor</div><div class="v">${result.profitFactor === Infinity ? '∞' : r2(result.profitFactor)}</div></div>
  <div class="stat"><div class="l">Max DD</div><div class="v" style="color:#ef4444">${r2(result.maxDrawdownPct)}%</div></div>
  <div class="stat"><div class="l">Avg Win</div><div class="v" style="color:#22c55e">+${result.avgWin}p</div></div>
  <div class="stat"><div class="l">Avg Loss</div><div class="v" style="color:#ef4444">${result.avgLoss}p</div></div>
  <div class="stat"><div class="l">R/R Ratio</div><div class="v">${rrRatio}</div></div>
</div>
<h2>Monthly Breakdown</h2>
<table><thead><tr><th>Month</th><th>P/L</th><th>Trades</th><th>Win Rate</th></tr></thead><tbody>${monthlyRows}</tbody></table>
<h2>Trade History (${result.trades.length})</h2>
<table><thead><tr><th>#</th><th>Type</th><th>Entry</th><th>Exit</th><th>Entry Price</th><th>Exit Price</th><th>P/L ($)</th><th>P/L</th><th>Balance</th></tr></thead><tbody>${tradeRows}</tbody></table>
<p style="margin-top:24px;font-size:10px;color:#484f58;text-align:center">Generated by FX Analytics · ${meta.generatedAt}</p>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `FX_Report_${meta.pair.replace('/', '')}_${meta.strategy.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ── Utility functions ───────────────────────────────────────── */

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r5(n: number): number { return Math.round(n * 100000) / 100000; }

function parseTs(t: string): number {
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  return new Date(t).getTime();
}

function fmtTs(t: string): string {
  if (/^\d+$/.test(t)) {
    const d = new Date(Number(t) * 1000);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
  return t;
}

function extractMonth(time: string): string {
  if (/^\d+$/.test(time)) {
    const d = new Date(Number(time) * 1000);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  }
  return time.slice(0, 7);
}

interface MonthData {
  pnl: number; totalPips: number; trades: number; wins: number; winRate: number;
  winPips: number[]; lossPips: number[]; best: number; worst: number;
}

function buildMonthly(r: SimResult): Map<string, MonthData> {
  const map = new Map<string, MonthData>();
  r.trades.forEach(t => {
    const month = extractMonth(t.exitTime);
    const e = map.get(month) || { pnl: 0, totalPips: 0, trades: 0, wins: 0, winRate: 0, winPips: [], lossPips: [], best: -Infinity, worst: Infinity };
    e.pnl += t.pnl;
    e.totalPips += t.pnlPips;
    e.trades += 1;
    if (t.pnl > 0) { e.wins += 1; e.winPips.push(t.pnlPips); }
    else e.lossPips.push(t.pnlPips);
    if (t.pnlPips > e.best) e.best = t.pnlPips;
    if (t.pnlPips < e.worst) e.worst = t.pnlPips;
    e.winRate = (e.wins / e.trades) * 100;
    map.set(month, e);
  });
  return map;
}

function computeMaxDrawdownDollar(r: SimResult, initialBal: number): number {
  let peak = initialBal, maxDD = 0, running = initialBal;
  for (const t of r.trades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeDrawdownPeriods(r: SimResult, initialBal: number) {
  const periods: { peak: number; trough: number; drawdown: number; drawdownPct: number; startIdx: number; endIdx: number }[] = [];
  let peak = initialBal, running = initialBal, inDD = false, ddStart = 0, trough = initialBal;
  r.equity.forEach((e, i) => {
    if (e.balance > peak) {
      if (inDD) {
        periods.push({ peak, trough, drawdown: peak - trough, drawdownPct: ((peak - trough) / peak) * 100, startIdx: ddStart, endIdx: i });
        inDD = false;
      }
      peak = e.balance;
      trough = e.balance;
    } else {
      if (!inDD) { inDD = true; ddStart = i; trough = e.balance; }
      if (e.balance < trough) trough = e.balance;
    }
    running = e.balance;
  });
  if (inDD) periods.push({ peak, trough, drawdown: peak - trough, drawdownPct: ((peak - trough) / peak) * 100, startIdx: ddStart, endIdx: r.equity.length - 1 });
  return periods.sort((a, b) => b.drawdownPct - a.drawdownPct);
}

function computeStreaks(trades: Trade[]) {
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  const wStreaks: number[] = [], lStreaks: number[] = [];
  trades.forEach(t => {
    if (t.pnl > 0) {
      if (curL > 0) lStreaks.push(curL);
      curW++; curL = 0; if (curW > maxW) maxW = curW;
    } else {
      if (curW > 0) wStreaks.push(curW);
      curL++; curW = 0; if (curL > maxL) maxL = curL;
    }
  });
  if (curW > 0) wStreaks.push(curW);
  if (curL > 0) lStreaks.push(curL);
  return {
    maxConsecWins: maxW, maxConsecLosses: maxL,
    avgConsecWins: wStreaks.length > 0 ? wStreaks.reduce((a, b) => a + b, 0) / wStreaks.length : 0,
    avgConsecLosses: lStreaks.length > 0 ? lStreaks.reduce((a, b) => a + b, 0) / lStreaks.length : 0,
  };
}

function computeSkewness(arr: number[]): number {
  const n = arr.length;
  if (n < 3) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const m2 = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const m3 = arr.reduce((s, x) => s + (x - mean) ** 3, 0) / n;
  const s = Math.sqrt(m2);
  return s > 0 ? m3 / (s ** 3) : 0;
}

function computeKurtosis(arr: number[]): number {
  const n = arr.length;
  if (n < 4) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const m2 = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const m4 = arr.reduce((s, x) => s + (x - mean) ** 4, 0) / n;
  return m2 > 0 ? m4 / (m2 ** 2) - 3 : 0;
}
