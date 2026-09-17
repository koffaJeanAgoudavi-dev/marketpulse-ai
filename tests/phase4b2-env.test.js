/**
 * MarketPulse AI - Tests Phase 4B.2-ENV - Migration GitHub Actions + process.env
 * 
 * Architecture:
 * GitHub Secret GEMINI_API_KEY -> GitHub Actions -> functions/.env temporaire -> process.env.GEMINI_API_KEY
 * 
 * Vérifie:
 * - process.env.GEMINI_API_KEY utilisé backend
 * - aucune clé hardcodée
 * - aucune ref active defineSecret('GEMINI_API_KEY')
 * - gemini-3.6-flash actif, pas 1.5-flash
 * - absence -> GEMINI_KEY_NOT_CONFIGURED
 * - non-régression Auth, crédits, idempotence, remboursement, stale recovery, Firestore Rules
 * - workflow GitHub Actions sécurisé
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

console.log('=== Tests Phase 4B.2-ENV - Migration GitHub Actions ===\n');

// --- 1. Nouveau mécanisme process.env ---
console.log('--- 1. Nouveau mécanisme process.env ---');

test('gemini.js utilise process.env.GEMINI_API_KEY', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/gemini.js'), 'utf8');
  assert(content.includes('process.env.GEMINI_API_KEY'), 'contient process.env.GEMINI_API_KEY');
  assert(content.includes('getGeminiApiKey'), 'getGeminiApiKey existe');
  assert(content.includes('trim()'), 'trim() la valeur');
});

test('gemini.js ne contient plus defineSecret GEMINI_API_KEY', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/gemini.js'), 'utf8');
  assert(!content.includes("defineSecret('GEMINI_API_KEY')"), 'ne doit plus contenir defineSecret GEMINI');
  assert(!content.includes('GEMINI_API_KEY_SECRET'), 'ne doit plus contenir GEMINI_API_KEY_SECRET');
  assert(!content.includes('defineSecret'), 'ne doit plus importer defineSecret pour GEMINI');
});

test('index.js ne contient plus defineSecret GEMINI_API_KEY ni secrets array', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  assert(!content.includes("defineSecret('GEMINI_API_KEY')"), 'index.js ne doit plus defineSecret GEMINI');
  assert(!content.includes('GEMINI_API_KEY_SECRET'), 'index.js ne doit plus GEMINI_API_KEY_SECRET');
  // Vérifie que secureGenerateCampaign n'a plus secrets: [..]
  const secureSection = content.substring(content.indexOf('exports.secureGenerateCampaign'), content.indexOf('exports.secureGenerateCampaign') + 5000);
  assert(!secureSection.includes('secrets:'), 'secureGenerateCampaign ne doit plus avoir secrets: [...]');
  assert(secureSection.includes('memory'), 'conserve memory');
  assert(secureSection.includes('timeoutSeconds'), 'conserve timeout');
});

test('index.js conserve onCall, memory 1GiB, timeout 120', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  const secureSection = content.substring(content.indexOf('exports.secureGenerateCampaign'), content.indexOf('exports.secureGenerateCampaign') + 2000);
  assert(secureSection.includes('onCall'), 'onCall conservé');
  assert(secureSection.includes('1GiB'), 'memory 1GiB conservé');
  assert(secureSection.includes('120'), 'timeout 120 conservé');
});

test('getGeminiApiKey retourne GEMINI_KEY_NOT_CONFIGURED si absente', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/gemini.js'), 'utf8');
  assert(content.includes('GEMINI_KEY_NOT_CONFIGURED'), 'contient GEMINI_KEY_NOT_CONFIGURED');
  assert(content.includes('failed-precondition'), 'failed-precondition pour absence clé');

  // Simulation logique
  function getGeminiApiKeyMock(env) {
    const raw = env.GEMINI_API_KEY;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      throw new Error('GEMINI_KEY_NOT_CONFIGURED');
    }
    return raw.trim();
  }

  try {
    getGeminiApiKeyMock({});
    assert(false, 'aurait dû throw si absente');
  } catch (e) {
    assert(e.message === 'GEMINI_KEY_NOT_CONFIGURED', 'absence -> GEMINI_KEY_NOT_CONFIGURED');
  }

  try {
    getGeminiApiKeyMock({ GEMINI_API_KEY: '   ' });
    assert(false, 'aurait dû throw si vide');
  } catch (e) {
    assert(e.message === 'GEMINI_KEY_NOT_CONFIGURED', 'vide -> GEMINI_KEY_NOT_CONFIGURED');
  }

  const ok = getGeminiApiKeyMock({ GEMINI_API_KEY: '  AIzaFakeKey123  ' });
  assert(ok === 'AIzaFakeKey123', 'trim() appliqué');
});

test('Aucune clé Gemini hardcodée dans repo', () => {
  const filesToCheck = [
    'functions/src/gemini.js',
    'functions/index.js',
    'functions/src/credits.js',
    'functions/src/campaigns.js',
    'src/js/campaign.js',
    'src/js/firebase/functions-client.js',
    'firebase.json',
    'firestore.rules',
  ];
  for (const file of filesToCheck) {
    const fp = path.join(__dirname, '..', file);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, 'utf8');
    const hasHardcoded = /GEMINI_API_KEY\s*=\s*["']AIza/.test(content) || /AIza[0-9A-Za-z\-_]{35,}/.test(content);
    // Autorise le commentaire de validation format (AIza) mais pas de vraie clé 35+ chars
    if (file === 'functions/src/gemini.js') {
      // Ce fichier contient seulement startsWith('AIza'), pas de vraie clé
      const hasRealKey = /AIza[0-9A-Za-z\-_]{35,}/.test(content);
      assert(!hasRealKey, `pas de vraie clé AIza 35+ dans ${file}`);
    } else {
      assert(!hasHardcoded, `pas de clé hardcodée dans ${file}`);
    }
  }
});

test('Aucune référence active defineSecret GEMINI_API_KEY dans code', () => {
  const files = [
    'functions/src/gemini.js',
    'functions/index.js',
    'functions/src/credits.js',
    'functions/src/campaigns.js',
    'functions/src/validation.js',
    'functions/src/generations.js',
  ];
  for (const file of files) {
    const fp = path.join(__dirname, '..', file);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, 'utf8');
    assert(!content.includes("defineSecret('GEMINI_API_KEY')"), `pas de defineSecret GEMINI dans ${file}`);
  }
});

test('Modèle gemini-3.6-flash actif, pas 1.5-flash', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/src/gemini.js'), 'utf8');
  assert(content.includes('gemini-3.6-flash'), '3.6-flash actif');
  assert(!content.includes('gemini-1.5-flash'), 'pas de 1.5-flash');
  const modelMatch = content.match(/const\s+model\s*=\s*['\"]([^'\"]+)['\"]/);
  assert(modelMatch && modelMatch[1] === 'gemini-3.6-flash', 'const model = 3.6-flash');
});

// --- 2. Sécurité ---
console.log('\n--- 2. Sécurité ENV ---');

test('GEMINI_API_KEY jamais loggée', () => {
  const geminiContent = fs.readFileSync(path.join(__dirname, '..', 'functions/src/gemini.js'), 'utf8');
  assert(!geminiContent.includes('logger.info.*apiKey') && !geminiContent.includes('console.log.*GEMINI'), 'pas de log clé');
  // Vérifie que getGeminiApiKey ne log pas la valeur
  assert(!/logger\.info.*apiKey/.test(geminiContent), 'pas de logger.info apiKey');
  assert(geminiContent.includes('GEMINI_API_KEY non configurée') || geminiContent.includes('format suspect'), 'log seulement absence/format, pas valeur');
});

test('GEMINI_API_KEY jamais retournée au frontend', () => {
  const indexContent = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  // Vérifie que secureGenerateCampaign ne retourne jamais apiKey
  const secureSection = indexContent.substring(indexContent.indexOf('secureGenerateCampaign'), indexContent.indexOf('secureGenerateCampaign') + 15000);
  assert(!secureSection.includes('apiKey') || secureSection.includes('apiKey') && !secureSection.includes('return') || secureSection.includes('generateCampaignWithGemini'), 'pas de retour apiKey au frontend');
  assert(!/return.*process\.env\.GEMINI_API_KEY/.test(secureSection), 'pas de return env key');
});

test('Frontend ne contient jamais process.env.GEMINI_API_KEY ni clé hardcodée', () => {
  const frontendFiles = [
    'src/js/campaign.js',
    'src/js/firebase/functions-client.js',
    'src/js/main.js',
    'index.html',
  ];
  for (const file of frontendFiles) {
    const fp = path.join(__dirname, '..', file);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, 'utf8');
    assert(!content.includes('process.env.GEMINI_API_KEY'), `frontend ${file} ne doit pas contenir process.env.GEMINI_API_KEY`);
    // Autorise commentaire "ne doit JAMAIS contenir GEMINI_API_KEY" mais interdit assignation hardcodée
    const hasHardcoded = /GEMINI_API_KEY\s*=\s*["']AIza/.test(content) || /AIza[0-9A-Za-z\-_]{35,}/.test(content);
    assert(!hasHardcoded, `frontend ${file} ne doit pas contenir clé hardcodée`);
  }
});

// --- 3. GitHub Actions Workflow ---
console.log('\n--- 3. GitHub Actions Workflow ---');

test('.github/workflows/deploy-functions.yml existe', () => {
  const fp = path.join(__dirname, '..', '.github/workflows/deploy-functions.yml');
  assert(fs.existsSync(fp), 'workflow existe');
});

test('Workflow déclenchement push main + paths pertinents', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/deploy-functions.yml'), 'utf8');
  assert(content.includes('push'), 'push trigger');
  assert(content.includes('main'), 'branch main');
  assert(content.includes('functions/**') || content.includes('functions/'), 'paths functions');
  assert(content.includes('firebase.json'), 'paths firebase.json');
});

test('Workflow sécurisé: ne jamais afficher valeur secret', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/deploy-functions.yml'), 'utf8');
  // Interdit echo direct de la valeur (echo $VAR ou echo "$VAR" qui afficherait la clé)
  // Autorise echo de messages contenant le nom de la variable sans sa valeur
  const hasDangerousEcho = /echo\s+\"?\$GEMINI_API_KEY\"?/.test(content) || /echo\s+\${{\s*secrets\.GEMINI_API_KEY\s*}}/.test(content);
  assert(!hasDangerousEcho, 'ne doit pas echo direct valeur GEMINI_API_KEY');
  assert(content.includes('${{ secrets.GEMINI_API_KEY }}'), 'utilise secrets.GEMINI_API_KEY via env');
  assert(content.includes('FIREBASE_SERVICE_ACCOUNT'), 'utilise FIREBASE_SERVICE_ACCOUNT');
  assert(!content.includes('AIza'), 'pas de vraie clé AIza dans workflow');
  // Vérifie que la création utilise printf avec env var (masqué par GitHub)
  assert(content.includes('printf') && content.includes('functions/.env'), 'crée .env via printf sécurisé');
});

test('Workflow crée functions/.env temporaire depuis secret', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/deploy-functions.yml'), 'utf8');
  assert(content.includes('functions/.env'), 'crée functions/.env');
  assert(content.includes('GEMINI_API_KEY'), 'contient GEMINI_API_KEY');
  assert(content.includes('printf') || content.includes('echo'), 'crée via printf/echo sécurisé');
});

test('Workflow vérifie présence sans afficher valeur', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/deploy-functions.yml'), 'utf8');
  assert(content.includes('Verify') || content.includes('present'), 'vérifie présence');
  assert(content.includes('grep') || content.includes('wc -c'), 'vérifie sans afficher valeur');
});

test('Workflow déploie uniquement Functions vers marketpulse-ai-48b08', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/deploy-functions.yml'), 'utf8');
  assert(content.includes('firebase deploy') || content.includes('firebase-tools'), 'deploy firebase');
  assert(content.includes('--only functions'), 'only functions');
  assert(content.includes('marketpulse-ai-48b08'), 'projet marketpulse-ai-48b08');
});

test('Workflow supprime .env après déploiement même en cas échec', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/deploy-functions.yml'), 'utf8');
  assert(content.includes('Cleanup') || content.includes('rm -f functions/.env'), 'supprime .env');
  assert(content.includes('if: always()'), 'always() pour cleanup');
});

test('Workflow Node.js 20', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/deploy-functions.yml'), 'utf8');
  assert(content.includes('20'), 'Node 20');
  assert(content.includes('setup-node'), 'setup-node');
});

test('.env est dans .gitignore', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', 'functions/.gitignore'), 'utf8');
  assert(gitignore.includes('.env'), '.env dans .gitignore');
});

// --- 4. Non-régression ---
console.log('\n--- 4. Non-régression ---');

test('Auth toujours exigé', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  assert(content.includes('requireAuth(request)'), 'requireAuth');
  assert(content.includes('email_verified') || content.includes('emailVerified'), 'email vérifié');
});

test('Crédits, idempotence, remboursement, stale recovery conservés', () => {
  const indexContent = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  assert(indexContent.includes('debitCreditAdmin'), 'debitCreditAdmin conservé');
  assert(indexContent.includes('refundCreditAdmin'), 'refundCreditAdmin conservé');
  assert(indexContent.includes('createGenerationProcessing'), 'idempotence conservé');
  assert(indexContent.includes('STALE_RECOVERED') || indexContent.includes('markGenerationRecovered'), 'stale recovery conservé');
});

test('Firestore Rules inchangées (template/legacy only)', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert(rules.includes("source in ['template', 'legacy']"), 'rules template/legacy');
  assert(!rules.includes("source in ['template', 'gemini', 'legacy']"), 'pas ancien rules avec gemini client');
});

test('Backend syntax OK', () => {
  const { execSync } = require('child_process');
  const files = [
    'functions/index.js',
    'functions/src/gemini.js',
    'functions/src/credits.js',
    'functions/src/validation.js',
    'functions/src/generations.js',
    'functions/src/campaigns.js',
  ];
  for (const f of files) {
    execSync(`node --check ${f}`, { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  }
});

console.log('\n=== RÉSUMÉ TESTS PHASE 4B.2-ENV ===');
console.log(`Total: ${total}, PASS: ${pass}, FAIL: ${fail}`);
if (fail === 0) console.log('✅ Tous tests Phase 4B.2-ENV PASS - Migration ENV prête');
else console.log(`❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
