/* Mode admin Recymo : chargé seulement après « ⋯ › Accès admin ».
   Connexion par code (vérifié par le serveur), modification directe des textes
   et des prix, horaires, photos, statistiques et demandes clients. */
(function () {
  "use strict";
  if (window.recymoAdminCharge) { window.recymoAdminOuvrir(); return; }
  window.recymoAdminCharge = true;

  var API = window.RECYMO_API;
  var CLE = "recymo-admin";
  var H = window.RecymoHoraires;
  var page = (function () {
    var p = location.pathname.split("/").pop() || "index.html";
    return /\.html$/.test(p) ? p : p + ".html";
  })();

  var jeton = null;
  try { jeton = sessionStorage.getItem(CLE); } catch (e) {}

  var textes = {};      // cle -> patch
  var photos = {};      // slot -> patch
  var galerie = [];     // patches galerie-ajout / galerie-retrait
  var horaires = null;  // patch horaires
  var originaux = {};   // cle -> texte d'origine

  /* ---------------------------------------------------------------- Outils */
  var el = function (tag, attrs, enfants) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (enfants || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  };
  var fmt = function (n) { return Number(n).toLocaleString("fr-BE"); };

  var annonce = el("div", { class: "adm-toast", role: "status", "aria-live": "polite" });
  var toast = function (msg, type) {
    annonce.textContent = msg;
    annonce.className = "adm-toast is-visible" + (type ? " is-" + type : "");
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { annonce.className = "adm-toast"; }, type === "erreur" ? 7000 : 4500);
  };

  var appel = function (methode, chemin, corps) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 90000);
    return fetch(API + chemin, {
      method: methode,
      headers: Object.assign({ "Content-Type": "application/json" }, jeton ? { Authorization: "Bearer " + jeton } : {}),
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal
    }).then(function (r) {
      clearTimeout(t);
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && chemin.indexOf("/admin/") === 0) { deconnecter(true); }
        if (!r.ok) throw new Error(d.erreur || "Erreur " + r.status);
        return d;
      });
    }, function (e) {
      clearTimeout(t);
      throw new Error(e.name === "AbortError" ? "Le serveur ne répond pas. Réessayez dans un instant." : "Connexion au serveur impossible. Vérifiez votre connexion internet.");
    });
  };

  /* ------------------------------------------------------------- Connexion */
  var login = el("dialog", { class: "adm-dialog adm-login", "aria-labelledby": "adm-login-titre" });
  var loginErr = el("p", { class: "adm-err", role: "alert" });
  var loginInput = el("input", { id: "adm-code", type: "password", autocomplete: "off", required: true, "aria-describedby": "adm-login-aide" });
  var loginBtn = el("button", { type: "submit", class: "btn btn-primary", text: "Entrer" });
  var loginForm = el("form", { method: "dialog", novalidate: true }, [
    el("h2", { id: "adm-login-titre", text: "Accès admin" }),
    el("label", { for: "adm-code", text: "Code admin" }),
    loginInput,
    el("small", { id: "adm-login-aide", text: "La première connexion peut prendre jusqu'à une minute si le serveur était en veille." }),
    loginErr,
    el("div", { class: "adm-actions" }, [
      el("button", { type: "button", class: "btn btn-outline", text: "Annuler", onclick: function () { login.close(); } }),
      loginBtn
    ])
  ]);
  login.appendChild(loginForm);
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    loginErr.textContent = "";
    if (!loginInput.value.trim()) { loginErr.textContent = "Entrez le code admin."; loginInput.focus(); return; }
    loginBtn.disabled = true;
    loginBtn.textContent = "Connexion…";
    appel("POST", "/login", { code: loginInput.value.trim() }).then(function (d) {
      jeton = d.jeton;
      try { sessionStorage.setItem(CLE, jeton); } catch (er) {}
      loginInput.value = "";
      login.close();
      activer();
      toast("Mode admin activé.");
    }, function (er) {
      loginErr.textContent = er.message;
      loginInput.select();
    }).then(function () { loginBtn.disabled = false; loginBtn.textContent = "Entrer"; });
  });

  var deconnecter = function (expire) {
    jeton = null;
    try { sessionStorage.removeItem(CLE); } catch (e) {}
    if (expire) { toast("Session expirée : entrez à nouveau le code.", "erreur"); login.showModal(); return; }
    location.reload();
  };

  /* ------------------------------------------------------------ Barre admin */
  var compteur = el("span", { class: "adm-count", "aria-live": "polite" });
  var btnEdit = el("button", { type: "button", class: "adm-btn", "aria-pressed": "false", text: "Modifier les textes et prix", onclick: function () { modeEdition(!document.body.classList.contains("adm-edit")); } });
  var btnPublier = el("button", { type: "button", class: "adm-btn adm-primary", text: "Publier", disabled: true, onclick: publier });
  var btnAnnuler = el("button", { type: "button", class: "adm-btn", text: "Annuler les modifications", disabled: true, onclick: function () {
    if (confirm("Annuler toutes les modifications non publiées ?")) { window.onbeforeunload = null; location.reload(); }
  } });
  var barre = el("div", { class: "adm-bar", role: "region", "aria-label": "Mode admin" }, [
    el("strong", { class: "adm-titre", text: "Mode admin" }),
    btnEdit,
    el("button", { type: "button", class: "adm-btn", text: "Photos", onclick: function () { ouvrirPanneau("photos"); } }),
    el("button", { type: "button", class: "adm-btn", text: "Horaires", onclick: function () { ouvrirPanneau("horaires"); } }),
    el("button", { type: "button", class: "adm-btn", text: "Statistiques", onclick: function () { ouvrirPanneau("stats"); } }),
    el("button", { type: "button", class: "adm-btn", text: "Demandes clients", onclick: function () { ouvrirPanneau("demandes"); } }),
    el("span", { class: "adm-sep" }),
    compteur, btnAnnuler, btnPublier,
    el("button", { type: "button", class: "adm-btn", text: "Quitter", onclick: function () {
      if (nbChangements() && !confirm("Des modifications ne sont pas publiées. Quitter quand même ?")) return;
      window.onbeforeunload = null; deconnecter(false);
    } })
  ]);

  var nbChangements = function () {
    return Object.keys(textes).length + Object.keys(photos).length + galerie.length + (horaires ? 1 : 0);
  };
  var majCompteur = function () {
    var n = nbChangements();
    compteur.textContent = n ? n + " modification" + (n > 1 ? "s" : "") + " à publier" : "Aucune modification";
    btnPublier.disabled = !n;
    btnAnnuler.disabled = !n;
    window.onbeforeunload = n ? function () { return "Des modifications ne sont pas publiées."; } : null;
  };

  /* --------------------------------------------------- Édition des textes */
  var modeEdition = function (on) {
    document.body.classList.toggle("adm-edit", on);
    btnEdit.setAttribute("aria-pressed", String(on));
    btnEdit.textContent = on ? "Terminer la modification" : "Modifier les textes et prix";
    var mode = "plaintext-only";
    var test = document.createElement("div");
    test.contentEditable = mode;
    if (test.contentEditable !== mode) mode = "true";
    document.querySelectorAll("[data-edit]").forEach(function (n) {
      if (on) { n.setAttribute("contenteditable", mode); n.setAttribute("spellcheck", "true"); }
      else { n.removeAttribute("contenteditable"); n.removeAttribute("spellcheck"); }
    });
    if (on) toast("Cliquez sur un texte ou un prix pour le modifier. Les liens sont désactivés pendant la modification.");
  };

  document.addEventListener("input", function (e) {
    var n = e.target.closest && e.target.closest("[data-edit]");
    if (!n || !document.body.classList.contains("adm-edit")) return;
    var cle = n.getAttribute("data-edit");
    var v = n.textContent.replace(/\s+/g, " ").trim();
    if (!(cle in originaux)) originaux[cle] = n.getAttribute("data-original") || v;
    if (v === originaux[cle]) delete textes[cle];
    else textes[cle] = { type: "texte", page: page, cle: cle, valeur: v };
    n.classList.toggle("adm-modifie", cle in textes);
    if (cle.indexOf("prix-") === 0 && window.recymoRecalculer) window.recymoRecalculer();
    majCompteur();
  });
  document.addEventListener("focusin", function (e) {
    var n = e.target.closest && e.target.closest("[data-edit]");
    if (n && !n.hasAttribute("data-original")) n.setAttribute("data-original", n.textContent.replace(/\s+/g, " ").trim());
  });
  document.addEventListener("keydown", function (e) {
    var n = e.target.closest && e.target.closest("[data-edit]");
    if (n && document.body.classList.contains("adm-edit") && e.key === "Enter") { e.preventDefault(); n.blur(); }
  });
  document.addEventListener("paste", function (e) {
    var n = e.target.closest && e.target.closest("[data-edit]");
    if (!n || !document.body.classList.contains("adm-edit")) return;
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text").replace(/\s+/g, " "));
  });
  document.addEventListener("click", function (e) {
    if (!document.body.classList.contains("adm-edit") || e.target.closest(".adm-bar, .adm-dialog")) return;
    var a = e.target.closest("a[href]");
    if (a) e.preventDefault();
  }, true);

  /* -------------------------------------------------------------- Panneaux */
  var panneau = el("dialog", { class: "adm-dialog adm-panel", "aria-labelledby": "adm-panel-titre" });
  var panneauTitre = el("h2", { id: "adm-panel-titre" });
  var panneauCorps = el("div", { class: "adm-panel-body" });
  panneau.appendChild(el("div", { class: "adm-panel-head" }, [
    panneauTitre,
    el("button", { type: "button", class: "adm-close", "aria-label": "Fermer", html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>', onclick: function () { panneau.close(); } })
  ]));
  panneau.appendChild(panneauCorps);

  var ouvrirPanneau = function (quoi) {
    panneauCorps.innerHTML = "";
    panneau.className = "adm-dialog adm-panel adm-panel-" + quoi;
    ({ photos: panneauPhotos, horaires: panneauHoraires, stats: panneauStats, demandes: panneauDemandes })[quoi]();
    if (!panneau.open) panneau.showModal();
  };

  /* ---------------------------------------------------------------- Photos */
  var NOMS_PHOTOS = {
    hero: "Grande photo en haut de l'accueil",
    ouvrier: "Photo « Pourquoi travailler avec Recymo »",
    "site-braives": "Vue aérienne du site de Braives",
    "site-charleroi": "Vue aérienne du site de Charleroi"
  };

  var preparerImage = function (fichier) {
    return new Promise(function (ok, ko) {
      if (!/^image\/(jpeg|png|webp)$/.test(fichier.type)) return ko(new Error("Choisissez une photo JPG, PNG ou WebP."));
      var img = new Image();
      var url = URL.createObjectURL(fichier);
      img.onload = function () {
        var max = 1920, w = img.naturalWidth, h = img.naturalHeight;
        if (w > max || h > max) { var r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        ok({ image: c.toDataURL("image/jpeg", 0.82), largeur: w, hauteur: h });
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error("Cette image ne peut pas être lue.")); };
      img.src = url;
    });
  };

  var choisirFichier = function (cb) {
    var input = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
    input.addEventListener("change", function () {
      if (input.files[0]) preparerImage(input.files[0]).then(cb, function (e) { toast(e.message, "erreur"); });
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  };

  var panneauPhotos = function () {
    panneauTitre.textContent = "Photos de cette page";
    var slots = Array.prototype.slice.call(document.querySelectorAll("img[data-photo]"));
    if (!slots.length && !document.querySelector("[data-galerie]")) {
      panneauCorps.appendChild(el("p", { text: "Il n'y a pas de photo modifiable sur cette page. Les photos se trouvent sur l'Accueil et sur la page Contact." }));
      return;
    }
    var liste = el("ul", { class: "adm-photos" });
    slots.forEach(function (img) {
      var slot = img.getAttribute("data-photo");
      var estGalerie = slot.indexOf("galerie-") === 0;
      var vignette = el("img", { src: img.currentSrc || img.src, alt: "" });
      var actions = el("div", { class: "adm-photo-actions" }, [
        el("button", { type: "button", class: "btn btn-outline btn-sm", text: "Remplacer…", onclick: function () {
          choisirFichier(function (p) {
            img.src = p.image; vignette.src = p.image;
            if (/^galerie-\d+$/.test(slot) && galerie.some(function (g) { return g.slot === slot; })) {
              galerie.forEach(function (g) { if (g.slot === slot) Object.assign(g, p); });
            } else photos[slot] = Object.assign({ type: "photo", slot: slot }, p);
            majCompteur();
            toast("Photo remplacée. Pensez à publier.");
          });
        } }),
        estGalerie ? el("button", { type: "button", class: "btn btn-outline btn-sm adm-danger", text: "Retirer", onclick: function () {
          if (!confirm("Retirer cette photo de la galerie ?")) return;
          var fig = img.closest("figure");
          var nouvelle = galerie.filter(function (g) { return g.slot === slot && g.type === "galerie-ajout"; })[0];
          if (nouvelle) galerie = galerie.filter(function (g) { return g !== nouvelle; });
          else galerie.push({ type: "galerie-retrait", slot: slot });
          if (fig) fig.remove();
          majCompteur();
          panneauPhotos.rafraichir();
        } }) : null
      ]);
      liste.appendChild(el("li", {}, [
        vignette,
        el("div", {}, [el("strong", { text: NOMS_PHOTOS[slot] || (img.closest("figure") && img.closest("figure").textContent.trim()) || (/^classe-/.test(slot) ? "Classe " + slot.slice(7).toUpperCase() + " (illustration à remplacer par une photo)" : "") || img.alt || "Photo" }), actions])
      ]));
    });
    panneauCorps.appendChild(liste);

    var gal = document.querySelector("[data-galerie]");
    if (gal) {
      var legende = el("input", { id: "adm-legende", type: "text", maxlength: "120", placeholder: "Ex. Site de Fosses-la-Ville" });
      var alt = el("input", { id: "adm-alt", type: "text", maxlength: "200", placeholder: "Ex. Vue aérienne du site avec les stocks de terres" });
      panneauCorps.appendChild(el("div", { class: "adm-ajout" }, [
        el("h3", { text: "Ajouter une photo à la galerie des sites" }),
        el("label", { for: "adm-legende", text: "Légende affichée sous la photo" }), legende,
        el("label", { for: "adm-alt", text: "Description de la photo (pour les malvoyants et Google)" }), alt,
        el("button", { type: "button", class: "btn btn-dark btn-sm", text: "Choisir la photo…", onclick: function () {
          if (!legende.value.trim()) { toast("Écrivez d'abord une légende.", "erreur"); legende.focus(); return; }
          choisirFichier(function (p) {
            var slot = "galerie-" + Date.now();
            galerie.push(Object.assign({ type: "galerie-ajout", slot: slot, legende: legende.value.trim(), alt: alt.value.trim() || legende.value.trim() }, p));
            var fig = el("figure", {}, [el("img", { "data-photo": slot, src: p.image, alt: alt.value.trim(), width: p.largeur, height: p.hauteur }), el("figcaption", { text: legende.value.trim() })]);
            var fin = Array.prototype.filter.call(gal.childNodes, function (c) { return c.nodeType === 8 && /fin galerie/.test(c.nodeValue); })[0];
            gal.insertBefore(fig, fin || null);
            majCompteur();
            toast("Photo ajoutée. Pensez à publier.");
            panneauPhotos.rafraichir();
          });
        } })
      ]));
    }
  };
  panneauPhotos.rafraichir = function () { if (panneau.open) ouvrirPanneau("photos"); };

  /* -------------------------------------------------------------- Horaires */
  var JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  var donneesHoraires = null;

  var panneauHoraires = function () {
    panneauTitre.textContent = "Horaires des sites";
    var chargement = el("p", { text: "Chargement…" });
    panneauCorps.appendChild(chargement);
    var depart = horaires ? Promise.resolve(JSON.parse(JSON.stringify(horaires.horaires))) :
      fetch("assets/data/horaires.json", { cache: "no-cache" }).then(function (r) { return r.json(); });
    depart.then(function (data) {
      donneesHoraires = data;
      chargement.remove();
      panneauCorps.appendChild(el("p", { class: "adm-aide", text: "Ces horaires servent au statut « Ouvert / Fermé » et sont recopiés partout sur le site à la publication." }));
      var form = el("form", { class: "adm-horaires", novalidate: true });
      Object.keys(data).forEach(function (k) {
        var s = data[k];
        var fs = el("fieldset", {}, [el("legend", { text: s.nom })]);
        var grille = el("div", { class: "adm-jours" });
        JOURS.forEach(function (nom, i) {
          var j = String(i + 1), p = s.jours[j];
          var id = "h-" + k + "-" + j;
          var ouvert = el("input", { type: "checkbox", id: id, checked: !!p });
          var de = el("input", { type: "time", value: p ? p[0] : "07:00", "aria-label": nom + " : ouverture", disabled: !p });
          var a = el("input", { type: "time", value: p ? p[1] : "17:00", "aria-label": nom + " : fermeture", disabled: !p });
          ouvert.addEventListener("change", function () { de.disabled = a.disabled = !ouvert.checked; });
          grille.appendChild(el("div", { class: "adm-jour", "data-site": k, "data-jour": j }, [
            el("label", { for: id }, [ouvert, " " + nom]), de, el("span", { "aria-hidden": "true", text: "à" }), a
          ]));
        });
        fs.appendChild(grille);
        var nid = "h-note-" + k;
        fs.appendChild(el("label", { for: nid, class: "adm-note-label", text: "Remarque (facultatif)" }));
        fs.appendChild(el("input", { id: nid, type: "text", class: "adm-note", "data-site": k, value: s.note || "", maxlength: "120", placeholder: "Ex. Fermé les jours fériés" }));
        form.appendChild(fs);
      });
      var err = el("p", { class: "adm-err", role: "alert" });
      form.appendChild(err);
      form.appendChild(el("div", { class: "adm-actions" }, [el("button", { type: "submit", class: "btn btn-primary", text: "Appliquer les horaires" })]));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var nouveau = JSON.parse(JSON.stringify(donneesHoraires));
        var probleme = null;
        form.querySelectorAll(".adm-jour").forEach(function (ligne) {
          var k = ligne.getAttribute("data-site"), j = ligne.getAttribute("data-jour");
          var ins = ligne.querySelectorAll("input");
          if (ins[0].checked) {
            if (!ins[1].value || !ins[2].value || ins[1].value >= ins[2].value) probleme = probleme || nouveau[k].nom + ", " + JOURS[j - 1].toLowerCase() + " : l'heure de fermeture doit être après l'ouverture.";
            nouveau[k].jours[j] = [ins[1].value, ins[2].value];
          } else delete nouveau[k].jours[j];
        });
        form.querySelectorAll(".adm-note").forEach(function (n) { nouveau[n.getAttribute("data-site")].note = n.value.trim(); });
        if (probleme) { err.textContent = probleme; return; }
        horaires = { type: "horaires", horaires: nouveau };
        apercuHoraires(nouveau);
        majCompteur();
        panneau.close();
        toast("Horaires appliqués sur la page. Pensez à publier.");
      });
      panneauCorps.appendChild(form);
    }, function () { chargement.textContent = "Impossible de charger les horaires."; });
  };

  var apercuHoraires = function (data) {
    if (window.recymoHoraires) window.recymoHoraires(data);
    if (!H) return;
    Object.keys(data).forEach(function (k) {
      document.querySelectorAll('[data-horaires-texte="' + k + '"]').forEach(function (n) { n.textContent = H.texteCourt(data[k]); });
      document.querySelectorAll('[data-horaires-liste="' + k + '"]').forEach(function (n) {
        n.innerHTML = H.listeHtml(data[k], function (s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; });
      });
    });
  };

  /* ---------------------------------------------------------- Statistiques */
  var COULEURS = { vues: "#16855a", visiteurs: "#3a5ba9" };

  var panneauStats = function () {
    panneauTitre.textContent = "Statistiques du site";
    var filtres = el("div", { class: "adm-filtres", role: "group", "aria-label": "Période" });
    var zone = el("div", { class: "adm-stats" });
    [[7, "7 jours"], [30, "30 jours"], [90, "90 jours"]].forEach(function (p) {
      filtres.appendChild(el("button", { type: "button", class: "chip", "aria-pressed": String(p[0] === 30), text: p[1], onclick: function (e) {
        filtres.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === e.currentTarget)); });
        charger(p[0]);
      } }));
    });
    panneauCorps.appendChild(filtres);
    panneauCorps.appendChild(zone);
    var charger = function (jours) {
      zone.classList.add("is-loading");
      if (!zone.childNodes.length) zone.appendChild(el("p", { text: "Chargement des statistiques… (jusqu'à une minute si le serveur était en veille)" }));
      appel("GET", "/admin/stats?jours=" + jours).then(function (d) {
        zone.classList.remove("is-loading");
        dessinerStats(zone, d.serie);
      }, function (e) {
        zone.classList.remove("is-loading");
        zone.innerHTML = "";
        zone.appendChild(el("p", { class: "adm-err", text: e.message }));
      });
    };
    charger(30);
  };

  var dessinerStats = function (zone, serie) {
    zone.innerHTML = "";
    var total = function (k) { return serie.reduce(function (s, d) { return s + (d[k] || 0); }, 0); };
    var tuiles = [
      ["vues", "Pages vues"], ["visiteurs", "Visiteurs"], ["devis", "Clics « Demander un devis »"],
      ["appels", "Clics « Appeler »"], ["estimations", "Estimations de prix"], ["demandes", "Demandes reçues"]
    ];
    zone.appendChild(el("dl", { class: "adm-kpis" }, tuiles.map(function (t) {
      return el("div", {}, [el("dt", { text: t[1] }), el("dd", { text: fmt(total(t[0])) })]);
    })));

    // Courbe : pages vues et visiteurs par jour
    var carte = el("figure", { class: "adm-chart" }, [el("figcaption", { text: "Visites par jour" })]);
    var legende = el("ul", { class: "adm-legende" }, [
      el("li", {}, [el("span", { class: "adm-key", style: "background:" + COULEURS.vues }), "Pages vues"]),
      el("li", {}, [el("span", { class: "adm-key", style: "background:" + COULEURS.visiteurs }), "Visiteurs"])
    ]);
    carte.appendChild(legende);
    carte.appendChild(courbe(serie, ["vues", "visiteurs"], { vues: "Pages vues", visiteurs: "Visiteurs" }));
    zone.appendChild(carte);

    // Barres : actions sur la période
    zone.appendChild(barres("Actions des visiteurs sur la période", tuiles.slice(2).map(function (t) { return [t[1], total(t[0])]; })));

    // Barres : pages les plus vues
    var pages = {};
    serie.forEach(function (d) { Object.keys(d.pages || {}).forEach(function (p) { pages[p] = (pages[p] || 0) + d.pages[p]; }); });
    var NOMS = { "/": "Accueil", "/tarifs": "Tarifs", "/fiches-techniques": "Fiches techniques", "/contact": "Contact", "/mentions-legales": "Mentions légales" };
    var top = Object.keys(pages).sort(function (a, b) { return pages[b] - pages[a]; }).slice(0, 6).map(function (p) { return [NOMS[p] || p, pages[p]]; });
    if (top.length) zone.appendChild(barres("Pages les plus vues", top));

    // Tableau des données (accessible sans graphique)
    var table = el("table", { class: "adm-table" }, [
      el("thead", {}, [el("tr", {}, ["Jour", "Pages vues", "Visiteurs", "Devis", "Appels", "Estimations", "Demandes"].map(function (h) { return el("th", { scope: "col", text: h }); }))]),
      el("tbody", {}, serie.slice().reverse().map(function (d) {
        return el("tr", {}, [d.jour, d.vues, d.visiteurs, d.devis, d.appels, d.estimations, d.demandes].map(function (v, i) { return el(i ? "td" : "th", i ? { text: fmt(v) } : { scope: "row", text: v }); }));
      }))
    ]);
    zone.appendChild(el("details", { class: "adm-details" }, [el("summary", { text: "Voir le tableau jour par jour" }), el("div", { class: "adm-table-wrap" }, [table])]));
    if (!total("vues")) zone.insertBefore(el("p", { class: "adm-aide", text: "Pas encore de visite enregistrée sur cette période : les chiffres apparaîtront au fil des visites." }), zone.firstChild);
  };

  var NS = "http://www.w3.org/2000/svg";
  var svgEl = function (tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; };
  var jourCourt = function (j) { var p = j.split("-"); return +p[2] + "/" + +p[1]; };

  var courbe = function (serie, cles, noms) {
    var W = 720, Hh = 240, m = { t: 12, r: 16, b: 28, l: 40 };
    var max = Math.max(1, Math.max.apply(null, serie.map(function (d) { return Math.max(d[cles[0]], d[cles[1]]); })));
    var pas = Math.pow(10, Math.floor(Math.log10(max)));
    var haut = Math.ceil(max / pas) * pas;
    var x = function (i) { return m.l + (serie.length === 1 ? 0 : i * (W - m.l - m.r) / (serie.length - 1)); };
    var y = function (v) { return m.t + (Hh - m.t - m.b) * (1 - v / haut); };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + Hh, class: "adm-svg", role: "img", "aria-label": "Courbe des pages vues et des visiteurs par jour" });
    [0, 0.5, 1].forEach(function (f) {
      var v = Math.round(haut * f);
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "adm-grid" }));
      var t = svgEl("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", class: "adm-axis" }); t.textContent = fmt(v); svg.appendChild(t);
    });
    var pasX = Math.max(1, Math.ceil(serie.length / 6));
    serie.forEach(function (d, i) {
      if (i % pasX && i !== serie.length - 1) return;
      var t = svgEl("text", { x: x(i), y: Hh - 8, "text-anchor": i === 0 ? "start" : i === serie.length - 1 ? "end" : "middle", class: "adm-axis" });
      t.textContent = jourCourt(d.jour); svg.appendChild(t);
    });
    cles.forEach(function (k) {
      var dPath = serie.map(function (d, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(d[k]).toFixed(1); }).join(" ");
      svg.appendChild(svgEl("path", { d: dPath, fill: "none", stroke: COULEURS[k], "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    });
    // Survol : ligne verticale et infobulle avec les deux valeurs
    var guide = svgEl("line", { y1: m.t, y2: Hh - m.b, class: "adm-cross", visibility: "hidden" });
    var points = cles.map(function (k) { return svgEl("circle", { r: 4, fill: COULEURS[k], stroke: "#fff", "stroke-width": 2, visibility: "hidden" }); });
    svg.appendChild(guide); points.forEach(function (p) { svg.appendChild(p); });
    var bulle = el("div", { class: "adm-tip", hidden: true });
    var cadre = el("div", { class: "adm-svg-wrap", tabindex: "0", "aria-label": "Graphique : utilisez les flèches pour parcourir les jours" }, [svg, bulle]);
    var montrer = function (i) {
      var d = serie[i];
      guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i)); guide.setAttribute("visibility", "visible");
      cles.forEach(function (k, j) { points[j].setAttribute("cx", x(i)); points[j].setAttribute("cy", y(d[k])); points[j].setAttribute("visibility", "visible"); });
      bulle.innerHTML = "";
      bulle.appendChild(el("div", { class: "adm-tip-date", text: d.jour.split("-").reverse().join("/") }));
      cles.forEach(function (k) {
        bulle.appendChild(el("div", { class: "adm-tip-row" }, [el("span", { class: "adm-tip-key", style: "background:" + COULEURS[k] }), el("strong", { text: fmt(d[k]) }), " " + noms[k]]));
      });
      bulle.hidden = false;
      var px = x(i) / W * cadre.clientWidth;
      bulle.style.left = Math.min(Math.max(px, 70), cadre.clientWidth - 70) + "px";
      cadre.dataset.i = i;
    };
    var cacher = function () { guide.setAttribute("visibility", "hidden"); points.forEach(function (p) { p.setAttribute("visibility", "hidden"); }); bulle.hidden = true; };
    cadre.addEventListener("pointermove", function (e) {
      var r = svg.getBoundingClientRect();
      var vx = (e.clientX - r.left) / r.width * W;
      var i = Math.round((vx - m.l) / ((W - m.l - m.r) / Math.max(1, serie.length - 1)));
      montrer(Math.max(0, Math.min(serie.length - 1, i)));
    });
    cadre.addEventListener("pointerleave", cacher);
    cadre.addEventListener("focus", function () { montrer(serie.length - 1); });
    cadre.addEventListener("blur", cacher);
    cadre.addEventListener("keydown", function (e) {
      var i = +(cadre.dataset.i || serie.length - 1);
      if (e.key === "ArrowLeft") { e.preventDefault(); montrer(Math.max(0, i - 1)); }
      if (e.key === "ArrowRight") { e.preventDefault(); montrer(Math.min(serie.length - 1, i + 1)); }
    });
    return cadre;
  };

  var barres = function (titre, donnees) {
    var max = Math.max(1, Math.max.apply(null, donnees.map(function (d) { return d[1]; })));
    return el("figure", { class: "adm-chart" }, [
      el("figcaption", { text: titre }),
      el("ul", { class: "adm-bars" }, donnees.map(function (d) {
        return el("li", { title: d[0] + " : " + fmt(d[1]) }, [
          el("span", { class: "adm-bar-label", text: d[0] }),
          el("span", { class: "adm-bar-track" }, [el("span", { class: "adm-bar-fill", style: "width:" + (d[1] / max * 100) + "%" })]),
          el("span", { class: "adm-bar-value", text: fmt(d[1]) })
        ]);
      }))
    ]);
  };

  /* ------------------------------------------------------ Demandes clients */
  var panneauDemandes = function () {
    panneauTitre.textContent = "Demandes clients";
    var zone = el("div", {}, [el("p", { text: "Chargement des demandes… (jusqu'à une minute si le serveur était en veille)" })]);
    panneauCorps.appendChild(zone);
    appel("GET", "/admin/demandes").then(function (d) {
      zone.innerHTML = "";
      var liste = d.demandes || [];
      if (!liste.length) {
        zone.appendChild(el("p", { text: "Aucune demande pour l'instant. Les demandes envoyées avec le formulaire de contact apparaîtront ici." }));
        return;
      }
      var emails = liste.map(function (x) { return x.email; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      zone.appendChild(el("div", { class: "adm-toolbar" }, [
        el("p", { text: liste.length + " demande" + (liste.length > 1 ? "s" : "") + " · " + emails.length + " email" + (emails.length > 1 ? "s" : "") + " différent" + (emails.length > 1 ? "s" : "") }),
        el("button", { type: "button", class: "btn btn-outline btn-sm", text: "Copier les emails", onclick: function () {
          navigator.clipboard.writeText(emails.join("; ")).then(function () { toast("Emails copiés."); }, function () { toast("Copie impossible : utilisez l'export CSV.", "erreur"); });
        } }),
        el("button", { type: "button", class: "btn btn-dark btn-sm", text: "Exporter en CSV (Excel)", onclick: function () { exporterCsv(liste); } })
      ]));
      zone.appendChild(el("ul", { class: "adm-demandes" }, liste.map(function (x) {
        var date = new Date(x.date);
        var photoZone = el("div");
        return el("li", {}, [
          el("div", { class: "adm-d-head" }, [
            el("strong", { text: x.nom + (x.societe ? " · " + x.societe : "") }),
            el("time", { datetime: x.date, text: date.toLocaleDateString("fr-BE") + " à " + date.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" }) })
          ]),
          el("p", { class: "adm-d-meta" }, [
            el("a", { href: "mailto:" + x.email, text: x.email }), " · ",
            el("a", { href: "tel:" + String(x.telephone).replace(/[^\d+]/g, ""), text: x.telephone }),
            x.sujet ? " · " + x.sujet : ""
          ]),
          el("p", { class: "adm-d-msg", text: x.message }),
          x.photo ? el("button", { type: "button", class: "btn btn-outline btn-sm", text: "Voir la photo jointe", onclick: function (e) {
            var b = e.currentTarget; b.disabled = true; b.textContent = "Chargement…";
            fetch(API + "/admin/photo?chemin=" + encodeURIComponent(x.photo), { headers: { Authorization: "Bearer " + jeton } })
              .then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
              .then(function (blob) { b.remove(); photoZone.appendChild(el("img", { src: URL.createObjectURL(blob), alt: "Photo jointe par " + x.nom, class: "adm-d-photo" })); },
                function () { b.disabled = false; b.textContent = "Réessayer d'afficher la photo"; });
          } }) : null,
          (x.fichiers && x.fichiers.length) ? el("div", { class: "adm-docs" }, [el("strong", { text: x.fichiers.length + " document" + (x.fichiers.length > 1 ? "s" : "") + " joint" + (x.fichiers.length > 1 ? "s" : "") })].concat(x.fichiers.map(function (f) {
            var pdf = f.type === "application/pdf";
            var taille = f.taille < 1048576 ? Math.max(1, Math.round(f.taille / 1024)) + " Ko" : (f.taille / 1048576).toFixed(1).replace(".", ",") + " Mo";
            return el("button", { type: "button", class: "adm-doc", onclick: function (e) {
              var b = e.currentTarget; b.disabled = true;
              fetch(API + "/admin/photo?chemin=" + encodeURIComponent(f.chemin), { headers: { Authorization: "Bearer " + jeton } })
                .then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
                .then(function (blob) {
                  b.disabled = false;
                  var url = URL.createObjectURL(blob);
                  if (pdf) {
                    var a = el("a", { href: url, download: f.nom.replace(/\.pdf$/i, "") + ".pdf" });
                    document.body.appendChild(a); a.click(); a.remove();
                  } else {
                    photoZone.appendChild(el("img", { src: url, alt: f.nom, class: "adm-d-photo" }));
                  }
                }, function () { b.disabled = false; toast("Impossible d'ouvrir ce document. Réessayez.", "erreur"); });
            } }, [el("span", { class: "adm-doc-type", text: pdf ? "PDF" : "Photo" }), el("span", { class: "adm-doc-nom", text: f.nom }), el("small", { text: taille + (pdf ? " · télécharger" : " · afficher") })]);
          }))) : null,
          photoZone
        ]);
      })));
    }, function (e) { zone.innerHTML = ""; zone.appendChild(el("p", { class: "adm-err", text: e.message })); });
  };

  var exporterCsv = function (liste) {
    var cols = ["date", "nom", "societe", "email", "telephone", "sujet", "message"];
    var entete = ["Date", "Nom", "Société", "Email", "Téléphone", "Objet", "Message"];
    var cel = function (v) { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    var lignes = [entete.join(";")].concat(liste.map(function (x) {
      return cols.map(function (c) { return cel(c === "date" ? new Date(x.date).toLocaleString("fr-BE") : x[c]); }).join(";");
    }));
    var blob = new Blob(["﻿" + lignes.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "demandes-recymo-" + new Date().toISOString().slice(0, 10) + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
  };

  /* --------------------------------------------------------------- Publier */
  function publier() {
    var patches = Object.keys(textes).map(function (k) { return textes[k]; })
      .concat(Object.keys(photos).map(function (k) { return photos[k]; }))
      .concat(galerie)
      .concat(horaires ? [horaires] : []);
    if (!patches.length) return;
    btnPublier.disabled = true;
    btnPublier.textContent = "Publication…";
    toast("Publication en cours…");
    appel("POST", "/admin/enregistrer", { patches: patches }).then(function (d) {
      textes = {}; photos = {}; galerie = []; horaires = null; originaux = {};
      document.querySelectorAll(".adm-modifie").forEach(function (n) { n.classList.remove("adm-modifie"); });
      document.querySelectorAll("[data-original]").forEach(function (n) { n.removeAttribute("data-original"); });
      majCompteur();
      toast(d.deploiement === "lancé" ? "Publié ! Le site en ligne sera à jour dans environ 1 à 2 minutes." :
        d.deploiement === "échec" ? "Enregistré, mais la mise en ligne automatique a échoué : prévenez votre webmaster." : "Enregistré.");
    }, function (e) {
      toast("Publication impossible : " + e.message, "erreur");
      majCompteur();
    }).then(function () { btnPublier.textContent = "Publier"; });
  }

  /* ----------------------------------------------------------- Démarrage */
  var activer = function () {
    if (!barre.isConnected) document.body.appendChild(barre);
    document.body.classList.add("is-admin");
    majCompteur();
  };

  document.body.appendChild(login);
  document.body.appendChild(panneau);
  document.body.appendChild(annonce);

  window.recymoAdminOuvrir = function () {
    if (jeton) { activer(); return; }
    login.showModal();
    loginInput.focus();
  };
  window.recymoAdminOuvrir();
})();
