const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// --- FIX: Trust Proxy for Render Deployment ---
app.set('trust proxy', 1);

// --- Helper function to validate imported routes ---
function validateRouter(routerModule, filePath) {
  if (typeof routerModule !== 'function' || !routerModule.stack) {
    throw new Error(`❌ FATAL: Failed to load router from '${filePath}'. Not a valid Express router.`);
  }
  return routerModule;
}

// --- MIDDLEWARE ---
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://hansei-frontend.vercel.app',
    /\.vercel\.app$/
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

// --- Rate Limiting and Security ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
});
app.use('/api/', apiLimiter);

// --- ROUTES ---
try {
  app.use('/api/auth', validateRouter(require('./routes/auth'), './routes/auth.js'));
  app.use('/api/sales', validateRouter(require('./routes/sales'), './routes/sales.js'));
  app.use('/api/analytics', validateRouter(require('./routes/analytics'), './routes/analytics.js'));
  app.use('/api/upload', validateRouter(require('./routes/upload'), './routes/upload.js'));
  app.use('/api/chatbot', validateRouter(require('./routes/chatbot'), './routes/chatbot.js'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// --- Health Check Endpoints ---
app.get('/', (req, res) => res.status(200).json({ message: 'Hansei Backend API is running!', status: 'healthy' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() }));

// --- Error Handling ---
app.use((err, req, res, next) => {
  console.error('Error Stack:', err.stack);
  res.status(err.status || 500).json({ error: { message: 'Internal server error' } });
});
app.use((req, res) => res.status(404).json({ error: { message: 'Endpoint not found' } }));

// =================================================================
// --- FINAL FIX: Automatic Database Initialization ---
// This block runs when the server starts. It checks if the database
// is set up. If not, it creates all the tables and imports the
// initial data automatically. This is a robust, one-time setup.
// =================================================================
const { pgPool } = require('./config/database');
const { createTables } = require('./scripts/create-schema');
const { importCSVSalesData } = require('./scripts/import-excel');

async function initializeApp() {
  const client = await pgPool.connect();
  try {
    const res = await client.query("SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'users');");
    const tableExists = res.rows[0].exists;

    if (!tableExists) {
      console.log('🔴 "users" table not found. Initializing database schema and data...');
      await createTables();
      await importCSVSalesData();
      console.log('🟢 Database initialization complete.');
    } else {
      console.log('🟢 Database already initialized.');
    }
  } catch (err) {
    console.error('💥 FATAL: Database initialization failed:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

// --- Start Server ---
initializeApp().then(() => {
  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Hansei Backend Server running on ${HOST}:${PORT}`);
  });

  const gracefulShutdown = (signal) => {
    console.log(`${signal} received. Shutting down gracefully.`);
    server.close(() => {
      console.log('HTTP server closed.');
      pgPool.end(() => {
        console.log('Database pool closed.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
});

module.exports = app;
