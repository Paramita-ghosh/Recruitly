import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import env from './config/env.js';
import { csrfGuard } from './middleware/csrf.js';
import { apiLimiter, authLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
//import companiesRoutes from './routes/companies.routes.js';
// import drivesRoutes from './routes/drives.routes.js';
// import roomsRoutes from './routes/rooms.routes.js';
// import candidatesRoutes from './routes/candidates.routes.js';
// import interviewersRoutes from './routes/interviewers.routes.js';
// import availabilityRoutes from './routes/availability.routes.js';
// import schedulingRoutes from './routes/scheduling.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
// import interviewsRoutes from './routes/interviews.routes.js';
// import evaluationsRoutes from './routes/evaluations.routes.js';
// import notificationsRoutes from './routes/notifications.routes.js';
// import calendarRoutes from './routes/calendar.routes.js';
// import importsRoutes from './routes/imports.routes.js';
// import reportsRoutes from './routes/reports.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true, allowedHeaders: ['Content-Type', 'X-Requested-With', 'Authorization'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter, csrfGuard);

  app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));
  app.use('/api/auth', authRoutes);
  app.use('/api/bookings', bookingsRoutes);
//   app.use('/api/calendar', calendarRoutes);
//   app.use('/api/companies', companiesRoutes);
//   app.use('/api/availability', availabilityRoutes);
//   app.use('/api/interviews', interviewsRoutes);
//   app.use('/api/notifications', notificationsRoutes);
//   app.use('/api/imports', importsRoutes);
     app.use('/api', usersRoutes);
//   app.use('/api', drivesRoutes);
//   app.use('/api', roomsRoutes);
//   app.use('/api', candidatesRoutes);
//   app.use('/api', interviewersRoutes);
//   app.use('/api', schedulingRoutes);
//   app.use('/api', evaluationsRoutes);
//   app.use('/api', reportsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

void authLimiter;
