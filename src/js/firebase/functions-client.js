/**
 * MarketPulse AI - Firebase Functions Client (Frontend)
 * Phase 4B.2 - Abstraction pour génération sécurisée Gemini + débit sécurisé
 *
 * IMPORTANT:
 * - Ce fichier est côté frontend (client)
 * - Il ne doit JAMAIS importer firebase-admin
 * - Il ne doit JAMAIS contenir GEMINI_API_KEY
 * - Il utilise firebase-functions client SDK (via CDN) pour appeler backend
 * - Secrets restent côté serveur (functions/ via Secrets Manager)
 * - Génération backend sécurisée via secureGenerateCampaign
 */

import { getFirebaseApp, isFirebaseAvailable } from './app.js';

let functionsInstance = null;
let functionsImportError = null;

/**
 * Lazy import Firebase Functions SDK (client)
 * @returns {Promise<object|null>} Functions instance ou null si non dispo
 */
export async function getFunctionsInstance() {
  if (functionsInstance) return functionsInstance;

  try {
    const app = getFirebaseApp();
    if (!app) {
      console.info('[Functions Client] Firebase App non disponible - Phase 4A préparation');
      return null;
    }

    // Dynamic import Functions SDK v10
    const { getFunctions, connectFunctionsEmulator } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'
    );

    functionsInstance = getFunctions(app);

    // Si emulator local, connecter
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        // Emulator Functions sur port 5001 (défini dans firebase.json)
        connectFunctionsEmulator(functionsInstance, '127.0.0.1', 5001);
        console.log('[Functions Client] Connecté à emulator Functions 127.0.0.1:5001');
      } catch (e) {
        console.warn('[Functions Client] Emulator connect error (peut être déjà connecté):', e.message);
      }
    }

    console.log('[Functions Client] Instance créée - Phase 4A foundation');
    return functionsInstance;
  } catch (err) {
    functionsImportError = err;
    console.warn('[Functions Client] Init error - fallback local (Phase 4A normal):', err.message);
    return null;
  }
}

/**
 * Vérifie si Functions client est disponible
 * @returns {boolean}
 */
export function isFunctionsAvailable() {
  return !!functionsInstance;
}

/**
 * Récupère erreur import si existante
 */
export function getFunctionsImportError() {
  return functionsImportError;
}

/**
 * Génère un generationId unique pour idempotence
 * Format: gen_ + timestamp + random
 * @returns {string} generationId
 */
export function generateGenerationId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  const random2 = Math.random().toString(36).substring(2, 6);
  return `gen_${timestamp}_${random}${random2}`;
}

/**
 * Appelle une Cloud Function callable
 * Phase 4B.2: healthCheck, debitCredit, checkCredits, secureGenerateCampaign autorisés
 *
 * @param {string} functionName
 * @param {object} data
 * @returns {Promise<{data, error}>}
 */
export async function callBackendFunction(functionName, data = {}) {
  try {
    const functions = await getFunctionsInstance();
    if (!functions) {
      return {
        data: null,
        error: { code: 'functions-unavailable', message: 'Functions non disponible - vérifiez connexion et Functions déployées' },
      };
    }

    const { httpsCallable } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'
    );

    // Phase 4B.2: fonctions autorisées
    const allowedPhase4B2 = ['healthCheck', 'debitCredit', 'checkCredits', 'secureGenerateCampaign'];
    if (!allowedPhase4B2.includes(functionName)) {
      console.warn(`[Functions Client] ${functionName} non implémenté Phase 4B.2`);
      return {
        data: null,
        error: {
          code: 'not-implemented',
          message: `${functionName} non implémenté Phase 4B.2`,
        },
      };
    }

    const callable = httpsCallable(functions, functionName);
    const result = await callable(data);
    return { data: result.data, error: null };
  } catch (err) {
    console.error(`[Functions Client] Erreur appel ${functionName}:`, err);
    const code = err.code || 'internal';
    const details = err.details || {};
    return {
      data: null,
      error: {
        code,
        message: err.message || 'Erreur appel backend',
        details,
        isInsufficientCredits: code === 'failed-precondition' && (details.code === 'INSUFFICIENT_CREDITS' || err.message.includes('Crédits insuffisants')),
        isAlreadyProcessing: code === 'failed-precondition' && details.code === 'ALREADY_PROCESSING' || code === 'already-processing' || err.message.includes('déjà en cours'),
        isEmailNotVerified: code === 'permission-denied' && details.code === 'EMAIL_NOT_VERIFIED',
      },
    };
  }
}

/**
 * Test backend healthCheck
 * @returns {Promise<{data, error}>}
 */
export async function testBackendHealth() {
  return callBackendFunction('healthCheck', { test: true, phase: '4B.2' });
}

/**
 * Débit sécurisé 1 crédit côté serveur (Phase 4B.1)
 * @param {object} options - { reason, metadata, generationId }
 * @returns {Promise<{data, error}>}
 */
export async function debitCredit(options = {}) {
  const { reason = 'generation', metadata = {}, generationId = null } = options;
  const payload = { reason, metadata };
  if (generationId) payload.generationId = generationId;
  return callBackendFunction('debitCredit', payload);
}

/**
 * Lecture seule solde crédits sécurisée côté serveur
 * @returns {Promise<{data, error}>}
 */
export async function checkCredits() {
  return callBackendFunction('checkCredits', {});
}

/**
 * Génération sécurisée campagne via Gemini côté serveur (Phase 4B.2)
 * Architecture: Frontend -> secureGenerateCampaign(generationId, params) -> Auth -> validation -> idempotence -> débit -> Gemini -> sauvegarde -> retour
 * - Génère generationId unique pour idempotence si non fourni
 * - Débit sécurisé 1 crédit atomique côté serveur
 * - Remboursement automatique si Gemini échoue
 * - Sauvegarde Firestore users/{uid}/campaigns/{campaignId} source gemini
 *
 * @param {object} params - { generationId (optionnel), brand, target, tone, lang, offer, preset }
 * @returns {Promise<{data: {success, generationId, campaignId, campaign, credits, transactionId}, error}>}
 */
export async function secureGenerateCampaign(params) {
  if (!params || typeof params !== 'object') {
    return {
      data: null,
      error: { code: 'invalid-argument', message: 'Paramètres manquants' },
    };
  }

  // Génère generationId si non fourni (idempotence)
  const generationId = params.generationId || generateGenerationId();

  const payload = {
    generationId,
    brand: params.brand,
    target: params.target,
    tone: params.tone,
    lang: params.lang,
    offer: params.offer,
    preset: params.preset || null,
  };

  console.log('[Functions Client] secureGenerateCampaign appel', { generationId, brand: payload.brand });

  const result = await callBackendFunction('secureGenerateCampaign', payload);

  // Enrichit résultat avec generationId même en cas d'erreur
  if (result.error && !result.error.generationId) {
    result.error.generationId = generationId;
  }
  if (result.data && !result.data.generationId) {
    result.data.generationId = generationId;
  }

  return result;
}

/**
 * Récupère infos backend publiques via HTTP (getBackendInfo)
 * @returns {Promise<{data, error}>}
 */
export async function getBackendInfo() {
  try {
    // URL Functions emulator ou prod
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isLocal
      ? 'http://127.0.0.1:5001/marketpulse-ai-48b08/us-central1/getBackendInfo'
      : `https://us-central1-marketpulse-ai-48b08.cloudfunctions.net/getBackendInfo`;

    const response = await fetch(baseUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: { code: 'fetch-error', message: err.message },
    };
  }
}

// Reset pour tests
export function _resetFunctionsForTests() {
  functionsInstance = null;
  functionsImportError = null;
}
