import jwt from 'jsonwebtoken';

/**
 * JWT utility functions for mobstep-chat
 * Uses a fixed secret key "mobstepchat" as requested
 */

const JWT_SECRET = 'mobstepchat';

/**
 * Create a JWT token with the given payload
 * @param {Object} payload - The token payload
 * @param {number} payload.application_id - Application ID
 * @param {string} payload.identifier - User identifier
 * @param {string|number} [payload.expiresIn] - Token expiration (default: '24h')
 * @returns {string} JWT token
 */
export function createToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * Verify and decode a JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded payload
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Create a token for chat widget usage
 * @param {number} applicationId - Application ID
 * @param {string} identifier - User identifier  
 * @param {string|number} [expiresIn] - Token expiration
 * @returns {string} JWT token
 */
export function createChatToken(applicationId, identifier, expiresIn = '24h') {
  return createToken({
    application_id: applicationId,
    identifier: identifier
  }, expiresIn);
}

// Export the secret key for reference (though it shouldn't be used directly in production)
export { JWT_SECRET };
