const Joi = require('joi');

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  username: Joi.string().min(3).max(30).required(),
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
  appleTokenSchema,
};
