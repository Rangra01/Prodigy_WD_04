const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const MIN_PASSWORD_LENGTH = 8;

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
}

// Public shape of a user — never includes the password hash.
function userDto(user) {
  return {
    _id: user._id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    const errors = [];
    if (!username) {
      errors.push('Username is required.');
    } else if (!USERNAME_RE.test(username)) {
      errors.push('Username may only contain letters, numbers and underscores.');
    } else if (username.length < 3 || username.length > 20) {
      errors.push('Username must be 3–20 characters.');
    }

    if (!email) {
      errors.push('Email is required.');
    } else if (!EMAIL_RE.test(email)) {
      errors.push('Please provide a valid email address.');
    }

    if (!password) {
      errors.push('Password is required.');
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    if (!confirmPassword) {
      errors.push('Please confirm your password.');
    } else if (password !== confirmPassword) {
      errors.push('Passwords do not match.');
    }

    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(' ') });
    }

    // Duplicate check (usernames are case-insensitive).
    const duplicate = await User.findOne({
      $or: [
        { email },
        { username: { $regex: `^${escapeRegex(username)}$`, $options: 'i' } },
      ],
    });
    if (duplicate) {
      const field = duplicate.email === email ? 'email' : 'username';
      return res.status(409).json({ success: false, message: `That ${field} is already taken.` });
    }

    const user = await User.create({ username, email, password });
    const token = signToken(user._id);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: userDto(user),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'That username or email is already taken.',
      });
    }
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map((e) => e.message).join(' ');
      return res.status(400).json({ success: false, message });
    }
    return next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email }).select('+password');
    const valid = user ? await user.comparePassword(password) : false;
    if (!valid) {
      // Same message for "unknown email" and "wrong password" on purpose.
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = signToken(user._id);
    return res.json({ success: true, message: 'Logged in.', token, user: userDto(user) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.json({ success: true, user: userDto(req.user) });
});

module.exports = router;
