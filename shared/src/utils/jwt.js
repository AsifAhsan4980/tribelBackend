const jwt = require('jsonwebtoken');

const signAccessToken = (user) =>
  jwt.sign(
    { sub: user.id, email: user.email, role: user.role, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );

const signRefreshToken = (user, jti) =>
  jwt.sign(
    { sub: user.id, jti },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '30d' }
  );

const verifyToken = (token, secret) => jwt.verify(token, secret);

module.exports = { signAccessToken, signRefreshToken, verifyToken };
