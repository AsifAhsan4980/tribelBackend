const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const error = (res, message, statusCode = 500) =>
  res.status(statusCode).json({ success: false, message });

const paginated = (res, data, total, page, limit) =>
  res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    },
  });

module.exports = { success, error, paginated };
