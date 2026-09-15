/**
 * MarketPulse AI - Firebase Auth Errors Translation
 * Phase 2B: Traduction erreurs Firebase vers messages utilisateur FR
 * 
 * Fournit toUserMessage(error) demandé dans spec Phase 2B
 * Réutilise translateFirebaseAuthError depuis auth.js
 */

import { translateFirebaseAuthError } from './auth.js';

/**
 * Traduit erreur Firebase vers message utilisateur compréhensible (FR)
 * @param {Error|Object} error - Erreur Firebase
 * @returns {string} Message FR
 */
export function toUserMessage(error) {
  return translateFirebaseAuthError(error);
}

/**
 * Alias pour compatibilité
 */
export function toUserFriendlyMessage(error) {
  return translateFirebaseAuthError(error);
}

// Re-export pour façade
export { translateFirebaseAuthError };
