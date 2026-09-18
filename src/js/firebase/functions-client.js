/**
 * MarketPulse AI - Client backend sécurisé
 *
 * Phase 4B.2 - Le frontend conserve Firebase Auth pour les comptes, mais les opérations
 * serveur passent par le backend REST hébergé séparément. Le jeton Firebase
 * est envoyé en Bearer token et la clé Gemini reste exclusivement côté serveur.
 */

let functionsInstance = null;
let functionsImportError = null;

const DEFAULT_BACKEND_URL = 'https://3000-i16tsehmgscl3ekbpemgm-b09eb31f.us1.manus.computer';

function getBackendUrl() {
  if (typeof window !== 'undefined' && window.__MARKETPULSE_BACKEND_URL__) {
    return String(window.__MARKETPULSE_BACKEND_URL__).replace(/\/$/, '');
  }
  return DEFAULT_BACKEND_URL;
}

async function getFirebaseIdToken() {
  const { waitForCurrentFirebaseUser } = await import('./auth.js');
  const user = await waitForCurrentFirebaseUser();
  if (!user) return null;
  return user.getIdToken(true);
}

/**
 * Retourne un descripteur du backend REST. La fonction conserve son nom
 * historique pour ne pas casser les imports de l’application.
 */
export async function getFunctionsInstance() {
  if (functionsInstance) return functionsInstance;
  try {
    functionsInstance = { type: 'rest', baseUrl: getBackendUrl() };
    return functionsInstance;
  } catch (err) {
    functionsImportError = err;
    return null;
  }
}

export function isFunctionsAvailable() {
  return Boolean(functionsInstance || getBackendUrl());
}

export function getFunctionsImportError() {
  return functionsImportError;
}

export function generateGenerationId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  const random2 = Math.random().toString(36).substring(2, 6);
  return `gen_${timestamp}_${random}${random2}`;
}

const endpointNames = {
  healthCheck: 'health',
  checkCredits: 'checkCredits',
  debitCredit: 'debitCredit',
  secureGenerateCampaign: 'secureGenerateCampaign',
};

export async function callBackendFunction(functionName, data = {}) {
  if (!Object.prototype.hasOwnProperty.call(endpointNames, functionName)) {
    return { data: null, error: { code: 'not-implemented', message: `${functionName} non implémenté` } };
  }

  try {
    const token = await getFirebaseIdToken();
    if (functionName !== 'healthCheck' && !token) {
      return {
        data: null,
        error: {
          code: 'auth/no-token',
          message: 'Session Firebase introuvable. Veuillez vous reconnecter puis réessayer.',
        },
      };
    }
    const endpoint = `${getBackendUrl()}/api/marketpulse/${endpointNames[functionName]}`;
    const response = await fetch(endpoint, {
      method: functionName === 'healthCheck' ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: functionName === 'healthCheck' ? undefined : JSON.stringify(data),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const backendError = payload.error || {};
      const details = backendError.details || {};
      const code = backendError.code || 'internal';
      return {
        data: null,
        error: {
          code,
          message: backendError.message || `Erreur backend HTTP ${response.status}`,
          details,
          isInsufficientCredits: code === 'failed-precondition' && details.code === 'INSUFFICIENT_CREDITS',
          isAlreadyProcessing: code === 'already-processing' || details.code === 'ALREADY_PROCESSING',
          isEmailNotVerified: code === 'permission-denied' && details.code === 'EMAIL_NOT_VERIFIED',
        },
      };
    }
    return { data: payload.data || payload, error: null };
  } catch (err) {
    console.error(`[Backend Client] Erreur appel ${functionName}:`, err);
    return {
      data: null,
      error: { code: 'functions-unavailable', message: err.message || 'Backend temporairement indisponible' },
    };
  }
}

export async function testBackendHealth() {
  return callBackendFunction('healthCheck', { test: true, phase: 'alternative-backend' });
}

export async function debitCredit(options = {}) {
  const { reason = 'generation', metadata = {}, generationId = null } = options;
  const payload = { reason, metadata };
  if (generationId) payload.generationId = generationId;
  return callBackendFunction('debitCredit', payload);
}

export async function checkCredits() {
  return callBackendFunction('checkCredits', {});
}

export async function secureGenerateCampaign(params) {
  if (!params || typeof params !== 'object') {
    return { data: null, error: { code: 'invalid-argument', message: 'Paramètres manquants' } };
  }
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
  console.log('[Backend Client] secureGenerateCampaign appel', { generationId, brand: payload.brand });
  const result = await callBackendFunction('secureGenerateCampaign', payload);
  if (result.error && !result.error.generationId) result.error.generationId = generationId;
  if (result.data && !result.data.generationId) result.data.generationId = generationId;
  return result;
}

export async function getBackendInfo() {
  try {
    const response = await fetch(`${getBackendUrl()}/api/marketpulse/health`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: { code: 'fetch-error', message: err.message } };
  }
}

export function _resetFunctionsForTests() {
  functionsInstance = null;
  functionsImportError = null;
}
