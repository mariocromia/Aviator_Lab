import { describe, expect, it } from 'vitest';
import type { ScreenProfile } from '@aviator/shared';
import { MockScreenController, validateScreenProfile } from '../src/index.js';

const profile: ScreenProfile = { id: crypto.randomUUID(), terminalId: crypto.randomUUID(), name: 'Perfil', resolutionWidth: 1920, resolutionHeight: 1080, windowTitle: 'Aviator', bet1: { enabled: true, amountCents: 100, cashout: 2, amount: {x:100,y:200}, cashoutField:{x:200,y:200}, action:{x:300,y:300} }, bet2: { enabled:false, amountCents:100, cashout:10, amount:{x:0,y:0}, cashoutField:{x:0,y:0}, action:{x:0,y:0} }, updatedAt: new Date().toISOString() };
describe('MockScreenController',()=>{
  it('validates enabled coordinates against the current resolution',()=>expect(validateScreenProfile(profile,{width:1920,height:1080}).valid).toBe(true));
  it('generates a safe trace and blocks the physical action click',()=>{const run=new MockScreenController().run(profile,{width:1920,height:1080});expect(run.safe).toBe(true);expect(run.steps.at(-1)?.action).toBe('CLICK_BLOCKED');});
  it('does not prepare steps for an incompatible screen',()=>{const run=new MockScreenController().run(profile,{width:1280,height:720});expect(run.validation.valid).toBe(false);expect(run.steps).toHaveLength(1);});
});
