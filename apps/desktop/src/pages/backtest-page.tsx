import { useMemo, useState } from 'react';
import { Activity, Banknote, Download, Play, TrendingDown, TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BacktestRun } from '@aviator/shared';
import { Button, Card } from '@/components/ui';
import { useAppStore } from '@/store/app-store';

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function BacktestPage() {
  const { platforms, gameStrategies, betStrategies, betPlans } = useAppStore();
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? '');
  const [gameStrategyId, setGameStrategyId] = useState(gameStrategies[0]?.id ?? '');
  const [betStrategyId, setBetStrategyId] = useState(betStrategies[0]?.id ?? '');
  const [betPlanId, setBetPlanId] = useState(betPlans[0]?.id ?? '');
  const [bankroll, setBankroll] = useState(1000);
  const [limit, setLimit] = useState(1000);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const chart = useMemo(() => run?.trace.filter((_, index) => index % Math.max(1, Math.floor(run.trace.length / 220)) === 0).map((item, index) => ({ index, banca: item.bankrollCents / 100, multiplicador: item.multiplier })) ?? [], [run]);

  async function execute() {
    setRunning(true); setError(null);
    const result = await window.aviator.runBacktest({ platformId, gameStrategyId, betStrategyId, betPlanId, initialBankrollCents: Math.round(bankroll * 100), limit });
    if (result.ok && result.data) setRun(result.data); else setError(result.error ?? 'Não foi possível executar o backtest.');
    setRunning(false);
  }
  function exportRun(format:'json'|'csv'){if(!run)return;const content=format==='json'?JSON.stringify(run,null,2):['rodada,data,multiplicador,anotacao,resultado_jogo,decisao,etapa,resultado_etapa,lucro_centavos,banca_centavos',...run.trace.map(item=>[item.roundId,item.occurredAt,item.multiplier,item.annotationRole,item.gameResult??'',item.decisionAction??'',item.stageLabel??'',item.stageResult??'',item.stageProfitLossCents,item.bankrollCents].map(value=>`"${String(value).replaceAll('"','""')}"`).join(','))].join('\n');const url=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`backtest-${new Date().toISOString().slice(0,19).replaceAll(':','-')}.${format}`;anchor.click();URL.revokeObjectURL(url);}

  return <div className="p-5">
    <div className="mb-5 flex items-end justify-between"><div><h2 className="text-xl font-bold">Backtest financeiro</h2><p className="mt-1 text-xs text-muted">Reprocessa o histórico cronológico com os mesmos motores usados nos Terminais.</p></div><div className="flex gap-2">{run&&<><Button onClick={()=>exportRun('csv')} className="border-line bg-panel text-muted"><Download size={13}/>CSV</Button><Button onClick={()=>exportRun('json')} className="border-line bg-panel text-muted"><Download size={13}/>JSON</Button></>}<Button onClick={() => void execute()} disabled={running || !platformId} className="bg-brand text-white"><Play size={14}/>{running ? 'Processando...' : 'Executar backtest'}</Button></div></div>
    <Card className="mb-3 grid grid-cols-2 gap-3 p-4 xl:grid-cols-6"><Select label="Plataforma" value={platformId} onChange={setPlatformId} options={platforms}/><Select label="Estratégia de jogo" value={gameStrategyId} onChange={setGameStrategyId} options={gameStrategies}/><Select label="Estratégia de entrada" value={betStrategyId} onChange={setBetStrategyId} options={betStrategies}/><Select label="Estratégia de aposta" value={betPlanId} onChange={setBetPlanId} options={betPlans}/><NumberField label="Banca inicial (R$)" value={bankroll} onChange={setBankroll}/><NumberField label="Rodadas" value={limit} onChange={setLimit}/></Card>
    {error && <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-red-200">{error}</div>}
    {!run ? <Card className="grid min-h-[360px] place-items-center p-8 text-center"><div><Activity className="mx-auto text-muted" size={34}/><div className="mt-3 text-sm font-semibold">Pronto para simular</div><p className="mt-1 text-xs text-muted">Selecione os componentes e execute sobre as rodadas persistidas.</p></div></Card> : <>
      {run.report.stoppedByLimit&&<div className="mb-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">Simulação interrompida/protegida: {run.report.stoppedByLimit}</div>}<div className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-8"><Metric label="Lucro líquido" value={money(run.report.profitCents)} icon={run.report.profitCents >= 0 ? TrendingUp : TrendingDown} tone={run.report.profitCents >= 0 ? 'text-success' : 'text-danger'}/><Metric label="ROI" value={`${run.report.roi.toFixed(2)}%`} icon={TrendingUp}/><Metric label="Taxa de WIN" value={`${run.report.winRate.toFixed(1)}%`} icon={TrendingUp}/><Metric label="Média / entrada" value={money(run.report.averageProfitPerEntryCents)} icon={Banknote}/><Metric label="Banca final" value={money(run.report.finalBankrollCents)} icon={Banknote}/><Metric label="Drawdown máx." value={money(run.report.maxDrawdownCents)} icon={TrendingDown}/><Metric label="Entradas" value={String(run.report.betEntries)} icon={Activity}/><Metric label="Exposição máx." value={money(run.report.maximumExposureCents)} icon={Banknote}/></div>
      <div className="grid gap-3 xl:grid-cols-[1fr_320px]"><Card className="p-4"><div className="label mb-4">Curva da banca</div><div className="h-[330px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><defs><linearGradient id="bankroll" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={.35}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#26303d" strokeDasharray="3 3"/><XAxis dataKey="index" stroke="#738094" fontSize={10}/><YAxis stroke="#738094" fontSize={10}/><Tooltip contentStyle={{background:'#111820',border:'1px solid #26303d',fontSize:11}} formatter={(value) => money(Number(value) * 100)}/><Area type="monotone" dataKey="banca" stroke="#60a5fa" fill="url(#bankroll)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div></Card><Card className="p-4"><div className="label mb-4">Resultado por ciclo</div><Result label="WIN direto" value={run.report.winDirect}/><Result label="WIN Gale 1" value={run.report.winG1}/><Result label="WIN Gale 2" value={run.report.winG2}/><Result label="WIN Gale 3+" value={run.report.winG3}/><Result label="LOSS final" value={run.report.lossFinal} danger/><div className="mt-4 border-t border-line pt-4"><Result label="Sinais de jogo" value={run.report.gameSignals}/><Result label="Rodadas analisadas" value={run.report.totalRounds}/><Result label="Ignoradas" value={run.report.ignored}/></div></Card></div>
    </>}
  </div>;
}

function Select({label,value,onChange,options}:{label:string;value:string;onChange(value:string):void;options:Array<{id:string;name:string}>}) { return <label><span className="label">{label}</span><select className="mt-2 w-full rounded-md border-line bg-canvas text-xs" value={value} onChange={e=>onChange(e.target.value)}>{options.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>; }
function NumberField({label,value,onChange}:{label:string;value:number;onChange(value:number):void}) { return <label><span className="label">{label}</span><input className="mt-2 w-full rounded-md border-line bg-canvas text-xs" type="number" min="10" max="300000" value={value} onChange={e=>onChange(Number(e.target.value))}/></label>; }
function Metric({label,value,icon:Icon,tone='text-blue-300'}:{label:string;value:string;icon:typeof Activity;tone?:string}) { return <Card className="p-3"><div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-muted"><Icon size={13} className={tone}/>{label}</div><div className={`mt-2 font-mono text-base font-bold ${tone}`}>{value}</div></Card>; }
function Result({label,value,danger=false}:{label:string;value:number;danger?:boolean}) { return <div className="mb-2 flex items-center justify-between rounded-md bg-canvas px-3 py-2 text-xs"><span className="text-muted">{label}</span><span className={`font-mono font-bold ${danger?'text-danger':'text-ink'}`}>{value}</span></div>; }
