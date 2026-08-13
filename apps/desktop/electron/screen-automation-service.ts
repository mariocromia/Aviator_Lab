import { spawn } from 'node:child_process';
import path from 'node:path';
import type { AssistedPreparationResult, ScreenAutomationAction, ScreenCoordinateKey, ScreenProfile } from '@aviator/shared';
import { buildAssistedPreparation, GlobalScreenAutomationLock, type BetPreparationValues, type ScreenTransform } from '@aviator/screen-controller';

export class ScreenAutomationService {
  private readonly lock = new GlobalScreenAutomationLock();
  private readonly agent = new PyAutoGuiAgent(path.join(import.meta.dirname, '../python/screen_agent.py'));
  setPaused(paused: boolean) { this.lock.setPaused(paused); }
  isPaused() { return this.lock.isPaused(); }
  testCoordinate(profile: ScreenProfile, key: ScreenCoordinateKey, transform: ScreenTransform) {
    const point = coordinate(profile, key); const actions: ScreenAutomationAction[] = [];
    if (profile.windowTitle?.trim()) actions.push({ type: 'FOCUS', windowTitle: profile.windowTitle.trim() });
    const physical = { x: Math.round(transform.x + point.x * transform.scaleFactor), y: Math.round(transform.y + point.y * transform.scaleFactor) };
    actions.push({ type: 'MOVE', ...physical }, { type: 'CLICK', ...physical });
    return this.lock.run(profile.terminalId, () => this.agent.execute(actions));
  }
  prepare(profile: ScreenProfile, transform: ScreenTransform, values?: BetPreparationValues): Promise<AssistedPreparationResult> {
    return this.lock.run(profile.terminalId, async () => { const startedAt = new Date().toISOString(); await this.agent.execute(buildAssistedPreparation(profile, transform, values)); return { terminalId: profile.terminalId, profileId: profile.id, preparedSlots: Number(profile.bet1.enabled) + Number(profile.bet2.enabled), finalClickBlocked: true, startedAt, finishedAt: new Date().toISOString() }; });
  }
}

class PyAutoGuiAgent {
  constructor(private readonly scriptPath: string) {}
  execute(actions: ScreenAutomationAction[]): Promise<void> { return new Promise((resolve, reject) => { const child = spawn('python', [this.scriptPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); }); child.on('error', reject); child.on('close', code => { try { const output = JSON.parse(stdout.trim()) as {ok:boolean;error?:string}; if (code === 0 && output.ok) resolve(); else reject(new Error(output.error ?? stderr.trim() ?? `Screen Agent encerrou com código ${code}.`)); } catch { reject(new Error(stderr.trim() || stdout.trim() || 'Resposta inválida do Screen Agent.')); } }); child.stdin.end(JSON.stringify({ actions })); }); }
}
function coordinate(profile: ScreenProfile, key: ScreenCoordinateKey) { const slot = key.startsWith('bet1') ? profile.bet1 : profile.bet2; return key.endsWith('.amount') ? slot.amount : key.endsWith('.cashout') ? slot.cashoutField : slot.action; }
