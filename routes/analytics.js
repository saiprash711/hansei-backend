// routes/analytics.js
const express = require('express');
const router = express.Router();
const { pgPool, AnalyticsEvent } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Get branch performance metrics
router.get('/branch-performance', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        b.name as branch_name,
        b.market_share,
        b.penetration,
        SUM(i.billing) as total_sales,
        SUM(i.month_plan) as total_plan,
        SUM(i.avl_stock) as total_stock,
        SUM(i.transit) as total_transit,
        COUNT(DISTINCT i.product_id) as product_count,
        ROUND((SUM(i.billing)::numeric / NULLIF(SUM(i.month_plan), 0)) * 100, 2) as plan_achievement
      FROM branches b
      LEFT JOIN inventory i ON b.id = i.branch_id
      GROUP BY b.id, b.name, b.market_share, b.penetration
      ORDER BY total_sales DESC
    `;

    const result = await pgPool.query(query);

    // --- START OF FIX ---
    // Log analytics event, but don't let it crash the request if the DB fails.
    try {
      await new AnalyticsEvent({
        eventType: 'branch_performance_viewed',
        userId: req.user.id,
        timestamp: new Date()
      }).save();
    } catch (dbError) {
      console.error('Analytics DB logging error:', dbError.message);
    }
    // --- END OF FIX ---

    res.json({
      branchPerformance: result.rows
    });

  } catch (error) {
    console.error('Error fetching branch performance:', error);
    res.status(500).json({
      error: 'Failed to fetch branch performance'
    });
  }
});

// Get product performance analysis
router.get('/product-performance', authenticateToken, async (req, res) => {
  try {
    const { top = 10, bottom = 10 } = req.query;

    // Top performing products
    const topQuery = `
      SELECT 
        p.material,
        p.tonnage,
        p.star,
        p.technology,
        p.price,
        SUM(i.billing) as total_sales,
        SUM(i.month_plan) as total_plan,
        SUM(i.avl_stock) as total_stock,
        ROUND((SUM(i.billing)::numeric / NULLIF(SUM(i.month_plan), 0)) * 100, 2) as plan_achievement
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      GROUP BY p.id, p.material, p.tonnage, p.star, p.technology, p.price
      ORDER BY total_sales DESC
      LIMIT $1
    `;

    // Bottom performing products
    const bottomQuery = `
      SELECT 
        p.material,
        p.tonnage,
        p.star,
        p.technology,
        p.price,
        SUM(i.billing) as total_sales,
        SUM(i.month_plan) as total_plan,
        SUM(i.avl_stock) as total_stock,
        ROUND((SUM(i.billing)::numeric / NULLIF(SUM(i.month_plan), 0)) * 100, 2) as plan_achievement
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      WHERE i.month_plan > 0
      GROUP BY p.id, p.material, p.tonnage, p.star, p.technology, p.price
      ORDER BY total_sales ASC
      LIMIT $1
    `;

    const [topResult, bottomResult] = await Promise.all([
      pgPool.query(topQuery, [parseInt(top)]),
      pgPool.query(bottomQuery, [parseInt(bottom)])
    ]);

    res.json({
      topPerformers: topResult.rows,
      bottomPerformers: bottomResult.rows
    });

  } catch (error) {
    console.error('Error fetching product performance:', error);
    res.status(500).json({
      error: 'Failed to fetch product performance'
    });
  }
});

// Get planning analytics
router.get('/planning-analysis', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        b.name as branch_name,
        SUM(i.op_stock) as op_stock,
        SUM(i.month_plan) as plan,
        SUM(i.avl_stock) as avl_stock,
        SUM(i.transit) as transit,
        SUM(i.billing) as billing,
        SUM(i.month_plan - i.billing) as balance_to_bill,
        SUM(i.avl_stock + i.transit) as total_availability,
        SUM(GREATEST(0, i.month_plan - (i.avl_stock + i.transit))) as balance_to_dispatch,
        SUM(GREATEST(0, (i.avl_stock + i.transit) - i.month_plan)) as excess_stock,
        ROUND((SUM(i.billing)::numeric / NULLIF(SUM(i.month_plan), 0)) * 100, 2) as billing_velocity
      FROM branches b
      JOIN inventory i ON b.id = i.branch_id
      GROUP BY b.id, b.name
      ORDER BY b.name
    `;

    const result = await pgPool.query(query);

    // Identify key insights
    const sortedByVelocity = [...result.rows].sort((a, b) => b.billing_velocity - a.billing_velocity);
    const sortedByGap = [...result.rows].sort((a, b) => b.balance_to_dispatch - a.balance_to_dispatch);
    const sortedByExcess = [...result.rows].sort((a, b) => b.excess_stock - a.excess_stock);

    const insights = {
      topPerformer: sortedByVelocity[0],
      biggestSupplyGap: sortedByGap[0],
      mostExcessStock: sortedByExcess[0]
    };

    res.json({
      planningData: result.rows,
      insights
    });

  } catch (error) {
    console.error('Error fetching planning analysis:', error);
    res.status(500).json({
      error: 'Failed to fetch planning analysis'
    });
  }
});

// Get trends data (simulated for now, can be expanded with real historical data)
router.get('/trends/:period', authenticateToken, async (req, res) => {
  try {
    const { period } = req.params; // daily, weekly, monthly
    
    // In a real implementation, this would fetch historical data
    // For now, we'll generate simulated trend data
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const currentMonth = new Date().getMonth();
    
    // Simulate growth trend
    const trendData = months.map((month, index) => {
      const baseValue = 1000 + (index * 150);
      const variation = Math.random() * 200 - 100;
      
      return {
        period: month,
        sales: Math.round(baseValue + variation),
        plan: Math.round(baseValue * 0.95),
        stock: Math.round(3000 - (index * 100) + variation),
        achievement: Math.round(85 + (index * 2) + (Math.random() * 10))
      };
    });

    res.json({
      period,
      trends: trendData
    });

  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({
      error: 'Failed to fetch trends'
    });
  }
});

// Get executive summary
router.get('/executive-summary', authenticateToken, async (req, res) => {
  try {
    // Overall metrics
    const overallQuery = `
      SELECT 
        SUM(i.billing) as total_sales,
        SUM(i.month_plan) as total_plan,
        SUM(i.avl_stock) as total_stock,
        COUNT(DISTINCT i.product_id) as product_count,
        COUNT(DISTINCT i.branch_id) as branch_count
      FROM inventory i
    `;

    // Technology breakdown
    const techQuery = `
      SELECT 
        p.technology,
        SUM(i.billing) as sales,
        COUNT(DISTINCT p.id) as product_count
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      GROUP BY p.technology
    `;

    // Best selling product
    const bestSellingQuery = `
      SELECT 
        p.material,
        p.technology,
        SUM(i.billing) as total_sales
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      GROUP BY p.id, p.material, p.technology
      ORDER BY total_sales DESC
      LIMIT 1
    `;

    const [overallResult, techResult, bestSellingResult] = await Promise.all([
      pgPool.query(overallQuery),
      pgPool.query(techQuery),
      pgPool.query(bestSellingQuery)
    ]);

    const overall = overallResult.rows[0];
    const planAchievement = overall.total_plan > 0 
      ? Math.round((overall.total_sales / overall.total_plan) * 100)
      : 0;

    // Calculate technology percentages
    const totalTechSales = techResult.rows.reduce((sum, tech) => sum + parseInt(tech.sales), 0);
    const techBreakdown = techResult.rows.map(tech => ({
      ...tech,
      percentage: totalTechSales > 0 
        ? Math.round((parseInt(tech.sales) / totalTechSales) * 100)
        : 0
    }));

    res.json({
      summary: {
        totalSales: parseInt(overall.total_sales) || 0,
        totalPlan: parseInt(overall.total_plan) || 0,
        planAchievement,
        totalStock: parseInt(overall.total_stock) || 0,
        productCount: parseInt(overall.product_count) || 0,
        branchCount: parseInt(overall.branch_count) || 0,
        bestSellingProduct: bestSellingResult.rows[0],
        technologyBreakdown: techBreakdown
      }
    });

  } catch (error) {
    console.error('Error fetching executive summary:', error);
    res.status(500).json({
      error: 'Failed to fetch executive summary'
    });
  }
});

// Get actionable recommendations
router.get('/recommendations', authenticateToken, async (req, res) => {
  try {
    // Find underperforming branches
    const underperformingQuery = `
      SELECT 
        b.name,
        SUM(i.billing) as sales,
        SUM(i.month_plan) as plan,
        ROUND((SUM(i.billing)::numeric / NULLIF(SUM(i.month_plan), 0)) * 100, 2) as achievement
      FROM branches b
      JOIN inventory i ON b.id = i.branch_id
      GROUP BY b.id, b.name
      HAVING SUM(i.month_plan) > 0
      ORDER BY achievement ASC
      LIMIT 1
    `;

    // Find overstocked products
    const overstockedQuery = `
      SELECT 
        p.material,
        SUM(i.avl_stock) as stock,
        SUM(i.month_plan) as plan,
        SUM(i.billing) as sales
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      GROUP BY p.id, p.material
      HAVING SUM(i.avl_stock) > SUM(i.month_plan) * 1.5
      ORDER BY stock DESC
      LIMIT 1
    `;

    // Find products with supply gaps
    const supplyGapQuery = `
      SELECT 
        p.material,
        b.name as branch_name,
        i.month_plan - (i.avl_stock + i.transit) as gap
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
      WHERE i.month_plan > (i.avl_stock + i.transit)
      ORDER BY gap DESC
      LIMIT 1
    `;

    const [underperforming, overstocked, supplyGap] = await Promise.all([
      pgPool.query(underperformingQuery),
      pgPool.query(overstockedQuery),
      pgPool.query(supplyGapQuery)
    ]);

    const recommendations = [];

    if (underperforming.rows.length > 0) {
      const branch = underperforming.rows[0];
      recommendations.push({
        type: 'boost_underperforming',
        priority: 'high',
        title: 'Boost Underperforming Region',
        description: `Launch targeted sales initiative in ${branch.name} branch. It has the lowest achievement rate at ${branch.achievement}%.`,
        metrics: {
          branch: branch.name,
          achievement: `${branch.achievement}%`,
          sales: parseInt(branch.sales),
          plan: parseInt(branch.plan)
        }
      });
    }

    if (overstocked.rows.length > 0) {
      const product = overstocked.rows[0];
      recommendations.push({
        type: 'optimize_inventory',
        priority: 'medium',
        title: 'Optimize Inventory & Reduce Waste',
        description: `Reallocate stock of ${product.material}. This model has excess inventory with low sales velocity.`,
        metrics: {
          product: product.material,
          stock: parseInt(product.stock),
          plan: parseInt(product.plan),
          sales: parseInt(product.sales)
        }
      });
    }

    if (supplyGap.rows.length > 0) {
      const gap = supplyGap.rows[0];
      recommendations.push({
        type: 'address_supply_gap',
        priority: 'high',
        title: 'Address Supply Gaps',
        description: `Prioritize dispatch of ${gap.material} to ${gap.branch_name}. Supply gap of ${gap.gap} units needs immediate attention.`,
        metrics: {
          product: gap.material,
          branch: gap.branch_name,
          gap: parseInt(gap.gap)
        }
      });
    }

    res.json({
      recommendations
    });

  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({
      error: 'Failed to generate recommendations'
    });
  }
});

module.exports = router;
