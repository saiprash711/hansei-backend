const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const { pgPool } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// --- Multer Configuration for file uploads ---
// Store files in memory to be processed before saving to disk or DB.
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

/**
 * Main upload endpoint.
 * Handles both Excel inventory files and CSV sales files.
 * Protected route, only accessible by 'smart_user'.
 */
router.post('/', authenticateToken, authorizeRole('smart_user'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    let data;
    // Process based on file type
    if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
      // For CSV files
      const fileContent = req.file.buffer.toString('utf8');
      const workbook = xlsx.read(fileContent, { type: 'string' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      // For Excel files (xlsx, xls)
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    if (!data || data.length === 0) {
        throw new Error("No data found in the uploaded file or file is empty.");
    }

    // Process the extracted data
    await processInventoryData(data, client);

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'File processed and data imported successfully.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('File upload processing error:', error);
    res.status(500).json({ error: 'Failed to process file.', details: error.message });
  } finally {
    client.release();
  }
});


// --- Data Processing Logic ---

// Determines which processing function to call based on data columns.
async function processInventoryData(data, client) {
  console.log('Processing uploaded data...');
  
  const isCSVSalesData = data.length > 0 && 
    data[0].hasOwnProperty('Item Code') && 
    data[0].hasOwnProperty('Sales Qty.') &&
    data[0].hasOwnProperty('Branch');

  if (isCSVSalesData) {
    await processCSVSalesData(data, client);
  } else {
    // Fallback to assuming it's direct inventory data
    await processExcelInventoryData(data, client);
  }
}

// Handles data from the FinalSales.csv format
async function processCSVSalesData(data, client) {
  console.log("Detected sales data format. Converting to inventory records...");
  const products = new Map();
  const branches = new Set(data.map(row => row.Branch).filter(Boolean));

  // First pass: aggregate all unique products
  data.forEach(row => {
    const itemCode = row['Item Code'];
    if (itemCode && !products.has(itemCode)) {
      products.set(itemCode, {
        material: itemCode,
        tonnage: parseFloat(row['Tonnage']) || 1.0,
        star: parseInt(row['Star rating']) || 3,
        technology: row['Technology'] || 'Non Inv',
        price: generateProductPrice(row)
      });
    }
  });

  // Insert branches and products
  for (const branchName of branches) {
    await client.query(`INSERT INTO branches (name, state) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`, [branchName, getStateForBranch(branchName)]);
  }
  for (const product of products.values()) {
    await client.query(`INSERT INTO products (material, tonnage, star, technology, price) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (material) DO NOTHING`, [product.material, product.tonnage, product.star, product.technology, product.price]);
  }

  // Get maps for IDs
  const [productRows, branchRows] = await Promise.all([
    client.query('SELECT id, material FROM products'),
    client.query('SELECT id, name FROM branches')
  ]);
  const productMap = new Map(productRows.rows.map(p => [p.material, p.id]));
  const branchMap = new Map(branchRows.rows.map(b => [b.name, b.id]));

  // Aggregate sales quantities
  const inventory = new Map();
  data.forEach(row => {
    const key = `${row['Item Code']}-${row.Branch}`;
    const salesQty = parseFloat(row['Sales Qty.']) || 0;
    if (salesQty > 0) {
      if (!inventory.has(key)) {
        inventory.set(key, { totalSales: 0 });
      }
      inventory.get(key).totalSales += salesQty;
    }
  });

  // Insert/Update inventory records
  for (const [key, invData] of inventory.entries()) {
    const [itemCode, branchName] = key.split('-');
    const productId = productMap.get(itemCode);
    const branchId = branchMap.get(branchName);

    if (productId && branchId) {
      const billing = Math.round(invData.totalSales);
      // Simulate other inventory fields based on sales
      const monthPlan = Math.round(billing * 1.2);
      const availStock = Math.round(billing * 0.5);
      const transit = Math.round(billing * 0.2);
      const opStock = availStock + billing - transit;

      await client.query(
        `INSERT INTO inventory (product_id, branch_id, op_stock, avl_stock, transit, billing, month_plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (product_id, branch_id) DO UPDATE SET
           op_stock = inventory.op_stock + EXCLUDED.op_stock,
           avl_stock = inventory.avl_stock + EXCLUDED.avl_stock,
           transit = inventory.transit + EXCLUDED.transit,
           billing = inventory.billing + EXCLUDED.billing,
           month_plan = inventory.month_plan + EXCLUDED.month_plan,
           updated_at = CURRENT_TIMESTAMP`,
        [productId, branchId, opStock, availStock, transit, billing, monthPlan]
      );
    }
  }
}

// Handles direct inventory upload format
async function processExcelInventoryData(data, client) {
    console.log("Detected direct inventory data format.");
  for (const row of data) {
    const material = row.material || row.Material;
    const branchName = row.branch || row.Branch;

    if (!material || !branchName) continue;

    const productResult = await client.query('SELECT id FROM products WHERE material = $1', [material]);
    const branchResult = await client.query('SELECT id FROM branches WHERE name = $1', [branchName]);

    if (productResult.rows.length > 0 && branchResult.rows.length > 0) {
      const productId = productResult.rows[0].id;
      const branchId = branchResult.rows[0].id;
      await client.query(
        `INSERT INTO inventory (product_id, branch_id, op_stock, avl_stock, transit, billing, month_plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (product_id, branch_id) DO UPDATE SET 
           op_stock = EXCLUDED.op_stock, avl_stock = EXCLUDED.avl_stock, transit = EXCLUDED.transit,
           billing = EXCLUDED.billing, month_plan = EXCLUDED.month_plan, updated_at = CURRENT_TIMESTAMP`,
        [
          productId, branchId,
          parseInt(row.op_stock || row['Op Stock'] || 0),
          parseInt(row.avl_stock || row['Avl Stock'] || 0),
          parseInt(row.transit || row.Transit || 0),
          parseInt(row.billing || row.Billing || 0),
          parseInt(row.month_plan || row['Month Plan'] || 0)
        ]
      );
    }
  }
}

// --- Helper Functions ---
function generateProductPrice(row) {
  const tonnage = parseFloat(row['Tonnage']) || 1.0;
  const star = parseInt(row['Star rating']) || 3;
  const technology = row['Technology'] || 'Non Inv';
  let basePrice = 25000;
  basePrice += (tonnage - 0.8) * 15000;
  basePrice += (star - 1) * 5000;
  if (technology.includes('Inv')) basePrice += 10000;
  return Math.round(basePrice);
}

function getStateForBranch(branch) {
  const stateMap = {
    'Chennai': 'Tamil Nadu', 'Bangalore': 'Karnataka', 'Hyderabad': 'Telangana',
    'Vijayawada': 'Andhra Pradesh', 'Cochin': 'Kerala', 'Mumbai': 'Maharashtra',
    'Delhi': 'Delhi', 'Kolkata': 'West Bengal', 'Pune': 'Maharashtra', 'Ahmedabad': 'Gujarat'
  };
  return stateMap[branch] || 'Unknown';
}

// --- IMPORTANT: Export the router ---
module.exports = router;
