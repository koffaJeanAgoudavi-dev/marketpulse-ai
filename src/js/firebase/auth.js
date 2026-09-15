/**
 * MarketPulse AI - Firebase Authentication API
 * Phase 2A: Préparation Email/Password + vérification email
 * 
 * - Aucune migration onboarding encore
 * - Ancien système localStorage continue
 * - API prête pour futur UID-based Firestore
 * - Gestion erreurs traduite
 */

import { initFirebaseApp, getFirebaseApp, isFirebaseAvailable } from './app.js';

// Cache Auth instance
let firebaseAuth = null;

/**
 * Initialise Auth (lazy) - retourne null si Firebase non dispo
 */
async function getAuthInstance() {
  if (firebaseAuth) return firebaseAuth;

  const app = await initFirebaseApp();
  if (!app) {
    return null;
  }

  try {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    firebaseAuth = getAuth(app);
    return firebaseAuth;
  } catch (err) {
    console.warn('[Firebase Auth] Impossible de charger Auth SDK:', err.message);
    return null;
  }
}

/**
 * Traduction erreurs Firebase Auth vers messages utilisateur compréhensibles
 */
export function translateFirebaseAuthError(error) {
  if (!error) return "Erreur inconnue";
  const code = error.code || '';

  const translations = {
    'auth/email-already-in-use': "Cette adresse e-mail est déjà utilisée. Essayez de vous connecter.",
    'auth/invalid-email': "Adresse e-mail invalide.",
    'auth/weak-password': "Mot de passe trop faible (minimum 6 caractères).",
    'auth/wrong-password': "Identifiants incorrects.",
    'auth/user-not-found': "Identifiants incorrects.",
    'auth/invalid-credential': "Identifiants incorrects.",
    'auth/user-disabled': "Ce compte a été désactivé.",
    'auth/too-many-requests': "Trop de tentatives. Réessayez plus tard.",
    'auth/network-request-failed': "Problème réseau. Vérifiez votre connexion.",
    'auth/requires-recent-login': "Veuillez vous reconnecter pour cette action.",
    'auth/email-not-verified': "Veuillez vérifier votre e-mail avant de continuer.",
    'auth/invalid-verification-code': "Code de vérification invalide.",
    'auth/missing-email': "Veuillez renseigner votre e-mail."
  };

  return translations[code] || error.message || "Erreur inconnue lors de l'authentification.";
}

/**
 * Inscription Email + Mot de passe
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user, error}>}
 */
export async function registerUser(email, password) {
  const auth = await getAuthInstance();
  if (!auth) {
    return { user: null, error: { code: 'firebase/not-configured', message: 'Firebase non configuré - utilisez onboarding localStorage (Phase 2A)' } };
  }

  try {
    const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    console.log('[Firebase Auth] Inscription réussie:', cred.user.uid);
    return { user: cred.user, error: null };
  } catch (err) {
    console.warn('[Firebase Auth] registerUser error:', err.code, err.message);
    return { user: null, error: err };
  }
}

/**
 * Connexion Email + Mot de passe
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user, error}>}
 */
export async function loginUser(email, password) {
  const auth = await getAuthInstance();
  if (!auth) {
    return { user: null, error: { code: 'firebase/not-configured', message: 'Firebase non configuré' } };
  }

  try {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const cred = await signInWithEmailAndPassword(auth, email, password);
    console.log('[Firebase Auth] Connexion réussie:', cred.user.uid);
    return { user: cred.user, error: null };
  } catch (err) {
    console.warn('[Firebase Auth] loginUser error:', err.code);
    return { user: null, error: err };
  }
}

/**
 * Déconnexion Firebase
 * @returns {Promise<{error}>}
 */
export async function logoutFirebaseUser() {
  const auth = await getAuthInstance();
  if (!auth) {
    return { error: null }; // Pas de session Firebase à fermer
  }

  try {
    const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    await signOut(auth);
    console.log('[Firebase Auth] Déconnexion réussie');
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Récupère utilisateur courant Firebase (peut être null)
 * @returns {Promise<import('firebase/auth').User|null>}
 */
export async function getCurrentFirebaseUser() {
  const auth = await getAuthInstance();
  if (!auth) return null;
  return auth.currentUser;
}

/**
 * Écoute changements session (login/logout)
 * @param {function} callback - (user|null) => void
 * @returns {Promise<function>} unsubscribe function ou no-op si non configuré
 */
export async function onFirebaseAuthStateChanged(callback) {
  const auth = await getAuthInstance();
  if (!auth) {
    // No-op si Firebase non configuré - app continue avec localStorage
    console.info('[Firebase Auth] onAuthStateChanged ignoré - Firebase non configuré');
    // Appelle callback avec null pour simuler pas de user Firebase
    if (callback) callback(null);
    return () => {}; // unsubscribe no-op
  }

  try {
    const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[Firebase Auth] State changed:', user ? user.uid : 'null');
      if (callback) callback(user);
    });
    return unsubscribe;
  } catch (err) {
    console.warn('[Firebase Auth] onAuthStateChanged error:', err.message);
    return () => {};
  }
}

/**
 * Envoie email de vérification à l'utilisateur courant
 * @returns {Promise<{error}>}
 */
export async function sendVerificationEmail() {
  const auth = await getAuthInstance();
  if (!auth || !auth.currentUser) {
    return { error: { code: 'auth/no-user', message: 'Aucun utilisateur connecté' } };
  }

  try {
    const { sendEmailVerification } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    await sendEmailVerification(auth.currentUser);
    console.log('[Firebase Auth] Email vérification envoyé');
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Vérifie si email utilisateur courant est vérifié
 * @returns {Promise<boolean>}
 */
export async function isEmailVerified() {
  const user = await getCurrentFirebaseUser();
  return user ? user.emailVerified : false;
}

/**
 * Recharge utilisateur courant (pour mettre à jour emailVerified après clic lien)
 */
export async function reloadCurrentUser() {
  const user = await getCurrentFirebaseUser();
  if (!user) return null;
  try {
    await user.reload();
    return user;
  } catch (err) {
    console.warn('[Firebase Auth] reload error:', err.message);
    return user;
  }
}

/**
 * Envoi email reset password (bonus, préparé pour futur)
 */
export async function sendPasswordResetEmail(email) {
  const auth = await getAuthInstance();
  if (!auth) {
    return { error: { code: 'firebase/not-configured', message: 'Firebase non configuré' } };
  }
  try {
    const { sendPasswordResetEmail: sendReset } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    await sendReset(auth, email);
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}
