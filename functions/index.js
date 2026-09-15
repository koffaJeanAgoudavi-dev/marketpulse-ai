/**
 * MarketPulse AI - Cloud Functions
 * Phase 4B.2 - Génération sécurisée Gemini + idempotence + remboursement automatique
 *
 * OBJECTIF Phase 4B.2:
 * - secureGenerateCampaign callable sécurisée
 * - Idempotence via generationId (users/{uid}/generations/{generationId})
 * - Débit sécurisé atomique + remboursement automatique si Gemini échoue
 * - Gemini côté serveur uniquement via Secrets Manager
 * - Sauvegarde campagne Firestore compatible history.js
 *
 * NE PAS implémenter Phase 4B.2:
 * - Chariow, paiement, activation PRO, bonus referral, images, Storage
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

// ==================== INITIALISATION ADMIN SDK ====================
initializeApp();
const db = getFirestore();
const auth = getAuth();
logger.info('[Functions] Admin SDK initialisé - Phase 4B.2-ENV');

// ==================== ENV CONFIG ====================
// GEMINI_API_KEY via process.env.GEMINI_API_KEY
// Architecture: GitHub Secret GEMINI_API_KEY -> GitHub Actions -> functions/.env temporaire -> process.env
// Déploiement: GitHub Actions crée functions/.env depuis secret GitHub, jamais commité
// Local emulator: functions/.env ou .env.local avec GEMINI_API_KEY

// Future secrets Phase 4C (seront aussi via process.env ou Secret Manager si facturation activée)
const futureSecrets = {
  // CHARIOW_API_KEY sera défini Phase 4C via GitHub Secret ou Secret Manager
  // CHARIOW_WEBHOOK_SECRET sera défini Phase 4C
};

// ==================== HELPERS AUTH ====================
function requireAuth(request) {
  if (!request.auth) {
    logger.warn('[Auth] Tentative appel sans authentification', { hasAuth: !!request.auth });
    throw new HttpsError('unauthenticated', 'Authentification requise. Veuillez vous connecter avec Firebase Auth.');
  }
  if (!request.auth.uid) {
    logger.warn('[Auth] Auth context sans uid');
    throw new HttpsError('unauthenticated', 'Contexte authentification invalide.');
  }
  return request.auth;
}

function requireOwner(authUid, resourceUid) {
  if (authUid !== resourceUid) {
    logger.warn('[Auth] Tentative accès ressource non propriétaire', { authUid, resourceUid });
    throw new HttpsError('permission-denied', 'Accès non autorisé à cette ressource.');
  }
}

async function getUserProfileAdmin(uid) {
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  } catch (err) {
    logger.error('[Firestore Admin] Erreur getUserProfile', { uid, error: err.message });
    throw new HttpsError('internal', 'Erreur lecture profil utilisateur.');
  }
}

// ==================== IMPORTS MODULES PHASE 4B ====================
const { debitCreditAdmin, refundCreditAdmin, checkBalanceAdmin, isUserPro } = require('./src/credits');
const { validateGenerationParams, validateGeminiOutput } = require('./src/validation');
const {
  getGeneration,
  createGenerationProcessing,
  updateGenerationWithTransaction,
  markGenerationCompleted,
  markGenerationFailed,
  markGenerationRecovered,
  forceCreateGenerationProcessing,
  getCampaignById,
} = require('./src/generations');
const { saveCampaignAdmin } = require('./src/campaigns');
const { generateCampaignWithGemini } = require('./src/gemini');

// ==================== FONCTIONS FONDATION PHASE 4A ====================

exports.healthCheck = onCall(
  { memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    try {
      const authContext = requireAuth(request);
      const uid = authContext.uid;
      const email = authContext.token.email || null;
      const emailVerified = authContext.token.email_verified || false;
      logger.info('[healthCheck] Appel authentifié', { uid, email, emailVerified });

      let profileExists = false;
      try {
        const profileData = await getUserProfileAdmin(uid);
        profileExists = !!profileData;
      } catch (err) {
        logger.warn('[healthCheck] Profil non trouvé', { uid, error: err.message });
      }

      return {
        status: 'ok',
        phase: '4B.2-ENV-foundation',
        timestamp: FieldValue.serverTimestamp(),
        auth: { uid, email, emailVerified },
        firestore: { adminInitialized: true, profileExists, hasProfile: profileExists },
        backend: { version: '4B.2-ENV.0', nodeVersion: process.version, environment: process.env.FUNCTIONS_EMULATOR ? 'emulator' : 'production' },
        message: 'Backend Phase 4B.2-ENV opérationnel - debitCredit + secureGenerateCampaign via process.env.GEMINI_API_KEY',
        endpoints: {
          healthCheck: 'Callable auth - test backend',
          getBackendInfo: 'HTTP GET public',
          debitCredit: 'Callable auth - débit 1 crédit atomique',
          checkCredits: 'Callable auth - lecture solde',
          secureGenerateCampaign: 'Callable auth + GEMINI_API_KEY env + idempotence + refund',
        },
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error('[healthCheck] Erreur interne', { error: err.message, stack: err.stack });
      throw new HttpsError('internal', 'Erreur interne healthCheck.');
    }
  }
);

exports.getBackendInfo = onRequest(
  { memory: '128MiB', timeoutSeconds: 30, cors: true },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }
    try {
      res.status(200).json({
        status: 'ok',
        service: 'marketpulse-ai-functions',
        phase: '4B.2-ENV',
        version: '4B.2-ENV.0',
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        environment: process.env.FUNCTIONS_EMULATOR ? 'emulator' : 'production',
        firestore: { adminInitialized: true },
        auth: { provider: 'Firebase Authentication', sourceOfTruth: 'Firebase Auth - unique' },
        secrets: {
          architecture: 'GitHub Secret GEMINI_API_KEY -> GitHub Actions -> functions/.env -> process.env.GEMINI_API_KEY',
          configured: ['GEMINI_API_KEY via process.env (Phase 4B.2-ENV)'],
          futureKeys: ['CHARIOW_API_KEY (Phase 4C)', 'CHARIOW_WEBHOOK_SECRET (Phase 4C)'],
          noHardcodedSecrets: true,
          envFileGitignored: true,
        },
        endpoints: {
          healthCheck: 'Callable auth',
          getBackendInfo: 'HTTP GET public',
          debitCredit: 'Phase 4B.1 - onCall auth + transaction',
          checkCredits: 'Phase 4B.1 - onCall auth lecture solde',
          secureGenerateCampaign: 'Phase 4B.2-ENV - onCall auth + GEMINI_API_KEY env + idempotence + refund',
        },
        security: {
          adminSdk: 'Only Cloud Functions',
          credentials: 'ADC - no private key file committed',
          firestoreRules: 'Unchanged Phase 3B - deny-by-default',
          authCheck: 'requireAuth() + uid from auth only',
          geminiKey: 'GEMINI_API_KEY via process.env (GitHub Secret -> .env temporaire), never in frontend, never in repo',
        },
        message: 'Phase 4B.2-ENV ready - secureGenerateCampaign with idempotence + refund via env',
      });
    } catch (err) {
      logger.error('[getBackendInfo] Erreur', { error: err.message });
      res.status(500).json({ error: 'Internal error', phase: '4B.2' });
    }
  }
);

// ==================== PHASE 4B.1 - DÉBIT SÉCURISÉ ====================

exports.debitCredit = onCall(
  { memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    const authContext = requireAuth(request);
    const uid = authContext.uid;

    if (request.data && request.data.uid && request.data.uid !== uid) {
      logger.warn('[debitCredit] Tentative uid différent', { authUid: uid, providedUid: request.data.uid });
    }

    try {
      const result = await debitCreditAdmin(uid, {
        reason: request.data?.reason || 'generation',
        metadata: request.data?.metadata || {},
        generationId: request.data?.generationId || null,
      });

      if (result.isPro) {
        return { success: true, credits: result.newBalance, rawCredits: result.newBalance, isPro: true, transactionId: null, message: 'PRO - pas de débit', phase: '4B.2' };
      }

      return { success: true, credits: result.newBalance, transactionId: result.transactionId, isPro: false, previousBalance: result.previousBalance, phase: '4B.2' };
    } catch (err) {
      if (err instanceof HttpsError) {
        if (err.code === 'failed-precondition') {
          throw new HttpsError('failed-precondition', err.message, { code: 'INSUFFICIENT_CREDITS', currentCredits: err.details?.currentCredits ?? 0 });
        }
        throw err;
      }
      logger.error('[debitCredit] Erreur interne', { uid, error: err.message, stack: err.stack });
      throw new HttpsError('internal', 'Erreur interne débit crédits.');
    }
  }
);

exports.checkCredits = onCall(
  { memory: '128MiB', timeoutSeconds: 15 },
  async (request) => {
    const authContext = requireAuth(request);
    const uid = authContext.uid;
    try {
      const balance = await checkBalanceAdmin(uid);
      return { success: true, credits: balance.credits, rawCredits: balance.rawCredits, isPro: balance.isPro, hasEnough: balance.hasEnough, plan: balance.plan, phase: '4B.2' };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error('[checkCredits] Erreur', { uid, error: err.message });
      throw new HttpsError('internal', 'Erreur lecture solde.');
    }
  }
);

// ==================== PHASE 4B.2 - GÉNÉRATION SÉCURISÉE GEMINI ====================

/**
 * secureGenerateCampaign - Génération sécurisée avec Gemini + idempotence + remboursement
 *
 * Architecture ENV (Phase 4B.2-ENV):
 * Frontend -> secureGenerateCampaign(generationId, params) -> requireAuth() -> validation -> idempotence check
 * -> débit sécurisé 1 crédit (transaction) -> appel Gemini côté serveur (process.env.GEMINI_API_KEY) -> validation sortie
 * -> SUCCESS: sauvegarde Firestore + mark completed -> retour campagne + solde
 * -> FAILURE: remboursement + mark failed + erreur propre
 *
 * Env: GitHub Secret GEMINI_API_KEY -> GitHub Actions -> functions/.env temporaire -> process.env.GEMINI_API_KEY
 *
 * Idempotence:
 * - users/{uid}/generations/{generationId} avec status processing/completed/failed
 * - Même generationId ne doit JAMAIS provoquer deux débits
 * - completed: retourne résultat déjà généré sans nouveau débit
 * - processing: ne débite pas à nouveau, retourne ALREADY_PROCESSING
 * - failed: autorise retry seulement si ancien débit remboursé, sans réutiliser ancienne transaction
 *
 * Remboursement:
 * - Si Gemini échoue après débit, remboursement +1 crédit idempotent (refund_{generationId})
 * - Même génération ne peut recevoir deux remboursements
 * - Transaction type generation_refund avec amount +1, balanceAfter
 *
 * Sécurité:
 * - GEMINI_API_KEY via process.env (GitHub Secret -> .env temporaire), jamais frontend, jamais repo
 * - UID uniquement depuis request.auth.uid
 * - Client ne peut pas choisir credits, balanceAfter, transactionId, campaignId
 * - Validation serveur obligatoire
 * - Pas de stack traces retournées
 */
exports.secureGenerateCampaign = onCall(
  {
    memory: '1GiB',
    timeoutSeconds: 120,
  },
  async (request) => {
    const startTime = Date.now();
    let uid = null;
    let generationId = null;
    let debitResult = null;

    try {
      // 1. Vérifier authentification
      const authContext = requireAuth(request);
      uid = authContext.uid;
      const email = authContext.token.email || null;
      const emailVerified = authContext.token.email_verified || false;

      logger.info('[secureGenerateCampaign] Appel authentifié', { uid, email, emailVerified });

      // 2. Vérifier email vérifié si architecture l'exige (Phase 2B+ exige vérification)
      // Pour génération, on exige email vérifié
      if (!emailVerified) {
        logger.warn('[secureGenerateCampaign] Email non vérifié', { uid });
        throw new HttpsError('permission-denied', 'Veuillez vérifier votre email avant de générer.', {
          code: 'EMAIL_NOT_VERIFIED',
        });
      }

      // 3. Validation paramètres
      let params;
      try {
        params = validateGenerationParams(request.data);
      } catch (validationErr) {
        if (validationErr instanceof HttpsError) throw validationErr;
        throw new HttpsError('invalid-argument', 'Paramètres invalides.', { code: 'INVALID_PARAMS' });
      }

      generationId = params.generationId;
      logger.info('[secureGenerateCampaign] Params validés', { uid, generationId, brand: params.brand, lang: params.lang });

      // 4. Vérification idempotence - users/{uid}/generations/{generationId}
      // Phase 4B.2-FIX: gestion stale recovery >10min
      let idempotenceResult = await createGenerationProcessing(uid, generationId, params);

      if (idempotenceResult.alreadyExists) {
        const existing = idempotenceResult.data;
        const existingStatus = idempotenceResult.status;

        if (existingStatus === 'completed') {
          // Déjà completed - retourner résultat déjà généré sans nouveau débit
          logger.info('[secureGenerateCampaign] Idempotence: déjà completed', { uid, generationId, campaignId: existing.campaignId });

          // Récupérer campagne associée
          let campaign = null;
          if (existing.campaignId) {
            try {
              campaign = await getCampaignById(uid, existing.campaignId);
            } catch (e) {
              logger.warn('[secureGenerateCampaign] Erreur récupération campagne completed', { uid, generationId, error: e.message });
            }
          }

          // Récupérer solde actuel
          let currentCredits = 0;
          let isPro = false;
          try {
            const balance = await checkBalanceAdmin(uid);
            currentCredits = balance.rawCredits;
            isPro = balance.isPro;
          } catch (e) {
            logger.warn('[secureGenerateCampaign] Erreur lecture solde pour idempotence completed', { uid, error: e.message });
          }

          return {
            success: true,
            generationId,
            campaignId: existing.campaignId,
            campaign: campaign,
            credits: isPro ? Infinity : currentCredits,
            rawCredits: currentCredits,
            isPro,
            transactionId: existing.transactionId,
            idempotent: true,
            status: 'completed',
            message: 'Génération déjà complétée - résultat retourné sans nouveau débit (idempotence)',
            phase: '4B.2-FIX',
          };
        }

        if (existingStatus === 'processing') {
          const ageMinutes = idempotenceResult.ageMinutes ?? 0;
          const existingTxId = idempotenceResult.transactionId || existing.transactionId || null;
          const isStale = idempotenceResult.isStale || ageMinutes >= 10;

          if (!isStale) {
            // Moins de 10 minutes - toujours en cours, ne pas débiter à nouveau
            logger.info('[secureGenerateCampaign] Idempotence: déjà processing (<10min)', { uid, generationId, ageMinutes });

            return {
              success: false,
              generationId,
              errorCode: 'ALREADY_PROCESSING',
              message: 'Génération déjà en cours. Veuillez patienter ou réessayer avec un nouveau generationId.',
              status: 'processing',
              idempotent: true,
              ageMinutes,
              phase: '4B.2-FIX',
            };
          }

          // Phase 4B.2-FIX: Stale processing >10min - récupération idempotente
          // Scénario: debit -> crash/timeout avant save -> reste processing -> credit débité
          // Fix: vérifier debit existe, refund +1 idempotent via refund_{genId}, marquer STALE_RECOVERED, autoriser nouvelle génération propre
          logger.warn('[secureGenerateCampaign] Stale processing détecté >10min, début recovery', {
            uid,
            generationId,
            ageMinutes,
            transactionId: existingTxId,
          });

          // Vérifier si débit initial existe (transactionId présent)
          if (existingTxId) {
            try {
              // Refund idempotent via mécanisme existant refundCreditAdmin (refund_{generationId})
              const refundRes = await refundCreditAdmin(uid, generationId, 'stale_processing_recovery');
              logger.info('[secureGenerateCampaign] Stale recovery refund', {
                uid,
                generationId,
                alreadyRefunded: refundRes.alreadyRefunded,
                newBalance: refundRes.newBalance,
                transactionId: existingTxId,
              });
            } catch (refundErr) {
              logger.error('[secureGenerateCampaign] Stale recovery refund échoué', {
                uid,
                generationId,
                error: refundErr.message,
              });
              // Si refund échoue pour raison autre que déjà remboursé, on ne bloque pas recovery
              // Mais si c'est une erreur critique, on tente quand même de marquer recovered pour éviter blocage
            }
          } else {
            logger.info('[secureGenerateCampaign] Stale sans transactionId - pas de refund fictif', { uid, generationId });
          }

          // Marquer ancienne tentative comme failed/recovered explicit
          try {
            await markGenerationRecovered(uid, generationId, ageMinutes);
          } catch (markErr) {
            logger.warn('[secureGenerateCampaign] Erreur mark recovered (non bloquant, continue)', { uid, generationId, error: markErr.message });
            // Fallback: marquer failed si recovered échoue
            try {
              await markGenerationFailed(uid, generationId, 'STALE_RECOVERED', `Stale after ${Math.round(ageMinutes)}min, recovered`);
            } catch (e2) {
              logger.warn('[secureGenerateCampaign] Fallback mark failed aussi échoué', { uid, generationId, error: e2.message });
            }
          }

          // Forcer création nouvelle génération processing propre après recovery
          // Nouvelle tentative aura un seul nouveau débit, net -1 pour nouvelle seulement
          try {
            idempotenceResult = await forceCreateGenerationProcessing(uid, generationId, params);
            logger.info('[secureGenerateCampaign] Stale recovery - nouvelle génération processing créée', { uid, generationId });
          } catch (forceErr) {
            logger.error('[secureGenerateCampaign] Erreur force create après recovery', { uid, generationId, error: forceErr.message });
            throw new HttpsError('internal', 'Erreur recovery génération stale, veuillez réessayer.', { code: 'STALE_RECOVERY_FAILED', generationId });
          }

          // Continuer avec nouveau débit propre - pas de return, on laisse le flow continuer vers débit
        }

        if (existingStatus === 'failed') {
          // Échouée - autoriser retry seulement si remboursement déjà fait
          logger.info('[secureGenerateCampaign] Idempotence: failed, autorise retry', { uid, generationId, previousError: existing.errorCode });
          // On continue avec nouveau débit - l'ancien débit a déjà été remboursé lors de l'échec précédent
          // La fonction createGenerationProcessing a déjà écrasé avec nouveau processing si failed
        }
      }

      // 5. Vérifier que utilisateur existe et récupérer profil (pour plan PRO)
      const userProfile = await getUserProfileAdmin(uid);
      if (!userProfile) {
        await markGenerationFailed(uid, generationId, 'USER_NOT_FOUND', 'Profil non trouvé');
        throw new HttpsError('not-found', 'Profil utilisateur non trouvé.');
      }

      // 6. Débit sécurisé 1 crédit (transaction atomique)
      try {
        debitResult = await debitCreditAdmin(uid, {
          reason: 'generation',
          metadata: { brand: params.brand, lang: params.lang },
          generationId: generationId,
        });

        // Mettre à jour génération avec transactionId
        if (debitResult.transactionId) {
          await updateGenerationWithTransaction(uid, generationId, debitResult.transactionId);
        }

        logger.info('[secureGenerateCampaign] Débit réussi', {
          uid,
          generationId,
          newBalance: debitResult.newBalance,
          transactionId: debitResult.transactionId,
          isPro: debitResult.isPro,
        });
      } catch (debitErr) {
        if (debitErr instanceof HttpsError) {
          // Si solde insuffisant, marquer génération failed
          if (debitErr.code === 'failed-precondition') {
            await markGenerationFailed(uid, generationId, 'INSUFFICIENT_CREDITS', debitErr.message);
            throw new HttpsError('failed-precondition', debitErr.message, {
              code: 'INSUFFICIENT_CREDITS',
              generationId,
              currentCredits: debitErr.details?.currentCredits ?? 0,
            });
          }
          await markGenerationFailed(uid, generationId, debitErr.code.toUpperCase(), debitErr.message);
          throw debitErr;
        }
        await markGenerationFailed(uid, generationId, 'DEBIT_FAILED', debitErr.message);
        throw new HttpsError('internal', 'Erreur débit crédits.', { code: 'DEBIT_FAILED' });
      }

      // Si PRO, pas de débit mais on continue génération
      const isProUser = debitResult.isPro;
      const currentBalance = debitResult.newBalance;
      const transactionId = debitResult.transactionId;

      // 7. Appel Gemini côté serveur
      let geminiRawOutput;
      try {
        geminiRawOutput = await generateCampaignWithGemini(params);
        logger.info('[secureGenerateCampaign] Gemini appel réussi', { uid, generationId, hasHooks: !!geminiRawOutput.hooks });
      } catch (geminiErr) {
        // Échec Gemini -> remboursement si débit avait eu lieu et pas PRO
        logger.error('[secureGenerateCampaign] Erreur Gemini, remboursement', {
          uid,
          generationId,
          error: geminiErr.message,
          code: geminiErr.code,
        });

        if (!isProUser && transactionId) {
          try {
            const refundResult = await refundCreditAdmin(uid, generationId, `gemini_error_${geminiErr.code || 'unknown'}`);
            logger.info('[secureGenerateCampaign] Remboursement après échec Gemini', {
              uid,
              generationId,
              newBalance: refundResult.newBalance,
              alreadyRefunded: refundResult.alreadyRefunded,
            });

            await markGenerationFailed(uid, generationId, geminiErr.code || 'GEMINI_ERROR', geminiErr.message);

            // Retourner erreur avec crédits remboursés
            return {
              success: false,
              generationId,
              errorCode: geminiErr.code || 'GEMINI_ERROR',
              message: geminiErr.message || 'Erreur génération Gemini',
              credits: refundResult.newBalance,
              rawCredits: refundResult.newBalance,
              refunded: !refundResult.alreadyRefunded,
              transactionId: transactionId,
              refundTransactionId: refundResult.transactionId,
              phase: '4B.2',
            };
          } catch (refundErr) {
            logger.error('[secureGenerateCampaign] Erreur remboursement après échec Gemini', {
              uid,
              generationId,
              error: refundErr.message,
            });
            await markGenerationFailed(uid, generationId, 'GEMINI_ERROR_REFUND_FAILED', `${geminiErr.message} + refund failed: ${refundErr.message}`);
            throw new HttpsError('internal', 'Erreur Gemini + remboursement échoué, contactez support.', {
              code: 'GEMINI_REFUND_FAILED',
              generationId,
            });
          }
        } else {
          // PRO ou pas de transaction - pas de remboursement nécessaire
          await markGenerationFailed(uid, generationId, geminiErr.code || 'GEMINI_ERROR', geminiErr.message);
          throw geminiErr;
        }
      }

      // 8. Validation sortie Gemini
      let validatedOutput;
      try {
        validatedOutput = validateGeminiOutput(geminiRawOutput);
        logger.info('[secureGenerateCampaign] Gemini output validé', { uid, generationId, hooksCount: validatedOutput.hooks.length });
      } catch (validationErr) {
        logger.error('[secureGenerateCampaign] Output Gemini invalide, remboursement', {
          uid,
          generationId,
          error: validationErr.message,
          rawOutput: JSON.stringify(geminiRawOutput).substring(0, 1000),
        });

        if (!isProUser && transactionId) {
          try {
            const refundResult = await refundCreditAdmin(uid, generationId, `gemini_invalid_output_${validationErr.message.substring(0, 50)}`);
            await markGenerationFailed(uid, generationId, 'GEMINI_INVALID_OUTPUT', validationErr.message);

            return {
              success: false,
              generationId,
              errorCode: 'GEMINI_INVALID_OUTPUT',
              message: `Réponse Gemini invalide: ${validationErr.message}`,
              credits: refundResult.newBalance,
              rawCredits: refundResult.newBalance,
              refunded: !refundResult.alreadyRefunded,
              transactionId,
              refundTransactionId: refundResult.transactionId,
              phase: '4B.2',
            };
          } catch (refundErr) {
            logger.error('[secureGenerateCampaign] Erreur remboursement après output invalide', { uid, generationId, error: refundErr.message });
            await markGenerationFailed(uid, generationId, 'INVALID_OUTPUT_REFUND_FAILED', validationErr.message);
            throw new HttpsError('internal', 'Réponse Gemini invalide + remboursement échoué.', { code: 'INVALID_OUTPUT_REFUND_FAILED' });
          }
        } else {
          await markGenerationFailed(uid, generationId, 'GEMINI_INVALID_OUTPUT', validationErr.message);
          throw new HttpsError('internal', `Réponse Gemini invalide: ${validationErr.message}`, { code: 'GEMINI_INVALID_OUTPUT' });
        }
      }

      // 9. Sauvegarde campagne Firestore
      let savedCampaign;
      try {
        const wordCount = (validatedOutput.social_post?.length || 0) + (validatedOutput.email?.body?.length || 0) + (validatedOutput.hooks?.join(' ').length || 0);

        savedCampaign = await saveCampaignAdmin(uid, {
          brand: params.brand,
          target: params.target,
          tone: params.tone,
          lang: params.lang,
          offer: params.offer,
          preset: params.preset,
          hooks: validatedOutput.hooks,
          post: validatedOutput.social_post,
          email: validatedOutput.email,
          imagePrompt: validatedOutput.image_prompt,
          generationId: generationId,
          wordCount: wordCount,
        });

        logger.info('[secureGenerateCampaign] Campagne sauvegardée', { uid, generationId, campaignId: savedCampaign.campaignId });
      } catch (saveErr) {
        logger.error('[secureGenerateCampaign] Erreur sauvegarde campagne, remboursement', { uid, generationId, error: saveErr.message });

        if (!isProUser && transactionId) {
          try {
            const refundResult = await refundCreditAdmin(uid, generationId, `save_failed_${saveErr.message.substring(0, 50)}`);
            await markGenerationFailed(uid, generationId, 'SAVE_FAILED', saveErr.message);

            return {
              success: false,
              generationId,
              errorCode: 'SAVE_FAILED',
              message: 'Erreur sauvegarde campagne',
              credits: refundResult.newBalance,
              refunded: !refundResult.alreadyRefunded,
              transactionId,
              refundTransactionId: refundResult.transactionId,
              phase: '4B.2',
            };
          } catch (refundErr) {
            logger.error('[secureGenerateCampaign] Erreur remboursement après échec sauvegarde', { uid, generationId, error: refundErr.message });
            await markGenerationFailed(uid, generationId, 'SAVE_FAILED_REFUND_FAILED', saveErr.message);
            throw new HttpsError('internal', 'Erreur sauvegarde + remboursement échoué.', { code: 'SAVE_REFUND_FAILED' });
          }
        } else {
          await markGenerationFailed(uid, generationId, 'SAVE_FAILED', saveErr.message);
          throw new HttpsError('internal', 'Erreur sauvegarde campagne.', { code: 'SAVE_FAILED' });
        }
      }

      // 10. Marquer génération completed
      try {
        await markGenerationCompleted(uid, generationId, savedCampaign.campaignId, transactionId);
      } catch (markErr) {
        logger.warn('[secureGenerateCampaign] Erreur mark completed (non bloquant)', { uid, generationId, error: markErr.message });
        // Non bloquant - campagne déjà sauvegardée, on continue
      }

      const duration = Date.now() - startTime;
      logger.info('[secureGenerateCampaign] Succès complet', { uid, generationId, campaignId: savedCampaign.campaignId, duration, credits: currentBalance });

      // 11. Retour frontend
      return {
        success: true,
        generationId,
        campaignId: savedCampaign.campaignId,
        campaign: {
          id: savedCampaign.campaignId,
          brand: params.brand,
          target: params.target,
          tone: params.tone,
          lang: params.lang,
          offer: params.offer,
          preset: params.preset,
          hooks: validatedOutput.hooks,
          post: validatedOutput.social_post,
          email: validatedOutput.email,
          imagePrompt: validatedOutput.image_prompt,
          source: 'gemini',
          generationId,
          createdAt: new Date().toISOString(),
          wordCount: (validatedOutput.social_post?.length || 0) + (validatedOutput.email?.body?.length || 0),
        },
        credits: isProUser ? Infinity : currentBalance,
        rawCredits: currentBalance,
        isPro: isProUser,
        transactionId: transactionId,
        phase: '4B.2',
        duration: duration,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;

      logger.error('[secureGenerateCampaign] Erreur interne non gérée', {
        uid,
        generationId,
        error: err.message,
        stack: err.stack,
      });

      // Si on a déjà débité et que c'est une erreur inattendue après débit, tenter remboursement
      if (uid && generationId && debitResult && debitResult.transactionId && !debitResult.isPro) {
        try {
          const refundResult = await refundCreditAdmin(uid, generationId, `internal_error_${err.message.substring(0, 50)}`);
          await markGenerationFailed(uid, generationId, 'INTERNAL_ERROR', err.message);
          return {
            success: false,
            generationId,
            errorCode: 'INTERNAL_ERROR',
            message: 'Erreur interne génération',
            credits: refundResult.newBalance,
            refunded: !refundResult.alreadyRefunded,
            phase: '4B.2',
          };
        } catch (refundErr) {
          logger.error('[secureGenerateCampaign] Erreur remboursement après erreur interne', { uid, generationId, error: refundErr.message });
        }
      }

      throw new HttpsError('internal', 'Erreur interne génération campagne.', { code: 'INTERNAL_ERROR', generationId });
    }
  }
);

// ==================== PLACEHOLDERS FUTURS PHASE 4C+ ====================
// - chariowWebhook: onRequest + secrets[CHARIOW_API_KEY, CHARIOW_WEBHOOK_SECRET]
// - grantReferralBonus, generateImage Phase 5

// ==================== EXPORTS UTILITAIRES TESTS ====================
exports._testHelpers = {
  requireAuth,
  requireOwner,
  getUserProfileAdmin,
  db: () => db,
  auth: () => auth,
  debitCreditAdmin,
  refundCreditAdmin,
  checkBalanceAdmin,
  isUserPro,
};
