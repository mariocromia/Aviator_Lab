import { create } from 'zustand';
import type { BootstrapData, UserSession } from '@aviator/shared';
import { sortByClassification } from '@/lib/utils';

interface AppState extends Omit<BootstrapData, 'session'> {
  session: UserSession | null;
  loading: boolean;
  error: string | null;
  initialize(): Promise<void>;
  login(email: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  createTerminal(input: unknown): Promise<boolean>;
  updateTerminal(input: unknown): Promise<boolean>;
  syncTerminal(id:string):Promise<boolean>;
  duplicateTerminal(id: string): Promise<boolean>;
  deleteTerminal(id: string): Promise<void>;
  resetTerminal(id:string,mode:'FINANCIAL'|'FULL'):Promise<boolean>;
  updateTerminalInitialBankroll(id:string,initialBankrollCents:number):Promise<boolean>;
  setTerminalBankrollAnchor(id:string,initialBankrollCents:number,bankrollStartAt:string):Promise<boolean>;
  setTerminalPaused(id: string, paused: boolean): Promise<void>;
  setTerminalSchedulePlan(terminalId:string,schedulePlanId:string|null):Promise<boolean>;
  saveTerminalControlRule(input:unknown):Promise<boolean>;
  deleteTerminalControlRule(id:string):Promise<void>;
  saveScreenProfile(input: unknown): Promise<boolean>;
  createPlatform(input: unknown): Promise<boolean>;
  updatePlatform(input: unknown): Promise<boolean>;
  setPlatformEnabled(id: string, enabled: boolean): Promise<void>;
  syncCollectorNow(platformId: string): Promise<void>;
  clearError(): void;
}

const empty: Omit<BootstrapData, 'session'> = { platforms: [], terminals: [], gameStrategies: [], betStrategies: [], betPlans: [], schedulePlans:[], recentRounds: [], collectors: [], terminalRuntimes: [], terminalHistories: {},terminalUpdateStates:{},terminalHistoryDisplayMax:5_000, screenProfiles: [], terminalSchedules:[],terminalControlRules:[], eventBus: { publishedEvents: 0, deliveredEvents: 0, failedDeliveries: 0, subscribersByPlatform: {} } };
let activeRefresh:Promise<void>|null=null;
let refreshQueued=false;

async function refreshApplication(setState:(data:Partial<AppState>)=>void){
  if(activeRefresh){refreshQueued=true;await activeRefresh;return;}
  do{
    refreshQueued=false;
    activeRefresh=(async()=>{const result=await window.aviator.bootstrap();if(result.ok&&result.data)setState(withClassificationOrder(result.data));})();
    try{await activeRefresh}finally{activeRefresh=null}
  }while(refreshQueued);
}

function withClassificationOrder(data: BootstrapData): BootstrapData {
  return {
    ...data,
    terminals: sortByClassification(data.terminals),
    gameStrategies: sortByClassification(data.gameStrategies),
    betStrategies: sortByClassification(data.betStrategies),
    betPlans: sortByClassification(data.betPlans),
    schedulePlans: sortByClassification(data.schedulePlans),
    terminalControlRules: sortByClassification(data.terminalControlRules)
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  ...empty, session: null, loading: true, error: null,
  initialize: async () => {
    const result = await window.aviator.bootstrap();
    if (result.ok && result.data) set({ ...withClassificationOrder(result.data), loading: false });
    else set({ loading: false, error: result.error ?? 'Falha ao iniciar.' });
  },
  login: async (email, password) => {
    set({ loading: true, error: null });
    const result = await window.aviator.login({ email, password });
    if (!result.ok || !result.data) { set({ loading: false, error: result.error ?? 'Falha no login.' }); return false; }
    set({ session: result.data, loading: false });
    await get().refresh(); return true;
  },
  logout: async () => { await window.aviator.logout(); set({ session: null, ...empty }); },
  refresh: async () => {
    await refreshApplication(set);
  },
  createTerminal: async (input) => {
    const result = await window.aviator.createTerminal(input);
    if (!result.ok) { set({ error: result.error ?? 'Não foi possível criar o Terminal.' }); return false; }
    await get().refresh(); return true;
  },
  updateTerminal: async (input) => {
    const result = await window.aviator.updateTerminal(input);
    if (!result.ok) { set({ error: result.error ?? 'Não foi possível atualizar o Terminal.' }); return false; }
    await get().refresh(); return true;
  },
  syncTerminal:async id=>{const result=await window.aviator.syncTerminal(id);if(!result.ok){set({error:result.error??'Não foi possível sincronizar o Terminal.'});return false}await get().refresh();return true},
  duplicateTerminal: async (id) => {
    const result = await window.aviator.duplicateTerminal(id);
    if (!result.ok) { set({ error: result.error ?? 'Não foi possível duplicar.' }); return false; }
    await get().refresh(); return true;
  },
  deleteTerminal: async (id) => { const result = await window.aviator.deleteTerminal(id); if (!result.ok) set({ error: result.error ?? 'Não foi possível excluir.' }); await get().refresh(); },
  resetTerminal:async(id,mode)=>{const result=await window.aviator.resetTerminal(id,mode);if(!result.ok){set({error:result.error??'Não foi possível resetar o Terminal.'});return false}await get().refresh();return true},
  updateTerminalInitialBankroll:async(id,initialBankrollCents)=>{const result=await window.aviator.updateTerminalInitialBankroll(id,initialBankrollCents);if(!result.ok){set({error:result.error??'Não foi possível atualizar a banca inicial.'});return false}await get().refresh();return true},
  setTerminalBankrollAnchor:async(id,initialBankrollCents,bankrollStartAt)=>{const result=await window.aviator.setTerminalBankrollAnchor(id,initialBankrollCents,bankrollStartAt);if(!result.ok){set({error:result.error??'Não foi possível definir a bolinha inicial da banca.'});return false}await get().refresh();return true},
  setTerminalPaused: async (id, paused) => { const result=await window.aviator.setTerminalPaused(id,paused);if(!result.ok)set({error:result.error??'Não foi possível alterar o estado do Terminal.'});await get().refresh(); },
  setTerminalSchedulePlan:async(terminalId,schedulePlanId)=>{const result=await window.aviator.setTerminalSchedulePlan(terminalId,schedulePlanId);if(!result.ok){set({error:result.error??'Não foi possível vincular o plano de horários.'});return false}await get().refresh();return true},
  saveTerminalControlRule:async input=>{const result=await window.aviator.saveTerminalControlRule(input);if(!result.ok){set({error:result.error??'Não foi possível salvar a regra de controle.'});return false}await get().refresh();return true},
  deleteTerminalControlRule:async id=>{const result=await window.aviator.deleteTerminalControlRule(id);if(!result.ok)set({error:result.error??'Não foi possível excluir a regra de controle.'});await get().refresh()},
  saveScreenProfile: async (input) => {
    const result = await window.aviator.saveScreenProfile(input);
    if (!result.ok) { set({ error: result.error ?? 'Não foi possível salvar o perfil do bot.' }); return false; }
    await get().refresh(); return true;
  },
  createPlatform: async (input) => {
    try {
      const result = await window.aviator.createPlatform(input);
      if (!result.ok) { set({ error: result.error ?? 'Não foi possível criar a plataforma.' }); return false; }
      await get().refresh(); return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Falha no canal IPC da plataforma.' }); return false;
    }
  },
  updatePlatform: async (input) => {
    const result = await window.aviator.updatePlatform(input);
    if (!result.ok) { set({ error: result.error ?? 'Não foi possível atualizar a plataforma.' }); return false; }
    await get().refresh(); return true;
  },
  setPlatformEnabled: async (id, enabled) => {
    const result = await window.aviator.setPlatformEnabled(id, enabled);
    if (!result.ok) set({ error: result.error ?? 'Não foi possível alterar a plataforma.' });
    await get().refresh();
  },
  syncCollectorNow: async (platformId) => { await window.aviator.syncCollectorNow(platformId); await get().refresh(); },
  clearError: () => set({ error: null })
}));
