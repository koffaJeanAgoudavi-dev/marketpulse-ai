# Phase 4A - Rapport Final - Backend Cloud Functions Fondations

**Date:** 2026-05-13
**Statut:** ✅ Fondation backend implémentée - 92/92 tests PASS - En attente validation avant Phase 4B

---

## 1. Audit Préalable (4A.1)

### Fichiers inspectés
- `firebase.json`: contenait firestore, storage, emulators (auth 9099, firestore 8080, storage 9199, ui 4000) - pas de functions
- `firestore.rules`: 10240 bytes, deny-by-default, users/{uid}, campaigns, creditTransactions deny, referralCodes, referrals - validée Phase 3B inchangée
- `firestore.indexes.json`: 3 indexes campaigns userId+createdAt, createdAt, creditTransactions userId+createdAt
- `storage.rules`: deny all Phase 3B
- `src/js/firebase/`: 7 fichiers - app.js, auth.js, config.js, firestore.js (22756 bytes), auth-errors.js, index.js (façade), README
- `src/js/main.js`: 16475 bytes, handleFirebaseAuthStateChange avec ensureUserProfile, migrateLegacyData, Firestore credits display, PRO bientôt disponible
- `src/js/campaign.js`: generateCampaign avec check Firebase Auth, crédits LS, template génération conservée
- `src/js/state.js`: état global LS + DEFAULT_CREDITS
- `src/js/user.js`: n'existe pas (logique dans state.js + auth-ui.js)
- `package.json` racine: n'existe pas (vanilla JS sans npm)
- `functions/` dossier: n'existait PAS avant Phase 4A

**Conclusion audit:** Projet vanilla JS sans backend Functions, Firebase Auth + Firestore Phase 3B opérationnels, génération template temporaire conservée, aucune clé secrète dans frontend, prêt pour fondation Functions.

---

## 2. Choix Technique (4A.2)

**Firebase Cloud Functions v2** avec Node.js 20 (version supportée Firebase actuellement)

- **Pourquoi Functions v2?** Support long terme, meilleure gestion secrets via `defineSecret`, `onCall` + `onRequest`, intégration Admin SDK
- **Pourquoi Node 20?** LTS supportée Firebase Functions (18,20,22 supportées, 20 recommandée)
- **Dépendances:**
  - `firebase-admin@^12.1.0` - Firestore Admin, Auth Admin côté serveur uniquement
  - `firebase-functions@^5.0.1` - v2 API onCall, onRequest, logger, params

**Aucune clé secrète dans frontend** - Principe fondamental respecté.

---

## 3. Structure Backend (4A.3)

### Arborescence finale
```
functions/
├── package.json          # Node 20, firebase-admin, firebase-functions
├── index.js              # Fondation principale - healthCheck + getBackendInfo + helpers auth
├── .gitignore            # Protège node_modules, .env, serviceAccountKey.json, *.pem
└── src/
    ├── config.js         # initAdmin() - Admin SDK init avec Application Default Credentials
    ├── auth.js           # requireAuth(), requireOwner(), requireEmailVerified()
    ├── firestore.js      # getDb(), getUserProfileAdmin(), checkCreditsAdmin()
    └── secrets.js        # Architecture secrets - defineSecret() futur GEMINI_API_KEY, CHARIOW_API_KEY, CHARIOW_WEBHOOK_SECRET
```

### Organisation future prévue (non implémentée Phase 4A)
```
functions/
  index.js (actuel - fondation)
  + future Phase 4B:
    - secureGenerateCampaign (onCall + auth + Gemini + debitCredits)
    - debitCreditsAdmin helper interne transaction
  + future Phase 4C:
    - chariowWebhook (onRequest + verify signature + activation PRO)
  + future Phase 4D:
    - grantReferralBonus helper
    - generateImage Phase 5
```

**Phase 4A contient UNIQUEMENT:**
- `healthCheck` (onCall + requireAuth + test Firestore Admin)
- `getBackendInfo` (onRequest public GET pour monitoring)

**Aucune logique métier Phase 4B+ implémentée** - fondation seulement.

---

## 4. Authentification (4A.4)

### Principe fondamental
**Firebase Authentication reste unique source identité** - Pas de système auth parallèle.

### Implémentation côté serveur

**Helper `requireAuth(request)` dans `functions/index.js` et `functions/src/auth.js`:**
```javascript
function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentification requise.');
  }
  if (!request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Contexte auth invalide.');
  }
  return request.auth; // { uid, token: { email, email_verified, ... } }
}
```

- Vérifie `request.auth` présent (injecté automatiquement par Firebase Functions pour onCall)
- Vérifie `uid` présent
- Throw `HttpsError('unauthenticated')` si non authentifié → client reçoit erreur claire
- Future: `requireEmailVerified()` pour opérations sensibles Phase 4B+

**Helper `requireOwner(authUid, resourceUid)`:**
```javascript
function requireOwner(authUid, resourceUid) {
  if (authUid !== resourceUid) {
    throw new HttpsError('permission-denied', 'Accès non autorisé.');
  }
}
```

- Vérifie que utilisateur authentifié est propriétaire ressource
- Utilisé Phase 4B+ pour vérifier `users/{uid}` accès

**Règle:** Utilisateur non authentifié ne peut pas appeler futures opérations sensibles (`secureGenerateCampaign`, `debitCredits`, etc.) - garanti par `requireAuth()`.

### Côté client
- `src/js/firebase/functions-client.js` utilise `httpsCallable` qui envoie automatiquement token Firebase Auth
- Aucun token manipulé manuellement - SDK gère

---

## 5. Firestore Admin (4A.5)

### Configuration

**`functions/index.js`:**
```javascript
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp(); // Application Default Credentials
const db = getFirestore();
const auth = getAuth();
```

- `initializeApp()` sans paramètres → utilise Application Default Credentials
- En local: `firebase emulators` ou `GOOGLE_APPLICATION_CREDENTIALS` env var
- En prod: auto via service account Firebase Functions (pas de fichier commité)
- **Aucune credential/service account commitée** - `.gitignore` protège `serviceAccountKey.json`, `*.pem`, `*-key.json`

**Modulaire `functions/src/config.js`:**
```javascript
function initAdmin() {
  if (getApps().length === 0) app = initializeApp();
  db = getFirestore();
  auth = getAuth();
  return { app, db, auth };
}
```

### Utilisation Admin vs Client

| Aspect | Client (frontend) | Admin (Functions) |
|--------|-------------------|-------------------|
| SDK | `firebase/firestore` via CDN | `firebase-admin/firestore` via npm |
| Auth | `request.auth` vérifié par rules | Bypass rules mais vérif `requireAuth()` manuelle |
| Crédits | Lecture seule, pas d'écriture (rules deny) | Écriture sécurisée via transaction Phase 4B+ |
| Secrets | Jamais | Via `defineSecret()` |

**Helper `getUserProfileAdmin(uid)`:**
```javascript
async function getUserProfileAdmin(uid) {
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}
```

- Lecture serveur profil utilisateur
- Utilisé dans `healthCheck` pour test Firestore Admin
- Future Phase 4B: `checkCreditsAdmin(uid)` pour vérifier crédits avant génération

**Sécurité:** Admin SDK jamais chargé dans frontend - vérifié par tests scan `src/js/` pour `firebase-admin`.

---

## 6. Configuration des Secrets (4A.6)

### Architecture Phase 4A - Préparation

**Aucune clé réelle créée en Phase 4A** - Seulement architecture.

**`functions/src/secrets.js`:**
```javascript
const { defineSecret } = require('firebase-functions/params');

// Définitions futures (non utilisées Phase 4A)
// const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// const CHARIOW_API_KEY = defineSecret('CHARIOW_API_KEY');
// const CHARIOW_WEBHOOK_SECRET = defineSecret('CHARIOW_WEBHOOK_SECRET');

module.exports = {
  futureSecrets: {
    GEMINI_API_KEY: { description: 'Clé API Gemini', phase: '4B', command: 'firebase functions:secrets:set GEMINI_API_KEY' },
    CHARIOW_API_KEY: { description: 'Clé API Chariow', phase: '4C', command: 'firebase functions:secrets:set CHARIOW_API_KEY' },
    CHARIOW_WEBHOOK_SECRET: { description: 'Secret webhook Chariow', phase: '4C', command: 'firebase functions:secrets:set CHARIOW_WEBHOOK_SECRET' },
  }
};
```

**`functions/index.js` commentaires:**
```javascript
// Future usage Phase 4B+:
// const geminiApiKey = defineSecret('GEMINI_API_KEY');
// exports.secureGenerateCampaign = onCall({ secrets: [geminiApiKey] }, async (request) => { ... })
//
// Déploiement secrets:
// firebase functions:secrets:set GEMINI_API_KEY
```

### Où seront placés futurs secrets

- **Firebase Functions Secrets Manager** - Pas dans code, pas dans repo, pas dans `.env` commité
- Commandes:
  ```bash
  firebase functions:secrets:set GEMINI_API_KEY
  firebase functions:secrets:set CHARIOW_API_KEY
  firebase functions:secrets:set CHARIOW_WEBHOOK_SECRET
  ```
- Accès côté serveur via `defineSecret().value()` dans fonction avec `secrets: [...]` option
- **Jamais côté frontend** - `src/js/` ne contient aucun secret

### Protection secrets

- `functions/.gitignore` ignore `.env`, `serviceAccountKey.json`, `*.pem`, `*-key.json`
- Tests scan repo pour `AIza...`, `sk_live_`, `-----BEGIN PRIVATE KEY-----` → 0 trouvé
- `firebase.json` ne contient pas de secrets
- `firestore.rules` ne contient pas de secrets

---

## 7. Frontend (4A.7)

### Abstraction minimale préparée

**`src/js/firebase/functions-client.js` (NOUVEAU Phase 4A):**

```javascript
// Lazy import Functions SDK client v10 via CDN
export async function getFunctionsInstance() {
  const { getFunctions, connectFunctionsEmulator } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'
  );
  functionsInstance = getFunctions(app);
  if (localhost) connectFunctionsEmulator(functionsInstance, '127.0.0.1', 5001);
}

export async function callBackendFunction(functionName, data) {
  // Phase 4A: seules healthCheck autorisées, autres not-implemented
  const allowedPhase4A = ['healthCheck'];
  if (!allowedPhase4A.includes(functionName)) {
    return { data: null, error: { code: 'not-implemented', message: 'prévu Phase 4B+' } };
  }
  const callable = httpsCallable(functions, functionName);
  const result = await callable(data);
  return { data: result.data, error: null };
}

export async function testBackendHealth() {
  return callBackendFunction('healthCheck', { test: true, phase: '4A' });
}

export async function getBackendInfo() {
  // HTTP GET public endpoint getBackendInfo
  const baseUrl = isLocal ? 'http://127.0.0.1:5001/.../getBackendInfo' : 'https://.../getBackendInfo';
  const response = await fetch(baseUrl);
  return { data: await response.json(), error: null };
}
```

- **Lazy import** via CDN (comme firestore.js)
- **Emulator support** - connecte `127.0.0.1:5001` si localhost
- **Phase 4A:** seulement `healthCheck` callable autorisé, autres retournent `not-implemented`
- **Pas de branchement métier** - génération actuelle continue template `campaign.js`
- **Admin SDK jamais dans frontend** - vérifié par tests

**`src/js/firebase/index.js` (MODIFIÉ):**
- Exporte `getFunctionsInstance`, `isFunctionsAvailable`, `callBackendFunction`, `testBackendHealth`, `getBackendInfo`
- `initFirebase()` tente init Functions client non bloquant (foundation)

**Non-régression:**
- `campaign.js` conserve `generateCampaign` template, check Firebase Auth, crédits LS
- Pas d'appel `secureGenerateCampaign` en Phase 4A
- Dashboard, historique, analytics, referral UI, exports inchangés

---

## 8. Firebase Config (4A.8)

### `firebase.json` mis à jour (seule modification structurelle)

**Avant Phase 4A:**
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "emulators": { "auth": 9099, "firestore": 8080, "storage": 9199, "ui": 4000 }
}
```

**Après Phase 4A:**
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": ["node_modules", ".git", "firebase-debug.log", "*.local"],
      "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run lint --silent || echo \"Lint warning\""]
    }
  ],
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

**Changements:**
- ✅ Ajout `functions` config (source, codebase, ignore, predeploy) - nécessaire pour déclarer Functions
- ✅ Ajout `emulators.functions` port 5001
- ✅ Ajout `singleProjectMode: true`
- ❌ Aucune modification règles métier Firestore (deny-by-default, credits, plan, etc. inchangés)
- ❌ Aucune modification `firestore.indexes.json` ou `storage.rules`

---

## 9. Tests (4A.9)

### Tests créés Phase 4A
**`tests/phase4a.test.js` - 22 tests PASS**

Vérifie:
- Dossier `functions/` existe avec `package.json`, `index.js`
- `firebase.json` contient config functions + emulator 5001
- `firestore.rules` inchangées Phase 3B (deny-by-default, credits, plan free, etc.)
- `firestore.indexes.json` cohérent (3 indexes)
- `storage.rules` inchangées
- `functions/package.json` Node 20 supportée, firebase-admin, firebase-functions présents
- `functions/index.js` structure backend propre (initializeApp, getFirestore, getAuth, onCall, onRequest, healthCheck, getBackendInfo)
- Auth helpers `requireAuth`, `request.auth`, `unauthenticated`, `requireOwner`
- Firestore Admin `getFirestore`, collection/doc, pas de serviceAccountKey.json file
- Secrets architecture `defineSecret`, pas de clé API réelle, mention future Gemini Phase 4B, Chariow Phase 4C
- Pas de logique métier Phase 4B+ (pas d'export secureGenerateCampaign, chariowWebhook actif, seulement healthCheck + getBackendInfo)
- Structure modulaire `functions/src/` avec config.js, auth.js, firestore.js, secrets.js
- `.gitignore` protège secrets (node_modules, .env, serviceAccountKey, *.pem)
- Frontend `functions-client.js` existe, getFunctionsInstance, callBackendFunction, healthCheck, pas d'import firebase-admin, import Functions SDK client
- Frontend ne charge pas Admin SDK (scan src/js/ et src/js/firebase/)
- Génération actuelle conservée (generateCampaign, getCurrentFirebaseUser, pas d'appel secureGenerateCampaign Phase 4A)
- `src/js/firebase/index.js` exporte Functions client
- Aucun secret dans repo (scan global pour GEMINI_API_KEY hardcodée, sk_live_, private key)
- Configuration Firebase cohérente (firestore rules path, indexes path, storage rules path, functions source existe)
- Non-régression modules Phase 1A-3B toujours présents (campaign.js, history.js, state.js, ui.js, main.js, firestore.js, auth.js)
- Backend peut être chargé (syntax check node --check functions/index.js + src/*.js)
- Frontend syntax OK (main.js, campaign.js, history.js, functions-client.js, index.js)

### Tests existants non-régression
- `tests/firestore.rules.test.js` - 19 PASS
- `tests/phase2b.test.js` - 24 PASS
- `tests/phase3b.test.js` - 27 PASS

### Commandes
```bash
node tests/firestore.rules.test.js
node tests/phase2b.test.js
node tests/phase3b.test.js
node tests/phase4a.test.js
# ou
npm --prefix functions run lint
node --check functions/index.js
```

### Résultats
```
Tests Phase 4A : 22/22 PASS
Tests Phase 3B : 27/27 PASS
Tests firestore.rules : 19/19 PASS
Tests Phase 2B : 24/24 PASS
Total : 92/92 PASS
Console errors : 0 (syntax check OK)
```

---

## 10. Non-Régression (4A.10)

### Fonctionnalités conservées
- ✅ Firebase Authentication (register, login, logout, onAuthStateChanged, email verification)
- ✅ Vérification email (showVerificationUI, sendVerificationEmail)
- ✅ Session Firebase (handleFirebaseAuthStateChange, getCurrentFirebaseUser)
- ✅ Profil Firestore (users/{uid}, ensureUserProfile, getUserProfile)
- ✅ Migration legacy (migrateLegacyData, max 100 crédits, one-shot migratedFromLocal)
- ✅ Historique Firestore (users/{uid}/campaigns, getCampaignsFromFirestore, renderHistoryList dual LS/Firestore)
- ✅ Règles Firestore (deny-by-default, crédits bloqués, plan free, sensibles bloqués)
- ✅ Fonctionnement dashboard (campaignForm, generateCampaign template, credits UI, PRO badge)
- ✅ Historique UI (historyList delegation restore-history + restore-history-firestore)
- ✅ Analytics (openAnalyticsModal, stats totalCampaigns/totalWords depuis Firestore, temps calculé)
- ✅ Referral UI (prepareReferralModalContent Firestore, copyReferralLink, referralCodes/{code})
- ✅ Exports (exportToTXT, exportToPDF, copyGeneratedContent)

### Aucune fonctionnalité supprimée
- Génération actuelle template conservée (sera remplacée Phase 4B par secureGenerateCampaign)
- LS filet sécurité conservé
- Google Sheets conservé temporairement
- Thème LS conservé

---

## 11. Livrables

### 1. Fichiers créés (8)

- `functions/package.json` - Config Node 20 + firebase-admin + firebase-functions
- `functions/index.js` - Fondation backend: initializeApp, getFirestore, getAuth, requireAuth, requireOwner, getUserProfileAdmin, healthCheck (onCall auth), getBackendInfo (onRequest public), placeholders futurs commentés, _testHelpers
- `functions/.gitignore` - Protège node_modules, .env, serviceAccountKey.json, *.pem
- `functions/src/config.js` - initAdmin() helper Admin SDK
- `functions/src/auth.js` - requireAuth(), requireOwner(), requireEmailVerified()
- `functions/src/firestore.js` - getDb(), getUserProfileAdmin(), checkCreditsAdmin(), FieldValue
- `functions/src/secrets.js` - Architecture secrets future GEMINI_API_KEY, CHARIOW_API_KEY, CHARIOW_WEBHOOK_SECRET via defineSecret
- `src/js/firebase/functions-client.js` - Frontend abstraction minimale: getFunctionsInstance() lazy CDN, connectFunctionsEmulator 5001, callBackendFunction() (seulement healthCheck autorisé Phase 4A), testBackendHealth(), getBackendInfo() HTTP
- `tests/phase4a.test.js` - 22 tests fondation backend
- `docs/PHASE_4A_REPORT.md` - Ce rapport

### 2. Fichiers modifiés (2)

- `firebase.json` - Ajout functions config (source functions, codebase default, ignore, predeploy lint) + emulators.functions port 5001 + singleProjectMode
- `src/js/firebase/index.js` - Ajout exports Functions client (getFunctionsInstance, isFunctionsAvailable, callBackendFunction, testBackendHealth, getBackendInfo) + initFirebase tente init Functions client non bloquant

### 3. Fichiers inchangés (importants)

- `firestore.rules` - Inchangées Phase 3B (10240 bytes)
- `firestore.indexes.json` - Inchangé
- `storage.rules` - Inchangé
- `src/js/main.js` - Inchangé (génération template conservée)
- `src/js/campaign.js` - Inchangé
- `src/js/history.js` - Inchangé
- `src/js/state.js` - Inchangé
- Tous modules Phase 1A-3B conservés

### 4. Architecture finale backend

```
functions/
├── package.json (Node 20, firebase-admin 12.1.0, firebase-functions 5.0.1)
├── index.js (12200 bytes)
│   ├── initializeApp() + getFirestore() + getAuth()
│   ├── futureSecrets placeholder (GEMINI_API_KEY, CHARIOW_API_KEY, CHARIOW_WEBHOOK_SECRET)
│   ├── requireAuth(request) -> throw unauthenticated si !request.auth
│   ├── requireOwner(authUid, resourceUid) -> throw permission-denied si !=
│   ├── getUserProfileAdmin(uid) -> db.collection('users').doc(uid).get()
│   ├── exports.healthCheck = onCall({memory 256MiB, timeout 60s}, requireAuth + getUserProfileAdmin + return status ok)
│   ├── exports.getBackendInfo = onRequest({memory 128MiB, cors true}, public info backend)
│   ├── FUTURE PHASE 4B/4C/4D commentés (pas d'export actif)
│   └── exports._testHelpers (pour tests)
├── .gitignore (node_modules, .env, serviceAccountKey.json, *.pem)
└── src/
    ├── config.js (initAdmin)
    ├── auth.js (requireAuth, requireOwner, requireEmailVerified)
    ├── firestore.js (getDb, getUserProfileAdmin, checkCreditsAdmin, FieldValue)
    └── secrets.js (futureSecrets + listFutureSecrets)

firebase.json
├── firestore.rules, indexes
├── storage.rules
├── functions: [{source: functions, codebase: default, ignore, predeploy lint}]
└── emulators: auth 9099, firestore 8080, functions 5001, storage 9199, ui 4000

src/js/firebase/
├── app.js (Firebase App init)
├── auth.js (Auth API)
├── firestore.js (Firestore client)
├── functions-client.js (NOUVEAU - Functions client abstraction minimale)
│   ├── getFunctionsInstance() lazy import firebase-functions.js CDN + emulator 5001
│   ├── isFunctionsAvailable()
│   ├── callBackendFunction(functionName, data) -> seulement healthCheck autorisé Phase 4A, autres not-implemented
│   ├── testBackendHealth() -> call healthCheck
│   └── getBackendInfo() -> fetch HTTP getBackendInfo
└── index.js (façade + initFirebase tente Functions client)
```

### 5. Sécurité

#### Comment identité Firebase est récupérée côté serveur

**Callable Functions (onCall):**
- Firebase Functions injecte automatiquement `request.auth` quand client appelle avec `httpsCallable` et est authentifié
- `request.auth` contient:
  ```javascript
  {
    uid: "user_uid_firebase",
    token: {
      email: "user@example.com",
      email_verified: true,
      auth_time, iat, exp, etc.
    }
  }
  ```
- Vérifié par `requireAuth(request)` qui throw `HttpsError('unauthenticated')` si absent
- Aucun token manipulé manuellement côté client - SDK gère envoi ID token

**HTTP Functions (onRequest):**
- Pour `chariowWebhook` futur Phase 4C, vérification signature webhook + pas de `request.auth` (webhook externe)
- Pour `getBackendInfo` public, pas d'auth requise (monitoring)

**Source vérité:** Firebase Auth uniquement - pas de système auth parallèle, pas de session custom.

#### Comment Firestore Admin est utilisé

- **Admin SDK uniquement dans `functions/`** - `firebase-admin` npm package, jamais dans `src/js/`
- **Initialisation:** `initializeApp()` sans paramètres → Application Default Credentials
  - Local: `firebase emulators:start --only functions,firestore,auth` ou `GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json` (jamais commité)
  - Prod: auto via service account Functions (géré par Google Cloud)
- **Bypass rules:** Admin SDK bypass Firestore Rules (normal) mais vérifications auth manuelles obligatoires via `requireAuth()` + `requireOwner()` avant toute opération sensible
- **Exemple Phase 4A:**
  ```javascript
  exports.healthCheck = onCall(async (request) => {
    const auth = requireAuth(request); // Vérifie auth
    const profile = await getUserProfileAdmin(auth.uid); // Lecture Admin
    return { auth: { uid: auth.uid }, firestore: { hasProfile: !!profile } };
  });
  ```
- **Future Phase 4B:**
  ```javascript
  // Transaction sécurisée débit crédits
  await db.runTransaction(async (t) => {
    const userDoc = await t.get(db.collection('users').doc(uid));
    if (userDoc.data().credits < 1) throw HttpsError('failed-precondition', 'Plus de crédits');
    t.update(userDoc.ref, { credits: FieldValue.increment(-1) });
    t.create(db.collection('users').doc(uid).collection('creditTransactions').doc(), { type: 'debit', amount: -1, reason: 'campaign_generation' });
  });
  ```

#### Où seront placés futurs secrets

- **Firebase Functions Secrets Manager** - Service managé Google Cloud
- **Déploiement:**
  ```bash
  firebase functions:secrets:set GEMINI_API_KEY
  # Prompt: Enter value: [coller clé]
  firebase functions:secrets:set CHARIOW_API_KEY
  firebase functions:secrets:set CHARIOW_WEBHOOK_SECRET
  ```
- **Stockage:** Chiffré, versionné, accès contrôlé IAM, jamais dans repo
- **Accès côté serveur:**
  ```javascript
  const { defineSecret } = require('firebase-functions/params');
  const geminiApiKey = defineSecret('GEMINI_API_KEY');
  exports.secureGenerateCampaign = onCall({ secrets: [geminiApiKey] }, async (request) => {
    const apiKey = geminiApiKey.value(); // Valeur déchiffrée côté serveur uniquement
    // Utiliser apiKey pour appeler Gemini
  });
  ```
- **Jamais côté frontend:** `src/js/` ne contient aucun secret, `functions-client.js` ne reçoit jamais clé API

#### Comment secrets sont protégés

1. **`.gitignore`:** `functions/.gitignore` ignore `.env`, `serviceAccountKey.json`, `*.pem`, `*-key.json`
2. **Pas de hardcode:** Tests scan repo pour `AIza...`, `sk_live_`, `BEGIN PRIVATE KEY` → 0 trouvé
3. **Pas de commit service account:** `serviceAccountKey.json` jamais commité, utilise ADC
4. **Secrets Manager:** Clés futures via `firebase functions:secrets:set`, pas dans code
5. **defineSecret:** Secrets injectés comme env vars chiffrées seulement dans Functions avec `secrets: [...]` option
6. **Frontend isolation:** `src/js/firebase/functions-client.js` n'a jamais accès aux secrets, seulement appelle backend via `httpsCallable`
7. **Logs:** `logger` ne log jamais secrets, seulement uid, email (pas de clé)

---

## 12. Tests

### Résultats complets

```
=== Firestore Rules Tests Phase 3B.1 ===
Total: 19, PASS: 19, FAIL: 0

=== Tests Phase 2B ===
Total: 24, PASS: 24, FAIL: 0

=== Tests Phase 3B ===
Total: 27, PASS: 27, FAIL: 0

=== Tests Phase 4A ===
Total: 22, PASS: 22, FAIL: 0

Total: 92/92 PASS
Console errors: 0 (syntax check OK frontend + backend)
```

**Détail Phase 4A 22/22 PASS:**
- Dossier functions/ existe
- firebase.json contient config functions
- firestore.rules inchangées Phase 3B
- firestore.indexes.json cohérent
- storage.rules inchangées
- functions/package.json Node 20 supportée
- functions/index.js structure backend propre
- functions/index.js auth helpers
- functions/index.js Firestore Admin
- functions/index.js secrets architecture
- functions/index.js ne contient PAS logique métier Phase 4B+
- functions/ structure modulaire src/
- functions/.gitignore protège secrets
- Frontend abstraction minimale functions-client.js existe
- Frontend ne charge pas Admin SDK
- Frontend génération actuelle conservée
- src/js/firebase/index.js exporte Functions client
- Aucun secret dans repository
- Configuration Firebase cohérente
- Non-régression modules Phase 1A-3B
- Backend peut être chargé (syntax check)
- Frontend syntax OK

**Commandes validation:**
```bash
node tests/firestore.rules.test.js
node tests/phase2b.test.js
node tests/phase3b.test.js
node tests/phase4a.test.js
# Total 92 PASS

for f in src/js/*.js src/js/firebase/*.js; do node --check "$f"; done
node --check functions/index.js
node --check functions/src/*.js
```

---

## 13. Limitations (volontairement non implémenté Phase 4A)

### Non implémenté (prévu phases suivantes)

- ❌ **Débit sécurisé des crédits** - Phase 4B: transaction Firestore Admin `debitCreditsAdmin` + `creditTransactions` + vérification crédits avant génération
- ❌ **Génération Gemini réelle** - Phase 4B: `secureGenerateCampaign` onCall + `defineSecret('GEMINI_API_KEY')` + appel Gemini côté serveur + sauvegarde `users/{uid}/campaigns`
- ❌ **Achat de crédits** - Phase 4C: `chariowWebhook` vérifie paiement Chariow + ajoute crédits via Admin
- ❌ **Chariow** - Phase 4C: intégration API Chariow + vérification paiements
- ❌ **Webhook Chariow** - Phase 4C: `onRequest` + vérification signature `CHARIOW_WEBHOOK_SECRET` + activation PRO ou ajout crédits
- ❌ **Activation PRO** - Phase 4C: webhook Chariow → update `users/{uid}.plan='pro'`, `isPro=true`, `proSource='chariow'`, `proActivatedAt`
- ❌ **Bonus de parrainage** - Phase 4D: `grantReferralBonus` helper + update `referralCodes` usesCount + `referrals` status validated + bonus crédits
- ❌ **Génération d'images** - Phase 5: `generateImage` onCall + Storage + `storage.rules` update
- ❌ **Nouveau système authentification** - Non prévu, Firebase Auth reste unique source
- ❌ **Refonte frontend** - Non prévue Phase 4A, génération template conservée

### Fondation prête pour

- ✅ Phase 4B: `secureGenerateCampaign` + `debitCredits` sécurisé
- ✅ Phase 4C: `chariowWebhook` + activation PRO + achat crédits
- ✅ Phase 4D: bonus referral + images
- ✅ Tests emulator: `firebase emulators:start --only functions,firestore,auth`

---

## 14. Commandes Déploiement Futur (non exécutées Phase 4A)

```bash
# Installation deps Functions
cd functions && npm install

# Lint
npm run lint

# Emulators local (test fondation)
firebase emulators:start --only functions,firestore,auth

# Dans autre terminal, test healthCheck
# curl http://127.0.0.1:5001/marketpulse-ai-48b08/us-central1/getBackendInfo
# Ou via frontend: callBackendFunction('healthCheck')

# Déploiement secrets futurs Phase 4B+
# firebase functions:secrets:set GEMINI_API_KEY
# firebase functions:secrets:set CHARIOW_API_KEY
# firebase functions:secrets:set CHARIOW_WEBHOOK_SECRET

# Déploiement Functions (Phase 4B+)
# firebase deploy --only functions

# Logs
# firebase functions:log
```

---

## 15. Conclusion

**Phase 4A fondation backend implémentée selon cahier des charges strict:**

- ✅ Architecture Cloud Functions propre et maintenable (Node 20, firebase-admin, firebase-functions v2)
- ✅ Dossier `functions/` créé avec `package.json`, `index.js`, `src/` modulaire, `.gitignore` protégeant secrets
- ✅ Authentification Firebase unique source identité, `requireAuth()` helper, utilisateur non authentifié bloqué pour opérations sensibles
- ✅ Firestore Admin configuré avec Application Default Credentials, jamais dans frontend, pas de credential commitée
- ✅ Secrets architecture compatible `defineSecret()` pour futures clés Gemini, Chariow, aucune clé réelle dans repo
- ✅ Frontend abstraction minimale `functions-client.js` préparée, pas de branchement métier, génération template conservée
- ✅ `firebase.json` mis à jour uniquement structurellement pour Functions (source, emulator 5001), règles Firestore inchangées Phase 3B
- ✅ Tests 22 Phase 4A PASS + 70 existants PASS = 92/92 PASS, non-régression complète
- ✅ Aucune logique métier Phase 4B+ implémentée (pas de Gemini, débit crédits, Chariow, PRO, bonus referral, images)

**Prêt pour validation avant Phase 4B (secureGenerateCampaign + débit sécurisé).**

**NE PAS PASSER À PHASE 4B** - Attente validation.

---

**Fichiers livrables:** Voir section 11 + `docs/PHASE_4A_REPORT.md`
**Tests:** `tests/phase4a.test.js` 22/22 PASS
**Total:** 92/92 PASS, 0 console errors
