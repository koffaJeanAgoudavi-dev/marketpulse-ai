/**
 * MarketPulse AI - Analytics
 * Phase 1A: Logique analytics conservée (compteurs locaux)
 */
import { state, saveTotalWords, saveTotalCampaigns } from './state.js';

export function incrementAnalytics(generatedResult) {
  const generatedTextLength = (generatedResult.hooks.join(' ') + generatedResult.post + generatedResult.email).split(/\s+/).length;
  const newTotalWords = state.totalWords + generatedTextLength;
  const newTotalCampaigns = state.totalCampaigns + 1;
  saveTotalWords(newTotalWords);
  saveTotalCampaigns(newTotalCampaigns);
}

export function getAnalyticsStats() {
  return {
    totalWords: state.totalWords,
    totalCampaigns: state.totalCampaigns,
    hoursSaved: (state.totalCampaigns * 0.5).toFixed(1) + 'h',
    credits: state.isProUser ? '∞ (PRO)' : state.credits
  };
}
