import type { BacktestReport, BacktestRun, BetPlanConfig, BetStrategyConfig, GameStrategyConfig, NormalizedRound, SimulationTraceItem, TerminalRuntime } from '@aviator/shared';
import { GameStrategyEngine } from '@aviator/game-strategy';
import { BetStrategyEngine, bankrollStopReason, calculateBetAmount, createBankrollMetrics, updateBankrollMetrics } from '@aviator/bet-strategy';
import { createResultAnalyzerState, ResultAnalyzer } from '@aviator/result-analyzer';

export interface SimulationInput {
  rounds: NormalizedRound[];
  gameStrategyId: string;
  gameStrategy: GameStrategyConfig;
  betStrategyId: string;
  betStrategy: BetStrategyConfig;
  betPlan: BetPlanConfig;
  initialBankrollCents: number;
}

export class SimulationEngine {
  private readonly gameEngine = new GameStrategyEngine();
  private readonly analyzer = new ResultAnalyzer();
  private readonly betEngine = new BetStrategyEngine();

  run(input: SimulationInput): BacktestRun {
    const rounds = [...input.rounds].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    let gameRuntime: TerminalRuntime['gameStrategyRuntime'] = { state: 'SEARCH_TRIGGER', processedRounds: 0, lastMultiplier: null, triggerRoundId: null, releaseProgress: 0 };
    let analyzerState = createResultAnalyzerState();
    let bankroll = input.initialBankrollCents;
    let bankrollMetrics = createBankrollMetrics(bankroll);
    let previousAmountCents = 0;
    let accumulatedLossCents = 0;
    let stoppedByLimit: string | null = null;
    let activeStage: number | null = null;
    let waitingSignals = 0;
    const trace: SimulationTraceItem[] = [];
    const counters = { gameSignals: 0, gameWins: 0, gameLosses: 0, betEntries: 0, ignored: 0, winDirect: 0, winG1: 0, winG2: 0, winG3: 0, lossFinal: 0 };

    for (const round of rounds) {
      const game = this.gameEngine.process({ terminalId: 'simulation', strategyId: input.gameStrategyId, config: input.gameStrategy, runtime: gameRuntime, round });
      gameRuntime = game.runtime;
      let decisionAction: SimulationTraceItem['decisionAction'] = null;
      let stageLabel: string | null = null;
      let stageResult: SimulationTraceItem['stageResult'] = null;
      let stageProfitLossCents = 0;

      if (game.signal) {
        counters.gameSignals++;
        if (game.signal.result === 'WIN') counters.gameWins++; else counters.gameLosses++;
        if (activeStage !== null) {
          const stage = input.betPlan.stages[activeStage];
          if (stage) {
            if(!simulationStageReady(stage.execution,waitingSignals,analyzerState,game.signal.result,bankroll)){waitingSignals++;}else{
            waitingSignals=0;
            const resolvedLegs = stage.legs.map(leg => ({...leg, resolvedAmountCents: calculateBetAmount(leg,{bankrollCents:bankroll,initialBankrollCents:input.initialBankrollCents,previousAmountCents,currentLossStreak:analyzerState.currentLossStreak,lastLossStreak:analyzerState.lastClosedLossStreak,accumulatedLossCents,stageIndex:activeStage!,cashout:leg.cashout})}));
            const stake = resolvedLegs.reduce((sum, leg) => sum + leg.resolvedAmountCents, 0);
            stoppedByLimit = bankrollStopReason(bankrollMetrics, stake, input.betPlan.bankrollLimits);
            if (!stoppedByLimit) {
              const returned = resolvedLegs.reduce((sum, leg) => sum + (round.multiplier >= leg.cashout ? Math.round(leg.resolvedAmountCents * leg.cashout) : 0), 0);
              stageProfitLossCents = returned - stake;
              bankroll += stageProfitLossCents;
              previousAmountCents = stake;
              accumulatedLossCents = stageProfitLossCents < 0 ? accumulatedLossCents - stageProfitLossCents : 0;
              bankrollMetrics = updateBankrollMetrics(bankrollMetrics, stageProfitLossCents, stake, input.betPlan.bankrollLimits);
              stoppedByLimit = bankrollMetrics.stopReason;
              stageLabel = stage.label;
              stageResult = stageProfitLossCents > 0 ? 'WIN' : 'LOSS';
              if (stageResult === 'WIN') {
                if (activeStage === 0) counters.winDirect++;
                else if (activeStage === 1) counters.winG1++;
                else if (activeStage === 2) counters.winG2++;
                else counters.winG3++;
                activeStage = null;
              } else if (activeStage + 1 < input.betPlan.stages.length) activeStage++;
              else { counters.lossFinal++; activeStage = null; }
            } else { counters.lossFinal++; stageLabel = stage.label; stageResult = 'LOSS'; activeStage = null; }
            }
          }
        }

        analyzerState = this.analyzer.process(analyzerState, game.signal.result);
        const decision = this.betEngine.decide({ terminalId: 'simulation', betStrategyId: input.betStrategyId, config: input.betStrategy, signal: game.signal, analyzer: analyzerState, bankrollCents: bankroll });
        decisionAction = decision.action;
        if (decision.action === 'ENTER' && activeStage === null && !stoppedByLimit) { activeStage = 0; counters.betEntries++; }
        else if (decision.action === 'IGNORE') counters.ignored++;
      }

      trace.push({ roundId: round.id, occurredAt: round.occurredAt, multiplier: round.multiplier, annotationRole: game.annotation.role, strategyState: gameRuntime.state, gameResult: game.signal?.result ?? null, decisionAction, stageLabel, stageResult, stageProfitLossCents, bankrollCents: bankroll });
    }

    const profit = bankroll - input.initialBankrollCents;
    const report: BacktestReport = { totalRounds: rounds.length, ...counters, initialBankrollCents: input.initialBankrollCents, finalBankrollCents: bankroll, profitCents: profit, roi: input.initialBankrollCents ? profit / input.initialBankrollCents * 100 : 0, maxDrawdownCents: bankrollMetrics.maxDrawdownCents, maximumExposureCents: bankrollMetrics.maximumExposureCents, winRate: counters.betEntries ? (counters.winDirect+counters.winG1+counters.winG2+counters.winG3)/counters.betEntries*100 : 0, averageProfitPerEntryCents: counters.betEntries ? Math.round(profit/counters.betEntries) : 0, longestWinStreak: analyzerState.maxWinStreak, longestLossStreak: analyzerState.maxLossStreak, stoppedByLimit, bankrupt: bankroll <= 0 };
    return { report, trace };
  }
}

function simulationStageReady(execution:BetPlanConfig['stages'][number]['execution'],waiting:number,analyzer:ReturnType<typeof createResultAnalyzerState>,result:'WIN'|'LOSS',bankroll:number){if(!execution||execution.policy==='NEXT_VALID_SIGNAL')return true;if(execution.policy==='AFTER_N_SIGNALS')return waiting+1>=Math.max(1,execution.signalCount??1);if(execution.policy==='AFTER_PATTERN')return Boolean(execution.pattern&&`${analyzer.recentPattern}${result[0]}`.endsWith(execution.pattern.toUpperCase()));if(!execution.condition)return false;const condition=execution.condition;const left=condition.field==='bankroll'?bankroll:analyzer[condition.field];const right=condition.referenceField?(condition.referenceField==='bankroll'?bankroll:analyzer[condition.referenceField]):condition.value;if(typeof left!=='number'||typeof right!=='number')return false;return condition.operator==='GT'?left>right:condition.operator==='GTE'?left>=right:condition.operator==='LT'?left<right:condition.operator==='LTE'?left<=right:left===right;}
