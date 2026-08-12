import type { ScreenCoordinateKey, ScreenMockRun, ScreenMockStep, ScreenProfile, ScreenProfileValidation } from '@aviator/shared';

export interface ScreenSize { width: number; height: number; }

export function validateScreenProfile(profile: ScreenProfile, current: ScreenSize): ScreenProfileValidation {
  const issues: string[] = [];
  if (profile.resolutionWidth !== current.width || profile.resolutionHeight !== current.height) issues.push(`Resolução esperada ${profile.resolutionWidth}x${profile.resolutionHeight}; atual ${current.width}x${current.height}.`);
  const points = coordinates(profile);
  for (const [key, point, enabled] of points) {
    if (!enabled) continue;
    if (point.x < 0 || point.y < 0 || point.x >= current.width || point.y >= current.height) issues.push(`${key} está fora da tela atual.`);
    if (point.x === 0 && point.y === 0) issues.push(`${key} ainda não foi calibrada.`);
  }
  if (!profile.bet1.enabled && !profile.bet2.enabled) issues.push('Ative ao menos uma entrada de aposta.');
  return { valid: issues.length === 0, issues, currentResolution: current };
}

export class MockScreenController {
  run(profile: ScreenProfile, current: ScreenSize): ScreenMockRun {
    const validation = validateScreenProfile(profile, current);
    const steps: ScreenMockStep[] = [{ action: 'FOCUS', coordinateKey: null, x: null, y: null, value: profile.windowTitle }];
    if (validation.valid) {
      for (const [key, point, enabled] of coordinates(profile)) {
        if (!enabled) continue;
        const isAction = key.endsWith('.action');
        steps.push({ action: 'MOVE', coordinateKey: key, x: point.x, y: point.y, value: null });
        steps.push({ action: 'HIGHLIGHT', coordinateKey: key, x: point.x, y: point.y, value: null });
        steps.push({ action: isAction ? 'CLICK_BLOCKED' : 'TYPE', coordinateKey: key, x: point.x, y: point.y, value: valueFor(profile, key) });
      }
    }
    return { terminalId: profile.terminalId, profileId: profile.id, safe: true, steps, validation, createdAt: new Date().toISOString() };
  }
}

function coordinates(profile: ScreenProfile): Array<[ScreenCoordinateKey, {x:number;y:number}, boolean]> { return [
  ['bet1.amount', profile.bet1.amount, profile.bet1.enabled], ['bet1.cashout', profile.bet1.cashoutField, profile.bet1.enabled], ['bet1.action', profile.bet1.action, profile.bet1.enabled],
  ['bet2.amount', profile.bet2.amount, profile.bet2.enabled], ['bet2.cashout', profile.bet2.cashoutField, profile.bet2.enabled], ['bet2.action', profile.bet2.action, profile.bet2.enabled]
]; }
function valueFor(profile: ScreenProfile, key: ScreenCoordinateKey): string | null { const slot = key.startsWith('bet1') ? profile.bet1 : profile.bet2; return key.endsWith('.amount') ? (slot.amountCents / 100).toFixed(2) : key.endsWith('.cashout') ? slot.cashout.toFixed(2) : null; }
