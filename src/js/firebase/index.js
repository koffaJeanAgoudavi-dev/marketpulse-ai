/**
 * MarketPulse AI - Firebase Module Entry
 * Phase 4A: Façade unique - Auth + Firestore + Functions Client (foundation)
 * 
 * Le reste de l'app doit passer par ce fichier, pas directement app.js/auth.js/firestore.js
 */

// Config & App
export { firebaseConfig, isFirebaseConfigValid, isFirebaseConfigured, FIREBASE_SETUP_INSTRUCTIONS } from './config.js';
export { initFirebaseApp, getFirebaseApp, isFirebaseAvailable, getFirebaseInitError } from './app.js';

// Auth API
export {
  registerUser,
  loginUser,
  logoutFirebaseUser,
  getCurrentFirebaseUser,
  waitForCurrentFirebaseUser,
  onFirebaseAuthStateChanged,
  sendVerificationEmail,
  isEmailVerified,
  reloadCurrentUser,
  sendPasswordResetEmail,
  translateFirebaseAuthError
} from './auth.js';

// Auth Errors
export { toUserMessage, toUserFriendlyMessage } from './auth-errors.js';

// Aliases spec Phase 2B
export { onFirebaseAuthStateChanged as onAuthChange } from './auth.js';
export { reloadCurrentUser as refreshCurrentUser } from './auth.js';
export { getCurrentFirebaseUser as getCurrentUser } from './auth.js';

// Firestore API - Phase 3B
export {
  isFirestoreAvailable,
  getUserProfile,
  createUserProfile,
  ensureUserProfile,
  migrateLegacyData,
  createCampaignInFirestore,
  getCampaignsFromFirestore,
  deleteCampaignFromFirestore,
  createReferralCodeInFirestore,
  getReferralCodeFromFirestore,
  createReferralRecordInFirestore,
  getCloudPreferences,
  saveCloudPreferences
} from './firestore.js';

// Functions Client API - Phase 4B.2 (fondation + débit sécurisé + génération Gemini)
export {
  getFunctionsInstance,
  isFunctionsAvailable,
  callBackendFunction,
  testBackendHealth,
  getBackendInfo,
  getFunctionsImportError,
  debitCredit,
  checkCredits,
  secureGenerateCampaign,
  generateGenerationId
} from './functions-client.js';

/**
 * Initialisation globale Firebase (optionnelle, non bloquante)
 * Appelée depuis main.js sans forcer dépendance
 */
export async function initFirebase() {
  const { initFirebaseApp } = await import('./app.js');
  const app = await initFirebaseApp();
  if (app) {
    console.log('[Firebase] Module initialisé - Auth disponible');
    // Prépare écoute session (non bloquant)
    const { onFirebaseAuthStateChanged } = await import('./auth.js');
    // Écoute mais ne remplace pas encore localStorage
    onFirebaseAuthStateChanged((user) => {
      if (user) {
        console.info('[Firebase] Session détectée:', user.uid, user.email, 'verified:', user.emailVerified);
        // Future: migrer vers UID
        // Pour Phase 2A, on log seulement, on ne remplace pas localStorage
      } else {
        console.info('[Firebase] Aucune session Firebase - mode localStorage');
      }
    });

    // Phase 4A: Prépare Functions client (non bloquant, foundation seulement)
    try {
      const { getFunctionsInstance } = await import('./functions-client.js');
      await getFunctionsInstance();
      console.log('[Firebase] Functions client foundation prête - Phase 4A');
    } catch (e) {
      console.info('[Firebase] Functions client non disponible Phase 4A (normal si pas de Functions déployées):', e.message);
    }
  } else {
    console.info('[Firebase] Non configuré - mode localStorage conservé (Phase 2A)');
  }
  return app;
}
