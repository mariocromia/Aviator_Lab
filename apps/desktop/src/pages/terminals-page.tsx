import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Bot, Clock3, Copy, Pause, Play, Plus, ReceiptText, RotateCcw, Search, Settings2, SquareTerminal, Trash2, Zap } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NormalizedRound, ScreenProfile, Terminal, TerminalHistoryItem, TerminalRuntime } from '@aviator/shared';
import { Badge, Button, Card, Modal } from '@/components/ui';
import { money } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

export function TerminalsPage() {
  const store = useAppStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Terminal | null>(null);
  const [chartTerminal, setChartTerminal] = useState<Terminal | null>(null);
  const[chartHistory,setChartHistory]=useState<TerminalHistoryItem[]>([]);
  const [statementTerminal, setStatementTerminal] = useState<Terminal | null>(null);
  const [scheduleTerminal,setScheduleTerminal]=useState<Terminal|null>(null);
  const [botTerminal, setBotTerminal] = useState<Terminal | null>(null);
  const[resettingTerminal,setResettingTerminal]=useState<Terminal|null>(null);
  const[bankrollTerminal,setBankrollTerminal]=useState<Terminal|null>(null);
  const [query, setQuery] = useState('');
  const terminals = store.terminals.filter(terminal => terminal.name.toLowerCase().includes(query.toLowerCase()));
  useEffect(()=>{if(!chartTerminal){setChartHistory([]);return}let active=true;void window.aviator.getTerminalHistory(chartTerminal.id,5000).then(result=>{if(active&&result.ok&&result.data)setChartHistory(result.data)});return()=>{active=false}},[chartTerminal?.id]);

  function configure(terminal: Terminal) { store.clearError(); setEditing(terminal); }

  return <div className="p-5">
    <div className="mb-5 flex items-end justify-between">
      <div><h2 className="text-xl font-bold">Terminais</h2><p className="mt-1 text-xs text-muted">Runtimes independentes com análise W/L e decisões de aposta isoladas.</p></div>
      <Button onClick={() => { store.clearError(); setCreating(true); }} className="bg-brand text-white hover:bg-blue-600"><Plus size={14}/> Novo Terminal</Button>
    </div>
    <div className="mb-3 flex items-center justify-between">
      <div className="relative w-72"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar Terminal..." className="h-9 w-full rounded-md border-line bg-panel pl-9 text-xs text-ink placeholder:text-muted/60 focus:border-brand focus:ring-0"/></div>
      <div className="font-mono text-[10px] text-muted">{terminals.length} TERMINAIS • {terminals.filter(terminal => !terminal.paused).length} ATIVOS</div>
    </div>
    <div className="grid gap-3 xl:grid-cols-2">
      {terminals.map(terminal => {
        const platform = store.platforms.find(item => item.id === terminal.platformId);
        const strategy = store.gameStrategies.find(item => item.id === terminal.gameStrategyId);
        const runtime = store.terminalRuntimes.find(item => item.terminalId === terminal.id);
        const analyzer = runtime?.resultAnalyzerState;
        const history = store.terminalHistories[terminal.id] ?? [];
        const screenProfile = store.screenProfiles.find(profile => profile.terminalId === terminal.id);
        const schedule=store.terminalSchedules.find(item=>item.terminalId===terminal.id);
        const schedulePlan=store.schedulePlans.find(item=>item.id===schedule?.schedulePlanId);
        const isPaused=terminal.paused||runtime?.status==='PAUSED';
        const streak = analyzer?.currentWinStreak ? `W${analyzer.currentWinStreak}` : analyzer?.currentLossStreak ? `L${analyzer.currentLossStreak}` : '—';
        return <Card key={terminal.id} className="overflow-hidden">
          <div className="flex items-center border-b border-line px-4 py-3">
            <div className={`mr-3 grid h-9 w-9 place-items-center rounded-lg ${isPaused ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}><SquareTerminal size={18}/></div>
            <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">{terminal.name}</h3><Badge tone={isPaused ? 'warning' : 'success'}>{translateTerminalStatus(runtime?.status??(terminal.paused?'PAUSED':'RUNNING'))}</Badge></div><div className="mt-1 truncate font-mono text-[9px] text-muted">ID {terminal.id}</div></div>
            <div className="ml-auto flex shrink-0 items-center gap-1 pl-3">
              <TerminalIconButton title={isPaused?'Retomar Terminal':'Pausar Terminal'} onClick={()=>void store.setTerminalPaused(terminal.id,!isPaused)} tone={isPaused?'success':'warning'}>{isPaused?<Play size={13}/>:<Pause size={13}/>}</TerminalIconButton>
              <TerminalIconButton title="Duplicar Terminal" onClick={()=>void store.duplicateTerminal(terminal.id)}><Copy size={13}/></TerminalIconButton>
              <TerminalIconButton title="Excluir Terminal" onClick={()=>{if(window.confirm(`Excluir ${terminal.name}? O histórico operacional deste Terminal será removido.`))void store.deleteTerminal(terminal.id)}} tone="danger"><Trash2 size={13}/></TerminalIconButton>
              <TerminalIconButton title="Opções de reset" onClick={()=>{store.clearError();setResettingTerminal(terminal)}} tone="warning"><RotateCcw size={13}/></TerminalIconButton>
              <TerminalIconButton title="Abrir gráfico" onClick={()=>setChartTerminal(terminal)}><BarChart3 size={13}/></TerminalIconButton>
              <TerminalIconButton title="Abrir extrato" onClick={()=>setStatementTerminal(terminal)}><ReceiptText size={13}/></TerminalIconButton>
              <TerminalIconButton title="Configurar bot visual" onClick={()=>{store.clearError();setBotTerminal(terminal)}}><Bot size={13}/></TerminalIconButton>
              <TerminalIconButton title="Selecionar plano de horários" onClick={()=>setScheduleTerminal(terminal)}><Clock3 size={13}/></TerminalIconButton>
              <TerminalIconButton title="Configurar Terminal" onClick={()=>configure(terminal)}><Settings2 size={14}/></TerminalIconButton>
            </div>
          </div>
          <div className="grid grid-cols-[1.25fr_1.25fr_1.35fr_.9fr_.6fr_.75fr] divide-x divide-line border-b border-line">
            <button type="button" title="Editar banca inicial" onClick={()=>{store.clearError();setBankrollTerminal(terminal)}} className="min-w-0 px-3 py-3 text-left transition hover:bg-elevated"><div className="label truncate">Banca inicial</div><div className="mt-1 whitespace-nowrap font-mono text-[11px] font-semibold">{money(terminal.initialBankrollCents)}</div><div className="mt-0.5 text-[8px] text-muted">CLIQUE PARA EDITAR</div></button>
            <Stat label="Saldo" value={money(terminal.currentBankrollCents)}/>
            <Stat label="Lucro / perda" value={signedMoney(terminal.currentBankrollCents-terminal.initialBankrollCents)} tone={terminal.currentBankrollCents>=terminal.initialBankrollCents?'success':'danger'}/>
            <Stat label="Sinais W/L" value={`${analyzer?.winCount ?? terminal.gameWins}/${analyzer?.lossCount ?? terminal.gameLosses}`}/>
            <Stat label="Seq." value={streak}/>
            <LastRoundStat platformId={terminal.platformId} value={runtime?.gameStrategyRuntime.lastMultiplier ? `${runtime.gameStrategyRuntime.lastMultiplier.toFixed(2)}x` : '—'} indicator={roundAnalysisIndicator(runtime)}/>
          </div>
          <div className="space-y-2 p-4 text-[11px]">
            <Row label="Plataforma" value={platform?.name ?? '—'} extra="coletor compartilhado"/>
            <Row label="Estratégia" value={strategy?.name ?? '—'}/>
            <Row label="Estado" value={translateOperationalState(runtime)} badge="strategy"/>
            <PatternDots history={history}/>
            <Row label="Decisão de aposta" value={translateDecision(runtime?.betStrategyRuntime.lastAction)} badge="decision"/>
            <Row label="Ciclo de aposta" value={runtime?.galeRuntime.active ? `${runtime.galeRuntime.currentStage === 0 ? 'BASE' : `GALE ${runtime.galeRuntime.currentStage}`} ${runtime.galeRuntime.followUp&&runtime.galeRuntime.followUpBehavior==='REPEAT_UNTIL_LOSS'?'PÓS-WIN':'AGUARDANDO'}` : 'SEM CICLO ATIVO'}/>
            <Row label="Bot visual" value={screenProfile ? 'CONFIGURADO' : 'NÃO CONFIGURADO'} badge="decision"/>
            <Row label="Plano de horários" value={schedulePlan?.name??'SEMPRE ATIVO'}/>
            {!runtime?.scheduleState.allowed&&<Row label="Bloqueio de horário" value={runtime?.scheduleState.reason==='INTERVALO_BLOQUEADO'?'INTERVALO BLOQUEADO':'FORA DO HORÁRIO'}/>} 
            {runtime?.pauseState.type!=='NONE'&&<Row label="Motivo da pausa" value={runtime?.pauseState.reason??'Pausa sem motivo informado'}/>} 
            <Row label="Modo" value={terminal.mode==='SIMULATION'?'SIMULAÇÃO':'ASSISTIDO'}/>
          </div>
          <TerminalTimeline history={history}/>
        </Card>;
      })}
    </div>
    <TerminalModal open={creating} terminal={null} onClose={() => setCreating(false)}/>
    <TerminalModal key={editing?.id??'terminal-editor'} open={editing !== null} terminal={editing} onClose={() => setEditing(null)}/>
    <TerminalChartModal terminal={chartTerminal} history={chartHistory} onClose={() => setChartTerminal(null)}/>
    <TerminalStatementModal terminal={statementTerminal} history={statementTerminal ? store.terminalHistories[statementTerminal.id] ?? [] : []} onClose={() => setStatementTerminal(null)}/>
    <ScreenProfileModal terminal={botTerminal} profile={botTerminal ? store.screenProfiles.find(item => item.terminalId === botTerminal.id) ?? null : null} onClose={() => setBotTerminal(null)}/>
    <TerminalScheduleModal terminal={scheduleTerminal} onClose={()=>setScheduleTerminal(null)}/>
    <TerminalResetModal terminal={resettingTerminal} onClose={()=>setResettingTerminal(null)}/>
    <InitialBankrollModal terminal={bankrollTerminal} onClose={()=>setBankrollTerminal(null)}/>
  </div>;
}

function TerminalResetModal({terminal,onClose}:{terminal:Terminal|null;onClose():void}){
  const store=useAppStore();const[saving,setSaving]=useState(false);
  async function reset(mode:'FINANCIAL'|'FULL'){if(!terminal)return;if(mode==='FULL'&&!window.confirm(`Limpar também todas as bolinhas e o histórico operacional de ${terminal.name}? Esta ação não pode ser desfeita.`))return;setSaving(true);const ok=await store.resetTerminal(terminal.id,mode);setSaving(false);if(ok)onClose();}
  return <Modal title={`Resetar • ${terminal?.name??'Terminal'}`} open={terminal!==null} onClose={onClose}><div className="space-y-3 p-5"><button type="button" disabled={saving} onClick={()=>void reset('FINANCIAL')} className="w-full rounded-lg border border-line bg-canvas p-4 text-left transition hover:border-brand disabled:opacity-50"><div className="text-xs font-semibold text-ink">Somente banca e valores</div><p className="mt-1 text-[10px] leading-5 text-muted">Restaura saldo, lucro/prejuízo e acumuladores financeiros. Preserva bolinhas, apostas, extrato, sequências e histórico.</p></button><button type="button" disabled={saving} onClick={()=>void reset('FULL')} className="w-full rounded-lg border border-danger/30 bg-danger/5 p-4 text-left transition hover:bg-danger/10 disabled:opacity-50"><div className="text-xs font-semibold text-danger">Banca, valores e bolinhas</div><p className="mt-1 text-[10px] leading-5 text-muted">Além dos valores financeiros, limpa sinais W/L, apostas, extrato, ciclos e histórico operacional deste terminal.</p></button>{store.error&&<div className="rounded-md border border-danger/25 bg-danger/10 p-3 text-[10px] text-red-200">{store.error}</div>}<div className="flex justify-end"><Button type="button" onClick={onClose} className="border-line bg-panel text-muted">Cancelar</Button></div></div></Modal>;
}

function InitialBankrollModal({terminal,onClose}:{terminal:Terminal|null;onClose():void}){
  const store=useAppStore();const[saving,setSaving]=useState(false);const[value,setValue]=useState('');
  useEffect(()=>{setValue(terminal?(terminal.initialBankrollCents/100).toFixed(2):'')},[terminal?.id,terminal?.initialBankrollCents]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!terminal)return;const cents=Math.round(Number(value.replace(',','.'))*100);if(!Number.isFinite(cents)||cents<0)return;setSaving(true);const ok=await store.updateTerminalInitialBankroll(terminal.id,cents);setSaving(false);if(ok)onClose();}
  return <Modal title={`Editar banca inicial • ${terminal?.name??'Terminal'}`} open={terminal!==null} onClose={onClose}><form onSubmit={submit} className="p-5"><Field label="Nova banca inicial (R$)"><input autoFocus value={value} onChange={event=>setValue(event.target.value)} inputMode="decimal" placeholder="1000,00" required/></Field><p className="mt-3 text-[10px] leading-5 text-muted">Ao salvar, a banca inicial e o saldo atual assumirão este valor. Bolinhas, apostas e histórico serão preservados.</p>{store.error&&<div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-3 text-[10px] text-red-200">{store.error}</div>}<div className="mt-5 flex justify-end gap-2"><Button type="button" onClick={onClose} className="border-line bg-panel text-muted">Cancelar</Button><Button disabled={saving||!value} className="bg-brand text-white">{saving?'Salvando...':'Salvar banca'}</Button></div></form></Modal>;
}

function TerminalScheduleModal({terminal,onClose}:{terminal:Terminal|null;onClose():void}){
  const store=useAppStore();const current=terminal?store.terminalSchedules.find(item=>item.terminalId===terminal.id):null;const[selected,setSelected]=useState('');const[saving,setSaving]=useState(false);
  useEffect(()=>{setSelected(current?.schedulePlanId??'')},[current?.schedulePlanId,terminal?.id]);
  async function save(){if(!terminal)return;setSaving(true);const saved=await store.setTerminalSchedulePlan(terminal.id,selected||null);setSaving(false);if(saved)onClose();}
  return <Modal title={`Plano de horários • ${terminal?.name??'Terminal'}`} open={terminal!==null} onClose={onClose}><div className="p-5"><div className="rounded-md border border-line bg-canvas p-4"><Field label="Plano selecionado"><select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Sempre ativo — sem restrições</option>{store.schedulePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field><p className="mt-3 text-[10px] leading-5 text-muted">O Terminal ignora rodadas fora dos intervalos permitidos ou dentro dos intervalos bloqueados. A pausa manual continua tendo prioridade.</p></div>{store.error&&<div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-3 text-[10px] text-red-200">{store.error}</div>}<div className="mt-5 flex justify-end gap-2"><Button onClick={onClose} className="border-line bg-panel text-muted">Cancelar</Button><Button onClick={()=>void save()} disabled={saving} className="bg-brand text-white"><Clock3 size={13}/>{saving?'Salvando...':'Aplicar plano'}</Button></div></div></Modal>;
}

function TerminalTimeline({ history }: { history: TerminalHistoryItem[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => { const element = viewport.current; if (element) element.scrollLeft = element.scrollWidth; }, [history.length]);
  return <div className="border-t border-line bg-canvas/35 px-3 py-2.5">
    <div className="mb-2 flex items-center justify-between"><span className="label">Linha do tempo operacional</span><span className="font-mono text-[9px] text-muted">JOGO + INTERSEÇÃO DO CICLO • {history.length} SINAIS</span></div>
    <div ref={viewport} className="overflow-x-auto pb-1.5">
      <div className="flex min-w-max items-stretch gap-1">
        {history.length === 0 && <div className="w-full py-4 text-center text-[10px] text-muted">Aguardando sinais do Terminal.</div>}
        {history.map((item, index) => <div key={item.signalId} className="flex items-center gap-1">
          {index > 0 && <span className="h-px w-2 bg-line"/>}
          <div className={`w-[84px] rounded-md border p-1.5 ${item.gameResult === 'WIN' ? 'border-success/25 bg-success/5' : 'border-danger/25 bg-danger/5'}`}>
            <div className="flex items-center justify-between"><span className="text-[8px] font-bold uppercase tracking-wider text-muted">Jogo</span><span className={`font-mono text-[11px] font-black ${item.gameResult === 'WIN' ? 'text-success' : 'text-danger'}`}>{item.gameResult === 'WIN' ? 'W' : 'L'}</span></div>
            <div className="mt-1 font-mono text-[9px] text-muted">{item.multiplier?.toFixed(2) ?? '—'}x</div>
            <div className="mt-1.5 border-t border-line/70 pt-1">
              {item.stage ? <><div className="truncate text-[7px] font-bold text-blue-300">{item.stage.stageLabel}</div><div className={`mt-0.5 font-mono text-[7px] font-bold ${item.stage.result === 'WIN' ? 'text-success' : 'text-danger'}`}>{item.stage.result==='WIN'?'GANHOU':'PERDEU'}</div>{item.execution&&<div className={`mt-0.5 truncate font-mono text-[7px] ${item.execution.profitLossCents>=0?'text-success':'text-danger'}`}>{signedMoney(item.execution.profitLossCents)}</div>}</> : item.decisionAction === 'ENTER' ? <div className="font-mono text-[7px] font-bold text-warning">BASE ARMADA</div> : <div className="text-[7px] text-muted">SEM APOSTA</div>}
            </div>
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}

function TerminalStatementModal({ terminal, history, onClose }: { terminal: Terminal | null; history: TerminalHistoryItem[]; onClose(): void }) {
  const rows=history.filter(item=>item.execution).map(item=>({item,execution:item.execution!}));
  const totalStake=rows.reduce((total,row)=>total+row.execution.stakeCents,0);
  const profitLoss=rows.reduce((total,row)=>total+row.execution.profitLossCents,0);
  let maxWins=0;let maxLosses=0;let wins=0;let losses=0;
  for(const row of rows){if(row.execution.result==='WIN'){wins++;losses=0;maxWins=Math.max(maxWins,wins)}else{losses++;wins=0;maxLosses=Math.max(maxLosses,losses)}}
  const lastResult=rows.at(-1)?.execution.result;let currentStreak=0;
  for(let index=rows.length-1;index>=0&&rows[index].execution.result===lastResult;index--)currentStreak++;
  return <Modal className="max-w-6xl" title={`Extrato de apostas • ${terminal?.name??'Terminal'}`} open={terminal!==null} onClose={onClose}>
    <div className="p-5">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <ChartMetric label="Saldo atual" value={money(terminal?.currentBankrollCents??0)}/>
        <ChartMetric label="Total apostado" value={money(totalStake)}/>
        <ChartMetric label="Ganho / perda" value={signedMoney(profitLoss)}/>
        <ChartMetric label="Apostas" value={String(rows.length)}/>
        <ChartMetric label="Sequência atual" value={lastResult?`${translateResult(lastResult)} × ${currentStreak}`:'—'}/>
        <ChartMetric label="Máximas W / L" value={`${maxWins} / ${maxLosses}`}/>
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-md border border-line">
        <table className="w-full min-w-[980px] text-left text-[10px]">
          <thead className="sticky top-0 z-10 bg-elevated text-muted"><tr><StatementHead>Data</StatementHead><StatementHead>Rodada</StatementHead><StatementHead>Etapa</StatementHead><StatementHead>Multiplicador</StatementHead><StatementHead>Resultado</StatementHead><StatementHead>Apostado</StatementHead><StatementHead>Retorno</StatementHead><StatementHead>Ganho / perda</StatementHead><StatementHead>Saldo</StatementHead></tr></thead>
          <tbody className="divide-y divide-line">{rows.map(({item,execution})=><tr key={execution.id} className="bg-panel hover:bg-elevated/70">
            <StatementCell>{new Date(execution.createdAt).toLocaleString('pt-BR')}</StatementCell><StatementCell mono>{item.signalId.slice(0,8)}</StatementCell><StatementCell><Badge tone={execution.stageIndex===0?'brand':'warning'}>{execution.stageLabel}</Badge></StatementCell><StatementCell mono>{execution.multiplier.toFixed(2)}x</StatementCell><StatementCell><Badge tone={execution.result==='WIN'?'success':'danger'}>{translateResult(execution.result)}</Badge></StatementCell><StatementCell mono>{money(execution.stakeCents)}</StatementCell><StatementCell mono>{money(execution.returnedCents)}</StatementCell><StatementCell mono className={execution.profitLossCents>=0?'text-success':'text-danger'}>{signedMoney(execution.profitLossCents)}</StatementCell><StatementCell mono>{money(execution.bankrollAfterCents)}</StatementCell>
          </tr>)}{rows.length===0&&<tr><td colSpan={9} className="py-12 text-center text-xs text-muted">Nenhuma aposta liquidada neste Terminal.</td></tr>}</tbody>
        </table>
      </div>
      <div className="mt-3 text-[9px] text-muted">O extrato considera somente apostas efetivamente liquidadas. As perdas usadas apenas como gatilho não alteram a banca.</div>
    </div>
  </Modal>;
}

function StatementHead({children}:{children:ReactNode}){return <th className="whitespace-nowrap px-3 py-2.5 font-semibold uppercase tracking-wider">{children}</th>}
function StatementCell({children,mono=false,className=''}:{children:ReactNode;mono?:boolean;className?:string}){return <td className={`whitespace-nowrap px-3 py-2.5 ${mono?'font-mono':''} ${className}`}>{children}</td>}

function TerminalChartModal({ terminal, history, onClose }: { terminal: Terminal | null; history: TerminalHistoryItem[]; onClose(): void }) {
  const[chartType,setChartType]=useState<'AREA'|'LINE'|'BAR'>('AREA');const[range,setRange]=useState<'30'|'60'|'100'|'250'|'500'|'ALL'>('100');
  let gameScore = 0; let betScore = 0;
  const allData = history.map((item, index) => {
    gameScore += item.gameResult === 'WIN' ? 1 : -1;
    if (item.stage) betScore += item.stage.result === 'WIN' ? 1 : -1;
    return { index: index + 1, gameScore, betScore, multiplier: item.multiplier ?? 0,bankroll:(item.execution?.bankrollAfterCents??terminal?.currentBankrollCents??0)/100 };
  });
  const data=range==='ALL'?allData:allData.slice(-Number(range));
  const gameWins = history.filter(item => item.gameResult === 'WIN').length;
  const stageEvents = history.filter(item => item.stage);
  const betWins = stageEvents.filter(item => item.stage?.result === 'WIN').length;
  const common=<><CartesianGrid stroke="#222a34" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="index" stroke="#66717e" fontSize={10}/><YAxis stroke="#66717e" fontSize={10}/><Tooltip contentStyle={{ background: '#161b22', border: '1px solid #2d333b', fontSize: 11 }}/></>;
  return <Modal className="max-w-7xl" title={`Gráfico • ${terminal?.name ?? 'Terminal'}`} open={terminal !== null} onClose={onClose}>
    <div className="p-5">
      <div className="mb-4 flex items-end gap-3"><div className="grid flex-1 grid-cols-3 gap-3"><ChartMetric label="Sinais" value={String(history.length)}/><ChartMetric label="Taxa de ganhos do jogo" value={history.length ? `${(gameWins / history.length * 100).toFixed(1)}%` : '0%'}/><ChartMetric label="Taxa de ganhos das apostas" value={stageEvents.length ? `${(betWins / stageEvents.length * 100).toFixed(1)}%` : '0%'}/></div><Field label="Intervalo"><select value={range} onChange={event=>setRange(event.target.value as typeof range)}><option value="30">30 sinais</option><option value="60">60 sinais</option><option value="100">100 sinais</option><option value="250">250 sinais</option><option value="500">500 sinais</option><option value="ALL">Até 5.000 sinais</option></select></Field><Field label="Tipo de gráfico"><select value={chartType} onChange={event=>setChartType(event.target.value as typeof chartType)}><option value="AREA">Área</option><option value="LINE">Linhas</option><option value="BAR">Barras</option></select></Field></div>
      <div className="h-[500px] rounded-md border border-line bg-canvas p-3">
        {data.length ? <ResponsiveContainer width="100%" height="100%">{chartType==='AREA'?<AreaChart data={data}><defs><linearGradient id="gameScore" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity={.35}/><stop offset="1" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs>{common}<Area type="monotone" dataKey="gameScore" name="Saldo W/L jogo" stroke="#60a5fa" fill="url(#gameScore)"/><Area type="monotone" dataKey="betScore" name="Saldo W/L apostas" stroke="#22c55e" fill="transparent"/></AreaChart>:chartType==='LINE'?<LineChart data={data}>{common}<Line type="monotone" dataKey="gameScore" name="Saldo W/L jogo" stroke="#60a5fa" dot={false}/><Line type="monotone" dataKey="betScore" name="Saldo W/L apostas" stroke="#22c55e" dot={false}/><Line type="monotone" dataKey="multiplier" name="Multiplicador" stroke="#a78bfa" dot={false}/></LineChart>:<BarChart data={data}>{common}<Bar dataKey="gameScore" name="Saldo W/L jogo" fill="#60a5fa"/><Bar dataKey="betScore" name="Saldo W/L apostas" fill="#22c55e"/></BarChart>}</ResponsiveContainer> : <div className="grid h-full place-items-center text-xs text-muted">Aguardando histórico para gerar o gráfico.</div>}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[9px] text-muted"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand"/> Resultado do jogo</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success"/> Resultado dos estágios apostados</span></div>
    </div>
  </Modal>;
}

function ChartMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-line bg-canvas p-3"><div className="label">{label}</div><div className="mt-1 font-mono text-lg font-bold">{value}</div></div>; }

function ScreenProfileModal({ terminal, profile, onClose }: { terminal: Terminal | null; profile: ScreenProfile | null; onClose(): void }) {
  const store = useAppStore(); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!terminal) return; store.clearError(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const number = (name: string) => Number(form.get(name));
    const slot = (name: 'bet1' | 'bet2') => ({ enabled: form.get(`${name}.enabled`) === 'on', amountCents: Math.round(number(`${name}.amountValue`) * 100), cashout: number(`${name}.cashoutValue`), amount: { x: number(`${name}.amount.x`), y: number(`${name}.amount.y`) }, cashoutField: { x: number(`${name}.cashout.x`), y: number(`${name}.cashout.y`) }, action: { x: number(`${name}.action.x`), y: number(`${name}.action.y`) } });
    const saved = await store.saveScreenProfile({ terminalId: terminal.id, name: String(form.get('name')), resolutionWidth: number('resolutionWidth'), resolutionHeight: number('resolutionHeight'), windowTitle: String(form.get('windowTitle')).trim() || null, bet1: slot('bet1'), bet2: slot('bet2') });
    setSaving(false); if (saved) onClose();
  }
  const fallback = { enabled: true, amountCents: 100, cashout: 2, amount: { x: 0, y: 0 }, cashoutField: { x: 0, y: 0 }, action: { x: 0, y: 0 } };
  return <Modal title={`Bot visual • ${terminal?.name ?? 'Terminal'}`} open={terminal !== null} onClose={onClose}>
    <form onSubmit={submit} className="max-h-[78vh] overflow-y-auto p-5">
      <div className="mb-4 rounded-md border border-warning/25 bg-warning/10 p-3 text-[10px] leading-5 text-yellow-100">Este perfil prepara valores e coordenadas por Terminal. A execução de mouse/teclado permanece bloqueada até o Screen Controller e o agente PyAutoGUI serem ativados.</div>
      <div className="grid grid-cols-2 gap-4"><Field label="Nome" className="col-span-2"><input name="name" defaultValue={profile?.name ?? `Bot ${terminal?.name ?? ''}`} required/></Field><Field label="Largura"><input name="resolutionWidth" type="number" min="640" defaultValue={profile?.resolutionWidth ?? 1920} required/></Field><Field label="Altura"><input name="resolutionHeight" type="number" min="480" defaultValue={profile?.resolutionHeight ?? 1080} required/></Field><Field label="Título da janela" className="col-span-2"><input name="windowTitle" defaultValue={profile?.windowTitle ?? ''} placeholder="Opcional"/></Field></div>
      <ScreenSlotFields slot="bet1" title="Bet 1" value={profile?.bet1 ?? fallback}/>
      <ScreenSlotFields slot="bet2" title="Bet 2" value={profile?.bet2 ?? { ...fallback, enabled: false }}/>
      {store.error && <div className="mt-4 rounded-md border border-danger/25 bg-danger/10 p-3 text-[11px] text-red-200">{store.error}</div>}
      <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-2 border-t border-line bg-panel px-5 py-4 shadow-[0_-10px_30px_rgba(0,0,0,.25)]"><Button type="button" onClick={onClose} className="border-line bg-panel text-muted">Cancelar</Button><Button disabled={saving} className="bg-brand text-white"><Bot size={13}/>{saving ? 'Salvando...' : 'Salvar perfil do bot'}</Button></div>
    </form>
  </Modal>;
}

function ScreenSlotFields({ slot, title, value }: { slot: 'bet1' | 'bet2'; title: string; value: ScreenProfile['bet1'] }) {
  return <fieldset className="mt-4 rounded-md border border-line p-4"><div className="mb-3 flex items-center justify-between"><legend className="text-xs font-semibold">{title}</legend><label className="flex items-center gap-2 text-[10px] text-muted"><input name={`${slot}.enabled`} type="checkbox" defaultChecked={value.enabled}/> Ativa</label></div><div className="grid grid-cols-2 gap-3"><Field label="Valor (R$)"><input name={`${slot}.amountValue`} type="number" min="0" step="0.01" defaultValue={(value.amountCents / 100).toFixed(2)} required/></Field><Field label="Cashout"><input name={`${slot}.cashoutValue`} type="number" min="1.01" step="0.01" defaultValue={value.cashout} required/></Field><CoordinateFields prefix={`${slot}.amount`} label="Campo valor" value={value.amount}/><CoordinateFields prefix={`${slot}.cashout`} label="Campo cashout" value={value.cashoutField}/><CoordinateFields prefix={`${slot}.action`} label="Botão ação" value={value.action}/></div></fieldset>;
}

function CoordinateFields({ prefix, label, value }: { prefix: string; label: string; value: { x: number; y: number } }) { return <div className="col-span-2 grid grid-cols-[1fr_.65fr_.65fr] items-end gap-2"><span className="pb-2 text-[10px] text-muted">{label}</span><Field label="X"><input name={`${prefix}.x`} type="number" min="0" defaultValue={value.x} required/></Field><Field label="Y"><input name={`${prefix}.y`} type="number" min="0" defaultValue={value.y} required/></Field></div>; }

function Stat({ label, value,tone,indicator }: { label: string; value: string;tone?:'success'|'danger';indicator?:{symbol:string;label:string;tone:string}|null }) { return <div className="min-w-0 px-3 py-3"><div className="label truncate">{label}</div><div className={`mt-1 whitespace-nowrap font-mono text-[11px] font-semibold ${tone==='success'?'text-success':tone==='danger'?'text-danger':''}`}>{value}</div>{indicator&&<div title={indicator.label} aria-label={indicator.label} className={`mt-0.5 font-mono text-[11px] font-black leading-none ${indicator.tone}`}>{indicator.symbol}</div>}</div>; }

function LastRoundStat({platformId,value,indicator}:{platformId:string;value:string;indicator:{symbol:string;label:string;tone:string}|null}){
  const[popover,setPopover]=useState<{left:number;top:number}|null>(null);
  const[rounds,setRounds]=useState<NormalizedRound[]>([]);
  const[loading,setLoading]=useState(false);
  async function open(element:HTMLDivElement){const rect=element.getBoundingClientRect();setPopover({left:Math.max(8,Math.min(rect.right-320,window.innerWidth-328)),top:rect.bottom+6});setLoading(true);const result=await window.aviator.getRecentRounds(platformId,50);if(result.ok&&result.data)setRounds(result.data.slice(0,15));setLoading(false);}
  return <><div className="min-w-0 cursor-help px-3 py-3" onMouseEnter={event=>void open(event.currentTarget)} onMouseLeave={()=>setPopover(null)}><div className="label truncate">Último</div><div className="mt-1 whitespace-nowrap font-mono text-[11px] font-semibold">{value}</div>{indicator&&<div title={indicator.label} aria-label={indicator.label} className={`mt-0.5 font-mono text-[11px] font-black leading-none ${indicator.tone}`}>{indicator.symbol}</div>}</div>{popover&&createPortal(<div className="pointer-events-none fixed z-[9998] w-80 rounded-lg border border-line bg-elevated p-3 shadow-2xl" style={popover}><div className="mb-2 flex items-center justify-between"><span className="label">Últimas 15 rodadas da plataforma</span><span className="font-mono text-[9px] text-muted">MAIS RECENTE PRIMEIRO</span></div>{loading?<div className="py-4 text-center font-mono text-[10px] text-muted">CARREGANDO...</div>:rounds.length===0?<div className="py-4 text-center font-mono text-[10px] text-muted">SEM RODADAS</div>:<div className="grid grid-cols-3 gap-1.5">{rounds.map(round=><div key={round.id} className="rounded border border-line bg-canvas px-2 py-1.5"><div className={`font-mono text-[11px] font-bold ${round.multiplier>=2?'text-success':round.multiplier<1.35?'text-danger':'text-warning'}`}>{round.multiplier.toFixed(2)}x</div><div className="mt-0.5 font-mono text-[8px] text-muted">{new Date(round.occurredAt).toLocaleTimeString('pt-BR')}</div></div>)}</div>}</div>,document.body)}</>;
}

function TerminalIconButton({title,onClick,children,tone='neutral'}:{title:string;onClick():void;children:ReactNode;tone?:'neutral'|'success'|'warning'|'danger'}){const colors={neutral:'text-muted hover:bg-elevated hover:text-ink',success:'text-success hover:bg-success/10',warning:'text-warning hover:bg-warning/10',danger:'text-muted hover:bg-danger/10 hover:text-danger'};return <button type="button" title={title} aria-label={title} onClick={onClick} className={`grid h-7 w-7 place-items-center rounded-md border border-line ${colors[tone]}`}>{children}</button>}

function PatternDots({history}:{history:TerminalHistoryItem[]}){
  const viewport=useRef<HTMLDivElement>(null);
  const[dotTooltip,setDotTooltip]=useState<{x:number;y:number;content:string}|null>(null);
  const results=history.slice(-100);
  useEffect(()=>{const element=viewport.current;if(element)element.scrollLeft=element.scrollWidth},[history.length]);
  if(results.length===0)return <span className="text-muted">—</span>;
  return <><div ref={viewport} className="w-full min-w-0 overflow-x-auto pb-1.5" aria-label={results.map(item=>item.gameResult==='WIN'?'GANHO':'PERDA').join(', ')}><div className="flex w-max items-start gap-[3px]">{results.map(item=>{
    const galeLevel=item.stage?.stageIndex??0;
    const resultStyle=item.gameResult==='WIN'?'bg-slate-200 text-slate-950':'bg-slate-700 text-white';
    const betStyle=item.stage?(galeLevel===0?'border-blue-400 ring-1 ring-blue-400':'border-yellow-300 ring-1 ring-yellow-300'):(item.gameResult==='WIN'?'border-white':'border-slate-400');
    const betStage=item.stage?(galeLevel===0?'BASE':`G${galeLevel}`):'SEM APOSTA';
    const title=[
      `Resultado: ${item.gameResult==='WIN'?'WIN':'LOSS'}`,
      `Multiplicador: ${item.multiplier==null?'—':`${item.multiplier.toFixed(2)}x`}`,
      `Situação: ${item.stage?`APOSTA ${betStage}`:betStage}`,
      `Lucro / prejuízo: ${item.execution?signedMoney(item.execution.profitLossCents):'—'}`
    ].join('\n');
    const showTooltip=(x:number,y:number)=>setDotTooltip({x,y,content:title});
    return <span key={item.signalId} className="flex h-6 shrink-0 cursor-help items-start" onMouseEnter={event=>showTooltip(event.clientX,event.clientY)} onMouseMove={event=>showTooltip(event.clientX,event.clientY)} onMouseLeave={()=>setDotTooltip(null)}><span className="relative"><span className={`grid h-4 w-4 place-items-center rounded-full border font-mono text-[8px] font-black leading-none shadow-sm ${resultStyle} ${betStyle}`}>{item.gameResult==='WIN'?'W':'L'}</span>{galeLevel>0&&<span className="absolute -bottom-[5px] left-1/2 flex -translate-x-1/2 gap-px">{Array.from({length:galeLevel},(_,marker)=><span key={marker} className="h-1 w-1 rounded-full bg-red-500"/>)}</span>}</span></span>;
  })}</div></div>{dotTooltip&&createPortal(<div role="tooltip" className="pointer-events-none fixed z-[9999] min-w-52 whitespace-pre-line rounded-md border border-line bg-elevated px-3 py-2 font-mono text-[10px] leading-5 text-ink shadow-2xl" style={{left:Math.min(dotTooltip.x+12,window.innerWidth-240),top:Math.min(dotTooltip.y+12,window.innerHeight-100)}}>{dotTooltip.content}</div>,document.body)}</>;
}

function Row({ label, value, extra, badge }: { label: string; value: string; extra?: string; badge?: 'strategy' | 'decision' }) {
  const tone = badge === 'decision' ? value === 'ENTRAR' ? 'success' : value === 'PAUSAR' ? 'danger' : 'neutral' : badge === 'strategy' ? ['AGUARDANDO RESULTADO','CONTINUANDO ATÉ LOSS'].includes(value)||value.startsWith('APOSTA ') ? 'success' : value === 'AGUARDANDO LIBERAÇÃO' ? 'warning' : 'neutral' : null;
  return <div className="flex items-center justify-between"><span className="text-muted">{label}</span><span className="flex items-center gap-2 font-medium">{tone ? <Badge tone={tone}>{value}</Badge> : value}{extra && <span className="text-[9px] text-muted">({extra})</span>}</span></div>;
}

function TerminalModal({ open, terminal, onClose }: { open: boolean; terminal: Terminal | null; onClose(): void }) {
  const store = useAppStore();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); store.clearError(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const common = { name: form.get('name'), sortOrder:Number(form.get('sortOrder')), platformId: form.get('platformId'), gameStrategyId: form.get('gameStrategyId'), betStrategyId: form.get('betStrategyLossId'), betStrategyWinId:form.get('betStrategyWinId'),betStrategyLossId:form.get('betStrategyLossId'), betPlanId: form.get('betPlanLossId'),betPlanWinId:form.get('betPlanWinId'),betPlanLossId:form.get('betPlanLossId'), mode: form.get('mode') };
    const saved = terminal
      ? await store.updateTerminal({ id: terminal.id, ...common })
      : await store.createTerminal({ ...common, initialBankrollCents: Math.round(Number(form.get('bankroll')) * 100) });
    setSaving(false); if (saved) onClose();
  }

  return <Modal title={terminal ? `Configurar ${terminal.name}` : 'Novo Terminal'} open={open} onClose={onClose}>
    <form onSubmit={submit} className="grid grid-cols-2 gap-4 p-5">
      <Field label="Nome"><input name="name" defaultValue={terminal?.name ?? `Terminal ${store.terminals.length + 1}`} required/></Field><Field label="Ordem de classificação"><input name="sortOrder" type="number" min="0" step="1" defaultValue={terminal?.sortOrder??(store.terminals.length?Math.max(...store.terminals.map(item=>item.sortOrder))+10:10)} required/></Field>
      <Field label="Plataforma"><select name="platformId" defaultValue={terminal?.platformId}>{store.platforms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Modo"><select name="mode" defaultValue={terminal?.mode ?? 'SIMULATION'}><option value="SIMULATION">Simulação</option><option value="ASSISTED">Assistido</option></select></Field>
      <Field label="Estratégia de jogo" className="col-span-2"><select name="gameStrategyId" defaultValue={terminal?.gameStrategyId}>{store.gameStrategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Estratégia de entrada após WIN"><select name="betStrategyWinId" defaultValue={terminal?.betStrategyWinId??terminal?.betStrategyId}>{store.betStrategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Plano de aposta após WIN"><select name="betPlanWinId" defaultValue={terminal?.betPlanWinId??terminal?.betPlanId}>{store.betPlans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Estratégia de entrada após LOSS"><select name="betStrategyLossId" defaultValue={terminal?.betStrategyLossId??terminal?.betStrategyId}>{store.betStrategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Plano de aposta após LOSS"><select name="betPlanLossId" defaultValue={terminal?.betPlanLossId??terminal?.betPlanId}>{store.betPlans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      {!terminal && <Field label="Banca inicial (R$)" className="col-span-2"><input name="bankroll" type="number" min="0" step="0.01" defaultValue="1000.00" required/></Field>}
      {store.error && <div className="col-span-2 rounded-md border border-danger/25 bg-danger/10 p-3 text-[11px] text-red-200">{store.error}</div>}
      <div className="col-span-2 mt-2 flex justify-end gap-2"><Button type="button" onClick={onClose} className="border-line bg-panel text-muted">Cancelar</Button><Button disabled={saving} className="bg-brand text-white"><Zap size={13}/>{saving ? 'Salvando...' : terminal ? 'Salvar alterações' : 'Criar Terminal'}</Button></div>
    </form>
  </Modal>;
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) { return <label className={className}><span className="label">{label}</span><div className="form-field mt-1.5">{children}</div></label>; }
function signedMoney(value:number){return `${value>=0?'+':'−'} ${money(Math.abs(value))}`}
function translateTerminalStatus(status:string){return status==='RUNNING'?'EM EXECUÇÃO':status==='PAUSED'?'PAUSADO':status==='STOPPED'?'PARADO':status}
function translateOperationalState(runtime:TerminalRuntime|undefined){if(runtime?.galeRuntime.active){if(runtime.galeRuntime.followUp&&runtime.galeRuntime.followUpBehavior==='REPEAT_UNTIL_LOSS')return'CONTINUANDO ATÉ LOSS';const stage=runtime.galeRuntime.currentStage;return`APOSTA ${stage===0?'BASE':`G${stage}`} AGUARDANDO`;}return translateGameState(runtime?.gameStrategyRuntime.state??'SEARCH_TRIGGER');}
function translateGameState(state:string){return state==='SEARCH_TRIGGER'?'BUSCANDO GATILHO':state==='WAIT_RESULT'?'AGUARDANDO RESULTADO':state==='WAIT_RELEASE'?'AGUARDANDO LIBERAÇÃO':state}
function translateDecision(action:string|null|undefined){return action==='ENTER'?'ENTRAR':action==='IGNORE'?'IGNORAR':action==='PAUSE'?'PAUSAR':'—'}
function translateResult(result:string){return result==='WIN'?'GANHO':'PERDA'}
function roundAnalysisIndicator(runtime:TerminalRuntime|undefined){const role=runtime?.gameStrategyRuntime.lastAnnotationRole;if(role==='WIN'||role==='LOSS')return{symbol:'●',label:'Rodada analisada e adicionada à sequência',tone:'text-success'};if(role==='TRIGGER'||role==='RELEASE_TRIGGER')return{symbol:'→',label:'A próxima rodada será analisada',tone:'text-brand'};if(role)return{symbol:'×',label:'Rodada não analisável ou ignorada',tone:'text-muted'};return null;}
