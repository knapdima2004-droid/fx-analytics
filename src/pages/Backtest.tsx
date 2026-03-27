import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useGlobalState } from '@/hooks/useGlobalState';
import { useBacktest, useAiAnalysis, useAiStatus } from '@/hooks/useApi';
import type { ModelType, BacktestResult, StatisticalTests, ReportItem } from '@/types';
import type { AiAnalysisResult } from '@/api/client';
import * as api from '@/api/client';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as ReTooltip, LineChart, Line, Cell, ReferenceLine, Legend } from 'recharts';
import { Loader2, Download, Brain, Sparkles, FileText, Info, Zap, Globe, Trophy, AlertTriangle, FileSpreadsheet, Square, History } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { downloadCsv, tableToCsv } from '@/utils/csv';
import { useEffect, useRef } from 'react';

const tooltipStyle = { backgroundColor: 'hsl(225,18%,10%)', border: '1px solid hsl(225,12%,15%)', borderRadius: '8px', color: 'hsl(210,15%,88%)' };
const ALL: ModelType[] = ['Naive', 'MovingAverage', 'ARIMA', 'Ridge', 'RandomForest', 'AIEnsemble'];

/** Unique color for each model */
const MODEL_COLORS: Record<string, string> = {
  Naive: '#6b7280',
  MovingAverage: '#3b82f6',
  ARIMA: '#8b5cf6',
  Ridge: '#f59e0b',
  RandomForest: '#10b981',
  AIEnsemble: '#0ea5e9',
};

/** Human-readable model descriptions */
const MODEL_DESC: Record<string, string> = {
  Naive: 'Baseline: next = last observed',
  MovingAverage: 'Average of last N values',
  ARIMA: 'Parametric time series model',
  Ridge: 'Linear regression with regularization',
  RandomForest: 'Ensemble of decision trees',
  AIEnsemble: 'AI-enhanced meta-prediction',
};

export default function Backtest() {
  const { pair, timeframe, dateRange } = useGlobalState();
  const [sel, setSel] = useState<ModelType[]>([...ALL]); // All selected by default
  const [tw, setTw] = useState(120);
  const [testW, setTestW] = useState(30);
  const [step, setStep] = useState(30);
  const [results, setResults] = useState<BacktestResult[] | null>(null);
  const [tests, setTests] = useState<StatisticalTests | null>(null);
  const [metric, setMetric] = useState<'mae' | 'rmse' | 'directionalAccuracy'>('rmse');
  const [rankBy, setRankBy] = useState<'mae' | 'rmse' | 'directionalAccuracy'>('rmse');
  const [wm, setWm] = useState<ModelType>('AIEnsemble');
  const [wmMetric, setWmMetric] = useState<'mae' | 'rmse'>('mae');
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progressInfo, setProgressInfo] = useState<{ currentModel?: string; modelIndex?: number; totalModels?: number; currentWindow?: number; totalWindows?: number; aiEstimateSec?: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bm = useBacktest();
  const aiMutation = useAiAnalysis();
  const { data: aiStatus } = useAiStatus();
  const navigate = useNavigate();

  const toggle = (m: ModelType) => setSel(p => p.includes(m) ? p.filter(x => x !== m) : [...p, m]);
  const selectAll = () => setSel([...ALL]);
  const selectRecommended = () => setSel(['Naive', 'ARIMA', 'RandomForest', 'AIEnsemble']);

  // Load last backtest results from history on mount
  useEffect(() => {
    (async () => {
      try {
        const history = await api.backtestHistory(pair.symbol, timeframe);
        if (history.length > 0) {
          const last = history[0];
          setResults(last.results as any);
          setTests(last.tests as any);
          setRunId(last.id);
          if (last.results?.length) setWm(last.results[0].model as ModelType);
        }
      } catch { /* ignore - no history */ }
    })();
  }, [pair.symbol, timeframe]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const run = async () => {
    setIsRunning(true);
    setAiResult(null);
    try {
      const { taskId: tid } = await api.backtestStart({
        pair: pair.symbol, timeframe, start: dateRange.start, end: dateRange.end,
        models: sel, windowTrainDays: tw, windowTestDays: testW, stepDays: step,
      });
      setTaskId(tid);

      // Poll for results
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.backtestStatus(tid) as any;
          if (status.progress) setProgressInfo(status.progress);
          if (status.status === 'completed' && status.results && status.tests) {
            if (pollRef.current) clearInterval(pollRef.current);
            setResults(status.results);
            setTests(status.tests as any);
            if (status.runId) setRunId(status.runId);
            if (status.results.length) setWm(status.results[0].model as ModelType);
            setIsRunning(false);
            setTaskId(null);
            setProgressInfo(null);
            toast.success('Backtest complete');
          } else if (status.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsRunning(false);
            setTaskId(null);
            setProgressInfo(null);
            toast.error(status.error || 'Backtest failed');
          } else if (status.status === 'cancelled') {
            if (pollRef.current) clearInterval(pollRef.current);
            setIsRunning(false);
            setTaskId(null);
            setProgressInfo(null);
            toast.info('Backtest cancelled');
          }
        } catch { /* continue polling */ }
      }, 2000);
    } catch (e: any) {
      setIsRunning(false);
      toast.error(e?.message || 'Failed to start backtest');
    }
  };

  const handleStop = async () => {
    if (!taskId) return;
    try {
      await api.backtestCancel(taskId);
      if (pollRef.current) clearInterval(pollRef.current);
      setIsRunning(false);
      setTaskId(null);
      toast.info('Backtest stopped');
    } catch {
      toast.error('Failed to cancel backtest');
    }
  };

  const runAiAnalysis = () => {
    if (!results || !tests) return;
    aiMutation.mutate({
      pair: pair.symbol,
      timeframe,
      start: dateRange.start,
      end: dateRange.end,
      backtestResults: results,
      statisticalTests: tests,
      language: 'en',
    }, {
      onSuccess: d => {
        setAiResult(d);
        toast.success('Analysis complete');
      },
      onError: () => toast.error('Analysis failed'),
    });
  };

  const [excelLoading, setExcelLoading] = useState(false);

  const [reportLoading, setReportLoading] = useState(false);

  /** Generate full report from backtest results (uses stored run to avoid re-computation) */
  const handleGenerateReport = async (lang: string) => {
    setReportLoading(true);
    toast.info('Generating full HTML report...');
    try {
      let report: ReportItem;
      if (runId) {
        // Use saved backtest run — no re-computation
        report = await api.generateReportFromRun({ runId, language: lang, includeCharts: true, includeTests: true });
      } else {
        // Fallback: generate from scratch (shouldn't happen normally)
        report = await api.generateReport({
          pair: pair.symbol,
          timeframe: timeframe as any,
          start: dateRange.start,
          end: dateRange.end,
          models: sel as any[],
          includeCharts: true,
          includeTests: true,
          language: lang,
        });
      }
      toast.success('Report ready! Downloading...');
      try {
        const blob = await api.downloadReport(report.id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${pair.symbol}_${timeframe}_${report.id.slice(0, 8)}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch { /* user can go to reports page */ }
    } catch (e: any) {
      toast.error(e?.message || 'Report generation failed');
    } finally {
      setReportLoading(false);
    }
  };

  /** Generate Excel report (uses stored run to avoid re-computation) */
  const handleGenerateExcel = async (lang: string) => {
    setExcelLoading(true);
    toast.info('Generating Excel report...');
    try {
      let report: ReportItem;
      if (runId) {
        report = await api.generateReportFromRun({ runId, language: lang, includeCharts: true, includeTests: true });
      } else {
        report = await api.generateReport({
          pair: pair.symbol,
          timeframe: timeframe as any,
          start: dateRange.start,
          end: dateRange.end,
          models: sel as any[],
          includeCharts: true,
          includeTests: true,
          language: lang,
        });
      }
      if (!report.hasExcel) {
        toast.error('Excel report was not generated');
        return;
      }
      const blob = await api.downloadReportExcel(report.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${pair.symbol}_${timeframe}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Excel report downloaded!');
    } catch (e: any) {
      toast.error(e?.message || 'Excel report failed');
    } finally {
      setExcelLoading(false);
    }
  };

  const ranked = useMemo(() => {
    if (!results) return [];
    return [...results].sort((a, b) => {
      if (rankBy === 'directionalAccuracy') return b.metrics[rankBy] - a.metrics[rankBy];
      return a.metrics[rankBy] - b.metrics[rankBy];
    }).map((r, i) => ({ ...r, rank: i + 1 }));
  }, [results, rankBy]);

  // Smart best-model: consider both RMSE and DA vs Naive baseline
  const bestModel = useMemo(() => {
    if (!ranked.length) return null;
    const naiveDA = ranked.find(r => r.model === 'Naive')?.metrics.directionalAccuracy ?? 0.5;
    // Best by RMSE among models with DA >= Naive
    const viable = ranked.filter(r => r.metrics.directionalAccuracy >= naiveDA);
    if (viable.length > 0) return viable[0]; // already sorted by RMSE
    // Fallback: best DA model
    return [...ranked].sort((a, b) => b.metrics.directionalAccuracy - a.metrics.directionalAccuracy)[0];
  }, [ranked]);
  const wr = results?.find(r => r.model === wm);

  const handleExportCsv = () => {
    if (!results) return;
    const headers = ['Model', 'MAE', 'RMSE', 'Directional Accuracy', 'Rank'];
    const rows = ranked.map(r => [r.model, r.metrics.mae, r.metrics.rmse, (r.metrics.directionalAccuracy * 100).toFixed(1) + '%', r.rank]);
    downloadCsv(tableToCsv(headers, rows as any), `backtest_${pair.symbol}.csv`);
    if (wr) {
      const wHeaders = ['Model', 'TrainStart', 'TrainEnd', 'TestStart', 'TestEnd', 'MAE', 'RMSE', 'Dir.Acc.'];
      const wRows = wr.windows.map(w => [wr.model, w.trainStart, w.trainEnd, w.testStart, w.testEnd, w.mae, w.rmse, (w.directionalAccuracy * 100).toFixed(1) + '%']);
      downloadCsv(tableToCsv(wHeaders, wRows as any), `backtest_windows_${pair.symbol}_${wm}.csv`);
    }
    toast.success('CSV exported');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Full Analysis</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Compare all prediction models using walk-forward backtest with statistical verification.
          For training individual models and generating forecasts, use{' '}
          <button onClick={() => navigate('/prediction')} className="text-primary hover:underline font-medium">Forecast</button>.
        </p>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Configuration</CardTitle>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {pair.base}/{pair.quote} | {timeframe} | {dateRange.start} to {dateRange.end}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Models selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Models</Label>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={selectAll}>All</Button>
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={selectRecommended}>Rec.</Button>
                </div>
              </div>
              {ALL.map(m => (
                <Tooltip key={m}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={sel.includes(m)} onCheckedChange={() => toggle(m)} />
                      <span className={`text-sm ${m === 'AIEnsemble' ? 'font-medium' : ''}`}>
                        {m === 'AIEnsemble' && <Sparkles className="h-3 w-3 inline mr-1 text-primary" />}
                        {m}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">{MODEL_DESC[m]}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* Train Window */}
            <div className="space-y-2">
              <Label className="text-sm">Train Window (bars)</Label>
              <Input type="number" value={tw} onChange={e => setTw(+e.target.value)} className="h-8" />
              <p className="text-[10px] text-muted-foreground">
                Number of data points used to train each model in each walk-forward step
              </p>
            </div>

            {/* Test Window */}
            <div className="space-y-2">
              <Label className="text-sm">Test Window (bars)</Label>
              <Input type="number" value={testW} onChange={e => setTestW(+e.target.value)} className="h-8" />
              <p className="text-[10px] text-muted-foreground">
                Number of data points to predict and evaluate per step
              </p>
            </div>

            {/* Step */}
            <div className="space-y-2">
              <Label className="text-sm">Step (bars)</Label>
              <Input type="number" value={step} onChange={e => setStep(+e.target.value)} className="h-8" />
              <p className="text-[10px] text-muted-foreground">
                How far the window slides forward between iterations
              </p>
            </div>
          </div>

          {sel.includes('AIEnsemble') && ['1M', '5M', '15M'].includes(timeframe) && (
            <div className="mt-3 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-md">
              <p className="text-xs text-amber-400">
                <strong>Note:</strong> AIEnsemble on short timeframes ({timeframe}) may take <strong>5–15 minutes</strong>.
                For faster results, use 1D or 1H timeframe, or reduce the date range.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border/50">
            {!isRunning ? (
              <Button onClick={run} disabled={isRunning || !sel.length}>
                {`Run Backtest (${sel.length} models)`}
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleStop}>
                <Square className="mr-2 h-4 w-4 fill-current" />
                Stop
              </Button>
            )}
            <Button variant="outline" onClick={handleExportCsv} disabled={!results}>
              <Download className="mr-1.5 h-3.5 w-3.5" />Export CSV
            </Button>
            {aiStatus?.available && results && tests && (
              <Button variant="secondary" onClick={runAiAnalysis} disabled={aiMutation.isPending}>
                {aiMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Brain className="mr-1.5 h-3.5 w-3.5" />}
                AI Interpretation
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {isRunning && (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium">Running walk-forward backtest...</p>
                  <p className="text-xs text-muted-foreground">
                    {progressInfo?.currentModel
                      ? `Model ${progressInfo.modelIndex}/${progressInfo.totalModels}: ${progressInfo.currentModel} — window ${progressInfo.currentWindow}/${progressInfo.totalWindows}`
                      : `Training ${sel.length} models across multiple time windows.`}
                    {progressInfo?.currentModel === 'AIEnsemble' && progressInfo?.aiEstimateSec
                      ? ` (AI ~${Math.ceil(progressInfo.aiEstimateSec / 60)} min remaining)`
                      : ''}
                  </p>
                </div>
              </div>
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />Stop
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!results && !isRunning && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12 space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Info className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-muted-foreground font-medium">No backtest results yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Select models and click <strong>"Run Backtest"</strong> to evaluate prediction accuracy. 
                  For a quick start, use the default settings (all 6 models selected).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {results && results.length > 0 && <>
        {/* Best Model Highlight */}
        {bestModel && (() => {
          const bda = bestModel.metrics.directionalAccuracy * 100;
          const naiveDA = (ranked.find(r => r.model === 'Naive')?.metrics.directionalAccuracy ?? 0.5) * 100;
          const beatsNaive = bda >= naiveDA;
          const aboveRandom = bda > 50;
          return (
            <Card className={`border-primary/30 bg-gradient-to-r ${beatsNaive ? 'from-primary/[0.04]' : 'from-amber-500/[0.04]'} to-transparent`}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <Trophy className={`h-5 w-5 ${beatsNaive ? 'text-primary' : 'text-amber-500'}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      Best overall model: <strong className="text-primary">{bestModel.model}</strong>
                      {!beatsNaive && <span className="text-amber-500 ml-2 text-xs">(DA below Naive baseline)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      MAE: {bestModel.metrics.mae.toFixed(6)} | RMSE: {bestModel.metrics.rmse.toFixed(6)} | Dir. Accuracy: {bda.toFixed(1)}%
                      {bda < 50 && ' ⚠ Worse than random'}
                      {!aboveRandom && bda >= 48 && ' ⚠ Near random chance'}
                    </p>
                    {!beatsNaive && (
                      <p className="text-xs text-amber-600 mt-1">
                        Note: No model significantly outperforms the Naive baseline (DA {naiveDA.toFixed(1)}%).
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* AI Analysis Results */}
        {aiResult && (
          <Card className="border-primary/30 bg-primary/[0.02]">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Statistical Interpretation</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {aiResult.summary && (
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-primary">Summary</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{aiResult.summary}</p>
                </div>
              )}
              {aiResult.model_comparison && (
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-primary">Model Comparison</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{aiResult.model_comparison}</p>
                </div>
              )}
              {aiResult.test_interpretation && (
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-primary">Statistical Test Interpretation</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{aiResult.test_interpretation}</p>
                </div>
              )}
              {aiResult.recommendation && (
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-primary">Recommendation</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{aiResult.recommendation}</p>
                </div>
              )}
              {aiResult.conclusion && (
                <div className="space-y-1 border-t pt-3 mt-3 border-primary/20">
                  <h4 className="font-medium text-sm text-primary">Thesis Conclusion</h4>
                  <p className="text-sm leading-relaxed italic">{aiResult.conclusion}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {aiMutation.isPending && (
          <Card className="border-primary/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Generating statistical interpretation...</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Table */}
        <Card><CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Summary</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rank by:</span>
            <Select value={rankBy} onValueChange={v => setRankBy(v as any)}><SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rmse">RMSE</SelectItem><SelectItem value="mae">MAE</SelectItem><SelectItem value="directionalAccuracy">Dir. Accuracy</SelectItem></SelectContent></Select>
          </div>
        </CardHeader>
          <CardContent><table className="w-full text-sm"><thead><tr className="border-b border-border"><th className="text-left py-2 text-muted-foreground font-medium">Model</th><th className="text-right py-2 text-muted-foreground font-medium">MAE</th><th className="text-right py-2 text-muted-foreground font-medium">RMSE</th><th className="text-right py-2 text-muted-foreground font-medium">Dir. Acc.</th><th className="text-right py-2 text-muted-foreground font-medium">Rank</th></tr></thead>
            <tbody>{ranked.map(r => {
              const isBest = bestModel && r.model === bestModel.model;
              const lowDA = r.metrics.directionalAccuracy < 0.4;
              const naiveDA = ranked.find(x => x.model === 'Naive')?.metrics.directionalAccuracy ?? 0.5;
              const belowNaive = r.metrics.directionalAccuracy < naiveDA;
              return (
                <tr key={r.model} className={`border-b border-border/30 ${isBest ? 'bg-primary/[0.03]' : ''}`}>
                  <td className="py-2 font-medium">
                    <div className="flex items-center gap-1.5">
                      {isBest && <Trophy className="h-3.5 w-3.5 text-primary" />}
                      {r.model === 'AIEnsemble' && <Sparkles className="h-3 w-3 text-primary" />}
                      {r.model}
                      {lowDA && (
                        <Tooltip><TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-500" /></TooltipTrigger>
                          <TooltipContent>Directional accuracy below 40% — unreliable</TooltipContent></Tooltip>
                      )}
                      {!lowDA && belowNaive && r.model !== 'Naive' && (
                        <Tooltip><TooltipTrigger><span className="text-amber-500 text-xs">↓</span></TooltipTrigger>
                          <TooltipContent>DA below Naive baseline ({(naiveDA * 100).toFixed(1)}%)</TooltipContent></Tooltip>
                      )}
                    </div>
                  </td>
                  <td className="text-right py-2 font-mono">{r.metrics.mae.toFixed(6)}</td>
                  <td className="text-right py-2 font-mono">{r.metrics.rmse.toFixed(6)}</td>
                  <td className={`text-right py-2 font-mono ${r.metrics.directionalAccuracy >= 0.55 ? 'text-[#22c55e]' : r.metrics.directionalAccuracy < 0.50 ? 'text-[#ef4444]' : ''}`}>
                    {(r.metrics.directionalAccuracy * 100).toFixed(1)}%
                  </td>
                  <td className="text-right py-2"><Badge variant={isBest ? 'default' : 'outline'}>#{r.rank}</Badge></td>
                </tr>
              );
            })}</tbody></table>
            <p className="text-xs text-muted-foreground mt-3">
              ★ Best model selected by lowest RMSE among models with DA ≥ Naive baseline.
              {ranked.some(r => r.metrics.directionalAccuracy < 0.50 && r.model !== 'Naive') &&
                ' Models with DA < 50% perform worse than random chance at direction prediction.'}
            </p>
          </CardContent></Card>

        {/* Metrics Comparison Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Metrics Comparison</CardTitle>
            <Select value={metric} onValueChange={v => setMetric(v as any)}>
              <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mae">MAE (lower = better)</SelectItem>
                <SelectItem value="rmse">RMSE (lower = better)</SelectItem>
                <SelectItem value="directionalAccuracy">Dir. Accuracy (higher = better)</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ranked.map(r => ({
                model: r.model,
                value: metric === 'directionalAccuracy' ? r.metrics[metric] * 100 : r.metrics[metric],
              }))}>
                <XAxis dataKey="model" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                {metric === 'directionalAccuracy' && (
                  <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="5 5" label={{ value: '50% random', fill: '#ef4444', fontSize: 10 }} />
                )}
                <ReTooltip
                  contentStyle={tooltipStyle}
                  formatter={(val: number) => [metric === 'directionalAccuracy' ? `${val.toFixed(1)}%` : val.toFixed(6), metric === 'directionalAccuracy' ? 'Dir. Accuracy' : metric.toUpperCase()]}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {ranked.map((r) => (
                    <Cell key={r.model} fill={MODEL_COLORS[r.model] || '#0ea5e9'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {metric === 'directionalAccuracy' && (
              <p className="text-[10px] text-muted-foreground text-center mt-1">Red dashed line = 50% random baseline. Above = better than random guessing.</p>
            )}
          </CardContent>
        </Card>

        {/* Rolling Windows + Statistical Tests Tabs */}
        <Card><Tabs defaultValue="windows"><CardHeader className="pb-0"><TabsList><TabsTrigger value="windows">Rolling Windows</TabsTrigger><TabsTrigger value="tests">Statistical Tests</TabsTrigger></TabsList></CardHeader>
          <CardContent className="pt-4">
            <TabsContent value="windows" className="mt-0 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={wm} onValueChange={v => setWm(v as ModelType)}>
                  <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{sel.map(m => (
                    <SelectItem key={m} value={m}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MODEL_COLORS[m] || '#0ea5e9' }} />
                        {m}
                      </div>
                    </SelectItem>
                  ))}</SelectContent>
                </Select>
                <Select value={wmMetric} onValueChange={v => setWmMetric(v as any)}>
                  <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="mae">MAE</SelectItem><SelectItem value="rmse">RMSE</SelectItem></SelectContent>
                </Select>
              </div>
              {wr && wr.windows.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={wr.windows.map((w, i) => ({
                      w: `W${i + 1}`,
                      [wmMetric]: w[wmMetric as 'mae' | 'rmse'],
                      da: w.directionalAccuracy * 100,
                    }))}>
                      <XAxis dataKey="w" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
                      <Line yAxisId="left" type="monotone" dataKey={wmMetric} stroke={MODEL_COLORS[wm] || '#0ea5e9'} dot={{ r: 3, fill: MODEL_COLORS[wm] || '#0ea5e9' }} strokeWidth={2} name={wmMetric.toUpperCase()} />
                      <Line yAxisId="right" type="monotone" dataKey="da" stroke="#f59e0b" dot={{ r: 3, fill: '#f59e0b' }} strokeWidth={2} strokeDasharray="5 5" name="Dir. Acc. %" />
                      <ReTooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="max-h-[250px] overflow-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border">
                          <th className="text-center py-2 px-2 text-muted-foreground font-medium w-12">#</th>
                          <th className="text-left py-2 px-2 text-muted-foreground font-medium">Train Period</th>
                          <th className="text-left py-2 px-2 text-muted-foreground font-medium">Test Period</th>
                          <th className="text-right py-2 px-2 text-muted-foreground font-medium">MAE</th>
                          <th className="text-right py-2 px-2 text-muted-foreground font-medium">RMSE</th>
                          <th className="text-right py-2 px-2 text-muted-foreground font-medium">Dir. Acc.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wr.windows.map((w, i) => {
                          const da = w.directionalAccuracy * 100;
                          return (
                            <tr key={i} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                              <td className="text-center py-1.5 px-2 text-muted-foreground">{i + 1}</td>
                              <td className="py-1.5 px-2">{w.trainStart} — {w.trainEnd}</td>
                              <td className="py-1.5 px-2">{w.testStart} — {w.testEnd}</td>
                              <td className="text-right py-1.5 px-2 font-mono">{w.mae.toFixed(6)}</td>
                              <td className="text-right py-1.5 px-2 font-mono">{w.rmse.toFixed(6)}</td>
                              <td className={`text-right py-1.5 px-2 font-mono font-medium ${da >= 55 ? 'text-green-500' : da < 50 ? 'text-red-500' : 'text-amber-500'}`}>
                                {da.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : wr && wr.windows.length === 0 ? (
                <p className="text-muted-foreground text-sm">No windows available for this model.</p>
              ) : (
                <p className="text-muted-foreground text-sm">Select a model from the dropdown above to see its window-by-window performance.</p>
              )}
            </TabsContent>
            <TabsContent value="tests" className="mt-0 space-y-4">
              {tests ? <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card><CardHeader className="pb-2"><CardTitle className="text-sm">ADF Test</CardTitle></CardHeader><CardContent className="text-sm space-y-1"><div>Statistic: <span className="font-mono">{tests.adf.statistic}</span></div><div>p-value: <span className="font-mono">{tests.adf.pValue < 0.001 ? '< 0.001' : tests.adf.pValue}</span></div><Badge variant={tests.adf.isStationary ? 'default' : 'destructive'}>Stationary: {tests.adf.isStationary ? 'Yes' : 'No'}</Badge></CardContent></Card>
                  <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Ljung-Box</CardTitle></CardHeader><CardContent className="text-sm space-y-1"><div>Statistic: <span className="font-mono">{tests.ljungBox.statistic}</span></div><div>p-value: <span className="font-mono">{tests.ljungBox.pValue < 0.001 ? '< 0.001' : tests.ljungBox.pValue}</span></div><Badge variant={tests.ljungBox.noAutocorrelation ? 'default' : 'destructive'}>No Autocorrelation: {tests.ljungBox.noAutocorrelation ? 'Yes' : 'No'}</Badge></CardContent></Card>
                  {tests.dieboldMariano && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Diebold-Mariano</CardTitle></CardHeader><CardContent className="text-sm space-y-1"><div>Statistic: <span className="font-mono">{tests.dieboldMariano.statistic}</span></div><div>p-value: <span className="font-mono">{tests.dieboldMariano.pValue < 0.001 ? '< 0.001' : tests.dieboldMariano.pValue}</span></div>{tests.dieboldMariano.betterModel && <Badge>Better: {tests.dieboldMariano.betterModel}</Badge>}</CardContent></Card>}
                </div>
                <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-md space-y-2">
                  <p><strong>Interpretation:</strong></p>
                  <p>A p-value below 0.05 indicates statistical significance at the 5% level, meaning the null hypothesis can be rejected with 95% confidence.</p>
                  <p><strong>ADF (Augmented Dickey-Fuller):</strong> Tests whether the time series has a unit root (is non-stationary). A low p-value (below 0.05) suggests the series is stationary, which is generally desirable for time series modeling.</p>
                  <p><strong>Ljung-Box:</strong> Tests whether the residuals exhibit autocorrelation. A high p-value (above 0.05) indicates no significant autocorrelation, suggesting the model adequately captures the temporal dependencies.</p>
                  {tests.dieboldMariano && <p><strong>Diebold-Mariano:</strong> Compares the predictive accuracy of two competing models. A low p-value suggests a statistically significant difference in forecast performance between the models.</p>}
                </div>
              </> : <p className="text-muted-foreground text-sm">No statistical test results available.</p>}
            </TabsContent>
          </CardContent></Tabs></Card>

        {/* Generate Report CTA */}
        <Card className="border-dashed border-2">
          <CardContent className="pt-6 space-y-4">
            {/* HTML Report */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <h3 className="font-medium">HTML Report</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Beautiful HTML report with charts, backtest metrics, statistical tests, and AI-powered interpretation.
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleGenerateReport('sk')} disabled={reportLoading}>
                  {reportLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
                  {reportLoading ? 'Generating...' : 'SK Report'}
                </Button>
                <Button variant="outline" onClick={() => handleGenerateReport('en')} disabled={reportLoading}>
                  EN Report
                </Button>
              </div>
            </div>

            <div className="border-t border-border/50" />

            {/* Excel Report */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-green-600" />
                  <h3 className="font-medium">Excel Report (.xlsx)</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Detailed spreadsheet with all data, model comparison charts, walk-forward windows, and statistical tests. 
                  Ideal for further analysis and thesis appendix.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => handleGenerateExcel('sk')} disabled={excelLoading}>
                  {excelLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                  {excelLoading ? 'Generating...' : 'SK Excel'}
                </Button>
                <Button variant="outline" onClick={() => handleGenerateExcel('en')} disabled={excelLoading}>
                  EN Excel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </>}
    </div>
  );
}
