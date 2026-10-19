const router = require('express').Router();
const User = require('../models/User');
const presence = require('../socket/presence');

// GET /api/users — all registered users except the caller, with online status
router.get('/', async (req, res, next) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .sort({ username: 1 })
      .select('username createdAt');

    res.json({
      success: true,
      users: users.map((u) => ({
        _id: u._id,
        username: u.username,
        isOnline: presence.isOnline(u._id),
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
