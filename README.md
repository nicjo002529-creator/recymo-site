# Recymo Wallonie — site web

Site vitrine de Recymo Wallonie SA (recyclage de déchets de construction et terres, Braives).

Site **100 % statique** (HTML / CSS / JS, aucune dépendance, aucun build) :

```
index.html               Accueil
tarifs.html              Tarifs (onglets : classe 3, terre, granulats, stabilisé, synthétiques)
fiches-techniques.html   Fiches techniques (PDF dans assets/docs/)
contact.html             Contact + formulaire (ouvre la messagerie, mailto:info@recymo.be)
mentions-legales.html
assets/css/style.css     Design system (couleurs, typo, composants)
assets/js/main.js        Menu mobile, onglets, filtres, formulaire, animations
render.yaml              Déploiement Render (static site, plan gratuit)
```

## Modifier un prix
Ouvrir `tarifs.html`, chercher la ligne concernée et changer la valeur dans la cellule `class="num"`.
Commit + push sur `main` → Render redéploie automatiquement.

## Ajouter une fiche technique
1. Déposer le PDF dans `assets/docs/`.
2. Dupliquer un bloc `<article class="doc-card">` dans `fiches-techniques.html` et adapter le texte, le lien et `data-cat`.

## Aperçu local
Ouvrir `index.html` dans un navigateur suffit.
