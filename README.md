<div align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="">
  <h1>Nook</h1>
  <p><strong>Un carnet de notes qui ne parle à personne.</strong></p>
  <p>
    <a href="https://maxgfr.github.io/nook/">Ouvrir l'application</a> ·
    <a href="#état-du-projet">État du projet</a> ·
    <a href="#ce-que-nook-protège-et-ce-quil-ne-protège-pas">Sécurité</a>
  </p>
</div>

---

Nook est un outil de prise de notes qui tourne entièrement dans votre
navigateur. Il n'y a pas de compte, pas de serveur, pas de synchronisation.
Vos notes sont chiffrées et stockées sur votre machine, et la page elle-même
est configurée pour qu'aucune requête sortante ne soit possible.

C'est un site statique servi par GitHub Pages : le serveur envoie des fichiers
et n'a jamais rien à recevoir en retour.

## La promesse, et comment elle est tenue

| Promesse                              | Mécanisme                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Rien ne sort de votre machine         | `connect-src 'none'` dans la CSP — le navigateur refuse toute requête sortante            |
| Personne ne l'a désactivé par mégarde | La CI inspecte le bundle publié et échoue si du code réseau y entre ([le garde-fou][cnn]) |
| Vos notes sont illisibles sur disque  | AES-GCM-256, clé non extractible, jamais exposée à JavaScript                             |
| Tout peut vraiment être effacé        | Base, caches, service worker et stockages détruits, puis inventaire de ce qui reste       |
| Ça marche hors connexion              | Application précachée, installable en PWA                                                 |

[cnn]: scripts/check-no-network.mjs

## Ce que Nook protège, et ce qu'il ne protège pas

Par défaut, la clé de chiffrement est générée sur l'appareil et rangée dans le
navigateur sous une forme que JavaScript ne peut pas lire.

**Ce que ça protège :** quelqu'un qui copie votre disque, votre profil
navigateur ou une sauvegarde n'obtient que des octets inexploitables.

**Ce que ça ne protège pas :** quelqu'un qui ouvre _votre_ navigateur avec
_votre_ session déverrouillée obtient exactement les mêmes droits que vous. La
protection par passphrase, qui répond à cette menace, arrive en phase 4.

Nous préférons le dire platement plutôt que de laisser croire à une garantie
que le produit ne donne pas encore.

## État du projet

Nook se construit par phases, et chaque phase laisse un dépôt déployable.

| Phase | Contenu                                                                           | État    |
| :---: | --------------------------------------------------------------------------------- | ------- |
|  P0   | Fondations, CI, déploiement Pages, garde-fou réseau, jetons de design             | ✅ fait |
|  P1   | Coffre chiffré : stockage, enveloppes AES-GCM, cycle de vie de la clé, effacement | ✅ fait |
|  P2   | Éditeur à blocs, arbre de pages, sauvegarde automatique                           | à venir |
|  P3   | Wikilinks, backlinks, tags, recherche, palette de commandes, notes du jour        | à venir |
|  P4   | Passphrase, verrouillage automatique, export chiffré                              | à venir |
|  P5   | Bases de données : propriétés typées, vues table / kanban / calendrier            | à venir |
|  P6   | Vue graphe, historique de versions, images, impression                            | à venir |

**L'éditeur n'existe pas encore.** L'application déployée montre aujourd'hui
l'état des fondations, pas un outil utilisable au quotidien.

## Architecture

Deux moitiés, séparées par une règle vérifiée en CI.

```
src/core/   TypeScript pur — stockage, chiffrement, modèle, recherche
src/ui/     React — composants, éditeur, mise en page
```

Le core n'importe ni React ni l'éditeur ; l'interface ne touche jamais
IndexedDB ni WebCrypto. Cette frontière n'est pas une convention de style :
[un test la fait respecter](src/core/architecture.test.ts) et casse la CI
quand elle est franchie. Elle permet de tester toute la logique sans
navigateur, et de refaire l'interface sans toucher aux données.

## Développement

```bash
pnpm install
pnpm dev        # serveur de développement
pnpm test       # tests du core
pnpm verify     # types, lint, tests, build, garde-fou réseau
```

`pnpm verify` est exactement ce que la CI exécute.

## Héberger le vôtre

1. Forkez ce dépôt.
2. Réglages → Pages → Source : **GitHub Actions**.
3. Poussez sur `main`.

Le sous-chemin est déduit du nom du dépôt : renommer votre fork suffit, il n'y
a rien à modifier dans le code.

## Licence

[MIT](LICENSE).
