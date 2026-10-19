/**
 * In-memory presence tracking.
 * Keyed by user ID (string) → Set of socket IDs, so a user with two open
 * tabs stays "online" until their last socket disconnects.
 */
const onlineUsers = new Map();

/**
 * Register a socket for a user.
 * @returns {boolean} true if this socket made the user newly online.
 */
function add(userId, socketId) {
  const id = String(userId);
  if (!onlineUsers.has(id)) onlineUsers.set(id, new Set());
  const sockets = onlineUsers.get(id);
  const wasOffline = sockets.size === 0;
  sockets.add(socketId);
  return wasOffline;
}

/**
 * Remove a socket for a user.
 * @returns {boolean} true if the user is now fully offline.
 */
function remove(userId, socketId) {
  const id = String(userId);
  const sockets = onlineUsers.get(id);
  if (!sockets) return true;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineUsers.delete(id);
    return true;
  }
  return false;
}

function isOnline(userId) {
  const sockets = onlineUsers.get(String(userId));
  return !!sockets && sockets.size > 0;
}

function onlineIds() {
  return [...onlineUsers.keys()];
}

function socketCount(userId) {
  const sockets = onlineUsers.get(String(userId));
  return sockets ? sockets.size : 0;
}

module.exports = { add, remove, isOnline, onlineIds, socketCount };
