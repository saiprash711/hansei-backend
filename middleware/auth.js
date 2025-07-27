// middleware/auth.js

const jwt = require('jsonwebtoken');

/**
 * Middleware to verify the JWT token from the Authorization header.
 * If the token is valid, it attaches the user payload to the request object.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'hansei-secret-key-2025', (err, user) => {
    if (err) {
      // Differentiate between an expired token and an invalid one for better client-side handling
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Unauthorized: Token has expired.' });
      }
      return res.status(403).json({ error: 'Forbidden: Invalid token.' });
    }
    req.user = user; // Attach user payload to the request
    next();
  });
}

/**
 * Middleware to authorize based on user role.
 * This is a higher-order function that takes a role and returns a middleware.
 * @param {string} role - The role required to access the route (e.g., 'smart_user').
 */
function authorizeRole(role) {
  return (req, res, next) => {
    // This middleware should run *after* authenticateToken, so req.user will be available.
    if (req.user && req.user.role === role) {
      next(); // User has the correct role, proceed to the next middleware/handler.
    } else {
      res.status(403).json({ error: 'Forbidden: You do not have the required permissions.' });
    }
  };
}

// --- IMPORTANT ---
// Both functions must be exported from the module.
module.exports = {
  authenticateToken,
  authorizeRole
};
