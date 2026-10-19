const router = require('express').Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');

const HISTORY_LIMIT = 50;

// GET /api/messages/private/:userId — latest 50 private messages with a user
router.get('/private/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id.' });
    }
    if (String(userId) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You cannot chat with yourself.' });
    }

    const other = await User.findById(userId).select('username');
    if (!other) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // conversationId is derived server-side from both participant ids.
    const conversationId = Message.buildConversationId(req.user._id, other._id);

    const messages = await Message.find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .populate('sender', 'username');
    messages.reverse(); // oldest → newest for rendering

    return res.json({
      success: true,
      conversationId,
      partner: { _id: other._id, username: other.username },
      messages,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
