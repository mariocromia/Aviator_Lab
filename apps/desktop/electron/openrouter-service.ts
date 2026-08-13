import { safeStorage } from 'electron';
import type { AiChatRequest, AiChatResponse, AiModelOption, AiSettingsView, NormalizedRound, TerminalHistoryItem } from '@aviator/shared';
import type { AppDatabase } from './database.js';

const SETTINGS_KEY = 'openrouter.ai';
const DEFAULT_MODEL = 'openrouter/auto';
const DEFAULT_TRANSCRIPTION_MODEL = 'openai/whisper-1';

interface StoredAiSettings { model: string; transcriptionModel: string; encryptedApiKey: string | null; }
interface OpenRouterErrorPayload { error?: { message?: string }; }

export class OpenRouterService {
  constructor(private readonly database: AppDatabase, private readonly fetcher: typeof fetch) {}

  getSettings(): AiSettingsView {
    const stored = this.readSettings();
    return {
      model: stored.model,
      transcriptionModel: stored.transcriptionModel,
      hasApiKey: Boolean(stored.encryptedApiKey),
      maskedApiKey: stored.encryptedApiKey ? 'sk-or-••••••••••••••••' : null
    };
  }

  saveSettings(input: { apiKey: string | null; model: string; transcriptionModel: string; clearApiKey: boolean }): AiSettingsView {
    const current = this.readSettings();
    let encryptedApiKey = input.clearApiKey ? null : current.encryptedApiKey;
    if (input.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('A proteção segura de credenciais não está disponível neste computador.');
      encryptedApiKey = safeStorage.encryptString(input.apiKey).toString('base64');
    }
    this.database.setAppSetting(SETTINGS_KEY, { model: input.model, transcriptionModel: input.transcriptionModel, encryptedApiKey });
    this.database.logEvent('AI', 'INFO', 'OPENROUTER_SETTINGS_UPDATED', { model: input.model, transcriptionModel: input.transcriptionModel, hasApiKey: Boolean(encryptedApiKey) });
    return this.getSettings();
  }

  async testConnection(): Promise<{ label: string; limit: number | null; limitRemaining: number | null }> {
    const response = await this.request('https://openrouter.ai/api/v1/key', { method: 'GET' });
    const payload = await response.json() as { data?: { label?: string; limit?: number | null; limit_remaining?: number | null } };
    return { label: payload.data?.label ?? 'Chave OpenRouter', limit: payload.data?.limit ?? null, limitRemaining: payload.data?.limit_remaining ?? null };
  }

  async listModels(): Promise<AiModelOption[]> {
    const response = await this.request('https://openrouter.ai/api/v1/models/user', { method: 'GET' });
    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    return (payload.data ?? []).map(item => {
      const architecture = item.architecture as { input_modalities?: string[] } | undefined;
      const pricing = item.pricing as { prompt?: string; completion?: string } | undefined;
      return {
        id: String(item.id ?? ''), name: String(item.name ?? item.id ?? ''),
        contextLength: typeof item.context_length === 'number' ? item.context_length : null,
        inputModalities: architecture?.input_modalities ?? [],
        promptPrice: pricing?.prompt ?? null, completionPrice: pricing?.completion ?? null
      };
    }).filter(model => model.id).sort((a,b) => a.name.localeCompare(b.name));
  }

  async chat(input: AiChatRequest): Promise<AiChatResponse> {
    const settings = this.readSettings();
    const transcript = input.audio ? await this.transcribe(input.audio, settings.transcriptionModel) : null;
    const prompt = input.prompt ?? transcript;
    if (!prompt) throw new Error('Não foi possível obter uma mensagem para análise.');
    const context = this.buildContext(input);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `DADOS DO SISTEMA SELECIONADOS\n${JSON.stringify(context.data)}` },
      ...input.messages.slice(-12).map(message => ({ role: message.role, content: message.content })),
      { role: 'user', content: prompt }
    ];
    const response = await this.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'HTTP-Referer': 'https://aviator-strategy-lab.local', 'X-Title': 'Aviator Strategy Lab' },
      body: JSON.stringify({ model: settings.model, messages, temperature: 0.2, max_tokens: 1400, stream: false })
    });
    const payload = await response.json() as {
      model?: string; choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const rawContent = payload.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent : rawContent?.map(part => part.text ?? '').join('') ?? '';
    if (!content.trim()) throw new Error('O modelo não retornou conteúdo para esta análise.');
    this.database.logEvent('AI', 'INFO', 'AI_ANALYSIS_COMPLETED', { model: payload.model ?? settings.model, scope: context.scope, analyzedRecords: context.records, totalTokens: payload.usage?.total_tokens ?? null });
    return {
      content: content.trim(), model: payload.model ?? settings.model, transcript, analyzedRecords: context.records,
      usage: payload.usage ? { promptTokens: payload.usage.prompt_tokens ?? 0, completionTokens: payload.usage.completion_tokens ?? 0, totalTokens: payload.usage.total_tokens ?? 0 } : null
    };
  }

  private async transcribe(audio: NonNullable<AiChatRequest['audio']>, model: string): Promise<string> {
    const response = await this.request('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input_audio: { data: audio.data, format: audio.format }, language: 'pt', temperature: 0 })
    });
    const payload = await response.json() as { text?: string };
    if (!payload.text?.trim()) throw new Error('O modelo de transcrição não reconheceu o áudio.');
    return payload.text.trim();
  }

  private buildContext(input: AiChatRequest): { scope: string; records: number; data: unknown } {
    if (input.terminalId) {
      const terminal = this.database.getTerminal(input.terminalId);
      if (!terminal) throw new Error('Terminal não encontrado.');
      const platform = this.database.getPlatform(terminal.platformId);
      const history = this.database.getTerminalHistory(terminal.id, input.historyLimit);
      const executions = history.flatMap(item => item.execution ? [item.execution] : []);
      const wins = history.filter(item => item.gameResult === 'WIN').length;
      const losses = history.filter(item => item.gameResult === 'LOSS').length;
      const profitLossCents = executions.reduce((sum,item) => sum + item.profitLossCents, 0);
      return { scope: `terminal:${terminal.id}`, records: history.length, data: {
        scope: 'TERMINAL', terminal: { id: terminal.id, name: terminal.name, mode: terminal.mode, paused: terminal.paused, initialBankrollCents: terminal.initialBankrollCents, currentBankrollCents: terminal.currentBankrollCents },
        platform: platform ? { id: platform.id, name: platform.name } : null,
        strategy: { game: this.database.getGameStrategyConfig(terminal.gameStrategyId), afterWin: {entry:this.database.getBetStrategyConfig(terminal.betStrategyWinId),plan:this.database.getBetPlanConfig(terminal.betPlanWinId)}, afterLoss:{entry:this.database.getBetStrategyConfig(terminal.betStrategyLossId),plan:this.database.getBetPlanConfig(terminal.betPlanLossId)} },
        sample: { requested: input.historyLimit, available: history.length, wins, losses, winRate: history.length ? wins / history.length : 0, executions: executions.length, profitLossCents },
        recentHistory: compactTerminalHistory(history.slice(-160))
      }};
    }
    const platform = input.platformId ? this.database.getPlatform(input.platformId) : null;
    if (!platform) throw new Error('Plataforma não encontrada.');
    const rounds = this.database.getRecentRoundsByFeed(platform.id, input.historyLimit);
    return { scope: `platform:${platform.id}`, records: rounds.length, data: { scope: 'PLATFORM', platform: { id: platform.id, name: platform.name, game: platform.game }, sample: summarizeRounds(rounds), recentRounds: compactRounds(rounds.slice(0, 200)) } };
  }

  private readSettings(): StoredAiSettings {
    const stored = this.database.getAppSetting<Partial<StoredAiSettings>>(SETTINGS_KEY);
    return { model: stored?.model || DEFAULT_MODEL, transcriptionModel: stored?.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL, encryptedApiKey: stored?.encryptedApiKey ?? null };
  }

  private getApiKey(): string {
    const encrypted = this.readSettings().encryptedApiKey;
    if (!encrypted) throw new Error('Configure a chave da API do OpenRouter antes de usar o Analista IA.');
    try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); }
    catch { throw new Error('Não foi possível desbloquear a chave do OpenRouter neste computador. Cadastre-a novamente.'); }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${this.getApiKey()}`);
      const response = await this.fetcher(url, { ...init, headers, signal: controller.signal });
      if (!response.ok) {
        let detail = '';
        try { detail = ((await response.json()) as OpenRouterErrorPayload).error?.message ?? ''; } catch { detail = ''; }
        const known = response.status === 401 ? 'Chave do OpenRouter inválida ou desativada.' : response.status === 402 ? 'A conta do OpenRouter está sem créditos disponíveis.' : response.status === 429 ? 'Limite de requisições do OpenRouter atingido.' : response.status === 503 ? 'O modelo selecionado está temporariamente indisponível.' : null;
        throw new Error(known ?? (detail || `OpenRouter retornou o erro HTTP ${response.status}.`));
      }
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('A solicitação ao OpenRouter excedeu 60 segundos.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
}

const SYSTEM_PROMPT = `Você é o Analista IA do Aviator Strategy Lab. Responda sempre em português do Brasil. Analise somente os dados fornecidos. Separe fatos observados, hipóteses e sugestões. Não alegue prever resultados aleatórios, não prometa lucro e não trate correlação como causalidade. Ao sugerir uma estratégia, apresente critérios objetivos, riscos, tamanho da amostra e um protocolo de backtest/simulação antes de qualquer uso. Nunca ordene cliques, apostas ou alterações automáticas; você apenas analisa e propõe testes. Valores monetários estão em centavos.`;

function compactTerminalHistory(history: TerminalHistoryItem[]) { return history.map(item => ({ at: item.createdAt, multiplier: item.multiplier, signal: item.gameResult, decision: item.decisionAction, stage: item.stage?.stageLabel ?? null, stageResult: item.stage?.result ?? null, stakeCents: item.execution?.stakeCents ?? null, profitLossCents: item.execution?.profitLossCents ?? null, bankrollAfterCents: item.execution?.bankrollAfterCents ?? null })); }
function compactRounds(rounds: NormalizedRound[]) { return rounds.map(round => ({ at: round.occurredAt, multiplier: round.multiplier })); }
function summarizeRounds(rounds: NormalizedRound[]) {
  const values=rounds.map(round=>round.multiplier);const sorted=[...values].sort((a,b)=>a-b);const count=values.length;const mean=count?values.reduce((a,b)=>a+b,0)/count:0;const median=count?sorted[Math.floor(count/2)]:0;
  return { requested: count, count, min: sorted[0]??null, max: sorted.at(-1)??null, mean, median, below2: values.filter(value=>value<2).length, atLeast2: values.filter(value=>value>=2).length, atLeast5: values.filter(value=>value>=5).length, atLeast10: values.filter(value=>value>=10).length, recentPattern: values.slice(0,100).map(value=>value>=2?'W':'L').join('') };
}
