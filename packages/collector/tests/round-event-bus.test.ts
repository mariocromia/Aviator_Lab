import { describe, expect, it, vi } from 'vitest';
import type { NormalizedRound } from '@aviator/shared';
import { RoundEventBus } from '../src/index.js';

const round: NormalizedRound = { id: crypto.randomUUID(), platformId: crypto.randomUUID(), externalId: '1', multiplier: 1.5, occurredAt: new Date().toISOString(), collectedAt: new Date().toISOString(), source: 'TIPMINER', deliveryMode: 'LIVE', dedupKey: 'external:1' };

describe('RoundEventBus', () => {
  it('delivers one platform event once to every subscribed terminal', async () => {
    const bus = new RoundEventBus(); const handlers = Array.from({ length: 10 }, () => vi.fn());
    handlers.forEach((handler, index) => bus.subscribe(round.platformId, `terminal-${index}`, handler));
    const delivered = await bus.publish({ id: crypto.randomUUID(), platformId: round.platformId, round, publishedAt: new Date().toISOString() });
    expect(delivered).toBe(10); expect(handlers.every(handler => handler.mock.calls.length === 1)).toBe(true);
    expect(bus.snapshot().subscribersByPlatform[round.platformId]).toBe(10);
  });

  it('never crosses platform subscriptions', async () => {
    const bus = new RoundEventBus(); const wrongPlatform = vi.fn();
    bus.subscribe(crypto.randomUUID(), 'terminal-other', wrongPlatform);
    await bus.publish({ id: crypto.randomUUID(), platformId: round.platformId, round, publishedAt: new Date().toISOString() });
    expect(wrongPlatform).not.toHaveBeenCalled();
  });

  it('isolates a failing terminal handler from the others', async () => {
    const bus = new RoundEventBus(); const healthy = vi.fn();
    bus.subscribe(round.platformId, 'broken', () => { throw new Error('runtime failure'); });
    bus.subscribe(round.platformId, 'healthy', healthy);
    expect(await bus.publish({ id: crypto.randomUUID(), platformId: round.platformId, round, publishedAt: new Date().toISOString() })).toBe(1);
    expect(healthy).toHaveBeenCalledOnce(); expect(bus.snapshot().failedDeliveries).toBe(1);
  });
});
