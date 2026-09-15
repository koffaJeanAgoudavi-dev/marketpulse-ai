/**
 * MarketPulse AI - Auth UI & Onboarding Firebase
 * Phase 2B: Migration onboarding vers Firebase Auth
 * 
 * - Gère UI inscription/connexion/vérification
 * - Utilise façade Firebase via src/js/firebase/index.js
 * - Conserve compatibilité localStorage pour crédits/history/PRO
 * - Ne stocke jamais mot de passe
 * - Ne log jamais credentials
 */

import { state, getUserCredits, saveUserCredits, setProUser, setUserEmail, clearUserEmail } from './state.js';
import { showToast, updateProUI, updateUserUI, updateCreditsUI, hideUserBadge, openOnboardingModal, closeOnboardingModal } from './ui.js';
import { loadUserHistory, clearUserHistoryUI } from './history.js';
import { GOOGLE_SHEETS_URL, DEFAULT_CREDITS } from './config.js';
import {
  registerUser,
  loginUser,
  logoutFirebaseUser,
  getCurrentFirebaseUser,
  onAuthChange,
  sendVerificationEmail,
  refreshCurrentUser,
  isEmailVerified,
  toUserMessage
} from './firebase/index.js';

let currentAuthMode = 'register'; // 'register' | 'login'
let currentFirebaseUser = null;
let isVerificationMode = false;

/**
 * Validation email basique
 */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Validation mot de passe Firebase: min 6 chars
 */
function validatePassword(password) {
  return password && password.length >= 6;
}

function showError(message) {
  const container = document.getElementById('authErrorContainer');
  const msgEl = document.getElementById('authErrorMessage');
  if (container && msgEl) {
    msgEl.textContent = message;
    container.classList.remove('hidden');
  }
}

function clearError() {
  const container = document.getElementById('authErrorContainer');
  if (container) {
    container.classList.add('hidden');
  }
}

function setLoading(isLoading, mode = currentAuthMode) {
  const btn = document.getElementById('authSubmitBtn');
  const textEl = document.getElementById('authSubmitText');
  if (!btn || !textEl) return;

  if (isLoading) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> <span>${mode === 'register' ? 'Création...' : 'Connexion...'}</span>`;
  } else {
    btn.disabled = false;
    if (mode === 'register') {
      btn.innerHTML = `<i class="fa-solid fa-user-plus"></i> <span id="authSubmitText">Créer mon compte</span>`;
    } else {
      btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> <span id="authSubmitText">Se connecter</span>`;
    }
  }
}

export function setAuthMode(mode) {
  currentAuthMode = mode;
  const registerBtn = document.getElementById('authModeRegisterBtn');
  const loginBtn = document.getElementById('authModeLoginBtn');
  const confirmGroup = document.getElementById('confirmPasswordGroup');
  const title = document.getElementById('authModalTitle');
  const subtitle = document.getElementById('authModalSubtitle');
  const submitText = document.getElementById('authSubmitText');
  const toggleLink = document.getElementById('authToggleLink');
  const submitBtn = document.getElementById('authSubmitBtn');

  if (mode === 'register') {
    if (registerBtn) {
      registerBtn.className = "flex-1 py-2 text-xs font-extrabold rounded-lg bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white transition-all";
    }
    if (loginBtn) {
      loginBtn.className = "flex-1 py-2 text-xs font-bold rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 transition-all";
    }
    if (confirmGroup) confirmGroup.classList.remove('hidden');
    if (title) title.textContent = "Créer votre compte";
    if (subtitle) subtitle.textContent = "Rejoignez MarketPulse AI et activez vos crédits gratuits.";
    if (submitText) submitText.textContent = "Créer mon compte";
    if (toggleLink) toggleLink.textContent = "Déjà un compte ? Se connecter";
    if (submitBtn) {
      submitBtn.className = "w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2";
    }
    const confirmInput = document.getElementById('onboardingConfirmPassword');
    if (confirmInput) confirmInput.required = true;
  } else {
    if (loginBtn) {
      loginBtn.className = "flex-1 py-2 text-xs font-extrabold rounded-lg bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white transition-all";
    }
    if (registerBtn) {
      registerBtn.className = "flex-1 py-2 text-xs font-bold rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 transition-all";
    }
    if (confirmGroup) confirmGroup.classList.add('hidden');
    if (title) title.textContent = "Bon retour !";
    if (subtitle) subtitle.textContent = "Connectez-vous à votre compte MarketPulse AI.";
    if (submitText) submitText.textContent = "Se connecter";
    if (toggleLink) toggleLink.textContent = "Pas encore de compte ? Créer un compte";
    if (submitBtn) {
      submitBtn.className = "w-full py-3 bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2";
    }
    const confirmInput = document.getElementById('onboardingConfirmPassword');
    if (confirmInput) confirmInput.required = false;
  }
  clearError();
}

export function showVerificationUI(user) {
  isVerificationMode = true;
  const form = document.getElementById('onboardingForm');
  const verificationSection = document.getElementById('verificationSection');
  const emailDisplay = document.getElementById('verificationEmailDisplay');
  const toggleDiv = document.querySelector('#onboardingModal .flex.bg-slate-100');
  const toggleLink = document.getElementById('authToggleLink');

  if (form) form.classList.add('hidden');
  if (toggleDiv) toggleDiv.classList.add('hidden');
  if (toggleLink) toggleLink.classList.add('hidden');
  if (verificationSection) verificationSection.classList.remove('hidden');
  if (emailDisplay && user) emailDisplay.textContent = user.email;

  const title = document.getElementById('authModalTitle');
  const subtitle = document.getElementById('authModalSubtitle');
  if (title) title.textContent = "Vérification requise";
  if (subtitle) subtitle.textContent = "Votre compte a été créé, vérifiez votre e-mail pour continuer.";

  openOnboardingModal();
}

export function hideVerificationUI() {
  isVerificationMode = false;
  const form = document.getElementById('onboardingForm');
  const verificationSection = document.getElementById('verificationSection');
  const toggleDiv = document.querySelector('#onboardingModal .flex.bg-slate-100');
  const toggleLink = document.getElementById('authToggleLink');

  if (form) form.classList.remove('hidden');
  if (toggleDiv) toggleDiv.classList.remove('hidden');
  if (toggleLink) toggleLink.classList.remove('hidden');
  if (verificationSection) verificationSection.classList.add('hidden');
}

async function handleLegacyLocalStorageMigration(firebaseEmail) {
  // Détecte ancien compte localStorage sans Firebase
  const legacyEmail = localStorage.getItem('marketpulse_user_email');
  const hint = document.getElementById('legacyAccountHint');
  if (legacyEmail && legacyEmail.toLowerCase() !== firebaseEmail.toLowerCase()) {
    if (hint) hint.classList.remove('hidden');
  } else if (hint) {
    hint.classList.add('hidden');
  }

  // Compatibilité: si crédits existent pour cet email, les conserver
  // Ne pas écraser, juste charger
  const existingCredits = localStorage.getItem(`marketpulse_credits_${firebaseEmail.toLowerCase()}`);
  if (existingCredits === null) {
    // Vérifie si ancien email avait crédits et propose migration manuelle (pas auto)
    // Pour Phase 2B, on ne migre pas automatiquement, on laisse l'utilisateur recréer
    // Mais on initialise crédits par défaut si pas existant et si referral présent
    const refCode = document.getElementById('referralCodeInput')?.value.trim();
    const creditsToSet = refCode ? 20 : DEFAULT_CREDITS;
    saveUserCredits(firebaseEmail, creditsToSet);
    state.credits = creditsToSet;
  } else {
    state.credits = parseInt(existingCredits, 10);
  }
}

async function handleSuccessfulAuth(firebaseUser, isNewUser = false) {
  if (!firebaseUser) return;

  currentFirebaseUser = firebaseUser;
  const email = firebaseUser.email;
  const uid = firebaseUser.uid;

  // Sécurité: ne jamais stocker password, seulement email pour compatibilité localStorage
  setUserEmail(email);

  // Compatibilité localStorage: crédits, history, PRO restent basés sur email pour l'instant (Phase 3 migrera vers UID)
  await handleLegacyLocalStorageMigration(email);

  // Google Sheets sync conservé (comportement original) mais avec UID
  const refCode = document.getElementById('referralCodeInput')?.value.trim() || 'Aucun';
  if (GOOGLE_SHEETS_URL) {
    fetch(GOOGLE_SHEETS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: new Date().toLocaleString('fr-FR'),
        email: email,
        uid: uid,
        referralCode: refCode,
        credits: state.credits,
        emailVerified: firebaseUser.emailVerified,
        source: 'SaaS MarketPulse AI - Firebase Auth'
      })
    }).catch(err => console.log('Google Sheets Sync:', err));
  }

  // Vérification email
  if (!firebaseUser.emailVerified) {
    showVerificationUI(firebaseUser);
    showToast(`📧 Compte créé ! Vérifiez votre e-mail (${email}) pour activer votre compte.`, 'info');
    return;
  }

  // Email vérifié -> connexion complète
  hideVerificationUI();
  closeOnboardingModal();
  updateUserUI(email);
  updateCreditsUI();
  loadUserHistory(email);

  if (isNewUser) {
    showToast(`🎉 Bienvenue ${email} ! Compte créé et vérifié. ${state.credits} crédits offerts.`, 'success');
  } else {
    showToast(`Re-bienvenue ${email} !`, 'success');
  }

  console.log('[Auth UI] Connexion réussie:', { uid, email, verified: firebaseUser.emailVerified });
}

export async function handleOnboardingSubmit(e) {
  e.preventDefault();
  clearError();

  const emailInput = document.getElementById('onboardingEmail')?.value.trim();
  const passwordInput = document.getElementById('onboardingPassword')?.value;
  const confirmPasswordInput = document.getElementById('onboardingConfirmPassword')?.value;
  const referralCode = document.getElementById('referralCodeInput')?.value.trim();

  // Validations UI
  if (!emailInput || !validateEmail(emailInput)) {
    showError("Veuillez entrer une adresse e-mail valide.");
    return;
  }
  if (!passwordInput || !validatePassword(passwordInput)) {
    showError("Mot de passe trop faible. Minimum 6 caractères requis.");
    return;
  }
  if (currentAuthMode === 'register') {
    if (passwordInput !== confirmPasswordInput) {
      showError("Les mots de passe ne correspondent pas.");
      return;
    }
  }

  // Ne jamais logger password
  console.log(`[Auth UI] Tentative ${currentAuthMode} pour:`, emailInput);

  setLoading(true, currentAuthMode);

  try {
    if (currentAuthMode === 'register') {
      // Inscription
      const { user, error } = await registerUser(emailInput, passwordInput);
      if (error) {
        showError(toUserMessage(error));
        showToast(toUserMessage(error), 'error');
        setLoading(false, currentAuthMode);
        return;
      }

      if (user) {
        // Envoyer email vérification automatiquement
        const { error: verifyError } = await sendVerificationEmail();
        if (verifyError) {
          console.warn('Erreur envoi vérification:', verifyError);
          showToast("Compte créé mais échec envoi e-mail vérification. Vous pourrez le renvoyer.", 'info');
        }

        // Gestion crédits bonus parrainage conservée
        if (referralCode) {
          saveUserCredits(emailInput, 20);
          state.credits = 20;
        } else {
          const existing = localStorage.getItem(`marketpulse_credits_${emailInput.toLowerCase()}`);
          if (existing === null) {
            saveUserCredits(emailInput, DEFAULT_CREDITS);
            state.credits = DEFAULT_CREDITS;
          }
        }

        await handleSuccessfulAuth(user, true);
      }
    } else {
      // Connexion avec requireVerifiedEmail = true
      const { user, error } = await loginUser(emailInput, passwordInput);
      if (error) {
        showError(toUserMessage(error));
        showToast(toUserMessage(error), 'error');
        setLoading(false, currentAuthMode);
        return;
      }

      if (user) {
        if (!user.emailVerified) {
          // Ne pas considérer comme pleinement connecté
          currentFirebaseUser = user;
          setUserEmail(emailInput); // Pour compatibilité mais pas full UI
          showVerificationUI(user);
          showError("Votre adresse e-mail n'est pas vérifiée. Veuillez vérifier votre e-mail et cliquer sur 'J'ai vérifié'.");
          showToast("🔒 E-mail non vérifié. Vérifiez votre boîte de réception.", 'error');
          setLoading(false, currentAuthMode);
          return;
        }

        // Vérifié -> connexion complète
        await handleSuccessfulAuth(user, false);
      }
    }
  } catch (err) {
    console.error('[Auth UI] Erreur inattendue:', err);
    showError("Une erreur inattendue est survenue. Veuillez réessayer.");
    showToast("Erreur inattendue", 'error');
  } finally {
    setLoading(false, currentAuthMode);
  }
}

export async function handleResendVerification() {
  const btn = document.getElementById('resendVerificationBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Envoi...`;
  }

  try {
    const { error } = await sendVerificationEmail();
    if (error) {
      showToast(toUserMessage(error), 'error');
      showError(toUserMessage(error));
    } else {
      showToast("📧 E-mail de vérification renvoyé ! Vérifiez votre boîte de réception.", 'success');
      clearError();
    }
  } catch (err) {
    showToast("Erreur lors du renvoi", 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Renvoyer l'e-mail`;
    }
  }
}

export async function handleRefreshVerification() {
  const btn = document.getElementById('refreshVerificationBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Vérification...`;
  }

  try {
    const refreshedUser = await refreshCurrentUser();
    if (refreshedUser && refreshedUser.emailVerified) {
      showToast("✅ E-mail vérifié ! Bienvenue !", 'success');
      await handleSuccessfulAuth(refreshedUser, false);
    } else {
      showToast("❌ E-mail toujours non vérifié. Cliquez sur le lien dans votre e-mail.", 'error');
      showError("E-mail toujours non vérifié. Vérifiez votre boîte de réception et cliquez sur le lien.");
    }
  } catch (err) {
    showToast("Erreur lors du rafraîchissement", 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> J'ai vérifié, rafraîchir`;
    }
  }
}

export async function handleLogout() {
  try {
    const { error } = await logoutFirebaseUser();
    if (error) {
      showToast(toUserMessage(error), 'error');
      return;
    }

    // Firebase déconnecté, UI retour visiteur
    currentFirebaseUser = null;
    clearUserEmail();
    hideUserBadge();
    clearUserHistoryUI();
    hideVerificationUI();
    showToast("Vous avez été déconnecté.", 'info');
    openOnboardingModal();
    setAuthMode('login'); // Après déconnexion, proposer login

    console.log('[Auth UI] Déconnexion réussie');
  } catch (err) {
    console.error('Logout error:', err);
    showToast("Erreur lors de la déconnexion", 'error');
  }
}

export function initAuthUI() {
  // Boutons mode
  document.getElementById('authModeRegisterBtn')?.addEventListener('click', () => setAuthMode('register'));
  document.getElementById('authModeLoginBtn')?.addEventListener('click', () => setAuthMode('login'));
  document.getElementById('authToggleLink')?.addEventListener('click', () => {
    setAuthMode(currentAuthMode === 'register' ? 'login' : 'register');
  });

  // Form
  document.getElementById('onboardingForm')?.addEventListener('submit', handleOnboardingSubmit);

  // Verification buttons
  document.getElementById('resendVerificationBtn')?.addEventListener('click', handleResendVerification);
  document.getElementById('refreshVerificationBtn')?.addEventListener('click', handleRefreshVerification);
  document.getElementById('verificationLogoutBtn')?.addEventListener('click', handleLogout);

  // Init mode par défaut: register (nouvel utilisateur)
  setAuthMode('register');

  console.log('[Auth UI] Initialisé en mode:', currentAuthMode);
}

export function getCurrentAuthMode() {
  return currentAuthMode;
}

export function getCurrentFirebaseUserCached() {
  return currentFirebaseUser;
}

export function isInVerificationMode() {
  return isVerificationMode;
}
