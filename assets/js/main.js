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

  /* Contact form: validates, then sends directly (FormSubmit, when an endpoint
     is configured) or opens the visitor's mail client prefilled */
  var form = document.getElementById("contact-form");
  if (form) {
    var endpoint = form.getAttribute("data-endpoint");
    var params = new URLSearchParams(location.search);

    if (endpoint) {
      form.action = endpoint;
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

    if (params.get("envoye") === "1") {
      var sent = document.getElementById("form-sent");
      if (sent) { sent.hidden = false; sent.focus(); }
    }

    var photo = form.elements.attachment;
    var photoOk = function () {
      return !photo || !photo.files || !photo.files[0] || photo.files[0].size <= 5 * 1024 * 1024;
    };

    form.addEventListener("submit", function (e) {
      var ok = true;
      form.querySelectorAll("[required]").forEach(function (input) {
        var field = input.closest(".field");
        var valid = input.checkValidity() && input.value.trim() !== "";
        field.classList.toggle("invalid", !valid);
        if (!valid && ok) { input.focus(); ok = false; }
      });
      if (endpoint && !photoOk()) {
        photo.closest(".field").classList.add("invalid");
        if (ok) photo.focus();
        ok = false;
      }
      var v = function (n) { return (form.elements[n].value || "").trim(); };
      var subject = "Demande " + v("sujet").toLowerCase() + " — " + v("nom") + (v("societe") ? " (" + v("societe") + ")" : "");
      if (!ok) { e.preventDefault(); return; }

      if (endpoint) {
        // Let the browser post the form; FormSubmit redirects back here
        form.elements._subject.value = subject;
        form.elements._next.value = location.origin + location.pathname + "?envoye=1#formulaire";
        var btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.firstChild.textContent = "Envoi en cours… ";
        return;
      }
      e.preventDefault();
      var body = [
        v("message"),
        "",
        "—",
        "Nom : " + v("nom"),
        "Société : " + (v("societe") || "-"),
        "Email : " + v("email"),
        "Téléphone : " + v("telephone")
      ].join("\n");
      window.location.href = "mailto:info@recymo.be?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      var status = document.getElementById("form-status");
      if (status) status.hidden = false;
    });
    form.addEventListener("change", function (e) { if (e.target === photo && photoOk()) photo.closest(".field").classList.remove("invalid"); });
    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field");
      if (field && field.classList.contains("invalid") && e.target.checkValidity() && (e.target !== photo || photoOk())) field.classList.remove("invalid");
    });
  }

  /* Current year */
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
