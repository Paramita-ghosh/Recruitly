import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { query } from '../config/database.js';

let io = null;

function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.FRONTEND_URL, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, 'recruitly_token');
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, env.JWT_SECRET);
      const { rows } = await query('SELECT id, role FROM users WHERE id = $1 AND is_active', [payload.sub]);
      if (!rows[0]) return next(new Error('unauthorized'));
      socket.data.user = rows[0];
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    socket.join(`role:${role}`);
  });
  return io;
}

export const emitToUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToRole = (role, event, payload) => io?.to(`role:${role}`).emit(event, payload);
