// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import supabase from './config/supabase.js';

const app = express();
const port = process.env.PORT || 5000;

// ─── CORS Configuration ───────────────────────────────────────────────
const allowedOrigins = [
  process.env.STUDENT_CLIENT_URL,
  process.env.TEACHER_CLIENT_URL,
  process.env.ADMIN_CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(null, true); // Allow in development, change to callback(new Error(...)) in strict mode
    }
  },
  credentials: true,
}));

// ─── Body Parsers ─────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Request Logger (Development) ─────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ─── Health Check ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('eLearning API is running');
});

app.get('/api/health', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    if (error) {
      console.error('[Health Check] Database error:', error.message);
      return res.status(500).json({ status: 'error', message: 'Database connection failed', error: error.message });
    }
    res.json({ status: 'ok', message: 'Server and Database are healthy' });
  } catch (err) {
    console.error('[Health Check] Unexpected error:', err.message);
    res.status(500).json({ status: 'error', message: 'Health check failed', error: err.message });
  }
});

// ─── Import Routes ────────────────────────────────────────────────────
import authRoutes from './routes/authRoutes.js';
import courseRoutes from './routes/courseRoutes.js';
import liveClassRoutes from './routes/liveClassRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import lecturerRoutes from './routes/lecturerRoutes.js';
import unitRoutes from './routes/unitRoutes.js';
import announcementRoutes from './routes/announcementRoutes.js';

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/live-classes', liveClassRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/lecturer', lecturerRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/announcements', announcementRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────
app.use((req, res) => {
  console.warn(`[404] Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ─── Global Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Global Error]', err.stack || err.message || err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error',
  });
});

// ─── Start Server ─────────────────────────────────────────────────────
const startServer = async () => {
  try {
    // Test Supabase connection on startup
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    if (error) {
      console.error('❌ Supabase connection failed:', error.message);
    } else {
      console.log('✅ Supabase connected successfully');
    }
  } catch (err) {
    console.error('❌ Supabase connection test error:', err.message);
  }

  app.listen(port, () => {
    console.log(`🚀 Server is running on port ${port}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

startServer();

export default app;
