# PHASE 4B.2-FIX — Rapport de corrections

**Date:** 2026-05-11  
**Phase:** 4B.2-FIX — Sécurisation et récupération des générations  
**Statut:** ✅ PASS 193/193 (19 rules + 24 2B + 27 3B + 22 4A + 32 4B.1 + 42 4B.2 + 27 FIX)

## Objectif
Appliquer UNIQUEMENT les corrections listées, sans refactor général.

## Corrections appliquées

### 1. Update Gemini model: ancien modèle (1.5) -> gemini-3.6-flash

**Problème:** Code utilisait encore `ancien modèle (1.5)` (modèle legacy). Risque dépréciation, performances moindres.

**Solution:**
- `functions/src/gemini.js` ligne 84: `const model = 'gemini-3.6-flash'` (était ancien modèle)
- `docs/PHASE_4B.2_REPORT.md`: remplacement global 1.5 -> 2.5
- Vérification grep global: zéro référence active `ancien modèle (1.5)` dans code/tests/constants/docs

**Impact:**
- Modèle plus récent, rapide, économique
- Aucun changement mécanisme call (fetch + generativelanguage.googleapis.com conservé)
- Tests 27 FIX vérifient model=3.6-flash et absence 1.5

### 2. Prevent fraudulent Firestore creation source:"gemini" client

**Problème:** `firestore.rules` autorisait `source in ['template','gemini','legacy']` côté client. Un client malveillant pouvait créer directement une campagne `source: gemini` sans passer par backend, contournant débit crédit et validation Gemini.

**Solution:**
- `firestore.rules` ligne 88: changé à `source in ['template', 'legacy']` uniquement
- `firebase/firestore.rules` copié identique
- Commentaire ajouté: `// Phase 4B.2-FIX: client peut créer uniquement template/legacy, PAS gemini (backend Admin only)`
- Backend Admin SDK bypass rules par design Firebase, donc `saveCampaignAdmin` continue de créer `source: 'gemini'` sans blocage

**Impact:**
- Sécurité renforcée: seul backend peut créer gemini
- Aucun blocage Admin SDK (bypass rules)
- Tests démontrent 4 cas:
  - client template ALLOWED
  - client legacy ALLOWED
  - client gemini DENIED
  - backend/Admin gemini PASS

### 3. Fix stale generation recovery (>10min)

**Problème:**
Scénario: `debit -> generation starts -> crash/timeout avant final save -> generation reste processing -> crédit reste débité`
- Ancien code: seuil 5min, permettait retry mais sans refund -> double consommation possible
- Si retry après 5min: ancien -1 + nouveau -1 = -2 (perte crédit)
- Ou crédit perdu si abandonné sans recovery

**Solution:**
- `functions/src/generations.js`:
  - Seuil changé 5min -> 10min (Functions timeout 120s, donc 10min = abandonné certain)
  - Retourne `ageMinutes`, `transactionId`, `isStale` pour processing
  - Nouvelles fonctions:
    - `markGenerationRecovered(uid, genId, ageMinutes)` -> marque `failed` avec `errorCode: STALE_RECOVERED`, `recoveredAt`
    - `forceCreateGenerationProcessing(uid, genId, params)` -> écrase stale par nouveau processing propre avec flag `recoveredFromStale: true`
  - Version bump `4B.2` -> `4B.2-FIX`

- `functions/index.js` `secureGenerateCampaign`:
  - Import `markGenerationRecovered`, `forceCreateGenerationProcessing`
  - Après `createGenerationProcessing`, si `alreadyExists && processing`:
    - Calcule `ageMinutes`, `isStale = ageMinutes >=10`
    - Si `<10min`: retourne `ALREADY_PROCESSING` (comportement actuel conservé)
    - Si `>=10min` (stale):
      1. Vérifie `transactionId` existe (débit initial a eu lieu)
      2. Si existe: `refundCreditAdmin(uid, genId, 'stale_processing_recovery')` idempotent via `refund_{genId}`
      3. Si pas de transactionId: pas de refund fictif (log `pas de refund fictif`)
      4. Marque ancienne tentative `STALE_RECOVERED` via `markGenerationRecovered`
      5. Force création nouvelle génération processing via `forceCreateGenerationProcessing`
      6. Continue flow avec nouveau débit propre (single debit)
  - Idempotence refund garantie par mécanisme existant `refund_{generationId}` dans `credits.js`
  - Jamais deux refunds même génération
  - Pas de scheduler/Cloud Scheduler, recovery dans flux `secureGenerateCampaign`

**Cas couverts:**
- `old -1 + refund +1 + new -1 = net -1` pour nouvelle seulement, jamais -2
- Stale avec débit -> refund automatique
- Refund seulement une fois (idempotent)
- Stale sans transactionId -> pas de fictif +1
- Après recovery nouvelle génération possible
- Nouvelle génération single debit
- Final crédits corrects
- Pas de double refund même si recovery appelée 2 fois

**Impact:**
- Aucune perte crédit après abandonné
- Récupération automatique sans intervention manuelle
- Net -1 pour nouvelle génération seulement

## Fichiers créés

- `tests/phase4b2-fix.test.js` (27 tests)
  - Model 3.6-flash no 1.5 ref (4 tests)
  - Firestore Rules template PASS legacy PASS gemini DENY backend PASS (5 tests)
  - Stale recovery 8 cas + logique (12 tests)
  - Non-régression auth/secrets/Chariow (6 tests)
- `docs/PHASE_4B.2-FIX_REPORT.md` (ce fichier)

## Fichiers modifiés

- `functions/src/gemini.js`
  - L84: model `ancien modèle (1.5)` -> `gemini-3.6-flash`
  - Commentaire mis à jour Phase 4B.2-FIX

- `firestore.rules`
  - L88: `source in ['template','legacy']` (était `['template','gemini','legacy']`)
  - Commentaire anti-fraude ajouté

- `firebase/firestore.rules`
  - Copie identique firestore.rules

- `functions/src/generations.js`
  - Seuil 5min -> 10min
  - Retourne ageMinutes, transactionId, isStale pour processing
  - Nouvelle fonction `markGenerationRecovered`
  - Nouvelle fonction `forceCreateGenerationProcessing`
  - Version `4B.2-FIX`

- `functions/index.js`
  - Import `markGenerationRecovered`, `forceCreateGenerationProcessing`
  - Logique stale recovery >10min dans secureGenerateCampaign:
    - Vérifie isStale
    - Refund idempotent si transactionId existe
    - Mark STALE_RECOVERED
    - Force create new processing
    - Continue avec single debit
  - Phase strings mis à jour `4B.2-FIX` pour idempotence returns

- `docs/PHASE_4B.2_REPORT.md`
  - Remplacement global `ancien modèle` -> `3.6-flash`

- `tests/firestore.rules.test.js`
  - Test campaigns mis à jour pour vérifier `['template','legacy']` et absence `gemini`

## Tests PASS counts

- **Phase 4B.2-FIX:** 27/27 PASS
  - Model 3.6-flash: 4 PASS
  - Rules 4 cas: 5 PASS
  - Stale recovery 8 cas: 12 PASS (inclut 2 vérifs structure)
  - Non-régression: 6 PASS

- **Firestore Rules:** 19/19 PASS

- **Phase 2B:** 24/24 PASS

- **Phase 3B:** 27/27 PASS

- **Phase 4A:** 22/22 PASS

- **Phase 4B.1:** 32/32 PASS

- **Phase 4B.2:** 42/42 PASS

**Total régression:** 166/166 PASS (ancien) + 27 FIX = **193/193 PASS**

## Validation critères obligatoires

- [x] **Modèle pas 1.5:** `gemini.js` contient `gemini-3.6-flash`, grep global zéro référence active `ancien modèle (1.5)` dans code/tests/constants/docs
- [x] **Client ne peut pas créer gemini:** `firestore.rules` `source in ['template','legacy']`, test client gemini DENIED, backend gemini PASS via Admin bypass
- [x] **Stale pas de perte crédit:** `old -1 + refund +1 + new -1 = net -1`, test final crédits corrects
- [x] **Refund pas double:** idempotent `refund_{genId}`, test refund seulement une fois, pas double même si recovery 2 fois
- [x] **Régression PASS:** 19+24+27+22+32+42+27 = 193 PASS, 0 FAIL
- [x] **0 console errors:** syntax check backend/frontend OK
- [x] **Aucun changement auth/UI/payment/PRO/referral/architecture inutile:** vérifié via tests non-régression, seul Chariow placeholder commentaire conservé

## Architecture conservée

- GEMINI_API_KEY via `defineSecret` backend uniquement
- Plan source vérité `free`/`pro`, pas isPro parallèle
- Admin SDK uniquement Cloud Functions
- Firestore Rules deny-by-default
- Pas de Cloud Scheduler, recovery dans flux secureGenerateCampaign
- Idempotence via `users/{uid}/generations/{generationId}` + `refund_{genId}`

## Prochaines étapes (hors scope FIX)

- Phase 4C: Chariow paiement, activation PRO
- Phase 5: Images, Storage
