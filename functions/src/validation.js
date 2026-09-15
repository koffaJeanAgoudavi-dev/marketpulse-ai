/**
 * MarketPulse AI - Validation Paramètres
 * Phase 4B.2 - Validation serveur obligatoire, ne jamais faire confiance frontend
 */

const { HttpsError } = require('firebase-functions/v2/https');

/**
 * Limites raisonnables pour éviter abus
 */
const LIMITS = {
  generationId: { min: 8, max: 100, pattern: /^gen_[a-zA-Z0-9_-]+$/ },
  brand: { min: 1, max: 100 },
  target: { min: 1, max: 200 },
  tone: { min: 1, max: 50 },
  lang: { min: 2, max: 50 },
  offer: { min: 1, max: 500 },
  preset: { min: 0, max: 50, optional: true },
};

/**
 * Nettoie et normalise string (trim, escape basique)
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function cleanString(str, maxLen) {
  if (typeof str !== 'string') return '';
  let cleaned = str.trim();
  // Limite longueur
  if (cleaned.length > maxLen) {
    cleaned = cleaned.substring(0, maxLen);
  }
  // Supprime caractères de contrôle dangereux (garde \n pour prompt)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned;
}

/**
 * Valide generationId
 * @param {any} generationId
 * @returns {string} generationId validé
 * @throws {HttpsError} invalid-argument
 */
function validateGenerationId(generationId) {
  if (!generationId || typeof generationId !== 'string') {
    throw new HttpsError('invalid-argument', 'generationId requis et doit être une chaîne.', {
      code: 'INVALID_GENERATION_ID',
    });
  }

  const cleaned = generationId.trim();

  if (cleaned.length < LIMITS.generationId.min || cleaned.length > LIMITS.generationId.max) {
    throw new HttpsError('invalid-argument', `generationId doit avoir entre ${LIMITS.generationId.min} et ${LIMITS.generationId.max} caractères.`, {
      code: 'INVALID_GENERATION_ID',
    });
  }

  if (!LIMITS.generationId.pattern.test(cleaned)) {
    throw new HttpsError('invalid-argument', 'generationId invalide. Format attendu: gen_ + alphanumérique.', {
      code: 'INVALID_GENERATION_ID',
    });
  }

  return cleaned;
}

/**
 * Valide paramètres génération
 * @param {object} data - { generationId, brand, target, tone, lang, offer, preset }
 * @returns {object} données nettoyées
 * @throws {HttpsError}
 */
function validateGenerationParams(data) {
  if (!data || typeof data !== 'object') {
    throw new HttpsError('invalid-argument', 'Paramètres manquants.', { code: 'MISSING_PARAMS' });
  }

  const { generationId, brand, target, tone, lang, offer, preset } = data;

  // generationId obligatoire
  const validGenerationId = validateGenerationId(generationId);

  // brand obligatoire
  if (!brand || typeof brand !== 'string' || brand.trim().length < LIMITS.brand.min) {
    throw new HttpsError('invalid-argument', 'brand requis.', { code: 'MISSING_BRAND' });
  }
  if (brand.length > LIMITS.brand.max) {
    throw new HttpsError('invalid-argument', `brand trop long (max ${LIMITS.brand.max}).`, { code: 'BRAND_TOO_LONG' });
  }

  // target obligatoire
  if (!target || typeof target !== 'string' || target.trim().length < LIMITS.target.min) {
    throw new HttpsError('invalid-argument', 'target requis.', { code: 'MISSING_TARGET' });
  }
  if (target.length > LIMITS.target.max) {
    throw new HttpsError('invalid-argument', `target trop long (max ${LIMITS.target.max}).`, { code: 'TARGET_TOO_LONG' });
  }

  // tone obligatoire
  if (!tone || typeof tone !== 'string' || tone.trim().length < LIMITS.tone.min) {
    throw new HttpsError('invalid-argument', 'tone requis.', { code: 'MISSING_TONE' });
  }
  if (tone.length > LIMITS.tone.max) {
    throw new HttpsError('invalid-argument', `tone trop long (max ${LIMITS.tone.max}).`, { code: 'TONE_TOO_LONG' });
  }

  // lang obligatoire
  if (!lang || typeof lang !== 'string' || lang.trim().length < LIMITS.lang.min) {
    throw new HttpsError('invalid-argument', 'lang requis.', { code: 'MISSING_LANG' });
  }
  if (lang.length > LIMITS.lang.max) {
    throw new HttpsError('invalid-argument', `lang trop long (max ${LIMITS.lang.max}).`, { code: 'LANG_TOO_LONG' });
  }

  // offer obligatoire
  if (!offer || typeof offer !== 'string' || offer.trim().length < LIMITS.offer.min) {
    throw new HttpsError('invalid-argument', 'offer requis.', { code: 'MISSING_OFFER' });
  }
  if (offer.length > LIMITS.offer.max) {
    throw new HttpsError('invalid-argument', `offer trop long (max ${LIMITS.offer.max}).`, { code: 'OFFER_TOO_LONG' });
  }

  // preset optionnel
  let validPreset = null;
  if (preset !== undefined && preset !== null && preset !== '') {
    if (typeof preset !== 'string') {
      throw new HttpsError('invalid-argument', 'preset doit être une chaîne.', { code: 'INVALID_PRESET' });
    }
    if (preset.length > LIMITS.preset.max) {
      throw new HttpsError('invalid-argument', `preset trop long (max ${LIMITS.preset.max}).`, { code: 'PRESET_TOO_LONG' });
    }
    validPreset = cleanString(preset, LIMITS.preset.max);
  }

  // Nettoyage
  return {
    generationId: validGenerationId,
    brand: cleanString(brand, LIMITS.brand.max),
    target: cleanString(target, LIMITS.target.max),
    tone: cleanString(tone, LIMITS.tone.max),
    lang: cleanString(lang, LIMITS.lang.max),
    offer: cleanString(offer, LIMITS.offer.max),
    preset: validPreset,
  };
}

/**
 * Valide sortie Gemini
 * @param {object} geminiOutput - { hooks, social_post, email: { subject, body }, image_prompt }
 * @returns {object} sortie validée
 * @throws {Error} si invalide
 */
function validateGeminiOutput(output) {
  if (!output || typeof output !== 'object') {
    throw new Error('Gemini output invalide: doit être un objet');
  }

  const { hooks, social_post, email, image_prompt } = output;

  // hooks: tableau non vide
  if (!Array.isArray(hooks) || hooks.length === 0) {
    throw new Error('Gemini output invalide: hooks doit être un tableau non vide');
  }
  // Vérifie chaque hook non vide et limite
  for (let i = 0; i < hooks.length; i++) {
    if (typeof hooks[i] !== 'string' || hooks[i].trim().length === 0) {
      throw new Error(`Gemini output invalide: hooks[${i}] doit être une chaîne non vide`);
    }
    if (hooks[i].length > 500) {
      throw new Error(`Gemini output invalide: hooks[${i}] trop long`);
    }
  }
  if (hooks.length < 2) {
    throw new Error('Gemini output invalide: hooks doit contenir au moins 2 accroches');
  }

  // social_post: chaîne non vide
  if (!social_post || typeof social_post !== 'string' || social_post.trim().length === 0) {
    throw new Error('Gemini output invalide: social_post doit être une chaîne non vide');
  }
  if (social_post.length > 5000) {
    throw new Error('Gemini output invalide: social_post trop long');
  }

  // email.subject: chaîne non vide
  if (!email || typeof email !== 'object') {
    throw new Error('Gemini output invalide: email doit être un objet');
  }
  if (!email.subject || typeof email.subject !== 'string' || email.subject.trim().length === 0) {
    throw new Error('Gemini output invalide: email.subject doit être une chaîne non vide');
  }
  if (email.subject.length > 500) {
    throw new Error('Gemini output invalide: email.subject trop long');
  }

  // email.body: chaîne non vide
  if (!email.body || typeof email.body !== 'string' || email.body.trim().length === 0) {
    throw new Error('Gemini output invalide: email.body doit être une chaîne non vide');
  }
  if (email.body.length > 10000) {
    throw new Error('Gemini output invalide: email.body trop long');
  }

  // image_prompt: chaîne non vide
  if (!image_prompt || typeof image_prompt !== 'string' || image_prompt.trim().length === 0) {
    throw new Error('Gemini output invalide: image_prompt doit être une chaîne non vide');
  }
  if (image_prompt.length > 1000) {
    throw new Error('Gemini output invalide: image_prompt trop long');
  }

  // Nettoyage et normalisation
  return {
    hooks: hooks.map(h => h.trim()).slice(0, 5), // Max 5 hooks
    social_post: social_post.trim(),
    email: {
      subject: email.subject.trim(),
      body: email.body.trim(),
    },
    image_prompt: image_prompt.trim(),
  };
}

module.exports = {
  LIMITS,
  cleanString,
  validateGenerationId,
  validateGenerationParams,
  validateGeminiOutput,
};
