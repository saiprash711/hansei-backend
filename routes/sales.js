// routes/sales.js
const express = require('express');
const router = express.Router();
const { pgPool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Get all products
router.get('/products', authenticateToken, async (req, res) => {
  try {
    const { technology, star, tonnage } = req.query;
    
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (technology) {
      query += ` AND technology = ANY($${paramCount}::text[])`;
      params.push(technology.split(','));
      paramCount++;
    }
    if (star) {
      query += ` AND star = ANY($${paramCount}::int[])`;
      params.push(star.split(','));
      paramCount++;
    }
    if (tonnage) {
      query += ` AND tonnage = ANY($${paramCount}::decimal[])`;
      params.push(tonnage.split(','));
      paramCount++;
    }

    query += ' ORDER BY material';

    const result = await pgPool.query(query, params);
    res.json({
      products: result.rows
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      error: 'Failed to fetch products'
    });
  }
});

// Get all branches
router.get('/branches', authenticateToken, async (req, res) => {
  try {
    const result = await pgPool.query(
      'SELECT * FROM branches ORDER BY name'
    );
    res.json({
      branches: result.rows
    });

  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({
      error: 'Failed to fetch branches'
    });
  }
});

// Get inventory by branch
router.get('/inventory/branch/:branchName', authenticateToken, async (req, res) => {
  try {
    const { branchName } = req.params;

    const query = `
      SELECT 
        i.*,
        p.material,
        p.tonnage,
        p.star,
        p.technology,
        p.price,
        b.name as branch_name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
      WHERE b.name = $1
      ORDER BY p.material
    `;

    const result = await pgPool.query(query, [branchName]);

    // Calculate availability percentage for each item
    const inventoryWithMetrics = result.rows.map(item => ({
      ...item,
      total_available: item.avl_stock + item.transit,
      availability_percentage: item.month_plan > 0 
        ? Math.round(((item.avl_stock + item.transit) / item.month_plan) * 100)
        : 0,
      balance_to_dispatch: Math.max(0, item.month_plan - item.billing),
      balance_to_produce: Math.max(0, item.month_plan - (item.avl_stock + item.transit))
    }));

    res.json({
      branch: branchName,
      inventory: inventoryWithMetrics
    });

  } catch (error) {
    console.error('Error fetching branch inventory:', error);
    res.status(500).json({
      error: 'Failed to fetch branch inventory'
    });
  }
});

// Get region-wide inventory summary
router.get('/inventory/region/:regionName', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        p.material,
        p.tonnage,
        p.star,
        p.technology,
        p.price,
        SUM(i.op_stock) as total_op_stock,
        SUM(i.avl_stock) as total_avl_stock,
        SUM(i.transit) as total_transit,
        SUM(i.billing) as total_billing,
        SUM(i.month_plan) as total_month_plan
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      GROUP BY p.id, p.material, p.tonnage, p.star, p.technology, p.price
      ORDER BY p.material
    `;

    const result = await pgPool.query(query);

    // Calculate aggregated metrics
    const inventoryWithMetrics = result.rows.map(item => ({
      ...item,
      total_available: item.total_avl_stock + item.total_transit,
      availability_percentage: item.total_month_plan > 0 
        ? Math.round(((item.total_avl_stock + item.total_transit) / item.total_month_plan) * 100)
        : 0
    }));

    // Calculate totals
    const totals = inventoryWithMetrics.reduce((acc, item) => {
      acc.total_op_stock += parseInt(item.total_op_stock) || 0;
      acc.total_avl_stock += parseInt(item.total_avl_stock) || 0;
      acc.total_transit += parseInt(item.total_transit) || 0;
      acc.total_billing += parseInt(item.total_billing) || 0;
      acc.total_month_plan += parseInt(item.total_month_plan) || 0;
      return acc;
    }, {
      total_op_stock: 0,
      total_avl_stock: 0,
      total_transit: 0,
      total_billing: 0,
      total_month_plan: 0
    });

    totals.availability_percentage = totals.total_month_plan > 0
      ? Math.round(((totals.total_avl_stock + totals.total_transit) / totals.total_month_plan) * 100)
      : 0;

    res.json({
      region: req.params.regionName,
      inventory: inventoryWithMetrics,
      totals
    });

  } catch (error) {
    console.error('Error fetching region inventory:', error);
    res.status(500).json({
      error: 'Failed to fetch region inventory'
    });
  }
});

// Get KPIs for dashboard
router.get('/kpis', authenticateToken, async (req, res) => {
  try {
    const { branch } = req.query;
    
    // MODIFIED: Cast multiplied values to bigint to prevent "integer out of range" error
    let inventoryQuery = `
      SELECT 
        SUM(i.avl_stock) as total_stock,
        SUM(i.transit) as total_transit,
        SUM(i.billing) as total_billing,
        SUM(i.month_plan) as total_plan,
        SUM(i.avl_stock::bigint * p.price::bigint) as inventory_value
      FROM inventory i
      JOIN products p ON i.product_id = p.id
    `;

    const params = [];
    if (branch) {
      inventoryQuery += ` JOIN branches b ON i.branch_id = b.id WHERE b.name = $1`;
      params.push(branch);
    }

    const inventoryResult = await pgPool.query(inventoryQuery, params);
    const data = inventoryResult.rows[0];

    const availability = data.total_plan > 0 
      ? Math.round(((parseInt(data.total_stock) + parseInt(data.total_transit)) / parseInt(data.total_plan)) * 100)
      : 0;

    const planAchievement = data.total_plan > 0
      ? Math.round((parseInt(data.total_billing) / parseInt(data.total_plan)) * 100)
      : 0;

    res.json({
      kpis: {
        availability_percentage: availability,
        plan_achievement_percentage: planAchievement,
        available_stock: parseInt(data.total_stock) || 0,
        inventory_value_cr: (parseInt(data.inventory_value) / 10000000).toFixed(2),
        total_billing: parseInt(data.total_billing) || 0,
        total_plan: parseInt(data.total_plan) || 0
      }
    });

  } catch (error) {
    console.error('Error fetching KPIs:', error);
    res.status(500).json({
      error: 'Failed to fetch KPIs'
    });
  }
});

// Get critical alerts
router.get('/alerts', authenticateToken, async (req, res) => {
  try {
    // Find products with zero stock but have a plan
    const criticalQuery = `
      SELECT 
        p.material,
        p.tonnage,
        p.star,
        p.technology,
        b.name as branch_name,
        i.month_plan,
        i.avl_stock,
        i.transit
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
      WHERE i.avl_stock = 0 AND i.month_plan > 0
      ORDER BY i.month_plan DESC
      LIMIT 10
    `;

    const criticalResult = await pgPool.query(criticalQuery);

    // Find products with low stock (< 20% of plan)
    const lowStockQuery = `
      SELECT 
        p.material,
        p.tonnage,
        p.star,
        p.technology,
        b.name as branch_name,
        i.month_plan,
        i.avl_stock,
        i.transit,
        ROUND(((i.avl_stock + i.transit)::numeric / NULLIF(i.month_plan, 0)) * 100, 2) as availability_percentage
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
      WHERE i.month_plan > 0 
        AND ((i.avl_stock + i.transit)::numeric / i.month_plan) < 0.2
        AND i.avl_stock > 0
      ORDER BY availability_percentage ASC
      LIMIT 10
    `;

    const lowStockResult = await pgPool.query(lowStockQuery);

    res.json({
      alerts: {
        critical: criticalResult.rows,
        lowStock: lowStockResult.rows
      }
    });

  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({
      error: 'Failed to fetch alerts'
    });
  }
});

// Update inventory (for admin users)
router.put('/inventory/:productId/:branchId', authenticateToken, async (req, res) => {
  try {
    // Check if user has permission
    if (req.user.role !== 'smart_user') {
      return res.status(403).json({
        error: 'Insufficient permissions to update inventory'
      });
    }

    const { productId, branchId } = req.params;
    const { op_stock, avl_stock, transit, billing, month_plan } = req.body;

    const updateQuery = `
      UPDATE inventory 
      SET 
        op_stock = COALESCE($1, op_stock),
        avl_stock = COALESCE($2, avl_stock),
        transit = COALESCE($3, transit),
        billing = COALESCE($4, billing),
        month_plan = COALESCE($5, month_plan),
        updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $6 AND branch_id = $7
      RETURNING *
    `;

    const result = await pgPool.query(updateQuery, [
      op_stock,
      avl_stock,
      transit,
      billing,
      month_plan,
      productId,
      branchId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Inventory record not found'
      });
    }

    res.json({
      success: true,
      inventory: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating inventory:', error);
    res.status(500).json({
      error: 'Failed to update inventory'
    });
  }
});

// Get sales summary by technology
router.get('/summary/technology', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        p.technology,
        COUNT(DISTINCT p.id) as product_count,
        SUM(i.avl_stock) as total_stock,
        SUM(i.billing) as total_sales,
        SUM(i.avl_stock * p.price) as inventory_value
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      GROUP BY p.technology
      ORDER BY total_sales DESC
    `;

    const result = await pgPool.query(query);

    res.json({
      summary: result.rows
    });

  } catch (error) {
    console.error('Error fetching technology summary:', error);
    res.status(500).json({
      error: 'Failed to fetch technology summary'
    });
  }
});

// Get region summary data (for Region Summary tab)
router.get('/region-summary', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        p.material,
        p.tonnage,
        p.star,
        p.technology,
        SUM(i.op_stock) as op_stock,
        SUM(i.month_plan) as plan,
        SUM(i.avl_stock) as avl_stock,
        SUM(i.transit) as transit,
        SUM(i.billing) as billing,
        SUM(i.avl_stock + i.transit) as total_avl,
        SUM(GREATEST(0, i.month_plan - i.billing)) as bal_dispatch,
        SUM(GREATEST(0, i.month_plan - (i.avl_stock + i.transit))) as bal_produce,
        SUM(GREATEST(0, (i.avl_stock + i.transit) - i.month_plan)) as excess
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      GROUP BY p.id, p.material, p.tonnage, p.star, p.technology
      ORDER BY p.material
    `;

    const result = await pgPool.query(query);

    // Calculate availability percentage for each item
    const summaryData = result.rows.map(item => ({
      ...item,
      avl_percent_plan: item.plan > 0 
        ? Math.round((parseInt(item.total_avl) / parseInt(item.plan)) * 100)
        : 0
    }));

    // Calculate totals for KPIs
    const totals = summaryData.reduce((acc, item) => {
      acc.op_stock += parseInt(item.op_stock) || 0;
      acc.plan += parseInt(item.plan) || 0;
      acc.avl_stock += parseInt(item.avl_stock) || 0;
      acc.transit += parseInt(item.transit) || 0;
      acc.billing += parseInt(item.billing) || 0;
      acc.bal_dispatch += parseInt(item.bal_dispatch) || 0;
      acc.bal_produce += parseInt(item.bal_produce) || 0;
      return acc;
    }, {
      op_stock: 0,
      plan: 0,
      avl_stock: 0,
      transit: 0,
      billing: 0,
      bal_dispatch: 0,
      bal_produce: 0
    });

    res.json({
      summary: summaryData,
      totals
    });

  } catch (error) {
    console.error('Error fetching region summary:', error);
    res.status(500).json({
      error: 'Failed to fetch region summary'
    });
  }
});

// Get coverage analysis data
router.get('/coverage-analysis', authenticateToken, async (req, res) => {
  try {
    const branchDataQuery = `
      SELECT 
        b.name as branch_name,
        b.penetration,
        SUM(i.billing) as total_sales,
        SUM(i.avl_stock) as total_stock,
        COUNT(DISTINCT i.product_id) as product_count
      FROM branches b
      LEFT JOIN inventory i ON b.id = i.branch_id
      GROUP BY b.id, b.name, b.penetration
      ORDER BY total_sales DESC
    `;

    const result = await pgPool.query(branchDataQuery);
    const branches = result.rows;

    // Calculate summary metrics
    const totalSales = branches.reduce((sum, b) => sum + parseInt(b.total_sales || 0), 0);
    const avgPenetration = branches.length > 0
      ? (branches.reduce((sum, b) => sum + parseFloat(b.penetration || 0), 0) / branches.length).toFixed(1)
      : 0;
    const topPerformer = branches[0]?.branch_name || 'N/A';

    res.json({
      branches,
      summary: {
        totalBranches: branches.length,
        totalSales,
        avgPenetration,
        topPerformer
      }
    });

  } catch (error) {
    console.error('Error fetching coverage analysis:', error);
    res.status(500).json({
      error: 'Failed to fetch coverage analysis'
    });
  }
});

// Get product analytics data with filters
router.get('/product-analytics', authenticateToken, async (req, res) => {
  try {
    const { star, technology, tonnage } = req.query;
    
    let query = `
      SELECT 
        p.*,
        SUM(i.avl_stock) as total_stock,
        SUM(i.billing) as total_sales,
        SUM(i.month_plan) as total_plan
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;

    if (star) {
      query += ` AND p.star = ANY($${paramCount}::int[])`;
      params.push(star.split(','));
      paramCount++;
    }
    if (technology) {
        let techArray = technology.split(',');
        if (techArray.includes('Inverter')) {
            techArray.push('H&C Inv');
        }
        query += ` AND p.technology = ANY($${paramCount}::text[])`;
        params.push(techArray);
        paramCount++;
    }
    if (tonnage) {
      query += ` AND p.tonnage = ANY($${paramCount}::decimal[])`;
      params.push(tonnage.split(','));
      paramCount++;
    }

    query += ' GROUP BY p.id ORDER BY total_stock DESC';

    const result = await pgPool.query(query, params);
    
    // Get unique values for filters
    const [starsResult, techsResult, tonnagesResult] = await Promise.all([
      pgPool.query('SELECT DISTINCT star FROM products ORDER BY star'),
      pgPool.query("SELECT DISTINCT CASE WHEN technology = 'H&C Inv' THEN 'Inverter' ELSE technology END as technology FROM products ORDER BY technology"),
      pgPool.query('SELECT DISTINCT tonnage FROM products ORDER BY tonnage')
    ]);

    res.json({
      products: result.rows,
      filters: {
        stars: starsResult.rows.map(r => r.star),
        technologies: [...new Set(techsResult.rows.map(r => r.technology))],
        tonnages: tonnagesResult.rows.map(r => r.tonnage)
      }
    });

  } catch (error) {
    console.error('Error fetching product analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch product analytics'
    });
  }
});

// Get product breakdown by category
router.get('/product-breakdown', authenticateToken, async (req, res) => {
  try {
    const { groupBy = 'technology' } = req.query;
    
    let groupField;
    switch (groupBy) {
      case 'star':
        groupField = 'p.star::text'; // Cast to text for consistent grouping
        break;
      case 'tonnage':
        groupField = 'p.tonnage::text'; // Cast to text for consistent grouping
        break;
      default:
        groupField = "CASE WHEN p.technology = 'H&C Inv' THEN 'Inverter' ELSE p.technology END";
    }
    
    const query = `
      SELECT 
        ${groupField} as category,
        COUNT(DISTINCT p.id) as product_count,
        SUM(i.avl_stock) as total_stock,
        SUM(i.billing) as total_sales
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      GROUP BY category
      ORDER BY total_stock DESC
    `;

    const result = await pgPool.query(query);

    res.json({
      breakdown: result.rows
    });

  } catch (error) {
    console.error('Error fetching product breakdown:', error);
    res.status(500).json({
      error: 'Failed to fetch product breakdown'
    });
  }
});

module.exports = router;
