/* Chat de devis (page Contact) : la conversation passe par le serveur Recymo, jamais directement par l'IA.
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
  var id = null, nb = 0, attente = false, relecture = null;

  var lire = function () { try { return localStorage.getItem(CLE); } catch (e) { return null; } };
  var garder = function (v) { try { if (v) localStorage.setItem(CLE, v); else localStorage.removeItem(CLE); } catch (e) {} };

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

  // Texte en paragraphes, sans HTML (les messages viennent de l'IA et du client)
  var bulle = function (m) {
    var li = document.createElement("li");
    li.className = "chat-msg chat-" + m.role;
    if (m.role === "equipe") {
      var tag = document.createElement("span");
      tag.className = "chat-tag";
      tag.textContent = T("Équipe Recymo", "Team Recymo");
      li.appendChild(tag);
    }
    String(m.texte || "").split(/\n{2,}/).forEach(function (p) {
      var el = document.createElement("p");
      p.split("\n").forEach(function (ligne, i) {
        if (i) el.appendChild(document.createElement("br"));
        el.appendChild(document.createTextNode(ligne));
      });
      li.appendChild(el);
    });
    if (m.pdf) {
      var a = document.createElement("a");
      a.className = "btn btn-primary btn-sm";
      a.href = m.pdf; a.target = "_blank"; a.rel = "noopener";
      a.textContent = m.pdfTexte || T("Télécharger le devis (PDF)", "Offerte downloaden (pdf)");
      li.appendChild(a);
    }
    return li;
  };

  var afficher = function (c) {
    if (c.messages.length === nb && !attente) return;
    liste.innerHTML = "";
    c.messages.forEach(function (m) { liste.appendChild(bulle(m)); });
    if (attente) {
      var li = document.createElement("li");
      li.className = "chat-msg chat-ia chat-ecrit";
      li.setAttribute("aria-label", T("L'assistant écrit…", "De assistent typt…"));
      li.innerHTML = "<span></span><span></span><span></span>";
      liste.appendChild(li);
    }
    nb = attente ? -1 : c.messages.length;
    liste.scrollTop = liste.scrollHeight;
    var fini = c.statut === "valide" || c.statut === "refuse";
    etat.textContent = c.statut === "envoye" ? T("Demande transmise à l'équipe : la réponse arrivera ici.", "Aanvraag doorgestuurd naar het team: het antwoord verschijnt hier.")
      : fini ? T("L'équipe a répondu.", "Het team heeft geantwoord.") : "";
    // Lien pour retrouver la conversation plus tard
    if (c.id && c.messages.some(function (m) { return m.role === "client"; })) {
      var url = location.origin + location.pathname + "?conv=" + c.id + "#chat";
      lienZone.hidden = false;
      lienZone.querySelector("input").value = url;
    }
    // Relecture toutes les 30 secondes tant que la réponse de l'équipe est attendue
    clearInterval(relecture);
    if (c.statut === "envoye") relecture = setInterval(function () { if (!document.hidden) charger(); }, 30000);
  };

  var charger = function () {
    return appel("GET", "/chat?id=" + encodeURIComponent(id)).then(afficher, function (e) {
      if (e.status === 404) { garder(null); id = null; demarrer(); }
    });
  };
  var demarrer = function () {
    return appel("POST", "/chat", { langue: NL ? "nl" : "fr" }).then(function (c) { id = c.id; afficher(c); });
  };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var texte = champ.value.trim();
    if (!texte || attente) return;
    var avant = Array.prototype.map.call(liste.children, function (li) { return li; });
    attente = true; bouton.disabled = true; champ.value = "";
    liste.appendChild(bulle({ role: "client", texte: texte }));
    var ecrit = document.createElement("li");
    ecrit.className = "chat-msg chat-ia chat-ecrit";
    ecrit.innerHTML = "<span></span><span></span><span></span>";
    liste.appendChild(ecrit);
    liste.scrollTop = liste.scrollHeight;
    appel("POST", "/chat", { id: id, message: texte, langue: NL ? "nl" : "fr" }).then(function (c) {
      attente = false; nb = 0;
      id = c.id; garder(id);
      afficher(c);
    }, function (err) {
      attente = false;
      ecrit.remove();
      var li = bulle({ role: "ia", texte: err.message || T("Le message n'est pas parti. Réessayez.", "Het bericht is niet verstuurd. Probeer opnieuw.") });
      li.classList.add("chat-erreur");
      liste.appendChild(li);
      if (!avant.length) champ.value = texte;
    }).then(function () { bouton.disabled = false; champ.focus(); });
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
    garder(null); id = null; nb = 0; lienZone.hidden = true; clearInterval(relecture);
    history.replaceState(null, "", location.pathname + "#chat");
    demarrer();
  });

  // Le chat n'apparaît que si le serveur l'a activé
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
