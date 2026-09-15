/**
 * MarketPulse AI - Firebase App Initialization
 * Phase 2A: Préparation Auth sans forcer dépendance
 * 
 * - Initialise Firebase uniquement si config valide
 * - Utilise SDK modulaire v10 via CDN (pas de npm pour rester vanilla)
 * - Retourne null si config manquante => app continue avec localStorage
 * - Aucune clé secrète serveur
 */

import { firebaseConfig, isFirebaseConfigValid, FIREBASE_SETUP_INSTRUCTIONS } from './config.js';

let firebaseApp = null;
let initializationAttempted = false;
let initializationError = null;

/**
 * Initialise Firebase App de manière paresseuse et sécurisée
 * @returns {Promise<FirebaseApp|null>} app ou null si config invalide
 */
export async function initFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  if (initializationAttempted && !firebaseApp) {
    // Déjà tenté et échoué (config invalide) => retourne null sans réessayer
    return null;
  }
  initializationAttempted = true;

  if (!isFirebaseConfigValid(firebaseConfig)) {
    console.info('[Firebase] Config non valide ou placeholder - mode localStorage conservé (Phase 2A)');
    console.info(FIREBASE_SETUP_INSTRUCTIONS);
    return null;
  }

  try {
    // Import dynamique SDK Firebase (évite erreur si offline ou config manquante)
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    firebaseApp = initializeApp(firebaseConfig);
    console.log('[Firebase] App initialisée avec succès:', firebaseConfig.projectId);
    return firebaseApp;
  } catch (err) {
    initializationError = err;
    console.warn('[Firebase] Échec initialisation, fallback localStorage:', err.message);
    return null;
  }
}

/**
 * Récupère l'app Firebase si déjà initialisée, sinon null
 */
export function getFirebaseApp() {
  return firebaseApp;
}

/**
 * Vérifie si Firebase est disponible
 */
export function isFirebaseAvailable() {
  return !!firebaseApp;
}

/**
 * Récupère erreur d'init si existante
 */
export function getFirebaseInitError() {
  return initializationError;
}

/**
 * Reset pour tests (Phase 2A)
 */
export function _resetFirebaseAppForTests() {
  firebaseApp = null;
  initializationAttempted = false;
  initializationError = null;
}
