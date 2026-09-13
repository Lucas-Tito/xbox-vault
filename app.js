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
var owned = new Set(), wishlist = new Set(), escondidos = new Set();

function rebuildSets() {
  owned = new Set(); wishlist = new Set(); escondidos = new Set();
  for (var id in marks) {
    if (marks[id].s === "own") owned.add(id);
    else if (marks[id].s === "wish") wishlist.add(id);
    else if (marks[id].s === "hide") escondidos.add(id);
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

/* XBLIG e homebrew nascem desmarcados junto com a emulacao: o catalogo abre no
   que quase todo mundo veio ver, 360 e Xbox original, e as outras categorias
   entram quando a pessoa pedir. Os 3.450 indies sozinhos passavam na frente de
   tudo por ano de lancamento. */
var F = {
  q: "", own: "all", plats: ["x360", "xbox"], modes: [], flags: [],
  systems: [], relType: "oficial", plScope: "any", plMin: 0, y1: "", y2: "", bc: "all", cat: "",
  mcMin: 0, genres: [], sort: "year-desc"
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
function prepararJogo(g) {
  g._s = norm([g.title, (g.developers || []).join(" "), (g.publishers || []).join(" ")].join(" "));
  g._c = g._s.replace(/[^a-z0-9]/g, "");   // sem espaço nem pontuação, para busca tolerante
  g._t = g.tags || {};
}

/* Busca tolerante: verifica se as letras da consulta aparecem NA ORDEM, mesmo
   com outras no meio. Resolve o caso de errar uma letra em nome técnico --
   "usbsecpatch" acha "UsbdSecPatch". Só entra em ação quando a busca literal
   não achou nada, e só com 5+ caracteres, senão pescaria meio catálogo. */
function subsequencia(agulha, palheiro) {
  var i = 0;
  for (var j = 0; j < palheiro.length && i < agulha.length; j++) {
    if (palheiro.charCodeAt(j) === agulha.charCodeAt(i)) i++;
  }
  return i === agulha.length;
}
GAMES.forEach(prepararJogo);

/* ---- catálogo de emulação: carregado só quando o usuário liga a categoria ----
   Injetar um <script> (em vez de fetch) é o que faz isso funcionar também com o
   site aberto direto do arquivo, via file:// — fetch de arquivo local é bloqueado. */
var emuCarregado = false, emuCarregando = false;

function carregarEmu(pronto) {
  if (emuCarregado) return pronto();
  if (emuCarregando) return;
  emuCarregando = true;
  var main = $("#main");
  if (main) main.innerHTML = '<div class="loading">Carregando o catálogo de emulação…<br>' +
    '<small>São ~10 mil jogos; isso acontece só uma vez por visita.</small></div>';
  var sc = document.createElement("script");
  sc.src = "data/db-emu.js";
  sc.onload = function () {
    var lista = (window.XBX_EMU && window.XBX_EMU.games) || [];
    lista.forEach(prepararJogo);
    GAMES = GAMES.concat(lista);
    emuCarregado = true; emuCarregando = false;
    montarFacetas();          // anos e gêneros mudaram
    pronto();
  };
  sc.onerror = function () {
    emuCarregando = false;
    F.plats = F.plats.filter(function (p) { return p !== "emu"; });
    $$(".f-plat").forEach(function (c) { if (c.value === "emu") c.checked = false; });
    alert("Não consegui carregar data/db-emu.js. Confira se o arquivo está junto do site.");
    pronto();
  };
  document.head.appendChild(sc);
}

/* ---------------- filtragem ---------------- */
function maxPlayers(g, scope) {
  var t = g._t;
  if (scope === "local")  return t.maxPlayersLocal || 0;
  if (scope === "online") return t.maxPlayersOnline || 0;
  return Math.max(t.maxPlayersLocal || 0, t.maxPlayersOnline || 0, t.maxPlayers || 0);
}

function match(g, skip) {
  if (skip !== "plat" && F.plats.indexOf(g.platform) < 0) return false;
  if (F.q) {
    if (g._s.indexOf(F.q) < 0 && !(F.qFrouxa && subsequencia(F.qc, g._c))) return false;
  }

  // "não quero" tira o jogo de todas as listas, menos da lista de escondidos
  if (F.own === "hide") { if (!escondidos.has(g.id)) return false; }
  else if (escondidos.has(g.id)) return false;
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
  if (F.mcMin > 0 && !(g.mc >= F.mcMin)) return false;   // sem nota também não passa

  if (F.y1 && (g.year == null || g.year < +F.y1)) return false;
  if (F.y2 && (g.year == null || g.year > +F.y2)) return false;

  if (F.bc !== "all" && g.platform === "xbox") {
    var c = !!(g.bc360 && g.bc360.compatible);
    if (F.bc === "yes" && !c) return false;
    if (F.bc === "no" && c) return false;
  }
  if (F.bc === "yes" && g.platform !== "xbox") return false;

  // Vale para o catálogo inteiro, não só emulação: o GoldenEye do XBLA é um
  // vazado do próprio 360.
  if (F.relType === "vaz" && g.releaseType !== "Vazado") return false;
  if (g.platform === "emu") {
    if (F.systems.length && F.systems.indexOf(g.system) < 0) return false;
    // "oficial" = lançamento licenciado; o resto são ROM hacks, homebrew, etc.
    // "Vazado" entra junto: é jogo que ficou pronto, não protótipo pela metade.
    if (F.relType === "oficial" && g.releaseType !== "Released" &&
        g.releaseType !== "Vazado") return false;
    if (F.relType === "hack" && g.releaseType !== "ROM Hack") return false;
    if (F.relType === "hb" && g.releaseType !== "Homebrew") return false;
  }
  if (F.cat && g.category !== F.cat) return false;
  if (F.genres.length && F.genres.indexOf(g.genre || "") < 0) return false;
  return true;
}

function filtered(skip) {
  var out = [];
  if (F.q) {
    F.qc = F.q.replace(/[^a-z0-9]/g, "");
    F.qFrouxa = false;
    var exato = 0;
    for (var k = 0; k < GAMES.length && exato < 1; k++) {
      if (GAMES[k]._s.indexOf(F.q) >= 0) exato++;
    }
    F.qFrouxa = exato === 0 && F.qc.length >= 5;   // só se o literal não achou nada
  }
  for (var i = 0; i < GAMES.length; i++) if (match(GAMES[i], skip)) out.push(GAMES[i]);
  return out;
}

function sortList(list) {
  var s = F.sort;
  return list.sort(function (a, b) {
    if (s === "title") return a.title.localeCompare(b.title);
    if (s === "players") return maxPlayers(b, "any") - maxPlayers(a, "any") || a.title.localeCompare(b.title);
    if (s === "mc") return (b.mc || -1) - (a.mc || -1) || a.title.localeCompare(b.title);
    var ya = a.year == null ? -Infinity : a.year, yb = b.year == null ? -Infinity : b.year;
    if (ya !== yb) return s === "year-asc" ? ya - yb : yb - ya;
    return a.title.localeCompare(b.title);
  });
}

/* ---------------- render ---------------- */
var queue = [], qi = 0, io = null;

function mcClasse(n) { return n >= 75 ? "bom" : n >= 50 ? "medio" : "ruim"; }

function tagsHtml(g) {
  var t = g._t, h = [], pl;
  if (g.platform === "x360") h.push('<span class="tag plat">360</span>');
  else if (g.platform === "xblig") h.push('<span class="tag plat">INDIE</span>');
  else if (g.platform === "emu") h.push('<span class="tag emu">' + esc(g.system) + "</span>");
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
  if (t.coop) {
    var cp = Math.max(t.coopLocalMax || 0, t.coopOnlineMax || 0);
    h.push('<span class="tag co">CO-OP' + (t.coopLocal ? " LOCAL" : "") +
      (cp ? " " + cp + "P" : "") + "</span>");
  }
  if (t.versus) h.push('<span class="tag vs">VS</span>');

  if (g.platform === "xbox") {
    h.push(g.bc360 && g.bc360.compatible
      ? '<span class="tag bc">RETRO ✓</span>'
      : '<span class="tag nobc">RETRO ✗</span>');
  }
  if (g.releaseType === "Vazado") {
    h.push('<span class="tag vaz" title="Cancelado antes de sair, mas ficou pronto e ' +
      'a build vazou, então dá para jogar">VAZADO</span>');
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

function urTexto(v) { return (Math.round(v * 100) / 100).toFixed(2); }

function cardHtml(g) {
  // A nota da critica tem preferencia. A dos jogadores so aparece no card de
  // quem nao tem Metacritic, e com desenho diferente para ninguem confundir
  // uma escala de 0-100 com uma de 0-5.
  var mc = typeof g.mc === "number"
    ? '<span class="mc ' + mcClasse(g.mc) + (g.mcGeral ? " geral" : "") + '" title="' +
      (g.mcGeral ? "Metacritic de outra plataforma" : "Metacritic") + '">' + g.mc +
      (g.mcGeral ? '<i>*</i>' : "") + "</span>"
    : (typeof g.ur === "number"
      ? '<span class="ur" title="Nota dos jogadores no Xbox Marketplace (0 a 5)">' +
        "<b>★</b>" + urTexto(g.ur) + "</span>"
      : "");
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

  var o = owned.has(g.id), w = wishlist.has(g.id), h = escondidos.has(g.id);
  return '<article class="card' + (o ? " own" : "") + (w ? " wish" : "") + (h ? " hide" : "") +
    '" data-id="' + esc(g.id) + '">' +
    '<div class="marks">' +
    '<button class="wish-btn" title="Adicionar à wishlist">' + (w ? "★" : "☆") + "</button>" +
    '<button class="hide-btn" title="Não quero, esconder da lista">⊘</button>' +
    "</div>" +
    '<div class="thumb">' + img + mc + "</div>" +
    '<div class="body"><h3>' + link + "</h3>" +
    '<div class="sub">' + sub + "</div>" +
    '<div class="tags">' + tagsHtml(g) + "</div></div></article>";
}

function buildQueue(list) {
  var groups = [], cur = null;
  // Agrupar por ano só faz sentido quando a ordenação É por ano. Ordenando por
  // título ou nota, cada seção viraria um jogo só.
  if (F.sort !== "year-desc" && F.sort !== "year-asc") {
    queue = list.length ? [{ y: null, items: list }] : [];
    qi = 0;
    return;
  }
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
    if (g.y === null) {                       // lista corrida, sem cabeçalho de ano
      var lote = g.items.slice(0, BATCH);
      html += '<section><div class="grid">' + lote.map(cardHtml).join("") + "</div></section>";
      n += lote.length;
      g.items = g.items.slice(BATCH);
      if (!g.items.length) qi++;
    } else {
      html += '<section><div class="year"><h2>' + esc(g.y) + '</h2><span class="cnt">' +
        g.items.length + " jogo" + (g.items.length > 1 ? "s" : "") +
        '</span><div class="ln"></div></div><div class="grid">' +
        g.items.map(cardHtml).join("") + "</div></section>";
      n += g.items.length; qi++;
    }
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
  var ownCount = 0, byPlat = { x360: 0, xblig: 0, xbox: 0, homebrew: 0, emu: 0 },
      ownPlat = { x360: 0, xblig: 0, xbox: 0, homebrew: 0, emu: 0 };
  GAMES.forEach(function (g) {
    byPlat[g.platform]++;
    if (owned.has(g.id)) { ownCount++; ownPlat[g.platform]++; }
  });
  $("#s-wish").textContent = wishlist.size.toLocaleString("pt-BR");
  var eh = $("#s-hide"); if (eh) eh.textContent = escondidos.size.toLocaleString("pt-BR");
  $("#s-shown").textContent = list.length.toLocaleString("pt-BR");
  $("#s-total").textContent = GAMES.length.toLocaleString("pt-BR");
  $("#s-own").textContent = ownCount.toLocaleString("pt-BR");
  var pct = GAMES.length ? (ownCount / GAMES.length * 100) : 0;
  $("#s-pct").textContent = "(" + pct.toFixed(1) + "%)";
  $("#s-bar").style.width = pct + "%";
  $("#s-breakdown").textContent =
    "360: " + ownPlat.x360 + "/" + byPlat.x360 +
    " · Indie: " + ownPlat.xblig + "/" + byPlat.xblig +
    " · Xbox: " + ownPlat.xbox + "/" + byPlat.xbox +
    " · Homebrew: " + ownPlat.homebrew + "/" + byPlat.homebrew +
    (byPlat.emu ? " · Emulação: " + ownPlat.emu + "/" + byPlat.emu : "");
  $$("[data-cnt^='plat-']").forEach(function (el) {
    var k = el.dataset.cnt.slice(5);
    // A emulacao so entra em GAMES depois do download sob demanda, entao ate la
    // o numero vem do total que o bundle.py grava no db.js. Bundle velho nao
    // tem esse campo: nesse caso fica em branco, que mente menos que um zero.
    if (k === "emu" && !byPlat.emu) {
      el.textContent = (DB.counts || {}).emu || "";
      return;
    }
    el.textContent = byPlat[k] || 0;
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
var PLATNOME = { x360: "Xbox 360", xblig: "Indie (XBLIG)", xbox: "Xbox original",
                 homebrew: "Homebrew", emu: "Emulação" };
/* Os rotulos vem em ingles do Co-Optimus; o resto da interface e em portugues. */
var COOPEXTRA = {
  "co-op campaign": "Campanha inteira em co-op",
  "drop in/drop out": "Entra e sai no meio da partida",
  "drop in / drop out": "Entra e sai no meio da partida",
  "splitscreen": "Tela dividida",
  "split-screen": "Tela dividida",
  "split screen": "Tela dividida",
  "co-op specific content": "Conteúdo exclusivo do co-op",
  "drop-in / drop-out": "Entra e sai no meio da partida",
  "drop-in/drop-out": "Entra e sai no meio da partida",
  "import": "Só em versão importada",
  "downloadable only": "Só em versão digital",
  "online play": "Jogo online",
  "local play": "Jogo local",
  "co-op modes": "Modos próprios de co-op",
  "co-op mode": "Modo próprio de co-op",
  "friendly fire": "Fogo amigo",
  "bots": "Bots"
};

function coopHtml(g) {
  var c = g.coopInfo;
  if (!c) return "";
  var li = [], n = function (v) {
    return v > 0 ? "até " + v + (v > 1 ? " jogadores" : " jogador") : "não tem";
  };
  if (c.local != null) li.push("Local: " + n(c.local));
  if (c.online != null) li.push("Online: " + n(c.online));
  if (c.combo) li.push("Local + online juntos: " + n(c.combo));
  if (c.lan) li.push("LAN / System Link: " + n(c.lan));
  var ex = (c.extras || []).map(function (x) {
    return COOPEXTRA[x.toLowerCase()] || x;
  });
  return "<h4>Co-op segundo o Co-Optimus</h4>" +
    (li.length ? '<ul class="modos">' + li.map(function (x) {
      return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
    (ex.length ? '<ul class="modos coop-ex">' + ex.map(function (x) {
      return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
    (c.exp ? '<p class="coop-exp">' + esc(c.exp) + "</p>" : "");
}

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
  var qtd = function (n) { return n ? " (até " + n + (n > 1 ? " jogadores)" : " jogador)") : ""; };
  if (t.source === "not-a-game")
    return '<p class="nota">Não é um jogo, é ' +
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
    h += '<p class="nota">Confiança <b>' + esc(t.confidence) + "</b>: " + CONFNOTA[t.confidence] + ".</p>";
  // O Co-Optimus é catalogado à mão e só cobre jogo COM co-op. O aviso vale nos
  // DOIS casos: quando dizemos que tem co-op, porque o número foi inferido do
  // texto de um artigo e é aí que moram os erros; e quando dizemos que não tem,
  // porque calar faz o leitor concluir que a ausência foi verificada, e não foi.
  if (!g.coopInfo)
    h += '<p class="nota">' + (t.coop
      ? "Co-op não conferido: este jogo não consta no Co-Optimus."
      : "Não consta no Co-Optimus, então a ausência de co-op não foi conferida.") +
      "</p>";
  return h;
}

/* Galeria do Marketplace. As imagens so entram no DOM quando o popup e montado,
   ou seja, no clique -- quem nunca abre uma ficha nao baixa nenhuma. */
function galeriaHtml(g) {
  if (!g.screens) return "";
  var h = [];
  for (var i = 1; i <= g.screens; i++) {
    var u = "images/screens/" + g.id + "-" + i + ".webp";
    h.push('<a href="' + esc(u) + '" target="_blank" rel="noopener">' +
      '<img loading="lazy" src="' + esc(u) + '" alt="Captura de ' + esc(g.title) +
      '" onerror="this.parentNode.remove()"></a>');
  }
  return '<div class="shots">' + h.join("") + "</div>";
}

/* Visualizador da galeria. Fica por cima do popup de detalhes em vez de
   substitui-lo: fechar a imagem devolve a ficha aberta, que e o que a pessoa
   estava lendo. As capturas em disco tem 480x270, entao o CSS limita a 960px. */
var lbFotos = [], lbI = 0;

function lbIr(i) {
  if (!lbFotos.length) return;
  lbI = (i + lbFotos.length) % lbFotos.length;   // da a volta nas duas pontas
  $("#lb-img").src = lbFotos[lbI];
  $("#lb-img").alt = "Captura " + (lbI + 1) + " de " + lbFotos.length;
  $("#lb-n").textContent = (lbI + 1) + " / " + lbFotos.length;
  var sozinha = lbFotos.length < 2;               // sem para onde navegar
  $("#lb-prev").hidden = sozinha;
  $("#lb-next").hidden = sozinha;
}

function lbAbrir(fotos, i) {
  lbFotos = fotos;
  $("#lb").hidden = false;
  lbIr(i < 0 ? 0 : i);
}

function lbFechar() {
  $("#lb").hidden = true;
  $("#lb-img").removeAttribute("src");   // solta a imagem em vez de deixar montada
  lbFotos = [];
}

function kb(v) { return v >= 1024 ? (v / 1024).toFixed(1) + " MB" : v + " KB"; }

function horas(v) {
  if (typeof v !== "number") return null;
  if (v < 1) return Math.round(v * 60) + " min";
  var h = Math.floor(v), m = Math.round((v - h) * 60);
  return h + "h" + (m ? " " + m + "min" : "");
}

/* Tempo de jogo. Duas fontes, já resolvidas pelo tools/bundle.py antes de
   chegar aqui: data/tempo.json (curadoria à mão, que manda no que estiver lá) e
   os data/hltb*.json do tools/fetch_hltb.py, que são a média dos relatos do
   HowLongToBeat. O número de relatos fica à vista de propósito: "8h" apoiado em
   5.533 relatos e "8h" apoiado em 1 são a mesma frase com valor muito diferente,
   e quem lê merece poder fazer essa distinção sozinho. */
var POUCOS_RELATOS = 10;   /* abaixo disso o popup avisa; ver tempoHtml */
function tempoHtml(g) {
  var t = g.tempo;
  if (!t) return "";
  var li = [];
  [["main", "Hist\u00f3ria principal"], ["plus", "Principal + extras"],
   ["cem", "Completar 100%"]].forEach(function (par) {
    var v = horas(t[par[0]]);
    if (v) li.push("<li><span>" + par[1] + "</span><b>" + esc(v) + "</b></li>");
  });
  if (!li.length) return "";
  var nota = "";
  if (t.fonte === "aproximado") {
    nota = "Valor aproximado, preenchido \u00e0 m\u00e3o \u2014 corrija em data/tempo.json.";
  } else if (t.fonte === "hltb") {
    var n = typeof t.n === "number" ? t.n : null;
    var versao = g.system || PLATNOME[g.platform] || "";
    nota = "HowLongToBeat" +
      (n === null ? "" : " \u2014 " + n.toLocaleString("pt-BR") +
        (n === 1 ? " relato" : " relatos")) +
      (t.geral
        /* o numero soma todas as versoes do jogo. Avisar disso e o mesmo que o
           catalogo ja faz com a nota do Metacritic que nao e da plataforma. */
        ? ", somando todas as vers\u00f5es do jogo" +
          (versao ? ", n\u00e3o s\u00f3 a de " + esc(versao) : "")
        : versao ? " de quem jogou no " + esc(versao) : "") + ".";
    /* Abaixo de POUCOS_RELATOS o numero deixa de ser media e vira o tempo de
       umas poucas pessoas. O corte e 10 e nao 5 por causa de um caso concreto:
       Black Ops III no Xbox 360 tem exatamente 5 relatos, de uma campanha que
       aquela versao nem tem -- com o corte em 5 ele passaria sem aviso. */
    if (n !== null && n < POUCOS_RELATOS) {
      nota += " Poucos relatos \u2014 \u00e9 o tempo de um punhado de pessoas, n\u00e3o uma m\u00e9dia.";
    }
  }
  return "<h4>Tempo de jogo</h4><ul class=\"tempo\">" + li.join("") + "</ul>" +
    (nota ? '<p class="nota">' + nota + "</p>" : "");
}

/* Lista de Title Updates, recolhida. Só versão, data e tamanho: é para saber o
   que existiu, não para baixar -- por isso nem hash nem endereço saem do
   coletor. O Xbox Unity não guarda changelog, e a Microsoft nunca publicou um
   para a maioria dos patches do 360, então não há o que cada um mudou. */
function tuHtml(g) {
  var t = g.tu;
  if (!t || !t.n || !(t.lista || []).length) return "";
  var linhas = t.lista.map(function (u) {
    return "<li><b>v" + u.v + "</b>" +
      (u.d ? '<span class="tu-d">' + esc(fmtDate(u.d)) + "</span>" : "") +
      (u.kb ? '<span class="tu-kb">' + esc(kb(u.kb)) + "</span>" : "") + "</li>";
  }).join("");
  return '<details class="tu"><summary>' + t.n +
    (t.n > 1 ? " atualizações oficiais" : " atualização oficial") +
    (t.ultima ? ", última v" + t.ultima : "") +
    (t.data ? " em " + esc(fmtDate(t.data)) : "") +
    "</summary><ul>" + linhas + "</ul></details>";
}

function detalheHtml(g) {
  var o = owned.has(g.id), w = wishlist.has(g.id), t = g.tags || {};
  var capa = g.image
    ? '<img src="' + esc(g.image) + '" alt="' + esc(g.title) + '"' + (g.wide ? ' class="wide"' : "") + ">"
    : '<div class="ph">' + esc(g.title) + "</div>";

  /* Uma data so, a mais antiga entre as regioes: quem abre a ficha quer saber
     quando o jogo saiu, nao em qual loja regional ele saiu primeiro. Quando o
     ano empata e so uma das regioes tem dia e mes, vale a mais precisa. */
  var lancamento = null;
  if (g.releases) {
    var ds = [];
    for (var rk in g.releases) if (g.releases[rk]) ds.push(String(g.releases[rk]));
    if (ds.length) {
      ds.sort();
      var d0 = ds[0];
      for (var di = 1; di < ds.length; di++) {
        if (ds[di].indexOf(d0) === 0 && ds[di].length > d0.length) d0 = ds[di];
      }
      lancamento = fmtDate(d0);
    }
  }

  var ficha = linha("Plataforma", esc(PLATNOME[g.platform] || g.platform)) +
    linha("Lançamento", lancamento || g.year || null) +
    linha("Gênero", esc(g.genre || "")) +
    linha("Categoria", g.category ? esc(g.category) : null) +
    linha("Situação", g.releaseType === "Vazado" ? "cancelado, com a build vazada e jogável" : null) +
    linha("Console", g.console ? esc(g.console === "x360" ? "Xbox 360"
          : g.console === "both" ? "Xbox e Xbox 360" : "Xbox original") : null) +
    linha("Desenvolvedora", esc((g.developers || []).join(", "))) +
    linha("Publicadora", esc((g.publishers || []).join(", ")));

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
  // Title Updates: a Xbox LIVE do 360 foi desligada, entao saber que patch
  // existiu (e que nunca existiu) importa para quem vai montar o console.
  if (g.tu && !g.tu.n) extras.push("Nunca recebeu atualização oficial");
  var f = g.flags || {};
  if (f.xbla) extras.push("Xbox Live Arcade");
  if (f.kinect) extras.push("Kinect (" + (f.kinect === "required" ? "obrigatório" : "opcional") + ")");
  if (f.xboxOne) extras.push("Roda também no Xbox One");
  if (f.stereo3d) extras.push("Suporte a 3D estereoscópico");

  var links = [];
  if (g.wiki) links.push('<a href="https://en.wikipedia.org/wiki/' + encodeURIComponent(g.wiki) +
    '" target="_blank" rel="noopener">Wikipédia ↗</a>');
  if (g.url) links.push('<a href="' + esc(g.url) + '" target="_blank" rel="noopener">Página do projeto ↗</a>');
  if (g.fonte) links.push('<a href="' + esc(g.fonte) + '" target="_blank" rel="noopener">Fonte do cancelamento ↗</a>');

  return '<div class="det">' +
    '<div class="det-capa">' + capa + "</div>" +
    '<div class="det-info">' +
      "<h3>" + esc(g.title) + "</h3>" +
      '<div class="det-sub">' + esc([PLATNOME[g.platform], g.year, g.genre || g.category]
        .filter(Boolean).join(" · ")) + "</div>" +
      (typeof g.mc === "number"
        ? '<div class="det-mc"><span class="mc ' + mcClasse(g.mc) +
          (g.mcGeral ? " geral" : "") + '">' + g.mc + (g.mcGeral ? '<i>*</i>' : "") + "</span>" +
          "<span>Nota da crítica · Metacritic" + (g.mcGeral ? " *" : "") + "</span></div>" : "") +
      (typeof g.ur === "number"
        ? '<div class="det-mc"><span class="ur"><b>★</b>' + urTexto(g.ur) + "</span>" +
          "<span>Nota dos jogadores · Xbox Marketplace</span></div>" : "") +
      (g.releaseType === "Vazado" && g.nota
        ? '<p class="det-vaz"><b>Cancelado, mas jogável.</b> ' + esc(g.nota) + "</p>" : "") +
      (g.description ? '<p class="desc">' + esc(g.description) + "</p>" : "") +
      '<div class="det-acoes">' +
        '<button class="btn ' + (o ? "primary" : "") + '" data-mark="own">' +
          (o ? "✓ Eu tenho" : "+ Marcar que tenho") + "</button>" +
        '<button class="btn ' + (w ? "amber" : "") + '" data-mark="wish">' +
          (w ? "★ Na wishlist" : "☆ Pôr na wishlist") + "</button>" +
        '<button class="btn' + (escondidos.has(g.id) ? " muted" : "") + '" data-mark="hide">' +
          (escondidos.has(g.id) ? "⊘ Escondido" : "⊘ Não quero") + "</button>" +
      "</div>" +
      galeriaHtml(g) +
      "<h4>Modos de jogo</h4>" + modosHtml(g) + coopHtml(g) +
      (extras.length ? "<h4>Extras</h4><ul class=\"modos\">" +
        extras.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      tuHtml(g) +
      tempoHtml(g) +
      bc +
      "<h4>Ficha</h4>" + ficha +
      (links.length ? '<div class="det-links">' + links.join("") + "</div>" : "") +
      (g.mcGeral
        ? '<p class="det-aviso">* Esta nota do Metacritic não é da versão de ' +
          esc(PLATNOME[g.platform] || g.platform) + '.</p>'
        : "") +
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
      marks[id] = { s: (r.s === "own" || r.s === "wish" || r.s === "hide") ? r.s : null, t: r.t };
    }
  }
  if (mudou) { rebuildSets(); try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch (e) {} }
  return mudou;
}

function paintCard(card, id) {
  var o = owned.has(id), w = wishlist.has(id);
  card.classList.toggle("own", o);
  card.classList.toggle("wish", w);
  card.classList.toggle("hide", escondidos.has(id));
  card.querySelector(".wish-btn").textContent = w ? "★" : "☆";
}
/* "tenho" e "quero" se contradizem: marcar um limpa o outro, senao o arquivo
   exportado sairia com o mesmo jogo nas duas listas. */
/* Tira um card da tela sem re-renderizar tudo (re-render perderia a rolagem).
   Ajusta a contagem da seção do ano e some com a seção se ela esvaziar. */
function removeCard(card) {
  var sec = card.closest("section"), grid = card.parentNode;
  card.remove();
  if (!sec) return;
  var cnt = sec.querySelector(".cnt"), n = grid ? grid.children.length : 0;
  if (!n) { sec.remove(); return; }
  if (cnt) cnt.textContent = n + " jogo" + (n > 1 ? "s" : "");
}

function toggleMark(id, which, card) {
  var atual = marks[id] && marks[id].s;
  setMark(id, atual === which ? null : which);   // null = lápide, não some do arquivo
  saveMarks();
  var g = GAMES.find(function (x) { return x.id === id; });
  if (card) {
    if (g && !match(g, null)) removeCard(card);  // não bate mais com o filtro atual
    else paintCard(card, id);
  }
  updateStats(filtered(null));
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
    hidden: Array.from(escondidos).sort(),
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
  if (Array.isArray(data)) return { owned: str(data), wishlist: [], hidden: [], marks: null };
  var o = data.owned || data.ids || [], w = data.wishlist || [];
  if (!Array.isArray(o) || !Array.isArray(w))
    throw new Error("Formato não reconhecido: esperava as listas 'owned' e 'wishlist'.");
  var m = data.marks && typeof data.marks === "object" ? data.marks : null;
  return { owned: str(o), wishlist: str(w), hidden: str(data.hidden || []), marks: m };  // v1/v2 não têm marks
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
    keep(p.hidden || []).forEach(function (i) { marks[i] = { s: "hide", t: agora }; });
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
function onChange() {
  saveF();
  subfiltrosEmu();
  // ligar a emulação dispara o download do catálogo dela, uma vez por visita
  if (F.plats.indexOf("emu") >= 0 && !emuCarregado) return carregarEmu(render);
  render();
}

function initControls() {
  montarFacetas();
  restaurarControles();
  ligarEventos();
}

function montarFacetas() {
  // anos
  var years = Array.from(new Set(GAMES.map(function (g) { return g.year; })
    .filter(function (y) { return y != null; }))).sort(function (a, b) { return a - b; });
  var o1 = '<option value="">qualquer</option>' + years.map(function (y) { return "<option>" + y + "</option>"; }).join("");
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
  $("#f-cat").value = F.cat;
}

function subfiltrosEmu() {
  var on = F.plats.indexOf("emu") >= 0;
  var g = $("#g-emu");
  if (g) g.hidden = !on;
}

function restaurarControles() {
  // restaura estado
  $("#q").value = F.q ? F.q : "";
  $("#f-own").value = F.own; $("#f-bc").value = F.bc; $("#f-cat").value = F.cat;
  $("#f-sort").value = F.sort; $("#f-pl-scope").value = F.plScope; $("#f-pl-min").value = String(F.plMin);
  $$(".f-plat").forEach(function (c) { c.checked = F.plats.indexOf(c.value) >= 0; });
  $$(".f-mode").forEach(function (c) { c.checked = F.modes.indexOf(c.value) >= 0; });
  $$(".f-flag").forEach(function (c) { c.checked = F.flags.indexOf(c.value) >= 0; });
  // descarta flags salvas que nao existem mais na UI (senao filtrariam sem forma de desmarcar)
  F.flags = $$(".f-flag").filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
  $$(".f-sys").forEach(function (c) { c.checked = F.systems.indexOf(c.value) >= 0; });
  if ($("#f-reltype")) $("#f-reltype").value = F.relType;
  if ($("#f-mc")) $("#f-mc").value = String(F.mcMin);
  subfiltrosEmu();
}

function ligarEventos() {
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
    else if (t.classList.contains("f-sys")) F.systems = pick(".f-sys");
    else if (t.id === "f-reltype") F.relType = t.value;
    else if (t.id === "f-own") F.own = t.value;
    else if (t.id === "f-bc") F.bc = t.value;
    else if (t.id === "f-cat") F.cat = t.value;
    else if (t.id === "f-sort") F.sort = t.value;
    else if (t.id === "f-y1") F.y1 = t.value;
    else if (t.id === "f-y2") F.y2 = t.value;
    else if (t.id === "f-pl-scope") F.plScope = t.value;
    else if (t.id === "f-pl-min") F.plMin = +t.value;
    else if (t.id === "f-mc") F.mcMin = +t.value;
    else return;
    onChange();
  });

  $("#main").addEventListener("click", function (e) {
    if (e.target.tagName === "A") return;
    var card = e.target.closest(".card");
    if (!card) return;
    var btn = e.target.closest(".wish-btn, .hide-btn");
    if (btn) {                                   // botoes do canto marcam direto
      toggleMark(card.dataset.id,
        btn.classList.contains("wish-btn") ? "wish" : "hide", card);
      return;
    }
    var g = GAMES.find(function (x) { return x.id === card.dataset.id; });
    if (g) openDetail(g);                        // resto do card abre os detalhes
  });

  $("#btn-export").onclick = doExport;
  // Abre o seletor do sistema direto. A tela intermediaria existia so para
  // oferecer o arrastar, e cobrava um clique de todo mundo por isso.
  $("#btn-import").onclick = function () { $("#file-in").click(); };
  $("#file-in").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f) f.text().then(importFlow);
    e.target.value = "";
  });
  $("#modal-x").onclick = closeModal;
  $("#modal-body").addEventListener("click", function (e) {
    var a = e.target.closest(".shots a");
    if (!a) return;
    e.preventDefault();
    var fotos = $$("#modal-body .shots a").map(function (x) { return x.getAttribute("href"); });
    lbAbrir(fotos, fotos.indexOf(a.getAttribute("href")));
  });
  $("#lb-prev").onclick = function () { lbIr(lbI - 1); };
  $("#lb-next").onclick = function () { lbIr(lbI + 1); };
  $("#lb-x").onclick = lbFechar;
  $("#lb").addEventListener("click", function (e) {
    if (e.target.id === "lb") lbFechar();   // clique no fundo fecha, como no popup
  });
  $("#modal-body").addEventListener("click", function (e) {
    var b = e.target.closest("[data-mark]");
    if (!b || !detAtual) return;
    var card = $('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(detAtual.id) : detAtual.id) + '"]');
    toggleMark(detAtual.id, b.dataset.mark, card);
    closeModal();      // marcou pelo popup: a ação está feita, fecha
  });
  document.addEventListener("keydown", function (e) {
    if (!$("#lb").hidden) {                 // aberto, ele tem a vez: Esc fecha so ele
      if (e.key === "Escape") lbFechar();
      else if (e.key === "ArrowLeft") lbIr(lbI - 1);
      else if (e.key === "ArrowRight") lbIr(lbI + 1);
      return;
    }
    if (e.key === "Escape" && !$("#modal").hidden) closeModal();
  });
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  $("#btn-filters").onclick = function () { $("#side").classList.toggle("open"); };
  $("#btn-reset").onclick = function () {
    F = { q: "", own: "all", plats: ["x360", "xbox"], modes: [], flags: [],
          systems: [], relType: "oficial", plScope: "any", plMin: 0, y1: "", y2: "", bc: "all",
          cat: "", mcMin: 0, genres: [], sort: "year-desc" };
    saveF(); location.reload();
  };
}

/* ---------------- boot ---------------- */
if (!GAMES.length) {
  $("#main").innerHTML = '<div class="empty"><b>Catálogo vazio.</b><br>' +
    'Rode <code>python3 tools/bundle.py</code> para gerar <code>data/db.js</code> a partir dos JSONs.</div>';
} else {
  initControls();
  render();
  // Se a emulacao ficou ligada de uma visita anterior, o filtro salvo a pede mas
  // nada dispara o carregamento no boot -- a lista viria vazia.
  if (F.plats.indexOf("emu") >= 0 && !emuCarregado) carregarEmu(render);
}
})();
