/**
 * MarketPulse AI - Functions Config
 * Phase 4A - Configuration Admin SDK
 *
 * IMPORTANT:
 * - Admin SDK uniquement côté serveur
 * - Aucune credential commitée
 * - Utilise Application Default Credentials
 */

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

let app;
let db;
let authInstance;

/**
 * Initialise Firebase Admin si pas déjà fait
 * @returns {{app, db, auth}}
 */
function initAdmin() {
  if (getApps().length === 0) {
    app = initializeApp();
  } else {
    app = getApps()[0];
  }

  if (!db) {
    db = getFirestore();
  }

  if (!authInstance) {
    authInstance = getAuth();
  }

  return { app, db, auth: authInstance };
}

module.exports = { initAdmin };
