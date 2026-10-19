const mongoose = require('mongoose');

/**
 * Connect to MongoDB using MONGODB_URI from server/.env.
 * Fails loudly (and explains how to fix it) instead of silently continuing.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/realtime_chat';

  mongoose.set('strictQuery', true);

  mongoose.connection.on('error', (err) => {
    console.error('[db] MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] MongoDB disconnected.');
  });

  try {
    // Fail fast (5s) instead of Mongoose's default 30s retry window.
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log(
      `[db] MongoDB connected → ${mongoose.connection.host}/${mongoose.connection.name}`
    );
  } catch (err) {
    console.error('[db] Could not connect to MongoDB:', err.message);
    console.error('[db] Troubleshooting:');
    console.error('[db]   1. Make sure MongoDB Community Server is installed and running.');
    console.error('[db]       sudo systemctl start mongod');
    console.error('[db]   2. Or start it manually:');
    console.error('[db]       mongod --dbpath /path/to/data --bind_ip 127.0.0.1 --port 27017');
    console.error('[db]   3. Check MONGODB_URI in server/.env');
    throw err;
  }
}

module.exports = connectDB;
