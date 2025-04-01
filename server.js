// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const session = require('express-session');
const helmet = require('helmet');
const { Pool } = require('pg');
const { parse } = require('pg-connection-string'); // Used to parse DATABASE_URL

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
app.use(express.json());
// Serve static files from /public
app.use(express.static(__dirname + '/public'));
app.use("/favicon.ico", express.static("public/favicon.ico"));

// Configure express-session using environment variable for secret
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Define isAuthenticated middleware to protect routes.
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  } else {
    res.status(401).json({ success: false, message: "Not authenticated" });
  }
}

// Parse the DATABASE_URL from Supabase into individual connection parameters
const config = parse(process.env.DATABASE_URL);
// Convert port to a number if needed
config.port = parseInt(config.port, 10);

// Set up PostgreSQL connection pool using the parsed parameters and force IPv4.
const pool = new Pool({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  ssl: { rejectUnauthorized: false },
  family: 4  // Force IPv4
});

// Test the database connection
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('Database Connection Failed!', err);
  } else {
    console.log('Connected to PostgreSQL:', result.rows[0]);
  }
});

//
// API Endpoints
//

// --- Login Endpoint ---
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Allow default guest login.
  if (username === "guest" && password === "guest") {
    req.session.user = { id: "guest", name: "Guest", permissionVal: 0 };
    return res.json({ success: true, user: req.session.user });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM admaccounts WHERE name = $1 AND pass = $2 LIMIT 1',
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const account = result.rows[0];
    req.session.user = { id: account.id, name: account.name, permissionVal: account.permissionval };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Create a New Game Session ---
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

// --- Update an Existing Game Session ---
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
      console.error("Error parsing session data:", err);
    }
    res.json({ success: true, session: updatedSession });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Get an Existing Game Session (API) ---
app.get('/api/game_sessions/:sessionId', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM game_sessions WHERE sessionid = $1',
      [req.params.sessionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    let session = result.rows[0];
    try {
      session.data = typeof session.data === 'string'
        ? JSON.parse(session.data)
        : session.data;
    } catch (err) {
      console.error("Error parsing session data:", err);
    }
    res.json({ success: true, session });
  } catch (err) {
    console.error("Error fetching session:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

//
// HTML Serving Routes (defined after API endpoints)
//

// Redirect root to /login
app.get('/', (_, res) => {
  res.redirect('/login');
});

// Serve the login page at /login
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

// Serve the canvas page at /game_sessions/:sessionId (protected)
app.get('/game_sessions/:sessionId', isAuthenticated, (req, res) => {
  res.sendFile(__dirname + '/public/canvas.html');
});

//
// Socket.IO for Real-Time Collaboration
//
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('canvas-update', (data) => {
    socket.broadcast.emit('canvas-update', data);
  });
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

//
// Start the Server
//
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
