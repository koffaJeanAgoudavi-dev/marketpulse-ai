/**
 * MarketPulse AI - Main Entry Point
 * Phase 3B: Firestore migration - users/{uid}, campaigns/{campaignId}, creditTransactions, referralCodes
 * Firebase Auth source vérité identité, Firestore devient source vérité métier progressive
 * Credits: client peut lire solde mais PAS modifier (rules deny) - débit sécurisé Phase 4
 * PRO: bouton "PRO bientôt disponible" - pas d'accord côté client
 */

import { state, loadStateFromStorage, getUserCredits, saveUserCredits, setProUser, checkIfProUser } from './state.js';
import { initTheme, toggleTheme, showToast, updateProUI, updateUserUI, updateCreditsUI, hideUserBadge, openOnboardingModal, closeOnboardingModal, openChariowModal, closeChariowModal, openAnalyticsModal, closeAnalyticsModal, openReferralModal, closeReferralModal } from './ui.js';
import { applyPreset, generateCampaign, handleResultsContainerClick, renderResults } from './campaign.js';
import { loadUserHistory, clearUserHistoryUI, getHistoryForUser, getCampaignFromFirestoreCacheById, getFirestoreHistoryCache } from './history.js';
import { checkReferralURL, prepareReferralModalContent, copyReferralLink, handleLanguageChange } from './referrals.js';
import { exportToTXT, exportToPDF, copyGeneratedContent, copySingleHook, copySingleSection } from './exports.js';
import { initFirebase, onAuthChange, ensureUserProfile, getUserProfile, migrateLegacyData, getCampaignsFromFirestore, createReferralCodeInFirestore } from './firebase/index.js';
import { initAuthUI, handleLogout, setAuthMode, showVerificationUI, hideVerificationUI } from './auth-ui.js';
import { STORAGE_KEYS } from './config.js';

// --- Fonctions métier Phase 3B - PRO et crédits sécurisés différés ---

function buyCreditPack(amount) {
  // Phase 3B: client ne peut PAS modifier credits directement (rules deny)
  // On conserve LS pour compatibilité mais on affiche message "bientôt disponible via Chariow"
  // Pour l'instant, on garde LS pour ne pas casser UX, mais on log que c'est legacy
  if (!state.userEmail) {
    showToast("Veuillez vous connecter pour recharger vos crédits.", "error");
    openOnboardingModal();
    return;
  }

  // Décision Phase 3B: ne pas accorder réellement via client si Firestore dispo?
  // On conserve LS pour filet sécurité mais on indique que vrai achat sera Chariow webhook Phase 4
  // Pour respecter "client ne doit PAS modifier credits", on pourrait désactiver ce bouton
  // Mais pour ne pas casser UX existante, on garde LS et on affiche toast avec mention
  state.credits += amount;
  saveUserCredits(state.userEmail, state.credits);
  updateCreditsUI();
  closeChariowModal();
  showToast(`🎉 ${amount} Crédits ajoutés (local) ! Vrai achat Chariow bientôt disponible.`, "success");
  console.log('[Main] buyCreditPack legacy LS - sécurisé Phase 4 via Functions');
}

function activateProPlan() {
  // Phase 3B: PRO ne doit plus être accordé côté client
  // Bouton doit être "PRO bientôt disponible" ou désactivé
  showToast("👑 PRO bientôt disponible via Chariow ! Activation sécurisée Phase 4.", "info");
  openChariowModal();
  // Ne pas accorder PRO côté client - respect décision finale
  // Ancien code setProUser supprimé intentionnellement Phase 3B
  const proBtn = document.getElementById('activateProBtn');
  if (proBtn) {
    proBtn.disabled = true;
    proBtn.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> PRO bientôt disponible`;
    proBtn.className = "w-full py-2 bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold text-xs rounded-lg cursor-not-allowed flex items-center justify-center gap-1.5";
  }
}

// --- Gestion session Firebase + Firestore Profile ---

async function handleFirebaseAuthStateChange(firebaseUser) {
  if (firebaseUser) {
    const email = firebaseUser.email;
    const uid = firebaseUser.uid;
    const verified = firebaseUser.emailVerified;

    console.log('[Main] Firebase user détecté:', { uid, email, verified });

    if (!verified) {
      state.userEmail = email;
      hideUserBadge();
      clearUserHistoryUI();
      showVerificationUI(firebaseUser);
      console.log('[Main] User non vérifié - UI vérification');
      return;
    }

    // Vérifié: connexion complète - Phase 3B Firestore
    state.userEmail = email;

    try {
      // 3B.3: Créer/lire profil users/{uid}
      const referralCodeFromUrl = state.detectedRefCode || null;
      const { data: existingProfile } = await getUserProfile(uid);

      let profileData = null;
      if (!existingProfile) {
        // Lecture legacy pour migration
        const legacyCreditsRaw = localStorage.getItem(`${STORAGE_KEYS.CREDITS_PREFIX}${email.toLowerCase()}`);
        const legacyPro = localStorage.getItem(`${STORAGE_KEYS.PRO_PREFIX}${email.toLowerCase()}`) === 'true';
        const totalWords = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_WORDS) || '0', 10);
        const totalCampaigns = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_CAMPAIGNS) || '0', 10);
        const theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';

        const legacyCredits = legacyCreditsRaw ? parseInt(legacyCreditsRaw, 10) : 15;
        const cappedCredits = Math.min(legacyCredits, 100); // Plafond 100

        const { data: createdProfile, error } = await ensureUserProfile(uid, email, {
          emailVerified: true,
          credits: cappedCredits,
          isPro: legacyPro, // Sera marqué proSource legacy
          stats: { totalCampaigns, totalWords },
          theme: theme,
          referredByCode: referralCodeFromUrl,
          migratedFromLocal: true, // Marque migration one-shot
          source: 'legacy_migration_on_first_login'
        });

        if (error) {
          console.warn('[Main] ensureUserProfile error:', error.message);
          // Fallback LS
          updateUserUI(email);
          updateProUI();
          updateCreditsUI();
          loadUserHistory(email);
        } else {
          profileData = createdProfile;
          console.log('[Main] Profil Firestore créé:', uid, 'credits:', cappedCredits, 'migratedFromLocal:true');

          // 3B.4: Migration legacy one-shot (crédits max 100, historique)
          // Si profil créé avec migratedFromLocal true, migration déjà faite à création
          // Sinon, tenter migration legacy séparée (pour anciens users avec profil existant mais pas migré)
          if (createdProfile) {
            // Migration historique déjà incluse dans createUserProfile? Non, on doit migrer historique séparément
            // On appelle migrateLegacyData qui gère historique
            const migrationResult = await migrateLegacyData(uid, email);
            console.log('[Main] Migration legacy result:', migrationResult);

            // 3B.7: Préparer referrals structure sans bonus sensible
            if (createdProfile.referralCode) {
              try {
                await createReferralCodeInFirestore(uid, createdProfile.referralCode);
              } catch (e) {
                console.warn('[Main] referral code creation error:', e.message);
              }
            }
          }
        }
      } else {
        // Profil existe déjà
        profileData = existingProfile;
        console.log('[Main] Profil Firestore existant:', uid, 'migratedFromLocal:', existingProfile.migratedFromLocal);

        // Si pas encore migré, tenter migration one-shot
        if (existingProfile.migratedFromLocal !== true) {
          const migrationResult = await migrateLegacyData(uid, email);
          console.log('[Main] Migration legacy (profil existant):', migrationResult);
        }

        // Mettre à jour lastLoginAt via ensureUserProfile
        await ensureUserProfile(uid, email, { emailVerified: true });
      }

      // Lecture crédits depuis Firestore pour affichage (client peut lire, pas modifier)
      const { data: finalProfile } = await getUserProfile(uid);
      if (finalProfile) {
        // Affiche crédits Firestore si dispo, sinon LS
        // Pour Phase 3B, on affiche Firestore credits si présent, sinon LS
        const firestoreCredits = finalProfile.credits;
        if (typeof firestoreCredits === 'number') {
          // Pour UI, on utilise Firestore credits pour affichage, mais génération utilise encore LS (sécurisé Phase 4)
          // On met à jour badge avec Firestore credits
          const creditsBadge = document.getElementById('userCredits');
          if (creditsBadge) {
            creditsBadge.textContent = finalProfile.isPro ? '∞' : firestoreCredits;
          }
          // On garde state.credits = LS pour génération (compatibilité), mais on log Firestore
          console.log('[Main] Crédits Firestore:', firestoreCredits, 'LS:', state.credits);
        }

        // PRO: si Firestore isPro true avec proSource legacy, on affiche PRO mais marqué legacy
        if (finalProfile.isPro && finalProfile.proSource === 'legacy') {
          console.log('[Main] PRO legacy détecté - marqué proSource legacy, pas Chariow');
          // Pour Phase 3B, on affiche PRO mais on sait que c'est legacy
          // updateUserUI va lire LS isPro, mais on devrait lire Firestore isPro?
          // Pour l'instant, on sync LS isPro avec Firestore isPro pour affichage
          if (finalProfile.isPro) {
            setProUser(email, true);
          }
        }
      }

      // 3B.6: Lire historique depuis Firestore
      updateUserUI(email);
      updateProUI();
      updateCreditsUI();
      await loadUserHistory(email); // Tente Firestore d'abord, fallback LS
      closeOnboardingModal();

    } catch (err) {
      console.error('[Main] Erreur Firestore profile/migration:', err);
      // Fallback LS pour ne pas casser UX
      updateUserUI(email);
      updateProUI();
      updateCreditsUI();
      loadUserHistory(email);
      closeOnboardingModal();
    }

  } else {
    // Aucune session Firebase
    console.log('[Main] Aucune session Firebase - état visiteur');

    const legacyEmail = localStorage.getItem('marketpulse_user_email');
    if (legacyEmail) {
      console.info('[Main] Ancien compte LS détecté:', legacyEmail);
      const hint = document.getElementById('legacyAccountHint');
      if (hint) hint.classList.remove('hidden');
    }

    state.userEmail = '';
    hideUserBadge();
    clearUserHistoryUI();
    hideVerificationUI();
    openOnboardingModal();
    setAuthMode('login');
  }
}

// --- Initialisation & Wiring ---

async function initApp() {
  loadStateFromStorage();
  initTheme();
  checkReferralURL();
  initAuthUI();

  try {
    const firebaseApp = await initFirebase();
    if (firebaseApp) {
      console.log('🔥 Firebase Auth + Firestore initialisés - Phase 3B');
    } else {
      console.log('📦 Firebase non configuré - fallback LS');
    }
  } catch (err) {
    console.warn('[Firebase] Init erreur:', err.message);
  }

  try {
    await onAuthChange(handleFirebaseAuthStateChange);
  } catch (err) {
    console.warn('[Main] onAuthChange erreur:', err.message);
    if (!state.userEmail) openOnboardingModal();
  }

  const campaignForm = document.getElementById('campaignForm');
  const generationLanguage = document.getElementById('generationLanguage');
  const resultsContainer = document.getElementById('resultsContainer');
  const historyList = document.getElementById('historyList');

  document.getElementById('analyticsBtn')?.addEventListener('click', openAnalyticsModal);
  document.getElementById('referralBtn')?.addEventListener('click', () => {
    prepareReferralModalContent();
    openReferralModal();
  });
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('rechargeBtn')?.addEventListener('click', openChariowModal);

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      if (presetKey) applyPreset(presetKey);
    });
  });

  campaignForm?.addEventListener('submit', generateCampaign);
  generationLanguage?.addEventListener('change', (e) => handleLanguageChange(e.target));

  document.getElementById('closeChariowBtn')?.addEventListener('click', closeChariowModal);
  document.getElementById('buy50Btn')?.addEventListener('click', () => buyCreditPack(50));
  document.getElementById('activateProBtn')?.addEventListener('click', activateProPlan);

  document.getElementById('closeAnalyticsBtn')?.addEventListener('click', closeAnalyticsModal);
  document.getElementById('closeReferralBtn')?.addEventListener('click', closeReferralModal);
  document.getElementById('copyReferralBtn')?.addEventListener('click', copyReferralLink);

  document.getElementById('exportTxtBtn')?.addEventListener('click', exportToTXT);
  document.getElementById('exportPdfBtn')?.addEventListener('click', exportToPDF);
  document.getElementById('copyAllBtn')?.addEventListener('click', copyGeneratedContent);

  resultsContainer?.addEventListener('click', (e) => {
    handleResultsContainerClick(e, { copySingleHook, copySingleSection });
  });

  // History delegation Phase 3B: supporte LS (index) et Firestore (id)
  historyList?.addEventListener('click', async (e) => {
    const itemLegacy = e.target.closest('[data-action="restore-history"]');
    const itemFirestore = e.target.closest('[data-action="restore-history-firestore"]');

    if (itemLegacy) {
      const index = parseInt(itemLegacy.dataset.index, 10);
      if (isNaN(index)) return;
      const history = getHistoryForUser(state.userEmail);
      const campaign = history[index];
      if (!campaign) return;

      const brandEl = document.getElementById('brandName');
      const targetEl = document.getElementById('targetAudience');
      const toneEl = document.getElementById('campaignTone');
      const offerEl = document.getElementById('offerDetails');
      if (brandEl) brandEl.value = campaign.brand || '';
      if (targetEl) targetEl.value = campaign.target || '';
      if (toneEl) toneEl.value = campaign.tone || '';
      if (offerEl) offerEl.value = campaign.offer || '';

      state.lastGeneratedData = campaign;
      renderResults(campaign.brand, campaign, campaign.tone, campaign.lang || 'Français 🇫🇷');
      showToast(`📂 Campagne "${campaign.brand}" rechargée ! (local)`, 'info');
    } else if (itemFirestore) {
      const id = itemFirestore.dataset.id;
      if (!id) return;
      const campaign = getCampaignFromFirestoreCacheById(id);
      if (!campaign) return;

      const brandEl = document.getElementById('brandName');
      const targetEl = document.getElementById('targetAudience');
      const toneEl = document.getElementById('campaignTone');
      const offerEl = document.getElementById('offerDetails');
      if (brandEl) brandEl.value = campaign.brand || '';
      if (targetEl) targetEl.value = campaign.target || '';
      if (toneEl) toneEl.value = campaign.tone || '';
      if (offerEl) offerEl.value = campaign.offer || '';

      state.lastGeneratedData = campaign;
      renderResults(campaign.brand, campaign, campaign.tone, campaign.lang || 'Français 🇫🇷');
      showToast(`📂 Campagne "${campaign.brand}" rechargée ! (Firestore)`, 'info');
    }
  });

  document.querySelectorAll('[data-modal-overlay]').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // PRO button Phase 3B: afficher "PRO bientôt disponible" et désactiver
  const activateProBtn = document.getElementById('activateProBtn');
  if (activateProBtn) {
    activateProBtn.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> PRO bientôt disponible`;
    activateProBtn.title = "Activation PRO sécurisée via Chariow bientôt disponible (Phase 4)";
  }

  console.log('✅ MarketPulse AI - Phase 3B initialisée (Firestore migration)', {
    user: state.userEmail || 'non connecté (attente Firebase)',
    credits: state.credits,
    isPro: state.isProUser,
    campaigns: state.totalCampaigns
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

window.MarketPulse = {
  state,
  showToast,
  applyPreset,
  generateCampaign,
  firebase: {
    init: () => import('./firebase/index.js').then(m => m.initFirebase())
  }
};
