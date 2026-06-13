import { WS_BASE } from './api';

type EventHandler = (data: any) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, EventHandler[]>();
  private reconnectAttempts = 0;
  private maxReconnects = 5;
  private token: string;
  private sessionId: string;

  constructor(token: string, sessionId: string) {
    this.token = token;
    this.sessionId = sessionId;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${WS_BASE}?token=${encodeURIComponent(this.token)}&sessionId=${encodeURIComponent(this.sessionId)}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('✅ WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.emit(msg.event, msg.data);
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log('🔴 WebSocket closed:', event.code, event.reason);
        this.emit('disconnected', { code: event.code, reason: event.reason });

        // Don't reconnect on application-level close codes (4001=auth, 4002-4005=session errors, 4008=replaced)
        const noReconnectCodes = [4001, 4002, 4003, 4004, 4005, 4008];
        const shouldReconnect = this.reconnectAttempts < this.maxReconnects
          && !noReconnectCodes.includes(event.code)
          && event.code !== 1000; // Normal close

        if (shouldReconnect) {
          const delay = Math.min(2000 * Math.pow(1.5, this.reconnectAttempts), 15000);
          setTimeout(() => {
            this.reconnectAttempts++;
            console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnects})`);
            this.connect().catch(() => {});
          }, delay);
        }
      };

      this.ws.onerror = (err) => {
        console.error('WS error:', err);
        reject(err);
      };
    });
  }

  send(event: string, data: any = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(event, handlers.filter(h => h !== handler));
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(h => h(data));
    }
  }

  disconnect(): void {
    this.maxReconnects = 0; // Prevent reconnection
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
