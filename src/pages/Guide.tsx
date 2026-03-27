import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Separator } from '@/components/ui/separator';
import { useGlobalState } from '@/hooks/useGlobalState';
import { CURRENCY_PAIRS, type CurrencyPair, type Timeframe } from '@/types';
import {
  BookOpen, TrendingUp, FlaskConical, ArrowRight, ArrowLeft,
  BarChart3, LayoutDashboard, FileText, ArrowRightLeft, Settings,
  Sparkles, Brain, LineChart, Shuffle, Target, Zap, Check,
  ChevronRight, Info, Database, Activity, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────── constants ────────────────────────── */

const TIMEFRAMES: { value: Timeframe; label: string; desc: string }[] = [
  { value: '1D', label: '1D', desc: 'Daily bars — best for long-term analysis' },
  { value: '4H', label: '4H', desc: '4-hour bars — intraday swing analysis' },
  { value: '1H', label: '1H', desc: '1-hour bars — short-term patterns' },
  { value: '30M', label: '30M', desc: '30-minute bars' },
  { value: '15M', label: '15M', desc: '15-minute bars' },
  { value: '5M', label: '5M', desc: '5-minute bars — high frequency' },
  { value: '1M', label: '1M', desc: '1-minute bars — tick-level data' },
];

type GoalType = 'forecast' | 'backtest';

const MODELS = [
  { id: 'Naive', name: 'Naive', desc: 'Uses the last known price as the prediction. Simplest possible baseline.', icon: Target },
  { id: 'MovingAverage', name: 'Moving Average', desc: 'Predicts based on the average of recent N prices. Smooths out noise.', icon: Activity },
  { id: 'ARIMA', name: 'ARIMA', desc: 'Auto-Regressive Integrated Moving Average. Classical time-series model that captures trends and patterns.', icon: LineChart },
  { id: 'Ridge', name: 'Ridge Regression', desc: 'Linear regression with L2 regularization. Uses engineered features (lags, indicators).', icon: Zap },
  { id: 'RandomForest', name: 'Random Forest', desc: 'Ensemble of decision trees. Captures non-linear relationships in the data.', icon: Shuffle },
  { id: 'AIEnsemble', name: 'AI Ensemble', desc: 'Author\'s contribution: combines all model predictions with GPT-based contextual analysis for the final forecast.', icon: Brain, highlight: true },
] as const;

const PAGES = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, desc: 'Overview of the selected currency pair: current price, daily change, data summary, and quick stats.' },
  { path: '/chart', label: 'Chart', icon: BarChart3, desc: 'Interactive candlestick chart with technical indicators (SMA, EMA, RSI, MACD). Zoom and scroll through history.' },
  { path: '/prediction', label: 'Forecast', icon: TrendingUp, desc: 'Train a single prediction model and generate a future price forecast. Download detailed Excel reports.' },
  { path: '/backtest', label: 'Analysis', icon: FlaskConical, desc: 'Run walk-forward backtesting to compare all models on historical data. See which model performs best.' },
  { path: '/reports', label: 'Reports', icon: FileText, desc: 'Generate comprehensive HTML & Excel reports with metrics, charts, and statistical tests for all models.' },
  { path: '/converter', label: 'Converter', icon: ArrowRightLeft, desc: 'Real-time currency converter with live exchange rates. Rates update automatically every few seconds.' },
  { path: '/settings', label: 'Settings', icon: Settings, desc: 'Configure API connection, data preferences, and application settings.' },
];

/* ────────────────────────── component ────────────────────────── */

export default function Guide() {
  const navigate = useNavigate();
  const { setPair, setTimeframe } = useGlobalState();

  const [step, setStep] = useState(0);
  const [selPair, setSelPair] = useState<CurrencyPair>(CURRENCY_PAIRS[0]);
  const [selTf, setSelTf] = useState<Timeframe>('1D');
  const [selGoal, setSelGoal] = useState<GoalType | null>(null);
  const [selModel, setSelModel] = useState<string>('ARIMA');

  const canNext = () => {
    if (step === 0) return true;
    if (step === 1) return true;
    if (step === 2) return selGoal !== null;
    if (step === 3) return selGoal === 'backtest' || !!selModel;
    return true;
  };

  const handleGo = () => {
    setPair(selPair);
    setTimeframe(selTf);
    if (selGoal === 'forecast') navigate('/prediction');
    else navigate('/backtest');
  };

  const handleGoReport = () => {
    setPair(selPair);
    setTimeframe(selTf);
    navigate('/reports');
  };

  const TOTAL_STEPS = 5;

  return (
    <div className="space-y-10 max-w-5xl mx-auto pb-12">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <BookOpen className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">How It Works</h1>
            <p className="text-muted-foreground text-sm">
              Statistical processing and evaluation of selected currency pair data
            </p>
          </div>
        </div>

        <Card className="bg-muted/40 border-muted">
          <CardContent className="pt-5 pb-4 space-y-3">
            <p className="text-sm text-muted-foreground italic border-l-2 border-primary/40 pl-3">
              "Navrhnite sposob zberu udajov o vybranych menovych paroch z internetu.
              Navrhnite a statisticky overte mozne sposoby predikcie vyvoja vybraneho menoveho paru.
              Pre dany casovy interval statisticky overte vhodnost navrhneteho predikcneho algoritmu."
            </p>
            <p className="text-sm text-muted-foreground">
              This application collects real-time currency data, applies multiple prediction algorithms,
              and statistically evaluates their accuracy using walk-forward backtesting.
            </p>
          </CardContent>
        </Card>

        {/* Flow diagram */}
        <div className="flex items-center justify-center gap-2 flex-wrap py-2">
          {[
            { icon: Database, label: 'Collect Data' },
            { icon: BarChart3, label: 'Analyze' },
            { icon: TrendingUp, label: 'Predict' },
            { icon: FlaskConical, label: 'Evaluate' },
            { icon: FileText, label: 'Report' },
          ].map((item, i, arr) => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <div className="p-2 rounded-lg bg-primary/10">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
              </div>
              {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground/50 mt-[-16px]" />}
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* ── Wizard ────────────────────────────────────────────── */}
      <section className="space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Interactive Setup
        </h2>

        {/* Progress bar */}
        <div className="flex items-center gap-1">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <button
                onClick={() => { if (i <= step) setStep(i); }}
                className={cn(
                  'h-2 rounded-full flex-1 transition-all duration-300',
                  i <= step ? 'bg-primary' : 'bg-muted-foreground/20',
                  i <= step && 'cursor-pointer hover:bg-primary/80',
                )}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground px-0.5">
          <span className={cn(step === 0 && 'text-primary font-medium')}>1. Pair</span>
          <span className={cn(step === 1 && 'text-primary font-medium')}>2. Timeframe</span>
          <span className={cn(step === 2 && 'text-primary font-medium')}>3. Goal</span>
          <span className={cn(step === 3 && 'text-primary font-medium')}>4. Details</span>
          <span className={cn(step === 4 && 'text-primary font-medium')}>5. Go!</span>
        </div>

        {/* Steps */}
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="min-h-[280px]">

              {/* ─── Step 1: Pair ─── */}
              {step === 0 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-base font-semibold mb-1">Step 1: Select a Currency Pair</h3>
                    <p className="text-sm text-muted-foreground">
                      We collect real-time <strong>OHLC</strong> (Open, High, Low, Close) data from
                      Yahoo Finance for selected currency pairs. Choose which pair you want to analyze.
                      Each pair represents the exchange rate between two currencies.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                    {CURRENCY_PAIRS.map(p => (
                      <button
                        key={p.symbol}
                        onClick={() => setSelPair(p)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md',
                          selPair.symbol === p.symbol
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-border hover:border-primary/40'
                        )}
                      >
                        <span className="text-lg font-bold">{p.base}/{p.quote}</span>
                        <span className="text-xs text-muted-foreground">{p.symbol}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Step 2: Timeframe ─── */}
              {step === 1 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-base font-semibold mb-1">Step 2: Select a Timeframe</h3>
                    <p className="text-sm text-muted-foreground">
                      The timeframe determines the granularity of each data bar. A <strong>1D</strong> bar
                      represents one full trading day; <strong>1H</strong> represents one hour, etc.
                      Longer timeframes are smoother and better for beginners; shorter ones contain more noise.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    {TIMEFRAMES.map(tf => (
                      <button
                        key={tf.value}
                        onClick={() => setSelTf(tf.value)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-200 hover:shadow-md',
                          selTf === tf.value
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-border hover:border-primary/40'
                        )}
                      >
                        <span className="text-lg font-bold">{tf.label}</span>
                        <span className="text-xs text-muted-foreground text-center leading-tight">{tf.desc}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mt-2">
                    <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      <strong>Recommendation:</strong> For beginners, <strong>1D</strong> (daily) is the best starting point.
                      It provides clean data with less noise, and models train faster.
                    </p>
                  </div>
                </div>
              )}

              {/* ─── Step 3: Goal ─── */}
              {step === 2 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-base font-semibold mb-1">Step 3: Choose Your Goal</h3>
                    <p className="text-sm text-muted-foreground">
                      What do you want to do with the data? You can either make a <strong>forecast</strong> using
                      a single model, or run a full <strong>backtest</strong> to compare all models on historical data.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <button
                      onClick={() => setSelGoal('forecast')}
                      className={cn(
                        'flex flex-col items-start gap-3 p-5 rounded-xl border-2 transition-all duration-200 text-left hover:shadow-md',
                        selGoal === 'forecast'
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-emerald-500/10">
                          <TrendingUp className="h-5 w-5 text-emerald-500" />
                        </div>
                        <h4 className="font-semibold">Forecast</h4>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Train a single prediction model on historical data and generate a
                        future price forecast. Great for testing individual models and seeing predicted values.
                      </p>
                      <Badge variant="secondary" className="mt-auto">Single model</Badge>
                    </button>

                    <button
                      onClick={() => setSelGoal('backtest')}
                      className={cn(
                        'flex flex-col items-start gap-3 p-5 rounded-xl border-2 transition-all duration-200 text-left hover:shadow-md',
                        selGoal === 'backtest'
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-violet-500/10">
                          <FlaskConical className="h-5 w-5 text-violet-500" />
                        </div>
                        <h4 className="font-semibold">Backtest & Compare</h4>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Run all models on historical data using walk-forward backtesting.
                        Compare MAE, RMSE, and directional accuracy. See which algorithm works best.
                      </p>
                      <Badge variant="secondary" className="mt-auto">All models compared</Badge>
                    </button>
                  </div>
                </div>
              )}

              {/* ─── Step 4: Model / Details ─── */}
              {step === 3 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  {selGoal === 'forecast' ? (
                    <>
                      <div>
                        <h3 className="text-base font-semibold mb-1">Step 4: Choose a Prediction Model</h3>
                        <p className="text-sm text-muted-foreground">
                          Select which algorithm to train. Each model uses a different approach to predict the next price.
                          The <strong>AI Ensemble</strong> is this thesis's original contribution.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                        {MODELS.map(m => (
                          <button
                            key={m.id}
                            onClick={() => setSelModel(m.id)}
                            className={cn(
                              'flex items-start gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left hover:shadow-md',
                              selModel === m.id
                                ? 'border-primary bg-primary/5 shadow-sm'
                                : m.highlight
                                  ? 'border-amber-500/40 hover:border-amber-500/70 bg-amber-500/5'
                                  : 'border-border hover:border-primary/40'
                            )}
                          >
                            <div className={cn(
                              'p-1.5 rounded-lg shrink-0 mt-0.5',
                              m.highlight ? 'bg-amber-500/10' : 'bg-muted'
                            )}>
                              <m.icon className={cn('h-4 w-4', m.highlight ? 'text-amber-500' : 'text-muted-foreground')} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{m.name}</span>
                                {m.highlight && <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] py-0">Author's work</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{m.desc}</p>
                            </div>
                            {selModel === m.id && <Check className="h-4 w-4 text-primary shrink-0 mt-1" />}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <h3 className="text-base font-semibold mb-1">Step 4: Backtest Configuration</h3>
                        <p className="text-sm text-muted-foreground">
                          Walk-forward backtesting trains each model on a sliding window of historical data,
                          then tests predictions on the next unseen period. This process repeats across the entire
                          date range, providing a realistic evaluation of how each model would have performed.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                        <Card className="bg-muted/30">
                          <CardContent className="pt-4 pb-3 space-y-2">
                            <h4 className="font-medium text-sm flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              How it works
                            </h4>
                            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
                              <li>Split data into rolling <strong>train/test windows</strong></li>
                              <li>Train each model on the train portion</li>
                              <li>Predict the test portion</li>
                              <li>Compare predictions with actual prices</li>
                              <li>Slide the window forward and repeat</li>
                            </ol>
                          </CardContent>
                        </Card>
                        <Card className="bg-muted/30">
                          <CardContent className="pt-4 pb-3 space-y-2">
                            <h4 className="font-medium text-sm flex items-center gap-2">
                              <Activity className="h-4 w-4 text-muted-foreground" />
                              Models compared
                            </h4>
                            <ul className="text-xs text-muted-foreground space-y-1">
                              {MODELS.filter(m => !m.highlight).map(m => (
                                <li key={m.id} className="flex items-center gap-1.5">
                                  <Check className="h-3 w-3 text-emerald-500" />
                                  <span>{m.name}</span>
                                </li>
                              ))}
                              <li className="flex items-center gap-1.5 text-amber-500">
                                <Sparkles className="h-3 w-3" />
                                <span>AI Ensemble <span className="text-muted-foreground">(optional, uses GPT API)</span></span>
                              </li>
                            </ul>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="flex items-start gap-2 bg-muted/40 border rounded-lg p-3 mt-1">
                        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          Metrics used: <strong>MAE</strong> (Mean Absolute Error), <strong>RMSE</strong> (Root Mean Square Error),
                          and <strong>Directional Accuracy</strong> (% of correct up/down predictions).
                          Statistical tests: ADF, Ljung-Box, Diebold-Mariano.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ─── Step 5: Summary ─── */}
              {step === 4 && (
                <div className="space-y-5 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-base font-semibold mb-1">Step 5: Ready to Go!</h3>
                    <p className="text-sm text-muted-foreground">
                      Here is a summary of your selections. Click <strong>Start</strong> to proceed.
                    </p>
                  </div>

                  <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="pt-5 pb-4">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Currency Pair</span>
                          <p className="font-semibold text-lg">{selPair.base}/{selPair.quote}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Timeframe</span>
                          <p className="font-semibold text-lg">{selTf}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Goal</span>
                          <p className="font-semibold capitalize">{selGoal === 'forecast' ? 'Forecast (Prediction)' : 'Backtest & Compare'}</p>
                        </div>
                        {selGoal === 'forecast' && (
                          <div>
                            <span className="text-muted-foreground text-xs">Model</span>
                            <p className="font-semibold">{MODELS.find(m => m.id === selModel)?.name}</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button size="lg" className="flex-1 gap-2 text-base" onClick={handleGo}>
                      Start
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                    <Button size="lg" variant="outline" className="gap-2" onClick={handleGoReport}>
                      <FileText className="h-4 w-4" />
                      Generate a Report instead
                    </Button>
                  </div>
                </div>
              )}

            </div>

            {/* Navigation */}
            <Separator className="my-4" />
            <div className="flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(s => Math.max(0, s - 1))}
                disabled={step === 0}
                className="gap-1"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {step < TOTAL_STEPS - 1 && (
                <Button
                  size="sm"
                  onClick={() => setStep(s => Math.min(TOTAL_STEPS - 1, s + 1))}
                  disabled={!canNext()}
                  className="gap-1"
                >
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ── Page Directory ────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Application Pages</h2>
        <p className="text-sm text-muted-foreground">
          Quick reference for every section of the application. Click a card to navigate there.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PAGES.map(page => (
            <button
              key={page.path}
              onClick={() => navigate(page.path)}
              className="flex items-start gap-3 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-muted/30 transition-all duration-200 text-left group"
            >
              <div className="p-2 rounded-lg bg-muted group-hover:bg-primary/10 transition-colors shrink-0">
                <page.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div>
                <h4 className="font-medium text-sm group-hover:text-primary transition-colors">{page.label}</h4>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{page.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <Separator />

      {/* ── Technical Details (Accordion) ─────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Technical Details</h2>
        <p className="text-sm text-muted-foreground">
          In-depth explanation of the prediction models and statistical verification methods used.
        </p>

        <Accordion type="multiple" className="space-y-2">
          <AccordionItem value="models" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-medium py-3">
              Prediction Models
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-4 pb-4">
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium text-foreground">Naive Model</h4>
                  <p>
                    The simplest baseline: predicts that the next price will be the same as the last known price.
                    Despite its simplicity, it is surprisingly hard to beat in efficient markets. Used as a reference
                    point for all other models.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Moving Average</h4>
                  <p>
                    Computes the arithmetic mean of the last N closing prices as the prediction. Smooths out
                    short-term fluctuations and highlights longer-term trends. The window size N is configurable.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">ARIMA (Auto-Regressive Integrated Moving Average)</h4>
                  <p>
                    A classical time-series model with three components: AR (auto-regression on past values),
                    I (differencing for stationarity), and MA (moving average of forecast errors). Parameters (p, d, q)
                    can be auto-selected using the AIC criterion via <code>pmdarima</code>.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Ridge Regression</h4>
                  <p>
                    Linear regression with L2 regularization. Uses engineered features: lagged returns, technical indicators
                    (SMA, EMA, RSI, MACD). The regularization prevents overfitting when the number of features is high relative
                    to the training data.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Random Forest</h4>
                  <p>
                    An ensemble of decision trees, each trained on a random subset of data and features. Captures non-linear
                    relationships and interactions between features. Robust to outliers and does not require feature scaling.
                  </p>
                </div>
                <div className="border-l-2 border-amber-500/50 pl-3">
                  <h4 className="font-medium text-foreground flex items-center gap-2">
                    AI Ensemble
                    <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] py-0">
                      Author's contribution
                    </Badge>
                  </h4>
                  <p>
                    The original contribution of this thesis. For each prediction step, the system sends the last 30 price
                    bars, technical indicators, and predictions from all base models to a GPT-based AI. The AI analyzes
                    the context, assigns dynamic weights to each model, and produces its own forecast. This demonstrates
                    whether AI-augmented analysis can improve upon traditional statistical methods.
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="tests" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-medium py-3">
              Statistical Tests
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-4 pb-4">
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium text-foreground">ADF (Augmented Dickey-Fuller) Test</h4>
                  <p>
                    Tests whether the time series is <strong>stationary</strong> (i.e., its statistical properties
                    don't change over time). A stationary series is easier to predict. If the p-value is below 0.05,
                    we reject the null hypothesis and conclude the series is stationary.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Ljung-Box Test</h4>
                  <p>
                    Tests whether the prediction <strong>errors are random</strong> (no autocorrelation). If errors
                    are random, the model has captured all predictable patterns in the data. A p-value above 0.05
                    means no significant autocorrelation — the model residuals are clean.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Diebold-Mariano Test</h4>
                  <p>
                    Compares the predictive accuracy of <strong>two models</strong> (typically the best model vs. Naive).
                    Tests whether one model's errors are significantly smaller than the other's. A significant result
                    means the improvement is not due to chance.
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="metrics" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-medium py-3">
              Evaluation Metrics
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-4 pb-4">
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium text-foreground">MAE (Mean Absolute Error)</h4>
                  <p>
                    Average of absolute differences between predicted and actual values. Easy to interpret:
                    if MAE = 0.0012, the model's predictions are off by 0.0012 on average. Lower is better.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">RMSE (Root Mean Square Error)</h4>
                  <p>
                    Similar to MAE but penalizes large errors more heavily (squared before averaging).
                    More sensitive to outlier predictions. Lower is better.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Directional Accuracy (DA)</h4>
                  <p>
                    Percentage of times the model correctly predicted the <strong>direction</strong> of price
                    movement (up or down). A value above 50% means the model predicts direction better than a coin flip.
                    This is often more practically useful than raw error metrics.
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="data" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-medium py-3">
              Data Collection & Processing
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-3 pb-4">
              <p>
                Price data is fetched from <strong>Yahoo Finance</strong> via the <code>yfinance</code> Python library.
                The data includes Open, High, Low, Close (OHLC) prices and volume for each bar.
              </p>
              <p>
                Data is stored locally in an <strong>SQLite</strong> database and can be updated on demand via the
                "Update Data" button in the top bar. The system automatically detects missing bars and fills gaps.
              </p>
              <p>
                <strong>Log returns</strong> (logarithmic returns) can optionally be used as the prediction target
                instead of raw close prices. Log returns are preferred in financial analysis because they are
                approximately normally distributed and time-additive.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    </div>
  );
}
