const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan'); // FIX: Correctly import the morgan package
const rateLimit = require('express-rate-limit'); // Import rate-limiter
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- SECURITY ENHANCEMENTS ---

// 1. API Rate Limiting
// Limits each IP to 100 requests per 15 minutes to prevent brute-force attacks and scraping.
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per window
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
});

// 2. User-Agent Blocking Middleware
// Blocks requests from common scraping tools and bots.
const blockScrapers = (req, res, next) => {
    const userAgent = req.get('User-Agent');
    if (userAgent) {
        const blockedAgents = ['python-requests', 'scrapy', 'node-fetch', 'wget', 'curl', 'postman'];
        if (blockedAgents.some(agent => userAgent.toLowerCase().includes(agent))) {
            // Return a generic 404 to avoid revealing that we are blocking them
            return res.status(404).json({ error: 'Endpoint not found' });
        }
    }
    next();
};

// --- MIDDLEWARE ---

// Apply security middleware
app.use(helmet()); // Sets crucial security headers
app.use(cors()); // FIX: Allow requests from any origin for development purposes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined')); // This line will now work correctly

// Apply anti-scraping middleware to all API routes
app.use('/api/', apiLimiter);
app.use('/api/', blockScrapers);


// Import routes
const authRoutes = require('./routes/auth');
const salesRoutes = require('./routes/sales');
const analyticsRoutes = require('./routes/analytics');
const uploadRoutes = require('./routes/upload');
const chatbotRoutes = require('./routes/chatbot');

// Database connection
const db = require('./config/database');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/chatbot', chatbotRoutes);

// Health check endpoint (exempt from rate limiting if needed, but fine for now)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.1' // Version bump
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      status: err.status || 500
    }
  });
});

// 404 handler for any routes not matched
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      status: 404
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Hansei Backend Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🔒 Anti-scraping measures are active.');
});

module.exports = app;
