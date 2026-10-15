// Marque les éléments modifiables depuis le mode admin.
// - textes simples (sans balise à l'intérieur) : data-edit="<page>-<n>"
// - prix de tarifs.html : data-edit="prix-<code>" (codes repris par l'estimateur)
// Les marques existantes sont conservées : relancer le script ne change pas les clés.
// Usage : node scripts/annoter.mjs
import { readFileSync, writeFileSync } from "node:fs";

const PAGES = { "index.html": "i", "tarifs.html": "t", "fiches-techniques.html": "f", "contact.html": "c", "mentions-legales.html": "m" };
const TAGS = "h1|h2|h3|p|td|th|dd|dt|summary|figcaption|strong|small|span|li|a|label|button";

// Zones jamais modifiables : en-tête, scripts, barre mobile, SVG
const zonesExclues = (html) => {
  const zones = [];
  const re = /<head[\s>][\s\S]*?<\/head>|<header[\s>][\s\S]*?<\/header>|<script[\s>][\s\S]*?<\/script>|<nav class="mobile-bar[\s\S]*?<\/nav>|<svg[\s>][\s\S]*?<\/svg>|<dl[^>]*data-horaires-liste[\s\S]*?<\/dl>/g;
  let m;
  while ((m = re.exec(html))) zones.push([m.index, m.index + m[0].length]);
  return zones;
};

const codePrix = (ligne, ctx) => {
  const ref = ligne.match(/<span class="ref">([^<]+)<\/span>/);
  if (ref) return { "B-T": "BT", "Poteaux": "POT" }[ref[1]] || ref[1];
  if (/Béton cellulaire/.test(ligne)) return "YT";
  if (ctx.section === "granulats") {
    const cells = [...ligne.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1].trim());
    const k = cells[0] + " " + cells[1];
    return {
      "Mixte 0/63": "G-MIX", "Tarmac 0/32": "G-TA32", "Tarmac 0/63": "G-TA63", "Béton 0/32": "G-BE32",
      "Béton 0/60": "G-BE60", "Béton 25/60": "G-BE2560", "Sable jaune ": "G-SAB", "Stabiter 0/32": "G-STAB"
    }[k] || null;
  }
  if (ctx.section === "versage-terre" && ctx.site) {
    const s = ctx.site;
    if (s === "SA") {
      if (/Type I à III/.test(ligne)) return "T-SA-13";
      if (/Type IV à V/.test(ligne)) return "T-SA-45";
      if (/Plantes/.test(ligne)) return "T-SA-INV";
      if (/amiante/.test(ligne)) return "T-SA-AM";
      if (/Type I à V/.test(ligne)) return "T-SA-AN";
    }
    if (s === "BR") return /Gros/.test(ligne) ? "T-BR-GROS" : "T-BR";
    ctx.vus[s] = (ctx.vus[s] || 0) + 1;
    return "T-" + s + (ctx.vus[s] > 1 ? "-AN" : "");
  }
  return null;
};

for (const [file, prefix] of Object.entries(PAGES)) {
  let html = readFileSync(file, "utf8");
  const nl = html.includes("\r\n") ? "\r\n" : "\n";

  // 1. Prix (ligne par ligne, tarifs.html)
  if (file === "tarifs.html") {
    const ctx = { section: null, site: null, vus: {} };
    let n = 0;
    html = html.split(nl).map((ligne) => {
      const sec = ligne.match(/<section class="panel" id="([^"]+)"/);
      if (sec) ctx.section = sec[1];
      const site = ligne.match(/WT(050579|011403|062991|026437)/);
      if (site) ctx.site = { "050579": "SA", "011403": "TR", "062991": "BR", "026437": "FO" }[site[1]];
      if (/<td data-label="Prix[^"]*" class="num/.test(ligne) && !/data-edit=/.test(ligne)) {
        const code = codePrix(ligne, ctx) || "n" + (++n);
        ligne = ligne.replace(/<td data-label="Prix([^"]*)" class="num/, '<td data-label="Prix$1" data-edit="prix-' + code + '" class="num');
      }
      return ligne;
    }).join(nl);
  }

  // 2. Textes simples
  const existants = [...html.matchAll(new RegExp('data-edit="' + prefix + '-(\\d+)"', "g"))].map((m) => +m[1]);
  let compteur = existants.length ? Math.max(...existants) : 0;
  const zones = zonesExclues(html);
  const dansZone = (i) => zones.some(([a, b]) => i >= a && i < b);
  const re = new RegExp("<(" + TAGS + ")(\\s[^>]*)?>([^<]+)</\\1>", "g");
  html = html.replace(re, (tout, tag, attrs = "", texte, offset) => {
    if (dansZone(offset)) return tout;
    if (/data-(edit|statut|year|suggest|horaires|prix-de)|aria-hidden|class="(sr-only|err)"/.test(attrs)) return tout;
    if (!/[A-Za-zÀ-ÿ0-9]/.test(texte)) return tout;
    return "<" + tag + attrs + ' data-edit="' + prefix + "-" + (++compteur) + '">' + texte + "</" + tag + ">";
  });

  writeFileSync(file, html);
  console.log(file, "→", (html.match(/data-edit=/g) || []).length, "éléments modifiables");
}
