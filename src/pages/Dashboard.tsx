import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOhlc, isForexMarketOpen } from '@/hooks/useApi';
import { useGlobalState, CURRENCY_PAIRS } from '@/hooks/useGlobalState';
import { CandlestickChart, type DrawingTool } from '@/components/charts/CandlestickChart';
import { computeSMA, computeEMA, computeRSI, computeMACD, computeParabolicSAR, computeADX, computeATR } from '@/utils/indicators';
import { useReportStore } from '@/hooks/useReportStore';
import {
  Star, TrendingUp, Minus, MousePointer2, Hand,
  LineChart as LineChartIcon,
  Activity, BarChart3,
  Maximize2, Minimize2, MoveUpRight, Trash2, GitBranch, Camera,
  Play, RotateCcw, Settings2, FileSpreadsheet, FileText, ExternalLink, Clock, FolderOpen, X,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip as RTooltip, Area, AreaChart } from 'recharts';
import { toast } from 'sonner';
import { exportExcel, exportHTML } from '@/utils/reportExport';
import type { OHLCBar, Timeframe } from '@/types';

/* ── Strategy Simulation ─────────────────────────────────────── */

interface SimTrade {
  type: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPips: number;
}

interface SimResult {
  trades: SimTrade[];
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

type StrategyId = 'sar' | 'sar_sma' | 'sar_adx' | 'sar_composite' | 'adaptive_hybrid';

const STRATEGIES: { id: StrategyId; label: string; desc: string }[] = [
  { id: 'sar',             label: 'Parabolic SAR',     desc: 'Pure SAR — trade every reversal signal' },
  { id: 'sar_sma',         label: 'SAR + SMA 200',     desc: 'SAR with SMA 200 trend filter: BUY only above SMA, SELL only below' },
  { id: 'sar_adx',         label: 'SAR + ADX',         desc: 'SAR with ADX > 25 trend strength filter and DI+/DI− confirmation' },
  { id: 'sar_composite',   label: 'SAR Composite',     desc: 'Confluence scoring (SMA+ADX+MACD+RSI) ≥ 2/4 + ATR 2.5× trailing stop' },
  { id: 'adaptive_hybrid', label: 'Adaptive Hybrid',   desc: 'Regime switching: EMA crossover in trends (ADX≥25) + RSI mean reversion in ranges (ADX≤20) + spread modeling' },
];

/**
 * Generates SAR flip signals: +1 = bullish flip (BUY), -1 = bearish flip (SELL).
 * Returns sparse array aligned with data index.
 */
function getSarSignals(data: OHLCBar[], afStep: number, afMax: number): (1 | -1 | 0)[] {
  const sarVals = computeParabolicSAR(
    data.map(b => b.high), data.map(b => b.low), data.map(b => b.close), afStep, afMax,
  );
  const signals: (1 | -1 | 0)[] = new Array(data.length).fill(0);
  for (let i = 1; i < data.length; i++) {
    if (sarVals[i] == null || sarVals[i - 1] == null) continue;
    const below = sarVals[i]! < data[i].close;
    const prevBelow = sarVals[i - 1]! < data[i - 1].close;
    if (below && !prevBelow) signals[i] = 1;
    else if (!below && prevBelow) signals[i] = -1;
  }
  return signals;
}

function buildStats(trades: SimTrade[], initialBalance: number, data: OHLCBar[]) {
  let balance = initialBalance;
  for (const t of trades) balance += t.pnl;
  const wins = trades.filter(t => t.pnl > 0).length;
  const losses = trades.filter(t => t.pnl <= 0).length;
  const totalPnl = balance - initialBalance;

  const equity: { time: string; balance: number }[] = [{ time: fmtTime(data[0].time), balance: initialBalance }];
  let peak = initialBalance, maxDD = 0, running = initialBalance;
  for (const t of trades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = (peak - running) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    equity.push({ time: fmtTime(t.exitTime), balance: Math.round(running * 100) / 100 });
  }
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const winPnls = trades.filter(t => t.pnl > 0).map(t => t.pnlPips);
  const lossPnls = trades.filter(t => t.pnl < 0).map(t => t.pnlPips);

  return {
    trades, equity, finalBalance: balance, totalPnl,
    totalPnlPct: (totalPnl / initialBalance) * 100,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    totalTrades: trades.length, wins, losses,
    maxDrawdownPct: Math.round(maxDD * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? Infinity : 0,
    avgWin: winPnls.length > 0 ? Math.round(winPnls.reduce((a, b) => a + b, 0) / winPnls.length * 10) / 10 : 0,
    avgLoss: lossPnls.length > 0 ? Math.round(lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length * 10) / 10 : 0,
    bestTrade: trades.length > 0 ? Math.round(Math.max(...trades.map(t => t.pnlPips)) * 10) / 10 : 0,
    worstTrade: trades.length > 0 ? Math.round(Math.min(...trades.map(t => t.pnlPips)) * 10) / 10 : 0,
  };
}

function runStrategy(
  strategy: StrategyId, data: OHLCBar[], initialBalance: number,
  lotUnits: number, afStep: number, afMax: number,
): SimResult {
  const avgPrice = data.reduce((s, b) => s + b.close, 0) / data.length;
  const pipSize = avgPrice > 10 ? 0.01 : 0.0001;
  const sarSignals = getSarSignals(data, afStep, afMax);

  if (strategy === 'sar_composite') {
    return runCompositeStrategy(data, initialBalance, lotUnits, pipSize, sarSignals, afStep, afMax);
  }
  if (strategy === 'adaptive_hybrid') {
    return runAdaptiveHybrid(data, initialBalance, lotUnits, pipSize);
  }

  let trendFilter: ((i: number) => 'up' | 'down' | 'flat') | null = null;

  if (strategy === 'sar_sma') {
    const closes = data.map(b => b.close);
    const sma200 = computeSMA(closes, 200);
    trendFilter = (i: number) => {
      const sv = sma200[i];
      if (sv == null) return 'flat';
      return data[i].close > sv ? 'up' : 'down';
    };
  } else if (strategy === 'sar_adx') {
    const { adx, plusDI, minusDI } = computeADX(
      data.map(b => b.high), data.map(b => b.low), data.map(b => b.close), 14,
    );
    trendFilter = (i: number) => {
      const a = adx[i], p = plusDI[i], m = minusDI[i];
      if (a == null || p == null || m == null) return 'flat';
      if (a < 25) return 'flat';
      return p > m ? 'up' : 'down';
    };
  }

  const trades: SimTrade[] = [];
  let balance = initialBalance;
  let pos: { type: 'BUY' | 'SELL'; price: number; time: string } | null = null;

  const closeTrade = (exitPrice: number, exitTime: string) => {
    if (!pos) return;
    const dir = pos.type === 'BUY' ? 1 : -1;
    const pnlPips = dir * (exitPrice - pos.price) / pipSize;
    const pnl = pnlPips * pipSize * lotUnits;
    trades.push({
      type: pos.type, entryTime: pos.time, exitTime,
      entryPrice: pos.price, exitPrice, pnl,
      pnlPips: Math.round(pnlPips * 10) / 10,
    });
    balance += pnl;
    pos = null;
  };

  for (let i = 1; i < data.length; i++) {
    const sig = sarSignals[i];
    if (sig === 0) continue;

    const trend = trendFilter ? trendFilter(i) : null;

    if (sig === 1) {
      if (trendFilter && trend !== 'up') {
        if (pos) closeTrade(data[i].close, data[i].time);
        continue;
      }
      closeTrade(data[i].close, data[i].time);
      pos = { type: 'BUY', price: data[i].close, time: data[i].time };
    } else {
      if (trendFilter && trend !== 'down') {
        if (pos) closeTrade(data[i].close, data[i].time);
        continue;
      }
      closeTrade(data[i].close, data[i].time);
      pos = { type: 'SELL', price: data[i].close, time: data[i].time };
    }
  }
  if (pos) closeTrade(data[data.length - 1].close, data[data.length - 1].time);
  return buildStats(trades, initialBalance, data);
}

function runCompositeStrategy(
  data: OHLCBar[], initialBalance: number, lotUnits: number,
  pipSize: number, sarSignals: number[], _afStep: number, _afMax: number,
): SimResult {
  const closes = data.map(b => b.close);
  const highs = data.map(b => b.high);
  const lows = data.map(b => b.low);

  const sma100 = computeSMA(closes, 100);
  const { adx, plusDI, minusDI } = computeADX(highs, lows, closes, 14);
  const rsi14 = computeRSI(closes, 14);
  const { histogram: macdHist } = computeMACD(closes, 12, 26, 9);
  const atr14 = computeATR(highs, lows, closes, 14);

  const ATR_MULT = 2.5;
  const MIN_SCORE = 2;

  const trades: SimTrade[] = [];
  let balance = initialBalance;
  let pos: { type: 'BUY' | 'SELL'; price: number; time: string; stop: number } | null = null;

  const closeTrade = (exitPrice: number, exitTime: string) => {
    if (!pos) return;
    const dir = pos.type === 'BUY' ? 1 : -1;
    const pnlPips = dir * (exitPrice - pos.price) / pipSize;
    const pnl = pnlPips * pipSize * lotUnits;
    trades.push({
      type: pos.type, entryTime: pos.time, exitTime,
      entryPrice: pos.price, exitPrice, pnl,
      pnlPips: Math.round(pnlPips * 10) / 10,
    });
    balance += pnl;
    pos = null;
  };

  for (let i = 1; i < data.length; i++) {
    const atrVal = atr14[i];

    /* --- ATR trailing stop: update & check every bar --- */
    if (pos && atrVal != null) {
      if (pos.type === 'BUY') {
        const newStop = data[i].close - ATR_MULT * atrVal;
        if (newStop > pos.stop) pos.stop = newStop;
        if (data[i].low <= pos.stop) { closeTrade(pos.stop, data[i].time); continue; }
      } else {
        const newStop = data[i].close + ATR_MULT * atrVal;
        if (newStop < pos.stop) pos.stop = newStop;
        if (data[i].high >= pos.stop) { closeTrade(pos.stop, data[i].time); continue; }
      }
    }

    const sig = sarSignals[i];
    if (sig === 0) continue;
    if (atrVal == null) continue;

    /* --- Confluence scoring: each filter adds +1 --- */
    const isBuy = sig === 1;
    let score = 0;

    const smaVal = sma100[i];
    if (smaVal != null) {
      if (isBuy ? data[i].close > smaVal : data[i].close < smaVal) score++;
    }

    const adxVal = adx[i]; const pDI = plusDI[i]; const mDI = minusDI[i];
    if (adxVal != null && pDI != null && mDI != null && adxVal >= 20) {
      if (isBuy ? pDI > mDI : mDI > pDI) score++;
    }

    const rsiVal = rsi14[i];
    if (rsiVal != null) {
      if (isBuy ? rsiVal < 70 : rsiVal > 30) score++;
    }

    const macdVal = macdHist[i];
    if (macdVal != null) {
      if (isBuy ? macdVal > 0 : macdVal < 0) score++;
    }

    if (score >= MIN_SCORE) {
      closeTrade(data[i].close, data[i].time);
      pos = {
        type: isBuy ? 'BUY' : 'SELL',
        price: data[i].close, time: data[i].time,
        stop: isBuy
          ? data[i].close - ATR_MULT * atrVal
          : data[i].close + ATR_MULT * atrVal,
      };
    } else if (pos && ((isBuy && pos.type === 'SELL') || (!isBuy && pos.type === 'BUY'))) {
      closeTrade(data[i].close, data[i].time);
    }
  }
  if (pos) closeTrade(data[data.length - 1].close, data[data.length - 1].time);
  return buildStats(trades, initialBalance, data);
}

function runAdaptiveHybrid(
  data: OHLCBar[], initialBalance: number, lotUnits: number, pipSize: number,
): SimResult {
  const closes = data.map(b => b.close);
  const highs = data.map(b => b.high);
  const lows = data.map(b => b.low);

  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const { adx, plusDI, minusDI } = computeADX(highs, lows, closes, 14);
  const rsi14 = computeRSI(closes, 14);
  const atr14 = computeATR(highs, lows, closes, 14);

  const SPREAD_PIPS = 1.5;
  const spreadCost = SPREAD_PIPS * pipSize * lotUnits;

  const trades: SimTrade[] = [];
  let balance = initialBalance;
  let pos: {
    type: 'BUY' | 'SELL'; price: number; time: string;
    stop: number; mode: 'trend' | 'reversion';
  } | null = null;

  const closeTrade = (exitPrice: number, exitTime: string) => {
    if (!pos) return;
    const dir = pos.type === 'BUY' ? 1 : -1;
    const rawPips = dir * (exitPrice - pos.price) / pipSize;
    const pnlPips = rawPips - SPREAD_PIPS;
    const pnl = pnlPips * pipSize * lotUnits;
    trades.push({
      type: pos.type, entryTime: pos.time, exitTime,
      entryPrice: pos.price, exitPrice, pnl,
      pnlPips: Math.round(pnlPips * 10) / 10,
    });
    balance += pnl;
    pos = null;
  };

  for (let i = 1; i < data.length; i++) {
    const atrVal = atr14[i];
    const adxVal = adx[i];
    const rsiVal = rsi14[i];
    const eFast = ema20[i];
    const eSlow = ema50[i];
    const eFastPrev = ema20[i - 1];
    const eSlowPrev = ema50[i - 1];

    if (atrVal == null || adxVal == null) continue;

    /* --- Manage existing position --- */
    if (pos) {
      if (pos.mode === 'trend') {
        if (pos.type === 'BUY') {
          const newStop = data[i].close - 2.0 * atrVal;
          if (newStop > pos.stop) pos.stop = newStop;
          if (data[i].low <= pos.stop) { closeTrade(pos.stop, data[i].time); continue; }
          if (eFast != null && eSlow != null && eFast < eSlow) {
            closeTrade(data[i].close, data[i].time); continue;
          }
        } else {
          const newStop = data[i].close + 2.0 * atrVal;
          if (newStop < pos.stop) pos.stop = newStop;
          if (data[i].high >= pos.stop) { closeTrade(pos.stop, data[i].time); continue; }
          if (eFast != null && eSlow != null && eFast > eSlow) {
            closeTrade(data[i].close, data[i].time); continue;
          }
        }
      } else {
        if (rsiVal != null) {
          if (pos.type === 'BUY' && rsiVal >= 45) { closeTrade(data[i].close, data[i].time); continue; }
          if (pos.type === 'SELL' && rsiVal <= 55) { closeTrade(data[i].close, data[i].time); continue; }
        }
        if (pos.type === 'BUY' && data[i].low <= pos.stop) { closeTrade(pos.stop, data[i].time); continue; }
        if (pos.type === 'SELL' && data[i].high >= pos.stop) { closeTrade(pos.stop, data[i].time); continue; }
      }
      continue;
    }

    /* --- No position: look for entries --- */
    if (eFast == null || eSlow == null || eFastPrev == null || eSlowPrev == null || rsiVal == null) continue;

    if (adxVal >= 25) {
      /* ── TREND MODE: EMA 20/50 crossover ── */
      const pDI = plusDI[i], mDI = minusDI[i];
      const crossUp = eFastPrev <= eSlowPrev && eFast > eSlow;
      const crossDown = eFastPrev >= eSlowPrev && eFast < eSlow;

      if (crossUp && pDI != null && mDI != null && pDI > mDI && rsiVal < 70) {
        pos = {
          type: 'BUY', price: data[i].close, time: data[i].time,
          stop: data[i].close - 2.0 * atrVal, mode: 'trend',
        };
      } else if (crossDown && pDI != null && mDI != null && mDI > pDI && rsiVal > 30) {
        pos = {
          type: 'SELL', price: data[i].close, time: data[i].time,
          stop: data[i].close + 2.0 * atrVal, mode: 'trend',
        };
      }
    } else if (adxVal <= 20) {
      /* ── MEAN REVERSION MODE: RSI extremes ── */
      if (rsiVal <= 30) {
        pos = {
          type: 'BUY', price: data[i].close, time: data[i].time,
          stop: data[i].close - 1.5 * atrVal, mode: 'reversion',
        };
      } else if (rsiVal >= 70) {
        pos = {
          type: 'SELL', price: data[i].close, time: data[i].time,
          stop: data[i].close + 1.5 * atrVal, mode: 'reversion',
        };
      }
    }
    /* ADX 20-25: gray zone — no trades */
  }
  if (pos) closeTrade(data[data.length - 1].close, data[data.length - 1].time);
  return buildStats(trades, initialBalance, data);
}

function fmtTime(t: string): string {
  if (/^\d+$/.test(t)) {
    const d = new Date(Number(t) * 1000);
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return t.slice(5, 10);
}

const TIMEFRAMES: Timeframe[] = ['1M', '5M', '15M', '30M', '1H', '4H', '1D'];
const TF_MAX_DAYS: Record<Timeframe, number> = {
  '1M': 7, '5M': 60, '15M': 60, '30M': 60, '1H': 730, '4H': 730, '1D': 3650,
};
const LOT_OPTIONS = [
  { label: '0.01 (1K)', units: 1000 },
  { label: '0.1 (10K)', units: 10000 },
  { label: '1.0 (100K)', units: 100000 },
];
const tooltipStyle = { backgroundColor: 'hsl(225,18%,10%)', border: '1px solid hsl(225,12%,15%)', borderRadius: '8px', color: 'hsl(210,15%,88%)' };

const DRAWING_TOOLS: { tool: DrawingTool; icon: typeof MousePointer2; label: string }[] = [
  { tool: 'cursor', icon: MousePointer2, label: 'Cursor (Esc)' },
  { tool: 'select', icon: Hand, label: 'Select / Move (click drawing)' },
  { tool: 'trendline', icon: TrendingUp, label: 'Trend Line' },
  { tool: 'hline', icon: Minus, label: 'Horizontal Line' },
  { tool: 'rect', icon: BarChart3, label: 'Rectangle' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  { tool: 'fib', icon: GitBranch, label: 'Fibonacci Retracement' },
];

export default function Dashboard() {
  const { data: ohlc, isLoading: ohlcLoading } = useOhlc();
  const { pair, timeframe, setTimeframe, favorites, toggleFavorite, setPair, dateRange, setDateRange } = useGlobalState();
  const navigate = useNavigate();
  const reportStore = useReportStore();
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('cursor');
  const [showSMA, setShowSMA] = useState(false);
  const [showEMA, setShowEMA] = useState(false);
  const [showSAR, setShowSAR] = useState(false);
  const [bottomTab, setBottomTab] = useState<string>('rsi');
  const [fullscreen, setFullscreen] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const [screenshotSignal, setScreenshotSignal] = useState(0);

  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simStrategy, setSimStrategy] = useState<StrategyId>('sar');
  const [simBalance, setSimBalance] = useState('10000');
  const [simLotIdx, setSimLotIdx] = useState(1);
  const [simAfStep, setSimAfStep] = useState('0.02');
  const [simAfMax, setSimAfMax] = useState('0.20');
  const [showSimParams, setShowSimParams] = useState(false);

  const marketOpen = isForexMarketOpen();
  const currentStrat = STRATEGIES.find(s => s.id === simStrategy)!;

  const runSimulation = useCallback(() => {
    if (!ohlc || ohlc.length < 20) { toast.error('Not enough data (min 20 bars)'); return; }
    const bal = parseFloat(simBalance) || 10000;
    const lot = LOT_OPTIONS[simLotIdx]?.units ?? 10000;
    const afS = parseFloat(simAfStep) || 0.02;
    const afM = parseFloat(simAfMax) || 0.20;
    const result = runStrategy(simStrategy, ohlc, bal, lot, afS, afM);
    setSimResult(result);
    if (!showSAR) setShowSAR(true);
    toast.success(`Simulation complete: ${result.totalTrades} trades`);
  }, [ohlc, simStrategy, simBalance, simLotIdx, simAfStep, simAfMax, showSAR]);

  const handleExport = useCallback((format: 'xlsx' | 'html') => {
    if (!simResult) return;
    const meta = {
      pair: `${pair.base}/${pair.quote}`,
      timeframe,
      strategy: currentStrat.label,
      strategyDesc: currentStrat.desc,
      initialBalance: parseFloat(simBalance) || 10000,
      lotSize: LOT_OPTIONS[simLotIdx]?.label ?? '0.1 (10K)',
      afStep: parseFloat(simAfStep) || 0.02,
      afMax: parseFloat(simAfMax) || 0.20,
      dateRange: `${dateRange.start} — ${dateRange.end}`,
      generatedAt: new Date().toLocaleString(),
    };
    if (format === 'xlsx') exportExcel(simResult, meta, ohlc ?? undefined);
    else exportHTML(simResult, meta);
    toast.success(`Report exported as ${format.toUpperCase()}`);
  }, [simResult, pair, timeframe, currentStrat, simBalance, simLotIdx, simAfStep, simAfMax, dateRange, ohlc]);

  const handleOpenReport = useCallback(() => {
    if (!simResult || !ohlc || ohlc.length === 0) return;
    const id = crypto.randomUUID();
    reportStore.addReport({
      id,
      createdAt: new Date().toLocaleString(),
      pair: `${pair.base}/${pair.quote}`,
      timeframe,
      strategy: currentStrat.label,
      strategyDesc: currentStrat.desc,
      initialBalance: parseFloat(simBalance) || 10000,
      lotSize: LOT_OPTIONS[simLotIdx]?.label ?? '0.1 (10K)',
      afStep: parseFloat(simAfStep) || 0.02,
      afMax: parseFloat(simAfMax) || 0.20,
      dateRange: `${dateRange.start} — ${dateRange.end}`,
      showSMA, showEMA, showSAR,
      result: simResult,
      ohlcData: ohlc,
    });
    reportStore.setActiveReport(id);
    navigate('/strategy-report');
  }, [simResult, ohlc, pair, timeframe, currentStrat, simBalance, simLotIdx, simAfStep, simAfMax, dateRange, showSMA, showEMA, showSAR, reportStore, navigate]);

  const priceStats = useMemo(() => {
    if (!ohlc || ohlc.length < 2) return null;
    const last = ohlc[ohlc.length - 1];
    const prev = ohlc[ohlc.length - 2];
    const change = last.close - prev.close;
    const changePct = (change / prev.close) * 100;
    const high = Math.max(...ohlc.map(b => b.high));
    const low = Math.min(...ohlc.map(b => b.low));
    const spread = last.high - last.low;
    return { last: last.close, open: last.open, high: last.high, low: last.low, change, changePct, periodHigh: high, periodLow: low, spread, isUp: change >= 0 };
  }, [ohlc]);

  const overlays = useMemo(() => {
    if (!ohlc || ohlc.length === 0) return [];
    const closes = ohlc.map(b => b.close);
    const result: { name: string; data: { time: string; value: number }[]; color: string }[] = [];
    if (showSMA) {
      const vals = computeSMA(closes, 20);
      result.push({ name: 'SMA 20', color: '#f59e0b', data: vals.map((v, i) => v !== null ? { time: ohlc[i].time, value: v } : null).filter(Boolean) as { time: string; value: number }[] });
    }
    if (showEMA) {
      const vals = computeEMA(closes, 50);
      result.push({ name: 'EMA 50', color: '#8b5cf6', data: vals.map((v, i) => v !== null ? { time: ohlc[i].time, value: v } : null).filter(Boolean) as { time: string; value: number }[] });
    }
    if (showSAR) {
      const highs = ohlc.map(b => b.high);
      const lows = ohlc.map(b => b.low);
      const sarVals = computeParabolicSAR(highs, lows, closes);
      const bullish: { time: string; value: number }[] = [];
      const bearish: { time: string; value: number }[] = [];
      for (let i = 0; i < sarVals.length; i++) {
        if (sarVals[i] == null) continue;
        const v = sarVals[i]!;
        if (v < ohlc[i].close) bullish.push({ time: ohlc[i].time, value: v });
        else bearish.push({ time: ohlc[i].time, value: v });
      }
      if (bullish.length) result.push({ name: 'SAR Bull', color: '#22c55e', data: bullish });
      if (bearish.length) result.push({ name: 'SAR Bear', color: '#ef4444', data: bearish });
    }
    return result;
  }, [ohlc, showSMA, showEMA, showSAR]);

  const rsiData = useMemo(() => {
    if (!ohlc || ohlc.length < 15) return [];
    const vals = computeRSI(ohlc.map(b => b.close), 14);
    const out: { time: string; value: number }[] = [];
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] != null) out.push({ time: ohlc[i].time.slice(0, 10), value: +vals[i]!.toFixed(2) });
    }
    return out;
  }, [ohlc]);

  const macdData = useMemo(() => {
    if (!ohlc || ohlc.length < 27) return [];
    const raw = computeMACD(ohlc.map(b => b.close), 12, 26, 9);
    const out: { time: string; macd: number; signal: number; hist: number }[] = [];
    for (let i = 0; i < raw.macdLine.length; i++) {
      const m = raw.macdLine[i], s = raw.signalLine[i], h = raw.histogram[i];
      if (m != null && s != null && h != null) {
        out.push({ time: ohlc[ohlc.length - raw.macdLine.length + i].time.slice(0, 10), macd: +m.toFixed(6), signal: +s.toFixed(6), hist: +h.toFixed(6) });
      }
    }
    return out;
  }, [ohlc]);

  /* ── Toolbar (shared between normal and fullscreen) ─────────── */
  const toolbar = (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-card/80 shrink-0">
      {/* Pair + Timeframes only in fullscreen (since TopBar is hidden) */}
      {fullscreen && (
        <>
          <Select value={pair.symbol} onValueChange={v => { const p = CURRENCY_PAIRS.find(cp => cp.symbol === v); if (p) setPair(p); }}>
            <SelectTrigger className="h-7 w-[110px] text-xs mr-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_PAIRS.map(p => (
                <SelectItem key={p.symbol} value={p.symbol}>{p.base}/{p.quote}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-0.5 mr-1">
            {TIMEFRAMES.map(tf => (
              <Button key={tf} variant={timeframe === tf ? 'default' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => {
                setTimeframe(tf);
                const maxDays = TF_MAX_DAYS[tf];
                const endD = new Date(dateRange.end);
                const startD = new Date(dateRange.start);
                const diffDays = (endD.getTime() - startD.getTime()) / 86400000;
                if (diffDays > maxDays) {
                  const ns = new Date(endD); ns.setDate(ns.getDate() - maxDays);
                  setDateRange({ start: ns.toISOString().split('T')[0], end: dateRange.end });
                  toast.info(`Date range adjusted for ${tf}`);
                }
              }}>
                {tf}
              </Button>
            ))}
          </div>
          <div className="w-px h-5 bg-border mx-1" />
        </>
      )}

      {/* Drawing Tools — grouped with labels */}
      <div className="flex items-center gap-0.5 bg-muted/30 rounded-md px-1 py-0.5">
        {DRAWING_TOOLS.map(({ tool, icon: Icon, label }) => (
          <Tooltip key={tool}>
            <TooltipTrigger asChild>
              <Button variant={drawingTool === tool ? 'default' : 'ghost'} size="sm" className="h-7 w-7 p-0" onClick={() => setDrawingTool(tool)}>
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500" onClick={() => setClearSignal(s => s + 1)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Clear All Drawings</TooltipContent>
        </Tooltip>
      </div>

      <div className="w-px h-5 bg-border mx-0.5" />

      {/* Screenshot */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setScreenshotSignal(s => s + 1); toast.success('Screenshot saved!'); }}>
            <Camera className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Save Screenshot</TooltipContent>
      </Tooltip>

      <div className="w-px h-5 bg-border mx-0.5" />

      {/* Overlays quick toggle */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={showSMA ? 'default' : 'ghost'} size="sm" className="h-7 px-2 text-xs font-semibold" onClick={() => setShowSMA(v => !v)}>
              SMA
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">SMA 20</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={showEMA ? 'default' : 'ghost'} size="sm" className="h-7 px-2 text-xs font-semibold" onClick={() => setShowEMA(v => !v)}>
              EMA
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">EMA 50</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={showSAR ? 'default' : 'ghost'} size="sm" className="h-7 px-2 text-xs font-semibold" onClick={() => setShowSAR(v => !v)}>
              SAR
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Parabolic SAR (0.02 / 0.2)</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1" />

      {/* Current price */}
      {priceStats && (
        <div className="flex items-center gap-2 text-sm font-mono mr-2">
          <span className="font-semibold">{priceStats.last.toFixed(5)}</span>
          <span className={priceStats.isUp ? 'text-emerald-500' : 'text-red-500'}>
            {priceStats.isUp ? '+' : ''}{priceStats.change.toFixed(5)}
          </span>
        </div>
      )}

      {/* Fullscreen toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setFullscreen(f => !f)}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{fullscreen ? 'Exit Fullscreen' : 'Fullscreen Chart'}</TooltipContent>
      </Tooltip>
    </div>
  );

  /* ── Chart area ─────────────────────────────────────────────── */
  const chartArea = (
    <div className="flex-1 min-h-0 relative">
      {ohlcLoading ? (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Loading chart data...
          </div>
        </div>
      ) : ohlc && ohlc.length > 0 ? (
        <CandlestickChart
          data={ohlc}
          height={undefined}
          showVolume
          showGrid
          timeframe={timeframe}
          overlays={overlays}
          drawingTool={drawingTool}
          fillContainer
          onClearDrawings={clearSignal}
          onScreenshot={screenshotSignal}
        />
      ) : (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          No data available. Click "Update Data" to fetch market data.
        </div>
      )}
    </div>
  );

  /* ── Bottom indicators ──────────────────────────────────────── */
  const bottomIndicators = (
    <div className={`${fullscreen ? 'h-[130px]' : 'h-[150px]'} shrink-0 border-t-2 border-border/60 bg-card/90`}>
      <Tabs value={bottomTab} onValueChange={setBottomTab} className="h-full flex flex-col">
        <TabsList className="h-8 rounded-none border-b border-border bg-muted/20 px-3 shrink-0 gap-1">
          <TabsTrigger value="rsi" className="h-6 text-xs font-semibold data-[state=active]:bg-accent px-3">
            <Activity className="h-3.5 w-3.5 mr-1.5" />RSI (14)
          </TabsTrigger>
          <TabsTrigger value="macd" className="h-6 text-xs font-semibold data-[state=active]:bg-accent px-3">
            <LineChartIcon className="h-3.5 w-3.5 mr-1.5" />MACD (12,26,9)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rsi" className="flex-1 m-0 p-0">
          {rsiData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rsiData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#999' }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#999' }} tickLine={false} width={35} />
                <RTooltip contentStyle={tooltipStyle} />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={50} stroke="#666" strokeDasharray="1 3" strokeOpacity={0.3} />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Not enough data for RSI</div>}
        </TabsContent>

        <TabsContent value="macd" className="flex-1 m-0 p-0">
          {macdData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={macdData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#999' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#999' }} tickLine={false} width={50} />
                <RTooltip contentStyle={tooltipStyle} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="1 3" strokeOpacity={0.3} />
                <Line type="monotone" dataKey="macd" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="MACD" />
                <Line type="monotone" dataKey="signal" stroke="#ef4444" dot={false} strokeWidth={1} name="Signal" />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Not enough data for MACD</div>}
        </TabsContent>
      </Tabs>
    </div>
  );

  /* ── FULLSCREEN MODE ────────────────────────────────────────── */
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {toolbar}
        {chartArea}
        {bottomIndicators}
      </div>
    );
  }

  /* ── NORMAL MODE ────────────────────────────────────────────── */
  return (
    <div className="flex h-full overflow-hidden gap-0">
      {/* Center: Toolbar + Chart + Indicators */}
      <div className="flex-1 flex flex-col min-w-0">
        {toolbar}
        {chartArea}
        {bottomIndicators}
      </div>

      {/* Right Panel: Strategy Tester */}
      <div className="w-[280px] shrink-0 border-l border-border bg-card flex flex-col">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">{pair.base}/{pair.quote}</h3>
          <span className="text-xs font-mono text-muted-foreground">{timeframe} · {dateRange.start.slice(5)} — {dateRange.end.slice(5)}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Current price */}
          {priceStats && (
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center justify-between">
                <span className="text-xl font-mono font-bold">{priceStats.last.toFixed(5)}</span>
                <span className={`text-xs font-mono font-semibold px-2 py-1 rounded ${priceStats.isUp ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>
                  {priceStats.isUp ? '+' : ''}{priceStats.changePct.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                <span>H {priceStats.high.toFixed(5)}</span>
                <span>L {priceStats.low.toFixed(5)}</span>
                <span>Spread {priceStats.spread.toFixed(5)}</span>
              </div>
            </div>
          )}

          {/* Strategy config */}
          <div className="px-4 py-3 border-b border-border space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Strategy Tester</h3>
              <button onClick={() => setShowSimParams(p => !p)} className="text-muted-foreground hover:text-foreground transition-colors">
                <Settings2 className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground font-medium">Strategy</span>
                <Select value={simStrategy} onValueChange={v => { setSimStrategy(v as StrategyId); setSimResult(null); }}>
                  <SelectTrigger className="h-8 text-sm font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STRATEGIES.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70 leading-snug">{currentStrat.desc}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Balance ($)</span>
                  <input
                    type="number" value={simBalance}
                    onChange={e => setSimBalance(e.target.value)}
                    className="h-8 w-full bg-background border border-border rounded px-2 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Lot Size</span>
                  <Select value={String(simLotIdx)} onValueChange={v => setSimLotIdx(Number(v))}>
                    <SelectTrigger className="h-8 text-sm font-mono"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOT_OPTIONS.map((o, i) => (
                        <SelectItem key={i} value={String(i)}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {showSimParams && (
                <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-border/50">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground font-medium">AF Step</span>
                    <input
                      type="number" step="0.01" value={simAfStep}
                      onChange={e => setSimAfStep(e.target.value)}
                      className="h-8 w-full bg-background border border-border rounded px-2 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground font-medium">AF Max</span>
                    <input
                      type="number" step="0.01" value={simAfMax}
                      onChange={e => setSimAfMax(e.target.value)}
                      className="h-8 w-full bg-background border border-border rounded px-2 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-1.5">
              <Button size="sm" className="flex-1 text-sm h-9 font-semibold" onClick={runSimulation} disabled={!ohlc || ohlc.length < 20}>
                <Play className="mr-1.5 h-4 w-4" />Run Test
              </Button>
              {simResult && (
                <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setSimResult(null)}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Test context info */}
            {ohlc && ohlc.length > 0 && (
              <div className="text-[11px] text-muted-foreground/60 text-center">
                {ohlc.length} bars · {dateRange.start} → {dateRange.end}
              </div>
            )}
          </div>

          {/* Results */}
          {simResult && (
            <div className="px-4 py-3 space-y-2.5">
              {/* P/L hero */}
              <div className={`rounded-lg p-3 text-center ${simResult.totalPnl >= 0 ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                <div className={`text-xl font-bold font-mono ${simResult.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {simResult.totalPnl >= 0 ? '+' : ''}{simResult.totalPnl.toFixed(2)}$
                </div>
                <div className={`text-sm font-mono ${simResult.totalPnl >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                  {simResult.totalPnlPct >= 0 ? '+' : ''}{simResult.totalPnlPct.toFixed(2)}%
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Final: ${simResult.finalBalance.toFixed(2)}
                </div>
              </div>

              {/* Equity curve */}
              {simResult.equity.length > 1 && (
                <div>
                  <h4 className="text-xs text-muted-foreground uppercase font-semibold mb-1">Equity Curve</h4>
                  <div className="h-[70px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={simResult.equity} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={simResult.totalPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={simResult.totalPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="balance" stroke={simResult.totalPnl >= 0 ? '#22c55e' : '#ef4444'} fill="url(#eqGrad)" strokeWidth={1.5} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {([
                  ['Win Rate', `${simResult.winRate.toFixed(1)}%`, simResult.winRate >= 50 ? 'text-emerald-500' : 'text-red-500'],
                  ['Trades', `${simResult.totalTrades}`, ''],
                  ['Wins', `${simResult.wins}`, 'text-emerald-500'],
                  ['Losses', `${simResult.losses}`, 'text-red-500'],
                  ['Avg Win', `+${simResult.avgWin}p`, 'text-emerald-500'],
                  ['Avg Loss', `${simResult.avgLoss}p`, 'text-red-500'],
                  ['Best', `+${simResult.bestTrade}p`, 'text-emerald-500'],
                  ['Worst', `${simResult.worstTrade}p`, 'text-red-500'],
                  ['Max DD', `${simResult.maxDrawdownPct}%`, 'text-red-500'],
                  ['Profit Factor', simResult.profitFactor === Infinity ? '∞' : `${simResult.profitFactor}`, simResult.profitFactor >= 1 ? 'text-emerald-500' : 'text-red-500'],
                ] as [string, string, string][]).map(([label, val, cls]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-mono font-semibold ${cls}`}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Export & Report buttons */}
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="flex-1 text-xs h-8" onClick={() => handleExport('xlsx')}>
                  <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />Excel
                </Button>
                <Button variant="outline" size="sm" className="flex-1 text-xs h-8" onClick={() => handleExport('html')}>
                  <FileText className="mr-1 h-3.5 w-3.5" />HTML
                </Button>
              </div>
              <Button variant="default" size="sm" className="w-full text-xs h-8" onClick={handleOpenReport}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" />Open Interactive Report
              </Button>

              {simResult.trades.length > 0 && (
                <div>
                  <h4 className="text-xs text-muted-foreground uppercase font-semibold mb-1">
                    Trade History ({simResult.trades.length})
                  </h4>
                  <div className="max-h-[220px] overflow-y-auto">
                    <div className="grid grid-cols-[22px_1fr_60px_55px] gap-0 text-[11px] text-muted-foreground border-b border-border/50 pb-0.5 mb-0.5 font-medium">
                      <span></span><span>Entry</span><span className="text-right">Price</span><span className="text-right">P/L</span>
                    </div>
                    {simResult.trades.map((t, i) => (
                      <div key={i} className="grid grid-cols-[22px_1fr_60px_55px] gap-0 text-xs py-0.5 hover:bg-accent/20 rounded-sm">
                        <span className={`font-bold ${t.type === 'BUY' ? 'text-emerald-500' : 'text-red-500'}`}>
                          {t.type === 'BUY' ? 'B' : 'S'}
                        </span>
                        <span className="text-muted-foreground truncate">{fmtTime(t.entryTime)}</span>
                        <span className="font-mono text-right text-muted-foreground">{t.entryPrice.toFixed(4)}</span>
                        <span className={`font-mono text-right font-semibold ${t.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {t.pnl >= 0 ? '+' : ''}{t.pnlPips}p
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!simResult && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <Play className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>Configure strategy and press</p>
              <p className="font-semibold mt-1 text-foreground">"Run Test"</p>
              <p className="mt-3 text-xs opacity-60 leading-relaxed">Simulates trades based on selected strategy signals over the loaded data period</p>
            </div>
          )}

          {/* Saved reports */}
          {reportStore.reports.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <h4 className="text-xs text-muted-foreground uppercase font-semibold mb-2 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Saved Reports ({reportStore.reports.length})
              </h4>
              <div className="space-y-1 max-h-[240px] overflow-y-auto">
                {reportStore.reports.map(r => (
                  <div key={r.id} className="group flex items-center gap-2 p-2 rounded-md hover:bg-accent/30 cursor-pointer"
                    onClick={() => { reportStore.setActiveReport(r.id); navigate('/strategy-report'); }}>
                    <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">{r.pair} · {r.strategy}</div>
                      <div className="text-[11px] text-muted-foreground">{r.timeframe} · {r.createdAt}</div>
                    </div>
                    <span className={`text-xs font-mono font-bold shrink-0 ${r.result.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.result.totalPnl >= 0 ? '+' : ''}${r.result.totalPnl.toFixed(0)}
                    </span>
                    <button className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); reportStore.removeReport(r.id); }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
