import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from 'react';
import React from 'react';
import type { OHLCBar, Timeframe } from '@/types';

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

export interface StrategyReport {
  id: string;
  createdAt: string;
  pair: string;
  timeframe: Timeframe;
  strategy: string;
  strategyDesc: string;
  initialBalance: number;
  lotSize: string;
  afStep: number;
  afMax: number;
  dateRange: string;
  showSMA: boolean;
  showEMA: boolean;
  showSAR: boolean;
  result: SimResult;
  ohlcData: OHLCBar[];
}

const STORAGE_KEY = 'fx_strategy_reports';
const ACTIVE_KEY = 'fx_active_report';
const MAX_REPORTS = 15;

function loadReports(): StrategyReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StrategyReport[];
  } catch {
    return [];
  }
}

function saveReports(reports: StrategyReport[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch {
    console.warn('Failed to save reports to localStorage — may be full');
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* */ }
}

interface ReportStoreCtx {
  reports: StrategyReport[];
  activeReportId: string | null;
  addReport: (report: StrategyReport) => void;
  removeReport: (id: string) => void;
  setActiveReport: (id: string | null) => void;
}

const ReportStoreContext = createContext<ReportStoreCtx | null>(null);

export function ReportStoreProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<StrategyReport[]>(() => loadReports());
  const [activeReportId, setActiveReportIdState] = useState<string | null>(() => loadActiveId());

  useEffect(() => { saveReports(reports); }, [reports]);
  useEffect(() => { saveActiveId(activeReportId); }, [activeReportId]);

  const addReport = useCallback((report: StrategyReport) => {
    setReports(prev => [report, ...prev].slice(0, MAX_REPORTS));
  }, []);

  const removeReport = useCallback((id: string) => {
    setReports(prev => prev.filter(r => r.id !== id));
    setActiveReportIdState(prev => prev === id ? null : prev);
  }, []);

  const setActiveReport = useCallback((id: string | null) => {
    setActiveReportIdState(id);
  }, []);

  return React.createElement(ReportStoreContext.Provider, {
    value: { reports, activeReportId, addReport, removeReport, setActiveReport },
  }, children);
}

export function useReportStore(): ReportStoreCtx {
  const ctx = useContext(ReportStoreContext);
  if (!ctx) throw new Error('useReportStore must be used within ReportStoreProvider');
  return ctx;
}
