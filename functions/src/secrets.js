/**
 * MarketPulse AI - Secrets Architecture
 * Phase 4A - Préparation compatible secrets Firebase/Cloud Functions
 *
 * IMPORTANT:
 * - Aucune clé API réelle ne doit apparaître dans code ou repo
 * - Secrets injectés via Firebase Functions Secrets
 * - Utilise defineSecret() de firebase-functions/params
 *
 * Déploiement:
 * firebase functions:secrets:set GEMINI_API_KEY
 * firebase functions:secrets:set CHARIOW_API_KEY
 * firebase functions:secrets:set CHARIOW_WEBHOOK_SECRET
 *
 * Usage futur (Phase 4B+):
 * const { defineSecret } = require('firebase-functions/params');
 * const geminiApiKey = defineSecret('GEMINI_API_KEY');
 * exports.secureGenerateCampaign = onCall({ secrets: [geminiApiKey] }, async (request) => {
 *   const apiKey = geminiApiKey.value();
 *   // utiliser apiKey côté serveur uniquement
 * });
 */

const { defineSecret } = require('firebase-functions/params');

// Définitions futures (non utilisées Phase 4A, documentées pour Phase 4B+)
// En Phase 4A, on ne les active pas pour éviter erreur si secrets non définis

// const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// const CHARIOW_API_KEY = defineSecret('CHARIOW_API_KEY');
// const CHARIOW_WEBHOOK_SECRET = defineSecret('CHARIOW_WEBHOOK_SECRET');

module.exports = {
  // Export placeholders pour documentation
  futureSecrets: {
    GEMINI_API_KEY: {
      description: 'Clé API Gemini pour génération côté serveur',
      phase: '4B',
      command: 'firebase functions:secrets:set GEMINI_API_KEY',
      usage: 'defineSecret + onCall secrets',
    },
    CHARIOW_API_KEY: {
      description: 'Clé API Chariow pour vérification paiements',
      phase: '4C',
      command: 'firebase functions:secrets:set CHARIOW_API_KEY',
      usage: 'defineSecret + onRequest',
    },
    CHARIOW_WEBHOOK_SECRET: {
      description: 'Secret webhook Chariow pour vérification signature',
      phase: '4C',
      command: 'firebase functions:secrets:set CHARIOW_WEBHOOK_SECRET',
      usage: 'defineSecret + onRequest verify signature',
    },
  },
  // Helper pour lister secrets futurs (utile pour docs)
  listFutureSecrets: () => [
    'GEMINI_API_KEY (Phase 4B)',
    'CHARIOW_API_KEY (Phase 4C)',
    'CHARIOW_WEBHOOK_SECRET (Phase 4C)',
  ],
};
