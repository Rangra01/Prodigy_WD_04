const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protects REST routes: requires a valid `Authorization: Bearer <token>` header
 * and a user that still exists in the database.
 */
async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }

    const token = header.slice(7).trim();
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
      }
      return res.status(401).json({ success: false, message: 'Invalid authentication token.' });
    }

    if (!payload || !payload.id) {
      return res.status(401).json({ success: false, message: 'Invalid authentication token.' });
    }

    const user = await User.findById(payload.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Account no longer exists. Please log in again.' });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { protect };
