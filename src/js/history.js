/**
 * MarketPulse AI - Historique
 * Phase 3B: Migration vers Firestore users/{uid}/campaigns/{campaignId}
 * - Lecture depuis Firestore si disponible, fallback localStorage
 * - Sauvegarde double: Firestore + localStorage filet sécurité
 * - Structure campagne: createdAt, brand, target, tone, lang, offer, hooks, post, email, imageUrl, preset, source, wordCount
 */

import { STORAGE_KEYS, MAX_HISTORY } from './config.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { getCurrentFirebaseUser, createCampaignInFirestore, getCampaignsFromFirestore } from './firebase/index.js';

let lastFirestoreDocs = []; // Cache pour pagination et restore par ID

function renderHistoryList(container, historyArray, isFirestore = false) {
  if (!container) return;

  if (historyArray.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-4">Aucune campagne sauvegardée pour le moment.</p>`;
    return;
  }

  if (isFirestore) {
    // Firestore: utilise ID doc - Phase 4B.2 compatible gemini + template + legacy
    lastFirestoreDocs = historyArray;
    container.innerHTML = historyArray.map((item) => {
      const sourceLabel = item.source === 'legacy' ? 'Legacy' : item.source === 'gemini' ? 'Gemini ✨' : 'Template';
      const sourceClass = item.source === 'legacy' ? 'bg-amber-100 text-amber-700' : item.source === 'gemini' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
      const generationIdShort = item.generationId ? item.generationId.substring(0, 12) : '';
      return `
      <div data-action="restore-history-firestore" data-id="${escapeHtml(item.id)}" class="p-3 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer transition-all space-y-1 group">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">${escapeHtml(item.brand || '')}</span>
          <span class="text-[9px] ${sourceClass} px-1.5 py-0.5 rounded font-bold">${escapeHtml(sourceLabel)}</span>
        </div>
        <p class="text-[10px] text-slate-500 truncate">${escapeHtml(item.hooks ? item.hooks[0] : '')}</p>
        <div class="flex items-center justify-between">
          <p class="text-[9px] text-slate-400">${item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString('fr-FR') : ''}</p>
          ${generationIdShort ? `<span class="text-[8px] text-slate-400 font-mono">${escapeHtml(generationIdShort)}...</span>` : ''}
        </div>
      </div>
    `;
    }).join('');
  } else {
    // localStorage legacy: index - compatible gemini format aussi
    container.innerHTML = historyArray.map((item, index) => {
      const sourceLabel = item.source === 'gemini' ? 'Gemini ✨' : item.tone || 'Template';
      return `
      <div data-action="restore-history" data-index="${index}" class="p-3 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer transition-all space-y-1 group">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">${escapeHtml(item.brand || '')}</span>
          <span class="text-[9px] ${item.source === 'gemini' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 dark:bg-slate-700'} px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 font-bold">${escapeHtml(sourceLabel)}</span>
        </div>
        <p class="text-[10px] text-slate-500 truncate">${escapeHtml(item.hooks ? item.hooks[0] : '')}</p>
      </div>
    `;
    }).join('');
  }
}

export async function saveCampaignToLocalHistory(campaign) {
  if (!state.userEmail) return;

  // Filet sécurité localStorage conservé Phase 4B.2 - compatible gemini + template
  const key = `${STORAGE_KEYS.HISTORY_PREFIX}${state.userEmail.toLowerCase().trim()}`;
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.unshift(campaign);
  localStorage.setItem(key, JSON.stringify(existing.slice(0, MAX_HISTORY)));

  // Firestore: users/{uid}/campaigns/{campaignId} - Phase 4B.2
  // Note: En Phase 4B.2, secureGenerateCampaign sauvegarde déjà côté serveur avec source gemini
  // Cette fonction est maintenant principalement pour compatibilité template legacy et cache local
  // On évite double sauvegarde si source gemini et déjà sauvegardée par backend (campaign a id serveur)
  if (campaign.source === 'gemini' && campaign.id && campaign.id.startsWith('cmp_')) {
    console.log('[History] Campagne Gemini déjà sauvegardée par backend, LS seulement');
    loadUserHistory(state.userEmail);
    return;
  }

  try {
    const firebaseUser = await getCurrentFirebaseUser();
    if (firebaseUser && firebaseUser.emailVerified) {
      const uid = firebaseUser.uid;
      // Prépare données Firestore avec schéma Phase 4B.2 compatible
      // Supporte email comme string (legacy) ou objet {subject, body} (gemini)
      let emailField = campaign.email;
      if (campaign.email && typeof campaign.email === 'object' && campaign.email.subject) {
        // Nouveau format gemini: garde objet
        emailField = campaign.email;
      }

      const firestoreCampaign = {
        brand: campaign.brand,
        target: campaign.target,
        tone: campaign.tone,
        lang: campaign.lang || 'Français 🇫🇷',
        offer: campaign.offer,
        hooks: campaign.hooks,
        post: campaign.post || campaign.social_post || '',
        email: emailField,
        imageUrl: campaign.imageUrl || null,
        imagePrompt: campaign.imagePrompt || campaign.image_prompt || null,
        preset: campaign.preset || null,
        source: campaign.source || 'template',
        generationId: campaign.generationId || null,
        wordCount: campaign.wordCount || 0,
      };
      const { error } = await createCampaignInFirestore(uid, firestoreCampaign);
      if (error) {
        console.warn('[History] Firestore save failed, LS fallback OK:', error.message);
      } else {
        console.log('[History] Campagne sauvegardée Firestore + LS');
      }
    }
  } catch (err) {
    console.warn('[History] Firestore save error, LS fallback:', err.message);
  }

  loadUserHistory(state.userEmail);
}

export async function loadUserHistory(email) {
  if (!email) return;
  const container = document.getElementById('historyList');
  if (!container) return;

  // Tente Firestore d'abord si Firebase dispo
  try {
    const firebaseUser = await getCurrentFirebaseUser();
    if (firebaseUser && firebaseUser.emailVerified) {
      const uid = firebaseUser.uid;
      const { data: campaigns, error } = await getCampaignsFromFirestore(uid, 20);
      if (!error && campaigns && campaigns.length > 0) {
        renderHistoryList(container, campaigns, true);
        return;
      }
      // Si Firestore vide, fallback LS
      console.info('[History] Firestore vide, fallback LS');
    }
  } catch (err) {
    console.warn('[History] Firestore load failed, fallback LS:', err.message);
  }

  // Fallback localStorage legacy
  const key = `${STORAGE_KEYS.HISTORY_PREFIX}${email.toLowerCase().trim()}`;
  const history = JSON.parse(localStorage.getItem(key) || '[]');
  renderHistoryList(container, history, false);
}

export function getHistoryForUser(email) {
  if (!email) return [];
  const key = `${STORAGE_KEYS.HISTORY_PREFIX}${email.toLowerCase().trim()}`;
  return JSON.parse(localStorage.getItem(key) || '[]');
}

export function getFirestoreHistoryCache() {
  return lastFirestoreDocs;
}

export function getCampaignFromFirestoreCacheById(id) {
  return lastFirestoreDocs.find(c => c.id === id) || null;
}

export function restoreCampaignFromHistory(index, onRestoreCallback) {
  if (!state.userEmail) return;
  const history = getHistoryForUser(state.userEmail);
  const campaign = history[index];
  if (!campaign) return;
  if (onRestoreCallback) onRestoreCallback(campaign);
}

export function clearUserHistoryUI() {
  const container = document.getElementById('historyList');
  if (container) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-4">Connectez-vous pour voir votre historique.</p>`;
  }
  lastFirestoreDocs = [];
}
