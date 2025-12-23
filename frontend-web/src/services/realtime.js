import { connectToUpdatesStream } from '../api/client.js';

/**
 * Manages real-time connection using Server-Sent Events.
 * Handles connection state, reconnection, and event routing.
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
  }

  connect() {
    if (this.isConnecting || this.eventSource) return;

    this.isConnecting = true;

    try {
      this.eventSource = connectToUpdatesStream();

      this.eventSource.onopen = () => {
        console.log('[Realtime] Connected to updates stream');
        this.reconnectCount = 0;
        this.onUpdate?.({
          type: 'connected',
          timestamp: new Date().toISOString(),
        });
        this.isConnecting = false;
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'heartbeat') {
            console.log('[Realtime] Received update:', data);
            this.onUpdate?.(data);
          }
        } catch (error) {
          console.error('[Realtime] Error parsing message:', error);
          this.onError?.({ type: 'parse_error', error });
        }
      };

      this.eventSource.onerror = (error) => {
        console.error('[Realtime] Connection error:', error);
        this.isConnecting = false;

        if (this.eventSource.readyState === EventSource.CLOSED) {
          this.eventSource = null;
          this.reconnect();
        }
      };
    } catch (error) {
      console.error('[Realtime] Failed to connect:', error);
      this.isConnecting = false;
      this.onError?.({ type: 'connection_error', error });
      this.reconnect();
    }
  }

  reconnect() {
    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectCount),
      this.maxReconnectInterval
    );
    this.reconnectCount++;

    console.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${this.reconnectCount})`);
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnecting = false;
      console.log('[Realtime] Disconnected');
    }
  }

  isConnected() {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}

