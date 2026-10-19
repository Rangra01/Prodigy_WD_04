const path = require('path');

// Load server/.env relative to this file so it works from any working directory.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const { protect } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const userRoutes = require('./routes/users');
const registerSocketHandlers = require('./socket/chat');
const Room = require('./models/Room');

// ---------------------------------------------------------------------------
// Environment validation — fail fast with a helpful message.
// ---------------------------------------------------------------------------
const missingVars = [];
if (!process.env.JWT_SECRET) missingVars.push('JWT_SECRET');
if (missingVars.length > 0) {
  console.error(`[env] Missing required environment variable(s): ${missingVars.join(', ')}`);
  console.error('[env] Fix it with:');
  console.error('[env]   cd server && cp .env.example .env');
  console.error('[env]   then edit .env and set a long random JWT_SECRET');
  process.exit(1);
}
if (process.env.JWT_SECRET === 'replace_with_a_long_random_secret') {
  console.warn('[env] WARNING: JWT_SECRET is still the placeholder value from .env.example.');
  console.warn('[env] Replace it with a long random secret before sharing this app.');
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

// Serve the static client (HTML/CSS/JS) from the same origin.
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// REST API routes (rooms/messages/users require a valid JWT).
app.use('/api/auth', authRoutes);
app.use('/api/rooms', protect, roomRoutes);
app.use('/api/messages', protect, messageRoutes);
app.use('/api/users', protect, userRoutes);

// Unknown API routes → JSON 404 (never HTML).
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: `Cannot ${req.method} ${req.originalUrl}` });
});

// Anything else → send visitors back to the landing page.
app.use((req, res) => {
  if (req.method === 'GET') return res.redirect('/');
  return res.status(404).json({ success: false, message: 'Not found' });
});

// Central JSON error handler (also catches malformed JSON bodies).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body.' });
  }
  const status = (err && err.status) || (err && err.statusCode) || 500;
  if (status >= 500) console.error('[server] Unhandled error:', err);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : err.message,
  });
});

// ---------------------------------------------------------------------------
// HTTP + Socket.IO
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  // Same-origin app: no cross-origin Socket.IO clients needed.
  cors: { origin: false },
});
registerSocketHandlers(io);

// ---------------------------------------------------------------------------
// Startup / shutdown
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 5000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already in use.`);
    console.error('[server] Change PORT in server/.env (or stop the other process) and retry.');
  } else {
    console.error('[server] Server error:', err.message);
  }
  process.exit(1);
});

// Create the default "General" room on startup if it does not exist yet.
async function ensureDefaultRoom() {
  const nameKey = 'general';
  const existing = await Room.findOne({ nameKey });
  if (existing) return;
  await Room.create({ name: 'General', nameKey, createdBy: null, members: [] });
  console.log('[db] Created the default "General" room.');
}

async function start() {
  await connectDB();
  await ensureDefaultRoom();
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`[server] Real-time chat running at http://localhost:${PORT}`);
  console.log('[server] Open that URL in your browser. Press Ctrl+C to stop.');
}

start().catch((err) => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} received — shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('[server] Timed out waiting for shutdown; exiting now.');
    process.exit(1);
  }, 10000);

  try {
    await new Promise((resolve) => io.close(() => resolve()));
    await mongoose.disconnect();
    clearTimeout(forceExit);
    console.log('[server] Shutdown complete.');
    process.exit(0);
  } catch (err) {
    console.error('[server] Error during shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[server] Unhandled promise rejection:', err);
});
