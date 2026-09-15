/**
 * MarketPulse AI - Configuration
 * Phase 1A: Fondation technique - constantes et presets
 */

export const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbwvt054Ryzs7mC-gchJaS27YNlOfLw-XhVkmKxysjPrpvONV4ScUaPdnD5G5FfCs2TpuA/exec";

export const DEFAULT_CREDITS = 15;
export const BONUS_REFERRAL = 5;
export const MAX_HISTORY = 10;

export const STORAGE_KEYS = {
  USER_EMAIL: 'marketpulse_user_email',
  CREDITS_PREFIX: 'marketpulse_credits_',
  PRO_PREFIX: 'marketpulse_is_pro_',
  HISTORY_PREFIX: 'marketpulse_history_',
  TOTAL_WORDS: 'marketpulse_total_words',
  TOTAL_CAMPAIGNS: 'marketpulse_total_campaigns',
  THEME: 'marketpulse_theme'
};

export const PRESETS = {
  ecom: {
    brand: "Afrishop Express",
    target: "Acheteurs en ligne & E-commerçants",
    tone: "Urgent & Persuasif",
    offer: "Livraison gratuite en 24h sur tous vos articles de mode & tech préférés avec paiement Mobile Money à la livraison !"
  },
  coaching: {
    brand: "Digital Skills Academy",
    target: "Jeunes professionnels & Reconversion",
    tone: "Inspirant & Captivant",
    offer: "Formation intensive de 4 semaines pour maîtriser le Marketing Digital et décrocher vos premiers clients freelances."
  },
  immo: {
    brand: "Koffi Immo Prestige",
    target: "Investisseurs & Familles",
    tone: "Professionnel & Premium",
    offer: "Villas de standing sécurisées à vendre avec facilités de paiement échelonnées et titres fonciers garantis."
  },
  resto: {
    brand: "Le Lagon Gourmand",
    target: "Amateurs de bonne cuisine & Familles",
    tone: "Décontracté & Amusant",
    offer: "Menu spécial Grillades & Fruits de Mer ce week-end avec -20% sur présentation de cette annonce !"
  },
  b2b: {
    brand: "DigiCraft Marketing Agency",
    target: "PME, Startups & Entreprises locales",
    tone: "Professionnel & Premium",
    offer: "Accompagnement 360° pour automatiser votre prospection client et multiplier vos ventes par 3 en 90 jours."
  }
};

export const IMAGE_URLS = {
  resto: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
  immo: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80',
  ecom: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=800&q=80',
  coaching: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=800&q=80',
  default: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80'
};
