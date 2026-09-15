/**
 * MarketPulse AI - Auth Helpers
 * Phase 4A - Vérification identité Firebase côté serveur
 *
 * Règle fondamentale:
 * - Firebase Auth unique source identité
 * - Utilisateur non authentifié ne peut pas appeler opérations sensibles
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

/**
 * Vérifie auth context callable
 * @param {object} request - Callable request
 * @returns {object} auth { uid, token }
 * @throws {HttpsError} unauthenticated
 */
function requireAuth(request) {
  if (!request.auth) {
    logger.warn('[Auth] Appel sans authentification');
    throw new HttpsError('unauthenticated', 'Authentification requise.');
  }
  if (!request.auth.uid) {
    logger.warn('[Auth] Auth sans uid');
    throw new HttpsError('unauthenticated', 'Contexte auth invalide.');
  }
  return request.auth;
}

/**
 * Vérifie propriétaire ressource
 * @param {string} authUid
 * @param {string} resourceUid
 * @throws {HttpsError} permission-denied
 */
function requireOwner(authUid, resourceUid) {
  if (authUid !== resourceUid) {
    logger.warn('[Auth] Accès non propriétaire', { authUid, resourceUid });
    throw new HttpsError('permission-denied', 'Accès non autorisé.');
  }
}

/**
 * Vérifie email vérifié (pour opérations sensibles Phase 4B+)
 * @param {object} auth - auth context
 * @throws {HttpsError} permission-denied si non vérifié
 */
function requireEmailVerified(auth) {
  if (!auth.token.email_verified) {
    logger.warn('[Auth] Email non vérifié', { uid: auth.uid });
    throw new HttpsError('permission-denied', 'Veuillez vérifier votre email.');
  }
}

module.exports = { requireAuth, requireOwner, requireEmailVerified };
