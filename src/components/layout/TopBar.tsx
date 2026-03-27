import { useState, useCallback } from 'react';
import { useGlobalState, CURRENCY_PAIRS } from '@/hooks/useGlobalState';
import { useUpdateData, useHealth, isForexMarketOpen } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandItem, CommandList, CommandEmpty } from '@/components/ui/command';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, Star, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Timeframe } from '@/types';

const TIMEFRAMES: Timeframe[] = ['1M', '5M', '15M', '30M', '1H', '4H', '1D'];

/** Max lookback days per timeframe (yfinance limits). */
const TF_MAX_DAYS: Record<Timeframe, number> = {
  '1M': 7, '5M': 60, '15M': 60, '30M': 60, '1H': 730, '4H': 730, '1D': 3650,
};

function getDefaultRangeForTimeframe(tf: Timeframe): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  switch (tf) {
    case '1M':  start.setDate(start.getDate() - 2);   break;
    case '5M':  start.setDate(start.getDate() - 5);   break;
    case '15M': start.setDate(start.getDate() - 14);  break;
    case '30M': start.setDate(start.getDate() - 30);  break;
    case '1H':  start.setMonth(start.getMonth() - 3);  break;
    case '4H':  start.setFullYear(start.getFullYear() - 1); break;
    case '1D':  start.setFullYear(start.getFullYear() - 1); break;
  }
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

function clampRangeForTimeframe(tf: Timeframe, range: { start: string; end: string }): { start: string; end: string; clamped: boolean } {
  const maxDays = TF_MAX_DAYS[tf];
  const endDate = new Date(range.end);
  const startDate = new Date(range.start);
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > maxDays) {
    const clampedStart = new Date(endDate);
    clampedStart.setDate(clampedStart.getDate() - maxDays);
    return { start: clampedStart.toISOString().split('T')[0], end: range.end, clamped: true };
  }
  return { ...range, clamped: false };
}

export function TopBar() {
  const { pair, setPair, timeframe, setTimeframe, dateRange, setDateRange, favorites, toggleFavorite } = useGlobalState();
  const updateMutation = useUpdateData();
  const { data: health, isLoading: healthLoading } = useHealth();
  const [pairOpen, setPairOpen] = useState(false);

  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setTimeframe(tf);
    const { start, end, clamped } = clampRangeForTimeframe(tf, dateRange);
    if (clamped) {
      setDateRange({ start, end });
      toast.info(`Date range adjusted for ${tf} (max ${TF_MAX_DAYS[tf]} days)`);
    }
  }, [setTimeframe, setDateRange, dateRange]);

  const handleUpdate = () => {
    toast.info('Data update started');
    updateMutation.mutate(undefined, {
      onSuccess: (data) => {
        if (data?.message?.includes('Offline')) {
          toast.info('Offline — showing cached data');
        } else {
          toast.success('Data updated successfully');
        }
      },
      onError: () => toast.error('Update failed — no cached data available'),
    });
  };

  const statusLabel = healthLoading ? 'Checking...' : health?.status === 'ok' ? 'Connected' : 'Offline';
  const statusColor = healthLoading ? 'bg-muted-foreground' : health?.status === 'ok' ? 'bg-[hsl(var(--chart-up))]' : 'bg-destructive';

  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 shrink-0">
      {/* Pair selector */}
      <Popover open={pairOpen} onOpenChange={setPairOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-[120px] justify-between">
            {pair.base}/{pair.quote}
            <ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0 bg-popover" align="start">
          <Command>
            <CommandInput placeholder="Search pair..." />
            <CommandList>
              <CommandEmpty>No pair found.</CommandEmpty>
              {CURRENCY_PAIRS.map(p => (
                <CommandItem key={p.symbol} onSelect={() => { setPair(p); setPairOpen(false); }} className="flex items-center justify-between">
                  <span>{p.base}/{p.quote}</span>
                  <button onClick={(e) => { e.stopPropagation(); toggleFavorite(p.symbol); }} className="p-0.5">
                    <Star className={cn("h-3.5 w-3.5", favorites.includes(p.symbol) ? "fill-warning text-warning" : "text-muted-foreground")} />
                  </button>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Timeframe selector */}
      <div className="flex rounded-md border border-border overflow-hidden">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => handleTimeframeChange(tf)}
            className={cn(
              "px-2.5 py-1.5 text-xs font-medium transition-colors",
              tf === '1H' && "border-l border-border",
              timeframe === tf ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-muted",
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <input type="date" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} max={dateRange.end} className="bg-input text-foreground border border-border rounded px-2 py-1 text-xs h-8" />
        <span className="text-muted-foreground text-xs">-</span>
        <input type="date" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} min={dateRange.start} max={new Date().toISOString().split('T')[0]} className="bg-input text-foreground border border-border rounded px-2 py-1 text-xs h-8" />
      </div>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" onClick={handleUpdate} disabled={updateMutation.isPending} className="h-8">
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", updateMutation.isPending && "animate-spin")} />
            <span>Update Data</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Fetch latest data for {pair.base}/{pair.quote}</TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-1.5 text-xs">
        <div className={cn("w-2 h-2 rounded-full", statusColor)} />
        <span className="text-muted-foreground">{statusLabel}</span>
      </div>
      {!isForexMarketOpen() && (
        <div className="flex items-center gap-1 text-xs text-blue-400 bg-blue-500/10 rounded px-2 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          Market closed
        </div>
      )}
    </header>
  );
}
