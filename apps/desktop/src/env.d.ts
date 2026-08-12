/// <reference types="vite/client" />
import type { AiChatResponse, AiModelOption, AiSettingsView, ApiResult, AuditRecord, BacktestRun, BootstrapData, ConfigurationDocument, ConfigurationKind, PerformanceBenchmarkResult, Platform, PlatformTestResult, RecoverySnapshot, ScreenCaptureResult, ScreenMockRun, ScreenProfile, ScreenProfileValidation, SystemDiagnostics, Terminal, TerminalControlRule, UserSession } from '@aviator/shared';

declare global {
  interface Window {
    aviator: {
      bootstrap(): Promise<ApiResult<BootstrapData>>;
      login(input: { email: string; password: string }): Promise<ApiResult<UserSession>>;
      logout(): Promise<ApiResult<boolean>>;
      createTerminal(input: unknown): Promise<ApiResult<Terminal>>;
      updateTerminal(input: unknown): Promise<ApiResult<Terminal>>;
      duplicateTerminal(id: string): Promise<ApiResult<Terminal>>;
      deleteTerminal(id: string): Promise<ApiResult<boolean>>;
      resetTerminal(id:string,mode:'FINANCIAL'|'FULL'):Promise<ApiResult<boolean>>;
      updateTerminalInitialBankroll(id:string,initialBankrollCents:number):Promise<ApiResult<boolean>>;
      getTerminalHistory(terminalId:string,limit?:number):Promise<ApiResult<import('@aviator/shared').TerminalHistoryItem[]>>;
      setTerminalPaused(id: string, paused: boolean): Promise<ApiResult<boolean>>;
      setTerminalSchedulePlan(terminalId:string,schedulePlanId:string|null):Promise<ApiResult<boolean>>;
      saveTerminalControlRule(input:unknown):Promise<ApiResult<TerminalControlRule>>;
      deleteTerminalControlRule(id:string):Promise<ApiResult<boolean>>;
      saveScreenProfile(input: unknown): Promise<ApiResult<ScreenProfile>>;
      captureScreenCoordinate(): Promise<ApiResult<ScreenCaptureResult>>;
      validateScreenProfile(terminalId: string): Promise<ApiResult<ScreenProfileValidation>>;
      runScreenMock(terminalId: string): Promise<ApiResult<ScreenMockRun>>;
      getScreenAutomationStatus(): Promise<ApiResult<{paused:boolean;emergencyHotkey:string}>>;
      setScreenAutomationPaused(paused: boolean): Promise<ApiResult<boolean>>;
      testScreenCoordinate(terminalId: string, coordinateKey: string): Promise<ApiResult<boolean>>;
      testAssistedPreparation(terminalId: string): Promise<ApiResult<boolean>>;
      createPlatform(input: unknown): Promise<ApiResult<Platform>>;
      updatePlatform(input: unknown): Promise<ApiResult<Platform>>;
      setPlatformEnabled(id: string, enabled: boolean): Promise<ApiResult<boolean>>;
      testPlatform(input: unknown): Promise<ApiResult<PlatformTestResult>>;
      syncCollectorNow(platformId: string): Promise<ApiResult<boolean>>;
      getRecentRounds(platformId:string|null,limit:50|100|250|500):Promise<ApiResult<import('@aviator/shared').NormalizedRound[]>>;
      getAiSettings():Promise<ApiResult<AiSettingsView>>;
      saveAiSettings(input:unknown):Promise<ApiResult<AiSettingsView>>;
      testAiConnection():Promise<ApiResult<{label:string;limit:number|null;limitRemaining:number|null}>>;
      listAiModels():Promise<ApiResult<AiModelOption[]>>;
      sendAiChat(input:unknown):Promise<ApiResult<AiChatResponse>>;
      runBacktest(input: unknown): Promise<ApiResult<BacktestRun>>;
      listAudit(input: unknown): Promise<ApiResult<AuditRecord[]>>;
      getSystemDiagnostics(): Promise<ApiResult<SystemDiagnostics>>;
      runPerformanceBenchmark():Promise<ApiResult<PerformanceBenchmarkResult[]>>;
      listRecoverySnapshots():Promise<ApiResult<RecoverySnapshot[]>>;
      restoreRecoverySnapshot(id:string):Promise<ApiResult<boolean>>;
      exportWorkspace(): Promise<ApiResult<string | null>>;
      importWorkspace(): Promise<ApiResult<boolean>>;
      listConfigurations(kind?: ConfigurationKind): Promise<ApiResult<ConfigurationDocument[]>>;
      saveConfiguration(input: unknown): Promise<ApiResult<ConfigurationDocument>>;
      duplicateConfiguration(id: string, kind: ConfigurationKind): Promise<ApiResult<ConfigurationDocument>>;
      deleteConfiguration(id: string, kind: ConfigurationKind): Promise<ApiResult<boolean>>;
      restartApp(): Promise<boolean>;
      onDataChanged(callback: () => void): () => void;
      windowMinimize(): Promise<boolean>;
      windowMaximize(): Promise<boolean>;
      windowClose(): Promise<boolean>;
    };
  }
}
export {};
