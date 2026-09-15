/**
 * MarketPulse AI - Firestore Admin Helpers
 * Phase 4A - Accès serveur Firestore via Admin SDK
 *
 * IMPORTANT:
 * - Admin SDK jamais dans frontend
 * - Bypass rules (admin) mais vérifications auth côté serveur obligatoires
 */

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

function getDb() {
  return getFirestore();
}

/**
 * Récupère profil utilisateur côté serveur
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
async function getUserProfileAdmin(uid) {
  try {
    const db = getDb();
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  } catch (err) {
    logger.error('[Firestore Admin] getUserProfile error', { uid, error: err.message });
    throw new HttpsError('internal', 'Erreur lecture profil.');
  }
}

/**
 * Vérifie crédits suffisants (lecture seule Phase 4A, débit Phase 4B)
 * @param {string} uid
 * @param {number} required
 * @returns {Promise<{hasEnough: boolean, currentCredits: number, isPro: boolean}>}
 */
async function checkCreditsAdmin(uid, required = 1) {
  const profile = await getUserProfileAdmin(uid);
  if (!profile) {
    throw new HttpsError('not-found', 'Profil utilisateur non trouvé.');
  }

  if (profile.isPro) {
    return { hasEnough: true, currentCredits: Infinity, isPro: true, profile };
  }

  const current = profile.credits ?? 0;
  return {
    hasEnough: current >= required,
    currentCredits: current,
    isPro: false,
    profile,
  };
}

module.exports = { getDb, getUserProfileAdmin, checkCreditsAdmin, FieldValue };
