import {describe,expect,it} from 'vitest';
import type {TerminalSchedule} from '@aviator/shared';
import {evaluateTerminalSchedule} from '../src/index.js';

const schedule=(mode:TerminalSchedule['mode'],startTime='09:00',endTime='18:00'):TerminalSchedule=>({terminalId:crypto.randomUUID(),schedulePlanId:crypto.randomUUID(),mode,timezone:'America/Sao_Paulo',windows:[{id:'work',days:[1,2,3,4,5],startTime,endTime}],updatedAt:new Date().toISOString()});

describe('evaluateTerminalSchedule',()=>{
  it('allows only configured weekday windows',()=>{const value=schedule('ALLOW_WINDOWS');expect(evaluateTerminalSchedule(value,new Date('2026-08-10T15:00:00Z')).allowed).toBe(true);expect(evaluateTerminalSchedule(value,new Date('2026-08-10T23:00:00Z')).reason).toBe('FORA_DO_HORARIO_PERMITIDO');});
  it('blocks configured windows and supports intervals crossing midnight',()=>{const value=schedule('BLOCK_WINDOWS','22:00','06:00');expect(evaluateTerminalSchedule(value,new Date('2026-08-11T03:00:00Z')).reason).toBe('INTERVALO_BLOQUEADO');expect(evaluateTerminalSchedule(value,new Date('2026-08-11T15:00:00Z')).allowed).toBe(true);});
});
