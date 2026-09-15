/**
 * MarketPulse AI - Idempotence Générations
 * Phase 4B.2 - Gestion idempotence avec generationId
 *
 * Structure: users/{uid}/generations/{generationId}
 * {
 *   generationId,
 *   uid,
 *   status: "processing" | "completed" | "failed",
 *   createdAt,
 *   updatedAt,
 *   transactionId,
 *   campaignId,
 *   errorCode,
 *   params: { brand, target, tone, lang, offer, preset }
 * }
 *
 * Stratégie idempotence:
 * - Même generationId ne doit JAMAIS provoquer deux débits
 * - completed: retourner résultat déjà généré sans nouveau débit
 * - processing: ne pas débiter à nouveau, retourner état processing
 * - failed: autoriser nouvelle tentative seulement si ancien débit remboursé, sans réutiliser aveuglément ancienne transaction
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function getDb() {
  return getFirestore();
}

/**
 * Récupère génération existante
 * @param {string} uid
 * @param {string} generationId
 * @returns {Promise<object|null>} génération ou null
 */
async function getGeneration(uid, generationId) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('generations').doc(generationId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Crée génération avec status processing (idempotence)
 * @param {string} uid
 * @param {string} generationId
 * @param {object} params - { brand, target, tone, lang, offer, preset }
 * @returns {Promise<object>} génération créée
 * @throws {HttpsError} si déjà existe avec status completed/processing
 */
async function createGenerationProcessing(uid, generationId, params) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('generations').doc(generationId);

  // Transaction pour vérifier existence atomiquement
  const result = await db.runTransaction(async (transaction) => {
    const existingSnap = await transaction.get(docRef);

    if (existingSnap.exists) {
      const existing = existingSnap.data();
      const status = existing.status;

      if (status === 'completed') {
        // Déjà complétée - ne pas recréer, retourner existante pour idempotence
        logger.info('[Generations] Generation déjà completed, idempotence', { uid, generationId });
        return { alreadyExists: true, status: 'completed', data: existing };
      }

      if (status === 'processing') {
        // Déjà en cours - vérifier âge
        const createdAt = existing.createdAt?.toDate ? existing.createdAt.toDate() : new Date(existing.createdAt);
        const now = new Date();
        const ageMinutes = (now - createdAt) / 1000 / 60;

        // Phase 4B.2-FIX: seuil 10 minutes (Functions timeout 120s, donc 10min = abandonné)
        if (ageMinutes < 10) {
          // Moins de 10 minutes - considérer comme toujours en cours
          logger.info('[Generations] Generation déjà processing (<10min), idempotence', { uid, generationId, ageMinutes });
          return { alreadyExists: true, status: 'processing', data: existing, ageMinutes, transactionId: existing.transactionId || null, isStale: false };
        } else {
          // Plus de 10 minutes - considérée comme bloquée/abandonnée, autorise recovery avec refund
          // Phase 4B.2-FIX: ne pas simplement écraser, le caller doit d'abord rembourser si débit existe
          logger.warn('[Generations] Generation processing >10min, considérée comme bloquée/stale, autorise recovery', {
            uid,
            generationId,
            ageMinutes,
            transactionId: existing.transactionId || null,
          });
          // Retourner stale pour que secureGenerateCampaign fasse refund idempotent puis retry
          return { alreadyExists: true, status: 'processing', data: existing, ageMinutes, transactionId: existing.transactionId || null, isStale: true };
        }
      }

      if (status === 'failed') {
        // Échouée - autoriser nouvelle tentative
        // Vérifier que remboursement a été fait si débit avait eu lieu
        logger.info('[Generations] Generation failed, autorise retry', { uid, generationId });
        // On va écraser avec nouveau processing
      }
    }

    // Créer ou écraser avec processing
    // Phase 4B.2-FIX: version mise à jour
    const newDoc = {
      generationId,
      uid,
      status: 'processing',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      transactionId: null,
      campaignId: null,
      errorCode: null,
      errorMessage: null,
      params: {
        brand: params.brand,
        target: params.target,
        tone: params.tone,
        lang: params.lang,
        offer: params.offer,
        preset: params.preset || null,
      },
      version: '4B.2-FIX',
    };

    transaction.set(docRef, newDoc);
    return { alreadyExists: false, status: 'processing', data: newDoc };
  });

  return result;
}

/**
 * Met à jour génération avec transactionId après débit
 * @param {string} uid
 * @param {string} generationId
 * @param {string} transactionId
 */
async function updateGenerationWithTransaction(uid, generationId, transactionId) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('generations').doc(generationId);
  await docRef.update({
    transactionId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info('[Generations] Updated with transactionId', { uid, generationId, transactionId });
}

/**
 * Marque génération comme completed avec campaignId
 * @param {string} uid
 * @param {string} generationId
 * @param {string} campaignId
 * @param {string} transactionId
 */
async function markGenerationCompleted(uid, generationId, campaignId, transactionId = null) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('generations').doc(generationId);
  const updateData = {
    status: 'completed',
    campaignId,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (transactionId) {
    updateData.transactionId = transactionId;
  }
  await docRef.update(updateData);
  logger.info('[Generations] Marked completed', { uid, generationId, campaignId });
}

/**
 * Marque génération comme failed avec errorCode
 * @param {string} uid
 * @param {string} generationId
 * @param {string} errorCode
 * @param {string} errorMessage
 */
async function markGenerationFailed(uid, generationId, errorCode, errorMessage = null) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('generations').doc(generationId);
  await docRef.update({
    status: 'failed',
    errorCode,
    errorMessage: errorMessage ? errorMessage.substring(0, 500) : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info('[Generations] Marked failed', { uid, generationId, errorCode });
}

/**
 * Phase 4B.2-FIX: Marque génération stale comme failed STALE_RECOVERED
 * Utilisé après refund idempotent pour permettre nouvelle tentative propre
 * @param {string} uid
 * @param {string} generationId
 * @param {number} ageMinutes
 */
async function markGenerationRecovered(uid, generationId, ageMinutes) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('generations').doc(generationId);
  await docRef.update({
    status: 'failed',
    errorCode: 'STALE_RECOVERED',
    errorMessage: `Stale processing recovered after ${Math.round(ageMinutes)}min - refunded if debit existed, allows new generation`,
    recoveredAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info('[Generations] Marked STALE_RECOVERED', { uid, generationId, ageMinutes });
}

/**
 * Phase 4B.2-FIX: Force création nouvelle génération après recovery
 * Écrase l'ancienne entrée stale par un nouveau processing propre
 * @param {string} uid
 * @param {string} generationId
 * @param {object} params
 * @returns {Promise<object>} nouvelle génération processing
 */
async function forceCreateGenerationProcessing(uid, generationId, params) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('generations').doc(generationId);

  const newDoc = {
    generationId,
    uid,
    status: 'processing',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    transactionId: null,
    campaignId: null,
    errorCode: null,
    errorMessage: null,
    params: {
      brand: params.brand,
      target: params.target,
      tone: params.tone,
      lang: params.lang,
      offer: params.offer,
      preset: params.preset || null,
    },
    version: '4B.2-FIX',
    recoveredFromStale: true,
  };

  await docRef.set(newDoc);
  logger.info('[Generations] Force created after stale recovery', { uid, generationId });
  return { alreadyExists: false, status: 'processing', data: newDoc };
}

/**
 * Récupère campagne associée à génération completed
 * @param {string} uid
 * @param {string} campaignId
 * @returns {Promise<object|null>}
 */
async function getCampaignById(uid, campaignId) {
  const db = getDb();
  const docRef = db.collection('users').doc(uid).collection('campaigns').doc(campaignId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

module.exports = {
  getGeneration,
  createGenerationProcessing,
  updateGenerationWithTransaction,
  markGenerationCompleted,
  markGenerationFailed,
  markGenerationRecovered,
  forceCreateGenerationProcessing,
  getCampaignById,
};
