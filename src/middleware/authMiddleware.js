import jwt from 'jsonwebtoken';

/* ================================
   AUTHENTICATE USER
================================ */

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn(`[Auth Middleware] Missing or invalid Authorization header: ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Unauthorized — no valid token provided' });
  }

  const token = authHeader.split(' ')[1];

  if (!process.env.JWT_SECRET) {
    console.error('[Auth Middleware] CRITICAL: JWT_SECRET is not set in environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach user to request (contains id and role)
    next();
  } catch (error) {
    console.warn(`[Auth Middleware] Token verification failed: ${error.message} — ${req.method} ${req.originalUrl}`);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/* ================================
   ROLE AUTHORIZATION
================================ */

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      console.warn(`[Auth Middleware] No user role found on request: ${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: 'Access denied: no role found' });
    }

    if (!roles.includes(req.user.role)) {
      console.warn(`[Auth Middleware] Role "${req.user.role}" denied for: ${req.method} ${req.originalUrl} (requires: ${roles.join(', ')})`);
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
};
