import type { Terminal } from '@aviator/shared';

export type TerminalDraft = Omit<Terminal, 'id' | 'createdAt' | 'updatedAt' | 'currentBankrollCents' | 'gameWins' | 'gameLosses' | 'sortOrder' | 'betStrategyWinId' | 'betStrategyLossId' | 'betPlanWinId' | 'betPlanLossId'|'controlPlayRuleIds'|'controlPauseRuleIds'|'strategySourceTerminalId'|'strategySourceMode'|'historyDisplayLimit'|'entryBlockPatterns'|'operationCombinations'> & { sortOrder?: number; betStrategyWinId?:string; betStrategyLossId?:string;betPlanWinId?:string;betPlanLossId?:string;controlPlayRuleIds?:string[];controlPauseRuleIds?:string[];strategySourceTerminalId?:string|null;strategySourceMode?:Terminal['strategySourceMode'];historyDisplayLimit?:number;entryBlockPatterns?:string[];operationCombinations?:Terminal['operationCombinations'] };

export function createTerminal(draft: TerminalDraft, id: string, now: string): Terminal {
  return {
    ...draft,
    id,
    sortOrder: draft.sortOrder ?? 0,
    strategySourceTerminalId:draft.strategySourceTerminalId??null,
    strategySourceMode:draft.strategySourceMode??'GAME_SIGNALS',
    betStrategyWinId: draft.betStrategyWinId ?? draft.betStrategyId,
    betStrategyLossId: draft.betStrategyLossId ?? draft.betStrategyId,
    betPlanWinId: draft.betPlanWinId ?? draft.betPlanId,
    betPlanLossId: draft.betPlanLossId ?? draft.betPlanId,
    controlPlayRuleIds:draft.controlPlayRuleIds??[],controlPauseRuleIds:draft.controlPauseRuleIds??[],
    historyDisplayLimit:draft.historyDisplayLimit??200,
    entryBlockPatterns:draft.entryBlockPatterns??[],
    operationCombinations:draft.operationCombinations??[],
    currentBankrollCents: draft.initialBankrollCents,
    gameWins: 0,
    gameLosses: 0,
    createdAt: now,
    updatedAt: now
  };
}

export function duplicateTerminal(source: Terminal, id: string, now: string): Terminal {
  return createTerminal({
    name: `${source.name} (cópia)`,
    sortOrder: source.sortOrder + 1,
    platformId: source.platformId,
    gameStrategyId: source.gameStrategyId,
    strategySourceTerminalId:source.strategySourceTerminalId,
    strategySourceMode:source.strategySourceMode,
    betStrategyId: source.betStrategyId,
    betStrategyWinId: source.betStrategyWinId,
    betStrategyLossId: source.betStrategyLossId,
    betPlanId: source.betPlanId,
    betPlanWinId: source.betPlanWinId,
    betPlanLossId: source.betPlanLossId,
    controlPlayRuleIds:source.controlPlayRuleIds,controlPauseRuleIds:source.controlPauseRuleIds,
    screenProfileId: source.screenProfileId,
    mode: source.mode,
    enabled: source.enabled,
    paused: true,
    historyDisplayLimit:source.historyDisplayLimit,
    entryBlockPatterns:[...source.entryBlockPatterns],
    operationCombinations:structuredClone(source.operationCombinations),
    initialBankrollCents: source.initialBankrollCents
  }, id, now);
}
