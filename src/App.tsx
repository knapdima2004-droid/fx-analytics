import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { GlobalStateProvider } from "@/hooks/useGlobalState";
import { ReportStoreProvider } from "@/hooks/useReportStore";
import { AppLayout } from "@/components/layout/AppLayout";
import { resolveBackendPort, isElectron, onBackendReady } from "@/api/client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import ChartPage from "./pages/ChartPage";
import Prediction from "./pages/Prediction";
import Backtest from "./pages/Backtest";
import Reports from "./pages/Reports";
import CurrencyConverter from "./pages/CurrencyConverter";
import Settings from "./pages/Settings";
import Guide from "./pages/Guide";
import StrategyReport from "./pages/StrategyReport";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function BackendReadyWatcher() {
  const qc = useQueryClient();
  useEffect(() => {
    onBackendReady(() => {
      qc.invalidateQueries();
    });
  }, [qc]);
  return null;
}

const App = () => {
  const [ready, setReady] = useState(!isElectron());

  useEffect(() => {
    if (isElectron()) {
      const timeout = setTimeout(() => setReady(true), 3000);
      resolveBackendPort().then(() => {
        clearTimeout(timeout);
        setReady(true);
      });
      return () => clearTimeout(timeout);
    }
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-lg">Starting FX Analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BackendReadyWatcher />
      <GlobalStateProvider>
        <ReportStoreProvider>
          <TooltipProvider>
            <HashRouter>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/guide" element={<Guide />} />
                  <Route path="/chart" element={<ChartPage />} />
                  <Route path="/prediction" element={<Prediction />} />
                  <Route path="/backtest" element={<Backtest />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/converter" element={<CurrencyConverter />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/strategy-report" element={<StrategyReport />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </AppLayout>
            </HashRouter>
            <Sonner />
          </TooltipProvider>
        </ReportStoreProvider>
      </GlobalStateProvider>
    </QueryClientProvider>
  );
};

export default App;
