import { describe, expect, it } from 'vitest';
import { saveConfigurationSchema } from '../src/index.js';
describe('configuration schemas',()=>{
  it('accepts a versionable game strategy',()=>{const result=saveConfigurationSchema.safeParse({id:null,kind:'GAME_STRATEGY',name:'Estratégia',config:{trigger:[{operator:'GT',value:1.35}],win:[{operator:'GTE',value:2}],loss:[{operator:'BETWEEN',value:[0.01,1.99]}],afterLoss:[],release:[{operator:'GTE',value:2}]}});expect(result.success).toBe(true);});
  it('rejects bet plans without legs',()=>{const result=saveConfigurationSchema.safeParse({id:null,kind:'BET_PLAN',name:'Plano',config:{stages:[{index:0,label:'BASE',legs:[]}]}});expect(result.success).toBe(false);});
  it('accepts BASE plus 50 Gales and rejects a 51st Gale',()=>{const stage=(index:number)=>({index,label:index===0?'BASE':`GALE ${index}`,legs:[{slot:1,amountCents:100,cashout:2}]});expect(saveConfigurationSchema.safeParse({id:null,kind:'BET_PLAN',name:'50 Gales',config:{stages:Array.from({length:51},(_,index)=>stage(index))}}).success).toBe(true);expect(saveConfigurationSchema.safeParse({id:null,kind:'BET_PLAN',name:'51 Gales',config:{stages:Array.from({length:52},(_,index)=>stage(index))}}).success).toBe(false);});
});
