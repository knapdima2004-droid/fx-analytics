import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { TopBar } from './TopBar';
import { useGlobalState } from '@/hooks/useGlobalState';

const FULL_BLEED_ROUTES = ['/'];

export function AppLayout({ children }: { children: ReactNode }) {
  const { sidebarCollapsed, setSidebarCollapsed } = useGlobalState();
  const location = useLocation();
  const isFullBleed = FULL_BLEED_ROUTES.includes(location.pathname);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar />
        <main className={`flex-1 ${isFullBleed ? 'overflow-hidden' : 'overflow-auto p-6'}`}>{children}</main>
      </div>
    </div>
  );
}
