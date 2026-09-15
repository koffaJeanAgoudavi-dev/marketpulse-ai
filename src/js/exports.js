/**
 * MarketPulse AI - Exports & Copies
 * Phase 1A: Logique exports conservée, sécurisée via modules
 */
import { state } from './state.js';
import { copyTextToClipboard } from './utils.js';
import { showToast, openChariowModal } from './ui.js';

export function exportToTXT() {
  if (!state.lastGeneratedData) {
    showToast("Aucune campagne générée à exporter.", "error");
    return;
  }

  const data = state.lastGeneratedData;
  const txtContent = `================================================
MARKETPULSE AI - RAPPORT DE CAMPAGNE
================================================
Marque : ${data.brand}
Cible  : ${data.target}
Ton    : ${data.tone}
Langue : ${data.lang || 'Français'}
Date   : ${new Date().toLocaleString('fr-FR')}
================================================

--- 1. ACCROCHES VIRALES (HOOKS) ---
${data.hooks.map((h, i) => `[Accroche ${i+1}] ${h}`).join('\n')}

--- 2. POST POUR RÉSEAUX SOCIAUX ---
${data.post}

--- 3. E-MAIL DE PROSPECTION ---
${data.email}

================================================
Généré automatiquement par MarketPulse AI
================================================`;

  const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `campagne_${data.brand.toLowerCase().replace(/\s+/g, '_')}.txt`;
  link.click();
  showToast("📄 Fichier TXT téléchargé !", "success");
}

export function exportToPDF() {
  if (!state.isProUser) {
    showToast("🔒 L'export PDF est réservé aux membres PRO !", "error");
    openChariowModal();
    return;
  }

  const element = document.getElementById('exportableCampaignContent');
  if (!element || !state.lastGeneratedData) {
    showToast("Aucune campagne générée à exporter.", "error");
    return;
  }

  const opt = {
    margin: 10,
    filename: `campagne_${state.lastGeneratedData.brand.toLowerCase().replace(/\s+/g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  showToast("⏳ Génération du PDF en cours...", "info");
  // html2pdf est global via CDN
  window.html2pdf().set(opt).from(element).save().then(() => {
    showToast("📄 Fichier PDF téléchargé !", "success");
  }).catch(err => {
    console.error("PDF Export Error:", err);
    showToast("Erreur lors de la création du PDF.", "error");
  });
}

export function copyGeneratedContent() {
  if (!state.lastGeneratedData) {
    showToast("Aucune campagne à copier.", "error");
    return;
  }
  const fullText = `=== ACCROCHES ===\n${state.lastGeneratedData.hooks.join('\n')}\n\n=== POST RÉSEAUX SOCIAUX ===\n${state.lastGeneratedData.post}\n\n=== COLD EMAIL ===\n${state.lastGeneratedData.email}`;
  copyTextToClipboard(fullText);
  showToast("Toute la campagne a été copiée !", "success");
}

export function copySingleHook(text) {
  copyTextToClipboard(text);
  showToast("Accroche copiée !", "success");
}

export function copySingleSection(type) {
  if (!state.lastGeneratedData) return;
  if (type === 'post') {
    copyTextToClipboard(state.lastGeneratedData.post);
    showToast("Post réseau social copié !", "success");
  } else if (type === 'email') {
    copyTextToClipboard(state.lastGeneratedData.email);
    showToast("E-mail de prospection copié !", "success");
  }
}
