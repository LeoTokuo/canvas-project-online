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

console.log('Starting server setup...');

// Setup Helmet CSP
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", `http://localhost:${process.env.PORT}`, "data:"]
    }
  })
);

// Middleware for JSON parsing
app.use(express.json({ limit: '1024mb' }));
// Serve static files from /public
app.use(express.static(__dirname + '/public'));
app.use('/favicon.ico', express.static('public/favicon.ico'));

// Configure express-session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

console.log('Middleware configured.');

// PostgreSQL connection pool
const caCert = fs.readFileSync(__dirname + '/certificates/prod-ca-2021.crt').toString();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: caCert }
});

// Test DB connection
pool.query('SELECT NOW()', (err, result) => {
  if (err) console.error('DB Connection Failed!', err);
  else console.log('Connected to PostgreSQL at', result.rows[0]);
});

// --- Authentication Middlewares ---
function isAuthenticated(req, res, next) {
  console.log('isAuthenticated:', req.session.user);
  if (req.session && req.session.user) return next();
  console.warn('Not authenticated attempt:', req.path);
  return res.status(401).json({ success: false, message: 'Not authenticated' });
}
function requireAdmin(req, res, next) {
  console.log('requireAdmin check for user:', req.session.user);
  if (req.session.user && req.session.user.permissionVal === 1) return next();
  console.warn('Admin only access denied for user:', req.session.user);
  return res.status(403).json({ success: false, message: 'Admins only' });
}

// --- Login Endpoint ---
app.post('/login', async (req, res) => {
  console.log('POST /login payload:', req.body);
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM admaccounts WHERE name = $1 AND pass = $2 LIMIT 1',
      [username, password]
    );
    console.log('Login query result rows:', result.rows.length);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const account = result.rows[0];
    req.session.user = {
      id: account.id,
      name: account.name,
      permissionVal: account.permissionval
    };
    console.log('User logged in:', req.session.user);
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Game Session Endpoints ---
app.post('/game_sessions', isAuthenticated, async (req, res) => {
  console.log('POST /game_sessions by user:', req.session.user);
  const { data } = req.body;
  const sessionDate = new Date();
  try {
    console.log('Inserting new game_session');
    const result = await pool.query(
      'INSERT INTO game_sessions (sessiondate, data, active_page) VALUES ($1, $2, 1) RETURNING sessionid',
      [sessionDate, JSON.stringify(data)]
    );
    const sessionId = result.rows[0].sessionid;
    console.log('New session created with ID:', sessionId);
    await pool.query(
      'INSERT INTO canvas_pages (session_id, page_number, canvas_json) VALUES ($1, 1, $2)',
      [sessionId, JSON.stringify(data)]
    );
    console.log('Initial page 1 created for session:', sessionId);
    res.json({ success: true, sessionId, sessionDate, data });
  } catch (err) {
    console.error('Error creating game session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/game_sessions/:sessionId', isAuthenticated, async (req, res) => {
  console.log('PUT /game_sessions/:sessionId params:', req.params, 'body:', req.body);
  const { data } = req.body;
  const sessionDate = new Date();
  const { sessionId } = req.params;
  try {
    const update = await pool.query(
      'UPDATE game_sessions SET data = $1, sessiondate = $2 WHERE sessionid = $3',
      [JSON.stringify(data), sessionDate, sessionId]
    );
    console.log('Update result rowCount:', update.rowCount);
    if (update.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    const sel = await pool.query(
      'SELECT * FROM game_sessions WHERE sessionid = $1',
      [sessionId]
    );
    let sess = sel.rows[0];
    sess.data = typeof sess.data === 'string' ? JSON.parse(sess.data) : sess.data;
    res.json({ success: true, session: sess });
  } catch (err) {
    console.error('Update session error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/game_sessions/:sessionId', isAuthenticated, async (req, res) => {
  console.log('GET /api/game_sessions/:sessionId req.params:', req.params);
  const { sessionId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM game_sessions WHERE sessionid = $1',
      [sessionId]
    );
    console.log('Fetched sessions count:', result.rows.length);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    let sess = result.rows[0];
    sess.data = typeof sess.data === 'string' ? JSON.parse(sess.data) : sess.data;
    res.json({ success: true, session: sess });
  } catch (err) {
    console.error('Error fetching session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Page Management Endpoints ---
app.post('/session/:sessionId/page/switch', isAuthenticated, requireAdmin, async (req, res) => {
  console.log('POST /session/:sessionId/page/switch params:', req.params, 'body:', req.body);
  const { sessionId } = req.params;
  const { newPage, currentJson } = req.body;
  try {
    const selActive = await pool.query(
      'SELECT active_page FROM game_sessions WHERE sessionid = $1',
      [sessionId]
    );
    console.log('Current active_page:', selActive.rows[0]);
    const oldPage = selActive.rows[0].active_page;

    await pool.query(
      `INSERT INTO canvas_pages(session_id, page_number, canvas_json, updated_at)
       VALUES($1, $2, $3, NOW())
       ON CONFLICT(session_id, page_number)
       DO UPDATE SET canvas_json = EXCLUDED.canvas_json, updated_at = NOW()`,
      [sessionId, oldPage, JSON.stringify(currentJson)]
    );
    console.log(`Saved page ${oldPage} for session ${sessionId}`);

    await pool.query(
      'UPDATE game_sessions SET active_page = $1 WHERE sessionid = $2',
      [newPage, sessionId]
    );
    console.log(`Updated active_page to ${newPage}`);

    const selNext = await pool.query(
      'SELECT canvas_json FROM canvas_pages WHERE session_id = $1 AND page_number = $2',
      [sessionId, newPage]
    );
    console.log('Next page fetch rows:', selNext.rows.length);
    let nextJson;
    if (selNext.rows.length) {
      nextJson = selNext.rows[0].canvas_json;
    } else {
      nextJson = { objects: [], background: null };
      await pool.query(
        'INSERT INTO canvas_pages(session_id, page_number, canvas_json) VALUES($1, $2, $3)',
        [sessionId, newPage, JSON.stringify(nextJson)]
      );
      console.log(`Created blank page ${newPage}`);
    }

    io.to(sessionId).emit('page_switch', { page: newPage, canvasJson: nextJson });
    console.log(`Broadcasted page_switch for page ${newPage}`);
    res.json({ success: true, page: newPage, canvasJson: nextJson });
  } catch (err) {
    console.error('Page switch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/session/:sessionId/page/current', isAuthenticated, async (req, res) => {
  console.log('GET /session/:sessionId/page/current params:', req.params);
  const { sessionId } = req.params;
  try {
    const sel = await pool.query(
      'SELECT active_page FROM game_sessions WHERE sessionid = $1',
      [sessionId]
    );
    console.log('Fetched active_page:', sel.rows[0]);
    const active = sel.rows[0].active_page || 1;
    const selPage = await pool.query(
      'SELECT canvas_json FROM canvas_pages WHERE session_id = $1 AND page_number = $2',
      [sessionId, active]
    );
    console.log('Fetched canvas_pages rows:', selPage.rows.length);
    const canvasJson = selPage.rows.length ? selPage.rows[0].canvas_json : null;
    res.json({ success: true, page: active, canvasJson });
  } catch (err) {
    console.error('Fetch current page error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- HTML Serving Routes ---
app.get('/', (_, res) => { console.log('GET / --> redirect to /login'); return res.redirect('/login'); });
app.get('/login', (req, res) => { console.log('GET /login'); return res.sendFile(__dirname + '/public/login.html'); });
app.get('/game_sessions/:sessionId', isAuthenticated, (req, res) => { console.log('GET /game_sessions/:sessionId', req.params); return res.sendFile(__dirname + '/public/canvas.html'); });

// --- Socket.IO for Real-Time Collaboration ---
io.on('connection', (socket) => {
  console.log('Socket.IO connected:', socket.id);
  socket.on('joinRoom', (sessionId) => {
    console.log(`Socket ${socket.id} joining room ${sessionId}`);
    socket.join(sessionId);
  });
  ['object:added', 'object:modified', 'object:removed', 'canvas-update'].forEach((evt) => {
    socket.on(evt, (data) => {
      console.log(`Socket event ${evt}`, data);
      const room = data.sessionId;
      if (room) socket.to(room).emit(evt, data);
      else socket.broadcast.emit(evt, data);
    });
  });
  socket.on('page_switch', ({ sessionId, page, canvasJson }) => {
    console.log(`Fallback page_switch from socket ${socket.id}`, sessionId, page);
    io.to(sessionId).emit('page_switch', { page, canvasJson });
  });
  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// Start the Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
