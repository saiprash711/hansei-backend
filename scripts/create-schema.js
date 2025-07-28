// scripts/create-schema.js
const { pgPool } = require('../config/database');

const createTables = async () => {
  const client = await pgPool.connect();
  try {
    console.log('🚀 Starting database schema creation...');

    // Drop existing tables if they exist to ensure a clean slate
    await client.query(`
      DROP TABLE IF EXISTS inventory;
      DROP TABLE IF EXISTS products;
      DROP TABLE IF EXISTS branches;
      DROP TABLE IF EXISTS users;
    `);
    console.log('✅ Dropped existing tables (if any).');

    // Create users table
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        role VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      );
    `);
    console.log('✅ Created "users" table.');

    // Create branches table
    await client.query(`
      CREATE TABLE branches (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        state VARCHAR(255),
        market_share NUMERIC(5, 2),
        penetration NUMERIC(5, 2)
      );
    `);
    console.log('✅ Created "branches" table.');

    // Create products table
    await client.query(`
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        material VARCHAR(255) UNIQUE NOT NULL,
        tonnage NUMERIC(4, 2),
        star INTEGER,
        technology VARCHAR(255),
        price INTEGER,
        factory_stock INTEGER DEFAULT 0
      );
    `);
    console.log('✅ Created "products" table.');

    // Create inventory table
    await client.query(`
      CREATE TABLE inventory (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
        op_stock INTEGER,
        avl_stock INTEGER,
        transit INTEGER,
        billing INTEGER,
        month_plan INTEGER,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (product_id, branch_id)
      );
    `);
    console.log('✅ Created "inventory" table.');

    console.log('🎉 Database schema created successfully!');
  } catch (error) {
    console.error('❌ Error creating database schema:', error);
    throw error; // Throw error to stop the deployment process if schema creation fails
  } finally {
    client.release();
  }
};

// Run the function if this script is executed directly
if (require.main === module) {
  createTables()
    .then(() => {
      console.log('Schema script finished.');
      pgPool.end(); // Close the pool
    })
    .catch(() => {
      process.exit(1); // Exit with an error code
    });
}

module.exports = { createTables };
