const errorHandler = (err, req, res, _next) => {
  console.error(`[${req.method}] ${req.path} →`, err.message);

  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'Resource already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
};

module.exports = { errorHandler };
