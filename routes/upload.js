// routes/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { pgPool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    // --- START OF FIX ---
    // Increased the file size limit from 10MB to 50MB
    fileSize: 50 * 1024 * 1024 // 50MB limit
    // --- END OF FIX ---
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only XLSX, XLS, and CSV files are allowed.'));
    }
  }
});

// Upload file endpoint
router.post('/file', authenticateToken, requireRole('smart_user'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    // Save file info to database
    const fileResult = await pgPool.query(
      `INSERT INTO file_uploads (filename, original_name, mime_type, size, uploaded_by) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id]
    );

    res.json({
      success: true,
      file: fileResult.rows[0],
      message: 'File uploaded successfully'
    });

  } catch (error) {
    console.error('File upload error:', error);
    // Handle multer-specific errors
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File is too large. Maximum size is 50MB.' });
        }
    }
    res.status(500).json({
      error: 'Failed to upload file'
    });
  }
});

// Process uploaded file
router.post('/process/:fileId', authenticateToken, requireRole('smart_user'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const { dataType } = req.body; // 'inventory', 'products', 'sales'

    // Get file info
    const fileResult = await pgPool.query(
      'SELECT * FROM file_uploads WHERE id = $1 AND uploaded_by = $2',
      [fileId, req.user.id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    const file = fileResult.rows[0];
    const filePath = path.join('uploads', file.filename);

    // Process based on file type
    if (file.original_name.endsWith('.csv')) {
      await processCSV(filePath, dataType);
    } else {
      await processExcel(filePath, dataType);
    }

    // Mark file as processed
    await pgPool.query(
      'UPDATE file_uploads SET processed = true WHERE id = $1',
      [fileId]
    );

    res.json({
      success: true,
      message: 'File processed successfully'
    });

  } catch (error) {
    console.error('File processing error:', error);
    res.status(500).json({
      error: 'Failed to process file'
    });
  }
});

// Process CSV file
async function processCSV(filePath, dataType) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        try {
          await processData(results, dataType);
          resolve();
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

// Process Excel file
async function processExcel(filePath, dataType) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);
  
  await processData(data, dataType);
}

// Process data based on type
async function processData(data, dataType) {
  const client = await pgPool.connect();
  
  try {
    await client.query('BEGIN');

    switch (dataType) {
      case 'inventory':
        await processInventoryData(data, client);
        break;
      case 'products':
        await processProductData(data, client);
        break;
      case 'sales':
        await processSalesData(data, client);
        break;
      default:
        throw new Error('Invalid data type');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Process inventory data
async function processInventoryData(data, client) {
  for (const row of data) {
    // Get product and branch IDs
    const productResult = await client.query(
      'SELECT id FROM products WHERE material = $1',
      [row.material || row.Material]
    );
    
    const branchResult = await client.query(
      'SELECT id FROM branches WHERE name = $1',
      [row.branch || row.Branch]
    );

    if (productResult.rows.length > 0 && branchResult.rows.length > 0) {
      await client.query(
        `INSERT INTO inventory (product_id, branch_id, op_stock, avl_stock, transit, billing, month_plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (product_id, branch_id) 
         DO UPDATE SET 
           op_stock = $3,
           avl_stock = $4,
           transit = $5,
           billing = $6,
           month_plan = $7,
           updated_at = CURRENT_TIMESTAMP`,
        [
          productResult.rows[0].id,
          branchResult.rows[0].id,
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

// Process product data
async function processProductData(data, client) {
  for (const row of data) {
    await client.query(
      `INSERT INTO products (material, tonnage, star, technology, price, factory_stock)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (material) 
       DO UPDATE SET 
         tonnage = $2,
         star = $3,
         technology = $4,
         price = $5,
         factory_stock = $6,
         updated_at = CURRENT_TIMESTAMP`,
      [
        row.material || row.Material,
        parseFloat(row.tonnage || row.Tonnage),
        parseInt(row.star || row.Star),
        row.technology || row.Technology,
        parseInt(row.price || row.Price),
        parseInt(row.factory_stock || row['Factory Stock'] || 0)
      ]
    );
  }
}

// Process sales data
async function processSalesData(data, client) {
  for (const row of data) {
    const productResult = await client.query(
      'SELECT id FROM products WHERE material = $1',
      [row.material || row.Material]
    );
    
    const branchResult = await client.query(
      'SELECT id FROM branches WHERE name = $1',
      [row.branch || row.Branch]
    );

    if (productResult.rows.length > 0 && branchResult.rows.length > 0) {
      await client.query(
        `INSERT INTO sales_transactions (product_id, branch_id, quantity, transaction_date, transaction_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          productResult.rows[0].id,
          branchResult.rows[0].id,
          parseInt(row.quantity || row.Quantity),
          new Date(row.date || row.Date || Date.now()),
          row.type || row.Type || 'sale'
        ]
      );
    }
  }
}

// Get upload history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pgPool.query(
      `SELECT 
        f.*,
        u.username,
        u.full_name
       FROM file_uploads f
       JOIN users u ON f.uploaded_by = u.id
       WHERE f.uploaded_by = $1
       ORDER BY f.upload_date DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({
      uploads: result.rows
    });

  } catch (error) {
    console.error('Error fetching upload history:', error);
    res.status(500).json({
      error: 'Failed to fetch upload history'
    });
  }
});

module.exports = router;
