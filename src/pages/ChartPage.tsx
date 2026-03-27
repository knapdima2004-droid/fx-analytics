import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CandlestickChart } from '@/components/charts/CandlestickChart';
import { useOhlc, isForexMarketOpen } from '@/hooks/useApi';
import { useGlobalState } from '@/hooks/useGlobalState';
import { computeSMA, computeEMA, computeRSI, computeMACD } from '@/utils/indicators';
import { ohlcToCsv, downloadCsv } from '@/utils/csv';
import type { IndicatorConfig } from '@/types';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';

/** Format bar time for the data table (local timezone). */
function formatBarTime(t: string): string {
  if (/^\d+$/.test(t)) {
    const d = new Date(Number(t) * 1000);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
  return t;
}
import { PanelRightClose, PanelRightOpen, RotateCcw, Copy, Download, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const tooltipStyle = { backgroundColor: 'hsl(225,18%,10%)', border: '1px solid hsl(225,12%,15%)', borderRadius: '8px', color: 'hsl(210,15%,88%)' };

const defaultInd: IndicatorConfig = {
  sma: { enabled: false, period: 20 }, ema: { enabled: false, period: 50 },
  rsi: { enabled: false, period: 14, overbought: 70, oversold: 30 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
};

type PriceType = 'close' | 'typical';

export default function ChartPage() {
  const { data: ohlc, isLoading } = useOhlc();
  const { pair, timeframe } = useGlobalState();
  const [ind, setInd] = useState<IndicatorConfig>(defaultInd);
  const [applied, setApplied] = useState<IndicatorConfig>(defaultInd);
  const [showVolume, setShowVolume] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [priceType, setPriceType] = useState<PriceType>('close');
  const [panel, setPanel] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const priceData = useMemo(() => {
    if (!ohlc) return [];
    return priceType === 'typical' ? ohlc.map(b => (b.high + b.low + b.close) / 3) : ohlc.map(b => b.close);
  }, [ohlc, priceType]);

  const times = useMemo(() => ohlc?.map(b => b.time) || [], [ohlc]);

  const overlays = useMemo(() => {
    if (!ohlc || !ohlc.length) return [];
    const res: { name: string; data: { time: string; value: number }[]; color: string }[] = [];
    if (applied.sma.enabled) {
      const v = computeSMA(priceData, applied.sma.period);
      res.push({ name: `SMA(${applied.sma.period})`, color: '#f59e0b', data: v.map((val, i) => val !== null ? { time: times[i], value: val } : null).filter(Boolean) as any[] });
    }
    if (applied.ema.enabled) {
      const v = computeEMA(priceData, applied.ema.period);
      res.push({ name: `EMA(${applied.ema.period})`, color: '#8b5cf6', data: v.map((val, i) => val !== null ? { time: times[i], value: val } : null).filter(Boolean) as any[] });
    }
    return res;
  }, [ohlc, applied, priceData, times]);

  const rsiData = useMemo(() => {
    if (!applied.rsi.enabled || !priceData.length) return null;
    return computeRSI(priceData, applied.rsi.period).map((v, i) => ({ time: times[i], value: v })).filter(d => d.value !== null);
  }, [applied, priceData, times]);

  const macdData = useMemo(() => {
    if (!applied.macd.enabled || !priceData.length) return null;
    const { macdLine, signalLine } = computeMACD(priceData, applied.macd.fast, applied.macd.slow, applied.macd.signal);
    return macdLine.map((m, i) => ({ time: times[i], macd: m, signal: signalLine[i] })).filter(d => d.macd !== null);
  }, [applied, priceData, times]);

  const isFlatData = useMemo(() => {
    if (!ohlc || ohlc.length < 10) return false;
    const eps = 1e-8;
    const flatCount = ohlc.filter(b => Math.abs(b.open - b.high) < eps && Math.abs(b.high - b.low) < eps && Math.abs(b.low - b.close) < eps).length;
    return flatCount / ohlc.length > 0.3;
  }, [ohlc]);

  const marketOpen = isForexMarketOpen();

  const handleApply = () => { setApplied({ ...ind }); toast.success('Indicators applied'); };
  const handleReset = () => { setInd(defaultInd); setApplied(defaultInd); toast.info('Indicators reset'); };

  const u = (path: string, value: any) => {
    setInd(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const parts = path.split('.');
      let obj = copy;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      return copy;
    });
  };

  // Pagination
  const sortedOhlc = useMemo(() => ohlc ? [...ohlc].reverse() : [], [ohlc]);
  const totalPages = Math.ceil(sortedOhlc.length / pageSize);
  const pagedData = sortedOhlc.slice(page * pageSize, (page + 1) * pageSize);

  const handleCopy = () => {
    if (!ohlc) return;
    navigator.clipboard.writeText(ohlcToCsv(ohlc));
    toast.success('Copied to clipboard');
  };

  const handleCsvExport = () => {
    if (!ohlc) return;
    downloadCsv(ohlcToCsv(ohlc), `${pair.symbol}_ohlc.csv`);
    toast.success('CSV downloaded');
  };


  return (
    <div className="flex gap-4 h-full">
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Chart</h2>
          <Button variant="ghost" size="sm" onClick={() => setPanel(!panel)}>{panel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</Button>
        </div>
        {!marketOpen && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <strong>Forex market is closed</strong> (weekends: Fri 21:00 UTC – Sun 21:00 UTC). Chart shows the latest available data. New data will appear when markets reopen.
            </div>
          </div>
        )}
        {isFlatData && marketOpen && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <strong>Flat or repetitive data detected.</strong> Yahoo Finance often returns poor-quality intraday FX data. For more reliable charts, try <strong>1D</strong> or <strong>1H</strong> timeframe.
            </div>
          </div>
        )}
        <Card>
          <CardContent className="pt-4">
            {isLoading ? <div className="h-[500px] flex items-center justify-center text-muted-foreground">Loading chart...</div>
              : ohlc && ohlc.length > 0 ? <CandlestickChart data={ohlc} overlays={overlays} showVolume={showVolume} showGrid={showGrid} timeframe={timeframe} />
              : <div className="h-[500px] flex items-center justify-center text-muted-foreground">No data</div>}
          </CardContent>
        </Card>
        {rsiData && rsiData.length > 0 && (
          <Card><CardHeader className="py-2"><CardTitle className="text-xs text-muted-foreground">RSI({applied.rsi.period})</CardTitle></CardHeader>
            <CardContent className="pb-2">
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={rsiData}><Line type="monotone" dataKey="value" stroke="hsl(190,85%,48%)" dot={false} strokeWidth={1.5} /><ReferenceLine y={applied.rsi.overbought} stroke="hsl(0,65%,50%)" strokeDasharray="3 3" /><ReferenceLine y={applied.rsi.oversold} stroke="hsl(142,60%,45%)" strokeDasharray="3 3" /><YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#6b7280' }} width={30} /><XAxis dataKey="time" hide /><Tooltip contentStyle={tooltipStyle} /></LineChart>
              </ResponsiveContainer>
            </CardContent></Card>
        )}
        {macdData && macdData.length > 0 && (
          <Card><CardHeader className="py-2"><CardTitle className="text-xs text-muted-foreground">MACD({applied.macd.fast},{applied.macd.slow},{applied.macd.signal})</CardTitle></CardHeader>
            <CardContent className="pb-2">
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={macdData}><Line type="monotone" dataKey="macd" stroke="hsl(190,85%,48%)" dot={false} strokeWidth={1.5} /><Line type="monotone" dataKey="signal" stroke="#f59e0b" dot={false} strokeWidth={1} /><YAxis tick={{ fontSize: 10, fill: '#6b7280' }} width={40} /><XAxis dataKey="time" hide /><ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" /><Tooltip contentStyle={tooltipStyle} /></LineChart>
              </ResponsiveContainer>
            </CardContent></Card>
        )}
        <Card>
          <Tabs defaultValue="data"><CardHeader className="pb-0"><TabsList><TabsTrigger value="data">Data Table</TabsTrigger></TabsList></CardHeader>
            <CardContent className="pt-4"><TabsContent value="data" className="mt-0">
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2 text-muted-foreground font-medium">Date</th><th className="text-right py-2 px-2 text-muted-foreground font-medium">Open</th><th className="text-right py-2 px-2 text-muted-foreground font-medium">High</th><th className="text-right py-2 px-2 text-muted-foreground font-medium">Low</th><th className="text-right py-2 px-2 text-muted-foreground font-medium">Close</th><th className="text-right py-2 px-2 text-muted-foreground font-medium">Volume</th></tr></thead>
                  <tbody>{pagedData.map((b, i) => (<tr key={i} className="border-b border-border/30"><td className="py-1.5 px-2">{formatBarTime(b.time)}</td><td className="text-right py-1.5 px-2 font-mono">{b.open}</td><td className="text-right py-1.5 px-2 font-mono">{b.high}</td><td className="text-right py-1.5 px-2 font-mono">{b.low}</td><td className="text-right py-1.5 px-2 font-mono">{b.close}</td><td className="text-right py-1.5 px-2 font-mono">{b.volume ?? '-'}</td></tr>))}</tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</Button>
                  <Button variant="outline" size="sm" onClick={handleCsvExport}><Download className="mr-1.5 h-3.5 w-3.5" />Download CSV</Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(0); }}>
                    <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem></SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" className="h-7 px-2" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <span>{page + 1} / {totalPages || 1}</span>
                  <Button variant="ghost" size="sm" className="h-7 px-2" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            </TabsContent></CardContent>
          </Tabs>
        </Card>
      </div>
      {panel && (
        <div className="w-72 space-y-4 shrink-0">
          <Card><CardHeader><CardTitle className="text-sm">Indicators</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><div className="flex items-center justify-between"><Label className="text-sm">SMA</Label><Switch checked={ind.sma.enabled} onCheckedChange={v => u('sma.enabled', v)} /></div>
                {ind.sma.enabled && <div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground">Period</Label><Input type="number" value={ind.sma.period} onChange={e => u('sma.period', +e.target.value)} className="h-7 text-sm" /></div>}</div>
              <div className="space-y-2"><div className="flex items-center justify-between"><Label className="text-sm">EMA</Label><Switch checked={ind.ema.enabled} onCheckedChange={v => u('ema.enabled', v)} /></div>
                {ind.ema.enabled && <div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground">Period</Label><Input type="number" value={ind.ema.period} onChange={e => u('ema.period', +e.target.value)} className="h-7 text-sm" /></div>}</div>
              <div className="space-y-2"><div className="flex items-center justify-between"><Label className="text-sm">RSI</Label><Switch checked={ind.rsi.enabled} onCheckedChange={v => u('rsi.enabled', v)} /></div>
                {ind.rsi.enabled && <div className="space-y-1.5"><div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground w-20">Period</Label><Input type="number" value={ind.rsi.period} onChange={e => u('rsi.period', +e.target.value)} className="h-7 text-sm" /></div><div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground w-20">Overbought</Label><Input type="number" value={ind.rsi.overbought} onChange={e => u('rsi.overbought', +e.target.value)} className="h-7 text-sm" /></div><div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground w-20">Oversold</Label><Input type="number" value={ind.rsi.oversold} onChange={e => u('rsi.oversold', +e.target.value)} className="h-7 text-sm" /></div></div>}</div>
              <div className="space-y-2"><div className="flex items-center justify-between"><Label className="text-sm">MACD</Label><Switch checked={ind.macd.enabled} onCheckedChange={v => u('macd.enabled', v)} /></div>
                {ind.macd.enabled && <div className="space-y-1.5"><div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground w-14">Fast</Label><Input type="number" value={ind.macd.fast} onChange={e => u('macd.fast', +e.target.value)} className="h-7 text-sm" /></div><div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground w-14">Slow</Label><Input type="number" value={ind.macd.slow} onChange={e => u('macd.slow', +e.target.value)} className="h-7 text-sm" /></div><div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground w-14">Signal</Label><Input type="number" value={ind.macd.signal} onChange={e => u('macd.signal', +e.target.value)} className="h-7 text-sm" /></div></div>}</div>
              <div className="flex gap-2 pt-2"><Button size="sm" onClick={handleApply} className="flex-1">Apply</Button><Button size="sm" variant="outline" onClick={handleReset}><RotateCcw className="h-3.5 w-3.5" /></Button></div>
            </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-sm">Chart Options</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between"><Label className="text-sm">Volume</Label><Switch checked={showVolume} onCheckedChange={setShowVolume} /></div>
              <div className="flex items-center justify-between"><Label className="text-sm">Grid</Label><Switch checked={showGrid} onCheckedChange={setShowGrid} /></div>
              <div className="space-y-1.5"><Label className="text-sm">Price Type</Label>
                <Select value={priceType} onValueChange={v => setPriceType(v as PriceType)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="close">Close</SelectItem><SelectItem value="typical">Typical (H+L+C)/3</SelectItem></SelectContent>
                </Select>
              </div>
            </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-sm">Export</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" className="w-full" onClick={handleCsvExport}><Download className="mr-1.5 h-3.5 w-3.5" />Export CSV</Button>
            </CardContent></Card>
        </div>
      )}
    </div>
  );
}
