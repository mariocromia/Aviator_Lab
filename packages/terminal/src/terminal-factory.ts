import type { Terminal } from '@aviator/shared';

export type TerminalDraft = Omit<Terminal, 'id' | 'createdAt' | 'updatedAt' | 'currentBankrollCents' | 'gameWins' | 'gameLosses' | 'sortOrder' | 'betStrategyWinId' | 'betStrategyLossId' | 'betPlanWinId' | 'betPlanLossId'> & { sortOrder?: number; betStrategyWinId?:string; betStrategyLossId?:string;betPlanWinId?:string;betPlanLossId?:string };

export function createTerminal(draft: TerminalDraft, id: string, now: string): Terminal {
  return {
    ...draft,
    id,
    sortOrder: draft.sortOrder ?? 0,
    betStrategyWinId: draft.betStrategyWinId ?? draft.betStrategyId,
    betStrategyLossId: draft.betStrategyLossId ?? draft.betStrategyId,
    betPlanWinId: draft.betPlanWinId ?? draft.betPlanId,
    betPlanLossId: draft.betPlanLossId ?? draft.betPlanId,
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
    betStrategyId: source.betStrategyId,
    betStrategyWinId: source.betStrategyWinId,
    betStrategyLossId: source.betStrategyLossId,
    betPlanId: source.betPlanId,
    betPlanWinId: source.betPlanWinId,
    betPlanLossId: source.betPlanLossId,
    screenProfileId: source.screenProfileId,
    mode: source.mode,
    enabled: source.enabled,
    paused: true,
    initialBankrollCents: source.initialBankrollCents
  }, id, now);
}
