import { describe, expect, it } from 'vitest';
import type { BetDecision, BetExecution, BetPlanConfig, BetStageEvent, BetStrategyConfig, GameSignal, GameStrategyConfig, NormalizedRound, RoundAnnotation, Terminal, TerminalControlRule, TerminalRuntime } from '@aviator/shared';
import { RoundEventBus } from '@aviator/collector';
import { createTerminal, TerminalManager, type TerminalRuntimeRepository } from '../src/index.js';

class MemoryRepository implements TerminalRuntimeRepository {
  terminals = new Map<string, Terminal>(); runtimes = new Map<string, TerminalRuntime>(); receipts = new Set<string>();
  annotations: RoundAnnotation[] = []; signals: GameSignal[] = []; decisions: BetDecision[] = []; stages: BetStageEvent[] = []; executions: BetExecution[] = [];
  betStrategyConfig = betStrategyConfig;
  betStrategyConfigs=new Map<string,BetStrategyConfig>();
  betPlanStageCount=3;
  betPlanCashout=2;
  betPlanConfig:BetPlanConfig|null=null;
  controlRules:TerminalControlRule[]=[];
  listTerminals() { return [...this.terminals.values()]; }
  getTerminal(id: string) { return this.terminals.get(id) ?? null; }
  saveTerminal(terminal: Terminal) { this.terminals.set(terminal.id, structuredClone(terminal)); }
  updateTerminal(terminal: Terminal) { this.terminals.set(terminal.id, structuredClone(terminal)); }
  deleteTerminal(id: string) { this.terminals.delete(id); this.runtimes.delete(id); }
  resetTerminal(id:string,clearHistory=false){const terminal=this.terminals.get(id);if(terminal){terminal.currentBankrollCents=terminal.initialBankrollCents;if(clearHistory){terminal.gameWins=0;terminal.gameLosses=0;}}if(clearHistory){this.runtimes.delete(id);this.annotations=this.annotations.filter(item=>item.terminalId!==id);this.signals=this.signals.filter(item=>item.terminalId!==id);this.decisions=this.decisions.filter(item=>item.terminalId!==id);this.stages=this.stages.filter(item=>item.terminalId!==id);this.executions=this.executions.filter(item=>item.terminalId!==id);}}
  clearTerminalCalculatedHistory(id:string){const terminal=this.terminals.get(id);if(terminal){terminal.gameWins=0;terminal.gameLosses=0;}this.runtimes.delete(id);this.receipts=new Set([...this.receipts].filter(key=>!key.startsWith(`${id}:`)));this.annotations=this.annotations.filter(item=>item.terminalId!==id);this.signals=this.signals.filter(item=>item.terminalId!==id);this.decisions=this.decisions.filter(item=>item.terminalId!==id);this.stages=this.stages.filter(item=>item.terminalId!==id);this.executions=this.executions.filter(item=>item.terminalId!==id);}
  updateTerminalInitialBankroll(id:string,value:number){const terminal=this.terminals.get(id);if(terminal){terminal.initialBankrollCents=value;terminal.currentBankrollCents=value;}}
  setTerminalPaused(id: string, paused: boolean) { const terminal = this.terminals.get(id); if (terminal) terminal.paused = paused; }
  getTerminalRuntime(id: string) { const runtime = this.runtimes.get(id); return runtime ? structuredClone(runtime) : null; }
  saveTerminalRuntime(runtime: TerminalRuntime) { this.runtimes.set(runtime.terminalId, structuredClone(runtime)); }
  recordRoundReceipt(terminalId: string, round: NormalizedRound) { const key = `${terminalId}:${round.id}`; if (this.receipts.has(key)) return false; this.receipts.add(key); return true; }
  getGameStrategyConfig() { return strategyConfig; }
  saveRoundAnnotation(annotation: RoundAnnotation) { this.annotations.push(annotation); }
  saveGameSignal(signal: GameSignal) { this.signals.push(signal); }
  getTerminalGameSignalByRound(terminalId:string,roundId:string){return[...this.signals].reverse().find((signal:GameSignal)=>signal.terminalId===terminalId&&signal.resultRoundId===roundId)??null;}
  getTerminalBetExecutionByRound(terminalId:string,roundId:string){const signal=this.getTerminalGameSignalByRound(terminalId,roundId);return signal?[...this.executions].reverse().find(execution=>execution.terminalId===terminalId&&execution.gameSignalId===signal.id)??null:null;}
  getBetStrategyConfig(id:string) { return this.betStrategyConfigs.get(id)??this.betStrategyConfig; }
  saveBetDecision(decision: BetDecision) { this.decisions.push(decision); }
  updateTerminalGameStats(id: string, wins: number, losses: number) { const terminal = this.terminals.get(id); if (terminal) { terminal.gameWins = wins; terminal.gameLosses = losses; } }
  getBetPlanConfig() { return this.betPlanConfig??{ stages: Array.from({ length: this.betPlanStageCount }, (_, index) => ({ index, label: index === 0 ? 'BASE' : `GALE ${index}`, legs: [{ slot: 1, amountCents: 100 * 2 ** index, cashout: this.betPlanCashout }] })) }; }
  getTerminalSchedule() { return null; }
  listTerminalControlRules() { return this.controlRules; }
  getTerminalControlRules(terminalId:string) { return this.controlRules.filter(rule=>!rule.targetTerminalId||rule.targetTerminalId===terminalId); }
  saveBetStageEvent(event: BetStageEvent) { this.stages.push(event); }
  saveBetExecution(execution: BetExecution) { this.executions.push(execution); }
  updateTerminalBankroll(id: string, balanceCents: number) { const terminal = this.terminals.get(id); if (terminal) terminal.currentBankrollCents = balanceCents; }
}

const strategyConfig: GameStrategyConfig = {
  trigger: [{ operator: 'GT', value: 1.35 }, { operator: 'LT', value: 99 }],
  win: [{ operator: 'GTE', value: 2 }], loss: [{ operator: 'BETWEEN', value: [0.01, 1.99] }],
  afterLoss: [{ operator: 'LT', value: 1.35 }], release: [{ operator: 'GTE', value: 2 }]
};
const betStrategyConfig: BetStrategyConfig = { rules: [{ id: 'loss-2', name: 'Loss 2', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', value: 2 }], action: 'ENTER' }] };

const platformId = crypto.randomUUID();
const makeTerminal = (name: string) => createTerminal({ name, platformId, gameStrategyId: crypto.randomUUID(), betStrategyId: crypto.randomUUID(), betPlanId: crypto.randomUUID(), screenProfileId: null, mode: 'SIMULATION', enabled: true, paused: false, initialBankrollCents: 10_000 }, crypto.randomUUID(), new Date().toISOString());
const makeRound = (multiplier = 1.72, sourcePlatformId = platformId): NormalizedRound => ({ id: crypto.randomUUID(), platformId: sourcePlatformId, externalId: crypto.randomUUID(), multiplier, occurredAt: new Date().toISOString(), collectedAt: new Date().toISOString(), source: 'TIPMINER', deliveryMode: 'LIVE', dedupKey: crypto.randomUUID() });

describe('TerminalManager', () => {
  it('routes one shared platform round into isolated runtimes', async () => {
    const repository = new MemoryRepository(); const first = makeTerminal('T1'); const second = makeTerminal('T2');
    repository.saveTerminal(first); repository.saveTerminal(second);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize();
    const round = makeRound(); expect(await manager.routeRoundToTerminals(round)).toBe(2);
    const firstRuntime = manager.getRuntime(first.id)!; const secondRuntime = manager.getRuntime(second.id)!;
    expect(firstRuntime).not.toBe(secondRuntime);
    expect(firstRuntime.lastProcessedRoundId).toBe(round.id); expect(secondRuntime.lastProcessedRoundId).toBe(round.id);
    expect(firstRuntime.gameStrategyRuntime.processedRounds).toBe(1); expect(secondRuntime.gameStrategyRuntime.processedRounds).toBe(1);
    expect(firstRuntime.gameStrategyRuntime.state).toBe('WAIT_RESULT'); expect(secondRuntime.gameStrategyRuntime.state).toBe('WAIT_RESULT');
    expect(repository.annotations).toHaveLength(2);
  });

  it('pauses only one subscription and keeps the other runtime processing', async () => {
    const repository = new MemoryRepository(); const first = makeTerminal('T1'); const second = makeTerminal('T2');
    repository.saveTerminal(first); repository.saveTerminal(second);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize(); manager.pauseTerminal(first.id);
    expect(await manager.routeRoundToTerminals(makeRound())).toBe(1);
    expect(manager.getRuntime(first.id)?.gameStrategyRuntime.processedRounds).toBe(0);
    expect(manager.getRuntime(second.id)?.gameStrategyRuntime.processedRounds).toBe(1);
  });

  it('duplicates configuration into a new paused zero-state runtime', () => {
    const repository = new MemoryRepository(); const source = makeTerminal('T1'); repository.saveTerminal(source);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize();
    const copy = manager.duplicateTerminal(source.id)!; const runtime = manager.getRuntime(copy.id)!;
    expect(copy.id).not.toBe(source.id); expect(copy.platformId).toBe(source.platformId);
    expect(runtime.terminalId).toBe(copy.id); expect(runtime.gameStrategyRuntime.processedRounds).toBe(0); expect(runtime.status).toBe('PAUSED');
  });

  it('resets only financial values and preserves signals, bets and analyzer history',()=>{const repository=new MemoryRepository();const terminal=makeTerminal('Resetável');terminal.currentBankrollCents=7_500;terminal.gameWins=8;terminal.gameLosses=5;repository.saveTerminal(terminal);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();const runtime=manager.getRuntime(terminal.id)!;runtime.bankrollState.currentBalanceCents=7_500;runtime.resultAnalyzerState.currentWinStreak=2;repository.signals.push({id:crypto.randomUUID(),terminalId:terminal.id,platformId:terminal.platformId,strategyId:terminal.gameStrategyId,triggerRoundId:crypto.randomUUID(),resultRoundId:crypto.randomUUID(),result:'WIN',createdAt:new Date().toISOString(),metadata:{multiplier:2.5}});repository.stages.push({id:crypto.randomUUID(),cycleId:crypto.randomUUID(),terminalId:terminal.id,gameSignalId:repository.signals[0].id,stageIndex:0,stageLabel:'BASE',result:'WIN',createdAt:new Date().toISOString()});manager.resetTerminal(terminal.id);expect(repository.getTerminal(terminal.id)).toMatchObject({currentBankrollCents:10_000,gameWins:8,gameLosses:5,platformId:terminal.platformId,betPlanId:terminal.betPlanId});expect(manager.getRuntime(terminal.id)?.bankrollState.currentBalanceCents).toBe(10_000);expect(manager.getRuntime(terminal.id)?.resultAnalyzerState.currentWinStreak).toBe(2);expect(repository.signals).toHaveLength(1);expect(repository.stages).toHaveLength(1);});

  it('optionally clears the operational history when fully resetting a terminal',()=>{const repository=new MemoryRepository();const terminal=makeTerminal('Reset completo');terminal.currentBankrollCents=7_500;terminal.gameWins=8;terminal.gameLosses=5;repository.saveTerminal(terminal);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();const runtime=manager.getRuntime(terminal.id)!;runtime.resultAnalyzerState.currentWinStreak=2;repository.saveTerminalRuntime(runtime);repository.signals.push({id:crypto.randomUUID(),terminalId:terminal.id,platformId:terminal.platformId,strategyId:terminal.gameStrategyId,triggerRoundId:crypto.randomUUID(),resultRoundId:crypto.randomUUID(),result:'WIN',createdAt:new Date().toISOString(),metadata:{multiplier:2.5}});manager.resetTerminal(terminal.id,true);expect(repository.getTerminal(terminal.id)).toMatchObject({currentBankrollCents:10_000,gameWins:0,gameLosses:0});expect(manager.getRuntime(terminal.id)?.resultAnalyzerState.currentWinStreak).toBe(0);expect(repository.signals).toHaveLength(0);});

  it('updates the initial bankroll without clearing the analyzer history',()=>{const repository=new MemoryRepository();const terminal=makeTerminal('Editar banca');repository.saveTerminal(terminal);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();const runtime=manager.getRuntime(terminal.id)!;runtime.resultAnalyzerState.currentLossStreak=3;repository.saveTerminalRuntime(runtime);manager.updateTerminalInitialBankroll(terminal.id,25_000);expect(repository.getTerminal(terminal.id)).toMatchObject({initialBankrollCents:25_000,currentBankrollCents:25_000});expect(manager.getRuntime(terminal.id)?.bankrollState).toMatchObject({initialBalanceCents:25_000,currentBalanceCents:25_000});expect(manager.getRuntime(terminal.id)?.resultAnalyzerState.currentLossStreak).toBe(3);});

  it('uses signals before the selected dot as context without counting them in the bankroll',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Banca por bolinha');
    const start=Date.parse('2026-01-01T12:00:00.000Z');const rounds=[1.72,1.25,2.27,1.25,2.27,1.25,2.27,1.25].map((multiplier,index)=>({...makeRound(multiplier),occurredAt:new Date(start+index*1_000).toISOString()}));
    terminal.bankrollStartAt=rounds[7].occurredAt;repository.saveTerminal(terminal);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const round of rounds)await manager.routeRoundToTerminals(round);
    expect(repository.executions).toHaveLength(1);
    expect(repository.executions[0]).toMatchObject({stageIndex:1,stakeCents:200,profitLossCents:-200,bankrollBeforeCents:10_000,bankrollAfterCents:9_800});
    expect(repository.getTerminal(terminal.id)?.currentBankrollCents).toBe(9_800);
  });

  it('analyzes signals and evaluates the bet strategy independently', async () => {
    const repository = new MemoryRepository(); const terminal = makeTerminal('T1'); repository.saveTerminal(terminal);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize();
    for (const multiplier of [1.72, 1.25, 2.27, 1.25]) await manager.routeRoundToTerminals(makeRound(multiplier));
    const runtime = manager.getRuntime(terminal.id)!;
    expect(runtime.resultAnalyzerState.currentLossStreak).toBe(2);
    expect(runtime.resultAnalyzerState.recentPattern).toBe('LL');
    expect(runtime.betStrategyRuntime.lastAction).toBe('ENTER');
    expect(runtime.betStrategyRuntime.entryCount).toBe(1);
    expect(repository.decisions.map(decision => decision.action)).toEqual(['IGNORE', 'ENTER']);
  });

  it('always uses the bet plan configured on the terminal, ignoring a legacy main plan on the entry rule', async () => {
    const repository = new MemoryRepository(); const terminal = makeTerminal('Plano do terminal'); const legacyRulePlanId = crypto.randomUUID();
    repository.betStrategyConfig = { rules: [{ id: 'legacy-plan', name: 'Entrada com plano antigo', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', value: 2 }], action: 'ENTER', betPlanId: legacyRulePlanId }] };
    repository.saveTerminal(terminal);
    const preparedPlanIds:string[]=[];
    const manager = new TerminalManager(repository, new RoundEventBus());
    manager.setAssistedPreparationHandler(request=>{preparedPlanIds.push(request.betPlanId)});
    manager.initialize();
    for (const multiplier of [1.72, 1.25, 2.27, 1.25]) await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(preparedPlanIds.at(-1)).toBe(terminal.betPlanLossId);
    expect(preparedPlanIds).not.toContain(legacyRulePlanId);
  });

  it('updates configuration and moves the live subscription to the selected platform', async () => {
    const repository = new MemoryRepository(); const terminal = makeTerminal('T1'); repository.saveTerminal(terminal);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize();
    const nextPlatformId = crypto.randomUUID();
    const updated = manager.updateTerminal(terminal.id, { name: 'T1 editado', platformId: nextPlatformId, gameStrategyId: terminal.gameStrategyId, betStrategyId: terminal.betStrategyId, betPlanId: terminal.betPlanId, mode: 'ASSISTED' });
    expect(updated?.name).toBe('T1 editado'); expect(updated?.mode).toBe('ASSISTED');
    expect(await manager.routeRoundToTerminals(makeRound(1.72))).toBe(0);
    expect(await manager.routeRoundToTerminals(makeRound(1.72, nextPlatformId))).toBe(1);
  });

  it('synchronizes terminal configuration without clearing analyzed history',()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Sincronizável');repository.saveTerminal(terminal);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();const runtime=manager.getRuntime(terminal.id)!;
    runtime.gameStrategyRuntime.state='WAIT_RELEASE';runtime.gameStrategyRuntime.triggerRoundId=crypto.randomUUID();runtime.gameStrategyRuntime.releaseProgress=2;runtime.resultAnalyzerState.recentPattern='WLW';runtime.resultAnalyzerState.winCount=2;runtime.resultAnalyzerState.lossCount=1;
    expect(manager.synchronizeTerminal(terminal.id)).toBe(true);
    expect(manager.getRuntime(terminal.id)?.gameStrategyRuntime).toMatchObject({state:'SEARCH_TRIGGER',triggerRoundId:null,releaseProgress:0});
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState).toMatchObject({recentPattern:'WLW',winCount:2,lossCount:1});
  });

  it('drives a dependent Terminal from the W/L signals of its principal Terminal',async()=>{
    const repository=new MemoryRepository();const principal=makeTerminal('Principal');const dependent=makeTerminal('Dependente');dependent.strategySourceTerminalId=principal.id;
    principal.betStrategyWinId=crypto.randomUUID();principal.betStrategyLossId=crypto.randomUUID();dependent.betStrategyWinId=crypto.randomUUID();dependent.betStrategyLossId=crypto.randomUUID();
    repository.betStrategyConfigs.set(principal.betStrategyWinId,{rules:[{id:'principal-ignore',name:'Não apostar',enabled:true,priority:1,conditions:[{field:'winCount',operator:'GT',value:999}],action:'ENTER'}]});repository.betStrategyConfigs.set(principal.betStrategyLossId,repository.betStrategyConfigs.get(principal.betStrategyWinId)!);
    repository.betStrategyConfigs.set(dependent.betStrategyWinId,{rules:[{id:'dependent-w1',name:'Entrar no W1 do principal',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'EQ',value:1}],action:'ENTER'}]});repository.betStrategyConfigs.set(dependent.betStrategyLossId,{rules:[{id:'dependent-ignore',name:'Ignorar LOSS',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'GT',value:999}],action:'ENTER'}]});
    repository.saveTerminal(principal);repository.saveTerminal(dependent);repository.terminals.delete(principal.id);repository.saveTerminal(principal);
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,2.5,1.72,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    const principalSignals=repository.signals.filter(signal=>signal.terminalId===principal.id);const dependentSignals=repository.signals.filter(signal=>signal.terminalId===dependent.id);
    expect(dependentSignals.map(signal=>signal.result)).toEqual(principalSignals.map(signal=>signal.result));
    expect(dependentSignals.every(signal=>signal.metadata.sourceTerminalId===principal.id)).toBe(true);
    expect(repository.decisions.filter(decision=>decision.terminalId===dependent.id).map(decision=>decision.action)).toEqual(['ENTER','IGNORE']);
    expect(repository.stages.filter(stage=>stage.terminalId===dependent.id)).toHaveLength(1);
  });

  it('rejects cross-platform and circular Terminal references',()=>{
    const repository=new MemoryRepository();const principal=makeTerminal('Principal');const dependent=makeTerminal('Dependente');repository.saveTerminal(principal);repository.saveTerminal(dependent);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    expect(()=>manager.updateTerminal(dependent.id,{...dependent,strategySourceTerminalId:principal.id,platformId:crypto.randomUUID()})).toThrow('mesma plataforma');
    manager.updateTerminal(dependent.id,{...dependent,strategySourceTerminalId:principal.id});
    expect(()=>manager.updateTerminal(principal.id,{...principal,strategySourceTerminalId:dependent.id})).toThrow('ciclo');
  });

  it('selects the highest-priority source-pattern combination and repeats until its own bet LOSS',async()=>{
    const repository=new MemoryRepository();const source=makeTerminal('Fonte');const dependent=makeTerminal('Operacional');dependent.strategySourceTerminalId=source.id;
    const strategyLlw=crypto.randomUUID();const strategyLw=crypto.randomUUID();const planLlw=crypto.randomUUID();const planLw=crypto.randomUUID();
    dependent.operationCombinations=[
      {id:'llw',name:'LLW até LOSS',priority:10,enabled:true,triggerType:'BET_STRATEGY',pattern:null,betStrategyId:strategyLlw,lossReentryType:'BET_STRATEGY',lossReentryPattern:null,lossReentryBetStrategyId:null,betPlanId:planLlw,behavior:'REPEAT_UNTIL_LOSS'},
      {id:'lw',name:'LW até LOSS',priority:20,enabled:true,triggerType:'BET_STRATEGY',pattern:null,betStrategyId:strategyLw,lossReentryType:'BET_STRATEGY',lossReentryPattern:null,lossReentryBetStrategyId:null,betPlanId:planLw,behavior:'REPEAT_UNTIL_LOSS'}
    ];
    repository.betStrategyConfigs.set(strategyLlw,{rules:[{id:'pattern-llw',name:'LLW',enabled:true,priority:1,conditions:[{field:'recentPattern',operator:'MATCHES',value:'LLW'}],action:'ENTER'}]});
    repository.betStrategyConfigs.set(strategyLw,{rules:[{id:'pattern-lw',name:'LW',enabled:true,priority:1,conditions:[{field:'recentPattern',operator:'MATCHES',value:'LW'}],action:'ENTER'}]});
    repository.saveTerminal(source);repository.saveTerminal(dependent);const preparedPlans:string[]=[];const manager=new TerminalManager(repository,new RoundEventBus());manager.setAssistedPreparationHandler(request=>{if(request.terminalId===dependent.id)preparedPlans.push(request.betPlanId)});manager.initialize();
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,2.5,1.72,2.5,1.72,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.decisions.filter(item=>item.terminalId===dependent.id&&item.action==='ENTER').at(0)?.metadata).toMatchObject({operationCombinationId:'llw'});
    expect(preparedPlans.every(id=>id===planLlw)).toBe(true);
    expect(repository.executions.filter(item=>item.terminalId===dependent.id).map(item=>item.result)).toEqual(['WIN','LOSS']);
    expect(repository.getTerminal(dependent.id)).toMatchObject({gameWins:1,gameLosses:1});
    expect(manager.getRuntime(dependent.id)?.galeRuntime.active).toBe(false);
  });

  it('accepts a typed W/L trigger and waits for a different typed pattern before Gale reentry',async()=>{
    const repository=new MemoryRepository();const source=makeTerminal('Fonte direta');const dependent=makeTerminal('Padrões digitados');dependent.strategySourceTerminalId=source.id;
    dependent.operationCombinations=[{id:'direct',name:'LLW e reentrada W',priority:10,enabled:true,triggerType:'PATTERN',pattern:'LLW',betStrategyId:dependent.betStrategyId,lossReentryType:'PATTERN',lossReentryPattern:'W',lossReentryBetStrategyId:null,betPlanId:dependent.betPlanId,behavior:'RUN_ONCE'}];
    repository.betPlanConfig={stages:[{index:0,label:'BASE',legs:[{slot:1,amountCents:100,cashout:2}]},{index:1,label:'GALE 1',execution:{policy:'AFTER_ENTRY_CONFIRMATION'},legs:[{slot:1,amountCents:200,cashout:2}]}]};
    repository.saveTerminal(source);repository.saveTerminal(dependent);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,2.5,1.72,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.executions.filter(item=>item.terminalId===dependent.id).map(item=>item.result)).toEqual(['LOSS']);
    expect(manager.getRuntime(dependent.id)?.galeRuntime).toMatchObject({active:true,currentStage:1,entryConfirmed:false});
    for(const multiplier of[2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(dependent.id)?.galeRuntime.entryConfirmed).toBe(true);
    expect(repository.decisions.filter(item=>item.terminalId===dependent.id).at(-1)?.metadata).toMatchObject({pattern:'W',reentryAfterLoss:true,matched:true});
    for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.executions.filter(item=>item.terminalId===dependent.id).map(item=>item.result)).toEqual(['LOSS','WIN']);
  });

  it('arms BASE when sequential intelligence recognizes a learned W pattern',async()=>{
    const repository=new MemoryRepository();const source=makeTerminal('Fonte IA');source.enabled=false;const dependent=makeTerminal('Terminal IA');dependent.strategySourceTerminalId=source.id;
    dependent.operationCombinations=[{id:'sequence-ai',name:'IA 12 sinais',priority:1,enabled:true,triggerType:'SEQUENCE_AI',pattern:null,sequenceAiConfig:{minWindow:2,maxWindow:12,minOccurrences:10,minConfidence:60},betStrategyId:dependent.betStrategyId,lossReentryType:'IMMEDIATE',lossReentryPattern:null,lossReentryBetStrategyId:null,betPlanId:dependent.betPlanId,behavior:'RUN_ONCE'}];
    repository.betStrategyConfigs.set(dependent.betStrategyWinId,{rules:[{id:'legacy-after-win',name:'Continuação global após WIN',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'GTE',value:1}],action:'ENTER',onWinBetPlanId:dependent.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    repository.saveTerminal(source);repository.saveTerminal(dependent);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();const runtime=manager.getRuntime(dependent.id)!;runtime.sequenceAiRuntime={history:'LWLW',observations:100,transitions:{LWLWL:{wins:18,losses:2}},lastPrediction:null};
    const round=makeRound(1.2);repository.signals.push({id:crypto.randomUUID(),terminalId:source.id,platformId:source.platformId,strategyId:source.gameStrategyId,triggerRoundId:round.id,resultRoundId:round.id,result:'LOSS',metadata:{multiplier:1.2},createdAt:round.occurredAt});await manager.routeRoundToTerminals(round);
    expect(runtime.sequenceAiRuntime.lastPrediction).toMatchObject({expected:'W',shouldEnter:true,context:'LWLWL'});
    expect(runtime.galeRuntime).toMatchObject({active:true,currentStage:0,activeCombinationId:'sequence-ai'});
    expect(repository.decisions.at(-1)?.metadata).toMatchObject({triggerType:'SEQUENCE_AI'});
    const winRound=makeRound(3.42);repository.signals.push({id:crypto.randomUUID(),terminalId:source.id,platformId:source.platformId,strategyId:source.gameStrategyId,triggerRoundId:winRound.id,resultRoundId:winRound.id,result:'WIN',metadata:{multiplier:3.42},createdAt:winRound.occurredAt});await manager.routeRoundToTerminals(winRound);
    expect(repository.executions.filter(item=>item.terminalId===dependent.id)).toHaveLength(1);
    expect(runtime.galeRuntime.active).toBe(false);
    runtime.sequenceAiRuntime.transitions={};
    const ignoredRound=makeRound(1.01);repository.signals.push({id:crypto.randomUUID(),terminalId:source.id,platformId:source.platformId,strategyId:source.gameStrategyId,triggerRoundId:ignoredRound.id,resultRoundId:ignoredRound.id,result:'LOSS',metadata:{multiplier:1.01},createdAt:ignoredRound.occurredAt});await manager.routeRoundToTerminals(ignoredRound);
    expect(repository.decisions.at(-1)?.action).toBe('IGNORE');
    expect(repository.executions.filter(item=>item.terminalId===dependent.id)).toHaveLength(1);
  });

  it('reavalia cada saida pela IA antes de confirmar um Gale',async()=>{
    const repository=new MemoryRepository();const source=makeTerminal('Fonte IA por saida');source.enabled=false;const dependent=makeTerminal('IA por saida');dependent.strategySourceTerminalId=source.id;
    dependent.operationCombinations=[{id:'sequence-ai-each',name:'IA em cada saida',priority:1,enabled:true,triggerType:'SEQUENCE_AI',pattern:null,sequenceAiConfig:{minWindow:2,maxWindow:2,minOccurrences:10,minConfidence:60,maxCurrentLossStreak:0,minContextAgreement:0,maxFullCycleLossRisk:100},betStrategyId:dependent.betStrategyId,lossReentryType:'IMMEDIATE',lossReentryPattern:null,lossReentryBetStrategyId:null,betPlanId:dependent.betPlanId,behavior:'RUN_ONCE'}];
    repository.betPlanConfig={stages:[{index:0,label:'BASE',legs:[{slot:1,amountCents:100,cashout:2}]},{index:1,label:'GALE 1',legs:[{slot:1,amountCents:200,cashout:2}]}]};
    repository.saveTerminal(source);repository.saveTerminal(dependent);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();const runtime=manager.getRuntime(dependent.id)!;
    runtime.sequenceAiRuntime={history:'LW',observations:100,transitions:{WL:{wins:18,losses:2},LL:{wins:2,losses:18},LW:{wins:18,losses:2}},lastPrediction:null};
    const publish=async(multiplier:number,result:GameSignal['result'])=>{const round=makeRound(multiplier);repository.signals.push({id:crypto.randomUUID(),terminalId:source.id,platformId:source.platformId,strategyId:source.gameStrategyId,triggerRoundId:round.id,resultRoundId:round.id,result,metadata:{multiplier},createdAt:round.occurredAt});await manager.routeRoundToTerminals(round);};
    await publish(1.2,'LOSS');
    await publish(1.2,'LOSS');
    expect(repository.executions.filter(item=>item.terminalId===dependent.id).map(item=>item.stageIndex)).toEqual([0]);
    expect(runtime.galeRuntime).toMatchObject({active:true,currentStage:1,entryConfirmed:false});
    await publish(3.2,'WIN');
    expect(runtime.galeRuntime).toMatchObject({active:true,currentStage:1,entryConfirmed:true});
    expect(repository.executions.filter(item=>item.terminalId===dependent.id)).toHaveLength(1);
    await publish(3.2,'WIN');
    expect(repository.executions.filter(item=>item.terminalId===dependent.id).map(item=>item.stageIndex)).toEqual([0,1]);
    expect(runtime.galeRuntime.active).toBe(false);
  });

  it('without combinations, enters BASE with the copy and advances G1 through G3 on every following physical round',async()=>{
    const repository=new MemoryRepository();const copy=makeTerminal('Cópia operacional');copy.enabled=false;
    const third=makeTerminal('Terminal 03');third.strategySourceTerminalId=copy.id;third.strategySourceMode='BET_EXECUTIONS';
    third.entryBlockPatterns=['L'];
    repository.betPlanConfig={stages:[
      {index:0,label:'BASE',legs:[{slot:1,amountCents:100,cashout:2}]},
      {index:1,label:'GALE 1',legs:[{slot:1,amountCents:200,cashout:2}]},
      {index:2,label:'GALE 2',legs:[{slot:1,amountCents:400,cashout:2}]},
      {index:3,label:'GALE 3',legs:[{slot:1,amountCents:800,cashout:2}]}
    ]};
    repository.saveTerminal(copy);repository.saveTerminal(third);const preparations:number[]=[];const manager=new TerminalManager(repository,new RoundEventBus());manager.setAssistedPreparationHandler(request=>{if(request.terminalId===third.id)preparations.push(request.stageIndex)});manager.initialize();
    const publishSourceOperation=async(multiplier:number,result:BetExecution['result'])=>{const round=makeRound(multiplier);const signal:GameSignal={id:crypto.randomUUID(),terminalId:copy.id,platformId:copy.platformId,strategyId:copy.gameStrategyId,triggerRoundId:round.id,resultRoundId:round.id,result:result==='LOSS'?'LOSS':'WIN',metadata:{multiplier},createdAt:round.occurredAt};repository.signals.push(signal);repository.executions.push({id:crypto.randomUUID(),cycleId:crypto.randomUUID(),terminalId:copy.id,gameSignalId:signal.id,stageIndex:0,stageLabel:'BASE',multiplier,stakeCents:100,returnedCents:result==='LOSS'?0:200,profitLossCents:result==='LOSS'?-100:100,bankrollBeforeCents:10_000,bankrollAfterCents:result==='LOSS'?9_900:10_100,result,createdAt:round.occurredAt});await manager.routeRoundToTerminals(round);};
    await publishSourceOperation(1.2,'LOSS');
    expect(manager.getRuntime(third.id)?.galeRuntime).toMatchObject({active:true,currentStage:1});
    await manager.routeRoundToTerminals(makeRound(1.1));
    expect(manager.getRuntime(third.id)?.galeRuntime).toMatchObject({active:true,currentStage:2});
    await manager.routeRoundToTerminals(makeRound(1.3));
    expect(manager.getRuntime(third.id)?.galeRuntime).toMatchObject({active:true,currentStage:3});
    await manager.routeRoundToTerminals(makeRound(2.5));
    expect(repository.executions.filter(item=>item.terminalId===third.id).map(item=>({stage:item.stageIndex,result:item.result}))).toEqual([{stage:0,result:'LOSS'},{stage:1,result:'LOSS'},{stage:2,result:'LOSS'},{stage:3,result:'WIN'}]);
    expect(preparations).toEqual([0,1,2,3]);
    expect(manager.getRuntime(third.id)?.galeRuntime.active).toBe(false);
    await manager.routeRoundToTerminals(makeRound(8.8));
    expect(repository.executions.filter(item=>item.terminalId===third.id)).toHaveLength(4);
  });

  it('does not arm an operational BASE when an enabled sequence AI combination returns IGNORE',async()=>{
    const repository=new MemoryRepository();const copy=makeTerminal('Cópia operacional IA');copy.enabled=false;
    const third=makeTerminal('Terminal 03 IA');third.strategySourceTerminalId=copy.id;third.strategySourceMode='BET_EXECUTIONS';
    third.operationCombinations=[{id:'sequence-ai-operational',name:'IA operacional',priority:1,enabled:true,triggerType:'SEQUENCE_AI',pattern:null,sequenceAiConfig:{minWindow:2,maxWindow:12,minOccurrences:10_000,minConfidence:60,maxCurrentLossStreak:3,minContextAgreement:60,maxFullCycleLossRisk:5},betStrategyId:third.betStrategyId,lossReentryType:'IMMEDIATE',lossReentryPattern:null,lossReentryBetStrategyId:null,betPlanId:third.betPlanId,behavior:'RUN_ONCE'}];
    repository.saveTerminal(copy);repository.saveTerminal(third);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    const round=makeRound(1.01);const signal:GameSignal={id:crypto.randomUUID(),terminalId:copy.id,platformId:copy.platformId,strategyId:copy.gameStrategyId,triggerRoundId:round.id,resultRoundId:round.id,result:'LOSS',metadata:{multiplier:1.01},createdAt:round.occurredAt};repository.signals.push(signal);repository.executions.push({id:crypto.randomUUID(),cycleId:crypto.randomUUID(),terminalId:copy.id,gameSignalId:signal.id,stageIndex:0,stageLabel:'BASE',multiplier:1.01,stakeCents:100,returnedCents:0,profitLossCents:-100,bankrollBeforeCents:10_000,bankrollAfterCents:9_900,result:'LOSS',createdAt:round.occurredAt});
    await manager.routeRoundToTerminals(round);
    expect(repository.decisions.filter(item=>item.terminalId===third.id).at(-1)?.action).toBe('IGNORE');
    expect(repository.executions.filter(item=>item.terminalId===third.id)).toHaveLength(0);
    expect(manager.getRuntime(third.id)?.galeRuntime.active).toBe(false);
  });

  it('blocks a new operational BASE when recent history ends with a prohibited W/L sequence',async()=>{
    const repository=new MemoryRepository();const copy=makeTerminal('Cópia com bloqueio');copy.enabled=false;const third=makeTerminal('Terminal bloqueado em LWL');third.strategySourceTerminalId=copy.id;third.strategySourceMode='BET_EXECUTIONS';third.entryBlockPatterns=['LWL'];
    repository.saveTerminal(copy);repository.saveTerminal(third);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();manager.getRuntime(third.id)!.resultAnalyzerState.recentPattern='WWWLWL';
    const round=makeRound(2.5);const signal:GameSignal={id:crypto.randomUUID(),terminalId:copy.id,platformId:copy.platformId,strategyId:copy.gameStrategyId,triggerRoundId:round.id,resultRoundId:round.id,result:'WIN',metadata:{multiplier:2.5},createdAt:round.occurredAt};repository.signals.push(signal);repository.executions.push({id:crypto.randomUUID(),cycleId:crypto.randomUUID(),terminalId:copy.id,gameSignalId:signal.id,stageIndex:0,stageLabel:'BASE',multiplier:2.5,stakeCents:100,returnedCents:200,profitLossCents:100,bankrollBeforeCents:10_000,bankrollAfterCents:10_100,result:'WIN',createdAt:round.occurredAt});
    await manager.routeRoundToTerminals(round);
    expect(repository.executions.filter(item=>item.terminalId===third.id)).toHaveLength(0);
    expect(manager.getRuntime(third.id)?.galeRuntime.active).toBe(false);
  });

  it('prepares BASE before an imminent copy operation',async()=>{
    const repository=new MemoryRepository();const root=makeTerminal('Terminal 01');root.enabled=false;const copy=makeTerminal('Cópia');copy.enabled=false;copy.strategySourceTerminalId=root.id;const third=makeTerminal('Terminal 03 físico');third.strategySourceTerminalId=copy.id;third.strategySourceMode='BET_EXECUTIONS';third.mode='ASSISTED';
    repository.saveTerminal(root);repository.saveTerminal(copy);repository.saveTerminal(third);const preparations:Array<{terminalId:string;stageIndex:number}>=[];const manager=new TerminalManager(repository,new RoundEventBus());manager.setAssistedPreparationHandler(request=>{preparations.push({terminalId:request.terminalId,stageIndex:request.stageIndex});});manager.initialize();
    const rootRuntime=manager.getRuntime(root.id)!;rootRuntime.gameStrategyRuntime.lastAnnotationRole='TRIGGER';
    const copyRuntime=manager.getRuntime(copy.id)!;copyRuntime.galeRuntime.active=true;copyRuntime.galeRuntime.cycleId=crypto.randomUUID();copyRuntime.galeRuntime.activeBetPlanId=copy.betPlanId;
    await manager.routeRoundToTerminals(makeRound(3.2));
    expect(preparations).toEqual([{terminalId:third.id,stageIndex:0}]);
  });

  it('replays all supplied historical rounds so the UI can retain the latest 500 calculated signals',()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Preload');terminal.currentBankrollCents=7_500;repository.saveTerminal(terminal);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    const sequence=[1.72,1.25,2.27,1.25,2.27,2.5];const rounds=Array.from({length:520},(_,index)=>makeRound(sequence[index%sequence.length]));
    expect(manager.rebuildTerminalFromHistory(terminal.id,rounds)).toBe(520);
    const runtime=manager.getRuntime(terminal.id)!;
    expect(runtime.gameStrategyRuntime.processedRounds).toBe(520);
    expect(runtime.gameStrategyRuntime.lastMultiplier).toBe(sequence[519%sequence.length]);
    expect(repository.signals.length).toBeGreaterThan(0);
    expect(repository.executions.length).toBeGreaterThan(0);
    expect(repository.getTerminal(terminal.id)?.currentBankrollCents).toBe(runtime.bankrollState.currentBalanceCents);
    expect(runtime.bankrollState.currentBalanceCents).not.toBe(7_500);
  });

  it('reprocesses historical rounds in chunks and reports progress without changing the result',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Preload em blocos');repository.saveTerminal(terminal);const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    const rounds=Array.from({length:220},(_,index)=>makeRound(index%2===0?1.25:2.5));const progress:number[]=[];
    expect(await manager.rebuildTerminalFromHistoryChunked(terminal.id,rounds,{chunkSize:50,onProgress:value=>progress.push(value)})).toBe(220);
    expect(manager.getRuntime(terminal.id)?.gameStrategyRuntime.processedRounds).toBe(220);
    expect(progress.at(-1)).toBe(100);
    expect(progress.length).toBeGreaterThan(2);
  });

  it('labels settled betting stages as BASE and GALE without mixing them with game signals', async () => {
    const repository = new MemoryRepository(); const terminal = makeTerminal('T1'); repository.saveTerminal(terminal);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize();
    for (const multiplier of [1.72,1.25,2.27,1.25,2.27,1.25,2.27,2.5]) await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage => `${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS', 'GALE 1:WIN']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
  });

  it('blocks an unaffordable stage without recording a zero-value LOSS or advancing the Gale',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Banca insuficiente');terminal.initialBankrollCents=50;terminal.currentBankrollCents=50;repository.saveTerminal(terminal);
    const preparations:number[]=[];const manager=new TerminalManager(repository,new RoundEventBus());manager.setAssistedPreparationHandler(request=>{preparations.push(request.stageIndex)});manager.initialize();
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,1.25,2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.executions).toHaveLength(0);expect(repository.stages).toHaveLength(0);expect(preparations).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)).toMatchObject({status:'PAUSED',pauseState:{reason:'Saldo insuficiente'},bankrollState:{currentBalanceCents:50,stopReason:'Saldo insuficiente'},galeRuntime:{active:true,currentStage:0}});
    expect(manager.resumeTerminal(terminal.id)).toBe(false);
  });

  it('waits for a new ENTER confirmation before executing the next Gale',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Gale confirmado');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'win-one',name:'Entrar após W1',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'EQ',value:1}],action:'ENTER'}]};
    repository.betPlanConfig={stages:[{index:0,label:'BASE',legs:[{slot:1,amountCents:100,cashout:2}]},{index:1,label:'GALE 1',execution:{policy:'AFTER_ENTRY_CONFIRMATION'},legs:[{slot:1,amountCents:200,cashout:2}]}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,2.5,1.72,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>stage.stageLabel)).toEqual(['BASE']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:1,entryConfirmed:false});
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(1);
    for(const multiplier of[2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(1);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.entryConfirmed).toBe(true);
    for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>stage.stageLabel)).toEqual(['BASE','GALE 1']);
  });

  it('does not use the signal that lost BASE to confirm Gale on the same processing step',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Confirmação posterior');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'enter-win',name:'Entrar com WIN',enabled:true,priority:1,conditions:[{field:'winCount',operator:'GTE',value:1}],action:'ENTER'}]};
    repository.betPlanConfig={stages:[{index:0,label:'BASE',legs:[{slot:1,amountCents:100,cashout:5}]},{index:1,label:'GALE 1',execution:{policy:'AFTER_ENTRY_CONFIRMATION'},legs:[{slot:1,amountCents:200,cashout:2}]}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,2.5,1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:1,entryConfirmed:false});
    for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(1);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.entryConfirmed).toBe(true);
    for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS','GALE 1:WIN']);
  });

  it('can close a double-bet cycle on a financial tie without advancing Gale',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Empate encerra');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'always',name:'Entrada',enabled:true,priority:1,conditions:[{field:'winCount',operator:'GTE',value:1}],action:'ENTER'}]};
    repository.betPlanConfig={continueOnTie:false,stages:[{index:0,label:'BASE',legs:[{slot:1,amountCents:100,cashout:2},{slot:2,amountCents:100,cashout:5}]},{index:1,label:'GALE 1',legs:[{slot:1,amountCents:200,cashout:2}]}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    manager.getRuntime(terminal.id)!.galeRuntime.failedCycleAttempts=2;
    for(const multiplier of[1.72,2.5,1.72,2])await manager.routeRoundToTerminals(makeRound(multiplier));
    const tiedExecution=repository.executions.at(-1)!;expect(tiedExecution).toMatchObject({stageLabel:'BASE',profitLossCents:0,result:'TIE'});
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:0});
    expect(manager.getRuntime(terminal.id)?.galeRuntime.failedCycleAttempts).toBe(0);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.cycleId).not.toBe(tiedExecution.cycleId);
  });

  it('can continue to Gale after a financial tie in a double bet',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Empate continua');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'always',name:'Entrada',enabled:true,priority:1,conditions:[{field:'winCount',operator:'GTE',value:1}],action:'ENTER'}]};
    repository.betPlanConfig={continueOnTie:true,stages:[{index:0,label:'BASE',legs:[{slot:1,amountCents:100,cashout:2},{slot:2,amountCents:100,cashout:5}]},{index:1,label:'GALE 1',legs:[{slot:1,amountCents:200,cashout:2}]}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,2.5,1.72,2])await manager.routeRoundToTerminals(makeRound(multiplier));
    const tiedExecution=repository.executions.at(-1)!;expect(tiedExecution).toMatchObject({stageLabel:'BASE',profitLossCents:0,result:'TIE'});
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:1,cycleId:tiedExecution.cycleId});
  });

  it('increases the next cycle after each configured block of failed attempts and resets on WIN',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Progressão de ciclos');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'always',name:'Sempre entrar',enabled:true,priority:1,conditions:[{field:'winCount',operator:'GTE',value:1}],action:'ENTER'}]};
    repository.betPlanConfig={cycleProgression:{attemptsPerStep:3,increasePercentage:50,maxAttempts:10},stages:[{index:0,label:'BASE 5X',legs:[{slot:1,amountCents:100,cashout:5}]}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(let index=0;index<5;index++)for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.executions.map(item=>item.stakeCents)).toEqual([100,100,100,150]);
    for(const multiplier of[1.72,5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.executions.at(-1)).toMatchObject({stakeCents:150,result:'WIN'});
    for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.executions.at(-1)?.stakeCents).toBe(100);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.failedCycleAttempts).toBe(1);
  });

  it('resets cycle progression after reaching the configured attempt limit',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Limite da progressão');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'always',name:'Sempre entrar',enabled:true,priority:1,conditions:[{field:'winCount',operator:'GTE',value:1}],action:'ENTER'}]};
    repository.betPlanConfig={cycleProgression:{attemptsPerStep:3,increasePercentage:50,maxAttempts:10},stages:[{index:0,label:'BASE 5X',legs:[{slot:1,amountCents:100,cashout:5}]}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(let index=0;index<12;index++)for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.executions.slice(0,11).map(item=>item.stakeCents)).toEqual([100,100,100,150,150,150,200,200,200,250,100]);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.failedCycleAttempts).toBe(1);
  });

  it('does not classify the release candle as WIN or settle an armed bet',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Liberação não é resultado');repository.saveTerminal(terminal);
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(true);
    await manager.routeRoundToTerminals(makeRound(2.56));
    expect(repository.executions).toHaveLength(0);
    expect(repository.signals.at(-1)?.result).toBe('LOSS');
    expect(manager.getRuntime(terminal.id)?.gameStrategyRuntime.state).toBe('WAIT_RESULT');
    await manager.routeRoundToTerminals(makeRound(2.11));
    expect(repository.executions).toHaveLength(1);
    expect(repository.executions[0]).toMatchObject({stageLabel:'BASE',multiplier:2.11,result:'WIN'});
  });

  it('analyzes the immediate round after a post-WIN bet and stops on 1.31x LOSS',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Pós-WIN imediato');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[{id:'loss-entry',name:'Entrada L2',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',value:2}],action:'ENTER',betPlanId:terminal.betPlanLossId}]});
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'continue-win',name:'Continuar até LOSS',enabled:true,priority:1,conditions:[{field:'lastClosedWinStreak',operator:'GT',value:99}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,followUp:true});
    expect(manager.getRuntime(terminal.id)?.gameStrategyRuntime.state).toBe('WAIT_RESULT');
    await manager.routeRoundToTerminals(makeRound(1.31));
    expect(repository.signals.at(-1)?.result).toBe('LOSS');
    expect(repository.stages.slice(-2).map(stage=>stage.result)).toEqual(['WIN','LOSS']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
    expect(manager.getRuntime(terminal.id)?.gameStrategyRuntime.lastAnnotationRole).toBe('LOSS');
  });

  it('stops post-WIN on an L signal even when a 1.35x leg makes financial profit',async()=>{
    const repository=new MemoryRepository();repository.betPlanCashout=1.35;const terminal=makeTerminal('LOSS com lucro financeiro');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[{id:'loss-entry',name:'Entrada L2',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',value:2}],action:'ENTER',betPlanId:terminal.betPlanLossId}]});
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'continue-win',name:'Continuar até sinal LOSS',enabled:true,priority:1,conditions:[{field:'lastClosedWinStreak',operator:'GT',value:99}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.galeRuntime.followUp).toBe(true);
    await manager.routeRoundToTerminals(makeRound(1.64));
    expect(repository.executions.at(-1)).toMatchObject({multiplier:1.64,result:'WIN'});
    expect(repository.signals.at(-1)?.result).toBe('LOSS');
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
  });

  it('prepares after W1 so W2 is the BASE for a current WIN streak greater than one',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Entrada no W2');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'win-two',name:'Entrada no segundo WIN',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'GT',value:1}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[]});
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,2.93])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:0});
    expect(manager.getRuntime(terminal.id)?.gameStrategyRuntime.state).toBe('WAIT_RESULT');
    await manager.routeRoundToTerminals(makeRound(3.16));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:WIN']);
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState.currentWinStreak).toBe(2);
  });

  it('starts the follow-up plan after a win, repeats wins and stops on the first loss', async () => {
    const repository = new MemoryRepository(); const terminal = makeTerminal('T1'); const followUpPlanId = crypto.randomUUID();
    repository.betStrategyConfig = { rules: [{ id: 'dynamic', name: 'Dinâmica', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', value: 2 }], action: 'ENTER', betPlanId: terminal.betPlanId, onWinBetPlanId: followUpPlanId, onWinPlanBehavior: 'REPEAT_UNTIL_LOSS' }] };
    repository.saveTerminal(terminal);
    const preparations: Array<{stageIndex:number;betPlanId:string}> = [];
    const manager = new TerminalManager(repository, new RoundEventBus());
    manager.setAssistedPreparationHandler(request=>{preparations.push({stageIndex:request.stageIndex,betPlanId:request.betPlanId})});
    manager.initialize();
    for (const multiplier of [1.72,1.25,2.27,1.25,2.27,2.5]) await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,activeBetPlanId:followUpPlanId,followUp:true,followUpBehavior:'REPEAT_UNTIL_LOSS'});
    await manager.routeRoundToTerminals(makeRound(2.5));
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,activeBetPlanId:followUpPlanId,followUp:true});
    await manager.routeRoundToTerminals(makeRound(1.25));
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
    expect(preparations.map(item=>item.betPlanId)).toEqual([terminal.betPlanId,followUpPlanId,followUpPlanId]);
  });

  it('uses the terminal after-WIN strategy to repeat bets until the first loss',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Continuação WIN');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[{id:'loss-entry',name:'Entrada após LOSS',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',value:2}],action:'ENTER',betPlanId:terminal.betPlanLossId}]});
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'win-repeat',name:'Seguir até LOSS',enabled:true,priority:1,conditions:[{field:'lastClosedWinStreak',operator:'GT',value:99}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    for(const multiplier of[1.72,1.25,2.27,1.25,2.5,2.5,2.5,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>stage.result)).toEqual(['WIN','WIN','WIN']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,followUp:true,followUpBehavior:'REPEAT_UNTIL_LOSS'});
    await manager.routeRoundToTerminals(makeRound(1.25));
    expect(repository.stages.map(stage=>stage.result)).toEqual(['WIN','WIN','WIN','LOSS']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:false,lastCycleWinCount:0,lastCycleLossCount:1});
  });

  it('preserves an active post-WIN BASE across an application restart',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Continuidade persistida');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[{id:'loss-entry',name:'Entrada L2',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',value:2}],action:'ENTER',betPlanId:terminal.betPlanLossId}]});
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'win-repeat',name:'Seguir ate LOSS',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'GT',value:1}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    const firstManager=new TerminalManager(repository,new RoundEventBus());firstManager.initialize();
    for(const multiplier of[1.72,2.93,3.16])await firstManager.routeRoundToTerminals(makeRound(multiplier));
    expect(firstManager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,followUp:true,currentStage:0});
    const restartedManager=new TerminalManager(repository,new RoundEventBus());restartedManager.initialize();
    await restartedManager.routeRoundToTerminals(makeRound(2.42));
    expect(repository.stages.at(-1)).toMatchObject({stageLabel:'BASE',result:'WIN'});
  });

  it('repairs legacy restart state when ENTER after WIN was persisted without its active BASE',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Continuidade recuperada');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'win-repeat',name:'Seguir ate LOSS',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'GT',value:1}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    const firstManager=new TerminalManager(repository,new RoundEventBus());firstManager.initialize();const persisted=firstManager.getRuntime(terminal.id)!;
    persisted.resultAnalyzerState={...persisted.resultAnalyzerState,currentWinStreak:5,lastClosedLossStreak:4,lastResult:'WIN',recentPattern:'LLLLWWWWW'};persisted.betStrategyRuntime.lastAction='ENTER';persisted.galeRuntime={...persisted.galeRuntime,active:false,cycleId:null,followUp:false,preparedLegAmountsCents:[]};repository.saveTerminalRuntime(persisted);
    const restartedManager=new TerminalManager(repository,new RoundEventBus());restartedManager.initialize();
    expect(restartedManager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,followUp:true,currentStage:0,triggerLossStreakTarget:4});
    await restartedManager.routeRoundToTerminals(makeRound(2.42));
    expect(repository.stages.at(-1)).toMatchObject({stageLabel:'BASE',result:'WIN'});
  });

  it('evaluates a reusable PAUSE rule against the linked terminal itself',async()=>{const repository=new MemoryRepository();const terminal=makeTerminal('Global');repository.saveTerminal(terminal);const now=new Date().toISOString();repository.controlRules=[{id:crypto.randomUUID(),name:'Proteção L2',sortOrder:10,enabled:true,metric:'currentLossStreak',operator:'GTE',value:2,action:'PAUSE',createdAt:now,updatedAt:now}];const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();for(const multiplier of[1.72,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));expect(manager.getRuntime(terminal.id)?.status).toBe('PAUSED');expect(manager.getRuntime(terminal.id)?.pauseState.reason).toContain('Proteção L2');});

  it('resumes after PAUSE when any linked PLAY rule matches',async()=>{const repository=new MemoryRepository();const terminal=makeTerminal('Múltiplas');repository.saveTerminal(terminal);const now=new Date().toISOString();repository.controlRules=[{id:crypto.randomUUID(),name:'Play W1',sortOrder:10,enabled:true,metric:'currentWinStreak',operator:'GTE',value:1,action:'PLAY',createdAt:now,updatedAt:now},{id:crypto.randomUUID(),name:'Play impossível',sortOrder:20,enabled:true,metric:'bankroll',operator:'GT',value:999999,action:'PLAY',createdAt:now,updatedAt:now},{id:crypto.randomUUID(),name:'Pause L1',sortOrder:30,enabled:true,metric:'currentLossStreak',operator:'GTE',value:1,action:'PAUSE',createdAt:now,updatedAt:now}];const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();manager.synchronizeTerminal(terminal.id);expect(manager.getRuntime(terminal.id)?.status).toBe('PAUSED');for(const multiplier of[1.72,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));expect(manager.getRuntime(terminal.id)?.status).toBe('RUNNING');for(const multiplier of[1.72,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));expect(manager.getRuntime(terminal.id)?.status).toBe('PAUSED');for(const multiplier of[2.5,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));expect(manager.getRuntime(terminal.id)?.status).toBe('RUNNING');expect(manager.getRuntime(terminal.id)?.pauseState.type).toBe('NONE');});

  it('never overrides a manual pause with PLAY rules',()=>{const repository=new MemoryRepository();const terminal=makeTerminal('Manual');repository.saveTerminal(terminal);const now=new Date().toISOString();repository.controlRules=[{id:crypto.randomUUID(),name:'Sempre play',sortOrder:10,enabled:true,metric:'bankroll',operator:'GTE',value:0,action:'PLAY',createdAt:now,updatedAt:now}];const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();manager.pauseTerminal(terminal.id);manager.synchronizeTerminal(terminal.id);expect(manager.getRuntime(terminal.id)?.status).toBe('PAUSED');expect(manager.getRuntime(terminal.id)?.pauseState.type).toBe('MANUAL');});

  it('uses only the last LOSS block between WIN signals as dynamic N',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Dinâmico N4');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'dynamic-n',name:'Último bloco LOSS',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',referenceField:'lastClosedLossStreak'}],action:'ENTER'}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    // Estado equivalente a W-L-L-L-L-W: último bloco encerrado possui N=4.
    const runtime=manager.getRuntime(terminal.id)!;runtime.resultAnalyzerState.lastClosedLossStreak=4;runtime.resultAnalyzerState.lastResult='WIN';runtime.resultAnalyzerState.recentPattern='WLLLLW';
    // L1, L2 e L3 não são aposta e ainda não completaram o alvo N=4.
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState.currentLossStreak).toBe(3);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
    // O quarto LOSS completa a condição e arma a BASE para o sinal seguinte.
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:0,triggerLossStreakTarget:4});
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS']);
  });

  it('uses the previous LOSS streak as N, places BASE after LN and keeps WIN bets until LOSS',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Entrada no terceiro LOSS');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[{id:'dynamic-three',name:'Entrada no terceiro LOSS',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',referenceField:'lastClosedLossStreak'}],action:'ENTER',betPlanId:terminal.betPlanLossId}]});
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'continue-win',name:'Continuar WIN atÃ© LOSS',enabled:true,priority:1,conditions:[{field:'lastClosedWinStreak',operator:'GT',value:99}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();

    // HistÃ³rico de referÃªncia L3, seguido do LOSS final de ciclo (L1) e L2.
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,1.25,2.27,2.5,2.27,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState).toMatchObject({currentLossStreak:2,lastClosedLossStreak:3});
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
    // N=3: o terceiro LOSS arma a BASE; o WIN seguinte liquida essa BASE.
    for(const multiplier of[2.5,1.25,2.5,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:WIN']);

    // Os WIN seguintes continuam apostados; o primeiro LOSS tambÃ©m Ã© liquidado
    // como aposta e encerra o ciclo. O bloco anterior teve 3 L entre W, então N=3.
    for(const multiplier of[2.5,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:WIN','BASE:WIN','BASE:LOSS']);
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState).toMatchObject({currentLossStreak:1,lastClosedLossStreak:3});
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);

    // O LOSS que encerrou o ciclo já vale como L1. L2 não arma; L3 arma a BASE seguinte.
    await manager.routeRoundToTerminals(makeRound(2.27));
    await manager.routeRoundToTerminals(makeRound(1.25));
    expect(repository.stages).toHaveLength(3);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:0,triggerLossStreakTarget:3});
    for(const multiplier of[2.27,1.25,2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.slice(-2).map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS','GALE 1:WIN']);
  });

  it('adapts N when the previous closed LOSS streak has a different size',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Alvo dinÃ¢mico N2');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'dynamic-n',name:'Usar tamanho anterior',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',referenceField:'lastClosedLossStreak'}],action:'ENTER'}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    // A sequÃªncia anterior fecha com dois LOSS; logo o alvo seguinte passa a N=2.
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,2.5,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState).toMatchObject({currentLossStreak:1,lastClosedLossStreak:2});
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,triggerLossStreakTarget:2});
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS']);
  });
  it('places BASE after WIN and waits the remaining dynamic LOSS count before GALE 1',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('BASE no primeiro L, Gale após N');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'after-win',name:'Entrada após W',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'EQ',value:1}],action:'ENTER',onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[{id:'dynamic-four',name:'Confirmar Gale no quarto L',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',referenceField:'lastClosedLossStreak'}],action:'ENTER'}]});
    const preparations:number[]=[];const manager=new TerminalManager(repository,new RoundEventBus());manager.setAssistedPreparationHandler(request=>{preparations.push(request.stageIndex)});manager.initialize();
    const runtime=manager.getRuntime(terminal.id)!;runtime.resultAnalyzerState={...runtime.resultAnalyzerState,currentLossStreak:4,currentWinStreak:0,lastClosedLossStreak:4,lastResult:'LOSS',recentPattern:'LLLL'};
    for(const multiplier of[2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(preparations).toEqual([0]);
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({currentStage:1,entryConfirmed:false,awaitingDynamicFirstGale:true,triggerLossStreakTarget:4,preparedLegAmountsCents:[]});
    for(const multiplier of[2.27,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(preparations).toEqual([0]);
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(preparations).toEqual([0,1]);
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS']);
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS','GALE 1:LOSS']);
    expect(preparations).toEqual([0,1,2]);
  });
  it('finishes the live mouse preparation before publishing the armed entry',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Preparo prioritário');repository.saveTerminal(terminal);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let started=false;let finished=false;
    const manager=new TerminalManager(repository,new RoundEventBus());manager.setAssistedPreparationHandler(async()=>{started=true;await gate;finished=true});manager.initialize();
    for(const multiplier of[1.72,1.25,2.27])await manager.routeRoundToTerminals(makeRound(multiplier));
    let published=false;const publication=manager.routeRoundToTerminals(makeRound(1.25)).then(result=>{published=true;return result});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(started).toBe(true);expect(finished).toBe(false);expect(published).toBe(false);
    release();expect(await publication).toBe(1);expect(finished).toBe(true);expect(published).toBe(true);
  });
});
