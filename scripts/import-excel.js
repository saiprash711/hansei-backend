// scripts/import-excel.js
const xlsx = require('xlsx');
const path = require('path');
const { pgPool } = require('../config/database');
const bcrypt = require('bcryptjs');

async function importExcelData() {
  try {
    console.log('📊 Starting Excel data import...');

    // Assuming the script is run from the root directory, and the file is in the root
    const filePath = path.join(__dirname, '../FinalSales.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    console.log(`Found ${data.length} rows in Excel file`);

    // Clear existing data
    await pgPool.query('TRUNCATE TABLE inventory, products, branches, users RESTART IDENTITY CASCADE');
    console.log('Truncated existing tables.');

    // Create default users
    const hashedPassword1 = await bcrypt.hash('Daikin@Hansei2025!', 10);
    const hashedPassword2 = await bcrypt.hash('Analytics@2025', 10);

    await pgPool.query(`
      INSERT INTO users (username, password, full_name, role) VALUES
      ('smart', $1, 'Smart User', 'smart_user'),
      ('normal', $2, 'Normal User', 'normal_user')
    `, [hashedPassword1, hashedPassword2]);
    console.log('Created default users.');

    // Process and insert branches
    const branches = [...new Set(data.map(row => row.Branch))].filter(Boolean);
    console.log('Branches found:', branches);

    for (const branchName of branches) {
      await pgPool.query(`
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
      // UPDATED: Changed from row.Material to row['Item Code']
      if (!row['Item Code']) {
        console.warn('Skipping row with missing Item Code:', row);
        return;
      }

      // UPDATED: Changed from row.Material to row['Item Code']
      if (!products[row['Item Code']]) {
        // UPDATED: Changed from row.Material to row['Item Code'] throughout this block
        products[row['Item Code']] = {
          material: row['Item Code'],
          tonnage: parseTonnage(row['Item Code']),
          star: parseStar(row['Item Code']),
          technology: parseTechnology(row['Item Code']),
          price: generatePrice(row['Item Code']),
          factory_stock: parseInt(row['Factory Stock']) || 0
        };
      }
    });

    for (const product of Object.values(products)) {
      await pgPool.query(`
        INSERT INTO products (material, tonnage, star, technology, price, factory_stock)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (material) DO UPDATE SET
          factory_stock = $6
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
    const productResult = await pgPool.query('SELECT id, material FROM products');
    const branchResult = await pgPool.query('SELECT id, name FROM branches');

    const productMap = {};
    productResult.rows.forEach(p => productMap[p.material] = p.id);

    const branchMap = {};
    branchResult.rows.forEach(b => branchMap[b.name] = b.id);

    // Process and insert inventory records
    for (const row of data) {
      // UPDATED: Changed from row.Material to row['Item Code']
      const itemCode = row['Item Code'];
      const branchName = row.Branch;

      if (itemCode && branchName && productMap[itemCode] && branchMap[branchName]) {
        await pgPool.query(`
          INSERT INTO inventory (product_id, branch_id, op_stock, avl_stock, transit, billing, month_plan)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (product_id, branch_id) DO UPDATE SET
            op_stock = $3,
            avl_stock = $4,
            transit = $5,
            billing = $6,
            month_plan = $7,
            updated_at = CURRENT_TIMESTAMP
        `, [
          productMap[itemCode], // UPDATED
          branchMap[branchName],
          parseInt(row['Op Stock']) || 0,
          parseInt(row['Avl Stock']) || 0,
          parseInt(row['Transit']) || 0,
          parseInt(row['Billing']) || 0,
          parseInt(row['Month Plan']) || 0
        ]);
      }
    }
    console.log('Inventory records imported.');

    console.log('✅ Excel data imported successfully!');

    // Final summary
    const summaryResult = await pgPool.query(`
      SELECT 
        (SELECT COUNT(*) FROM products) as product_count,
        (SELECT COUNT(*) FROM branches) as branch_count,
        (SELECT COUNT(*) FROM inventory) as inventory_count,
        (SELECT SUM(avl_stock) FROM inventory) as total_stock
    `);

    const summary = summaryResult.rows[0];
    console.log(`
Summary:
- Products: ${summary.product_count}
- Branches: ${summary.branch_count}
- Inventory Records: ${summary.inventory_count}
- Total Stock: ${summary.total_stock || 0}
    `);

  } catch (error) {
    console.error('❌ Error importing Excel data:', error);
    throw error;
  }
}

// Helper Functions (no changes needed here)
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

function parseTonnage(material) {
    if (typeof material !== 'string') return 1.0;
    if (material.includes('RL50')) return 1.5;
    if (material.includes('RHT50')) return 1.5;
    return 1.0;
}

function parseStar(material) {
    if (typeof material !== 'string') return 3;
    if (material.includes('UV16V3')) return 3;
    if (material.includes('UV16V')) return 5;
    return 3;
}

function parseTechnology(material) {
    if (typeof material !== 'string') return 'Non Inv';
    if (material.includes('RHT')) return 'H&C Inv';
    if (material.includes('RL')) return 'Non Inv';
    return 'Non Inv';
}


function generatePrice(material) {
  const tonnage = parseTonnage(material);
  const star = parseStar(material);
  const tech = parseTechnology(material);

  let basePrice = 25000;
  basePrice += (tonnage - 0.8) * 15000;
  basePrice += (star - 1) * 5000;
  if (tech.includes('Inv')) basePrice += 10000;

  return Math.round(basePrice);
}

// Entry point for running the script directly
if (require.main === module) {
  importExcelData()
    .then(() => {
      console.log('Import completed!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Import failed:', err);
      process.exit(1);
    });
}

module.exports = { importExcelData };
