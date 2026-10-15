/* Outils Recymo : calculateur de prix, recherche « puis-je déposer ? »,
   horaires en direct des sites. Les prix reprennent la page tarifs.html :
   à mettre à jour en même temps qu'elle. */
(function () {
  "use strict";

  var TVA = 0.21;
  var SUPPLEMENT_PETIT = 7.5;   // par versage ou enlèvement de moins de 5 tonnes
  var SEUIL_PETIT = 5;
  var reduit = function () { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); };

  /* ---------- Sites et horaires ---------- */
  // Jours : 1 = lundi … 6 = samedi, 0 = dimanche. Heures en minutes.
  var SITES = {
    braives: {
      nom: "Braives", code: "WT062991", adresse: "Rue Roua 6, 4260 Braives",
      dest: "50.5753235,5.2076884",
      horaires: { 1: [420, 1020], 2: [420, 1020], 3: [420, 1020], 4: [420, 1020], 5: [420, 1020], 6: [480, 720] }
    },
    sambreville: {
      nom: "Sambreville", code: "WT050579", adresse: "Rue de la Larronnerie, 5060 Sambreville",
      horaires: { 1: [420, 990], 2: [420, 990], 3: [420, 990], 4: [420, 990], 5: [420, 990] }
    },
    transinnes: {
      nom: "Transinnes", code: "WT011403", adresse: "Grand Route, 6890 Libin",
      horaires: { 1: [420, 945], 2: [420, 945], 3: [420, 945] },
      note: "Jeudi et vendredi sur demande (minimum 1000 t par jour)."
    },
    fosses: {
      nom: "Fosses-la-Ville", code: "WT026437", adresse: "Rue Adelin Beguin, 5070 Fosses-la-Ville",
      horaires: { 1: [420, 1020], 2: [420, 1020], 3: [420, 1020], 4: [420, 1020], 5: [420, 1020] }
    }
  };
  var JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

  var heure = function (m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return h + "h" + (mm < 10 ? "0" : "") + mm;
  };

  // Heure de Bruxelles, quel que soit le fuseau du visiteur
  var maintenant = function () {
    try {
      var parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Brussels", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
      }).formatToParts(new Date());
      var get = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
      var jour = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
      return { jour: jour, min: (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10) };
    } catch (e) {
      var d = new Date();
      return { jour: d.getDay(), min: d.getHours() * 60 + d.getMinutes() };
    }
  };

  var statut = function (site) {
    var t = maintenant(), h = site.horaires[t.jour];
    if (h && t.min >= h[0] && t.min < h[1]) {
      return { ouvert: true, texte: "Ouvert", detail: "ferme à " + heure(h[1]) };
    }
    if (h && t.min < h[0]) {
      return { ouvert: false, texte: "Fermé", detail: "ouvre aujourd'hui à " + heure(h[0]) };
    }
    for (var i = 1; i <= 7; i++) {
      var j = (t.jour + i) % 7;
      if (site.horaires[j]) {
        return { ouvert: false, texte: "Fermé", detail: "ouvre " + (i === 1 ? "demain" : JOURS[j]) + " à " + heure(site.horaires[j][0]) };
      }
    }
    return { ouvert: false, texte: "Fermé", detail: "" };
  };

  var majStatuts = function () {
    document.querySelectorAll("[data-statut]").forEach(function (el) {
      var site = SITES[el.getAttribute("data-statut")];
      if (!site) return;
      var s = statut(site);
      el.classList.toggle("is-open", s.ouvert);
      el.classList.toggle("is-closed", !s.ouvert);
      el.innerHTML = '<span class="dot" aria-hidden="true"></span><strong>' + s.texte + "</strong>" + (s.detail ? " · " + s.detail : "");
    });
  };

  document.querySelectorAll("[data-itineraire]").forEach(function (a) {
    var site = SITES[a.getAttribute("data-itineraire")];
    if (!site) return;
    var dest = encodeURIComponent(site.dest || site.adresse + ", Belgique");
    a.href = a.getAttribute("data-app") === "waze"
      ? (site.dest ? "https://waze.com/ul?ll=" + dest + "&navigate=yes" : "https://waze.com/ul?q=" + dest + "&navigate=yes")
      : "https://www.google.com/maps/dir/?api=1&destination=" + dest;
  });

  majStatuts();
  setInterval(majStatuts, 60000);

  // Guide des classes : les prix affichés suivent le tableau des tarifs
  var syncPrix = function () {
    document.querySelectorAll("[data-prix-de]").forEach(function (el) {
      var cell = document.querySelector('[data-edit="' + el.getAttribute("data-prix-de") + '"]');
      if (!cell) return;
      var t = cell.textContent.trim();
      el.textContent = /€/.test(t) && !/\/t/.test(t) ? t + "/t" : t;
    });
  };
  syncPrix();

  // Horaires modifiables depuis l'admin : assets/data/horaires.json remplace les valeurs ci-dessus
  var enMinutes = function (hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; };
  window.recymoHoraires = function (data) {
    Object.keys(data).forEach(function (k) {
      if (!SITES[k]) return;
      var h = {};
      Object.keys(data[k].jours || {}).forEach(function (j) {
        h[j] = [enMinutes(data[k].jours[j][0]), enMinutes(data[k].jours[j][1])];
      });
      SITES[k].horaires = h;
    });
    majStatuts();
  };
  if (window.fetch && document.querySelector("[data-statut]")) {
    fetch("assets/data/horaires.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) window.recymoHoraires(d); })
      .catch(function () {});
  }

  /* ---------- Matériaux et prix ---------- */
  // prix : €/t HTVA, null = à convenir. supp : supplément si moins de 5 t.
  var CALC = [
    { groupe: "Déposer des bétons", sujet: "Versage classe 3", onglet: "versage-classe3", supp: true, items: [
      ["B0", "B0 · Béton non armé, sans terre ni fines", 0],
      ["B1", "B1 · Béton légèrement armé, hors dimensions ou avec fines", 5],
      ["B2", "B2 · Béton légèrement armé et/ou légèrement terreux", 8],
      ["B3", "B3 · Béton fortement armé et/ou fortement terreux", 10],
      ["B4", "B4 · Béton-tarmac terreux", 12],
      ["B5", "B5 · Béton très fortement armé, sale ou terreux", null],
      ["B6", "B6 · Petites pierrailles terreuses", 14],
      ["POT", "Poteaux, hourdis, piquets et dalles de clôture", 22]
    ] },
    { groupe: "Déposer des bricaillons", sujet: "Versage classe 3", onglet: "versage-classe3", supp: true, items: [
      ["BR0", "BR0 · Bricaillons propres, sans fines et sans terre", 0],
      ["BR1", "BR1 · Bricaillons propres", 5],
      ["BR2", "BR2 · Bricaillons légèrement sales ou terreux", 8],
      ["BR3", "BR3 · Bricaillons sales ou terreux", 10],
      ["BR4", "BR4 · Bricaillons très sales ou très terreux", 12],
      ["BR5", "BR5 · Bricaillons terreux, moins de 50 % de terres", 14],
      ["BR6", "BR6 · Bricaillons terreux, plus de 50 % de terres", 18],
      ["BR7", "BR7 · Déchets classe 3 en mélange", null],
      ["BR8", "BR8 · Ardoises naturelles", 20],
      ["BR9", "BR9 · Carrelages", 12],
      ["BR10", "BR10 · Bricaillons terreux, moins de 25 % de bricaillons", 25]
    ] },
    { groupe: "Déposer d'autres déchets", sujet: "Versage classe 3", onglet: "versage-classe3", supp: true, items: [
      ["YT", "Béton cellulaire (Ytong…)", 90],
      ["TA", "TA · Tarmac bitumineux", 8],
      ["BT", "B-T · Béton avec tarmac", 8],
      ["TN", "TN · Déchets classe 3 terreux non criblables", 30]
    ] },
    { groupe: "Déposer des terres · Braives", sujet: "Versage terre", onglet: "versage-terre", site: "braives", items: [
      ["T-BR", "Terres type I à V, petits versages (avec analyse)", 25],
      ["T-BR-GROS", "Terres type I à V, gros chantier", null]
    ] },
    { groupe: "Déposer des terres · Fosses-la-Ville", sujet: "Versage terre", onglet: "versage-terre", site: "fosses", items: [
      ["T-FO", "Terres type I et II", 9.85]
    ] },
    { groupe: "Déposer des terres · Transinnes", sujet: "Versage terre", onglet: "versage-terre", site: "transinnes", items: [
      ["T-TR", "Terres type I et II", 7.45]
    ] },
    { groupe: "Déposer des terres · Sambreville", sujet: "Versage terre", onglet: "versage-terre", site: "sambreville", items: [
      ["T-SA-13", "Terres type I à III, sans analyse (< 400 m³)", 18],
      ["T-SA-45", "Terres type IV à V, sans analyse (< 400 m³)", 23],
      ["T-SA-AN", "Terres type I à V, avec analyse", 18],
      ["T-SA-INV", "Terres avec plantes invasives (renouée du Japon…)", 40],
      ["T-SA-AM", "Terres avec fibres d'amiante de 100 à 500 mg/kg MS", 32.5]
    ] },
    { groupe: "Acheter des granulats (départ Braives)", sujet: "Achat de granulats", onglet: "granulats", supp: true, achat: true, items: [
      ["G-MIX", "Mixte 0/63", 5],
      ["G-TA32", "Tarmac 0/32", 7.5],
      ["G-TA63", "Tarmac 0/63", 5],
      ["G-BE32", "Béton 0/32", 9.8],
      ["G-BE60", "Béton 0/60", 7.5],
      ["G-BE2560", "Béton 25/60", 10.8],
      ["G-SAB", "Sable jaune", 8.85],
      ["G-STAB", "Stabiter 0/32", 0]
    ] }
  ];

  var euro = function (n) {
    return n.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  };
  var tonnes = function (n) {
    return n.toLocaleString("fr-BE", { maximumFractionDigits: 2 }) + " t";
  };

  var calc = document.getElementById("calc");
  if (calc) {
    var rows = calc.querySelector("#calc-rows");
    var addBtn = calc.querySelector("#calc-add");
    var out = calc.querySelector("#calc-resultat");
    var MAX_LIGNES = 10;
    var index = {};
    var options = '<option value="">Choisir un matériau…</option>';

    CALC.forEach(function (g) {
      options += '<optgroup label="' + g.groupe + '">';
      g.items.forEach(function (it) {
        options += '<option value="' + it[0] + '">' + it[1] + "</option>";
        index[it[0]] = { groupe: g, label: it[1], prix: it[2] };
      });
      options += "</optgroup>";
    });

    var uid = 0;
    var numeroter = function () {
      var lis = rows.querySelectorAll(".calc-row");
      lis.forEach(function (li, i) {
        li.querySelector(".calc-row-num").textContent = "Matériau " + (i + 1);
        var del = li.querySelector(".calc-del");
        del.hidden = lis.length === 1;
        del.setAttribute("aria-label", "Retirer le matériau " + (i + 1));
      });
      addBtn.hidden = lis.length >= MAX_LIGNES;
    };

    var ajouterLigne = function (code, quantite) {
      var n = ++uid;
      var li = document.createElement("li");
      li.className = "calc-row";
      li.innerHTML =
        '<div class="field calc-mat">' +
          '<label for="calc-m' + n + '" class="calc-row-num"></label>' +
          '<select id="calc-m' + n + '">' + options + "</select>" +
        "</div>" +
        '<div class="field calc-q">' +
          '<label for="calc-q' + n + '">Tonnes</label>' +
          '<input id="calc-q' + n + '" type="number" inputmode="decimal" min="0" step="0.5" placeholder="Ex. 12" aria-describedby="calc-q' + n + '-err">' +
          '<span class="err" id="calc-q' + n + '-err">Indiquez un nombre de tonnes supérieur à zéro.</span>' +
        "</div>" +
        '<button type="button" class="calc-del"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
      if (code) li.querySelector("select").value = code;
      if (quantite) li.querySelector("input").value = quantite;
      if (rows.children.length) {
        li.classList.add("is-new");
        li.addEventListener("animationend", function () { li.classList.remove("is-new"); }, { once: true });
      }
      rows.appendChild(li);
      numeroter();
      return li;
    };

    var lireLignes = function () {
      return Array.prototype.map.call(rows.querySelectorAll(".calc-row"), function (li) {
        var input = li.querySelector("input");
        var q = parseFloat(String(input.value).replace(",", "."));
        var valide = !isNaN(q) && q > 0;
        input.closest(".field").classList.toggle("invalid", input.value !== "" && !valide);
        var code = li.querySelector("select").value;
        var m = index[code];
        if (m) m = Object.assign({}, m, { prix: prixAffiche(code, m.prix) });
        return { m: m, q: valide ? q : null };
      }).filter(function (l) { return l.m; });
    };

    // Le prix affiché dans le tableau de la page (modifiable en mode admin) prime sur la valeur par défaut
    var prixAffiche = function (code, defaut) {
      var cell = document.querySelector('[data-edit="prix-' + code + '"]');
      if (!cell) return defaut;
      var t = cell.textContent.trim();
      if (/gratuit/i.test(t)) return 0;
      var n = parseFloat(t.replace(/\s/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
      return /\d/.test(t) && !isNaN(n) ? n : null;
    };
    window.recymoRecalculer = function () { calculer(); syncPrix(); };

    var calculer = function () {
      var lignes = lireLignes();
      if (!lignes.length) { out.innerHTML = ""; return; }

      var total = 0, detail = "", surDemande = [], manqueQte = 0;
      var onglets = {}, sujets = {}, message = [];

      lignes.forEach(function (l) {
        var m = l.m, site = m.groupe.site ? SITES[m.groupe.site] : null;
        onglets[m.groupe.onglet] = true;
        sujets[m.groupe.sujet] = true;
        message.push("- " + (m.groupe.achat ? "Achat : " : "Versage : ") + m.label +
          (l.q ? ", environ " + tonnes(l.q) : "") + (site ? " (site de " + site.nom + ")" : ""));

        if (m.prix === null) { surDemande.push(m.label); return; }
        if (!l.q) { manqueQte++; return; }

        var base = Math.round(m.prix * l.q * 100) / 100;
        var supp = m.groupe.supp && l.q < SEUIL_PETIT ? SUPPLEMENT_PETIT : 0;
        total += base + supp;
        detail +=
          '<div><dt>' + m.label + (site ? " · " + site.nom : "") +
          '<span>' + tonnes(l.q) + " × " + euro(m.prix) + (supp ? " + supplément moins de 5 t " + euro(supp) : "") + "</span></dt>" +
          "<dd>" + euro(base + supp) + "</dd></div>";
      });

      total = Math.round(total * 100) / 100;
      var tva = Math.round(total * TVA * 100) / 100;
      var sujetsListe = Object.keys(sujets);
      var devis = "contact.html?sujet=" + encodeURIComponent(sujetsListe.length === 1 ? sujetsListe[0] : "De devis") +
        "&message=" + encodeURIComponent("Demande de prix pour :\n" + message.join("\n")) + "#formulaire";
      var liens = Object.keys(onglets).map(function (o) {
        var nom = { "versage-classe3": "versage classe 3", "versage-terre": "versage terre", "granulats": "granulats" }[o];
        return '<a href="tarifs.html#' + o + '">' + nom + "</a>";
      }).join(", ");

      var html = "";
      if (detail) {
        html +=
          '<p class="calc-label">Estimation' + (lignes.length > 1 ? " pour " + lignes.length + " matériaux" : "") + "</p>" +
          '<p class="calc-total">' + euro(total) + ' <span>HTVA</span></p>' +
          '<p class="calc-ttc">' + euro(total + tva) + " TVAC</p>" +
          '<dl class="calc-lines">' + detail + '<div class="calc-tva"><dt>TVA 21 %</dt><dd>' + euro(tva) + "</dd></div></dl>";
      } else if (surDemande.length) {
        html += '<p class="calc-total">Prix sur demande</p>';
      } else {
        html += '<p class="calc-unit">Indiquez les quantités pour obtenir le total.</p>';
      }
      if (detail && surDemande.length) {
        html += '<p class="calc-warn">Non compris : ' + surDemande.join(", ") + " (prix sur demande).</p>";
      } else if (!detail && surDemande.length) {
        html += "<p>" + surDemande.join(", ") + " : facturé au cas par cas.</p>";
      }
      if (detail && manqueQte) {
        html += '<p class="calc-warn">' + (manqueQte === 1 ? "Un matériau n'a pas encore de quantité." : manqueQte + " matériaux n'ont pas encore de quantité.") + "</p>";
      }
      html +=
        '<p class="calc-note">Prix indicatif, établi d\'après le tarif en vigueur. Le poids réel est mesuré sur notre bascule' +
        (lignes.length > 1 ? " ; le supplément de moins de 5 t s'applique par matériau" : "") + "." +
        (onglets["versage-classe3"] ? " Un versage non conforme est facturé comme classe 2." : "") +
        (onglets["versage-terre"] ? " Terres : sous réserve d'acceptation préalable par notre service qualité." : "") +
        (Object.keys(onglets).length > 1 ? " Tarifs détaillés : " : " Tarif détaillé : ") + liens + ".</p>" +
        '<div class="calc-actions"><a class="btn btn-primary" href="' + devis + '">' + (detail ? "Demander un devis" : "Demander un prix") + '</a><a class="btn btn-outline" href="tel:+3285217445">085 21 74 45</a></div>';
      out.innerHTML = html;
      animerTotal(detail ? total : null);
      if (detail && !estimationComptee && window.recymoStat) { estimationComptee = true; window.recymoStat("estimation"); }
    };
    var estimationComptee = false;

    // Le total défile jusqu'à sa nouvelle valeur ; une nouvelle saisie annule l'animation en cours
    var dernierTotal = null, anim = 0;
    var animerTotal = function (valeur) {
      var el = out.querySelector(".calc-total");
      var depart = dernierTotal;
      dernierTotal = valeur;
      cancelAnimationFrame(anim);
      if (!el || valeur === null || depart === null || depart === valeur || reduit()) return;
      var span = el.querySelector("span").outerHTML;
      var t0 = performance.now(), duree = 450;
      el.classList.add("is-updated");
      var pas = function (t) {
        var p = Math.min(1, (t - t0) / duree);
        var e = 1 - Math.pow(1 - p, 3);
        el.innerHTML = euro(depart + (valeur - depart) * e) + " " + span;
        if (p < 1) anim = requestAnimationFrame(pas);
      };
      anim = requestAnimationFrame(pas);
    };

    rows.addEventListener("change", calculer);
    rows.addEventListener("input", calculer);
    rows.addEventListener("click", function (e) {
      var del = e.target.closest(".calc-del");
      if (!del || del.closest(".is-leaving")) return;
      var li = del.closest(".calc-row");
      var prev = li.previousElementSibling || li.nextElementSibling;
      var retirer = function () {
        li.remove();
        numeroter();
        calculer();
        if (prev) prev.querySelector("select").focus();
      };
      if (reduit()) { retirer(); return; }
      li.classList.add("is-leaving");
      setTimeout(retirer, 150);
    });
    addBtn.addEventListener("click", function () {
      ajouterLigne().querySelector("select").focus();
      calculer();
    });

    ajouterLigne();
    calculer();
  }

  /* ---------- Puis-je déposer ? ---------- */
  // mots : termes de recherche (sans accents). rep : réponse affichée.
  var DECHETS = [
    { mots: "beton non arme propre dalle fondation", nom: "Béton non armé", rep: "Accepté. 0 € la tonne s'il est propre, sans terre ni fines (max. 50 × 50 × 150 cm).", lien: "versage-classe3" },
    { mots: "beton arme ferraille armature", nom: "Béton armé", rep: "Accepté. De 5 à 10 €/t selon l'armature et la terre ; très fortement armé : à convenir.", lien: "versage-classe3" },
    { mots: "poteau hourdis piquet dalle cloture", nom: "Poteaux, hourdis, piquets, dalles de clôture", rep: "Accepté. 22 €/t.", lien: "versage-classe3" },
    { mots: "pierraille caillou pierre", nom: "Petites pierrailles terreuses", rep: "Accepté. 14 €/t.", lien: "versage-classe3" },
    { mots: "bricaillon brique maconnerie debris demolition gravat", nom: "Bricaillons (briques, maçonnerie)", rep: "Accepté. De 0 €/t (propres, sans fines) à 25 €/t selon la terre et la propreté.", lien: "versage-classe3" },
    { mots: "ardoise toiture", nom: "Ardoises naturelles", rep: "Accepté. 20 €/t.", lien: "versage-classe3" },
    { mots: "carrelage faience", nom: "Carrelages", rep: "Accepté. 12 €/t.", lien: "versage-classe3" },
    { mots: "ytong beton cellulaire siporex", nom: "Béton cellulaire (Ytong…)", rep: "Accepté. 90 €/t.", lien: "versage-classe3" },
    { mots: "tarmac asphalte enrobe bitume hydrocarbone route", nom: "Tarmac bitumineux", rep: "Accepté. 8 €/t (aussi béton avec tarmac : 8 €/t ; béton-tarmac terreux : 12 €/t).", lien: "versage-classe3" },
    { mots: "melange classe 3 inerte", nom: "Déchets classe 3 en mélange", rep: "Accepté, prix à convenir. Appelez-nous avant de venir.", lien: "versage-classe3" },
    { mots: "terreux non criblable", nom: "Déchets classe 3 terreux non criblables", rep: "Accepté. 30 €/t.", lien: "versage-classe3" },
    { mots: "terre terres excavee remblai deblai sol", nom: "Terres excavées", rep: "Acceptées sur nos 4 sites, de 7,45 à 25 €/t selon le site et le type de terre (I à V). Acceptation préalable par notre service qualité.", lien: "versage-terre" },
    { mots: "terre vegetale humus", nom: "Terre végétale", rep: "Acceptée. Le prix dépend du site et du type de terre : appelez-nous ou consultez le tarif terres.", lien: "versage-terre" },
    { mots: "renouee japon plante invasive", nom: "Terres avec plantes invasives", rep: "Acceptées uniquement à Sambreville, 40 €/t.", lien: "versage-terre" },
    { mots: "amiante fibre", nom: "Terres contenant des fibres d'amiante", rep: "Uniquement des terres avec 100 à 500 mg/kg MS de fibres d'amiante, à Sambreville, 32,50 €/t. Pour tout autre déchet amianté, appelez-nous.", lien: "versage-terre" }
  ];
  var plain = function (s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").trim();
  };

  var finder = document.getElementById("finder");
  if (finder) {
    var input = finder.querySelector("input");
    var res = finder.querySelector(".finder-results");
    // Les résultats n'apparaissent en fondu que lorsque la liste change vraiment
    var derniere = "";
    var montrer = function (cle, html) {
      if (cle === derniere) { res.classList.remove("is-new"); res.innerHTML = html; return; }
      derniere = cle;
      res.classList.remove("is-new");
      res.innerHTML = html;
      void res.offsetWidth;
      if (html) res.classList.add("is-new");
    };
    var chercher = function () {
      var q = plain(input.value);
      if (q.length < 2) { montrer("", ""); return; }
      var mots = q.split(/\s+/);
      var trouves = DECHETS.filter(function (d) {
        var hay = plain(d.nom) + " " + d.mots;
        return mots.every(function (m) { return hay.indexOf(m) !== -1 || hay.split(" ").some(function (w) { return m.length > 3 && w.indexOf(m.slice(0, -1)) === 0; }); });
      });
      trouves.sort(function (a, b) { return (plain(b.nom).indexOf(q) !== -1) - (plain(a.nom).indexOf(q) !== -1); });
      if (!trouves.length) {
        montrer("?",
          '<div class="finder-item is-unknown"><p><strong>« ' + input.value.replace(/</g, "&lt;") + " » n'est pas dans notre liste.</strong> " +
          "Nous acceptons les déchets inertes de chantier et les terres. Appelez-nous avant de venir, on vous dira tout de suite si c'est possible.</p>" +
          '<a class="btn btn-dark btn-sm" href="tel:+3285217445">Appeler le 085 21 74 45</a></div>');
        return;
      }
      trouves = trouves.slice(0, 4);
      montrer(trouves.map(function (d) { return d.nom; }).join("|"), trouves.map(function (d) {
        return '<div class="finder-item"><p><strong>' + d.nom + "</strong> " + d.rep + '</p><a href="tarifs.html#' + d.lien + '">Voir le tarif</a></div>';
      }).join(""));
    };
    input.addEventListener("input", chercher);
    finder.addEventListener("submit", function (e) { e.preventDefault(); chercher(); });
    finder.querySelectorAll("[data-suggest]").forEach(function (b) {
      b.addEventListener("click", function () { input.value = b.textContent; chercher(); input.focus(); });
    });
  }
})();
