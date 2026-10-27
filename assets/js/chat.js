/* Chat de devis (page Contact) : la conversation passe par le serveur Recymo (robot à règles).
   Le robot propose des boutons, une case pour les tonnes, les cases des coordonnées et une carte récapitulative.
   L'identifiant de la conversation est gardé dans le navigateur et dans un lien que le client peut garder. */
(function () {
  "use strict";
  var zone = document.getElementById("chat");
  var API = window.RECYMO_API;
  if (!zone || !API || !window.fetch) return;

  var NL = /^nl/.test(document.documentElement.lang);
  var T = function (fr, nl) { return NL ? nl : fr; };
  var CLE = "recymo-chat";
  var liste = zone.querySelector(".chat-messages");
  var form = zone.querySelector(".chat-form");
  var champ = form.querySelector("textarea");
  var bouton = form.querySelector("button");
  var etat = zone.querySelector(".chat-etat");
  var lienZone = zone.querySelector(".chat-lien");
  var id = null, attente = false, relecture = null, signature = "", flux = null;

  var lire = function () { try { return localStorage.getItem(CLE); } catch (e) { return null; } };
  var garder = function (v) { try { if (v) localStorage.setItem(CLE, v); else localStorage.removeItem(CLE); } catch (e) {} };
  var el = function (tag, cls, texte) { var n = document.createElement(tag); if (cls) n.className = cls; if (texte != null) n.textContent = texte; return n; };
  var euro = function (n) { return Number(n).toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; };
  var tonnes = function (n) { return Number(n).toLocaleString("fr-BE", { maximumFractionDigits: 3 }) + " t"; };

  var appel = function (methode, chemin, corps) {
    return fetch(API + chemin, {
      method: methode,
      headers: corps ? { "Content-Type": "application/json" } : {},
      body: corps ? JSON.stringify(corps) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw Object.assign(new Error(d.erreur || "Erreur"), { status: r.status });
        return d;
      });
    });
  };

  // Texte en paragraphes, sans HTML
  var paragraphes = function (parent, texte) {
    String(texte || "").split(/\n{2,}/).forEach(function (p) {
      if (!p) return;
      var n = el("p");
      p.split("\n").forEach(function (ligne, i) { if (i) n.appendChild(el("br")); n.appendChild(document.createTextNode(ligne)); });
      parent.appendChild(n);
    });
  };

  // Carte récapitulative : prix calculés par le serveur d'après la grille tarifaire
  var carte = function (rc) {
    var c = el("div", "chat-recap");
    if (rc.lignes && rc.lignes.length) {
      var table = el("table");
      rc.lignes.forEach(function (l) {
        var tr = el("tr");
        var td = el("td");
        td.appendChild(el("span", "chat-code", l.code));
        td.appendChild(document.createTextNode(" " + l.libelle));
        if (l.supplement) td.appendChild(el("small", null, T("Supplément moins de 5 t inclus", "Toeslag minder dan 5 t inbegrepen")));
        if (l.note) td.appendChild(el("small", null, l.note));
        tr.appendChild(td);
        tr.appendChild(el("td", "num", tonnes(l.quantite)));
        tr.appendChild(el("td", "num", l.montant === null ? T("à convenir", "op aanvraag") : euro(l.montant)));
        table.appendChild(tr);
      });
      var tot = el("tr", "chat-total");
      tot.appendChild(el("td", null, T("Total indicatif HTVA", "Indicatief totaal excl. btw")));
      tot.appendChild(el("td"));
      tot.appendChild(el("td", "num", euro(rc.totalHtva) + (rc.aConvenir ? " +" : "")));
      table.appendChild(tot);
      var tvac = el("tr", "chat-tvac");
      tvac.appendChild(el("td", null, T("TVAC (21 %)", "Incl. btw (21 %)")));
      tvac.appendChild(el("td"));
      tvac.appendChild(el("td", "num", euro(rc.totalTvac)));
      table.appendChild(tvac);
      c.appendChild(table);
    }
    if (rc.libre) {
      c.appendChild(el("p", "chat-recap-titre", T("Votre demande", "Uw aanvraag")));
      paragraphes(c, rc.libre);
    }
    var infos = el("dl");
    var ajout = function (dt, dd) { if (!dd) return; var d = el("div"); d.appendChild(el("dt", null, dt)); d.appendChild(el("dd", null, dd)); infos.appendChild(d); };
    ajout(T("Chantier", "Werf"), rc.chantier);
    ajout(T("Site", "Site"), rc.site && (rc.site + (rc.siteAdresse ? " · " + rc.siteAdresse : "")));
    var co = rc.coordonnees, fa = rc.facturation;
    if (co) {
      ajout(rc.profil === "entreprise" ? T("Société", "Bedrijf") : T("Client", "Klant"), rc.profil === "entreprise" ? co.societe : T("Particulier", "Particulier"));
      ajout(T("Contact", "Contact"), [co.nom, co.email, co.telephone].filter(Boolean).join(" · "));
    }
    if (fa) {
      ajout(T("Facturation", "Facturatie"), [fa.adresse, [fa.cp, fa.localite].filter(Boolean).join(" "), fa.pays].filter(Boolean).join(", "));
      if (fa.tva) ajout(T("TVA", "Btw"), fa.tva + (fa.tvaValide === false ? T(" (numéro à vérifier)", " (nummer na te kijken)") : ""));
      if (fa.emailFactures) ajout(T("Factures", "Facturen"), fa.emailFactures);
    }
    c.appendChild(infos);
    if (rc.analyse) c.appendChild(el("p", "chat-recap-note", T("Analyse de terres : envoyez-la à info@recymo.be ou avec le formulaire ci-dessous.", "Grondanalyse: stuur ze naar info@recymo.be of via het formulier hieronder.")));
    c.appendChild(el("p", "chat-recap-note", T("Prix indicatif, confirmé par Recymo après vérification.", "Indicatieve prijs, bevestigd door Recymo na controle.")));
    return c;
  };

  // Ce que le robot attend : boutons, nombre de tonnes ou coordonnées
  var actions = function (m) {
    var bloc = el("div", "chat-actions");
    if (m.boutons && m.boutons.length) {
      var rang = el("div", "chat-boutons");
      m.boutons.forEach(function (b) {
        var cls = b.v === "oui" ? "btn btn-primary btn-sm" : b.v === "non" ? "btn btn-outline btn-sm" : "chat-choix";
        var x = el("button", cls, b.l);
        x.type = "button";
        x.addEventListener("click", function () { envoyer({ bouton: b.v }, b.l); });
        rang.appendChild(x);
      });
      bloc.appendChild(rang);
    }
    if (m.champ === "nombre") {
      var f = el("form", "chat-nombre");
      var label = el("label", "sr-only", T("Nombre de tonnes", "Aantal ton"));
      var input = el("input");
      input.type = "number"; input.min = "0.1"; input.step = "0.1"; input.inputMode = "decimal"; input.required = true; input.id = "chat-tonnes";
      label.htmlFor = input.id;
      input.placeholder = T("Ex. 12", "Bv. 12");
      var unite = el("span", null, T("tonnes", "ton"));
      var ok = el("button", "btn btn-primary btn-sm", T("Valider", "Bevestigen"));
      ok.type = "submit";
      f.appendChild(label); f.appendChild(input); f.appendChild(unite); f.appendChild(ok);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = String(input.value).replace(",", ".");
        if (!(parseFloat(v) > 0)) { input.focus(); return; }
        envoyer({ nombre: v }, v.replace(".", ",") + " t");
      });
      bloc.appendChild(f);
      setTimeout(function () { input.focus({ preventScroll: true }); }, 50);
    }
    if (m.champ === "chantier" || m.champ === "coordonnees" || m.champ === "facturation") bloc.appendChild(formulaire(m));
    // Étape inconnue de cette version de la page (mise à jour du site pendant la conversation) : proposer de recharger
    if (m.champ && ["nombre", "texte", "chantier", "coordonnees", "facturation"].indexOf(m.champ) === -1) {
      var maj = el("div", "chat-maj");
      maj.appendChild(el("p", null, T("Le chat a été mis à jour. Rechargez la page pour continuer : votre conversation est gardée.", "De chat is bijgewerkt. Herlaad de pagina om verder te gaan: uw gesprek blijft bewaard.")));
      var recharger = el("button", "btn btn-primary btn-sm", T("Recharger la page", "Pagina herladen"));
      recharger.type = "button";
      recharger.addEventListener("click", function () { location.reload(); });
      maj.appendChild(recharger);
      bloc.appendChild(maj);
    }
    return bloc.children.length ? bloc : null;
  };

  // Numéro de TVA belge : 10 chiffres, 97 - (8 premiers % 97) = 2 derniers (avertissement, sans bloquer)
  var tvaValide = function (v) {
    var n = String(v || "").toUpperCase().replace(/^BE/, "").replace(/\D/g, "");
    if (n.length === 9) n = "0" + n;
    return /^[01]\d{9}$/.test(n) && 97 - (Number(n.slice(0, 8)) % 97) === Number(n.slice(8));
  };

  // Formulaires du robot, dans l'ordre logique : chantier → personne de contact → facturation
  var formulaire = function (m) {
    var v = m.valeurs || {};
    var entreprise = v.profil === "entreprise";
    var champs, titre, envoi;
    if (m.champ === "chantier") {
      champs = [
        { n: "cp", l: T("Code postal du chantier", "Postcode van de werf") + " *", type: "text", auto: "postal-code", requis: true, mode: "numeric", max: 4, court: true },
        { n: "rue", l: T("Rue et numéro (facultatif)", "Straat en nummer (optioneel)"), type: "text", auto: "address-line1" }
      ];
      envoi = T("Valider", "Bevestigen");
    } else if (m.champ === "coordonnees") {
      champs = (entreprise ? [{ n: "societe", l: T("Nom de la société", "Naam van het bedrijf") + " *", type: "text", auto: "organization", requis: true }] : []).concat([
        { n: "nom", l: (entreprise ? T("Nom et prénom de la personne de contact", "Naam en voornaam van de contactpersoon") : T("Nom et prénom", "Naam en voornaam")) + " *", type: "text", auto: "name", requis: true },
        { n: "email", l: "E-mail *", type: "email", auto: "email", requis: true },
        { n: "telephone", l: T("Téléphone", "Telefoon") + " *", type: "tel", auto: "tel", requis: true }
      ]);
      envoi = T("Continuer", "Verder");
    } else {
      champs = [
        { n: "adresse", l: T("Adresse (rue et numéro)", "Adres (straat en nummer)") + " *", type: "text", auto: "address-line1", requis: true, large: true },
        { n: "cp", l: T("Code postal", "Postcode") + " *", type: "text", auto: "postal-code", requis: true, court: true },
        { n: "localite", l: T("Localité", "Gemeente") + " *", type: "text", auto: "address-level2", requis: true },
        { n: "pays", l: T("Pays", "Land"), type: "select", auto: "country", options: [["BE", T("Belgique", "België")], ["NL", T("Pays-Bas", "Nederland")], ["LU", "Luxembourg"], ["FR", T("France", "Frankrijk")], ["DE", T("Allemagne", "Duitsland")]] }
      ].concat(entreprise ? [
        { n: "tva", l: T("Numéro de TVA", "Btw-nummer") + " *", type: "text", requis: true, aide: "BE0123456749" },
        { n: "emailFactures", l: T("E-mail pour les factures (facultatif)", "E-mail voor facturen (optioneel)"), type: "email", auto: "email" }
      ] : []);
      envoi = T("Voir le récapitulatif", "Overzicht bekijken");
    }
    var fc = el("form", "chat-dossier");
    champs.forEach(function (c) {
      var lab = el("label", c.large ? "large" : c.court ? "court" : null, c.l);
      var inp;
      if (c.type === "select") {
        inp = el("select");
        c.options.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; inp.appendChild(op); });
        inp.value = v[c.n] || "BE";
      } else {
        inp = el("input");
        inp.type = c.type; inp.value = v[c.n] || "";
        if (c.mode) inp.inputMode = c.mode;
        if (c.max) inp.maxLength = c.max;
        if (c.aide) inp.placeholder = c.aide;
      }
      inp.name = c.n;
      if (c.auto) inp.autocomplete = c.auto;
      if (c.requis) inp.required = true;
      lab.appendChild(inp);
      if (c.n === "tva") {
        var alerte = el("small", "chat-alerte", T("Numéro de TVA invalide : vérifiez-le (vous pouvez quand même continuer).", "Ongeldig btw-nummer: controleer het (u kunt toch verdergaan)."));
        alerte.hidden = true;
        var controle = function () {
          var pays = fc.elements.pays ? fc.elements.pays.value : "BE";
          alerte.hidden = !inp.value.trim() || pays !== "BE" || tvaValide(inp.value);
        };
        inp.addEventListener("blur", controle);
        inp.addEventListener("input", function () { if (!alerte.hidden) controle(); });
        lab.appendChild(alerte);
      }
      fc.appendChild(lab);
    });
    fc.appendChild(el("small", "chat-obligatoire", T("* obligatoire", "* verplicht")));
    var ok = el("button", "btn btn-primary btn-sm", envoi);
    ok.type = "submit";
    fc.appendChild(ok);
    fc.addEventListener("submit", function (e) {
      e.preventDefault();
      var vide = champs.filter(function (c) { return c.requis && !fc.elements[c.n].value.trim(); })[0];
      if (vide) { fc.elements[vide.n].focus(); return; }
      var mauvais = champs.filter(function (c) { return c.type === "email" && fc.elements[c.n].value.trim() && !fc.elements[c.n].checkValidity(); })[0];
      if (mauvais) { fc.elements[mauvais.n].focus(); return; }
      if (m.champ === "chantier" && !/^\d{4}$/.test(fc.elements.cp.value.trim())) { fc.elements.cp.focus(); return; }
      var valeurs = {};
      champs.forEach(function (c) { valeurs[c.n] = fc.elements[c.n].value.trim(); });
      var corps = {}; corps[m.champ] = valeurs;
      var resume = m.champ === "chantier" ? [valeurs.rue, valeurs.cp].filter(Boolean).join(", ")
        : m.champ === "coordonnees" ? [valeurs.societe, valeurs.nom, valeurs.email, valeurs.telephone].filter(Boolean).join(" · ")
        : [valeurs.adresse, valeurs.cp + " " + valeurs.localite, valeurs.pays, valeurs.tva && T("TVA ", "Btw ") + valeurs.tva].filter(Boolean).join(" · ");
      envoyer(corps, resume);
    });
    setTimeout(function () { var premier = fc.querySelector("input"); if (premier && !premier.value) premier.focus({ preventScroll: true }); }, 50);
    return fc;
  };

  var bulle = function (m) {
    var li = el("li", "chat-msg chat-" + m.role);
    if (m.role === "equipe") li.appendChild(el("span", "chat-tag", T("Équipe Recymo", "Team Recymo")));
    paragraphes(li, m.texte);
    if (m.recap) li.appendChild(carte(m.recap));
    if (m.pdf) {
      var a = el("a", "btn btn-primary btn-sm", m.pdfTexte || T("Télécharger le devis (PDF)", "Offerte downloaden (pdf)"));
      a.href = m.pdf; a.target = "_blank"; a.rel = "noopener";
      li.appendChild(a);
    }
    if (m.boutons || m.champ) { var act = actions(m); if (act) li.appendChild(act); }
    return li;
  };

  var ecrit = function () {
    var li = el("li", "chat-msg chat-ia chat-ecrit");
    li.setAttribute("aria-label", T("Le robot écrit…", "De robot typt…"));
    li.innerHTML = "<span></span><span></span><span></span>";
    return li;
  };

  var afficher = function (c) {
    var sig = c.messages.length + ":" + c.statut;
    if (sig === signature) return;
    signature = sig;
    liste.innerHTML = "";
    c.messages.forEach(function (m) { liste.appendChild(bulle(m)); });
    liste.scrollTop = liste.scrollHeight;
    requestAnimationFrame(function () { liste.scrollTop = liste.scrollHeight; });
    var dernier = c.messages[c.messages.length - 1] || {};
    // La case de texte reste disponible, sauf quand le robot attend un clic ou des cases précises
    var bloque = ["chantier", "coordonnees", "facturation", "nombre"].indexOf(dernier.champ) !== -1 || (dernier.recap && dernier.boutons && dernier.boutons.length);
    champ.disabled = !!bloque; bouton.disabled = !!bloque;
    champ.placeholder = dernier.champ === "texte" ? T("Décrivez votre demande…", "Beschrijf uw aanvraag…")
      : bloque ? T("Répondez avec les boutons ou les cases ci-dessus", "Antwoord met de knoppen of vakjes hierboven") : T("Écrivez votre message…", "Schrijf uw bericht…");
    etat.textContent = c.statut === "envoye" ? T("Demande transmise à l'équipe : la réponse arrivera ici.", "Aanvraag doorgestuurd naar het team: het antwoord verschijnt hier.")
      : (c.statut === "valide" || c.statut === "refuse") ? T("L'équipe a répondu.", "Het team heeft geantwoord.") : "";
    if (c.id && c.messages.some(function (m) { return m.role === "client"; })) {
      lienZone.hidden = false;
      lienZone.querySelector("input").value = location.origin + location.pathname + "?conv=" + c.id + "#chat";
    }
    // Relecture toutes les 30 secondes tant que la réponse de l'équipe est attendue
    // Réponse de l'équipe attendue : écoute en direct, et relecture de secours toutes les 15 secondes
    clearInterval(relecture);
    if (c.statut === "envoye") { ecouter(); relecture = setInterval(function () { if (!attente) charger(); }, 15000); }
    else if (c.statut === "valide" || c.statut === "refuse") couper();
  };

  var envoyer = function (corps, texteClient) {
    if (attente) return;
    attente = true;
    zone.querySelectorAll(".chat-actions button, .chat-actions input").forEach(function (x) { x.disabled = true; });
    var li = bulle({ role: "client", texte: texteClient });
    liste.appendChild(li);
    var e = ecrit();
    liste.appendChild(e);
    liste.scrollTop = liste.scrollHeight;
    corps.id = id; corps.langue = NL ? "nl" : "fr";
    return appel("POST", "/chat", corps).then(function (c) {
      attente = false;
      id = c.id; garder(id);
      signature = "";
      afficher(c);
    }, function (err) {
      attente = false;
      e.remove(); li.remove();
      zone.querySelectorAll(".chat-actions button, .chat-actions input").forEach(function (x) { x.disabled = false; });
      var m = bulle({ role: "ia", texte: err.message || T("Le message n'est pas parti. Réessayez.", "Het bericht is niet verstuurd. Probeer opnieuw.") });
      m.classList.add("chat-erreur");
      liste.appendChild(m);
      liste.scrollTop = liste.scrollHeight;
      throw err;
    });
  };

  // Flux en direct : le serveur envoie la conversation dès qu'elle change (décision de NewTonne)
  var ecouter = function () {
    if (flux || !id || !window.EventSource) return;
    flux = new EventSource(API + "/chat/flux?id=" + encodeURIComponent(id));
    flux.addEventListener("maj", function (e) {
      if (attente) return;
      try { afficher(JSON.parse(e.data)); } catch (err) {}
    });
  };
  var couper = function () { if (flux) { flux.close(); flux = null; } };
  // Retour sur l'onglet (par exemple après avoir validé dans NewTonne) : relecture immédiate
  document.addEventListener("visibilitychange", function () { if (!document.hidden && id && !attente) charger(); });

  var charger = function () {
    return appel("GET", "/chat?id=" + encodeURIComponent(id)).then(afficher, function (e) {
      if (e.status === 404) { garder(null); id = null; return demarrer(); }
    });
  };
  var demarrer = function () {
    return appel("POST", "/chat", { langue: NL ? "nl" : "fr" }).then(function (c) { id = c.id; signature = ""; afficher(c); });
  };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var texte = champ.value.trim();
    if (!texte || attente || champ.disabled) return;
    champ.value = "";
    envoyer({ message: texte }, texte).catch(function () { champ.value = texte; });
  });
  champ.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); }
  });
  zone.querySelector(".chat-copier").addEventListener("click", function () {
    var input = lienZone.querySelector("input");
    (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).then(function () {
      etat.textContent = T("Lien copié.", "Link gekopieerd.");
    }, function () { input.select(); });
  });
  zone.querySelector(".chat-nouveau").addEventListener("click", function () {
    garder(null); id = null; signature = ""; lienZone.hidden = true; clearInterval(relecture); couper();
    history.replaceState(null, "", location.pathname + "#chat");
    demarrer();
  });

  // Le chat n'apparaît que si le serveur répond
  appel("GET", "/sante").then(function (s) {
    if (!s.chat) return;
    zone.hidden = false;
    var depuisLien = new URLSearchParams(location.search).get("conv");
    id = depuisLien || lire();
    if (depuisLien) garder(depuisLien);
    (id ? charger() : demarrer()).then(function () {
      if (depuisLien) zone.scrollIntoView({ block: "start" });
    });
  }).catch(function () {});
})();
