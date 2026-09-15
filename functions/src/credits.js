/**
 * MarketPulse AI - Credits Debit Sécurisé + Remboursement
 * Phase 4B.2 - Débit atomique + remboursement idempotent
 *
 * IMPORTANT:
 * - Transaction Firestore obligatoire
 * - Pas de solde négatif possible
 * - Concurrence gérée par transaction
 * - UID depuis Firebase Auth uniquement
 * - Source canonique PRO: users/{uid}.plan (free/pro), pas isPro parallèle
 * - Remboursement idempotent: même generationId ne peut recevoir deux remboursements
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function getDb() {
  return getFirestore();
}

/**
 * Vérifie si user est PRO - source canonique plan
 * @param {object} userData
 * @returns {boolean}
 */
function isUserPro(userData) {
  // Source canonique: plan == 'pro'
  if (userData.plan === 'pro') return true;
  // Fallback legacy: isPro true (pour compatibilité Phase 3B, mais plan reste canonique)
  if (userData.isPro === true) return true;
  return false;
}

/**
 * Débit sécurisé 1 crédit avec transaction atomique
 * @param {string} uid - UID Firebase Auth
 * @param {object} options - { reason, metadata, generationId }
 * @returns {Promise<{newBalance, transactionId, isPro, previousBalance}>}
 */
async function debitCreditAdmin(uid, options = {}) {
  const { reason = 'generation', metadata = {}, generationId = null } = options;
  const db = getDb();

  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'UID invalide.');
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        logger.warn('[Credits] Profil non trouvé', { uid });
        throw new HttpsError('not-found', 'Profil utilisateur non trouvé.');
      }

      const userData = userSnap.data();
      const isPro = isUserPro(userData);

      // PRO users: pas de débit, crédits illimités - plan est source canonique
      if (isPro) {
        logger.info('[Credits] User PRO (plan=pro) - pas de débit', { uid, plan: userData.plan });
        return {
          newBalance: userData.credits ?? 100,
          transactionId: null,
          isPro: true,
          previousBalance: userData.credits ?? 0,
        };
      }

      const currentCredits = typeof userData.credits === 'number' ? userData.credits : 0;

      if (currentCredits < 1) {
        logger.warn('[Credits] Solde insuffisant', { uid, currentCredits });
        throw new HttpsError(
          'failed-precondition',
          'Crédits insuffisants. Rechargez vos crédits.',
          { code: 'INSUFFICIENT_CREDITS', currentCredits }
        );
      }

      const newBalance = currentCredits - 1;

      if (newBalance < 0) {
        logger.error('[Credits] Tentative solde négatif bloquée', { uid, currentCredits, newBalance });
        throw new HttpsError('failed-precondition', 'Solde insuffisant.', {
          code: 'INSUFFICIENT_CREDITS',
        });
      }

      const txRef = userRef.collection('creditTransactions').doc();

      transaction.update(userRef, {
        credits: newBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const txData = {
        createdAt: FieldValue.serverTimestamp(),
        type: 'generation',
        amount: -1,
        balanceAfter: newBalance,
        balanceBefore: currentCredits,
        uid: uid,
        reason: reason,
        source: 'debitCredit',
        metadata: metadata,
        createdBy: 'system',
        version: '4B.2',
      };

      // Ajout generationId si fourni (pour traçabilité idempotence)
      if (generationId) {
        txData.generationId = generationId;
      }

      transaction.set(txRef, txData);

      logger.info('[Credits] Débit réussi', {
        uid,
        previousBalance: currentCredits,
        newBalance,
        transactionId: txRef.id,
        generationId,
      });

      return {
        newBalance,
        transactionId: txRef.id,
        isPro: false,
        previousBalance: currentCredits,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;

    logger.error('[Credits] Erreur transaction débit', {
      uid,
      error: err.message,
      stack: err.stack,
    });

    if (err.message && err.message.includes('Crédits insuffisants')) {
      throw new HttpsError('failed-precondition', 'Crédits insuffisants.', {
        code: 'INSUFFICIENT_CREDITS',
      });
    }

    throw new HttpsError('internal', 'Erreur interne lors du débit de crédits.', {
      originalError: err.message,
    });
  }
}

/**
 * Remboursement sécurisé idempotent +1 crédit
 * Même generationId ne doit jamais recevoir deux remboursements
 *
 * @param {string} uid
 * @param {string} generationId - ID génération pour idempotence
 * @param {string} reason - Raison remboursement
 * @returns {Promise<{newBalance, transactionId, alreadyRefunded}>}
 */
async function refundCreditAdmin(uid, generationId, reason = 'gemini_failure') {
  const db = getDb();

  if (!uid || !generationId) {
    throw new HttpsError('invalid-argument', 'UID et generationId requis pour remboursement.');
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        logger.warn('[Credits] Profil non trouvé pour remboursement', { uid });
        throw new HttpsError('not-found', 'Profil utilisateur non trouvé.');
      }

      // Vérifier si remboursement déjà existe pour ce generationId (idempotence)
      const existingRefundQuery = await db
        .collection('users')
        .doc(uid)
        .collection('creditTransactions')
        .where('generationId', '==', generationId)
        .where('type', '==', 'generation_refund')
        .limit(1)
        .get();

      // Note: Firestore transaction ne peut pas faire de query where dans transaction?
      // Pour idempotence, on fait query hors transaction puis vérifie dans transaction avec get sur doc spécifique
      // Mais pour Phase 4B.2, on utilise approche: chercher doc refund avec ID déterministe
      // ID déterministe: refund_{generationId}

      const refundDocId = `refund_${generationId}`;
      const refundRef = userRef.collection('creditTransactions').doc(refundDocId);
      const refundSnap = await transaction.get(refundRef);

      if (refundSnap.exists) {
        const existingData = refundSnap.data();
        logger.info('[Credits] Remboursement déjà existant (idempotence)', {
          uid,
          generationId,
          existingRefundId: refundDocId,
        });
        return {
          newBalance: existingData.balanceAfter,
          transactionId: refundDocId,
          alreadyRefunded: true,
          previousBalance: existingData.balanceBefore,
        };
      }

      const userData = userSnap.data();
      const currentCredits = typeof userData.credits === 'number' ? userData.credits : 0;
      const newBalance = currentCredits + 1;

      // Sécurité: plafond 100 crédits? On respecte pas de plafond strict pour remboursement, mais on log si >100
      if (newBalance > 100) {
        logger.warn('[Credits] Remboursement dépasse 100 crédits (autorisé pour remboursement)', {
          uid,
          currentCredits,
          newBalance,
        });
      }

      transaction.update(userRef, {
        credits: newBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(refundRef, {
        createdAt: FieldValue.serverTimestamp(),
        type: 'generation_refund',
        amount: +1,
        balanceAfter: newBalance,
        balanceBefore: currentCredits,
        uid: uid,
        generationId: generationId,
        reason: reason,
        source: 'secureGenerateCampaign',
        createdBy: 'system',
        version: '4B.2',
      });

      logger.info('[Credits] Remboursement réussi', {
        uid,
        generationId,
        previousBalance: currentCredits,
        newBalance,
        transactionId: refundDocId,
        reason,
      });

      return {
        newBalance,
        transactionId: refundDocId,
        alreadyRefunded: false,
        previousBalance: currentCredits,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;

    logger.error('[Credits] Erreur transaction remboursement', {
      uid,
      generationId,
      error: err.message,
      stack: err.stack,
    });

    throw new HttpsError('internal', 'Erreur interne lors du remboursement.', {
      originalError: err.message,
    });
  }
}

/**
 * Vérifie solde sans débiter
 * @param {string} uid
 * @returns {Promise<{credits, rawCredits, isPro, hasEnough}>}
 */
async function checkBalanceAdmin(uid) {
  const db = getDb();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'Profil utilisateur non trouvé.');
  }

  const userData = userSnap.data();
  const isPro = isUserPro(userData);
  const credits = typeof userData.credits === 'number' ? userData.credits : 0;

  return {
    credits: isPro ? Infinity : credits,
    rawCredits: credits,
    isPro,
    hasEnough: isPro || credits >= 1,
    plan: userData.plan || 'free',
  };
}

module.exports = { debitCreditAdmin, refundCreditAdmin, checkBalanceAdmin, isUserPro };
