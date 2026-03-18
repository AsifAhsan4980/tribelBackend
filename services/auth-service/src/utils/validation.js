const Joi = require('joi');

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  username: Joi.string().min(3).max(30).pattern(/^[a-zA-Z0-9_]+$/).required()
    .messages({
      'string.pattern.base': 'Username can only contain letters, numbers, and underscores',
    }),
  firstName: Joi.string().allow('', null).optional(),
  lastName: Joi.string().allow('', null).optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  email: Joi.string().email().required(),
  newPassword: Joi.string().min(8).required(),
});

const appleTokenSchema = Joi.object({
  idToken: Joi.string().required(),
  firstName: Joi.string().allow('', null).optional(),
  lastName: Joi.string().allow('', null).optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  appleTokenSchema,
};
