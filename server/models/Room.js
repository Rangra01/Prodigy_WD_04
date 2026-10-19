const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Room name is required'],
      trim: true,
      minlength: [2, 'Room name must be at least 2 characters'],
      maxlength: [40, 'Room name must be at most 40 characters'],
    },
    // Normalized copy of `name` used for duplicate prevention
    // ("General Room" === "general room" === "  general   room ").
    nameKey: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // the seeded "General" room has no creator
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true }
);

roomSchema.pre('validate', function normalizeName(next) {
  if (this.name) {
    this.nameKey = this.name.trim().toLowerCase().replace(/\s+/g, ' ');
  }
  next();
});

roomSchema.methods.isMember = function isMember(userId) {
  const id = String(userId);
  return this.members.some((member) => String(member) === id);
};

module.exports = mongoose.model('Room', roomSchema);
