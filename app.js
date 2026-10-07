/* Xbox Vault: app principal. Dados vêm de data/db.js (window.XBX_DB). */
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
   ressuscita o que você desmarcou num deles. `s: null` é uma lápide: registra que
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
function padraoF() {
  return {
    q: "", own: "all", plats: ["x360", "xbox"], modes: [], flags: [],
    systems: [], relType: "oficial", where: "any", plMin: 0, yMode: "intervalo", y1: "", y2: "",
    bc: "all", cat: "", mcMin: 0, genres: [], coopt: false, sort: "year-desc"
  };
}
var F = padraoF();
try { Object.assign(F, JSON.parse(localStorage.getItem(FILT_KEY) || "{}")); } catch (e) {}
// Filtro salvo antes da fusao do modo de jogo: o escopo dos jogadores virou o
// "onde", que agora vale para o modo tambem.
if (F.plScope) { if (F.where === "any") F.where = F.plScope; delete F.plScope; }

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
  // Todos os Title IDs do jogo, em maiusculas: o que o colecoes.txt guarda
  g._tids = g.titleId ? [g.titleId.toUpperCase()].concat((g.titleIdAlt || []).map(function (t) {
    return t.toUpperCase(); })) : [];
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

/* ---- catálogos sob demanda ----
   O db.js traz só Xbox 360 e Xbox original. XBLIG, homebrew e emulação moram em
   arquivo próprio e descem quando a categoria é ligada: juntos são mais da
   metade do peso, e a maioria das visitas nunca abre nenhum dos três.

   Esta tabela é a fonte única de quem carrega o quê. O filtro, o boot e a
   importação consultam ela, e separar mais uma categoria amanhã é acrescentar
   uma linha aqui, em vez de espalhar prefixo cravado pelo arquivo.

   Injetar um <script> (em vez de fetch) é o que faz isso funcionar também com o
   site aberto direto do arquivo, via file://, onde fetch de arquivo local é bloqueado. */
var CATALOGOS = {
  xblig:    { arquivo: "data/db-xblig.js", global: "XBX_XBLIG", prefixo: "xblig-", nome: "os indies" },
  homebrew: { arquivo: "data/db-hb.js",    global: "XBX_HB",    prefixo: "hb-",    nome: "os homebrews" },
  emu:      { arquivo: "data/db-emu.js",   global: "XBX_EMU",   prefixo: "emu-",   nome: "a emulação" }
};

/* Das plataformas pedidas, quais ainda não estão em GAMES. */
function pendentes(plats) {
  return plats.filter(function (p) { return CATALOGOS[p] && !CATALOGOS[p].carregado; });
}

function carregarCatalogo(chave, pronto) {
  var c = CATALOGOS[chave];
  if (!c || c.carregado) return pronto(true);
  /* Fila em vez de desistir: dois eventos seguidos, como marcar duas categorias
     de uma vez, faziam o segundo pedido cair no chao sem chamar ninguem de
     volta, e a corrente parava ali -- a segunda categoria nunca descia. */
  (c.fila = c.fila || []).push(pronto);
  if (c.carregando) return;
  c.carregando = true;
  var servir = function (ok) {
    var f = c.fila || []; c.fila = [];
    f.forEach(function (cb) { cb(ok); });
  };
  var main = $("#main");
  if (main) main.innerHTML = '<div class="loading">Carregando ' + esc(c.nome) + '…<br>' +
    '<small>Isso acontece só uma vez por visita.</small></div>';
  var sc = document.createElement("script");
  sc.src = c.arquivo;
  sc.onload = function () {
    var lista = (window[c.global] && window[c.global].games) || [];
    lista.forEach(prepararJogo);
    GAMES = GAMES.concat(lista);
    c.carregado = true; c.carregando = false;
    montarFacetas();          // anos e gêneros mudaram
    servir(true);
  };
  sc.onerror = function () {
    c.carregando = false;
    F.plats = F.plats.filter(function (x) { return x !== chave; });
    $$(".f-plat").forEach(function (x) { if (x.value === chave) x.checked = false; });
    alert("Não consegui carregar " + c.arquivo + ". Confira se o arquivo está junto do site.");
    servir(false);
  };
  document.head.appendChild(sc);
}

/* Em sequência, e só então segue: dois <script> concorrentes competiriam pelo
   mesmo #main e pela mesma remontagem de facetas. */
function carregarCatalogos(chaves, pronto) {
  var ok = true;
  var proximo = function (i) {
    if (i >= chaves.length) return pronto(ok);
    carregarCatalogo(chaves[i], function (bom) { ok = ok && bom; proximo(i + 1); });
  };
  proximo(0);
}

function maxPlayers(g, scope) {
  var t = g._t;
  if (scope === "local")  return t.maxPlayersLocal || 0;
  if (scope === "online") return t.maxPlayersOnline || 0;
  return Math.max(t.maxPlayersLocal || 0, t.maxPlayersOnline || 0, t.maxPlayers || 0);
}

/* Um modo de jogo, levando em conta o "onde". Sem co-op nem versus marcado, o
   onde sozinho pede multiplayer naquele lugar. Nao existe versus online no dado,
   so versus local: online usa "tem versus e tem multiplayer online", que e o mais
   perto que da para chegar. */
function modoOk(g, m) {
  var t = g._t, w = F.where;
  if (m === "singlePlayer") return !!t.singlePlayer;
  if (m === "coop") return !!(w === "local" ? t.coopLocal : w === "online" ? t.coopOnline : t.coop);
  if (m === "versus") return !!(w === "local" ? t.versusLocal :
                                w === "online" ? t.versus && t.multiplayerOnline : t.versus);
  return false;
}

function modosOk(g) {
  var multi = false;
  for (var i = 0; i < F.modes.length; i++) {
    if (!modoOk(g, F.modes[i])) return false;
    if (F.modes[i] !== "singlePlayer") multi = true;
  }
  if (!multi && F.where === "local" && !g._t.multiplayerLocal) return false;
  if (!multi && F.where === "online" && !g._t.multiplayerOnline) return false;
  return true;
}

function buscaOk(g) {
  return !F.q || g._s.indexOf(F.q) >= 0 || (F.qFrouxa && subsequencia(F.qc, g._c));
}

function match(g, skip) {
  // Dentro de uma colecao do CollectionUI so a busca vale: os filtros do catalogo
  // escondem a coluna e poderiam sumir com um jogo que esta la.
  if (AREA === "cui" && cuiTela === "jogos") return buscaOk(g) && cuiNaSel(g);
  if (skip !== "plat" && F.plats.indexOf(g.platform) < 0) return false;
  if (!buscaOk(g)) return false;

  // Ao adicionar jogos ao CollectionUI vale o catalogo inteiro, escondido
  // incluso: um jogo escondido daqui ainda pode estar no console.
  if (AREA !== "cui") {
  // "não quero" tira o jogo de todas as listas, menos da lista de escondidos
  if (F.own === "hide") { if (!escondidos.has(g.id)) return false; }
  else if (escondidos.has(g.id)) return false;
  if (F.own === "yes" && !owned.has(g.id)) return false;
  if (F.own === "no" && owned.has(g.id)) return false;
  if (F.own === "wish" && !wishlist.has(g.id)) return false;
  // o que ainda não passou por nenhuma decisão: nem tenho, nem quero, nem
  // escondi (escondido já saiu acima). "Só os que faltam" não serve aqui
  // porque a wishlist também falta, e ela já foi decidida.
  if (F.own === "none" && (owned.has(g.id) || wishlist.has(g.id))) return false;
  }

  if (skip !== "mode" && !modosOk(g)) return false;
  if (skip !== "coopt" && F.coopt && !g.coopInfo) return false;
  if (skip !== "flag") {
    for (var j = 0; j < F.flags.length; j++) {
      var f = F.flags[j], v = (g.flags || {})[f];
      if (f === "kinect") { if (!v) return false; }
      else if (!v) return false;
    }
  }
  if (F.plMin > 0 && maxPlayers(g, F.where) < F.plMin) return false;
  if (F.mcMin > 0 && !(g.mc >= F.mcMin)) return false;   // sem nota também não passa

  if (F.y1 && (g.year == null || g.year < +F.y1)) return false;
  if (F.y2 && (g.year == null || g.year > +F.y2)) return false;

  // So corta jogo de Xbox original. O "sim" escondia tambem todos os de 360,
  // que nao tem retrocompatibilidade nenhuma a filtrar.
  if (F.bc !== "all" && g.platform === "xbox") {
    var c = !!(g.bc360 && g.bc360.compatible);
    if (F.bc === "yes" && !c) return false;
    if (F.bc === "no" && c) return false;
  }

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

  /* Nos 3.344 jogos de source "xblig-default" o modo nao e fraco, e inventado:
     o coletor procura palavra de multiplayer no TITULO e, nao achando nenhuma,
     grava singlePlayer=true com todo o resto false. Etiqueta ali seria o
     catalogo afirmando 3.344 vezes uma coisa que ninguem apurou, e aviso no
     card, numa grade de dezenas, ninguem le. O card entao nao diz nada sobre
     modo, e quem abrir a ficha encontra a frase inteira. */
  if (t.source === "xblig-default") return h.join("") + extrasHtml(g);

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

  return h.join("") + extrasHtml(g);
}

/* O que nao e modo de jogo: plataforma ja saiu, aqui vem retrocompatibilidade,
   situacao de vazado, flags e categoria. Fica a parte porque o card de XBLIG
   sem fonte pula os modos e vem direto para ca. */
function extrasHtml(g) {
  var h = [];
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

/* Icones dos botoes do card em SVG, e nao caractere: estrela e "proibido" de
   texto mudam de desenho e de tamanho a cada fonte. A estrela cheia ou vazia
   sai do CSS, pela classe .wish do card, entao marcar nao reescreve o botao. */
var ICO_WISH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
var ICO_REM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
var ICO_HIDE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.2-3.1 3.5M6.6 6.6C4.6 8 3.2 10 2.5 12c1 1.5 4.5 6 9.5 6 1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function cardHtml(g) {
  // A nota da critica tem preferencia. A dos jogadores so aparece no card de
  // quem nao tem Metacritic, e com desenho diferente para ninguem confundir
  // uma escala de 0-100 com uma de 0-5.
  var mc = typeof g.mc === "number"
    ? '<span class="mc ' + mcClasse(g.mc) + (g.mcGeral ? " geral" : "") + '" title="' +
      (g.mcGeral ? "Nota Geral do Metacritic" + (g.mcPlats ? ": " + g.mcPlats : "")
        : "Metacritic") + '">' + g.mc +
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
  /* Título sem link: clicar no card é para abrir a ficha, e um <a> no meio dele
     mandava a pessoa para fora do site sem aviso. A Wikipédia e a página do
     projeto continuam na Ficha técnica, que é onde link é o que se espera. */
  var link = esc(g.title);

  var o = owned.has(g.id), w = wishlist.has(g.id), h = escondidos.has(g.id);
  var estado, marcas;
  if (AREA !== "cui") {
    estado = (o ? " own" : "") + (w ? " wish" : "") + (h ? " hide" : "");
    marcas = '<div class="marks">' +
      '<button class="wish-btn" title="Wishlist" aria-label="Wishlist">' + ICO_WISH + "</button>" +
      '<button class="hide-btn" title="Não quero, esconder da lista" aria-label="Esconder">' + ICO_HIDE + "</button>" +
      "</div>";
  } else if (cuiTela === "adicionar") {
    // Como na previa: o nao marcado fica apagado, e so acende quando marcado.
    estado = (cuiNoRascunho(g) ? " nacol" : " apagado") + (g._tids.length ? "" : " semtid");
    marcas = "";
  } else {
    estado = "";
    marcas = cuiEditavel() ? '<div class="marks"><button class="rem-btn" title="Remover da coleção" ' +
      'aria-label="Remover da coleção">' + ICO_REM + "</button></div>" : "";
  }
  return '<article class="card' + estado + '" data-id="' + esc(g.id) + '"' +
    (AREA === "cui" && !g._tids.length ? ' title="Sem Title ID: não dá para pôr em coleção do CollectionUI"' : "") + ">" +
    marcas +
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
  if (AREA === "cui" && cuiTela === "colecoes") return cuiTelaColecoes();
  var list = sortList(filtered(null));
  var main = $("#main");
  main.innerHTML = "";
  if (!list.length) {
    main.innerHTML = AREA === "cui" && cuiTela === "jogos"
      ? '<div class="empty">' + (F.q ? "Nenhum jogo desta coleção bate com a busca." : "Nenhum jogo nesta coleção ainda.") + "</div>"
      : '<div class="empty">Nenhum jogo bate com esses filtros.<br>Tente limpar alguns.</div>';
  } else {
    buildQueue(list);
    renderMore();
    observe();
  }
  updateStats(list);
  updateFacets();
  cuiPintar();
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
  var ownCount = 0, byPlat = { x360: 0, xblig: 0, xbox: 0, homebrew: 0, emu: 0 };
  GAMES.forEach(function (g) {
    byPlat[g.platform]++;
    if (owned.has(g.id)) ownCount++;
  });
  $("#s-wish").textContent = wishlist.size.toLocaleString("pt-BR");
  var eh = $("#s-hide"); if (eh) eh.textContent = escondidos.size.toLocaleString("pt-BR");
  /* Categoria ainda não baixada não tem jogo em GAMES, mas o total dela veio no
     bundle principal, em counts. Sem esse resgate o painel exibiria zero, que é
     mentira, e a porcentagem daria um salto na hora que a categoria carregasse. */
  var totalPlat = function (k) {
    if (byPlat[k]) return byPlat[k];
    return CATALOGOS[k] && !CATALOGOS[k].carregado ? ((DB.counts || {})[k] || 0) : 0;
  };
  var totalTudo = GAMES.length;
  pendentes(Object.keys(CATALOGOS)).forEach(function (k) { totalTudo += totalPlat(k); });

  $("#s-shown").textContent = list.length.toLocaleString("pt-BR");
  // o painel de cima fica atras da gaveta no celular, entao o numero de
  // exibidos precisa aparecer tambem no rodape dela, ao vivo
  $("#side-n").textContent = list.length.toLocaleString("pt-BR");
  $("#s-total").textContent = totalTudo.toLocaleString("pt-BR");
  $("#s-own").textContent = ownCount.toLocaleString("pt-BR");
  $$("[data-cnt^='plat-']").forEach(function (el) {
    var k = el.dataset.cnt.slice(5), n = totalPlat(k);
    // Bundle velho nao traz o total das categorias sob demanda: nesse caso fica
    // em branco, que mente menos que um zero.
    el.textContent = n || (CATALOGOS[k] && !CATALOGOS[k].carregado ? "" : 0);
  });
}

function updateFacets() {
  var fm = filtered("mode"), ff = filtered("flag");
  $$("[data-cnt^='m-']").forEach(function (el) {
    var k = el.dataset.cnt.slice(2), n = 0;
    fm.forEach(function (g) { if (modoOk(g, k)) n++; });
    el.textContent = n;
  });
  $$("[data-cnt^='f-']").forEach(function (el) {
    var k = el.dataset.cnt.slice(2), n = 0;
    ff.forEach(function (g) { if ((g.flags || {})[k]) n++; });
    el.textContent = n;
  });
  var fc = filtered("coopt"), nc = 0;
  fc.forEach(function (g) { if (g.coopInfo) nc++; });
  $("[data-cnt='coopt']").textContent = nc;
}

/* ---------------- detalhes ---------------- */
/* O console que roda a ROM. O catalogo guarda a sigla, que e o que o filtro
   usa, mas na ficha ela vira o nome inteiro: "GBA" nao diz nada para quem nao e
   do meio. */
var SISTEMA = { SNES: "Super Nintendo", GBA: "Game Boy Advance", PS1: "PlayStation 1" };

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

/* O bloco do Co-Optimus numa caixa propria, e nao como mais uma lista de
   marcadores igual a dos modos. As duas coisas tem naturezas diferentes: os
   modos sao inferencia nossa a partir da Wikipedia, o Co-Optimus e catalogo
   mantido a mao, jogo a jogo, e so de co-op.

   Os quatro numeros vao em grade porque sao a MESMA medida em quatro situacoes:
   em lista de marcadores ninguem compara "local 2" com "online 4". */
function coopHtml(g) {
  var c = g.coopInfo;
  /* A caixa aparece mesmo vazia, e de propósito: calar faria o leitor concluir
     que a ausência de co-op foi conferida, e ela não foi. O Co-Optimus só
     cataloga jogo COM co-op, e cobre 905 dos 17.239 títulos do catálogo. */
  if (!c) {
    return '<div class="coop-caixa"><div class="coop-topo">' +
      "<b>Co-op segundo o Co-Optimus</b></div>" +
      '<div class="coop-corpo"><p class="nota">Jogo não consta no Co-Optimus.</p></div></div>';
  }
  var cel = function (rot, v) {
    if (v == null) return "";
    return '<div class="num' + (v > 0 ? "" : " zero") + '"><span>' + rot + "</span><b>" +
      (v > 0 ? v : "não tem") + "</b></div>";
  };
  var nums = cel("Local", c.local) + cel("Online", c.online) +
    (c.combo ? cel("Local + online", c.combo) : "") +
    (c.lan ? cel("System Link", c.lan) : "");
  var ex = (c.extras || []).map(function (x) {
    return '<span class="chip-coop">' + esc(COOPEXTRA[x.toLowerCase()] || x) + "</span>";
  }).join("");
  /* A data diz de quando e a copia do Internet Archive que foi lida. O
     Co-Optimus vive atras de um desafio da Cloudflare, entao o que temos e
     sempre um retrato, nunca a pagina de hoje. */
  var d = /^\d{8}$/.test(String(c.snapshot || ""))
    ? String(c.snapshot).slice(6, 8) + "/" + String(c.snapshot).slice(4, 6) +
      "/" + String(c.snapshot).slice(0, 4)
    : null;
  return '<div class="coop-caixa"><div class="coop-topo">' +
    "<b>Co-op segundo o Co-Optimus</b>" +
    (d ? "<small>lido em " + d + "</small>" : "") + "</div>" +
    '<div class="coop-corpo">' +
    (nums ? '<div class="nums">' + nums + "</div>" : "") +
    (ex ? '<div class="chips-coop">' + ex + "</div>" : "") +
    (c.exp ? '<p class="coop-exp">' + esc(c.exp) + "</p>" : "") +
    "</div></div>";
}

/* De onde saiu o modo de jogo de cada título. Isto era um grau, "confiança
   high/medium/low", e o grau escondia justamente o que importa: "high" juntava
   ficha do artigo com número digitado sem fonte, e "low" juntava chute por
   gênero com um padrão aplicado em bloco a todos os 3.344 indies. Nomear a
   procedência diz mais e não dá nota a ninguém, que é o mesmo caminho das notas
   (Metacritic), do tempo (HowLongToBeat) e do co-op (Co-Optimus).

   Duas palavras, dois sentidos: "derivados" para o que saiu de uma fonte de
   verdade, "deduzidos" e "presumidos" para o que é palpite nosso. "fraco" marca
   o palpite, e só ele ganha a régua âmbar. */
var FONTE = {
  "wikipedia-infobox": { txt: "Modos de jogo derivados da ficha do artigo na Wikipédia." },
  "wikipedia-text":    { txt: "Modos de jogo derivados do texto do artigo na Wikipédia." },
  "systemlink":        { txt: "Modos de jogo derivados da lista de System Link da Wikipédia." },
  /* "sem fonte registrada" e não "escrito à mão": quem lê não sabe o que é um
     coletor, e dizer que foi feito à mão soa como cuidado quando é o contrário.
     O que importa para quem lê é que ninguém pode apontar de onde veio. */
  "manual":            { txt: "Modos de jogo sem fonte registrada.", fraco: true },
  "manual-vazados":    { txt: "Modos de jogo sem fonte registrada.", fraco: true },
  "genre-prior":       { txt: "Modos de jogo deduzidos do gênero.", fraco: true },
  "title-hint":        { txt: "Modos de jogo deduzidos do título.", fraco: true },
  /* O pior caso do catálogo, e são 3.344 jogos. O coletor procura palavra de
     multiplayer no TÍTULO; não achando nenhuma, grava singlePlayer=true e todo
     o resto false. O "Single player" desses jogos é presumido, e a ausência dos
     outros modos também. Por isso o card nem mostra etiqueta de modo neles. */
  "xblig-default":     { txt: "Modos de jogo presumidos: nenhuma fonte, e o título não sugere multiplayer.",
                         fraco: true },
  "launchbox":         { txt: "Modos de jogo derivados do LaunchBox." },
  "launchbox-sem-maxplayers": {
    txt: "Modos de jogo derivados do LaunchBox sem número de jogadores." }
};

/* Há procedência composta, tipo "wikipedia-infobox+systemlink": o que manda é a
   primeira, que é de onde veio o grosso da informação. */
function fonteTag(t) {
  var s = t.source || "";
  return FONTE[s] || FONTE[s.split("+")[0]] || null;
}

function fmtDate(s) {
  if (!s) return null;
  var p = String(s).split("-");
  if (p.length === 3) return p[2] + "/" + p[1] + "/" + p[0];
  if (p.length === 2) return p[1] + "/" + p[0];
  return p[0];
}

function linha(rot, val, titulo) {
  return val ? '<div class="li"' + (titulo ? ' title="' + esc(titulo) + '"' : "") +
    "><span>" + rot + "</span><b>" + val + "</b></div>" : "";
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
  var f = fonteTag(t);
  if (f) h += '<p class="nota' + (f.fraco ? " alerta" : "") + '">' + f.txt + "</p>";
  /* Quando a procedência é palpite, a régua âmbar corre ao lado da LISTA e não
     só do texto: é a lista inteira que está sob ressalva, não uma frase solta.
     O aviso do Co-Optimus fica de fora dela de propósito, porque fala de outra
     coisa, a ausência de conferência do co-op. */
  if (f && f.fraco) h = '<div class="fonte-fraca">' + h + "</div>";
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

/* O coletor guarda GB porque e a unidade da pagina do Marketplace, mas mostrar
   tudo em giga esconde o catalogo: 83% dos jogos tem menos de 1 GB, 1.948 deles
   tem menos de 100 MB e a mediana e 0,04 GB. "0,04 GB" seria a leitura normal, e
   nao a excecao. Abaixo de 1 GB, portanto, sai em MB. */
function mbTexto(mb) {
  if (typeof mb !== "number" || mb <= 0) return null;
  if (mb < 1) return Math.round(mb * 1024) + " KB";
  /* Abaixo de 10 MB a casa decimal ainda diz algo (2,4 MB contra 2 MB); acima
     dela vira ruído. Os DLCs vão de 20 KB a 3,2 GB, então as três unidades são
     todas necessárias. */
  if (mb < 1024) return mb.toLocaleString("pt-BR", { maximumFractionDigits: mb < 10 ? 1 : 0 }) + " MB";
  return (mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " GB";
}

/* O coletor guarda o tamanho do jogo em GB e o do DLC em MB; a régua de unidade
   é a mesma, então uma converte para a outra em vez de duplicar a regra. */
function tamanhoTexto(gb) {
  return typeof gb === "number" ? mbTexto(gb * 1024) : null;
}

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
var POUCOS_RELATOS = 5;    /* abaixo disso o popup avisa; ver tempoHtml */
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
    nota = "Valor aproximado, preenchido \u00e0 m\u00e3o. Corrija em data/tempo.json.";
  } else if (t.fonte === "hltb") {
    var n = typeof t.n === "number" ? t.n : null;
    var console_ = g.system || PLATNOME[g.platform] || "";
    /* O "S\u00f3" faz o trabalho que antes era uma frase inteira de aviso, e o
       proprio numero fica a vista para quem quiser julgar sozinho. A mediana
       deste catalogo e 6 relatos, entao sem o corte o aviso dispararia em dois
       tercos dos jogos e viraria ruido. */
    var quantos = n === null ? "" :
      (n < POUCOS_RELATOS ? "S\u00f3 " : "") + n.toLocaleString("pt-BR") +
      (n === 1 ? " relato" : " relatos") + " ";
    nota = (quantos || "") + (quantos ? "no HowLongToBeat" : "HowLongToBeat") +
      /* De onde vem o numero. O geral soma o jogo em todo canto onde ele saiu;
         avisar disso e o mesmo que o catalogo ja faz com a nota do Metacritic
         que nao e da plataforma. */
      (t.geral ? ", de todos os consoles"
        : console_ ? ", no " + esc(console_) : "") + ".";
  }
  return "<ul class=\"tempo\">" + li.join("") + "</ul>" +
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
    return "<li><b>TU" + u.v + "</b>" +
      (u.d ? '<span class="tu-d">' + esc(fmtDate(u.d)) + "</span>" : "") +
      (u.kb ? '<span class="tu-kb">' + esc(kb(u.kb)) + "</span>" : "") + "</li>";
  }).join("");
  /* "conhecidos", e nao "lancados" nem "disponiveis": a lista vem do arquivo do
     Xbox Unity e sabemos que ela tem buraco -- em 152 dos 689 jogos com patch a
     numeracao comeca no TU2, ou seja, o primeiro nao foi arquivado. E nada aqui
     e baixavel: os servidores sairam do ar com a Xbox LIVE do 360. */
  return '<details class="tu"><summary>' + t.n +
    (t.n > 1 ? " TUs conhecidos" : " TU conhecido") +
    "</summary><ul>" + linhas + "</ul></details>";
}

/* Retrocompatibilidade: bloco proprio porque so 995 jogos tem, e para eles e a
   primeira pergunta, nao um detalhe de rodape. */
/* Uma pilula por fato de uma linha so. Elas nao parecem nem texto nem lista,
   que era o problema da Visao geral: prosa, midia e fatos disputando o mesmo
   peso, com os fatos ainda usando dois sistemas de linha diferentes. */
function chip(rot, val, classe) {
  if (!val) return "";
  return '<span class="chip' + (classe ? " " + classe : "") + '">' +
    (rot ? "<span>" + rot + "</span>" : "") + "<b>" + val + "</b></span>";
}

function bcChips(g) {
  var c = g.bc360;
  if (!c) return "";
  /* A regiao entra dentro do veredito em vez de virar pilula propria: ela
     qualifica o "roda", e solta nao se explicava. */
  var regs = (c.regions || []).join(", ");
  var h = chip("", (c.compatible ? "✓ Roda no Xbox 360" : "✗ Não roda no Xbox 360") +
    (c.compatible && regs ? " (" + esc(regs) + ")" : ""),
    c.compatible ? "sim" : "nao");
  if (c.compatible) {
    /* A lista da Microsoft era por REGIAO do disco: o perfil de compatibilidade
       era feito por SKU, entao a versao NA podia rodar e a PAL nao. Mas o
       build_xbox.py grava "all" tambem quando a tabela da Wikipedia nao traz
       selo nenhum, o que e o caso de 425 dos 466 compativeis. Mostrar "todas"
       ali seria transformar silencio da fonte em afirmacao, que e exatamente o
       que o aviso de co-op existe para evitar. So falamos quando a fonte falou,
       o que sao 41 jogos. */
    if (c.xboxOriginals) h += chip("", "Xbox Originals", "");
  }
  return h;
}

/* Resolucao nativa de render. O campo de anti-aliasing e texto livre de forum:
   ao lado de "2xAA" e "FXAA" existem coisas como "no MSAA, but depth/Z-based
   edge blur ?" e "2xAA ala Gears...". So o que for curto entra no parenteses; o
   resto vai para o hover, junto da fonte, que nao cabe na linha. */
function resolucaoLinha(g) {
  var r = g.resolucao;
  if (!r || !r.w || !r.h) return "";
  var aa = r.aa || "";
  var curto = /^no aa$/i.test(aa) ? "sem AA"
    : (aa && aa.length <= 12 && aa.indexOf(",") < 0 ? aa : "");
  var fonte = "Resolução medida pela comunidade do fórum Beyond3D" +
    (aa && !curto ? ". Anti-aliasing: " + aa : "");
  return linha("Resolução", r.w + " x " + r.h + (curto ? " (" + esc(curto) + ")" : ""), fonte);
}

function fichaHtml(g) {
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
  var f = g.flags || {};
  var h = linha("Plataforma", esc(PLATNOME[g.platform] || g.platform)) +
    linha("Lançamento", lancamento || g.year || null) +
    linha("Gênero", esc(g.genre || "")) +
    linha("Categoria", g.category ? esc(g.category) : null) +
    linha("Situação", g.releaseType === "Vazado" ? "cancelado, com a build vazada e jogável" : null) +
    linha("Console", g.console ? esc(g.console === "x360" ? "Xbox 360"
          : g.console === "both" ? "Xbox e Xbox 360" : "Xbox original") : null) +
    linha("Desenvolvedora", esc((g.developers || []).join(", "))) +
    linha("Publicadora", esc((g.publishers || []).join(", "))) +
    /* A chave canonica do jogo no console. E o que aparece no dashboard e o que
       o Xbox Unity, os gerenciadores de TU e o Xenia pedem, entao quem usa o
       catalogo para montar console vai querer copiar daqui. Monoespacada porque
       e codigo, e para 425307D5 nao virar 4253O7D5 na leitura. */
    linha("Title ID", g.titleId ? "<code>" + esc(g.titleId) + "</code>" : null) +
    /* Os outros Title IDs do mesmo jogo: outra regiao, disco e Arcade, edicao.
       O console grava o do disco que ele achou, entao qualquer um pode ser o seu. */
    linha("Outros Title IDs", (g.titleIdAlt || []).length
      ? g.titleIdAlt.map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(" ") : null,
      "Mesmo jogo em outra região, edição ou versão (disco e Arcade)") +
    resolucaoLinha(g) +
    /* O que era a gaveta "Extras" virou linha de ficha. A gaveta misturava fato
       de patch, forma de venda, hardware e recurso de video numa lista so, e
       cada um deles responde uma pergunta diferente. */
    (f.xbla ? linha("Distribuição", "Xbox Live Arcade") : "") +
    (f.stereo3d ? linha("3D estereoscópico", "suportado") : "") +
    /* A Xbox LIVE do 360 foi desligada, entao saber que um jogo NUNCA recebeu
       patch vale tanto quanto saber quais ele recebeu. */
    (g.tu && !g.tu.n ? linha("Atualizações", "nunca recebeu") : "");

  var links = [];
  if (g.wiki) links.push('<a href="https://en.wikipedia.org/wiki/' + encodeURIComponent(g.wiki) +
    '" target="_blank" rel="noopener">Wikipédia ↗</a>');
  if (g.url) links.push('<a href="' + esc(g.url) + '" target="_blank" rel="noopener">Página do projeto ↗</a>');
  if (g.fonte) links.push('<a href="' + esc(g.fonte) + '" target="_blank" rel="noopener">Fonte do cancelamento ↗</a>');
  return h + (links.length ? '<div class="det-links">' + links.join("") + "</div>" : "");
}

/* As abas da ficha. Aba sem conteudo NAO e desenhada: prometer "Conteudo
   adicional" e abrir o vazio e pior do que nao ter a aba, e o vazio seria a
   regra -- dos 4.892 jogos com Title ID, 4.203 nunca receberam patch nenhum. */
function abasDetalhe(g) {
  var f = g.flags || {}, abas = [];

  /* O que se escaneia vem antes do que se le: a faixa de fatos abre a aba, a
     midia e a prosa vem depois. Kinect entra aqui e nao com os modos porque nos
     132 jogos que EXIGEM o sensor ele responde a mesma pergunta que a
     retrocompatibilidade, se roda no seu setup. */
  /* "Tamanho Total" e nao "Tamanho": com a pílula de discos do lado, "Tamanho
     4,8 GB" mais "Discos 2" convida a multiplicar um pelo outro. São medidas de
     coisas diferentes -- o disco é a mídia física de 2014, o tamanho é o que o
     Marketplace mandava pela rede, sem enchimento e sem o conteúdo duplicado
     entre discos -- e a palavra "Total" fecha essa leitura. */
  var fatos = chip("Console", g.system ? esc(SISTEMA[g.system] || g.system) : null) +
    chip("Tamanho Total", tamanhoTexto(g.tamanho)) +
    chip("Discos", g.discos > 1 ? g.discos : null) +
    chip("Kinect", f.kinect ? (f.kinect === "required" ? "obrigatório" : "opcional") : null) +
    bcChips(g);
  var geral = (fatos ? '<div class="faixa">' + fatos + "</div>" : "") +
    (g.bc360 && g.bc360.issues
      ? '<p class="nota bc-nota"><b>Problemas conhecidos:</b> ' + esc(g.bc360.issues) + "</p>" : "") +
    (g.description ? '<p class="desc">' + esc(g.description) + "</p>" : "") +
    galeriaHtml(g);
  var tempo = tempoHtml(g);
  if (tempo) geral += "<h4>Tempo de jogo</h4>" + tempo;
  if (geral) abas.push(["Visão geral", geral]);

  var coop = coopHtml(g);
  abas.push(["Modos/co-op", "<h4>Modos de jogo</h4>" + modosHtml(g) + coop]);

  var adicional = dlcHtml(g) + tuHtml(g);
  if (adicional) abas.push(["Conteúdo adicional", adicional]);

  abas.push(["Ficha técnica", fichaHtml(g)]);
  return abas;
}

/* Add-ons do Marketplace. "Conhecidos" pelo mesmo motivo dos Title Updates: a
   listagem da loja era paginada e o que ficou no Internet Archive e a pagina
   arquivada, nao o catalogo inteiro de add-ons do jogo. E nada disso se compra
   mais, a loja fechou em 2024 -- por isso o coletor nem guarda preco ou link. */
function dlcHtml(g) {
  var d = g.dlc;
  if (!d || !d.length) return "";
  /* Cada add-on é {n, mb}: nome e tamanho em MB. Antes era o nome cru, e o
     render que não acompanhou punha "[object Object]" na tela. */
  return '<details class="tu"><summary>' + d.length +
    (d.length > 1 ? " DLCs conhecidos" : " DLC conhecido") +
    "</summary><ul>" + d.map(function (x) {
      var t = mbTexto(x.mb);
      return '<li><span class="tu-n">' + esc(x.n || "") + "</span>" +
        (t ? '<span class="tu-mb">' + t + "</span>" : "") + "</li>";
    }).join("") + "</ul></details>";
}

function detalheHtml(g) {
  var o = owned.has(g.id), w = wishlist.has(g.id);
  var capa = g.image
    ? '<img src="' + esc(g.image) + '" alt="' + esc(g.title) + '"' + (g.wide ? ' class="wide"' : "") + ">"
    : '<div class="ph">' + esc(g.title) + "</div>";

  var abas = abasDetalhe(g), corpo;
  if (abas.length < 2) {
    corpo = abas.length ? abas[0][1] : "";   // uma aba so nao e aba, e uma coluna
  } else {
    corpo = '<div class="abas" role="tablist">' + abas.map(function (a, i) {
        return '<button class="aba" role="tab" data-aba="' + i +
          '" aria-selected="' + (i === 0) + '">' + a[0] + "</button>";
      }).join("") + "</div>" +
      abas.map(function (a, i) {
        return '<div class="pane" data-pane="' + i + '"' + (i ? " hidden" : "") + ">" +
          a[1] + "</div>";
      }).join("");
  }

  return '<div class="det">' +
    '<div class="det-capa">' + capa + "</div>" +
    '<div class="det-info">' +
      "<h3>" + esc(g.title) + "</h3>" +
      '<div class="det-sub">' + esc([PLATNOME[g.platform], g.year, g.genre || g.category]
        .filter(Boolean).join(" · ")) + "</div>" +
      /* O rotulo da nota diz so a fonte. O quadrado colorido e a pilula com
         estrela ja separam critica de publico, entao escrever "nota da critica"
         era legendar o que o desenho mostra. */
      /* "Nota Geral" é o que o dado diz de si: ela veio da página geral do
         jogo no Metacritic, que cobre vários consoles de uma vez. A versão
         anterior afirmava "não é da versão de X", o que é falso em 55 dos 198
         casos, porque o console do jogo costuma estar na lista. A lista exata
         fica no hover, e o asterisco com rodapé sai: legenda no rótulo não
         obriga o olho a viajar. */
      (typeof g.mc === "number"
        ? '<div class="det-mc"' + (g.mcGeral && g.mcPlats
            ? ' title="A nota cobre: ' + esc(g.mcPlats) + '"' : "") + ">" +
          '<span class="mc ' + mcClasse(g.mc) + (g.mcGeral ? " geral" : "") + '">' +
          g.mc + "</span><span>" +
          (g.mcGeral ? "Nota Geral do Metacritic" : "Metacritic") + "</span></div>" : "") +
      (typeof g.ur === "number"
        ? '<div class="det-mc"><span class="ur"><b>★</b>' + urTexto(g.ur) + "</span>" +
          "<span>Xbox Marketplace</span></div>" : "") +
      (g.releaseType === "Vazado" && g.nota
        ? '<p class="det-vaz"><b>Cancelado, mas jogável.</b> ' + esc(g.nota) + "</p>" : "") +
      '<div class="det-acoes">' +
        '<button class="btn ' + (o ? "primary" : "") + '" data-mark="own">' +
          (o ? "Eu tenho" : "Marcar que tenho") + "</button>" +
        '<button class="btn ' + (w ? "amber" : "") + '" data-mark="wish">' +
          (w ? "Na wishlist" : "Pôr na wishlist") + "</button>" +
        '<button class="btn' + (escondidos.has(g.id) ? " muted" : "") + '" data-mark="hide">' +
          (escondidos.has(g.id) ? "Escondido" : "Não quero") + "</button>" +
      "</div>" + corpo +
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
/* O nome diz o que o arquivo guarda. Era "xbox-vault-colecao-", e colecao vai ser
   a do CollectionUI. A importacao nao olha o nome, entao os arquivos antigos
   continuam entrando. */
function nomeExport() {
  return "xbox-vault-marcacoes-" + new Date().toISOString().slice(0, 10) + ".json";
}

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
  a.download = nomeExport();
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

function applyImport(p, mode, semConferir) {
  var todos = Object.keys(p.marks || {}).concat(p.owned, p.wishlist, p.hidden || []);

  /* O filtro abaixo compara contra o catálogo CARREGADO, e as categorias sob
     demanda não estão nele. Antes de julgar um id como inexistente, baixar o
     catálogo a que ele pertence. Era assim que importar um backup com a
     emulação desligada apagava em silêncio as marcações dela, e o aviso ainda
     contava menos do que perdia, porque só somava owned e wishlist: num caso
     real, 6 avisados e 18 perdidos, sendo 12 deles "não quero". */
  if (!semConferir) {
    var faltam = Object.keys(CATALOGOS).filter(function (k) {
      if (CATALOGOS[k].carregado) return false;
      for (var i = 0; i < todos.length; i++) {
        if (todos[i].indexOf(CATALOGOS[k].prefixo) === 0) return true;
      }
      return false;
    });
    /* Se o download falhar, guardar vale mais que descartar: a marcação é da
       pessoa, e um id que não casa com jogo nenhum é inerte, nunca renderiza. */
    if (faltam.length) {
      return carregarCatalogos(faltam, function (ok) { applyImport(p, mode, !ok); });
    }
  }

  var known = new Set(GAMES.map(function (g) { return g.id; }));
  var deCatalogo = function (id) {
    for (var k in CATALOGOS) if (id.indexOf(CATALOGOS[k].prefixo) === 0) return true;
    return false;
  };
  var vale = function (id) { return known.has(id) || (semConferir && deCatalogo(id)); };
  var keep = function (a) { return a.filter(vale); };
  var o = keep(p.owned), w = keep(p.wishlist);

  // o aviso conta o arquivo INTEIRO, e nao so as duas listas
  var vistos = {}, ignorados = 0;
  todos.forEach(function (id) {
    if (vistos[id] || vale(id)) return;
    vistos[id] = 1; ignorados++;
  });

  if (p.marks) {                       // arquivo v3: junta respeitando os timestamps
    if (mode === "replace") { marks = {}; }
    var lim = {};
    for (var k in p.marks) if (vale(k)) lim[k] = p.marks[k];
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
  alert("Importado: " + o.length + " que tenho, " + w.length + " na wishlist" +
    (ignorados ? "\n" + ignorados + " id(s) do arquivo não existem no catálogo e foram ignorados." : "") +
    (semConferir ? "\nNão consegui carregar uma das categorias, então os ids dela entraram sem conferência." : "") +
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
    "<h3>Importar marcações</h3><p>O arquivo tem <b>" + pending.owned.length +
    "</b> jogo(s) que você tem e <b>" + pending.wishlist.length +
    "</b> na wishlist. Como aplicar?</p>" +
    '<button class="btn primary" id="imp-merge">Somar ao que já está marcado aqui (' +
    owned.size + " que tenho, " + wishlist.size + " na wishlist)</button>" +
    '<button class="btn" id="imp-replace">Substituir tudo pelo arquivo</button>');
  $("#imp-merge").onclick = function () { applyImport(pending, "merge"); };
  $("#imp-replace").onclick = function () {
    if (confirm("Isso apaga suas marcações atuais (" + owned.size + " que tenho e " + wishlist.size +
                " na wishlist) e usa só as do arquivo. Confirmar?"))
      applyImport(pending, "replace");
  };
}

/* ---------------- UI ---------------- */
function saveF() { try { localStorage.setItem(FILT_KEY, JSON.stringify(F)); } catch (e) {} }
/* A gaveta de filtros do celular cobre a tela inteira, cabecalho incluso: nao ha
   altura de cabecalho para acertar, e os onze grupos cabem. Como ela esconde o
   painel de estatisticas, o rodape repete quantos jogos passam pelo filtro, e o
   fundo para de rolar atras dela. */
function filtros(abrir) {
  var side = $("#side");
  if (abrir === undefined) abrir = !side.classList.contains("open");
  side.classList.toggle("open", abrir);
  document.body.classList.toggle("filtros-abertos", abrir);
}

function onChange() {
  contexto();
  saveF();
  // ligar uma categoria sob demanda dispara o download dela, uma vez por visita
  var faltam = pendentes(F.plats);
  if (faltam.length) return carregarCatalogos(faltam, render);
  render();
}

function initControls() {
  medirTopo();
  if (AREA === "cui") setAreaInicial();
  montarFacetas();
  restaurarControles();
  ligarEventos();
  ligarCui();
}

/* O cabecalho muda de altura quando quebra linha (tela estreita, janela
   redimensionada), entao a altura e medida, e nao escrita no CSS. */
function medirTopo() {
  var topo = $(".topbar");
  var aplicar = function () {
    document.documentElement.style.setProperty("--topo", topo.offsetHeight + "px");
  };
  aplicar();
  if (window.ResizeObserver) new ResizeObserver(aplicar).observe(topo);
}

function montarFacetas() {
  // anos
  var years = Array.from(new Set(GAMES.map(function (g) { return g.year; })
    .filter(function (y) { return y != null; }))).sort(function (a, b) { return a - b; });
  var o1 = '<option value="">Todos</option>' + years.map(function (y) { return "<option>" + y + "</option>"; }).join("");
  $("#f-y1").innerHTML = o1; $("#f-y2").innerHTML = o1;
  $("#f-y1").value = F.y1; $("#f-y2").value = F.y2;

  // gêneros: os cinco maiores e o resto atrás do "Mostrar mais". Um gênero
  // marcado fica sempre à vista, senão o filtro ativo sumiria ao recolher.
  var gc = {};
  GAMES.forEach(function (g) { if (g.genre) gc[g.genre] = (gc[g.genre] || 0) + 1; });
  var gens = Object.keys(gc).sort(function (a, b) { return gc[b] - gc[a] || a.localeCompare(b); });
  $("#f-genres").innerHTML = gens.map(function (g, i) {
    var on = F.genres.indexOf(g) >= 0;
    return '<label class="chk' + (i >= 5 && !on ? " extra" : "") + '"><input type="checkbox" class="f-genre" value="' +
      esc(g) + '"' + (on ? " checked" : "") + "> " + esc(g) + '<span class="n">' + gc[g] + "</span></label>";
  }).join("");
  var mais = $("#genre-mais");
  mais.hidden = gens.length <= 5;
  mais.textContent = $("#f-genres").classList.contains("aberto") ? "− Mostrar menos" : "+ Mostrar mais";

  // categorias homebrew
  var cats = Array.from(new Set(GAMES.map(function (g) { return g.category; }).filter(Boolean))).sort();
  $("#f-cat").innerHTML = '<option value="">Todas</option>' +
    cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
  $("#f-cat").value = F.cat;
}

/* Grupo que so vale para uma plataforma aparece com ela marcada. Escondido, ele
   tambem e zerado: um filtro ativo sem controle visivel esvaziaria a lista sem
   explicacao. */
function contexto() {
  $$(".fgroup[data-plat]").forEach(function (gr) {
    var on = F.plats.indexOf(gr.dataset.plat) >= 0;
    gr.hidden = !on;
    if (on) return;
    var k = gr.dataset.g;
    if (k === "bc") { F.bc = "all"; $("#f-bc").value = "all"; }
    else if (k === "extras") { F.flags = []; $$(".f-flag").forEach(function (c) { c.checked = false; }); }
    else if (k === "cat") { F.cat = ""; $("#f-cat").value = ""; }
  });
}

function marcarVista() {
  $$(".vista").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.own === F.own); });
}

/* "Um ano" usa so o primeiro seletor e espelha o valor no segundo. */
function modoAno() {
  var um = F.yMode === "um";
  $(".y-ate").hidden = um; $("#f-y2").hidden = um;
  $$("input[name=f-ymode]").forEach(function (r) { r.checked = r.value === F.yMode; });
}

var GRUPOS_KEY = "xbx.grupos.v1";
function restaurarGrupos() {
  var fechados = [];
  try { fechados = JSON.parse(localStorage.getItem(GRUPOS_KEY) || "[]"); } catch (e) {}
  $$("details.fgroup").forEach(function (gr) {
    if (fechados.indexOf(gr.dataset.g) >= 0) gr.open = false;
    gr.addEventListener("toggle", function () {
      var f = $$("details.fgroup").filter(function (x) { return !x.open; }).map(function (x) { return x.dataset.g; });
      try { localStorage.setItem(GRUPOS_KEY, JSON.stringify(f)); } catch (e) {}
    });
  });
}

function restaurarControles() {
  // restaura estado
  $("#q").value = F.q ? F.q : "";
  $("#f-bc").value = F.bc; $("#f-cat").value = F.cat;
  $("#f-sort").value = F.sort; $("#f-pl-min").value = String(F.plMin);
  $$(".f-plat").forEach(function (c) { c.checked = F.plats.indexOf(c.value) >= 0; });
  $$(".f-mode").forEach(function (c) { c.checked = F.modes.indexOf(c.value) >= 0; });
  // modo salvo que nao existe mais (multiplayerLocal, coopLocal...) sai do filtro
  F.modes = $$(".f-mode").filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
  $$("input[name=f-where]").forEach(function (r) { r.checked = r.value === F.where; });
  $("#f-coopt").checked = !!F.coopt;
  $$(".f-flag").forEach(function (c) { c.checked = F.flags.indexOf(c.value) >= 0; });
  // descarta flags salvas que nao existem mais na UI (senao filtrariam sem forma de desmarcar)
  F.flags = $$(".f-flag").filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
  $$(".f-sys").forEach(function (c) { c.checked = F.systems.indexOf(c.value) >= 0; });
  if ($("#f-reltype")) $("#f-reltype").value = F.relType;
  if ($("#f-mc")) $("#f-mc").value = String(F.mcMin);
  marcarVista();
  modoAno();
  contexto();
  restaurarGrupos();
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
    else if (t.name === "f-where") F.where = t.value;
    else if (t.id === "f-coopt") F.coopt = t.checked;
    else if (t.name === "f-ymode") {
      F.yMode = t.value;
      if (F.yMode === "um") { F.y2 = F.y1; $("#f-y2").value = F.y1; }
      modoAno();
    }
    else if (t.id === "f-bc") F.bc = t.value;
    else if (t.id === "f-cat") F.cat = t.value;
    else if (t.id === "f-sort") F.sort = t.value;
    else if (t.id === "f-y1") { F.y1 = t.value; if (F.yMode === "um") { F.y2 = t.value; $("#f-y2").value = t.value; } }
    else if (t.id === "f-y2") F.y2 = t.value;
    else if (t.id === "f-pl-min") F.plMin = +t.value;
    else if (t.id === "f-mc") F.mcMin = +t.value;
    else return;
    onChange();
  });

  $$(".vista").forEach(function (b) {
    b.onclick = function () { F.own = b.dataset.own; marcarVista(); onChange(); };
  });
  $("#genre-mais").onclick = function () {
    var box = $("#f-genres");
    box.classList.toggle("aberto");
    this.textContent = box.classList.contains("aberto") ? "− Mostrar menos" : "+ Mostrar mais";
  };

  $("#main").addEventListener("click", function (e) {
    if (e.target.tagName === "A") return;
    var card = e.target.closest(".card");
    if (!card) return;
    if (AREA === "cui") {
      if (cuiTela === "adicionar") { cuiAlternar(card); return; }   // marca no rascunho
      if (e.target.closest(".rem-btn")) { cuiRemover(card); return; }
      // dentro da colecao o clique abre a ficha, como no catalogo
    }
    var btn = e.target.closest(".wish-btn, .hide-btn");
    if (btn) {                                   // botoes do canto marcam direto
      toggleMark(card.dataset.id,
        btn.classList.contains("wish-btn") ? "wish" : "hide", card);
      return;
    }
    var g = GAMES.find(function (x) { return x.id === card.dataset.id; });
    if (g) openDetail(g);                        // resto do card abre os detalhes
  });

  // Menus do topo (o do nome do site e o Arquivo): um aberto por vez, fecham ao
  // escolher, ao clicar fora e no Esc.
  var menus = $$(".menu");
  var abrirMenu = function (menu, abre) {
    menu.querySelector(".menu-lista").hidden = !abre;
    menu.querySelector("[aria-haspopup]").setAttribute("aria-expanded", abre);
  };
  menus.forEach(function (menu) {
    var lista = menu.querySelector(".menu-lista");
    menu.querySelector("[aria-haspopup]").onclick = function () {
      var abre = lista.hidden;
      menus.forEach(function (m) { abrirMenu(m, false); });
      abrirMenu(menu, abre);
    };
    lista.addEventListener("click", function (e) {
      if (!e.target.closest('[aria-disabled="true"]')) abrirMenu(menu, false);   // escolheu, fecha
    });
  });
  document.addEventListener("click", function (e) {
    menus.forEach(function (m) { if (!m.contains(e.target)) abrirMenu(m, false); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") menus.forEach(function (m) { abrirMenu(m, false); });
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
    var t = e.target.closest(".aba");
    if (t) {
      var raiz = t.closest(".det-info"), i = t.dataset.aba;
      Array.prototype.forEach.call(raiz.querySelectorAll(".aba"), function (x) {
        x.setAttribute("aria-selected", x === t);
      });
      Array.prototype.forEach.call(raiz.querySelectorAll(".pane"), function (p) {
        p.hidden = p.dataset.pane !== i;
      });
      return;
    }
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
    else if (e.key === "Escape" && $("#side").classList.contains("open")) filtros(false);
  });
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  $("#btn-filters").onclick = function () { filtros(); };
  $("#side-x").onclick = function () { filtros(false); };
  $("#side-done").onclick = function () { filtros(false); };
  $("#btn-reset").onclick = function () {
    F = padraoF();
    saveF(); location.reload();
  };
}

/* ---------------- CollectionUI ---------------- */
/* As colecoes do CollectionUI (o colecoes.txt do console), no fluxo da previa
   dele: uma tela com as colecoes; dentro de uma, so os jogos dela; e "Adicionar
   jogos", que abre o catalogo com os filtros num RASCUNHO, com os nao marcados
   apagados, e so grava no Concluir. Fica no navegador, como as marcacoes; o
   arquivo entra e sai pelo menu Arquivo.

   O formato e o do app/src/colecoes.cpp: tres linhas de comentario e uma
   colecao por linha, "id|tipo|nome|conteudo", CRLF. tipo jogos guarda Title IDs
   em hexa (8 digitos, maiusculos); tipo uniao guarda ids de colecao. */
var AREA = location.hash === "#collectionui" ? "cui" : "cat";
var CUI_KEY = "xbx.cui.v1";
var CUI = { cols: [], sel: null };
try { Object.assign(CUI, JSON.parse(localStorage.getItem(CUI_KEY) || "{}")); } catch (e) {}
delete CUI.vista;           // do seletor Todos/Que tenho/Da colecao, que saiu
var cuiTela = "colecoes";   // colecoes | jogos | adicionar
// Ao adicionar, a marcacao vai numa COPIA dos Title IDs: e o que da sentido ao
// Cancelar, como o rascunho da previa.
var cuiRascunho = null, cuiRascunhoSet = null;
var cuiAviso = "";          // uma linha de retorno na barra: importou, exportou...
var cuiSelIds = null;       // os Title IDs da colecao escolhida, refeito a cada mudanca
var cuiMapaCache = null;    // Title ID -> jogo, refeito quando uma categoria desce

function cuiSalvar() { try { localStorage.setItem(CUI_KEY, JSON.stringify(CUI)); } catch (e) {} }

function cuiMapa() {
  if (cuiMapaCache && cuiMapaCache.n === GAMES.length) return cuiMapaCache.m;
  var m = new Map();
  GAMES.forEach(function (g) { g._tids.forEach(function (t) { if (!m.has(t)) m.set(t, g); }); });
  cuiMapaCache = { n: GAMES.length, m: m };
  return m;
}

function cuiPorId(id) {
  for (var i = 0; i < CUI.cols.length; i++) if (CUI.cols[i].id === id) return CUI.cols[i];
  return null;
}

/* Os Title IDs de uma colecao. A uniao junta os das origens. */
function cuiIds(c) {
  var s = new Set();
  if (!c) return s;
  if (!c.uniao) { c.ids.forEach(function (t) { s.add(t); }); return s; }
  c.origens.forEach(function (o) {
    var oc = cuiPorId(o);
    if (oc && !oc.uniao) oc.ids.forEach(function (t) { s.add(t); });
  });
  return s;
}

function cuiNaSel(g) {
  if (!cuiSelIds) cuiSelIds = cuiIds(cuiPorId(CUI.sel));
  for (var i = 0; i < g._tids.length; i++) if (cuiSelIds.has(g._tids[i])) return true;
  return false;
}

function cuiNoRascunho(g) {
  for (var i = 0; i < g._tids.length; i++) if (cuiRascunhoSet.has(g._tids[i])) return true;
  return false;
}

/* Colecao de jogos aberta: e onde da para adicionar e remover. A uniao so le. */
function cuiEditavel() {
  var c = cuiPorId(CUI.sel);
  return !!(c && !c.uniao);
}

/* Quantos JOGOS a colecao tem: os do catalogo contam uma vez, por mais Title
   IDs que tenham la dentro, e o que o catalogo nao conhece conta um por ID. */
function cuiContar(c) {
  var m = cuiMapa(), vistos = new Set(), fora = [];
  cuiIds(c).forEach(function (t) {
    var g = m.get(t);
    if (g) vistos.add(g.id); else fora.push(t);
  });
  return { n: vistos.size + fora.length, fora: fora };
}

/* Ordem do console: alfabetica sem diferenciar caixa, ignorando o artigo do
   comeco (SemArtigo, no colecoes.cpp). */
function semArtigo(n) {
  var s = (n || "").toLowerCase(), A = ["the ", "a ", "an ", "o ", "os ", "as ", "um ", "uma "];
  for (var i = 0; i < A.length; i++) if (s.indexOf(A[i]) === 0) return s.slice(A[i].length);
  return s;
}
function cuiOrdenadas() {
  return CUI.cols.slice().sort(function (a, b) {
    var x = semArtigo(a.nome), y = semArtigo(b.nome);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/* O Sanear do app: sem barra nem quebra de linha, e no maximo 28 BYTES, cortando
   por caractere para nao partir um acento no meio. */
function cuiSanear(nome) {
  var cs = Array.from(String(nome || "").replace(/[|\r\n]/g, " ").trim());
  var enc = new TextEncoder();
  while (cs.length && enc.encode(cs.join("")).length > 28) cs.pop();
  return cs.join("").trim();
}

function cuiProximoId(cols) {
  var maior = 0;
  (cols || CUI.cols).forEach(function (c) { if (c.id > maior) maior = c.id; });
  return maior + 1;
}

/* O LimparUnioes do app: uniao so aponta para colecao de jogos que existe, e a
   que fica sem origem e apagada. Devolve os nomes das apagadas. */
function cuiLimparUnioes(cols) {
  var apagadas = [], mexeu = true;
  while (mexeu) {
    mexeu = false;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (!c.uniao) continue;
      var antes = c.origens.length;
      c.origens = c.origens.filter(function (o) {
        var oc = null;
        for (var k = 0; k < cols.length; k++) if (cols[k].id === o) oc = cols[k];
        return oc && !oc.uniao;
      });
      if (c.origens.length !== antes) mexeu = true;
      if (!c.origens.length) { apagadas.push(c.nome); cols.splice(i, 1); mexeu = true; break; }
    }
  }
  return apagadas;
}

/* Le o colecoes.txt. Tolera BOM, CRLF e o formato antigo "nome|TitleIds", que o
   app ainda le e converte. Id repetido: vale o primeiro, como no PorId do app. */
function cuiLer(txt) {
  var cols = [], legado = [];
  String(txt).replace(/^﻿/, "").split(/\r?\n/).forEach(function (l) {
    if (!l || l.charAt(0) === "#" || l.indexOf("|") < 0) return;
    var p = l.split("|");
    var hexa = function (lista) {
      var out = [];
      lista.split(",").forEach(function (t) {
        t = t.trim();
        if (/^[0-9a-f]{1,8}$/i.test(t) && parseInt(t, 16)) {
          t = ("0000000" + t.toUpperCase()).slice(-8);
          if (out.indexOf(t) < 0) out.push(t);
        }
      });
      return out;
    };
    if (/^\d+$/.test(p[0]) && p.length >= 4) {
      var id = +p[0];
      if (!(id > 0) || cols.some(function (c) { return c.id === id; })) return;
      var uniao = p[1] === "uniao", conteudo = p.slice(3).join("|");
      cols.push({ id: id, uniao: uniao, nome: p[2],
        ids: uniao ? [] : hexa(conteudo),
        origens: uniao ? conteudo.split(",").map(Number).filter(function (n) { return n > 0; }) : [] });
    } else if (p.length === 2) {
      legado.push({ nome: p[0], ids: hexa(p[1]) });
    }
  });
  legado.forEach(function (c) {
    cols.push({ id: cuiProximoId(cols), uniao: false, nome: c.nome, ids: c.ids, origens: [] });
  });
  cuiLimparUnioes(cols);
  return cols;
}

function cuiTexto() {
  cuiLimparUnioes(CUI.cols);
  var L = ["# CollectionUI: uma colecao por linha, no formato",
           "#   id, tipo, nome, conteudo -- separados por barra vertical",
           "#   tipo jogos: TitleIds em hexa. tipo uniao: ids de colecao"];
  CUI.cols.forEach(function (c) {
    L.push(c.id + "|" + (c.uniao ? "uniao" : "jogos") + "|" + c.nome + "|" +
      (c.uniao ? c.origens.join(",") : c.ids.join(",")));
  });
  return L.join("\r\n") + "\r\n";
}

function cuiMudou() { cuiSelIds = null; cuiSalvar(); }

function cuiIr(tela) {
  cuiTela = tela;
  document.body.dataset.tela = tela;
  render();
  window.scrollTo(0, 0);
}

function cuiAbrir(id) { CUI.sel = id; cuiAviso = ""; cuiMudou(); cuiIr("jogos"); }

function cuiAdicionar() {
  var c = cuiPorId(CUI.sel);
  if (!c || c.uniao) return;
  cuiRascunho = c.ids.slice(); cuiRascunhoSet = new Set(cuiRascunho);
  cuiAviso = ""; cuiIr("adicionar");
}

function cuiConcluir() {
  var c = cuiPorId(CUI.sel);
  if (c && cuiRascunho) { c.ids = cuiRascunho; cuiMudou(); }
  cuiRascunho = cuiRascunhoSet = null;
  cuiIr("jogos");
}

function cuiCancelar() { cuiRascunho = cuiRascunhoSet = null; cuiIr("jogos"); }

function cuiImportar(txt) {
  var cols = cuiLer(txt);
  if (!cols.length) { alert("Nenhuma coleção nesse arquivo."); return; }
  if (CUI.cols.length && !confirm("Substituir as " + CUI.cols.length + " coleções daqui pelas " +
      cols.length + " do arquivo?")) return;
  CUI.cols = cols;
  CUI.sel = null;
  cuiAviso = cols.length + " coleç" + (cols.length > 1 ? "ões importadas" : "ão importada") + ".";
  cuiMudou(); cuiIr("colecoes");
}

function cuiExportar() {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([cuiTexto()], { type: "text/plain" }));
  a.download = "colecoes.txt";
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  // O app so le o arquivo ao abrir e regrava tudo a cada mudanca: copiado com
  // ele aberto, a copia se perde na primeira edicao feita no console.
  cuiAviso = "colecoes.txt exportado. Copie para a pasta do CollectionUI com o app fechado.";
  cuiSalvar(); cuiPintar();
}

/* Adicionar jogos: o clique marca ou desmarca no rascunho. Entram TODOS os
   Title IDs do jogo (disco e Arcade, regioes): o console mostra o que estiver
   instalado e ignora o resto, entao ele aparece qualquer que seja a versao. */
function cuiAlternar(card) {
  var g = GAMES.find(function (x) { return x.id === card.dataset.id; });
  if (!cuiRascunho || !g || !g._tids.length) return;
  var dentro = cuiNoRascunho(g);
  if (dentro) cuiRascunho = cuiRascunho.filter(function (t) { return g._tids.indexOf(t) < 0; });
  else g._tids.forEach(function (t) { if (!cuiRascunhoSet.has(t)) cuiRascunho.push(t); });
  cuiRascunhoSet = new Set(cuiRascunho);
  card.classList.toggle("nacol", !dentro);
  card.classList.toggle("apagado", dentro);
  cuiPintar();
}

/* Dentro da colecao: o botao do canto tira o jogo, com todos os Title IDs dele. */
function cuiRemover(card) {
  var c = cuiPorId(CUI.sel);
  var g = GAMES.find(function (x) { return x.id === card.dataset.id; });
  if (!c || c.uniao || !g) return;
  c.ids = c.ids.filter(function (t) { return g._tids.indexOf(t) < 0; });
  cuiMudou();
  removeCard(card);
  updateStats(filtered(null));
  cuiPintar();
}

/* A tela inicial: um quadrado por colecao, com a colagem de tres capas da previa
   (grupo30). A busca do topo filtra pelo nome da colecao. */
function cuiTelaColecoes() {
  var m = cuiMapa(), q = F.q;
  var lista = cuiOrdenadas().filter(function (c) { return !q || norm(c.nome).indexOf(q) >= 0; });
  var h = '<div class="cui-grade"><button class="cui-tile cui-tile-nova" id="cui-nova">' +
    "<span>+</span><b>Nova coleção</b></button>";
  lista.forEach(function (c) {
    var capas = [], vistos = new Set();
    cuiIds(c).forEach(function (t) {
      var g = m.get(t);
      if (g && g.image && capas.length < 3 && !vistos.has(g.id)) { vistos.add(g.id); capas.push(g); }
    });
    h += '<button class="cui-tile" data-col="' + c.id + '"><span class="colagem">' +
      capas.map(function (g) {
        return '<img loading="lazy" src="' + esc(g.image) + '" alt="" onerror="this.remove()">';
      }).join("") + '</span><span class="cui-tile-txt"><b>' + esc(c.nome) + "</b><i>( " +
      (c.uniao ? "união" : cuiContar(c).n) + " )</i></span></button>";
  });
  $("#main").innerHTML = h + "</div>";
  cuiPintar();
}

function cuiFormulario(titulo, c) {
  var jogos = cuiOrdenadas().filter(function (x) { return !x.uniao && (!c || x.id !== c.id); });
  var novo = !c;
  return "<h3>" + titulo + "</h3>" +
    '<input type="text" id="cui-nome" maxlength="28" placeholder="Ex.: Para jogar em dois" value="' +
      esc(c ? c.nome : "") + '">' +
    (novo ? '<div class="seg" role="radiogroup" aria-label="Tipo">' +
      '<label><input type="radio" name="cui-tipo" value="jogos" checked> Jogos</label>' +
      '<label><input type="radio" name="cui-tipo" value="uniao"> União de coleções</label></div>' : "") +
    '<div id="cui-origens"' + (novo || !c.uniao ? " hidden" : "") + '><p>Junta os jogos de:</p>' +
    (jogos.length ? jogos.map(function (x) {
      return '<label class="chk"><input type="checkbox" class="cui-origem" value="' + x.id + '"' +
        (c && c.uniao && c.origens.indexOf(x.id) >= 0 ? " checked" : "") + "> " + esc(x.nome) + "</label>";
    }).join("") : "<p>Crie antes uma coleção de jogos.</p>") + "</div>" +
    '<button class="btn primary" id="cui-ok">' + (novo ? "Criar" : "Salvar") + "</button>";
}

function cuiAbrirForm(c) {
  openModal(cuiFormulario(c ? (c.uniao ? "Editar união" : "Renomear coleção") : "Nova coleção", c));
  var nome = $("#cui-nome");
  nome.focus();
  $$("input[name=cui-tipo]").forEach(function (r) {
    r.onchange = function () { $("#cui-origens").hidden = r.value !== "uniao" || !r.checked; };
  });
  var salvar = function () {
    var n = cuiSanear(nome.value);
    if (!n) { nome.focus(); return; }
    var uniao = c ? c.uniao : $("input[name=cui-tipo]:checked").value === "uniao";
    var origens = $$(".cui-origem").filter(function (x) { return x.checked; }).map(function (x) { return +x.value; });
    if (uniao && !origens.length) { alert("Escolha ao menos uma coleção para a união."); return; }
    if (c) { c.nome = n; if (c.uniao) c.origens = origens; }
    else {
      c = { id: cuiProximoId(), uniao: uniao, nome: n, ids: [], origens: uniao ? origens : [] };
      CUI.cols.push(c);
    }
    CUI.sel = c.id; cuiAviso = "";
    cuiMudou(); closeModal(); cuiIr("jogos");
  };
  $("#cui-ok").onclick = salvar;
  nome.onkeydown = function (e) { if (e.key === "Enter") salvar(); };
}

function cuiApagar() {
  var c = cuiPorId(CUI.sel);
  if (!c || !confirm('Apagar a coleção "' + c.nome + '"?')) return;
  CUI.cols = CUI.cols.filter(function (x) { return x !== c; });
  var foram = cuiLimparUnioes(CUI.cols);
  CUI.sel = null;
  cuiAviso = foram.length ? "União apagada junto, por ficar sem origem: " + foram.join(", ") + "." : "";
  cuiMudou(); cuiIr("colecoes");
}

function cuiPintar() {
  if (AREA !== "cui") return;
  var c = cuiPorId(CUI.sel), h = "";
  if (cuiTela === "colecoes") {
    if (!CUI.cols.length)
      h = "<span>Nenhuma coleção ainda. Importe o colecoes.txt do console pelo menu Arquivo, ou crie uma em Nova coleção.</span>";
  } else if (cuiTela === "jogos" && c) {
    var k = cuiContar(c);
    // Trilha no tamanho de titulo: o nivel de cima e link cinza, o atual em destaque.
    h = '<div class="cui-trilha"><button id="cui-voltar">Coleções</button><i>/</i><b>' + esc(c.nome) + "</b></div>" +
      '<span class="cui-conta">' + k.n + " jogo" + (k.n === 1 ? "" : "s") +
      (c.uniao ? " · união de " + esc(c.origens.map(function (o) { return (cuiPorId(o) || {}).nome; }).join(", ")) : "") +
      "</span>" +
      '<div class="cui-acoes">' +
      (c.uniao ? '<button class="btn" id="cui-editar">Editar união</button>'
               : '<button class="btn primary" id="cui-add">Adicionar jogos</button>' +
                 '<button class="btn" id="cui-editar">Renomear</button>') +
      '<button class="btn perigo" id="cui-apagar">Apagar</button></div>' +
      (k.fora.length ? '<div class="cui-nota">' + k.fora.length + " desta coleção não aparece" +
        (k.fora.length > 1 ? "m" : "") + " no catálogo e continua no arquivo: " +
        k.fora.map(function (t) { return "<code>" + t + "</code>"; }).join(" ") + "</div>" : "");
  } else if (cuiTela === "adicionar" && c) {
    var n = 0, m = cuiMapa(), vistos = new Set();
    cuiRascunho.forEach(function (t) { var g = m.get(t); if (g) vistos.add(g.id); else n++; });
    n += vistos.size;
    // Sair pela trilha e o mesmo que Cancelar: o rascunho nao e gravado.
    h = '<div class="cui-trilha"><button id="cui-voltar">Coleções</button><i>/</i>' +
      '<button id="cui-trilha-col">' + esc(c.nome) + "</button><i>/</i><b>Adicionar jogos</b></div>" +
      '<span class="cui-conta">' + n + " marcado" + (n === 1 ? "" : "s") + "</span>" +
      '<div class="cui-acoes"><button class="btn" id="cui-cancelar">Cancelar</button>' +
      '<button class="btn primary" id="cui-concluir">Concluir</button></div>';
  }
  if (cuiAviso) h += '<div class="cui-nota">' + esc(cuiAviso) + "</div>";
  $("#cui-barra").innerHTML = h;
}

/* Na carga a area vem do endereco (#collectionui); render() ainda vai rodar. */
function setAreaInicial() {
  document.body.classList.add("cui");
  document.body.dataset.tela = cuiTela;
  marcarArea("cui");
}

/* O botao do topo diz em que area se esta: fora do menu, era o unico lugar que
   continuava dizendo "Xbox Vault" com o CollectionUI aberto. */
function marcarArea(a) {
  $("#brand-nome").textContent = a === "cui" ? "CollectionUI" : "Xbox Vault";
  $$(".menu-item.area").forEach(function (m) {
    var on = m.dataset.area === a;
    m.classList.toggle("atual", on);
    if (on) m.setAttribute("aria-current", "page"); else m.removeAttribute("aria-current");
  });
}

function setArea(a) {
  AREA = a;
  document.body.classList.toggle("cui", a === "cui");
  history.replaceState(null, "", a === "cui" ? "#collectionui" : location.pathname + location.search);
  marcarArea(a);
  cuiSelIds = null; cuiAviso = ""; cuiRascunho = cuiRascunhoSet = null;
  cuiTela = "colecoes"; document.body.dataset.tela = cuiTela;
  cuiCarregarIndies();
  render();
}

/* Os indies tem Title ID e entram em colecao: na area do CollectionUI o catalogo
   deles desce junto, senao contariam como "fora do catalogo". */
function cuiCarregarIndies() {
  if (AREA === "cui" && pendentes(["xblig"]).length) carregarCatalogos(["xblig"], render);
}

function ligarCui() {
  $$(".menu-item.area").forEach(function (m) {
    m.onclick = function () { if (m.dataset.area !== AREA) setArea(m.dataset.area); };
  });
  $("#main").addEventListener("click", function (e) {
    if (AREA !== "cui" || cuiTela !== "colecoes") return;
    if (e.target.closest("#cui-nova")) return cuiAbrirForm(null);
    var t = e.target.closest("[data-col]");
    if (t) cuiAbrir(+t.dataset.col);
  });
  $("#cui-barra").addEventListener("click", function (e) {
    var id = e.target.id;
    if (id === "cui-voltar") { cuiRascunho = cuiRascunhoSet = null; CUI.sel = null; cuiMudou(); cuiIr("colecoes"); }
    else if (id === "cui-add") cuiAdicionar();
    else if (id === "cui-concluir") cuiConcluir();
    else if (id === "cui-cancelar" || id === "cui-trilha-col") cuiCancelar();
    else if (id === "cui-editar") cuiAbrirForm(cuiPorId(CUI.sel));
    else if (id === "cui-apagar") cuiApagar();
  });
  $("#btn-cui-import").onclick = function () { $("#file-cui").click(); };
  $("#btn-cui-export").onclick = cuiExportar;
  $("#file-cui").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f) f.text().then(cuiImportar);
    e.target.value = "";
  });
}

/* ---------------- boot ---------------- */
if (!GAMES.length) {
  $("#main").innerHTML = '<div class="empty"><b>Catálogo vazio.</b><br>' +
    'Rode <code>python3 tools/bundle.py</code> para gerar <code>data/db.js</code> a partir dos JSONs.</div>';
} else {
  initControls();
  render();
  // Se uma categoria sob demanda ficou ligada de uma visita anterior, o filtro
  // salvo a pede mas nada dispara o carregamento no boot: a lista viria vazia.
  // Na area do CollectionUI os indies descem junto: eles entram em colecao.
  var faltamNoBoot = pendentes(AREA === "cui" ? F.plats.concat(["xblig"]) : F.plats);
  if (faltamNoBoot.length) carregarCatalogos(faltamNoBoot, render);
}
})();
