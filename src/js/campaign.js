/**
 * MarketPulse AI - Campagne & Génération
 * Phase 4B.2 - Génération sécurisée Gemini via Cloud Functions + idempotence + remboursement
 *
 * Flux:
 * clic Générer -> generationId unique -> secureGenerateCampaign() backend -> Gemini -> résultat -> affichage
 * Débit sécurisé 1 crédit atomique côté serveur, remboursement automatique si échec Gemini
 */

import { PRESETS } from './config.js';
import { state, getUserCredits, setLastGeneratedData, checkIfProUser } from './state.js';
import { getCampaignImageUrl, escapeHtml, escapeAttribute, downloadImage } from './utils.js';
import { showToast, openChariowModal, openOnboardingModal, updateCreditsUI } from './ui.js';
import { saveCampaignToLocalHistory } from './history.js';
import { incrementAnalytics } from './analytics.js';
import { getCurrentFirebaseUser, secureGenerateCampaign, generateGenerationId } from './firebase/index.js';

export function applyPreset(key) {
  const data = PRESETS[key];
  if (!data) return;
  const brandEl = document.getElementById('brandName');
  const targetEl = document.getElementById('targetAudience');
  const toneEl = document.getElementById('campaignTone');
  const offerEl = document.getElementById('offerDetails');
  if (brandEl) brandEl.value = data.brand;
  if (targetEl) targetEl.value = data.target;
  if (toneEl) toneEl.value = data.tone;
  if (offerEl) offerEl.value = data.offer;
  showToast(`🎯 Modèle "${data.brand}" appliqué !`, 'info');
}

export async function generateCampaign(e) {
  e.preventDefault();

  // Phase 4B.2: Vérification Firebase Auth source vérité + email vérifié
  try {
    const firebaseUser = await getCurrentFirebaseUser();
    if (!firebaseUser) {
      showToast("Veuillez vous connecter pour générer une campagne.", "error");
      openOnboardingModal();
      return;
    }
    if (!firebaseUser.emailVerified) {
      showToast("🔒 Veuillez vérifier votre e-mail avant de générer. Vérifiez votre boîte de réception.", "error");
      openOnboardingModal();
      const event = new CustomEvent('showVerification');
      document.dispatchEvent(event);
      return;
    }
    state.userEmail = firebaseUser.email;
  } catch (err) {
    console.warn('[Campaign] Firebase check failed:', err.message);
    if (!state.userEmail) {
      showToast("Veuillez vous connecter.", "error");
      openOnboardingModal();
      return;
    }
  }

  // Recharge état frais (pour affichage rapide, mais serveur reste source vérité crédits)
  state.credits = getUserCredits(state.userEmail);
  state.isProUser = checkIfProUser(state.userEmail);

  // Vérif rapide crédits côté client (UX), mais serveur vérifiera vraiment
  if (!state.isProUser && state.credits <= 0) {
    showToast("Vous n'avez plus de crédits disponibles. Rechargez via Chariow !", 'error');
    openChariowModal();
    return;
  }

  const brand = document.getElementById('brandName')?.value?.trim() || '';
  const target = document.getElementById('targetAudience')?.value?.trim() || '';
  const tone = document.getElementById('campaignTone')?.value?.trim() || '';
  const lang = document.getElementById('generationLanguage')?.value || 'Français 🇫🇷';
  const offer = document.getElementById('offerDetails')?.value?.trim() || '';
  const preset = document.querySelector('[data-preset].active')?.dataset?.preset || null;

  // Validation basique frontend (serveur revalidera)
  if (!brand || !target || !tone || !offer) {
    showToast("Veuillez remplir tous les champs obligatoires.", "error");
    return;
  }

  const btn = document.getElementById('generateBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Génération sécurisée en ${escapeHtml(lang)}...`;
  }

  // Phase 4B.2: Génération generationId unique pour idempotence
  const generationId = generateGenerationId();
  console.log('[Campaign] Nouvelle génération', { generationId, brand, target, lang });

  try {
    // Appel backend sécurisé Gemini
    showToast("🚀 Génération sécurisée en cours via Gemini...", "info");

    const { data, error } = await secureGenerateCampaign({
      generationId,
      brand,
      target,
      tone,
      lang,
      offer,
      preset,
    });

    if (error) {
      console.error('[Campaign] Erreur backend', error);

      // Gestion erreurs spécifiques
      if (error.isInsufficientCredits || error.code === 'failed-precondition' || error.details?.code === 'INSUFFICIENT_CREDITS') {
        showToast("❌ Crédits insuffisants. Rechargez vos crédits !", "error");
        openChariowModal();
        // Met à jour crédits UI si backend retourne solde
        if (error.details?.currentCredits !== undefined) {
          state.credits = error.details.currentCredits;
          updateCreditsUI();
        }
        return;
      }

      if (error.isAlreadyProcessing || error.code === 'already-processing' || error.message?.includes('déjà en cours')) {
        showToast("⏳ Génération déjà en cours avec ce ID. Veuillez patienter ou réessayer.", "info");
        return;
      }

      if (error.isEmailNotVerified) {
        showToast("🔒 Veuillez vérifier votre email.", "error");
        openOnboardingModal();
        return;
      }

      if (error.code === 'auth/no-token') {
        showToast("🔐 Session Firebase expirée. Déconnectez-vous, reconnectez-vous, puis réessayez.", "error");
        openOnboardingModal();
        return;
      }

      if (error.code === 'functions-unavailable') {
        showToast("❌ Backend temporairement indisponible. Veuillez réessayer plus tard.", "error");
        return;
      }

      if (error.code === 'GEMINI_KEY_NOT_CONFIGURED') {
        showToast("⚙️ Service génération non configuré côté serveur (clé Gemini manquante). Contactez admin.", "error");
        return;
      }

      // Erreur générique Gemini ou autre
      const errorMsg = error.message || "Erreur lors de la génération.";
      showToast(`❌ ${errorMsg}`, "error");

      // Si remboursement a eu lieu, informer
      if (error.details?.refunded || error.message?.includes('rembours')) {
        showToast("💳 Crédit remboursé suite à l'échec.", "info");
      }

      return;
    }

    if (!data || !data.success) {
      // Cas où backend retourne success false avec errorCode
      const errCode = data?.errorCode || 'UNKNOWN_ERROR';
      const errMsg = data?.message || 'Erreur génération';

      console.warn('[Campaign] Backend retourne success false', { errCode, errMsg, generationId });

      if (errCode === 'INSUFFICIENT_CREDITS') {
        showToast("❌ Crédits insuffisants.", "error");
        openChariowModal();
        if (data?.credits !== undefined) {
          state.credits = data.credits === Infinity ? state.credits : data.credits;
          updateCreditsUI();
        }
        return;
      }

      if (errCode === 'ALREADY_PROCESSING') {
        showToast("⏳ Génération déjà en cours. Patientez...", "info");
        return;
      }

      showToast(`❌ ${errMsg}`, "error");
      if (data?.refunded) {
        showToast("💳 Crédit remboursé.", "info");
        if (data?.credits !== undefined) {
          state.credits = data.credits;
          updateCreditsUI();
        }
      }
      return;
    }

    // Succès
    const campaign = data.campaign;
    const newCredits = data.credits;
    const campaignId = data.campaignId;
    const transactionId = data.transactionId;
    const isIdempotent = data.idempotent || false;

    console.log('[Campaign] Génération réussie', { generationId, campaignId, transactionId, isIdempotent, credits: newCredits });

    // Met à jour crédits UI depuis backend (source vérité)
    if (typeof newCredits === 'number' && !data.isPro) {
      // Pour compatibilité LS, on met à jour LS aussi, mais serveur est source vérité
      // On ne fait plus saveUserCredits avec -1, on met à jour avec nouveau solde serveur
      state.credits = newCredits;
      // Sauvegarde LS pour compatibilité affichage rapide (mais serveur reste vérité)
      try {
        const { saveUserCredits } = await import('./state.js');
        saveUserCredits(state.userEmail, newCredits);
      } catch (e) {
        console.warn('[Campaign] Erreur saveUserCredits compat', e.message);
      }
      updateCreditsUI();
    } else if (data.isPro) {
      state.isProUser = true;
      updateCreditsUI();
    }

    // Prépare données pour affichage compatible history.js
    // Gemini retourne: hooks, social_post, email {subject, body}, image_prompt
    // history.js attend: hooks, post, email (string ou objet), brand, target, tone, lang, offer, preset, source, generationId, etc.
    const displayData = {
      brand: campaign.brand || brand,
      target: campaign.target || target,
      tone: campaign.tone || tone,
      lang: campaign.lang || lang,
      offer: campaign.offer || offer,
      preset: campaign.preset || preset,
      hooks: campaign.hooks || [],
      post: campaign.post || campaign.social_post || '',
      email: campaign.email || { subject: '', body: '' },
      // Pour compatibilité renderResults qui attend email string ou objet
      emailSubject: campaign.email?.subject || '',
      emailBody: campaign.email?.body || '',
      imagePrompt: campaign.imagePrompt || campaign.image_prompt || '',
      source: 'gemini',
      generationId: generationId,
      campaignId: campaignId,
      transactionId: transactionId,
      createdAt: campaign.createdAt || new Date().toISOString(),
      wordCount: campaign.wordCount || 0,
    };

    // Pour incrementAnalytics qui attend hooks/post/email
    incrementAnalytics({
      hooks: displayData.hooks,
      post: displayData.post,
      email: displayData.emailBody || displayData.email?.body || '',
      wordCount: displayData.wordCount,
    });

    setLastGeneratedData(displayData);
    renderResults(displayData.brand, displayData, displayData.tone, displayData.lang);

    // Sauvegarde locale pour compatibilité historique immédiat (backend a déjà sauvegardé dans Firestore)
    // On sauvegarde avec campaignId et source gemini pour que history.js l'affiche même si Firestore pas encore rechargé
    try {
      saveCampaignToLocalHistory({
        ...displayData,
        id: campaignId,
        source: 'gemini',
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[Campaign] Erreur saveCampaignToLocalHistory', e.message);
    }

    if (isIdempotent) {
      showToast(`✅ Campagne déjà générée (idempotence) - ${displayData.brand} - Crédits: ${data.isPro ? '∞ PRO' : newCredits}`, "success");
    } else {
      showToast(data.isPro ? `✅ Campagne Gemini générée en Mode PRO !` : `✅ Campagne Gemini générée ! (-1 crédit) - Reste: ${newCredits}`, "success");
    }

  } catch (err) {
    console.error("[Campaign] Erreur génération sécurisée:", err);
    showToast(`❌ Erreur: ${err.message || 'Erreur lors de la génération.'}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles text-base"></i> Générer la Campagne ${state.isProUser ? '(Illimité PRO)' : '(1 crédit)'}`;
    }
  }
}

export function renderResults(brand, data, tone, lang) {
  const container = document.getElementById('resultsContainer');
  if (!container) return;
  const imageUrl = getCampaignImageUrl(brand, state.lastGeneratedData ? state.lastGeneratedData.offer : '');

  const safeBrand = escapeHtml(brand);
  const safeBrandInitial = escapeHtml(brand.charAt(0).toUpperCase());
  const safeLang = escapeHtml(lang || 'FR');
  const safeTone = escapeHtml(tone || '');

  // Supporte post comme string et email comme string ou objet {subject, body}
  let postContent = '';
  let emailSubject = '';
  let emailBody = '';

  if (typeof data.post === 'string') {
    postContent = data.post;
  } else if (data.social_post) {
    postContent = data.social_post;
  }

  if (typeof data.email === 'string') {
    emailBody = data.email;
  } else if (data.email && typeof data.email === 'object') {
    emailSubject = data.email.subject || data.emailSubject || '';
    emailBody = data.email.body || data.emailBody || '';
  } else {
    emailBody = data.emailBody || '';
    emailSubject = data.emailSubject || '';
  }

  const safePost = escapeHtml(postContent).replace(/\n/g, '<br>');
  const safeEmailSubject = escapeHtml(emailSubject);
  const safeEmailBody = escapeHtml(emailBody).replace(/\n/g, '<br>');

  const hooksHtml = (data.hooks || []).map(h => {
    const safeH = escapeHtml(h);
    const attrH = escapeAttribute(h);
    return `<li class="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-medium flex items-center justify-between group">
      <span>${safeH}</span>
      <button data-action="copy-hook" data-hook="${attrH}" class="text-slate-400 hover:text-blue-600 text-xs p-1" title="Copier cette accroche">
        <i class="fa-solid fa-copy"></i>
      </button>
    </li>`;
  }).join('');

  const safeImageUrl = escapeAttribute(imageUrl);
  const safeFileName = `visuel_${brand.toLowerCase().replace(/\s+/g, '_')}.jpg`;
  const safeFileNameAttr = escapeAttribute(safeFileName);

  const imagePromptSection = data.imagePrompt ? `
      <div class="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/50">
        <span class="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider">Image Prompt (Phase 5)</span>
        <p class="text-xs text-slate-700 dark:text-slate-300 mt-1">${escapeHtml(data.imagePrompt)}</p>
      </div>
  ` : '';

  const generationIdBadge = data.generationId ? `
    <span class="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-mono">ID: ${escapeHtml(data.generationId.substring(0, 20))}...</span>
  ` : '';

  const sourceBadge = data.source === 'gemini' ? `
    <span class="text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
      <i class="fa-solid fa-wand-magic-sparkles"></i> Gemini
    </span>
  ` : `
    <span class="text-[10px] bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-extrabold px-2 py-0.5 rounded">Template</span>
  `;

  container.innerHTML = `
    <div id="exportableCampaignContent" class="space-y-4">
      <div class="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <i class="fa-brands fa-linkedin text-blue-600 dark:text-blue-400 text-sm"></i> Prévisualisation Mockup (${safeLang})
          </span>
          <div class="flex items-center gap-2">
            ${sourceBadge}
            ${generationIdBadge}
            <button data-action="copy-post" class="text-xs px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-bold flex items-center gap-1 transition-all">
              <i class="fa-solid fa-copy text-blue-500"></i> Copier le Post
            </button>
          </div>
        </div>

        <div class="p-4 bg-slate-50/80 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-3 font-sans">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-amber-400 flex items-center justify-center text-white font-extrabold text-sm shadow-sm">
                ${safeBrandInitial}
              </div>
              <div>
                <h4 class="text-xs font-extrabold text-slate-900 dark:text-white">${safeBrand}</h4>
                <p class="text-[10px] text-slate-400">Compte Officiel • À l'instant • 🌐</p>
              </div>
            </div>
            <button class="text-blue-600 dark:text-blue-400 hover:text-blue-700 text-xs font-bold flex items-center gap-1">
              <i class="fa-solid fa-plus text-[10px]"></i> Suivre
            </button>
          </div>

          <div class="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-normal">
            ${safePost}
          </div>

          <div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm my-2 relative group">
            <img src="${safeImageUrl}" alt="Visuel Publicitaire ${escapeAttribute(brand)}" class="w-full h-48 sm:h-56 object-cover hover:scale-105 transition-all duration-300">
            <button data-action="download-image" data-url="${safeImageUrl}" data-filename="${safeFileNameAttr}" class="absolute top-3 right-3 bg-slate-900/85 hover:bg-slate-900 text-white text-xs px-3 py-1.5 rounded-xl font-bold backdrop-blur-md shadow-lg transition-all flex items-center gap-1.5">
              <i class="fa-solid fa-download text-amber-400"></i> Télécharger l'image
            </button>
          </div>

          ${imagePromptSection}

          <div class="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <button class="hover:text-blue-600 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-all font-semibold">
              <i class="fa-regular fa-thumbs-up text-amber-500"></i> J'aime (42)
            </button>
            <button class="hover:text-blue-600 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-all font-semibold">
              <i class="fa-regular fa-comment"></i> Commenter (12)
            </button>
            <button class="hover:text-blue-600 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-all font-semibold">
              <i class="fa-solid fa-share"></i> Partager
            </button>
          </div>
        </div>
      </div>

      <div class="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
        <span class="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <i class="fa-solid fa-bolt text-amber-500"></i> ${data.hooks?.length || 3} Accroches Virales (Hooks)
        </span>
        <ul class="space-y-2 text-xs text-slate-800 dark:text-slate-200">
          ${hooksHtml}
        </ul>
      </div>

      <div class="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
        <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <span class="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <i class="fa-solid fa-envelope text-blue-500"></i> E-mail de Prospection
            ${safeEmailSubject ? `<span class="ml-2 text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Sujet: ${safeEmailSubject}</span>` : ''}
          </span>
          <button data-action="copy-email" class="text-xs px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-bold flex items-center gap-1 transition-all">
            <i class="fa-solid fa-copy text-blue-500"></i> Copier l'E-mail
          </button>
        </div>
        <div class="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
          ${safeEmailSubject ? `<div class="font-bold mb-2 pb-2 border-b border-slate-200 dark:border-slate-700">Objet: ${safeEmailSubject}</div>` : ''}
          ${safeEmailBody}
        </div>
      </div>
    </div>
  `;
}

export function handleResultsContainerClick(e, deps) {
  const { copySingleHook, copySingleSection } = deps;
  const target = e.target.closest('button');
  if (!target) return;
  const action = target.dataset.action;
  if (!action) return;

  if (action === 'copy-hook') {
    const hookText = target.dataset.hook;
    if (hookText) copySingleHook(hookText);
  } else if (action === 'copy-post') {
    copySingleSection('post');
  } else if (action === 'copy-email') {
    copySingleSection('email');
  } else if (action === 'download-image') {
    const url = target.dataset.url;
    const filename = target.dataset.filename;
    if (url) {
      downloadImage(url, filename, showToast);
    }
  }
}
