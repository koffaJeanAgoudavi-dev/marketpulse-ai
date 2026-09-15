# Firebase - Module Frontend Phase 2A

## Objectif
Préparer Firebase Authentication (Email/Password) sans remplacer onboarding localStorage.

## Fichiers Phase 2A

```
src/js/firebase/
├── config.js   -> firebaseConfig placeholder + isFirebaseConfigValid() + instructions setup
├── app.js      -> initFirebaseApp() lazy, dynamic import SDK CDN v10, fallback null si config invalide
├── auth.js     -> API Auth complète + traduction erreurs
├── index.js    -> re-exports + initFirebase() non bloquant
└── README.md   -> ce fichier
```

## Détail fichiers

### config.js
- `firebaseConfig`: tente `window.__FIREBASE_CONFIG__` injectée, sinon placeholder `PLACEHOLDER_*`
- `isFirebaseConfigValid()`: détecte placeholder => false => mode localStorage
- `FIREBASE_SETUP_INSTRUCTIONS`: log console aide si config manquante
- Aucune fausse valeur en prod, placeholders explicites

### app.js
- `initFirebaseApp()`: dynamic import `https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js` uniquement si config valide
- Retourne `null` si config invalide => app continue
- `getFirebaseApp()`, `isFirebaseAvailable()`, `getFirebaseInitError()`
- Pas de clé secrète serveur, Web API Key seulement

### auth.js
API préparée (Email/Password uniquement, pas Google OAuth encore):

- `registerUser(email, password)` -> `{user, error}` via `createUserWithEmailAndPassword`
- `loginUser(email, password)` -> `{user, error}` via `signInWithEmailAndPassword`
- `logoutFirebaseUser()` -> signOut
- `getCurrentFirebaseUser()` -> `auth.currentUser` ou null
- `onFirebaseAuthStateChanged(callback)` -> écoute session, retourne unsubscribe no-op si non configuré
- `sendVerificationEmail()` -> envoie email vérif à currentUser
- `isEmailVerified()` -> bool
- `reloadCurrentUser()` -> reload après clic lien vérif
- `sendPasswordResetEmail(email)` -> bonus préparé
- `translateFirebaseAuthError(error)` -> messages FR compréhensibles:
  - email-already-in-use, invalid-email, weak-password, wrong-password/user-not-found, too-many-requests, network-request-failed, etc.

Toutes fonctions retournent `{user, error}` ou `{error}` sans throw, avec fallback si Firebase non configuré.

### index.js
- Re-exports config + app + auth
- `initFirebase()` -> init app + écoute `onFirebaseAuthStateChanged` log seulement (ne remplace pas localStorage)
- Non bloquant, appelé depuis `main.js` dans try/catch

## Utilisation future (Phase 2B+)

```js
import { registerUser, loginUser, sendVerificationEmail, translateFirebaseAuthError } from './firebase/index.js';

// Inscription
const { user, error } = await registerUser(email, password);
if (error) {
  showToast(translateFirebaseAuthError(error), 'error');
} else {
  await sendVerificationEmail();
  showToast('Vérifiez votre email', 'success');
}

// Connexion
const { user, error } = await loginUser(email, password);
if (user && !user.emailVerified) {
  showToast('Veuillez vérifier votre email', 'error');
}
```

## Pourquoi UID et pas email?

- Future Firestore: données liées à `user.uid` stable, pas email changeable
- Règles sécurité: `request.auth.uid == userId`
- Migration progressive: `localStorage email` -> `Firebase UID` -> `Firestore`

## Configuration nécessaire (pas encore)

Voir `firebase/README.md` pour étapes création projet Firebase.

Pour tester Phase 2A avec Firebase réel:

1. Créer projet Firebase
2. Activer Email/Password
3. Dans `index.html` avant `main.js`:

```html
<script>
  window.__FIREBASE_CONFIG__ = {
    apiKey: "xxx",
    authDomain: "xxx.firebaseapp.com",
    projectId: "xxx",
    storageBucket: "xxx.appspot.com",
    messagingSenderId: "xxx",
    appId: "xxx"
  };
</script>
```

4. Recharger - console doit afficher `🔥 Firebase Auth disponible`

## Contraintes Phase 2A respectées

- ❌ Pas de Firestore, pas de collections, pas de migration historique/crédits/PRO
- ❌ Pas de Cloud Functions, Gemini, Chariow
- ❌ Pas de suppression localStorage/onboarding
- ❌ Pas de Google OAuth (Email/Password seulement)
- ❌ Pas de React, pas de changement design
- ✅ Ancien système continue, Firebase optionnel non bloquant
- ✅ Aucune clé secrète serveur, placeholders documentés

## Tests

- `node --check src/js/firebase/*.js` OK
- App démarre sans config (mode localStorage)
- Aucune erreur JS si placeholder
- Si config valide injectée, init sans casser ancien onboarding

## Prochaines étapes

- Phase 2B: UI login/register Firebase en plus de l'ancien onboarding
- Phase 3: Firestore + migration UID
