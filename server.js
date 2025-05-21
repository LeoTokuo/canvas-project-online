// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const session = require('express-session');
const helmet = require('helmet');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Setup Helmet CSP
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "http://localhost:" + process.env.PORT, "data:"]
    }
  })
);

// Middleware for JSON parsing
app.use(express.json({ limit: '1024mb' }));
// Serve static files from /public
app.use(express.static(__dirname + '/public'));
app.use("/favicon.ico", express.static("public/favicon.ico"));

// Configure express-session using environment variable for secret
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// PostgreSQL connection pool
const caCert = fs.readFileSync(__dirname + '/certificates/prod-ca-2021.crt').toString();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: caCert }
});

// Test the database connection
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('Database Connection Failed!', err);
  } else {
    console.log('Connected to PostgreSQL:', result.rows[0]);
  }
});

// --- Authentication Middleware ---
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ success: false, message: 'Not authenticated' });
}

function requireAdmin(req, res, next) {
  // Assuming permissionVal === 1 indicates admin
  if (req.session.user && req.session.user.permissionVal === 1) {
    return next();
  }
  res.status(403).json({ success: false, message: 'Admins only' });
}

// --- Login Endpoint ---
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM admaccounts WHERE name = $1 AND pass = $2 LIMIT 1',
      [username, password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const account = result.rows[0];
    req.session.user = {
      id: account.id,
      name: account.name,
      permissionVal: account.permissionval
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Game Session Endpoints ---
app.post('/game_sessions', isAuthenticated, async (req, res) => {
  const { data } = req.body;
  const sessionDate = new Date();
  try {
    const result = await pool.query(
      'INSERT INTO game_sessions (sessiondate, data) VALUES ($1, $2) RETURNING sessionid',
      [sessionDate, JSON.stringify(data)]
    );
    const sessionId = result.rows[0].sessionid;
    res.json({ success: true, sessionId, sessionDate, data });
  } catch (err) {
    console.error('Error creating game session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/game_sessions/:sessionId', isAuthenticated, async (req, res) => {
  const { data } = req.body;
  const sessionDate = new Date();
  try {
    const result = await pool.query(
      'UPDATE game_sessions SET data = $1, sessiondate = $2 WHERE sessionid = $3',
      [JSON.stringify(data), sessionDate, req.params.sessionId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    const updated = await pool.query(
      'SELECT * FROM game_sessions WHERE sessionid = $1',
      [req.params.sessionId]
    );
    let updatedSession = updated.rows[0];
    try {
      updatedSession.data = typeof updatedSession.data === 'string'
        ? JSON.parse(updatedSession.data)
        : updatedSession.data;
    } catch (err) {
      console.error('Error parsing session data:', err);
    }
    res.json({ success: true, session: updatedSession });
  } catch (err) {
    console.error('Update session error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/game_sessions/:sessionId', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM game_sessions WHERE sessionid = $1',
      [req.params.sessionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    let sessionData = result.rows[0];
    try {
      sessionData.data = typeof sessionData.data === 'string'
        ? JSON.parse(sessionData.data)
        : sessionData.data;
    } catch (err) {
      console.error('Error parsing session data:', err);
    }
    res.json({ success: true, session: sessionData });
  } catch (err) {
    console.error('Error fetching session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Page Management Endpoints ---
// Switch active page (admin only)
app.post('/session/:sessionId/page/switch', isAuthenticated, requireAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const { newPage, currentJson } = req.body;
  try {
    // Upsert current page state
    await pool.query(
      `INSERT INTO canvas_pages(session_id, page_number, canvas_json, updated_at)
       VALUES($1, $2, $3, NOW())
       ON CONFLICT (session_id, page_number)
       DO UPDATE SET canvas_json = EXCLUDED.canvas_json, updated_at = NOW()`,
      [sessionId, req.session.user.active_page || 1, JSON.stringify(currentJson)]
    );
    // Update sessions.active_page
    await pool.query(
      'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_page INT',
      []
    ); // ensure column exists
    await pool.query(
      'UPDATE sessions SET active_page = $1 WHERE sessionid = $2',
      [newPage, sessionId]
    );
    // Load next page JSON
    const { rows } = await pool.query(
      'SELECT canvas_json FROM canvas_pages WHERE session_id = $1 AND page_number = $2',
      [sessionId, newPage]
    );
    const canvasJson = rows.length ? rows[0].canvas_json : null;
    // Broadcast to all in room
    io.to(sessionId).emit('page_switch', { page: newPage, canvasJson });
    res.json({ success: true, page: newPage, canvasJson });
  } catch (err) {
    console.error('Page switch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get current active page and JSON
app.get('/session/:sessionId/page/current', isAuthenticated, async (req, res) => {
  const { sessionId } = req.params;
  try {
    // Ensure column exists
    await pool.query(
      'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_page INT DEFAULT 1',
      []
    );
    const { rows: sessRows } = await pool.query(
      'SELECT active_page FROM sessions WHERE sessionid = $1',
      [sessionId]
    );
    const activePage = sessRows.length ? sessRows[0].active_page : 1;
    const { rows } = await pool.query(
      'SELECT canvas_json FROM canvas_pages WHERE session_id = $1 AND page_number = $2',
      [sessionId, activePage]
    );
    const canvasJson = rows.length ? rows[0].canvas_json : null;
    res.json({ success: true, page: activePage, canvasJson });
  } catch (err) {
    console.error('Fetch current page error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Redirect root to /login
app.get('/', (_, res) => res.redirect('/login'));
// Login page
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});
// Canvas page
app.get('/game_sessions/:sessionId', isAuthenticated, (req, res) => {
  res.sendFile(__dirname + '/public/canvas.html');
});

// Socket.IO for Real-Time Collaboration
io.on('connection', (socket) => {
  console.log('A user connected');

  // Join room (session)
  socket.on('joinRoom', (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined room ${sessionId}`);
  });

  // Canvas object events
  ['object:added', 'object:modified', 'object:removed', 'canvas-update'].forEach(evt => {
    socket.on(evt, (data) => {
      const room = data.sessionId;
      if (room) socket.to(room).emit(evt, data);
      else socket.broadcast.emit(evt, data);
    });
  });

  // Page switch via socket (fallback)
  socket.on('page_switch', ({ sessionId, page, canvasJson }) => {
    io.to(sessionId).emit('page_switch', { page, canvasJson });
  });

  socket.on('disconnect', () => console.log('A user disconnected'));
});

// Start the Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
