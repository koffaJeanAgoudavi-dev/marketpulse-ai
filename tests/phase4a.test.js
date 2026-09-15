/**
 * MarketPulse AI - Tests Phase 4A - Backend Cloud Functions Foundation
 * Vérifie architecture backend propre et sécurisée
 * Phase 4B.2: Mise à jour pour autoriser debitCredit + secureGenerateCampaign (fondation + 4B.1/4B.2)
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

console.log('=== Tests Phase 4A - Backend Cloud Functions Foundation ===\n');

// --- Audit préalable ---
test('Dossier functions/ existe', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'functions')), 'functions dir existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'package.json')), 'package.json existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'index.js')), 'index.js existe');
});

test('firebase.json contient config functions', () => {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
  assert(firebaseJson.functions, 'contient functions');
  assert(Array.isArray(firebaseJson.functions), 'functions array');
  assert(firebaseJson.functions[0].source === 'functions', 'source functions');
  assert(firebaseJson.emulators.functions, 'emulator functions port');
  assert(firebaseJson.emulators.functions.port === 5001, 'port 5001');
});

test('firestore.rules inchangées Phase 3B (deny-by-default)', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert(rules.includes('allow read, write: if false'), 'deny-by-default présent');
  assert(rules.includes('creditTransactions'), 'creditTransactions présent');
  assert(rules.includes('referralCodes'), 'referralCodes présent');
  assert(rules.includes('referrals'), 'referrals présent');
  assert(rules.includes('credits == resource.data.credits'), 'bloque credits inchangé');
  assert(rules.includes("plan == 'free'"), 'plan free inchangé');
});

test('firestore.indexes.json cohérent', () => {
  const indexes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firestore.indexes.json'), 'utf8'));
  assert(indexes.indexes.length >= 3, 'au moins 3 indexes');
});

test('storage.rules inchangées', () => {
  const storageRules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8');
  assert(storageRules.includes('allow read, write: if false'), 'deny all Phase 3B');
});

test('functions/package.json Node.js version supportée', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'functions', 'package.json'), 'utf8'));
  assert(pkg.engines && pkg.engines.node, 'engines.node défini');
  const nodeVersion = parseInt(pkg.engines.node, 10);
  assert([18,20,22].includes(nodeVersion), `Node version supportée: ${nodeVersion}`);
  assert(pkg.dependencies['firebase-admin'], 'firebase-admin présent');
  assert(pkg.dependencies['firebase-functions'], 'firebase-functions présent');
  assert(pkg.main === 'index.js', 'main index.js');
});

test('functions/index.js structure backend propre', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert(content.includes('firebase-admin'), 'import firebase-admin');
  assert(content.includes('initializeApp'), 'initializeApp');
  assert(content.includes('getFirestore'), 'getFirestore');
  assert(content.includes('getAuth') || content.includes('firebase-admin/auth'), 'getAuth');
  assert(content.includes('onCall'), 'onCall présent');
  assert(content.includes('onRequest'), 'onRequest présent');
  assert(content.includes('healthCheck'), 'healthCheck fonction');
  assert(content.includes('getBackendInfo'), 'getBackendInfo fonction');
});

test('functions/index.js auth helpers', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert(content.includes('requireAuth'), 'requireAuth helper');
  assert(content.includes('request.auth'), 'vérifie request.auth');
  assert(content.includes('unauthenticated'), 'throw unauthenticated');
  assert(content.includes('permission-denied') || content.includes('requireOwner'), 'vérifie owner ou permission');
});

test('functions/index.js Firestore Admin', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert(content.includes('getFirestore'), 'Firestore Admin');
  assert(content.includes('collection') && content.includes('doc'), 'accès Firestore via Admin');
  assert(!fs.existsSync(path.join(__dirname, '..', 'functions', 'serviceAccountKey.json')), 'pas de serviceAccountKey.json file');
  assert(!fs.existsSync(path.join(__dirname, '..', 'serviceAccountKey.json')), 'pas de serviceAccountKey.json root');
});

test('functions/index.js secrets architecture', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert(content.includes('defineSecret') || content.includes('secrets'), 'architecture secrets mentionnée');
  const hasRealKey = /AIza[0-9A-Za-z\-_]{20,}/.test(content) || /sk_live_[0-9a-zA-Z]+/.test(content);
  assert(!hasRealKey, 'pas de clé API réelle dans functions/index.js');
  assert(content.includes('GEMINI_API_KEY') || content.includes('Phase 4B'), 'mention Gemini Phase 4B');
  assert(content.includes('CHARIOW') || content.includes('Phase 4C'), 'mention Chariow Phase 4C');
});

test('functions/index.js ne contient PAS logique métier Phase 4C+ (fondation + 4B.1/4B.2 autorisés)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  const lines = content.split('\n');
  const forbiddenExports = lines.filter(l => {
    const trimmed = l.trim();
    return trimmed.startsWith('exports.chariowWebhook') || trimmed.startsWith('exports.grantReferralBonus') || trimmed.startsWith('exports.generateImage') || trimmed.startsWith('exports.chariow');
  });
  assert(forbiddenExports.length === 0, `Pas d'export métier Phase 4C+ actif, trouvé: ${forbiddenExports.join(', ')}`);
  assert(content.includes('exports.healthCheck'), 'healthCheck exporté');
  assert(content.includes('exports.getBackendInfo'), 'getBackendInfo exporté');
  assert(content.includes('exports.debitCredit'), 'debitCredit exporté Phase 4B.1');
});

test('functions/ structure modulaire src/', () => {
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src')), 'src dir existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'config.js')), 'src/config.js existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'auth.js')), 'src/auth.js existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'firestore.js')), 'src/firestore.js existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'secrets.js')), 'src/secrets.js existe');
  // Phase 4B.2 nouveaux modules
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'credits.js')), 'src/credits.js existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'validation.js')), 'src/validation.js existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'generations.js')), 'src/generations.js existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'gemini.js')), 'src/gemini.js existe');
  assert(fs.existsSync(path.join(__dirname, '..', 'functions', 'src', 'campaigns.js')), 'src/campaigns.js existe');
});

test('functions/.gitignore protège secrets', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', 'functions', '.gitignore'), 'utf8');
  assert(gitignore.includes('node_modules'), 'ignore node_modules');
  assert(gitignore.includes('.env'), 'ignore .env');
  assert(gitignore.includes('serviceAccountKey') || gitignore.includes('*.pem') || gitignore.includes('*-key.json'), 'ignore service account keys');
});

test('Frontend abstraction functions-client.js existe', () => {
  const clientPath = path.join(__dirname, '..', 'src/js/firebase/functions-client.js');
  assert(fs.existsSync(clientPath), 'functions-client.js existe');
  const content = fs.readFileSync(clientPath, 'utf8');
  assert(content.includes('getFunctionsInstance'), 'getFunctionsInstance');
  assert(content.includes('callBackendFunction'), 'callBackendFunction');
  assert(content.includes('healthCheck'), 'healthCheck');
  const hasAdminImport = /from\s+['"]firebase-admin['"]|require\(['"]firebase-admin['"]\)/.test(content);
  assert(!hasAdminImport, 'pas d import firebase-admin dans frontend');
  assert(content.includes('firebase-functions.js'), 'import Functions SDK client');
});

test('Frontend ne charge pas Admin SDK', () => {
  const adminImportPattern = /from\s+['"]firebase-admin['"]|require\(['"]firebase-admin['"]\)/;
  const frontendFiles = fs.readdirSync(path.join(__dirname, '..', 'src/js')).filter(f => f.endsWith('.js'));
  for (const file of frontendFiles) {
    const content = fs.readFileSync(path.join(__dirname, '..', 'src/js', file), 'utf8');
    const hasAdminImport = adminImportPattern.test(content);
    assert(!hasAdminImport, `pas d import firebase-admin dans src/js/${file}`);
  }
  const firebaseFiles = fs.readdirSync(path.join(__dirname, '..', 'src/js/firebase')).filter(f => f.endsWith('.js'));
  for (const file of firebaseFiles) {
    const content = fs.readFileSync(path.join(__dirname, '..', 'src/js/firebase', file), 'utf8');
    const hasAdminImport = adminImportPattern.test(content);
    assert(!hasAdminImport, `pas d import firebase-admin dans firebase/${file}`);
  }
});

test('Frontend génération utilise backend sécurisé Phase 4B.2', () => {
  const campaignContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/campaign.js'), 'utf8');
  assert(campaignContent.includes('generateCampaign'), 'generateCampaign existe');
  assert(campaignContent.includes('getCurrentFirebaseUser'), 'check Firebase auth conservé');
  assert(campaignContent.includes('secureGenerateCampaign'), 'appelle secureGenerateCampaign Phase 4B.2');
  assert(campaignContent.includes('generateGenerationId'), 'génère generationId');
});

test('src/js/firebase/index.js exporte Functions client', () => {
  const indexContent = fs.readFileSync(path.join(__dirname, '..', 'src/js/firebase/index.js'), 'utf8');
  assert(indexContent.includes('functions-client'), 'export via functions-client');
  assert(indexContent.includes('secureGenerateCampaign'), 'export secureGenerateCampaign');
});

test('Aucun secret dans repository (scan global)', () => {
  const forbiddenPatterns = [
    { pattern: /GEMINI_API_KEY\s*=\s*["']AIza/, desc: 'GEMINI_API_KEY hardcodée' },
    { pattern: /sk_live_[0-9a-zA-Z]{10,}/, desc: 'Stripe/Chariow secret key' },
    { pattern: /-----BEGIN PRIVATE KEY-----/, desc: 'Private key' },
  ];
  const filesToScan = [
    path.join(__dirname, '..', 'src/js/firebase/config.js'),
    path.join(__dirname, '..', 'src/js/firebase/functions-client.js'),
    path.join(__dirname, '..', 'src/js/campaign.js'),
    path.join(__dirname, '..', 'firebase.json'),
  ];
  for (const filePath of filesToScan) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const { pattern, desc } of forbiddenPatterns) {
      if (pattern.test(content)) {
        const lines = content.split('\n');
        for (const line of lines) {
          if (pattern.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.includes('defineSecret')) {
            throw new Error(`${desc} trouvée dans ${path.basename(filePath)}: ${line.trim().substring(0,100)}`);
          }
        }
      }
    }
  }
  // Vérifie pas de clé dans functions/index.js hors defineSecret
  const functionsContent = fs.readFileSync(path.join(__dirname, '..', 'functions/index.js'), 'utf8');
  const hasHardcodedKey = /AIza[0-9A-Za-z\-_]{35,}/.test(functionsContent);
  assert(!hasHardcodedKey, 'pas de clé API hardcodée dans functions/index.js');
});

test('Configuration Firebase cohérente', () => {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
  assert(firebaseJson.firestore.rules === 'firestore.rules', 'firestore rules path');
  assert(firebaseJson.firestore.indexes === 'firestore.indexes.json', 'indexes path');
  assert(firebaseJson.storage.rules === 'storage.rules', 'storage rules path');
  assert(fs.existsSync(path.join(__dirname, '..', firebaseJson.functions[0].source)), 'functions source existe');
});

test('Non-régression: modules Phase 1A-3B toujours présents', () => {
  const requiredModules = [
    'src/js/campaign.js',
    'src/js/history.js',
    'src/js/state.js',
    'src/js/ui.js',
    'src/js/main.js',
    'src/js/firebase/firestore.js',
    'src/js/firebase/auth.js',
  ];
  for (const mod of requiredModules) {
    assert(fs.existsSync(path.join(__dirname, '..', mod)), `${mod} existe`);
  }
});

test('Backend peut être chargé (syntax check)', () => {
  const { execSync } = require('child_process');
  try {
    execSync('node --check functions/index.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  } catch (e) {
    throw new Error(`Syntax error functions/index.js: ${e.message}`);
  }
  const srcFiles = ['config.js', 'auth.js', 'firestore.js', 'secrets.js', 'credits.js', 'validation.js', 'generations.js', 'gemini.js', 'campaigns.js'];
  for (const f of srcFiles) {
    try {
      execSync(`node --check src/${f}`, { cwd: path.join(__dirname, '..', 'functions'), stdio: 'pipe' });
    } catch (e) {
      throw new Error(`Syntax error functions/src/${f}: ${e.message}`);
    }
  }
});

test('Frontend syntax OK', () => {
  const { execSync } = require('child_process');
  const frontendFiles = [
    'src/js/main.js',
    'src/js/campaign.js',
    'src/js/history.js',
    'src/js/firebase/functions-client.js',
    'src/js/firebase/index.js',
  ];
  for (const f of frontendFiles) {
    try {
      execSync(`node --check ${f}`, { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    } catch (e) {
      throw new Error(`Syntax error ${f}: ${e.message}`);
    }
  }
});

console.log('\n=== RÉSUMÉ TESTS PHASE 4A ===');
console.log(`Total: ${total}, PASS: ${pass}, FAIL: ${fail}`);
if (fail === 0) console.log('✅ Tous tests Phase 4A PASS - Fondation backend prête');
else console.log(`❌ ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
