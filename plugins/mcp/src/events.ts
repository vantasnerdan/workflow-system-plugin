/**
 * Push (architecture 6.3, US-D-32): the plugin holds `GET /api/v1/agent/events` open and hands each
 * new inbox item to the binding, which shows it in the harness as a visible message. It reconnects
 * with `Last-Event-ID` after a break, so nothing is skipped; and the inbox stays the complete record
 * whether or not push works. A refusal that will not change by retrying (paused, key revoked or
 * expired, owner inactive) stops the stream and is reported once.
 */
import { isWfError, type Schemas, type WfClient, type WfError } from '@wf/client';
import type { StateStore } from './state.ts';

export type InboxItem = Schemas['Event_inbox_item'];

const FINAL = new Set(['paused', 'key_revoked', 'key_expired', 'owner_inactive', 'deactivated', 'unauthenticated']);

export interface EventPumpOptions {
  client: WfClient;
  state: StateStore;
  onItem(item: InboxItem): void | Promise<void>;
  onStopped?(error: WfError): void | Promise<void>;
  onState?(connected: boolean): void;
  /** First wait after a break, doubled up to maxDelayMs. */
  minDelayMs?: number;
  maxDelayMs?: number;
}

export class EventPump {
  connected = false;
  stopped: WfError | null = null;
  private readonly abort = new AbortController();
  private running: Promise<void> | null = null;

  private readonly options: EventPumpOptions;

  constructor(options: EventPumpOptions) {
    this.options = options;
  }

  start(): void {
    this.running ??= this.loop();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.running?.catch(() => undefined);
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    this.options.onState?.(value);
  }

  private async loop(): Promise<void> {
    const min = this.options.minDelayMs ?? 1000;
    const max = this.options.maxDelayMs ?? 30_000;
    let delay = min;
    while (!this.abort.signal.aborted) {
      try {
        const lastEventId = this.options.state.read().lastEventId;
        const stream = this.options.client.stream(
          'agent_events',
          {},
          {
            signal: this.abort.signal,
            onOpen: () => {
              this.setConnected(true);
              delay = min;
            },
            ...(lastEventId ? { lastEventId } : {}),
          },
        );
        for await (const message of stream) {
          if (message.event === 'inbox_item') {
            await this.options.onItem(message.data as InboxItem);
            const id = message.id;
            if (id) {
              this.options.state.update((s) => {
                s.lastEventId = id;
              });
            }
          }
        }
      } catch (error) {
        if (this.abort.signal.aborted) break;
        if (isWfError(error) && FINAL.has(error.code)) {
          this.setConnected(false);
          this.stopped = error;
          await this.options.onStopped?.(error);
          return;
        }
      }
      this.setConnected(false);
      if (this.abort.signal.aborted) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delay);
        this.abort.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve(undefined);
          },
          { once: true },
        );
      });
      delay = Math.min(max, delay * 2);
    }
    this.setConnected(false);
  }
}

/**
 * The visible text of one inbox item, as a person would read it: what happened, the tool that opens it,
 * the page on the site (the site sends a path; it is shown as a full address), and the unread count.
 */
export function inboxItemText(item: InboxItem, site: string): string {
  const n = item.notification;
  const open = n.stepId ? `step_open with step ${n.stepId}` : n.runId ? `run_map with run ${n.runId}` : null;
  const page = new URL(n.link, site).toString();
  return [
    n.title,
    ...(open ? [`Read it: ${open}`] : []),
    `Page: ${page}`,
    `Type: ${n.type}. ${item.unread} unread in the inbox (inbox_read to read, inbox_ack to acknowledge).`,
  ].join('\n');
}
