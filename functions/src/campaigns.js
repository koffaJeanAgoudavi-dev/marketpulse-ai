/**
 * MarketPulse AI - Campaigns Firestore
 * Phase 4B.2 - Sauvegarde campagne après succès Gemini
 *
 * Structure: users/{uid}/campaigns/{campaignId}
 * Compatible avec history.js existant
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function getDb() {
  return getFirestore();
}

/**
 * Génère ID campagne unique
 * @returns {string} campaignId
 */
function generateCampaignId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `cmp_${timestamp}_${random}`;
}

/**
 * Sauvegarde campagne dans Firestore
 * @param {string} uid
 * @param {object} campaignData - { brand, target, tone, lang, offer, preset, hooks, post, email, imagePrompt, generationId, wordCount }
 * @returns {Promise<{campaignId, campaign}>}
 */
async function saveCampaignAdmin(uid, campaignData) {
  const db = getDb();

  if (!uid) {
    throw new HttpsError('invalid-argument', 'UID requis pour sauvegarde campagne.');
  }

  const {
    brand,
    target,
    tone,
    lang,
    offer,
    preset,
    hooks,
    post,
    email,
    imagePrompt,
    generationId,
    wordCount,
  } = campaignData;

  const campaignId = campaignData.campaignId || generateCampaignId();

  const docData = {
    id: campaignId,
    userId: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    brand: brand || '',
    target: target || '',
    tone: tone || '',
    lang: lang || 'Français 🇫🇷',
    offer: offer || '',
    preset: preset || null,
    hooks: Array.isArray(hooks) ? hooks : [],
    post: post || '',
    email: email || { subject: '', body: '' },
    // Compatibilité history.js: email peut être string ou objet
    // On garde objet pour nouveau format, mais aussi champ emailText pour compat?
    emailSubject: email?.subject || '',
    emailBody: email?.body || '',
    imagePrompt: imagePrompt || '',
    imageUrl: null, // Pas de génération image Phase 4B.2
    source: 'gemini',
    generationId: generationId || null,
    wordCount: typeof wordCount === 'number' ? wordCount : (post?.length || 0) + (email?.body?.length || 0),
    schemaVersion: 2, // Version 2 pour Gemini
    version: '4B.2',
  };

  try {
    const docRef = db.collection('users').doc(uid).collection('campaigns').doc(campaignId);
    await docRef.set(docData);

    // Met à jour stats utilisateur (totalCampaigns, totalWords) - optionnel, non bloquant
    try {
      const userRef = db.collection('users').doc(uid);
      await userRef.update({
        'stats.totalCampaigns': FieldValue.increment(1),
        'stats.totalWords': FieldValue.increment(docData.wordCount),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (statsErr) {
      logger.warn('[Campaigns] Erreur update stats (non bloquant)', {
        uid,
        campaignId,
        error: statsErr.message,
      });
    }

    logger.info('[Campaigns] Campagne sauvegardée', { uid, campaignId, generationId, source: 'gemini' });

    // Retourne campagne avec createdAt résolu pour frontend
    const savedSnap = await docRef.get();
    const savedData = savedSnap.exists ? savedSnap.data() : docData;

    return {
      campaignId,
      campaign: {
        id: campaignId,
        ...savedData,
        // Pour compatibilité frontend, on s'assure que post et email existent
        post: savedData.post,
        email: savedData.email,
      },
    };
  } catch (err) {
    logger.error('[Campaigns] Erreur sauvegarde campagne', {
      uid,
      campaignId,
      generationId,
      error: err.message,
      stack: err.stack,
    });
    throw new HttpsError('internal', 'Erreur sauvegarde campagne.', {
      originalError: err.message,
    });
  }
}

module.exports = { generateCampaignId, saveCampaignAdmin };
