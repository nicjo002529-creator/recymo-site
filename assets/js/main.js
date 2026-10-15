(function () {
  "use strict";
  document.documentElement.classList.add("js");

  /* Header shadow on scroll */
  var header = document.querySelector(".site-header");
  var onScroll = function () {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Mobile navigation */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  if (toggle && links) {
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
      links.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
  }

  /* Tabs (tarifs) — synced with URL hash so /tarifs.html#granulats works */
  var tablist = document.querySelector("[role='tablist']");
  if (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll("[role='tab']"));
    var select = function (id, focus) {
      var found = tabs.some(function (t) { return t.getAttribute("aria-controls") === id; });
      if (!found) id = tabs[0].getAttribute("aria-controls");
      tabs.forEach(function (t) {
        var on = t.getAttribute("aria-controls") === id;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
        if (on) {
          if (focus) t.focus();
          t.scrollIntoView({ block: "nearest", inline: "center" });
        }
      });
    };
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () {
        var id = t.getAttribute("aria-controls");
        select(id);
        history.replaceState(null, "", "#" + id);
      });
      t.addEventListener("keydown", function (e) {
        var dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        var next = tabs[(i + dir + tabs.length) % tabs.length];
        next.click();
        next.focus();
      });
    });
    var fromHash = function () { select(location.hash.slice(1)); };
    window.addEventListener("hashchange", fromHash);
    fromHash();
  }

  /* Print current price list */
  document.querySelectorAll("[data-print]").forEach(function (b) {
    b.addEventListener("click", function () { window.print(); });
  });

  /* Document filters (fiches techniques) */
  var filterBar = document.querySelector("[data-filters]");
  if (filterBar) {
    var cards = document.querySelectorAll("[data-cat]");
    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      var f = btn.getAttribute("data-filter");
      filterBar.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b === btn));
      });
      cards.forEach(function (c) {
        c.hidden = f !== "all" && c.getAttribute("data-cat") !== f;
      });
    });
  }

  /* Admin server (statistics, contact requests, admin mode) */
  var API = location.hostname === "localhost" ? "http://localhost:10000" : "https://recymo-admin.onrender.com";
  window.RECYMO_API = API;

  /* Contact form: validates, then sends the request to the Recymo server
     (stored in the admin). If the server can't be reached, the visitor's mail
     client opens prefilled instead. */
  var form = document.getElementById("contact-form");
  if (form) {
    var params = new URLSearchParams(location.search);

    if (API) {
      form.querySelectorAll("[data-online-only], [data-foot-online]").forEach(function (el) { el.hidden = false; });
      form.querySelectorAll("[data-foot-mailto]").forEach(function (el) { el.hidden = true; });
    }

    // Prefill from the price calculator or other links (?sujet=…&message=…)
    if (params.get("sujet")) {
      Array.prototype.forEach.call(form.elements.sujet.options, function (o) {
        if (o.text === params.get("sujet")) form.elements.sujet.value = o.text;
      });
    }
    if (params.get("message")) form.elements.message.value = params.get("message");

    // Arrivée depuis l'estimateur : l'estimation est déjà dans le message
    if (params.get("estimation") === "1" && params.get("message")) {
      var msg = form.elements.message;
      msg.style.minHeight = Math.min(420, 60 + msg.value.split("\n").length * 24) + "px";
      var info = document.createElement("div");
      info.className = "notice info";
      info.setAttribute("role", "status");
      info.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><p><strong>Votre estimation est déjà dans le message.</strong> Il ne reste qu’à indiquer vos coordonnées et à envoyer.</p>';
      form.parentNode.insertBefore(info, form);
      setTimeout(function () { form.elements.nom.focus({ preventScroll: true }); }, 50);
    }

    // Documents joints : analyses de terres, NMT, photos du chargement (plusieurs fichiers)
    var photo = form.elements.attachment;
    var MAX_FICHIERS = 6, MAX_TAILLE = 10 * 1024 * 1024;
    var TYPES = /^(application\/pdf|image\/(jpeg|png|webp))$/;
    var fichiers = [];
    var liste = document.getElementById("docs-liste");
    var champDocs = photo ? photo.closest(".field") : null;
    var tailleTxt = function (o) { return o < 1048576 ? Math.max(1, Math.round(o / 1024)) + " Ko" : (o / 1048576).toFixed(1).replace(".", ",") + " Mo"; };
    var afficherFichiers = function () {
      if (!liste) return;
      liste.innerHTML = "";
      fichiers.forEach(function (f, i) {
        var li = document.createElement("li");
        var nom = document.createElement("span");
        nom.className = "docs-nom";
        nom.textContent = f.name;
        var t = document.createElement("small");
        t.textContent = (f.type === "application/pdf" ? "PDF" : "Image") + " · " + tailleTxt(f.size);
        var del = document.createElement("button");
        del.type = "button";
        del.className = "docs-del";
        del.setAttribute("aria-label", "Retirer " + f.name);
        del.innerHTML = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" aria-hidden=\"true\"><path d=\"M18 6 6 18M6 6l12 12\"/></svg>";
        del.addEventListener("click", function () { fichiers.splice(i, 1); afficherFichiers(); photo.focus(); });
        li.appendChild(nom); li.appendChild(t); li.appendChild(del);
        liste.appendChild(li);
      });
    };
    var ajouterFichiers = function (nouveaux) {
      var refus = false;
      Array.prototype.forEach.call(nouveaux, function (f) {
        var type = f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : "");
        if (!TYPES.test(type) || f.size > MAX_TAILLE || fichiers.length >= MAX_FICHIERS) { refus = true; return; }
        if (!fichiers.some(function (x) { return x.name === f.name && x.size === f.size; })) fichiers.push(f);
      });
      if (champDocs) champDocs.classList.toggle("invalid", refus);
      afficherFichiers();
    };
    // Un fichier refusé n est simplement pas ajouté : il ne bloque pas l envoi
    var photoOk = function () { if (champDocs) champDocs.classList.remove("invalid"); return true; };
    if (photo) {
      photo.addEventListener("change", function () { ajouterFichiers(photo.files); photo.value = ""; });
      var zone = photo.closest(".drop");
      ["dragenter", "dragover"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("is-over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("is-over"); }); });
      zone.addEventListener("drop", function (e) { ajouterFichiers(e.dataTransfer.files); });
    }
    // Rappel pour les terres quand l objet de la demande est « Versage terre »
    var rappelTerres = document.getElementById("docs-terres");
    var majRappel = function () { if (rappelTerres) rappelTerres.hidden = form.elements.sujet.value !== "Versage terre"; };
    form.elements.sujet.addEventListener("change", majRappel);
    majRappel();

    // Images réduites (1600 px, JPEG), PDF envoyés tels quels
    var lireFichier = function (f) {
      return new Promise(function (ok) {
        if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
          var r = new FileReader();
          r.onload = function () { ok({ nom: f.name, data: String(r.result).replace(/^data:[^;]*;/, "data:application/pdf;") }); };
          r.onerror = function () { ok(null); };
          r.readAsDataURL(f);
          return;
        }
        var img = new Image();
        var url = URL.createObjectURL(f);
        img.onload = function () {
          var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
          if (w > max || h > max) { var k = Math.min(max / w, max / h); w = Math.round(w * k); h = Math.round(h * k); }
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          ok({ nom: f.name.replace(/\.[^.]+$/, "") + ".jpg", data: c.toDataURL("image/jpeg", 0.82) });
        };
        img.onerror = function () { URL.revokeObjectURL(url); ok(null); };
        img.src = url;
      });
    };

    var v = function (n) { return (form.elements[n].value || "").trim(); };
    var btn = form.querySelector("button[type=submit]");
    var btnLabel = btn.firstChild.textContent;
    var erreur = document.getElementById("form-error");

    var parEmail = function () {
      var subject = "Demande " + v("sujet").toLowerCase() + " — " + v("nom") + (v("societe") ? " (" + v("societe") + ")" : "");
      var body = [
        v("message"),
        "",
        "—",
        "Nom : " + v("nom"),
        "Société : " + (v("societe") || "-"),
        "Email : " + v("email"),
        "Téléphone : " + v("telephone")
      ].concat(fichiers.length ? ["", "Documents à joindre : " + fichiers.map(function (f) { return f.name; }).join(", ") + " (je les ajoute à cet email)."] : []).join("\n");
      window.location.href = "mailto:info@recymo.be?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      var status = document.getElementById("form-status");
      if (status) status.hidden = false;
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = true;
      form.querySelectorAll("[required]").forEach(function (input) {
        var field = input.closest(".field");
        var valid = input.checkValidity() && input.value.trim() !== "";
        field.classList.toggle("invalid", !valid);
        if (!valid && ok) { input.focus(); ok = false; }
      });
      if (API && !photoOk()) {
        photo.closest(".field").classList.add("invalid");
        if (ok) photo.focus();
        ok = false;
      }
      if (!ok) return;
      if (erreur) erreur.hidden = true;
      if (!API) { parEmail(); return; }

      btn.disabled = true;
      btn.firstChild.textContent = "Envoi en cours… ";
      Promise.all(fichiers.map(lireFichier)).then(function (docs) {
        var ctrl = new AbortController();
        var t = setTimeout(function () { ctrl.abort(); }, 75000);
        return fetch(API + "/demande", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nom: v("nom"), societe: v("societe"), email: v("email"), telephone: v("telephone"),
            sujet: v("sujet"), message: v("message"), fichiers: docs.filter(Boolean), _honey: form.elements._honey.value
          }),
          signal: ctrl.signal
        }).then(function (r) {
          clearTimeout(t);
          return r.json().catch(function () { return {}; }).then(function (d) {
            if (r.ok) {
              form.reset();
              fichiers = []; afficherFichiers(); majRappel();
              var sent = document.getElementById("form-sent");
              if (sent) { sent.hidden = false; sent.focus(); }
              return;
            }
            if (r.status >= 500) throw new Error("serveur");
            if (erreur) {
              erreur.querySelector("p").textContent = d.erreur || "L'envoi n'a pas fonctionné. Appelez-nous au 085 21 74 45.";
              erreur.hidden = false;
              erreur.focus();
            }
          });
        });
      }).catch(function () {
        // Server unreachable: fall back to the visitor's mail client
        parEmail();
      }).then(function () {
        btn.disabled = false;
        btn.firstChild.textContent = btnLabel;
      });
    });
    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field");
      if (field && field.classList.contains("invalid") && e.target.checkValidity() && (e.target !== photo || photoOk())) field.classList.remove("invalid");
    });
  }

  /* Visit statistics: anonymous counts, no cookie (not counted in admin mode) */
  var enAdmin = function () { try { return !!sessionStorage.getItem("recymo-admin"); } catch (e) { return false; } };
  window.recymoStat = function (evt) {
    if (!API || enAdmin() || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon(API + "/hit", new Blob([JSON.stringify({ e: evt, p: location.pathname })], { type: "text/plain" }));
    } catch (e) {}
  };
  window.recymoStat("vue");
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || document.body.classList.contains("adm-edit")) return;
    var href = a.getAttribute("href");
    if (/^tel:/.test(href)) window.recymoStat("appel");
    else if (/#formulaire$/.test(href)) window.recymoStat("devis");
  });

  /* "⋯" menu: admin access */
  var moreBtn = document.querySelector(".more-btn");
  var moreList = document.getElementById("more-list");
  var chargerAdmin = function () {
    if (window.recymoAdminCharge) { window.recymoAdminOuvrir(); return; }
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "assets/css/admin.css";
    document.head.appendChild(css);
    var h = document.createElement("script");
    h.src = "serveur/horaires.js";
    h.onload = function () {
      var s = document.createElement("script");
      s.src = "assets/js/admin.js";
      document.body.appendChild(s);
    };
    document.body.appendChild(h);
  };
  if (moreBtn && moreList) {
    var setMore = function (open) {
      moreBtn.setAttribute("aria-expanded", String(open));
      moreList.hidden = !open;
    };
    moreBtn.addEventListener("click", function () {
      var open = moreBtn.getAttribute("aria-expanded") !== "true";
      setMore(open);
      if (open) {
        moreList.querySelector("button").focus();
        // Wake the server up while the visitor types the code
        if (API && window.fetch) fetch(API + "/sante").catch(function () {});
      }
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".more-menu")) setMore(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && moreBtn.getAttribute("aria-expanded") === "true") { setMore(false); moreBtn.focus(); }
    });
    moreList.querySelector("[data-admin-open]").addEventListener("click", function () {
      setMore(false);
      chargerAdmin();
    });
  }
  // Stay in admin mode while browsing between pages
  if (enAdmin()) chargerAdmin();

  /* Current year */
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
