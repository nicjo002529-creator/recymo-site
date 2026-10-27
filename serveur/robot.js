// Robot de devis à règles (sans IA) : il repère des mots-clés, pose les questions qui manquent avec des
// boutons, puis montre un récapitulatif. Le devis part dans NewTonne seulement quand le client clique sur
// « Oui, j'envoie ma demande ». Module remplaçable : une seule fonction, repondre(conversation, entree).
//
// entree : { texte } (message tapé), { bouton } (valeur d'un bouton), { nombre }, { contact: { nom, societe, email, telephone } }
// réponse : { texte, boutons: [{ v, l }], champ: "nombre" | "contact" | "texte" | null, recap: bool, envoyer: bool }
// L'état du robot est gardé dans conversation.robot. Les prix ne sont jamais écrits ici : le serveur les calcule.
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
// Site de chaque code (les autres : Braives)
const SITE_CODE = {
  "T-FO": "FOSSES", "T-FO-AN": "FOSSES", "T-TR": "TRANSINNES", "T-TR-AN": "TRANSINNES",
  "T-SA-13": "SAMBREVILLE", "T-SA-45": "SAMBREVILLE", "T-SA-AN": "SAMBREVILLE", "T-SA-INV": "SAMBREVILLE", "T-SA-AM": "SAMBREVILLE"
};
const siteDe = (code) => SITE_CODE[code] || "BRAIVES";
const SITES = { BRAIVES: "Braives", FOSSES: "Fosses-la-Ville", SAMBREVILLE: "Sambreville", TRANSINNES: "Transinnes" };
const libelle = (code, langue) => (LIBELLES[code] || [code, code])[langue === "nl" ? 1 : 0];

/* --------------------------------------------------------- Lecture du texte */
// Minuscules, sans accents ni apostrophes
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
const siteDans = (t) => /braives/.test(t) ? "BRAIVES" : /fosses/.test(t) ? "FOSSES" : /sambreville|auvelais|tamines/.test(t) ? "SAMBREVILLE" : /transinnes|libin/.test(t) ? "TRANSINNES" : null;

// Découpe un message en demandes : « 30 t de béton et 10 t de briques » → deux éléments
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
  // Une quantité citée avant la matière (« 20 tonnes de béton ») est dans le même morceau ; sinon, une seule quantité pour une seule matière
  if (elements.length === 1 && !elements[0].quantite) {
    const mt = t.match(RE_TONNES), mm = t.match(RE_M3);
    if (mt) elements[0].quantite = nombre(mt[1]); else if (mm) elements[0].m3 = nombre(mm[1]);
  }
  return { operation, elements, site: siteDans(t) };
};

/* ------------------------------------------------------------------- Textes */
const T = (r, fr, nl) => (r.langue === "nl" ? nl : fr);
const b = (r, v, fr, nl) => ({ v, l: T(r, fr, nl) });
const boutonsMatiere = (r) => [
  b(r, "m:beton", "Béton", "Beton"), b(r, "m:brique", "Briques", "Bakstenen"), b(r, "m:terre", "Terre", "Grond"),
  b(r, "m:tarmac", "Tarmac", "Asfalt"), b(r, "m:granulat", "Acheter des granulats", "Granulaten kopen"), b(r, "autre", "Autre demande", "Andere vraag")
];
const ACCUEIL = (r) => T(r,
  "Bonjour ! Je vous aide à préparer votre demande de devis. Que voulez-vous déposer ou acheter ? Écrivez-le (par exemple « 20 tonnes de béton à jeter ») ou choisissez ci-dessous.",
  "Hallo! Ik help u uw offerteaanvraag voor te bereiden. Wat wilt u storten of kopen? Schrijf het (bijvoorbeeld “20 ton beton storten”) of kies hieronder.");

/* ------------------------------------------------- Questions par matière */
// Chaque fonction regarde les réponses déjà données (e.rep) et renvoie soit une question, soit un code.
// q(cle, texte, boutons) : question ; les réponses tapées sont reconnues par lire[cle].
const q = (cle, texte, boutons) => ({ question: { cle, texte, boutons } });
const LIRE = {
  arme: (t) => /non arme|sans fer|pas arme|ongewapend|zonder (ijzer|wapening)|niet gewapend/.test(t) ? "non" : /un peu|legerement|peu arme|licht|beetje|weinig/.test(t) ? "peu" : /arme|\bfer|gewapend|wapening|ijzer/.test(t) ? "arme" : null,
  propre: (t) => /terre|terreu|grond|aarde|vuil|sale/.test(t) ? "terre" : /propre|zuiver|proper|schoon|net\b/.test(t) ? "propre" : null,
  brique: (t) => /tres (sale|terreu)|zeer (vuil|grondhoudend)|heel vuil/.test(t) ? "sale" : /un peu|legerement|licht/.test(t) ? "peu" : /tres propre|sans terre|zeer zuiver|zonder grond/.test(t) ? "tres" : /propre|zuiver|proper|schoon/.test(t) ? "propre" : /sale|terre|vuil|grond/.test(t) ? "peu" : null,
  tarmac: (t) => /terre|grond/.test(t) ? "b4" : /beton/.test(t) ? "bt" : /seul|alleen|tarmac|asfalt|asphalt/.test(t) ? "ta" : null,
  site: (t) => siteDans(t) || (/sais pas|weet niet|aucune idee|geen idee/.test(t) ? "nsp" : null),
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
    if (e.operation === "retrait") return pasEnVente(r, e);
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
  terre(r, e) {
    if (e.operation === "retrait") return pasEnVente(r, e);
    if (!r.site && !e.rep.site) e.rep.site = siteDans(e.texte);
    const site = e.rep.site || r.site;
    if (!site || site === "nsp") {
      const intro = site === "nsp" ? T(r, "Fosses-la-Ville et Transinnes acceptent les terres de type I et II. Sambreville et Braives acceptent aussi les types III à V (Braives : uniquement avec une analyse). ",
        "Fosses-la-Ville en Transinnes aanvaarden grond van type I en II. Sambreville en Braives aanvaarden ook type III tot V (Braives: enkel met analyse). ") : "";
      e.rep.site = null;
      return q("site", intro + T(r, "Sur quel site voulez-vous déposer vos terres ?", "Op welke site wilt u uw grond storten?"),
        (e.sitesPossibles || ["BRAIVES", "FOSSES", "SAMBREVILLE", "TRANSINNES"]).map((s) => ({ v: s, l: SITES[s] })).concat(site === "nsp" || e.sitesPossibles ? [] : [b(r, "nsp", "Je ne sais pas", "Ik weet het niet")]));
    }
    if (site === "FOSSES" || site === "TRANSINNES") {
      if (!e.rep.type12) return q("type12", T(r, `${SITES[site]} accepte uniquement les terres de type I et II. Est-ce votre cas ?`, `${SITES[site]} aanvaardt enkel grond van type I en II. Is dat bij u het geval?`),
        [b(r, "oui", "Oui", "Ja"), b(r, "nsp", "Je ne sais pas", "Ik weet het niet"), b(r, "non", "Non, type III à V", "Nee, type III tot V")]);
      if (e.rep.type12 === "non") {
        e.rep = {}; e.texte = ""; e.sitesPossibles = ["SAMBREVILLE", "BRAIVES"]; if (r.site === site) r.site = null;
        return q("site", T(r, "Pour les terres de type III à V : Sambreville, ou Braives avec une analyse (RQT, CCQT). Quel site choisissez-vous ?",
          "Voor grond van type III tot V: Sambreville, of Braives met analyse (RQT, CCQT). Welke site kiest u?"), [{ v: "SAMBREVILLE", l: "Sambreville" }, { v: "BRAIVES", l: "Braives" }]);
      }
      if (e.rep.type12 === "nsp") e.note = T(r, "type de terre à vérifier", "grondtype na te kijken");
    }
    if (site === "SAMBREVILLE") {
      if (!e.rep.pollution && /amiante|asbest/.test(e.texte)) e.rep.pollution = "am";
      if (!e.rep.pollution && /renouee|invasive|duizendknoop|invasieve/.test(e.texte)) e.rep.pollution = "inv";
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
      if (e.rep.braivesSans === "autre") {
        e.rep = {}; e.texte = ""; if (r.site === "BRAIVES") r.site = null; e.sitesPossibles = ["FOSSES", "TRANSINNES", "SAMBREVILLE"];
        return questions.terre(r, e);
      }
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
  invasives(r, e) { return siteImpose(r, e, "T-SA-INV"); },
  amiante(r, e) { return siteImpose(r, e, "T-SA-AM"); },
  granulat(r, e) {
    if (!e.rep.granulat) e.rep.granulat = LIRE.granulat(e.texte.replace(/granula\w*/g, ""));
    if (!e.rep.granulat) return q("granulat", T(r, "Quel granulat vous faut-il ? (au départ de Braives, livraison possible sur demande)", "Welk granulaat hebt u nodig? (af Braives, levering mogelijk op aanvraag)"), [
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
const siteImpose = (r, e, code) => {
  if (r.site && r.site !== "SAMBREVILLE") e.note = T(r, "accepté uniquement à Sambreville", "enkel aanvaard in Sambreville");
  return { code };
};
const pasEnVente = (r, e) => {
  e.annule = true;
  return { info: T(r, "Nous ne vendons pas ce matériau. Nous vendons des granulats recyclés, du sable jaune et du Stabiter.", "Dit materiaal verkopen we niet. We verkopen gerecycleerde granulaten, geel zand en Stabiter.") };
};

/* ---------------------------------------------------------------- Moteur */
const etatNeuf = (langue) => ({ etape: "accueil", langue, file: [], courant: null, lignes: [], site: null, contact: null, echecs: 0, libre: null, notes: [] });

const reponse = (texte, extra = {}) => ({ texte, boutons: [], champ: null, recap: false, envoyer: false, ...extra });

// Fait avancer la conversation jusqu'à la prochaine question
const avancer = (r, prefixe = "") => {
  for (let garde = 0; garde < 20; garde++) {
    if (!r.courant && r.file.length) r.courant = r.file.shift();
    const e = r.courant;
    if (e && r.lignes.length && !e.siteVerifie) {
      e.siteVerifie = true;
      const siteDemande = siteDe(r.lignes[0].code);
      const voulu = e.famille === "terre" ? (e.rep.site || siteDans(e.texte)) : ["invasives", "amiante"].includes(e.famille) ? "SAMBREVILLE" : e.operation === "retrait" && ["brique", "terre"].includes(e.famille) ? null : "BRAIVES";
      if (e.famille === "terre" && !voulu) e.rep.site = siteDemande;
      if (voulu && voulu !== siteDemande) {
        r.courant = null;
        prefixe += T(r, `Cette matière se dépose à ${SITES[voulu]}, pas à ${SITES[siteDemande]} : faites une demande séparée pour ce site (bouton « Nouvelle conversation »). `,
          `Dit materiaal wordt gestort in ${SITES[voulu]}, niet in ${SITES[siteDemande]}: doe een aparte aanvraag voor die site (knop “Nieuw gesprek”). `);
        if (r.file.length) continue;
        r.etape = "plus";
        return reponse(prefixe + T(r, "Avez-vous autre chose à ajouter ?", "Wilt u nog iets toevoegen?"),
          { boutons: [b(r, "plus", "Ajouter une autre matière", "Nog een materiaal toevoegen"), b(r, "fini", "Non, c'est tout", "Nee, dat is alles")] });
      }
    }
    if (e) {
      const res = questions[e.famille](r, e);
      if (res.question) {
        r.etape = "question"; r.cle = res.question.cle;
        return reponse(prefixe + res.question.texte, { boutons: res.question.boutons });
      }
      if (res.info) { r.courant = null; prefixe += res.info + " "; continue; }
      if (res.libre) { r.courant = null; r.etape = "libre"; return reponse(prefixe + res.libre, { champ: "texte" }); }
      // Code trouvé : un seul site par demande
      const site = siteDe(res.code);
      const siteDemande = r.lignes.length ? siteDe(r.lignes[0].code) : null;
      if (siteDemande && site !== siteDemande) {
        r.courant = null;
        prefixe += T(r, `« ${libelle(res.code, r.langue)} » se dépose à ${SITES[site]}, pas à ${SITES[siteDemande]} : faites une demande séparée pour ce site (bouton « Nouvelle conversation »). `,
          `“${libelle(res.code, r.langue)}” wordt gestort in ${SITES[site]}, niet in ${SITES[siteDemande]}: doe een aparte aanvraag voor die site (knop “Nieuw gesprek”). `);
        continue;
      }
      if (!e.quantite) {
        r.etape = "quantite"; e.code = res.code;
        const texte = e.m3
          ? T(r, `Vous avez indiqué ${String(e.m3).replace(".", ",")} m³. Combien de tonnes cela fait-il environ ? (Comptez environ 1,5 t par m³ pour du béton ou des briques, 1,8 t par m³ pour des terres.)`,
            `U gaf ${String(e.m3).replace(".", ",")} m³ op. Hoeveel ton is dat ongeveer? (Reken op ongeveer 1,5 t per m³ voor beton of bakstenen, 1,8 t per m³ voor grond.)`)
          : T(r, `${libelle(res.code, r.langue)} : combien de tonnes environ ?`, `${libelle(res.code, r.langue)}: hoeveel ton ongeveer?`);
        return reponse(prefixe + texte, { champ: "nombre" });
      }
      r.lignes.push({ code: res.code, quantite: e.quantite, ...(e.note ? { note: e.note } : {}) });
      r.site = site;
      r.courant = null;
      if (r.file.length) continue;
      r.etape = "plus";
      return reponse(prefixe + T(r, `C'est noté : ${String(e.quantite).replace(".", ",")} t de ${libelle(res.code, r.langue).charAt(0).toLowerCase() + libelle(res.code, r.langue).slice(1)}. Avez-vous autre chose à ajouter ?`,
        `Genoteerd: ${String(e.quantite).replace(".", ",")} t ${libelle(res.code, r.langue).charAt(0).toLowerCase() + libelle(res.code, r.langue).slice(1)}. Wilt u nog iets toevoegen?`),
      { boutons: [b(r, "plus", "Ajouter une autre matière", "Nog een materiaal toevoegen"), b(r, "fini", "Non, c'est tout", "Nee, dat is alles")] });
    }
    // Plus rien en attente
    if (!r.lignes.length && !r.libre) {
      r.etape = "accueil";
      return reponse(prefixe + T(r, "Que voulez-vous déposer ou acheter ?", "Wat wilt u storten of kopen?"), { boutons: boutonsMatiere(r) });
    }
    return demanderContact(r, prefixe);
  }
  return reponse(T(r, "Je n'ai pas compris.", "Ik heb het niet begrepen."));
};

const demanderContact = (r, prefixe = "") => {
  if (r.contact) return recap(r, prefixe);
  r.etape = "contact";
  return reponse(prefixe + T(r, "Pour finir, vos coordonnées : nom, société (si vous en avez une), e-mail et téléphone.", "Tot slot uw gegevens: naam, bedrijf (indien van toepassing), e-mail en telefoon."), { champ: "contact" });
};

const recap = (r, prefixe = "") => {
  r.etape = "recap";
  return reponse(prefixe + T(r, "Voici le récapitulatif de votre demande. Est-ce que tout est correct ?", "Hier is het overzicht van uw aanvraag. Klopt alles?"), {
    recap: true,
    boutons: [b(r, "oui", "Oui, j'envoie ma demande", "Ja, ik verstuur mijn aanvraag"), b(r, "non", "Non, je modifie", "Nee, ik pas aan")]
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

// Point d'entrée unique
const repondre = (conversation, entree = {}) => {
  const r = conversation.robot || (conversation.robot = etatNeuf(conversation.langue === "nl" ? "nl" : "fr"));
  const texte = String(entree.texte || "").trim();
  const bouton = entree.bouton ? String(entree.bouton) : null;
  const t = norm(texte);

  if (!texte && !bouton && entree.nombre == null && !entree.contact) {
    if (r.etape === "accueil" && !r.lignes.length) return reponse(ACCUEIL(r), { boutons: boutonsMatiere(r) });
    return reponse("");
  }

  // Demande déjà envoyée
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
    if (bouton === "non") {
      r.etape = "modifier";
      return reponse(T(r, "Que voulez-vous modifier ?", "Wat wilt u aanpassen?"), { boutons: [
        b(r, "matieres", "Les matières ou les quantités", "De materialen of hoeveelheden"), b(r, "contact", "Mes coordonnées", "Mijn gegevens"), b(r, "recommencer", "Tout recommencer", "Alles opnieuw")] });
    }
    return reponse(T(r, "Pour confirmer, cliquez sur le bouton « Oui, j'envoie ma demande ». Pour changer quelque chose, cliquez sur « Non, je modifie ».",
      "Klik om te bevestigen op de knop “Ja, ik verstuur mijn aanvraag”. Om iets te wijzigen, klik op “Nee, ik pas aan”."), {
      boutons: [b(r, "oui", "Oui, j'envoie ma demande", "Ja, ik verstuur mijn aanvraag"), b(r, "non", "Non, je modifie", "Nee, ik pas aan")] });
  }

  if (r.etape === "modifier") {
    if (bouton === "contact") { r.contact = null; return demanderContact(r); }
    if (bouton === "matieres") { Object.assign(r, { lignes: [], file: [], courant: null, libre: null, site: null, echecs: 0, etape: "accueil" }); return reponse(T(r, "D'accord. Que voulez-vous déposer ou acheter ?", "Goed. Wat wilt u storten of kopen?"), { boutons: boutonsMatiere(r) }); }
    if (bouton === "recommencer") { const contact = r.contact; conversation.robot = Object.assign(etatNeuf(r.langue), { contact: null }); void contact; return reponse(ACCUEIL(conversation.robot), { boutons: boutonsMatiere(conversation.robot) }); }
    return reponse(T(r, "Que voulez-vous modifier ?", "Wat wilt u aanpassen?"), { boutons: [
      b(r, "matieres", "Les matières ou les quantités", "De materialen of hoeveelheden"), b(r, "contact", "Mes coordonnées", "Mijn gegevens"), b(r, "recommencer", "Tout recommencer", "Alles opnieuw")] });
  }

  // Coordonnées (cases du formulaire)
  if (r.etape === "contact") {
    const c = entree.contact || {};
    const nom = String(c.nom || "").trim().slice(0, 120), email = String(c.email || "").trim().slice(0, 160);
    const telephone = String(c.telephone || "").trim().slice(0, 40), societe = String(c.societe || "").trim().slice(0, 120);
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), telOk = telephone.replace(/\D/g, "").length >= 8;
    if (!nom || (!emailOk && !telOk) || (email && !emailOk)) {
      return reponse(T(r, "Indiquez au moins votre nom et un e-mail valide ou un numéro de téléphone, dans les cases ci-dessous.",
        "Vul ten minste uw naam en een geldig e-mailadres of telefoonnummer in, in de vakjes hieronder."), { champ: "contact" });
    }
    r.contact = { nom, societe, email: emailOk ? email : "", telephone };
    return recap(r);
  }

  // Texte libre (après 2 incompréhensions ou « Autre demande »)
  if (r.etape === "libre") {
    if (!texte) return reponse(T(r, "Écrivez votre demande dans la case ci-dessous.", "Schrijf uw vraag in het vak hieronder."), { champ: "texte" });
    r.libre = (r.libre ? r.libre + "\n" : "") + texte.slice(0, 2000);
    return demanderContact(r, T(r, "Merci, c'est noté. ", "Bedankt, genoteerd. "));
  }

  // Quantité
  if (r.etape === "quantite" && r.courant) {
    const mt = t.match(RE_TONNES), mm = t.match(RE_M3);
    const n = entree.nombre != null ? nombre(entree.nombre) : mt ? nombre(mt[1]) : (!mm && /^\d+([.,]\d+)?$/.test(t)) ? nombre(t) : null;
    if (mm && !mt && entree.nombre == null) { r.courant.m3 = nombre(mm[1]); return avancer(r); }
    if (!n) return reponse(T(r, "Indiquez un nombre de tonnes (par exemple 12).", "Geef een aantal ton in (bijvoorbeeld 12)."), { champ: "nombre" });
    r.courant.quantite = n;
    return avancer(r);
  }

  // « Autre chose à ajouter ? »
  if (r.etape === "plus") {
    if (bouton === "fini" || /^(non|nee|c est tout|dat is alles|rien|niets)\b/.test(t)) return demanderContact(r);
    if (bouton === "plus") { r.etape = "accueil"; return reponse(T(r, "Que voulez-vous ajouter ?", "Wat wilt u toevoegen?"), { boutons: boutonsMatiere(r) }); }
    // sinon : le texte décrit peut-être une nouvelle matière (traité plus bas)
  }

  // Réponse à une question sur la matière en cours
  if (r.etape === "question" && r.courant) {
    // Un bouton n'est valable que s'il fait partie de la question posée
    const posee = questions[r.courant.famille](r, r.courant).question;
    const boutonValide = bouton && posee && posee.boutons.some((x) => x.v === bouton) ? bouton : null;
    if (bouton && !boutonValide) return reponse(posee ? posee.texte : T(r, "Choisissez une réponse ci-dessous.", "Kies een antwoord hieronder."), { boutons: posee ? posee.boutons : [] });
    const v = boutonValide || (LIRE[r.cle] ? LIRE[r.cle](t) : null);
    if (v) {
      r.courant.rep[r.cle] = v;
      if (r.cle === "site" && v !== "nsp") { r.courant.rep.site = v; }
      r.courant.essais = 0;
      return avancer(r);
    }
    // Le client décrit autre chose : on le traite comme une nouvelle demande s'il cite une matière
    if (!analyser(texte).elements.length) {
      r.courant.essais = (r.courant.essais || 0) + 1;
      if (r.courant.essais >= 2) { r.courant = null; r.file = []; return incompris(Object.assign(r, { echecs: 1 })); }
      const res = questions[r.courant.famille](r, r.courant);
      return reponse(T(r, "Choisissez une réponse ci-dessous. ", "Kies een antwoord hieronder. ") + (res.question ? res.question.texte : ""), { boutons: res.question ? res.question.boutons : [] });
    }
    r.courant = null;
  }

  // Boutons de l'accueil
  if (bouton === "autre") {
    r.etape = "libre";
    return reponse(T(r, "Écrivez votre demande, notre équipe vous répond.", "Schrijf uw vraag, ons team antwoordt u."), { champ: "texte" });
  }
  if (bouton && bouton.startsWith("m:")) {
    const famille = bouton.slice(2);
    if (!questions[famille]) return incompris(r);
    r.file.push({ famille, quantite: null, m3: null, texte: "", rep: {}, operation: famille === "granulat" ? "retrait" : "depot" });
    r.echecs = 0;
    return avancer(r);
  }
  if (bouton) return avancer(r);

  // Texte libre : recherche des matières, quantités, site et opération
  const a = analyser(texte);
  if (!a.elements.length) return incompris(r);
  r.echecs = 0;
  if (a.site) r.site = r.lignes.length ? r.site : a.site;
  for (const e of a.elements) {
    e.operation = a.operation || (["granulat", "sable", "stabilise"].includes(e.famille) ? "retrait" : "depot");
    if (a.site && e.famille === "terre") e.rep.site = a.site;
    r.file.push(e);
  }
  return avancer(r);
};

// Récapitulatif pour l'affichage et pour NewTonne (le serveur ajoute les prix)
const resume = (r) => ({
  lignes: r.lignes.map((l) => ({ code: l.code, quantite: l.quantite, note: l.note || null })),
  site: r.lignes.length ? siteDe(r.lignes[0].code) : null,
  libre: r.libre || null,
  contact: r.contact || null,
  analyse: !!r.analyseAJoindre
});

module.exports = { repondre, resume, libelle, siteDe, SITES, LIBELLES, _analyser: analyser, _norm: norm };
