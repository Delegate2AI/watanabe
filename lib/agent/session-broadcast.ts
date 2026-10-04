import type { AgentEvent } from "./events";

export type Subscriber = (event: AgentEvent) => void;

export class SessionBroadcaster {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  emit(event: AgentEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        continue;
      }
    }
  }
}
