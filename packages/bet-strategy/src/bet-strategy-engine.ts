import { randomUUID } from 'node:crypto';
import type { BetCondition, BetDecision, BetRule, BetStrategyConfig, GameSignal, ResultAnalyzerState } from '@aviator/shared';
import { PatternEngine } from './pattern-engine.js';

export interface BetStrategyInput {
  terminalId: string;
  betStrategyId: string;
  config: BetStrategyConfig;
  signal: GameSignal;
  analyzer: ResultAnalyzerState;
  bankrollCents: number;
}

export class BetStrategyEngine {
  constructor(private readonly patternEngine = new PatternEngine()) {}

  decide(input: BetStrategyInput): BetDecision {
    const evaluations: Array<{ ruleId: string; matched: boolean; conditions: boolean[] }> = [];
    let selected: BetRule | null = null;
    for (const rule of [...input.config.rules].filter(rule => rule.enabled).sort((a, b) => a.priority - b.priority)) {
      const conditionResults = rule.conditions.map(condition => this.evaluateCondition(condition, input.analyzer, input.bankrollCents));
      const matched = conditionResults.length > 0 && conditionResults.every(Boolean);
      evaluations.push({ ruleId: rule.id, matched, conditions: conditionResults });
      if (matched) { selected = rule; break; }
    }
    return {
      id: randomUUID(), terminalId: input.terminalId, platformId: input.signal.platformId, betStrategyId: input.betStrategyId,
      gameSignalId: input.signal.id, ruleId: selected?.id ?? null, action: selected?.action ?? 'IGNORE', createdAt: new Date().toISOString(),
      metadata: { evaluations, analyzer: input.analyzer, bankrollCents: input.bankrollCents, betPlanId: selected?.betPlanId ?? null, onWinBetPlanId: selected?.onWinBetPlanId ?? null, onWinPlanBehavior: selected?.onWinPlanBehavior ?? 'RUN_ONCE' }
    };
  }

  private evaluateCondition(condition: BetCondition, analyzer: ResultAnalyzerState, bankrollCents: number): boolean {
    const left = condition.field === 'bankroll' ? bankrollCents : analyzer[condition.field];
    const right = condition.referenceField == null
      ? condition.value
      : condition.referenceField === 'bankroll' ? bankrollCents : analyzer[condition.referenceField];
    if (condition.operator === 'MATCHES') return typeof left === 'string' && typeof right === 'string' && this.patternEngine.matches(left, right);
    if (condition.operator === 'BETWEEN') return typeof left === 'number' && Array.isArray(right) && left >= right[0] && left <= right[1];
    if (Array.isArray(right) || right == null) return false;
    switch (condition.operator) {
      case 'EQ': return left === right;
      case 'GT': return typeof left === 'number' && typeof right === 'number' && left > right;
      case 'GTE': return typeof left === 'number' && typeof right === 'number' && left >= right;
      case 'LT': return typeof left === 'number' && typeof right === 'number' && left < right;
      case 'LTE': return typeof left === 'number' && typeof right === 'number' && left <= right;
    }
  }
}
