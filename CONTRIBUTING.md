# Contribuer à MarketPulse AI

## Prérequis

- Node.js 20 ou supérieur
- npm
- Firebase CLI pour lancer les émulateurs

## Installation

```bash
npm --prefix functions ci
```

## Validation locale

Depuis la racine du dépôt :

```bash
npm run check
```

Cette commande exécute le lint du backend Firebase, les tests frontend de phases et la vérification syntaxique des Cloud Functions.

Pour exécuter les tests des règles Firestore, qui nécessitent l'émulateur Firebase et les dépendances de test correspondantes :

```bash
npm run test:rules
```

## Développement

```bash
npm run serve
```

Les secrets locaux doivent rester dans `functions/.env` et ne doivent jamais être commités. Le déploiement des fonctions est effectué par GitHub Actions avec les secrets du dépôt.
