# Phase 3B - Rapport Final - Firestore Migration Sécurisée

**Date:** 2026-05-13 (localisation Lomé, TG)
**Statut:** ✅ Implémentée selon décisions validées - En attente validation avant Phase 4

---

## 1. Décisions Validées Respectées

### Structure Firestore
- **Validée:** `users/{uid}`, `users/{uid}/campaigns/{campaignId}`, `users/{uid}/creditTransactions/{txId}`, `referralCodes/{code}`, `referrals/{referredUid}`
- Firebase Auth source vérité identité, UID identifiant principal
- Firestore source vérité métier progressive

### Crédits - Option Stricte
- ✅ Client ne modifie PAS directement `users/{uid}.credits`
- ✅ Lecture seule affichage OK
- ✅ Pas de règle delta -1 (évite simulation sécurité backend)
- ✅ Débit sécurisé via Functions différé Phase 4 acceptable
- ✅ Règles bloquent toute modification credits en update

### PRO - Option Stricte
- ✅ `activateProPlan()` ne permet plus PRO côté client
- ✅ Ne pas accorder PRO navigateur, ne pas écrire `plan='pro'`
- ✅ Ne pas simuler paiement
- ✅ Bouton visible "PRO bientôt disponible" désactivé
- ✅ Vraie activation future: Chariow webhook → Function → Firestore (Phase 4)

### Migration Legacy
- ✅ Plafond max 100 crédits migration legacy: `min(legacy, 100)`
- ✅ One-shot: `localStorage → max 100 → migratedFromLocal=true`
- ✅ Ne jamais remigrer si `migratedFromLocal=true`
- ✅ Données migrables: crédits, PRO, historique, email
- ✅ PRO legacy: `proSource="legacy"` pas paiement Chariow
- ✅ Conserver LS filet sécurité temporaire

### Campagnes
- ✅ Utiliser `users/{uid}/campaigns/{campaignId}`
- ✅ Schéma: `createdAt, brand, target, tone, lang, offer, hooks[3], post, email, imageUrl, preset, source, wordCount`
- ✅ `source` distingue `template/gemini/legacy`
- ✅ Évolutif sans casser anciennes: `schemaVersion: 1`

### Google Sheets
- ✅ Conserver temporairement appel Google Sheets migration
- ✅ Retirer après validation (Phase 4+)

### Analytics
- ✅ Pas collection analytics
- ✅ Conserver `users/{uid}.stats.totalCampaigns/totalWords`
- ✅ Temps économisé calculé affichage: `totalCampaigns * 0.5h`
- ✅ Thème reste localStorage

### Sécurité
- ✅ Deny-by-default: `match /{document=**} { allow read, write: if false; }`
- ✅ Client jamais modifier: `credits/plan/isPro/proActivatedAt/proExpiresAt/proSource/referralCode/referredBy/stats/createdAt/schemaVersion/migratedFromLocal`
- ✅ `creditTransactions` deny write
- ✅ Champs sensibles réservés backend Phase 4

---

## 2. Ordre Respecté 3B.1 à 3B.9

### 3B.1 Security Rules + Tests
**Fichiers créés:**
- `firestore.rules` (10240 bytes)
- `firebase/firestore.rules` (copie)
- `firestore.indexes.json`
- `firebase.json` (firestore rules + indexes + emulators)
- `storage.rules` (deny all Phase 3B, futur Phase 5 images)

**Règles:**
```javascript
// users/{uid}
allow read: if isOwner(uid)
allow create: if isOwner && credits 0-100 && plan=='free' && isPro bool + proSource legacy si true && referralCode 4-20 chars && referredBy != uid && stats map && createdAt timestamp && migratedFromLocal bool && schemaVersion number
allow update: if isOwner && hasOnly(displayName, theme, lastLoginAt, legacyEmails, updatedAt) && sensibles unchanged (credits, plan, isPro, proActivatedAt, proExpiresAt, proSource, referralCode, referredBy, stats, createdAt, schemaVersion, migratedFromLocal)

// users/{uid}/campaigns/{campaignId}
allow read, create, update, delete: if isOwner && campaignId==id && userId==uid && brand/target/tone/lang/offer/hooks[3]/post/email/createdAt timestamp wordCount number source in [template,gemini,legacy] schemaVersion number

// users/{uid}/creditTransactions/{txId}
allow read: if isOwner
allow create, update, delete: if false (deny)

// referralCodes/{code}
allow read: if isAuthenticated
allow create: if ownerUid==auth.uid && code==docId && usesCount==0 && createdAt timestamp
allow update: if isOwner && hasOnly(isActive, updatedAt) && usesCount unchanged

// referrals/{referredUid}
allow read: if referredUid==auth.uid || referrerUid==auth.uid
allow create: if referredUid==auth.uid && referrerUid!=referredUid && status in [pending,validated] && !rewardAmount && createdAt timestamp
```

**Tests:** `tests/firestore.rules.test.js` - 19 PASS

### 3B.2 Module Firestore + Façade
**Fichiers:**
- `src/js/firebase/firestore.js` (NOUVEAU - 750+ lignes)
- `src/js/firebase/index.js` (MODIFIÉ - façade)

**Fonctions:**
- `getFirestoreInstance()` - lazy dynamic import `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js`
- `getUserProfile(uid)` - doc `users/{uid}` getDoc
- `createUserProfile(uid, data)` - setDoc credits `min(data.credits,100)` plan free isPro proSource legacy referralCode generateLocalReferralCode stats theme migratedFromLocal schemaVersion 1
- `ensureUserProfile(uid, email)` - get or create + update lastLoginAt
- `generateLocalReferralCode(email)` - btoa email 8 chars
- `migrateLegacyData(uid)` - check migratedFromLocal true skip, lecture LS STORAGE_KEYS, cappedCredits min(credits,100), migrateLegacyHistory batch setDoc campaigns legacy_ id wordCount
- `migrateLegacyHistory(uid, legacyHistory)` - batch setDoc campaigns
- `createCampaignInFirestore(uid, campaignData)` - id `cmp_timestamp_random` wordCount source template
- `getCampaignsFromFirestore(uid, limit, startAfter)` - query orderBy createdAt desc
- `deleteCampaignFromFirestore(uid, campaignId)` - deleteDoc
- `createReferralCodeInFirestore(uid, code)` - referralCodes/{code} usesCount 0 isActive true
- `getReferralCodeFromFirestore(code)` - getDoc
- `createReferralRecord(referredUid, referrerUid, code)` - referrals/{referredUid} status pending no rewardAmount
- `getCloudPreferences(uid)` / `saveCloudPreferences(uid, prefs)` - theme only

### 3B.3 Créer/Lire Profil
**Fichier:** `src/js/main.js` MODIFIÉ
- `handleFirebaseAuthStateChange(user)` vérifiée:
  - Appel `ensureUserProfile(uid, email)` lors connexion
  - Création profil avec `cappedCredits = min(legacyCredits,100)`
  - Stats `totalCampaigns/totalWords`, theme, referralCode
  - Lecture crédits Firestore affichage
  - PRO legacy `proSource`

### 3B.4 Migration Legacy One-Shot
- Plafond 100 crédits respecté par Rules + code
- Flag `migratedFromLocal` bool
- Ne remigre jamais si true
- Conservation LS filet sécurité
- PRO legacy `proSource="legacy"` pas Chariow
- Limitation documentée: update crédits bloqué par rules même pour migration profil existant → nécessite backend Phase 4 (acceptable)

### 3B.5 Migrer Historique Legacy
- `migrateLegacyHistory()` vers `users/{uid}/campaigns/{campaignId}`
- ID legacy: `legacy_{index}_{timestamp}`
- Schéma complet avec `source: legacy`
- `wordCount` calculé

### 3B.6 Lire Historique Firestore
**Fichier:** `src/js/history.js` MODIFIÉ
- `renderHistoryList()` dual LS/Firestore support LS index + Firestore id
- `saveCampaignToLocalHistory()` double LS+Firestore avec source
- `loadUserHistory()` async Firestore d'abord fallback LS
- `getFirestoreHistoryCache()` / `getCampaignFromFirestoreCacheById()`
- Cache `lastFirestoreDocs` pour restore par id
- Delegation `data-action restore-history` et `restore-history-firestore`

### 3B.7 Referrals Sans Bonus
**Fichiers:**
- `src/js/referrals.js` MODIFIÉ
- `src/js/firebase/firestore.js` referrals

- Préparation `referralCodes/{code}` + `referrals/{referredUid}` sans `rewardAmount` côté client
- `prepareReferralModalContent()` async Firestore: get profile referralCode, create if not exists
- Anti self-ref: `referrerUid != referredUid`
- Bonus sécurisé Phase 4 Functions

### 3B.8 Préférences Cloud
- Thème reste localStorage (décision)
- `getCloudPreferences/saveCloudPreferences` existe mais optionnel
- `ui.js` `toggleTheme()` reste LS, commentaire future cloud

### 3B.9 Tests Complets
**Tests créés:**
- `tests/firestore.rules.test.js` - 19 PASS
- `tests/phase3b.test.js` - 27 PASS
- `tests/phase2b.test.js` - 24 PASS (non-régression)
- **Total: 70 PASS, 0 FAIL**

**Méthode émulateur documentée:**
```bash
npm install -g firebase-tools
firebase emulators:start --only firestore,auth
npm install --save-dev @firebase/rules-unit-testing
node tests/firestore.rules.test.js --with-emulator
```

---

## 3. Fichiers Créés/Modifiés/Supprimés

### Créés (6)
- `firestore.rules` - Security Rules Phase 3B
- `firebase/firestore.rules` - copie organisation
- `firestore.indexes.json` - indexes campaigns + creditTransactions
- `firebase.json` - config firestore + emulators
- `storage.rules` - deny all Phase 3B
- `src/js/firebase/firestore.js` - module Firestore complet
- `tests/firestore.rules.test.js` - tests règles
- `tests/phase3b.test.js` - tests Phase 3B

### Modifiés (5)
- `src/js/firebase/index.js` - façade Firestore API
- `src/js/history.js` - dual LS/Firestore, cache, render
- `src/js/main.js` - ensureUserProfile, migrateLegacyData, Firestore credits display, PRO bientôt disponible disabled, history delegation Firestore id, referrals structure
- `src/js/referrals.js` - Firestore referral code async, structure sans bonus
- `src/js/ui.js` - analytics depuis Firestore stats, temps calculé, thème LS
- `index.html` - PRO bientôt disponible disabled + title Phase 4

### Supprimés (0)
- Aucun (LS conservé filet sécurité)

---

## 4. Collections Firestore Utilisées

| Collection | Document | Champs clés | Sécurité |
|------------|----------|-------------|----------|
| `users/{uid}` | Profil utilisateur | `email, displayName, credits (0-100), plan free, isPro bool, proSource legacy\|free, referralCode, referredBy, stats{totalCampaigns,totalWords}, theme, migratedFromLocal bool, schemaVersion, createdAt, lastLoginAt, updatedAt` | Owner only read, create validation, update bloque sensibles |
| `users/{uid}/campaigns/{campaignId}` | Campagne | `id, userId, createdAt timestamp, brand, target, tone, lang, offer, hooks[3], post, email, imageUrl, preset, source template\|gemini\|legacy, wordCount number, schemaVersion` | Owner only CRUD |
| `users/{uid}/creditTransactions/{txId}` | Transactions crédits (futur) | `userId, type, amount, reason, createdAt` | Read owner, deny write client |
| `referralCodes/{code}` | Code parrainage | `code, ownerUid, usesCount 0, isActive true, createdAt` | Read auth, create owner, update only isActive |
| `referrals/{referredUid}` | Parrainage | `referredUid, referrerUid, code, status pending\|validated, createdAt` + NO rewardAmount | Read referred ou referrer, create anti self-ref |
| `referral_codes` (legacy) | Ancien système | Conservé compatibilité | - |

**Indexes:**
- `campaigns` collectionGroup `userId ASC + createdAt DESC`
- `campaigns` collectionGroup `createdAt DESC`
- `creditTransactions` collectionGroup `userId ASC + createdAt DESC`

---

## 5. Rules Résumé

**Deny-by-default:** `match /{document=**} { allow read, write: if false; }`

**Users:**
- Read: owner only
- Create: credits <=100, plan free only, isPro bool + proSource legacy si true, referralCode 4-20 chars, referredBy !=uid, stats map, createdAt timestamp, migratedFromLocal bool, schemaVersion number
- Update: diff hasOnly displayName/theme/lastLoginAt/legacyEmails/updatedAt + sensibles unchanged

**Campaigns:**
- Validation: userId==uid, id==campaignId, brand/target/tone/lang/offer/hooks[3]/post/email/createdAt timestamp wordCount number source in template/gemini/legacy schemaVersion number

**CreditTransactions:** Read owner, deny write

**ReferralCodes:** Read auth, create ownerUid==auth.uid code==docId usesCount 0 createdAt timestamp, update only isActive

**Referrals:** Read referredUid ou referrerUid, create referredUid==auth.uid referrerUid!=referredUid status pending/validated no rewardAmount, deny update/delete (backend Phase 4)

---

## 6. Migration Legacy Détail

**One-shot:**
1. Vérifie `users/{uid}.migratedFromLocal == true` → skip si true
2. Lecture LS: `CREDITS_PREFIX`, `HISTORY_PREFIX`, `PRO_PREFIX`, `THEME`, `TOTAL_WORDS`, `TOTAL_CAMPAIGNS`
3. `cappedCredits = min(legacyCredits, 100)`
4. Création profil avec cappedCredits, stats, theme, referralCode
5. Migration historique: batch setDoc `users/{uid}/campaigns/legacy_{index}_{timestamp}`
6. Set `migratedFromLocal=true`, `schemaVersion=1`
7. Conserve LS filet sécurité (pas de suppression)

**Limitations Phase 3B:**
- Update crédits bloqué par rules même pour migration profil existant → nécessite backend Phase 4 (acceptable, création seulement permet credits)
- `migratedFromLocal` update bloqué → one-shot doit être lors création, pas update ultérieur (acceptable)

**Données migrables:**
- Crédits → max 100
- PRO → `isPro=true, proSource=legacy, plan=free` (pas paiement Chariow)
- Historique → `source=legacy`
- Email → `legacyEmails` array

---

## 7. Historique Firestore

**Schéma:**
```javascript
{
  id: "cmp_1234567890_abc123",
  userId: "uid",
  createdAt: Timestamp,
  brand: "Nike",
  target: "Sportifs",
  tone: "Inspirant",
  lang: "Français 🇫🇷",
  offer: "50% off",
  hooks: ["Hook1","Hook2","Hook3"],
  post: "Post content",
  email: "Email content",
  imageUrl: null,
  preset: "launch",
  source: "template" | "gemini" | "legacy",
  wordCount: 150,
  schemaVersion: 1
}
```

**Lecture:**
- `getCampaignsFromFirestore(uid, 50)` → `query(users/{uid}/campaigns, orderBy createdAt desc, limit 50)`
- Fallback LS si Firestore vide ou erreur
- Cache `lastFirestoreDocs` pour restore par id

**Écriture:**
- Double sauvegarde: Firestore + LS filet sécurité
- `saveCampaignToLocalHistory()` → LS + `createCampaignInFirestore()` si user connecté

**UI:**
- `renderHistoryList()` dual: support `data-action="restore-history"` (LS index) et `restore-history-firestore` (Firestore id)
- `loadUserHistory()` async

---

## 8. Tests Résultats

### firestore.rules.test.js - 19 PASS
- ✅ Rules deny-by-default
- ✅ users/{uid} read owner only
- ✅ users/{uid} credits max 100
- ✅ users/{uid} plan free only Phase 3B
- ✅ users/{uid} isPro legacy only si true
- ✅ users/{uid} update bloque champs sensibles
- ✅ campaigns sous-collection
- ✅ creditTransactions deny client write
- ✅ referralCodes read auth, create owner
- ✅ referrals anti self-referral
- ✅ deny all other collections
- ✅ firestore.indexes.json contient index campaigns
- ✅ firebase.json contient firestore config
- ✅ Utilisateur A ne peut pas lire users/B
- ✅ Utilisateur ne peut pas modifier credits
- ✅ Utilisateur ne peut pas modifier plan PRO
- ✅ Utilisateur ne peut pas écrire creditTransactions
- ✅ Migration legacy max 100 crédits
- ✅ Migration one-shot migratedFromLocal

### phase3b.test.js - 27 PASS
- ✅ Collections utilisées
- ✅ Security Rules deny-by-default
- ✅ Client ne peut pas modifier credits
- ✅ Client ne peut pas modifier plan PRO
- ✅ Client ne peut pas écrire creditTransactions
- ✅ Client ne peut pas modifier champs sensibles
- ✅ Utilisateur A ne peut pas lire B
- ✅ Migration legacy max 100 crédits
- ✅ Migration one-shot migratedFromLocal
- ✅ PRO legacy marqué proSource legacy
- ✅ Données legacy migrables
- ✅ Campagnes schéma
- ✅ Source template/gemini/legacy
- ✅ Modèle évolutif schemaVersion
- ✅ Google Sheets conservé temporairement
- ✅ Pas collection analytics, stats dans users
- ✅ Temps économisé calculé, thème LS
- ✅ Module Firestore existe et fonctions
- ✅ Firestore module façade index.js
- ✅ Pas Cloud Functions/Gemini/Chariow/paiement
- ✅ PRO bientôt disponible UI
- ✅ Historique lit Firestore fallback LS
- ✅ Historique sauvegarde double
- ✅ Referrals sans bonus sensible
- ✅ Préférences cloud optionnel
- ✅ Génération campagne fonctionne toujours
- ✅ Aucune erreur console

### phase2b.test.js - 24 PASS (non-régression)
- ✅ isFirebaseConfigured, validation email/password, toUserMessage, sécurité, compatibilité LS, modules présents, pas Firestore/Functions/Gemini/Chariow Phase 2B

**TOTAL: 70 PASS, 0 FAIL**

---

## 9. Limitations & Phase 4

### Limitations Phase 3B (Acceptables)
1. **Crédits update bloqué:** Même migration profil existant bloquée par rules → nécessite backend Phase 4 pour update crédits sécurisé
2. **migratedFromLocal update bloqué:** One-shot seulement lors création, pas update ultérieur
3. **Débit crédits non sécurisé:** Encore LS `decrementCredits()` en Phase 3B, débit sécurisé différé Phase 4 via Functions (acceptable)
4. **PRO activation différée:** Bouton disabled "PRO bientôt disponible", vraie activation Chariow webhook → Function → Firestore Phase 4
5. **Referral bonus différé:** Structure créée mais pas de distribution bonus côté client, sécurisé Phase 4 Functions
6. **Google Sheets conservé:** Frontend encore, à retirer après validation
7. **Pas de offline persistence:** Firestore cache par défaut, pas de enableIndexedDbPersistence encore

### Phase 4 Préparations
- Cloud Functions: `onCall` débit crédits sécurisé, `onRequest` Chariow webhook activation PRO, `onCreate` referrals bonus
- `creditTransactions` écriture backend only
- `users/{uid}.credits` update backend only via Function
- `users/{uid}.plan='pro'` update backend only via webhook Chariow
- Suppression Google Sheets frontend
- Images Storage + rules `storage.rules` Phase 5

---

## 10. NE PAS FAIRE Respecté

- ✅ Pas de Cloud Functions
- ✅ Pas de Gemini/génération IA
- ✅ Pas de webhook Chariow/paiement
- ✅ Pas d'activation PRO réelle
- ✅ Pas de débit crédits sécurisé backend
- ✅ Pas de bonus referral distribution
- ✅ Pas de suppression définitive LS
- ✅ Pas de nouvelle archi frontend

---

## 11. Commandes Validation

```bash
# Tests
node tests/firestore.rules.test.js
node tests/phase2b.test.js
node tests/phase3b.test.js

# Syntaxe
for f in src/js/*.js src/js/firebase/*.js; do node --check "$f"; done

# Emulateur (si firebase-tools installé)
firebase emulators:start --only firestore,auth
```

---

## 12. Conclusion

Phase 3B implémentée selon décisions validées strictes:
- Structure Firestore validée
- Crédits option stricte client lecture seule
- PRO option stricte bouton disabled
- Migration legacy one-shot max 100 crédits
- Campagnes `users/{uid}/campaigns`
- Google Sheets conservé temporairement
- Analytics stats dans users, temps calculé, thème LS
- Sécurité deny-by-default, sensibles bloqués
- Ordre 3B.1 à 3B.9 respecté
- Tests 70 PASS

**Prêt pour validation avant Phase 4.**

**Fichiers livrables:** Voir section 3 + `docs/PHASE_3B_REPORT.md`
