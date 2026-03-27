import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { useGlobalState } from '@/hooks/useGlobalState';
import { useQueryClient } from '@tanstack/react-query';
import { useTrainModel, useModels, useForecast } from '@/hooks/useApi';
import * as api from '@/api/client';
import type { ModelType, TrainResponse, ForecastPoint } from '@/types';
import { ComposedChart, Line, Area, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { Loader2, Trash2, Save, FolderOpen, Info, ArrowRight, Sparkles, FileSpreadsheet, Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadForecastExcel } from '@/api/client';
import { useNavigate } from 'react-router-dom';

const tooltipStyle = { backgroundColor: 'hsl(225,18%,10%)', border: '1px solid hsl(225,12%,15%)', borderRadius: '8px', color: 'hsl(210,15%,88%)' };
const MODELS: ModelType[] = ['Naive', 'MovingAverage', 'ARIMA', 'Ridge', 'RandomForest', 'AIEnsemble'];
const ML: ModelType[] = ['Ridge', 'RandomForest'];

/** Model descriptions for the user */
const MODEL_DESC: Record<string, { short: string; detail: string }> = {
  Naive: {
    short: 'Simplest baseline',
    detail: 'Predicts that the next price will be exactly the same as the last known price. This is the simplest possible model — any useful model should beat it.',
  },
  MovingAverage: {
    short: 'Average of recent values',
    detail: 'Calculates the average of the last N prices and uses it as the prediction. Helps smooth out short-term noise. The "Window Size" parameter controls how many recent prices to average.',
  },
  ARIMA: {
    short: 'Time-series statistical model',
    detail: 'Auto-Regressive Integrated Moving Average — a classical statistical model that finds patterns in how prices change over time. The parameters (p, d, q) control the complexity. Enable "Auto" to let the model find the best parameters automatically.',
  },
  Ridge: {
    short: 'Regularized linear regression',
    detail: 'A machine learning model that predicts future prices based on technical features (past returns, SMA, EMA, RSI). "Alpha" controls how much the model is regularized (higher = simpler model, less overfitting).',
  },
  RandomForest: {
    short: 'Ensemble of decision trees',
    detail: 'Creates many decision trees and combines their predictions. Can discover non-linear relationships between technical indicators and future price movements.',
  },
  AIEnsemble: {
    short: 'AI-enhanced meta-model',
    detail: 'Combines predictions from all base models (Naive, MA, ARIMA, Ridge, RF) with technical indicators, then uses AI to produce a final prediction. Aims to leverage the strengths of each model.',
  },
};

/** Explanation for prediction targets */
const TARGET_DESC: Record<string, { label: string; desc: string }> = {
  close: {
    label: 'Close Price',
    desc: 'The model predicts the actual future price value (e.g., 1.0425). Easier to understand, but prices are non-stationary which can reduce accuracy.',
  },
  logreturn: {
    label: 'Log Return',
    desc: 'The model predicts the percentage change (log return) between consecutive bars. Mathematically more suitable for financial time series, then converts back to price. Recommended for ARIMA.',
  },
};

interface ConfigPreset {
  name: string;
  model: ModelType;
  target: string;
  feat: any;
  hp: any;
}

function loadPresets(): ConfigPreset[] {
  try { const s = localStorage.getItem('fx_presets'); return s ? JSON.parse(s) : []; } catch { return []; }
}
function savePresets(p: ConfigPreset[]) { localStorage.setItem('fx_presets', JSON.stringify(p)); }

export default function Prediction() {
  const { pair, timeframe, dateRange } = useGlobalState();
  const navigate = useNavigate();
  const [mt, setMt] = useState<ModelType>('ARIMA');
  const [target, setTarget] = useState<'close' | 'logreturn'>('close');
  const [feat, setFeat] = useState({ lagReturns: true, numLags: 5, sma: true, ema: true, rsi: false, macd: false });
  const [hp, setHp] = useState({ p: 1, d: 1, q: 1, auto: false, alpha: 1.0, nEst: 100, maxD: 10, maWindow: 10 });
  const [horizon, setHorizon] = useState(30);
  const [selModel, setSelModel] = useState<string | null>(null);
  const [fcData, setFcData] = useState<ForecastPoint[] | null>(null);
  const [trainRes, setTrainRes] = useState<TrainResponse | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [presets, setPresets] = useState<ConfigPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const trainM = useTrainModel();
  const fcM = useForecast();
  const qc = useQueryClient();
  const { data: models } = useModels();
  const isML = ML.includes(mt);

  const handleTrain = () => {
    trainM.mutate({
      pair: pair.symbol, timeframe, start: dateRange.start, end: dateRange.end, model: mt,
      target: target === 'logreturn' ? 'log_return' : 'close',
      features: isML ? feat : undefined,
      hyperparams: mt === 'ARIMA' ? { p: hp.p, d: hp.d, q: hp.q, auto: hp.auto }
        : mt === 'Ridge' ? { alpha: hp.alpha }
        : mt === 'RandomForest' ? { n_estimators: hp.nEst, max_depth: hp.maxD }
        : mt === 'MovingAverage' ? { window: hp.maWindow }
        : undefined,
    }, {
      onSuccess: r => { setTrainRes(r); setSelModel(r.modelId); toast.success('Model trained'); },
      onError: (err: any) => {
        const msg = err?.message || 'Training failed';
        toast.error(msg, { duration: 6000 });
      },
    });
  };

  const handleForecast = () => {
    if (!selModel) return;
    fcM.mutate({ modelId: selModel, horizon }, {
      onSuccess: d => { setFcData(d); toast.success('Forecast generated'); },
      onError: (err: any) => {
        const msg = err?.message || 'Forecast failed';
        toast.error(msg, { duration: 6000 });
      },
    });
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) { toast.error('Name required'); return; }
    const p: ConfigPreset = { name: presetName.trim(), model: mt, target, feat, hp };
    const updated = [...presets.filter(x => x.name !== p.name), p];
    setPresets(updated);
    savePresets(updated);
    setSaveOpen(false);
    setPresetName('');
    toast.success('Configuration saved');
  };

  const handleLoadPreset = (name: string) => {
    const p = presets.find(x => x.name === name);
    if (!p) return;
    setMt(p.model); setTarget(p.target as any); setFeat(p.feat); setHp(p.hp);
    toast.success(`Loaded "${name}"`);
  };

  const handleDeletePreset = (name: string) => {
    const updated = presets.filter(x => x.name !== name);
    setPresets(updated);
    savePresets(updated);
    toast.success('Preset deleted');
  };

  const handleDownloadExcel = async () => {
    if (!selModel) return;
    setDownloading(true);
    try {
      const blob = await downloadForecastExcel(selModel, horizon);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `forecast_${pair.symbol}_${mt}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Excel report downloaded');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate Excel report');
    } finally {
      setDownloading(false);
    }
  };

  const bandData = fcData?.map(d => ({ ...d, lower: d.lower, upper: d.upper }));

  // Determine if forecast is essentially flat (all predicted values very close)
  const isFlatForecast = (() => {
    if (!fcData || fcData.length < 2) return false;
    const vals = fcData.map(d => d.predicted);
    const range = Math.max(...vals) - Math.min(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return avg !== 0 && range / Math.abs(avg) < 0.0001; // less than 0.01% variation
  })();

  // Compute explicit Y-axis domain from actual data values (not from stacked bandWidth)
  const yDomain: [number, number] | undefined = (() => {
    if (!fcData || fcData.length === 0) return undefined;
    const allVals = fcData.flatMap(d => [d.predicted, d.lower, d.upper].filter((v): v is number => v != null && !isNaN(v)));
    if (allVals.length === 0) return undefined;
    const yMin = Math.min(...allVals);
    const yMax = Math.max(...allVals);
    const padding = Math.max((yMax - yMin) * 0.15, yMax * 0.0005);
    return [yMin - padding, yMax + padding];
  })();

  return (
    <div className="space-y-6">
      {/* Header with explanation */}
      <div>
        <h2 className="text-2xl font-bold">Forecast</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Train a single model on historical data and predict future prices.
          This is for exploring individual models. For full comparison of all models, use{' '}
          <button onClick={() => navigate('/backtest')} className="text-primary hover:underline font-medium">Analysis</button>.
        </p>
      </div>

      {/* How it works guide */}
      <Card className="border-dashed">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-4">
            <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">How it works:</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">1. Choose model</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="secondary">2. Train</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="secondary">3. Set horizon</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="secondary">4. Run forecast</Badge>
              </div>
              <p>
                Currently using <strong>{pair.base}/{pair.quote}</strong> ({timeframe}) data from {dateRange.start} to {dateRange.end}.
                Change pair, timeframe, or dates in the top bar.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Model Setup */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Step 1: Choose & Train Model</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Model Type</Label>
                <Select value={mt} onValueChange={v => setMt(v as ModelType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELS.map(m => (
                      <SelectItem key={m} value={m}>
                        <div className="flex items-center gap-2">
                          {m === 'AIEnsemble' && <Sparkles className="h-3 w-3 text-primary" />}
                          <span>{m}</span>
                          <span className="text-muted-foreground text-xs">— {MODEL_DESC[m]?.short}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="rounded-md bg-muted/50 border border-border/50 p-2.5 text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">{mt}:</span> {MODEL_DESC[mt]?.detail}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Prediction Target</Label>
                <div className="flex gap-4">
                  {(['close', 'logreturn'] as const).map(t => (
                    <label
                      key={t}
                      className={`flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 transition-colors ${
                        target === t ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      <input type="radio" checked={target === t} onChange={() => setTarget(t)} className="accent-primary" />
                      {TARGET_DESC[t].label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {TARGET_DESC[target].desc}
                </p>
              </div>

              {isML && (
                <div className="space-y-2 rounded-md border border-border/50 p-3">
                  <Label>Input Features (technical indicators)</Label>
                  <p className="text-xs text-muted-foreground mb-1">Select which technical indicators the ML model should use as input for making predictions:</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={feat.lagReturns} onCheckedChange={v => setFeat(f => ({ ...f, lagReturns: !!v }))} />
                      <span className="text-sm">Lag returns</span>
                      {feat.lagReturns && <Input type="number" value={feat.numLags} onChange={e => setFeat(f => ({ ...f, numLags: +e.target.value }))} className="h-7 w-20 text-sm" />}
                      <span className="text-[10px] text-muted-foreground">— past price changes as features</span>
                    </div>
                    <div className="flex items-center gap-2"><Checkbox checked={feat.sma} onCheckedChange={v => setFeat(f => ({ ...f, sma: !!v }))} /><span className="text-sm">SMA(20)</span><span className="text-[10px] text-muted-foreground">— Simple Moving Average (20 bars)</span></div>
                    <div className="flex items-center gap-2"><Checkbox checked={feat.ema} onCheckedChange={v => setFeat(f => ({ ...f, ema: !!v }))} /><span className="text-sm">EMA(50)</span><span className="text-[10px] text-muted-foreground">— Exponential Moving Average (50 bars)</span></div>
                    <div className="flex items-center gap-2"><Checkbox checked={feat.rsi} onCheckedChange={v => setFeat(f => ({ ...f, rsi: !!v }))} /><span className="text-sm">RSI(14)</span><span className="text-[10px] text-muted-foreground">— Relative Strength Index (overbought/oversold)</span></div>
                    <div className="flex items-center gap-2"><Checkbox checked={feat.macd} onCheckedChange={v => setFeat(f => ({ ...f, macd: !!v }))} /><span className="text-sm">MACD</span><span className="text-[10px] text-muted-foreground">— trend/momentum indicator</span></div>
                  </div>
                </div>
              )}

              {mt === 'ARIMA' && (
                <div className="space-y-2 rounded-md border border-border/50 p-3">
                  <div className="flex items-center justify-between">
                    <Label>ARIMA Parameters (p, d, q)</Label>
                    <div className="flex items-center gap-2"><Label className="text-xs text-muted-foreground">Auto-select</Label><Switch checked={hp.auto} onCheckedChange={v => setHp(h => ({ ...h, auto: v }))} /></div>
                  </div>
                  {hp.auto ? (
                    <p className="text-xs text-muted-foreground">The model will automatically find the best (p, d, q) parameters. This takes longer but usually gives better results.</p>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs text-muted-foreground">p (AR order)</Label>
                          <Input type="number" value={hp.p} onChange={e => setHp(h => ({ ...h, p: +e.target.value }))} className="h-7 text-sm" min={0} max={10} />
                        </div>
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs text-muted-foreground">d (differencing)</Label>
                          <Input type="number" value={hp.d} onChange={e => setHp(h => ({ ...h, d: +e.target.value }))} className="h-7 text-sm" min={0} max={3} />
                        </div>
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs text-muted-foreground">q (MA order)</Label>
                          <Input type="number" value={hp.q} onChange={e => setHp(h => ({ ...h, q: +e.target.value }))} className="h-7 text-sm" min={0} max={10} />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">p = how many past values to use, d = differencing order (1 for non-stationary data), q = moving average terms.</p>
                    </>
                  )}
                </div>
              )}
              {mt === 'Ridge' && (
                <div className="space-y-2 rounded-md border border-border/50 p-3">
                  <Label>Alpha (regularization strength)</Label>
                  <Input type="number" value={hp.alpha} onChange={e => setHp(h => ({ ...h, alpha: +e.target.value }))} className="h-8 text-sm" step="0.1" min={0.001} />
                  <p className="text-xs text-muted-foreground">Higher alpha = simpler model (less overfitting). Typical values: 0.1 to 10.0.</p>
                </div>
              )}
              {mt === 'RandomForest' && (
                <div className="space-y-2 rounded-md border border-border/50 p-3">
                  <Label>Model Complexity</Label>
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">Number of trees</Label>
                      <Input type="number" value={hp.nEst} onChange={e => setHp(h => ({ ...h, nEst: +e.target.value }))} className="h-7 text-sm" min={10} max={1000} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">Max depth</Label>
                      <Input type="number" value={hp.maxD} onChange={e => setHp(h => ({ ...h, maxD: +e.target.value }))} className="h-7 text-sm" min={1} max={50} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">More trees = more stable predictions (but slower). Lower depth = less overfitting.</p>
                </div>
              )}
              {mt === 'MovingAverage' && (
                <div className="space-y-2 rounded-md border border-border/50 p-3">
                  <Label>Window Size (number of bars to average)</Label>
                  <Input type="number" value={hp.maWindow} onChange={e => setHp(h => ({ ...h, maWindow: +e.target.value }))} className="h-8 text-sm" min={2} max={200} />
                  <p className="text-xs text-muted-foreground">Larger window = smoother prediction but slower to react to changes. Try 10-50 for daily data.</p>
                </div>
              )}

              {(() => {
                const days = Math.round((new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime()) / (1000 * 60 * 60 * 24));
                if (days < 30) return (
                  <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-2.5 text-xs text-yellow-600 dark:text-yellow-400">
                    ⚠ Selected date range is only <strong>{days} days</strong>. Models need at least 30 data points for training.
                    Expand the date range in the top bar (recommended: 6-12 months).
                  </div>
                );
                return null;
              })()}

              <Button onClick={handleTrain} disabled={trainM.isPending} className="w-full">
                {trainM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {trainM.isPending ? 'Training...' : 'Train Model'}
              </Button>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setSaveOpen(true)}><Save className="mr-1.5 h-3.5 w-3.5" />Save Config</Button>
                {presets.length > 0 && (
                  <Select onValueChange={handleLoadPreset}>
                    <SelectTrigger className="flex-1 h-8"><FolderOpen className="mr-1.5 h-3.5 w-3.5" /><SelectValue placeholder="Load..." /></SelectTrigger>
                    <SelectContent>{presets.map(p => (
                      <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                    ))}</SelectContent>
                  </Select>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Results */}
        <div className="space-y-4">
          {/* Training result */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Training Result</CardTitle></CardHeader>
            <CardContent>
              {trainM.isPending ? (
                <div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-40" /></div>
              ) : trainRes ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge>{trainRes.model}</Badge>
                    <span className="text-xs text-muted-foreground">trained at {new Date(trainRes.trainedAt).toLocaleString()}</span>
                  </div>
                  {trainRes.metricsPreview && (
                    <div className="flex gap-3">
                      <Badge variant="secondary">MAE: {trainRes.metricsPreview.mae}</Badge>
                      <Badge variant="secondary">RMSE: {trainRes.metricsPreview.rmse}</Badge>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Model is ready. Set horizon and click "Run Forecast" below.</p>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No model trained yet. Choose a model and click "Train Model".</p>
              )}
            </CardContent>
          </Card>

          {/* Forecast */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Step 2: Run Forecast</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label className="text-sm">Forecast Horizon</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" value={horizon} onChange={e => setHorizon(+e.target.value)} className="h-8 w-24 text-sm" min={1} max={365} />
                  <span className="text-xs text-muted-foreground">
                    {timeframe === '1D' ? 'trading days' : timeframe === '4H' ? '4-hour bars' : timeframe === '1H' ? 'hours' : `${timeframe} bars`}
                  </span>
                  <Button size="sm" onClick={handleForecast} disabled={!selModel || fcM.isPending}>
                    {fcM.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Run Forecast
                  </Button>
                </div>
                {/* Quick-set buttons */}
                <div className="flex gap-1.5 flex-wrap">
                  {(timeframe === '1D' ? [5, 10, 30, 60] : timeframe === '4H' ? [6, 12, 30, 60] : [12, 30, 60, 120]).map(h => (
                    <Button key={h} variant={horizon === h ? 'secondary' : 'outline'} size="sm" className="h-6 text-xs px-2"
                      onClick={() => setHorizon(h)}>
                      {h} {timeframe === '1D' ? 'days' : 'bars'}
                    </Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Predict the next <strong>{horizon}</strong> {timeframe === '1D' ? 'trading days' : `bars (${timeframe})`} of {pair.base}/{pair.quote}.
                {target === 'logreturn' && ' The model predicts log returns, which are converted back to price levels.'}
              </p>
              {!selModel && <p className="text-muted-foreground text-sm mt-2">Train a model first, or select one from "Saved Models" below.</p>}
              {fcData && fcData.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadExcel}
                  disabled={downloading || !selModel}
                  className="mt-2"
                >
                  {downloading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />}
                  {downloading ? 'Generating...' : 'Download Excel Report'}
                </Button>
              )}
              {fcM.isPending && <Skeleton className="h-[280px] w-full" />}
              {bandData && bandData.length > 0 && (
                <div className="space-y-2 mt-2">
                  {isFlatForecast && (
                    <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-2 text-xs text-yellow-600 dark:text-yellow-400">
                      The forecast appears nearly flat. This often happens with short-term log return predictions — the model expects minimal price change.
                      Try using "Close price" target or a longer horizon for more visible variation.
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground flex items-center justify-between">
                    <span>Forecast: {bandData[0]?.time} → {bandData[bandData.length - 1]?.time}</span>
                    {bandData[0]?.predicted && bandData[bandData.length - 1]?.predicted && (
                      <span className={`font-medium ${bandData[bandData.length - 1].predicted >= bandData[0].predicted ? 'text-green-500' : 'text-red-500'}`}>
                        {bandData[bandData.length - 1].predicted >= bandData[0].predicted ? '+' : ''}
                        {((bandData[bandData.length - 1].predicted - bandData[0].predicted) / bandData[0].predicted * 100).toFixed(4)}%
                      </span>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={bandData}>
                      <defs>
                        <linearGradient id="ciBand" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(190,85%,48%)" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="hsl(190,85%,48%)" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="upper" stroke="none" fill="url(#ciBand)" />
                      <Area type="monotone" dataKey="lower" stroke="none" fill="hsl(225,18%,7%)" />
                      <Line type="monotone" dataKey="upper" stroke="hsl(190,85%,48%)" strokeDasharray="4 4" strokeWidth={1} dot={false} strokeOpacity={0.4} name="Upper CI" />
                      <Line type="monotone" dataKey="lower" stroke="hsl(190,85%,48%)" strokeDasharray="4 4" strokeWidth={1} dot={false} strokeOpacity={0.4} name="Lower CI" />
                      <Line type="monotone" dataKey="predicted" stroke="hsl(190,85%,48%)" dot={{ r: 2, fill: 'hsl(190,85%,48%)' }} strokeWidth={2} />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#6b7280' }} angle={-30} textAnchor="end" height={50} />
                      <YAxis
                        domain={yDomain ?? ['auto', 'auto']}
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        tickFormatter={(v: number) => v.toFixed(4)}
                      />
                      <RTooltip contentStyle={tooltipStyle} formatter={(val: number, name: string) => [val.toFixed(6), name === 'predicted' ? 'Predicted' : name]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Saved models */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Saved Models</CardTitle></CardHeader>
            <CardContent>
              {!models || !models.length ? (
                <p className="text-muted-foreground text-sm">No trained models yet.</p>
              ) : (
                <div className="space-y-2">
                  {models.map(m => (
                    <div key={m.modelId} className={`flex items-center justify-between p-2 rounded border ${selModel === m.modelId ? 'border-primary bg-primary/5' : 'border-border'}`}>
                      <div className="text-sm">
                        <span className="font-medium">{m.model}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{m.modelId.slice(0, 8)}...</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant={selModel === m.modelId ? 'default' : 'ghost'} size="sm" onClick={() => setSelModel(m.modelId)}>
                          {selModel === m.modelId ? 'Selected' : 'Select'}
                        </Button>
                        <Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteId(m.modelId)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </TooltipTrigger><TooltipContent>Delete model</TooltipContent></Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Save Preset Dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save Configuration</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Preset Name</Label><Input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="My config..." /></div>
            {presets.length > 0 && <div className="space-y-1"><Label className="text-xs text-muted-foreground">Existing presets:</Label>{presets.map(p => (
              <div key={p.name} className="flex items-center justify-between text-sm py-1"><span>{p.name} ({p.model})</span><Button variant="ghost" size="sm" onClick={() => handleDeletePreset(p.name)}><Trash2 className="h-3 w-3" /></Button></div>
            ))}</div>}
          </div>
          <DialogFooter><Button onClick={handleSavePreset}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Model</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this model? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (!deleteId) return;
              try {
                await api.deleteModel(deleteId);
                qc.invalidateQueries({ queryKey: ['models'] });
                if (selModel === deleteId) setSelModel(null);
                toast.success('Model deleted');
              } catch { toast.error('Failed to delete model'); }
              setDeleteId(null);
            }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
