// Vercel detects this entry point as the Express backend. The same server
// module continues to listen locally when started by the Windows desktop app.
module.exports = require('./server/server').app;
