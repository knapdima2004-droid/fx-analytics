import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useHealth, useAiStatus } from '@/hooks/useApi';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Server, Database, Brain, Globe, Info, Trash2, ExternalLink, CheckCircle, XCircle } from 'lucide-react';

export default function Settings() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('apiBaseUrl') || '');
  const [confirmReset, setConfirmReset] = useState(false);
  const { data: health, isLoading: hLoading } = useHealth();
  const { data: aiStatus, isLoading: aiLoading } = useAiStatus();

  const handleSaveUrl = () => {
    if (apiUrl.trim()) {
      localStorage.setItem('apiBaseUrl', apiUrl.trim());
    } else {
      localStorage.removeItem('apiBaseUrl');
    }
    toast.success('API URL saved. Reloading...');
    setTimeout(() => window.location.reload(), 800);
  };

  const handleReset = () => {
    localStorage.clear();
    toast.success('Data cleared. Reloading...');
    setTimeout(() => window.location.reload(), 1000);
  };

  const backendOk = health?.status === 'ok';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Application configuration and system status</p>
      </div>

      {/* System Status */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" />System Status</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span>Backend API</span>
              </div>
              {hLoading ? <Skeleton className="h-5 w-24" /> : (
                <div className="flex items-center gap-2">
                  {backendOk ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                  <Badge variant={backendOk ? 'default' : 'destructive'}>{backendOk ? 'Connected' : 'Offline'}</Badge>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span>AI Analysis</span>
              </div>
              {aiLoading ? <Skeleton className="h-5 w-24" /> : (
                <div className="flex items-center gap-2">
                  {aiStatus?.available ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-amber-500" />}
                  <Badge variant={aiStatus?.available ? 'default' : 'secondary'}>
                    {aiStatus?.available ? 'Active' : 'Not configured'}
                  </Badge>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Data Source</span>
              <Badge variant="secondary">Yahoo Finance (yfinance)</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Configuration */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" />API Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Backend URL</Label>
            <div className="flex gap-2">
              <Input value={apiUrl} onChange={e => setApiUrl(e.target.value)} className="h-9" />
              <Button size="sm" onClick={handleSaveUrl}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">Leave empty to use auto-detection ({window.location.origin}/api)</p>
          </div>
        </CardContent>
      </Card>

      {/* Supported Data */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" />Supported Data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Currency Pairs</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {['EUR/USD', 'USD/JPY', 'GBP/USD', 'EUR/GBP', 'USD/CHF'].map(p => (
                <Badge key={p} variant="secondary">{p}</Badge>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Timeframes</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {[
                { tf: '1M', label: '1 Minute' },
                { tf: '5M', label: '5 Minutes' },
                { tf: '15M', label: '15 Minutes' },
                { tf: '30M', label: '30 Minutes' },
                { tf: '1H', label: '1 Hour' },
                { tf: '4H', label: '4 Hours' },
                { tf: '1D', label: '1 Day' },
              ].map(({ tf, label }) => (
                <Badge key={tf} variant="outline" className="text-xs">{tf} ({label})</Badge>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Prediction Models</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {[
                { name: 'Naive', desc: 'Baseline' },
                { name: 'Moving Average', desc: 'Smoothing' },
                { name: 'ARIMA', desc: 'Time series' },
                { name: 'Ridge', desc: 'Linear ML' },
                { name: 'RandomForest', desc: 'Non-linear ML' },
                { name: 'AI Ensemble', desc: 'AI-enhanced' },
              ].map(m => (
                <Badge key={m.name} variant="outline" className="text-xs">{m.name}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Info className="h-4 w-4" />About</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">Application</span>
            <span className="font-medium">FX Analytics</span>
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">v0.1.0</span>
            <span className="text-muted-foreground">Frontend</span>
            <span>React + TypeScript + Tailwind CSS</span>
            <span className="text-muted-foreground">Backend</span>
            <span>Python FastAPI + SQLAlchemy</span>
            <span className="text-muted-foreground">Charts</span>
            <span>Lightweight Charts + Recharts</span>
            <span className="text-muted-foreground">Data Source</span>
            <span>Yahoo Finance (yfinance)</span>
          </div>
          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            Statistical processing and evaluation of selected currency pairs. 
            Bachelor's thesis project — analysis, prediction, and comparison of FX forecasting models.
          </p>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2 text-destructive"><Trash2 className="h-4 w-4" />Danger Zone</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Reset Application Data</p>
              <p className="text-xs text-muted-foreground">Clears all saved preferences, favorites, and cached settings. The page will reload.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmReset(true)}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset App Data</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will clear all saved preferences, presets, and favorites. The page will reload. Are you sure?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReset}>Reset Everything</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
