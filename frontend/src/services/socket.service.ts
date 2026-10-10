import { io, Socket } from 'socket.io-client';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

class SocketService {
  private socket: Socket | null = null;
  private isConnectedState: boolean = false;
  private statusListeners: Set<(connected: boolean) => void> = new Set();

  /**
   * Connects to the Socket.IO server using the provided JWT token.
   * Only connects when an authenticated token is available.
   * @param token JWT authentication token
   */
  connect(token: string): Socket {
    if (!token) {
      throw new Error('SocketService: An authentication token is required to connect.');
    }

    // If socket is already connected with the same token, reuse it
    if (this.socket && this.socket.connected) {
      return this.socket;
    }

    // Clean up previous socket if existing
    this.disconnect();

    this.socket = io(SOCKET_URL, {
      auth: {
        token
      },
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      this.isConnectedState = true;
      this.notifyStatusListeners(true);
    });

    this.socket.on('disconnect', () => {
      this.isConnectedState = false;
      this.notifyStatusListeners(false);
    });

    this.socket.on('connect_error', (error) => {
      console.warn('[SocketService] Connection error:', error.message);
      this.isConnectedState = false;
      this.notifyStatusListeners(false);
    });

    return this.socket;
  }

  /**
   * Disconnects the socket cleanly.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.isConnectedState = false;
      this.notifyStatusListeners(false);
    }
  }

  /**
   * Returns the current Socket instance or null if not initialized.
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Returns whether the socket is currently connected.
   */
  isConnected(): boolean {
    return this.isConnectedState && (this.socket?.connected ?? false);
  }

  /**
   * Subscribes a listener to connection status changes.
   * Returns an unsubscribe function.
   */
  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.isConnected());
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private notifyStatusListeners(connected: boolean): void {
    this.statusListeners.forEach((callback) => callback(connected));
  }
}

export const socketService = new SocketService();
