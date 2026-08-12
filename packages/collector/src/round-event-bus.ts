import type { RoundEvent, RoundEventBusSnapshot } from '@aviator/shared';

export type RoundEventHandler = (event: RoundEvent) => void | Promise<void>;

export class RoundEventBus {
  private readonly subscribers = new Map<string, Map<string, RoundEventHandler>>();
  private publishedEvents = 0;
  private deliveredEvents = 0;
  private failedDeliveries = 0;

  subscribe(platformId: string, terminalId: string, handler: RoundEventHandler): () => void {
    let platformSubscribers = this.subscribers.get(platformId);
    if (!platformSubscribers) { platformSubscribers = new Map(); this.subscribers.set(platformId, platformSubscribers); }
    platformSubscribers.set(terminalId, handler);
    return () => {
      const current = this.subscribers.get(platformId);
      current?.delete(terminalId);
      if (current?.size === 0) this.subscribers.delete(platformId);
    };
  }

  async publish(event: RoundEvent): Promise<number> {
    this.publishedEvents++;
    const handlers = [...(this.subscribers.get(event.platformId)?.values() ?? [])];
    const results = await Promise.allSettled(handlers.map(handler => Promise.resolve().then(() => handler(event))));
    const delivered = results.filter(result => result.status === 'fulfilled').length;
    this.deliveredEvents += delivered;
    this.failedDeliveries += results.length - delivered;
    return delivered;
  }

  snapshot(): RoundEventBusSnapshot {
    return { publishedEvents: this.publishedEvents, deliveredEvents: this.deliveredEvents, failedDeliveries: this.failedDeliveries, subscribersByPlatform: Object.fromEntries([...this.subscribers].map(([platformId, subscribers]) => [platformId, subscribers.size])) };
  }
}
