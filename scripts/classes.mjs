// Génère les illustrations schématiques des classes de versage (assets/img/classes/*.svg)
// et le bloc HTML du guide. Les illustrations sont des emplacements photo : l'admin peut
// les remplacer par de vraies photos de chargement (data-photo="classe-…").
// Usage : node scripts/classes.mjs  → écrit les SVG et affiche le HTML à insérer.
import { mkdirSync, writeFileSync } from "node:fs";

// a : armatures 0-3, t : terre 0-3, f : fines 0-1, m : matière, x : hors dimensions
const CLASSES = [
  { code: "B0", nom: "Béton non armé, propre", desc: "Dimension max 50 × 50 × 150 cm, sans terre ni fines.", prix: "0,00 €", m: "beton", a: 0, t: 0, f: 0 },
  { code: "B1", nom: "Béton légèrement armé", desc: "Ou hors dimensions, ou avec fines.", prix: "5,00 €", m: "beton", a: 1, t: 0, f: 1, x: 1 },
  { code: "B2", nom: "Béton légèrement armé et/ou légèrement terreux", desc: "", prix: "8,00 €", m: "beton", a: 1, t: 1, f: 0 },
  { code: "B3", nom: "Béton fortement armé et/ou fortement terreux", desc: "", prix: "10,00 €", m: "beton", a: 2, t: 2, f: 0 },
  { code: "B4", nom: "Béton-tarmac terreux", desc: "", prix: "12,00 €", m: "betontarmac", a: 0, t: 2, f: 0 },
  { code: "B5", nom: "Béton très fortement armé, sale ou terreux", desc: "", prix: "À convenir", m: "beton", a: 3, t: 3, f: 1 },
  { code: "B6", nom: "Petites pierrailles terreuses", desc: "", prix: "14,00 €", m: "pierres", a: 0, t: 2, f: 0 },
  { code: "BR0", nom: "Bricaillons propres", desc: "Sans fines et sans terre.", prix: "0,00 €", m: "briques", a: 0, t: 0, f: 0 },
  { code: "BR1", nom: "Bricaillons propres", desc: "", prix: "5,00 €", m: "briques", a: 0, t: 0, f: 1 },
  { code: "BR2", nom: "Bricaillons légèrement sales ou légèrement terreux", desc: "", prix: "8,00 €", m: "briques", a: 0, t: 1, f: 1 },
  { code: "BR3", nom: "Bricaillons sales ou terreux", desc: "", prix: "10,00 €", m: "briques", a: 0, t: 2, f: 1 },
  { code: "BR4", nom: "Bricaillons très sales ou très terreux", desc: "", prix: "12,00 €", m: "briques", a: 0, t: 3, f: 1 },
  { code: "BR5", nom: "Bricaillons terreux", desc: "Moins de 50 % de terres.", prix: "14,00 €", m: "briques", a: 0, t: 4, f: 0 },
  { code: "BR6", nom: "Bricaillons terreux", desc: "Plus de 50 % de terres.", prix: "18,00 €", m: "briques", a: 0, t: 5, f: 0 },
  { code: "BR7", nom: "Déchets classe 3 en mélange", desc: "", prix: "À convenir", m: "melange", a: 0, t: 1, f: 1 },
  { code: "BR8", nom: "Ardoises naturelles", desc: "", prix: "20,00 €", m: "ardoises", a: 0, t: 0, f: 0 },
  { code: "BR9", nom: "Carrelages", desc: "", prix: "12,00 €", m: "carrelages", a: 0, t: 0, f: 0 },
  { code: "BR10", nom: "Bricaillons terreux", desc: "Moins de 25 % de bricaillons.", prix: "25,00 €", m: "briques", a: 0, t: 6, f: 0 }
];

// Générateur pseudo-aléatoire stable : même dessin à chaque génération
const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const W = 240, H = 160;
const C = { fond: "#f3f1ea", sol: "#e4ddcc", beton: "#b9bcb6", betonOmbre: "#9a9e97", brique: "#b5583a", briqueOmbre: "#8e4128", acier: "#2f3a35", terre: "#7a5230", terreClair: "#9c6c43", tarmac: "#3d3f40", ardoise: "#4a5560", carrelage: "#d9cfc0", fines: "#8f918b" };

const bloc = (x, y, w, h, c, o) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}"/><rect x="${x}" y="${y + h - 4}" width="${w}" height="4" rx="2" fill="${o}"/>`;

const dessiner = (k, i) => {
  const r = rnd(1000 + i * 97);
  let s = `<rect width="${W}" height="${H}" fill="${C.fond}"/><rect y="${H - 22}" width="${W}" height="22" fill="${C.sol}"/>`;
  const base = H - 22;
  // Matière principale
  if (k.m === "beton" || k.m === "betontarmac") {
    const blocs = k.x ? [[18, base - 70, 120, 70], [150, base - 50, 74, 50]] : [[26, base - 56, 90, 56], [126, base - 44, 86, 44]];
    blocs.forEach(([x, y, w, h], j) => {
      s += bloc(x, y, w, h, C.beton, C.betonOmbre);
      if (k.m === "betontarmac" && j === 1) s += `<rect x="${x}" y="${y}" width="${w}" height="12" rx="3" fill="${C.tarmac}"/>`;
    });
    // Armatures : fers qui dépassent du béton, plus nombreux, plus longs et tordus selon le niveau
    const n = [0, 3, 8, 16][k.a];
    for (let b = 0; b < n; b++) {
      const [x, y, w, h] = blocs[b % 2];
      const cote = b % 3; // 0 : gauche, 1 : droite, 2 : dessus
      const long = (k.a === 1 ? 10 : 18) + r() * (k.a === 1 ? 10 : 26);
      let x0, y0, dx, dy;
      if (cote === 0) { x0 = x + 2; y0 = y + 8 + r() * (h - 16); dx = -long; dy = (r() - .5) * 12; }
      else if (cote === 1) { x0 = x + w - 2; y0 = y + 8 + r() * (h - 16); dx = long; dy = (r() - .5) * 12; }
      else { x0 = x + 10 + r() * (w - 20); y0 = y + 2; dx = (r() - .5) * 20; dy = -long; }
      const tordu = k.a >= 2 && r() < 0.5;
      const d = tordu
        ? `M${x0.toFixed(1)} ${y0.toFixed(1)} q ${(dx * .6).toFixed(1)} ${(dy * .6).toFixed(1)} ${(dx + (r() - .5) * 18).toFixed(1)} ${(dy - 10 - r() * 10).toFixed(1)}`
        : `M${x0.toFixed(1)} ${y0.toFixed(1)} l ${dx.toFixed(1)} ${dy.toFixed(1)}`;
      s += `<path d="${d}" stroke="${C.acier}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;
    }
  } else if (k.m === "briques" || k.m === "melange") {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 7; col++) {
        if (r() < 0.25 + row * 0.1) continue;
        const x = 14 + col * 30 + row * 6 + r() * 6, y = base - 16 - row * 15 - r() * 4;
        s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${24 + r() * 6}" height="12" rx="2" fill="${r() < 0.5 ? C.brique : C.briqueOmbre}" transform="rotate(${((r() - .5) * 18).toFixed(1)} ${x} ${y})"/>`;
      }
    }
    if (k.m === "melange") {
      s += bloc(140, base - 40, 60, 30, C.beton, C.betonOmbre);
      s += `<rect x="40" y="${base - 48}" width="50" height="10" rx="2" fill="${C.carrelage}" stroke="#b9ad9a"/>`;
    }
  } else if (k.m === "pierres") {
    for (let p = 0; p < 34; p++) {
      const x = 16 + r() * 208, y = base - 6 - r() * 46 * (1 - Math.abs(x - 120) / 140);
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(5 + r() * 6).toFixed(1)}" ry="${(4 + r() * 4).toFixed(1)}" fill="${r() < .5 ? C.beton : C.betonOmbre}"/>`;
    }
  } else if (k.m === "ardoises") {
    for (let p = 0; p < 9; p++) {
      const x = 20 + p * 22 + r() * 6, y = base - 10 - r() * 40;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="44" height="7" rx="1.5" fill="${C.ardoise}" transform="rotate(${((r() - .5) * 50).toFixed(1)} ${x + 22} ${y})"/>`;
    }
  } else if (k.m === "carrelages") {
    for (let p = 0; p < 14; p++) {
      const x = 18 + (p % 7) * 30 + r() * 4, y = base - 14 - Math.floor(p / 7) * 18 - r() * 8;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="26" height="9" rx="1" fill="${C.carrelage}" stroke="#a89c88" transform="rotate(${((r() - .5) * 30).toFixed(1)} ${x + 13} ${y})"/>`;
    }
  }
  // Terre : de quelques mottes à un tas qui recouvre presque tout
  const tas = [0, 0, 0, 0, 0.42, 0.62, 0.85][k.t] || 0;
  if (tas) {
    const h = 90 * tas;
    s += `<path d="M0 ${base} Q ${W * .3} ${base - h * 1.1} ${W * .55} ${base - h} T ${W} ${base} Z" fill="${C.terre}"/>`;
  }
  const mottes = [0, 6, 16, 28, 10, 8, 6][k.t] || 0;
  for (let m = 0; m < mottes; m++) {
    const x = 10 + r() * 220, y = base - 2 - r() * 34;
    s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(4 + r() * 9).toFixed(1)}" ry="${(3 + r() * 5).toFixed(1)}" fill="${r() < .5 ? C.terre : C.terreClair}"/>`;
  }
  // Fines : petit gravier
  if (k.f) for (let d = 0; d < 26; d++) s += `<circle cx="${(8 + r() * 224).toFixed(1)}" cy="${(base - 1 - r() * 8).toFixed(1)}" r="${(1 + r() * 1.8).toFixed(1)}" fill="${C.fines}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg>\n`;
};

mkdirSync("assets/img/classes", { recursive: true });
const carte = (k, i) => {
  writeFileSync(`assets/img/classes/${k.code.toLowerCase()}.svg`, dessiner(k, i));
  return `            <li class="classe">
              <img data-photo="classe-${k.code.toLowerCase()}" src="assets/img/classes/${k.code.toLowerCase()}.svg" alt="Illustration de la classe ${k.code} : ${k.nom.toLowerCase()}" width="240" height="160" loading="lazy">
              <div class="classe-body">
                <p class="classe-head"><span class="ref">${k.code}</span><span class="classe-prix">${k.prix}${/€/.test(k.prix) ? "/t" : ""}</span></p>
                <h4>${k.nom}</h4>
                ${k.desc ? `<p class="classe-desc">${k.desc}</p>` : ""}
              </div>
            </li>`;
};

const groupe = (titre, liste, debut) => `          <h4 class="classes-groupe">${titre}</h4>
          <ul class="classes">
${liste.map((k, i) => carte(k, debut + i)).join("\n")}
          </ul>`;

console.log(groupe("Les bétons", CLASSES.slice(0, 7), 0) + "\n" + groupe("Les bricaillons", CLASSES.slice(7), 7));
