import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, BookOpen, BarChart3, TrendingUp, FlaskConical, FileText, ArrowRightLeft, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/guide', label: 'Guide', icon: BookOpen },
  { path: '/chart', label: 'Chart', icon: BarChart3 },
  { path: '/prediction', label: 'Forecast', icon: TrendingUp },
  { path: '/backtest', label: 'Analysis', icon: FlaskConical },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/converter', label: 'Converter', icon: ArrowRightLeft },
  { path: '/settings', label: 'Settings', icon: Settings },
];

interface Props { collapsed: boolean; onToggle: () => void; }

export function AppSidebar({ collapsed, onToggle }: Props) {
  const location = useLocation();
  return (
    <aside className={cn("h-screen flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200 shrink-0", collapsed ? "w-14" : "w-56")}>
      <Link to="/" className={cn("h-14 flex items-center border-b border-sidebar-border hover:bg-sidebar-accent/30 transition-colors cursor-pointer", collapsed ? "justify-center" : "px-4")}>
        {collapsed ? <span className="text-sidebar-primary font-bold text-lg">FX</span> : <span className="font-bold text-sidebar-primary text-lg tracking-tight">FX Analytics</span>}
      </Link>
      <nav className="flex-1 py-3 space-y-0.5">
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.path} className={cn("flex items-center gap-3 mx-2 px-3 py-2.5 rounded-md text-sm transition-colors", active ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground")}>
              <item.icon size={18} className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
      <button onClick={onToggle} className="h-10 flex items-center justify-center border-t border-sidebar-border text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors">
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  );
}
