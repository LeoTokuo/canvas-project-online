// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const session = require('express-session');
const helmet = require('helmet');
const sql = require('mssql');

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
// Serve static files from /public (ensure no folder named "game_sessions" exists here)
app.use(express.static(__dirname + '/public'));
app.use("/favicon.ico", express.static("public/favicon.ico"));

// Configure express-session for login persistence using env variable for secret
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

// Set up Microsoft SQL Server connection configuration using environment variables
const dbConfig = {
  user: process.env.DB_USER ,
  password: process.env.DB_PASSWORD ,
  server: process.env.DB_SERVER ,
  database: process.env.DB_NAME ,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Create a connection pool (as a promise)
const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then(pool => {
    console.log('Connected to MSSQL');
    return pool;
  })
  .catch(err => console.error('Database Connection Failed!', err));

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
    const pool = await poolPromise;
    const result = await pool.request()
      .input('name', sql.VarChar, username)
      .input('pass', sql.VarChar, password)
      .query('SELECT TOP 1 * FROM admAccounts WHERE name = @name AND pass = @pass');
    
    if (result.recordset.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const account = result.recordset[0];
    req.session.user = { id: account.id, name: account.name, permissionVal: account.permissionVal };
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
    const pool = await poolPromise;
    const result = await pool.request()
      .input('sessionDate', sql.DateTime, sessionDate)
      .input('data', sql.NVarChar(sql.MAX), JSON.stringify(data))
      .query('INSERT INTO game_sessions (sessionDate, data) OUTPUT INSERTED.sessionId VALUES (@sessionDate, @data)');
    
    const sessionId = result.recordset[0].sessionId;
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
    const pool = await poolPromise;
    const result = await pool.request()
      .input('data', sql.NVarChar(sql.MAX), JSON.stringify(data))
      .input('sessionDate', sql.DateTime, sessionDate)
      .input('sessionId', sql.Int, req.params.sessionId)
      .query('UPDATE game_sessions SET data = @data, sessionDate = @sessionDate WHERE sessionId = @sessionId');
    
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    const updated = await pool.request()
      .input('sessionId', sql.Int, req.params.sessionId)
      .query('SELECT * FROM game_sessions WHERE sessionId = @sessionId');
    let updatedSession = updated.recordset[0];
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
// New API endpoint for loading session data in JSON format.
app.get('/api/game_sessions/:sessionId', isAuthenticated, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('sessionId', sql.Int, req.params.sessionId)
      .query('SELECT * FROM game_sessions WHERE sessionId = @sessionId');
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    let session = result.recordset[0];
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
const PORT = process.env.PORT;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
