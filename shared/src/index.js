const { prisma } = require('./prisma');
const { authenticate, requireRole, requireOwnership } = require('./middleware/auth');
const { validate } = require('./middleware/validate');
const { errorHandler } = require('./middleware/errorHandler');
const { success, error, paginated } = require('./utils/response');
const { getUploadUrl, getDownloadUrl, deleteS3Object } = require('./utils/s3');
const { signAccessToken, signRefreshToken, verifyToken } = require('./utils/jwt');

module.exports = {
  prisma,
  authenticate,
  requireRole,
  requireOwnership,
  validate,
  errorHandler,
  success,
  error,
  paginated,
  getUploadUrl,
  getDownloadUrl,
  deleteS3Object,
  signAccessToken,
  signRefreshToken,
  verifyToken,
};
