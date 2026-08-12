import { randomUUID } from 'node:crypto';
import type { GameSignal, GameStrategyConfig, MultiplierCondition, NormalizedRound, RoundAnnotation, RoundAnnotationRole, TerminalRuntime } from '@aviator/shared';

export interface GameStrategyProcessInput {
  terminalId: string;
  strategyId: string;
  config: GameStrategyConfig;
  runtime: TerminalRuntime['gameStrategyRuntime'];
  round: NormalizedRound;
}

export interface GameStrategyProcessResult {
  runtime: TerminalRuntime['gameStrategyRuntime'];
  annotation: RoundAnnotation;
  signal: GameSignal | null;
}

export class GameStrategyEngine {
  process(input: GameStrategyProcessInput): GameStrategyProcessResult {
    const { terminalId, strategyId, config, round } = input;
    const stateBefore = input.runtime.state;
    const runtime = { ...input.runtime, processedRounds: input.runtime.processedRounds + 1, lastMultiplier: round.multiplier };
    let role: RoundAnnotationRole = 'NORMAL';
    let signal: GameSignal | null = null;

    if (stateBefore === 'SEARCH_TRIGGER') {
      if (matches(round.multiplier, config.trigger)) {
        role = 'TRIGGER';
        runtime.state = 'WAIT_RESULT';
        runtime.triggerRoundId = round.id;
      }
    } else if (stateBefore === 'WAIT_RESULT') {
      if (matches(round.multiplier, config.win)) {
        role = 'WIN';
        signal = createSignal(input, 'WIN', runtime.triggerRoundId ?? round.id);
        runtime.state = 'SEARCH_TRIGGER';
        runtime.triggerRoundId = null;
      } else if (matches(round.multiplier, config.loss)) {
        role = 'LOSS';
        signal = createSignal(input, 'LOSS', runtime.triggerRoundId ?? round.id);
        if (matches(round.multiplier, config.afterLoss)) {
          runtime.state = 'WAIT_RELEASE';
        } else {
          runtime.state = 'SEARCH_TRIGGER';
          runtime.triggerRoundId = null;
        }
      }
    } else if (matches(round.multiplier, config.release)) {
      role = 'RELEASE_TRIGGER';
      runtime.state = 'WAIT_RESULT';
      runtime.triggerRoundId = round.id;
    } else {
      role = 'IGNORED';
    }

    runtime.lastAnnotationRole = role;
    return {
      runtime,
      annotation: {
        id: randomUUID(), terminalId, roundId: round.id, strategyId, role, stateBefore, stateAfter: runtime.state,
        metadata: { multiplier: round.multiplier, deliveryMode: round.deliveryMode }, createdAt: new Date().toISOString()
      },
      signal
    };
  }
}

export function matches(multiplier: number, conditions: MultiplierCondition[]): boolean {
  return conditions.length > 0 && conditions.every(condition => evaluate(multiplier, condition));
}

function evaluate(multiplier: number, condition: MultiplierCondition): boolean {
  if (condition.operator === 'BETWEEN') {
    if (!Array.isArray(condition.value)) return false;
    return multiplier >= condition.value[0] && multiplier <= condition.value[1];
  }
  if (Array.isArray(condition.value)) return false;
  switch (condition.operator) {
    case 'GT': return multiplier > condition.value;
    case 'GTE': return multiplier >= condition.value;
    case 'LT': return multiplier < condition.value;
    case 'LTE': return multiplier <= condition.value;
    case 'EQ': return multiplier === condition.value;
  }
}

function createSignal(input: GameStrategyProcessInput, result: GameSignal['result'], triggerRoundId: string): GameSignal {
  return {
    id: randomUUID(), terminalId: input.terminalId, platformId: input.round.platformId, strategyId: input.strategyId,
    triggerRoundId, resultRoundId: input.round.id, result, createdAt: new Date().toISOString(),
    metadata: { multiplier: input.round.multiplier, deliveryMode: input.round.deliveryMode }
  };
}
