import { describe, expect, it } from 'vitest';
import type { BetDecision, BetExecution, BetStageEvent, BetStrategyConfig, GameSignal, GameStrategyConfig, NormalizedRound, RoundAnnotation, Terminal, TerminalControlRule, TerminalRuntime } from '@aviator/shared';
import { RoundEventBus } from '@aviator/collector';
import { createTerminal, TerminalManager, type TerminalRuntimeRepository } from '../src/index.js';

class MemoryRepository implements TerminalRuntimeRepository {
  terminals = new Map<string, Terminal>(); runtimes = new Map<string, TerminalRuntime>(); receipts = new Set<string>();
  annotations: RoundAnnotation[] = []; signals: GameSignal[] = []; decisions: BetDecision[] = []; stages: BetStageEvent[] = []; executions: BetExecution[] = [];
  betStrategyConfig = betStrategyConfig;
  betStrategyConfigs=new Map<string,BetStrategyConfig>();
  betPlanStageCount=3;
  betPlanCashout=2;
  controlRules:TerminalControlRule[]=[];
  listTerminals() { return [...this.terminals.values()]; }
  getTerminal(id: string) { return this.terminals.get(id) ?? null; }
  saveTerminal(terminal: Terminal) { this.terminals.set(terminal.id, structuredClone(terminal)); }
  updateTerminal(terminal: Terminal) { this.terminals.set(terminal.id, structuredClone(terminal)); }
  deleteTerminal(id: string) { this.terminals.delete(id); this.runtimes.delete(id); }
  resetTerminal(id:string,clearHistory=false){const terminal=this.terminals.get(id);if(terminal){terminal.currentBankrollCents=terminal.initialBankrollCents;if(clearHistory){terminal.gameWins=0;terminal.gameLosses=0;}}if(clearHistory){this.runtimes.delete(id);this.annotations=this.annotations.filter(item=>item.terminalId!==id);this.signals=this.signals.filter(item=>item.terminalId!==id);this.decisions=this.decisions.filter(item=>item.terminalId!==id);this.stages=this.stages.filter(item=>item.terminalId!==id);this.executions=this.executions.filter(item=>item.terminalId!==id);}}
  updateTerminalInitialBankroll(id:string,value:number){const terminal=this.terminals.get(id);if(terminal){terminal.initialBankrollCents=value;terminal.currentBankrollCents=value;}}
  setTerminalPaused(id: string, paused: boolean) { const terminal = this.terminals.get(id); if (terminal) terminal.paused = paused; }
  getTerminalRuntime(id: string) { const runtime = this.runtimes.get(id); return runtime ? structuredClone(runtime) : null; }
  saveTerminalRuntime(runtime: TerminalRuntime) { this.runtimes.set(runtime.terminalId, structuredClone(runtime)); }
  recordRoundReceipt(terminalId: string, round: NormalizedRound) { const key = `${terminalId}:${round.id}`; if (this.receipts.has(key)) return false; this.receipts.add(key); return true; }
  getGameStrategyConfig() { return strategyConfig; }
  saveRoundAnnotation(annotation: RoundAnnotation) { this.annotations.push(annotation); }
  saveGameSignal(signal: GameSignal) { this.signals.push(signal); }
  getBetStrategyConfig(id:string) { return this.betStrategyConfigs.get(id)??this.betStrategyConfig; }
  saveBetDecision(decision: BetDecision) { this.decisions.push(decision); }
  updateTerminalGameStats(id: string, wins: number, losses: number) { const terminal = this.terminals.get(id); if (terminal) { terminal.gameWins = wins; terminal.gameLosses = losses; } }
  getBetPlanConfig() { return { stages: Array.from({ length: this.betPlanStageCount }, (_, index) => ({ index, label: index === 0 ? 'BASE' : `GALE ${index}`, legs: [{ slot: 1, amountCents: 100 * 2 ** index, cashout: this.betPlanCashout }] })) }; }
  getTerminalSchedule() { return null; }
  listTerminalControlRules() { return this.controlRules; }
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

  it('updates configuration and moves the live subscription to the selected platform', async () => {
    const repository = new MemoryRepository(); const terminal = makeTerminal('T1'); repository.saveTerminal(terminal);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize();
    const nextPlatformId = crypto.randomUUID();
    const updated = manager.updateTerminal(terminal.id, { name: 'T1 editado', platformId: nextPlatformId, gameStrategyId: terminal.gameStrategyId, betStrategyId: terminal.betStrategyId, betPlanId: terminal.betPlanId, mode: 'ASSISTED' });
    expect(updated?.name).toBe('T1 editado'); expect(updated?.mode).toBe('ASSISTED');
    expect(await manager.routeRoundToTerminals(makeRound(1.72))).toBe(0);
    expect(await manager.routeRoundToTerminals(makeRound(1.72, nextPlatformId))).toBe(1);
  });

  it('labels settled betting stages as BASE and GALE without mixing them with game signals', async () => {
    const repository = new MemoryRepository(); const terminal = makeTerminal('T1'); repository.saveTerminal(terminal);
    const manager = new TerminalManager(repository, new RoundEventBus()); manager.initialize();
    for (const multiplier of [1.72,1.25,2.27,1.25,2.27,1.25,2.27,2.5]) await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage => `${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS', 'GALE 1:WIN']);
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);
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

  it('pauses and resumes a target terminal from another terminal rule with an explicit reason',async()=>{
    const repository=new MemoryRepository();const source=makeTerminal('Origem');const target=makeTerminal('Alvo');repository.saveTerminal(source);repository.saveTerminal(target);const now=new Date().toISOString();
    repository.controlRules=[{id:crypto.randomUUID(),name:'Proteção por perdas',sortOrder:10,enabled:true,sourceTerminalId:source.id,targetTerminalId:target.id,metric:'currentLossStreak',operator:'GTE',value:2,action:'PAUSE',createdAt:now,updatedAt:now}];
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();for(const multiplier of[1.72,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(target.id)?.status).toBe('PAUSED');expect(manager.getRuntime(target.id)?.pauseState.reason).toContain('Proteção por perdas');
    repository.controlRules=[{...repository.controlRules[0],id:crypto.randomUUID(),name:'Retomar após ganho',metric:'currentWinStreak',operator:'GTE',value:1,action:'RESUME'}];
    for(const multiplier of[2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));expect(manager.getRuntime(target.id)?.status).toBe('RUNNING');expect(manager.getRuntime(target.id)?.pauseState.type).toBe('NONE');
  });

  it('pauses a target using the LOSS count from the last closed betting cycle',async()=>{
    const repository=new MemoryRepository();const source=makeTerminal('Ciclo observado');const target=makeTerminal('Alvo do ciclo');repository.saveTerminal(source);repository.saveTerminal(target);const now=new Date().toISOString();
    repository.controlRules=[{id:crypto.randomUUID(),name:'Pausar após ciclo com 2 LOSS',sortOrder:10,enabled:true,sourceTerminalId:source.id,targetTerminalId:target.id,metric:'lastCycleLossCount',operator:'GTE',value:2,action:'PAUSE',createdAt:now,updatedAt:now}];
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();const sourceRuntime=manager.getRuntime(source.id)!;sourceRuntime.galeRuntime.lastCycleLossCount=2;
    await manager.routeRoundToTerminals(makeRound(2.5));await manager.routeRoundToTerminals(makeRound(2.5));
    expect(manager.getRuntime(target.id)?.status).toBe('PAUSED');expect(manager.getRuntime(target.id)?.pauseState.reason).toContain('LOSS no último ciclo de aposta');
  });

  it('keeps pause and resume conditions in the same control rule',async()=>{
    const repository=new MemoryRepository();const source=makeTerminal('Origem');const target=makeTerminal('Alvo');repository.saveTerminal(source);repository.saveTerminal(target);const now=new Date().toISOString();
    repository.controlRules=[{id:crypto.randomUUID(),name:'Pausa com retomada automática',sortOrder:10,enabled:true,sourceTerminalId:source.id,targetTerminalId:target.id,metric:'currentLossStreak',operator:'GTE',value:2,referenceMetric:null,action:'PAUSE',resumeMetric:'currentWinStreak',resumeOperator:'GTE',resumeValue:1,resumeReferenceMetric:null,createdAt:now,updatedAt:now}];
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();for(const multiplier of[1.72,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(target.id)?.status).toBe('PAUSED');
    for(const multiplier of[2.27,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(target.id)?.status).toBe('RUNNING');expect(manager.getRuntime(target.id)?.pauseState.type).toBe('NONE');
  });

  it('uses only the last LOSS block between WIN signals as dynamic N',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Dinâmico N4');repository.saveTerminal(terminal);
    repository.betStrategyConfig={rules:[{id:'dynamic-n',name:'Último bloco LOSS',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',referenceField:'lastClosedLossStreak'}],action:'ENTER'}]};
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();
    // Estado equivalente a W-L-L-L-L-W: último bloco encerrado possui N=4.
    const runtime=manager.getRuntime(terminal.id)!;runtime.resultAnalyzerState.lastClosedLossStreak=4;runtime.resultAnalyzerState.lastResult='WIN';runtime.resultAnalyzerState.recentPattern='WLLLLW';
    // L1, L2 e L3 não são aposta; ao fim de L3 a BASE fica armada para L4.
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState.currentLossStreak).toBe(3);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:0,triggerLossStreakTarget:4});
    // O quarto LOSS é a própria BASE, não apenas o preparador da rodada seguinte.
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS']);
  });

  it('uses the previous LOSS streak as N, places BASE on LN and keeps WIN bets until LOSS',async()=>{
    const repository=new MemoryRepository();const terminal=makeTerminal('Entrada no terceiro LOSS');terminal.betStrategyWinId=crypto.randomUUID();terminal.betStrategyLossId=crypto.randomUUID();repository.saveTerminal(terminal);
    repository.betStrategyConfigs.set(terminal.betStrategyLossId,{rules:[{id:'dynamic-three',name:'Entrada no terceiro LOSS',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'EQ',referenceField:'lastClosedLossStreak'}],action:'ENTER',betPlanId:terminal.betPlanLossId}]});
    repository.betStrategyConfigs.set(terminal.betStrategyWinId,{rules:[{id:'continue-win',name:'Continuar WIN atÃ© LOSS',enabled:true,priority:1,conditions:[{field:'lastClosedWinStreak',operator:'GT',value:99}],action:'ENTER',betPlanId:terminal.betPlanWinId,onWinBetPlanId:terminal.betPlanWinId,onWinPlanBehavior:'REPEAT_UNTIL_LOSS'}]});
    const manager=new TerminalManager(repository,new RoundEventBus());manager.initialize();

    // HistÃ³rico de referÃªncia L3, seguido do LOSS final de ciclo (L1) e L2.
    for(const multiplier of[1.72,1.25,2.27,1.25,2.27,1.25,2.27,2.5,2.27,1.25,2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState).toMatchObject({currentLossStreak:2,lastClosedLossStreak:3});
    expect(repository.stages).toHaveLength(0);
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,currentStage:0,triggerLossStreakTarget:3});
    // N=3: depois de L1 e L2, o terceiro LOSS é BASE; o WIN seguinte é G1.
    for(const multiplier of[2.5,1.25,2.5,2.5])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS','GALE 1:WIN']);

    // Os WIN seguintes continuam apostados; o primeiro LOSS tambÃ©m Ã© liquidado
    // como aposta e encerra o ciclo. O bloco anterior teve 3 L entre W, então N=3.
    for(const multiplier of[2.5,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS','GALE 1:WIN','BASE:WIN','BASE:LOSS']);
    expect(manager.getRuntime(terminal.id)?.resultAnalyzerState).toMatchObject({currentLossStreak:1,lastClosedLossStreak:3});
    expect(manager.getRuntime(terminal.id)?.galeRuntime.active).toBe(false);

    // O LOSS que encerrou o ciclo já vale como L1. L2 não é aposta e arma L3.
    await manager.routeRoundToTerminals(makeRound(2.27));
    await manager.routeRoundToTerminals(makeRound(1.25));
    expect(repository.stages).toHaveLength(4);
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
    expect(manager.getRuntime(terminal.id)?.galeRuntime).toMatchObject({active:true,triggerLossStreakTarget:2});
    for(const multiplier of[2.27,1.25])await manager.routeRoundToTerminals(makeRound(multiplier));
    expect(repository.stages.map(stage=>`${stage.stageLabel}:${stage.result}`)).toEqual(['BASE:LOSS']);
  });
});
