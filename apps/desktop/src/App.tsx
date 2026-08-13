import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAppStore } from '@/store/app-store';
import { LoginPage } from '@/pages/login-page';
import { AppShell } from '@/components/app-shell';
const DashboardPage=lazy(()=>import('@/pages/dashboard-page').then(module=>({default:module.DashboardPage})));
const TerminalsPage=lazy(()=>import('@/pages/terminals-page').then(module=>({default:module.TerminalsPage})));
const PlatformsPage=lazy(()=>import('@/pages/platforms-page').then(module=>({default:module.PlatformsPage})));
const LiveMonitorPage=lazy(()=>import('@/pages/live-monitor-page').then(module=>({default:module.LiveMonitorPage})));
const BacktestPage=lazy(()=>import('@/pages/backtest-page').then(module=>({default:module.BacktestPage})));
const ReplayPage=lazy(()=>import('@/pages/replay-page').then(module=>({default:module.ReplayPage})));
const AuditPage=lazy(()=>import('@/pages/audit-page').then(module=>({default:module.AuditPage})));
const ScreenProfilesPage=lazy(()=>import('@/pages/screen-profiles-page').then(module=>({default:module.ScreenProfilesPage})));
const SettingsPage=lazy(()=>import('@/pages/settings-page').then(module=>({default:module.SettingsPage})));
const StrategiesPage=lazy(()=>import('@/pages/strategies-page').then(module=>({default:module.StrategiesPage})));

const SchedulePlansPage=lazy(()=>import('@/pages/schedule-plans-page').then(module=>({default:module.SchedulePlansPage})));
const ControlRulesPage=lazy(()=>import('@/pages/control-rules-page').then(module=>({default:module.ControlRulesPage})));
const BankrollPage=lazy(()=>import('@/pages/bankroll-page').then(module=>({default:module.BankrollPage})));
const HistoryPage=lazy(()=>import('@/pages/history-page').then(module=>({default:module.HistoryPage})));
const GalesPage=lazy(()=>import('@/pages/gales-page').then(module=>({default:module.GalesPage})));
const AiAnalystPage=lazy(()=>import('@/pages/ai-analyst-page').then(module=>({default:module.AiAnalystPage})));

export function App() {
  const { initialize, loading, session, error } = useAppStore();
  useEffect(() => {
    void initialize();
    return window.aviator.onDataChanged(() => void useAppStore.getState().refresh());
  }, [initialize]);
  if (loading && !session) return <div className="grid min-h-screen place-items-center bg-canvas"><div className="text-center"><div className="loader mx-auto"/><p className="mt-4 text-xs text-muted">Inicializando serviços locais...</p></div></div>;
  if (error && !session) return <div className="grid min-h-screen place-items-center bg-canvas p-6 text-ink"><div className="max-w-md rounded-lg border border-danger/30 bg-panel p-6 text-center"><h1 className="text-base font-semibold">Não foi possível iniciar</h1><p className="mt-2 text-xs leading-5 text-muted">{error}</p><button onClick={() => void initialize()} className="mt-4 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white">Tentar novamente</button></div></div>;
  if (!session) return <LoginPage />;
  return <Suspense fallback={<div className="grid min-h-[60vh] place-items-center"><div className="loader"/></div>}>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/terminals" element={<TerminalsPage />} />
        <Route path="/platforms" element={<PlatformsPage />} />
        <Route path="/live" element={<LiveMonitorPage />} />
        <Route path="/backtest" element={<BacktestPage />} />
        <Route path="/replay" element={<ReplayPage />} />
        <Route path="/logs" element={<AuditPage />} />
        <Route path="/screen-profiles" element={<ScreenProfilesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/strategies" element={<StrategiesPage />} />
        <Route path="/bet-plans" element={<Navigate to="/strategies" replace />} />
        <Route path="/schedule-plans" element={<SchedulePlansPage />} />
        <Route path="/control-rules" element={<ControlRulesPage />} />
        <Route path="/bankroll" element={<BankrollPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/gales" element={<GalesPage />} />
        <Route path="/ai-analyst" element={<AiAnalystPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  </Suspense>;
}
