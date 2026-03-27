import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useGlobalState } from './useGlobalState';
import * as api from '@/api/client';
import type { TrainRequest, ForecastRequest, BacktestRequest, ModelType, Timeframe } from '@/types';
import { toast } from 'sonner';

// ─── Forex market hours ──────────────────────────────────────────────────────

/**
 * Forex market operates Sun 21:00 UTC → Fri 21:00 UTC.
 * Returns true if the market is currently open.
 */
export function isForexMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();    // 0=Sun..6=Sat
  const hour = now.getUTCHours();

  // Sat: always closed
  if (day === 6) return false;
  // Sun: opens at 21:00 UTC
  if (day === 0) return hour >= 21;
  // Fri: closes at 21:00 UTC
  if (day === 5) return hour < 21;
  // Mon–Thu: open all day
  return true;
}

/** Whether a timeframe is intraday (needs frequent updates). */
function isIntraday(tf: Timeframe): boolean {
  return ['1M', '5M', '15M', '30M', '1H'].includes(tf);
}

/** Polling interval (DB query) per timeframe for auto-refresh. */
function getRefreshInterval(tf: Timeframe): number {
  if (!isForexMarketOpen()) return 0; // no polling when market closed
  switch (tf) {
    case '1M': return 30_000;    // 30s
    case '5M': return 60_000;    // 1min
    case '15M': return 120_000;  // 2min
    case '30M': return 180_000;  // 3min
    case '1H': return 300_000;   // 5min
    default: return 0;
  }
}

/** Interval for downloading fresh data from yfinance (longer than DB poll). */
function getDownloadInterval(tf: Timeframe): number {
  if (!isForexMarketOpen()) return 0; // no downloads when market closed
  switch (tf) {
    case '1M': return 60_000;    // 1min (yfinance is slow)
    case '5M': return 120_000;   // 2min
    case '15M': return 240_000;  // 4min
    case '30M': return 360_000;  // 6min
    case '1H': return 600_000;   // 10min
    default: return 0;
  }
}

/**
 * Fetches OHLC data. Automatically downloads data from yfinance if needed.
 * For intraday timeframes, periodically refreshes data from source.
 */
export function useOhlc() {
  const { pair, timeframe, dateRange } = useGlobalState();
  const qc = useQueryClient();
  const fetchedRef = useRef<Set<string>>(new Set());
  const updatingRef = useRef(false);

  const refreshMs = useMemo(() => getRefreshInterval(timeframe), [timeframe]);
  const downloadMs = useMemo(() => getDownloadInterval(timeframe), [timeframe]);
  const intraday = isIntraday(timeframe);
  const paramsKey = `${pair.symbol}_${timeframe}_${dateRange.start}_${dateRange.end}`;

  const query = useQuery({
    queryKey: ['ohlc', pair.symbol, timeframe, dateRange.start, dateRange.end],
    queryFn: () => api.getOhlc(pair.symbol, timeframe, dateRange.start, dateRange.end),
    retry: 1,
    staleTime: refreshMs ? refreshMs / 2 : 60_000,
    refetchInterval: refreshMs || false,
  });

  // Data download trigger: runs once when params change
  const triggerUpdate = useCallback(async (showToast: boolean) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    if (showToast) toast.info(`Downloading ${pair.symbol} (${timeframe}) data...`);
    try {
      const result = await api.updateData({ pair: pair.symbol, timeframe, start: dateRange.start, end: dateRange.end });
      qc.invalidateQueries({ queryKey: ['ohlc', pair.symbol, timeframe] });
      qc.invalidateQueries({ queryKey: ['dataSummary'] });
      if (result.message?.includes('Offline')) {
        if (showToast) toast.info(`Offline — showing cached ${pair.symbol} data`);
      } else {
        if (showToast) toast.success(`${pair.symbol} data loaded`);
      }
    } catch {
      qc.invalidateQueries({ queryKey: ['ohlc', pair.symbol, timeframe] });
      if (showToast) toast.error(`Failed to download ${pair.symbol} data`);
    } finally {
      updatingRef.current = false;
    }
  }, [pair.symbol, timeframe, dateRange.start, dateRange.end, qc]);

  // Auto-fetch: trigger download when params change and data is empty or stale
  useEffect(() => {
    if (fetchedRef.current.has(paramsKey)) return;
    if (!query.isSuccess) return;

    const hasData = query.data && query.data.length > 10;

    // Check if data is stale (last bar is old for this timeframe)
    let isStale = false;
    if (hasData && query.data) {
      const lastBar = query.data[query.data.length - 1];
      const lastTime = /^\d+$/.test(lastBar.time)
        ? new Date(Number(lastBar.time) * 1000)
        : new Date(lastBar.time);
      const ageMs = Date.now() - lastTime.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      // Stale thresholds: 1D=36h, 4H=8h, 1H=4h, intraday=2h
      if (timeframe === '1D' && ageHours > 36) isStale = true;
      else if (timeframe === '4H' && ageHours > 8) isStale = true;
      else if (timeframe === '1H' && ageHours > 4) isStale = true;
      else if (intraday && ageHours > 2) isStale = true;
    }

    // Fetch: always for intraday, or if no data, or if data is stale
    if (intraday || !hasData || isStale) {
      fetchedRef.current.add(paramsKey);
      triggerUpdate(!hasData); // show toast only if no data visible
    }
  }, [query.isSuccess, query.data, paramsKey, intraday, timeframe, triggerUpdate]);

  // Periodic yfinance download for intraday timeframes (longer interval than DB poll)
  useEffect(() => {
    if (!downloadMs) return;
    const interval = setInterval(() => {
      if (!updatingRef.current) {
        triggerUpdate(false);
      }
    }, downloadMs);
    return () => clearInterval(interval);
  }, [downloadMs, triggerUpdate]);

  return query;
}

export function useDataSummary() {
  const { pair, timeframe } = useGlobalState();
  return useQuery({
    queryKey: ['dataSummary', pair.symbol, timeframe],
    queryFn: () => api.getDataSummary(pair.symbol, timeframe),
    staleTime: 60_000,
  });
}

export function useUpdateData() {
  const qc = useQueryClient();
  const { pair, timeframe, dateRange } = useGlobalState();
  return useMutation({
    mutationFn: () => api.updateData({ pair: pair.symbol, timeframe, start: dateRange.start, end: dateRange.end }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ohlc'] }); qc.invalidateQueries({ queryKey: ['dataSummary'] }); },
  });
}

export function useTrainModel() {
  return useMutation({ mutationFn: (req: TrainRequest) => api.trainModel(req) });
}

export function useModels() {
  const { pair } = useGlobalState();
  return useQuery({ queryKey: ['models', pair.symbol], queryFn: () => api.getModels(pair.symbol) });
}

export function useForecast() {
  return useMutation({ mutationFn: (req: ForecastRequest) => api.forecast(req) });
}

export function useBacktest() {
  return useMutation({ mutationFn: (req: BacktestRequest) => api.backtest(req) });
}

export function useReports() {
  return useQuery({ queryKey: ['reports'], queryFn: () => api.listReports() });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { pair: string; timeframe: Timeframe; start: string; end: string; models: ModelType[]; includeCharts?: boolean; includeTests?: boolean; language?: string }) => api.generateReport(payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reports'] }); },
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.checkHealth(),
    refetchInterval: 30000,
    retry: 1,
  });
}

export function useAiAnalysis() {
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.getAiAnalysis>[0]) => api.getAiAnalysis(payload),
  });
}

export function useAiStatus() {
  return useQuery({
    queryKey: ['aiStatus'],
    queryFn: () => api.getAiAnalysisStatus(),
    staleTime: 300_000,
  });
}

export function useDataQuality() {
  const { pair, timeframe, dateRange } = useGlobalState();
  return useQuery({
    queryKey: ['dataQuality', pair.symbol, timeframe, dateRange.start, dateRange.end],
    queryFn: () => api.getDataQuality(pair.symbol, timeframe, dateRange.start, dateRange.end),
    staleTime: 120_000,
    enabled: false,
  });
}
