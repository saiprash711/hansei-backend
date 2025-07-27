// scripts/import-csv-sales.js
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { pgPool } = require('../config/database');
const bcrypt = require('bcryptjs');

// --- Helper Functions for Safe Parsing ---

/**
 * Safely parses a string into a floating-point number.
 * If the value is invalid, empty, or null, it returns a specified default value.
 * @param {any} value The value to parse.
 * @param {number} defaultValue The value to return if parsing fails.
 * @returns {number} The parsed number or the default value.
 */
const safeParseFloat = (value, defaultValue) => {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

/**
 * Safely parses a string into an integer.
 * If the value is invalid, empty, or null, it returns a specified default value.
 * @param {any} value The value to parse.
 * @param {number} defaultValue The value to return if parsing fails.
 * @returns {number} The parsed number or the default value.
 */
const safeParseInt = (value, defaultValue) => {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};


async function importCSVSalesData() {
  try {
    console.log('📊 Starting CSV sales data import...');

    // Read CSV file
    const filePath = path.join(__dirname, '../FinalSales.csv');
    const data = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => data.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Found ${data.length} rows in CSV file`);

    // Connect to the database client
    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');

        // Clear existing data
        await client.query('TRUNCATE TABLE inventory, products, branches, users RESTART IDENTITY CASCADE');
        console.log('Truncated existing tables.');

        // Create default users
        const hashedPassword1 = await bcrypt.hash('Daikin@Hansei2025!', 10);
        const hashedPassword2 = await bcrypt.hash('Analytics@2025', 10);

        await client.query(`
          INSERT INTO users (username, password, full_name, role) VALUES
          ('smart', $1, 'Smart User', 'smart_user'),
          ('normal', $2, 'Normal User', 'normal_user')
        `, [hashedPassword1, hashedPassword2]);
        console.log('Created default users.');

        // Process and insert branches
        const branches = [...new Set(data.map(row => row.Branch))].filter(Boolean);
        console.log('Branches found:', branches);

        for (const branchName of branches) {
          await client.query(`
            INSERT INTO branches (name, state, market_share, penetration) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (name) DO NOTHING
          `, [
            branchName,
            getStateForBranch(branchName),
            Math.floor(Math.random() * 10) + 15,
            Math.floor(Math.random() * 20) + 65
          ]);
        }
        console.log('Branches imported.');

        // Process and insert products
        const products = {};
        data.forEach(row => {
          const itemCode = row['Item Code'];
          if (!itemCode) return;

          if (!products[itemCode]) {
            // UPDATED: Using safe parsing functions
            const tonnage = safeParseFloat(row['Tonnage'], 1.0);
            const star = safeParseInt(row['Star rating'], 3);
            const technology = row['Technology'] || 'Non Inv';

            products[itemCode] = {
              material: itemCode,
              tonnage: tonnage,
              star: star,
              technology: technology,
              price: generatePrice(itemCode, tonnage, star, technology),
              factory_stock: 0 // Will be calculated from sales data
            };
          }
        });

        for (const product of Object.values(products)) {
          await client.query(`
            INSERT INTO products (material, tonnage, star, technology, price, factory_stock)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (material) DO UPDATE SET
              tonnage = EXCLUDED.tonnage,
              star = EXCLUDED.star,
              technology = EXCLUDED.technology,
              price = EXCLUDED.price,
              factory_stock = EXCLUDED.factory_stock
          `, [
            product.material,
            product.tonnage,
            product.star,
            product.technology,
            product.price,
            product.factory_stock
          ]);
        }
        console.log('Products imported.');

        // Create maps for foreign key relationships
        const productResult = await client.query('SELECT id, material FROM products');
        const branchResult = await client.query('SELECT id, name FROM branches');

        const productMap = {};
        productResult.rows.forEach(p => productMap[p.material] = p.id);

        const branchMap = {};
        branchResult.rows.forEach(b => branchMap[b.name] = b.id);

        // Aggregate sales data by product and branch
        const inventory = {};
        
        data.forEach(row => {
          const itemCode = row['Item Code'];
          const branchName = row.Branch;
          // UPDATED: Using safe parsing function
          const salesQty = safeParseFloat(row['Sales Qty.'], 0);

          if (itemCode && branchName && salesQty > 0) {
            const key = `${itemCode}-${branchName}`;
            if (!inventory[key]) {
              inventory[key] = {
                itemCode,
                branchName,
                totalSales: 0,
                transactionCount: 0
              };
            }
            inventory[key].totalSales += salesQty;
            inventory[key].transactionCount += 1;
          }
        });

        console.log(`Aggregated ${Object.keys(inventory).length} inventory records`);

        // Insert inventory records with simulated data
        for (const invData of Object.values(inventory)) {
          const productId = productMap[invData.itemCode];
          const branchId = branchMap[invData.branchName];

          if (productId && branchId) {
            const billing = Math.round(invData.totalSales);
            const monthPlan = Math.round(billing * (0.9 + Math.random() * 0.4));
            const availStock = Math.round(monthPlan * (0.1 + Math.random() * 0.8));
            const transit = Math.round(monthPlan * (0.05 + Math.random() * 0.15));
            const opStock = Math.round(availStock + billing + (Math.random() * 100));

            await client.query(`
              INSERT INTO inventory (product_id, branch_id, op_stock, avl_stock, transit, billing, month_plan)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (product_id, branch_id) DO UPDATE SET
                op_stock = EXCLUDED.op_stock,
                avl_stock = EXCLUDED.avl_stock,
                transit = EXCLUDED.transit,
                billing = EXCLUDED.billing,
                month_plan = EXCLUDED.month_plan,
                updated_at = CURRENT_TIMESTAMP
            `, [
              productId,
              branchId,
              opStock,
              availStock,
              transit,
              billing,
              monthPlan
            ]);
          }
        }
        console.log('Inventory records created from sales data.');
        
        await client.query('COMMIT');
        console.log('✅ CSV sales data imported and converted to inventory format!');

        // Final summary
        const summaryResult = await client.query(`
          SELECT 
            (SELECT COUNT(*) FROM products) as product_count,
            (SELECT COUNT(*) FROM branches) as branch_count,
            (SELECT COUNT(*) FROM inventory) as inventory_count,
            (SELECT SUM(avl_stock) FROM inventory) as total_stock,
            (SELECT SUM(billing) FROM inventory) as total_sales
        `);

        const summary = summaryResult.rows[0];
        console.log(`
    Summary:
    - Products: ${summary.product_count}
    - Branches: ${summary.branch_count}
    - Inventory Records: ${summary.inventory_count}
    - Total Stock: ${summary.total_stock || 0}
    - Total Sales: ${summary.total_sales || 0}
        `);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error during database transaction:', error);
        throw error;
    } finally {
        client.release();
    }

  } catch (error) {
    console.error('❌ Error importing CSV data:', error.message);
    throw error;
  }
}

// Helper Functions
function getStateForBranch(branch) {
  const stateMap = {
    'Chennai': 'Tamil Nadu',
    'Bangalore': 'Karnataka',
    'Hyderabad': 'Telangana',
    'Vijayawada': 'Andhra Pradesh',
    'Cochin': 'Kerala',
    'Mumbai': 'Maharashtra',
    'Delhi': 'Delhi',
    'Kolkata': 'West Bengal',
    'Pune': 'Maharashtra',
    'Ahmedabad': 'Gujarat'
  };
  return stateMap[branch] || 'Unknown';
}

function generatePrice(material, tonnage, star, technology) {
  let basePrice = 25000;
  basePrice += (tonnage - 0.8) * 15000;
  basePrice += (star - 1) * 5000;
  if (technology && technology.includes('Inv')) basePrice += 10000;
  return Math.round(basePrice);
}

// Entry point for running the script directly
if (require.main === module) {
  importCSVSalesData()
    .then(() => {
      console.log('CSV Import completed!');
      process.exit(0);
    })
    .catch(err => {
      console.error('CSV Import failed:', err.message);
      process.exit(1);
    });
}

module.exports = { importCSVSalesData };
