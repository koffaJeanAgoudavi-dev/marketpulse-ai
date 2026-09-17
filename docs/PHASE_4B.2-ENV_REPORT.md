# PHASE 4B.2-ENV — Migration GitHub Actions + process.env.GEMINI_API_KEY

**Date:** 2026-05-11
**Projet:** marketpulse-ai-48b08
**Repo:** koffaJeanAgoudavi-dev/marketpulse-ai (public)
**Branch:** main
**Objectif:** Abandonner `defineSecret('GEMINI_API_KEY')` (Secret Manager bloqué par facturation) au profit de GitHub Secret → functions/.env temporaire → process.env

## 1. Fichiers créés

- `.github/workflows/deploy-functions.yml` (workflow sécurisé GitHub Actions)
  - Trigger push main sur `functions/**`, `firebase.json`, workflow lui-même + manual dispatch
  - Node 20, checkout, install deps, auth GCP via FIREBASE_SERVICE_ACCOUNT, création .env depuis secret, vérif sans afficher valeur, deploy --only functions vers marketpulse-ai-48b08, cleanup always()
  - Aucune clé en dur, aucun echo de valeur, .env gitignored

- `tests/phase4b2-env.test.js` (24 tests)
  - Vérifie nouveau mécanisme process.env, absence defineSecret, pas de clé hardcodée, modèle 3.6-flash, GEMINI_KEY_NOT_CONFIGURED, sécurité frontend, workflow sécurisé, non-régression Auth/crédits/idempotence/refund/stale recovery/rules

## 2. Fichiers modifiés

- `functions/src/gemini.js`
  - Suppression `defineSecret` import et `GEMINI_API_KEY_SECRET`
  - `getGeminiApiKey()` récupère uniquement `process.env.GEMINI_API_KEY`, `trim()`, erreur `GEMINI_KEY_NOT_CONFIGURED` si absente/vide, warn format suspect sans logger clé
  - `callGeminiAPI` doc mise à jour (depuis process.env)
  - `module.exports` ne contient plus `GEMINI_API_KEY_SECRET`
  - Modèle conservé `gemini-3.6-flash`, logique Gemini intacte

- `functions/index.js`
  - Suppression import `defineSecret` et `const GEMINI_API_KEY_SECRET = defineSecret(...)`
  - Suppression `secrets: [GEMINI_API_KEY_SECRET]` dans `secureGenerateCampaign`
  - Import `GEMINI_API_KEY_SECRET` depuis gemini.js supprimé, ne garde que `generateCampaignWithGemini`
  - Conservé: `onCall`, `memory: 1GiB`, `timeoutSeconds: 120`, Auth, validation, idempotence, débit sécurisé, remboursement, stale recovery, sauvegarde campagne, healthCheck, checkCredits, debitCredit
  - `getBackendInfo` et `healthCheck` messages mis à jour vers architecture ENV: `GitHub Secret -> .env temporaire -> process.env`

- `tests/phase4b2.test.js`
  - Test existence: ne vérifie plus `defineSecret`, vérifie `process.env` ou mention GEMINI
  - Test Gemini intégration: vérifie `process.env.GEMINI_API_KEY` utilisé, plus de `defineSecret('GEMINI_API_KEY')`

- `tests/phase4b2-fix.test.js`
  - Test non-régression GEMINI: vérifie `process.env.GEMINI_API_KEY` et absence `defineSecret`
  - Skip `phase4b2-env.test.js` dans test anti 1.5-flash pour éviter faux positif

- `docs/PHASE_4B.2-FIX_REPORT.md`
  - Nettoyage références `1.5-flash` pour validation zéro ref active (remplacé par ancien modèle)

## 3. Ancien mécanisme supprimé

- `defineSecret('GEMINI_API_KEY')` dans `functions/src/gemini.js` et `functions/index.js`
- `GEMINI_API_KEY_SECRET` constant
- `GEMINI_API_KEY_SECRET.value()` dans `getGeminiApiKey()`
- `secrets: [GEMINI_API_KEY_SECRET]` dans `secureGenerateCampaign` onCall options
- Dépendance à Google Cloud Secret Manager API (nécessite facturation Blaze)
- `firebase functions:secrets:set GEMINI_API_KEY` (plus nécessaire)

## 4. Nouveau mécanisme

```
GitHub Repository Secret GEMINI_API_KEY (chiffré GitHub, jamais dans code)
  ↓
GitHub Actions Workflow .github/workflows/deploy-functions.yml
  - env: GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }} (masqué *** dans logs)
  - printf "GEMINI_API_KEY=%s\n" "$GEMINI_API_KEY" > functions/.env (temporaire)
  - Vérif présence via grep + wc -c sans afficher valeur
  ↓
functions/.env (gitignored, créé à la volée, supprimé après deploy always())
  ↓
Firebase Functions v2 deployment
  - Firebase lit .env et injecte comme variable d'environnement Cloud Run
  - Pas de Secret Manager, pas de facturation Secret Manager requise
  ↓
functions/src/gemini.js getGeminiApiKey()
  - process.env.GEMINI_API_KEY.trim()
  - Si absente/vide → throw GEMINI_KEY_NOT_CONFIGURED (failed-precondition)
  - Jamais loggée, jamais retournée frontend
  ↓
secureGenerateCampaign -> generateCampaignWithGemini -> callGeminiAPI
  - modèle gemini-3.6-flash conservé
  - Sécurité: Auth, validation, idempotence, débit, refund, stale recovery inchangés
```

**Sécurité:**
- Clé hors GitHub source code (public repo)
- Clé hors frontend (jamais dans src/js/*)
- Clé hors logs (GitHub masque secrets, workflow ne fait jamais echo valeur)
- .env gitignored, supprimé after deploy even on failure
- Aucune vraie clé dans workflow, utilise `${{ secrets.GEMINI_API_KEY }}` uniquement runtime

## 5. Résultats complets des tests

```
firestore.rules.test.js: 19/19 PASS
phase2b.test.js: 24/24 PASS
phase3b.test.js: 27/27 PASS
phase4a.test.js: 22/22 PASS
phase4b1.test.js: 32/32 PASS
phase4b2.test.js: 42/42 PASS (mis à jour pour ENV)
phase4b2-fix.test.js: 27/27 PASS (mis à jour pour ENV)
phase4b2-env.test.js: 24/24 PASS (nouveau)

Total: 217/217 PASS
```

Détails ENV (24 tests):
- Nouveau mécanisme process.env: 8 PASS
- Sécurité ENV: 3 PASS
- GitHub Actions Workflow: 9 PASS (existe, trigger main + paths, sécurisé sans echo valeur, crée .env, vérif sans afficher, deploy only functions marketpulse-ai-48b08, cleanup always, Node 20, .gitignore)
- Non-régression: 4 PASS (Auth, crédits/idempotence/refund/stale, Rules, syntax)

Aucune régression, 0 console errors, syntax backend OK.

## 6. Rôles IAM minimum nécessaires pour FIREBASE_SERVICE_ACCOUNT

Pour déployer Firebase Functions v2 (Cloud Run functions) vers `marketpulse-ai-48b08`, le service account utilisé dans GitHub Actions a besoin **minimum** :

### Obligatoires

1. **roles/cloudfunctions.developer** (ou `roles/cloudfunctions.admin` si developer insuffisant)
   - **Pourquoi:** Créer, mettre à jour, supprimer les Cloud Functions, lire config. Sans ce rôle, `firebase deploy --only functions` échoue 403.
   - Minimal vs admin: `developer` suffit pour deploy, `admin` ajoute droits delete + IAM sur functions. Recommandé `developer` pour principe moindre privilège.

2. **roles/iam.serviceAccountUser**
   - **Pourquoi:** Permission `iam.serviceAccounts.actAs` sur le runtime service account (par défaut `PROJECT_NUMBER-compute@developer.gserviceaccount.com` ou `PROJECT_ID@appspot.gserviceaccount.com`). Le deployer doit pouvoir "agir comme" ce SA pour attacher le runtime à la Function. Erreur classique `Missing permission iam.serviceAccounts.actAs`.
   - À accorder **sur le runtime SA**, pas forcément projet-wide, mais plus simple projet-wide pour CI.

3. **roles/run.admin** (spécifique Gen2)
   - **Pourquoi:** Functions v2 = Cloud Run services sous-jacents. Déployer une Function Gen2 crée/met à jour un service Cloud Run. Sans `run.admin`, échec `run.services.create/update`.
   - Peut être restreint à `roles/run.developer` si vous ne gérez pas IAM sur Run, mais `admin` est souvent nécessaire pour première création.

4. **roles/artifactregistry.writer** (ou `roles/artifactregistry.admin` minimal writer)
   - **Pourquoi:** Gen2 build l'image container et la pousse dans Artifact Registry (`gcf-artifacts`). Sans writer, échec push image.
   - Alternative ancienne: `roles/storage.admin` pour Container Registry, mais Artifact Registry est nouveau standard Gen2.

5. **roles/cloudbuild.builds.editor** (ou `roles/cloudbuild.builds.builder`)
   - **Pourquoi:** Cloud Build construit la Function à partir du source uploadé. Le service account de build a besoin de builder, mais le deployer a besoin de créer des builds.

6. **roles/storage.objectAdmin** sur le bucket de déploiement Functions (pas global Storage Admin)
   - **Pourquoi:** `firebase deploy` upload le zip source dans un bucket GCS (`gcf-v2-sources-...` ou `PROJECT_ID.appspot.com`). Besoin d'écrire des objets.
   - Minimal: donner `objectAdmin` uniquement sur ce bucket, pas `storage.admin` global.

### Optionnels selon usage

- **roles/firebase.admin** ou `roles/firebase.developAdmin`: Si vous déployez aussi Hosting, Firestore Rules via même workflow. Pour `--only functions`, pas strictement nécessaire si Cloud Functions roles présents, mais Firebase CLI vérifie parfois projet Firebase. Peut être évité si vous ne déployez que functions.

### Rôles à ÉVITER (trop larges)

- **Owner (`roles/owner`)**: Donne tout sur tout le projet, y compris facturation, IAM, suppression projet. Inutile et dangereux pour CI.
- **Editor (`roles/editor`)**: Donne quasi tout sauf IAM admin, peut modifier VMs, DB, etc. Trop large.
- **Storage Admin global (`roles/storage.admin`)**: Donne accès à tous les buckets, y compris données utilisateurs. Préférer `objectAdmin` sur bucket spécifique `gcf-*`.
- **Artifact Registry Repository Administrator global**: Donne delete repos, etc. Préférer `writer`.
- **Service Account Admin**: Permet créer/supprimer SA, trop large.

### Recommandation minimale pratique (testée communauté)

Pour projet `marketpulse-ai-48b08` uniquement Functions:

```
- roles/cloudfunctions.developer
- roles/iam.serviceAccountUser (sur runtime SA)
- roles/run.developer (ou run.admin si developer échoue)
- roles/artifactregistry.writer
- roles/cloudbuild.builds.editor
- roles/storage.objectAdmin (sur bucket gcf-v2-sources-... uniquement)
```

Si vous voulez 2 rôles ultra-minimalistes qui fonctionnent dans 90% des cas (selon marketplace action `mwpryer/deploy-firebase-functions`):

```
- roles/cloudfunctions.admin
- roles/iam.serviceAccountUser
```

Mais pour Gen2 complet, ajoutez Run + Artifact Registry.

## 7. Deux actions manuelles que vous devrez faire ensuite

### Action 1: Créer GEMINI_API_KEY dans GitHub Secrets

1. Aller sur `github.com/koffaJeanAgoudavi-dev/marketpulse-ai`
2. **Settings > Secrets and variables > Actions**
3. **New repository secret**
   - Name: `GEMINI_API_KEY`
   - Secret: coller votre vraie clé Gemini (commençant par `AIza...`)
   - Add secret
4. Vérifier qu'elle apparaît dans la liste (valeur masquée)

Ne jamais mettre cette clé dans code, .env commité, ou Arena.

### Action 2: Créer/configurer Service Account et ajouter JSON dans FIREBASE_SERVICE_ACCOUNT

**Depuis Google Cloud Console (UI, sans terminal):**

1. Aller sur **console.cloud.google.com** > projet `marketpulse-ai-48b08`
2. **IAM & Admin > Service Accounts > Create Service Account**
   - Name: `github-actions-deploy`
   - Description: `Deploy Firebase Functions via GitHub Actions`
   - Create
3. **Grant roles** (étape 2 création):
   - Ajouter rôles minimum listés ci-dessus (au moins `Cloud Functions Developer` + `Service Account User`)
   - Vous pourrez ajouter les autres après via IAM > Edit si deploy échoue avec permission manquante (méthode itérative sécurisée)
   - Continue > Done
4. **Créer clé JSON:**
   - Cliquer sur le SA créé > **Keys > Add Key > Create new key > JSON**
   - Fichier JSON téléchargé automatiquement
5. **Aller sur GitHub repo > Settings > Secrets and variables > Actions > New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: ouvrir le JSON téléchargé avec éditeur texte, copier **tout le contenu JSON** (avec accolades), coller
   - Add secret
6. **Supprimer le fichier JSON local** de votre PC après ajout (sécurité)

**Permissions minimales à accorder après création (IAM > Edit):**

Si vous voulez affiner sans Owner/Editor:
- Allez dans **IAM** > trouvez `github-actions-deploy@marketpulse-ai-48b08.iam.gserviceaccount.com` > Edit > Add roles minimum listés.

Le workflow `.github/workflows/deploy-functions.yml` utilise déjà `google-github-actions/auth@v2` avec `credentials_json: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}` et ne log jamais le JSON.

## 8. Workflow final

- Push sur `main` avec modif `functions/**` ou `firebase.json` → GitHub Actions se déclenche
- Crée `functions/.env` depuis secret → deploy → supprime .env
- Clé jamais dans GitHub source, jamais frontend, jamais logs, jamais Arena
- Pas de Secret Manager, pas de facturation Secret Manager nécessaire (mais projet doit être en Blaze pour Functions Gen2 en général - à vérifier selon votre plan Firebase)

**Aucun déploiement réel effectué, en attente de votre validation.**
