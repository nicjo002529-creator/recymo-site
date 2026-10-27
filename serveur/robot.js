// Robot de devis à règles (sans IA). Ordre des questions : quoi (matière et détails) → combien (tonnes)
// → où (code postal du chantier, site le plus proche) → qui (entreprise ou particulier, coordonnées)
// → facturation (adresse, TVA) → récapitulatif. Le devis part dans NewTonne seulement quand le client
// clique sur « Oui, j'envoie ma demande ». Module remplaçable : une seule fonction, repondre().
//
// repondre(conversation, entree, outils)
//   entree : { texte } | { bouton } | { nombre } | { chantier: { cp, rue } } | { coordonnees: {…} } | { facturation: {…} }
//   outils (fournis par le serveur) : sitesPour(cp) → sites triés du plus proche [{ code, nom, adresse, km, accepte(code, op), terres }],
//                                     commune(cp) → nom ou null, newtonne(codeInterne) → { code, operation }
//   réponse : { texte, boutons: [{ v, l }], champ, valeurs, recap, envoyer }
// L'état est gardé dans conversation.robot. Les prix ne sont jamais écrits ici : le serveur les calcule.
"use strict";

/* ----------------------------------------------------------------- Catalogue */
// Code interne (celui de l'estimateur du site) → libellés FR / NL. Le code NewTonne vient du serveur.
const LIBELLES = {
  B0: ["Béton non armé, propre, sans terre ni fines (max 50 × 50 × 150 cm)", "Ongewapend beton, zuiver, zonder grond of fijne fractie (max. 50 × 50 × 150 cm)"],
  B1: ["Béton légèrement armé, ou hors dimensions, ou avec fines", "Licht gewapend beton, of buiten afmetingen, of met fijne fractie"],
  B2: ["Béton légèrement armé et/ou légèrement terreux", "Licht gewapend en/of licht grondhoudend beton"],
  B3: ["Béton fortement armé et/ou fortement terreux", "Sterk gewapend en/of sterk grondhoudend beton"],
  B4: ["Béton-tarmac terreux", "Grondhoudend beton-asfalt"],
  B5: ["Béton très fortement armé, sale ou terreux", "Zeer sterk gewapend, vuil of grondhoudend beton"],
  B6: ["Petites pierrailles terreuses", "Kleine grondhoudende steenslag"],
  POT: ["Poteaux, hourdis, piquets et dalles de clôture", "Palen, welfsels, paaltjes en afsluitplaten"],
  BR0: ["Bricaillons propres, sans fines et sans terre", "Zuiver metselpuin, zonder fijne fractie en zonder grond"],
  BR1: ["Bricaillons propres", "Zuiver metselpuin"],
  BR2: ["Bricaillons légèrement sales ou terreux", "Licht vervuild of licht grondhoudend metselpuin"],
  BR4: ["Bricaillons très sales ou très terreux", "Sterk vervuild of sterk grondhoudend metselpuin"],
  BR7: ["Déchets classe 3 en mélange", "Gemengd klasse 3-afval"],
  BR8: ["Ardoises naturelles", "Natuurleien"],
  BR9: ["Carrelages", "Tegels"],
  YT: ["Béton cellulaire (Ytong…)", "Cellenbeton (Ytong…)"],
  TA: ["Tarmac bitumineux", "Bitumineus asfalt"],
  BT: ["Béton avec tarmac", "Beton met asfalt"],
  "T-BR": ["Terres type I à V avec analyse (RQT, CCQT), petits versages", "Grond type I tot V met analyse (RQT, CCQT), kleine stortingen"],
  "T-FO": ["Terres type I et II, sans analyse", "Grond type I en II, zonder analyse"],
  "T-FO-AN": ["Terres type I et II, avec analyse (RQT, CCQT)", "Grond type I en II, met analyse (RQT, CCQT)"],
  "T-TR": ["Terres type I et II, sans analyse", "Grond type I en II, zonder analyse"],
  "T-TR-AN": ["Terres type I et II, avec analyse (RQT, CCQT)", "Grond type I en II, met analyse (RQT, CCQT)"],
  "T-SA-13": ["Terres type I à III, sans analyse (moins de 400 m³)", "Grond type I tot III, zonder analyse (minder dan 400 m³)"],
  "T-SA-45": ["Terres type IV à V, sans analyse (moins de 400 m³)", "Grond type IV tot V, zonder analyse (minder dan 400 m³)"],
  "T-SA-AN": ["Terres type I à V, avec analyse (RQT, CCQT)", "Grond type I tot V, met analyse (RQT, CCQT)"],
  "T-SA-INV": ["Terres avec plantes invasives (renouée du Japon…)", "Grond met invasieve planten (Japanse duizendknoop…)"],
  "T-SA-AM": ["Terres avec fibres d'amiante de 100 à 500 mg/kg MS", "Grond met asbestvezels van 100 tot 500 mg/kg DS"],
  "G-MIX": ["Granulat mixte 0/63", "Gemengd granulaat 0/63"],
  "G-TA32": ["Granulat tarmac 0/32", "Asfaltgranulaat 0/32"],
  "G-TA63": ["Granulat tarmac 0/63", "Asfaltgranulaat 0/63"],
  "G-BE32": ["Granulat béton 0/32", "Betongranulaat 0/32"],
  "G-BE60": ["Granulat béton 0/60", "Betongranulaat 0/60"],
  "G-BE2560": ["Granulat béton 25/60", "Betongranulaat 25/60"],
  "G-SAB": ["Sable jaune", "Geel zand"],
  "G-STAB": ["Stabiter 0/32", "Stabiter 0/32"]
};
const libelle = (code, langue) => (LIBELLES[code] || [code, code])[langue === "nl" ? 1 : 0];
const nomLigne = (l, langue) => (l.code ? libelle(l.code, langue) : l.nom || l.nt);
// Terres connues par site (codes internes) ; un nouveau site ajouté dans NewTonne propose ses terres telles quelles
const TERRES_SITE = { BRAIVES: ["T-BR"], FOSSES: ["T-FO", "T-FO-AN"], TRANSINNES: ["T-TR", "T-TR-AN"], SAMBREVILLE: ["T-SA-13", "T-SA-45", "T-SA-AN", "T-SA-INV", "T-SA-AM"] };
const FAMILLES_TERRE = ["terre", "invasives", "amiante"];

/* --------------------------------------------------------- Lecture du texte */
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’'`´]/g, " ").replace(/\s+/g, " ").trim();

// Ordre important : du plus précis au plus général
const FAMILLES = [
  ["invasives", /renouee|invasive|duizendknoop|invasieve|exoten/],
  ["amiante", /amiante|asbest/],
  ["ytong", /ytong|cellulaire|siporex|cellenbeton|gasbeton/],
  ["poteaux", /poteau|hourdi|piquet|cloture|welfsel|\bpalen\b|paaltje|afsluitpla/],
  ["ardoise", /ardoise|\bleien\b|\blei\b/],
  ["carrelage", /carrelage|faience|\btegel/],
  ["stabilise", /stabilis|stabiter|recystab/],
  ["sable", /\bsable|\bzand\b/],
  ["granulat", /granulat|granulaat|concasse|empierrement|gravier|recycle 0|\bmixte\b/],
  ["tarmac", /tarmac|asphalt|enrobe|bitum|asfalt/],
  ["brique", /brique|bricaillon|maconnerie|baksteen|bakstenen|metselpuin|\bpuin\b|gravat/],
  ["melange", /melange|en vrac|gemengd afval|bouwafval gemengd/],
  ["pierrailles", /pierraille|caillou/],
  ["terre", /\bterres?\b|deblai|\bgrond\b|aarde|uitgegraven/],
  ["beton", /beton/]
];
const ACHAT = /achet|acquer|besoin d|livr|\bprendre\b|commander|recuperer du|\bkopen\b|\bkoop\b|nodig|leveren|bestellen/;
const DEPOT = /jeter|depos|evacu|verser|debarrass|vider|\bstort|afvoer|wegdoen|kwijt|\bbrengen\b/;
const RE_TONNES = /(\d+(?:[.,]\d+)?)\s*(?:t\b|tonnes?\b|tonne\b|ton\b|tons\b)/;
const RE_M3 = /(\d+(?:[.,]\d+)?)\s*(?:m3|m³|m 3|metres? cubes?|mc\b|kub)/;
const nombre = (s) => { const n = parseFloat(String(s).replace(",", ".")); return n > 0 && n < 100000 ? Math.round(n * 1000) / 1000 : null; };
const t3 = (n) => String(n).replace(".", ",");

const analyser = (texte) => {
  const t = norm(texte);
  const operation = ACHAT.test(t) ? "retrait" : DEPOT.test(t) ? "depot" : null;
  const elements = [];
  for (const morceau of t.split(/\s(?:et|en|plus|ainsi que)\s|[,;+]/)) {
    const famille = (FAMILLES.find(([, re]) => re.test(morceau)) || [])[0] || null;
    const mt = morceau.match(RE_TONNES), mm = morceau.match(RE_M3);
    const quantite = mt ? nombre(mt[1]) : null, m3 = !mt && mm ? nombre(mm[1]) : null;
    if (famille) elements.push({ famille, quantite, m3, texte: morceau, rep: {} });
    else if ((quantite || m3) && elements.length && !elements[elements.length - 1].quantite) Object.assign(elements[elements.length - 1], { quantite, m3 });
  }
  if (elements.length === 1 && !elements[0].quantite) {
    const mt = t.match(RE_TONNES), mm = t.match(RE_M3);
    if (mt) elements[0].quantite = nombre(mt[1]); else if (mm) elements[0].m3 = nombre(mm[1]);
  }
  const cp = t.match(/\b(\d{4})\b(?!\s*(?:t\b|tonnes?|ton\b|m3|m³|kg))/);
  return { operation, elements, cp: cp ? cp[1] : null, texte: t };
};

// Numéro de TVA belge : 10 chiffres, 97 - (8 premiers % 97) = 2 derniers
const tvaBelgeValide = (v) => {
  let n = String(v || "").toUpperCase().replace(/^BE/, "").replace(/\D/g, "");
  if (n.length === 9) n = "0" + n;
  if (!/^[01]\d{9}$/.test(n)) return false;
  return 97 - (Number(n.slice(0, 8)) % 97) === Number(n.slice(8));
};

/* ------------------------------------------------------------------- Textes */
const T = (r, fr, nl) => (r.langue === "nl" ? nl : fr);
const b = (r, v, fr, nl) => ({ v, l: T(r, fr, nl) });
const boutonsMatiere = (r) => [
  b(r, "m:beton", "Béton", "Beton"), b(r, "m:brique", "Briques", "Bakstenen"), b(r, "m:terre", "Terre", "Grond"),
  b(r, "m:tarmac", "Tarmac", "Asfalt"), b(r, "m:granulat", "Acheter des granulats", "Granulaten kopen"), b(r, "autre", "Autre demande", "Andere vraag")
];
const boutonsPlus = (r) => [b(r, "plus", "Ajouter une autre matière", "Nog een materiaal toevoegen"), b(r, "fini", "Non, c'est tout", "Nee, dat is alles")];
const boutonsModifier = (r) => [
  b(r, "matieres", "Les matières ou les quantités", "De materialen of hoeveelheden"), b(r, "chantier", "Le chantier ou le site", "De werf of de site"),
  b(r, "coordonnees", "Mes coordonnées", "Mijn gegevens"), b(r, "facturation", "La facturation", "De facturatie"), b(r, "recommencer", "Tout recommencer", "Alles opnieuw")];
const ACCUEIL = (r) => T(r,
  "Bonjour ! Je vous aide à préparer votre demande de devis. Que voulez-vous déposer ou acheter ? Écrivez-le (par exemple « 20 tonnes de béton à jeter ») ou choisissez ci-dessous.",
  "Hallo! Ik help u uw offerteaanvraag voor te bereiden. Wat wilt u storten of kopen? Schrijf het (bijvoorbeeld “20 ton beton storten”) of kies hieronder.");
const minuscule = (s) => s.charAt(0).toLowerCase() + s.slice(1);
// Localité seulement si le code postal n'en couvre qu'une (sinon le client l'écrit)
const communeUnique = (c) => (c && !/[,…]/.test(c) ? c : "");
const kmTexte = (s) => (s.km == null ? "" : ` (${s.km} km)`);

/* ------------------------------------------------- Questions par matière */
const q = (cle, texte, boutons) => ({ question: { cle, texte, boutons } });
const LIRE = {
  arme: (t) => /non arme|sans fer|pas arme|ongewapend|zonder (ijzer|wapening)|niet gewapend/.test(t) ? "non" : /un peu|legerement|peu arme|licht|beetje|weinig/.test(t) ? "peu" : /arme|\bfer|gewapend|wapening|ijzer/.test(t) ? "arme" : null,
  propre: (t) => /terre|terreu|grond|aarde|vuil|sale/.test(t) ? "terre" : /propre|zuiver|proper|schoon|net\b/.test(t) ? "propre" : null,
  brique: (t) => /tres (sale|terreu)|zeer (vuil|grondhoudend)|heel vuil/.test(t) ? "sale" : /un peu|legerement|licht/.test(t) ? "peu" : /tres propre|sans terre|zeer zuiver|zonder grond/.test(t) ? "tres" : /propre|zuiver|proper|schoon/.test(t) ? "propre" : /sale|terre|vuil|grond/.test(t) ? "peu" : null,
  tarmac: (t) => /terre|grond/.test(t) ? "b4" : /beton/.test(t) ? "bt" : /seul|alleen|tarmac|asfalt|asphalt/.test(t) ? "ta" : null,
  type12: (t) => /sais pas|weet niet/.test(t) ? "nsp" : /\bnon\b|\bnee\b|iii|iv|\bv\b|type 3|type 4|type 5/.test(t) ? "non" : /\boui\b|\bja\b|\bi\b|\bii\b|type 1|type 2/.test(t) ? "oui" : null,
  analyse: (t) => /\bnon\b|\bnee\b|pas d|geen/.test(t) ? "non" : /\boui\b|\bja\b|rqt|ccqt|analyse/.test(t) ? "oui" : null,
  braivesSans: (t) => /autre|ander/.test(t) ? "autre" : /fourni|envoie|bezorg|stuur|ok|oui|ja/.test(t) ? "continuer" : null,
  pollution: (t) => /amiante|asbest/.test(t) ? "am" : /invasive|renouee|duizendknoop/.test(t) ? "inv" : /\bnon\b|\bnee\b|aucun|geen/.test(t) ? "non" : null,
  typeSa: (t) => /sais pas|weet niet/.test(t) ? "nsp" : /iv|\bv\b|type 4|type 5/.test(t) ? "45" : /i a iii|i tot iii|type 1|type 2|type 3|\biii?\b/.test(t) ? "13" : null,
  granulat: (t) => /stabi/.test(t) ? "stab" : /sable|zand/.test(t) ? "sable" : /mixte|gemengd/.test(t) ? "mix" : /tarmac|asfalt|asphalt/.test(t) ? "tarmac" : /beton/.test(t) ? "beton" : null,
  calibreBe: (t) => /25.?60/.test(t) ? "2560" : /0.?60/.test(t) ? "060" : /0.?32/.test(t) ? "032" : null,
  calibreTa: (t) => /0.?63/.test(t) ? "063" : /0.?32/.test(t) ? "032" : null,
  stabilise: (t) => /recystab|ciment|cement/.test(t) ? "recystab" : /stabiter|gratuit|gratis/.test(t) ? "stab" : null
};

const pasEnVente = (r) => ({ info: T(r, "Nous ne vendons pas ce matériau. Nous vendons des granulats recyclés, du sable jaune et du Stabiter.", "Dit materiaal verkopen we niet. We verkopen gerecycleerde granulaten, geel zand en Stabiter.") });

const questions = {
  beton(r, e) {
    if (e.operation === "retrait") { e.famille = "granulat"; e.rep.granulat = "beton"; return questions.granulat(r, e); }
    if (!e.rep.arme) e.rep.arme = LIRE.arme(e.texte);
    if (!e.rep.arme) return q("arme", T(r, "Votre béton est-il armé (avec des fers) ?", "Is uw beton gewapend (met ijzer)?"),
      [b(r, "arme", "Armé", "Gewapend"), b(r, "non", "Non armé", "Ongewapend"), b(r, "peu", "Un peu", "Een beetje")]);
    if (!e.rep.propre) e.rep.propre = LIRE.propre(e.texte.replace(/beton/g, ""));
    if (!e.rep.propre) return q("propre", T(r, "Est-il propre, ou mélangé avec de la terre ?", "Is het zuiver, of vermengd met grond?"),
      [b(r, "propre", "Propre", "Zuiver"), b(r, "terre", "Avec de la terre", "Met grond")]);
    const { arme, propre } = e.rep;
    return { code: arme === "non" ? (propre === "propre" ? "B0" : "B2") : arme === "peu" ? (propre === "propre" ? "B1" : "B2") : (propre === "propre" ? "B3" : "B5") };
  },
  brique(r, e) {
    if (e.operation === "retrait") return pasEnVente(r);
    if (!e.rep.brique) e.rep.brique = LIRE.brique(e.texte.replace(/brique|bricaillon/g, ""));
    if (!e.rep.brique) return q("brique", T(r, "Vos briques sont-elles propres ?", "Zijn uw bakstenen zuiver?"), [
      b(r, "tres", "Très propres, sans terre ni poussière", "Heel zuiver, zonder grond of stof"), b(r, "propre", "Propres", "Zuiver"),
      b(r, "peu", "Un peu sales ou terreuses", "Licht vervuild of met wat grond"), b(r, "sale", "Très sales ou terreuses", "Sterk vervuild of met veel grond")]);
    return { code: { tres: "BR0", propre: "BR1", peu: "BR2", sale: "BR4" }[e.rep.brique] };
  },
  tarmac(r, e) {
    if (e.operation === "retrait") { e.famille = "granulat"; e.rep.granulat = "tarmac"; return questions.granulat(r, e); }
    if (!e.rep.tarmac && /beton/.test(e.texte)) e.rep.tarmac = /terre|grond/.test(e.texte) ? "b4" : "bt";
    if (!e.rep.tarmac) return q("tarmac", T(r, "S'agit-il de tarmac seul, ou de béton avec du tarmac ?", "Gaat het om asfalt alleen, of om beton met asfalt?"), [
      b(r, "ta", "Tarmac seul", "Alleen asfalt"), b(r, "bt", "Béton avec du tarmac", "Beton met asfalt"), b(r, "b4", "Béton-tarmac avec de la terre", "Beton-asfalt met grond")]);
    return { code: { ta: "TA", bt: "BT", b4: "B4" }[e.rep.tarmac] };
  },
  // Terres : le site est choisi avant (selon le code postal du chantier), les questions dépendent du site
  terre(r, e) {
    if (e.operation === "retrait") return pasEnVente(r);
    const site = r.site;
    if (!TERRES_SITE[site]) {
      // Site ajouté dans NewTonne : ses terres telles quelles
      const s = (r.candidats || []).find((x) => x.code === site) || {};
      const terres = s.terres || [];
      if (!terres.length) return { info: T(r, "Ce site n'accepte pas de terres pour le moment.", "Deze site aanvaardt momenteel geen grond.") };
      if (terres.length === 1) return { nt: terres[0].code, nom: terres[0].nom };
      if (!e.rep.terreNt) return q("terreNt", T(r, "Quelles terres apportez-vous ?", "Welke grond brengt u?"), terres.map((x) => ({ v: x.code, l: x.nom })));
      const x = terres.find((y) => y.code === e.rep.terreNt) || terres[0];
      return { nt: x.code, nom: x.nom };
    }
    if (site === "FOSSES" || site === "TRANSINNES") {
      if (!e.rep.type12) return q("type12", T(r, `${r.siteNom} accepte uniquement les terres de type I et II. Est-ce votre cas ?`, `${r.siteNom} aanvaardt enkel grond van type I en II. Is dat bij u het geval?`),
        [b(r, "oui", "Oui", "Ja"), b(r, "nsp", "Je ne sais pas", "Ik weet het niet"), b(r, "non", "Non, type III à V", "Nee, type III tot V")]);
      if (e.rep.type12 === "non") return { changerSite: ["SAMBREVILLE", "BRAIVES"], info: T(r, "Pour les terres de type III à V : Sambreville, ou Braives avec une analyse (RQT, CCQT).", "Voor grond van type III tot V: Sambreville, of Braives met analyse (RQT, CCQT).") };
      if (e.rep.type12 === "nsp") e.note = T(r, "type de terre à vérifier", "grondtype na te kijken");
    }
    if (site === "SAMBREVILLE") {
      if (!e.rep.pollution && (e.famille === "amiante" || /amiante|asbest/.test(e.texte))) e.rep.pollution = "am";
      if (!e.rep.pollution && (e.famille === "invasives" || /renouee|invasive|duizendknoop|invasieve/.test(e.texte))) e.rep.pollution = "inv";
      if (!e.rep.pollution) return q("pollution", T(r, "Vos terres contiennent-elles des plantes invasives (renouée du Japon…) ou de l'amiante ?", "Bevat uw grond invasieve planten (Japanse duizendknoop…) of asbest?"),
        [b(r, "non", "Non", "Nee"), b(r, "inv", "Plantes invasives", "Invasieve planten"), b(r, "am", "Amiante (100 à 500 mg/kg)", "Asbest (100 tot 500 mg/kg)")]);
      if (e.rep.pollution === "inv") return { code: "T-SA-INV" };
      if (e.rep.pollution === "am") return { code: "T-SA-AM" };
    }
    if (!e.rep.analyse) return q("analyse", T(r, "Avez-vous une analyse de vos terres (RQT / CCQT) ?", "Hebt u een analyse van uw grond (RQT / CCQT)?"),
      [b(r, "oui", "Oui, je la joins", "Ja, ik voeg ze toe"), b(r, "non", "Non", "Nee")]);
    if (e.rep.analyse === "oui") r.analyseAJoindre = true;
    if (site === "BRAIVES") {
      if (e.rep.analyse === "non" && !e.rep.braivesSans) return q("braivesSans", T(r, "À Braives, les terres sont acceptées uniquement avec une analyse (RQT, CCQT). Que préférez-vous ?",
        "In Braives wordt grond enkel aanvaard met een analyse (RQT, CCQT). Wat verkiest u?"), [b(r, "continuer", "Je fournirai l'analyse", "Ik bezorg de analyse"), b(r, "autre", "Choisir un autre site", "Een andere site kiezen")]);
      if (e.rep.braivesSans === "autre") return { changerSite: ["FOSSES", "TRANSINNES", "SAMBREVILLE"] };
      if (e.rep.braivesSans === "continuer") { r.analyseAJoindre = true; e.note = T(r, "analyse à fournir", "analyse te bezorgen"); }
      return { code: "T-BR" };
    }
    if (site === "SAMBREVILLE") {
      if (e.rep.analyse === "oui") return { code: "T-SA-AN" };
      if (!e.rep.typeSa) return q("typeSa", T(r, "Sans analyse : de quel type sont vos terres ?", "Zonder analyse: van welk type is uw grond?"),
        [b(r, "13", "Type I à III", "Type I tot III"), b(r, "45", "Type IV ou V", "Type IV of V"), b(r, "nsp", "Je ne sais pas", "Ik weet het niet")]);
      if (e.rep.typeSa === "nsp") e.note = T(r, "type de terre à vérifier", "grondtype na te kijken");
      return { code: e.rep.typeSa === "45" ? "T-SA-45" : "T-SA-13" };
    }
    return { code: (site === "FOSSES" ? "T-FO" : "T-TR") + (e.rep.analyse === "oui" ? "-AN" : "") };
  },
  invasives(r, e) { return questions.terre(r, e); },
  amiante(r, e) { return questions.terre(r, e); },
  granulat(r, e) {
    if (!e.rep.granulat) e.rep.granulat = LIRE.granulat(e.texte.replace(/granula\w*/g, ""));
    if (!e.rep.granulat) return q("granulat", T(r, "Quel granulat vous faut-il ?", "Welk granulaat hebt u nodig?"), [
      b(r, "mix", "Mixte 0/63", "Gemengd 0/63"), b(r, "beton", "Béton", "Beton"), b(r, "tarmac", "Tarmac", "Asfalt"), b(r, "sable", "Sable jaune", "Geel zand"), b(r, "stab", "Stabiter 0/32", "Stabiter 0/32")]);
    const g = e.rep.granulat;
    if (g === "mix") return { code: "G-MIX" };
    if (g === "sable") return { code: "G-SAB" };
    if (g === "stab") return { code: "G-STAB" };
    if (g === "beton") {
      if (!e.rep.calibreBe) e.rep.calibreBe = LIRE.calibreBe(e.texte);
      if (!e.rep.calibreBe) return q("calibreBe", T(r, "Quel calibre de granulat béton ?", "Welk kaliber betongranulaat?"), [{ v: "032", l: "0/32" }, { v: "060", l: "0/60" }, { v: "2560", l: "25/60" }]);
      return { code: { "032": "G-BE32", "060": "G-BE60", "2560": "G-BE2560" }[e.rep.calibreBe] };
    }
    if (!e.rep.calibreTa) e.rep.calibreTa = LIRE.calibreTa(e.texte);
    if (!e.rep.calibreTa) return q("calibreTa", T(r, "Quel calibre de granulat tarmac ?", "Welk kaliber asfaltgranulaat?"), [{ v: "032", l: "0/32" }, { v: "063", l: "0/63" }]);
    return { code: e.rep.calibreTa === "032" ? "G-TA32" : "G-TA63" };
  },
  sable() { return { code: "G-SAB" }; },
  stabilise(r, e) {
    if (!e.rep.stabilise) e.rep.stabilise = LIRE.stabilise(e.texte);
    if (!e.rep.stabilise) return q("stabilise", T(r, "Quel produit stabilisé vous intéresse ?", "In welk gestabiliseerd product bent u geïnteresseerd?"),
      [b(r, "stab", "Stabiter 0/32 (gratuit)", "Stabiter 0/32 (gratis)"), b(r, "recystab", "Recystab-e (bientôt disponible)", "Recystab-e (binnenkort beschikbaar)")]);
    if (e.rep.stabilise === "recystab") return { libre: T(r, "Le Recystab-e sera bientôt disponible. Décrivez votre besoin (quantité, usage, date) : notre équipe vous répond.",
      "Recystab-e is binnenkort beschikbaar. Beschrijf uw behoefte (hoeveelheid, gebruik, datum): ons team antwoordt u.") };
    return { code: "G-STAB" };
  },
  ytong() { return { code: "YT" }; },
  poteaux() { return { code: "POT" }; },
  ardoise() { return { code: "BR8" }; },
  carrelage() { return { code: "BR9" }; },
  melange() { return { code: "BR7" }; },
  pierrailles() { return { code: "B6" }; }
};

/* ---------------------------------------------------------------- Moteur */
const etatNeuf = (langue) => ({ etape: "accueil", langue, file: [], courant: null, lignes: [], site: null, siteNom: null, chantier: null,
  profil: null, coordonnees: null, facturation: null, echecs: 0, libre: null });
const reponse = (texte, extra = {}) => ({ texte, boutons: [], champ: null, valeurs: null, recap: false, envoyer: false, ...extra });

// Le site accepte-t-il cette ligne (code interne ou code NewTonne direct) ?
const accepteLigne = (s, res, outils) => {
  if (res.nt) return true; // proposé par le site lui-même
  const n = outils.newtonne(res.code);
  return !!(n && s.accepte(n.code, n.operation));
};
// Sites qui acceptent une matière (ou, pour les terres, au moins une de leurs terres)
const sitesPossibles = (r, outils, e, res) => {
  const tous = outils.sitesPour(r.chantier && r.chantier.cp);
  if (res) return tous.filter((s) => accepteLigne(s, res, outils));
  return tous.filter((s) => {
    if (e.limiteSites && !e.limiteSites.includes(s.code)) return false;
    if (TERRES_SITE[s.code]) {
      const codes = e.famille === "amiante" ? ["T-SA-AM"] : e.famille === "invasives" ? ["T-SA-INV"] : TERRES_SITE[s.code];
      return codes.some((c) => accepteLigne(s, { code: c }, outils));
    }
    return FAMILLES_TERRE.includes(e.famille) && e.famille === "terre" && s.terres && s.terres.length > 0;
  });
};

const demanderChantier = (r, prefixe = "") => {
  r.etape = "chantier";
  return reponse(prefixe + T(r, "Où se trouve votre chantier ? Avec le code postal, je vous indique le site Recymo le plus proche.",
    "Waar ligt uw werf? Met de postcode zeg ik u welke Recymo-site het dichtst bij ligt."), { champ: "chantier", valeurs: r.chantier || null });
};

// Choix du site : un seul possible → choisi d'office ; plusieurs → boutons, le plus proche en premier
const choisirSite = (r, outils, candidats, quoi, prefixe) => {
  if (!candidats.length) return null;
  r.candidats = candidats.map((s) => ({ code: s.code, nom: s.nom, adresse: s.adresse, km: s.km, terres: s.terres }));
  const proche = candidats[0];
  if (candidats.length === 1) {
    r.site = proche.code; r.siteNom = proche.nom;
    return { info: T(r, `${quoi} : ${proche.nom}${proche.km != null ? ` (${proche.km} km de votre chantier)` : ""}.`, `${quoi}: ${proche.nom}${proche.km != null ? ` (${proche.km} km van uw werf)` : ""}.`) };
  }
  r.etape = "site";
  const texte = proche.km != null
    ? T(r, `Le plus proche pour ${minuscule(quoi)} : ${proche.nom} (${proche.km} km). Sur quel site voulez-vous aller ?`, `Het dichtst bij voor ${minuscule(quoi)}: ${proche.nom} (${proche.km} km). Naar welke site wilt u gaan?`)
    : T(r, "Sur quel site voulez-vous aller ?", "Naar welke site wilt u gaan?");
  return { reponse: reponse(prefixe + texte, { boutons: candidats.map((s) => ({ v: s.code, l: s.nom + kmTexte(s) })) }) };
};

// Matière refusée au site de la demande : dire où elle est acceptée (le plus proche d'abord)
const ailleurs = (r, nom, autres, quantite, operation) => {
  r.ailleurs = r.ailleurs || [];
  r.ailleurs.push({ nom, quantite: quantite || null, sites: autres.slice(0, 3).map((s) => ({ code: s.code, nom: s.nom, km: s.km })) });
  if (!autres.length) {
    return T(r, `« ${nom} » n'est pas accepté à ${r.siteNom}, ni sur un autre site pour le moment : notre équipe vous recontactera à ce sujet. `,
      `“${nom}” wordt niet aanvaard in ${r.siteNom}, en momenteel ook niet op een andere site: ons team neemt hierover contact met u op. `);
  }
  const liste = autres.slice(0, 2).map((x) => x.nom + kmTexte(x)).join(T(r, " ou à ", " of in "));
  const verbe = operation === "retrait" ? T(r, "le retirer", "het af te halen") : T(r, "le déposer", "het te storten");
  return T(r, `Attention : « ${nom} » n'est pas accepté à ${r.siteNom}. Il est accepté à ${liste} : vous devrez donc vous y rendre pour ${verbe}, avec une demande séparée (bouton « Nouvelle conversation »). Je continue votre demande pour ${r.siteNom}. `,
    `Opgelet: “${nom}” wordt niet aanvaard in ${r.siteNom}. Het wordt aanvaard in ${liste}: u moet er dus naartoe om ${verbe}, met een aparte aanvraag (knop “Nieuw gesprek”). Ik ga verder met uw aanvraag voor ${r.siteNom}. `);
};
const apresRefus = (r, prefixe) => {
  r.etape = "plus";
  return reponse(prefixe + T(r, "Avez-vous autre chose à ajouter pour " + r.siteNom + " ?", "Wilt u nog iets toevoegen voor " + r.siteNom + "?"), { boutons: boutonsPlus(r) });
};

const avancer = (r, outils, prefixe = "") => {
  for (let garde = 0; garde < 25; garde++) {
    if (!r.courant && r.file.length) r.courant = r.file.shift();
    const e = r.courant;
    if (e) {
      const terre = FAMILLES_TERRE.includes(e.famille);
      // Terres : chantier puis site d'abord (les questions dépendent du site)
      if (terre && e.operation !== "retrait" && (!r.site || e.changerSite || (r.lignes.length && !e.siteVerifie))) {
        e.siteVerifie = true;
        if (!r.chantier) return demanderChantier(r, prefixe);
        if (r.lignes.length && !e.changerSite) {
          // Demande déjà liée à un site : il doit accepter les terres
          const ici = outils.sitesPour(r.chantier.cp).find((s) => s.code === r.site);
          const possibles = sitesPossibles(r, outils, e);
          if (!ici || !possibles.some((s) => s.code === r.site)) {
            const nomTerres = e.famille === "amiante" ? libelle("T-SA-AM", r.langue) : e.famille === "invasives" ? libelle("T-SA-INV", r.langue) : T(r, "Ces terres", "Deze grond");
            r.courant = null;
            prefixe += ailleurs(r, nomTerres, possibles.filter((s) => s.code !== r.site), e.quantite, "depot");
            if (r.file.length) continue;
            return apresRefus(r, prefixe);
          }
        } else {
          e.changerSite = false;
          const cands = sitesPossibles(r, outils, e);
          if (!cands.length) { r.courant = null; prefixe += T(r, "Aucun site n'accepte ces terres pour le moment. ", "Geen enkele site aanvaardt deze grond momenteel. "); continue; }
          const ch = choisirSite(r, outils, cands, T(r, "Vos terres", "Uw grond"), prefixe);
          if (ch.reponse) return ch.reponse;
          prefixe += ch.info + " ";
        }
      }
      const res = questions[e.famille](r, e);
      if (res.question) { r.etape = "question"; r.cle = res.question.cle; return reponse(prefixe + res.question.texte, { boutons: res.question.boutons }); }
      if (res.changerSite) {
        // Ex. terres de type III à V : seuls certains sites conviennent
        e.rep = {}; e.texte = ""; e.limiteSites = res.changerSite; e.changerSite = true;
        if (!r.lignes.length) { r.site = null; r.siteNom = null; }
        if (res.info) prefixe += res.info + " ";
        continue;
      }
      if (res.info) { r.courant = null; prefixe += res.info + " "; continue; }
      if (res.libre) { r.courant = null; r.etape = "libre"; return reponse(prefixe + res.libre, { champ: "texte" }); }
      const nom = res.code ? libelle(res.code, r.langue) : res.nom;
      if (!terre && r.site) {
        const ici = outils.sitesPour(r.chantier && r.chantier.cp).find((x) => x.code === r.site);
        if (ici && !accepteLigne(ici, res, outils)) {
          r.courant = null;
          prefixe += ailleurs(r, nom, sitesPossibles(r, outils, e, res).filter((x) => x.code !== r.site), e.quantite, e.operation);
          if (r.file.length) continue;
          return apresRefus(r, prefixe);
        }
      }
      if (!e.quantite) {
        r.etape = "quantite"; e.res = res;
        const texte = e.m3
          ? T(r, `Vous avez indiqué ${t3(e.m3)} m³. Combien de tonnes cela fait-il environ ? (Comptez environ 1,5 t par m³ pour du béton ou des briques, 1,8 t par m³ pour des terres.)`,
            `U gaf ${t3(e.m3)} m³ op. Hoeveel ton is dat ongeveer? (Reken op ongeveer 1,5 t per m³ voor beton of bakstenen, 1,8 t per m³ voor grond.)`)
          : T(r, `${nom} : combien de tonnes environ ?`, `${nom}: hoeveel ton ongeveer?`);
        return reponse(prefixe + texte, { champ: "nombre" });
      }
      // Autres matières : chantier puis site après la quantité
      if (!terre && !r.site) {
        if (!r.chantier) { e.res = res; return demanderChantier(r, prefixe); }
        const cands = sitesPossibles(r, outils, e, res);
        if (!cands.length) {
          r.courant = null;
          prefixe += T(r, `« ${nom} » n'est accepté sur aucun site pour le moment : notre équipe vous recontactera. `, `“${nom}” wordt momenteel op geen enkele site aanvaard: ons team neemt contact met u op. `);
          r.libre = (r.libre ? r.libre + "\n" : "") + nom + " : " + t3(e.quantite) + " t";
          continue;
        }
        const quoi = e.operation === "retrait" ? T(r, "À retirer", "Af te halen") : T(r, "À déposer", "Te storten");
        const ch = choisirSite(r, outils, cands, quoi, prefixe);
        e.res = res;
        if (ch.reponse) return ch.reponse;
        prefixe += ch.info + (e.operation === "retrait" ? T(r, " Livraison possible sur demande.", " Levering mogelijk op aanvraag.") : "") + " ";
      }
      r.lignes.push({ code: res.code || null, nt: res.nt || null, nom: res.nom || null, quantite: e.quantite, ...(e.note ? { note: e.note } : {}) });
      r.courant = null;
      if (r.file.length) continue;
      r.etape = "plus";
      return reponse(prefixe + T(r, `C'est noté : ${t3(e.quantite)} t de ${minuscule(nom)}. Avez-vous autre chose à ajouter ?`, `Genoteerd: ${t3(e.quantite)} t ${minuscule(nom)}. Wilt u nog iets toevoegen?`), { boutons: boutonsPlus(r) });
    }
    if (!r.lignes.length && !r.libre) {
      r.etape = "accueil";
      return reponse(prefixe + T(r, "Que voulez-vous déposer ou acheter ?", "Wat wilt u storten of kopen?"), { boutons: boutonsMatiere(r) });
    }
    return suiteDossier(r, prefixe);
  }
  return reponse(T(r, "Je n'ai pas compris.", "Ik heb het niet begrepen."));
};

/* ----------------------------------------------- Dossier : qui, facturation */
const suiteDossier = (r, prefixe = "") => {
  if (!r.profil) {
    r.etape = "profil";
    return reponse(prefixe + T(r, "Pour finir, quelques informations pour le devis. Vous êtes :", "Tot slot nog enkele gegevens voor de offerte. U bent:"),
      { boutons: [b(r, "entreprise", "Une entreprise", "Een bedrijf"), b(r, "particulier", "Un particulier", "Een particulier")] });
  }
  if (!r.coordonnees) {
    r.etape = "coordonnees";
    return reponse(prefixe + T(r, r.profil === "entreprise" ? "Qui est votre personne de contact ?" : "Vos coordonnées :", r.profil === "entreprise" ? "Wie is uw contactpersoon?" : "Uw gegevens:"),
      { champ: "coordonnees", valeurs: { profil: r.profil } });
  }
  if (!r.facturation) {
    r.etape = "facturation";
    const ch = r.chantier || {};
    return reponse(prefixe + T(r, "Dernière étape : l'adresse de facturation.", "Laatste stap: het facturatieadres."), {
      champ: "facturation",
      valeurs: { profil: r.profil, ...(r.profil === "particulier" && ch.rue ? { adresse: ch.rue, cp: ch.cp, localite: communeUnique(ch.commune) } : {}), pays: "BE" }
    });
  }
  return recap(r, prefixe);
};

const recap = (r, prefixe = "") => {
  r.etape = "recap";
  return reponse(prefixe + T(r, "Voici le récapitulatif de votre demande. Est-ce que tout est correct ?", "Hier is het overzicht van uw aanvraag. Klopt alles?"), {
    recap: true, boutons: [b(r, "oui", "Oui, j'envoie ma demande", "Ja, ik verstuur mijn aanvraag"), b(r, "non", "Non, je modifie", "Nee, ik pas aan")]
  });
};

const incompris = (r) => {
  r.echecs++;
  if (r.echecs >= 2) {
    r.etape = "libre"; r.courant = null;
    return reponse(T(r, "Je n'ai pas compris. Écrivez votre demande, notre équipe vous répond.", "Ik heb het niet begrepen. Schrijf uw vraag, ons team antwoordt u."), { champ: "texte" });
  }
  return reponse(T(r, "Je n'ai pas bien compris. De quoi s'agit-il ?", "Ik heb het niet goed begrepen. Waarover gaat het?"), { boutons: boutonsMatiere(r) });
};

const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const telOk = (v) => String(v || "").replace(/\D/g, "").length >= 8;

/* --------------------------------------------------------- Point d'entrée */
const repondre = (conversation, entree = {}, outils) => {
  if (!outils) throw new Error("outils manquants");
  const r = conversation.robot || (conversation.robot = etatNeuf(conversation.langue === "nl" ? "nl" : "fr"));
  const texte = String(entree.texte || "").trim();
  const bouton = entree.bouton ? String(entree.bouton) : null;
  const t = norm(texte);
  const vide = !texte && !bouton && entree.nombre == null && !entree.chantier && !entree.coordonnees && !entree.facturation;

  if (vide) return r.etape === "accueil" && !r.lignes.length ? reponse(ACCUEIL(r), { boutons: boutonsMatiere(r) }) : reponse("");

  if (r.etape === "envoye") {
    return reponse(T(r, "Votre demande est entre les mains de notre équipe : la réponse arrivera ici. Pour une nouvelle demande, cliquez sur « Nouvelle conversation ».",
      "Uw aanvraag is in handen van ons team: het antwoord verschijnt hier. Voor een nieuwe aanvraag klikt u op “Nieuw gesprek”."));
  }

  // Récapitulatif : seul le bouton « Oui » envoie la demande
  if (r.etape === "recap") {
    if (bouton === "oui") {
      r.etape = "envoye";
      return reponse(T(r, "Merci ! Votre demande est envoyée à notre équipe. Elle vérifie le prix et vous répond ici : gardez le lien de cette conversation.",
        "Bedankt! Uw aanvraag is naar ons team verstuurd. Het controleert de prijs en antwoordt u hier: bewaar de link van dit gesprek."), { envoyer: true });
    }
    if (bouton === "non") { r.etape = "modifier"; return reponse(T(r, "Que voulez-vous modifier ?", "Wat wilt u aanpassen?"), { boutons: boutonsModifier(r) }); }
    return reponse(T(r, "Pour confirmer, cliquez sur le bouton « Oui, j'envoie ma demande ». Pour changer quelque chose, cliquez sur « Non, je modifie ».",
      "Klik om te bevestigen op de knop “Ja, ik verstuur mijn aanvraag”. Om iets te wijzigen, klik op “Nee, ik pas aan”."), {
      boutons: [b(r, "oui", "Oui, j'envoie ma demande", "Ja, ik verstuur mijn aanvraag"), b(r, "non", "Non, je modifie", "Nee, ik pas aan")] });
  }

  if (r.etape === "modifier") {
    if (bouton === "coordonnees") { r.profil = null; r.coordonnees = null; return suiteDossier(r); }
    if (bouton === "facturation") { r.facturation = null; return suiteDossier(r); }
    if (bouton === "matieres" || bouton === "chantier") {
      Object.assign(r, { lignes: [], file: [], courant: null, libre: null, site: null, siteNom: null, ailleurs: [], echecs: 0, etape: "accueil", ...(bouton === "chantier" ? { chantier: null } : {}) });
      return reponse(T(r, "D'accord. Que voulez-vous déposer ou acheter ?", "Goed. Wat wilt u storten of kopen?"), { boutons: boutonsMatiere(r) });
    }
    if (bouton === "recommencer") { conversation.robot = etatNeuf(r.langue); return reponse(ACCUEIL(conversation.robot), { boutons: boutonsMatiere(conversation.robot) }); }
    return reponse(T(r, "Que voulez-vous modifier ?", "Wat wilt u aanpassen?"), { boutons: boutonsModifier(r) });
  }

  // Chantier : code postal (obligatoire) et rue (facultative)
  if (r.etape === "chantier") {
    const c = entree.chantier || (/^\d{4}$/.test(t) ? { cp: t } : null);
    const cp = c ? txt(c.cp, 4) : "";
    if (!/^\d{4}$/.test(cp)) return reponse(T(r, "Indiquez le code postal du chantier (4 chiffres).", "Geef de postcode van de werf in (4 cijfers)."), { champ: "chantier", valeurs: r.chantier });
    const commune = outils.commune(cp);
    if (!commune) return reponse(T(r, `Le code postal ${cp} est introuvable. Vérifiez-le (code belge, 4 chiffres).`, `Postcode ${cp} niet gevonden. Controleer hem (Belgische code, 4 cijfers).`), { champ: "chantier", valeurs: { cp, rue: txt(c.rue, 160) } });
    r.chantier = { cp, rue: txt(c.rue, 160), commune };
    return avancer(r, outils);
  }

  // Choix du site
  if (r.etape === "site") {
    const choix = (r.candidats || []).find((s) => s.code === bouton || (!bouton && t && norm(s.nom).includes(t)));
    if (!choix) return reponse(T(r, "Choisissez un site ci-dessous.", "Kies een site hieronder."), { boutons: (r.candidats || []).map((s) => ({ v: s.code, l: s.nom + kmTexte(s) })) });
    r.site = choix.code; r.siteNom = choix.nom;
    return avancer(r, outils);
  }

  // Entreprise ou particulier
  if (r.etape === "profil") {
    const p = bouton || (/particulier|prive|privé|particulier/.test(t) ? "particulier" : /entreprise|societe|bedrijf|firma/.test(t) ? "entreprise" : null);
    if (!["entreprise", "particulier"].includes(p)) return suiteDossier(r);
    r.profil = p;
    return suiteDossier(r);
  }

  // Personne de contact
  if (r.etape === "coordonnees") {
    const c = entree.coordonnees || {};
    const v = { societe: txt(c.societe, 120), nom: txt(c.nom, 120), email: txt(c.email, 160), telephone: txt(c.telephone, 40) };
    const manque = (r.profil === "entreprise" && !v.societe) || !v.nom || !emailOk(v.email) || !telOk(v.telephone);
    if (manque) return reponse(T(r, (r.profil === "entreprise" ? "La société, le nom, " : "Le nom, ") + "un e-mail valide et un numéro de téléphone sont obligatoires.",
      (r.profil === "entreprise" ? "Het bedrijf, de naam, " : "De naam, ") + "een geldig e-mailadres en een telefoonnummer zijn verplicht."), { champ: "coordonnees", valeurs: { profil: r.profil, ...v } });
    if (r.profil !== "entreprise") v.societe = "";
    r.coordonnees = v;
    return suiteDossier(r);
  }

  // Facturation (le numéro de TVA invalide est signalé, sans bloquer)
  if (r.etape === "facturation") {
    const c = entree.facturation || {};
    const v = { adresse: txt(c.adresse, 160), cp: txt(c.cp, 10), localite: txt(c.localite, 80), pays: (txt(c.pays, 2).toUpperCase() || "BE").replace(/[^A-Z]/g, "") || "BE",
      tva: txt(c.tva, 30), emailFactures: txt(c.emailFactures, 160) };
    if (!v.localite && v.pays === "BE") v.localite = communeUnique(outils.commune(v.cp));
    const manque = !v.adresse || !v.cp || !v.localite || (r.profil === "entreprise" && !v.tva) || (v.emailFactures && !emailOk(v.emailFactures));
    if (manque) return reponse(T(r, "L'adresse, le code postal, la localité" + (r.profil === "entreprise" ? " et le numéro de TVA" : "") + " sont obligatoires (et l'e-mail pour les factures doit être valide s'il est rempli).",
      "Het adres, de postcode, de gemeente" + (r.profil === "entreprise" ? " en het btw-nummer" : "") + " zijn verplicht (en het e-mailadres voor facturen moet geldig zijn als het ingevuld is)."), { champ: "facturation", valeurs: { profil: r.profil, ...v } });
    if (r.profil !== "entreprise") { v.tva = ""; v.emailFactures = ""; }
    v.tvaValide = r.profil === "entreprise" ? (v.pays !== "BE" || tvaBelgeValide(v.tva)) : null;
    r.facturation = v;
    return recap(r);
  }

  // Texte libre (après 2 incompréhensions ou « Autre demande »)
  if (r.etape === "libre") {
    if (!texte) return reponse(T(r, "Écrivez votre demande dans la case ci-dessous.", "Schrijf uw vraag in het vak hieronder."), { champ: "texte" });
    r.libre = (r.libre ? r.libre + "\n" : "") + texte.slice(0, 2000);
    return suiteDossier(r, T(r, "Merci, c'est noté. ", "Bedankt, genoteerd. "));
  }

  // Quantité
  if (r.etape === "quantite" && r.courant) {
    const mt = t.match(RE_TONNES), mm = t.match(RE_M3);
    const n = entree.nombre != null ? nombre(entree.nombre) : mt ? nombre(mt[1]) : (!mm && /^\d+([.,]\d+)?$/.test(t)) ? nombre(t) : null;
    if (mm && !mt && entree.nombre == null) { r.courant.m3 = nombre(mm[1]); return avancer(r, outils); }
    if (!n) return reponse(T(r, "Indiquez un nombre de tonnes (par exemple 12).", "Geef een aantal ton in (bijvoorbeeld 12)."), { champ: "nombre" });
    r.courant.quantite = n;
    return avancer(r, outils);
  }

  // « Autre chose à ajouter ? »
  if (r.etape === "plus") {
    if (bouton === "fini" || /^(non|nee|c est tout|dat is alles|rien|niets)\b/.test(t)) return suiteDossier(r);
    if (bouton === "plus") { r.etape = "accueil"; return reponse(T(r, "Que voulez-vous ajouter ?", "Wat wilt u toevoegen?"), { boutons: boutonsMatiere(r) }); }
  }

  // Réponse à une question sur la matière en cours
  if (r.etape === "question" && r.courant) {
    const posee = questions[r.courant.famille](r, r.courant).question;
    const boutonValide = bouton && posee && posee.boutons.some((x) => x.v === bouton) ? bouton : null;
    if (bouton && !boutonValide) return reponse(posee ? posee.texte : T(r, "Choisissez une réponse ci-dessous.", "Kies een antwoord hieronder."), { boutons: posee ? posee.boutons : [] });
    const v = boutonValide || (LIRE[r.cle] ? LIRE[r.cle](t) : null);
    if (v) { r.courant.rep[r.cle] = v; r.courant.essais = 0; return avancer(r, outils); }
    if (!analyser(texte).elements.length) {
      r.courant.essais = (r.courant.essais || 0) + 1;
      if (r.courant.essais >= 2) { r.courant = null; r.file = []; return incompris(Object.assign(r, { echecs: 1 })); }
      return reponse(T(r, "Choisissez une réponse ci-dessous. ", "Kies een antwoord hieronder. ") + (posee ? posee.texte : ""), { boutons: posee ? posee.boutons : [] });
    }
    r.courant = null;
  }

  if (bouton === "autre") { r.etape = "libre"; return reponse(T(r, "Écrivez votre demande, notre équipe vous répond.", "Schrijf uw vraag, ons team antwoordt u."), { champ: "texte" }); }
  if (bouton && bouton.startsWith("m:")) {
    const famille = bouton.slice(2);
    if (!questions[famille]) return incompris(r);
    r.file.push({ famille, quantite: null, m3: null, texte: "", rep: {}, operation: famille === "granulat" ? "retrait" : "depot" });
    r.echecs = 0;
    return avancer(r, outils);
  }
  if (bouton) return avancer(r, outils);

  // Texte : matières, quantités, opération (et code postal du chantier s'il est cité)
  const a = analyser(texte);
  if (!a.elements.length) return incompris(r);
  r.echecs = 0;
  if (a.cp && !r.chantier && outils.commune(a.cp)) r.chantier = { cp: a.cp, rue: "", commune: outils.commune(a.cp) };
  for (const e of a.elements) {
    e.operation = a.operation || (["granulat", "sable", "stabilise"].includes(e.famille) ? "retrait" : "depot");
    r.file.push(e);
  }
  return avancer(r, outils);
};

// Récapitulatif pour l'affichage et pour NewTonne (le serveur ajoute les prix)
const resume = (r) => ({
  lignes: r.lignes.map((l) => ({ code: l.code || null, nt: l.nt || null, nom: l.nom || null, quantite: l.quantite, note: l.note || null })),
  site: r.site || null, siteNom: r.siteNom || null,
  chantier: r.chantier || null,
  profil: r.profil || null, coordonnees: r.coordonnees || null, facturation: r.facturation || null,
  libre: r.libre || null, analyse: !!r.analyseAJoindre,
  ailleurs: r.ailleurs || []
});

module.exports = { repondre, resume, libelle, nomLigne, tvaBelgeValide, LIBELLES, _analyser: analyser, _norm: norm };
