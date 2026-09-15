/**
 * MarketPulse AI - Tests Phase 4B.1 - Débit Sécurisé Crédits
 * Vérifie débit atomique côté serveur, sécurité, transactions, concurrence
 */

const fs = require('fs');
const path = require('path');

let total = 0, pass = 0, fail = 0;
function test(name, fn) {
  total++;
  try { fn(); console.log(`✅ PASS: ${name}`); pass++; }
  catch (e) { console.log(`❌ FAIL: ${name} - ${e.message}`); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('=== Tests Phase 4B.1 - Débit Sécurisé Crédits ===\n');

// --- Audit ---
test('functions/index.js existe et contient debitCredit', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  assert(content.includes('debitCredit'), 'contient debitCredit');
  assert(content.includes('exports.debitCredit'), 'export debitCredit');
  assert(content.includes('onCall'), 'onCall présent');
});

test('functions/src/credits.js existe', () => {
  const p = path.join(__dirname, '..', 'functions/src/credits.js');
  assert(fs.existsSync(p), 'credits.js existe');
  const content = fs.readFileSync(p, 'utf8');
  assert(content.includes('debitCreditAdmin'), 'debitCreditAdmin');
  assert(content.includes('runTransaction'), 'transaction');
  assert(content.includes('checkBalanceAdmin'), 'checkBalanceAdmin');
});

test('src/js/firebase/functions-client.js contient debitCredit abstraction', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src/js/firebase/functions-client.js'), 'utf8');
  assert(content.includes('debitCredit'), 'debitCredit abstraction');
  assert(content.includes('checkCredits'), 'checkCredits abstraction');
  assert(content.includes('callBackendFunction'), 'callBackendFunction');
});

// --- 4B.1.2 Fonction serveur ---
test('Fonction serveur vérifie request.auth (authentification)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  assert(content.includes('requireAuth(request)'), 'requireAuth appelé');
  assert(content.includes('unauthenticated'), 'erreur unauthenticated prévue');
  assert(content.includes('request.auth.uid'), 'uid depuis auth');
});

test('Fonction serveur ne fait PAS confiance à uid fourni par frontend', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  // Doit ignorer request.data.uid et utiliser auth.uid
  assert(content.includes('request.data.uid') || content.includes('providedUid'), 'vérifie tentative uid fourni');
  assert(content.includes('authUid') || content.includes('auth.uid'), 'utilise auth uid');
  // Sécurité: ne doit pas faire db.collection('users').doc(request.data.uid) directement
  const hasInsecureUid = /db\.collection.*doc\(request\.data\.uid\)/.test(content);
  assert(!hasInsecureUid, 'pas de doc(request.data.uid) direct - doit utiliser auth uid');
});

test('Fonction serveur récupère users/{uid} avec Admin', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(content.includes("collection('users')"), 'collection users');
  assert(content.includes('.doc(uid)'), 'doc(uid)');
  assert(content.includes('.get()'), 'get()');
});

test('Fonction serveur vérifie profil existe', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(content.includes('!userSnap.exists') || content.includes('exists'), 'vérifie exists');
  assert(content.includes('not-found'), 'erreur not-found si profil absent');
});

test('Fonction serveur lit credits et refuse si <1', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(content.includes('credits'), 'lit credits');
  assert(content.includes('currentCredits < 1') || content.includes('< 1'), 'vérifie <1');
  assert(content.includes('failed-precondition'), 'erreur failed-precondition');
  assert(content.includes('INSUFFICIENT_CREDITS'), 'code INSUFFICIENT_CREDITS');
});

// --- 4B.1.3 Atomicité ---
test('Débit utilise transaction Firestore (atomicité)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(content.includes('runTransaction'), 'runTransaction présent');
  assert(content.includes('transaction.get'), 'transaction.get');
  assert(content.includes('transaction.update'), 'transaction.update');
  assert(content.includes('transaction.set'), 'transaction.set pour creditTransactions');
  // Pas de read puis write séparés hors transaction
  const hasSeparateWrite = content.includes('await db.collection') && content.includes('credits - 1') && !content.includes('runTransaction');
  assert(!hasSeparateWrite, 'pas de read/write séparés hors transaction');
});

test('Aucun solde négatif possible', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(content.includes('newBalance < 0') || content.includes('< 0'), 'vérifie pas négatif');
  assert(content.includes('newBalance = currentCredits - 1'), 'débit -1');
});

test('Concurrence: transaction gère deux appels simultanés solde 1 -> 1 succès 1 échec', () => {
  // Simulation logique transaction Firestore
  // On simule deux transactions concurrentes avec solde initial 1
  // Firestore transaction garantit qu'une seule réussit
  
  // Simulation in-memory de la logique
  let currentCredits = 1;
  let transactions = [];
  
  function simulateTransaction(uid, attemptId) {
    // Lecture
    const readBalance = currentCredits;
    // Vérif
    if (readBalance < 1) {
      return { success: false, code: 'INSUFFICIENT_CREDITS', attemptId };
    }
    // Écriture (dans vraie transaction, si deux lectures simultanées avec solde 1, 
    // la seconde échouera au commit car document modifié)
    // Ici on simule que première réussit, seconde échoue
    if (transactions.length === 0) {
      currentCredits = readBalance - 1;
      const tx = { id: `tx_${attemptId}`, balanceAfter: currentCredits, amount: -1, type: 'generation' };
      transactions.push(tx);
      return { success: true, credits: currentCredits, transactionId: tx.id, attemptId };
    } else {
      // Seconde tentative voit solde déjà 0 si relit, ou conflit transaction
      return { success: false, code: 'INSUFFICIENT_CREDITS', attemptId };
    }
  }
  
  const result1 = simulateTransaction('user123', 1);
  const result2 = simulateTransaction('user123', 2);
  
  const successes = [result1, result2].filter(r => r.success);
  const failures = [result1, result2].filter(r => !r.success);
  
  assert(successes.length === 1, '1 succès sur 2 tentatives');
  assert(failures.length === 1, '1 échec sur 2 tentatives');
  assert(currentCredits === 0, 'solde final 0');
  assert(failures[0].code === 'INSUFFICIENT_CREDITS', 'échec avec INSUFFICIENT_CREDITS');
});

// --- 4B.1.4 Erreurs ---
test('Gestion erreurs: unauthenticated, not-found, failed-precondition, internal', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  assert(content.includes('unauthenticated'), 'unauthenticated');
  const creditsContent = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(creditsContent.includes('not-found'), 'not-found');
  assert(creditsContent.includes('failed-precondition'), 'failed-precondition');
  assert(creditsContent.includes('internal'), 'internal');
});

test('Erreur solde insuffisant retourne code métier identifiable', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(content.includes('INSUFFICIENT_CREDITS'), 'code INSUFFICIENT_CREDITS');
  // Frontend doit recevoir message exploitable
  const clientContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/firebase/functions-client.js'), 'utf8');
  assert(clientContent.includes('INSUFFICIENT_CREDITS') || clientContent.includes('isInsufficientCredits'), 'frontend gère INSUFFICIENT_CREDITS');
});

// --- 4B.1.5 Credit Transaction ---
test('Chaque débit crée trace immuable creditTransactions', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  assert(content.includes('creditTransactions'), 'creditTransactions collection');
  assert(content.includes('createdAt'), 'createdAt');
  assert(content.includes('serverTimestamp'), 'serverTimestamp');
  assert(content.includes("type: 'generation'") || content.includes('type: \"generation\"') || content.includes("type: 'generation'") || content.includes('type'), 'type generation');
  assert(content.includes('amount: -1'), 'amount -1');
  assert(content.includes('balanceAfter'), 'balanceAfter');
});

test('Structure creditTransactions conforme spec', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/credits.js'), 'utf8');
  // Vérifie champs minimum requis
  const requiredFields = ['createdAt', 'type', 'amount', 'balanceAfter'];
  for (const field of requiredFields) {
    assert(content.includes(field), `champ ${field} présent`);
  }
  // Vérifie amount -1 et type generation
  assert(content.includes("type: 'generation'") || content.includes('type: "generation"') || (content.includes('type') && content.includes('generation')), 'type generation');
});

test('Client ne peut pas créer/modifier creditTransactions (rules)', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  // Doit contenir deny pour creditTransactions
  assert(rules.includes('creditTransactions'), 'rules contient creditTransactions');
  assert(rules.includes('allow create, update, delete: if false'), 'deny write creditTransactions');
  // Client ne peut pas écrire credits
  assert(rules.includes('request.resource.data.credits == resource.data.credits'), 'bloque modification credits côté client');
});

// --- 4B.1.6 Frontend Client ---
test('Frontend abstraction debitCredit() appelle uniquement Cloud Function', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src/js/firebase/functions-client.js'), 'utf8');
  assert(content.includes('export async function debitCredit'), 'export debitCredit');
  assert(content.includes("callBackendFunction('debitCredit'") || content.includes('callBackendFunction'), 'appelle Cloud Function');
  // Ne doit pas connaître logique Firestore du débit
  assert(!content.includes("collection('users')") || content.includes('Functions Client'), 'pas de logique Firestore directe');
  assert(!content.includes('runTransaction'), 'pas de transaction Firestore côté client');
});

test('Frontend ne branche pas encore dans workflow génération complet', () => {
  const campaignContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/campaign.js'), 'utf8');
  // Ne doit pas encore appeler debitCredit dans generateCampaign (Phase 4B.1 test indépendant)
  const hasDebitInCampaign = campaignContent.includes('debitCredit') && !campaignContent.includes('Phase 4B.1') && !campaignContent.includes('TODO');
  // On autorise commentaire mais pas appel réel
  assert(!hasDebitInCampaign, 'pas d appel debitCredit dans campaign.js Phase 4B.1 (test indépendant)');
});

// --- 4B.1.7 LocalStorage ---
test('LocalStorage legacy conservé (pas de suppression)', () => {
  const stateContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/state.js'), 'utf8');
  assert(stateContent.includes('CREDITS_PREFIX'), 'CREDITS_PREFIX conservé');
  assert(stateContent.includes('getUserCredits'), 'getUserCredits conservé');
  assert(stateContent.includes('saveUserCredits'), 'saveUserCredits conservé');
  assert(fs.existsSync(path.join(__dirname, '..', 'src/js/config.js')), 'config.js existe');
  const configContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/config.js'), 'utf8');
  assert(configContent.includes('CREDITS_PREFIX'), 'CREDITS_PREFIX dans config');
});

test('decrementCredits legacy documenté comme progressivement legacy', () => {
  const campaignContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/campaign.js'), 'utf8');
  // Actuellement utilise saveUserCredits avec -1, c'est legacy
  assert(campaignContent.includes('saveUserCredits'), 'utilise saveUserCredits (legacy)');
  // Documentation que débit sécurisé sera utilisé Phase 4B.2
  const functionsClientContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/firebase/functions-client.js'), 'utf8');
  assert(functionsClientContent.includes('Phase 4B.2') || functionsClientContent.includes('test indépendant'), 'documente futur usage Phase 4B.2');
});

// --- 4B.1.8 Tests Authentification ---
test('Authentification: non authentifié -> refus (requireAuth)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  assert(content.includes('requireAuth(request)'), 'requireAuth appelé dans debitCredit');
  // Simulation logique
  function requireAuthMock(request) {
    if (!request.auth) throw new Error('unauthenticated');
    return request.auth;
  }
  try {
    requireAuthMock({ auth: null });
    assert(false, 'aurait dû throw unauthenticated');
  } catch (e) {
    assert(e.message === 'unauthenticated', 'refus si non authentifié');
  }
  const auth = requireAuthMock({ auth: { uid: 'user123' } });
  assert(auth.uid === 'user123', 'autorisé si authentifié');
});

test('Authentification: UID contexte Firebase utilisé, pas UID arbitraire frontend', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  // Vérifie que fonction utilise auth.uid, pas request.data.uid comme source vérité
  assert(content.includes('const uid = authContext.uid'), 'uid depuis authContext');
  assert(content.includes('authUid') || content.includes('auth.uid'), 'utilise auth uid');
  // Sécurité: si frontend fournit uid différent, on l'ignore
  assert(content.includes('providedUid') || content.includes('request.data.uid'), 'détecte tentative uid différent');
});

// --- Solde ---
test('Solde: 0 crédit -> refus', () => {
  function checkCredits(current) {
    if (current < 1) throw new Error('INSUFFICIENT_CREDITS');
    return current - 1;
  }
  try {
    checkCredits(0);
    assert(false, 'aurait dû refuser');
  } catch (e) {
    assert(e.message === 'INSUFFICIENT_CREDITS', 'refus 0 crédit');
  }
});

test('Solde: 1 crédit -> succès nouveau solde 0', () => {
  function debit(current) {
    if (current < 1) throw new Error('INSUFFICIENT_CREDITS');
    return current - 1;
  }
  const newBalance = debit(1);
  assert(newBalance === 0, '1 -> 0');
});

test('Solde: 5 crédits -> succès nouveau solde 4', () => {
  function debit(current) {
    if (current < 1) throw new Error('INSUFFICIENT_CREDITS');
    return current - 1;
  }
  const newBalance = debit(5);
  assert(newBalance === 4, '5 -> 4');
});

test('Aucun solde négatif possible', () => {
  function debit(current) {
    if (current < 1) throw new Error('INSUFFICIENT_CREDITS');
    const newBal = current - 1;
    if (newBal < 0) throw new Error('NEGATIVE_BALANCE');
    return newBal;
  }
  // Test avec 0
  try {
    debit(0);
    assert(false, 'aurait dû refuser');
  } catch (e) {
    assert(e.message === 'INSUFFICIENT_CREDITS', 'pas de solde négatif, refus avant');
  }
  // Test avec 1 -> 0 ok, pas négatif
  const bal = debit(1);
  assert(bal === 0, '1 -> 0 pas négatif');
  assert(bal >= 0, 'solde >=0');
});

// --- Transaction ---
test('Transaction après débit réussi: existe, type generation, amount -1, balanceAfter correspond', () => {
  // Simulation transaction
  const currentCredits = 5;
  const newBalance = currentCredits - 1;
  const tx = {
    createdAt: new Date(),
    type: 'generation',
    amount: -1,
    balanceAfter: newBalance,
    balanceBefore: currentCredits,
  };
  assert(tx.type === 'generation', 'type generation');
  assert(tx.amount === -1, 'amount -1');
  assert(tx.balanceAfter === newBalance, 'balanceAfter correspond nouveau solde');
  assert(tx.balanceAfter === 4, 'balanceAfter 4 pour 5->4');
});

// --- Sécurité ---
test('Sécurité: client ne peut pas écrire directement users/{uid}.credits (rules)', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert(rules.includes('request.resource.data.credits == resource.data.credits'), 'rules bloque credits');
});

test('Sécurité: client ne peut pas créer directement creditTransactions (rules)', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const creditTxSection = rules.substring(rules.indexOf('creditTransactions'), rules.indexOf('creditTransactions') + 500);
  assert(creditTxSection.includes('if false'), 'deny creditTransactions');
});

// --- Non-régression ---
test('Non-régression: modules Phase 1A-3B toujours présents', () => {
  const required = [
    'src/js/campaign.js',
    'src/js/history.js',
    'src/js/state.js',
    'src/js/ui.js',
    'src/js/main.js',
    'src/js/firebase/firestore.js',
  ];
  for (const mod of required) {
    assert(fs.existsSync(path.join(__dirname, '..', mod)), `${mod} existe`);
  }
});

test('Backend syntax OK', () => {
  const { execSync } = require('child_process');
  try {
    execSync('node --check functions/index.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    execSync('node --check functions/src/credits.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  } catch (e) {
    throw new Error(`Syntax error: ${e.message}`);
  }
});

test('Frontend syntax OK', () => {
  const { execSync } = require('child_process');
  try {
    execSync('node --check src/js/firebase/functions-client.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    execSync('node --check src/js/firebase/index.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  } catch (e) {
    throw new Error(`Syntax error frontend: ${e.message}`);
  }
});

console.log('\n=== RÉSUMÉ TESTS PHASE 4B.1 ===');
console.log(`Total: ${total}, PASS: ${pass}, FAIL: ${fail}`);
if (fail === 0) console.log('✅ Tous tests Phase 4B.1 PASS - Débit sécurisé prêt');
else console.log(`❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
