// Serveur de l'espace admin Recymo : connexion par code, enregistrement des
// modifications dans GitHub, statistiques de visite et demandes clients.
// Aucune dépendance : Node 20+.
//
// Variables d'environnement :
//   ADMIN_CODE        code d'accès admin (obligatoire)
//   GITHUB_TOKEN      clé GitHub avec accès en écriture aux deux dépôts
//                     (sans clé : mode local, fichiers lus et écrits sur le disque)
//   DEPLOY_HOOK       lien « deploy hook » Render du site, appelé après chaque enregistrement
//   SITE_REPO         dépôt du site      (défaut : nicjo002529-creator/recymo-site)
//   DATA_REPO         dépôt des données  (défaut : nicjo002529-creator/recymo-data)
//   ALLOWED_ORIGINS   origines autorisées, séparées par des virgules
//   LOCAL_SITE_DIR / LOCAL_DATA_DIR   dossiers utilisés en mode local
"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const H = require("./horaires.js");

const PORT = +process.env.PORT || 10000;
const ADMIN_CODE = process.env.ADMIN_CODE || "";
const TOKEN = process.env.GITHUB_TOKEN || "";
const DEPLOY_HOOK = process.env.DEPLOY_HOOK || "";
const SITE_REPO = process.env.SITE_REPO || "nicjo002529-creator/recymo-site";
const DATA_REPO = process.env.DATA_REPO || "nicjo002529-creator/recymo-data";
const BRANCH = "main";
const ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "https://recymo-ciu7.onrender.com,https://recymo.be,https://www.recymo.be,http://localhost:8765").split(",").map((s) => s.trim());
const LOCAL = !TOKEN;
const LOCAL_DIRS = {
  [SITE_REPO]: process.env.LOCAL_SITE_DIR || path.join(__dirname, ".."),
  [DATA_REPO]: process.env.LOCAL_DATA_DIR || path.join(__dirname, "..", "..", "recymo-data-local")
};
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
// Pages françaises et leur version néerlandaise (dossier nl/)
const VERSION_NL = {
  "index.html": "nl/index.html", "tarifs.html": "nl/tarieven.html", "fiches-techniques.html": "nl/technische-fiches.html",
  "contact.html": "nl/contact.html", "mentions-legales.html": "nl/juridische-informatie.html"
};
const PAGES = [...Object.keys(VERSION_NL), ...Object.values(VERSION_NL)];
const langueDe = (f) => (f.startsWith("nl/") ? "nl" : "fr");
const pageJumelle = (f) => VERSION_NL[f] || Object.keys(VERSION_NL).find((k) => VERSION_NL[k] === f);
// Prix recopiés d'une langue à l'autre : seuls les mots courants changent
const traduirePrix = (v, langue) => langue === "nl"
  ? v.replace(/à convenir/gi, "Op aanvraag").replace(/gratuit/gi, "Gratis").replace(/sur demande/gi, "op aanvraag")
  : v.replace(/op aanvraag/gi, "À convenir").replace(/gratis/gi, "Gratuit");

/* ---------------------------------------------------------------- Stockage */

const gh = async (url, opts = {}) => {
  const r = await fetch("https://api.github.com" + url, {
    ...opts,
    headers: {
      Authorization: "Bearer " + TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "recymo-admin",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {})
    }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub " + r.status + " " + (await r.text()).slice(0, 200));
  return r;
};

// Lit un fichier : Buffer, ou null s'il n'existe pas
const lire = async (repo, chemin) => {
  if (LOCAL) {
    try { return await fs.readFile(path.join(LOCAL_DIRS[repo], chemin)); } catch { return null; }
  }
  const r = await gh(`/repos/${repo}/contents/${encodeURI(chemin)}?ref=${BRANCH}`, { headers: { Accept: "application/vnd.github.raw" } });
  return r ? Buffer.from(await r.arrayBuffer()) : null;
};
const lireTexte = async (repo, chemin) => { const b = await lire(repo, chemin); return b ? b.toString("utf8") : null; };

// Écrit plusieurs fichiers en un seul commit. fichiers : { chemin: Buffer|string|null (suppression) }
const files = {};
const commit = (repo, fichiers, message) => {
  files[repo] = (files[repo] || Promise.resolve()).then(() => commitNow(repo, fichiers, message));
  return files[repo];
};
const commitNow = async (repo, fichiers, message) => {
  if (LOCAL) {
    for (const [chemin, contenu] of Object.entries(fichiers)) {
      const p = path.join(LOCAL_DIRS[repo], chemin);
      if (contenu === null) { await fs.rm(p, { force: true }); continue; }
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, contenu);
    }
    return "local";
  }
  const ref = await (await gh(`/repos/${repo}/git/ref/heads/${BRANCH}`)).json();
  const parent = await (await gh(`/repos/${repo}/git/commits/${ref.object.sha}`)).json();
  const tree = [];
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    if (contenu === null) { tree.push({ path: chemin, mode: "100644", type: "blob", sha: null }); continue; }
    const buf = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu, "utf8");
    const blob = await (await gh(`/repos/${repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: buf.toString("base64"), encoding: "base64" }) })).json();
    tree.push({ path: chemin, mode: "100644", type: "blob", sha: blob.sha });
  }
  const t = await (await gh(`/repos/${repo}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree }) })).json();
  const c = await (await gh(`/repos/${repo}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) })).json();
  await gh(`/repos/${repo}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
  return c.sha;
};

/* ------------------------------------------------------------- Utilitaires */

const ipDe = (req) => (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const jourBruxelles = (d = new Date()) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Brussels" }).format(d);
const echapper = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const echapperAttr = (s) => echapper(s).replace(/"/g, "&quot;");

const lireCorps = (req, max) => new Promise((ok, ko) => {
  const morceaux = []; let taille = 0;
  req.on("data", (c) => { taille += c.length; if (taille > max) { ko(Object.assign(new Error("Trop volumineux"), { status: 413 })); req.destroy(); } else morceaux.push(c); });
  req.on("end", () => ok(Buffer.concat(morceaux).toString("utf8")));
  req.on("error", ko);
});

// Limiteur simple : n essais par fenêtre, par clé
const limites = new Map();
const limite = (cle, n, fenetreMs) => {
  const now = Date.now();
  const e = limites.get(cle);
  if (!e || e.fin < now) { limites.set(cle, { n: 1, fin: now + fenetreMs }); return true; }
  e.n++;
  return e.n <= n;
};
setInterval(() => { const now = Date.now(); for (const [k, v] of limites) if (v.fin < now) limites.delete(k); }, 600000).unref();

/* ---------------------------------------------------------------- Sessions */

const signer = (exp) => crypto.createHmac("sha256", SECRET).update(String(exp)).digest("base64url");
const nouveauJeton = () => { const exp = Date.now() + 12 * 3600 * 1000; return exp + "." + signer(exp); };
const jetonValide = (req) => {
  const m = (req.headers.authorization || "").match(/^Bearer (\d+)\.([\w-]+)$/);
  if (!m || +m[1] < Date.now()) return false;
  const a = Buffer.from(signer(m[1])), b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const codeValide = (code) => {
  if (!ADMIN_CODE) return false;
  const a = crypto.createHash("sha256").update(String(code)).digest();
  const b = crypto.createHash("sha256").update(ADMIN_CODE).digest();
  return crypto.timingSafeEqual(a, b);
};

/* ------------------------------------------------------------ Statistiques */
// stats/AAAA-MM.json : { "AAAA-MM-JJ": { vues, visiteurs, devis, appels, estimations, demandes, pages: {} } }

const EVENEMENTS = ["vue", "devis", "appel", "estimation", "demande"];
const CHAMP = { vue: "vues", devis: "devis", appel: "appels", estimation: "estimations", demande: "demandes" };
let mois = { cle: null, data: {}, sale: false };
let visiteurs = { jour: null, set: new Set(), sel: crypto.randomBytes(16).toString("hex") };

const chargerMois = async (cle) => {
  if (mois.cle === cle) return;
  if (mois.sale) await sauverStats();
  const txt = await lireTexte(DATA_REPO, `stats/${cle}.json`).catch(() => null);
  mois = { cle, data: txt ? JSON.parse(txt) : {}, sale: false };
};
const sauverStats = async () => {
  if (!mois.sale || !mois.cle) return;
  mois.sale = false;
  try {
    await commit(DATA_REPO, { [`stats/${mois.cle}.json`]: JSON.stringify(mois.data, null, 1) }, "Statistiques " + mois.cle);
  } catch (e) { mois.sale = true; console.error("Sauvegarde stats :", e.message); }
};
const compter = async (evt, req, page) => {
  const jour = jourBruxelles();
  await chargerMois(jour.slice(0, 7));
  const d = mois.data[jour] || (mois.data[jour] = { vues: 0, visiteurs: 0, devis: 0, appels: 0, estimations: 0, demandes: 0, pages: {} });
  d[CHAMP[evt]]++;
  if (evt === "vue") {
    if (visiteurs.jour !== jour) visiteurs = { jour, set: new Set(), sel: crypto.randomBytes(16).toString("hex") };
    // Visiteur unique du jour, sans cookie : empreinte jetable de l'IP et du navigateur
    const id = crypto.createHash("sha256").update(visiteurs.sel + ipDe(req) + (req.headers["user-agent"] || "")).digest("hex").slice(0, 16);
    if (!visiteurs.set.has(id)) { visiteurs.set.add(id); d.visiteurs++; }
    const p = String(page || "/").replace(/\.html$/, "").replace(/\/index$/, "/").slice(0, 60) || "/";
    d.pages[p] = (d.pages[p] || 0) + 1;
  }
  mois.sale = true;
};
setInterval(sauverStats, 5 * 60 * 1000).unref();

/* ------------------------------------------------------- Demandes clients */

let demandes = null;
const chargerDemandes = async () => {
  if (!demandes) {
    const txt = await lireTexte(DATA_REPO, "demandes/index.json");
    demandes = txt ? JSON.parse(txt) : [];
  }
  return demandes;
};

/* ---------------------------------------------- Modifications du site */

// Remplace le texte d'un élément simple marqué data-edit="cle"
const remplacerTexte = (html, cle, valeur) => {
  const re = new RegExp('(<(\\w+)(?:\\s[^>]*)?\\sdata-edit="' + cle.replace(/[^\w-]/g, "") + '"[^>]*>)([^<]*)(</\\2>)');
  if (!re.test(html)) return null;
  return html.replace(re, (t, ouv, tag, ancien, ferm) => ouv + echapper(valeur) + ferm);
};

const appliquerHoraires = (html, horaires, langue) => {
  for (const [site, h] of Object.entries(horaires)) {
    const texte = echapper(H.texteCourt(h, langue));
    html = html.replace(new RegExp('(<(\\w+)[^>]*data-horaires-texte="' + site + '"[^>]*>)([^<]*)(</\\2>)', "g"), (t, o, tag, a, f) => o + texte + f);
    html = html.replace(new RegExp('(<dl[^>]*data-horaires-liste="' + site + '"[^>]*>)[\\s\\S]*?(</dl>)', "g"), (t, o, f) => o + H.listeHtml(h, echapper, langue) + f);
    if (site === "braives") {
      html = html.replace(/("openingHoursSpecification": )\[[\s\S]*?\n    \]/, (t, o) => o + H.jsonLd(h));
    }
  }
  return html;
};

const horodatage = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);

const enregistrer = async (patches) => {
  const pages = {};
  const fichiers = {};
  const page = async (f) => {
    if (!PAGES.includes(f)) throw Object.assign(new Error("Page inconnue : " + f), { status: 400 });
    if (!(f in pages)) pages[f] = await lireTexte(SITE_REPO, f);
    return pages[f];
  };
  const resume = [];

  for (const p of patches) {
    if (p.type === "texte") {
      const html = await page(p.page);
      const nouveau = remplacerTexte(html, String(p.cle), String(p.valeur).slice(0, 2000));
      if (nouveau === null) throw Object.assign(new Error("Élément introuvable : " + p.cle), { status: 400 });
      pages[p.page] = nouveau;
      if (/^prix-/.test(p.cle)) {
        const cle = String(p.cle).replace(/[^\w-]/g, "");
        // Le guide des classes reprend le prix du tableau
        const guide = (f, v) => {
          const affiche = /€/.test(v) && !/\/t/.test(v) ? v + "/t" : v;
          pages[f] = pages[f].replace(new RegExp('(<span[^>]*data-prix-de="' + cle + '"[^>]*>)[^<]*(</span>)', "g"), (t, o, fin) => o + echapper(affiche) + fin);
        };
        const v = String(p.valeur).slice(0, 200);
        guide(p.page, v);
        // Même prix sur la page de l'autre langue
        const jumelle = pageJumelle(p.page);
        if (jumelle) {
          const vj = traduirePrix(v, langueDe(jumelle));
          const autre = remplacerTexte(await page(jumelle), cle, vj);
          if (autre !== null) { pages[jumelle] = autre; guide(jumelle, vj); }
        }
      }
      resume.push("texte " + p.cle);
    } else if (p.type === "horaires") {
      const h = H.valider(p.horaires);
      fichiers["assets/data/horaires.json"] = JSON.stringify(h, null, 2) + "\n";
      for (const f of PAGES) pages[f] = appliquerHoraires(await page(f), h, langueDe(f));
      resume.push("horaires");
    } else if (p.type === "photo" || p.type === "galerie-ajout") {
      const m = String(p.image || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw Object.assign(new Error("Image invalide"), { status: 400 });
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 6 * 1024 * 1024) throw Object.assign(new Error("Image trop lourde (6 Mo max)"), { status: 413 });
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      if (p.type === "photo") {
        const slot = String(p.slot).replace(/[^\w-]/g, "");
        const fichier = `assets/img/${slot}-${horodatage()}.${ext}`;
        fichiers[fichier] = buf;
        for (const f of PAGES) {
          const html = await page(f);
          // Les pages nl/ gardent leur préfixe ../
          pages[f] = html.replace(new RegExp('(<img[^>]*data-photo="' + slot + '"[^>]*?\\ssrc=")((?:\\.\\./)*)[^"]*(")', "g"), "$1$2" + fichier + "$3")
            .replace(new RegExp('(<img[^>]*data-photo="' + slot + '"[^>]*?\\swidth=")\\d+("[^>]*?\\sheight=")\\d+(")', "g"), "$1" + (+p.largeur || 1600) + "$2" + (+p.hauteur || 1067) + "$3");
        }
        resume.push("photo " + slot);
      } else {
        const id = "galerie-" + horodatage();
        const fichier = `assets/img/${id}.${ext}`;
        fichiers[fichier] = buf;
        for (const f of ["contact.html", "nl/contact.html"]) {
          const html = await page(f);
          const fig =
            '<figure>\n            <img data-photo="' + id + '" src="' + (f.startsWith("nl/") ? "../" : "") + fichier + '" alt="' + echapperAttr(String(p.alt || p.legende || "Photo Recymo").slice(0, 200)) +
            '" width="' + (+p.largeur || 1600) + '" height="' + (+p.hauteur || 1067) + '" loading="lazy">\n            <figcaption>' +
            echapper(String(p.legende || "").slice(0, 120)) + "</figcaption>\n          </figure>\n          ";
          if (!html.includes("<!-- fin galerie -->")) throw Object.assign(new Error("Galerie introuvable"), { status: 400 });
          pages[f] = html.replace("<!-- fin galerie -->", fig + "<!-- fin galerie -->");
        }
        resume.push("photo ajoutée");
      }
    } else if (p.type === "galerie-retrait") {
      const id = String(p.slot).replace(/[^\w-]/g, "");
      const re = new RegExp('<figure>\\s*<img data-photo="' + id + '"[\\s\\S]*?</figure>\\s*');
      let trouvee = false;
      for (const f of ["contact.html", "nl/contact.html"]) {
        const html = await page(f);
        if (re.test(html)) { trouvee = true; pages[f] = html.replace(re, ""); }
      }
      if (!trouvee) throw Object.assign(new Error("Photo introuvable"), { status: 400 });
      resume.push("photo retirée");
    } else {
      throw Object.assign(new Error("Modification inconnue"), { status: 400 });
    }
  }

  for (const [f, html] of Object.entries(pages)) if (html !== null) fichiers[f] = html;
  if (!Object.keys(fichiers).length) return { ok: true, rien: true };
  const sha = await commit(SITE_REPO, fichiers, "Admin : " + resume.slice(0, 6).join(", ") + (resume.length > 6 ? "…" : ""));
  let deploiement = "non configuré";
  if (DEPLOY_HOOK && !LOCAL) {
    const r = await fetch(DEPLOY_HOOK, { method: "POST" }).catch(() => null);
    deploiement = r && r.ok ? "lancé" : "échec";
  }
  return { ok: true, commit: sha, deploiement, fichiers: Object.keys(fichiers) };
};

/* ------------------------------------------------------------------ Routes */

const envoyer = (res, status, data, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
};

const routes = {
  "GET /sante": async () => ({ ok: true, mode: LOCAL ? "local" : "github", code: !!ADMIN_CODE }),

  "POST /hit": async (req) => {
    if (!limite("hit:" + ipDe(req), 120, 60000)) return { ok: false };
    let d = {};
    try { d = JSON.parse(await lireCorps(req, 2000)); } catch { return { ok: false }; }
    if (!["vue", "devis", "appel", "estimation"].includes(d.e)) return { ok: false };
    await compter(d.e, req, d.p);
    return { ok: true };
  },

  "POST /login": async (req) => {
    const ip = ipDe(req);
    if (!limite("login:" + ip, 5, 15 * 60000)) throw Object.assign(new Error("Trop d'essais. Réessayez dans 15 minutes."), { status: 429 });
    let d = {};
    try { d = JSON.parse(await lireCorps(req, 1000)); } catch {}
    if (!codeValide(d.code || "")) throw Object.assign(new Error("Code incorrect."), { status: 401 });
    limites.delete("login:" + ip);
    return { jeton: nouveauJeton() };
  },

  "POST /demande": async (req) => {
    if (!limite("demande:" + ipDe(req), 5, 3600000)) throw Object.assign(new Error("Trop de demandes envoyées. Appelez-nous au 085 21 74 45."), { status: 429 });
    const d = JSON.parse(await lireCorps(req, 85 * 1024 * 1024));
    if (d._honey) return { ok: true };
    const champ = (k, max) => String(d[k] || "").trim().slice(0, max);
    const demande = {
      id: crypto.randomUUID(), date: new Date().toISOString(),
      nom: champ("nom", 120), societe: champ("societe", 120), email: champ("email", 160),
      telephone: champ("telephone", 40), sujet: champ("sujet", 80), message: champ("message", 5000), photo: null,
      langue: d.langue === "nl" ? "nl" : "fr"
    };
    if (!demande.nom || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(demande.email) || !demande.telephone || !demande.message) {
      throw Object.assign(new Error("Champs obligatoires manquants."), { status: 400 });
    }
    const fichiers = {};
    const m = String(d.photo || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (m) {
      const buf = Buffer.from(m[2], "base64");
      if (buf.length <= 6 * 1024 * 1024) {
        demande.photo = `demandes/photos/${demande.date.slice(0, 10)}-${demande.id.slice(0, 8)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
        fichiers[demande.photo] = buf;
      }
    }
    // Documents joints : analyses de terres, NMT, photos (6 fichiers, 10 Mo chacun au maximum)
    demande.fichiers = [];
    const EXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    for (const [i, f] of (Array.isArray(d.fichiers) ? d.fichiers.slice(0, 6) : []).entries()) {
      const mf = String((f && f.data) || "").match(/^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!mf) continue;
      const buf = Buffer.from(mf[2], "base64");
      if (buf.length > 10 * 1024 * 1024) continue;
      if (mf[1] === "application/pdf" && buf.subarray(0, 4).toString() !== "%PDF") continue;
      const base = String(f.nom || "document").replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "-").slice(0, 60) || "document";
      const chemin = `demandes/fichiers/${demande.date.slice(0, 10)}-${demande.id.slice(0, 8)}-${i + 1}-${base}.${EXT[mf[1]]}`;
      fichiers[chemin] = buf;
      demande.fichiers.push({ nom: String(f.nom || base).slice(0, 120), chemin, type: mf[1], taille: buf.length });
    }
    const liste = await chargerDemandes();
    liste.unshift(demande);
    fichiers["demandes/index.json"] = JSON.stringify(liste, null, 1);
    await commit(DATA_REPO, fichiers, "Nouvelle demande");
    await compter("demande", req);
    return { ok: true };
  },

  "GET /admin/stats": async (req, url) => {
    const jours = Math.min(366, Math.max(1, +url.searchParams.get("jours") || 30));
    const fin = new Date();
    const cles = new Set();
    for (let i = 0; i < jours; i++) cles.add(jourBruxelles(new Date(fin - i * 86400000)).slice(0, 7));
    const data = {};
    for (const c of cles) {
      if (c === mois.cle) { Object.assign(data, mois.data); continue; }
      const txt = await lireTexte(DATA_REPO, `stats/${c}.json`).catch(() => null);
      if (txt) Object.assign(data, JSON.parse(txt));
    }
    const serie = [];
    for (let i = jours - 1; i >= 0; i--) {
      const j = jourBruxelles(new Date(fin - i * 86400000));
      serie.push({ jour: j, ...(data[j] || { vues: 0, visiteurs: 0, devis: 0, appels: 0, estimations: 0, demandes: 0, pages: {} }) });
    }
    return { serie };
  },

  "GET /admin/demandes": async () => ({ demandes: await chargerDemandes() }),

  "GET /admin/photo": async (req, url, res) => {
    const chemin = String(url.searchParams.get("chemin") || "");
    if (!/^demandes\/(photos|fichiers)\/[\w.-]+$/.test(chemin)) throw Object.assign(new Error("Chemin invalide"), { status: 400 });
    const buf = await lire(DATA_REPO, chemin);
    if (!buf) throw Object.assign(new Error("Introuvable"), { status: 404 });
    const type = chemin.endsWith(".pdf") ? "application/pdf" : chemin.endsWith(".png") ? "image/png" : chemin.endsWith(".webp") ? "image/webp" : "image/jpeg";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(buf);
    return undefined;
  },

  "POST /admin/enregistrer": async (req) => {
    const d = JSON.parse(await lireCorps(req, 25 * 1024 * 1024));
    if (!Array.isArray(d.patches) || !d.patches.length || d.patches.length > 500) throw Object.assign(new Error("Aucune modification."), { status: 400 });
    return enregistrer(d.patches);
  }
};

const serveur = http.createServer(async (req, res) => {
  const origine = req.headers.origin;
  if (origine && ORIGINS.includes(origine)) {
    res.setHeader("Access-Control-Allow-Origin", origine);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, "http://x");
  const route = routes[req.method + " " + url.pathname];
  if (!route) return envoyer(res, 404, { erreur: "Introuvable" });
  if (url.pathname.startsWith("/admin/") && !jetonValide(req)) return envoyer(res, 401, { erreur: "Session expirée : reconnectez-vous." });
  try {
    const r = await route(req, url, res);
    if (r !== undefined) envoyer(res, 200, r);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) envoyer(res, e.status || 500, { erreur: e.status ? e.message : "Erreur du serveur. Réessayez dans un instant." });
  }
});

serveur.listen(PORT, () => console.log(`Admin Recymo sur le port ${PORT} (mode ${LOCAL ? "local" : "GitHub"})`));

// Render arrête le service après une période sans visite : on sauvegarde les statistiques avant
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => { await sauverStats().catch(() => {}); process.exit(0); });
}
