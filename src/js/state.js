/**
 * MarketPulse AI - État Global
 * Phase 1A: Gestion centralisée de l'état + localStorage (comportement conservé)
 */
import { STORAGE_KEYS, DEFAULT_CREDITS } from './config.js';

export const state = {
  userEmail: '',
  isProUser: false,
  credits: DEFAULT_CREDITS,
  totalWords: 0,
  totalCampaigns: 0,
  detectedRefCode: '',
  lastGeneratedData: null
};

export function checkIfProUser(email) {
  if (!email) return false;
  return localStorage.getItem(`${STORAGE_KEYS.PRO_PREFIX}${email.toLowerCase().trim()}`) === 'true';
}

export function getUserCredits(email) {
  if (!email) return DEFAULT_CREDITS;
  const key = `${STORAGE_KEYS.CREDITS_PREFIX}${email.toLowerCase().trim()}`;
  const stored = localStorage.getItem(key);
  return stored !== null ? parseInt(stored, 10) : DEFAULT_CREDITS;
}

export function saveUserCredits(email, amount) {
  if (!email) return;
  const key = `${STORAGE_KEYS.CREDITS_PREFIX}${email.toLowerCase().trim()}`;
  localStorage.setItem(key, amount.toString());
  state.credits = amount;
}

export function setProUser(email, isPro) {
  if (!email) return;
  const key = `${STORAGE_KEYS.PRO_PREFIX}${email.toLowerCase().trim()}`;
  localStorage.setItem(key, isPro ? 'true' : 'false');
  state.isProUser = isPro;
}

export function setUserEmail(email) {
  state.userEmail = email;
  if (email) {
    localStorage.setItem(STORAGE_KEYS.USER_EMAIL, email);
    state.isProUser = checkIfProUser(email);
    state.credits = getUserCredits(email);
  }
}

export function clearUserEmail() {
  localStorage.removeItem(STORAGE_KEYS.USER_EMAIL);
  state.userEmail = '';
}

export function loadStateFromStorage() {
  const storedEmail = localStorage.getItem(STORAGE_KEYS.USER_EMAIL) || '';
  state.userEmail = storedEmail;
  state.isProUser = checkIfProUser(storedEmail);
  state.credits = getUserCredits(storedEmail);
  state.totalWords = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_WORDS) || '0', 10);
  state.totalCampaigns = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_CAMPAIGNS) || '0', 10);
  state.detectedRefCode = '';
  state.lastGeneratedData = null;
}

export function saveTotalWords(count) {
  state.totalWords = count;
  localStorage.setItem(STORAGE_KEYS.TOTAL_WORDS, count.toString());
}

export function saveTotalCampaigns(count) {
  state.totalCampaigns = count;
  localStorage.setItem(STORAGE_KEYS.TOTAL_CAMPAIGNS, count.toString());
}

export function setDetectedRefCode(code) {
  state.detectedRefCode = code;
}

export function setLastGeneratedData(data) {
  state.lastGeneratedData = data;
}
