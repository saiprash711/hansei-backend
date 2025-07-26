// config/database.js
const { Pool } = require('pg');
const mongoose = require('mongoose');

// PostgreSQL configuration
const pgPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hansei_db',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

// MongoDB configuration (for unstructured data like chat logs)
//mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hansei_analytics', {
  //useNewUrlParser: true,
  //useUnifiedTopology: true,
//});

// PostgreSQL Schema Creation
const createTables = async () => {
  try {
    // Users table
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    // Products table
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        material VARCHAR(50) UNIQUE NOT NULL,
        tonnage DECIMAL(3,1) NOT NULL,
        star INTEGER NOT NULL,
        technology VARCHAR(20) NOT NULL,
        price INTEGER NOT NULL,
        factory_stock INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Cities/Branches table
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        state VARCHAR(50),
        market_share DECIMAL(5,2),
        penetration DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Inventory table (city-wise stock)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id),
        branch_id INTEGER REFERENCES branches(id),
        op_stock INTEGER DEFAULT 0,
        avl_stock INTEGER DEFAULT 0,
        transit INTEGER DEFAULT 0,
        billing INTEGER DEFAULT 0,
        month_plan INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, branch_id)
      )
    `);

    // Sales transactions table
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS sales_transactions (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id),
        branch_id INTEGER REFERENCES branches(id),
        quantity INTEGER NOT NULL,
        transaction_date DATE NOT NULL,
        transaction_type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // File uploads table
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS file_uploads (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        size INTEGER,
        uploaded_by INTEGER REFERENCES users(id),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed BOOLEAN DEFAULT FALSE
      )
    `);

    console.log('✅ Database tables created successfully');
  } catch (err) {
    console.error('❌ Error creating tables:', err);
  }
};

// MongoDB Schemas
const ChatLogSchema = new mongoose.Schema({
  userId: String,
  message: String,
  response: String,
  timestamp: { type: Date, default: Date.now },
  sessionId: String
});

const AnalyticsEventSchema = new mongoose.Schema({
  eventType: String,
  userId: String,
  data: mongoose.Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now }
});

const ChatLog = mongoose.model('ChatLog', ChatLogSchema);
const AnalyticsEvent = mongoose.model('AnalyticsEvent', AnalyticsEventSchema);

// Initialize database
createTables();

// Seed initial data
const seedDatabase = async () => {
  try {
    // Check if data already exists
    const userCheck = await pgPool.query('SELECT COUNT(*) FROM users');
    if (userCheck.rows[0].count > 0) return;

    // Import bcrypt for password hashing
    const bcrypt = require('bcryptjs');

    // Insert default users
    const hashedPassword1 = await bcrypt.hash('Daikin@Hansei2025!', 10);
    const hashedPassword2 = await bcrypt.hash('Analytics@2025', 10);
    
    await pgPool.query(`
      INSERT INTO users (username, password, full_name, role) VALUES
      ('smart', $1, 'Smart User', 'smart_user'),
      ('normal', $2, 'Normal User', 'normal_user')
    `, [hashedPassword1, hashedPassword2]);

    // Insert branches
    await pgPool.query(`
      INSERT INTO branches (name, state, market_share, penetration) VALUES
      ('Chennai', 'Tamil Nadu', 25, 85),
      ('Bangalore', 'Karnataka', 22, 78),
      ('Hyderabad', 'Telangana', 20, 72),
      ('Vijayawada', 'Andhra Pradesh', 18, 68),
      ('Cochin', 'Kerala', 15, 65)
    `);

    // Insert products
    await pgPool.query(`
      INSERT INTO products (material, tonnage, star, technology, price, factory_stock) VALUES
      ('RKL28TV16W', 0.8, 3, 'Non Inv', 32000, 120),
      ('RKT35TV16U', 1.0, 3, 'Inverter', 45000, 250),
      ('FTKF50TV16U', 1.5, 5, 'Inverter', 55000, 150),
      ('FTHT30TV16U', 1.0, 4, 'Inverter', 48000, 200),
      ('RKL50TV16W', 1.5, 3, 'Non Inv', 42000, 180),
      ('RKT60TV16U', 1.8, 3, 'Inverter', 62000, 100),
      ('FTKF28TV16U', 0.8, 5, 'Inverter', 41000, 300),
      ('FTHT36TV16U', 1.2, 4, 'Inverter', 51000, 130),
      ('RKL71TV16W', 2.0, 3, 'Non Inv', 58000, 90),
      ('RKL35TV16W', 1.0, 3, 'Non Inv', 36000, 220),
      ('GENERIC-1STAR', 1.0, 1, 'Non Inv', 25000, 500),
      ('GENERIC-2STAR', 1.5, 2, 'Non Inv', 29000, 400)
    `);

    // Get product and branch IDs
    const products = await pgPool.query('SELECT id, material FROM products');
    const branches = await pgPool.query('SELECT id, name FROM branches');

    // Initial inventory data mapping
    const inventoryData = {
      'RKL28TV16W': { Chennai: 18, Bangalore: 15, Hyderabad: 15, Vijayawada: 12, Cochin: 12 },
      'RKT35TV16U': { Chennai: 35, Bangalore: 30, Hyderabad: 30, Vijayawada: 28, Cochin: 28 },
      'FTKF50TV16U': { Chennai: 28, Bangalore: 25, Hyderabad: 25, Vijayawada: 23, Cochin: 23 },
      'FTHT30TV16U': { Chennai: 22, Bangalore: 20, Hyderabad: 20, Vijayawada: 18, Cochin: 18 },
      'RKL50TV16W': { Chennai: 20, Bangalore: 18, Hyderabad: 18, Vijayawada: 15, Cochin: 15 },
      'RKT60TV16U': { Chennai: 14, Bangalore: 14, Hyderabad: 11, Vijayawada: 11, Cochin: 0 },
      'FTKF28TV16U': { Chennai: 45, Bangalore: 45, Hyderabad: 40, Vijayawada: 40, Cochin: 0 },
      'FTHT36TV16U': { Chennai: 25, Bangalore: 25, Hyderabad: 22, Vijayawada: 22, Cochin: 0 },
      'RKL71TV16W': { Chennai: 11, Bangalore: 11, Hyderabad: 9, Vijayawada: 9, Cochin: 0 },
      'RKL35TV16W': { Chennai: 30, Bangalore: 30, Hyderabad: 28, Vijayawada: 28, Cochin: 0 },
      'GENERIC-1STAR': { Chennai: 50, Bangalore: 40, Hyderabad: 30, Vijayawada: 20, Cochin: 10 },
      'GENERIC-2STAR': { Chennai: 45, Bangalore: 35, Hyderabad: 25, Vijayawada: 15, Cochin: 5 }
    };

    // Insert inventory data
    for (const product of products.rows) {
      for (const branch of branches.rows) {
        const stock = inventoryData[product.material]?.[branch.name] || 0;
        await pgPool.query(`
          INSERT INTO inventory (product_id, branch_id, op_stock, avl_stock, transit, billing, month_plan)
          VALUES ($1, $2, $3, $3, $4, $5, $6)
        `, [
          product.id,
          branch.id,
          stock,
          Math.floor(stock * 0.1),
          Math.floor(stock * 0.3),
          Math.ceil(stock * 1.2)
        ]);
      }
    }

    console.log('✅ Database seeded successfully');
  } catch (err) {
    console.error('❌ Error seeding database:', err);
  }
};

// Run seeding
seedDatabase();

module.exports = {
  pgPool,
  mongoose,
  ChatLog,
  AnalyticsEvent
};