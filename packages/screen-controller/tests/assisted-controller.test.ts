import { describe, expect, it } from 'vitest';
import type { ScreenProfile } from '@aviator/shared';
import { buildAssistedPreparation, GlobalScreenAutomationLock } from '../src/index.js';
const profile = { id:'p',terminalId:'t',name:'P',resolutionWidth:1920,resolutionHeight:1080,windowTitle:'Aviator',bet1:{enabled:true,amountCents:100,cashout:2,amount:{x:10,y:20},cashoutField:{x:30,y:40},action:{x:50,y:60}},bet2:{enabled:false,amountCents:100,cashout:10,amount:{x:0,y:0},cashoutField:{x:0,y:0},action:{x:0,y:0}},updatedAt:'' } as ScreenProfile;
describe('assisted controller',()=>{
  it('scales logical coordinates but never clicks the action button',()=>{const actions=buildAssistedPreparation(profile,{x:100,y:200,scaleFactor:1.25});expect(actions.some(action=>action.type==='CLICK'&&action.x===163&&action.y===275)).toBe(false);expect(actions.at(-1)?.type).toBe('HIGHLIGHT');});
  it('starts globally paused and serializes only after explicit release',async()=>{const lock=new GlobalScreenAutomationLock();await expect(lock.run('t',async()=>true)).rejects.toThrow('pausada');lock.setPaused(false);await expect(lock.run('t',async()=>true)).resolves.toBe(true);});
});
