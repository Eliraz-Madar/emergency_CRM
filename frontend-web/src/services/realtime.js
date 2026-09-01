import { connectToUpdatesStream } from '../api/client.js';

/**
 * Manages the real-time SSE connection.
 *
 * Guarantees AT MOST ONE live EventSource per instance: a dropped connection
 * is fully closed (handlers detached + `.close()`) before a replacement is
 * scheduled, and only one reconnect timer can be pending at a time. Left
 * unchecked, an orphaned EventSource keeps its own socket + `onmessage` alive
 * on the server's subscriber list — every event then reaches the tab several
 * times, which the war-room announcement code would speak once per copy.
 */

export class RealtimeService {
  constructor(onUpdate, onError) {
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.eventSource = null;
    this.isConnecting = false;
    this.reconnectInterval = 3000;
    this.maxReconnectInterval = 30000;
    this.reconnectCount = 0;
    this._reconnectTimer = null;
    this._closed = false;
  }

  connect() {
    if (this._closed || this.isConnecting || this.eventSource) return;

    this.isConnecting = true;

    try {
      const es = connectToUpdatesStream();
      this.eventSource = es;

      es.onopen = () => {
        if (this.eventSource !== es) { this._teardown(es); return; } // superseded
        console.log('[Realtime] Connected to updates stream');
        this.reconnectCount = 0;
        this.isConnecting = false;
        this.onUpdate?.({ type: 'connected', timestamp: new Date().toISOString() });
      };

      es.onmessage = (event) => {
        // Ignore anything from a socket we've already replaced.
        if (this.eventSource !== es) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'heartbeat') {
            this.onUpdate?.(data);
          }
        } catch (error) {
          console.error('[Realtime] Error parsing message:', error);
          this.onError?.({ type: 'parse_error', error });
        }
      };

      es.onerror = () => {
        this.isConnecting = false;
        if (this.eventSource !== es) return; // already handled / replaced
        // Take full ownership of reconnection: close THIS socket (killing the
        // browser's own silent auto-retry) and schedule exactly one reconnect
        // of our own. Leaving the native retry running while our own
        // `_scheduleReconnect` / the dashboard's `reconnectNonce` also fire is
        // how a single tab ends up with two live streams delivering every
        // event twice — which is what doubled the spoken announcements.
        this._teardown(es);
        this.eventSource = null;
        this.onError?.({ type: 'connection_dropped' });
        this._scheduleReconnect();
      };
    } catch (error) {
      console.error('[Realtime] Failed to connect:', error);
      this.isConnecting = false;
      this.eventSource = null;
      this.onError?.({ type: 'connection_error', error });
      this._scheduleReconnect();
    }
  }

  _teardown(es) {
    if (!es) return;
    try {
      es.onopen = null;
      es.onmessage = null;
      es.onerror = null;
      es.close();
    } catch (_) {
      /* already gone */
    }
  }

  _scheduleReconnect() {
    if (this._closed || this._reconnectTimer || this.eventSource) return;
    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectCount),
      this.maxReconnectInterval,
    );
    this.reconnectCount += 1;
    console.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${this.reconnectCount})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect() {
    this._closed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._teardown(this.eventSource);
    this.eventSource = null;
    this.isConnecting = false;
    console.log('[Realtime] Disconnected');
  }

  isConnected() {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
