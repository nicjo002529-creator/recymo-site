// Mise en forme des horaires, partagée par le serveur (Node) et la page admin (navigateur).
// Format : { site: { nom, jours: { "1": ["07:00", "17:00"], … }, note } }, 1 = lundi … 7 = dimanche.
(function (racine) {
  "use strict";
  var COURT = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  var LONG = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  var JSONLD = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  var h = function (hhmm) { var p = hhmm.split(":"); return +p[0] + "h" + p[1]; };
  var jour = function (j) { return String(j === 0 ? 7 : j); };

  // Regroupe les jours consécutifs qui ont les mêmes heures
  var groupes = function (site) {
    var out = [];
    for (var j = 1; j <= 7; j++) {
      var p = site.jours[jour(j)] || null;
      var cle = p ? p.join("-") : "ferme";
      var dernier = out[out.length - 1];
      if (dernier && dernier.cle === cle && dernier.fin === j - 1) dernier.fin = j;
      else out.push({ cle: cle, debut: j, fin: j, plage: p });
    }
    return out;
  };
  var nomGroupe = function (g, noms, sep) {
    return g.debut === g.fin ? noms[g.debut] : noms[g.debut] + sep + noms[g.fin];
  };

  var texteCourt = function (site) {
    var parts = groupes(site).filter(function (g) { return g.plage; }).map(function (g) {
      return nomGroupe(g, COURT, "–") + " " + h(g.plage[0]) + "–" + h(g.plage[1]);
    });
    if (site.note) parts.push(site.note);
    return parts.join(" · ") || "Sur rendez-vous";
  };

  var listeHtml = function (site, echapper) {
    var lignes = groupes(site).map(function (g) {
      return "\n              <div><dt>" + nomGroupe(g, LONG, " – ") + "</dt>" +
        (g.plage ? "<dd>" + h(g.plage[0]) + " – " + h(g.plage[1]) + "</dd>" : '<dd class="closed">Fermé</dd>') + "</div>";
    });
    if (site.note) lignes.push('\n              <div><dt>Note</dt><dd>' + echapper(site.note) + "</dd></div>");
    return lignes.join("") + "\n            ";
  };

  var jsonLd = function (site) {
    var lignes = groupes(site).filter(function (g) { return g.plage; }).map(function (g) {
      var jours = [];
      for (var j = g.debut; j <= g.fin; j++) jours.push('"' + JSONLD[j] + '"');
      return '\n      { "@type": "OpeningHoursSpecification", "dayOfWeek": ' + (jours.length > 1 ? "[" + jours.join(",") + "]" : jours[0]) +
        ', "opens": "' + g.plage[0] + '", "closes": "' + g.plage[1] + '" }';
    });
    return "[" + lignes.join(",") + "\n    ]";
  };

  // Vérifie et nettoie les horaires reçus de la page admin
  var valider = function (data) {
    var propre = {};
    var heure = /^([01]\d|2[0-3]):[0-5]\d$/;
    Object.keys(data || {}).forEach(function (k) {
      if (!/^[a-z-]{2,30}$/.test(k)) return;
      var s = data[k] || {};
      var jours = {};
      Object.keys(s.jours || {}).forEach(function (j) {
        var p = s.jours[j];
        if (/^[1-7]$/.test(j) && Array.isArray(p) && heure.test(p[0]) && heure.test(p[1]) && p[0] < p[1]) jours[j] = [p[0], p[1]];
      });
      propre[k] = { nom: String(s.nom || k).slice(0, 60), jours: jours, note: String(s.note || "").slice(0, 120) };
    });
    if (!Object.keys(propre).length) throw Object.assign(new Error("Horaires invalides"), { status: 400 });
    return propre;
  };

  var api = { texteCourt: texteCourt, listeHtml: listeHtml, jsonLd: jsonLd, valider: valider, groupes: groupes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.RecymoHoraires = api;
})(this);
