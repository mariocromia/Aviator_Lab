import type { ScreenAutomationAction, ScreenProfile } from '@aviator/shared';

export interface BetPreparationValues { bet1?: { amountCents: number; cashout: number }; bet2?: { amountCents: number; cashout: number }; }
export interface AssistedPreparationOptions { clickAction?: boolean; }

export interface ScreenTransform { x: number; y: number; scaleFactor: number; }
export function buildAssistedPreparation(profile: ScreenProfile, transform: ScreenTransform, values?: BetPreparationValues, options: AssistedPreparationOptions = {}): ScreenAutomationAction[] {
  if (!profile.windowTitle?.trim()) throw new Error('Informe o título da janela antes do teste assistido.');
  const actions: ScreenAutomationAction[] = [{ type: 'FOCUS', windowTitle: profile.windowTitle.trim() }];
  for (const [name, slot] of [['bet1', profile.bet1], ['bet2', profile.bet2]] as const) {
    if (!slot.enabled) continue;
    const configured = values ? values[name] : slot;
    if (!configured) continue;
    const actionPoint = physical(slot.action, transform);
    actions.push(
      { type: 'MOVE', ...physical(slot.amount, transform) }, { type: 'CLICK', ...physical(slot.amount, transform) }, { type: 'SELECT_ALL' }, { type: 'TYPE_TEXT', text: (configured.amountCents / 100).toFixed(2) },
      { type: 'MOVE', ...physical(slot.cashoutField, transform) }, { type: 'CLICK', ...physical(slot.cashoutField, transform) }, { type: 'SELECT_ALL' }, { type: 'TYPE_TEXT', text: configured.cashout.toFixed(2) },
      { type: 'MOVE', ...actionPoint }, options.clickAction ? { type: 'CLICK', ...actionPoint } : { type: 'HIGHLIGHT', ...actionPoint }
    );
  }
  return actions;
}
function physical(point: {x:number;y:number}, transform: ScreenTransform) { return { x: Math.round(transform.x + point.x * transform.scaleFactor), y: Math.round(transform.y + point.y * transform.scaleFactor) }; }

export class GlobalScreenAutomationLock {
  private queue: Promise<void> = Promise.resolve();
  private terminalLocks = new Set<string>();
  private paused = true;
  setPaused(paused: boolean) { this.paused = paused; }
  isPaused() { return this.paused; }
  async run<T>(terminalId: string, task: () => Promise<T>): Promise<T> {
    if (this.paused) throw new Error('Automação de tela está pausada globalmente.');
    if (this.terminalLocks.has(terminalId)) throw new Error('Este Terminal já possui uma preparação em andamento.');
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    const previous = this.queue; this.queue = previous.then(() => turn);
    await previous;
    if (this.paused) { release(); throw new Error('Automação de tela foi pausada antes da execução.'); }
    this.terminalLocks.add(terminalId);
    try { return await task(); } finally { this.terminalLocks.delete(terminalId); release(); }
  }
}
