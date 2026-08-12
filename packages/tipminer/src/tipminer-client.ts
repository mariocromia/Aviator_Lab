export interface TipMinerHistoryRequest {
  roundUuid: string;
  limit: number;
  timeoutMs: number;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class TipMinerHttpError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export class TipMinerClient {
  constructor(private readonly fetcher: FetchLike = globalThis.fetch) {}

  async getHistory(request: TipMinerHistoryRequest): Promise<unknown[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    const url = `https://api.core.public.tipminer.com/v1/crash/rounds/${encodeURIComponent(request.roundUuid)}/history?limit=${request.limit}`;
    try {
      const response = await this.fetcher(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new TipMinerHttpError(`TipMiner respondeu HTTP ${response.status}.`, response.status);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new TipMinerHttpError('Payload TipMiner não é uma lista de rodadas.');
      return body;
    } catch (error) {
      if (error instanceof TipMinerHttpError) throw error;
      if (controller.signal.aborted) throw new TipMinerHttpError(`Timeout TipMiner após ${request.timeoutMs} ms.`);
      throw new TipMinerHttpError(error instanceof Error ? error.message : 'Falha HTTP desconhecida.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
