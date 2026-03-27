import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as api from '@/api/client';
import { ArrowRightLeft, RefreshCw, TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// Currency flags (emoji)
const FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CHF: '🇨🇭',
  CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', SEK: '🇸🇪', NOK: '🇳🇴',
  DKK: '🇩🇰', PLN: '🇵🇱', CZK: '🇨🇿', HUF: '🇭🇺', TRY: '🇹🇷', CNY: '🇨🇳',
};

export default function CurrencyConverter() {
  const [fromCurrency, setFromCurrency] = useState('EUR');
  const [toCurrency, setToCurrency] = useState('USD');
  const [amount, setAmount] = useState('1000');
  const [converted, setConverted] = useState<api.ConvertResponse | null>(null);
  // Track previous rates for color highlighting
  const prevRatesRef = useRef<Record<string, number>>({});
  const [rateChanges, setRateChanges] = useState<Record<string, 'up' | 'down' | 'same'>>({});

  // Live rates with auto-refresh every 7s
  const { data: ratesData, isLoading: ratesLoading, refetch: refetchRates, dataUpdatedAt } = useQuery({
    queryKey: ['liveRates'],
    queryFn: () => api.getLiveRates(),
    refetchInterval: 7_000,
    staleTime: 5_000,
  });

  // Compare rates with previous values when data updates
  useEffect(() => {
    if (!ratesData?.rates) return;
    const prev = prevRatesRef.current;
    const changes: Record<string, 'up' | 'down' | 'same'> = {};
    for (const r of ratesData.rates) {
      const prevRate = prev[r.currency];
      if (prevRate !== undefined) {
        if (r.rateVsUsd > prevRate) changes[r.currency] = 'up';
        else if (r.rateVsUsd < prevRate) changes[r.currency] = 'down';
        else changes[r.currency] = 'same';
      } else {
        changes[r.currency] = 'same';
      }
      prev[r.currency] = r.rateVsUsd;
    }
    setRateChanges(changes);
    // Clear flash after 2s
    const timer = setTimeout(() => setRateChanges({}), 2000);
    return () => clearTimeout(timer);
  }, [ratesData]);

  const { data: currencies } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => api.getCurrencies(),
    staleTime: 300_000,
  });

  const convertMutation = useMutation({
    mutationFn: () => api.convertCurrency(fromCurrency, toCurrency, parseFloat(amount) || 0),
    onSuccess: (data) => setConverted(data),
  });

  // Auto-convert when inputs change
  useEffect(() => {
    const num = parseFloat(amount);
    if (!num || num <= 0) return;
    const timer = setTimeout(() => convertMutation.mutate(), 300);
    return () => clearTimeout(timer);
  }, [fromCurrency, toCurrency, amount, ratesData]);

  const swapCurrencies = useCallback(() => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  }, [fromCurrency, toCurrency]);

  // Compute cross rates from USD-based rates for the table
  const crossRates = useMemo(() => {
    if (!ratesData?.rates) return [];
    const rates = ratesData.rates;
    // Find the from-currency rate vs USD
    const fromRate = rates.find(r => r.currency === fromCurrency);
    if (!fromRate) return [];

    return rates
      .filter(r => r.currency !== fromCurrency)
      .map(r => ({
        currency: r.currency,
        name: r.name,
        rate: r.rateVsUsd / fromRate.rateVsUsd,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }, [ratesData, fromCurrency]);

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '...';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Currency Converter</h2>
          <p className="text-sm text-muted-foreground mt-1">Live exchange rates with automatic updates</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>Updated: {lastUpdate}</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" onClick={() => refetchRates()} className="h-8">
                <RefreshCw className={cn("h-3.5 w-3.5", ratesLoading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh rates</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Converter Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Convert</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-center gap-4">
            {/* Amount + From */}
            <div className="flex-1 w-full space-y-2">
              <label className="text-xs text-muted-foreground font-medium">Amount</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="text-lg font-semibold h-12"
                  min={0}
                  step="any"
                />
                <Select value={fromCurrency} onValueChange={setFromCurrency}>
                  <SelectTrigger className="w-[140px] h-12">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies?.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        <span className="flex items-center gap-2">
                          <span>{FLAGS[c.code] || '💱'}</span>
                          <span>{c.code}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Swap button */}
            <Button variant="outline" size="icon" className="rounded-full h-10 w-10 mt-4 shrink-0" onClick={swapCurrencies}>
              <ArrowRightLeft className="h-4 w-4" />
            </Button>

            {/* Result + To */}
            <div className="flex-1 w-full space-y-2">
              <label className="text-xs text-muted-foreground font-medium">Converted</label>
              <div className="flex gap-2">
                <div className="flex-1 h-12 bg-muted/50 border border-border rounded-md flex items-center px-3">
                  <span className="text-lg font-semibold">
                    {converted ? converted.result.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}
                  </span>
                </div>
                <Select value={toCurrency} onValueChange={setToCurrency}>
                  <SelectTrigger className="w-[140px] h-12">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies?.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        <span className="flex items-center gap-2">
                          <span>{FLAGS[c.code] || '💱'}</span>
                          <span>{c.code}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Rate info */}
          {converted && (
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {FLAGS[fromCurrency]} 1 {fromCurrency} = {converted.rate.toFixed(6)} {toCurrency} {FLAGS[toCurrency]}
              </span>
              <Badge variant="secondary" className="text-xs">Live</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick converter buttons */}
      <div className="flex flex-wrap gap-2">
        {[100, 500, 1000, 5000, 10000, 50000].map(val => (
          <Button key={val} variant="outline" size="sm" className="text-xs" onClick={() => setAmount(String(val))}>
            {val.toLocaleString()} {fromCurrency}
          </Button>
        ))}
      </div>

      {/* Rates Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Exchange Rates (1 {fromCurrency} = ...)
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {crossRates.length} currencies
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {ratesLoading && !crossRates.length ? (
            <div className="text-center py-8 text-muted-foreground">Loading rates...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {crossRates.map(r => {
                const change = rateChanges[r.currency];
                return (
                  <button
                    key={r.currency}
                    onClick={() => setToCurrency(r.currency)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-all duration-500 text-left",
                      toCurrency === r.currency
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/30",
                      change === 'up' && "bg-green-500/10 border-green-500/40",
                      change === 'down' && "bg-red-500/10 border-red-500/40",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{FLAGS[r.currency] || '💱'}</span>
                      <div>
                        <div className="font-medium text-sm">{r.currency}</div>
                        <div className="text-xs text-muted-foreground">{r.name}</div>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-1.5">
                      <div className={cn(
                        "font-mono font-semibold text-sm transition-colors duration-500",
                        change === 'up' && "text-green-400",
                        change === 'down' && "text-red-400",
                      )}>
                        {r.rate >= 100 ? r.rate.toFixed(2) : r.rate >= 1 ? r.rate.toFixed(4) : r.rate.toFixed(6)}
                      </div>
                      {change === 'up' && <TrendingUp className="h-3.5 w-3.5 text-green-400" />}
                      {change === 'down' && <TrendingDown className="h-3.5 w-3.5 text-red-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
