/* Xbox Vault — app principal. Dados vêm de data/db.js (window.XBX_DB). */
(function () {
"use strict";

var DB = window.XBX_DB || { games: [], generated: null };
var GAMES = DB.games || [];
var OWNED_KEY = "xbx.owned.v1";      // formato antigo, só para migrar
var WISH_KEY  = "xbx.wishlist.v1";   // idem
var MARKS_KEY = "xbx.marks.v3";
var FILT_KEY  = "xbx.filters.v1";
var BATCH = 120;

/* ---------------- estado ---------------- */
/* marks: { "<id>": { s: "own" | "wish" | null, t: <epoch ms> } }
   O timestamp existe por causa da sincronização: sem ele, juntar dois dispositivos
   ressuscita o que você desmarcou num deles. `s: null` é uma lápide — registra que
   a marcação foi REMOVIDA naquele instante, em vez de sumir do arquivo. */
var marks = {};
var owned = new Set(), wishlist = new Set();

function rebuildSets() {
  owned = new Set(); wishlist = new Set();
  for (var id in marks) {
    if (marks[id].s === "own") owned.add(id);
    else if (marks[id].s === "wish") wishlist.add(id);
  }
}

(function loadMarks() {
  try { marks = JSON.parse(localStorage.getItem(MARKS_KEY) || "null") || {}; } catch (e) { marks = {}; }
  if (!Object.keys(marks).length) {          // migra o formato antigo, se houver
    var t = Date.now(), got = false;
    try {
      JSON.parse(localStorage.getItem(OWNED_KEY) || "[]").forEach(function (i) {
        marks[i] = { s: "own", t: t }; got = true;
      });
      JSON.parse(localStorage.getItem(WISH_KEY) || "[]").forEach(function (i) {
        marks[i] = { s: "wish", t: t }; got = true;
      });
    } catch (e) {}
    if (got) try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch (e) {}
  }
  rebuildSets();
})();

var F = {
  q: "", own: "all", plats: ["x360", "xbox", "homebrew"], modes: [], flags: [],
  plScope: "any", plMin: 0, y1: "", y2: "", bc: "all", cat: "", genres: [], sort: "year-desc"
};
try { Object.assign(F, JSON.parse(localStorage.getItem(FILT_KEY) || "{}")); } catch (e) {}

var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

function norm(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* índice de busca pré-computado (título + devs + publishers) */
GAMES.forEach(function (g) {
  g._s = norm([g.title, (g.developers || []).join(" "), (g.publishers || []).join(" ")].join(" "));
  g._t = g.tags || {};
});

/* ---------------- filtragem ---------------- */
function maxPlayers(g, scope) {
  var t = g._t;
  if (scope === "local")  return t.maxPlayersLocal || 0;
  if (scope === "online") return t.maxPlayersOnline || 0;
  return Math.max(t.maxPlayersLocal || 0, t.maxPlayersOnline || 0, t.maxPlayers || 0);
}

function match(g, skip) {
  if (skip !== "plat" && F.plats.indexOf(g.platform) < 0) return false;
  if (F.q && g._s.indexOf(F.q) < 0) return false;

  if (F.own === "yes" && !owned.has(g.id)) return false;
  if (F.own === "no" && owned.has(g.id)) return false;
  if (F.own === "wish" && !wishlist.has(g.id)) return false;

  if (skip !== "mode") {
    for (var i = 0; i < F.modes.length; i++) if (!g._t[F.modes[i]]) return false;
  }
  if (skip !== "flag") {
    for (var j = 0; j < F.flags.length; j++) {
      var f = F.flags[j], v = (g.flags || {})[f];
      if (f === "kinect") { if (!v) return false; }
      else if (!v) return false;
    }
  }
  if (F.plMin > 0 && maxPlayers(g, F.plScope) < F.plMin) return false;

  if (F.y1 && (g.year == null || g.year < +F.y1)) return false;
  if (F.y2 && (g.year == null || g.year > +F.y2)) return false;

  if (F.bc !== "all" && g.platform === "xbox") {
    var c = !!(g.bc360 && g.bc360.compatible);
    if (F.bc === "yes" && !c) return false;
    if (F.bc === "no" && c) return false;
  }
  if (F.bc === "yes" && g.platform !== "xbox") return false;

  if (F.cat && g.category !== F.cat) return false;
  if (F.genres.length && F.genres.indexOf(g.genre || "") < 0) return false;
  return true;
}

function filtered(skip) {
  var out = [];
  for (var i = 0; i < GAMES.length; i++) if (match(GAMES[i], skip)) out.push(GAMES[i]);
  return out;
}

function sortList(list) {
  var s = F.sort;
  return list.sort(function (a, b) {
    if (s === "title") return a.title.localeCompare(b.title);
    if (s === "players") return maxPlayers(b, "any") - maxPlayers(a, "any") || a.title.localeCompare(b.title);
    var ya = a.year == null ? -Infinity : a.year, yb = b.year == null ? -Infinity : b.year;
    if (ya !== yb) return s === "year-asc" ? ya - yb : yb - ya;
    return a.title.localeCompare(b.title);
  });
}

/* ---------------- render ---------------- */
var queue = [], qi = 0, io = null;

function tagsHtml(g) {
  var t = g._t, h = [], pl;
  if (g.platform === "x360") h.push('<span class="tag plat">360</span>');
  else if (g.platform === "xbox") h.push('<span class="tag plat">XBOX</span>');
  else h.push('<span class="tag plat">HB</span>');

  if (t.singlePlayer) h.push('<span class="tag sp">1P</span>');
  if (t.multiplayerLocal) {
    pl = t.maxPlayersLocal ? t.maxPlayersLocal + "P" : "";
    h.push('<span class="tag loc">LOCAL' + (pl ? " " + pl : "") + "</span>");
  }
  if (t.multiplayerOnline) {
    pl = t.maxPlayersOnline ? t.maxPlayersOnline + "P" : "";
    h.push('<span class="tag onl">ONLINE' + (pl ? " " + pl : "") + "</span>");
  }
  if (t.coop) h.push('<span class="tag co">CO-OP' + (t.coopLocal ? " LOCAL" : "") + "</span>");
  if (t.versus) h.push('<span class="tag vs">VS</span>');

  if (g.platform === "xbox") {
    h.push(g.bc360 && g.bc360.compatible
      ? '<span class="tag bc">RETRO ✓</span>'
      : '<span class="tag nobc">RETRO ✗</span>');
  }
  var f = g.flags || {};
  if (f.xbla) h.push('<span class="tag">XBLA</span>');
  if (f.kinect) h.push('<span class="tag">KINECT</span>');
  if (g.category) h.push('<span class="tag">' + esc(g.category.toUpperCase()) + "</span>");
  return h.join("");
}

/* capa: tenta o arquivo local, cai para a URL da Wikipedia, depois placeholder */
window.XBXimgErr = function (im) {
  var fb = im.getAttribute("data-fb");
  if (fb) { im.removeAttribute("data-fb"); im.src = fb; return; }
  var card = im.closest(".card"), h3 = card && card.querySelector("h3");
  var ph = document.createElement("div");
  ph.className = "ph";
  ph.textContent = h3 ? h3.textContent : "";
  im.parentNode.replaceChild(ph, im);
};

function cardHtml(g) {
  var img = g.image
    ? '<img loading="lazy" src="' + esc(g.image) + '"' +
      (g.imageRemote ? ' data-fb="' + esc(g.imageRemote) + '"' : "") +
      ' alt="' + esc(g.title) + '"' + (g.wide ? ' class="wide"' : "") +
      ' onerror="XBXimgErr(this)">'
    : '<div class="ph">' + esc(g.title) + "</div>";
  var sub = g.platform === "homebrew"
    ? esc(g.description || g.category || "")
    : esc([g.genre, (g.developers || [])[0]].filter(Boolean).join(" · "));
  var link = g.wiki
    ? '<a href="https://en.wikipedia.org/wiki/' + encodeURIComponent(g.wiki) + '" target="_blank" rel="noopener">' + esc(g.title) + "</a>"
    : (g.url ? '<a href="' + esc(g.url) + '" target="_blank" rel="noopener">' + esc(g.title) + "</a>" : esc(g.title));

  var o = owned.has(g.id), w = wishlist.has(g.id);
  return '<article class="card' + (o ? " own" : "") + (w ? " wish" : "") +
    '" data-id="' + esc(g.id) + '">' +
    '<div class="marks">' +
    '<button class="own-btn" title="Marcar como tenho">' + (o ? "✓" : "+") + "</button>" +
    '<button class="wish-btn" title="Adicionar à wishlist">' + (w ? "★" : "☆") + "</button>" +
    "</div>" +
    '<div class="thumb">' + img + "</div>" +
    '<div class="body"><h3>' + link + "</h3>" +
    '<div class="sub">' + sub + "</div>" +
    '<div class="tags">' + tagsHtml(g) + "</div></div></article>";
}

function buildQueue(list) {
  var groups = [], cur = null;
  for (var i = 0; i < list.length; i++) {
    var y = list[i].year == null ? "Sem ano" : list[i].year;
    if (!cur || cur.y !== y) { cur = { y: y, items: [] }; groups.push(cur); }
    cur.items.push(list[i]);
  }
  queue = groups; qi = 0;
}

function renderMore() {
  var main = $("#main"), html = "", n = 0;
  while (qi < queue.length && n < BATCH) {
    var g = queue[qi];
    html += '<section><div class="year"><h2>' + esc(g.y) + '</h2><span class="cnt">' +
      g.items.length + " jogo" + (g.items.length > 1 ? "s" : "") + '</span><div class="ln"></div></div><div class="grid">' +
      g.items.map(cardHtml).join("") + "</div></section>";
    n += g.items.length; qi++;
  }
  var sent = $("#sentinel");
  if (sent) sent.insertAdjacentHTML("beforebegin", html);
  else main.insertAdjacentHTML("beforeend", html + '<div class="sentinel" id="sentinel"></div>');
  if (qi >= queue.length && $("#sentinel")) $("#sentinel").remove();
}

function render() {
  var list = sortList(filtered(null));
  var main = $("#main");
  main.innerHTML = "";
  if (!list.length) {
    main.innerHTML = '<div class="empty">Nenhum jogo bate com esses filtros.<br>Tente limpar alguns.</div>';
  } else {
    buildQueue(list);
    renderMore();
    observe();
  }
  updateStats(list);
  updateFacets();
}

function observe() {
  if (io) io.disconnect();
  io = new IntersectionObserver(function (es) {
    if (es[0].isIntersecting && qi < queue.length) { renderMore(); observe(); }
  }, { rootMargin: "600px" });
  var s = $("#sentinel");
  if (s) io.observe(s);
}

/* ---------------- stats e contadores ---------------- */
function updateStats(list) {
  var ownCount = 0, byPlat = { x360: 0, xbox: 0, homebrew: 0 }, ownPlat = { x360: 0, xbox: 0, homebrew: 0 };
  GAMES.forEach(function (g) {
    byPlat[g.platform]++;
    if (owned.has(g.id)) { ownCount++; ownPlat[g.platform]++; }
  });
  $("#s-wish").textContent = wishlist.size.toLocaleString("pt-BR");
  $("#s-shown").textContent = list.length.toLocaleString("pt-BR");
  $("#s-total").textContent = GAMES.length.toLocaleString("pt-BR");
  $("#s-own").textContent = ownCount.toLocaleString("pt-BR");
  var pct = GAMES.length ? (ownCount / GAMES.length * 100) : 0;
  $("#s-pct").textContent = "(" + pct.toFixed(1) + "%)";
  $("#s-bar").style.width = pct + "%";
  $("#s-breakdown").textContent =
    "360: " + ownPlat.x360 + "/" + byPlat.x360 +
    " · Xbox: " + ownPlat.xbox + "/" + byPlat.xbox +
    " · Homebrew: " + ownPlat.homebrew + "/" + byPlat.homebrew;
  $$("[data-cnt^='plat-']").forEach(function (el) {
    el.textContent = byPlat[el.dataset.cnt.slice(5)] || 0;
  });
}

function updateFacets() {
  var fm = filtered("mode"), ff = filtered("flag");
  $$("[data-cnt^='m-']").forEach(function (el) {
    var k = el.dataset.cnt.slice(2), n = 0;
    fm.forEach(function (g) { if (g._t[k]) n++; });
    el.textContent = n;
  });
  $$("[data-cnt^='f-']").forEach(function (el) {
    var k = el.dataset.cnt.slice(2), n = 0;
    ff.forEach(function (g) { if ((g.flags || {})[k]) n++; });
    el.textContent = n;
  });
}

/* ---------------- detalhes ---------------- */
var REGIAO = { NA: "América do Norte", EU: "Europa", PAL: "PAL (Europa/Oceania)",
               JP: "Japão", AU: "Austrália" };
var PLATNOME = { x360: "Xbox 360", xbox: "Xbox original", homebrew: "Homebrew" };
var CONFNOTA = {
  high: "conferido à mão, ou vindo do campo estruturado do artigo",
  medium: "inferido do texto do artigo",
  low: "inferido do gênero, ou sem artigo de referência"
};

function fmtDate(s) {
  if (!s) return null;
  var p = String(s).split("-");
  if (p.length === 3) return p[2] + "/" + p[1] + "/" + p[0];
  if (p.length === 2) return p[1] + "/" + p[0];
  return p[0];
}

function linha(rot, val) {
  return val ? '<div class="li"><span>' + rot + "</span><b>" + val + "</b></div>" : "";
}

function modosHtml(g) {
  var t = g.tags || {}, out = [];
  var qtd = function (n) { return n ? " — até " + n + (n > 1 ? " jogadores" : " jogador") : ""; };
  if (t.source === "not-a-game")
    return '<p class="nota">Não é um jogo — é ' +
      ({ emulator: "um emulador", dashboard: "um dashboard", utility: "um utilitário",
         media: "um app de mídia" }[g.category] || "um software") +
      ", então não tem modo de jogo.</p>";
  if (t.singlePlayer) out.push("Single player");
  if (t.multiplayerLocal) out.push("Multiplayer local" + qtd(t.maxPlayersLocal));
  if (t.multiplayerOnline) out.push("Multiplayer online" + qtd(t.maxPlayersOnline));
  if (t.coop) out.push("Co-op" + (t.coopLocal && t.coopOnline ? " (local e online)"
      : t.coopLocal ? " (local)" : t.coopOnline ? " (online)" : ""));
  if (t.versus) out.push("Versus" + (t.versusLocal ? " (local)" : ""));
  if (!out.length) return '<p class="nota">Sem informação de modo de jogo.</p>';
  var h = "<ul class=\"modos\">" + out.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  if (CONFNOTA[t.confidence])
    h += '<p class="nota">Confiança <b>' + esc(t.confidence) + "</b> — " + CONFNOTA[t.confidence] + ".</p>";
  return h;
}

function detalheHtml(g) {
  var o = owned.has(g.id), w = wishlist.has(g.id), t = g.tags || {};
  var capa = g.image
    ? '<img src="' + esc(g.image) + '" alt="' + esc(g.title) + '"' + (g.wide ? ' class="wide"' : "") + ">"
    : '<div class="ph">' + esc(g.title) + "</div>";

  var ficha = linha("Plataforma", esc(PLATNOME[g.platform] || g.platform)) +
    linha("Ano", g.year || null) +
    linha("Gênero", esc(g.genre || "")) +
    linha("Categoria", g.category ? esc(g.category) : null) +
    linha("Console", g.console ? esc(g.console === "x360" ? "Xbox 360"
          : g.console === "both" ? "Xbox e Xbox 360" : "Xbox original") : null) +
    linha("Desenvolvedora", esc((g.developers || []).join(", "))) +
    linha("Publicadora", esc((g.publishers || []).join(", ")));

  var lanc = "";
  if (g.releases) {
    var ls = Object.keys(g.releases).filter(function (k) { return g.releases[k]; })
      .map(function (k) { return linha(REGIAO[k] || k, fmtDate(g.releases[k])); }).join("");
    if (ls) lanc = "<h4>Lançamento</h4>" + ls;
  }

  var bc = "";
  if (g.platform === "xbox" && g.bc360) {
    var c = g.bc360;
    bc = "<h4>Retrocompatibilidade com o Xbox 360</h4>" +
      '<p class="' + (c.compatible ? "sim" : "nao") + '">' +
      (c.compatible ? "✓ Roda no Xbox 360" : "✗ Não roda no Xbox 360") + "</p>" +
      (c.compatible ? linha("Região", esc(c.region === "all" ? "todas" : (c.regions || [c.region]).join(", "))) : "") +
      (c.xboxOriginals ? linha("Xbox Originals", "sim (era vendido digitalmente)") : "") +
      (c.issues ? '<p class="nota"><b>Problemas conhecidos:</b> ' + esc(c.issues) + "</p>" : "");
  }

  var extras = [];
  var f = g.flags || {};
  if (f.xbla) extras.push("Xbox Live Arcade");
  if (f.kinect) extras.push("Kinect (" + (f.kinect === "required" ? "obrigatório" : "opcional") + ")");
  if (f.xboxOne) extras.push("Roda também no Xbox One");
  if (f.stereo3d) extras.push("Suporte a 3D estereoscópico");

  var links = [];
  if (g.wiki) links.push('<a href="https://en.wikipedia.org/wiki/' + encodeURIComponent(g.wiki) +
    '" target="_blank" rel="noopener">Wikipédia ↗</a>');
  if (g.url) links.push('<a href="' + esc(g.url) + '" target="_blank" rel="noopener">Página do projeto ↗</a>');

  return '<div class="det">' +
    '<div class="det-capa">' + capa + "</div>" +
    '<div class="det-info">' +
      "<h3>" + esc(g.title) + "</h3>" +
      '<div class="det-sub">' + esc([PLATNOME[g.platform], g.year, g.genre || g.category]
        .filter(Boolean).join(" · ")) + "</div>" +
      (g.description ? '<p class="desc">' + esc(g.description) + "</p>" : "") +
      '<div class="det-acoes">' +
        '<button class="btn ' + (o ? "primary" : "") + '" data-mark="own">' +
          (o ? "✓ Eu tenho" : "+ Marcar que tenho") + "</button>" +
        '<button class="btn ' + (w ? "amber" : "") + '" data-mark="wish">' +
          (w ? "★ Na wishlist" : "☆ Pôr na wishlist") + "</button>" +
      "</div>" +
      "<h4>Modos de jogo</h4>" + modosHtml(g) +
      (extras.length ? "<h4>Extras</h4><ul class=\"modos\">" +
        extras.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      bc +
      "<h4>Ficha</h4>" + ficha +
      lanc +
      (links.length ? '<div class="det-links">' + links.join("") + "</div>" : "") +
    "</div></div>";
}

var detAtual = null;
function openDetail(g) {
  detAtual = g;
  openModal(detalheHtml(g), "sheet--det");
}

/* ---------------- coleção ---------------- */
function saveMarks() {
  try {
    localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
    // mantém as chaves antigas em dia para não quebrar nada que ainda as leia
    localStorage.setItem(OWNED_KEY, JSON.stringify(Array.from(owned)));
    localStorage.setItem(WISH_KEY, JSON.stringify(Array.from(wishlist)));
  } catch (e) { alert("Não consegui salvar no navegador: " + e.message); }
  if (window.XBXSync) XBXSync.agendarGravacao();
}

function setMark(id, estado) {
  marks[id] = { s: estado, t: Date.now() };
  rebuildSets();
}

/* Junta marcações vindas de fora: vence a mais recente, item a item.
   Devolve quantos itens mudaram aqui. */
function mergeMarks(remoto) {
  var mudou = 0;
  for (var id in remoto) {
    var r = remoto[id];
    if (!r || typeof r.t !== "number") continue;
    var l = marks[id];
    if (!l || r.t > l.t) {
      if (!l || l.s !== r.s) mudou++;
      marks[id] = { s: r.s === "own" || r.s === "wish" ? r.s : null, t: r.t };
    }
  }
  if (mudou) { rebuildSets(); try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch (e) {} }
  return mudou;
}

function paintCard(card, id) {
  var o = owned.has(id), w = wishlist.has(id);
  card.classList.toggle("own", o);
  card.classList.toggle("wish", w);
  card.querySelector(".own-btn").textContent = o ? "✓" : "+";
  card.querySelector(".wish-btn").textContent = w ? "★" : "☆";
}
/* "tenho" e "quero" se contradizem: marcar um limpa o outro, senao o arquivo
   exportado sairia com o mesmo jogo nas duas listas. */
function toggleMark(id, which, card) {
  var atual = marks[id] && marks[id].s;
  setMark(id, atual === which ? null : which);   // null = lápide, não some do arquivo
  saveMarks();
  if (card) paintCard(card, id);
  updateStats(filtered(null));
  if (F.own !== "all") render();
}

/* ---------------- export / import ---------------- */
function doExport() {
  var payload = {
    app: "xbox-vault", version: 3,
    exportedAt: new Date().toISOString(),
    catalogGenerated: DB.generated || null,
    count: owned.size,
    wishlistCount: wishlist.size,
    // owned/wishlist ficam para leitura humana e compatibilidade com versões antigas;
    // `marks` é a fonte da verdade, porque carrega o quando de cada mudança
    owned: Array.from(owned).sort(),
    wishlist: Array.from(wishlist).sort(),
    marks: marks
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "xbox-vault-colecao-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

function parseImport(text) {
  var data = JSON.parse(text);
  var str = function (a) { return a.filter(function (x) { return typeof x === "string"; }); };
  if (Array.isArray(data)) return { owned: str(data), wishlist: [], marks: null };
  var o = data.owned || data.ids || [], w = data.wishlist || [];
  if (!Array.isArray(o) || !Array.isArray(w))
    throw new Error("Formato não reconhecido: esperava as listas 'owned' e 'wishlist'.");
  var m = data.marks && typeof data.marks === "object" ? data.marks : null;
  return { owned: str(o), wishlist: str(w), marks: m };  // v1/v2 não têm marks
}

function applyImport(p, mode) {
  var known = new Set(GAMES.map(function (g) { return g.id; }));
  var keep = function (a) { return a.filter(function (i) { return known.has(i); }); };
  var o = keep(p.owned), w = keep(p.wishlist);
  var unknown = (p.owned.length - o.length) + (p.wishlist.length - w.length);
  if (p.marks) {                       // arquivo v3: junta respeitando os timestamps
    if (mode === "replace") { marks = {}; }
    var lim = {};
    for (var k in p.marks) if (known.has(k)) lim[k] = p.marks[k];
    if (mode === "replace") { marks = lim; rebuildSets(); }
    else mergeMarks(lim);
  } else {                             // arquivo v1/v2: sem timestamp, assume "agora"
    var agora = Date.now();
    if (mode === "replace") marks = {};
    o.forEach(function (i) { marks[i] = { s: "own", t: agora }; });
    w.forEach(function (i) { marks[i] = { s: "wish", t: agora }; });
    rebuildSets();
  }
  saveMarks(); render();
  closeModal();
  alert("Importado: " + o.length + " na coleção, " + w.length + " na wishlist" +
    (unknown ? "\n" + unknown + " id(s) do arquivo não existem neste catálogo e foram ignorados." : "") +
    "\nAgora: " + owned.size + " que tenho, " + wishlist.size + " na wishlist.");
}

function openModal(html, cls) {
  $("#modal-body").innerHTML = html;
  $(".sheet").className = "sheet" + (cls ? " " + cls : "");
  $("#modal").hidden = false;
}
function closeModal() {
  $("#modal").hidden = true;
  $("#modal-body").innerHTML = "";   // limpa: senão os botões do diálogo anterior
  detAtual = null;                   // continuam no DOM e podem ser reativados
}

var pending = null;
function importFlow(text) {
  try { pending = parseImport(text); }
  catch (e) { alert("Arquivo inválido: " + e.message); return; }
  openModal(
    "<h3>Importar</h3><p>O arquivo tem <b>" + pending.owned.length +
    "</b> jogo(s) na coleção e <b>" + pending.wishlist.length +
    "</b> na wishlist. Como aplicar?</p>" +
    '<button class="btn primary" id="imp-merge">➕ Somar ao que já tenho aqui (' +
    owned.size + " + " + wishlist.size + " na wishlist)</button>" +
    '<button class="btn" id="imp-replace">♻️ Substituir tudo pelo arquivo</button>');
  $("#imp-merge").onclick = function () { applyImport(pending, "merge"); };
  $("#imp-replace").onclick = function () {
    if (confirm("Isso apaga sua coleção atual (" + owned.size + " jogos e " + wishlist.size +
                " na wishlist) e usa só a do arquivo. Confirmar?"))
      applyImport(pending, "replace");
  };
}

/* ---------------- UI ---------------- */
function saveF() { try { localStorage.setItem(FILT_KEY, JSON.stringify(F)); } catch (e) {} }
function onChange() { saveF(); render(); }

function initControls() {
  // anos
  var years = Array.from(new Set(GAMES.map(function (g) { return g.year; })
    .filter(function (y) { return y != null; }))).sort(function (a, b) { return a - b; });
  var o1 = '<option value="">—</option>' + years.map(function (y) { return "<option>" + y + "</option>"; }).join("");
  $("#f-y1").innerHTML = o1; $("#f-y2").innerHTML = o1;
  $("#f-y1").value = F.y1; $("#f-y2").value = F.y2;

  // gêneros
  var gc = {};
  GAMES.forEach(function (g) { if (g.genre) gc[g.genre] = (gc[g.genre] || 0) + 1; });
  var gens = Object.keys(gc).sort(function (a, b) { return gc[b] - gc[a] || a.localeCompare(b); });
  $("#f-genres").innerHTML = gens.map(function (g) {
    return '<label class="chk"><input type="checkbox" class="f-genre" value="' + esc(g) + '"' +
      (F.genres.indexOf(g) >= 0 ? " checked" : "") + "> " + esc(g) + '<span class="n">' + gc[g] + "</span></label>";
  }).join("");

  // categorias homebrew
  var cats = Array.from(new Set(GAMES.map(function (g) { return g.category; }).filter(Boolean))).sort();
  $("#f-cat").innerHTML = '<option value="">Todas</option>' +
    cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");

  // restaura estado
  $("#q").value = F.q ? F.q : "";
  $("#f-own").value = F.own; $("#f-bc").value = F.bc; $("#f-cat").value = F.cat;
  $("#f-sort").value = F.sort; $("#f-pl-scope").value = F.plScope; $("#f-pl-min").value = String(F.plMin);
  $$(".f-plat").forEach(function (c) { c.checked = F.plats.indexOf(c.value) >= 0; });
  $$(".f-mode").forEach(function (c) { c.checked = F.modes.indexOf(c.value) >= 0; });
  $$(".f-flag").forEach(function (c) { c.checked = F.flags.indexOf(c.value) >= 0; });
  // descarta flags salvas que nao existem mais na UI (senao filtrariam sem forma de desmarcar)
  F.flags = $$(".f-flag").filter(function (c) { return c.checked; }).map(function (c) { return c.value; });

  // listeners
  var tmr;
  $("#q").addEventListener("input", function (e) {
    clearTimeout(tmr);
    var v = norm(e.target.value);
    tmr = setTimeout(function () { F.q = v; onChange(); }, 180);
  });
  function pick(sel) { return $$(sel).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }); }
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.classList.contains("f-plat")) F.plats = pick(".f-plat");
    else if (t.classList.contains("f-mode")) F.modes = pick(".f-mode");
    else if (t.classList.contains("f-flag")) F.flags = pick(".f-flag");
    else if (t.classList.contains("f-genre")) F.genres = pick(".f-genre");
    else if (t.id === "f-own") F.own = t.value;
    else if (t.id === "f-bc") F.bc = t.value;
    else if (t.id === "f-cat") F.cat = t.value;
    else if (t.id === "f-sort") F.sort = t.value;
    else if (t.id === "f-y1") F.y1 = t.value;
    else if (t.id === "f-y2") F.y2 = t.value;
    else if (t.id === "f-pl-scope") F.plScope = t.value;
    else if (t.id === "f-pl-min") F.plMin = +t.value;
    else return;
    onChange();
  });

  $("#main").addEventListener("click", function (e) {
    if (e.target.tagName === "A") return;
    var card = e.target.closest(".card");
    if (!card) return;
    var btn = e.target.closest(".own-btn, .wish-btn");
    if (btn) {                                   // botoes do canto marcam direto
      toggleMark(card.dataset.id, btn.classList.contains("wish-btn") ? "wish" : "own", card);
      return;
    }
    var g = GAMES.find(function (x) { return x.id === card.dataset.id; });
    if (g) openDetail(g);                        // resto do card abre os detalhes
  });

  $("#btn-export").onclick = doExport;
  var bs = $("#btn-sync");
  if (bs) { bs.hidden = !XBXSync.suporta; bs.onclick = XBXSync.aoClicar; }
  $("#btn-import").onclick = function () {
    openModal('<h3>Importar coleção</h3><p>Escolha o arquivo <code>.json</code> exportado antes.</p>' +
      '<div class="drop" id="drop">Arraste o arquivo aqui<br>ou clique para escolher</div>');
    var d = $("#drop");
    d.onclick = function () { $("#file-in").click(); };
    d.ondragover = function (ev) { ev.preventDefault(); d.classList.add("over"); };
    d.ondragleave = function () { d.classList.remove("over"); };
    d.ondrop = function (ev) {
      ev.preventDefault(); d.classList.remove("over");
      var f = ev.dataTransfer.files[0];
      if (f) f.text().then(importFlow);
    };
  };
  $("#file-in").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f) f.text().then(importFlow);
    e.target.value = "";
  });
  $("#modal-x").onclick = closeModal;
  $("#modal-body").addEventListener("click", function (e) {
    var b = e.target.closest("[data-mark]");
    if (!b || !detAtual) return;
    var card = $('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(detAtual.id) : detAtual.id) + '"]');
    toggleMark(detAtual.id, b.dataset.mark, card);
    $("#modal-body").innerHTML = detalheHtml(detAtual);   // redesenha com o novo estado
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("#modal").hidden) closeModal();
  });
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  $("#btn-filters").onclick = function () { $("#side").classList.toggle("open"); };
  $("#btn-reset").onclick = function () {
    F = { q: "", own: "all", plats: ["x360", "xbox", "homebrew"], modes: [], flags: [],
          plScope: "any", plMin: 0, y1: "", y2: "", bc: "all", cat: "", genres: [], sort: "year-desc" };
    saveF(); location.reload();
  };
}

/* ---------------- sincronização com um arquivo do dispositivo ----------------
   A File System Access API devolve um handle serializável: guardamos ele no
   IndexedDB e o site volta a ler/gravar no MESMO arquivo nas próximas visitas.
   Apontando esse arquivo para uma pasta do Google Drive/OneDrive/Dropbox, a
   sincronização entre máquinas sai de graça, sem conta, token ou servidor.
   Só existe em navegadores Chromium; nos demais o botão nem aparece. */
window.XBXSync = (function () {
  var SUPORTA = typeof window.showSaveFilePicker === "function";
  var DB_NOME = "xbx-sync", LOJA = "handles";
  var handle = null, ligado = false, timer = null, gravando = false;

  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NOME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(LOJA); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbOp(modo, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(LOJA, modo), req = fn(tx.objectStore(LOJA));
        tx.oncomplete = function () { res(req && req.result); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  var guardar = function (h) { return idbOp("readwrite", function (st) { return st.put(h, "file"); }); };
  var buscar  = function () { return idbOp("readonly",  function (st) { return st.get("file"); }); };
  var limpar  = function () { return idbOp("readwrite", function (st) { return st.delete("file"); }); };

  function permissao(h, pedir) {
    var op = { mode: "readwrite" };
    return (pedir ? h.requestPermission(op) : h.queryPermission(op))
      .then(function (p) { return p === "granted"; })
      .catch(function () { return false; });
  }

  function pintar(estado, detalhe) {
    var b = document.getElementById("btn-sync");
    if (!b) return;
    b.hidden = !SUPORTA;
    b.dataset.estado = estado;
    var txt = { off: "Sincronizar arquivo", on: "Sincronizado",
                perm: "Reconectar arquivo", erro: "Erro na sincronização",
                salvando: "Salvando…" }[estado] || estado;
    b.textContent = (estado === "on" ? "✓ " : "") + txt;
    b.title = detalhe || (estado === "on" ? "Clique para recarregar ou desconectar" : "");
  }

  function payload() {
    return JSON.stringify({
      app: "xbox-vault", version: 3, exportedAt: new Date().toISOString(),
      count: owned.size, wishlistCount: wishlist.size,
      owned: Array.from(owned).sort(), wishlist: Array.from(wishlist).sort(),
      marks: marks
    }, null, 1);
  }

  function lerArquivo() {
    return handle.getFile().then(function (f) { return f.text(); }).then(function (t) {
      if (!t.trim()) return null;
      try { return JSON.parse(t); } catch (e) { return null; }
    });
  }

  /* Nunca sobrescreve cego: relê o arquivo e junta antes de gravar, senão a
     gravação daqui apagaria o que outra máquina escreveu enquanto isso. */
  function gravar() {
    if (!handle || !ligado || gravando) return Promise.resolve();
    gravando = true;
    pintar("salvando");
    return lerArquivo().then(function (remoto) {
      if (remoto && remoto.marks) mergeMarks(remoto.marks);
      return handle.createWritable();
    }).then(function (w) {
      return w.write(payload()).then(function () { return w.close(); });
    }).then(function () {
      pintar("on", handle.name);
    }).catch(function (e) {
      pintar(e && e.name === "NotAllowedError" ? "perm" : "erro", String(e && e.message || e));
    }).then(function () { gravando = false; });
  }

  function agendarGravacao() {
    if (!ligado) return;
    clearTimeout(timer);
    timer = setTimeout(gravar, 1200);
  }

  function puxar(silencioso) {
    if (!handle || !ligado) return Promise.resolve(0);
    return lerArquivo().then(function (remoto) {
      if (!remoto) return 0;
      var conhecidos = new Set(GAMES.map(function (g) { return g.id; }));
      var lim = {};
      if (remoto.marks) {
        for (var k in remoto.marks) if (conhecidos.has(k)) lim[k] = remoto.marks[k];
      } else {                                   // arquivo antigo, sem timestamp
        var t = 0;
        (remoto.owned || []).forEach(function (i) { if (conhecidos.has(i)) lim[i] = { s: "own", t: t }; });
        (remoto.wishlist || []).forEach(function (i) { if (conhecidos.has(i)) lim[i] = { s: "wish", t: t }; });
      }
      var n = mergeMarks(lim);
      if (n) { render(); }
      if (!silencioso) pintar("on", handle.name);
      return n;
    }).catch(function () { return 0; });
  }

  function ativar(h) {
    handle = h; ligado = true;
    pintar("on", h.name);
    return puxar(true).then(gravar);
  }

  function conectar() {
    if (!SUPORTA) return;
    var nome = "xbox-vault-colecao.json";
    return window.showSaveFilePicker({
      suggestedName: nome,
      types: [{ description: "Coleção do Xbox Vault", accept: { "application/json": [".json"] } }]
    }).then(function (h) {
      // memorizar o handle é otimização para a próxima visita, não pré-requisito:
      // se o IndexedDB falhar, a sincronização desta sessão continua valendo
      return guardar(h).catch(function () {}).then(function () { return ativar(h); });
    }).catch(function (e) {
      if (e && e.name === "AbortError") return;   // usuário cancelou o seletor
      pintar("erro", String(e && e.message || e));
    });
  }

  function desconectar() {
    ligado = false; handle = null;
    clearTimeout(timer);
    return limpar().then(function () { pintar("off"); });
  }

  function restaurar() {
    if (!SUPORTA) { pintar("off"); return; }
    pintar("off");
    buscar().then(function (h) {
      if (!h) return;
      handle = h;
      permissao(h, false).then(function (ok) {
        if (ok) ativar(h);
        else pintar("perm", h.name);   // precisa de um clique: a API exige gesto do usuário
      });
    }).catch(function () {});
  }

  function aoClicar() {
    var b = document.getElementById("btn-sync");
    var estado = b && b.dataset.estado;
    if (estado === "on") {
      if (confirm("Sincronizando com “" + handle.name + "”.\n\nOK recarrega do arquivo agora.\nCancelar desconecta.")) puxar();
      else desconectar();
      return;
    }
    if (estado === "perm" && handle) {
      permissao(handle, true).then(function (ok) {
        if (ok) ativar(handle); else pintar("perm", handle.name);
      });
      return;
    }
    conectar();
  }

  window.addEventListener("focus", function () { puxar(true); });

  return { suporta: SUPORTA, restaurar: restaurar, aoClicar: aoClicar,
           agendarGravacao: agendarGravacao, puxar: puxar, desconectar: desconectar };
})();

/* ---------------- boot ---------------- */
if (!GAMES.length) {
  $("#main").innerHTML = '<div class="empty"><b>Catálogo vazio.</b><br>' +
    'Rode <code>python3 tools/bundle.py</code> para gerar <code>data/db.js</code> a partir dos JSONs.</div>';
} else {
  initControls();
  render();
  XBXSync.restaurar();
}
})();
