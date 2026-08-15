import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Bot, Clock3, Copy, FolderOpen, Pause, Play, Plus, ReceiptText, RefreshCw, RotateCcw, Save, Search, Settings2, SquareTerminal, Trash2, Zap } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NormalizedRound, ScreenProfile, Terminal, TerminalHistoryItem, TerminalOperationCombination, TerminalPreset, TerminalRuntime } from '@aviator/shared';
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
  const[bankrollAnchor,setBankrollAnchor]=useState<{terminal:Terminal;item:TerminalHistoryItem}|null>(null);
  const[presetsOpen,setPresetsOpen]=useState(false);
  const[savingPresetTerminal,setSavingPresetTerminal]=useState<Terminal|null>(null);
  const[syncingTerminalId,setSyncingTerminalId]=useState<string|null>(null);
  const [query, setQuery] = useState('');
  const terminals = store.terminals.filter(terminal => terminal.name.toLowerCase().includes(query.toLowerCase()));
  useEffect(()=>{if(!chartTerminal){setChartHistory([]);return}let active=true;void window.aviator.getTerminalHistory(chartTerminal.id,5000).then(result=>{if(active&&result.ok&&result.data)setChartHistory(result.data)});return()=>{active=false}},[chartTerminal?.id]);

  function configure(terminal: Terminal) { store.clearError(); setEditing(terminal); }
  async function synchronize(id:string){store.clearError();setSyncingTerminalId(id);try{await store.syncTerminal(id)}finally{setSyncingTerminalId(null)}}

  return <div className="p-5">
    <div className="mb-5 flex items-end justify-between">
      <div><h2 className="text-xl font-bold">Terminais</h2><p className="mt-1 text-xs text-muted">Runtimes independentes com análise W/L e decisões de aposta isoladas.</p></div>
      <div className="flex gap-2"><Button onClick={()=>setPresetsOpen(true)} className="border-line bg-elevated text-ink"><FolderOpen size={14}/>Configurações salvas</Button><Button onClick={() => { store.clearError(); setCreating(true); }} className="bg-brand text-white hover:bg-blue-600"><Plus size={14}/> Novo Terminal</Button></div>
    </div>
    <div className="mb-3 flex items-center justify-between">
      <div className="relative w-72"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar Terminal..." className="h-9 w-full rounded-md border-line bg-panel pl-9 text-xs text-ink placeholder:text-muted/60 focus:border-brand focus:ring-0"/></div>
      <div className="font-mono text-[10px] text-muted">{terminals.length} TERMINAIS • {terminals.filter(terminal => !terminal.paused).length} ATIVOS</div>
    </div>
    <div className="grid gap-3 xl:grid-cols-2">
      {terminals.map(terminal => {
        const platform = store.platforms.find(item => item.id === terminal.platformId);
        const strategy = store.gameStrategies.find(item => item.id === terminal.gameStrategyId);
        const strategySource=terminal.strategySourceTerminalId?store.terminals.find(item=>item.id===terminal.strategySourceTerminalId):null;
        const runtime = store.terminalRuntimes.find(item => item.terminalId === terminal.id);
        const analyzer = runtime?.resultAnalyzerState;
        const history = store.terminalHistories[terminal.id] ?? [];
        const updateState=store.terminalUpdateStates[terminal.id];
        const isUpdating=updateState?.status==='FOREGROUND';
        const aiPrediction=runtime?.sequenceAiRuntime.lastPrediction;
        const aiContextCount=Object.keys(runtime?.sequenceAiRuntime.transitions??{}).length;
        const aiObservationCount=runtime?.sequenceAiRuntime.observations??0;
        const sequenceAiEnabled=terminal.operationCombinations.some(item=>item.enabled&&item.triggerType==='SEQUENCE_AI');
        const displayedHistory=sequenceAiEnabled?history.filter(item=>item.execution):history;
        const screenProfile = store.screenProfiles.find(profile => profile.terminalId === terminal.id);
        const schedule=store.terminalSchedules.find(item=>item.terminalId===terminal.id);
        const schedulePlan=store.schedulePlans.find(item=>item.id===schedule?.schedulePlanId);
        const isPaused=terminal.paused||runtime?.status==='PAUSED';
        const operationalResults=history.filter(item=>item.execution).map(item=>item.gameResult==='TIE'?'WIN' as const:item.gameResult);
        const operationalStreak=calculateDisplayedStreak(operationalResults);
        const streak = strategySource ? operationalStreak : analyzer?.currentWinStreak ? `W${analyzer.currentWinStreak}` : analyzer?.currentLossStreak ? `L${analyzer.currentLossStreak}` : '—';
        return <Card key={terminal.id} className="overflow-hidden">
          <div className="flex items-center border-b border-line px-4 py-3">
            <div className={`mr-3 grid h-9 w-9 place-items-center rounded-lg ${isPaused ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}><SquareTerminal size={18}/></div>
            <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{terminal.name}</h3><div className="mt-1"><Badge tone={isPaused ? 'warning' : 'success'}>{translateTerminalStatus(runtime?.status??(terminal.paused?'PAUSED':'RUNNING'))}</Badge></div></div>
            <div className="ml-auto flex shrink-0 items-center gap-1 pl-3">
              <TerminalIconButton title={isPaused?'Retomar Terminal':'Pausar Terminal'} onClick={()=>void store.setTerminalPaused(terminal.id,!isPaused)} tone={isPaused?'success':'warning'}>{isPaused?<Play size={13}/>:<Pause size={13}/>}</TerminalIconButton>
              <TerminalIconButton title="Atualizar agora (prioridade na fila)" onClick={()=>void synchronize(terminal.id)} disabled={syncingTerminalId===terminal.id||updateState?.status==='FOREGROUND'}><RefreshCw size={13} className={isUpdating?'animate-spin':''}/></TerminalIconButton>
              <TerminalIconButton title="Duplicar Terminal" onClick={()=>void store.duplicateTerminal(terminal.id)}><Copy size={13}/></TerminalIconButton>
              <TerminalIconButton title="Salvar configuração completa" onClick={()=>setSavingPresetTerminal(terminal)}><Save size={13}/></TerminalIconButton>
              <TerminalIconButton title="Excluir Terminal" onClick={()=>{if(window.confirm(`Excluir ${terminal.name}? O histórico operacional deste Terminal será removido.`))void store.deleteTerminal(terminal.id)}} tone="danger"><Trash2 size={13}/></TerminalIconButton>
              <TerminalIconButton title="Opções de reset" onClick={()=>{store.clearError();setResettingTerminal(terminal)}} tone="warning"><RotateCcw size={13}/></TerminalIconButton>
              <TerminalIconButton title="Abrir gráfico" onClick={()=>setChartTerminal(terminal)}><BarChart3 size={13}/></TerminalIconButton>
              <TerminalIconButton title="Abrir extrato" onClick={()=>setStatementTerminal(terminal)}><ReceiptText size={13}/></TerminalIconButton>
              <TerminalIconButton title="Configurar bot visual" onClick={()=>{store.clearError();setBotTerminal(terminal)}}><Bot size={13}/></TerminalIconButton>
              <TerminalIconButton title="Selecionar plano de horários" onClick={()=>setScheduleTerminal(terminal)}><Clock3 size={13}/></TerminalIconButton>
              <TerminalIconButton title="Configurar Terminal" onClick={()=>configure(terminal)}><Settings2 size={14}/></TerminalIconButton>
            </div>
          </div>
          {updateState&&updateState.status!=='UPDATED'&&<div className={`flex items-center justify-between border-b px-4 py-2 text-[9px] font-bold uppercase tracking-wider ${updateState.status==='ERROR'?'border-danger/30 bg-danger/10 text-danger':'border-warning/25 bg-warning/10 text-warning'}`}><span>{updateState.status==='PENDING'?'Configuração alterada — clique em Atualizar para recalcular':updateState.status==='FOREGROUND'?'Atualizando este Terminal e suas fontes':`Falha na atualização: ${updateState.error??'erro desconhecido'}`}</span>{updateState.status==='FOREGROUND'&&<span className="font-mono">{updateState.progress}%</span>}</div>}
          <div className="grid grid-cols-[1.25fr_1.25fr_1.35fr_.9fr_.6fr_.75fr] divide-x divide-line border-b border-line">
            <button type="button" title="Editar banca inicial" onClick={()=>{store.clearError();setBankrollTerminal(terminal)}} className="min-w-0 px-3 py-3 text-left transition hover:bg-elevated"><div className="label truncate">Banca inicial</div><div className="mt-1 whitespace-nowrap font-mono text-[11px] font-semibold">{money(terminal.initialBankrollCents)}</div><div className="mt-0.5 text-[8px] text-muted">CLIQUE PARA EDITAR</div></button>
            <Stat label="Saldo" value={money(terminal.currentBankrollCents)}/>
            <Stat label="Lucro / perda" value={signedMoney(terminal.currentBankrollCents-terminal.initialBankrollCents)} tone={terminal.currentBankrollCents>=terminal.initialBankrollCents?'success':'danger'}/>
            <Stat label={strategySource?'Apostas W/L':'Sinais W/L'} value={strategySource?`${terminal.gameWins}/${terminal.gameLosses}`:`${analyzer?.winCount ?? terminal.gameWins}/${analyzer?.lossCount ?? terminal.gameLosses}`}/>
            <Stat label="Seq." value={streak}/>
            <LastRoundStat platformId={terminal.platformId} value={runtime?.gameStrategyRuntime.lastMultiplier ? `${runtime.gameStrategyRuntime.lastMultiplier.toFixed(2)}x` : '—'} indicator={roundAnalysisIndicator(runtime)}/>
          </div>
          <div className="space-y-2 p-4 text-[11px]">
            <Row label="Plataforma" value={platform?.name ?? '—'} extra="coletor compartilhado"/>
            <Row label="Fonte W/L" value={strategySource?`Terminal ${strategySource.name}`:'Jogo próprio'} extra={strategySource?(terminal.strategySourceMode==='BET_EXECUTIONS'?'operações liquidadas':'sinais do terminal'):(strategy?.name??'—')}/>
            <Row label="Estado" value={translateOperationalState(runtime,terminal)} badge="strategy"/>
            {runtime?.galeRuntime.activeCombinationId&&<Row label="Combinação ativa" value={terminal.operationCombinations.find(item=>item.id===runtime.galeRuntime.activeCombinationId)?.name??'COMBINAÇÃO OPERACIONAL'}/>}
            {sequenceAiEnabled&&<Row
              label={aiPrediction?.engineVersion==='V2'?'IA de padrões v2':'IA sequencial'}
              value={!aiPrediction?'APRENDENDO':aiPrediction.expected===null?'SEM AMOSTRA':aiPrediction.riskBlocked?`BLOQUEADO • RISCO ${aiPrediction.winProbability.toFixed(1)}%`:aiPrediction.shouldEnter?`ENTRAR • W ${aiPrediction.winProbability.toFixed(1)}%`:`AGUARDAR • ${aiPrediction.expected} ${aiPrediction.confidence.toFixed(1)}%`}
              extra={`${aiObservationCount.toLocaleString('pt-BR')} sinais • ${aiContextCount.toLocaleString('pt-BR')} padrões${aiPrediction&&aiPrediction.sampleSize>0?` • amostra atual ${aiPrediction.sampleSize}`:''}${aiPrediction?.evaluatedContexts?` • consenso ${(aiPrediction.contextAgreement??0).toFixed(1)}%/${aiPrediction.evaluatedContexts} janelas`:''}${aiPrediction?.probabilityLowerBound!==undefined?` • limite ${aiPrediction.probabilityLowerBound.toFixed(1)}%`:''}${aiPrediction?.recentSampleSize?` • recente ${aiPrediction.recentWinProbability?.toFixed(1)}%/${aiPrediction.recentSampleSize}`:''}${aiPrediction?.riskDepth?` • risco ${aiPrediction.fullCycleLossRisk?.toFixed(2)??'0.00'}% de L${aiPrediction.riskDepth}`:''}`}
            />}
            {aiPrediction&&<Row
              label="Padrão atual da IA"
              value={aiPrediction.structuralPattern??(aiPrediction.periodicPattern?`REPETIÇÃO ${aiPrediction.periodicPattern}`:aiPrediction.context||'SEM CONTEXTO')}
              extra={aiPrediction.reason}
            />}
            {sequenceAiEnabled&&<Row label="Bolinhas exibidas" value="SOMENTE ENTRADAS EXECUTADAS"/>}
            <PatternDots history={displayedHistory} currentBankrollCents={terminal.currentBankrollCents} limit={Math.min(terminal.historyDisplayLimit,store.terminalHistoryDisplayMax)} anchorAt={terminal.bankrollStartAt} onSelect={item=>{store.clearError();setBankrollAnchor({terminal,item})}}/>
            {terminal.bankrollStartAt&&<Row label="Início financeiro" value={new Date(terminal.bankrollStartAt).toLocaleString('pt-BR')}/>}
            <Row label={sequenceAiEnabled?'Decisão para próxima rodada':'Decisão de aposta'} value={translateDecision(runtime?.betStrategyRuntime.lastAction)} badge="decision"/>
            <Row label="Ciclo de aposta" value={translateBetCycle(runtime,terminal)}/>
            {(runtime?.galeRuntime.failedCycleAttempts??0)>0&&<Row label="Progressão entre ciclos" value={`TENTATIVA ${(runtime?.galeRuntime.failedCycleAttempts??0)+1}`}/>}
            <Row label="Bot visual" value={screenProfile ? 'CONFIGURADO' : 'NÃO CONFIGURADO'} badge="decision"/>
            <Row label="Plano de horários" value={schedulePlan?.name??'SEMPRE ATIVO'}/>
            {!runtime?.scheduleState.allowed&&<Row label="Bloqueio de horário" value={runtime?.scheduleState.reason==='INTERVALO_BLOQUEADO'?'INTERVALO BLOQUEADO':'FORA DO HORÁRIO'}/>} 
            {runtime?.pauseState.type!=='NONE'&&<Row label="Motivo da pausa" value={runtime?.pauseState.reason??'Pausa sem motivo informado'}/>} 
            <Row label="Modo" value={terminal.mode==='SIMULATION'?'SIMULAÇÃO':'ASSISTIDO'}/>
          </div>
          <TerminalTimeline history={displayedHistory} label={sequenceAiEnabled?'ENTRADAS EXECUTADAS PELA IA':'JOGO + INTERSEÇÃO DO CICLO'}/>
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
    <BankrollAnchorModal selection={bankrollAnchor} onClose={()=>setBankrollAnchor(null)}/>
    <TerminalPresetsModal open={presetsOpen} onClose={()=>setPresetsOpen(false)}/>
    <SaveTerminalPresetModal terminal={savingPresetTerminal} onClose={()=>setSavingPresetTerminal(null)} onSaved={()=>{setSavingPresetTerminal(null);setPresetsOpen(true)}}/>
  </div>;
}

function SaveTerminalPresetModal({terminal,onClose,onSaved}:{terminal:Terminal|null;onClose():void;onSaved():void}){
  const[name,setName]=useState('');const[saving,setSaving]=useState(false);const[error,setError]=useState<string|null>(null);
  useEffect(()=>{if(terminal){setName(terminal.name);setError(null);setSaving(false)}},[terminal]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const normalized=name.trim();if(normalized.length<2){setError('Informe um nome com pelo menos 2 caracteres.');return}setSaving(true);setError(null);try{const result=await window.aviator.saveTerminalPreset(terminal!.id,normalized);if(!result.ok){setError(result.error??'Não foi possível salvar a configuração.');setSaving(false);return}onSaved();}catch(reason){setError(reason instanceof Error?reason.message:'Falha ao comunicar com o banco de dados.');setSaving(false);}}
  return <Modal title={`Salvar configuração completa • ${terminal?.name??'Terminal'}`} open={terminal!==null} onClose={onClose}><form onSubmit={submit} className="p-5"><Field label="Nome da configuração salva"><input autoFocus value={name} onChange={event=>setName(event.target.value)} placeholder="Ex.: EstrelaBet 5X completa" maxLength={100}/></Field><div className="mt-4 rounded-md border border-brand/25 bg-brand/10 p-3 text-[10px] leading-5 text-blue-100">Será criada uma cópia independente das estratégias de jogo, entradas, apostas, horários, regras de controle e bot visual deste Terminal.</div>{error&&<div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-3 text-[10px] text-red-200">{error}</div>}<div className="mt-5 flex justify-end gap-2"><Button type="button" disabled={saving} onClick={onClose} className="border-line bg-panel text-muted">Cancelar</Button><Button disabled={saving||name.trim().length<2} className="bg-brand text-white"><Save size={13}/>{saving?'Salvando...':'Salvar configuração'}</Button></div></form></Modal>;
}

function TerminalPresetsModal({open,onClose}:{open:boolean;onClose():void}){
  const store=useAppStore();const[presets,setPresets]=useState<TerminalPreset[]>([]);const[loading,setLoading]=useState(false);const[message,setMessage]=useState<string|null>(null);
  async function load(){setLoading(true);const result=await window.aviator.listTerminalPresets();setLoading(false);if(result.ok&&result.data)setPresets(result.data);else setMessage(result.error??'Não foi possível carregar as configurações salvas.');}
  useEffect(()=>{if(open)void load()},[open]);
  async function restore(id:string){setLoading(true);setMessage(null);const result=await window.aviator.restoreTerminalPreset(id);if(result.ok){await store.refresh();setMessage(`Terminal “${result.data?.name??'restaurado'}” criado com configurações próprias.`);}else setMessage(result.error??'Não foi possível restaurar.');setLoading(false);}
  async function remove(id:string){if(!window.confirm('Excluir esta configuração salva? O Terminal original não será alterado.'))return;const result=await window.aviator.deleteTerminalPreset(id);if(!result.ok)setMessage(result.error??'Não foi possível excluir.');await load();}
  return <Modal className="max-w-3xl" title="Configurações completas de Terminais" open={open} onClose={onClose}><div className="p-5"><p className="mb-4 text-[10px] leading-5 text-muted">Cada item é um snapshot independente. Ao restaurar, o sistema recria estratégias de jogo, entradas, apostas, horário, regras de controle e bot visual com novos IDs.</p>{message&&<div className="mb-3 rounded-md border border-brand/25 bg-brand/10 p-3 text-[10px] text-blue-100">{message}</div>}<div className="space-y-2">{loading&&presets.length===0?<div className="py-8 text-center text-xs text-muted">Carregando...</div>:presets.length===0?<div className="py-8 text-center text-xs text-muted">Nenhuma configuração completa foi salva.</div>:presets.map(preset=><div key={preset.id} className="flex items-center rounded-lg border border-line bg-canvas p-3"><div className="min-w-0"><div className="truncate text-xs font-semibold">{preset.name}</div><div className="mt-1 text-[9px] text-muted">Terminal: {preset.sourceTerminalName} • Plataforma: {preset.platformName} • {new Date(preset.createdAt).toLocaleString('pt-BR')}</div></div><div className="ml-auto flex gap-2"><Button disabled={loading} onClick={()=>void restore(preset.id)} className="bg-brand text-white"><FolderOpen size={12}/>Restaurar como novo</Button><TerminalIconButton title="Excluir configuração salva" onClick={()=>void remove(preset.id)} tone="danger"><Trash2 size={12}/></TerminalIconButton></div></div>)}</div><div className="mt-5 flex justify-end"><Button onClick={onClose} className="border-line bg-panel text-muted">Fechar</Button></div></div></Modal>;
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

function BankrollAnchorModal({selection,onClose}:{selection:{terminal:Terminal;item:TerminalHistoryItem}|null;onClose():void}){
  const store=useAppStore();const[saving,setSaving]=useState(false);const[value,setValue]=useState('');
  const terminal=selection?.terminal??null;const item=selection?.item??null;const occurredAt=item?.occurredAt??item?.createdAt??null;
  useEffect(()=>{setValue(terminal?(terminal.initialBankrollCents/100).toFixed(2):'');setSaving(false)},[terminal?.id,item?.signalId]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!terminal||!occurredAt)return;const cents=Math.round(Number(value.replace(',','.'))*100);if(!Number.isFinite(cents)||cents<0)return;setSaving(true);const ok=await store.setTerminalBankrollAnchor(terminal.id,cents,occurredAt);setSaving(false);if(ok)onClose();}
  return <Modal title={`Iniciar banca nesta bolinha • ${terminal?.name??'Terminal'}`} open={selection!==null} onClose={onClose}><form onSubmit={submit} className="p-5"><div className="mb-4 rounded-md border border-brand/25 bg-brand/10 p-3 text-[10px] leading-5 text-blue-100"><div className="font-semibold">Bolinha selecionada: {item?displayedResultLetter(item.gameResult):'—'} • {occurredAt?new Date(occurredAt).toLocaleString('pt-BR'):'—'} {item?.multiplier!=null?`• ${item.multiplier.toFixed(2)}x`:''}</div><p className="mt-1">Esta bolinha será a primeira operação considerada no saldo. As anteriores continuarão sendo analisadas para formar sequências, gatilhos e contexto da IA.</p></div><Field label="Banca inicial nesta bolinha (R$)"><input autoFocus value={value} onChange={event=>setValue(event.target.value)} inputMode="decimal" placeholder="1000,00" required/></Field><p className="mt-3 text-[10px] leading-5 text-muted">Ao confirmar, o Terminal e os Terminais dependentes serão recalculados. Antes do marco não haverá lucro, prejuízo ou consumo dos limites da banca.</p>{store.error&&<div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-3 text-[10px] text-red-200">{store.error}</div>}<div className="mt-5 flex justify-end gap-2"><Button type="button" onClick={onClose} disabled={saving} className="border-line bg-panel text-muted">Cancelar</Button><Button disabled={saving||!value} className="bg-brand text-white">{saving?'Recalculando...':'Iniciar banca aqui'}</Button></div></form></Modal>;
}

function TerminalScheduleModal({terminal,onClose}:{terminal:Terminal|null;onClose():void}){
  const store=useAppStore();const current=terminal?store.terminalSchedules.find(item=>item.terminalId===terminal.id):null;const[selected,setSelected]=useState('');const[saving,setSaving]=useState(false);
  useEffect(()=>{setSelected(current?.schedulePlanId??'')},[current?.schedulePlanId,terminal?.id]);
  async function save(){if(!terminal)return;setSaving(true);const saved=await store.setTerminalSchedulePlan(terminal.id,selected||null);setSaving(false);if(saved)onClose();}
  return <Modal title={`Plano de horários • ${terminal?.name??'Terminal'}`} open={terminal!==null} onClose={onClose}><div className="p-5"><div className="rounded-md border border-line bg-canvas p-4"><Field label="Plano selecionado"><select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Sempre ativo — sem restrições</option>{store.schedulePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field><p className="mt-3 text-[10px] leading-5 text-muted">O Terminal ignora rodadas fora dos intervalos permitidos ou dentro dos intervalos bloqueados. A pausa manual continua tendo prioridade.</p></div>{store.error&&<div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-3 text-[10px] text-red-200">{store.error}</div>}<div className="mt-5 flex justify-end gap-2"><Button onClick={onClose} className="border-line bg-panel text-muted">Cancelar</Button><Button onClick={()=>void save()} disabled={saving} className="bg-brand text-white"><Clock3 size={13}/>{saving?'Salvando...':'Aplicar plano'}</Button></div></div></Modal>;
}

function TerminalTimeline({ history,label='JOGO + INTERSEÇÃO DO CICLO' }: { history: TerminalHistoryItem[];label?:string }) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => { const element = viewport.current; if (element) element.scrollLeft = element.scrollWidth; }, [history.length]);
  return <div className="border-t border-line bg-canvas/35 px-3 py-2.5">
    <div className="mb-2 flex items-center justify-between"><span className="label">Linha do tempo operacional</span><span className="font-mono text-[9px] text-muted">{label} • {history.length} {label.startsWith('ENTRADAS')?'APOSTAS':'SINAIS'}</span></div>
    <div ref={viewport} className="overflow-x-auto pb-1.5">
      <div className="flex min-w-max items-stretch gap-1">
        {history.length === 0 && <div className="w-full py-4 text-center text-[10px] text-muted">{label.startsWith('ENTRADAS')?'Nenhuma entrada da IA foi executada neste período.':'Aguardando sinais do Terminal.'}</div>}
        {history.map((item, index) => <div key={item.signalId} className="flex items-center gap-1">
          {index > 0 && <span className="h-px w-2 bg-line"/>}
          <div className={`w-[84px] rounded-md border p-1.5 ${item.gameResult === 'LOSS' ? 'border-danger/25 bg-danger/5' : 'border-success/25 bg-success/5'}`}>
            <div className="flex items-center justify-between"><span className="text-[8px] font-bold uppercase tracking-wider text-muted">{item.execution?'Aposta':'Gatilho'}</span><span className={`flex items-center gap-1 font-mono text-[11px] font-black ${item.gameResult === 'LOSS' ? 'text-danger' : 'text-success'}`}>{item.gameResult==='TIE'&&<span className="h-1.5 w-1.5 rounded-full bg-green-400"/>}{displayedResultLetter(item.gameResult)}</span></div>
            <div className="mt-1 font-mono text-[9px] text-muted">{item.multiplier?.toFixed(2) ?? '—'}x</div>
            <div className="mt-1.5 border-t border-line/70 pt-1">
              {item.stage ? <><div className="truncate text-[7px] font-bold text-blue-300">{item.stage.stageLabel}</div><div className={`mt-0.5 font-mono text-[7px] font-bold ${resultToneClass(item.stage.result)}`}>{translateResult(item.stage.result)}</div>{item.execution&&<div className={`mt-0.5 truncate font-mono text-[7px] ${item.execution.profitLossCents>0?'text-success':item.execution.profitLossCents<0?'text-danger':'text-warning'}`}>{signedMoney(item.execution.profitLossCents)}</div>}</> : item.decisionAction === 'ENTER' ? <div className="font-mono text-[7px] font-bold text-warning">BASE ARMADA</div> : <div className="text-[7px] text-muted">SEM APOSTA</div>}
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
  for(const row of rows){if(row.execution.result==='WIN'){wins++;losses=0;maxWins=Math.max(maxWins,wins)}else if(row.execution.result==='LOSS'){losses++;wins=0;maxLosses=Math.max(maxLosses,losses)}else{wins=0;losses=0}}
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
            <StatementCell>{new Date(execution.createdAt).toLocaleString('pt-BR')}</StatementCell><StatementCell mono>{item.signalId.slice(0,8)}</StatementCell><StatementCell><Badge tone={execution.stageIndex===0?'brand':'warning'}>{execution.stageLabel}</Badge></StatementCell><StatementCell mono>{execution.multiplier.toFixed(2)}x</StatementCell><StatementCell><Badge tone={resultBadgeTone(execution.result)}>{translateResult(execution.result)}</Badge></StatementCell><StatementCell mono>{money(execution.stakeCents)}</StatementCell><StatementCell mono>{money(execution.returnedCents)}</StatementCell><StatementCell mono className={execution.profitLossCents>0?'text-success':execution.profitLossCents<0?'text-danger':'text-warning'}>{signedMoney(execution.profitLossCents)}</StatementCell><StatementCell mono>{money(execution.bankrollAfterCents)}</StatementCell>
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
    gameScore += item.gameResult === 'LOSS' ? -1 : 1;
    if (item.stage) betScore += item.stage.result === 'WIN' ? 1 : item.stage.result === 'LOSS' ? -1 : 0;
    return { index: index + 1, gameScore, betScore, multiplier: item.multiplier ?? 0,bankroll:(item.execution?.bankrollAfterCents??terminal?.currentBankrollCents??0)/100 };
  });
  const data=range==='ALL'?allData:allData.slice(-Number(range));
  const gameWins = history.filter(item => item.gameResult !== 'LOSS').length;
  const stageEvents = history.filter(item => item.stage);
  const betWins = stageEvents.filter(item => item.stage?.result === 'WIN').length;
  const betLosses=stageEvents.filter(item=>item.stage?.result==='LOSS').length;
  const betTies=stageEvents.filter(item=>item.stage?.result==='TIE').length;
  const common=<><CartesianGrid stroke="#222a34" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="index" stroke="#66717e" fontSize={10}/><YAxis stroke="#66717e" fontSize={10}/><Tooltip contentStyle={{ background: '#161b22', border: '1px solid #2d333b', fontSize: 11 }}/></>;
  return <Modal className="max-w-7xl" title={`Gráfico • ${terminal?.name ?? 'Terminal'}`} open={terminal !== null} onClose={onClose}>
    <div className="p-5">
      <div className="mb-4 flex items-end gap-3"><div className="grid flex-1 grid-cols-4 gap-3"><ChartMetric label="Sinais" value={String(history.length)}/><ChartMetric label="Taxa de ganhos do jogo" value={history.length ? `${(gameWins / history.length * 100).toFixed(1)}%` : '0%'}/><ChartMetric label="Taxa de ganhos das apostas" value={betWins+betLosses ? `${(betWins/(betWins+betLosses)*100).toFixed(1)}%` : '0%'}/><ChartMetric label="Empates financeiros" value={String(betTies)}/></div><Field label="Intervalo"><select value={range} onChange={event=>setRange(event.target.value as typeof range)}><option value="30">30 sinais</option><option value="60">60 sinais</option><option value="100">100 sinais</option><option value="250">250 sinais</option><option value="500">500 sinais</option><option value="ALL">Até 5.000 sinais</option></select></Field><Field label="Tipo de gráfico"><select value={chartType} onChange={event=>setChartType(event.target.value as typeof chartType)}><option value="AREA">Área</option><option value="LINE">Linhas</option><option value="BAR">Barras</option></select></Field></div>
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

function TerminalIconButton({title,onClick,children,tone='neutral',disabled=false}:{title:string;onClick():void;children:ReactNode;tone?:'neutral'|'success'|'warning'|'danger';disabled?:boolean}){const colors={neutral:'text-muted hover:bg-elevated hover:text-ink',success:'text-success hover:bg-success/10',warning:'text-warning hover:bg-warning/10',danger:'text-muted hover:bg-danger/10 hover:text-danger'};return <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled} className={`grid h-7 w-7 place-items-center rounded-md border border-line disabled:cursor-wait disabled:opacity-50 ${colors[tone]}`}>{children}</button>}

function PatternDots({history,currentBankrollCents,limit,anchorAt,onSelect}:{history:TerminalHistoryItem[];currentBankrollCents:number;limit:number;anchorAt:string|null;onSelect(item:TerminalHistoryItem):void}){
  const viewport=useRef<HTMLDivElement>(null);
  const[dotTooltip,setDotTooltip]=useState<{x:number;y:number;content:string}|null>(null);
  const results=history.slice(-limit);
  const balanceBySignal=new Map<string,number>();
  let balance=currentBankrollCents;
  for(let index=history.length-1;index>=0;index--){
    const item=history[index];
    if(item.execution){balanceBySignal.set(item.signalId,item.execution.bankrollAfterCents);balance=item.execution.bankrollBeforeCents;}
    else balanceBySignal.set(item.signalId,balance);
  }
  useEffect(()=>{const element=viewport.current;if(element)element.scrollLeft=element.scrollWidth},[history.length]);
  if(results.length===0)return <span className="text-muted">—</span>;
  return <><div ref={viewport} className="w-full min-w-0 overflow-x-auto pb-1.5" aria-label={results.map(item=>translateResult(item.gameResult)).join(', ')}><div className="flex w-max items-start gap-[3px]">{results.map(item=>{
    const galeLevel=item.stage?.stageIndex??0;
    const resultStyle=item.gameResult==='WIN'||item.gameResult==='TIE'?'bg-slate-200 text-slate-950':'bg-slate-700 text-white';
    const betStyle=item.stage?(galeLevel===0?'border-blue-400 ring-1 ring-blue-400':'border-yellow-300 ring-1 ring-yellow-300'):(item.gameResult==='WIN'?'border-white':'border-slate-400');
    const betStage=item.stage?(galeLevel===0?'BASE':`G${galeLevel}`):'SEM APOSTA';
    const itemOccurredAt=item.occurredAt??item.createdAt;
    const isAnchor=anchorAt===itemOccurredAt;
    const title=[
      `Resultado: ${item.gameResult==='TIE'?'WIN (EMPATE FINANCEIRO)':item.gameResult}`,
      `Horário: ${new Date(item.occurredAt??item.createdAt).toLocaleString('pt-BR')}`,
      `Multiplicador: ${item.multiplier==null?'—':`${item.multiplier.toFixed(2)}x`}`,
      `Situação: ${item.stage?`APOSTA ${betStage}`:betStage}`,
      `Resultado financeiro: ${item.stage?translateResult(item.stage.result):'—'}`,
      `Lucro / prejuízo: ${item.execution?signedMoney(item.execution.profitLossCents):'—'}`,
      `Saldo da banca: ${money(balanceBySignal.get(item.signalId)??currentBankrollCents)}`,
      isAnchor?'Início financeiro: SIM':'Clique para iniciar a banca nesta bolinha'
    ].join('\n');
    const showTooltip=(x:number,y:number)=>setDotTooltip({x,y,content:title});
    return <button type="button" key={item.signalId} className="flex h-6 shrink-0 cursor-pointer items-start" aria-label={`${displayedResultLetter(item.gameResult)} em ${new Date(itemOccurredAt).toLocaleString('pt-BR')}; selecionar como início da banca`} onClick={()=>{setDotTooltip(null);onSelect(item)}} onMouseEnter={event=>showTooltip(event.clientX,event.clientY)} onMouseMove={event=>showTooltip(event.clientX,event.clientY)} onMouseLeave={()=>setDotTooltip(null)}><span className="relative">{isAnchor&&<span title="Início financeiro" className="absolute -inset-[3px] rounded-full ring-2 ring-violet-400"/>}{item.gameResult==='TIE'&&<span title="Empate financeiro" className="absolute -top-[5px] left-1/2 z-10 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-green-400 ring-1 ring-slate-950"/>}<span className={`grid h-4 w-4 place-items-center rounded-full border font-mono text-[8px] font-black leading-none shadow-sm ${resultStyle} ${betStyle}`}>{displayedResultLetter(item.gameResult)}</span>{galeLevel>0&&<span className="absolute -bottom-[5px] left-1/2 flex -translate-x-1/2 gap-px">{Array.from({length:galeLevel},(_,marker)=><span key={marker} className="h-1 w-1 rounded-full bg-red-500"/>)}</span>}</span></button>;
  })}</div></div>{dotTooltip&&createPortal(<div role="tooltip" className="pointer-events-none fixed z-[9999] min-w-52 whitespace-pre-line rounded-md border border-line bg-elevated px-3 py-2 font-mono text-[10px] leading-5 text-ink shadow-2xl" style={{left:Math.min(dotTooltip.x+12,window.innerWidth-240),top:Math.min(dotTooltip.y+12,window.innerHeight-160)}}>{dotTooltip.content}</div>,document.body)}</>;
}

function Row({ label, value, extra, badge }: { label: string; value: string; extra?: string; badge?: 'strategy' | 'decision' }) {
  const tone = badge === 'decision' ? value === 'ENTRAR' ? 'success' : value === 'PAUSAR' ? 'danger' : 'neutral' : badge === 'strategy' ? ['AGUARDANDO RESULTADO','CONTINUANDO ATÉ LOSS'].includes(value)||value.startsWith('APOSTA ') ? 'success' : value === 'AGUARDANDO LIBERAÇÃO'||value.startsWith('ENTRADA BLOQUEADA') ? 'warning' : 'neutral' : null;
  return <div className="flex items-center justify-between"><span className="text-muted">{label}</span><span className="flex items-center gap-2 font-medium">{tone ? <Badge tone={tone}>{value}</Badge> : value}{extra && <span className="text-[9px] text-muted">({extra})</span>}</span></div>;
}

function TerminalModal({ open, terminal, onClose }: { open: boolean; terminal: Terminal | null; onClose(): void }) {
  const store = useAppStore();
  const [saving, setSaving] = useState(false);
  const[selectedPlatformId,setSelectedPlatformId]=useState(terminal?.platformId??store.platforms[0]?.id??'');
  const[operationCombinations,setOperationCombinations]=useState<TerminalOperationCombination[]>(terminal?.operationCombinations??[]);
  useEffect(()=>{if(open){setSelectedPlatformId(terminal?.platformId??store.platforms[0]?.id??'');setOperationCombinations(structuredClone(terminal?.operationCombinations??[]));}},[open,terminal?.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); store.clearError(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const sourceValue=form.get('strategySourceTerminalId');const entryBlockPatterns=String(form.get('entryBlockPatterns')??'').toUpperCase().split(/[\s,;]+/).map(value=>value.replace(/[^WL]/g,'')).filter(Boolean);const common = { name: form.get('name'), sortOrder:Number(form.get('sortOrder')), platformId: form.get('platformId'), gameStrategyId: form.get('gameStrategyId'),strategySourceTerminalId:sourceValue?sourceValue:null,strategySourceMode:sourceValue?form.get('strategySourceMode'):'GAME_SIGNALS', betStrategyId: form.get('betStrategyLossId'), betStrategyWinId:form.get('betStrategyWinId'),betStrategyLossId:form.get('betStrategyLossId'), betPlanId: form.get('betPlanLossId'),betPlanWinId:form.get('betPlanWinId'),betPlanLossId:form.get('betPlanLossId'),entryBlockPatterns:[...new Set(entryBlockPatterns)],operationCombinations,controlPlayRuleIds:form.getAll('controlPlayRuleIds'),controlPauseRuleIds:form.getAll('controlPauseRuleIds'), mode: form.get('mode'),historyDisplayLimit:Number(form.get('historyDisplayLimit')),analysisRoundLimit:Number(form.get('analysisRoundLimit')),bankrollStartAt:terminal?.bankrollStartAt??null };
    const saved = terminal
      ? await store.updateTerminal({ id: terminal.id, ...common })
      : await store.createTerminal({ ...common, initialBankrollCents: Math.round(Number(form.get('bankroll')) * 100) });
    setSaving(false); if (saved) onClose();
  }

  return <Modal title={terminal ? `Configurar ${terminal.name}` : 'Novo Terminal'} open={open} onClose={onClose}>
    <form onSubmit={submit} className="grid grid-cols-2 gap-4 p-5">
      <Field label="Nome"><input name="name" defaultValue={terminal?.name ?? `Terminal ${store.terminals.length + 1}`} required/></Field><Field label="Ordem de classificação"><input name="sortOrder" type="number" min="0" step="1" defaultValue={terminal?.sortOrder??(store.terminals.length?Math.max(...store.terminals.map(item=>item.sortOrder))+10:10)} required/></Field>
      <Field label="Plataforma"><select name="platformId" value={selectedPlatformId} onChange={event=>setSelectedPlatformId(event.target.value)}>{store.platforms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Modo"><select name="mode" defaultValue={terminal?.mode ?? 'SIMULATION'}><option value="SIMULATION">Simulação</option><option value="ASSISTED">Assistido</option></select></Field>
      <Field label="Terminal de referência"><select name="strategySourceTerminalId" defaultValue={terminal?.strategySourceTerminalId??''}><option value="">Estratégia de jogo própria</option>{store.terminals.filter(item=>item.id!==terminal?.id&&item.platformId===selectedPlatformId).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Dados recebidos da referência"><select name="strategySourceMode" defaultValue={terminal?.strategySourceMode??'GAME_SIGNALS'}><option value="GAME_SIGNALS">Sinais W/L internos</option><option value="BET_EXECUTIONS">Operações liquidadas W/L</option></select></Field>
      <div className="col-span-2 rounded-md border border-brand/25 bg-brand/10 p-3 text-[10px] leading-5 text-blue-100">Ao escolher o Terminal cópia e “Operações liquidadas W/L”, a BASE acompanha uma aposta efetiva da fonte. Se perder, G1, G2 e G3 entram nas rodadas físicas seguintes, inclusive quando a fonte estiver em GATILHO ou SEM APOSTA. A primeira combinação ativa por prioridade define o plano e os valores.</div>
      <Field label="Sequências proibidas para nova BASE" className="col-span-2"><input name="entryBlockPatterns" className="font-mono uppercase" defaultValue={(terminal?.entryBlockPatterns??[]).join(', ')} placeholder="Ex.: LWL, LLL, WLW"/><p className="mt-1 text-[9px] text-muted">Separe por vírgulas. Se o histórico terminar em uma destas sequências, a nova BASE será ignorada. Um Gale já ativo continua normalmente.</p></Field>
      <Field label="Bolinhas exibidas no histórico"><select name="historyDisplayLimit" defaultValue={Math.min(terminal?.historyDisplayLimit??5_000,store.terminalHistoryDisplayMax)}>{historyDotOptions(store.terminalHistoryDisplayMax).map(value=><option key={value} value={value}>{value.toLocaleString('pt-BR')} bolinhas</option>)}</select><p className="mt-1 text-[9px] text-muted">5.000 bolinhas cobrem aproximadamente as últimas 24 horas.</p></Field>
      <Field label="Rodadas analisadas"><select name="analysisRoundLimit" defaultValue={terminal?.analysisRoundLimit??5000}>{[200,500,1000,2000,5000,10000,20000,50000,100000,300000].map(value=><option key={value} value={value}>{value.toLocaleString('pt-BR')} rodadas</option>)}</select><p className="mt-1 text-[9px] text-muted">5.000 rodadas normalmente cobrem mais de 24 horas. O recálculo só acontece ao clicar em Atualizar.</p></Field>
      <Field label="Estratégia de jogo" className="col-span-2"><select name="gameStrategyId" defaultValue={terminal?.gameStrategyId}>{store.gameStrategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="mt-1 text-[9px] text-muted">Usada somente quando a fonte estiver em “Estratégia de jogo própria”.</p></Field>
      <OperationCombinationsEditor combinations={operationCombinations} onChange={setOperationCombinations} betStrategies={store.betStrategies} betPlans={store.betPlans}/>
      <div className="col-span-2 text-[9px] font-bold uppercase tracking-wider text-muted">Compatibilidade sem combinações</div>
      <Field label="Estratégia de entrada após WIN"><select name="betStrategyWinId" defaultValue={terminal?.betStrategyWinId??terminal?.betStrategyId}>{store.betStrategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Estratégia de aposta após WIN"><select name="betPlanWinId" defaultValue={terminal?.betPlanWinId??terminal?.betPlanId}>{store.betPlans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Estratégia de entrada após LOSS"><select name="betStrategyLossId" defaultValue={terminal?.betStrategyLossId??terminal?.betStrategyId}>{store.betStrategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Estratégia de aposta após LOSS"><select name="betPlanLossId" defaultValue={terminal?.betPlanLossId??terminal?.betPlanId}>{store.betPlans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <RuleSelector title="Regras PLAY" name="controlPlayRuleIds" rules={store.terminalControlRules.filter(rule=>rule.enabled&&(rule.action==='PLAY'||rule.action==='RESUME'))} selected={terminal?.controlPlayRuleIds??[]}/>
      <RuleSelector title="Regras PAUSE" name="controlPauseRuleIds" rules={store.terminalControlRules.filter(rule=>rule.enabled&&rule.action==='PAUSE')} selected={terminal?.controlPauseRuleIds??[]}/>
      {!terminal && <Field label="Banca inicial (R$)" className="col-span-2"><input name="bankroll" type="number" min="0" step="0.01" defaultValue="1000.00" required/></Field>}
      {store.error && <div className="col-span-2 rounded-md border border-danger/25 bg-danger/10 p-3 text-[11px] text-red-200">{store.error}</div>}
      {saving&&<div className="col-span-2 flex items-center gap-3 rounded-md border border-brand/25 bg-brand/10 p-3 text-[10px] text-blue-100"><RefreshCw size={14} className="animate-spin"/><span>Salvando configuração e agendando a atualização...</span></div>}
      <div className="col-span-2 mt-2 flex justify-end gap-2"><Button type="button" onClick={onClose} disabled={saving} className="border-line bg-panel text-muted">Cancelar</Button><Button disabled={saving} className="bg-brand text-white"><Zap size={13}/>{saving ? 'Salvando...' : terminal ? 'Salvar alterações' : 'Criar Terminal'}</Button></div>
    </form>
  </Modal>;
}

function RuleSelector({title,name,rules,selected}:{title:string;name:'controlPlayRuleIds'|'controlPauseRuleIds';rules:import('@aviator/shared').TerminalControlRule[];selected:string[]}){return <fieldset className="rounded-md border border-line bg-canvas p-3"><legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</legend><div className="mt-1 max-h-32 space-y-2 overflow-y-auto">{rules.map(rule=><label key={rule.id} className="flex items-center gap-2 text-[10px] text-ink"><input type="checkbox" name={name} value={rule.id} defaultChecked={selected.includes(rule.id)}/><span className="truncate">{rule.name}</span></label>)}{!rules.length&&<div className="text-[9px] text-muted">Nenhuma regra global deste tipo.</div>}</div></fieldset>}

function OperationCombinationsEditor({combinations,onChange,betStrategies,betPlans}:{combinations:TerminalOperationCombination[];onChange(value:TerminalOperationCombination[]):void;betStrategies:Array<{id:string;name:string}>;betPlans:Array<{id:string;name:string}>}){
  const update=(index:number,patch:Partial<TerminalOperationCombination>)=>onChange(combinations.map((item,itemIndex)=>itemIndex===index?{...item,...patch}:item));
  const normalizePattern=(value:string)=>value.toUpperCase().replace(/[^WL]/g,'').slice(0,100);
  const add=()=>onChange([...combinations,{id:crypto.randomUUID(),name:`Combinação ${combinations.length+1}`,priority:(combinations.length+1)*10,enabled:true,triggerType:'PATTERN',pattern:'W',sequenceAiConfig:null,betStrategyId:betStrategies[0]?.id??'',lossReentryType:'PATTERN',lossReentryPattern:'W',lossReentryBetStrategyId:null,betPlanId:betPlans[0]?.id??'',behavior:'REPEAT_UNTIL_LOSS'}]);
  return <fieldset className="col-span-2 rounded-lg border border-line bg-canvas p-4"><legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted">Combinações operacionais</legend>
    <div className="flex items-start justify-between gap-4"><p className="max-w-2xl text-[10px] leading-5 text-muted">Digite uma sequência, selecione uma estratégia de entrada ou use a inteligência sequencial. Na IA, cada saída é avaliada novamente antes da BASE e de cada Gale; o plano define valores e limite de etapas.</p><Button type="button" onClick={add} className="shrink-0 bg-brand text-white"><Plus size={12}/>Adicionar combinação</Button></div>
    <div className="mt-3 space-y-3">{combinations.map((combination,index)=><div key={combination.id} className="rounded-md border border-line bg-panel p-3">
      <div className="grid grid-cols-[1fr_110px_120px_auto] gap-2"><input aria-label="Nome da combinação" value={combination.name} onChange={event=>update(index,{name:event.target.value})}/><input aria-label="Prioridade" type="number" min="0" value={combination.priority} onChange={event=>update(index,{priority:Number(event.target.value)})}/><label className="flex items-center justify-center gap-2 rounded-md border border-line text-[10px]"><input type="checkbox" checked={combination.enabled} onChange={event=>update(index,{enabled:event.target.checked})}/>Ativa</label><TerminalIconButton title="Excluir combinação" onClick={()=>onChange(combinations.filter((_,itemIndex)=>itemIndex!==index))} tone="danger"><Trash2 size={12}/></TerminalIconButton></div>
      <div className="mt-3 grid grid-cols-2 gap-3"><label><span className="label">Gatilho inicial</span><select className="mt-1.5 w-full" value={combination.triggerType??'BET_STRATEGY'} onChange={event=>{const triggerType=event.target.value as TerminalOperationCombination['triggerType'];update(index,{triggerType,behavior:triggerType==='SEQUENCE_AI'?'RUN_ONCE':combination.behavior,sequenceAiConfig:triggerType==='SEQUENCE_AI'?(combination.sequenceAiConfig??defaultSequenceAiConfig()):combination.sequenceAiConfig})}}><option value="PATTERN">Digitar sequência W/L</option><option value="BET_STRATEGY">Usar estratégia de entrada</option><option value="SEQUENCE_AI">Inteligência sequencial</option></select></label>{(combination.triggerType??'BET_STRATEGY')==='PATTERN'?<label><span className="label">Sequência para entrar</span><input className="mt-1.5 w-full font-mono uppercase" value={combination.pattern??''} onChange={event=>update(index,{pattern:normalizePattern(event.target.value)})} placeholder="Ex.: LLLWWL, LW ou W"/></label>:(combination.triggerType??'BET_STRATEGY')==='BET_STRATEGY'?<label><span className="label">Estratégia de entrada</span><select className="mt-1.5 w-full" value={combination.betStrategyId} onChange={event=>update(index,{betStrategyId:event.target.value})}>{betStrategies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:<div className="flex items-end pb-2 text-[9px] leading-4 text-muted">A IA aprende com o histórico da fonte e prevê o próximo W antes de armar a BASE.</div>}</div>
      {combination.triggerType==='SEQUENCE_AI'&&<div className="mt-3 grid grid-cols-3 gap-3 rounded-md border border-brand/25 bg-brand/10 p-3"><label><span className="label">Motor de análise</span><select className="mt-1.5 w-full" value={combination.sequenceAiConfig?.engineVersion??'V1'} onChange={event=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),engineVersion:event.target.value as 'V1'|'V2'}})}><option value="V2">Banco de padrões v2</option><option value="V1">IA legada v1</option></select></label><AiNumber label="Janela mínima" value={combination.sequenceAiConfig?.minWindow??2} min={1} max={16} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),minWindow:value}})}/><AiNumber label="Janela máxima" value={combination.sequenceAiConfig?.maxWindow??12} min={2} max={16} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),maxWindow:value}})}/><AiNumber label="Ocorrências mínimas" value={combination.sequenceAiConfig?.minOccurrences??20} min={2} max={100000} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),minOccurrences:value}})}/><AiNumber label="Confiança mínima (%)" value={combination.sequenceAiConfig?.minConfidence??60} min={50} max={99.9} step={0.1} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),minConfidence:value}})}/><AiNumber label="Limite conservador (%)" value={combination.sequenceAiConfig?.minProbabilityLowerBound??50} min={0} max={99.9} step={0.1} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),minProbabilityLowerBound:value}})}/><AiNumber label="Máx. L atuais" value={combination.sequenceAiConfig?.maxCurrentLossStreak??3} min={0} max={16} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),maxCurrentLossStreak:value}})}/><AiNumber label="Consenso mínimo (%)" value={combination.sequenceAiConfig?.minContextAgreement??60} min={0} max={100} step={1} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),minContextAgreement:value}})}/><AiNumber label="Risco máx. ciclo (0 = auto)" value={combination.sequenceAiConfig?.maxFullCycleLossRisk??0} min={0} max={100} step={0.1} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),maxFullCycleLossRisk:value}})}/>{(combination.sequenceAiConfig?.engineVersion??'V1')==='V2'&&<><AiNumber label="Janela recente" value={combination.sequenceAiConfig?.recentWindow??500} min={50} max={5000} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),recentWindow:value}})}/><AiNumber label="Amostra recente mínima" value={combination.sequenceAiConfig?.minRecentOccurrences??8} min={0} max={10000} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),minRecentOccurrences:value}})}/><AiNumber label="Divergência máx. (p.p.)" value={combination.sequenceAiConfig?.maxRecentDivergence??12} min={0} max={100} step={0.5} onChange={value=>update(index,{sequenceAiConfig:{...(combination.sequenceAiConfig??defaultSequenceAiConfig()),maxRecentDivergence:value}})}/></>}<div className="col-span-3 text-[9px] leading-4 text-blue-100">A v2 combina janelas de 2 a 16 casas, usa limite estatístico conservador, detecta mudança de regime e bloqueia ciclos com risco elevado. A IA legada permanece disponível para comparação.</div></div>}
      {combination.triggerType==='SEQUENCE_AI'?<div className="mt-3 grid grid-cols-2 gap-3 rounded-md border border-brand/25 bg-brand/10 p-3"><div><span className="label">Reentrada após LOSS/Gale</span><div className="mt-1.5 rounded-md border border-brand/25 px-3 py-2 text-[10px] text-blue-100">Reavaliar pela IA a cada saída</div></div><div className="flex items-end pb-2 text-[9px] leading-4 text-blue-100">O Gale permanece pendente até a IA prever W novamente. Um L da fonte alimenta a análise, mas não libera aposta automaticamente.</div></div>:<div className="mt-3 grid grid-cols-2 gap-3"><label><span className="label">Reentrada após LOSS/Gale</span><select className="mt-1.5 w-full" value={combination.lossReentryType??'BET_STRATEGY'} onChange={event=>update(index,{lossReentryType:event.target.value as TerminalOperationCombination['lossReentryType']})}><option value="PATTERN">Esperar sequência W/L</option><option value="BET_STRATEGY">Usar estratégia de entrada</option><option value="IMMEDIATE">Entrar imediatamente</option></select></label>{(combination.lossReentryType??'BET_STRATEGY')==='PATTERN'?<label><span className="label">Sequência para reentrar</span><input className="mt-1.5 w-full font-mono uppercase" value={combination.lossReentryPattern??''} onChange={event=>update(index,{lossReentryPattern:normalizePattern(event.target.value)})} placeholder="Ex.: W, LW ou LLW"/></label>:(combination.lossReentryType??'BET_STRATEGY')==='BET_STRATEGY'?<label><span className="label">Estratégia após LOSS</span><select className="mt-1.5 w-full" value={combination.lossReentryBetStrategyId??combination.betStrategyId} onChange={event=>update(index,{lossReentryBetStrategyId:event.target.value})}>{betStrategies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:<div className="flex items-end pb-2 text-[9px] text-muted">O próximo estágio será confirmado no sinal seguinte.</div>}</div>}
      <div className="mt-3 grid grid-cols-2 gap-3"><label><span className="label">Estratégia de aposta</span><select className="mt-1.5 w-full" value={combination.betPlanId} onChange={event=>update(index,{betPlanId:event.target.value})}>{betPlans.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span className="label">Depois da entrada</span><select className="mt-1.5 w-full" value={combination.triggerType==='SEQUENCE_AI'?'RUN_ONCE':combination.behavior} disabled={combination.triggerType==='SEQUENCE_AI'} onChange={event=>update(index,{behavior:event.target.value as TerminalOperationCombination['behavior']})}><option value="REPEAT_UNTIL_LOSS">Seguir até o primeiro LOSS</option><option value="RUN_ONCE">{combination.triggerType==='SEQUENCE_AI'?'IA reavalia após encerrar o ciclo':'Executar somente uma vez'}</option></select></label></div>
    </div>)}{combinations.length===0&&<div className="rounded-md border border-dashed border-line p-5 text-center text-[10px] text-muted">Nenhuma combinação criada. O Terminal continuará usando a configuração de compatibilidade abaixo.</div>}</div>
  </fieldset>;
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) { return <label className={className}><span className="label">{label}</span><div className="form-field mt-1.5">{children}</div></label>; }
function defaultSequenceAiConfig(){return{engineVersion:'V2' as const,minWindow:2,maxWindow:16,minOccurrences:30,minConfidence:58,maxCurrentLossStreak:3,minContextAgreement:60,maxFullCycleLossRisk:0,minProbabilityLowerBound:50,recentWindow:500,minRecentOccurrences:8,maxRecentDivergence:12};}
function AiNumber({label,value,min,max,step=1,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange(value:number):void}){return <label><span className="label">{label}</span><input className="mt-1.5 w-full" type="number" value={value} min={min} max={max} step={step} onChange={event=>onChange(Number(event.target.value))}/></label>}
function historyDotOptions(max:number){return [...new Set([25,50,100,200,300,400,500,1_000,2_000,3_000,4_000,5_000,max].filter(value=>value<=max))].sort((left,right)=>left-right);}
function displayedResultLetter(result:TerminalHistoryItem['gameResult']){return result==='LOSS'?'L':'W';}
function calculateDisplayedStreak(results:TerminalHistoryItem['gameResult'][]){
  const last=results.at(-1);if(!last||last==='TIE')return'—';let count=0;
  for(let index=results.length-1;index>=0&&results[index]===last;index--)count++;
  return`${last==='WIN'?'W':'L'}${count}`;
}
function signedMoney(value:number){return `${value>=0?'+':'−'} ${money(Math.abs(value))}`}
function translateTerminalStatus(status:string){return status==='RUNNING'?'EM EXECUÇÃO':status==='PAUSED'?'PAUSADO':status==='STOPPED'?'PARADO':status}
function translateOperationalState(runtime:TerminalRuntime|undefined,terminal?:Terminal){if(runtime?.galeRuntime.active){const stage=runtime.galeRuntime.currentStage;if(stage>0&&runtime.galeRuntime.entryConfirmed===false)return`G${stage} AGUARDANDO IA`;if(terminal?.strategySourceMode==='BET_EXECUTIONS')return stage===0?'BASE ARMADA • AGUARDANDO APOSTA DA FONTE':`G${stage} ARMADO • PRÓXIMA RODADA`;if(runtime.galeRuntime.followUp&&runtime.galeRuntime.followUpBehavior==='REPEAT_UNTIL_LOSS')return'CONTINUANDO ATÉ LOSS';return`APOSTA ${stage===0?'BASE':`G${stage}`} AGUARDANDO`;}const blocked=terminal&&runtime?terminal.entryBlockPatterns.find(pattern=>runtime.resultAnalyzerState.recentPattern.toUpperCase().endsWith(pattern)):null;if(blocked)return`ENTRADA BLOQUEADA • ${blocked}`;return terminal?.strategySourceMode==='BET_EXECUTIONS'?'AGUARDANDO OPERAÇÃO DA FONTE':translateGameState(runtime?.gameStrategyRuntime.state??'SEARCH_TRIGGER');}
function translateBetCycle(runtime:TerminalRuntime|undefined,terminal?:Terminal){if(!runtime?.galeRuntime.active)return'SEM CICLO ATIVO';if(runtime.galeRuntime.currentStage>0&&runtime.galeRuntime.entryConfirmed===false)return`GALE ${runtime.galeRuntime.currentStage} AGUARDANDO NOVA ENTRADA DA IA`;if(terminal?.strategySourceMode==='BET_EXECUTIONS')return runtime.galeRuntime.currentStage===0?'BASE NA PRÓXIMA OPERAÇÃO DA FONTE':`GALE ${runtime.galeRuntime.currentStage} NA PRÓXIMA RODADA`;if(runtime.galeRuntime.followUp&&runtime.galeRuntime.followUpBehavior==='REPEAT_UNTIL_LOSS')return`${runtime.galeRuntime.currentStage===0?'BASE':`GALE ${runtime.galeRuntime.currentStage}`} PÓS-WIN`;return`${runtime.galeRuntime.currentStage===0?'BASE':`GALE ${runtime.galeRuntime.currentStage}`} AGUARDANDO`;}
function translateGameState(state:string){return state==='SEARCH_TRIGGER'?'BUSCANDO GATILHO':state==='WAIT_RESULT'?'AGUARDANDO RESULTADO':state==='WAIT_RELEASE'?'AGUARDANDO LIBERAÇÃO':state}
function translateDecision(action:string|null|undefined){return action==='ENTER'?'ENTRAR':action==='IGNORE'?'IGNORAR':action==='PAUSE'?'PAUSAR':'—'}
function translateResult(result:string){return result==='WIN'?'GANHO':result==='LOSS'?'PERDA':'EMPATE'}
function resultToneClass(result:string){return result==='WIN'?'text-success':result==='LOSS'?'text-danger':'text-warning'}
function resultBadgeTone(result:string):'success'|'danger'|'warning'{return result==='WIN'?'success':result==='LOSS'?'danger':'warning'}
function roundAnalysisIndicator(runtime:TerminalRuntime|undefined){const role=runtime?.gameStrategyRuntime.lastAnnotationRole;if(role==='WIN'||role==='LOSS')return{symbol:'●',label:'Rodada analisada e adicionada à sequência',tone:'text-success'};if(role==='TRIGGER'||role==='RELEASE_TRIGGER')return{symbol:'→',label:'A próxima rodada será analisada',tone:'text-brand'};if(role)return{symbol:'×',label:'Rodada não analisável ou ignorada',tone:'text-muted'};return null;}
