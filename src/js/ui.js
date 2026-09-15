/**
 * MarketPulse AI - UI & Thème & Modales
 * Phase 3B: Analytics depuis Firestore stats, thème reste localStorage
 */
import { STORAGE_KEYS } from './config.js';
import { state } from './state.js';

export function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark');
    updateThemeIcon(true);
  } else {
    document.documentElement.classList.remove('dark');
    updateThemeIcon(false);
  }
}

export function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(STORAGE_KEYS.THEME, isDark ? 'dark' : 'light');
  updateThemeIcon(isDark);
  showToast(isDark ? '🌙 Mode Sombre activé' : '☀️ Mode Clair activé', 'info');
  // Phase 3B: thème reste localStorage (décision), pas de cloud prefs nécessaire
  // Future: saveCloudPreferences(uid, {theme}) si besoin
}

export function updateThemeIcon(isDark) {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  icon.className = isDark ? 'fa-solid fa-sun text-amber-400' : 'fa-solid fa-moon text-slate-700 dark:text-slate-200';
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `px-4 py-3 rounded-xl text-xs font-bold text-white shadow-xl flex items-center gap-2 pointer-events-auto transition-all transform translate-y-2 opacity-0 ${
    type === 'success' ? 'bg-emerald-600' :
    type === 'error' ? 'bg-rose-600' : 'bg-slate-900 dark:bg-slate-800'
  }`;
  
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'} text-sm"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

export function updateProUI() {
  const badge = document.getElementById('planBadge');
  if (!badge) return;
  if (state.isProUser) {
    badge.textContent = "PRO ✨";
    badge.className = "text-[10px] bg-amber-400 text-slate-950 font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm";
  } else {
    badge.textContent = "Gratuit";
    badge.className = "text-[10px] bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider";
  }
}

export function updateUserUI(email) {
  const badge = document.getElementById('userProfileBadge');
  const emailSpan = document.getElementById('displayUserEmail');
  if (badge && emailSpan && email) {
    emailSpan.textContent = email;
    badge.classList.remove('hidden');
    badge.classList.add('flex');
  }
  updateCreditsUI();
  updateProUI();
}

export function updateCreditsUI() {
  const userCreditsEl = document.getElementById('userCredits');
  if (!userCreditsEl) return;
  userCreditsEl.textContent = state.isProUser ? '∞' : state.credits;
}

export function hideUserBadge() {
  const badge = document.getElementById('userProfileBadge');
  if (badge) {
    badge.classList.add('hidden');
    badge.classList.remove('flex');
  }
}

// Modales génériques
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

export function openOnboardingModal() {
  openModal('onboardingModal');
}

export function closeOnboardingModal() {
  closeModal('onboardingModal');
}

export function openChariowModal() {
  openModal('chariowModal');
}

export function closeChariowModal() {
  closeModal('chariowModal');
}

export async function openAnalyticsModal() {
  const modal = document.getElementById('analyticsModal');
  if (!modal) return;

  // Phase 3B: tente lecture stats depuis Firestore users/{uid}.stats, fallback state LS
  let totalWords = state.totalWords;
  let totalCampaigns = state.totalCampaigns;
  let creditsDisplay = state.isProUser ? '∞ (PRO)' : state.credits;

  try {
    const { getCurrentFirebaseUser, getUserProfile } = await import('./firebase/index.js');
    const firebaseUser = await getCurrentFirebaseUser();
    if (firebaseUser) {
      const { data: profile } = await getUserProfile(firebaseUser.uid);
      if (profile && profile.stats) {
        totalWords = profile.stats.totalWords ?? totalWords;
        totalCampaigns = profile.stats.totalCampaigns ?? totalCampaigns;
      }
      if (profile && typeof profile.credits === 'number') {
        creditsDisplay = profile.isPro ? '∞ (PRO)' : profile.credits;
      }
    }
  } catch (err) {
    console.warn('[UI] Analytics Firestore fallback LS:', err.message);
  }

  const statWords = document.getElementById('statWords');
  const statCampaigns = document.getElementById('statCampaigns');
  const statHours = document.getElementById('statHours');
  const statCredits = document.getElementById('statCredits');
  if (statWords) statWords.textContent = totalWords;
  if (statCampaigns) statCampaigns.textContent = totalCampaigns;
  if (statHours) statHours.textContent = (totalCampaigns * 0.5).toFixed(1) + 'h'; // Temps économisé calculé affichage
  if (statCredits) statCredits.textContent = creditsDisplay;
  modal.classList.remove('hidden');
}

export function closeAnalyticsModal() {
  closeModal('analyticsModal');
}

export function openReferralModal() {
  const modal = document.getElementById('referralModal');
  if (!modal) return;
  modal.classList.remove('hidden');
}

export function closeReferralModal() {
  closeModal('referralModal');
}
