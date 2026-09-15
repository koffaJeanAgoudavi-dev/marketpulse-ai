/**
 * MarketPulse AI - Parrainage & Langue PRO
 * Phase 3B: Préparation structure referrals Firestore sans bonus sensible côté client
 * - referralCodes/{code} avec ownerUid, usesCount
 * - referrals/{referredUid} avec referrerUid, code, status pending
 * - Pas de distribution bonus côté client (backend Phase 4)
 */
import { state, setDetectedRefCode } from './state.js';
import { generateReferralCode, buildReferralLink, copyTextToClipboard } from './utils.js';
import { showToast, openChariowModal } from './ui.js';
import { getCurrentFirebaseUser, getUserProfile, createReferralCodeInFirestore, getReferralCodeFromFirestore } from './firebase/index.js';

export function checkReferralURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref') || "";
  
  if (refCode) {
    setDetectedRefCode(refCode);
    const refCodeInput = document.getElementById('referralCodeInput');
    const refBanner = document.getElementById('referralBanner');
    const badgeText = document.getElementById('signupCreditsBadge');
    
    if (refCodeInput) refCodeInput.value = refCode;
    if (refBanner) refBanner.classList.remove('hidden');
    if (badgeText) badgeText.textContent = "20 Crédits (15 + 5 Bonus Parrainage) - Validation Firestore Phase 4";
  }
}

export async function prepareReferralModalContent() {
  const input = document.getElementById('referralLinkInput');
  if (!input) return;

  try {
    const firebaseUser = await getCurrentFirebaseUser();
    if (firebaseUser) {
      const uid = firebaseUser.uid;
      const { data: profile } = await getUserProfile(uid);
      let code = null;

      if (profile && profile.referralCode) {
        code = profile.referralCode;
      } else {
        code = generateReferralCode(state.userEmail);
      }

      // Prépare structure referralCodes/{code} sans bonus sensible (Phase 3B)
      // Vérifie si code existe déjà, sinon crée
      const { data: existingCode } = await getReferralCodeFromFirestore(code);
      if (!existingCode) {
        await createReferralCodeInFirestore(uid, code);
        console.log('[Referrals] Code Firestore créé:', code);
      }

      const refLink = buildReferralLink(code);
      input.value = refLink;
      return;
    }
  } catch (err) {
    console.warn('[Referrals] Firestore referral code error, fallback LS:', err.message);
  }

  // Fallback localStorage
  const userRefCode = generateReferralCode(state.userEmail);
  const refLink = buildReferralLink(userRefCode);
  input.value = refLink;
}

export function copyReferralLink() {
  const linkInput = document.getElementById('referralLinkInput');
  if (linkInput) {
    copyTextToClipboard(linkInput.value);
    showToast("🎁 Lien de parrainage copié ! Bonus sécurisé bientôt disponible.", "success");
  }
}

export function handleLanguageChange(selectEl) {
  if (selectEl.value !== 'Français 🇫🇷' && !state.isProUser) {
    showToast("🔒 Les langues internationales sont réservées au Plan PRO ! PRO bientôt disponible via Chariow.", "error");
    openChariowModal();
    selectEl.value = 'Français 🇫🇷';
  }
}
