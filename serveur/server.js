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
//
// Connexion à NewTonne (gestion des devis) — facultative, active si NEWTONNE_URL et NEWTONNE_API_KEY existent :
//   NEWTONNE_URL             adresse de NewTonne (ex. https://newtonne.onrender.com)
//   NEWTONNE_API_KEY         clé « ntq_… » créée dans NewTonne › Commercial › Devis › Connexion à l'IA
//   NEWTONNE_WEBHOOK_SECRET  secret « whsec_… » affiché au même endroit (vérifie les décisions reçues)
//   LIENS_SECRET             clé des liens vers les documents joints (défaut : NEWTONNE_API_KEY)
// Information du client après la décision (Brevo) — facultative :
//   BREVO_API_KEY            clé API Brevo (e-mails et SMS)
//   EMAIL_EXPEDITEUR         adresse d'envoi validée dans Brevo (ex. devis@recymo.be)
//   EMAIL_COPIE              copie cachée de chaque e-mail envoyé au client (facultatif, ex. info@recymo.be)
//   SMS_EXPEDITEUR           nom affiché des SMS (ex. Recymo) ; absent : pas de SMS
// Chat de devis : robot à règles (serveur/robot.js), sans service d'IA extérieur ni clé.
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

const lireBrut = (req, max) => new Promise((ok, ko) => {
  const morceaux = []; let taille = 0;
  req.on("data", (c) => { taille += c.length; if (taille > max) { ko(Object.assign(new Error("Trop volumineux"), { status: 413 })); req.destroy(); } else morceaux.push(c); });
  req.on("end", () => ok(Buffer.concat(morceaux)));
  req.on("error", ko);
});
const lireCorps = async (req, max) => (await lireBrut(req, max)).toString("utf8");

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
// Version de la liste : change à chaque nouvelle demande ou mise à jour (suivi en direct dans l'admin)
let majDemandes = Date.now();
const sauverDemandes = async (message) => {
  majDemandes = Date.now();
  await commit(DATA_REPO, { "demandes/index.json": JSON.stringify(await chargerDemandes(), null, 1) }, message);
};

/* ---------------------------------------------------------------- NewTonne */
// Chaque demande part dans la boîte « Devis » de NewTonne (statut « à valider »). La décision prise dans
// NewTonne revient par un message signé, et le serveur vérifie aussi lui-même l'état des devis ouverts
// (le service peut être endormi quand NewTonne prévient). Le client est alors informé par e-mail et SMS.

const NEWTONNE_URL = (process.env.NEWTONNE_URL || "").replace(/\/+$/, "");
const NEWTONNE_CLE = process.env.NEWTONNE_API_KEY || "";
const NEWTONNE_SECRET = process.env.NEWTONNE_WEBHOOK_SECRET || "";
const NEWTONNE_ACTIF = !!(NEWTONNE_URL && NEWTONNE_CLE);
const LIENS_SECRET = process.env.LIENS_SECRET || NEWTONNE_CLE;
const BREVO_CLE = process.env.BREVO_API_KEY || "";
const EMAIL_EXPEDITEUR = process.env.EMAIL_EXPEDITEUR || "";
const EMAIL_COPIE = process.env.EMAIL_COPIE || "";
const SMS_EXPEDITEUR = (process.env.SMS_EXPEDITEUR || "").slice(0, 11);
const URL_PUBLIQUE = (process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const ESSAIS_MAX = 12;

// Codes de l'estimateur du site → matière NewTonne, opération, site
const MATIERES_NEWTONNE = {
  B0: "B0", B1: "B1", B2: "B2", B3: "B3", B4: "B4", B5: "B5", B6: "B6", POT: "POTEAUX",
  BR0: "BR0", BR1: "BR1", BR2: "BR2", BR3: "BR3", BR4: "BR4", BR5: "BR5", BR6: "BR6", BR7: "BR7", BR8: "BR8", BR9: "BR9", BR10: "BR10",
  YT: "YTONG", TA: "TA", BT: "B-T", TN: "TN",
  "T-BR": ["TERRE-BRAIVES-PETIT", "depot", "BRAIVES"], "T-BR-GROS": ["TERRE-BRAIVES-GROS", "depot", "BRAIVES"],
  "T-FO": ["TERRE-FOSSES-SA", "depot", "FOSSES"], "T-TR": ["TERRE-TRANS-SA", "depot", "TRANSINNES"],
  "T-FO-AN": ["TERRE-FOSSES-AA", "depot", "FOSSES"], "T-TR-AN": ["TERRE-TRANS-AA", "depot", "TRANSINNES"],
  "T-SA-13": ["TERRE-SAMB-SA-I-III", "depot", "SAMBREVILLE"], "T-SA-45": ["TERRE-SAMB-SA-IV-V", "depot", "SAMBREVILLE"],
  "T-SA-AN": ["TERRE-SAMB-AA", "depot", "SAMBREVILLE"], "T-SA-INV": ["TERRE-SAMB-INVASIVES", "depot", "SAMBREVILLE"],
  "T-SA-AM": ["TERRE-SAMB-AMIANTE", "depot", "SAMBREVILLE"],
  "G-MIX": ["GR-MIXTE-063", "retrait"], "G-TA32": ["GR-TARMAC-032", "retrait"], "G-TA63": ["GR-TARMAC-063", "retrait"],
  "G-BE32": ["GR-BETON-032", "retrait"], "G-BE60": ["GR-BETON-060", "retrait"], "G-BE2560": ["GR-BETON-2560", "retrait"],
  "G-SAB": ["GR-SABLE-JAUNE", "retrait"], "G-STAB": ["GR-STABITER-032", "retrait"]
};
const matiere = (code) => {
  const m = MATIERES_NEWTONNE[code];
  if (!m) return null;
  const [newtonne, operation = "depot", site = "BRAIVES"] = Array.isArray(m) ? m : [m];
  return { newtonne, operation, site };
};
// Lignes de l'estimateur reçues avec la demande : [[code, tonnes|null], …]
const lignesValides = (brut) => (Array.isArray(brut) ? brut : []).slice(0, 10)
  .map((l) => Array.isArray(l) ? { code: String(l[0] || ""), quantite: +l[1] > 0 && +l[1] < 100000 ? Math.round(+l[1] * 1000) / 1000 : null } : null)
  .filter((l) => l && matiere(l.code));

const SITES_PAR_SUJET = { "Versage classe 3": "BRAIVES", "Achat de granulats": "BRAIVES", "Béton et stabilisé": "BRAIVES", "Synthétiques enterrés": "BRAIVES" };

// Liens signés vers les documents joints (lisibles depuis NewTonne sans compte, valables 90 jours)
const signerLien = (chemin, exp) => crypto.createHmac("sha256", LIENS_SECRET + ":documents").update(chemin + "|" + exp).digest("base64url");
const lienDocument = (chemin) => {
  const exp = Math.floor(Date.now() / 1000) + 90 * 86400;
  return `${URL_PUBLIQUE}/document?c=${encodeURIComponent(chemin)}&exp=${exp}&sig=${signerLien(chemin, exp)}`;
};

const dateBruxelles = (iso) => new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

const versNewtonne = (d) => {
  const lignes = (d.lignes || []).map((l) => {
    const m = matiere(l.code);
    return { material_code: m.newtonne, operation: m.operation, ...(l.quantite ? { quantity: String(l.quantite) } : {}) };
  });
  const site = d.lignes && d.lignes.length ? matiere(d.lignes[0].code).site : SITES_PAR_SUJET[d.sujet];
  const docs = [...(d.fichiers || []), ...(d.photo ? [{ nom: "photo", chemin: d.photo }] : [])];
  const resume = [
    (d.langue === "nl" ? "[NL] Client néerlandophone : répondre en néerlandais. " : "") +
      `Demande reçue sur recymo.be le ${dateBruxelles(d.date)}. Objet : ${d.sujet || "non précisé"}.`,
    lignes.length ? `Estimation faite sur le site : ${lignes.length} matériau${lignes.length > 1 ? "x" : ""} (détail dans les lignes et dans le message).` : "Pas d'estimation : lignes à compléter.",
    docs.length ? "Documents joints (liens valables 90 jours) :\n" + docs.map((f) => `- ${f.nom} : ${lienDocument(f.chemin)}`).join("\n") : "Aucun document joint."
  ].join("\n");
  return {
    external_id: "recymo-" + d.id,
    status: "a_valider",
    contact: { name: d.nom, company: d.societe, email: d.email, phone: d.telephone },
    ...(site ? { site } : {}),
    summary: resume,
    messages: [{ role: "client", text: d.message, at: d.date }],
    ...(lignes.length ? { lines: lignes } : {})
  };
};

const appelNewtonne = async (methode, chemin, corps) => {
  const r = await fetch(NEWTONNE_URL + chemin, {
    method: methode,
    headers: { Authorization: "Bearer " + NEWTONNE_CLE, "Content-Type": "application/json", "User-Agent": "recymo-admin" },
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

// Envoie une demande à NewTonne ; met à jour d.newtonne (sans sauvegarder)
const envoyerNewtonne = async (d) => {
  const n = d.newtonne || (d.newtonne = { statut: "a_envoyer", essais: 0 });
  n.essais = (n.essais || 0) + 1;
  try {
    const { status, data } = await appelNewtonne("POST", "/api/devis/", versNewtonne(d));
    if (status === 200 || status === 201) {
      Object.assign(n, { statut: "envoye", envoyeLe: new Date().toISOString(), id: data.id || null, erreur: null });
      return true;
    }
    if (status === 409) { Object.assign(n, { statut: "envoye", erreur: null }); return true; } // déjà décidé dans NewTonne
    n.statut = "echec";
    n.erreur = `NewTonne ${status} : ${String(data.error || "").slice(0, 200)}`;
  } catch (e) {
    n.statut = "echec";
    n.erreur = "NewTonne injoignable : " + String(e.message).slice(0, 150);
  }
  console.error("Envoi NewTonne", d.id, n.erreur);
  return false;
};

/* Information du client */
const TEXTES = {
  fr: {
    sujetValide: (num) => `Votre devis Recymo ${num}`,
    sujetRefus: "Votre demande de devis Recymo",
    bonjour: (nom) => `Bonjour ${nom},`,
    valide: "Votre devis est prêt. Vous le trouverez en pièce jointe.",
    refus: "Nous avons bien étudié votre demande, mais nous ne pouvons pas y donner suite.",
    motif: "Motif",
    total: "Total", htva: "HTVA", tvac: "TVAC", unites: { tonne: "t", metre: "m", piece: "pièce(s)", passage: "passage(s)" },
    validite: "Ce devis est valable 30 jours. Pour le confirmer ou pour toute question, répondez à cet e-mail ou appelez-nous au 085 21 74 45.",
    autre: "Pour toute question, appelez-nous au 085 21 74 45.",
    signature: "L'équipe Recymo Wallonie",
    sms: (num, total) => `Recymo : votre devis ${num} est prêt (${total} HTVA). Envoyé par e-mail. Questions : 085 21 74 45`,
    smsRefus: "Recymo : nous ne pouvons pas donner suite à votre demande de devis. Détails par e-mail. Questions : 085 21 74 45"
  },
  nl: {
    sujetValide: (num) => `Uw offerte van Recymo ${num}`,
    sujetRefus: "Uw offerteaanvraag bij Recymo",
    bonjour: (nom) => `Beste ${nom},`,
    valide: "Uw offerte is klaar. U vindt ze in bijlage.",
    refus: "We hebben uw aanvraag grondig bekeken, maar kunnen er helaas niet op ingaan.",
    motif: "Reden",
    total: "Totaal", htva: "excl. btw", tvac: "incl. btw", unites: { tonne: "t", metre: "m", piece: "stuk(s)", passage: "rit(ten)" },
    validite: "Deze offerte is 30 dagen geldig. Om ze te bevestigen of voor vragen: antwoord op deze e-mail of bel 085 21 74 45.",
    autre: "Voor vragen kunt u ons bellen op 085 21 74 45.",
    signature: "Het team van Recymo Wallonie",
    sms: (num, total) => `Recymo: uw offerte ${num} is klaar (${total} excl. btw). Verstuurd per e-mail. Vragen: 085 21 74 45`,
    smsRefus: "Recymo: we kunnen niet ingaan op uw offerteaanvraag. Details per e-mail. Vragen: 085 21 74 45"
  }
};
const euros = (v) => (+v || 0).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

const courrielHtml = (d, dec) => {
  const t = TEXTES[d.langue] || TEXTES.fr;
  const p = (s) => `<p style="margin:0 0 14px">${s}</p>`;
  let corps = p(echapper(t.bonjour(d.nom)));
  if (dec.status === "valide") {
    corps += p(t.valide);
    if (dec.message_to_client) corps += p(echapper(dec.message_to_client).replace(/\n/g, "<br>"));
    const lignes = (dec.lines || []).map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #dfe6e1">${echapper(l.label || l.material_code || "")}</td>` +
      `<td style="padding:6px 8px;border-bottom:1px solid #dfe6e1;text-align:right;white-space:nowrap">${echapper((+l.quantity || 0).toLocaleString("fr-BE"))} ${echapper(t.unites[l.unit] || l.unit || "")}</td>` +
      `<td style="padding:6px 8px;border-bottom:1px solid #dfe6e1;text-align:right;white-space:nowrap">${euros(l.total_excl_vat)}</td></tr>`).join("");
    corps += `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 14px">${lignes}` +
      `<tr><td colspan="2" style="padding:8px;font-weight:700">${t.total} ${t.htva}</td><td style="padding:8px;text-align:right;font-weight:700">${euros(dec.total_excl_vat)}</td></tr>` +
      `<tr><td colspan="2" style="padding:0 8px 8px">${t.total} ${t.tvac}</td><td style="padding:0 8px 8px;text-align:right">${euros(dec.total_incl_vat)}</td></tr></table>`;
    corps += p(t.validite);
  } else {
    corps += p(t.refus);
    if (dec.refusal_reason) corps += p(`<strong>${t.motif} :</strong> ${echapper(dec.refusal_reason)}`);
    if (dec.message_to_client) corps += p(echapper(dec.message_to_client).replace(/\n/g, "<br>"));
    corps += p(t.autre);
  }
  corps += p(t.signature + "<br>Rue Roua 6, 4260 Braives · 085 21 74 45 · info@recymo.be");
  return `<!doctype html><html lang="${d.langue === "nl" ? "nl" : "fr"}"><body style="margin:0;padding:24px;background:#f6f4ee;font-family:Arial,sans-serif;color:#0e1a15">` +
    `<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font-size:15px;line-height:1.5">${corps}</div></body></html>`;
};

// Téléphone belge → format international pour les SMS (mobiles uniquement)
const mobileInternational = (tel) => {
  let n = String(tel || "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1); else if (n.startsWith("00")) n = n.slice(2); else if (n.startsWith("0")) n = "32" + n.slice(1);
  return /^324\d{8}$/.test(n) ? n : null;
};

const brevo = async (chemin, corps) => {
  const r = await fetch("https://api.brevo.com/v3" + chemin, {
    method: "POST", headers: { "api-key": BREVO_CLE, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(corps), signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error("Brevo " + r.status + " " + (await r.text()).slice(0, 150));
};

const informerClient = async (d, dec) => {
  const t = TEXTES[d.langue] || TEXTES.fr;
  const sujet = dec.status === "valide" ? t.sujetValide(dec.number || "") : t.sujetRefus;
  const html = courrielHtml(d, dec);
  const resultat = { email: "non configuré", sms: SMS_EXPEDITEUR ? "non configuré" : "désactivé" };

  // PDF officiel du devis (seulement depuis l'adresse NewTonne configurée : la clé n'est jamais envoyée ailleurs)
  let pdf = null;
  if (dec.status === "valide" && dec.pdf_url && NEWTONNE_URL && new URL(dec.pdf_url).origin === new URL(NEWTONNE_URL).origin) {
    try {
      const r = await fetch(dec.pdf_url, { headers: { Authorization: "Bearer " + NEWTONNE_CLE }, signal: AbortSignal.timeout(20000) });
      if (r.ok) pdf = Buffer.from(await r.arrayBuffer());
    } catch (e) { console.error("PDF NewTonne :", e.message); }
  }

  if (LOCAL && !BREVO_CLE) {
    // Mode local : le message est écrit sur le disque au lieu d'être envoyé
    const dossier = path.join(LOCAL_DIRS[DATA_REPO], "courriels");
    await fs.mkdir(dossier, { recursive: true });
    await fs.writeFile(path.join(dossier, `${d.id.slice(0, 8)}-${dec.status}.html`), `<!-- À : ${d.email} · Objet : ${sujet} -->\n` + html);
    if (pdf) await fs.writeFile(path.join(dossier, `${d.id.slice(0, 8)}-${dec.number}.pdf`), pdf);
    return { email: "simulé (mode local)", sms: SMS_EXPEDITEUR ? "simulé (mode local)" : "désactivé", pdf: !!pdf };
  }
  if (BREVO_CLE && EMAIL_EXPEDITEUR) {
    try {
      await brevo("/smtp/email", {
        sender: { email: EMAIL_EXPEDITEUR, name: "Recymo Wallonie" },
        to: [{ email: d.email, name: d.nom }],
        ...(EMAIL_COPIE ? { bcc: [{ email: EMAIL_COPIE }] } : {}),
        replyTo: { email: EMAIL_COPIE || EMAIL_EXPEDITEUR },
        subject: sujet, htmlContent: html,
        ...(pdf ? { attachment: [{ name: `${dec.number || "devis"}.pdf`, content: pdf.toString("base64") }] } : {})
      });
      resultat.email = pdf || dec.status !== "valide" ? "envoyé" : "envoyé sans PDF";
    } catch (e) { resultat.email = "échec"; console.error("E-mail client :", e.message); }
  }
  if (BREVO_CLE && SMS_EXPEDITEUR) {
    const mobile = mobileInternational(d.telephone);
    if (!mobile) resultat.sms = "pas de numéro mobile";
    else {
      try {
        await brevo("/transactionalSMS/sms", {
          sender: SMS_EXPEDITEUR, recipient: mobile, type: "transactional",
          content: dec.status === "valide" ? t.sms(dec.number || "", euros(dec.total_excl_vat)) : t.smsRefus
        });
        resultat.sms = "envoyé";
      } catch (e) { resultat.sms = "échec"; console.error("SMS client :", e.message); }
    }
  }
  return resultat;
};

// Décision reçue de NewTonne (message signé ou vérification périodique). Ne prévient le client qu'une fois.
const traiterDecision = async (dec) => {
  if (!dec || !["valide", "refuse", "abandonne"].includes(dec.status)) return false;
  const id = String(dec.external_id || "").replace(/^recymo-/, "");
  // Conversation du chat : la réponse est ajoutée dans la conversation (pas d'e-mail)
  const chat = await chargerChat(id);
  if (chat) return deciderChat(chat, dec);
  const d = (await chargerDemandes()).find((x) => x.id === id);
  if (!d) return false;
  const n = d.newtonne || (d.newtonne = { essais: 0 });
  if (n.statut === dec.status && (n.client || dec.status === "abandonne")) return false;
  Object.assign(n, {
    statut: dec.status, numero: dec.number || null, totalHtva: dec.total_excl_vat || null, totalTvac: dec.total_incl_vat || null,
    decideLe: dec.decided_at || new Date().toISOString(), decidePar: dec.decided_by || null,
    motif: dec.refusal_reason || null, messageClient: dec.message_to_client || null, erreur: null
  });
  if (dec.status !== "abandonne") {
    n.client = await informerClient(d, dec);
    n.client.le = new Date().toISOString();
  }
  await sauverDemandes(`Devis ${dec.number || id.slice(0, 8)} : ${dec.status}`);
  return true;
};

const signatureValide = (brut, ts, sig) => {
  if (!NEWTONNE_SECRET || !/^\d+$/.test(ts || "") || Math.abs(Date.now() / 1000 - +ts) > 300) return false;
  const attendu = Buffer.from("sha256=" + crypto.createHmac("sha256", NEWTONNE_SECRET).update(Buffer.concat([Buffer.from(ts + "."), brut])).digest("hex"));
  const recu = Buffer.from(String(sig || ""));
  return attendu.length === recu.length && crypto.timingSafeEqual(attendu, recu);
};

// Tâche de fond : renvoie les demandes en échec et vérifie l'état des devis encore ouverts
let tacheEnCours = false;
const tacheNewtonne = async () => {
  if (!NEWTONNE_ACTIF || tacheEnCours) return;
  tacheEnCours = true;
  try {
    const liste = await chargerDemandes();
    let change = false;
    for (const d of liste) {
      const n = d.newtonne;
      if (n && ["a_envoyer", "echec"].includes(n.statut) && (n.essais || 0) < ESSAIS_MAX) {
        await envoyerNewtonne(d);
        change = true;
      }
    }
    if (change) await sauverDemandes("Envoi des demandes à NewTonne");
    const limite60j = Date.now() - 60 * 86400000;
    for (const d of liste) {
      if (!d.newtonne || d.newtonne.statut !== "envoye" || new Date(d.date) < limite60j) continue;
      const { status, data } = await appelNewtonne("GET", "/api/devis/" + encodeURIComponent("recymo-" + d.id) + "/").catch(() => ({ status: 0 }));
      if (status === 200) await traiterDecision(data);
    }
    // Conversations du chat : renvoi des échecs, puis vérification des devis transmis
    for (const e of (await chargerIndexChats()).filter((x) => ["echec", "envoye"].includes(x.statut) && new Date(x.cree) >= limite60j)) {
      const c = await chargerChat(e.id);
      if (!c || !c.newtonne) continue;
      if (c.newtonne.statut === "echec" && (c.newtonne.essais || 0) < ESSAIS_MAX) { await envoyerChatNewtonne(c); marquerChat(c); continue; }
      if (c.newtonne.statut !== "envoye") continue;
      const { status, data } = await appelNewtonne("GET", "/api/devis/" + encodeURIComponent("recymo-" + c.id) + "/").catch(() => ({ status: 0 }));
      if (status === 200) await traiterDecision(data);
    }
  } catch (e) { console.error("Tâche NewTonne :", e.message); }
  tacheEnCours = false;
};
if (NEWTONNE_ACTIF) {
  setTimeout(tacheNewtonne, 30000).unref();
  setInterval(tacheNewtonne, 30 * 60000).unref();
}

/* ------------------------------------------------------------ Chat de devis */
// Le robot (serveur/robot.js) pose les questions et tient l'état de la conversation. Le serveur calcule les prix
// d'après la grille de la page Tarifs, garde la conversation et envoie le devis dans NewTonne seulement quand
// le client clique sur « Oui, j'envoie ma demande ». La décision de NewTonne est ensuite ajoutée à la conversation.
// Pour passer plus tard à l'API de Claude : remplacer robot.repondre, sans toucher au reste.

const robot = require("./robot.js");
const MAX_MESSAGES_CLIENT = 80;
const SUPPLEMENT_PETIT = 7.5; // par matière de moins de 5 t (versage classe 3 et granulats)

let prixSite = { lu: 0, prix: {} };
const chargerPrix = async () => {
  if (Date.now() - prixSite.lu < 600000) return prixSite.prix;
  const html = await lireTexte(SITE_REPO, "tarifs.html").catch(() => null);
  const prix = {};
  if (html) for (const m of html.matchAll(/data-edit="prix-([\w-]+)"[^>]*>([^<]*)</g)) prix[m[1]] = m[2].trim();
  prixSite = { lu: Date.now(), prix };
  return prix;
};
// « 18,00 €/t » → 18 ; « Gratuit » → 0 ; « À convenir » → null
const prixUnitaire = (texte) => {
  if (texte == null) return null;
  if (/gratuit|gratis/i.test(texte)) return 0;
  if (!/\d/.test(texte)) return null;
  const n = parseFloat(texte.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
};

// Codes postaux belges (GeoNames) : { "4260": [latitude, longitude, "Braives"] }, lus une fois sur le disque
let codesPostaux = null;
const chargerCodesPostaux = async () => {
  if (!codesPostaux) {
    try { codesPostaux = JSON.parse(await fs.readFile(path.join(__dirname, "..", "assets", "data", "codes-postaux.json"), "utf8")); }
    catch { codesPostaux = {}; }
  }
  return codesPostaux;
};
const distanceKm = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * rad / 2), y = Math.sin((b[1] - a[1]) * rad / 2);
  return 2 * R * Math.asin(Math.sqrt(x * x + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * y * y));
};

// Sites et matières : liste à jour de NewTonne (GET /api/devis/sites/, gardée 10 minutes).
// Secours si NewTonne ne répond pas : les 4 sites connus et les prix de la page Tarifs.
const SITES_SECOURS = [
  { code: "BRAIVES", name: "Recymo Braives", address: "Rue Roua 6, 4260 Braives", postal_code: "4260" },
  { code: "FOSSES", name: "Fosses-la-Ville (WT026437)", address: "Rue Adelin Beguin, 5070 Fosses-la-Ville", postal_code: "5070" },
  { code: "SAMBREVILLE", name: "Sambreville (WT050579)", address: "Rue de la Larronnerie, 5060 Sambreville", postal_code: "5060" },
  { code: "TRANSINNES", name: "Transinnes (WT011403)", address: "Grand Route, 6890 Libin", postal_code: "6890" }
];
let sitesCache = { lu: 0, duree: 0, sites: null, source: null };
const chargerSites = async () => {
  if (sitesCache.sites && Date.now() - sitesCache.lu < sitesCache.duree) return sitesCache;
  if (NEWTONNE_ACTIF) {
    try {
      const { status, data } = await appelNewtonne("GET", "/api/devis/sites/");
      if (status === 200 && Array.isArray(data.sites) && data.sites.length) {
        sitesCache = { lu: Date.now(), duree: 600000, source: "newtonne", sites: data.sites.map((x) => ({
          code: String(x.code), name: String(x.name || x.code), address: String(x.address || ""), postal_code: String(x.postal_code || ""),
          materials: (Array.isArray(x.materials) ? x.materials : []).map((m) => ({
            code: String(m.code), name: String(m.name || m.code), operation: m.operation === "retrait" ? "retrait" : "depot",
            prix: m.price_on_request || m.price_excl_vat == null ? null : Number(m.price_excl_vat)
          }))
        })) };
        return sitesCache;
      }
    } catch (e) { console.error("Sites NewTonne :", e.message); }
  }
  const prix = await chargerPrix();
  const sites = SITES_SECOURS.map((x) => ({ ...x, materials: [] }));
  for (const code of Object.keys(MATIERES_NEWTONNE)) {
    const m = matiere(code);
    const site = sites.find((x) => x.code === m.site);
    if (site) site.materials.push({ code: m.newtonne, name: robot.libelle(code, "fr"), operation: m.operation, prix: prixUnitaire(prix[code]) });
  }
  sitesCache = { lu: Date.now(), duree: 60000, source: "secours", sites };
  return sitesCache;
};
const nomCourt = (n) => String(n).replace(/^Recymo\s+/i, "").replace(/\s*\(.*\)\s*$/, "").trim();

// Outils donnés au robot : sites triés par distance du chantier, communes, codes NewTonne
const preparerOutils = async () => {
  const { sites } = await chargerSites();
  const cps = await chargerCodesPostaux();
  return {
    commune: (cp) => (cps[cp] ? cps[cp][2] : null),
    newtonne: (code) => { const m = matiere(code); return m ? { code: m.newtonne, operation: m.operation } : null; },
    sitesPour: (cp) => sites.map((x) => {
      const a = cps[cp], b = cps[x.postal_code];
      return {
        code: x.code, nom: nomCourt(x.name), adresse: x.address,
        km: a && b ? Math.max(1, Math.round(distanceKm(a, b))) : null,
        accepte: (code, op) => x.materials.some((m) => m.code === code && m.operation === op),
        terres: x.materials.filter((m) => /^TERRE/i.test(m.code) && m.operation === "depot").map((m) => ({ code: m.code, nom: m.name }))
      };
    }).sort((p, q) => (p.km == null ? 1e9 : p.km) - (q.km == null ? 1e9 : q.km))
  };
};

// Carte récapitulative : prix indicatifs du site choisi (NewTonne), calculés ici, jamais par le robot
const construireRecap = async (c) => {
  const { sites } = await chargerSites();
  const prixSecours = await chargerPrix();
  const r = robot.resume(c.robot);
  const site = sites.find((x) => x.code === r.site);
  let total = 0, aConvenir = false;
  const lignes = r.lignes.map((l) => {
    const m = l.code ? matiere(l.code) : null;
    const code = l.nt || (m && m.newtonne), operation = m ? m.operation : "depot";
    const mat = site && site.materials.find((x) => x.code === code && x.operation === operation);
    const pu = mat ? mat.prix : l.code ? prixUnitaire(prixSecours[l.code]) : null;
    const supplement = operation === "retrait" || !/^TERRE/i.test(code) ? (l.quantite < 5 ? SUPPLEMENT_PETIT : 0) : 0;
    const montant = pu === null ? null : Math.round((pu * l.quantite + supplement) * 100) / 100;
    if (montant === null) aConvenir = true; else total += montant;
    return { code, libelle: robot.nomLigne(l, c.langue), quantite: l.quantite, prixUnitaire: pu, supplement, montant, note: l.note };
  });
  total = Math.round(total * 100) / 100;
  return {
    lignes, site: r.siteNom, siteAdresse: site ? site.address : null,
    chantier: r.chantier ? [r.chantier.rue, r.chantier.cp + " " + r.chantier.commune].filter(Boolean).join(", ") : null,
    profil: r.profil, coordonnees: r.coordonnees, facturation: r.facturation,
    libre: r.libre, analyse: r.analyse, totalHtva: total, totalTvac: Math.round(total * 121) / 100, aConvenir
  };
};

const texteRecap = (rc) => [
  ...rc.lignes.map((l) => `- ${l.code} ${l.libelle} : ${String(l.quantite).replace(".", ",")} t` +
    (l.montant === null ? " (prix à convenir)" : ` = ${euros(l.montant)} HTVA${l.supplement ? " (supplément moins de 5 t compris)" : ""}`) + (l.note ? ` [${l.note}]` : "")),
  rc.lignes.length ? `Total indicatif : ${euros(rc.totalHtva)} HTVA${rc.aConvenir ? " + lignes à convenir" : ""}.` : "",
  rc.site ? "Site : " + rc.site + (rc.chantier ? " · chantier : " + rc.chantier : "") : "",
  rc.libre ? "Demande écrite par le client : " + rc.libre : ""
].filter(Boolean).join("\n");

const versNewtonneChat = (c) => {
  const r = robot.resume(c.robot);
  const co = r.coordonnees || {}, fa = r.facturation || {}, ch = r.chantier || {};
  const entreprise = r.profil === "entreprise";
  const recapMsg = [...c.messages].reverse().find((m) => m.recap);
  const resume = [
    (c.langue === "nl" ? "[NL] Client néerlandophone : répondre en néerlandais. " : "") + "Demande faite avec le chat de recymo.be, récapitulatif accepté par le client.",
    entreprise ? "Client : entreprise" + (fa.tva && fa.tvaValide === false ? " — attention, numéro de TVA invalide (contrôle modulo 97)." : ".") : "Client : particulier (paiement avant le code de passage).",
    r.libre ? "Le robot n'a pas reconnu la matière : lignes à compléter. Demande du client : « " + r.libre + " »" : "",
    recapMsg ? texteRecap(recapMsg.recap) : "",
    r.analyse ? "Le client annonce une analyse de terres (RQT/CCQT) : à recevoir par e-mail (info@recymo.be) ou par le formulaire." : ""
  ].filter(Boolean).join("\n");
  return {
    external_id: "recymo-" + c.id,
    status: "a_valider",
    contact: {
      name: co.nom || "", company: entreprise ? co.societe || "" : "", email: co.email || "", billing_email: entreprise ? fa.emailFactures || "" : "",
      phone: co.telephone || "", vat_number: entreprise ? fa.tva || "" : "", is_private: !entreprise,
      address: fa.adresse || "", postal_code: fa.cp || "", city: fa.localite || "", country: fa.pays || "BE"
    },
    ...(r.site ? { site: r.site } : {}),
    ...(ch.cp ? { job_site: [ch.rue, ch.cp + " " + (ch.commune || "")].filter(Boolean).join(", ").trim(), job_site_postal_code: ch.cp } : {}),
    summary: resume,
    messages: c.messages.slice(-500).map((m) => ({
      role: m.role === "client" ? "client" : m.role === "equipe" ? "humain" : "ia",
      text: (m.texte || "") + (m.recap ? "\n" + texteRecap(m.recap) : ""), at: m.at
    })),
    lines: r.lignes.map((l) => {
      const m = l.code ? matiere(l.code) : null;
      return { material_code: l.nt || m.newtonne, operation: m ? m.operation : "depot", quantity: String(l.quantite) };
    })
  };
};

// Conversations en mémoire, sauvegardées dans le dépôt des données peu après chaque changement
const chats = new Map();
let indexChats = null;
const chargerIndexChats = async () => {
  if (!indexChats) {
    const txt = await lireTexte(DATA_REPO, "chats/index.json").catch(() => null);
    indexChats = txt ? JSON.parse(txt) : [];
  }
  return indexChats;
};
const chargerChat = async (id) => {
  if (!/^[\w-]{20,40}$/.test(id)) return null;
  if (chats.has(id)) return chats.get(id);
  const txt = await lireTexte(DATA_REPO, `chats/${id}.json`).catch(() => null);
  if (!txt) return null;
  const c = JSON.parse(txt);
  chats.set(id, c);
  return c;
};
const aSauver = new Set();
let minuterieChats = null;
const sauverChats = async () => {
  clearTimeout(minuterieChats); minuterieChats = null;
  if (!aSauver.size) return;
  const ids = [...aSauver]; aSauver.clear();
  const index = await chargerIndexChats();
  const fichiers = {};
  for (const id of ids) {
    const c = chats.get(id);
    if (!c) continue;
    fichiers[`chats/${id}.json`] = JSON.stringify(c, null, 1);
    const e = index.find((x) => x.id === id);
    const ligne = { id, cree: c.cree, maj: c.maj, statut: (c.newtonne && c.newtonne.statut) || "brouillon" };
    if (e) Object.assign(e, ligne); else index.unshift(ligne);
  }
  fichiers["chats/index.json"] = JSON.stringify(index, null, 1);
  try { await commit(DATA_REPO, fichiers, "Chat : " + ids.length + " conversation" + (ids.length > 1 ? "s" : "")); }
  catch (e) { ids.forEach((id) => aSauver.add(id)); console.error("Sauvegarde des chats :", e.message); }
};
const marquerChat = (c, immediat) => {
  c.maj = new Date().toISOString();
  aSauver.add(c.id);
  if (immediat) return sauverChats();
  if (!minuterieChats) minuterieChats = setTimeout(sauverChats, 15000);
};

const envoyerChatNewtonne = async (c) => {
  const n = c.newtonne || (c.newtonne = { statut: "a_envoyer", essais: 0 });
  n.essais = (n.essais || 0) + 1;
  try {
    const { status, data } = await appelNewtonne("POST", "/api/devis/", versNewtonneChat(c));
    if (status === 200 || status === 201) {
      Object.assign(n, { statut: "envoye", transmis: true, envoyeLe: new Date().toISOString(), id: data.id || n.id || null, erreur: null, essais: 0 });
      return true;
    }
    if (status === 409) { if (!["valide", "refuse"].includes(n.statut)) n.statut = "envoye"; n.erreur = null; return true; }
    n.statut = "echec"; n.erreur = `NewTonne ${status} : ${String(data.error || "").slice(0, 200)}`;
  } catch (e) { n.statut = "echec"; n.erreur = "NewTonne injoignable : " + String(e.message).slice(0, 150); }
  console.error("Envoi chat NewTonne", c.id.slice(0, 6), n.erreur);
  return false;
};

// Lien signé vers le PDF du devis validé (servi par ce serveur : le lien NewTonne demande la clé)
const lienPdfChat = (c) => {
  const exp = Math.floor(Date.now() / 1000) + 90 * 86400;
  return `${URL_PUBLIQUE}/chat/pdf?id=${c.id}&exp=${exp}&sig=${signerLien("chat-pdf:" + c.id, exp)}`;
};
const dateCourte = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const TEXTES_CHAT = {
  fr: {
    valide: (n, prive) => prive ? `✅ Votre devis ${n.numero || ""} est validé : ${euros(n.totalTvac)} TVAC.` : `✅ Votre devis ${n.numero || ""} est validé : ${euros(n.totalHtva)} HTVA (${euros(n.totalTvac)} TVAC).`,
    code: (a) => `🔑 Votre code de passage : ${a.code}, valable jusqu'au ${dateCourte(a.valid_until)}` +
      (a.sites && a.sites.length ? " à " + a.sites.map((x) => `${x.name}${x.address ? " (" + x.address + ")" : ""}`).join(", ") : "") +
      (a.operations && a.operations.length ? ", pour " + a.operations.map((o) => (o === "retrait" ? "les enlèvements" : "les dépôts")).join(" et ") : "") +
      ". Donnez-le à vos chauffeurs : ils le tapent sur la borne à l'entrée du site.",
    paiement: "💳 Le paiement se fait à l'accueil du site (paiement en ligne bientôt). Dès qu'il est enregistré, votre code de passage apparaîtra ici.",
    paye: "🔑 Paiement reçu, merci !",
    pdf: "Télécharger le devis (PDF)",
    refus: (n) => "Nous ne pouvons malheureusement pas donner suite à votre demande." + (n.motif ? " Motif : " + n.motif : ""),
    suite: "Pour toute question, appelez-nous au 085 21 74 45."
  },
  nl: {
    valide: (n, prive) => prive ? `✅ Uw offerte ${n.numero || ""} is goedgekeurd: ${euros(n.totalTvac)} incl. btw.` : `✅ Uw offerte ${n.numero || ""} is goedgekeurd: ${euros(n.totalHtva)} excl. btw (${euros(n.totalTvac)} incl. btw).`,
    code: (a) => `🔑 Uw toegangscode: ${a.code}, geldig tot ${dateCourte(a.valid_until)}` +
      (a.sites && a.sites.length ? " in " + a.sites.map((x) => `${x.name}${x.address ? " (" + x.address + ")" : ""}`).join(", ") : "") +
      (a.operations && a.operations.length ? ", voor " + a.operations.map((o) => (o === "retrait" ? "afhalingen" : "stortingen")).join(" en ") : "") +
      ". Geef hem aan uw chauffeurs: ze tikken hem in op de zuil aan de ingang van de site.",
    paiement: "💳 U betaalt aan het onthaal van de site (online betalen binnenkort). Zodra de betaling geregistreerd is, verschijnt uw toegangscode hier.",
    paye: "🔑 Betaling ontvangen, bedankt!",
    pdf: "Offerte downloaden (pdf)",
    refus: (n) => "Helaas kunnen we niet ingaan op uw aanvraag." + (n.motif ? " Reden: " + n.motif : ""),
    suite: "Voor vragen kunt u ons bellen op 085 21 74 45."
  }
};
// Le code de passage n'est jamais écrit dans les journaux : seulement dans la conversation (dépôt privé)
const deciderChat = async (c, dec) => {
  const n = c.newtonne || (c.newtonne = { essais: 0 });
  const acces = dec.access_code && dec.access_code.code ? dec.access_code : null;
  const cle = [dec.status, dec.payment_status || "", acces ? acces.code : ""].join("|");
  if (n.statut === dec.status && n.annonce && n.cleAnnonce === cle) return false; // rien de nouveau
  const dejaValide = n.statut === "valide" && !!n.annonce;
  const prive = !!dec.payment_required;
  Object.assign(n, {
    statut: dec.status, numero: dec.number || n.numero || null, totalHtva: dec.total_excl_vat || null, totalTvac: dec.total_incl_vat || null,
    decideLe: dec.decided_at || n.decideLe || new Date().toISOString(), decidePar: dec.decided_by || null, motif: dec.refusal_reason || null, erreur: null,
    pdf: !!dec.pdf_url, client: dec.customer ? { code: dec.customer.code, nom: dec.customer.name } : n.client || null,
    paiement: dec.payment_required ? dec.payment_status || "en_attente" : null, validJusqua: dec.valid_until || null,
    acces: acces ? { code: acces.code, valid_until: acces.valid_until, sites: acces.sites || [], operations: acces.operations || [] } : null
  });
  if (dec.status !== "abandonne") {
    const t = TEXTES_CHAT[c.langue] || TEXTES_CHAT.fr;
    let texte;
    if (dec.status === "valide" && dejaValide) {
      // Deuxième notification (paiement enregistré) : seulement le code
      texte = acces ? [t.paye, t.code(acces)].join("\n\n") : null;
    } else if (dec.status === "valide") {
      texte = [t.valide(n, prive), acces ? t.code(acces) : prive ? t.paiement : "", dec.message_to_client || "", t.suite].filter(Boolean).join("\n\n");
    } else {
      texte = [t.refus(n), dec.message_to_client || "", t.suite].filter(Boolean).join("\n\n");
    }
    if (texte) c.messages.push({ role: "equipe", texte, at: new Date().toISOString(), ...(dec.status === "valide" && dec.pdf_url && !dejaValide ? { pdf: true } : {}) });
    n.annonce = n.annonce || new Date().toISOString();
  }
  n.cleAnnonce = cle;
  diffuserChat(c); // tout de suite aux pages ouvertes, avant l'enregistrement
  await marquerChat(c, true);
  return true;
};

// Flux en direct (Server-Sent Events) : les pages ouvertes sur une conversation reçoivent chaque changement
const abonnes = new Map(); // id de conversation → ensemble de réponses HTTP ouvertes
const diffuserChat = (c) => {
  const liste = abonnes.get(c.id);
  if (!liste || !liste.size) return;
  const message = "event: maj\ndata: " + JSON.stringify(chatPublic(c)) + "\n\n";
  for (const res of liste) { try { res.write(message); } catch {} }
};
setInterval(() => { for (const liste of abonnes.values()) for (const res of liste) { try { res.write(": ping\n\n"); } catch {} } }, 20000).unref();

const chatPublic = (c) => {
  const n = c.newtonne;
  const dernier = c.messages.length - 1;
  return {
    id: c.id, langue: c.langue,
    statut: n && ["valide", "refuse"].includes(n.statut) ? n.statut : c.robot && c.robot.etape === "envoye" ? "envoye" : "en_cours",
    messages: c.messages.map((m, i) => ({
      role: m.role, texte: m.texte, at: m.at,
      ...(m.recap ? { recap: m.recap } : {}),
      // Les boutons et les cases ne sont actifs que sur le dernier message du robot
      ...(i === dernier && m.role === "ia" ? { boutons: m.boutons || [], champ: m.champ || null, valeurs: m.valeurs || null } : {}),
      ...(m.pdf ? { pdf: lienPdfChat(c), pdfTexte: (TEXTES_CHAT[c.langue] || TEXTES_CHAT.fr).pdf } : {})
    }))
  };
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
  "GET /sante": async () => ({
    ok: true, mode: LOCAL ? "local" : "github", code: !!ADMIN_CODE,
    newtonne: NEWTONNE_ACTIF, decisions: !!NEWTONNE_SECRET, email: !!(BREVO_CLE && EMAIL_EXPEDITEUR), sms: !!(BREVO_CLE && SMS_EXPEDITEUR), chat: true
  }),

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
      langue: d.langue === "nl" ? "nl" : "fr",
      lignes: lignesValides(d.lignes)
    };
    if (NEWTONNE_ACTIF) demande.newtonne = { statut: "a_envoyer", essais: 0 };
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
    majDemandes = Date.now();
    fichiers["demandes/index.json"] = JSON.stringify(liste, null, 1);
    await commit(DATA_REPO, fichiers, "Nouvelle demande");
    await compter("demande", req);
    // Transmission à NewTonne après la réponse au client (en cas d'échec : nouvel essai par la tâche de fond)
    if (NEWTONNE_ACTIF) {
      envoyerNewtonne(demande).then(() => sauverDemandes("Demande transmise à NewTonne")).catch((e) => console.error("NewTonne :", e.message));
    }
    return { ok: true };
  },

  // Document joint à une demande, ouvert depuis NewTonne par un lien signé
  "GET /document": async (req, url, res) => {
    const chemin = String(url.searchParams.get("c") || "");
    const exp = String(url.searchParams.get("exp") || "");
    const sig = Buffer.from(String(url.searchParams.get("sig") || ""));
    if (!LIENS_SECRET || !/^demandes\/(photos|fichiers)\/[\w.-]+$/.test(chemin) || !/^\d+$/.test(exp) || +exp < Date.now() / 1000) {
      throw Object.assign(new Error("Lien invalide ou expiré."), { status: 403 });
    }
    const attendu = Buffer.from(signerLien(chemin, exp));
    if (attendu.length !== sig.length || !crypto.timingSafeEqual(attendu, sig)) throw Object.assign(new Error("Lien invalide ou expiré."), { status: 403 });
    const buf = await lire(DATA_REPO, chemin);
    if (!buf) throw Object.assign(new Error("Introuvable"), { status: 404 });
    const type = chemin.endsWith(".pdf") ? "application/pdf" : chemin.endsWith(".png") ? "image/png" : chemin.endsWith(".webp") ? "image/webp" : "image/jpeg";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline; filename=\"" + chemin.split("/").pop() + "\"" });
    res.end(buf);
    return undefined;
  },

  // Décision prise dans NewTonne (message signé « devis.decision »)
  "POST /newtonne/decision": async (req, url, res) => {
    const brut = await lireBrut(req, 512 * 1024);
    if (!signatureValide(brut, req.headers["x-newtonne-timestamp"], req.headers["x-newtonne-signature"])) {
      throw Object.assign(new Error("Signature refusée."), { status: 401 });
    }
    let dec;
    try { dec = JSON.parse(brut.toString("utf8")); } catch { throw Object.assign(new Error("JSON invalide."), { status: 400 }); }
    // Réponse immédiate (NewTonne attend 10 secondes au plus), traitement ensuite
    envoyer(res, 200, { ok: true });
    traiterDecision(dec).catch((e) => console.error("Décision NewTonne :", e.message));
    return undefined;
  },

  // Chat : message, bouton, nombre ou coordonnées du client → réponse du robot (crée la conversation si besoin)
  "POST /chat": async (req) => {
    const ip = ipDe(req);
    if (!limite("chat:" + ip, 40, 10 * 60000) || !limite("chat-jour:" + ip, 300, 86400000)) {
      throw Object.assign(new Error("Trop de messages. Réessayez plus tard ou appelez-nous au 085 21 74 45."), { status: 429 });
    }
    let d = {};
    try { d = JSON.parse(await lireCorps(req, 8000)); } catch {}
    let c = d.id ? await chargerChat(String(d.id)) : null;
    if (d.id && !c) throw Object.assign(new Error("Conversation introuvable."), { status: 404 });
    const maintenant = () => new Date().toISOString();
    if (!c) {
      c = { id: crypto.randomBytes(18).toString("base64url"), cree: maintenant(), maj: null, langue: d.langue === "nl" ? "nl" : "fr", messages: [] };
      const accueil = robot.repondre(c, {}, await preparerOutils());
      c.messages.push({ role: "ia", texte: accueil.texte, at: maintenant(), boutons: accueil.boutons, champ: accueil.champ });
      chats.set(c.id, c);
    }
    // Ce que le client a fait : seul ce que propose le dernier message du robot est accepté
    const dernier = [...c.messages].reverse().find((m) => m.role === "ia") || {};
    const t = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
    let entree = null, affiche = "";
    if (d.bouton != null) {
      const btn = (dernier.boutons || []).find((x) => x.v === String(d.bouton));
      if (btn) { entree = { bouton: btn.v }; affiche = btn.l; }
    } else if (d.chantier && dernier.champ === "chantier") {
      const k = { cp: t(d.chantier.cp, 4), rue: t(d.chantier.rue, 160) };
      entree = { chantier: k };
      affiche = [k.rue, k.cp].filter(Boolean).join(", ");
    } else if (d.coordonnees && dernier.champ === "coordonnees") {
      const k = { societe: t(d.coordonnees.societe, 120), nom: t(d.coordonnees.nom, 120), email: t(d.coordonnees.email, 160), telephone: t(d.coordonnees.telephone, 40) };
      entree = { coordonnees: k };
      affiche = [k.societe, k.nom, k.email, k.telephone].filter(Boolean).join(" · ");
    } else if (d.facturation && dernier.champ === "facturation") {
      const k = { adresse: t(d.facturation.adresse, 160), cp: t(d.facturation.cp, 10), localite: t(d.facturation.localite, 80), pays: t(d.facturation.pays, 2),
        tva: t(d.facturation.tva, 30), emailFactures: t(d.facturation.emailFactures, 160) };
      entree = { facturation: k };
      affiche = [k.adresse, [k.cp, k.localite].filter(Boolean).join(" "), k.pays, k.tva && "TVA " + k.tva, k.emailFactures].filter(Boolean).join(" · ");
    } else if (d.nombre != null && dernier.champ === "nombre") {
      entree = { nombre: t(d.nombre, 20) };
      affiche = t(d.nombre, 20).replace(".", ",") + " t";
    } else if (t(d.message, 2000)) {
      entree = { texte: t(d.message, 2000) };
      affiche = entree.texte;
    }
    if (!entree || !affiche) return chatPublic(c); // rien à traiter (ouverture, ou bouton périmé)
    if (c.messages.filter((m) => m.role === "client").length >= MAX_MESSAGES_CLIENT) {
      throw Object.assign(new Error("Cette conversation est terminée. Appelez-nous au 085 21 74 45."), { status: 429 });
    }
    c.messages.push({ role: "client", texte: affiche, at: maintenant() });
    const rep = robot.repondre(c, entree, await preparerOutils());
    if (rep.texte) {
      const msg = { role: "ia", texte: rep.texte, at: maintenant(), boutons: rep.boutons || [], champ: rep.champ || null, ...(rep.valeurs ? { valeurs: rep.valeurs } : {}) };
      if (rep.recap) msg.recap = await construireRecap(c);
      c.messages.push(msg);
    }
    // Envoi dans NewTonne au clic sur « Oui », puis mise à jour si le client ajoute un message avant la décision
    const n = c.newtonne;
    const decide = n && ["valide", "refuse", "abandonne"].includes(n.statut);
    if (rep.envoyer || (n && n.transmis && !decide)) {
      if (NEWTONNE_ACTIF) await envoyerChatNewtonne(c);
      else c.newtonne = Object.assign(c.newtonne || {}, { statut: "echec", essais: 0, erreur: "NewTonne n'est pas configuré" });
    }
    await marquerChat(c, !!rep.envoyer);
    diffuserChat(c); // autres onglets ouverts sur la même conversation
    return chatPublic(c);
  },

  // Chat : flux en direct d'une conversation (la réponse de l'équipe arrive sans recharger la page)
  "GET /chat/flux": async (req, url, res) => {
    const c = await chargerChat(String(url.searchParams.get("id") || ""));
    if (!c) throw Object.assign(new Error("Conversation introuvable."), { status: 404 });
    if (!limite("flux:" + ipDe(req), 60, 10 * 60000)) throw Object.assign(new Error("Trop de connexions."), { status: 429 });
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 5000\n\n");
    res.write("event: maj\ndata: " + JSON.stringify(chatPublic(c)) + "\n\n");
    if (!abonnes.has(c.id)) abonnes.set(c.id, new Set());
    const liste = abonnes.get(c.id);
    // Au plus 5 onglets ouverts par conversation
    if (liste.size >= 5) { const ancien = liste.values().next().value; liste.delete(ancien); try { ancien.end(); } catch {} }
    liste.add(res);
    req.on("close", () => { liste.delete(res); if (!liste.size) abonnes.delete(c.id); });
    return undefined;
  },

  // Chat : relire la conversation (secours si le flux en direct est coupé)
  "GET /chat": async (req, url) => {
    const c = await chargerChat(String(url.searchParams.get("id") || ""));
    if (!c) throw Object.assign(new Error("Conversation introuvable."), { status: 404 });
    return chatPublic(c);
  },

  // Chat : PDF du devis validé, téléchargé chez NewTonne avec la clé du serveur
  "GET /chat/pdf": async (req, url, res) => {
    const id = String(url.searchParams.get("id") || ""), exp = String(url.searchParams.get("exp") || "");
    const sig = Buffer.from(String(url.searchParams.get("sig") || ""));
    if (!/^\d+$/.test(exp) || +exp < Date.now() / 1000 || !LIENS_SECRET) throw Object.assign(new Error("Lien invalide ou expiré."), { status: 403 });
    const attendu = Buffer.from(signerLien("chat-pdf:" + id, exp));
    if (attendu.length !== sig.length || !crypto.timingSafeEqual(attendu, sig)) throw Object.assign(new Error("Lien invalide ou expiré."), { status: 403 });
    const c = await chargerChat(id);
    if (!c || !c.newtonne || c.newtonne.statut !== "valide" || !NEWTONNE_ACTIF) throw Object.assign(new Error("Devis introuvable."), { status: 404 });
    const r = await fetch(`${NEWTONNE_URL}/api/devis/${encodeURIComponent("recymo-" + id)}/pdf/`, { headers: { Authorization: "Bearer " + NEWTONNE_CLE }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw Object.assign(new Error("PDF indisponible pour le moment."), { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${(c.newtonne.numero || "devis").replace(/[^\w-]/g, "")}.pdf"`,
      "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" });
    res.end(buf);
    return undefined;
  },

  // Admin : envoyer (ou renvoyer) une demande à NewTonne
  "POST /admin/newtonne/envoyer": async (req) => {
    if (!NEWTONNE_ACTIF) throw Object.assign(new Error("NewTonne n'est pas configuré sur le serveur."), { status: 400 });
    const { id } = JSON.parse(await lireCorps(req, 1000));
    const d = (await chargerDemandes()).find((x) => x.id === id);
    if (!d) throw Object.assign(new Error("Demande introuvable."), { status: 404 });
    d.newtonne = Object.assign(d.newtonne || {}, { statut: "a_envoyer", essais: 0 });
    const ok = await envoyerNewtonne(d);
    await sauverDemandes("Demande renvoyée à NewTonne");
    if (!ok) throw Object.assign(new Error(d.newtonne.erreur || "Échec de l'envoi."), { status: 502 });
    return { ok: true, newtonne: d.newtonne };
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

  // Admin : « quoi de neuf ? » pour la liste des demandes (appelée toutes les 3 secondes quand le panneau est ouvert)
  "GET /admin/demandes/version": async (req, url, res) => {
    if (!limite("version:" + ipDe(req), 60, 60000)) throw Object.assign(new Error("Trop d'appels."), { status: 429 });
    res.setHeader("Cache-Control", "no-store");
    const liste = await chargerDemandes();
    return { v: liste.length + ":" + majDemandes };
  },

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
  process.on(sig, async () => { await Promise.all([sauverStats().catch(() => {}), sauverChats().catch(() => {})]); process.exit(0); });
}
