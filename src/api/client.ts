import type { OHLCBar, DataSummary, TrainRequest, TrainResponse, ForecastRequest, ForecastPoint, BacktestRequest, BacktestResult, StatisticalTests, ReportItem, Timeframe, ModelType } from '@/types';

declare global {
  interface Window {
    electronAPI?: {
      getBackendPort: () => Promise<number>;
      isElectron: boolean;
      onBackendReady?: (cb: (port: number) => void) => void;
    };
  }
}

let _cachedPort: number | null = null;
let _backendReady = false;
const _backendReadyCallbacks: Array<() => void> = [];

async function resolveBackendPort(): Promise<number> {
  if (_cachedPort) return _cachedPort;
  if (window.electronAPI?.isElectron) {
    try {
      _cachedPort = await window.electronAPI.getBackendPort();
    } catch {
      _cachedPort = 8000;
    }
    return _cachedPort;
  }
  return 8000;
}

const isElectron = () => !!(window.electronAPI?.isElectron);

if (typeof window !== 'undefined' && window.electronAPI?.onBackendReady) {
  window.electronAPI.onBackendReady((port) => {
    _cachedPort = port;
    _backendReady = true;
    _backendReadyCallbacks.forEach(cb => cb());
    _backendReadyCallbacks.length = 0;
  });
}

export function onBackendReady(cb: () => void): void {
  if (_backendReady) { cb(); return; }
  _backendReadyCallbacks.push(cb);
}

const getBaseUrl = () => {
  const stored = localStorage.getItem('apiBaseUrl');
  if (stored) return stored;
  if (isElectron() && _cachedPort) return `http://127.0.0.1:${_cachedPort}`;
  if (isElectron()) return `http://127.0.0.1:8000`;
  if (import.meta.env.VITE_API_BASE_URL !== undefined && import.meta.env.VITE_API_BASE_URL !== '') return import.meta.env.VITE_API_BASE_URL;
  return window.location.origin + '/api';
};

export { resolveBackendPort, isElectron };

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      signal: options?.signal ?? controller.signal,
    });
    if (!res.ok) {
      let detail = `API error: ${res.status}`;
      try {
        const body = await res.json();
        if (body.detail) detail = body.detail;
        else if (body.error?.message) detail = body.error.message;
      } catch { /* ignore parse errors */ }
      throw new Error(detail);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkHealth(): Promise<{ status: 'ok' | 'offline'; mock: boolean }> {
  try {
    const res = await fetch(`${getBaseUrl()}/health`, { signal: AbortSignal.timeout(5000) });
    return { status: res.ok ? 'ok' : 'offline', mock: false };
  } catch {
    return { status: 'offline', mock: false };
  }
}

function ohlcCacheKey(pair: string, timeframe: string): string {
  return `ohlc_cache_${pair}_${timeframe}`;
}

function saveOhlcCache(pair: string, timeframe: string, data: OHLCBar[]): void {
  if (!data || data.length === 0) return;
  try {
    const key = ohlcCacheKey(pair, timeframe);
    localStorage.setItem(key, JSON.stringify(data));
  } catch { /* quota exceeded — ignore */ }
}

function loadOhlcCache(pair: string, timeframe: string): OHLCBar[] | null {
  try {
    const raw = localStorage.getItem(ohlcCacheKey(pair, timeframe));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch { return null; }
}

export async function getOhlc(pair: string, timeframe: Timeframe, start: string, end: string): Promise<OHLCBar[]> {
  try {
    const data = await fetchJson<OHLCBar[]>(`/data/ohlc?pair=${pair}&timeframe=${timeframe}&start=${start}&end=${end}`);
    if (data && data.length > 0) saveOhlcCache(pair, timeframe, data);
    return data;
  } catch (e: any) {
    if (e.message?.includes('404')) return [];
    const cached = loadOhlcCache(pair, timeframe);
    if (cached) return cached;
    throw e;
  }
}

export async function getDataSummary(pair: string, timeframe: Timeframe): Promise<DataSummary> {
  try {
    return await fetchJson(`/data/summary?pair=${pair}&timeframe=${timeframe}`);
  } catch {
    return { rows: 0, start: '', end: '', missing: 0, duplicates: 0, lastUpdated: new Date().toISOString() };
  }
}

export async function updateData(payload: { pair: string; timeframe: Timeframe; start: string; end: string }): Promise<{ ok: true; message: string; summary?: DataSummary }> {
  try {
    return await fetchJson('/data/update', { method: 'POST', body: JSON.stringify(payload) });
  } catch {
    const cached = loadOhlcCache(payload.pair, payload.timeframe);
    if (cached) {
      return { ok: true, message: 'Offline — using cached data' };
    }
    throw new Error('No internet connection and no cached data available');
  }
}

export async function trainModel(payload: TrainRequest): Promise<TrainResponse> {
  return fetchJson('/models/train', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getModels(pair: string): Promise<TrainResponse[]> {
  return fetchJson(`/models?pair=${pair}`);
}

export async function deleteModel(modelId: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/models/${modelId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
}

export async function forecast(payload: ForecastRequest): Promise<ForecastPoint[]> {
  return fetchJson('/models/forecast', { method: 'POST', body: JSON.stringify(payload) });
}

export async function downloadForecastExcel(modelId: string, horizon: number): Promise<Blob> {
  const res = await fetch(`${getBaseUrl()}/models/forecast-excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, horizon }),
  });
  if (!res.ok) {
    let detail = `API error: ${res.status}`;
    try { const body = await res.json(); if (body.detail) detail = body.detail; } catch {}
    throw new Error(detail);
  }
  return res.blob();
}

export async function backtest(payload: BacktestRequest): Promise<{ results: BacktestResult[]; tests: StatisticalTests }> {
  return fetchJson('/backtest/run', { method: 'POST', body: JSON.stringify(payload) });
}

// ─── Async backtest with cancellation support ───────────────────────────

export async function backtestStart(payload: BacktestRequest): Promise<{ taskId: string; status: string }> {
  return fetchJson('/backtest/start', { method: 'POST', body: JSON.stringify(payload) });
}

export async function backtestStatus(taskId: string): Promise<{ taskId: string; status: string; runId?: string; results?: BacktestResult[]; tests?: StatisticalTests; error?: string; progress?: { currentModel?: string; modelIndex?: number; totalModels?: number; currentWindow?: number; totalWindows?: number; aiEstimateSec?: number } }> {
  return fetchJson(`/backtest/${taskId}`);
}

export async function backtestCancel(taskId: string): Promise<{ ok: boolean; status: string }> {
  return fetchJson(`/backtest/${taskId}/cancel`, { method: 'POST' });
}

export async function backtestHistory(pair: string, timeframe: string): Promise<Array<{ id: string; symbol: string; timeframe: string; start: string; end: string; createdAt: string; results: BacktestResult[]; tests: StatisticalTests }>> {
  return fetchJson(`/backtest/history?pair=${pair}&timeframe=${timeframe}`);
}

export async function listReports(): Promise<ReportItem[]> {
  return fetchJson('/reports');
}

export async function generateReport(payload: { pair: string; timeframe: Timeframe; start: string; end: string; models: ModelType[]; includeCharts?: boolean; includeTests?: boolean; language?: string }): Promise<ReportItem> {
  return fetchJson('/reports/generate', { method: 'POST', body: JSON.stringify(payload) });
}

export async function generateReportFromRun(payload: {
  runId: string;
  language?: string;
  includeCharts?: boolean;
  includeTests?: boolean;
}): Promise<ReportItem> {
  return fetchJson('/reports/from-run', { method: 'POST', body: JSON.stringify(payload) });
}

export async function downloadReport(id: string): Promise<Blob> {
  const res = await fetch(`${getBaseUrl()}/reports/${id}/download`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}

export async function downloadReportExcel(id: string): Promise<Blob> {
  const res = await fetch(`${getBaseUrl()}/reports/${id}/download-excel`);
  if (!res.ok) throw new Error(`Excel download failed: ${res.status}`);
  return res.blob();
}

export async function deleteReport(id: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/reports/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

// ─── AI Analysis ────────────────────────────────────────────────────────

export interface AiAnalysisResult {
  summary: string;
  model_comparison: string;
  test_interpretation: string;
  recommendation: string;
  conclusion: string;
}

export async function getAiAnalysis(payload: {
  pair: string;
  timeframe: Timeframe;
  start: string;
  end: string;
  backtestResults?: BacktestResult[];
  statisticalTests?: StatisticalTests;
  dataSummary?: DataSummary;
  language?: string;
}): Promise<AiAnalysisResult> {
  return fetchJson('/analysis/interpret', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getAiAnalysisStatus(): Promise<{ available: boolean; model: string | null }> {
  return fetchJson('/analysis/status');
}

// ─── Data Quality ───────────────────────────────────────────────────────

export interface DataQualityReport {
  totalBars: number;
  invalidBars: number;
  invalidBarDetails: string[];
  duplicateTimestamps: number;
  missingWeekdays: number;
  missingWeekdayDates: string[];
  outlierCount: number;
  qualityScore: number;
}

export async function getDataQuality(pair: string, timeframe: Timeframe, start: string, end: string): Promise<DataQualityReport> {
  return fetchJson(`/data/quality?pair=${pair}&timeframe=${timeframe}&start=${start}&end=${end}`);
}

// ─── Live Rates ─────────────────────────────────────────────────────────

export interface RateInfo {
  currency: string;
  rateVsUsd: number;
  name: string;
}

export interface LiveRatesResponse {
  baseCurrency: string;
  rates: RateInfo[];
  updatedAt: string;
}

export interface ConvertResponse {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  result: number;
  rate: number;
  updatedAt: string;
}

export interface CurrencyInfo {
  code: string;
  name: string;
}

export async function getLiveRates(): Promise<LiveRatesResponse> {
  return fetchJson('/rates/live');
}

export async function convertCurrency(fromCurrency: string, toCurrency: string, amount: number): Promise<ConvertResponse> {
  return fetchJson('/rates/convert', {
    method: 'POST',
    body: JSON.stringify({ fromCurrency, toCurrency, amount }),
  });
}

export async function getCurrencies(): Promise<CurrencyInfo[]> {
  return fetchJson('/rates/currencies');
}
