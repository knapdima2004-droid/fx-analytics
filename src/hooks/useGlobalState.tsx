import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { CurrencyPair, Timeframe } from '@/types';
import { CURRENCY_PAIRS } from '@/types';

interface DateRange { start: string; end: string; }

interface GlobalState {
  pair: CurrencyPair;
  setPair: (p: CurrencyPair) => void;
  timeframe: Timeframe;
  setTimeframe: (t: Timeframe) => void;
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  favorites: string[];
  toggleFavorite: (symbol: string) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (c: boolean) => void;
}

const GlobalStateContext = createContext<GlobalState | null>(null);

export function useGlobalState() {
  const ctx = useContext(GlobalStateContext);
  if (!ctx) throw new Error('useGlobalState must be used within GlobalStateProvider');
  return ctx;
}

function getDefaultDateRange(): DateRange {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

function loadPersistedState() {
  try {
    const pair = localStorage.getItem('fx_pair');
    const tf = localStorage.getItem('fx_timeframe');
    const dr = localStorage.getItem('fx_dateRange');
    let dateRange = dr ? JSON.parse(dr) as DateRange : getDefaultDateRange();

    // Auto-update end date to today if stored date is in the past
    const today = new Date().toISOString().split('T')[0];
    if (dateRange.end < today) {
      dateRange = { ...dateRange, end: today };
      localStorage.setItem('fx_dateRange', JSON.stringify(dateRange));
    }

    return {
      pair: pair ? CURRENCY_PAIRS.find(p => p.symbol === pair) || CURRENCY_PAIRS[0] : CURRENCY_PAIRS[0],
      timeframe: (tf as Timeframe) || '1D',
      dateRange,
    };
  } catch {
    return { pair: CURRENCY_PAIRS[0], timeframe: '1D' as Timeframe, dateRange: getDefaultDateRange() };
  }
}

export function GlobalStateProvider({ children }: { children: ReactNode }) {
  const persisted = loadPersistedState();
  const [pair, setPairState] = useState<CurrencyPair>(persisted.pair);
  const [timeframe, setTimeframeState] = useState<Timeframe>(persisted.timeframe);
  const [dateRange, setDateRangeState] = useState<DateRange>(persisted.dateRange);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { const s = localStorage.getItem('fx_favorites'); return s ? JSON.parse(s) : ['EURUSD']; } catch { return ['EURUSD']; }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const setPair = useCallback((p: CurrencyPair) => { setPairState(p); localStorage.setItem('fx_pair', p.symbol); }, []);
  const setTimeframe = useCallback((t: Timeframe) => { setTimeframeState(t); localStorage.setItem('fx_timeframe', t); }, []);
  const setDateRange = useCallback((r: DateRange) => { setDateRangeState(r); localStorage.setItem('fx_dateRange', JSON.stringify(r)); }, []);

  const toggleFavorite = useCallback((symbol: string) => {
    setFavorites(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      localStorage.setItem('fx_favorites', JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <GlobalStateContext.Provider value={{ pair, setPair, timeframe, setTimeframe, dateRange, setDateRange, favorites, toggleFavorite, sidebarCollapsed, setSidebarCollapsed }}>
      {children}
    </GlobalStateContext.Provider>
  );
}

export { CURRENCY_PAIRS };
