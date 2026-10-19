const mongoose = require('mongoose');

/**
 * One schema for both group and private messages:
 *   - group:   roomId set, recipient/conversationId null
 *   - private: recipient + conversationId set, roomId null
 */
const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: { values: ['text'], message: 'Only text messages are supported' },
      default: 'text',
    },
    content: {
      type: String,
      required: [true, 'Message content is required'],
      trim: true,
      minlength: [1, 'Message cannot be empty'],
      maxlength: [2000, 'Message must be at most 2000 characters'],
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      default: null,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    conversationId: {
      type: String,
      default: null,
    },
  },
  // Messages only need a creation timestamp.
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.pre('validate', function validateMessageShape(next) {
  const isGroup = !!this.roomId;
  const isPrivate = !!this.recipient;

  if (isGroup && isPrivate) {
    return next(new Error('A message cannot be both a room message and a private message.'));
  }
  if (!isGroup && !isPrivate) {
    return next(new Error('A message must have either a roomId or a recipient.'));
  }
  if (isPrivate) {
    if (!this.conversationId) {
      return next(new Error('Private messages require a conversationId.'));
    }
    if (String(this.recipient) === String(this.sender)) {
      return next(new Error('You cannot send a private message to yourself.'));
    }
  } else {
    this.conversationId = null;
    this.recipient = null;
  }
  return next();
});

// Deterministic id for a private conversation, independent of who writes first.
messageSchema.statics.buildConversationId = function buildConversationId(userA, userB) {
  return [String(userA), String(userB)].sort().join('_');
};

// Fast, paginated history queries (latest N messages).
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
