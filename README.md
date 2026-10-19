# Real-Time Chat Application

A complete, beginner-friendly real-time messaging web application. Users can register, log in, join group chat rooms, send private messages, and see who is online — all delivered instantly over Socket.IO with messages persisted in MongoDB.

## Features

- **Secure authentication** — register, log in, log out with bcrypt-hashed passwords and JWT sessions.
- **Chat rooms** — view all rooms, create new rooms, join rooms (a default `General` room is created automatically).
- **Real-time group messaging** — messages are saved to MongoDB first, then broadcast instantly to room members; history (latest 50) reloads when you reopen a room.
- **Private messaging** — one-to-one conversations between any two registered users, authorized server-side.
- **Presence** — online/offline indicators per user, correct even when a user has multiple tabs open.
- **Session restore** — refresh the page and your token, socket connection, and selected conversation are restored.
- **Responsive UI** — sidebar + conversation layout that adapts to laptop, tablet, and mobile screens.
- **Safe rendering** — all user-generated content is inserted with `textContent` (no HTML/JS injection).

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (no frameworks) |
| Backend | Node.js, Express.js (CommonJS) |
| Real time | Socket.IO (JWT-authenticated handshakes) |
| Database | MongoDB + Mongoose |
| Auth | JSON Web Tokens, bcryptjs |
| Config | dotenv |
| Dev tools | nodemon |

## Project Structure

```
Chat App/
├── server/
│   ├── server.js            # Express + HTTP + Socket.IO bootstrap, graceful shutdown
│   ├── package.json
│   ├── .env.example         # copy to .env and edit
│   ├── config/
│   │   └── db.js            # Mongoose connection with clear error messages
│   ├── models/
│   │   ├── User.js          # username, email, hashed password
│   │   ├── Room.js          # name + normalized nameKey, members
│   │   └── Message.js       # one schema for group + private messages
│   ├── routes/
│   │   ├── auth.js          # register / login / me
│   │   ├── rooms.js         # list / create / join / history
│   │   ├── messages.js      # private conversation history
│   │   └── users.js         # user list with online status
│   ├── middleware/
│   │   └── auth.js          # JWT protection middleware
│   └── socket/
│       ├── chat.js          # all Socket.IO events + authorization
│       └── presence.js      # online user tracking (userId → sockets)
├── client/
│   ├── index.html           # landing page
│   ├── login.html
│   ├── register.html
│   ├── chat.html            # chat dashboard
│   ├── css/style.css
│   └── js/
│       ├── auth.js          # shared API helper + login/register logic
│       └── chat.js          # dashboard logic + Socket.IO client
├── .gitignore
└── README.md
```

## Prerequisites

- **Node.js** 18+ and npm (tested on Node 24).
- **MongoDB Community Server** running locally on `127.0.0.1:27017`.
- A modern browser (Chrome/Firefox/Edge).

## Starting MongoDB (Linux)

With systemd:

```bash
sudo systemctl start mongod      # start
sudo systemctl status mongod     # check status
```

Manual start:

```bash
mongod --dbpath /path/to/data --bind_ip 127.0.0.1 --port 27017
```

Quick check:

```bash
mongosh --quiet --eval "db.runCommand({ ping: 1 })"   # or: echo > /dev/tcp/127.0.0.1/27017
```

If MongoDB is not installed, install the official **MongoDB Community Server** package for your distribution first. This project intentionally does **not** fall back to an in-memory database.

## Installation

```bash
cd "/home/rangra/Documents/Prodogy/FULL STACK/Chat App/server"
npm install
```

## Environment Configuration

```bash
cd "/home/rangra/Documents/Prodogy/FULL STACK/Chat App/server"
cp .env.example .env
# edit .env and set a long random JWT_SECRET, e.g.:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`.env.example`:

```
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/realtime_chat
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=1d
```

`.env` is git-ignored — never commit real secrets.

## Running the Application

Development (auto-restart on changes):

```bash
cd "/home/rangra/Documents/Prodogy/FULL STACK/Chat App/server"
npm run dev
```

Production-style:

```bash
cd "/home/rangra/Documents/Prodogy/FULL STACK/Chat App/server"
npm start
```

Expected startup output:

```
[db] MongoDB connected → 127.0.0.1/realtime_chat
[server] Real-time chat running at http://localhost:5000
```

**Local URL: http://localhost:5000** (Express serves both the API and the client, so there is only one origin.)

## How to Test Real-Time Messaging (two sessions)

1. Start MongoDB and the server (commands above).
2. Open **http://localhost:5000** in your normal browser → *Create account* → register user **alice**.
3. Log out, or open a **private/incognito window** (a separate session) → register user **bob**.
4. In both sessions open the **General** room (or create a new room and join it).
5. Type a message in one window and press **Enter** — it appears in the other window instantly, with no refresh.
6. In alice's window click **bob** in the Users list → private conversation opens → exchange messages; history persists after refresh.
7. Watch the sidebar: green dot = online, grey = offline. Close bob's tab and alice sees bob go offline.
8. Refresh a page: the token, socket connection, and selected conversation are restored automatically.

Tip: two different browsers (e.g. Chrome + Firefox) work just as well as an incognito window.

## REST API Summary

All responses are JSON: `{ "success": true|false, ... }` or `{ "success": false, "message": "..." }`.
Protected routes require `Authorization: Bearer <token>`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account (`username, email, password, confirmPassword`); 400/409 on validation/duplicates |
| POST | `/api/auth/login` | – | Returns `{ token, user }`; 401 on bad credentials |
| GET | `/api/auth/me` | ✔ | Current user from the token |
| GET | `/api/rooms` | ✔ | All rooms with `memberCount` and `isMember` |
| POST | `/api/rooms` | ✔ | Create a room (`name`, 2–40 chars); 409 on duplicate (case/space-insensitive) |
| POST | `/api/rooms/:id/join` | ✔ | Join a room (idempotent); 400/404 on bad id |
| GET | `/api/rooms/:id/messages` | ✔ | Latest **50** room messages (members only, otherwise 403) |
| GET | `/api/users` | ✔ | All users except you, each with `isOnline` |
| GET | `/api/messages/private/:userId` | ✔ | Latest **50** private messages with a user |

## Socket.IO Event Summary

Connect with the JWT in the handshake: `io({ auth: { token } })`. Unauthenticated sockets are rejected.

| Event (client → server) | Payload | Notes |
|---|---|---|
| `joinRoom` | `{ roomId }` | Room must exist; membership persisted server-side |
| `sendMessage` | `{ roomId, content }` | Requires membership (DB check); 1–2000 chars; saved then broadcast |
| `joinPrivateConversation` | `{ recipientId }` | Recipient must exist; conversation id derived server-side |
| `sendPrivateMessage` | `{ recipientId, content }` | Both participants verified; saved then delivered only to them |

| Event (server → client) | Payload | Notes |
|---|---|---|
| `receiveMessage` | message | Group message, only to sockets in that room |
| `receivePrivateMessage` | message | Only to the two participants |
| `userStatus` | `{ userId, username?, status: 'online'\|'offline' }` | Presence broadcasts + initial online list |
| `chatError` | `{ message }` | Validation/authorization failures (also returned via the emit ack) |

Every client emit uses an ack callback: `{ ok: true }` or `{ ok: false, message }`.

## Security Measures

- Passwords hashed with **bcryptjs** (10 salt rounds); password fields use `select: false` and are stripped from JSON — hashes never leave the server.
- **JWT** signed with `JWT_SECRET` from the environment (`JWT_EXPIRES_IN`, default `1d`), verified on every REST route and every Socket.IO handshake.
- Sender identity, timestamps, room membership, and private-conversation participants are **always derived/verified on the server** — client-supplied ids for those are never trusted.
- Internal Socket.IO rooms (`room:<id>`, `conv:<id>`, `user:<id>`) can only be joined server-side after validation, so clients cannot eavesdrop by joining arbitrary rooms.
- Input validation on ids, lengths, and message content (max 2000 chars, non-empty, text only).
- Password hashes, tokens, and `.env` never committed (`.gitignore`); duplicate usernames/emails enforced at app **and** database level.
- User-generated content rendered exclusively with `textContent` — no `innerHTML` with message data.
- Consistent JSON errors and appropriate status codes (400/401/403/404/409/500).

## Known Limitations (intentional for a college MVP)

- The JWT is stored in **localStorage** — convenient for a local MVP, but vulnerable to XSS; in production use httpOnly cookies.
- No message edit/delete, read receipts, typing indicators, file uploads, or admin roles.
- Rooms are open: any authenticated user can join any room (there are no private/invite-only rooms).
- Presence is in-memory — restarting the server resets online status (messages remain in MongoDB).
- No rate limiting, CSRF tokens, or HTTPS (fine for localhost only).
- History shows the latest 50 messages per conversation (no infinite scroll pagination).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `[db] Could not connect to MongoDB` | Start MongoDB (see above) — the server exits with instructions. |
| `[env] Missing required environment variable: JWT_SECRET` | `cd server && cp .env.example .env` and set a secret. |
| `Port 5000 is already in use` | Stop the other process or change `PORT` in `server/.env`. |
| Redirected to login after refresh | Token expired — log in again (`JWT_EXPIRES_IN` controls lifetime). |
| Messages not arriving in real time | Check the connection indicator in the sidebar footer; the client auto-reconnects. |

