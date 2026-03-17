const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  next();
};

const requireOwnership = (getOwnerId) => async (req, res, next) => {
  try {
    if (req.user.role === 'Admin') return next();
    const ownerId = typeof getOwnerId === 'function' ? await getOwnerId(req) : req.params.userId;
    if (req.user.sub !== ownerId) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this resource' });
    }
    next();
  } catch {
    return res.status(403).json({ success: false, message: 'Authorization check failed' });
  }
};

module.exports = { authenticate, requireRole, requireOwnership };
