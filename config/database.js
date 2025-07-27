// config/database.js
const { Pool } = require('pg');
const mongoose = require('mongoose');
require('dotenv').config();

// UPDATED: Enhanced PostgreSQL connection with better error handling
const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'hansei_dashboard',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000, // Increased for Render
  // ADDED: SSL configuration for production databases
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test PostgreSQL connection with better error handling
pgPool.on('connect', (client) => {
  console.log('✅ Connected to PostgreSQL database');
  console.log(`📊 Database: ${process.env.DB_NAME || 'hansei_dashboard'}`);
});

pgPool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err.message);
  // Don't exit process in production, just log the error
  if (process.env.NODE_ENV !== 'production') {
    console.error('Full error:', err);
  }
});

// UPDATED: Enhanced MongoDB connection with better error handling
const connectMongoDB = async () => {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 15000, // 15 seconds
        socketTimeoutMS: 45000, // 45 seconds
      });
      console.log('✅ Connected to MongoDB');
    } else {
      console.log('⚠️ No MONGODB_URI provided, skipping MongoDB connection');
    }
  } catch (error) {
    console.log('⚠️ MongoDB connection failed, continuing without analytics logging:', error.message);
    // Don't throw error, just continue without MongoDB
  }
};

// ADDED: Test database connectivity function
async function testDatabaseConnections() {
  try {
    // Test PostgreSQL
    const client = await pgPool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ PostgreSQL test query successful:', result.rows[0].current_time);
    client.release();
    
    return true;
  } catch (error) {
    console.error('❌ Database connectivity test failed:', error.message);
    throw error;
  }
}

// MongoDB schemas (for analytics logging)
const analyticsEventSchema = new mongoose.Schema({
  eventType: String,
  userId: String,
  timestamp: { type: Date, default: Date.now },
  metadata: Object
});

const chatLogSchema = new mongoose.Schema({
  userId: String,
  message: String,
  response: String,
  sessionId: String,
  timestamp: { type: Date, default: Date.now }
});

// UPDATED: Handle model creation with error handling
let AnalyticsEvent, ChatLog;
try {
  AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);
  ChatLog = mongoose.model('ChatLog', chatLogSchema);
} catch (error) {
  console.warn('⚠️ MongoDB models not available:', error.message);
  // Create dummy models that don't actually save
  AnalyticsEvent = {
    prototype: {
      save: async () => {
        console.warn('⚠️ Analytics logging skipped (MongoDB not available)');
        return Promise.resolve();
      }
    }
  };
  ChatLog = {
    find: () => ({ sort: () => ({ limit: () => Promise.resolve([]) }) }),
    prototype: {
      save: async () => {
        console.warn('⚠️ Chat logging skipped (MongoDB not available)');
        return Promise.resolve();
      }
    }
  };
}

// Initialize connections
connectMongoDB().catch(error => {
  console.warn('MongoDB initialization failed, continuing...', error.message);
});

// ADDED: Initialize database connections and test them
async function initializeDatabase() {
  try {
    await testDatabaseConnections();
    console.log('🎉 Database initialization complete!');
  } catch (error) {
    console.error('💥 Database initialization failed:', error.message);
    throw error;
  }
}

module.exports = {
  pgPool,
  AnalyticsEvent,
  ChatLog,
  initializeDatabase,
  testDatabaseConnections
};