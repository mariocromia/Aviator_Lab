import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, screen, type Display } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { aiChatRequestSchema, aiSettingsInputSchema, auditQuerySchema, backtestRequestSchema, configurationActionSchema, createPlatformInputSchema, createTerminalInputSchema, loginInputSchema, recentRoundsQuerySchema, recoverySnapshotIdSchema, resetTerminalInputSchema, saveConfigurationSchema, saveScreenProfileInputSchema, saveTerminalControlRuleInputSchema, screenCoordinateTestSchema, screenProfileActionSchema, setPlatformEnabledInputSchema, setTerminalSchedulePlanInputSchema, terminalControlRuleIdSchema, terminalHistoryQuerySchema, terminalIdSchema, testPlatformInputSchema, updatePlatformInputSchema, updateTerminalBankrollInputSchema, updateTerminalInputSchema, workspaceArchiveSchema, type AiChatResponse, type AiModelOption, type AiSettingsView, type ApiResult, type AuditRecord, type BacktestRun, type ConfigurationDocument, type ConfigurationKind, type PerformanceBenchmarkResult, type Platform, type PlatformTestResult, type RecoverySnapshot, type ScreenCaptureResult, type ScreenMockRun, type ScreenProfile, type ScreenProfileValidation, type SystemDiagnostics, type Terminal, type TerminalControlRule, type UserSession } from '@aviator/shared';
import { TerminalManager } from '@aviator/terminal';
import { SimulationEngine } from '@aviator/simulator';
import { MockScreenController, validateScreenProfile } from '@aviator/screen-controller';
import { RoundEventBus } from '@aviator/collector';
import { TipMinerClient, TipMinerRoundNormalizer } from '@aviator/tipminer';
import { AppDatabase } from './database.js';
import { LocalLicenseService } from './services.js';
import { CollectorManager } from './collector-manager.js';
import { ScreenAutomationService } from './screen-automation-service.js';
import { splashHtml } from './splash.js';
import { OpenRouterService } from './openrouter-service.js';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashStartedAt = 0;
let splashState = { message: 'Preparando o ambiente...', progress: 8, isError: false };
let database: AppDatabase;
let collectorManager: CollectorManager;
let terminalManager: TerminalManager;
let roundEventBus: RoundEventBus;
let screenAutomation: ScreenAutomationService;
let openRouterService: OpenRouterService;
const INTERFACE_SCALES = new Set([0.8, 0.9, 1, 1.1, 1.25]);

function createSplashWindow() {
  splashStartedAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 520,
    height: 330,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#090c10',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  splashWindow.webContents.on('did-finish-load', () => applySplashState());
  splashWindow.on('closed', () => { splashWindow = null; });
  void splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashHtml)}`);
}

function updateSplash(message: string, progress: number, isError = false) {
  splashState = { message, progress, isError };
  applySplashState();
}

function applySplashState() {
  if (!splashWindow || splashWindow.isDestroyed() || splashWindow.webContents.isLoading()) return;
  const { message, progress, isError } = splashState;
  void splashWindow.webContents
    .executeJavaScript(`window.setSplashState(${JSON.stringify(message)}, ${progress}, ${isError})`)
    .catch(() => undefined);
}

function revealMainWindow() {
  updateSplash('Interface pronta', 100);
  const remaining = Math.max(0, 1200 - (Date.now() - splashStartedAt));
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  }, remaining);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 720, frame: false,
    show: false, backgroundColor: '#0b0e11', titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  const savedScale = database.getAppSetting<number>('interface_scale');
  mainWindow.webContents.setZoomFactor(savedScale && INTERFACE_SCALES.has(savedScale) ? savedScale : 1);
  mainWindow.once('ready-to-show', revealMainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode === -3) return;
    updateSplash(`Falha ao carregar a interface: ${errorDescription}`, 100, true);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const load = devUrl
    ? mainWindow.loadURL(devUrl)
    : mainWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
  void load.catch(error => updateSplash(`Falha ao carregar a interface: ${error instanceof Error ? error.message : String(error)}`, 100, true));
}

app.whenReady()
  .then(async () => {
    createSplashWindow();
    updateSplash('Abrindo banco de dados local...', 18);
    console.info('[SYSTEM] Electron ready; initializing SQLite.');
    database = new AppDatabase(path.join(app.getPath('userData'), 'aviator-strategy-lab.db'));
    openRouterService = new OpenRouterService(database, net.fetch as unknown as typeof fetch);
    console.info('[SYSTEM] SQLite initialized.');
    updateSplash('Validando os serviços locais...', 38);
    await new LocalLicenseService().initialize();
    console.info('[SYSTEM] Local services initialized.');
    updateSplash('Preparando os Terminais...', 56);
    roundEventBus = new RoundEventBus();
    terminalManager = new TerminalManager(database, roundEventBus);
    terminalManager.initialize();
    screenAutomation = new ScreenAutomationService();
    terminalManager.setAssistedPreparationHandler(async request => {
      const terminal = database.getTerminal(request.terminalId); if (!terminal || request.deliveryMode !== 'LIVE' || terminal.mode !== 'ASSISTED' || !terminal.enabled || terminal.paused || screenAutomation.isPaused()) return;
      const runtime = terminalManager.getRuntime(terminal.id); if (runtime?.screenControllerState.paused) return;
      const profile = database.getScreenProfiles().find(item => item.terminalId === terminal.id); if (!profile) { database.logEvent('SCREEN_CONTROLLER', 'WARN', 'SCREEN_VALIDATION_FAILED', { terminalId: terminal.id, reason: 'PROFILE_MISSING' }); return; }
      const display = screen.getAllDisplays()[profile.monitorIndex ?? 0] ?? screen.getPrimaryDisplay(); const validation = validateScreenProfile(profile, { width: display.size.width, height: display.size.height });
      if (!validation.valid) { terminalManager.setScreenControllerState(terminal.id, 'INVALID'); database.logEvent('SCREEN_CONTROLLER', 'WARN', 'SCREEN_VALIDATION_FAILED', { terminalId: terminal.id, issues: validation.issues }); return; }
      const stage = database.getBetPlanConfig(request.betPlanId)?.stages[request.stageIndex]; const values = stage ? { bet1: stage.legs[0] ? { amountCents: request.amountsCents[0]??stage.legs[0].amountCents, cashout: stage.legs[0].cashout } : undefined, bet2: stage.legs[1] ? { amountCents: request.amountsCents[1]??stage.legs[1].amountCents, cashout: stage.legs[1].cashout } : undefined } : undefined;
      try { terminalManager.setScreenControllerState(terminal.id, 'PREPARING'); database.logEvent('SCREEN_CONTROLLER', 'INFO', 'SCREEN_PREPARE_STARTED', { terminalId: terminal.id, stageIndex: request.stageIndex }); const result = await screenAutomation.prepare(profile, screenTransform(display), values); terminalManager.setScreenControllerState(terminal.id, 'READY'); database.logEvent('SCREEN_CONTROLLER', 'INFO', 'SCREEN_PREPARE_FINISHED', result); }
      catch (error) { terminalManager.setScreenControllerState(terminal.id, 'ERROR'); database.logEvent('SCREEN_CONTROLLER', 'ERROR', 'SCREEN_PREPARE_FAILED', { terminalId: terminal.id, error: error instanceof Error ? error.message : String(error) }); }
    });
    globalShortcut.register('CommandOrControl+Shift+F12', () => { screenAutomation.setPaused(true); database.logEvent('SCREEN_CONTROLLER', 'WARN', 'SCREEN_EMERGENCY_STOP', {}); notifyDataChanged(); });
    collectorManager = new CollectorManager(
      net.fetch as unknown as import('@aviator/tipminer').FetchLike,
      database,
      notifyDataChanged,
      async round => {
        const delivered = await terminalManager.routeRoundToTerminals(round);
        database.logEvent('COLLECTOR', 'INFO', 'ROUND_DISTRIBUTED', { platformId: round.platformId, roundId: round.id, delivered });
      }
    );
    updateSplash('Conectando a interface aos serviços...', 76);
    registerIpc();
    console.info('[SYSTEM] IPC registered; creating main window.');
    createWindow();
    updateSplash('Carregando a interface...', 88);
    collectorManager.syncPlatforms(database.getPlatforms());
    console.info('[SYSTEM] Collectors started.');
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Falha fatal ao iniciar o Aviator Strategy Lab:', error);
    updateSplash(`Falha na inicialização: ${message}`, 100, true);
    dialog.showErrorBox(
      'Falha ao iniciar o Aviator Strategy Lab',
      `${message}\n\nConsulte o terminal de desenvolvimento para mais detalhes.`
    );
    app.quit();
  });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { screenAutomation?.setPaused(true); globalShortcut.unregisterAll(); collectorManager?.stopAll(); });

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => success({ ...database.bootstrap(), collectors: collectorManager.snapshots(), terminalRuntimes: terminalManager.getRuntimes(), eventBus: roundEventBus.snapshot() }));
  ipcMain.handle('display:scale:get', (): ApiResult<number> => {
    const savedScale = database.getAppSetting<number>('interface_scale');
    return success(savedScale && INTERFACE_SCALES.has(savedScale) ? savedScale : 1);
  });
  ipcMain.handle('display:scale:set', (event, raw): ApiResult<number> => {
    const scale = Number(raw);
    if (!INTERFACE_SCALES.has(scale)) return failure('Escala da interface inválida.');
    database.setAppSetting('interface_scale', scale);
    BrowserWindow.fromWebContents(event.sender)?.webContents.setZoomFactor(scale);
    return success(scale);
  });
  ipcMain.handle('auth:login', (_event, raw): ApiResult<UserSession> => {
    const parsed = loginInputSchema.safeParse(raw);
    if (!parsed.success) return failure('Dados de acesso inválidos.');
    const session = database.authenticate(parsed.data.email, parsed.data.password);
    return session ? success(session) : failure('E-mail ou senha incorretos.');
  });
  ipcMain.handle('auth:logout', () => { database.logout(); return success(true); });
  ipcMain.handle('terminal:create', (_event, raw): ApiResult<Terminal> => {
    const parsed = createTerminalInputSchema.safeParse(raw);
    if (!parsed.success) return failure('Configuração do Terminal inválida.');
    const value = parsed.data;
    const terminal = terminalManager.createTerminal({ ...value, screenProfileId: null, enabled: true, paused: false });
    return success(terminal);
  });
  ipcMain.handle('terminal:duplicate', (_event, raw): ApiResult<Terminal> => {
    const parsed = terminalIdSchema.safeParse(raw);
    if (!parsed.success) return failure('Terminal não encontrado.');
    const copy = terminalManager.duplicateTerminal(parsed.data);
    if (!copy) return failure('Terminal não encontrado.');
    return success(copy);
  });
  ipcMain.handle('terminal:update', (_event, raw): ApiResult<Terminal> => {
    const parsed = updateTerminalInputSchema.safeParse(raw);
    if (!parsed.success) return failure(`Configuração do Terminal inválida: ${parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    const { id, ...update } = parsed.data;
    const terminal = terminalManager.updateTerminal(id, update);
    if (!terminal) return failure('Terminal não encontrado.');
    notifyDataChanged();
    return success(terminal);
  });
  ipcMain.handle('terminal:set-paused', (_event, raw): ApiResult<boolean> => {
    const parsed = terminalIdSchema.safeParse(raw?.id);
    if (!parsed.success || typeof raw?.paused !== 'boolean') return failure('Operação inválida.');
    if (raw.paused) terminalManager.pauseTerminal(parsed.data); else terminalManager.resumeTerminal(parsed.data);
    return success(true);
  });
  ipcMain.handle('terminal:set-schedule-plan',(_event,raw):ApiResult<boolean>=>{const parsed=setTerminalSchedulePlanInputSchema.safeParse(raw);if(!parsed.success)return failure('Plano de horários inválido.');database.setTerminalSchedulePlan(parsed.data.terminalId,parsed.data.schedulePlanId);notifyDataChanged();return success(true);});
  ipcMain.handle('terminal-control-rule:save',(_event,raw):ApiResult<TerminalControlRule>=>{const parsed=saveTerminalControlRuleInputSchema.safeParse(raw);if(!parsed.success)return failure(parsed.error.issues.map(issue=>issue.message).join(' '));const rule=database.saveTerminalControlRule(parsed.data);notifyDataChanged();return success(rule);});
  ipcMain.handle('terminal-control-rule:delete',(_event,raw):ApiResult<boolean>=>{const parsed=terminalControlRuleIdSchema.safeParse(raw);if(!parsed.success)return failure('Regra inválida.');database.deleteTerminalControlRule(parsed.data);notifyDataChanged();return success(true);});
  ipcMain.handle('screen-profile:save', (_event, raw): ApiResult<ScreenProfile> => {
    const parsed = saveScreenProfileInputSchema.safeParse(raw);
    if (!parsed.success || !database.getTerminal(parsed.data.terminalId)) return failure('Configuração do bot inválida.');
    const existing = database.getScreenProfiles().find(profile => profile.terminalId === parsed.data.terminalId);
    const profile: ScreenProfile = { ...parsed.data, monitorIndex: parsed.data.monitorIndex ?? existing?.monitorIndex ?? null, calibratedAt: parsed.data.calibratedAt ?? existing?.calibratedAt ?? null, id: existing?.id ?? randomUUID(), updatedAt: new Date().toISOString() };
    database.saveScreenProfile(profile); notifyDataChanged(); return success(profile);
  });
  ipcMain.handle('screen-profile:capture', (): ApiResult<ScreenCaptureResult> => {
    const point = screen.getCursorScreenPoint(); const displays = screen.getAllDisplays(); const display = screen.getDisplayNearestPoint(point);
    return success({ x: point.x - display.bounds.x, y: point.y - display.bounds.y, monitorIndex: Math.max(0, displays.findIndex(item => item.id === display.id)), resolutionWidth: display.size.width, resolutionHeight: display.size.height });
  });
  ipcMain.handle('screen-profile:validate', (_event, raw): ApiResult<ScreenProfileValidation> => {
    const parsed = screenProfileActionSchema.safeParse(raw); if (!parsed.success) return failure('Terminal inválido.');
    const profile = database.getScreenProfiles().find(item => item.terminalId === parsed.data.terminalId); if (!profile) return failure('Este Terminal ainda não possui Screen Profile.');
    const displays = screen.getAllDisplays(); const display = displays[profile.monitorIndex ?? 0] ?? screen.getPrimaryDisplay();
    return success(validateScreenProfile(profile, { width: display.size.width, height: display.size.height }));
  });
  ipcMain.handle('screen-profile:mock-run', (_event, raw): ApiResult<ScreenMockRun> => {
    const parsed = screenProfileActionSchema.safeParse(raw); if (!parsed.success) return failure('Terminal inválido.');
    const profile = database.getScreenProfiles().find(item => item.terminalId === parsed.data.terminalId); if (!profile) return failure('Este Terminal ainda não possui Screen Profile.');
    const displays = screen.getAllDisplays(); const display = displays[profile.monitorIndex ?? 0] ?? screen.getPrimaryDisplay();
    terminalManager.setScreenControllerState(profile.terminalId, 'MOCKING');
    const run = new MockScreenController().run(profile, { width: display.size.width, height: display.size.height });
    terminalManager.setScreenControllerState(profile.terminalId, run.validation.valid ? 'READY' : 'INVALID');
    database.logEvent('SCREEN_CONTROLLER', run.validation.valid ? 'INFO' : 'WARN', run.validation.valid ? 'SCREEN_MOCK_FINISHED' : 'SCREEN_VALIDATION_FAILED', { terminalId: profile.terminalId, profileId: profile.id, safe: true, issues: run.validation.issues, steps: run.steps.length });
    return success(run);
  });
  ipcMain.handle('screen-automation:status', (): ApiResult<{paused:boolean;emergencyHotkey:string}> => success({ paused: screenAutomation.isPaused(), emergencyHotkey: 'Ctrl+Shift+F12' }));
  ipcMain.handle('screen-automation:set-paused', (_event, raw): ApiResult<boolean> => {
    if (typeof raw?.paused !== 'boolean') return failure('Estado de automação inválido.');
    screenAutomation.setPaused(raw.paused); database.logEvent('SCREEN_CONTROLLER', 'WARN', raw.paused ? 'SCREEN_CONTROLLER_PAUSED' : 'SCREEN_CONTROLLER_ENABLED', {}); notifyDataChanged(); return success(true);
  });
  ipcMain.handle('screen-automation:test-coordinate', async (_event, raw): Promise<ApiResult<boolean>> => {
    const parsed = screenCoordinateTestSchema.safeParse(raw); if (!parsed.success) return failure('Coordenada de teste inválida.');
    const terminal = database.getTerminal(parsed.data.terminalId); const profile = database.getScreenProfiles().find(item => item.terminalId === parsed.data.terminalId);
    if (!terminal || !profile) return failure('Terminal ou Screen Profile não encontrado.');
    if (terminal.mode !== 'ASSISTED') return failure('Altere o Terminal para o modo ASSISTED antes do teste físico.');
    if (!terminal.enabled || terminal.paused) return failure('O Terminal precisa estar ativo e não pausado.');
    const display = screen.getAllDisplays()[profile.monitorIndex ?? 0] ?? screen.getPrimaryDisplay(); const validation = validateScreenProfile(profile, { width: display.size.width, height: display.size.height });
    if (!validation.valid) return failure(validation.issues.join(' '));
    try { terminalManager.setScreenControllerState(terminal.id, 'PREPARING'); await screenAutomation.testCoordinate(profile, parsed.data.coordinateKey, screenTransform(display)); terminalManager.setScreenControllerState(terminal.id, 'READY'); database.logEvent('SCREEN_CONTROLLER', 'INFO', 'SCREEN_COORDINATE_CLICKED', { terminalId: terminal.id, coordinateKey: parsed.data.coordinateKey }); return success(true); }
    catch (error) { terminalManager.setScreenControllerState(terminal.id, 'ERROR'); const message = error instanceof Error ? error.message : String(error); database.logEvent('SCREEN_CONTROLLER', 'ERROR', 'SCREEN_COORDINATE_TEST_FAILED', { terminalId: terminal.id, coordinateKey: parsed.data.coordinateKey, error: message }); return failure(message); }
  });
  ipcMain.handle('screen-automation:prepare-test', async (_event, raw): Promise<ApiResult<boolean>> => {
    const parsed = screenProfileActionSchema.safeParse(raw); if (!parsed.success) return failure('Terminal inválido.');
    const terminal = database.getTerminal(parsed.data.terminalId); const profile = database.getScreenProfiles().find(item => item.terminalId === parsed.data.terminalId);
    if (!terminal || !profile) return failure('Terminal ou Screen Profile não encontrado.');
    if (terminal.mode !== 'ASSISTED') return failure('Altere o Terminal para o modo ASSISTED antes do preenchimento real.');
    if (!terminal.enabled || terminal.paused) return failure('O Terminal precisa estar ativo e não pausado.');
    const display = screen.getAllDisplays()[profile.monitorIndex ?? 0] ?? screen.getPrimaryDisplay(); const validation = validateScreenProfile(profile, { width: display.size.width, height: display.size.height });
    if (!validation.valid) return failure(validation.issues.join(' '));
    try { terminalManager.setScreenControllerState(terminal.id, 'PREPARING'); const result = await screenAutomation.prepare(profile, screenTransform(display)); terminalManager.setScreenControllerState(terminal.id, 'READY'); database.logEvent('SCREEN_CONTROLLER', 'INFO', 'SCREEN_PREPARE_FINISHED', result); return success(true); }
    catch (error) { terminalManager.setScreenControllerState(terminal.id, 'ERROR'); const message = error instanceof Error ? error.message : String(error); database.logEvent('SCREEN_CONTROLLER', 'ERROR', 'SCREEN_PREPARE_FAILED', { terminalId: terminal.id, error: message }); return failure(message); }
  });
  ipcMain.handle('terminal:delete', (_event, raw): ApiResult<boolean> => {
    const parsed = terminalIdSchema.safeParse(raw); if (!parsed.success) return failure('Terminal inválido.');
    terminalManager.deleteTerminal(parsed.data); return success(true);
  });
  ipcMain.handle('terminal:reset',(_event,raw):ApiResult<boolean>=>{const parsed=resetTerminalInputSchema.safeParse(raw);if(!parsed.success)return failure('Opção de reset inválida.');try{terminalManager.resetTerminal(parsed.data.id,parsed.data.mode==='FULL');notifyDataChanged();return success(true);}catch(error){return failure(error instanceof Error?error.message:'Falha ao resetar Terminal.');}});
  ipcMain.handle('terminal:update-bankroll',(_event,raw):ApiResult<boolean>=>{const parsed=updateTerminalBankrollInputSchema.safeParse(raw);if(!parsed.success)return failure('Valor da banca inicial inválido.');try{terminalManager.updateTerminalInitialBankroll(parsed.data.id,parsed.data.initialBankrollCents);notifyDataChanged();return success(true);}catch(error){return failure(error instanceof Error?error.message:'Falha ao atualizar banca inicial.');}});
  ipcMain.handle('terminal:history',(_event,raw)=>{const parsed=terminalHistoryQuerySchema.safeParse(raw);return parsed.success?success(database.getTerminalHistory(parsed.data.terminalId,parsed.data.limit)):failure('Filtro de histórico inválido.');});
  ipcMain.handle('platform:create', (_event, raw): ApiResult<Platform> => {
    const parsed = createPlatformInputSchema.safeParse(raw);
    if (!parsed.success) return failure('Configuração da plataforma inválida.');
    const now = new Date().toISOString();
    const platform: Platform = { ...parsed.data, id: randomUUID(), enabled: true, sourceType: 'TIPMINER', collectorStatus: 'OFFLINE', createdAt: now, updatedAt: now };
    try {
      database.insertPlatform(platform);
      collectorManager.syncPlatforms(database.getPlatforms());
      return success(platform);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('platforms.slug')) return failure('Este slug já está cadastrado.');
      database.logEvent('PLATFORM', 'ERROR', 'PLATFORM_CREATE_FAILED', { error: message });
      return failure(`Não foi possível cadastrar: ${message}`);
    }
  });
  ipcMain.handle('platform:update', (_event, raw): ApiResult<Platform> => {
    const parsed = updatePlatformInputSchema.safeParse(raw);
    if (!parsed.success) return failure('Configuração da plataforma inválida.');
    const existing = database.getPlatform(parsed.data.id);
    if (!existing) return failure('Plataforma não encontrada.');
    const platform: Platform = { ...existing, ...parsed.data, updatedAt: new Date().toISOString(), collectorStatus: 'OFFLINE' };
    try {
      database.updatePlatform(platform); collectorManager.syncPlatforms(database.getPlatforms()); notifyDataChanged(); return success(platform);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(message.includes('platforms.slug') ? 'Este slug já está cadastrado.' : `Não foi possível atualizar: ${message}`);
    }
  });
  ipcMain.handle('platform:set-enabled', (_event, raw): ApiResult<boolean> => {
    const parsed = setPlatformEnabledInputSchema.safeParse(raw);
    if (!parsed.success || !database.getPlatform(parsed.data.id)) return failure('Plataforma não encontrada.');
    database.setPlatformEnabled(parsed.data.id, parsed.data.enabled); collectorManager.syncPlatforms(database.getPlatforms()); notifyDataChanged(); return success(true);
  });
  ipcMain.handle('platform:test', async (_event, raw): Promise<ApiResult<PlatformTestResult>> => {
    const parsed = testPlatformInputSchema.safeParse(raw);
    if (!parsed.success) return failure('UUID ou parâmetros de teste inválidos.');
    const startedAt = performance.now();
    try {
      const client = new TipMinerClient(net.fetch as unknown as import('@aviator/tipminer').FetchLike);
      const payload = await client.getHistory({ roundUuid: parsed.data.tipMinerRoundUuid, limit: parsed.data.historyLimit, timeoutMs: parsed.data.requestTimeoutMs });
      const rounds = new TipMinerRoundNormalizer().normalizeMany(payload, randomUUID());
      const latest = rounds.at(-1) ?? null;
      return success({ latencyMs: Math.round(performance.now() - startedAt), roundsReceived: rounds.length, latestMultiplier: latest?.multiplier ?? null, latestOccurredAt: latest?.occurredAt ?? null });
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'Falha desconhecida ao testar a API.');
    }
  });
  ipcMain.handle('collector:sync-now', async (_event, raw) => {
    const parsed = terminalIdSchema.safeParse(raw);
    if (!parsed.success) return failure('Plataforma inválida.');
    await collectorManager.syncNow(parsed.data); return success(true);
  });
  ipcMain.handle('rounds:recent',(_event,raw)=>{const parsed=recentRoundsQuerySchema.safeParse(raw);return parsed.success?success(database.getRecentRoundsByFeed(parsed.data.platformId,parsed.data.limit)):failure('Filtro de rodadas inválido.');});
  ipcMain.handle('ai:settings:get',():ApiResult<AiSettingsView>=>success(openRouterService.getSettings()));
  ipcMain.handle('ai:settings:save',(_event,raw):ApiResult<AiSettingsView>=>{const parsed=aiSettingsInputSchema.safeParse(raw);if(!parsed.success)return failure(parsed.error.issues.map(issue=>issue.message).join(' '));try{return success(openRouterService.saveSettings(parsed.data))}catch(error){return failure(error instanceof Error?error.message:'Não foi possível salvar a configuração da IA.')}});
  ipcMain.handle('ai:connection:test',async():Promise<ApiResult<{label:string;limit:number|null;limitRemaining:number|null}>>=>{try{return success(await openRouterService.testConnection())}catch(error){return failure(error instanceof Error?error.message:'Falha ao conectar ao OpenRouter.')}});
  ipcMain.handle('ai:models:list',async():Promise<ApiResult<AiModelOption[]>>=>{try{return success(await openRouterService.listModels())}catch(error){return failure(error instanceof Error?error.message:'Não foi possível carregar os modelos.')}});
  ipcMain.handle('ai:chat',async(_event,raw):Promise<ApiResult<AiChatResponse>>=>{const parsed=aiChatRequestSchema.safeParse(raw);if(!parsed.success)return failure(parsed.error.issues.map(issue=>issue.message).join(' '));try{return success(await openRouterService.chat(parsed.data))}catch(error){return failure(error instanceof Error?error.message:'Falha na análise da IA.')}});
  ipcMain.handle('backtest:run', (_event, raw): ApiResult<BacktestRun> => {
    const parsed = backtestRequestSchema.safeParse(raw);
    if (!parsed.success) return failure('Parâmetros do backtest inválidos.');
    const request = parsed.data;
    const rounds = database.getBacktestRounds(request.platformId, request.limit);
    const gameStrategy = database.getGameStrategyConfig(request.gameStrategyId);
    const betStrategy = database.getBetStrategyConfig(request.betStrategyId);
    const betPlan = database.getBetPlanConfig(request.betPlanId);
    if (!gameStrategy || !betStrategy || !betPlan) return failure('Estratégia ou plano de aposta não encontrado.');
    if (rounds.length < 10) return failure('São necessárias pelo menos 10 rodadas para executar o backtest.');
    const run = new SimulationEngine().run({ rounds, gameStrategyId: request.gameStrategyId, gameStrategy, betStrategyId: request.betStrategyId, betStrategy, betPlan, initialBankrollCents: request.initialBankrollCents });
    database.logEvent('BACKTEST', 'INFO', 'BACKTEST_COMPLETED', { platformId: request.platformId, rounds: rounds.length, profitCents: run.report.profitCents, roi: run.report.roi });
    return success(run);
  });
  ipcMain.handle('audit:list', (_event, raw): ApiResult<AuditRecord[]> => {
    const parsed = auditQuerySchema.safeParse(raw ?? {});
    return parsed.success ? success(database.listAudit(parsed.data.limit, parsed.data.category)) : failure('Filtro de auditoria inválido.');
  });
  ipcMain.handle('system:diagnostics', (): ApiResult<SystemDiagnostics> => success(database.getSystemDiagnostics()));
  ipcMain.handle('system:benchmark',():ApiResult<PerformanceBenchmarkResult[]>=>{const terminal=database.listTerminals()[0];if(!terminal)return failure('Cadastre ao menos um Terminal.');const rounds=database.getRecentRounds(terminal.platformId,500).reverse();if(rounds.length<10)return failure('São necessárias ao menos 10 rodadas persistidas.');const gameStrategy=database.getGameStrategyConfig(terminal.gameStrategyId);const betStrategy=database.getBetStrategyConfig(terminal.betStrategyId);const betPlan=database.getBetPlanConfig(terminal.betPlanId);if(!gameStrategy||!betStrategy||!betPlan)return failure('Configuração do Terminal inválida.');const engine=new SimulationEngine();const results=[10,20,50,100].map(terminalCount=>{const started=performance.now();for(let index=0;index<terminalCount;index++)engine.run({rounds,gameStrategyId:terminal.gameStrategyId,gameStrategy,betStrategyId:terminal.betStrategyId,betStrategy,betPlan,initialBankrollCents:terminal.initialBankrollCents});const durationMs=Math.max(.01,performance.now()-started);const totalEvaluations=terminalCount*rounds.length;return{terminalCount,roundsPerTerminal:rounds.length,totalEvaluations,durationMs,evaluationsPerSecond:Math.round(totalEvaluations/durationMs*1000)}});database.logEvent('SYSTEM','INFO','PERFORMANCE_BENCHMARK_FINISHED',{results});return success(results);});
  ipcMain.handle('recovery:list',():ApiResult<RecoverySnapshot[]>=>success(database.listRecoverySnapshots()));
  ipcMain.handle('recovery:restore',(_event,raw):ApiResult<boolean>=>{const parsed=recoverySnapshotIdSchema.safeParse(raw);if(!parsed.success)return failure('Snapshot inválido.');try{screenAutomation.setPaused(true);database.restoreRecoverySnapshot(parsed.data);notifyDataChanged();return success(true);}catch(error){return failure(error instanceof Error?error.message:'Falha ao restaurar snapshot.');}});
  ipcMain.handle('workspace:export', async (): Promise<ApiResult<string | null>> => {
    const target = await dialog.showSaveDialog(mainWindow!, { title:'Exportar workspace',defaultPath:`aviator-workspace-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'Aviator JSON',extensions:['json']}] });
    if (target.canceled || !target.filePath) return success(null);
    await writeFile(target.filePath, JSON.stringify(database.exportWorkspace(), null, 2), 'utf8'); database.logEvent('SYSTEM','INFO','WORKSPACE_EXPORTED',{filePath:target.filePath}); return success(target.filePath);
  });
  ipcMain.handle('workspace:import', async (): Promise<ApiResult<boolean>> => {
    const target = await dialog.showOpenDialog(mainWindow!, { title:'Importar workspace',properties:['openFile'],filters:[{name:'Aviator JSON',extensions:['json']}] });
    if (target.canceled || !target.filePaths[0]) return success(false);
    try { const parsed=workspaceArchiveSchema.safeParse(JSON.parse(await readFile(target.filePaths[0],'utf8'))); if(!parsed.success) return failure('Arquivo de workspace inválido ou incompatível.'); screenAutomation.setPaused(true); database.importWorkspace(parsed.data); return success(true); }
    catch(error) { return failure(error instanceof Error ? error.message : 'Falha ao importar workspace.'); }
  });
  ipcMain.handle('configuration:list', (_event, raw): ApiResult<ConfigurationDocument[]> => { const kinds:ConfigurationKind[]=['GAME_STRATEGY','BET_STRATEGY','BET_PLAN','SCHEDULE_PLAN']; const kind=raw?.kind as ConfigurationKind|undefined; return kind&&!kinds.includes(kind)?failure('Tipo de configuração inválido.'):success(database.listConfigurationDocuments(kind)); });
  ipcMain.handle('configuration:save', (_event, raw): ApiResult<ConfigurationDocument> => { const parsed=saveConfigurationSchema.safeParse(raw);if(!parsed.success)return failure(parsed.error.issues.map(issue=>`${issue.path.join('.')||'configuração'}: ${issue.message}`).join(' '));const document=database.saveConfiguration(parsed.data);notifyDataChanged();return success(document); });
  ipcMain.handle('configuration:duplicate', (_event, raw): ApiResult<ConfigurationDocument> => {const parsed=configurationActionSchema.safeParse(raw);if(!parsed.success)return failure('Configuração inválida.');const copy=database.duplicateConfiguration(parsed.data.id,parsed.data.kind);if(!copy)return failure('Configuração não encontrada.');notifyDataChanged();return success(copy);});
  ipcMain.handle('configuration:delete', (_event, raw): ApiResult<boolean> => {const parsed=configurationActionSchema.safeParse(raw);if(!parsed.success)return failure('Configuração inválida.');try{database.deleteConfiguration(parsed.data.id,parsed.data.kind);notifyDataChanged();return success(true);}catch(error){return failure(error instanceof Error?error.message:'Não foi possível excluir.');}});
  ipcMain.handle('app:restart', () => { screenAutomation.setPaused(true); app.relaunch(); app.exit(0); return true; });
  ipcMain.handle('window:minimize', (event) => { BrowserWindow.fromWebContents(event.sender)?.minimize(); return true; });
  ipcMain.handle('window:maximize', (event) => { const target = BrowserWindow.fromWebContents(event.sender); if (target?.isMaximized()) target.unmaximize(); else target?.maximize(); return true; });
  ipcMain.handle('window:close', (event) => { BrowserWindow.fromWebContents(event.sender)?.close(); return true; });
}

function notifyDataChanged() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:data-changed'); }

function success<T>(data: T): ApiResult<T> { return { ok: true, data }; }
function failure<T>(error: string): ApiResult<T> { return { ok: false, error }; }
function screenTransform(display: Display) { return { x: Math.round(display.bounds.x * display.scaleFactor), y: Math.round(display.bounds.y * display.scaleFactor), scaleFactor: display.scaleFactor }; }
