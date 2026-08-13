import { Bell, Bot, ChartNoAxesCombined, ChevronDown, CircleDollarSign, Clock3, Database, FileClock, FlaskConical, Gauge, History, Layers3, Maximize2, Menu, Minus, MonitorCog, PanelLeftClose, PlaySquare, Settings, ShieldCheck, Sparkles, SquareTerminal, TrendingUp, Workflow, X } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

const nav = [
  ['Dashboard', '/dashboard', Gauge], ['Terminais', '/terminals', SquareTerminal], ['Monitor ao vivo', '/live', PlaySquare],
  ['Analista IA', '/ai-analyst', Sparkles],
  ['Estratégias', '/strategies', FlaskConical], ['Planos de horários','/schedule-plans',Clock3], ['Regras de controle','/control-rules',Workflow], ['Banca', '/bankroll', CircleDollarSign], ['Histórico','/history',History], ['Gales','/gales',TrendingUp],
  ['Plataformas', '/platforms', Database], ['Backtest', '/backtest', ChartNoAxesCombined], ['Replay', '/replay', FileClock],
  ['Perfis de tela', '/screen-profiles', MonitorCog], ['Logs', '/logs', Layers3]
] as const;

export function AppShell() {
  const { session, logout } = useAppStore();
  const location = useLocation();
  const label = location.pathname.startsWith('/settings') ? 'Configurações' : nav.find(([, path]) => location.pathname.startsWith(path))?.[0] ?? 'Laboratório';
  return <div className="min-h-screen bg-canvas text-ink">
    <header className="drag-region fixed inset-x-0 top-0 z-40 flex h-9 items-center border-b border-line bg-[#090c10] pl-3">
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted"><Bot size={14} className="text-brand" /> AVIATOR STRATEGY LAB <span className="font-mono text-[9px] text-muted/50">v1.1.0</span></div>
      <div className="no-drag ml-auto flex h-full"><button onClick={() => void window.aviator.windowMinimize()} className="title-button"><Minus size={14}/></button><button onClick={() => void window.aviator.windowMaximize()} className="title-button"><Maximize2 size={12}/></button><button onClick={() => void window.aviator.windowClose()} className="title-button hover:bg-danger"><X size={14}/></button></div>
    </header>
    <aside className="fixed bottom-0 left-0 top-9 z-30 flex w-60 flex-col border-r border-line bg-[#10151c]">
      <div className="flex h-[76px] items-center gap-3 border-b border-line px-4"><div className="grid h-10 w-10 place-items-center rounded-lg border border-brand/30 bg-brand/10"><Bot className="text-blue-300" size={22}/></div><div><div className="text-sm font-bold">Aviator Lab</div><div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-bold tracking-[.16em] text-success"><span className="h-1.5 w-1.5 rounded-full bg-success"/> LOCAL MASTER</div></div></div>
      <nav className="scrollbar flex-1 overflow-y-auto p-2"><div className="px-3 pb-2 pt-2 text-[9px] font-bold uppercase tracking-[.18em] text-muted/60">Workspace</div>{nav.map(([name,path,Icon]) => <NavLink key={path} to={path} className={({isActive}) => cn('group mb-0.5 flex h-9 items-center gap-3 rounded-md px-3 text-[12px] text-muted transition hover:bg-elevated hover:text-ink', isActive && 'bg-brand/10 text-blue-300 ring-1 ring-inset ring-brand/15')}><Icon size={16}/><span>{name}</span></NavLink>)}</nav>
      <div className="border-t border-line p-2"><NavLink to="/settings" className="flex h-9 items-center gap-3 rounded-md px-3 text-[12px] text-muted hover:bg-elevated hover:text-ink"><Settings size={16}/> Configurações</NavLink><button onClick={() => void logout()} className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-elevated"><div className="grid h-7 w-7 place-items-center rounded-full bg-brand text-[10px] font-bold text-white">MC</div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium">{session?.email}</div><div className="text-[9px] text-muted">Encerrar sessão</div></div><ChevronDown size={13} className="text-muted"/></button></div>
    </aside>
    <div className="ml-60 pt-9"><div className="fixed left-60 right-0 top-9 z-20 flex h-14 items-center border-b border-line bg-canvas/95 px-5 backdrop-blur"><button className="mr-3 text-muted"><PanelLeftClose size={18}/></button><div><div className="text-[9px] font-bold uppercase tracking-[.15em] text-muted">Aviator Strategy Lab</div><h1 className="text-sm font-semibold">{label}</h1></div><div className="ml-auto flex items-center gap-2"><div className="hidden items-center gap-2 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[10px] text-muted xl:flex"><ShieldCheck size={13} className="text-success"/> Sistema local protegido</div><button className="relative grid h-8 w-8 place-items-center rounded-md border border-line bg-panel text-muted hover:text-ink"><Bell size={15}/><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand"/></button><button className="grid h-8 w-8 place-items-center rounded-md border border-line bg-panel text-muted"><Menu size={15}/></button></div></div><main className="min-h-[calc(100vh-5.75rem)] pt-14"><Outlet /></main></div>
  </div>;
}
