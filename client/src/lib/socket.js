import { io } from 'socket.io-client';

let socket;
export function getSocket() {
  if (!socket) {
    const url = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') || undefined;
    socket = io(url, { withCredentials: true, autoConnect: false, transports: ['websocket', 'polling'] });
  }
  return socket;
}
export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
