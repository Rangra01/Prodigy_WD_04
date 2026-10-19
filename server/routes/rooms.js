const router = require('express').Router();
const mongoose = require('mongoose');
const Room = require('../models/Room');
const Message = require('../models/Message');

const HISTORY_LIMIT = 50;

function roomDto(room, userId) {
  return {
    _id: room._id,
    name: room.name,
    nameKey: room.nameKey,
    createdBy: room.createdBy,
    members: room.members,
    memberCount: room.members.length,
    isMember: room.members.some((m) => String(m._id || m) === String(userId)),
    createdAt: room.createdAt,
  };
}

function invalidId(res) {
  return res.status(400).json({ success: false, message: 'Invalid room id.' });
}

// GET /api/rooms — list every room
router.get('/', async (req, res, next) => {
  try {
    const rooms = await Room.find().sort({ createdAt: 1 });
    res.json({ success: true, rooms: rooms.map((r) => roomDto(r, req.user._id)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/rooms — create a room (creator becomes the first member)
router.post('/', async (req, res, next) => {
  try {
    const rawName = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (rawName.length < 2 || rawName.length > 40) {
      return res.status(400).json({ success: false, message: 'Room name must be 2–40 characters.' });
    }

    const nameKey = rawName.toLowerCase().replace(/\s+/g, ' ');
    const existing = await Room.findOne({ nameKey });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A room with that name already exists.' });
    }

    const room = await Room.create({
      name: rawName,
      nameKey,
      createdBy: req.user._id,
      members: [req.user._id],
    });

    return res.status(201).json({
      success: true,
      message: 'Room created.',
      room: roomDto(room, req.user._id),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A room with that name already exists.' });
    }
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map((e) => e.message).join(' ');
      return res.status(400).json({ success: false, message });
    }
    return next(err);
  }
});

// POST /api/rooms/:id/join — join a room (idempotent)
router.post('/:id/join', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return invalidId(res);

    const room = await Room.findById(id);
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });

    const alreadyMember = room.isMember(req.user._id);
    if (!alreadyMember) {
      room.members.push(req.user._id);
      await room.save();
    }

    return res.json({
      success: true,
      message: alreadyMember ? 'Already a member of this room.' : 'Joined room.',
      room: roomDto(room, req.user._id),
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/rooms/:id/messages — latest 50 messages (members only)
router.get('/:id/messages', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return invalidId(res);

    const room = await Room.findById(id);
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });

    if (!room.isMember(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You must join this room before reading its messages.',
      });
    }

    const messages = await Message.find({ roomId: room._id })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .populate('sender', 'username');
    messages.reverse(); // oldest → newest for rendering

    return res.json({ success: true, room: roomDto(room, req.user._id), messages });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
