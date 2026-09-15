/**
 * MarketPulse AI - Utilitaires
 * Phase 1A: Fonctions utilitaires partagées
 */
import { IMAGE_URLS } from './config.js';

/**
 * Échappement HTML basique pour éviter XSS lors du rendu
 * Conserve le comportement visuel mais sécurise l'injection
 */
export function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Échappement pour attributs HTML
 */
export function escapeAttribute(text) {
  return escapeHtml(text).replace(/`/g, '&#96;');
}

/**
 * Copie texte vers clipboard - méthode moderne + fallback
 */
export function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    console.error("Copy failed:", err);
  }
  document.body.removeChild(textArea);
}

/**
 * Téléchargement image via blob avec fallback
 */
export async function downloadImage(url, filename, showToastFn) {
  try {
    if (showToastFn) showToastFn("⏳ Préparation du téléchargement de l'image...", "info");
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'visuel_publicitaire.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    if (showToastFn) showToastFn("🖼️ Image téléchargée avec succès !", "success");
  } catch (err) {
    console.log("Image fetch fallback:", err);
    window.open(url, '_blank');
    if (showToastFn) showToastFn("🖼️ Visuel ouvert dans un nouvel onglet.", "info");
  }
}

/**
 * Sélection image publicitaire selon mots-clés (logique originale conservée)
 */
export function getCampaignImageUrl(brand, offer) {
  const text = (brand + ' ' + (offer || '')).toLowerCase();
  if (text.includes('resto') || text.includes('gourmand') || text.includes('cuisine') || text.includes('plat') || text.includes('grill')) {
    return IMAGE_URLS.resto;
  } else if (text.includes('immo') || text.includes('villa') || text.includes('maison') || text.includes('appartement')) {
    return IMAGE_URLS.immo;
  } else if (text.includes('ecom') || text.includes('shop') || text.includes('mode') || text.includes('livraison') || text.includes('tech')) {
    return IMAGE_URLS.ecom;
  } else if (text.includes('coach') || text.includes('form') || text.includes('academ') || text.includes('etud')) {
    return IMAGE_URLS.coaching;
  } else {
    return IMAGE_URLS.default;
  }
}

/**
 * Génération code parrainage (logique originale conservée: btoa tronqué)
 */
export function generateReferralCode(email) {
  if (!email) return 'FREE15';
  try {
    return btoa(email).substring(0, 8);
  } catch {
    return 'FREE15';
  }
}

/**
 * Génération lien de parrainage
 */
export function buildReferralLink(code) {
  return `${window.location.origin}${window.location.pathname}?ref=${code}`;
}
