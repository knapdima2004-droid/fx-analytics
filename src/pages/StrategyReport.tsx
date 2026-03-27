import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CandlestickChart, type DrawingTool, type TradeMarker } from '@/components/charts/CandlestickChart';
import { computeSMA, computeEMA, computeParabolicSAR } from '@/utils/indicators';
import { exportExcel, exportHTML } from '@/utils/reportExport';
import { useReportStore, type StrategyReport as ReportType } from '@/hooks/useReportStore';
import {
  ArrowLeft, TrendingUp, Minus, MousePointer2, Hand,
  MoveUpRight, Trash2, GitBranch, Camera, BarChart3,
  Maximize2, Minimize2, FileSpreadsheet, FileText,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer,
  Tooltip as RTooltip, Area, AreaChart, ReferenceLine,
} from 'recharts';
import { toast } from 'sonner';

const DRAWING_TOOLS: { tool: DrawingTool; icon: typeof MousePointer2; label: string }[] = [
  { tool: 'cursor', icon: MousePointer2, label: 'Cursor' },
  { tool: 'select', icon: Hand, label: 'Select / Move' },
  { tool: 'trendline', icon: TrendingUp, label: 'Trend Line' },
  { tool: 'hline', icon: Minus, label: 'Horizontal Line' },
  { tool: 'rect', icon: BarChart3, label: 'Rectangle' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  { tool: 'fib', icon: GitBranch, label: 'Fibonacci' },
];

const tooltipStyle = { backgroundColor: 'hsl(225,18%,10%)', border: '1px solid hsl(225,12%,15%)', borderRadius: '8px', color: 'hsl(210,15%,88%)' };

export default function StrategyReportPage() {
  const navigate = useNavigate();
  const { reports, activeReportId, removeReport } = useReportStore();
  const report = reports.find(r => r.id === activeReportId) ?? null;

  const [drawingTool, setDrawingTool] = useState<DrawingTool>('cursor');
  const [clearSignal, setClearSignal] = useState(0);
  const [screenshotSignal, setScreenshotSignal] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showTradesPanel, setShowTradesPanel] = useState(true);
  const [showConfig, setShowConfig] = useState(true);

  if (!report) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-lg">No active report selected</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <ReportView
      report={report}
      drawingTool={drawingTool}
      setDrawingTool={setDrawingTool}
      clearSignal={clearSignal}
      setClearSignal={setClearSignal}
      screenshotSignal={screenshotSignal}
      setScreenshotSignal={setScreenshotSignal}
      fullscreen={fullscreen}
      setFullscreen={setFullscreen}
      showTradesPanel={showTradesPanel}
      setShowTradesPanel={setShowTradesPanel}
      showConfig={showConfig}
      setShowConfig={setShowConfig}
      onBack={() => navigate('/')}
      onDelete={() => { removeReport(report.id); navigate('/'); }}
    />
  );
}

interface ReportViewProps {
  report: ReportType;
  drawingTool: DrawingTool;
  setDrawingTool: (t: DrawingTool) => void;
  clearSignal: number;
  setClearSignal: (n: number) => void;
  screenshotSignal: number;
  setScreenshotSignal: (n: number) => void;
  fullscreen: boolean;
  setFullscreen: (b: boolean) => void;
  showTradesPanel: boolean;
  setShowTradesPanel: (b: boolean) => void;
  showConfig: boolean;
  setShowConfig: (b: boolean) => void;
  onBack: () => void;
  onDelete: () => void;
}

function ReportView({
  report, drawingTool, setDrawingTool,
  clearSignal, setClearSignal, screenshotSignal, setScreenshotSignal,
  fullscreen, setFullscreen,
  showTradesPanel, setShowTradesPanel,
  showConfig, setShowConfig,
  onBack, onDelete,
}: ReportViewProps) {
  const r = report.result;

  const overlays = useMemo(() => {
    const d = report.ohlcData;
    if (!d || d.length === 0) return [];
    const closes = d.map(b => b.close);
    const result: { name: string; data: { time: string; value: number }[]; color: string }[] = [];
    if (report.showSMA) {
      const vals = computeSMA(closes, 20);
      result.push({ name: 'SMA 20', color: '#f59e0b', data: vals.map((v, i) => v !== null ? { time: d[i].time, value: v } : null).filter(Boolean) as { time: string; value: number }[] });
    }
    if (report.showEMA) {
      const vals = computeEMA(closes, 50);
      result.push({ name: 'EMA 50', color: '#8b5cf6', data: vals.map((v, i) => v !== null ? { time: d[i].time, value: v } : null).filter(Boolean) as { time: string; value: number }[] });
    }
    if (report.showSAR) {
      const highs = d.map(b => b.high);
      const lows = d.map(b => b.low);
      const sarVals = computeParabolicSAR(highs, lows, closes, report.afStep, report.afMax);
      const bull: { time: string; value: number }[] = [];
      const bear: { time: string; value: number }[] = [];
      sarVals.forEach((v, i) => {
        if (v == null) return;
        if (v < d[i].close) bull.push({ time: d[i].time, value: v });
        else bear.push({ time: d[i].time, value: v });
      });
      if (bull.length > 0) result.push({ name: 'SAR Bull', data: bull, color: '#22c55e' });
      if (bear.length > 0) result.push({ name: 'SAR Bear', data: bear, color: '#ef4444' });
    }
    return result;
  }, [report]);

  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    const markers: TradeMarker[] = [];
    r.trades.forEach(t => {
      markers.push({ time: t.entryTime, type: t.type, price: t.entryPrice, label: `${t.type} ${t.entryPrice.toFixed(5)}` });
      markers.push({ time: t.exitTime, type: t.type === 'BUY' ? 'SELL' : 'BUY', price: t.exitPrice,
        label: `CLOSE ${t.exitPrice.toFixed(5)} (${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)})` });
    });
    return markers;
  }, [r.trades]);

  const handleExport = useCallback((format: 'xlsx' | 'html') => {
    const meta = {
      pair: report.pair, timeframe: report.timeframe, strategy: report.strategy,
      strategyDesc: report.strategyDesc, initialBalance: report.initialBalance,
      lotSize: report.lotSize, afStep: report.afStep, afMax: report.afMax,
      dateRange: report.dateRange, generatedAt: report.createdAt,
    };
    if (format === 'xlsx') exportExcel(r, meta, report.ohlcData);
    else exportHTML(r, meta);
    toast.success(`Report exported as ${format.toUpperCase()}`);
  }, [r, report]);

  const pnlColor = r.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400';

  const equityChartData = useMemo(() => r.equity.map((e, i) => ({
    idx: i, balance: e.balance, time: e.time,
  })), [r.equity]);

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0e14] flex flex-col">
        <div className="flex items-center gap-1 px-2 py-1 bg-[#0d1117] border-b border-white/5 shrink-0">
          <span className="text-xs font-mono text-muted-foreground mr-2">
            {report.pair} · {report.strategy} · Report
          </span>
          <div className="flex gap-0.5">
            {DRAWING_TOOLS.map(({ tool, icon: Icon, label }) => (
              <Tooltip key={tool}><TooltipTrigger asChild>
                <Button variant={drawingTool === tool ? 'secondary' : 'ghost'} size="sm"
                  className="h-6 w-6 p-0" onClick={() => setDrawingTool(tool)}>
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger><TooltipContent side="bottom"><p className="text-xs">{label}</p></TooltipContent></Tooltip>
            ))}
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setClearSignal(clearSignal + 1)}>
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setScreenshotSignal(screenshotSignal + 1)}>
            <Camera className="h-3 w-3 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setFullscreen(false)}>
            <Minimize2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <CandlestickChart
            data={report.ohlcData} overlays={overlays} tradeMarkers={tradeMarkers}
            showVolume showGrid timeframe={report.timeframe}
            drawingTool={drawingTool} fillContainer
            onClearDrawings={clearSignal} onScreenshot={screenshotSignal}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-[#0d1117] shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="h-4 w-px bg-white/10" />
        <span className="text-sm font-semibold">{report.pair}</span>
        <span className="text-xs text-muted-foreground">{report.timeframe}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{report.strategy}</span>
        <div className="flex-1" />
        <span className={`text-sm font-mono font-bold ${pnlColor}`}>
          {r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(2)} ({r.totalPnlPct >= 0 ? '+' : ''}{r.totalPnlPct.toFixed(2)}%)
        </span>
        <div className="h-4 w-px bg-white/10" />
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleExport('xlsx')}>
          <FileSpreadsheet className="mr-1 h-3 w-3" />Excel
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleExport('html')}>
          <FileText className="mr-1 h-3 w-3" />HTML
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main chart area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 px-2 py-1 bg-[#0d1117] border-b border-white/5 shrink-0">
            {DRAWING_TOOLS.map(({ tool, icon: Icon, label }) => (
              <Tooltip key={tool}><TooltipTrigger asChild>
                <Button variant={drawingTool === tool ? 'secondary' : 'ghost'} size="sm"
                  className="h-6 w-6 p-0" onClick={() => setDrawingTool(tool)}>
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger><TooltipContent side="bottom"><p className="text-xs">{label}</p></TooltipContent></Tooltip>
            ))}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setClearSignal(clearSignal + 1)}>
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setScreenshotSignal(screenshotSignal + 1)}>
              <Camera className="h-3 w-3 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setFullscreen(true)}>
              <Maximize2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 relative">
            <CandlestickChart
              data={report.ohlcData} overlays={overlays} tradeMarkers={tradeMarkers}
              showVolume showGrid timeframe={report.timeframe}
              drawingTool={drawingTool} fillContainer
              onClearDrawings={clearSignal} onScreenshot={screenshotSignal}
            />
          </div>
        </div>

        {/* Right panel: config + stats + trades */}
        <div className="w-[280px] border-l border-white/5 bg-[#0d1117] flex flex-col overflow-hidden shrink-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
            {/* Config section */}
            <button
              className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground"
              onClick={() => setShowConfig(!showConfig)}
            >
              <span>Configuration Snapshot</span>
              {showConfig ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showConfig && (
              <div className="space-y-1 text-[11px]">
                <ConfigRow label="Pair" value={report.pair} />
                <ConfigRow label="Timeframe" value={report.timeframe} />
                <ConfigRow label="Strategy" value={report.strategy} />
                <ConfigRow label="Date Range" value={report.dateRange} />
                <ConfigRow label="Initial Balance" value={`$${report.initialBalance.toLocaleString()}`} />
                <ConfigRow label="Lot Size" value={report.lotSize} />
                <ConfigRow label="AF Step" value={report.afStep.toString()} />
                <ConfigRow label="AF Max" value={report.afMax.toString()} />
                <ConfigRow label="Generated" value={report.createdAt} />
                <div className="flex gap-1 pt-1">
                  {report.showSMA && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[9px]">SMA 20</span>}
                  {report.showEMA && <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[9px]">EMA 50</span>}
                  {report.showSAR && <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px]">SAR</span>}
                </div>
              </div>
            )}

            <div className="border-t border-white/5" />

            {/* Performance */}
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Performance</div>
            <div className={`text-center py-2 rounded-lg ${r.totalPnl >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
              <div className={`text-xl font-bold font-mono ${pnlColor}`}>
                {r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(2)}
              </div>
              <div className={`text-xs font-mono ${pnlColor}`}>
                {r.totalPnlPct >= 0 ? '+' : ''}{r.totalPnlPct.toFixed(2)}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Final: ${r.finalBalance.toFixed(2)}
              </div>
            </div>

            {/* Equity curve */}
            <div className="h-[100px] -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityChartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="reportEq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={r.totalPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={r.totalPnl >= 0 ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <ReferenceLine y={report.initialBalance} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="balance" stroke={r.totalPnl >= 0 ? '#22c55e' : '#ef4444'}
                    strokeWidth={1.5} fill="url(#reportEq)" dot={false} />
                  <RTooltip
                    contentStyle={{ ...tooltipStyle, fontSize: 10, padding: '4px 8px' }}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, 'Balance']}
                    labelFormatter={(idx: number) => equityChartData[idx]?.time || ''}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-1">
              <StatCell label="Trades" value={r.totalTrades.toString()} />
              <StatCell label="Win Rate" value={`${r.winRate.toFixed(1)}%`} color={r.winRate >= 50 ? '#22c55e' : '#ef4444'} />
              <StatCell label="Profit Factor" value={r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)} />
              <StatCell label="Max DD" value={`${r.maxDrawdownPct.toFixed(2)}%`} color="#ef4444" />
              <StatCell label="Avg Win" value={`+${r.avgWin}p`} color="#22c55e" />
              <StatCell label="Avg Loss" value={`${r.avgLoss}p`} color="#ef4444" />
              <StatCell label="Best" value={`+${r.bestTrade}p`} color="#22c55e" />
              <StatCell label="Worst" value={`${r.worstTrade}p`} color="#ef4444" />
            </div>

            <div className="border-t border-white/5" />

            {/* Trade history */}
            <button
              className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground"
              onClick={() => setShowTradesPanel(!showTradesPanel)}
            >
              <span>Trade History ({r.trades.length})</span>
              {showTradesPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showTradesPanel && (
              <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-[9px] font-mono">
                  <thead>
                    <tr className="text-muted-foreground sticky top-0 bg-[#0d1117]">
                      <th className="text-left py-1 px-1">#</th>
                      <th className="text-left py-1 px-1">Type</th>
                      <th className="text-right py-1 px-1">Entry</th>
                      <th className="text-right py-1 px-1">Exit</th>
                      <th className="text-right py-1 px-1">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.trades.map((t, i) => (
                      <tr key={i} className="border-t border-white/3 hover:bg-white/[0.02]">
                        <td className="py-0.5 px-1 text-muted-foreground">{i + 1}</td>
                        <td className={`py-0.5 px-1 font-semibold ${t.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.type}
                        </td>
                        <td className="py-0.5 px-1 text-right">{t.entryPrice.toFixed(5)}</td>
                        <td className="py-0.5 px-1 text-right">{t.exitPrice.toFixed(5)}</td>
                        <td className={`py-0.5 px-1 text-right font-semibold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded px-2 py-1.5">
      <div className="text-[8px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-[12px] font-mono font-semibold" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
