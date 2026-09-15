/**
 * MarketPulse AI - Firebase Config
 * Phase 2A: Préparation Firebase Authentication (sans activation forcée)
 * 
 * IMPORTANT:
 * - Aucune clé secrète serveur ne doit être ajoutée ici
 * - La Web API Key Firebase n'est PAS un secret, mais elle ne doit pas être inventée
 * - Si le projet Firebase n'existe pas encore, ce fichier reste avec placeholders
 * - L'app doit continuer à fonctionner si config non renseignée
 */

/**
 * Configuration Firebase Web
 * 
 * Pour obtenir ces valeurs:
 * 1. Aller sur https://console.firebase.google.com
 * 2. Créer projet "marketpulse-ai" (ou nom choisi)
 * 3. Project Settings > General > Your apps > Web app
 * 4. Copier config
 * 
 * NE PAS COMMITTER de vraies valeurs sans .env si repo public
 * Pour Phase 2A, on utilise placeholders + chargement optionnel via window.__FIREBASE_CONFIG__
 */

// Option 1: Chargement via variable globale (permet injection sans commit)
// Ex: dans index.html avant main.js: <script>window.__FIREBASE_CONFIG__ = {apiKey: "...", ...}</script>
const injectedConfig = typeof window !== 'undefined' && window.__FIREBASE_CONFIG__ ? window.__FIREBASE_CONFIG__ : null;

// Option 2: Configuration Firebase réelle - Projet MarketPulse AI créé Phase 2A.1
// Source: Firebase Console > Project Settings > Web App
const realFirebaseConfig = {
  apiKey: "AIzaSyCXOPapKmB_P4TuIJMnLlhHx2chlrDXm7U",
  authDomain: "marketpulse-ai-48b08.firebaseapp.com",
  projectId: "marketpulse-ai-48b08",
  storageBucket: "marketpulse-ai-48b08.firebasestorage.app",
  messagingSenderId: "976077704942",
  appId: "1:976077704942:web:5ca71a3b4a520dbc4f6dff",
  measurementId: "G-KLL1JBTH9M"
};

// Config finale: injectée si disponible (permet override), sinon config réelle
export const firebaseConfig = injectedConfig || realFirebaseConfig;

/**
 * Vérifie si la config est valide (pas placeholder)
 * Phase 2A.1: retourne true avec config réelle
 */
export function isFirebaseConfigValid(config = firebaseConfig) {
  if (!config) return false;
  const placeholders = ["PLACEHOLDER", "YOUR_", "XXX"];
  const values = [config.apiKey, config.authDomain, config.projectId, config.appId];
  // Si une valeur contient PLACEHOLDER ou est vide => invalide
  return values.every(v => v && v.trim() !== "" && !placeholders.some(p => v.includes(p)));
}

/**
 * Alias pour compatibilité vérification Phase 2A.1
 * Le test demande isFirebaseConfigured() -> true
 */
export function isFirebaseConfigured(config = firebaseConfig) {
  return isFirebaseConfigValid(config);
}

/**
 * Messages d'aide pour setup
 */
export const FIREBASE_SETUP_INSTRUCTIONS = `
🔧 Configuration Firebase manquante (Phase 2A - normal si projet pas encore créé)

Étapes pour activer Firebase Auth:
1. Créer projet sur https://console.firebase.google.com
2. Activer Authentication > Sign-in method > Email/Password > Enable
3. Dans Project Settings > General > Web App, copier config
4. Option A (recommandée dev): dans index.html ajouter avant main.js:
   <script>
     window.__FIREBASE_CONFIG__ = {
       apiKey: "votre_apiKey",
       authDomain: "votre_project.firebaseapp.com",
       projectId: "votre_projectId",
       storageBucket: "votre_project.appspot.com",
       messagingSenderId: "123456789",
       appId: "1:123:web:abc"
     };
   </script>
5. Option B: remplacer placeholderConfig dans src/js/firebase/config.js (ne pas committer en public sans env)
6. Recharger app - Firebase Auth sera disponible sans casser ancien onboarding

Note: Web API Key n'est pas un secret serveur, mais ne pas exposer de secrets serveur (service account, etc.)
`;
