// Génère la version néerlandaise du site (dossier nl/) à partir des pages françaises,
// et ajoute dans toutes les pages le lien FR/NL et les balises hreflang.
// Les traductions sont dans scripts/nl-dictionnaire.mjs.
// Attention : relancer le script écrase les pages nl/ (et donc les textes NL modifiés dans l'admin).
// Usage : node scripts/traduire-nl.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { NL, NEUTRES } from "./nl-dictionnaire.mjs";

const require = createRequire(import.meta.url);
const H = require("../serveur/horaires.js");
const horaires = JSON.parse(readFileSync("assets/data/horaires.json", "utf8"));

// Page française → page néerlandaise, et adresses publiques (canonical)
const PAGES = {
  "index.html": { nl: "index.html", urlFr: "https://recymo.be/", urlNl: "https://recymo.be/nl/" },
  "tarifs.html": { nl: "tarieven.html", urlFr: "https://recymo.be/tarifs", urlNl: "https://recymo.be/nl/tarieven.html" },
  "fiches-techniques.html": { nl: "technische-fiches.html", urlFr: "https://recymo.be/fiches-techniques", urlNl: "https://recymo.be/nl/technische-fiches.html" },
  "contact.html": { nl: "contact.html", urlFr: "https://recymo.be/contact", urlNl: "https://recymo.be/nl/contact.html" },
  "mentions-legales.html": { nl: "juridische-informatie.html", urlFr: "https://recymo.be/mentions-legales", urlNl: "https://recymo.be/nl/juridische-informatie.html" }
};

const manquants = new Map();
const echapper = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Traduit un texte entier ; garde les espaces autour
const traduire = (brut, ou) => {
  const t = brut.trim();
  if (!t || !/[A-Za-zÀ-ÿ]/.test(t)) return brut;
  if (t in NL) return brut.replace(t, NL[t]);
  if (!NEUTRES.has(t) && !/^[A-Z]{1,2}\d{1,2}$|^Site WT\d+$|^(Lun|Mar|Mer|Jeu|Ven|Sam|Dim)–/.test(t) && !/^[\d\s,./×%€+±&;nbspt°m²³-]+$|^\d/.test(t)) manquants.set(t, ou);
  return brut;
};

// Supprime ce que le script a ajouté lors d'une exécution précédente
const nettoyer = (html) => html
  .replace(/\n\s*<link rel="alternate" hreflang="[^"]+"[^>]*>/g, "")
  .replace(/\n\s*<a class="lang-switch"[^>]*>[\s\S]*?<\/a>/g, "")
  .replace(/\n\s*<li class="mobile-only lang-li">[\s\S]*?<\/li>/g, "");

const lienLangue = (vers, href) => vers === "nl"
  ? `<a class="lang-switch" href="${href}" hreflang="nl" lang="nl" data-langue="nl"><span class="sr-only">Nederlandstalige versie: </span>NL</a>`
  : `<a class="lang-switch" href="${href}" hreflang="fr" lang="fr" data-langue="fr"><span class="sr-only">Version française : </span>FR</a>`;

const ajouterLangues = (html, p, langue) => {
  const alternates =
    `\n  <link rel="alternate" hreflang="fr-BE" href="${p.urlFr}" data-local="${langue === "nl" ? "../" + (p.fr) : p.fr}">` +
    `\n  <link rel="alternate" hreflang="nl-BE" href="${p.urlNl}" data-local="${langue === "nl" ? p.nl : "nl/" + p.nl}">` +
    `\n  <link rel="alternate" hreflang="x-default" href="${p.urlFr}">`;
  html = html.replace(/(<link rel="canonical"[^>]*>)/, "$1" + alternates);
  const autre = langue === "nl" ? "fr" : "nl";
  const href = langue === "nl" ? "../" + p.fr : "nl/" + p.nl;
  html = html.replace(/(\n(\s*)<div class="more-menu">)/, (t, tout, ind) => "\n" + ind + lienLangue(autre, href) + tout);
  return html;
};

mkdirSync("nl", { recursive: true });

for (const [fr, p] of Object.entries(PAGES)) {
  p.fr = fr;
  let source = nettoyer(readFileSync(fr, "utf8"));

  // 1. Page française : liens de langue
  writeFileSync(fr, ajouterLangues(source, p, "fr"));

  // 2. Page néerlandaise
  let html = source;
  html = html.replace('<html lang="fr-BE">', '<html lang="nl-BE" data-racine="../">');
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, "$1" + p.urlNl + "$2");
  // Fichiers communs : un dossier plus haut
  html = html.replace(/(\s(?:src|href|content)=")(assets\/|serveur\/)/g, "$1../$2");
  // Liens entre pages
  for (const [f, q] of Object.entries(PAGES)) {
    html = html.replace(new RegExp('(href=")' + f.replace(".", "\\.") + '([#?"])', "g"), "$1" + q.nl + "$2");
  }
  // Options du formulaire : la valeur reste en français (traitement des demandes), le texte est traduit
  html = html.replace(/<option>([^<]+)<\/option>/g, '<option value="$1">$1</option>');

  // Textes (hors scripts, styles et SVG)
  const zones = [];
  html = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?-->/g, (m) => { zones.push(m); return "<zone-" + (zones.length - 1) + ">"; });
  html = html.replace(/>([^<]+)</g, (m, t) => ">" + traduire(t, p.nl) + "<");
  html = html.replace(/(\s(?:alt|aria-label|placeholder|title)=")([^"]+)(")/g, (m, a, t, b) => a + traduire(t, p.nl).trim() + b);
  html = html.replace(/(<meta (?:name="description"|property="og:(?:title|description)") content=")([^"]+)(")/g, (m, a, t, b) => a + traduire(t, p.nl).trim() + b);
  html = html.replace(/<zone-(\d+)>/g, (m, i) => zones[+i]);

  // Horaires au format néerlandais
  for (const [site, h] of Object.entries(horaires)) {
    html = html.replace(new RegExp('(<(\\w+)[^>]*data-horaires-texte="' + site + '"[^>]*>)([^<]*)(</\\2>)', "g"), (t, o, tag, a, f) => o + echapper(H.texteCourt(h, "nl")) + f);
    html = html.replace(new RegExp('(<dl[^>]*data-horaires-liste="' + site + '"[^>]*>)[\\s\\S]*?(</dl>)', "g"), (t, o, f) => o + H.listeHtml(h, echapper, "nl") + f);
  }

  // FAQ en données structurées : reprise des questions traduites
  if (fr === "index.html") {
    const texte = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const faq = [...html.matchAll(/<details>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/details>/g)]
      .map((m) => `      { "@type": "Question", "name": ${JSON.stringify(texte(m[1]))}, "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(texte(m[2]))} } }`);
    html = html.replace(/("mainEntity": \[)[\s\S]*?(\n    \])/, "$1\n" + faq.join(",\n") + "$2");
    html = html.replace('"areaServed": { "@type": "AdministrativeArea", "name": "Wallonie" }', '"areaServed": [{ "@type": "AdministrativeArea", "name": "Wallonië" }, { "@type": "AdministrativeArea", "name": "Vlaanderen" }]');
    html = html.replace('"url": "https://recymo.be/"', '"url": "https://recymo.be/nl/"');
  }

  writeFileSync("nl/" + p.nl, ajouterLangues(html, p, "nl"));
  console.log(fr, "→ nl/" + p.nl);
}

if (manquants.size) {
  console.log("\nTextes sans traduction :");
  for (const [t, ou] of manquants) console.log("  " + ou + " : " + t);
  process.exitCode = 1;
}
