const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Room = require('../models/Room');
const Message = require('../models/Message');
const presence = require('./presence');

const MAX_MESSAGE_LENGTH = 2000;

// Internal Socket.IO room names. Clients can never join these directly —
// they are only joined by the server after validation.
const roomKey = (roomId) => `room:${roomId}`;
const convKey = (conversationId) => `conv:${conversationId}`;
const userKey = (userId) => `user:${userId}`;

// Convert a Mongoose message (sender populated) to the wire format.
function messageDto(msg) {
  const sender =
    msg.sender && typeof msg.sender === 'object' && msg.sender.username
      ? { _id: msg.sender._id, username: msg.sender.username }
      : { _id: msg.sender, username: 'Unknown' };

  return {
    _id: msg._id,
    type: msg.type,
    content: msg.content,
    roomId: msg.roomId ? String(msg.roomId) : null,
    recipient: msg.recipient ? String(msg.recipient) : null,
    conversationId: msg.conversationId || null,
    sender,
    createdAt: msg.createdAt,
  };
}

function validateContent(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: 'Message cannot be empty.' };
  }
  const content = raw.trim();
  if (content.length > MAX_MESSAGE_LENGTH) {
    return { error: `Message must be at most ${MAX_MESSAGE_LENGTH} characters.` };
  }
  return { content };
}

function registerSocketHandlers(io) {
  // -----------------------------------------------------------------------
  // 1) Authenticate every socket from the JWT in the handshake auth payload.
  //    Unauthenticated sockets never reach the "connection" handler.
  // -----------------------------------------------------------------------
  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const token = auth.token;
    if (!token) {
      return next(new Error('Authentication required: no token provided.'));
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!payload || !payload.id) {
        return next(new Error('Invalid authentication token.'));
      }
      socket.userId = String(payload.id);
      return next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new Error('Token expired. Please log in again.'));
      }
      return next(new Error('Invalid authentication token.'));
    }
  });

  io.on('connection', async (socket) => {
    // 2) Identity always comes from the authenticated token — never the client.
    let user = null;
    try {
      user = await User.findById(socket.userId);
    } catch (err) {
      console.error('[socket] Failed to load user:', err.message);
    }
    if (!user) return socket.disconnect(true);

    const userId = String(user._id);
    socket.data.userId = userId;
    socket.data.username = user.username;

    // 3) Presence: Map<userId, Set<socketId>> so multiple tabs are handled.
    presence.add(userId, socket.id);
    socket.join(userKey(userId)); // internal room, joined server-side only

    // Tell this socket who is online right now.
    for (const id of presence.onlineIds()) {
      if (id !== userId) {
        socket.emit('userStatus', { userId: id, status: 'online' });
      }
    }
    // Tell everyone about the new connection.
    io.emit('userStatus', { userId, username: user.username, status: 'online' });

    // Emit a chat error both as an event and through the ack callback.
    const fail = (ack, message) => {
      socket.emit('chatError', { message });
      if (typeof ack === 'function') ack({ ok: false, message });
    };
    const succeed = (ack, extra) => {
      if (typeof ack === 'function') ack(Object.assign({ ok: true }, extra || {}));
    };

    // -------------------------------------------------------------------
    // joinRoom — verify the room exists, persist membership, join the
    // internal `room:<id>` Socket.IO room.
    // -------------------------------------------------------------------
    socket.on('joinRoom', async (payload, ack) => {
      try {
        const roomId = payload && payload.roomId;
        if (!mongoose.isValidObjectId(roomId)) return fail(ack, 'Invalid room.');

        const room = await Room.findById(roomId);
        if (!room) return fail(ack, 'Room not found.');

        if (!room.isMember(user._id)) {
          room.members.push(user._id);
          await room.save(); // joining a public room is allowed and recorded
        }
        socket.join(roomKey(room._id));
        return succeed(ack, { roomId: String(room._id), name: room.name });
      } catch (err) {
        console.error('[socket] joinRoom error:', err.message);
        return fail(ack, 'Could not join the room.');
      }
    });

    // -------------------------------------------------------------------
    // sendMessage — requires an existing room + membership (checked in the
    // database, not trusted from the client). Saved before broadcasting.
    // -------------------------------------------------------------------
    socket.on('sendMessage', async (payload, ack) => {
      try {
        const check = validateContent(payload && payload.content);
        if (check.error) return fail(ack, check.error);

        const roomId = payload && payload.roomId;
        if (!mongoose.isValidObjectId(roomId)) return fail(ack, 'Invalid room.');

        const room = await Room.findById(roomId);
        if (!room) return fail(ack, 'Room not found.');
        if (!room.isMember(user._id)) {
          return fail(ack, 'You are not a member of this room.');
        }

        const key = roomKey(room._id);
        if (!socket.rooms.has(key)) socket.join(key); // re-sync after reconnect

        const message = await Message.create({
          sender: user._id,
          roomId: room._id,
          content: check.content,
          type: 'text',
        });
        await message.populate('sender', 'username');

        // Broadcast only to sockets inside this room (its members).
        io.to(key).emit('receiveMessage', messageDto(message));
        return succeed(ack);
      } catch (err) {
        console.error('[socket] sendMessage error:', err.message);
        return fail(ack, 'Could not send the message.');
      }
    });

    // -------------------------------------------------------------------
    // joinPrivateConversation — the conversation id is derived from the
    // authenticated sender + a recipient that must exist in the database.
    // -------------------------------------------------------------------
    socket.on('joinPrivateConversation', async (payload, ack) => {
      try {
        const recipientId = payload && payload.recipientId;
        if (!mongoose.isValidObjectId(recipientId)) return fail(ack, 'Invalid user.');
        if (String(recipientId) === userId) return fail(ack, 'You cannot chat with yourself.');

        const other = await User.findById(recipientId);
        if (!other) return fail(ack, 'User not found.');

        const conversationId = Message.buildConversationId(user._id, other._id);
        socket.join(convKey(conversationId));
        return succeed(ack, { conversationId });
      } catch (err) {
        console.error('[socket] joinPrivateConversation error:', err.message);
        return fail(ack, 'Could not open the conversation.');
      }
    });

    // -------------------------------------------------------------------
    // sendPrivateMessage — both participants are verified on the server;
    // delivery goes only to the internal `conv:<id>` room.
    // -------------------------------------------------------------------
    socket.on('sendPrivateMessage', async (payload, ack) => {
      try {
        const check = validateContent(payload && payload.content);
        if (check.error) return fail(ack, check.error);

        const recipientId = payload && payload.recipientId;
        if (!mongoose.isValidObjectId(recipientId)) return fail(ack, 'Invalid user.');
        if (String(recipientId) === userId) return fail(ack, 'You cannot message yourself.');

        const other = await User.findById(recipientId);
        if (!other) return fail(ack, 'User not found.');

        const conversationId = Message.buildConversationId(user._id, other._id);
        const key = convKey(conversationId);
        if (!socket.rooms.has(key)) socket.join(key);

        const message = await Message.create({
          sender: user._id,
          recipient: other._id,
          conversationId,
          content: check.content,
          type: 'text',
        });
        await message.populate('sender', 'username');

        io.to(key).emit('receivePrivateMessage', messageDto(message));
        return succeed(ack);
      } catch (err) {
        console.error('[socket] sendPrivateMessage error:', err.message);
        return fail(ack, 'Could not send the message.');
      }
    });

    // 4) Clean up presence when this socket closes. The user only becomes
    //    "offline" when their LAST socket disconnects.
    socket.on('disconnect', () => {
      const wentOffline = presence.remove(userId, socket.id);
      if (wentOffline) {
        io.emit('userStatus', { userId, username: user.username, status: 'offline' });
      }
    });

    socket.on('error', (err) => {
      console.error('[socket] Socket error:', err.message);
    });
  });
}

module.exports = registerSocketHandlers;

