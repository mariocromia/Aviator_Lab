import { randomUUID } from 'node:crypto';
import type { BetDecision, BetExecution, BetPlanConfig, BetStageEvent, BetStrategyConfig, GameSignal, GameStrategyConfig, NormalizedRound, RoundAnnotation, RoundEvent, Terminal, TerminalControlRule, TerminalMode, TerminalRuntime, TerminalSchedule } from '@aviator/shared';
import type { RoundEventBus } from '@aviator/collector';
import { GameStrategyEngine } from '@aviator/game-strategy';
import { ResultAnalyzer, createResultAnalyzerState } from '@aviator/result-analyzer';
import { BetStrategyEngine, bankrollStopReason, calculateBetAmount, createBankrollMetrics, updateBankrollMetrics } from '@aviator/bet-strategy';
import { createTerminal, duplicateTerminal, type TerminalDraft } from './terminal-factory.js';
import { evaluateTerminalSchedule } from './terminal-schedule.js';

export interface TerminalRuntimeRepository {
  listTerminals(): Terminal[];
  getTerminal(id: string): Terminal | null;
  saveTerminal(terminal: Terminal): void;
  updateTerminal(terminal: Terminal): void;
  deleteTerminal(id: string): void;
  resetTerminal(id:string,clearHistory:boolean):void;
  updateTerminalInitialBankroll(id:string,initialBankrollCents:number):void;
  setTerminalPaused(id: string, paused: boolean): void;
  getTerminalRuntime(id: string): TerminalRuntime | null;
  saveTerminalRuntime(runtime: TerminalRuntime): void;
  recordRoundReceipt(terminalId: string, round: NormalizedRound): boolean;
  getGameStrategyConfig(id: string): GameStrategyConfig | null;
  saveRoundAnnotation(annotation: RoundAnnotation): void;
  saveGameSignal(signal: GameSignal): void;
  getBetStrategyConfig(id: string): BetStrategyConfig | null;
  saveBetDecision(decision: BetDecision): void;
  updateTerminalGameStats(id: string, wins: number, losses: number): void;
  getBetPlanConfig(id: string): BetPlanConfig | null;
  getTerminalSchedule(id: string): TerminalSchedule | null;
  listTerminalControlRules():TerminalControlRule[];
  saveBetStageEvent(event: BetStageEvent): void;
  saveBetExecution(execution: BetExecution): void;
  updateTerminalBankroll(id: string, balanceCents: number): void;
}

export interface TerminalConfigurationUpdate {
  name: string;
  sortOrder?: number;
  platformId: string;
  gameStrategyId: string;
  betStrategyId: string;
  betStrategyWinId?: string;
  betStrategyLossId?: string;
  betPlanId: string;
  betPlanWinId?: string;
  betPlanLossId?: string;
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

  initialize() { for (const terminal of this.repository.listTerminals()) this.initializeTerminal(terminal); }

  createTerminal(draft: TerminalDraft): Terminal {
    const now = new Date().toISOString(); const terminal = createTerminal(draft, randomUUID(), now);
    this.repository.saveTerminal(terminal); this.initializeTerminal(terminal); return terminal;
  }

  duplicateTerminal(id: string): Terminal | null {
    const source = this.repository.getTerminal(id); if (!source) return null;
    const terminal = duplicateTerminal(source, randomUUID(), new Date().toISOString());
    this.repository.saveTerminal(terminal); this.initializeTerminal(terminal); return terminal;
  }

  updateTerminal(id: string, update: TerminalConfigurationUpdate): Terminal | null {
    const terminal = this.repository.getTerminal(id); if (!terminal) return null;
    const platformChanged = terminal.platformId !== update.platformId;
    const strategyChanged = terminal.gameStrategyId !== update.gameStrategyId;
    Object.assign(terminal, update, { updatedAt: new Date().toISOString() });
    this.repository.updateTerminal(terminal);
    const runtime = this.runtimes.get(id);
    if (runtime && strategyChanged) {
      runtime.gameStrategyRuntime.state = 'SEARCH_TRIGGER';
      runtime.gameStrategyRuntime.triggerRoundId = null;
      runtime.updatedAt = new Date().toISOString();
      this.repository.saveTerminalRuntime(runtime);
    }
    if (platformChanged && runtime?.status === 'RUNNING') this.attach(terminal);
    return terminal;
  }

  deleteTerminal(id: string) { this.unsubscribeByTerminal.get(id)?.(); this.unsubscribeByTerminal.delete(id); this.runtimes.delete(id); this.repository.deleteTerminal(id); }
  resetTerminal(id:string,clearHistory=false){const terminal=this.repository.getTerminal(id);const runtime=this.runtimes.get(id);if(!terminal)return;this.repository.resetTerminal(id,clearHistory);const refreshed=this.repository.getTerminal(id);if(!refreshed)return;if(clearHistory){this.unsubscribeByTerminal.get(id)?.();this.unsubscribeByTerminal.delete(id);const clean=createRuntime(refreshed);this.runtimes.set(id,clean);this.repository.saveTerminalRuntime(clean);if(clean.status==='RUNNING')this.attach(refreshed);return;}if(!runtime)return;runtime.bankrollState=createBankrollMetrics(refreshed.initialBankrollCents);runtime.galeRuntime.previousAmountCents=0;runtime.galeRuntime.accumulatedLossCents=0;runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);}
  updateTerminalInitialBankroll(id:string,initialBankrollCents:number){const terminal=this.repository.getTerminal(id);if(!terminal)return;this.repository.updateTerminalInitialBankroll(id,initialBankrollCents);terminal.initialBankrollCents=initialBankrollCents;terminal.currentBankrollCents=initialBankrollCents;const runtime=this.runtimes.get(id);if(runtime){runtime.bankrollState=createBankrollMetrics(initialBankrollCents);runtime.galeRuntime.previousAmountCents=0;runtime.galeRuntime.accumulatedLossCents=0;runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);}}
  pauseTerminal(id: string) { const runtime=this.runtimes.get(id);if(runtime)runtime.pauseState={type:'MANUAL',reason:'Pausa manual',ruleId:null,sourceTerminalId:null};this.repository.setTerminalPaused(id, true); this.stopRuntime(id, 'PAUSED'); }
  resumeTerminal(id: string) { const runtime=this.runtimes.get(id);if(runtime)runtime.pauseState={type:'NONE',reason:null,ruleId:null,sourceTerminalId:null};this.repository.setTerminalPaused(id, false); this.startRuntime(id); }

  async routeRoundToTerminals(round: NormalizedRound): Promise<number> {
    return this.eventBus.publish({ id: `${round.platformId}:${round.id}`, platformId: round.platformId, round, publishedAt: new Date().toISOString() });
  }

  getRuntime(id: string): TerminalRuntime | null { return this.runtimes.get(id) ?? null; }
  getRuntimes(): TerminalRuntime[] { return [...this.runtimes.values()]; }
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
    runtime.galeRuntime.preparedLegAmountsCents ??= [];
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
    const planId=rule.onWinBetPlanId??rule.betPlanId??terminal.betPlanWinId;
    const plan=this.repository.getBetPlanConfig(planId);
    if(!plan)return;
    runtime.galeRuntime={active:true,currentStage:0,cycleId:randomUUID(),activeBetPlanId:planId,onWinBetPlanId:null,followUp:true,followUpBehavior:'REPEAT_UNTIL_LOSS',triggerLossStreakTarget:runtime.galeRuntime.triggerLossStreakTarget??(runtime.resultAnalyzerState.lastClosedLossStreak||null),previousAmountCents:0,accumulatedLossCents:0,waitingSignals:0,preparedLegAmountsCents:resolveStageAmounts(runtime,plan,0),currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:runtime.galeRuntime.lastCycleWinCount??0,lastCycleLossCount:runtime.galeRuntime.lastCycleLossCount??0};
    runtime.gameStrategyRuntime.state='WAIT_RESULT';
  }

  private attach(terminal: Terminal) {
    this.unsubscribeByTerminal.get(terminal.id)?.();
    this.unsubscribeByTerminal.set(terminal.id, this.eventBus.subscribe(terminal.platformId, terminal.id, event => this.processRound(terminal.id, event)));
  }

  private processRound(terminalId: string, event: RoundEvent) {
    const runtime = this.runtimes.get(terminalId); if (!runtime) return;
    if(runtime.status==='PAUSED'&&this.isControlRulePause(runtime)){this.processPausedControlObservation(terminalId,event);return;}
    if(runtime.status !== 'RUNNING') return;
    const scheduleEvaluation=evaluateTerminalSchedule(this.repository.getTerminalSchedule(terminalId),new Date(event.round.occurredAt));
    runtime.scheduleState={allowed:scheduleEvaluation.allowed,reason:scheduleEvaluation.reason,checkedAt:new Date().toISOString()};
    if(!scheduleEvaluation.allowed){runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);return;}
    if (!this.repository.recordRoundReceipt(terminalId, event.round)) return;
    const terminal = this.repository.getTerminal(terminalId);
    const config = terminal ? this.repository.getGameStrategyConfig(terminal.gameStrategyId) : null;
    if (terminal && config) {
      const result = this.gameStrategyEngine.process({ terminalId, strategyId: terminal.gameStrategyId, config, runtime: runtime.gameStrategyRuntime, round: event.round });
      runtime.gameStrategyRuntime = result.runtime;
      this.repository.saveRoundAnnotation(result.annotation);
      if (result.signal) {
        this.repository.saveGameSignal(result.signal);
        const cycleLossStreakTarget = runtime.galeRuntime.triggerLossStreakTarget ?? null;
        let cycleClosedWithLoss=false;
        if (runtime.galeRuntime.active && runtime.galeRuntime.cycleId) {
          const activeBetPlanId = runtime.galeRuntime.activeBetPlanId ?? terminal.betPlanId;
          const betPlan = this.repository.getBetPlanConfig(activeBetPlanId);
          const stageIndex = runtime.galeRuntime.currentStage;
          const stage = betPlan?.stages[stageIndex];
          if(!isStageReady(stage?.execution,runtime,result.signal.result)){runtime.galeRuntime.waitingSignals=(runtime.galeRuntime.waitingSignals??0)+1;}else{
          runtime.galeRuntime.waitingSignals=0;
          const multiplier = Number(result.signal.metadata.multiplier ?? event.round.multiplier);
          const resolvedLegs = stage?.legs.map((leg,index)=>({...leg,resolvedAmountCents:runtime.galeRuntime.preparedLegAmountsCents?.[index]??calculateBetAmount(leg,{bankrollCents:runtime.bankrollState.currentBalanceCents,initialBankrollCents:runtime.bankrollState.initialBalanceCents,previousAmountCents:runtime.galeRuntime.previousAmountCents??0,currentLossStreak:runtime.resultAnalyzerState.currentLossStreak,lastLossStreak:runtime.resultAnalyzerState.lastClosedLossStreak,accumulatedLossCents:runtime.galeRuntime.accumulatedLossCents??0,stageIndex,cashout:leg.cashout})}))??[];
          const stakeCents = resolvedLegs.reduce((total, leg) => total + leg.resolvedAmountCents, 0);
          const bankrollBeforeCents = runtime.bankrollState.currentBalanceCents;
          const limitReason=bankrollStopReason(runtime.bankrollState,stakeCents,betPlan?.bankrollLimits);
          const canSettle = stakeCents > 0 && !limitReason;
          const returnedCents = canSettle ? resolvedLegs.reduce((total, leg) => total + (multiplier >= leg.cashout ? Math.round(leg.resolvedAmountCents * leg.cashout) : 0), 0) : 0;
          const profitLossCents = canSettle ? returnedCents - stakeCents : 0;
          const stageResult = canSettle && profitLossCents > 0 ? 'WIN' : 'LOSS';
          const bankrollAfterCents = bankrollBeforeCents + profitLossCents;
          const stageLabel = stage?.label ?? (stageIndex === 0 ? 'BASE' : `GALE ${stageIndex}`);
          const createdAt = new Date().toISOString();
          this.repository.saveBetStageEvent({ id: randomUUID(), cycleId: runtime.galeRuntime.cycleId, terminalId, gameSignalId: result.signal.id, stageIndex, stageLabel, result: stageResult, createdAt });
          this.repository.saveBetExecution({ id: randomUUID(), cycleId: runtime.galeRuntime.cycleId, terminalId, gameSignalId: result.signal.id, stageIndex, stageLabel, multiplier, stakeCents, returnedCents, profitLossCents, bankrollBeforeCents, bankrollAfterCents, result: stageResult, createdAt });
          runtime.bankrollState = updateBankrollMetrics(runtime.bankrollState,profitLossCents,stakeCents,betPlan?.bankrollLimits);
          runtime.galeRuntime.previousAmountCents=stakeCents;
          runtime.galeRuntime.accumulatedLossCents=profitLossCents<0?(runtime.galeRuntime.accumulatedLossCents??0)-profitLossCents:0;
          const cycleWinCount=(runtime.galeRuntime.currentCycleWinCount??0)+(stageResult==='WIN'?1:0);
          const cycleLossCount=(runtime.galeRuntime.currentCycleLossCount??0)+(stageResult==='LOSS'?1:0);
          runtime.galeRuntime.currentCycleWinCount=cycleWinCount;
          runtime.galeRuntime.currentCycleLossCount=cycleLossCount;
          const closedCycleCounts={currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:cycleWinCount,lastCycleLossCount:cycleLossCount};
          this.repository.updateTerminalBankroll(terminalId, bankrollAfterCents);
          if(limitReason||runtime.bankrollState.stopReason){runtime.status='PAUSED';runtime.pauseState={type:'RULE',reason:limitReason??runtime.bankrollState.stopReason,ruleId:null,sourceTerminalId:terminalId};this.unsubscribeByTerminal.get(terminalId)?.();this.unsubscribeByTerminal.delete(terminalId);}
          if (runtime.galeRuntime.followUp && runtime.galeRuntime.followUpBehavior === 'REPEAT_UNTIL_LOSS' && result.signal.result === 'LOSS') {
            // "AtÃ© LOSS" se refere ao sinal W/L da estratÃ©gia de jogo, nÃ£o ao
            // lucro lÃ­quido da aposta dupla. Um sinal L pode ainda dar pequeno
            // lucro em uma perna de 1,35x, mas mesmo assim encerra o pÃ³s-WIN.
            runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
            cycleClosedWithLoss=true;
          } else if (stageResult === 'WIN') {
            const repeatFollowUp = runtime.galeRuntime.followUp && runtime.galeRuntime.followUpBehavior === 'REPEAT_UNTIL_LOSS';
            const nextPlanId = repeatFollowUp ? activeBetPlanId : runtime.galeRuntime.followUp ? null : runtime.galeRuntime.onWinBetPlanId;
            if (nextPlanId && this.repository.getBetPlanConfig(nextPlanId)) {
              runtime.galeRuntime = { active: true, currentStage: 0, cycleId: randomUUID(), activeBetPlanId: nextPlanId, onWinBetPlanId: null, followUp: true, followUpBehavior: runtime.galeRuntime.followUpBehavior, triggerLossStreakTarget: cycleLossStreakTarget,...closedCycleCounts };
              // O plano pós-WIN aposta na rodada imediatamente seguinte. A
              // rodada não precisa abrir outro gatilho antes de ser avaliada.
              runtime.gameStrategyRuntime.state='WAIT_RESULT';
              runtime.gameStrategyRuntime.triggerRoundId=result.signal.resultRoundId;
              const amountsCents=resolveStageAmounts(runtime,this.repository.getBetPlanConfig(nextPlanId),0);runtime.galeRuntime.preparedLegAmountsCents=amountsCents;
              void this.assistedPreparationHandler?.({ terminalId, deliveryMode: event.round.deliveryMode, stageIndex: 0, betPlanId: nextPlanId,amountsCents });
            } else {
              runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
            }
          } else if (runtime.galeRuntime.followUp && runtime.galeRuntime.followUpBehavior === 'REPEAT_UNTIL_LOSS') {
            runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
          } else if (stageIndex + 1 >= (betPlan?.stages.length ?? 1)) {
            runtime.galeRuntime = { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:cycleLossStreakTarget,...closedCycleCounts };
            cycleClosedWithLoss=result.signal.result==='LOSS';
          } else {
            runtime.galeRuntime.currentStage++;
            runtime.galeRuntime.waitingSignals=0;
            const amountsCents=resolveStageAmounts(runtime,betPlan,runtime.galeRuntime.currentStage,stageResult==='LOSS'?1:0);runtime.galeRuntime.preparedLegAmountsCents=amountsCents;
            void this.assistedPreparationHandler?.({ terminalId, deliveryMode: event.round.deliveryMode, stageIndex: runtime.galeRuntime.currentStage, betPlanId: activeBetPlanId,amountsCents });
          }
          }
        }
        runtime.resultAnalyzerState = this.resultAnalyzer.process(runtime.resultAnalyzerState, result.signal.result);
        if(!runtime.galeRuntime.active){
          if(result.signal.result==='WIN'){
            runtime.galeRuntime.triggerLossStreakTarget=runtime.resultAnalyzerState.lastClosedLossStreak||runtime.galeRuntime.triggerLossStreakTarget||null;
            runtime.galeRuntime.triggerLossProgress=0;
          }else{
            runtime.galeRuntime.triggerLossProgress=cycleClosedWithLoss?1:(runtime.galeRuntime.triggerLossProgress??0)+1;
          }
        }
        this.repository.updateTerminalGameStats(terminal.id, runtime.resultAnalyzerState.winCount, runtime.resultAnalyzerState.lossCount);
        const selectedBetStrategyId = result.signal.result==='WIN' ? terminal.betStrategyWinId : terminal.betStrategyLossId;
        const betConfig = this.repository.getBetStrategyConfig(selectedBetStrategyId);
        if (betConfig) {
          let decision = this.betStrategyEngine.decide({ terminalId, betStrategyId: selectedBetStrategyId, config: betConfig, signal: result.signal, analyzer: runtime.resultAnalyzerState, bankrollCents: runtime.bankrollState.currentBalanceCents });
          if(result.signal.result==='LOSS'&&!runtime.galeRuntime.active){
            const target=runtime.galeRuntime.triggerLossStreakTarget??runtime.resultAnalyzerState.lastClosedLossStreak;
            const progress=runtime.galeRuntime.triggerLossProgress??0;
            const canArmNext=target>0&&progress>=Math.max(0,target-1);
            const projectedAnalyzer={...runtime.resultAnalyzerState,currentLossStreak:canArmNext?target:progress,lastClosedLossStreak:target};
            const projectedDecision=this.betStrategyEngine.decide({terminalId,betStrategyId:selectedBetStrategyId,config:betConfig,signal:result.signal,analyzer:projectedAnalyzer,bankrollCents:runtime.bankrollState.currentBalanceCents});
            const projectedRule=betConfig.rules.find(rule=>rule.id===projectedDecision.ruleId);
            const dynamicLossEntry=canArmNext&&projectedRule?.action==='ENTER'&&projectedRule.conditions.some(condition=>condition.field==='currentLossStreak'&&condition.referenceField==='lastClosedLossStreak');
            if(dynamicLossEntry)decision={...projectedDecision,metadata:{...projectedDecision.metadata,analyzer:runtime.resultAnalyzerState,prospectiveLossEntry:true,triggerLossStreakTarget:target,observedLossProgress:runtime.galeRuntime.triggerLossProgress}};
            else if(betConfig.rules.some(rule=>rule.enabled&&rule.conditions.some(condition=>condition.field==='currentLossStreak'&&condition.referenceField==='lastClosedLossStreak')))decision={...decision,action:'IGNORE',ruleId:null,metadata:{...decision.metadata,triggerLossStreakTarget:target,observedLossProgress:runtime.galeRuntime.triggerLossProgress}};
          }
          if(decision.action==='IGNORE'&&result.signal.result==='WIN'&&!runtime.galeRuntime.active){
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
          if (decision.action === 'ENTER' && runtime.status==='RUNNING' && !runtime.galeRuntime.active) {
            const resultPlanId=result.signal.result==='WIN'?terminal.betPlanWinId:terminal.betPlanLossId;
            const requestedPlanId = typeof decision.metadata.betPlanId === 'string' ? decision.metadata.betPlanId : resultPlanId;
            const activeBetPlanId = this.repository.getBetPlanConfig(requestedPlanId) ? requestedPlanId : resultPlanId;
            const winContinuationRule=this.repository.getBetStrategyConfig(terminal.betStrategyWinId)?.rules.find(rule=>rule.enabled&&rule.action==='ENTER'&&rule.onWinPlanBehavior==='REPEAT_UNTIL_LOSS');
            const configuredOnWinPlanId=typeof decision.metadata.onWinBetPlanId==='string'?decision.metadata.onWinBetPlanId:winContinuationRule?.onWinBetPlanId??winContinuationRule?.betPlanId??(winContinuationRule?terminal.betPlanWinId:null);
            const onWinBetPlanId = configuredOnWinPlanId&&this.repository.getBetPlanConfig(configuredOnWinPlanId) ? configuredOnWinPlanId : null;
            const followUpBehavior = decision.metadata.onWinPlanBehavior === 'REPEAT_UNTIL_LOSS'||winContinuationRule?.onWinPlanBehavior==='REPEAT_UNTIL_LOSS' ? 'REPEAT_UNTIL_LOSS' : 'RUN_ONCE';
            const matchedRule=betConfig.rules.find(rule=>rule.id===decision.ruleId);
            const triggerLossStreakTarget=matchedRule?.conditions.some(condition=>condition.field==='currentLossStreak'&&condition.referenceField==='lastClosedLossStreak')?(Number(decision.metadata.triggerLossStreakTarget)||runtime.galeRuntime.triggerLossStreakTarget||runtime.resultAnalyzerState.lastClosedLossStreak):runtime.galeRuntime.triggerLossStreakTarget??null;
            runtime.galeRuntime = { active: true, currentStage: 0, cycleId: randomUUID(), activeBetPlanId, onWinBetPlanId, followUp: false, followUpBehavior, triggerLossStreakTarget,triggerLossProgress:runtime.galeRuntime.triggerLossProgress??0,currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:runtime.galeRuntime.lastCycleWinCount??0,lastCycleLossCount:runtime.galeRuntime.lastCycleLossCount??0 };
            if(decision.metadata.prospectiveWinEntry===true){runtime.gameStrategyRuntime.state='WAIT_RESULT';runtime.gameStrategyRuntime.triggerRoundId=result.signal.resultRoundId;}
            const amountsCents=resolveStageAmounts(runtime,this.repository.getBetPlanConfig(activeBetPlanId),0);runtime.galeRuntime.preparedLegAmountsCents=amountsCents;
            void this.assistedPreparationHandler?.({ terminalId, deliveryMode: event.round.deliveryMode, stageIndex: 0, betPlanId: activeBetPlanId,amountsCents });
          }
        }
      }
      this.evaluateControlRules(terminalId);
    } else {
      runtime.gameStrategyRuntime.processedRounds++;
      runtime.gameStrategyRuntime.lastMultiplier = event.round.multiplier;
    }
    runtime.lastProcessedRoundId = event.round.id;
    runtime.updatedAt = new Date().toISOString();
    this.repository.saveTerminalRuntime(runtime);
  }

  private evaluateControlRules(sourceTerminalId:string){
    const all=this.repository.listTerminalControlRules().filter(rule=>rule.enabled);const affected=new Set(all.filter(rule=>rule.sourceTerminalId===sourceTerminalId).map(rule=>rule.targetTerminalId));
    for(const targetId of affected){const runtime=this.runtimes.get(targetId);if(!runtime||runtime.pauseState.type==='MANUAL')continue;const current=runtime.pauseState.ruleId?all.find(rule=>rule.id===runtime.pauseState.ruleId):undefined;if(current?.action==='PAUSE'&&current.resumeMetric&&current.resumeOperator&&current.resumeValue!=null){const source=this.runtimes.get(current.sourceTerminalId);if(source&&!compareControlValue(controlMetricValueByName(current.resumeMetric,source),current.resumeOperator,current.resumeReferenceMetric?controlMetricValueByName(current.resumeReferenceMetric,source):current.resumeValue))continue;}
      const pause=all.filter(rule=>rule.targetTerminalId===targetId&&rule.action==='PAUSE').find(rule=>{const source=this.runtimes.get(rule.sourceTerminalId);return source&&compareControlValue(controlMetricValue(rule,source),rule.operator,rule.referenceMetric?controlMetricValueByName(rule.referenceMetric,source):rule.value)});if(pause){this.applyRulePause(targetId,pause);continue;}
      const legacyResume=all.filter(rule=>rule.targetTerminalId===targetId&&rule.action==='RESUME').find(rule=>{const source=this.runtimes.get(rule.sourceTerminalId);return source&&compareControlValue(controlMetricValue(rule,source),rule.operator,rule.referenceMetric?controlMetricValueByName(rule.referenceMetric,source):rule.value)});if((current?.resumeMetric&&current.resumeOperator&&current.resumeValue!=null)||legacyResume)this.applyRuleResume(targetId);
    }
  }

  private applyRulePause(targetId:string,rule:TerminalControlRule){const runtime=this.runtimes.get(targetId);if(!runtime||runtime.pauseState.type==='MANUAL')return;const comparedWith=rule.referenceMetric?controlMetricLabel(rule.referenceMetric):String(rule.value);runtime.pauseState={type:'RULE',reason:`${rule.name}: ${controlMetricLabel(rule.metric)} ${controlOperatorLabel(rule.operator)} ${comparedWith}`,ruleId:rule.id,sourceTerminalId:rule.sourceTerminalId};runtime.status='PAUSED';runtime.updatedAt=new Date().toISOString();const terminal=this.repository.getTerminal(targetId);if(terminal&&!this.unsubscribeByTerminal.has(targetId))this.attach(terminal);this.repository.saveTerminalRuntime(runtime);}
  private applyRuleResume(targetId:string){const terminal=this.repository.getTerminal(targetId);const runtime=this.runtimes.get(targetId);if(!terminal||!runtime||terminal.paused||runtime.pauseState.type!=='RULE')return;runtime.pauseState={type:'NONE',reason:null,ruleId:null,sourceTerminalId:null};this.startRuntime(targetId);}
  private isControlRulePause(runtime:TerminalRuntime){return runtime.pauseState.type==='RULE'&&runtime.pauseState.ruleId!==null&&this.repository.listTerminalControlRules().some(rule=>rule.id===runtime.pauseState.ruleId);}
  private processPausedControlObservation(terminalId:string,event:RoundEvent){const runtime=this.runtimes.get(terminalId);const terminal=this.repository.getTerminal(terminalId);const config=terminal?this.repository.getGameStrategyConfig(terminal.gameStrategyId):null;if(!runtime||!terminal||!config||!this.repository.recordRoundReceipt(terminalId,event.round))return;const result=this.gameStrategyEngine.process({terminalId,strategyId:terminal.gameStrategyId,config,runtime:runtime.gameStrategyRuntime,round:event.round});runtime.gameStrategyRuntime=result.runtime;this.repository.saveRoundAnnotation(result.annotation);if(result.signal){this.repository.saveGameSignal(result.signal);runtime.resultAnalyzerState=this.resultAnalyzer.process(runtime.resultAnalyzerState,result.signal.result);this.repository.updateTerminalGameStats(terminal.id,runtime.resultAnalyzerState.winCount,runtime.resultAnalyzerState.lossCount);this.evaluateControlRules(terminalId);}runtime.lastProcessedRoundId=event.round.id;runtime.updatedAt=new Date().toISOString();this.repository.saveTerminalRuntime(runtime);}
}

export function createRuntime(terminal: Terminal): TerminalRuntime {
  return { terminalId: terminal.id, gameStrategyRuntime: { state: 'SEARCH_TRIGGER', processedRounds: 0, lastMultiplier: null, triggerRoundId: null, lastAnnotationRole:null }, resultAnalyzerState: createResultAnalyzerState(), betStrategyRuntime: { lastDecisionId: null, lastAction: null, decisionCount: 0, entryCount: 0, ignoredCount: 0 }, galeRuntime: { active: false, currentStage: 0, cycleId: null, activeBetPlanId: null, onWinBetPlanId: null, followUp: false, followUpBehavior: 'RUN_ONCE', triggerLossStreakTarget:null,triggerLossProgress:0, previousAmountCents:0, accumulatedLossCents:0, waitingSignals:0, preparedLegAmountsCents:[],currentCycleWinCount:0,currentCycleLossCount:0,lastCycleWinCount:0,lastCycleLossCount:0 }, bankrollState: createBankrollMetrics(terminal.initialBankrollCents), screenControllerState: { status: 'IDLE', paused: false }, scheduleState:{allowed:true,reason:null,checkedAt:null},pauseState:{type:terminal.paused?'MANUAL':'NONE',reason:terminal.paused?'Pausa manual':null,ruleId:null,sourceTerminalId:null}, lastProcessedRoundId: null, status: terminal.paused ? 'PAUSED' : 'RUNNING', updatedAt: new Date().toISOString() };
}

function normalizeBankrollState(state:Partial<TerminalRuntime['bankrollState']>,initial:number):TerminalRuntime['bankrollState']{const base=createBankrollMetrics(state.initialBalanceCents??initial);const current=state.currentBalanceCents??base.currentBalanceCents;const peak=state.peakBalanceCents??Math.max(base.initialBalanceCents,current);return{...base,...state,currentBalanceCents:current,peakBalanceCents:peak,profitCents:state.profitCents??current-base.initialBalanceCents,roi:state.roi??(base.initialBalanceCents?(current-base.initialBalanceCents)/base.initialBalanceCents*100:0),drawdownCents:state.drawdownCents??peak-current,maxDrawdownCents:state.maxDrawdownCents??peak-current,currentExposureCents:state.currentExposureCents??0,maximumExposureCents:state.maximumExposureCents??0,stopReason:state.stopReason??null};}
function normalizeAnalyzerStreaksFromPattern(runtime:TerminalRuntime){const pattern=runtime.resultAnalyzerState.recentPattern;const currentLoss=pattern.match(/L+$/)?.[0].length??0;const currentWin=pattern.match(/W+$/)?.[0].length??0;const closedLossBlocks=[...pattern.matchAll(/L+(?=W)/g)];const lastClosedLoss=closedLossBlocks.at(-1)?.[0].length;runtime.resultAnalyzerState.currentLossStreak=currentLoss;runtime.resultAnalyzerState.currentWinStreak=currentWin;if(lastClosedLoss!==undefined)runtime.resultAnalyzerState.lastClosedLossStreak=lastClosedLoss;}
function isStageReady(execution:BetPlanConfig['stages'][number]['execution'],runtime:TerminalRuntime,result:'WIN'|'LOSS'){if(!execution||execution.policy==='NEXT_VALID_SIGNAL')return true;if(execution.policy==='AFTER_N_SIGNALS')return(runtime.galeRuntime.waitingSignals??0)+1>=Math.max(1,execution.signalCount??1);if(execution.policy==='AFTER_PATTERN'){const pattern=(execution.pattern??'').toUpperCase();return pattern.length>0&&`${runtime.resultAnalyzerState.recentPattern}${result[0]}`.endsWith(pattern);}if(!execution.condition)return false;const condition=execution.condition;const left=condition.field==='bankroll'?runtime.bankrollState.currentBalanceCents:Number(runtime.resultAnalyzerState[condition.field]);const right=condition.referenceField?(condition.referenceField==='bankroll'?runtime.bankrollState.currentBalanceCents:Number(runtime.resultAnalyzerState[condition.referenceField])):condition.value;if(typeof left!=='number'||typeof right!=='number')return false;return condition.operator==='GT'?left>right:condition.operator==='GTE'?left>=right:condition.operator==='LT'?left<right:condition.operator==='LTE'?left<=right:left===right;}
function resolveStageAmounts(runtime:TerminalRuntime,plan:BetPlanConfig|null,index:number,lossOffset=0){return plan?.stages[index]?.legs.map(leg=>calculateBetAmount(leg,{bankrollCents:runtime.bankrollState.currentBalanceCents,initialBankrollCents:runtime.bankrollState.initialBalanceCents,previousAmountCents:runtime.galeRuntime.previousAmountCents??0,currentLossStreak:runtime.resultAnalyzerState.currentLossStreak+lossOffset,lastLossStreak:runtime.resultAnalyzerState.lastClosedLossStreak,accumulatedLossCents:runtime.galeRuntime.accumulatedLossCents??0,stageIndex:index,cashout:leg.cashout}))??[];}

function controlMetricValue(rule:TerminalControlRule,runtime:TerminalRuntime){return controlMetricValueByName(rule.metric,runtime);}
function controlMetricValueByName(metric:TerminalControlRule['metric'],runtime:TerminalRuntime){if(metric==='bankroll')return runtime.bankrollState.currentBalanceCents/100;if(metric==='lastCycleWinCount')return runtime.galeRuntime.lastCycleWinCount??0;if(metric==='lastCycleLossCount')return runtime.galeRuntime.lastCycleLossCount??0;return Number(runtime.resultAnalyzerState[metric]);}
function compareControlValue(left:number,operator:TerminalControlRule['operator'],right:number){return operator==='GT'?left>right:operator==='GTE'?left>=right:operator==='LT'?left<right:operator==='LTE'?left<=right:left===right;}
function controlMetricLabel(metric:TerminalControlRule['metric']){return{currentWinStreak:'ganhos atuais',currentLossStreak:'perdas atuais',lastClosedWinStreak:'última sequência de ganhos',lastClosedLossStreak:'última sequência de perdas',lastCycleWinCount:'WIN no último ciclo de aposta',lastCycleLossCount:'LOSS no último ciclo de aposta',winRate:'taxa de ganhos',bankroll:'saldo'}[metric];}
function controlOperatorLabel(operator:TerminalControlRule['operator']){return{GT:'maior que',GTE:'maior ou igual a',LT:'menor que',LTE:'menor ou igual a',EQ:'igual a'}[operator];}
