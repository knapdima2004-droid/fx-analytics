import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useReports, useGenerateReport } from '@/hooks/useApi';
import { useGlobalState } from '@/hooks/useGlobalState';
import * as api from '@/api/client';
import type { ModelType, ReportItem } from '@/types';
import { Download, Trash2, Eye, Plus, Loader2, Globe, Sparkles, Zap, ExternalLink, Info, FileSpreadsheet, FileText, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const ALL: ModelType[] = ['Naive', 'MovingAverage', 'ARIMA', 'Ridge', 'RandomForest', 'AIEnsemble'];
const DEFAULT_MODELS: ModelType[] = ['Naive', 'MovingAverage', 'ARIMA', 'Ridge', 'RandomForest'];

const MODEL_INFO: Record<ModelType, { desc: string; icon?: string }> = {
  Naive: { desc: 'Baseline — predicts next value = last observed value' },
  MovingAverage: { desc: 'Average of last N observations (window=10)' },
  ARIMA: { desc: 'ARIMA(1,1,1) — parametric time series model' },
  Ridge: { desc: 'Ridge regression with lagged returns as features' },
  RandomForest: { desc: 'Ensemble of 100 decision trees with lagged returns' },
  AIEnsemble: { desc: 'AI-enhanced model — uses GPT API (slow, costs money per bar!)', icon: '✨' },
};

export default function Reports() {
  const { data: reports, refetch } = useReports();
  const gen = useGenerateReport();
  const { pair, timeframe, dateRange } = useGlobalState();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelType[]>([...DEFAULT_MODELS]);
  const [charts, setCharts] = useState(true);
  const [tests, setTests] = useState(true);
  const [language, setLanguage] = useState<string>('sk');
  const [detailReport, setDetailReport] = useState<ReportItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportItem | null>(null);

  const toggle = (m: ModelType) => setModels(p => p.includes(m) ? p.filter(x => x !== m) : [...p, m]);
  const selectAll = () => setModels([...ALL]);
  const deselectAll = () => setModels([]);

  const generateReport = (selectedModels: ModelType[], lang: string) => {
    toast.info('Generating report with backtest... This may take 1-2 minutes.');
    gen.mutate(
      {
        pair: pair.symbol,
        timeframe,
        start: dateRange.start,
        end: dateRange.end,
        models: selectedModels,
        includeCharts: charts,
        includeTests: tests,
        language: lang,
      },
      {
        onSuccess: () => {
          setOpen(false);
          refetch();
          toast.success('Report ready! Both HTML and Excel versions generated from the same data.');
        },
        onError: (e: any) => toast.error(e?.message || 'Failed to generate report'),
      }
    );
  };

  const handleDownloadHtml = async (r: ReportItem) => {
    try {
      const blob = await api.downloadReport(r.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${r.pair}_${r.timeframe}_${r.id.slice(0, 8)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('HTML report downloaded');
    } catch {
      toast.error('Download failed');
    }
  };

  const handleDownloadExcel = async (r: ReportItem) => {
    try {
      const blob = await api.downloadReportExcel(r.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${r.pair}_${r.timeframe}_${r.id.slice(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Excel report downloaded');
    } catch {
      toast.error('Excel download failed');
    }
  };

  const handleOpenInBrowser = async (r: ReportItem) => {
    try {
      const blob = await api.downloadReport(r.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast.error('Failed to open report');
    }
  };

  const handleDelete = async (r: ReportItem) => {
    try {
      await api.deleteReport(r.id);
      refetch();
      setDeleteTarget(null);
      toast.success('Report deleted');
    } catch {
      toast.error('Delete failed');
    }
  };

  // Check if date range is long enough
  const days = Math.round((new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime()) / (1000 * 60 * 60 * 24));
  const tooShort = days < 60;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Reports</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Walk-forward backtest reports comparing all prediction models
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => generateReport([...DEFAULT_MODELS], 'sk')} disabled={gen.isPending || tooShort}>
            {gen.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            {gen.isPending ? 'Generating...' : 'Generate Report'}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Plus className="mr-2 h-4 w-4" />Custom</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Custom Report</DialogTitle>
                <DialogDescription>
                  Choose which models, language, and options to include
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm font-medium">{pair.base}/{pair.quote} | {timeframe}</p>
                  <p className="text-xs text-muted-foreground">{dateRange.start} to {dateRange.end} ({days} days)</p>
                  <p className="text-xs text-muted-foreground mt-1">Change pair, timeframe, or dates in the top bar</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Models</Label>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={selectAll}>All</Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={deselectAll}>None</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {ALL.map(m => (
                      <div key={m} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 transition-colors">
                        <Checkbox checked={models.includes(m)} onCheckedChange={() => toggle(m)} />
                        <div className="flex-1">
                          <span className="text-sm font-medium">
                            {MODEL_INFO[m].icon && <span className="mr-1">{MODEL_INFO[m].icon}</span>}
                            {m}
                          </span>
                          <p className="text-xs text-muted-foreground">{MODEL_INFO[m].desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sk">Slovenčina</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Include Charts</Label>
                      <p className="text-xs text-muted-foreground">Price chart, returns distribution</p>
                    </div>
                    <Switch checked={charts} onCheckedChange={setCharts} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Statistical Tests</Label>
                      <p className="text-xs text-muted-foreground">ADF, Ljung-Box, Diebold-Mariano</p>
                    </div>
                    <Switch checked={tests} onCheckedChange={setTests} />
                  </div>
                </div>

                <Button
                  onClick={() => generateReport(models, language)}
                  disabled={gen.isPending || !models.length || tooShort}
                  className="w-full"
                >
                  {gen.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {gen.isPending ? 'Generating... (1-2 min)' : `Generate Report (${models.length} models)`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Explanation card */}
      <Card className="border-dashed">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-4">
            <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">What are these reports?</p>
              <p>
                Each report runs a <strong>walk-forward backtest</strong> on historical data — the system trains each model
                on past data, makes predictions, then compares those predictions with actual prices. This shows which model
                performs best for the selected currency pair.
              </p>
              <p>
                <strong>Note:</strong> By default, AIEnsemble is <em>not</em> included because it calls GPT API for every bar and can be very slow and expensive.
                You can add it via "Custom" if needed, but expect longer generation times and API costs.
              </p>
              <p>
                Both <strong>HTML</strong> (viewable in browser) and <strong>Excel</strong> (detailed spreadsheet with charts)
                are generated from the <strong>same backtest run</strong>, so numbers are always identical.
              </p>
              <p className="text-xs">
                Currently using: <strong>{pair.base}/{pair.quote}</strong> | {timeframe} | {dateRange.start} to {dateRange.end}.
                Change in the top bar before generating.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {tooShort && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                  Date range too short ({days} days)
                </p>
                <p className="text-xs text-muted-foreground">
                  Reports need at least 60 data points for a meaningful backtest. Expand the date range in the top bar (recommended: 6-12 months).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {gen.isPending && (
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">Generating report...</p>
                <p className="text-xs text-muted-foreground">
                  Running walk-forward backtest for {pair.symbol}, computing statistics, and creating both HTML and Excel reports. This usually takes 1-2 minutes.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {!reports || !reports.length ? (
            <div className="text-center py-12 space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-muted-foreground font-medium">No reports yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Click <strong>"Generate Report"</strong> to create a full backtest comparison report.
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-muted-foreground font-medium">Created</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Pair</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">TF</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Range</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Models</th>
                  <th className="text-left py-2 text-muted-foreground font-medium">Status</th>
                  <th className="text-right py-2 text-muted-foreground font-medium">Download</th>
                </tr>
              </thead>
              <tbody>{reports.map(r => (
                <tr key={r.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                  <td className="py-2.5">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="py-2.5 font-medium">{r.pair}</td>
                  <td className="py-2.5">{r.timeframe}</td>
                  <td className="py-2.5 text-xs">{r.start} – {r.end}</td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.models.map(m => (
                        <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {m === 'AIEnsemble' ? '✨ AI' : m.slice(0, 4)}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5">
                    <Badge variant={r.status === 'Ready' ? 'default' : r.status === 'Generating' ? 'secondary' : 'destructive'}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="text-right py-2.5">
                    <div className="flex justify-end gap-1">
                      <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={r.status !== 'Ready'} onClick={() => handleOpenInBrowser(r)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger><TooltipContent>View HTML in browser</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={r.status !== 'Ready'} onClick={() => handleDownloadHtml(r)}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger><TooltipContent>Download HTML</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={r.status !== 'Ready' || !r.hasExcel} onClick={() => handleDownloadExcel(r)}>
                          <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                      </TooltipTrigger><TooltipContent>{r.hasExcel ? 'Download Excel' : 'Excel not available'}</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(r)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Details Drawer */}
      <Sheet open={!!detailReport} onOpenChange={() => setDetailReport(null)}>
        <SheetContent>
          <SheetHeader><SheetTitle>Report Details</SheetTitle></SheetHeader>
          {detailReport && (
            <div className="space-y-4 mt-4 text-sm">
              <div><span className="text-muted-foreground">Pair:</span> <span className="font-medium">{detailReport.pair}</span></div>
              <div><span className="text-muted-foreground">Timeframe:</span> <span>{detailReport.timeframe}</span></div>
              <div><span className="text-muted-foreground">Range:</span> <span>{detailReport.start} – {detailReport.end}</span></div>
              <div>
                <span className="text-muted-foreground">Models:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {detailReport.models.map(m => <Badge key={m} variant="secondary">{m}</Badge>)}
                </div>
              </div>
              <div><span className="text-muted-foreground">Created:</span> <span>{new Date(detailReport.createdAt).toLocaleString()}</span></div>
              <div><span className="text-muted-foreground">Status:</span> <Badge className="ml-2" variant={detailReport.status === 'Ready' ? 'default' : detailReport.status === 'Generating' ? 'secondary' : 'destructive'}>{detailReport.status}</Badge></div>
              {detailReport.status === 'Ready' && (
                <div className="space-y-2 pt-2">
                  <Button className="w-full" onClick={() => handleOpenInBrowser(detailReport)}>
                    <ExternalLink className="mr-2 h-4 w-4" />View in Browser
                  </Button>
                  <Button className="w-full" variant="outline" onClick={() => handleDownloadHtml(detailReport)}>
                    <FileText className="mr-2 h-4 w-4" />Download HTML
                  </Button>
                  {detailReport.hasExcel && (
                    <Button className="w-full" variant="outline" onClick={() => handleDownloadExcel(detailReport)}>
                      <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />Download Excel
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Report</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure? Both HTML and Excel files will be deleted.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && handleDelete(deleteTarget)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
