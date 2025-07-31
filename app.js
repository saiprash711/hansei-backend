// ============================================================================
// HANSEI BACKEND - PRODUCTION READY
// ============================================================================
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// SECURE CORS CONFIGURATION (FIXED)
// ============================================================================
// Define the list of allowed origins (domains)
const allowedOrigins = [
  'http://localhost', // Allows localhost on any port
  'http://127.0.0.1', // Allows 127.0.0.1 on any port
  'null', // Important for local file testing (file:///)
  'https://chennai-frontend.vercel.app', // Your deployed frontend app
  'https://chennai-frontend-3m487rgbn-sais-projects-266c2092.vercel.app' // Add the preview URL
];

// Configure CORS options
const corsOptions = {
  origin: function (origin, callback) {
    // The origin is the URL of the frontend making the request.
    // We check if the start of the origin string is in our allowed list.
    // This handles cases like http://localhost:5500, http://127.0.0.1:8080, etc.
    const isAllowed = allowedOrigins.some(allowedOrigin => {
        // Allow if origin is null (like for file://) and 'null' is in the list
        if (allowedOrigin === 'null' && !origin) return true;
        // Allow if the request origin starts with one of our allowed origins
        return origin && origin.startsWith(allowedOrigin);
    });

    if (isAllowed || !origin) { // Also allow requests with no origin (like Postman)
      callback(null, true);
    } else {
      console.error(`CORS Error: Origin ${origin} not allowed.`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // This allows cookies and authorization headers to be sent
  optionsSuccessStatus: 200 // For legacy browser support
};

// Use the CORS middleware with your options. This MUST come before your routes.
app.use(cors(corsOptions));

// ============================================================================
// BASIC MIDDLEWARE
// ============================================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================================
// TEST ROUTES
// ============================================================================
app.get('/', (req, res) => {
    res.json({ 
        message: 'Hansei Backend is WORKING!',
        cors: 'ENABLED - Secure Configuration',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        cors: 'WORKING',
        timestamp: new Date().toISOString(),
        origin: req.get('Origin') || 'null'
    });
});

// ============================================================================
// LOAD YOUR EXISTING ROUTES (with error handling)
// ============================================================================
try {
    const authRoutes = require('./routes/auth');
    const salesRoutes = require('./routes/sales');
    const analyticsRoutes = require('./routes/analytics');
    const uploadRoutes = require('./routes/upload');
    const chatbotRoutes = require('./routes/chatbot');
    
    app.use('/api/auth', authRoutes);
    app.use('/api/sales', salesRoutes);
    app.use('/api/analytics', analyticsRoutes);
    app.use('/api/upload', uploadRoutes);
    app.use('/api/chatbot', chatbotRoutes);

    console.log('✅ Core routes (auth, sales, analytics, upload, chatbot) loaded');

} catch (error) {
    console.log('❌ CRITICAL ERROR: Could not load core routes. Server may not function correctly.', error);
}

// ============================================================================
// GLOBAL ERROR HANDLING
// ============================================================================
app.use((err, req, res, next) => {
    console.error('❌ Global Error Handler Caught:', err.stack);
    res.status(500).json({ error: 'An internal server error occurred.' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// ============================================================================
// START SERVER WITH GRACEFUL ERROR HANDLING
// ============================================================================
const server = app.listen(PORT, () => {
    console.log('🚀 ==========================================');
    console.log('🚀 HANSEI BACKEND STARTED SUCCESSFULLY!');
    console.log('🚀 ==========================================');
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🔥 CORS: SECURELY ENABLED`);
    console.log(`✅ Allowed Origins: ${allowedOrigins.join(', ')}`);
    console.log(`🧪 Test: http://localhost:${PORT}/api/health`);
    console.log('🚀 ==========================================');
    
    // Test database connection after server starts
    setTimeout(async () => {
        try {
            // Assuming database.js exports this function
            const { testDatabaseConnections } = require('./config/database');
            await testDatabaseConnections();
        } catch (error) {
            console.warn('⚠️ Database connection failed on startup check:', error.message);
            console.warn('ℹ️ Server will continue, but database features may not work.');
        }
    }, 1000);
});

// FIX: Add a specific error handler for EADDRINUSE
server.on('error', (error) => {
    if (error.syscall !== 'listen') {
        throw error;
    }

    const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;

    switch (error.code) {
        case 'EACCES':
            console.error(`❌ ${bind} requires elevated privileges.`);
            process.exit(1);
            break;
        case 'EADDRINUSE':
            console.error(`❌ ${bind} is already in use.`);
            console.error('Please stop the other process running on this port or change the PORT in your .env file.');
            process.exit(1);
            break;
        default:
            throw error;
    }
});

console.log('🔄 Starting Hansei Backend Server...');
