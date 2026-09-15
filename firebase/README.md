# Firebase - Architecture & Préparation Phase 2A

## Objectif Phase 2A
Préparer Firebase Authentication (Email/Password) sans remplacer l'onboarding localStorage actuel.

## Stack cible validée

- **Firebase Authentication** (Phase 2A - focus)
- Cloud Firestore (Phase 3)
- Cloud Functions (Phase 4+ Gemini, Phase 7 Chariow)
- Firebase Storage (Phase 5 images)

## Architecture prévue

### Dossier `firebase/` (racine - config infra)

```
firebase/
├── README.md (ce fichier)
├── firebase.json (à venir Phase 3 - config hosting/firestore/functions)
├── firestore.rules (à venir - RLS)
├── firestore.indexes.json (à venir)
├── storage.rules (à venir)
└── functions/
    ├── package.json (Node.js 20, firebase-functions, gemini)
    ├── index.js (exports: generateCampaign, handleChariowWebhook, etc.)
    └── gemini.js (appel Gemini côté serveur uniquement)
```

### Dossier `src/js/firebase/` (frontend - Phase 2A réalisé)

```
src/js/firebase/
├── config.js      -> firebaseConfig placeholder + isFirebaseConfigValid + instructions
├── app.js         -> initFirebaseApp() lazy, dynamic import SDK CDN, fallback localStorage
├── auth.js        -> API Auth: registerUser, loginUser, logoutFirebaseUser, getCurrentFirebaseUser,
│                    onFirebaseAuthStateChanged, sendVerificationEmail, isEmailVerified, etc.
├── index.js       -> point d'entrée, re-exports + initFirebase()
└── README.md      -> doc détaillée Phase 2A
```

## Configuration nécessaire (Phase 2A)

### 1. Créer projet Firebase

1. Aller sur https://console.firebase.google.com
2. Créer projet (ex: `marketpulse-ai`)
3. Désactiver Google Analytics si pas besoin (optionnel)

### 2. Activer Authentication

1. Console > Build > Authentication > Get started
2. Sign-in method > Email/Password > Enable > Save
3. (Ne pas activer Google OAuth encore - prévu plus tard)

### 3. Créer Web App & récupérer config

1. Project Settings > General > Your apps > Add app > Web `</>`
2. Register app `MarketPulse AI Web`
3. Copier config:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "marketpulse-ai.firebaseapp.com",
  projectId: "marketpulse-ai",
  storageBucket: "marketpulse-ai.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 4. Injecter config sans committer secrets

**Option A (recommandée dev local, Phase 2A):** Dans `index.html` avant `main.js`:

```html
<script>
  window.__FIREBASE_CONFIG__ = {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "..."
  };
</script>
```

**Option B:** Remplacer `placeholderConfig` dans `src/js/firebase/config.js` (ne pas committer si repo public, utiliser `.env` + Vite plus tard)

**Option C (future):** Utiliser Vite env `VITE_FIREBASE_API_KEY` + import.meta.env

### 5. Vérification email

- Firebase envoie automatiquement email de vérification si `sendVerificationEmail()` appelé
- Templates email customisables dans Console > Authentication > Templates
- L'utilisateur doit cliquer lien puis `reloadCurrentUser()` pour mettre à jour `emailVerified`

## Règles de sécurité à venir

### Authentication vs Firestore distinction

- **Authentication:** gère identité (UID, email, emailVerified, token)
- **Firestore:** gère données (users, campaigns, credits) liées à UID

### Firestore Rules (à venir Phase 3)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users: chacun ne peut lire/écrire que son doc UID
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    // Campaigns: liées à UID
    match /campaigns/{campaignId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
  }
}
```

### Pourquoi UID et pas email?

- Email peut changer, UID est stable et unique
- Sécurité: `request.auth.uid` fiable côté règles
- Migration prévue: `localStorage email` -> `Firebase UID`

## Parcours utilisateur futur (après Phase 2A)

1. User crée compte `registerUser(email, password)` -> Firebase crée UID
2. `sendVerificationEmail()` -> email reçu
3. User clique lien vérif -> `emailVerified = true`
4. `onAuthStateChanged` détecte session -> future migration localStorage vers Firestore liée UID
5. Ancien onboarding localStorage conservé pendant transition

## Phase 2A - Contraintes respectées

- ❌ Pas de Firestore
- ❌ Pas de collections
- ❌ Pas de migration historique/crédits/PRO
- ❌ Pas de Cloud Functions / Gemini / Chariow
- ❌ Pas de suppression localStorage / onboarding
- ✅ Auth Email/Password préparé, non bloquant
- ✅ App fonctionne si config manquante (fallback localStorage)

## Tests Phase 2A

- App démarre sans config Firebase (mode localStorage)
- Aucune erreur JS si placeholder
- Ancien onboarding fonctionne
- Génération, historique, crédits, PRO, exports, dark mode OK
- Si config valide injectée, `initFirebase()` initialise sans casser
- Console log indique mode

## Prochaines phases

- **Phase 2B:** UI login/register Firebase (en plus de l'ancien onboarding)
- **Phase 3:** Firestore + migration données vers UID
- **Phase 4:** Cloud Functions Gemini serveur
- **Phase 5:** Storage images IA
- **Phase 6:** Crédits serveur
- **Phase 7:** Chariow webhook

Aucune clé réelle dans ce README.
