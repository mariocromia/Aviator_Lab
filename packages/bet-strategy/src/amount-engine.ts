import type { AmountCalculationContext, AmountStrategyConfig, BankrollLimitsConfig, BankrollMetrics, BetLegConfig } from '@aviator/shared';

const ALLOWED_VARIABLES: Record<string, keyof AmountCalculationContext> = {
  banca: 'bankrollCents', bancaInicial: 'initialBankrollCents', valorAnterior: 'previousAmountCents',
  lossAtual: 'currentLossStreak', ultimoLoss: 'lastLossStreak', perdaAcumulada: 'accumulatedLossCents',
  etapa: 'stageIndex', cashout: 'cashout'
};

export function calculateBetAmount(leg: BetLegConfig, context: AmountCalculationContext): number {
  const strategy = leg.amountStrategy ?? { type: 'FIXED', fixedCents: leg.amountCents };
  let amount: number;
  switch (strategy.type) {
    case 'FIXED': amount = strategy.fixedCents ?? leg.amountCents; break;
    case 'BANKROLL_PERCENTAGE': amount = context.bankrollCents * (strategy.percentage ?? 1) / 100; break;
    case 'PREVIOUS_AMOUNT_MULTIPLIER': amount = (context.previousAmountCents || strategy.baseCents || leg.amountCents) * (strategy.multiplier ?? 2); break;
    case 'CURRENT_LOSS_STREAK': amount = (strategy.baseCents ?? leg.amountCents) * Math.max(1, context.currentLossStreak); break;
    case 'LAST_LOSS_STREAK': amount = (strategy.baseCents ?? leg.amountCents) * Math.max(1, context.lastLossStreak); break;
    case 'MANUAL_TABLE': amount = tableValue(strategy, context.stageIndex, leg.amountCents); break;
    case 'RECOVERY_TARGET': {
      const target = context.accumulatedLossCents + (strategy.recoveryTargetCents ?? 0);
      amount = context.cashout > 1 ? target / (context.cashout - 1) : leg.amountCents;
      break;
    }
    case 'FORMULA': amount = evaluateFormula(strategy.formula ?? '0', context); break;
  }
  const min = Math.max(1, strategy.minCents ?? 1);
  const max = Math.max(min, strategy.maxCents ?? Number.MAX_SAFE_INTEGER);
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(amount) ? amount : leg.amountCents)));
}

function tableValue(strategy: AmountStrategyConfig, index: number, fallback: number) {
  const table = strategy.tableCents?.filter(value => Number.isFinite(value) && value > 0) ?? [];
  return table[Math.min(index, table.length - 1)] ?? fallback;
}

/** Avalia somente números, operadores aritméticos, parênteses e variáveis conhecidas. Não usa eval. */
export function evaluateFormula(formula: string, context: AmountCalculationContext): number {
  const tokens = tokenize(formula);
  let cursor = 0;
  const expression = (): number => {
    let value = term();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') { const op = tokens[cursor++]; const right = term(); value = op === '+' ? value + right : value - right; }
    return value;
  };
  const term = (): number => {
    let value = factor();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') { const op = tokens[cursor++]; const right = factor(); value = op === '*' ? value * right : right === 0 ? 0 : value / right; }
    return value;
  };
  const factor = (): number => {
    const token = tokens[cursor++];
    if (token === '-') return -factor();
    if (token === '(') { const value = expression(); if (tokens[cursor++] !== ')') throw new Error('Parênteses inválidos na fórmula.'); return value; }
    if (token && token in ALLOWED_VARIABLES) return context[ALLOWED_VARIABLES[token]];
    const value = Number(token); if (!Number.isFinite(value)) throw new Error(`Token não permitido na fórmula: ${token ?? ''}`); return value;
  };
  const result = expression();
  if (cursor !== tokens.length) throw new Error('Fórmula inválida.');
  return result;
}

function tokenize(formula: string): string[] {
  if (formula.length > 200) throw new Error('Fórmula muito longa.');
  const tokens = formula.match(/[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*|\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  if (tokens.join('').toLowerCase() !== formula.replace(/\s+/g, '').toLowerCase()) throw new Error('A fórmula contém caracteres não permitidos.');
  return tokens;
}

export function createBankrollMetrics(initialBalanceCents: number): BankrollMetrics {
  return { initialBalanceCents, currentBalanceCents: initialBalanceCents, peakBalanceCents: initialBalanceCents, profitCents: 0, roi: 0, drawdownCents: 0, maxDrawdownCents: 0, currentExposureCents: 0, maximumExposureCents: 0, stopReason: null };
}

export function updateBankrollMetrics(metrics: BankrollMetrics, profitLossCents: number, exposureCents: number, limits?: BankrollLimitsConfig): BankrollMetrics {
  const currentBalanceCents = metrics.currentBalanceCents + profitLossCents;
  const peakBalanceCents = Math.max(metrics.peakBalanceCents, currentBalanceCents);
  const drawdownCents = peakBalanceCents - currentBalanceCents;
  const next: BankrollMetrics = { ...metrics, currentBalanceCents, peakBalanceCents, profitCents: currentBalanceCents - metrics.initialBalanceCents, roi: metrics.initialBalanceCents ? (currentBalanceCents - metrics.initialBalanceCents) / metrics.initialBalanceCents * 100 : 0, drawdownCents, maxDrawdownCents: Math.max(metrics.maxDrawdownCents, drawdownCents), currentExposureCents: 0, maximumExposureCents: Math.max(metrics.maximumExposureCents, exposureCents), stopReason: null };
  next.stopReason = bankrollStopReason(next, exposureCents, limits);
  return next;
}

export function bankrollStopReason(metrics: BankrollMetrics, requestedExposureCents: number, limits?: BankrollLimitsConfig): string | null {
  if (!limits) return requestedExposureCents > metrics.currentBalanceCents ? 'Saldo insuficiente' : null;
  if (limits.stopWinCents != null && metrics.profitCents >= limits.stopWinCents) return 'Stop WIN atingido';
  if (limits.stopLossCents != null && -metrics.profitCents >= limits.stopLossCents) return 'Stop LOSS atingido';
  if (limits.maxDrawdownCents != null && metrics.maxDrawdownCents >= limits.maxDrawdownCents) return 'Drawdown máximo atingido';
  if (limits.maxExposureCents != null && requestedExposureCents > limits.maxExposureCents) return 'Exposição máxima excedida';
  if (limits.maxBetPercentage != null && requestedExposureCents > metrics.currentBalanceCents * limits.maxBetPercentage / 100) return 'Percentual máximo da banca excedido';
  if (requestedExposureCents > metrics.currentBalanceCents) return 'Saldo insuficiente';
  return null;
}
