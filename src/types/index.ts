export interface CurrencyPair {
  base: string;
  quote: string;
  symbol: string;
}

export type Timeframe = '1D' | '4H' | '1H' | '30M' | '15M' | '5M' | '1M';

export interface OHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface DataSummary {
  rows: number;
  start: string;
  end: string;
  missing: number;
  duplicates: number;
  lastUpdated: string;
}

export interface IndicatorConfig {
  sma: { enabled: boolean; period: number };
  ema: { enabled: boolean; period: number };
  rsi: { enabled: boolean; period: number; overbought: number; oversold: number };
  macd: { enabled: boolean; fast: number; slow: number; signal: number };
}

export type ModelType = 'Naive' | 'MovingAverage' | 'ARIMA' | 'Ridge' | 'RandomForest' | 'AIEnsemble';

export interface TrainRequest {
  pair: string;
  timeframe: Timeframe;
  start: string;
  end: string;
  model: ModelType;
  target?: 'close' | 'log_return';
  features?: {
    lagReturns?: boolean;
    numLags?: number;
    sma?: boolean;
    ema?: boolean;
    rsi?: boolean;
    macd?: boolean;
  };
  hyperparams?: Record<string, number | boolean>;
}

export interface TrainResponse {
  modelId: string;
  model: ModelType;
  trainedAt: string;
  metricsPreview?: { mae: number; rmse: number };
}

export interface ForecastRequest {
  modelId: string;
  horizon: number;
}

export interface ForecastPoint {
  time: string;
  actual?: number;
  predicted: number;
  lower?: number;
  upper?: number;
}

export interface BacktestRequest {
  pair: string;
  timeframe: Timeframe;
  start: string;
  end: string;
  models: ModelType[];
  windowTrainDays: number;
  windowTestDays: number;
  stepDays: number;
}

export interface BacktestWindowResult {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  mae: number;
  rmse: number;
  directionalAccuracy: number;
}

export interface BacktestResult {
  model: ModelType;
  metrics: { mae: number; rmse: number; directionalAccuracy: number };
  windows: BacktestWindowResult[];
}

export interface StatisticalTests {
  adf: { statistic: number; pValue: number; isStationary: boolean };
  ljungBox: { statistic: number; pValue: number; noAutocorrelation: boolean };
  dieboldMariano?: { statistic: number; pValue: number; betterModel: ModelType | null };
}

export interface ReportItem {
  id: string;
  createdAt: string;
  pair: string;
  timeframe: Timeframe;
  start: string;
  end: string;
  models: ModelType[];
  status: 'Ready' | 'Generating' | 'Failed';
  downloadUrl?: string;
  hasExcel?: boolean;
}

export const CURRENCY_PAIRS: CurrencyPair[] = [
  { base: 'EUR', quote: 'USD', symbol: 'EURUSD' },
  { base: 'USD', quote: 'JPY', symbol: 'USDJPY' },
  { base: 'GBP', quote: 'USD', symbol: 'GBPUSD' },
  { base: 'EUR', quote: 'GBP', symbol: 'EURGBP' },
  { base: 'USD', quote: 'CHF', symbol: 'USDCHF' },
];
