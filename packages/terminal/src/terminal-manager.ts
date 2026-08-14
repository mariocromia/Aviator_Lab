import { randomUUID } from 'node:crypto';
import type { BetDecision, BetExecution, BetPlanConfig, BetStageEvent, BetStrategyConfig, GameSignal, GameStrategyConfig, NormalizedRound, RoundAnnotation, RoundEvent, Terminal, TerminalControlRule, TerminalMode, TerminalRuntime, TerminalSchedule } from '@aviator/shared';
import type { RoundEventBus } from '@aviator/collector';
import { GameStrategyEngine } from '@aviator/game-strategy';
import { ResultAnalyzer, createResultAnalyzerState } from '@aviator/result-analyzer';
import { BetStrategyEngine, bankrollStopReason, calculateBetAmount, createBankrollMetrics, updateBankrollMetrics } from '@aviator/bet-strategy';
import { createTerminal, duplicateTerminal, type TerminalDraft } from './terminal-factory.js';
import { evaluateTerminalSchedule } from './terminal-schedule.js';
import { createSequenceAiRuntime, normalizeSequenceAiRuntime, observeSequenceResult, predictSequence } from './sequence-pattern-intelligence.js';

export interface TerminalRuntimeRepository {
  listTerminals(): Terminal[];
  getTerminal(id: string): Terminal | null;
  saveTerminal(terminal: Terminal): void;
  updateTerminal(terminal: Terminal): void;
  deleteTerminal(id: string): void;
  resetTerminal(id:string,clearHistory:boolean):void;
  clearTerminalCalculatedHistory(id:string):void;
  beginTerminalReplay?(id:string):void;
  endTerminalReplay?(id:string):void;
  updateTerminalInitialBankroll(id:string,initialBankrollCents:number):void;
  setTerminalPaused(id: string, paused: boolean): void;
  getTerminalRuntime(id: string): TerminalRuntime | null;
  saveTerminalRuntime(runtime: TerminalRuntime): void;
  recordRoundReceipt(terminalId: string, round: NormalizedRound): boolean;
  getGameStrategyConfig(id: string): GameStrategyConfig | null;
  saveRoundAnnotation(annotation: RoundAnnotation): void;
  saveGameSignal(signal: GameSignal): void;
  getTerminalGameSignalByRound(terminalId:string,roundId:string):GameSignal|null;
  getTerminalBetExecutionByRound(terminalId:string,roundId:string):BetExecution|null;
  getBetStrategyConfig(id: string): BetStrategyConfig | null;
  saveBetDecision(decision: BetDecision): void;
  updateTerminalGameStats(id: string, wins: number, losses: number): void;
  getBetPlanConfig(id: string): BetPlanConfig | null;
  getTerminalSchedule(id: string): TerminalSchedule | null;
  listTerminalControlRules():TerminalControlRule[];
  getTerminalControlRules(terminalId:string):TerminalControlRule[];
  saveBetStageEvent(event: BetStageEvent): void;
  saveBetExecution(execution: BetExecution): void;
  updateTerminalBankroll(id: string, balanceCents: number): void;
}

export interface TerminalConfigurationUpdate {
  name: string;
  sortOrder?: number;
  platformId: string;
  gameStrategyId: string;
  strategySourceTerminalId?:string|null;
  strategySourceMode?:Terminal['strategySourceMode'];
  betStrategyId: string;
  betStrategyWinId?: string;
  betStrategyLossId?: string;
  betPlanId: string;
  betPlanWinId?: string;
  betPlanLossId?: string;
  controlPlayRuleIds?:string[];
  controlPauseRuleIds?:string[];
  historyDisplayLimit?:number;
  entryBlockPatterns?:string[];
  operationCombinations?:Terminal['operationCombinations'];
  mode: TerminalMode;
}

export class TerminalManager {
  private readonly gameStrategyEngine = new GameStrategyEngine();
  private readonly resultAnalyzer = new ResultAnalyzer();
  private readonly betStrategyEngine = new BetStrategyEngine();
  private readonly runtimes = new Map<string, TerminalRuntime>();
  private readonly unsubscribeByTerminal = new Map<string, () => void>();
  private assistedPreparationHandler: ((request: {terminalId:string;deliveryMode:NormalizedRound['deliveryMode'];stageIndex:number;betPlanId:string;amountsCents:number[]}) => void | Promise<void>) | null = null;

  constructor(private readonly repository: TerminalRuntimeRepository, private readonly eventBus: RoundEventBus) {}

  initialize() {
    const terminals=this.repository.listTerminals();
    for(const terminal of terminals)this.initializeTerminal(terminal);
    for(const terminal of terminals)this.evaluateControlRules(terminal.id);
  }

  createTerminal(draft: TerminalDraft): Terminal {
    this.validateStrategySource(null,draft.platformId,draft.strategySourceTerminalId??null);
    const now = new Date().toISOString(); const terminal = createTerminal(draft, randomUUID(), now);
    this.repository.saveTerminal(terminal); this.initializeTerminal(terminal); this.evaluateControlRules(terminal.id); return terminal;
  }

  duplicateTerminal(id: string): Terminal | null {
    const source = this.repository.getTerminal(id); if (!source) return null;
    const terminal = duplicateTerminal(source, randomUUID(), new Date().toISOString());
    this.repository.saveTerminal(terminal); this.initializeTerminal(terminal); this.evaluateControlRules(terminal.id); return terminal;
  }

  updateTerminal(id: string, update: TerminalConfigurationUpdate): Terminal | null {
    const terminal = this.repository.getTerminal(id); if (!terminal) return null;
    this.validateStrategySource(id,update.platformId,update.strategySourceTerminalId??null);
    const platformChanged = terminal.platformId !== update.platformId;
    const sourceChanged=terminal.strategySourceTerminalId!==(update.strategySourceTerminalId??null)||terminal.strategySourceMode!==(update.strategySourceMode??'GAME_SIGNALS');
    const strategyChanged = terminal.gameStrategyId !== update.gameStrategyId;
    const normalizedUpdate={...update,controlPlayRuleIds:update.controlPlayRuleIds??terminal.controlPlayRuleIds,controlPauseRuleIds:update.controlPauseRuleIds??terminal.controlPauseRuleIds};
    Object.assign(terminal, normalizedUpdate, { updatedAt: new Date().toISOString() });
    this.repository.updateTerminal(terminal);
    const runtime = this.runtimes.get(id);
    if (runtime && strategyChanged) {
      runtime.gameStrategyRuntime.state = 'SEARCH_TRIGGER';
      runtime.gameStrategyRuntime.triggerRoundId = null;
      runtime.gameStrategyRuntime.releaseProgress = 0;
      runtime.updatedAt = new Date().toISOString();
      this.repository.saveTerminalRuntime(runtime);
    }
    if(platformChanged||sourceChanged)this.refreshSubscriptions();
    this.evaluateControlRules(id);
    return terminal;
  }

  deleteTerminal(id: string) { this.unsubscribeByTerminal.get(id)?.(); this.unsubscribeByTerminal.delete(id); this.runtimes.delete(id); this.repository.deleteTerminal(id); }
  resetTerminal(id:string,clearHistory=false){const terminal=this.repository.getTerminal(id);const runtime=this.runtimes.get(id);if(!terminal)return;this.repository.resetTerminal(id,clearHistory);const refreshed=this.repository.getTerminal(id);if(!refreshed)return;if(clearHistory){this.unsubscribeByTerminal.get(id)?.();this.unsubscribeByTerminal.delete(id);const clean=createRuntime(refreshed);this.runtimes.set(id,clean);this.repository.saveTerminalRuntime(clean);if(clean.status==='RUNNING')this.attach(refreshed);return;}if(!runtime)return;runtime.bankrollState=createBankrollMetrics(refreshed.initialBankrollCents);runtime.galeRuntime.previousAmountCents=0;runtime.galeRuntime.accumulatedLossCents=0;runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);}
  updateTerminalInitialBankroll(id:string,initialBankrollCents:number){const terminal=this.repository.getTerminal(id);if(!terminal)return;this.repository.updateTerminalInitialBankroll(id,initialBankrollCents);terminal.initialBankrollCents=initialBankrollCents;terminal.currentBankrollCents=initialBankrollCents;const runtime=this.runtimes.get(id);if(runtime){runtime.bankrollState=createBankrollMetrics(initialBankrollCents);runtime.galeRuntime.previousAmountCents=0;runtime.galeRuntime.accumulatedLossCents=0;runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);}}
  pauseTerminal(id: string) { const runtime=this.runtimes.get(id);if(runtime)runtime.pauseState={type:'MANUAL',reason:'Pausa manual',ruleId:null,sourceTerminalId:null};this.repository.setTerminalPaused(id, true); this.stopRuntime(id, 'PAUSED'); }
  resumeTerminal(id: string) { const runtime=this.runtimes.get(id);if(runtime)runtime.pauseState={type:'NONE',reason:null,ruleId:null,sourceTerminalId:null};this.repository.setTerminalPaused(id, false); this.startRuntime(id); this.evaluateControlRules(id); }

  async routeRoundToTerminals(round: NormalizedRound): Promise<number> {
    return this.eventBus.publish({ id: `${round.platformId}:${round.id}`, platformId: round.platformId, round, publishedAt: new Date().toISOString() });
  }

  getRuntime(id: string): TerminalRuntime | null { return this.runtimes.get(id) ?? null; }
  getRuntimes(): TerminalRuntime[] { return [...this.runtimes.values()]; }
  synchronizeTerminal(id:string):boolean{
    const terminal=this.repository.getTerminal(id);const runtime=this.runtimes.get(id);if(!terminal||!runtime)return false;
    if(runtime.galeRuntime.active){
      const planId=runtime.galeRuntime.activeBetPlanId??terminal.betPlanId;
      runtime.galeRuntime.preparedLegAmountsCents=resolveStageAmounts(runtime,this.repository.getBetPlanConfig(planId),runtime.galeRuntime.currentStage);
      runtime.gameStrategyRuntime.state='WAIT_RESULT';
    }else{
      runtime.gameStrategyRuntime.state='SEARCH_TRIGGER';
      runtime.gameStrategyRuntime.triggerRoundId=null;
      runtime.gameStrategyRuntime.releaseProgress=0;
    }
    runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);
    this.unsubscribeByTerminal.get(id)?.();this.unsubscribeByTerminal.delete(id);
    if(runtime.status==='RUNNING'||this.isControlRulePause(runtime))this.attach(terminal);
    this.evaluateControlRules(id);
    return true;
  }
  rebuildTerminalFromHistory(id:string,rounds:NormalizedRound[]):number{
    const terminal=this.repository.getTerminal(id);if(!terminal)return 0;
    this.unsubscribeByTerminal.get(id)?.();this.unsubscribeByTerminal.delete(id);
    this.repository.clearTerminalCalculatedHistory(id);
    this.repository.updateTerminalBankroll(id,terminal.initialBankrollCents);
    const runtime=createRuntime(terminal);
    runtime.status='RUNNING';runtime.pauseState={type:'NONE',reason:null,ruleId:null,sourceTerminalId:null};
    runtime.bankrollState=createBankrollMetrics(terminal.initialBankrollCents);this.runtimes.set(id,runtime);this.repository.saveTerminalRuntime(runtime);
    let processed=0;
    for(const sourceRound of rounds){
      const round={...sourceRound,platformId:terminal.platformId,deliveryMode:'BACKLOG' as const};
      const before=runtime.gameStrategyRuntime.processedRounds;
      this.processRound(id,{id:`preload:${id}:${round.id}`,platformId:terminal.platformId,round,publishedAt:new Date().toISOString()});
      if(runtime.gameStrategyRuntime.processedRounds>before)processed++;
    }
    if(!terminal.enabled)runtime.status='STOPPED';
    else if(terminal.paused){runtime.status='PAUSED';runtime.pauseState={type:'MANUAL',reason:'Pausa manual',ruleId:null,sourceTerminalId:null};}
    runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);
    this.repository.updateTerminalGameStats(id,runtime.resultAnalyzerState.winCount,runtime.resultAnalyzerState.lossCount);
    if(runtime.status==='RUNNING')this.attach(terminal);
    return processed;
  }
  async rebuildTerminalFromHistoryChunked(id:string,rounds:NormalizedRound[],options?:{chunkSize?:number;onProgress?:(progress:number)=>void;catchUpRounds?:()=>NormalizedRound[]}):Promise<number>{
    const terminal=this.repository.getTerminal(id);if(!terminal)return 0;
    this.unsubscribeByTerminal.get(id)?.();this.unsubscribeByTerminal.delete(id);
    this.repository.beginTerminalReplay?.(id);
    try{
    this.repository.clearTerminalCalculatedHistory(id);
    this.repository.updateTerminalBankroll(id,terminal.initialBankrollCents);
    const runtime=createRuntime(terminal);
    runtime.status='RUNNING';runtime.pauseState={type:'NONE',reason:null,ruleId:null,sourceTerminalId:null};
    runtime.bankrollState=createBankrollMetrics(terminal.initialBankrollCents);this.runtimes.set(id,runtime);this.repository.saveTerminalRuntime(runtime);
    const chunkSize=Math.max(25,options?.chunkSize??100);let processed=0;let cursor=0;
    const processBatch=(batch:NormalizedRound[])=>{for(const sourceRound of batch){
      const round={...sourceRound,platformId:terminal.platformId,deliveryMode:'BACKLOG' as const};
      const before=runtime.gameStrategyRuntime.processedRounds;
      this.processRound(id,{id:`preload:${id}:${round.id}`,platformId:terminal.platformId,round,publishedAt:new Date().toISOString()});
      if(runtime.gameStrategyRuntime.processedRounds>before)processed++;
    }};
    while(cursor<rounds.length){const end=Math.min(rounds.length,cursor+chunkSize);processBatch(rounds.slice(cursor,end));cursor=end;options?.onProgress?.(rounds.length?Math.round(cursor/rounds.length*95):95);await new Promise<void>(resolve=>setImmediate(resolve));}
    const known=new Set(rounds.map(round=>round.id));
    const catchUp=(options?.catchUpRounds?.()??[]).filter(round=>!known.has(round.id));
    for(let index=0;index<catchUp.length;index+=chunkSize){processBatch(catchUp.slice(index,index+chunkSize));await new Promise<void>(resolve=>setImmediate(resolve));}
    if(!terminal.enabled)runtime.status='STOPPED';
    else if(terminal.paused){runtime.status='PAUSED';runtime.pauseState={type:'MANUAL',reason:'Pausa manual',ruleId:null,sourceTerminalId:null};}
    runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);
    this.repository.updateTerminalGameStats(id,runtime.resultAnalyzerState.winCount,runtime.resultAnalyzerState.lossCount);
    if(runtime.status==='RUNNING')this.attach(terminal);
    options?.onProgress?.(100);return processed;
    }finally{this.repository.endTerminalReplay?.(id);}
  }

  async refreshTerminalFromHistoryChunked(id:string,rounds:NormalizedRound[],options?:{chunkSize?:number;onProgress?:(progress:number)=>void;catchUpRounds?:()=>NormalizedRound[]}):Promise<number>{
    const terminal=this.repository.getTerminal(id);const runtime=this.runtimes.get(id);if(!terminal||!runtime)return 0;
    this.unsubscribeByTerminal.get(id)?.();this.unsubscribeByTerminal.delete(id);
    const originalStatus=runtime.status;const originalPauseState=runtime.pauseState;runtime.status='RUNNING';runtime.pauseState={type:'NONE',reason:null,ruleId:null,sourceTerminalId:null};
    this.repository.beginTerminalReplay?.(id);
    try{
      const chunkSize=Math.max(25,options?.chunkSize??100);let processed=0;
      const processBatch=(batch:NormalizedRound[])=>{for(const sourceRound of batch){const round={...sourceRound,platformId:terminal.platformId,deliveryMode:'BACKLOG' as const};const before=runtime.gameStrategyRuntime.processedRounds;this.processRound(id,{id:`refresh:${id}:${round.id}`,platformId:terminal.platformId,round,publishedAt:new Date().toISOString()});if(runtime.gameStrategyRuntime.processedRounds>before)processed++;}};
      for(let cursor=0;cursor<rounds.length;cursor+=chunkSize){processBatch(rounds.slice(cursor,cursor+chunkSize));options?.onProgress?.(rounds.length?Math.round(Math.min(rounds.length,cursor+chunkSize)/rounds.length*95):95);await new Promise<void>(resolve=>setImmediate(resolve));}
      const known=new Set(rounds.map(round=>round.id));const catchUp=(options?.catchUpRounds?.()??[]).filter(round=>!known.has(round.id));for(let index=0;index<catchUp.length;index+=chunkSize){processBatch(catchUp.slice(index,index+chunkSize));await new Promise<void>(resolve=>setImmediate(resolve));}
      if(originalStatus!=='RUNNING'){runtime.status=originalStatus;runtime.pauseState=originalPauseState;}runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);if(runtime.status==='RUNNING'||this.isControlRulePause(runtime))this.attach(terminal);options?.onProgress?.(100);return processed;
    }finally{this.repository.endTerminalReplay?.(id);}
  }
  setAssistedPreparationHandler(handler: (request: {terminalId:string;deliveryMode:NormalizedRound['deliveryMode'];stageIndex:number;betPlanId:string;amountsCents:number[]}) => void | Promise<void>) { this.assistedPreparationHandler = handler; }
  setScreenControllerState(id: string, status: TerminalRuntime['screenControllerState']['status']) {
    const runtime = this.runtimes.get(id); if (!runtime) return;
    runtime.screenControllerState.status = status; runtime.updatedAt = new Date().toISOString(); this.repository.saveTerminalRuntime(runtime);
  }

  startRuntime(id: string) {
    const terminal = this.repository.getTerminal(id); const runtime = this.runtimes.get(id);
    if (!terminal || !runtime || !terminal.enabled) return;
    runtime.status = 'RUNNING'; runtime.updatedAt = new Date().toISOString(); this.repository.saveTerminalRuntime(runtime);
    this.attach(terminal);
  }

  stopRuntime(id: string, status: TerminalRuntime['status'] = 'STOPPED') {
    this.unsubscribeByTerminal.get(id)?.(); this.unsubscribeByTerminal.delete(id);
    const runtime = this.runtimes.get(id); if (!runtime) return;
    runtime.status = status; runtime.updatedAt = new Date().toISOString(); this.repository.saveTerminalRuntime(runtime);
  }

  private initializeTerminal(terminal: Terminal) {
    const runtime = this.repository.getTerminalRuntime(terminal.id) ?? createRuntime(terminal);
    runtime.sequenceAiRuntime=normalizeSequenceAiRuntime(runtime.sequenceAiRuntime);
    normalizeAnalyzerStreaksFromPattern(runtime);
    // O runtime persistido e a fonte de verdade. Recalcular/cancelar uma etapa
    // ativa a partir do padrao W/L durante a inicializacao fazia a primeira
    // aposta apos reiniciar o aplicativo desaparecer.
    runtime.galeRuntime.triggerLossStreakTarget ??= null;
    runtime.galeRuntime.triggerLossProgress ??= 0;
    runtime.galeRuntime.activeBetPlanId ??= null;
    runtime.galeRuntime.onWinBetPlanId ??= null;
    runtime.galeRuntime.followUp ??= false;
    runtime.galeRuntime.followUpBehavior ??= 'RUN_ONCE';
    runtime.galeRuntime.previousAmountCents ??= 0;
    runtime.galeRuntime.accumulatedLossCents ??= 0;
    runtime.galeRuntime.waitingSignals ??= 0;
    runtime.galeRuntime.entryConfirmed ??= runtime.galeRuntime.currentStage===0;
    runtime.galeRuntime.failedCycleAttempts ??= 0;
    runtime.galeRuntime.preparedLegAmountsCents ??= [];
    runtime.galeRuntime.operationalPreparationKey ??= null;
    this.recoverWinContinuation(terminal,runtime);
    runtime.bankrollState = normalizeBankrollState(runtime.bankrollState, terminal.initialBankrollCents);
    runtime.pauseState??={type:terminal.paused?'MANUAL':'NONE',reason:terminal.paused?'Pausa manual':null,ruleId:null,sourceTerminalId:null};
    runtime.status = terminal.enabled ? (terminal.paused||runtime.pauseState.type==='RULE' ? 'PAUSED' : 'RUNNING') : 'STOPPED';
    this.runtimes.set(terminal.id, runtime); this.repository.saveTerminalRuntime(runtime);
    if (runtime.status === 'RUNNING'||this.isControlRulePause(runtime)) this.attach(terminal);
  }

  private recoverWinContinuation(terminal:Terminal,runtime:TerminalRuntime){
    if(runtime.galeRuntime.active||runtime.resultAnalyzerState.lastResult!=='WIN'||runtime.betStrategyRuntime.lastAction!=='ENTER')return;
    const config=this.repository.getBetStrategyConfig(terminal.betStrategyWinId);
    const rule=config?.rules.find(item=>item.enabled&&item.action==='ENTER'&&item.onWinPlanBehavior==='REPEAT_UNTIL_LOSS');
    if(!rule)return;
    const planId=rule.onWinBetPlanId??terminal.betPlanWinId;
    const plan=this.repository.getBetPlanConfig(planId);
    if(!plan)return;
    runtime.galeRuntime={active:true,currentStage:0,cycleId:randomUUID(),activeBetPlanId:planId,onWinBetPlanId:null,followUp:true,followUpBehavior:'REPEAT_UNTIL_LOSS',triggerLossStreakTarget:runtime.galeRuntime.triggerLossStreakTarget??(runtime.resultAnalyzerState.lastClosedLossStreak||null),previousAmountCents:0,accumulatedLossCents:0,waitingSignals:0,entryConfirmed:true,failedCycleAttempts:runtime.galeRuntime.failedCycleAttempts??0,preparedLegAmountsCents:resolveStageAmounts(runtime,plan,0),currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:runtime.galeRuntime.lastCycleWinCount??0,lastCycleLossCount:runtime.galeRuntime.lastCycleLossCount??0};
    runtime.gameStrategyRuntime.state='WAIT_RESULT';
  }

  private attach(terminal: Terminal) {
    this.unsubscribeByTerminal.get(terminal.id)?.();
    this.unsubscribeByTerminal.set(terminal.id, this.eventBus.subscribe(terminal.platformId, terminal.id, event => this.processRound(terminal.id, event),this.referenceDepth(terminal)));
  }

  private referenceDepth(terminal:Terminal){let depth=0;let current=terminal;const visited=new Set<string>([terminal.id]);while(current.strategySourceTerminalId){const source=this.repository.getTerminal(current.strategySourceTerminalId);if(!source||visited.has(source.id))break;visited.add(source.id);depth++;current=source;}return depth;}
  private refreshSubscriptions(){for(const terminal of this.repository.listTerminals()){const runtime=this.runtimes.get(terminal.id);if(runtime&&(runtime.status==='RUNNING'||this.isControlRulePause(runtime)))this.attach(terminal);}}
  private validateStrategySource(terminalId:string|null,platformId:string,sourceId:string|null){if(terminalId&&this.repository.listTerminals().some(item=>item.strategySourceTerminalId===terminalId&&item.platformId!==platformId))throw new Error('Altere primeiro os Terminais dependentes; todos devem permanecer na mesma plataforma.');if(!sourceId)return;if(sourceId===terminalId)throw new Error('Um Terminal não pode usar a si próprio como referência.');const source=this.repository.getTerminal(sourceId);if(!source)throw new Error('Terminal de referência não encontrado.');if(source.platformId!==platformId)throw new Error('O Terminal de referência deve usar a mesma plataforma.');const visited=new Set<string>();let current:Terminal|null=source;while(current){if(current.id===terminalId)throw new Error('A referência criaria um ciclo entre Terminais.');if(visited.has(current.id))throw new Error('A cadeia de referência já contém um ciclo.');visited.add(current.id);current=current.strategySourceTerminalId?this.repository.getTerminal(current.strategySourceTerminalId):null;}}

  private processRound(terminalId: string, event: RoundEvent) {
    const runtime = this.runtimes.get(terminalId); if (!runtime) return;
    if(runtime.status==='PAUSED'&&this.isControlRulePause(runtime)){this.processPausedControlObservation(terminalId,event);return;}
    if(runtime.status !== 'RUNNING') return;
    const scheduleEvaluation=evaluateTerminalSchedule(this.repository.getTerminalSchedule(terminalId),new Date(event.round.occurredAt));
    runtime.scheduleState={allowed:scheduleEvaluation.allowed,reason:scheduleEvaluation.reason,checkedAt:new Date().toISOString()};
    if(!scheduleEvaluation.allowed){runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);return;}
    if (!this.repository.recordRoundReceipt(terminalId, event.round)) return;
    const terminal = this.repository.getTerminal(terminalId);
    const sourceSignal=terminal?.strategySourceTerminalId&&terminal.strategySourceMode==='GAME_SIGNALS'?this.repository.getTerminalGameSignalByRound(terminal.strategySourceTerminalId,event.round.id):null;
    const sourceExecution=terminal?.strategySourceTerminalId&&terminal.strategySourceMode==='BET_EXECUTIONS'?this.repository.getTerminalBetExecutionByRound(terminal.strategySourceTerminalId,event.round.id):null;
    if(terminal?.strategySourceMode==='BET_EXECUTIONS'&&sourceExecution&&!runtime.galeRuntime.active)this.armOperationalBase(terminal,runtime,event.round);
    if(terminal?.strategySourceMode==='BET_EXECUTIONS'&&runtime.galeRuntime.active)this.alignOperationalCyclePlan(terminal,runtime);
    const operationalCycleRound=terminal?.strategySourceMode==='BET_EXECUTIONS'&&runtime.galeRuntime.active&&(sourceExecution!=null||runtime.galeRuntime.currentStage>0);
    const config = terminal&&!terminal.strategySourceTerminalId ? this.repository.getGameStrategyConfig(terminal.gameStrategyId) : null;
    if (terminal && (config||sourceSignal||sourceExecution||operationalCycleRound)) {
      // A BASE acompanha uma operação efetiva da fonte. Depois de uma perda,
      // os GALEs ocupam as rodadas físicas seguintes, inclusive GATILHO/SEM APOSTA.
      const result = operationalCycleRound?operationalPhysicalResult(terminal,runtime,event.round):sourceExecution?referencedOperationalResult(terminal,runtime,event.round,sourceExecution):sourceSignal?referencedGameResult(terminal,runtime,event.round,sourceSignal):this.gameStrategyEngine.process({ terminalId, strategyId: terminal.gameStrategyId, config: config!, runtime: runtime.gameStrategyRuntime, round: event.round });
      runtime.gameStrategyRuntime = result.runtime;
      this.repository.saveRoundAnnotation(result.annotation);
      if (result.signal) {
        let stageAdvancedThisSignal=false;
        this.repository.saveGameSignal(result.signal);
        const cycleLossStreakTarget = runtime.galeRuntime.triggerLossStreakTarget ?? null;
        let cycleClosedWithLoss=false;
        if (runtime.galeRuntime.active && runtime.galeRuntime.cycleId) {
          const activeBetPlanId = runtime.galeRuntime.activeBetPlanId ?? terminal.betPlanId;
          const betPlan = this.repository.getBetPlanConfig(activeBetPlanId);
          const stageIndex = runtime.galeRuntime.currentStage;
          const stage = betPlan?.stages[stageIndex];
          const continuousOperationalGale=result.signal.metadata.operationalContinuation===true&&terminal.strategySourceMode==='BET_EXECUTIONS';
          const activeCombination=terminal.operationCombinations.find(item=>item.id===runtime.galeRuntime.activeCombinationId);
          const sequenceAiReentryPending=stageIndex>0&&runtime.galeRuntime.entryConfirmed===false&&activeCombination?.triggerType==='SEQUENCE_AI';
          if(sequenceAiReentryPending||(!continuousOperationalGale&&!isStageReady(stage?.execution,runtime,result.signal.result))){runtime.galeRuntime.waitingSignals=(runtime.galeRuntime.waitingSignals??0)+1;}else{
          runtime.galeRuntime.waitingSignals=0;
          const multiplier = Number(result.signal.metadata.multiplier ?? event.round.multiplier);
          const resolvedLegs = stage?.legs.map((leg,index)=>({...leg,resolvedAmountCents:runtime.galeRuntime.preparedLegAmountsCents?.[index]??calculateBetAmount(leg,{bankrollCents:runtime.bankrollState.currentBalanceCents,initialBankrollCents:runtime.bankrollState.initialBalanceCents,previousAmountCents:runtime.galeRuntime.previousAmountCents??0,currentLossStreak:runtime.resultAnalyzerState.currentLossStreak,lastLossStreak:runtime.resultAnalyzerState.lastClosedLossStreak,accumulatedLossCents:runtime.galeRuntime.accumulatedLossCents??0,stageIndex,cashout:leg.cashout})}))??[];
          const stakeCents = resolvedLegs.reduce((total, leg) => total + leg.resolvedAmountCents, 0);
          const bankrollBeforeCents = runtime.bankrollState.currentBalanceCents;
          const financialActive=!terminal.bankrollStartAt||Date.parse(event.round.occurredAt)>=Date.parse(terminal.bankrollStartAt);
          const limitReason=financialActive?bankrollStopReason(runtime.bankrollState,stakeCents,betPlan?.bankrollLimits):null;
          const canSettle = stakeCents > 0 && !limitReason;
          const returnedCents = canSettle ? resolvedLegs.reduce((total, leg) => total + (multiplier >= leg.cashout ? Math.round(leg.resolvedAmountCents * leg.cashout) : 0), 0) : 0;
          const profitLossCents = canSettle ? returnedCents - stakeCents : 0;
          const stageResult = canSettle ? (profitLossCents>0?'WIN':profitLossCents<0?'LOSS':'TIE') : 'LOSS';
          const bankrollAfterCents = bankrollBeforeCents + profitLossCents;
          const stageLabel = stage?.label ?? (stageIndex === 0 ? 'BASE' : `GALE ${stageIndex}`);
          const createdAt = new Date().toISOString();
          if(financialActive){
            this.repository.saveBetStageEvent({ id: randomUUID(), cycleId: runtime.galeRuntime.cycleId, terminalId, gameSignalId: result.signal.id, stageIndex, stageLabel, result: stageResult, createdAt });
            this.repository.saveBetExecution({ id: randomUUID(), cycleId: runtime.galeRuntime.cycleId, terminalId, gameSignalId: result.signal.id, stageIndex, stageLabel, multiplier, stakeCents, returnedCents, profitLossCents, bankrollBeforeCents, bankrollAfterCents, result: stageResult, createdAt });
          }
          if(financialActive&&terminal.strategySourceTerminalId){
            // Empate financeiro e neutro: nao aumenta nem WIN nem LOSS.
            this.repository.updateTerminalGameStats(terminal.id,terminal.gameWins+(stageResult==='WIN'?1:0),terminal.gameLosses+(stageResult==='LOSS'?1:0));
          }
          if(financialActive)runtime.bankrollState = updateBankrollMetrics(runtime.bankrollState,profitLossCents,stakeCents,betPlan?.bankrollLimits);
          runtime.galeRuntime.previousAmountCents=stakeCents;
          runtime.galeRuntime.accumulatedLossCents=profitLossCents<0?(runtime.galeRuntime.accumulatedLossCents??0)-profitLossCents:0;
          const cycleWinCount=(runtime.galeRuntime.currentCycleWinCount??0)+(stageResult==='WIN'?1:0);
          const cycleLossCount=(runtime.galeRuntime.currentCycleLossCount??0)+(stageResult==='LOSS'?1:0);
          runtime.galeRuntime.currentCycleWinCount=cycleWinCount;
          runtime.galeRuntime.currentCycleLossCount=cycleLossCount;
          const closedCycleCounts={currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:cycleWinCount,lastCycleLossCount:cycleLossCount,get failedCycleAttempts(){return runtime.galeRuntime.failedCycleAttempts??0;}};
          if(financialActive)this.repository.updateTerminalBankroll(terminalId, bankrollAfterCents);
          if(financialActive&&(limitReason||runtime.bankrollState.stopReason)){runtime.status='PAUSED';runtime.pauseState={type:'RULE',reason:limitReason??runtime.bankrollState.stopReason,ruleId:null,sourceTerminalId:terminalId};this.unsubscribeByTerminal.get(terminalId)?.();this.unsubscribeByTerminal.delete(terminalId);}
          const dependentCombinationCycle = terminal.strategySourceTerminalId != null && runtime.galeRuntime.activeCombinationId != null;
          if (runtime.galeRuntime.followUp && runtime.galeRuntime.followUpBehavior === 'REPEAT_UNTIL_LOSS' && !dependentCombinationCycle && result.signal.result === 'LOSS' && stageResult !== 'TIE') {
            completeCycleProgression(runtime,betPlan,stageResult==='WIN');
            // "AtÃ© LOSS" se refere ao sinal W/L da estratÃ©gia de jogo, nÃ£o ao
            // lucro lÃ­quido da aposta dupla. Um sinal L pode ainda dar pequeno
            // lucro em uma perna de 1,35x, mas mesmo assim encerra o pÃ³s-WIN.
            runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
            cycleClosedWithLoss=true;
          } else if (stageResult === 'WIN') {
            completeCycleProgression(runtime,betPlan,true);
            const repeatFollowUp = runtime.galeRuntime.followUp && runtime.galeRuntime.followUpBehavior === 'REPEAT_UNTIL_LOSS';
            const nextPlanId = repeatFollowUp ? activeBetPlanId : runtime.galeRuntime.followUp ? null : runtime.galeRuntime.onWinBetPlanId;
            if (nextPlanId && this.repository.getBetPlanConfig(nextPlanId)) {
              runtime.galeRuntime = { active: true, currentStage: 0, cycleId: randomUUID(), activeBetPlanId: nextPlanId,activeCombinationId:runtime.galeRuntime.activeCombinationId??null, onWinBetPlanId: null, followUp: true, followUpBehavior: runtime.galeRuntime.followUpBehavior, triggerLossStreakTarget: cycleLossStreakTarget,...closedCycleCounts };
              // O plano pós-WIN aposta na rodada imediatamente seguinte. A
              // rodada não precisa abrir outro gatilho antes de ser avaliada.
              runtime.gameStrategyRuntime.state='WAIT_RESULT';
              runtime.gameStrategyRuntime.triggerRoundId=result.signal.resultRoundId;
              const amountsCents=resolveStageAmounts(runtime,this.repository.getBetPlanConfig(nextPlanId),0);runtime.galeRuntime.preparedLegAmountsCents=amountsCents;
              if(terminal.strategySourceMode!=='BET_EXECUTIONS'&&!awaitsReferencedSignalPreparation(terminal))void this.assistedPreparationHandler?.({ terminalId, deliveryMode: event.round.deliveryMode, stageIndex: 0, betPlanId: nextPlanId,amountsCents });
            } else {
              runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
            }
          } else if(stageResult==='TIE'&&betPlan?.continueOnTie===false){
            // Empate nao e WIN, mas reinicia o Gale e a progressao entre ciclos.
            completeCycleProgression(runtime,betPlan,true);
            runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
          } else if (stageResult==='LOSS'&&runtime.galeRuntime.followUp && runtime.galeRuntime.followUpBehavior === 'REPEAT_UNTIL_LOSS') {
            completeCycleProgression(runtime,betPlan,false);
            runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
          } else if (stageIndex + 1 >= (betPlan?.stages.length ?? 1)) {
            completeCycleProgression(runtime,betPlan,false);
            runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
            cycleClosedWithLoss=result.signal.result==='LOSS';
          } else {
            runtime.galeRuntime.currentStage++;
            stageAdvancedThisSignal=true;
            runtime.galeRuntime.waitingSignals=0;
            runtime.galeRuntime.entryConfirmed=false;
            const nextStage=betPlan?.stages[runtime.galeRuntime.currentStage];
            if(nextStage?.execution?.policy==='AFTER_ENTRY_CONFIRMATION')runtime.galeRuntime.preparedLegAmountsCents=[];
            else{const amountsCents=resolveStageAmounts(runtime,betPlan,runtime.galeRuntime.currentStage,stageResult==='LOSS'?1:0);runtime.galeRuntime.preparedLegAmountsCents=amountsCents;runtime.galeRuntime.operationalPreparationKey=null;if(terminal.strategySourceMode==='BET_EXECUTIONS')this.prepareOperationalStage(terminal,runtime,event.round);else if(!awaitsReferencedSignalPreparation(terminal))void this.assistedPreparationHandler?.({ terminalId, deliveryMode: event.round.deliveryMode, stageIndex: runtime.galeRuntime.currentStage, betPlanId: activeBetPlanId,amountsCents });}
          }
          }
        }
        runtime.resultAnalyzerState = this.resultAnalyzer.process(runtime.resultAnalyzerState, result.signal.result);
        runtime.sequenceAiRuntime=observeSequenceResult(runtime.sequenceAiRuntime,result.signal.result);
        if(!terminal.strategySourceTerminalId)this.repository.updateTerminalGameStats(terminal.id, runtime.resultAnalyzerState.winCount, runtime.resultAnalyzerState.lossCount);
        if(!runtime.galeRuntime.active){
          if(result.signal.result==='WIN'){
            runtime.galeRuntime.triggerLossStreakTarget=runtime.resultAnalyzerState.lastClosedLossStreak||runtime.galeRuntime.triggerLossStreakTarget||null;
            runtime.galeRuntime.triggerLossProgress=0;
          }else{
            runtime.galeRuntime.triggerLossProgress=cycleClosedWithLoss?1:(runtime.galeRuntime.triggerLossProgress??0)+1;
          }
        }
        const gameSignal=result.signal;
        const combinations=[...terminal.operationCombinations].filter(item=>item.enabled).sort((left,right)=>left.priority-right.priority);
        let selectedCombination=combinations.find(item=>item.id===runtime.galeRuntime.activeCombinationId)??null;
        let selectedBetStrategyId = selectedCombination?.betStrategyId??(result.signal.result==='WIN' ? terminal.betStrategyWinId : terminal.betStrategyLossId);
        let betConfig = this.repository.getBetStrategyConfig(selectedBetStrategyId);
        let combinationDecision:BetDecision|null=null;
        const evaluateCombination=(combination:Terminal['operationCombinations'][number],reentry:boolean)=>{
          // Uma combinacao de IA reavalia cada saida antes de confirmar BASE ou
          // qualquer Gale. O L da fonte alimenta o modelo, mas nao libera o
          // proximo estagio automaticamente.
          const triggerType=reentry&&combination.triggerType==='SEQUENCE_AI'?'SEQUENCE_AI':reentry?combination.lossReentryType:combination.triggerType;
          const strategyId=reentry?(combination.lossReentryBetStrategyId??combination.betStrategyId):combination.betStrategyId;
          const candidateConfig=this.repository.getBetStrategyConfig(strategyId)??{rules:[]};
          const pattern=reentry?combination.lossReentryPattern:combination.pattern;
          const candidateDecision=triggerType==='BET_STRATEGY'
            ?this.betStrategyEngine.decide({terminalId,betStrategyId:strategyId,config:candidateConfig,signal:gameSignal,analyzer:runtime.resultAnalyzerState,bankrollCents:runtime.bankrollState.currentBalanceCents})
            :triggerType==='SEQUENCE_AI'?sequenceAiCombinationDecision(terminalId,strategyId,gameSignal,runtime,combination,this.repository.getBetPlanConfig(combination.betPlanId)?.stages.length??1)
            :patternCombinationDecision(terminalId,strategyId,gameSignal,runtime,combination,pattern,triggerType==='IMMEDIATE',reentry);
          return{strategyId,candidateConfig,candidateDecision};
        };
        const operationalContinuation=result.signal.metadata.operationalContinuation===true;
        const operationalSourceEntryHandled=terminal.strategySourceMode==='BET_EXECUTIONS'&&!runtime.galeRuntime.active;
        if(combinations.length&&!runtime.galeRuntime.active&&!operationalContinuation&&!operationalSourceEntryHandled){
          for(const combination of combinations){
            const{strategyId,candidateConfig,candidateDecision}=evaluateCombination(combination,false);
            combinationDecision??=candidateDecision;
            if(candidateDecision.action!=='IGNORE'){selectedCombination=combination;selectedBetStrategyId=strategyId;betConfig=candidateConfig;combinationDecision={...candidateDecision,metadata:{...candidateDecision.metadata,operationCombinationId:combination.id,operationCombinationName:combination.name}};break;}
          }
        }else if(selectedCombination){
          const waitingForReentry=runtime.galeRuntime.currentStage>0&&runtime.galeRuntime.entryConfirmed===false;
          const evaluated=evaluateCombination(selectedCombination,waitingForReentry);selectedBetStrategyId=evaluated.strategyId;betConfig=evaluated.candidateConfig;combinationDecision={...evaluated.candidateDecision,metadata:{...evaluated.candidateDecision.metadata,operationCombinationId:selectedCombination.id,operationCombinationName:selectedCombination.name}};
        }
        if (betConfig) {
          let decision = combinationDecision??(terminal.strategySourceMode==='BET_EXECUTIONS'&&(operationalContinuation||operationalSourceEntryHandled)
            ? ignoredOperationalContinuationDecision(terminalId,selectedBetStrategyId,result.signal,runtime)
            : this.betStrategyEngine.decide({ terminalId, betStrategyId: selectedBetStrategyId, config: betConfig, signal: result.signal, analyzer: runtime.resultAnalyzerState, bankrollCents: runtime.bankrollState.currentBalanceCents }));
          if(combinations.length===0&&decision.action==='IGNORE'&&result.signal.result==='WIN'&&!runtime.galeRuntime.active){
            // Para que o segundo WIN seja uma aposta, a condiÃ§Ã£o W2 precisa ser
            // antecipada ao fim do W1, quando ainda hÃ¡ tempo de preparar o clique.
            const projectedAnalyzer={...runtime.resultAnalyzerState,currentWinStreak:runtime.resultAnalyzerState.currentWinStreak+1};
            const projectedDecision=this.betStrategyEngine.decide({terminalId,betStrategyId:selectedBetStrategyId,config:betConfig,signal:result.signal,analyzer:projectedAnalyzer,bankrollCents:runtime.bankrollState.currentBalanceCents});
            const projectedRule=betConfig.rules.find(rule=>rule.id===projectedDecision.ruleId);
            const isProspectiveWinEntry=projectedRule?.action==='ENTER'&&projectedRule.conditions.some(condition=>condition.field==='currentWinStreak');
            if(isProspectiveWinEntry){decision={...projectedDecision,metadata:{...projectedDecision.metadata,analyzer:runtime.resultAnalyzerState,prospectiveWinEntry:true,projectedWinStreak:projectedAnalyzer.currentWinStreak}};}
          }
          this.repository.saveBetDecision(decision);
          runtime.betStrategyRuntime.lastDecisionId = decision.id;
          runtime.betStrategyRuntime.lastAction = decision.action;
          runtime.betStrategyRuntime.decisionCount++;
          if (decision.action === 'ENTER') runtime.betStrategyRuntime.entryCount++;
          if (decision.action === 'IGNORE') runtime.betStrategyRuntime.ignoredCount++;
          if (decision.action === 'PAUSE') {
            runtime.status = 'PAUSED';
            runtime.pauseState={type:'RULE',reason:'Estratégia de aposta solicitou pausa',ruleId:decision.ruleId,sourceTerminalId:terminalId};
            this.unsubscribeByTerminal.get(terminalId)?.();
            this.unsubscribeByTerminal.delete(terminalId);
          }
          if(decision.action==='ENTER'&&runtime.galeRuntime.active&&(!stageAdvancedThisSignal||selectedCombination?.triggerType==='SEQUENCE_AI')){
            const activeBetPlanId=runtime.galeRuntime.activeBetPlanId??terminal.betPlanId;
            const activeBetPlan=this.repository.getBetPlanConfig(activeBetPlanId);
            const activeStage=activeBetPlan?.stages[runtime.galeRuntime.currentStage];
            const requiresAiConfirmation=selectedCombination?.triggerType==='SEQUENCE_AI'&&runtime.galeRuntime.currentStage>0;
            if((activeStage?.execution?.policy==='AFTER_ENTRY_CONFIRMATION'||requiresAiConfirmation)&&!runtime.galeRuntime.entryConfirmed){
              runtime.galeRuntime.entryConfirmed=true;runtime.galeRuntime.waitingSignals=0;
              const amountsCents=resolveStageAmounts(runtime,activeBetPlan,runtime.galeRuntime.currentStage);runtime.galeRuntime.preparedLegAmountsCents=amountsCents;
              if(!awaitsReferencedSignalPreparation(terminal))void this.assistedPreparationHandler?.({terminalId,deliveryMode:event.round.deliveryMode,stageIndex:runtime.galeRuntime.currentStage,betPlanId:activeBetPlanId,amountsCents});
            }
          }
          if (decision.action === 'ENTER' && runtime.status==='RUNNING' && !runtime.galeRuntime.active) {
            const resultPlanId=selectedCombination?.betPlanId??(result.signal.result==='WIN'?terminal.betPlanWinId:terminal.betPlanLossId);
            const activeBetPlanId = resultPlanId;
            const winContinuationRule=this.repository.getBetStrategyConfig(terminal.betStrategyWinId)?.rules.find(rule=>rule.enabled&&rule.action==='ENTER'&&rule.onWinPlanBehavior==='REPEAT_UNTIL_LOSS');
            const combinationRepeats=selectedCombination?.triggerType!=='SEQUENCE_AI'&&selectedCombination?.behavior==='REPEAT_UNTIL_LOSS';
            const configuredOnWinPlanId=selectedCombination?null:typeof decision.metadata.onWinBetPlanId==='string'?decision.metadata.onWinBetPlanId:winContinuationRule?.onWinBetPlanId??(winContinuationRule?terminal.betPlanWinId:null);
            const onWinBetPlanId = combinationRepeats?activeBetPlanId:configuredOnWinPlanId&&this.repository.getBetPlanConfig(configuredOnWinPlanId) ? configuredOnWinPlanId : null;
            const followUpBehavior = combinationRepeats||(!selectedCombination&&(decision.metadata.onWinPlanBehavior === 'REPEAT_UNTIL_LOSS'||winContinuationRule?.onWinPlanBehavior==='REPEAT_UNTIL_LOSS')) ? 'REPEAT_UNTIL_LOSS' : 'RUN_ONCE';
            const matchedRule=betConfig.rules.find(rule=>rule.id===decision.ruleId);
            const triggerLossStreakTarget=matchedRule?.conditions.some(condition=>condition.field==='currentLossStreak'&&condition.referenceField==='lastClosedLossStreak')?(runtime.resultAnalyzerState.lastClosedLossStreak||null):runtime.galeRuntime.triggerLossStreakTarget??null;
            runtime.galeRuntime = { active: true, currentStage: 0, cycleId: randomUUID(), activeBetPlanId,activeCombinationId:selectedCombination?.id??null, onWinBetPlanId, followUp: combinationRepeats, followUpBehavior, triggerLossStreakTarget,triggerLossProgress:runtime.galeRuntime.triggerLossProgress??0,entryConfirmed:true,failedCycleAttempts:runtime.galeRuntime.failedCycleAttempts??0,currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:runtime.galeRuntime.lastCycleWinCount??0,lastCycleLossCount:runtime.galeRuntime.lastCycleLossCount??0 };
            if(decision.metadata.prospectiveWinEntry===true){runtime.gameStrategyRuntime.state='WAIT_RESULT';runtime.gameStrategyRuntime.triggerRoundId=result.signal.resultRoundId;}
            const amountsCents=resolveStageAmounts(runtime,this.repository.getBetPlanConfig(activeBetPlanId),0);runtime.galeRuntime.preparedLegAmountsCents=amountsCents;
            runtime.galeRuntime.operationalPreparationKey=null;
            if(!awaitsReferencedSignalPreparation(terminal))void this.assistedPreparationHandler?.({ terminalId, deliveryMode: event.round.deliveryMode, stageIndex: 0, betPlanId: activeBetPlanId,amountsCents });
          }
        }
      }
      this.evaluateControlRules(terminalId);
    } else {
      runtime.gameStrategyRuntime.processedRounds++;
      runtime.gameStrategyRuntime.lastMultiplier = event.round.multiplier;
    }
    if(event.round.deliveryMode==='LIVE'&&terminal?.strategySourceMode==='BET_EXECUTIONS'&&terminal.strategySourceTerminalId&&this.sourceOperationIsImminent(terminal.strategySourceTerminalId)){
      if(runtime.galeRuntime.active)this.prepareOperationalStage(terminal,runtime,event.round);
      else this.armOperationalBase(terminal,runtime,event.round);
    }
    if(event.round.deliveryMode==='LIVE'&&terminal?.strategySourceMode==='GAME_SIGNALS'&&terminal.strategySourceTerminalId&&runtime.galeRuntime.active&&!sourceSignal&&this.sourceSignalIsImminent(terminal.strategySourceTerminalId))this.prepareOperationalStage(terminal,runtime,event.round);
    runtime.lastProcessedRoundId = event.round.id;
    runtime.updatedAt = new Date().toISOString();
    this.repository.saveTerminalRuntime(runtime);
  }

  private armOperationalBase(terminal:Terminal,runtime:TerminalRuntime,round:NormalizedRound){
    if(runtime.galeRuntime.active||entryIsBlocked(terminal,runtime))return;
    const combination=[...terminal.operationCombinations].filter(item=>item.enabled).sort((left,right)=>left.priority-right.priority)[0]??null;
    const planId=combination?.betPlanId??terminal.betPlanId;const plan=this.repository.getBetPlanConfig(planId);if(!plan?.stages.length)return;const amountsCents=resolveStageAmounts(runtime,plan,0);
    runtime.galeRuntime={active:true,currentStage:0,cycleId:randomUUID(),activeBetPlanId:planId,activeCombinationId:combination?.id??null,onWinBetPlanId:null,followUp:false,followUpBehavior:'RUN_ONCE',triggerLossStreakTarget:runtime.galeRuntime.triggerLossStreakTarget??null,triggerLossProgress:runtime.galeRuntime.triggerLossProgress??0,previousAmountCents:runtime.galeRuntime.previousAmountCents??0,accumulatedLossCents:runtime.galeRuntime.accumulatedLossCents??0,waitingSignals:0,entryConfirmed:true,failedCycleAttempts:runtime.galeRuntime.failedCycleAttempts??0,preparedLegAmountsCents:amountsCents,currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:runtime.galeRuntime.lastCycleWinCount??0,lastCycleLossCount:runtime.galeRuntime.lastCycleLossCount??0,operationalPreparationKey:`${round.id}:0`};
    void this.assistedPreparationHandler?.({terminalId:terminal.id,deliveryMode:round.deliveryMode,stageIndex:0,betPlanId:planId,amountsCents});
  }

  private alignOperationalCyclePlan(terminal:Terminal,runtime:TerminalRuntime){
    const combinations=[...terminal.operationCombinations].filter(item=>item.enabled).sort((left,right)=>left.priority-right.priority);
    const combination=combinations.find(item=>item.id===runtime.galeRuntime.activeCombinationId)??combinations[0]??null;
    const planId=combination?.betPlanId??terminal.betPlanId;const plan=this.repository.getBetPlanConfig(planId);if(!plan?.stages.length)return;
    const stageIndex=Math.min(runtime.galeRuntime.currentStage,plan.stages.length-1);
    if(runtime.galeRuntime.activeBetPlanId===planId&&runtime.galeRuntime.currentStage===stageIndex)return;
    runtime.galeRuntime.activeBetPlanId=planId;runtime.galeRuntime.activeCombinationId=combination?.id??null;runtime.galeRuntime.currentStage=stageIndex;
    runtime.galeRuntime.preparedLegAmountsCents=resolveStageAmounts(runtime,plan,stageIndex);runtime.galeRuntime.operationalPreparationKey=null;
  }

  private prepareOperationalStage(terminal:Terminal,runtime:TerminalRuntime,round:NormalizedRound){
    if(!runtime.galeRuntime.active)return;const key=`${runtime.galeRuntime.cycleId}:${runtime.galeRuntime.currentStage}`;if(runtime.galeRuntime.operationalPreparationKey===key)return;
    const planId=runtime.galeRuntime.activeBetPlanId??terminal.betPlanId;const amountsCents=runtime.galeRuntime.preparedLegAmountsCents?.length?runtime.galeRuntime.preparedLegAmountsCents:resolveStageAmounts(runtime,this.repository.getBetPlanConfig(planId),runtime.galeRuntime.currentStage);
    runtime.galeRuntime.preparedLegAmountsCents=amountsCents;runtime.galeRuntime.operationalPreparationKey=key;
    void this.assistedPreparationHandler?.({terminalId:terminal.id,deliveryMode:round.deliveryMode,stageIndex:runtime.galeRuntime.currentStage,betPlanId:planId,amountsCents});
  }

  private sourceOperationIsImminent(sourceTerminalId:string):boolean{
    const source=this.repository.getTerminal(sourceTerminalId);const runtime=this.runtimes.get(sourceTerminalId);if(!source||!runtime?.galeRuntime.active)return false;
    if(!source.strategySourceTerminalId)return runtime.gameStrategyRuntime.lastAnnotationRole==='TRIGGER'||runtime.gameStrategyRuntime.lastAnnotationRole==='RELEASE_TRIGGER';
    if(source.strategySourceMode==='BET_EXECUTIONS')return this.sourceOperationIsImminent(source.strategySourceTerminalId);
    const signalSourceRuntime=this.runtimes.get(source.strategySourceTerminalId);
    return signalSourceRuntime?.gameStrategyRuntime.lastAnnotationRole==='TRIGGER'||signalSourceRuntime?.gameStrategyRuntime.lastAnnotationRole==='RELEASE_TRIGGER';
  }

  private sourceSignalIsImminent(sourceTerminalId:string):boolean{const source=this.repository.getTerminal(sourceTerminalId);const runtime=this.runtimes.get(sourceTerminalId);if(!source||!runtime)return false;if(!source.strategySourceTerminalId)return runtime.gameStrategyRuntime.lastAnnotationRole==='TRIGGER'||runtime.gameStrategyRuntime.lastAnnotationRole==='RELEASE_TRIGGER';return this.sourceSignalIsImminent(source.strategySourceTerminalId);}

  private evaluateControlRules(sourceTerminalId:string){
    const runtime=this.runtimes.get(sourceTerminalId);if(!runtime||runtime.pauseState.type==='MANUAL')return;
    const rules=this.repository.getTerminalControlRules(sourceTerminalId).filter(rule=>rule.enabled);const matchesRule=(rule:TerminalControlRule)=>compareControlValue(controlMetricValue(rule,runtime),rule.operator,rule.referenceMetric?controlMetricValueByName(rule.referenceMetric,runtime):rule.value);
    const pause=rules.filter(rule=>rule.action==='PAUSE').find(matchesRule);if(pause){this.applyRulePause(sourceTerminalId,pause);return;}
    const playRules=rules.filter(rule=>rule.action==='PLAY'||rule.action==='RESUME');const canPlay=playRules.length===0||playRules.some(matchesRule);
    if(canPlay)this.applyRuleResume(sourceTerminalId);else if(runtime.status==='RUNNING')this.applyRuleWait(sourceTerminalId,playRules);
  }

  private applyRulePause(targetId:string,rule:TerminalControlRule){const runtime=this.runtimes.get(targetId);if(!runtime||runtime.pauseState.type==='MANUAL')return;const comparedWith=rule.referenceMetric?controlMetricLabel(rule.referenceMetric):String(rule.value);runtime.pauseState={type:'RULE',reason:`${rule.name}: ${controlMetricLabel(rule.metric)} ${controlOperatorLabel(rule.operator)} ${comparedWith}`,ruleId:rule.id,sourceTerminalId:targetId};runtime.status='PAUSED';runtime.updatedAt=new Date().toISOString();const terminal=this.repository.getTerminal(targetId);if(terminal&&!this.unsubscribeByTerminal.has(targetId))this.attach(terminal);this.repository.saveTerminalRuntime(runtime);}
  private applyRuleWait(targetId:string,rules:TerminalControlRule[]){const runtime=this.runtimes.get(targetId);const terminal=this.repository.getTerminal(targetId);if(!runtime||!terminal)return;runtime.status='PAUSED';runtime.pauseState={type:'RULE',reason:`Aguardando uma regra PLAY: ${rules.map(rule=>rule.name).join(', ')}`,ruleId:rules[0]?.id??null,sourceTerminalId:targetId};runtime.updatedAt=new Date().toISOString();if(!this.unsubscribeByTerminal.has(targetId))this.attach(terminal);this.repository.saveTerminalRuntime(runtime);}
  private applyRuleResume(targetId:string){const terminal=this.repository.getTerminal(targetId);const runtime=this.runtimes.get(targetId);if(!terminal||!runtime||terminal.paused||runtime.pauseState.type!=='RULE')return;runtime.pauseState={type:'NONE',reason:null,ruleId:null,sourceTerminalId:null};this.startRuntime(targetId);}
  private isControlRulePause(runtime:TerminalRuntime){return runtime.pauseState.type==='RULE'&&this.repository.getTerminalControlRules(runtime.terminalId).some(rule=>rule.enabled);}
  private processPausedControlObservation(terminalId:string,event:RoundEvent){const runtime=this.runtimes.get(terminalId);const terminal=this.repository.getTerminal(terminalId);if(!runtime||!terminal||!this.repository.recordRoundReceipt(terminalId,event.round))return;const sourceSignal=terminal.strategySourceTerminalId?this.repository.getTerminalGameSignalByRound(terminal.strategySourceTerminalId,event.round.id):null;const config=!terminal.strategySourceTerminalId?this.repository.getGameStrategyConfig(terminal.gameStrategyId):null;const result=sourceSignal?referencedGameResult(terminal,runtime,event.round,sourceSignal):config?this.gameStrategyEngine.process({terminalId,strategyId:terminal.gameStrategyId,config,runtime:runtime.gameStrategyRuntime,round:event.round}):null;if(result){runtime.gameStrategyRuntime=result.runtime;this.repository.saveRoundAnnotation(result.annotation);if(result.signal){this.repository.saveGameSignal(result.signal);runtime.resultAnalyzerState=this.resultAnalyzer.process(runtime.resultAnalyzerState,result.signal.result);runtime.sequenceAiRuntime=observeSequenceResult(runtime.sequenceAiRuntime,result.signal.result);if(!terminal.strategySourceTerminalId)this.repository.updateTerminalGameStats(terminal.id,runtime.resultAnalyzerState.winCount,runtime.resultAnalyzerState.lossCount);this.evaluateControlRules(terminalId);}}else{runtime.gameStrategyRuntime.processedRounds++;runtime.gameStrategyRuntime.lastMultiplier=event.round.multiplier;}runtime.lastProcessedRoundId=event.round.id;runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);}
}

export function createRuntime(terminal: Terminal): TerminalRuntime {
  return { terminalId: terminal.id, gameStrategyRuntime: { state: 'SEARCH_TRIGGER', processedRounds: 0, lastMultiplier: null, triggerRoundId: null, releaseProgress:0, lastAnnotationRole:null }, resultAnalyzerState: createResultAnalyzerState(),sequenceAiRuntime:createSequenceAiRuntime(), betStrategyRuntime: { lastDecisionId: null, lastAction: null, decisionCount: 0, entryCount: 0, ignoredCount: 0 }, galeRuntime: { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null,activeCombinationId:null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:null,triggerLossProgress:0, previousAmountCents:0, accumulatedLossCents:0, waitingSignals:0,entryConfirmed:false,failedCycleAttempts:0, preparedLegAmountsCents:[],currentCycleWinCount:0,currentCycleLossCount:0,lastCycleLossCount:0,lastCycleWinCount:0 }, bankrollState: createBankrollMetrics(terminal.initialBankrollCents), screenControllerState: { status: 'IDLE', paused: false }, scheduleState:{allowed:true,reason:null,checkedAt:null},pauseState:{type:terminal.paused?'MANUAL':'NONE',reason:terminal.paused?'Pausa manual':null,ruleId:null,sourceTerminalId:null}, lastProcessedRoundId: null, status: terminal.paused ? 'PAUSED' : 'RUNNING', updatedAt: new Date().toISOString() };
}

function sequenceAiCombinationDecision(terminalId:string,strategyId:string,signal:GameSignal,runtime:TerminalRuntime,combination:Terminal['operationCombinations'][number],riskDepth:number):BetDecision{
  const config=combination.sequenceAiConfig??{minWindow:2,maxWindow:12,minOccurrences:20,minConfidence:60,maxCurrentLossStreak:3,minContextAgreement:60,maxFullCycleLossRisk:0};const prediction=predictSequence(runtime.sequenceAiRuntime,config,riskDepth);runtime.sequenceAiRuntime.lastPrediction=prediction;
  return{id:randomUUID(),terminalId,platformId:signal.platformId,betStrategyId:strategyId,gameSignalId:signal.id,ruleId:`combination:${combination.id}:sequence-ai`,action:prediction.shouldEnter?'ENTER':'IGNORE',createdAt:new Date().toISOString(),metadata:{operationCombinationId:combination.id,operationCombinationName:combination.name,triggerType:'SEQUENCE_AI',sequenceAiConfig:config,sequenceAiPrediction:prediction,analyzer:runtime.resultAnalyzerState,bankrollCents:runtime.bankrollState.currentBalanceCents}};
}

function patternCombinationDecision(terminalId:string,strategyId:string,signal:GameSignal,runtime:TerminalRuntime,combination:Terminal['operationCombinations'][number],pattern:string|null,immediate:boolean,reentry:boolean):BetDecision{
  const normalizedPattern=(pattern??'').toUpperCase();const recentPattern=runtime.resultAnalyzerState.recentPattern.toUpperCase();const matched=immediate||(normalizedPattern.length>0&&recentPattern.endsWith(normalizedPattern));
  return{id:randomUUID(),terminalId,platformId:signal.platformId,betStrategyId:strategyId,gameSignalId:signal.id,ruleId:`combination:${combination.id}:${reentry?'loss-reentry':'trigger'}`,action:matched?'ENTER':'IGNORE',createdAt:new Date().toISOString(),metadata:{operationCombinationId:combination.id,operationCombinationName:combination.name,triggerType:immediate?'IMMEDIATE':'PATTERN',pattern:normalizedPattern,reentryAfterLoss:reentry,matched,recentPattern,analyzer:runtime.resultAnalyzerState,bankrollCents:runtime.bankrollState.currentBalanceCents}};
}

function normalizeBankrollState(state:Partial<TerminalRuntime['bankrollState']>,initial:number):TerminalRuntime['bankrollState']{const base=createBankrollMetrics(state.initialBalanceCents??initial);const current=state.currentBalanceCents??base.currentBalanceCents;const peak=state.peakBalanceCents??Math.max(base.initialBalanceCents,current);return{...base,...state,currentBalanceCents:current,peakBalanceCents:peak,profitCents:state.profitCents??current-base.initialBalanceCents,roi:state.roi??(base.initialBalanceCents?(current-base.initialBalanceCents)/base.initialBalanceCents*100:0),drawdownCents:state.drawdownCents??peak-current,maxDrawdownCents:state.maxDrawdownCents??peak-current,currentExposureCents:state.currentExposureCents??0,maximumExposureCents:state.maximumExposureCents??0,stopReason:state.stopReason??null};}
function referencedGameResult(terminal:Terminal,runtime:TerminalRuntime,round:NormalizedRound,sourceSignal:GameSignal){const state=runtime.gameStrategyRuntime.state;const gameRuntime={...runtime.gameStrategyRuntime,processedRounds:runtime.gameStrategyRuntime.processedRounds+1,lastMultiplier:round.multiplier,lastAnnotationRole:sourceSignal.result};return{runtime:gameRuntime,annotation:{id:randomUUID(),terminalId:terminal.id,roundId:round.id,strategyId:sourceSignal.strategyId,role:sourceSignal.result,stateBefore:state,stateAfter:state,metadata:{...sourceSignal.metadata,deliveryMode:round.deliveryMode,sourceTerminalId:sourceSignal.terminalId,sourceSignalId:sourceSignal.id},createdAt:round.occurredAt} as RoundAnnotation,signal:{...sourceSignal,id:randomUUID(),terminalId:terminal.id,metadata:{...sourceSignal.metadata,sourceTerminalId:sourceSignal.terminalId,sourceSignalId:sourceSignal.id}} as GameSignal};}
function referencedOperationalResult(terminal:Terminal,runtime:TerminalRuntime,round:NormalizedRound,sourceExecution:BetExecution){const result:GameSignal['result']=sourceExecution.result==='LOSS'?'LOSS':'WIN';const state=runtime.gameStrategyRuntime.state;const gameRuntime={...runtime.gameStrategyRuntime,processedRounds:runtime.gameStrategyRuntime.processedRounds+1,lastMultiplier:sourceExecution.multiplier,lastAnnotationRole:result};const metadata={multiplier:sourceExecution.multiplier,deliveryMode:round.deliveryMode,sourceTerminalId:sourceExecution.terminalId,sourceExecutionId:sourceExecution.id,sourceFinancialResult:sourceExecution.result,operationalSource:true};return{runtime:gameRuntime,annotation:{id:randomUUID(),terminalId:terminal.id,roundId:round.id,strategyId:terminal.gameStrategyId,role:result,stateBefore:state,stateAfter:state,metadata,createdAt:round.occurredAt} as RoundAnnotation,signal:{id:randomUUID(),terminalId:terminal.id,platformId:terminal.platformId,strategyId:terminal.gameStrategyId,triggerRoundId:round.id,resultRoundId:round.id,result,metadata,createdAt:round.occurredAt} as GameSignal};}
function operationalPhysicalResult(terminal:Terminal,runtime:TerminalRuntime,round:NormalizedRound){const result:GameSignal['result']=round.multiplier>=2?'WIN':'LOSS';const state=runtime.gameStrategyRuntime.state;const gameRuntime={...runtime.gameStrategyRuntime,processedRounds:runtime.gameStrategyRuntime.processedRounds+1,lastMultiplier:round.multiplier,lastAnnotationRole:result};const metadata={multiplier:round.multiplier,deliveryMode:round.deliveryMode,operationalContinuation:true,physicalRound:true};return{runtime:gameRuntime,annotation:{id:randomUUID(),terminalId:terminal.id,roundId:round.id,strategyId:terminal.gameStrategyId,role:result,stateBefore:state,stateAfter:state,metadata,createdAt:round.occurredAt} as RoundAnnotation,signal:{id:randomUUID(),terminalId:terminal.id,platformId:terminal.platformId,strategyId:terminal.gameStrategyId,triggerRoundId:round.id,resultRoundId:round.id,result,metadata,createdAt:round.occurredAt} as GameSignal};}
function ignoredOperationalContinuationDecision(terminalId:string,strategyId:string,signal:GameSignal,runtime:TerminalRuntime):BetDecision{return{id:randomUUID(),terminalId,platformId:signal.platformId,betStrategyId:strategyId,gameSignalId:signal.id,ruleId:null,action:'IGNORE',createdAt:new Date().toISOString(),metadata:{operationalContinuation:true,reason:'A rodada pertence ao ciclo armado; somente uma nova operação da fonte pode armar outro ciclo.',analyzer:runtime.resultAnalyzerState,bankrollCents:runtime.bankrollState.currentBalanceCents}};}
function entryIsBlocked(terminal:Terminal,runtime:TerminalRuntime){const recent=runtime.resultAnalyzerState.recentPattern.toUpperCase();return terminal.entryBlockPatterns.some(pattern=>recent.endsWith(pattern.toUpperCase()));}
function awaitsReferencedSignalPreparation(terminal:Terminal){return terminal.strategySourceTerminalId!==null&&terminal.strategySourceMode==='GAME_SIGNALS';}
function normalizeAnalyzerStreaksFromPattern(runtime:TerminalRuntime){const pattern=runtime.resultAnalyzerState.recentPattern;const currentLoss=pattern.match(/L+$/)?.[0].length??0;const currentWin=pattern.match(/W+$/)?.[0].length??0;const closedLossBlocks=[...pattern.matchAll(/L+(?=W)/g)];const lastClosedLoss=closedLossBlocks.at(-1)?.[0].length;runtime.resultAnalyzerState.currentLossStreak=currentLoss;runtime.resultAnalyzerState.currentWinStreak=currentWin;if(lastClosedLoss!==undefined)runtime.resultAnalyzerState.lastClosedLossStreak=lastClosedLoss;}
function isStageReady(execution:BetPlanConfig['stages'][number]['execution'],runtime:TerminalRuntime,result:'WIN'|'LOSS'){if(!execution||execution.policy==='NEXT_VALID_SIGNAL')return true;if(execution.policy==='AFTER_ENTRY_CONFIRMATION')return runtime.galeRuntime.entryConfirmed===true;if(execution.policy==='AFTER_N_SIGNALS')return(runtime.galeRuntime.waitingSignals??0)+1>=Math.max(1,execution.signalCount??1);if(execution.policy==='AFTER_PATTERN'){const pattern=(execution.pattern??'').toUpperCase();return pattern.length>0&&`${runtime.resultAnalyzerState.recentPattern}${result[0]}`.endsWith(pattern);}if(!execution.condition)return false;const condition=execution.condition;const left=condition.field==='bankroll'?runtime.bankrollState.currentBalanceCents:Number(runtime.resultAnalyzerState[condition.field]);const right=condition.referenceField?(condition.referenceField==='bankroll'?runtime.bankrollState.currentBalanceCents:Number(runtime.resultAnalyzerState[condition.referenceField])):condition.value;if(typeof left!=='number'||typeof right!=='number')return false;return condition.operator==='GT'?left>right:condition.operator==='GTE'?left>=right:condition.operator==='LT'?left<right:condition.operator==='LTE'?left<=right:left===right;}
function resolveStageAmounts(runtime:TerminalRuntime,plan:BetPlanConfig|null,index:number,lossOffset=0){const progression=plan?.cycleProgression;const failed=runtime.galeRuntime.failedCycleAttempts??0;const factor=progression?1+Math.floor(failed/progression.attemptsPerStep)*progression.increasePercentage/100:1;return plan?.stages[index]?.legs.map(leg=>Math.max(1,Math.round(calculateBetAmount(leg,{bankrollCents:runtime.bankrollState.currentBalanceCents,initialBankrollCents:runtime.bankrollState.initialBalanceCents,previousAmountCents:runtime.galeRuntime.previousAmountCents??0,currentLossStreak:runtime.resultAnalyzerState.currentLossStreak+lossOffset,lastLossStreak:runtime.resultAnalyzerState.lastClosedLossStreak,accumulatedLossCents:runtime.galeRuntime.accumulatedLossCents??0,stageIndex:index,cashout:leg.cashout})*factor)))??[];}
function completeCycleProgression(runtime:TerminalRuntime,plan:BetPlanConfig|null,won:boolean){if(!plan?.cycleProgression){if(won)runtime.galeRuntime.failedCycleAttempts=0;return;}if(won){runtime.galeRuntime.failedCycleAttempts=0;return;}const next=(runtime.galeRuntime.failedCycleAttempts??0)+1;runtime.galeRuntime.failedCycleAttempts=next>=plan.cycleProgression.maxAttempts?0:next;}

function controlMetricValue(rule:TerminalControlRule,runtime:TerminalRuntime){return controlMetricValueByName(rule.metric,runtime);}
function controlMetricValueByName(metric:TerminalControlRule['metric'],runtime:TerminalRuntime){if(metric==='bankroll')return runtime.bankrollState.currentBalanceCents/100;if(metric==='lastCycleWinCount')return runtime.galeRuntime.lastCycleWinCount??0;if(metric==='lastCycleLossCount')return runtime.galeRuntime.lastCycleLossCount??0;return Number(runtime.resultAnalyzerState[metric]);}
function compareControlValue(left:number,operator:TerminalControlRule['operator'],right:number){return operator==='GT'?left>right:operator==='GTE'?left>=right:operator==='LT'?left<right:operator==='LTE'?left<=right:left===right;}
function controlMetricLabel(metric:TerminalControlRule['metric']){return{currentWinStreak:'ganhos atuais',currentLossStreak:'perdas atuais',lastClosedWinStreak:'última sequência de ganhos',lastClosedLossStreak:'última sequência de perdas',lastCycleWinCount:'WIN no último ciclo de aposta',lastCycleLossCount:'LOSS no último ciclo de aposta',winRate:'taxa de ganhos',bankroll:'saldo'}[metric];}
function controlOperatorLabel(operator:TerminalControlRule['operator']){return{GT:'maior que',GTE:'maior ou igual a',LT:'menor que',LTE:'menor ou igual a',EQ:'igual a'}[operator];}
