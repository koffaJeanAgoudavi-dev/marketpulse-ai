/**
 * MarketPulse AI - Firestore Module
 * Phase 3B: Implémentation Firestore derrière façade
 * 
 * - Client peut lire solde pour affichage, mais PAS modifier credits directement (rules deny)
 * - PRO: pas d'accord côté client, bouton "bientôt disponible"
 * - Migration legacy one-shot max 100 crédits, migratedFromLocal flag
 * - Campaigns: users/{uid}/campaigns/{campaignId}
 * - Referrals: préparation sans bonus sensible côté client
 * - Pas de Cloud Functions, Gemini, Chariow, paiement
 */

import { getFirebaseApp, isFirebaseAvailable } from './app.js';
import { isFirebaseConfigValid } from './config.js';
import { DEFAULT_CREDITS, BONUS_REFERRAL, STORAGE_KEYS } from '../config.js';

let firestoreDb = null;

/**
 * Récupère Firestore instance (lazy)
 */
async function getFirestoreInstance() {
  if (firestoreDb) return firestoreDb;

  const app = getFirebaseApp();
  if (!app) {
    const { initFirebaseApp } = await import('./app.js');
    const initializedApp = await initFirebaseApp();
    if (!initializedApp) return null;
  }

  const finalApp = getFirebaseApp();
  if (!finalApp) return null;

  try {
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    firestoreDb = getFirestore(finalApp);
    return firestoreDb;
  } catch (err) {
    console.warn('[Firestore] Impossible charger Firestore SDK:', err.message);
    return null;
  }
}

/**
 * Vérifie si Firestore disponible
 */
export async function isFirestoreAvailable() {
  const db = await getFirestoreInstance();
  return !!db;
}

// ==================== USERS ====================

/**
 * Lit profil users/{uid}
 * @param {string} uid
 * @returns {Promise<{data, error}>}
 */
export async function getUserProfile(uid) {
  const db = await getFirestoreInstance();
  if (!db) return { data: null, error: { code: 'firestore/not-configured' } };

  try {
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const ref = doc(db, `users/${uid}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return { data: { id: snap.id, ...snap.data() }, error: null };
    } else {
      return { data: null, error: null };
    }
  } catch (err) {
    console.warn('[Firestore] getUserProfile error:', err.message);
    return { data: null, error: err };
  }
}

/**
 * Crée profil users/{uid} lors connexion vérifiée
 * Phase 3B: credits max 100, plan free only, proSource legacy si PRO legacy migré
 * @param {string} uid
 * @param {Object} data
 * @returns {Promise<{data, error}>}
 */
export async function createUserProfile(uid, data) {
  const db = await getFirestoreInstance();
  if (!db) return { data: null, error: { code: 'firestore/not-configured' } };

  try {
    const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    // Validation Phase 3B: credits max 100
    const credits = Math.min(data.credits ?? DEFAULT_CREDITS, 100);
    if (credits < 0) throw new Error('Credits invalide');

    // Plan forced free in Phase 3B (no pro from client)
    // Exception: if legacy PRO, allow isPro true with proSource legacy but plan still free? Decision: PRO legacy marqué proSource legacy, pas paiement Chariow
    // Pour respecter security rules, on force plan free, mais on permet isPro true si proSource legacy
    const isPro = data.isPro === true;
    const proSource = isPro ? 'legacy' : 'free';
    const plan = 'free'; // Toujours free en Phase 3B, pas d'accord PRO client

    const profile = {
      uid: uid,
      email: data.email,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      emailVerified: data.emailVerified ?? false,
      credits: credits,
      plan: plan,
      isPro: isPro,
      proActivatedAt: data.proActivatedAt || null,
      proExpiresAt: null, // Pas d'expiration en Phase 3B
      proSource: proSource,
      referralCode: data.referralCode || generateLocalReferralCode(data.email),
      referredBy: data.referredBy || null,
      referredByCode: data.referredByCode || null,
      referralCount: 0,
      stats: {
        totalCampaigns: data.stats?.totalCampaigns ?? 0,
        totalWords: data.stats?.totalWords ?? 0
      },
      theme: data.theme || 'light',
      migratedFromLocal: data.migratedFromLocal ?? false,
      legacyEmails: data.legacyEmails || [],
      schemaVersion: 1,
      source: data.source || 'firebase-auth'
    };

    const ref = doc(db, `users/${uid}`);
    await setDoc(ref, profile, { merge: false });
    console.log('[Firestore] Profil créé:', uid, 'credits:', credits, 'isPro:', isPro, 'source:', proSource);

    return { data: profile, error: null };
  } catch (err) {
    console.warn('[Firestore] createUserProfile error:', err.message);
    return { data: null, error: err };
  }
}

/**
 * Génère code referral local temporaire (sera remplacé par nanoid côté Functions Phase 4)
 * Phase 3B: utilise btoa pour compatibilité mais documenté comme à remplacer
 */
function generateLocalReferralCode(email) {
  if (!email) return 'FREE' + Math.random().toString(36).substring(2, 6).toUpperCase();
  try {
    return btoa(email).substring(0, 8).toUpperCase();
  } catch {
    return 'FREE' + Math.random().toString(36).substring(2, 6).toUpperCase();
  }
}

/**
 * Assure profil existe, le crée si manquant (lors connexion vérifiée)
 * @param {string} uid
 * @param {string} email
 * @param {Object} extra - {emailVerified, referralCode, etc.}
 */
export async function ensureUserProfile(uid, email, extra = {}) {
  const { data: existing } = await getUserProfile(uid);
  if (existing) {
    // Met à jour lastLoginAt seulement (safe field)
    try {
      const db = await getFirestoreInstance();
      const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const ref = doc(db, `users/${uid}`);
      await updateDoc(ref, {
        lastLoginAt: serverTimestamp(),
        emailVerified: extra.emailVerified ?? existing.emailVerified,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.warn('[Firestore] ensureUserProfile update lastLoginAt error:', err.message);
    }
    return { data: existing, error: null, created: false };
  } else {
    // Création profil initial
    const result = await createUserProfile(uid, {
      email: email,
      emailVerified: extra.emailVerified ?? false,
      credits: extra.credits ?? DEFAULT_CREDITS,
      isPro: extra.isPro ?? false,
      referralCode: extra.referralCode,
      referredBy: extra.referredBy,
      referredByCode: extra.referredByCode,
      stats: extra.stats,
      theme: extra.theme,
      migratedFromLocal: extra.migratedFromLocal ?? false,
      source: 'ensureUserProfile'
    });
    return { ...result, created: true };
  }
}

// ==================== MIGRATION LEGACY ONE-SHOT ====================

/**
 * Migration legacy one-shot max 100 crédits
 * Ne remigre jamais si migratedFromLocal === true
 * @param {string} uid
 * @param {string} email
 * @returns {Promise<{migrated, data, error}>}
 */
export async function migrateLegacyData(uid, email) {
  const db = await getFirestoreInstance();
  if (!db) return { migrated: false, data: null, error: { code: 'firestore/not-configured' } };

  try {
    // Vérifie si déjà migré
    const { data: existingProfile } = await getUserProfile(uid);
    if (existingProfile && existingProfile.migratedFromLocal === true) {
      console.log('[Firestore] Migration déjà effectuée, skip:', uid);
      return { migrated: false, data: existingProfile, error: null, reason: 'already_migrated' };
    }

    // Lecture localStorage legacy
    const legacyEmail = email.toLowerCase().trim();
    const creditsKey = `${STORAGE_KEYS.CREDITS_PREFIX}${legacyEmail}`;
    const historyKey = `${STORAGE_KEYS.HISTORY_PREFIX}${legacyEmail}`;
    const proKey = `${STORAGE_KEYS.PRO_PREFIX}${legacyEmail}`;

    const storedCredits = localStorage.getItem(creditsKey);
    const storedHistory = localStorage.getItem(historyKey);
    const storedPro = localStorage.getItem(proKey);
    const storedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    const totalWords = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_WORDS) || '0', 10);
    const totalCampaigns = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_CAMPAIGNS) || '0', 10);

    let credits = DEFAULT_CREDITS;
    if (storedCredits !== null) {
      credits = parseInt(storedCredits, 10);
    }
    // Plafond 100 crédits max migration legacy (décision validée)
    const cappedCredits = Math.min(credits, 100);

    const isProLegacy = storedPro === 'true';
    const history = storedHistory ? JSON.parse(storedHistory) : [];

    console.log('[Firestore] Migration legacy détectée:', {
      email,
      credits,
      cappedCredits,
      isProLegacy,
      historyCount: history.length,
      totalWords,
      totalCampaigns
    });

    // Si profil existe déjà mais pas migré, on met à jour avec migration
    if (existingProfile) {
      // Ne pas écraser crédits si déjà > capped? On prend max pour éviter perte mais plafonné 100
      // Mais rules interdisent update credits côté client, donc on ne peut pas update credits ici en Phase 3B
      // Pour Phase 3B, on documente que migration crédits sera faite via Function Phase 4 si besoin
      // Pour l'instant, on crée un doc de migration log et on marque migratedFromLocal
      // On tente update seulement des champs safe + migratedFromLocal si rules permettent?
      // Rules bloquent credits, plan, etc. en update, donc on ne peut pas migrer crédits via update client
      // Solution Phase 3B: si profil existe, on ne migre crédits que si migratedFromLocal false et on tente set avec merge et seulement si credits <=100?
      // Mais rules bloquent credits en update, donc on doit passer par création seulement
      // Pour Phase 3B, on va créer un document de log migration et marquer migratedFromLocal via update safe? 
      // En réalité, rules bloquent migratedFromLocal en update aussi (sensible), donc migration complète nécessite backend
      // Pour Phase 3B, on implémente migration uniquement à la création du profil, pas après
      // Si profil existe déjà sans migration, on log et on skip crédits migration, mais on migre historique
      console.warn('[Firestore] Profil existe déjà, migration crédits bloquée par rules (backend only) - migration historique seulement');
    } else {
      // Création profil avec données legacy
      const result = await createUserProfile(uid, {
        email: email,
        emailVerified: true, // On ne migre que si vérifié
        credits: cappedCredits,
        isPro: isProLegacy,
        stats: {
          totalCampaigns: totalCampaigns,
          totalWords: totalWords
        },
        theme: storedTheme,
        migratedFromLocal: true,
        legacyEmails: [legacyEmail],
        source: 'legacy_migration'
      });

      if (result.error) {
        return { migrated: false, data: null, error: result.error };
      }

      // Migration historique
      const migratedCampaigns = await migrateLegacyHistory(uid, history);

      return {
        migrated: true,
        data: result.data,
        error: null,
        campaignsMigrated: migratedCampaigns.length,
        creditsMigrated: cappedCredits,
        isProMigrated: isProLegacy
      };
    }

    // Si profil existe, migration historique seulement
    const migratedCampaigns = await migrateLegacyHistory(uid, history);

    // Marquer migratedFromLocal true via update safe? Rules bloquent, donc on ne peut pas
    // On documente limitation Phase 3B: migratedFromLocal ne peut être set que à création, pas update client
    // Pour Phase 3B, on va tenter update avec seulement safe fields + migratedFromLocal si possible, sinon on log
    try {
      const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const ref = doc(db, `users/${uid}`);
      // Tentative update migratedFromLocal - va échouer avec rules actuelles (voulu), on catch
      await updateDoc(ref, {
        migratedFromLocal: true,
        updatedAt: serverTimestamp()
      });
      console.log('[Firestore] migratedFromLocal marqué true');
    } catch (err) {
      console.warn('[Firestore] Impossible marquer migratedFromLocal (rules deny, backend needed Phase 4):', err.message);
    }

    return {
      migrated: true,
      data: existingProfile,
      error: null,
      campaignsMigrated: migratedCampaigns.length,
      creditsMigrated: 0, // Bloqué par rules Phase 3B
      reason: 'history_only_due_to_rules'
    };

  } catch (err) {
    console.warn('[Firestore] migrateLegacyData error:', err.message);
    return { migrated: false, data: null, error: err };
  }
}

/**
 * Migration historique legacy vers Firestore
 * @param {string} uid
 * @param {Array} historyArray - depuis localStorage
 * @returns {Promise<Array>} campagnes migrées
 */
async function migrateLegacyHistory(uid, historyArray) {
  const db = await getFirestoreInstance();
  if (!db || !historyArray || historyArray.length === 0) return [];

  const migrated = [];
  try {
    const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    for (let i = 0; i < historyArray.length; i++) {
      const item = historyArray[i];
      // Génère ID unique pour campagne migrée
      const campaignId = `legacy_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 8)}`;
      const ref = doc(db, `users/${uid}/campaigns/${campaignId}`);

      // Calcule wordCount si manquant
      const wordCount = item.hooks ? (item.hooks.join(' ') + (item.post || '') + (item.email || '')).split(/\s+/).length : 0;

      const campaignDoc = {
        id: campaignId,
        userId: uid,
        createdAt: serverTimestamp(), // Pas de date originale dans LS, on utilise now
        // Pour préserver ordre, on pourrait utiliser now - i*1h mais serverTimestamp ne permet pas, on utilise now
        brand: item.brand || 'Marque inconnue',
        target: item.target || '',
        tone: item.tone || 'Professionnel & Premium',
        lang: item.lang || 'Français 🇫🇷',
        offer: item.offer || '',
        hooks: item.hooks || [],
        post: item.post || '',
        email: item.email || '',
        imageUrl: item.imageUrl || null,
        preset: item.preset || null,
        source: 'legacy', // Distingue template/gemini/legacy
        wordCount: wordCount,
        creditsUsed: 1,
        schemaVersion: 1,
        migratedFromLocal: true,
        legacyIndex: i
      };

      await setDoc(ref, campaignDoc);
      migrated.push(campaignDoc);
    }

    console.log(`[Firestore] ${migrated.length} campagnes legacy migrées vers Firestore`);
    return migrated;
  } catch (err) {
    console.warn('[Firestore] migrateLegacyHistory error:', err.message);
    return migrated;
  }
}

// ==================== CAMPAIGNS ====================

/**
 * Crée campagne dans users/{uid}/campaigns/{campaignId}
 * @param {string} uid
 * @param {Object} campaignData
 * @returns {Promise<{data, error}>}
 */
export async function createCampaignInFirestore(uid, campaignData) {
  const db = await getFirestoreInstance();
  if (!db) return { data: null, error: { code: 'firestore/not-configured' } };

  try {
    const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const campaignId = `cmp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ref = doc(db, `users/${uid}/campaigns/${campaignId}`);

    const wordCount = (campaignData.hooks?.join(' ') + (campaignData.post || '') + (campaignData.email || '')).split(/\s+/).length;

    const docData = {
      id: campaignId,
      userId: uid,
      createdAt: serverTimestamp(),
      brand: campaignData.brand,
      target: campaignData.target,
      tone: campaignData.tone,
      lang: campaignData.lang || 'Français 🇫🇷',
      offer: campaignData.offer,
      hooks: campaignData.hooks,
      post: campaignData.post,
      email: campaignData.email,
      imageUrl: campaignData.imageUrl || null,
      preset: campaignData.preset || null,
      source: campaignData.source || 'template', // template | gemini | legacy
      wordCount: wordCount,
      creditsUsed: 1,
      schemaVersion: 1
    };

    await setDoc(ref, docData);
    console.log('[Firestore] Campagne créée:', campaignId);

    return { data: docData, error: null };
  } catch (err) {
    console.warn('[Firestore] createCampaign error:', err.message);
    return { data: null, error: err };
  }
}

/**
 * Lit historique depuis Firestore avec pagination
 * @param {string} uid
 * @param {number} limit
 * @param {Object|null} lastDoc - dernier doc pour startAfter
 * @returns {Promise<{data, lastDoc, error}>}
 */
export async function getCampaignsFromFirestore(uid, limitCount = 20, lastDoc = null) {
  const db = await getFirestoreInstance();
  if (!db) return { data: [], lastDoc: null, error: { code: 'firestore/not-configured' } };

  try {
    const { collection, query, orderBy, limit, getDocs, startAfter } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const colRef = collection(db, `users/${uid}/campaigns`);

    let q;
    if (lastDoc) {
      q = query(colRef, orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(limitCount));
    } else {
      q = query(colRef, orderBy('createdAt', 'desc'), limit(limitCount));
    }

    const snap = await getDocs(q);
    const campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

    return { data: campaigns, lastDoc: newLastDoc, error: null };
  } catch (err) {
    console.warn('[Firestore] getCampaigns error:', err.message);
    return { data: [], lastDoc: null, error: err };
  }
}

/**
 * Supprime campagne
 * @param {string} uid
 * @param {string} campaignId
 */
export async function deleteCampaignFromFirestore(uid, campaignId) {
  const db = await getFirestoreInstance();
  if (!db) return { error: { code: 'firestore/not-configured' } };

  try {
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const ref = doc(db, `users/${uid}/campaigns/${campaignId}`);
    await deleteDoc(ref);
    console.log('[Firestore] Campagne supprimée:', campaignId);
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

// ==================== REFERRALS (préparation sans bonus sensible) ====================

/**
 * Prépare structure referrals sans distribuer bonus côté client (Phase 3B)
 * Crée referralCodes/{code} avec ownerUid
 * @param {string} uid
 * @param {string} code
 */
export async function createReferralCodeInFirestore(uid, code) {
  const db = await getFirestoreInstance();
  if (!db) return { data: null, error: { code: 'firestore/not-configured' } };

  try {
    const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const ref = doc(db, `referralCodes/${code}`);

    const data = {
      code: code,
      ownerUid: uid,
      createdAt: serverTimestamp(),
      usesCount: 0,
      isActive: true
    };

    await setDoc(ref, data);
    console.log('[Firestore] Referral code créé:', code, 'owner:', uid);
    return { data, error: null };
  } catch (err) {
    console.warn('[Firestore] createReferralCode error:', err.message);
    return { data: null, error: err };
  }
}

/**
 * Lit referral code
 * @param {string} code
 */
export async function getReferralCodeFromFirestore(code) {
  const db = await getFirestoreInstance();
  if (!db) return { data: null, error: null };

  try {
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const ref = doc(db, `referralCodes/${code}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return { data: snap.data(), error: null };
    }
    return { data: null, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Prépare referrals/{referredUid} sans bonus (Phase 3B)
 * Bonus sécurisé sera Phase 4 via Functions
 * @param {string} referredUid
 * @param {string} referrerUid
 * @param {string} code
 */
export async function createReferralRecordInFirestore(referredUid, referrerUid, code) {
  const db = await getFirestoreInstance();
  if (!db) return { data: null, error: { code: 'firestore/not-configured' } };

  if (referredUid === referrerUid) {
    return { data: null, error: { code: 'referral/self-referral', message: 'Auto-parrainage interdit' } };
  }

  try {
    const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const ref = doc(db, `referrals/${referredUid}`);

    const data = {
      referredUid: referredUid,
      referrerUid: referrerUid,
      code: code,
      createdAt: serverTimestamp(),
      status: 'pending' // pending -> validated par backend Phase 4
      // Pas de rewardAmount côté client (backend only)
    };

    await setDoc(ref, data);
    console.log('[Firestore] Referral record créé:', referredUid, '->', referrerUid);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ==================== PREFERENCES (cloud only si nécessaire) ====================

/**
 * Pour Phase 3B, thème reste localStorage (décision)
 * Cette fonction est placeholder pour future préférences cloud
 */
export async function getCloudPreferences(uid) {
  const { data: profile } = await getUserProfile(uid);
  if (profile) {
    return { theme: profile.theme || 'light' };
  }
  return { theme: 'light' };
}

export async function saveCloudPreferences(uid, prefs) {
  // Phase 3B: ne sauvegarde que theme si nécessaire, pas de crédits/plan/etc.
  const db = await getFirestoreInstance();
  if (!db) return { error: { code: 'firestore/not-configured' } };

  try {
    const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const ref = doc(db, `users/${uid}`);
    await updateDoc(ref, {
      theme: prefs.theme || 'light',
      updatedAt: serverTimestamp()
    });
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}
