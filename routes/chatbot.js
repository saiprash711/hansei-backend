// routes/chatbot.js
const express = require('express');
const router = express.Router();
const { pgPool, ChatLog } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Chatbot query endpoint
router.post('/query', authenticateToken, async (req, res) => {
  try {
    const { message, sessionId = uuidv4() } = req.body;
    
    if (!message) {
      return res.status(400).json({
        error: 'Message is required'
      });
    }

    // Process the query and generate response
    const response = await processQuery(message.toLowerCase());

    // --- START OF FIX ---
    // Log the conversation but DO NOT let it block the user's response.
    // If the database connection fails, we will log it to the console
    // but the user will still get their answer.
    try {
      await new ChatLog({
        userId: req.user.id,
        message,
        response,
        sessionId
      }).save();
    } catch (dbError) {
      console.error('Chatbot DB logging error:', dbError.message);
      // We don't send an error response here because the main query was successful.
    }
    // --- END OF FIX ---

    res.json({
      response,
      sessionId
    });

  } catch (error) {
    // This will now only catch errors from processQuery, not the database logging.
    console.error('Chatbot query processing error:', error);
    res.status(500).json({
      error: 'Failed to process query'
    });
  }
});

// Process chatbot queries
async function processQuery(query) {
  // Greetings
  if (query.includes('hello') || query.includes('hi')) {
    return 'Hello! I\'m the Hansei AI assistant. How can I help you with the sales data today?';
  }

  // Help
  if (query.includes('help') || query.includes('command')) {
    return `You can ask me things like:
- What is the total stock?
- How many products are there?
- Tell me about branch performance
- What are the critical alerts?
- Show me the top selling products
- What's the plan achievement rate?`;
  }

  // Total sales
  if (query.includes('total sales') || query.includes('revenue')) {
    const result = await pgPool.query('SELECT SUM(billing) as total FROM inventory');
    const totalSales = parseInt(result.rows[0].total) || 0;
    return `The total sales billing across all branches is ${totalSales.toLocaleString()} units.`;
  }

  // Total stock
  if (query.includes('total stock') || query.includes('inventory')) {
    const result = await pgPool.query('SELECT SUM(avl_stock) as total FROM inventory');
    const totalStock = parseInt(result.rows[0].total) || 0;
    return `The total available stock across all branches is ${totalStock.toLocaleString()} units.`;
  }

  // Product count
  if (query.includes('products') || query.includes('models')) {
    const result = await pgPool.query('SELECT COUNT(*) as count FROM products');
    const techResult = await pgPool.query(
      'SELECT technology, COUNT(*) as count FROM products GROUP BY technology'
    );
    
    const productCount = parseInt(result.rows[0].count);
    const techBreakdown = techResult.rows
      .map(t => `${t.count} ${t.technology}`)
      .join(', ');
    
    return `We are tracking ${productCount} different product models: ${techBreakdown}.`;
  }

  // Branch information
  if (query.includes('branch') || query.includes('cities')) {
    const result = await pgPool.query('SELECT name FROM branches ORDER BY name');
    const branches = result.rows.map(b => b.name).join(', ');
    return `We are monitoring ${result.rows.length} branches: ${branches}. Which branch are you interested in?`;
  }

  // Specific branch queries
  if (query.includes('chennai')) {
    const result = await pgPool.query(`
      SELECT SUM(i.avl_stock) as stock, SUM(i.billing) as sales
      FROM inventory i
      JOIN branches b ON i.branch_id = b.id
      WHERE b.name = 'Chennai'
    `);
    const data = result.rows[0];
    return `Chennai currently has ${parseInt(data.stock).toLocaleString()} units in stock and has achieved ${parseInt(data.sales).toLocaleString()} units in sales.`;
  }

  if (query.includes('bangalore')) {
    const result = await pgPool.query(`
      SELECT SUM(i.avl_stock) as stock, SUM(i.billing) as sales
      FROM inventory i
      JOIN branches b ON i.branch_id = b.id
      WHERE b.name = 'Bangalore'
    `);
    const data = result.rows[0];
    return `Bangalore currently has ${parseInt(data.stock).toLocaleString()} units in stock and has achieved ${parseInt(data.sales).toLocaleString()} units in sales.`;
  }

  // Critical alerts
  if (query.includes('critical') || query.includes('alert')) {
    const result = await pgPool.query(`
      SELECT p.material, i.month_plan 
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.avl_stock = 0 AND i.month_plan > 0
      LIMIT 3
    `);
    
    if (result.rows.length > 0) {
      const alerts = result.rows
        .map(a => `${a.material} (plan: ${a.month_plan})`)
        .join(', ');
      return `Yes, there are ${result.rows.length} critical stock-out alerts for: ${alerts}`;
    }
    return 'Good news! There are currently no critical stock alerts.';
  }

  // Plan achievement
  if (query.includes('plan achievement') || query.includes('performance')) {
    const result = await pgPool.query(`
      SELECT 
        SUM(billing) as total_billing,
        SUM(month_plan) as total_plan
      FROM inventory
    `);
    
    const billing = parseInt(result.rows[0].total_billing) || 0;
    const plan = parseInt(result.rows[0].total_plan) || 0;
    const achievement = plan > 0 ? Math.round((billing / plan) * 100) : 0;
    
    return `The overall plan achievement rate is ${achievement}%. Total billing: ${billing.toLocaleString()} units against a plan of ${plan.toLocaleString()} units.`;
  }

  // Top selling products
  if (query.includes('top selling') || query.includes('best selling')) {
    const result = await pgPool.query(`
      SELECT p.material, SUM(i.billing) as total_sales
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      GROUP BY p.id, p.material
      ORDER BY total_sales DESC
      LIMIT 3
    `);
    
    const topProducts = result.rows
      .map(p => `${p.material} (${parseInt(p.total_sales).toLocaleString()} units)`)
      .join(', ');
    
    return `The top 3 selling products are: ${topProducts}`;
  }

  // Technology breakdown
  if (query.includes('inverter') || query.includes('technology')) {
    const result = await pgPool.query(`
      SELECT 
        p.technology,
        COUNT(DISTINCT p.id) as product_count,
        SUM(i.avl_stock) as total_stock
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      GROUP BY p.technology
    `);
    
    const techInfo = result.rows
      .map(t => `${t.technology}: ${t.product_count} products with ${parseInt(t.total_stock).toLocaleString()} units`)
      .join('. ');
    
    return `Technology breakdown - ${techInfo}`;
  }

  // Low stock
  if (query.includes('low stock') || query.includes('shortage')) {
    const result = await pgPool.query(`
      SELECT 
        p.material,
        b.name as branch,
        i.avl_stock,
        i.month_plan
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
      WHERE i.avl_stock < i.month_plan * 0.2
        AND i.month_plan > 0
      ORDER BY (i.avl_stock::float / i.month_plan) ASC
      LIMIT 3
    `);
    
    if (result.rows.length > 0) {
      const shortages = result.rows
        .map(s => `${s.material} at ${s.branch} (only ${s.avl_stock} units)`)
        .join(', ');
      return `Low stock alerts: ${shortages}. These products need immediate restocking.`;
    }
    return 'All products have adequate stock levels.';
  }

  // About Hansei
  if (query.includes('hansei') || query.includes('who are you')) {
    return 'I am an AI assistant for the Hansei Intelligence Portal. I can help you analyze sales data, check inventory levels, and provide insights about branch performance. I have access to real-time data across all branches and products.';
  }

  // Default response
  return 'I\'m not sure how to answer that. Please try asking about sales, stock, products, branches, or type "help" for a list of commands.';
}

// Get chat history
router.get('/history/:sessionId?', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const query = sessionId 
      ? { userId: req.user.id, sessionId }
      : { userId: req.user.id };
    
    const chats = await ChatLog
      .find(query)
      .sort({ timestamp: -1 })
      .limit(50);

    res.json({
      history: chats
    });

  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({
      error: 'Failed to fetch chat history'
    });
  }
});

module.exports = router;
