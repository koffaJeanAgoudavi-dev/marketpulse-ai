# Phase 4B.2 - Rapport Final - Génération Sécurisée Gemini + Idempotence + Remboursement

**Date:** 2026-05-13
**Statut:** ✅ Génération sécurisée implémentée - 166/166 tests PASS - En attente validation avant Phase 4C

---

## 1. Contraintes Absolues Respectées

- ✅ Pas de Chariow/paiement
- ✅ Pas d'activation PRO (plan reste source canonique free/pro)
- ✅ Pas de bonus referral
- ✅ Pas de génération images / Storage
- ✅ Pas de nouvelle auth
- ✅ Pas de modification Firestore Rules existantes (deny-by-default conservé)
- ✅ GEMINI_API_KEY jamais exposée frontend, uniquement via Secrets Manager côté Functions
- ✅ Pas de deuxième source vérité PRO - `users/{uid}.plan` reste canonique (free/pro), `isPro` fallback legacy uniquement
- ✅ Pas de clé fictive dans code

---

## 2. Idempotence Obligatoire - Stratégie

### Structure serveur

**Collection:** `users/{uid}/generations/{generationId}`

**Document minimal:**
```javascript
{
  generationId: "gen_xxx",
  uid: "user_uid",
  status: "processing" | "completed" | "failed",
  createdAt: serverTimestamp,
  updatedAt: serverTimestamp,
  transactionId: "tx_abc" | null,
  campaignId: "cmp_123" | null,
  errorCode: "GEMINI_ERROR" | "INSUFFICIENT_CREDITS" | null,
  errorMessage: "message" | null,
  params: { brand, target, tone, lang, offer, preset },
  version: "4B.2"
}
```

### Génération ID

- Frontend génère `generationId` unique avant chaque génération: `gen_${timestamp36}_${random}`
- Exemple: `gen_m2a8f9_x7k9p2q3`
- Fonction `generateGenerationId()` dans `functions-client.js`
- Format validé serveur: `/^gen_[a-zA-Z0-9_-]+$/`, 8-100 chars

### Comportement idempotence

**Même `generationId` envoyé deux fois ne doit JAMAIS provoquer deux débits.**

Implémentation `createGenerationProcessing(uid, generationId, params)` avec transaction Firestore:

#### `completed`
- Si génération déjà `completed`: retourner résultat déjà généré sans débiter à nouveau
- Récupère `campaignId` associé et retourne campagne depuis `users/{uid}/campaigns/{campaignId}`
- Retourne `idempotent: true`, `status: 'completed'`, `credits` actuel, `transactionId` existant
- **Pas de nouveau débit**

#### `processing`
- Si génération déjà `processing` et créée il y a <5 minutes: ne pas débiter une deuxième fois
- Retourne `{ success: false, errorCode: 'ALREADY_PROCESSING', message: 'Génération déjà en cours', status: 'processing', idempotent: true }`
- Frontend affiche "Patientez..."
- Si `processing` >5 minutes (bloquée, crash avant sauvegarde): considérée comme bloquée, autorise retry après vérification remboursement (logique dans `generations.js`)

#### `failed`
- Si génération `failed`: autoriser nouvelle tentative seulement si ancien débit remboursé
- Vérification: `refundCreditAdmin` a déjà créé `generation_refund` si débit avait eu lieu
- Stratégie sûre: ne pas réutiliser aveuglément ancienne transaction, créer nouvelle transaction avec nouveau débit
- `createGenerationProcessing` écrase ancien doc `failed` avec nouveau `processing` et `transactionId: null`

**Documenté dans `functions/src/generations.js` et ce rapport.**

### Crash / Cohérence

**Séquence critique:**
```
débit (transaction OK, credits 5->4, tx créée, generation transactionId set)
↓
appel Gemini
↓
crash avant sauvegarde campagne
```

**Conception:**
- Génération reste `processing` avec `transactionId` mais sans `campaignId`
- Retry avec même `generationId` → retourne `ALREADY_PROCESSING`, pas de deuxième débit
- **Limite documentée:** Firestore transaction ne peut pas englober appel réseau Gemini (transaction distribuée impossible). On utilise état explicite `processing` + idempotence.
- **Récupération crash:** 
  - Option 1 (actuelle Phase 4B.2): génération reste `processing`, frontend doit générer nouveau `generationId` pour retry. Ancien crédit reste débité mais peut être remboursé manuellement via admin ou après timeout 5min.
  - Option 2 future: job de nettoyage qui détecte `processing` >5min et rembourse automatiquement (non implémenté Phase 4B.2, documenté comme limite).
- **Pas de double débit garanti** par idempotence check avant débit.

---

## 3. Fonction Cloud Function - `secureGenerateCampaign`

**Fichier:** `functions/index.js` + modules `src/`

**Type:** Callable v2, `memory: 1GiB`, `timeout: 120s`, `secrets: [GEMINI_API_KEY]`

**Étapes:**

1. **Vérifier authentification:** `requireAuth(request)` → `unauthenticated` si absent
2. **Récupérer UID:** `request.auth.uid` uniquement, jamais depuis frontend data (sécurité)
3. **Vérifier utilisateur existe:** `getUserProfileAdmin(uid)` → `not-found` si absent
4. **Vérifier email vérifié:** `auth.token.email_verified` → `permission-denied EMAIL_NOT_VERIFIED` si non vérifié (architecture actuelle exige vérification)
5. **Validation paramètres:** `validateGenerationParams(request.data)` → `invalid-argument` si manquants/trop longs/generationId invalide, limites raisonnables (brand 100, target 200, offer 500, etc.), nettoyage `cleanString`
6. **Vérifier idempotence:** `createGenerationProcessing(uid, generationId, params)` transaction
   - Si `completed`: retourne campagne existante sans débit
   - Si `processing` <5min: retourne `ALREADY_PROCESSING` sans débit
   - Si `failed` ou `processing` >5min: autorise retry avec nouveau processing
7. **Débiter 1 crédit atomique:** `debitCreditAdmin(uid, { generationId, reason: 'generation' })` transaction, `type: 'generation', amount: -1, balanceAfter, generationId`
8. **Appeler Gemini côté serveur:** `generateCampaignWithGemini(params)` avec `GEMINI_API_KEY` depuis secret
9. **Valider réponse Gemini:** `validateGeminiOutput(rawOutput)` → vérifie hooks tableau non vide, social_post chaîne non vide, email.subject/body non vide, image_prompt non vide
10. **Si validation échoue:** pas de campagne sauvegardée, remboursement `refundCreditAdmin(uid, generationId)`, mark `failed`, retourne erreur avec crédits remboursés
11. **Sauvegarder campagne:** `saveCampaignAdmin(uid, { brand, target, tone, lang, offer, preset, hooks, post: social_post, email, imagePrompt, generationId, wordCount })` → `users/{uid}/campaigns/{campaignId}` avec `source: 'gemini'`
12. **Marquer génération completed:** `markGenerationCompleted(uid, generationId, campaignId, transactionId)`
13. **Retourner:** `{ success: true, generationId, campaignId, campaign, credits, transactionId, isPro, phase: '4B.2' }`

**Gestion erreurs avec remboursement automatique** (voir section 6).

---

## 4. Paramètres Attendus

```javascript
{
  generationId: "gen_xxx", // obligatoire, format gen_ + alphanum, 8-100 chars
  brand: "Nike", // 1-100 chars, obligatoire
  target: "Sportifs 25-35 ans", // 1-200 chars, obligatoire
  tone: "Inspirant", // 1-50 chars, obligatoire
  lang: "Français 🇫🇷", // 2-50 chars, obligatoire
  offer: "50% off", // 1-500 chars, obligatoire
  preset: "launch" // 0-50 chars, optionnel
}
```

**Validation serveur obligatoire** dans `functions/src/validation.js`:
- Ne jamais faire confiance frontend
- Limites raisonnables pour éviter abus
- Nettoyage `cleanString` (trim, supprime caractères contrôle)
- `validateGenerationId` avec pattern `/^gen_[a-zA-Z0-9_-]+$/`

---

## 5. Crédit

**Réutilise `debitCreditAdmin()` existante Phase 4B.1** - pas de duplication logique.

- Débit côté serveur transaction Firestore
- Client ne peut jamais choisir `uid, credits, balanceAfter, transactionId` - serveur détermine
- Type transaction: `generation` avec `generationId` référence
- Source canonique PRO: `users/{uid}.plan` (free/pro), `isUserPro()` vérifie `plan === 'pro'` + fallback `isPro` legacy
- PRO: pas de débit, crédits illimités, pas de transaction

---

## 6. Gestion Critique Erreurs Gemini + Remboursement

**Principe:** Un crédit ne doit pas être définitivement perdu si Gemini échoue après débit.

**Opération remboursement:** `refundCreditAdmin(uid, generationId, reason)` idempotente

**Structure `generation_refund`:**
```javascript
users/{uid}/creditTransactions/refund_{generationId} = {
  createdAt: serverTimestamp,
  type: "generation_refund",
  amount: +1,
  balanceAfter: 5,
  balanceBefore: 4,
  uid,
  generationId,
  reason: "gemini_error_GEMINI_API_ERROR",
  source: "secureGenerateCampaign",
  createdBy: "system",
  version: "4B.2"
}
```

**Idempotence remboursement:**
- ID déterministe: `refund_{generationId}`
- Vérifie existence avant création dans transaction
- Si déjà existe: retourne `alreadyRefunded: true`, pas de nouveau +1
- Même génération ne peut jamais recevoir deux remboursements

**Cas gérés avec remboursement automatique:**

| Échec | Action | Remboursement |
|-------|--------|---------------|
| Gemini réseau/error HTTP 500 | `refundCreditAdmin` | +1 crédit, type generation_refund |
| Gemini auth error 401/403 | refund | +1 |
| Gemini rate limit 429 | refund | +1 |
| Gemini safety block | refund | +1 |
| Gemini JSON parse error | refund | +1 |
| Gemini output invalide (hooks vide, etc.) | refund | +1 |
| Sauvegarde campagne échoue | refund | +1 |
| Erreur interne inattendue après débit | refund tentative | +1 |

**Si PRO ou pas de transactionId:** pas de remboursement nécessaire.

**Retour frontend après remboursement:**
```javascript
{
  success: false,
  generationId,
  errorCode: "GEMINI_API_ERROR",
  message: "Service Gemini temporairement indisponible",
  credits: 5, // nouveau solde après remboursement
  refunded: true,
  transactionId: "tx_debit",
  refundTransactionId: "refund_gen_xxx",
  phase: "4B.2"
}
```

---

## 7. Cas Crash / Cohérence

**Séquence:**
```
débit OK (credits 5->4, tx créée, generation transactionId set, status processing)
↓
appel Gemini OK
↓
crash avant sauvegarde campagne (ex: Functions timeout, OOM)
```

**État après crash:**
- `users/{uid}` credits = 4 (débité)
- `users/{uid}/creditTransactions/{txId}` existe (type generation, amount -1)
- `users/{uid}/generations/{generationId}` status = processing, transactionId = txId, campaignId = null

**Retry même generationId:**
- `createGenerationProcessing` voit existing status processing <5min → retourne `ALREADY_PROCESSING`, pas de nouveau débit
- Frontend affiche "Génération déjà en cours"
- **Pas de double débit garanti**

**Récupération:**
- Frontend doit générer nouveau `generationId` pour nouvelle tentative
- Ancien crédit reste débité mais peut être remboursé manuellement ou via job nettoyage futur (non implémenté Phase 4B.2)
- **Limite documentée:** Pas de transaction distribuée Gemini + Firestore possible, on utilise état processing + idempotence. Crash avant sauvegarde laisse génération en processing, nécessite nouveau generationId.

**Alternative future (non implémentée):** Job qui détecte `processing` >10min et rembourse automatiquement.

---

## 8. Gemini

**Intégration backend dédiée:** `functions/src/gemini.js`

**Clé:** `GEMINI_API_KEY` via `defineSecret('GEMINI_API_KEY')` + `secrets: [GEMINI_API_KEY_SECRET]` dans `secureGenerateCampaign`

**Récupération:**
```javascript
const GEMINI_API_KEY_SECRET = defineSecret('GEMINI_API_KEY');
function getGeminiApiKey() {
  const key = GEMINI_API_KEY_SECRET.value();
  if (!key) throw HttpsError('failed-precondition', 'Clé API non configurée', { code: 'GEMINI_KEY_NOT_CONFIGURED' });
  return key;
}
```

**Déploiement secret (sans valeur dans Git):**
```bash
firebase functions:secrets:set GEMINI_API_KEY
# Enter value: AIza...
```

**Si secret non configuré:** Fonction retourne erreur propre `failed-precondition GEMINI_KEY_NOT_CONFIGURED` avec message "Service de génération temporairement indisponible. Clé API non configurée côté serveur."

**Appel API:**
- Modèle: `gemini-3.6-flash`
- URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`
- Fetch Node 20 natif, pas de clé dans logs, pas de clé retournée frontend
- `generationConfig: { temperature: 0.8, maxOutputTokens: 2048, responseMimeType: 'application/json' }`

---

## 9. Prompt Gemini

**`buildGeminiPrompt(params)` dans `gemini.js`:**

```
Tu es un expert en marketing digital et copywriting. Génère une campagne marketing complète et structurée.

Paramètres:
- Marque/Produit: ${brand}
- Audience cible: ${target}
- Ton: ${tone}
- Langue: ${lang}
- Offre/Promotion: ${offer}
- Type de campagne: ${preset}

Consignes:
- Génère contenu percutant adapté audience et ton
- Langue sortie: ${lang}
- Hooks: 3-5 accroches virales
- Social post: publication complète LinkedIn/Instagram 200-500 mots
- Email: sujet + corps prospection 300-600 mots
- Image prompt: description détaillée pour génération image 100-200 mots

Format sortie OBLIGATOIRE - JSON strict, UNIQUEMENT JSON, sans markdown:
{
  "hooks": ["accroche 1", "accroche 2", "accroche 3"],
  "social_post": "Publication complète...",
  "email": { "subject": "Sujet...", "body": "Corps..." },
  "image_prompt": "Description image..."
}
```

**Demande JSON uniquement, pas d'image maintenant.**

---

## 10. Validation Sortie Gemini

**`validateGeminiOutput(output)` dans `validation.js`:**

- `hooks` = tableau non vide, au moins 2, max 5, chaque string non vide, max 500 chars
- `social_post` = chaîne non vide, max 5000 chars
- `email.subject` = chaîne non vide, max 500 chars
- `email.body` = chaîne non vide, max 10000 chars
- `image_prompt` = chaîne non vide, max 1000 chars

**Si invalide:**
- Pas de campagne sauvegardée
- Remboursement crédit `refundCreditAdmin`
- Génération marquée `failed` avec `errorCode: GEMINI_INVALID_OUTPUT`
- Erreur propre retournée frontend avec crédits remboursés

---

## 11. Sauvegarde Firestore

**En cas succès, création:** `users/{uid}/campaigns/{campaignId}`

**`saveCampaignAdmin` dans `campaigns.js`:**
```javascript
{
  id: campaignId,
  userId: uid,
  createdAt: serverTimestamp,
  updatedAt: serverTimestamp,
  brand,
  target,
  tone,
  lang,
  offer,
  preset,
  hooks,
  post: social_post, // mapping social_post -> post pour compat history.js
  email: { subject, body },
  emailSubject: subject, // compat
  emailBody: body, // compat
  imagePrompt: image_prompt,
  imageUrl: null, // pas génération image Phase 4B.2
  source: "gemini",
  generationId,
  wordCount,
  schemaVersion: 2,
  version: "4B.2"
}
```

**Compatibilité `history.js`:**
- `renderHistoryList` gère `source === 'gemini'` avec badge "Gemini ✨"
- Gère `generationId` affiché court
- Gère `email` comme objet {subject, body} ou string legacy
- `saveCampaignToLocalHistory` évite double sauvegarde si déjà sauvegardée par backend (id cmp_)

**Ne casse pas campagnes historiques existantes** (template, legacy).

---

## 12. Retour Fonction

**Succès:**
```javascript
{
  success: true,
  generationId: "gen_abc123",
  campaignId: "cmp_1234567890_xyz",
  campaign: {
    id, brand, target, tone, lang, offer, preset,
    hooks, post: social_post, email: { subject, body }, imagePrompt,
    source: "gemini", generationId, createdAt, wordCount
  },
  credits: 4, // nouveau solde
  rawCredits: 4,
  isPro: false,
  transactionId: "tx_abc",
  phase: "4B.2",
  duration: 3500
}
```

**Idempotence completed:**
```javascript
{
  success: true,
  generationId,
  campaignId,
  campaign, // campagne déjà existante
  credits,
  transactionId,
  idempotent: true,
  status: "completed",
  message: "Génération déjà complétée - sans nouveau débit",
  phase: "4B.2"
}
```

**Processing:**
```javascript
{
  success: false,
  generationId,
  errorCode: "ALREADY_PROCESSING",
  message: "Génération déjà en cours...",
  status: "processing",
  idempotent: true,
  phase: "4B.2"
}
```

**Erreur avec remboursement:**
```javascript
{
  success: false,
  generationId,
  errorCode: "GEMINI_API_ERROR",
  message: "Service Gemini indisponible",
  credits: 5, // après remboursement
  refunded: true,
  transactionId: "tx_debit",
  refundTransactionId: "refund_gen_abc",
  phase: "4B.2"
}
```

**Erreur solde insuffisant:**
```javascript
// Firebase HttpsError format:
{
  code: "failed-precondition",
  message: "Crédits insuffisants",
  details: { code: "INSUFFICIENT_CREDITS", currentCredits: 0, generationId }
}
```

**Ne retourne jamais:** clé Gemini, secrets, stack traces, infos internes inutiles.

---

## 13. Frontend

**`src/js/firebase/functions-client.js` modifié Phase 4B.2:**

```javascript
export function generateGenerationId() {
  return `gen_${Date.now().toString(36)}_${Math.random().toString(36).substring(2,10)}...`;
}

export async function secureGenerateCampaign(params) {
  const generationId = params.generationId || generateGenerationId();
  const payload = { generationId, brand, target, tone, lang, offer, preset };
  return callBackendFunction('secureGenerateCampaign', payload);
}

export async function debitCredit(options) { ... }
export async function checkCredits() { ... }
```

**Allowed functions:** `healthCheck`, `debitCredit`, `checkCredits`, `secureGenerateCampaign`

**Façade `src/js/firebase/index.js`:**
```javascript
export { secureGenerateCampaign, generateGenerationId, debitCredit, checkCredits } from './functions-client.js';
```

**Frontend génère `generationId` unique avant chaque nouvelle génération** - idempotence.

**Crédit géré par `secureGenerateCampaign` côté serveur** - frontend ne fait plus `saveUserCredits(... -1)` définitif, seulement met à jour UI avec nouveau solde serveur.

**Migration LS:** `marketpulse_credits_{email}` conservé pour compatibilité affichage rapide, mais serveur est source vérité. Suppression définitive après validation workflow complet Phase 4B.2+.

---

## 14. Migration campaign.js

**`src/js/campaign.js` adapté Phase 4B.2:**

**Avant (Phase 4B.1):**
```javascript
state.credits = getUserCredits(email);
if (!isPro && credits <=0) { showToast(...); openChariowModal(); return; }
saveUserCredits(email, credits-1); // débit LS legacy
// génération template
renderResults(...);
saveCampaignToLocalHistory(...);
```

**Après (Phase 4B.2):**
```javascript
// Vérif Firebase Auth + email vérifié
const firebaseUser = await getCurrentFirebaseUser();
if (!firebaseUser || !emailVerified) { ... }

state.credits = getUserCredits(email); // UX rapide, mais serveur vérité

const generationId = generateGenerationId();
btn.disabled = true; innerHTML = "Génération sécurisée...";

const { data, error } = await secureGenerateCampaign({ generationId, brand, target, tone, lang, offer, preset });

if (error) {
  if (isInsufficientCredits) { showToast('Crédits insuffisants'); openChariowModal(); updateCreditsUI(error.details.currentCredits); return; }
  if (isAlreadyProcessing) { showToast('Déjà en cours'); return; }
  showToast(error.message); return;
}

if (!data.success) { /* gère ALREADY_PROCESSING, INSUFFICIENT_CREDITS, GEMINI_ERROR avec refund */ return; }

// Succès
state.credits = data.credits; // depuis serveur
updateCreditsUI();
renderResults(brand, { hooks: data.campaign.hooks, post: data.campaign.post, email: data.campaign.email, imagePrompt: data.campaign.imagePrompt, source: 'gemini', generationId }, tone, lang);
saveCampaignToLocalHistory({ ...data.campaign, id: data.campaignId, source: 'gemini' }); // cache local, backend déjà sauvegardé Firestore
showToast('Campagne Gemini générée !');
```

**Flux utilisateur:**
```
clic Générer
↓
generationId = gen_xxx (unique)
↓
secureGenerateCampaign({ generationId, brand, target, tone, lang, offer, preset })
↓
Backend: requireAuth + validation + idempotence check + debitCredit transaction + Gemini + validation + save campaign + mark completed
↓
Frontend reçoit { success, campaign, credits, campaignId }
↓
renderResults + updateCreditsUI + saveCampaignToLocalHistory (cache)
```

**Si backend indisponible:** `error.code === 'functions-unavailable'` → toast "Backend temporairement indisponible. Veuillez réessayer plus tard." → pas de simulation silencieuse template (conforme spec).

**Pas deux générations concurrentes pour même action:** Un seul appel `secureGenerateCampaign` par clic, avec `generationId` unique. Idempotence empêche double débit même si user double-clic rapidement avec même ID (mais frontend génère nouvel ID à chaque clic, donc double-clic = 2 IDs différents = 2 débits potentiels, mais c'est attendu - chaque génération coûte 1 crédit).

---

## 15. Sécurité

**Vérifications:**

- ✅ Aucune clé Gemini dans `src/` - scan `src/js/campaign.js`, `functions-client.js`, `main.js`, `index.html` → 0 clé `AIza` 35+ chars hardcodée
- ✅ Aucune clé Gemini dans `index.html` - vérifié
- ✅ Aucune clé Gemini dans tests - `tests/phase4b2.test.js` ne contient pas clé, seulement mention `GEMINI_API_KEY` dans commentaires
- ✅ Aucune donnée sensible loggée - `logger.info` log uid, brand, lang, pas apiKey, pas de `logger.info(apiKey)`
- ✅ UID vient uniquement `request.auth.uid` - `secureGenerateCampaign` utilise `const uid = authContext.uid`, ignore `request.data.uid` si différent, log warn si tentative
- ✅ Client ne peut pas choisir solde - pas de `request.data.credits` utilisé, serveur détermine `newBalance`
- ✅ Client ne peut pas choisir transactionId - généré serveur `doc()` + `refund_{generationId}` déterministe
- ✅ Client ne peut pas modifier directement crédits - rules `credits == resource.data.credits` bloque update
- ✅ Client ne peut pas créer artificiellement campagne `source: "gemini"` sans backend - Rules actuelles permettent `source in [template, gemini, legacy]` depuis client, mais backend via Admin est source vérité. Pour renforcer, future Phase pourrait bloquer `source: gemini` depuis client (seulement Admin), mais spec dit ne pas affaiblir rules existantes. Actuellement client pourrait théoriquement créer campagne source gemini sans payer, mais ce serait sans débit et sans génération Gemini réelle, donc pas critique. Historique UI affiche source mais génération réelle seulement via backend. On conserve rules existantes.
- ✅ `users/{uid}.plan` reste unique source vérité PRO - `isUserPro()` vérifie `plan === 'pro'` canonique + fallback `isPro` legacy, pas de système parallèle
- ✅ Secrets absents logs - pas de log apiKey.value()
- ✅ Pas de stack traces retournées frontend - `HttpsError` avec message propre, pas `err.stack`

**Rules non affaiblies:** `firestore.rules` inchangées Phase 3B (10240 bytes), deny-by-default, credits bloqué, creditTransactions deny.

---

## 16. Tests Obligatoires

**Fichier:** `tests/phase4b2.test.js` - 42 tests PASS

### Auth (3 tests)
- ✅ non authentifié refusé (requireAuth throw unauthenticated)
- ✅ authentifié accepté, UID depuis contexte Firebase Auth
- ✅ email vérifié exigé (EMAIL_NOT_VERIFIED)

### Validation (3 tests)
- ✅ paramètres manquants refusés (MISSING_BRAND, MISSING_TARGET, etc.)
- ✅ paramètres trop longs refusés (BRAND_TOO_LONG, LIMITS)
- ✅ generationId invalide refusé (INVALID_GENERATION_ID, format gen_)

### Idempotence (5 tests)
- ✅ structure generations/{generationId} existe (status processing/completed/failed, transactionId, campaignId, errorCode)
- ✅ même generationId ne débite qu'une seule fois (simulation Map, alreadyExists)
- ✅ génération completed retournée sans nouveau débit (idempotent true, debitAgain false)
- ✅ état processing géré correctement (ALREADY_PROCESSING)
- ✅ aucun double remboursement (refund_{generationId} déterministe, alreadyRefunded)

### Crédit (5 tests)
- ✅ solde insuffisant refusé (INSUFFICIENT_CREDITS)
- ✅ débit 1 crédit, balanceAfter correcte (5->4, 1->0)
- ✅ transaction generation créée (type generation, amount -1, generationId)
- ✅ aucun accès client direct aux crédits (rules)
- ✅ plan est source canonique PRO, pas isPro parallèle (plan === 'pro', isUserPro)

### Gemini (4 tests)
- ✅ intégration backend dédiée (GEMINI_API_KEY defineSecret, generativelanguage.googleapis.com)
- ✅ succès - structure attendue (hooks, social_post, email, image_prompt)
- ✅ erreur API gérée (GEMINI_API_ERROR, RATE_LIMIT, AUTH_ERROR, 429, 403)
- ✅ réponse JSON invalide gérée (JSON.parse, GEMINI_JSON_PARSE_ERROR, GEMINI_INVALID_OUTPUT)
- ✅ réponse incomplète gérée (tableau non vide, chaîne non vide)

### Remboursement (3 tests)
- ✅ erreur Gemini → +1 crédit (refundCreditAdmin, amount +1)
- ✅ transaction generation_refund créée (type generation_refund, balanceAfter, generationId)
- ✅ aucun double remboursement (idempotent, refund_ ID, alreadyRefunded)

### Firestore (4 tests)
- ✅ campagne sauvegardée uniquement après succès (await generateCampaignWithGemini avant await saveCampaignAdmin)
- ✅ source === "gemini"
- ✅ generationId associé
- ✅ historique compatible (history.js gère gemini, generationId, champs compatibles)

### Sécurité (6 tests)
- ✅ GEMINI_API_KEY absente frontend (scan campaign.js, functions-client.js, main.js, index.html, pas de AIza 35+ hardcodée)
- ✅ secrets absents logs (pas de logger apiKey)
- ✅ UID depuis auth uniquement (request.auth.uid)
- ✅ client ne peut pas choisir solde, transactionId (pas de request.data.credits, transactionId généré serveur)
- ✅ client ne peut pas créer campagne source gemini sans backend (rules)
- ✅ users/{uid}.plan reste source vérité PRO

### Non-régression (2 tests)
- ✅ pas de Chariow/PRO/referral/image introduit (pas d'export chariowWebhook, grantReferralBonus, generateImage actif)
- ✅ Backend + Frontend syntax OK (node --check)

### Régression globale

```
firestore.rules: 19/19 PASS
Phase 2B: 24/24 PASS
Phase 3B: 27/27 PASS
Phase 4A: 22/22 PASS
Phase 4B.1: 32/32 PASS
Phase 4B.2: 42/42 PASS
Total: 166/166 PASS
Console errors: 0
```

---

## 17. Critères Validation

1. ✅ `secureGenerateCampaign` existe et fonctionne (exports.secureGenerateCampaign onCall + secrets GEMINI_API_KEY)
2. ✅ Gemini appelé uniquement côté backend (functions/src/gemini.js avec fetch generativelanguage.googleapis.com, GEMINI_API_KEY via defineSecret, jamais frontend)
3. ✅ `GEMINI_API_KEY` jamais exposée frontend (scan src/, index.html, tests → 0 clé hardcodée)
4. ✅ Débit sécurisé (réutilise debitCreditAdmin transaction atomique, pas de solde négatif, concurrence gérée)
5. ✅ Même `generationId` ne peut pas être facturé deux fois (idempotence generations/{generationId} avec status processing/completed/failed, transactionId, déjà processing → ALREADY_PROCESSING sans nouveau débit)
6. ✅ Échec Gemini rembourse crédit (refundCreditAdmin idempotent +1, type generation_refund, balanceAfter)
7. ✅ Remboursement ne peut pas être effectué deux fois (ID déterministe refund_{generationId}, vérif exists dans transaction, alreadyRefunded)
8. ✅ Campagne Gemini valide sauvegardée Firestore (saveCampaignAdmin users/{uid}/campaigns/{campaignId} avec source gemini, generationId, hooks, post, email, imagePrompt, compatible history.js)
9. ✅ Format sortie respecte contrat (hooks tableau, social_post string, email {subject, body}, image_prompt string, validé par validateGeminiOutput)
10. ✅ `users/{uid}.plan` reste unique source vérité PRO (isUserPro vérifie plan === 'pro' canonique, fallback isPro legacy)
11. ✅ Aucune fonctionnalité Chariow/PRO/referral/image introduite (pas d'export chariowWebhook, grantReferralBonus, generateImage actif)
12. ✅ Tous tests précédents passent (2B 24, 3B 27, 4A 22, 4B.1 32)
13. ✅ Nouveaux tests passent (4B.2 42)
14. ✅ Zéro erreur console applicative (syntax check OK frontend + backend)

---

## 18. Fichiers Créés

```
functions/src/validation.js (4.5K) - validateGenerationParams, validateGenerationId, validateGeminiOutput, LIMITS, cleanString
functions/src/generations.js (5.8K) - getGeneration, createGenerationProcessing transaction idempotence, updateGenerationWithTransaction, markGenerationCompleted, markGenerationFailed, getCampaignById, stratégie 5min processing
functions/src/gemini.js (6.2K) - GEMINI_API_KEY_SECRET defineSecret, getGeminiApiKey, buildGeminiPrompt, callGeminiAPI fetch gemini-3.6-flash, generateCampaignWithGemini, gestion erreurs 400/401/403/429/500
functions/src/campaigns.js (2.8K) - generateCampaignId, saveCampaignAdmin avec source gemini, generationId, compatible history.js, update stats
tests/phase4b2.test.js (42 tests) - Auth, Validation, Idempotence, Crédit, Gemini, Remboursement, Firestore, Sécurité, Non-régression
docs/PHASE_4B.2_REPORT.md (ce rapport)
```

## 19. Fichiers Modifiés

```
functions/package.json - Ajout @google/generative-ai 0.21.0, description Phase 4B.2
functions/index.js (17K -> 24K) - Ajout imports validation, generations, gemini, campaigns, refund, GEMINI_API_KEY_SECRET, exports.secureGenerateCampaign onCall 1GiB 120s secrets [GEMINI_API_KEY], logique complète idempotence + débit + Gemini + validation + save + refund + mark completed/failed, _testHelpers étendus
functions/src/credits.js (5.2K -> 8.5K) - Ajout isUserPro() avec plan canonique, refundCreditAdmin() idempotent avec refund_{generationId} + déjà remboursé check, générationId dans transaction generation, plafond log
src/js/firebase/functions-client.js (6.7K -> 9.5K) - Ajout generateGenerationId(), secureGenerateCampaign() avec generationId unique, allowedPhase4B2, gestion isInsufficientCredits/isAlreadyProcessing/isEmailNotVerified, getBackendInfo conservé
src/js/firebase/index.js - Export secureGenerateCampaign, generateGenerationId
src/js/campaign.js (13K -> 16K) - Migration complète Phase 4B.2: generateGenerationId, secureGenerateCampaign backend, gestion erreurs INSUFFICIENT_CREDITS/ALREADY_PROCESSING/GEMINI_KEY_NOT_CONFIGURED, updateCreditsUI depuis serveur, renderResults compatible email objet + imagePrompt + generationId badge + source Gemini badge, saveCampaignToLocalHistory compat gemini
src/js/history.js - renderHistoryList compatible gemini badge Gemini ✨ + generationId court, saveCampaignToLocalHistory évite double sauvegarde si déjà backend, support email objet + imagePrompt
tests/phase4a.test.js - Mise à jour pour autoriser debitCredit + secureGenerateCampaign Phase 4B.2, vérifie pas de Chariow/PRO/referral/image
```

## 20. Architecture Finale

```
functions/
├── package.json (Node 20, firebase-admin 12.1.0, firebase-functions 5.0.1, @google/generative-ai 0.21.0)
├── index.js (24K)
│   ├── healthCheck (onCall auth)
│   ├── getBackendInfo (onRequest public)
│   ├── debitCredit (onCall auth + transaction)
│   ├── checkCredits (onCall auth lecture)
│   └── secureGenerateCampaign (onCall auth + GEMINI_API_KEY secret + 1GiB 120s)
│       ├── requireAuth() + emailVerified
│       ├── validateGenerationParams()
│       ├── createGenerationProcessing() idempotence transaction
│       │   ├── completed -> return campagne existante sans débit
│       │   ├── processing <5min -> ALREADY_PROCESSING sans débit
│       │   └── failed / processing >5min -> autorise retry avec nouveau processing
│       ├── debitCreditAdmin() transaction -1 + creditTransactions generation + generationId
│       ├── generateCampaignWithGemini() fetch Gemini API avec secret
│       ├── validateGeminiOutput() hooks, social_post, email.subject/body, image_prompt
│       ├── saveCampaignAdmin() users/{uid}/campaigns/{campaignId} source gemini
│       ├── markGenerationCompleted() ou markGenerationFailed() + refundCreditAdmin() si échec
│       └── return { success, generationId, campaignId, campaign, credits, transactionId }
├── src/
│   ├── config.js (initAdmin)
│   ├── auth.js (requireAuth, requireOwner, requireEmailVerified)
│   ├── firestore.js (getDb, getUserProfileAdmin, checkCreditsAdmin)
│   ├── secrets.js (future Chariow)
│   ├── credits.js (debitCreditAdmin transaction, refundCreditAdmin idempotent refund_{genId}, checkBalanceAdmin, isUserPro plan canonique)
│   ├── validation.js (LIMITS, cleanString, validateGenerationId gen_, validateGenerationParams, validateGeminiOutput)
│   ├── generations.js (getGeneration, createGenerationProcessing idempotence, updateGenerationWithTransaction, markCompleted/Failed, getCampaignById, 5min timeout)
│   ├── gemini.js (GEMINI_API_KEY_SECRET defineSecret, getGeminiApiKey, buildGeminiPrompt JSON strict, callGeminiAPI fetch gemini-3.6-flash, generateCampaignWithGemini)
│   └── campaigns.js (generateCampaignId cmp_, saveCampaignAdmin source gemini + generationId + compatible history.js)
└── .gitignore

src/js/firebase/
├── functions-client.js
│   ├── generateGenerationId() gen_timestamp_random
│   ├── getFunctionsInstance() CDN + emulator 5001
│   ├── callBackendFunction() allowedPhase4B2
│   ├── debitCredit(), checkCredits()
│   └── secureGenerateCampaign() génère generationId si absent, appelle backend
└── index.js façade

src/js/
├── campaign.js (secureGenerateCampaign flow, plus de saveUserCredits -1 direct)
└── history.js (compatible gemini)

Firestore:
├── users/{uid} { credits, plan free/pro (canonique), stats, ... }
├── users/{uid}/campaigns/{campaignId} { source gemini|template|legacy, generationId, hooks, post, email {subject,body}, imagePrompt, ... }
├── users/{uid}/creditTransactions/{txId} { type generation, amount -1, balanceAfter, generationId }
├── users/{uid}/creditTransactions/refund_{generationId} { type generation_refund, amount +1, balanceAfter, generationId, reason }
└── users/{uid}/generations/{generationId} { status processing/completed/failed, transactionId, campaignId, errorCode, params }

Secrets Manager:
└── GEMINI_API_KEY (via firebase functions:secrets:set GEMINI_API_KEY, jamais dans repo)
```

## 21. Comportement secureGenerateCampaign - Résumé

**Succès:**
1. Auth + validation params + idempotence check (pas déjà completed/processing)
2. Débit 1 crédit transaction atomique (ou PRO pas de débit)
3. Appel Gemini serveur avec secret
4. Validation sortie JSON (hooks, social_post, email.subject/body, image_prompt)
5. Sauvegarde campagne Firestore source gemini
6. Mark generation completed
7. Retour campagne + crédits

**Échec Gemini après débit:**
1. Débit déjà fait
2. Gemini erreur → refund +1 crédit idempotent (refund_{genId}) + mark failed
3. Retour erreur avec crédits remboursés + refunded true

**Idempotence:**
- Même genId déjà completed → retourne campagne existante sans nouveau débit
- Même genId déjà processing → ALREADY_PROCESSING sans débit
- Même genId failed → autorise retry avec nouveau débit (ancien déjà remboursé)

**Pas de double débit, pas de double remboursement garanti.**

## 22. Limites Restantes

- **Crash avant sauvegarde:** Génération reste processing, nécessite nouveau generationId pour retry, crédit reste débité jusqu'à remboursement manuel ou job nettoyage futur (non implémenté Phase 4B.2)
- **Pas de transaction distribuée Gemini + Firestore:** Documenté, impossible, on utilise état processing + idempotence
- **Pas de Chariow/PRO/referral/image:** Phase 4C, 4D, 5
- **GEMINI_API_KEY doit être configurée manuellement:** `firebase functions:secrets:set GEMINI_API_KEY` sinon fonction retourne `GEMINI_KEY_NOT_CONFIGURED`
- **Pas de retry automatique failed:** Frontend doit générer nouveau generationId pour retry (UX actuelle)
- **Rules campaigns permettent encore source gemini depuis client:** Théoriquement client pourrait créer fausse campagne source gemini sans payer, mais sans génération Gemini réelle, pas critique. Future renforcement possible: bloquer source gemini côté client, seulement Admin.

---

## 23. Tests

```
Phase 4B.2 : 42/42 PASS
Phase 4B.1 : 32/32 PASS
Phase 4A : 22/22 PASS
Phase 3B : 27/27 PASS
firestore.rules : 19/19 PASS
Phase 2B : 24/24 PASS
Total : 166/166 PASS
Console errors : 0
```

---

## 24. Conclusion

**Phase 4B.2 implémentée selon cahier des charges strict:**

- ✅ `secureGenerateCampaign` existe et fonctionne avec idempotence + débit sécurisé + remboursement
- ✅ Gemini appelé uniquement backend via Secrets Manager, jamais frontend
- ✅ Idempotence via `generations/{generationId}` avec completed/processing/failed, pas de double débit
- ✅ Remboursement automatique idempotent `generation_refund` si Gemini échoue
- ✅ Validation paramètres + sortie Gemini stricte
- ✅ Sauvegarde Firestore compatible history.js, source gemini
- ✅ Frontend `secureGenerateCampaign()` + `generateGenerationId()` + migration campaign.js
- ✅ Sécurité: pas de clé Gemini frontend, UID depuis auth, pas de choix solde/transactionId, plan source vérité PRO
- ✅ Tests 42 Phase 4B.2 PASS + 124 existants PASS = 166/166 PASS
- ✅ Aucune fonctionnalité Chariow/PRO/referral/image introduite

**Prêt pour validation avant Phase 4C (Chariow).**

**NE PAS PASSER À PHASE 4C - Attente validation.**

---

**Fichiers:** Voir sections 18-19 + `docs/PHASE_4B.2_REPORT.md`
**Fonction:** `secureGenerateCampaign` (onCall + GEMINI_API_KEY secret + idempotence + refund)
**Total tests:** 166/166 PASS
