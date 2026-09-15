/**
 * MarketPulse AI - Gemini Integration Backend
 * Phase 4B.2-ENV - Appel Gemini côté serveur via process.env.GEMINI_API_KEY
 *
 * IMPORTANT:
 * - GEMINI_API_KEY jamais exposée au frontend
 * - Récupérée via process.env.GEMINI_API_KEY (injectée par GitHub Actions -> functions/.env)
 * - GitHub Secret GEMINI_API_KEY -> GitHub Actions -> functions/.env temporaire -> process.env
 * - Si variable non configurée, retourne erreur propre GEMINI_KEY_NOT_CONFIGURED
 * - Ne jamais logger la clé, ne jamais la retourner au frontend
 * - Ne pas mettre clé fictive dans code
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

/**
 * Récupère clé API Gemini depuis variable d'environnement serveur
 * Architecture: GitHub Secret -> GitHub Actions -> functions/.env -> process.env.GEMINI_API_KEY
 * @returns {string} API key
 * @throws {HttpsError} si non configurée
 */
function getGeminiApiKey() {
  const rawKey = process.env.GEMINI_API_KEY;

  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    logger.error('[Gemini] GEMINI_API_KEY non configurée dans process.env');
    throw new HttpsError(
      'failed-precondition',
      'Service de génération temporairement indisponible. Clé API non configurée côté serveur.',
      { code: 'GEMINI_KEY_NOT_CONFIGURED' }
    );
  }

  const apiKey = rawKey.trim();

  // Validation basique format sans logger la clé
  if (!apiKey.startsWith('AIza') && apiKey.length < 20) {
    logger.warn('[Gemini] GEMINI_API_KEY format suspect (ne commence pas par AIza)');
  }

  return apiKey;
}

/**
 * Construit prompt Gemini pour campagne marketing structurée
 * @param {object} params - { brand, target, tone, lang, offer, preset }
 * @returns {string} prompt
 */
function buildGeminiPrompt(params) {
  const { brand, target, tone, lang, offer, preset } = params;

  // Nettoyage déjà fait côté validation, mais double sécurité
  const safeBrand = (brand || '').substring(0, 100);
  const safeTarget = (target || '').substring(0, 200);
  const safeTone = (tone || '').substring(0, 50);
  const safeLang = (lang || '').substring(0, 50);
  const safeOffer = (offer || '').substring(0, 500);
  const safePreset = preset ? preset.substring(0, 50) : 'général';

  return `Tu es un expert en marketing digital et copywriting. Génère une campagne marketing complète et structurée.

**Paramètres:**
- Marque/Produit: ${safeBrand}
- Audience cible: ${safeTarget}
- Ton: ${safeTone}
- Langue: ${safeLang}
- Offre/Promotion: ${safeOffer}
- Type de campagne: ${safePreset}

**Consignes:**
- Génère du contenu percutant, adapté à l'audience et au ton demandé
- Langue de sortie: ${safeLang}
- Hooks: 3 à 5 accroches virales courtes et percutantes
- Social post: publication complète pour LinkedIn/Instagram (200-500 mots)
- Email: sujet accrocheur + corps d'email de prospection (300-600 mots)
- Image prompt: description détaillée pour génération image (100-200 mots) - scène, style, couleurs, émotion

**Format de sortie OBLIGATOIRE - JSON strict:**
Tu dois retourner UNIQUEMENT un JSON valide, sans texte avant ou après, sans markdown, sans \`\`\`json.

Structure exacte:
{
  "hooks": ["accroche 1", "accroche 2", "accroche 3"],
  "social_post": "Publication complète...",
  "email": {
    "subject": "Sujet email...",
    "body": "Corps email..."
  },
  "image_prompt": "Description image..."
}

**Règles:**
- Retourne UNIQUEMENT le JSON, rien d'autre
- Pas de \`\`\`json, pas de commentaires
- Tous les champs obligatoires
- hooks: tableau 3-5 strings non vides
- social_post: string non vide
- email.subject: string non vide
- email.body: string non vide
- image_prompt: string non vide
`;
}

/**
 * Appelle Gemini API côté serveur
 * @param {object} params - { brand, target, tone, lang, offer, preset }
 * @param {string} apiKey - Clé API Gemini (depuis process.env.GEMINI_API_KEY)
 * @returns {Promise<object>} { hooks, social_post, email: { subject, body }, image_prompt }
 * @throws {HttpsError} si erreur API, réponse invalide, etc.
 */
async function callGeminiAPI(params, apiKey) {
  if (!apiKey) {
    apiKey = getGeminiApiKey();
  }

  const prompt = buildGeminiPrompt(params);

  // Utilise fetch (Node 20 natif) pour appeler Gemini API
  // Modèle: gemini-2.5-flash (Phase 4B.2-FIX)
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.8,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json', // Demande JSON si supporté
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  logger.info('[Gemini] Appel API', { model, brand: params.brand, lang: params.lang });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    logger.error('[Gemini] Erreur réseau fetch', { error: err.message });
    throw new HttpsError('unavailable', 'Service Gemini temporairement indisponible (réseau).', {
      code: 'GEMINI_NETWORK_ERROR',
      originalError: err.message,
    });
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    logger.error('[Gemini] Erreur API HTTP', {
      status: response.status,
      statusText: response.statusText,
      body: errorText.substring(0, 1000),
    });

    if (response.status === 400) {
      throw new HttpsError('invalid-argument', 'Requête Gemini invalide.', {
        code: 'GEMINI_BAD_REQUEST',
        status: response.status,
      });
    }
    if (response.status === 403 || response.status === 401) {
      throw new HttpsError('failed-precondition', 'Clé API Gemini invalide ou non autorisée.', {
        code: 'GEMINI_AUTH_ERROR',
      });
    }
    if (response.status === 429) {
      throw new HttpsError('resource-exhausted', 'Limite API Gemini atteinte, réessayez plus tard.', {
        code: 'GEMINI_RATE_LIMIT',
      });
    }
    if (response.status >= 500) {
      throw new HttpsError('unavailable', 'Service Gemini temporairement indisponible.', {
        code: 'GEMINI_SERVER_ERROR',
        status: response.status,
      });
    }

    throw new HttpsError('internal', 'Erreur API Gemini.', {
      code: 'GEMINI_API_ERROR',
      status: response.status,
    });
  }

  let responseJson;
  try {
    responseJson = await response.json();
  } catch (err) {
    logger.error('[Gemini] Erreur parsing réponse JSON', { error: err.message });
    throw new HttpsError('internal', 'Réponse Gemini invalide (JSON parsing).', {
      code: 'GEMINI_INVALID_RESPONSE',
    });
  }

  // Extraction texte généré
  // Structure Gemini: candidates[0].content.parts[0].text
  try {
    const candidates = responseJson.candidates;
    if (!candidates || candidates.length === 0) {
      logger.error('[Gemini] Pas de candidates dans réponse', { response: JSON.stringify(responseJson).substring(0, 2000) });
      throw new Error('Pas de candidates');
    }

    const firstCandidate = candidates[0];
    if (firstCandidate.finishReason && firstCandidate.finishReason !== 'STOP') {
      logger.warn('[Gemini] Finish reason non STOP', { finishReason: firstCandidate.finishReason });
      if (firstCandidate.finishReason === 'SAFETY') {
        throw new HttpsError('invalid-argument', 'Contenu bloqué par filtres de sécurité Gemini.', {
          code: 'GEMINI_SAFETY_BLOCK',
        });
      }
    }

    const parts = firstCandidate.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error('Pas de parts dans content');
    }

    const text = parts[0].text;
    if (!text || typeof text !== 'string' || text.trim() === '') {
      throw new Error('Texte vide dans réponse Gemini');
    }

    logger.info('[Gemini] Réponse reçue', { textLength: text.length, brand: params.brand });

    // Parse JSON dans texte (Gemini doit retourner JSON strict)
    let parsedOutput;
    try {
      // Nettoie éventuels ```json ... ```
      let cleanedText = text.trim();
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      parsedOutput = JSON.parse(cleanedText);
    } catch (parseErr) {
      logger.error('[Gemini] Erreur parsing JSON dans texte Gemini', {
        text: text.substring(0, 2000),
        error: parseErr.message,
      });
      throw new HttpsError('internal', 'Réponse Gemini JSON invalide.', {
        code: 'GEMINI_JSON_PARSE_ERROR',
        originalText: text.substring(0, 1000),
      });
    }

    return parsedOutput;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('[Gemini] Erreur extraction texte', { error: err.message, response: JSON.stringify(responseJson).substring(0, 2000) });
    throw new HttpsError('internal', 'Erreur traitement réponse Gemini.', {
      code: 'GEMINI_EXTRACTION_ERROR',
      originalError: err.message,
    });
  }
}

/**
 * Wrapper avec gestion clé non configurée
 * @param {object} params
 * @returns {Promise<object>} Gemini output validé
 */
async function generateCampaignWithGemini(params) {
  const apiKey = getGeminiApiKey();
  const rawOutput = await callGeminiAPI(params, apiKey);

  // Validation sera faite par validation.js dans index.js, mais on peut déjà logger
  logger.info('[Gemini] Output brut reçu', {
    hasHooks: !!rawOutput.hooks,
    hasSocialPost: !!rawOutput.social_post,
    hasEmail: !!rawOutput.email,
    hasImagePrompt: !!rawOutput.image_prompt,
  });

  return rawOutput;
}

module.exports = {
  getGeminiApiKey,
  buildGeminiPrompt,
  callGeminiAPI,
  generateCampaignWithGemini,
};
