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
/* As caixas de Jogadores: o MAXIMO de jogadores do jogo no "onde" escolhido, em
   faixas. Pelo maximo, e nao "N ou mais", porque e assim que se separa jogo para
   dois e jogo para quatro; e duas caixas marcadas somam, como em Plataforma. */
var FAIXAS_PL = { "2": [2, 2], "3": [3, 3], "4": [4, 4], "5-8": [5, 8], "9-16": [9, 16], "17+": [17, Infinity] };
function faixaPl(g) {
  var n = maxPlayers(g, F.where);
  for (var k in FAIXAS_PL) if (n >= FAIXAS_PL[k][0] && n <= FAIXAS_PL[k][1]) return k;
  return "";
}

function padraoF() {
  return {
    q: "", own: "all", plats: ["x360", "xbox"], modes: [], flags: [],
    systems: [], relType: "oficial", where: "any", pls: [], yMode: "intervalo", y1: "", y2: "",
    bc: "all", cat: "", mcMin: 0, genres: [], coopt: false, sort: "year-desc"
  };
}
var F = padraoF();
try { Object.assign(F, JSON.parse(localStorage.getItem(FILT_KEY) || "{}")); } catch (e) {}
// Filtro salvo antes da fusao do modo de jogo: o escopo dos jogadores virou o
// "onde", que agora vale para o modo tambem.
if (F.plScope) { if (F.where === "any") F.where = F.plScope; delete F.plScope; }
// "N ou mais jogadores" virou caixas por faixa: o filtro salvo vira as faixas
// que davam o mesmo resultado.
if (F.plMin) {
  F.pls = Object.keys(FAIXAS_PL).filter(function (k) { return FAIXAS_PL[k][0] >= F.plMin; });
}
delete F.plMin;
if (!Array.isArray(F.pls)) F.pls = [];
// As abas "No console" e "Fora da colecao" so existem ao adicionar jogos ao
// CollectionUI.
if (F.own === "console" || F.own === "fora") F.own = "all";

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
  var aCon = AREA === "cui" && cuiTela === "adicionar" && (F.own === "console" || F.own === "fora");
  if (aCon && !g._con) return false;
  // "Fora da colecao": o do console que nao estava nela quando a aba foi aberta.
  // Nao e o rascunho ao vivo, senao o card sumiria no clique que o marca.
  if (aCon && F.own === "fora" && (!g._tids.length || cuiNoFora(g))) return false;
  if (skip !== "plat" && F.plats.indexOf(g.platform) < 0) return false;
  if (!buscaOk(g)) return false;
  // Item do console que o catalogo nao conhece (ROM, homebrew, jogo que falta
  // la) nao tem genero, nota nem modo: so a busca e a plataforma valem, e ele so
  // aparece em "No console" e em "Todos", que nao dependem de marcacao.
  if (g._con && !g._cat) return aCon || F.own === "all";

  // Ao adicionar jogos ao CollectionUI as abas do catalogo (tenho, wishlist,
  // escondidos...) valem igual: e o recorte mais util para montar colecao. A
  // marcacao do item do console e a do jogo do catalogo que ele e.
  if (!aCon && (AREA !== "cui" || cuiTela === "adicionar")) {
  var mid = g._cat ? g._cat.id : g.id;
  // "não quero" tira o jogo de todas as listas, menos da lista de escondidos
  if (F.own === "hide") { if (!escondidos.has(mid)) return false; }
  else if (escondidos.has(mid)) return false;
  if (F.own === "yes" && !owned.has(mid)) return false;
  if (F.own === "no" && owned.has(mid)) return false;
  if (F.own === "wish" && !wishlist.has(mid)) return false;
  // o que ainda não passou por nenhuma decisão: nem tenho, nem quero, nem
  // escondi (escondido já saiu acima). "Só os que faltam" não serve aqui
  // porque a wishlist também falta, e ela já foi decidida.
  if (F.own === "none" && (owned.has(mid) || wishlist.has(mid))) return false;
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
  if (skip !== "pl" && F.pls.length && F.pls.indexOf(faixaPl(g)) < 0) return false;
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
  var out = [], U = universo();
  if (F.q) {
    F.qc = F.q.replace(/[^a-z0-9]/g, "");
    F.qFrouxa = false;
    var exato = 0;
    for (var k = 0; k < U.length && exato < 1; k++) {
      if (U[k]._s.indexOf(F.q) >= 0) exato++;
    }
    F.qFrouxa = exato === 0 && F.qc.length >= 5;   // só se o literal não achou nada
  }
  for (var i = 0; i < U.length; i++) if (match(U[i], skip)) out.push(U[i]);
  return out;
}

/* O que a lista percorre. No catalogo, o catalogo. Na area do CollectionUI com o
   inventario do console importado, cada item do console vira um card (dois discos
   do mesmo jogo sao dois cards, como no console) e o catalogo entra com o que NAO
   esta no console, para planejar. */
function universo() {
  var con = AREA === "cui" ? cuiConsole() : null;
  return con ? con.universo : GAMES;
}

/* Acha o jogo de um card pelo data-id, no que a lista percorre. */
function jogoDoCard(card) {
  var id = card.dataset.id, U = universo();
  for (var i = 0; i < U.length; i++) if (U[i].id === id) return U[i];
  return null;
}

/* A ordem em vigor. Dentro de uma colecao do CollectionUI e a do console:
   alfabetica, sem o artigo do comeco e sem diferenciar caixa (biblioteca.cpp).
   Ao adicionar jogos vale o "Ordenar por" dos filtros, como no catalogo. */
function ordemAtual() {
  return AREA === "cui" && cuiTela === "jogos" ? "console" : F.sort;
}

function sortList(list) {
  var s = ordemAtual();
  return list.sort(function (a, b) {
    if (s === "console") {
      var x = semArtigo(a.title), y = semArtigo(b.title);
      return x < y ? -1 : x > y ? 1 : 0;
    }
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

/* No maximo quatro etiquetas, na ordem do que mais pesa para escolher:
   1. a plataforma, sempre;
   2. o aviso que muda a decisao: VAZADO, ou a retrocompatibilidade do Xbox
      original;
   3. jogar junto no mesmo console, numa etiqueta so: co-op local, senao
      versus local, senao multiplayer local, com o numero de jogadores;
   4. online, com o numero de jogadores (co-op online quando o co-op e so la).
   Fora do card, e so na ficha: 1P (quase todo jogo tem), VS solto, XBLA,
   KINECT e categoria. Eram ate oito pilulas, e o corte de uma linha escondia
   justamente as do fim. */
function tagsHtml(g) {
  var t = g._t, h = [];
  var tag = function (txt, cls) { h.push('<span class="tag' + (cls ? " " + cls : "") + '">' + txt + "</span>"); };
  var nP = function (n) { return n ? " " + n + "P" : ""; };

  if (g._con && g._con.rom) tag("ROM", "emu");
  else if (g.platform === "x360") tag("360", "plat");
  else if (g.platform === "xblig") tag("INDIE", "plat");
  else if (g.platform === "emu") tag(esc(g.system), "emu");
  else if (g.platform === "xbox") tag("XBOX OG", "plat");
  else tag("HB", "plat");

  // CollectionUI com o inventario do console: se o jogo esta ou nao la
  var onde = AREA === "cui" ? cuiOnde(g) : "";
  if (onde === "con") tag("NO CONSOLE", "con");
  else if (onde === "fora") tag("FORA DO CONSOLE", "fora");
  // O que so o console conhece nao tem mais nada a dizer em etiqueta.
  if (g._con && !g._cat) return h.join("");

  if (g.releaseType === "Vazado") {
    h.push('<span class="tag vaz" title="Cancelado antes de sair, mas ficou pronto e ' +
      'a build vazou, então dá para jogar">VAZADO</span>');
  } else if (g.platform === "xbox") {
    if (g.bc360 && g.bc360.compatible) tag("RETRO ✓", "bc");
    else tag("RETRO ✗", "nobc");
  }

  /* Nos 3.344 jogos de source "xblig-default" o modo nao e fraco, e inventado:
     o coletor procura palavra de multiplayer no TITULO e, nao achando nenhuma,
     grava singlePlayer=true com todo o resto false. Etiqueta ali seria o
     catalogo afirmando 3.344 vezes uma coisa que ninguem apurou, e aviso no
     card, numa grade de dezenas, ninguem le. O card entao nao diz nada sobre
     modo, e quem abrir a ficha encontra a frase inteira. */
  if (t.source === "xblig-default") return h.join("");

  if (t.coopLocal) tag("CO-OP LOCAL" + nP(t.coopLocalMax || t.maxPlayersLocal));
  else if (t.versusLocal) tag("VS LOCAL" + nP(t.maxPlayersLocal));
  else if (t.multiplayerLocal) tag("LOCAL" + nP(t.maxPlayersLocal));

  if (t.multiplayerOnline) tag("ONLINE" + nP(t.maxPlayersOnline));
  else if (t.coopOnline) tag("CO-OP ONLINE" + nP(t.coopOnlineMax));

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
var ICO_INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.1"/></svg>';
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
  /* O card leva o que ajuda a escolher de relance: nome; a nota ao lado do
     genero, so o numero (o desenho ja separa critica de jogador, e o rotulo
     completo fica no title); o comeco da descricao, no meio do card; e as
     etiquetas. Estudio e ano ficam na ficha. O homebrew nao tem genero, e a
     categoria faz esse papel. */
  var genero = esc(g.platform === "homebrew" ? g.category || "" : g.genre || "");
  var desc = (g.description || "").trim();
  var junto = "";
  if (g._con) {
    // So o console conhece: o que se sabe e de onde ele vem.
    if (!g._cat) {
      genero = g._con.rom ? "ROM · " + esc(g._emu) : "Só no console";
      desc = cuiPasta(g._con);
    }
    // Title ID que outro item do console tambem usa: a colecao guarda Title ID,
    // entao os dois entram e saem juntos. E do desenho do app, nao e erro.
    if (g._junto) junto = '<div class="cui-junto">Mesmo Title ID de ' + g._junto.map(function (x) {
      return "<b>" + esc(cuiPasta(x._con)) + "</b>"; }).join(", ") + ": entram juntos na coleção.</div>";
  }
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
    // O clique no card marca, entao a ficha ganha um botao proprio. O que so o
    // console conhece nao tem ficha, e fica sem ele.
    marcas = g._con && !g._cat ? "" : '<div class="marks marks-card"><button class="info-btn" title="Ver ficha" ' +
      'aria-label="Ver ficha">' + ICO_INFO + "</button></div>";
  } else {
    estado = cuiOnde(g) === "fora" ? " fora" : "";
    marcas = cuiEditavel() ? '<div class="marks marks-card"><button class="rem-btn" title="Remover da coleção" ' +
      'aria-label="Remover da coleção">' + ICO_REM + "</button></div>" : "";
  }
  return '<article class="card' + estado + '" data-id="' + esc(g.id) + '"' +
    (AREA === "cui" && !g._tids.length ? ' title="' + (g._con
      ? "Title ID 00000000 (homebrew sem EXECUTION_INFO): não dá para pôr em coleção"
      : "Sem Title ID: não dá para pôr em coleção do CollectionUI") + '"' : "") + ">" +
    marcas +
    '<div class="thumb">' + img + "</div>" +
    '<div class="body"><h3>' + link + "</h3>" +
    (mc || genero ? '<div class="linha">' + mc + (genero ? '<span class="sub">' + genero + "</span>" : "") + "</div>" : "") +
    (desc ? '<div class="desc">' + esc(desc) + "</div>" : "") + junto +
    '<div class="tags">' + tagsHtml(g) + "</div></div></article>";
}

function buildQueue(list) {
  var groups = [], cur = null;
  // Agrupar por ano só faz sentido quando a ordenação É por ano. Ordenando por
  // título ou nota, cada seção viraria um jogo só.
  var ordem = ordemAtual();
  if (ordem !== "year-desc" && ordem !== "year-asc") {
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
  var fp = filtered("pl"), np = {};
  fp.forEach(function (g) { var k = faixaPl(g); if (k) np[k] = (np[k] || 0) + 1; });
  $$("[data-cnt^='pl-']").forEach(function (el) { el.textContent = np[el.dataset.cnt.slice(3)] || 0; });
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
  $("#f-sort").value = F.sort;
  $$(".f-pl").forEach(function (c) { c.checked = F.pls.indexOf(c.value) >= 0; });
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
    else if (t.classList.contains("f-pl")) F.pls = pick(".f-pl");
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
    else if (t.id === "f-mc") F.mcMin = +t.value;
    else return;
    onChange();
  });

  $$(".vista").forEach(function (b) {
    b.onclick = function () {
      F.own = b.dataset.own;
      if (F.own === "fora" && cuiRascunho) cuiForaSet = new Set(cuiRascunho);
      marcarVista(); onChange();
    };
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
      if (cuiTela === "adicionar" && !e.target.closest(".info-btn")) { cuiAlternar(card); return; }   // marca no rascunho
      if (e.target.closest(".rem-btn")) { cuiRemover(card); return; }
      // dentro da colecao o clique abre a ficha, como no catalogo
    }
    var btn = e.target.closest(".wish-btn, .hide-btn");
    if (btn) {                                   // botoes do canto marcam direto
      toggleMark(card.dataset.id,
        btn.classList.contains("wish-btn") ? "wish" : "hide", card);
      return;
    }
    // O item do console abre a ficha do jogo do catalogo que ele e; o que so o
    // console conhece nao tem ficha.
    var g = jogoDoCard(card);
    if (g && g._con) g = g._cat;
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
   em hexa (8 digitos, maiusculos); tipos uniao e intersecao guardam ids de
   colecao. A linha de tipo que o Vault nao conhece fica em CUI.extras, como
   chegou, e volta igual no export. */
var AREA = location.hash === "#collectionui" ? "cui" : "cat";
var CUI_KEY = "xbx.cui.v1";
var CUI = { cols: [], sel: null, extras: [] };
try { Object.assign(CUI, JSON.parse(localStorage.getItem(CUI_KEY) || "{}")); } catch (e) {}
delete CUI.vista;           // do seletor Todos/Que tenho/Da colecao, que saiu
if (!Array.isArray(CUI.extras)) CUI.extras = [];
// O bool uniao virou tipo: jogos, uniao ou intersecao.
CUI.cols.forEach(function (c) { if (!c.tipo) c.tipo = c.uniao ? "uniao" : "jogos"; delete c.uniao; });
var cuiTela = "colecoes";   // colecoes | jogos | adicionar
// Ao adicionar, a marcacao vai numa COPIA dos Title IDs: e o que da sentido ao
// Cancelar, como o rascunho da previa.
var cuiRascunho = null, cuiRascunhoSet = null;
// A colecao como estava ao abrir a aba "Fora da colecao" (Title IDs).
var cuiForaSet = null;
var cuiAviso = "";          // uma linha de retorno na barra: importou, exportou...
var cuiSelIds = null;       // os Title IDs da colecao escolhida, refeito a cada mudanca
var cuiMapaCache = null;    // Title ID -> jogo, refeito quando uma categoria desce
// A aba do catalogo de antes de entrar em "Adicionar jogos", que abre em "No
// console": ao sair, o catalogo volta para a aba em que estava.
var cuiOwnAntes = null;

/* O inventario do console, que vem no vault.txt: um item por linha JOGO ou ROM.
   Fica no navegador junto com a hora em que chegou, que o arquivo nao traz data.
   { t: epoch ms, itens: [{ k, rom, tid, ct, emu, nome, arq }] }; k e a chave
   unica: o ContentItemId do jogo, ou o id da ROM. Title ID NAO e unico. */
var CUI_INV_KEY = "xbx.cui.inv.v1";
var CUI_INV = null;
try { CUI_INV = JSON.parse(localStorage.getItem(CUI_INV_KEY) || "null"); } catch (e) {}
if (CUI_INV && !Array.isArray(CUI_INV.itens)) CUI_INV = null;
var cuiConCache = null;

function cuiSalvar() { try { localStorage.setItem(CUI_KEY, JSON.stringify(CUI)); } catch (e) {} }

function cuiMapa() {
  if (cuiMapaCache && cuiMapaCache.n === GAMES.length) return cuiMapaCache.m;
  var m = new Map();
  GAMES.forEach(function (g) { g._tids.forEach(function (t) { if (!m.has(t)) m.set(t, g); }); });
  cuiMapaCache = { n: GAMES.length, m: m };
  return m;
}

/* Os cards do console, refeitos quando o inventario muda ou uma categoria do
   catalogo desce. O item que casa com o catalogo HERDA o jogo de la (capa, nota,
   etiquetas, filtros) e so troca o id e os Title IDs; o que nao casa vira um card
   simples com o nome do console. Sobre este console o export e a fonte: nada do
   que veio nele fica de fora por o catalogo nao conhecer.
   - porTid: Title ID -> cards do console que ele acende (inclui os Title IDs
     alternativos do jogo do catalogo, que o Adicionar grava junto).
   - cat: ids do catalogo que estao no console, e que saem do universo para nao
     aparecerem duas vezes. */
function cuiConsole() {
  if (!CUI_INV) return null;
  if (cuiConCache && cuiConCache.n === GAMES.length && cuiConCache.inv === CUI_INV) return cuiConCache;
  var m = cuiMapa(), lista = [], porTid = new Map(), cat = new Set(), emus = {}, nomeEmu = {};
  CUI_INV.itens.forEach(function (it) { if (it.rom) emus[it.emu] = 1; });
  CUI_INV.itens.forEach(function (it) { if (!it.rom && emus[it.tid] && !nomeEmu[it.tid]) nomeEmu[it.tid] = it.nome; });
  CUI_INV.itens.forEach(function (it) {
    // Title ID zero e xex de homebrew sem EXECUTION_INFO: nao casa com nada.
    var zero = it.tid === "00000000";
    var c = zero || it.rom ? null : m.get(it.tid) || null;
    var g = c ? Object.create(c) : {};
    g.id = "con-" + it.k; g._con = it; g._cat = c;
    if (c) {
      g._tids = [it.tid].concat(c._tids.filter(function (t) { return t !== it.tid; }));
      g._s = c._s + " " + norm(it.nome);
      cat.add(c.id);
    } else {
      g.title = it.nome;
      g.platform = it.rom ? "emu" : zero || emus[it.tid] ? "homebrew"
        : it.ct === "00005000" ? "xbox" : it.ct === "00000002" ? "xblig" : "x360";
      g._tids = zero ? [] : [it.tid];
      g._s = norm(it.nome);
      g._t = {}; g.flags = {}; g.year = null;
      if (it.rom) g._emu = nomeEmu[it.emu] || it.emu;
    }
    g._c = g._s.replace(/[^a-z0-9]/g, "");
    g._tids.forEach(function (t) {
      if (!porTid.has(t)) porTid.set(t, []);
      porTid.get(t).push(g);
    });
    lista.push(g);
  });
  // Mesmo Title ID em mais de um item: cada card sabe quem vem junto.
  lista.forEach(function (g) {
    if (!g._tids.length) return;
    var j = porTid.get(g._con.tid).filter(function (x) { return x !== g && x._con.tid === g._con.tid; });
    if (j.length) g._junto = j;
  });
  cuiConCache = { n: GAMES.length, inv: CUI_INV, lista: lista, porTid: porTid, cat: cat,
    universo: lista.concat(GAMES.filter(function (g) { return !cat.has(g.id); })) };
  return cuiConCache;
}

/* "con" para o card do console, "fora" para o do catalogo, e "" quando nao ha
   inventario ou a etiqueta so repetiria a aba. Dentro da colecao so o que esta
   fora ganha marca; em "No console" nada ganha. */
function cuiOnde(g) {
  if (!CUI_INV) return "";
  if (cuiTela === "jogos") return g._con ? "" : "fora";
  if (cuiTela === "adicionar" && F.own !== "console" && F.own !== "fora" && g._con) return "con";
  return "";
}

/* Onde o item mora no console, para distinguir dois com o mesmo nome: a pasta,
   sem o nome do executavel e sem a pasta de cima (JOGOS, XBLA...). ROM e o nome
   do arquivo. */
function cuiPasta(it) {
  if (it.rom) return it.arq;
  var p = it.arq.split("\\").filter(Boolean);
  if (p.length > 1 && /\.[a-z0-9]{2,4}$/i.test(p[p.length - 1])) p.pop();
  if (p.length > 1) p.shift();
  return p.join("\\") || it.nome;
}

/* Os cards que um Title ID da colecao acende: os do console, senao o do catalogo. */
function cuiDonos(t) {
  var con = cuiConsole();
  if (con && con.porTid.has(t)) return con.porTid.get(t);
  var g = cuiMapa().get(t);
  return g ? [g] : [];
}

function cuiPorId(id) {
  for (var i = 0; i < CUI.cols.length; i++) if (CUI.cols[i].id === id) return CUI.cols[i];
  return null;
}

/* A escada do console: jogos < uniao < intersecao. A uniao so tem origem de
   jogos; a intersecao, de jogos ou uniao. Nenhum tipo aceita o proprio, entao
   resolver desce no maximo dois degraus, sem ciclo, nem em arquivo editado a mao. */
function cuiComposta(c) { return !!c && c.tipo !== "jogos"; }
function cuiPodeSerOrigem(o, alvo) {
  if (!o) return false;
  if (alvo === "uniao") return o.tipo === "jogos";
  if (alvo === "intersecao") return o.tipo === "jogos" || o.tipo === "uniao";
  return false;
}

/* Os Title IDs de uma colecao, como o Tem() do console.
   - Uniao: o que esta em qualquer origem; origem morta so encolhe, e e ignorada.
   - Intersecao: o que esta em todas. Origem morta derruba tudo, em vez de ser
     ignorada: ignorar faria "co-op nao zerado" virar "co-op", maior que o certo
     e com cara de certo. E sem origem nenhuma e vazia, nao o catalogo inteiro. */
function cuiIds(c) {
  var s = new Set();
  if (!c) return s;
  if (c.tipo === "jogos") { c.ids.forEach(function (t) { s.add(t); }); return s; }
  var os = c.origens.map(cuiPorId);
  if (c.tipo === "uniao") {
    os.forEach(function (o) {
      if (cuiPodeSerOrigem(o, "uniao")) cuiIds(o).forEach(function (t) { s.add(t); });
    });
    return s;
  }
  if (c.tipo === "intersecao" && os.length &&
      os.every(function (o) { return cuiPodeSerOrigem(o, "intersecao"); })) {
    var cada = os.map(cuiIds);
    cada[0].forEach(function (t) {
      if (cada.every(function (x) { return x.has(t); })) s.add(t);
    });
  }
  return s;
}

/* Intersecao com origem que nao resolve: fica vazia ate alguem escolher de novo. */
function cuiOrigemMorta(c) {
  return !!c && c.tipo === "intersecao" &&
    !c.origens.every(function (o) { return cuiPodeSerOrigem(cuiPorId(o), "intersecao"); });
}

function cuiNaSel(g) {
  if (!cuiSelIds) cuiSelIds = cuiIds(cuiPorId(CUI.sel));
  for (var i = 0; i < g._tids.length; i++) if (cuiSelIds.has(g._tids[i])) return true;
  return false;
}

function cuiNoFora(g) {
  for (var i = 0; i < g._tids.length; i++) if (cuiForaSet.has(g._tids[i])) return true;
  return false;
}

function cuiNoRascunho(g) {
  for (var i = 0; i < g._tids.length; i++) if (cuiRascunhoSet.has(g._tids[i])) return true;
  return false;
}

/* Colecao de jogos aberta: e onde da para adicionar e remover. A composta so le. */
function cuiEditavel() {
  var c = cuiPorId(CUI.sel);
  return !!(c && c.tipo === "jogos");
}

/* Quantos JOGOS a colecao tem: os do catalogo contam uma vez, por mais Title
   IDs que tenham la dentro, e o que o catalogo nao conhece conta um por ID. */
function cuiContar(c) { return cuiContarIds(cuiIds(c)); }
function cuiContarIds(ids) {
  var vistos = new Set(), fora = [];
  ids.forEach(function (t) {
    var d = cuiDonos(t);
    if (d.length) d.forEach(function (g) { vistos.add(g.id); }); else fora.push(t);
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
   por caractere para nao partir um acento no meio. Como o do app, nao mexe no
   espaco das pontas. Vale para o nome digitado, para o importado e para o
   exportado: nome de arquivo editado a mao nao atravessa o Vault fora da regra. */
function cuiSanearArquivo(nome) {
  var cs = Array.from(String(nome || "").replace(/[|\r\n]/g, " "));
  var enc = new TextEncoder();
  while (cs.length && enc.encode(cs.join("")).length > 28) cs.pop();
  return cs.join("");
}
/* No formulario o espaco das pontas sai antes, que o teclado deixa sobrar. */
function cuiSanear(nome) { return cuiSanearArquivo(String(nome || "").trim()).trim(); }

/* Id de colecao e SORTEADO, nao sequencial, como no ProximoId do console. O
   arquivo tem dois editores, o app e o Vault, e os dois criavam id como "maior +
   1": apagar a de maior id devolvia aquele numero ao estoque, e criar uma de cada
   lado antes de sincronizar dava o MESMO id a colecoes diferentes, e uma uniao
   passava a apontar para a errada, em silencio. Sortear em 31 bits resolve sem os
   dois lados combinarem nada. Os ids pequenos que ja existem continuam valendo.
   O id de linha guardada como chegou (tipo desconhecido) tambem esta ocupado. */
function cuiProximoId(cols, extras) {
  var usados = {};
  (cols || CUI.cols).forEach(function (c) { usados[c.id] = 1; });
  (extras || CUI.extras).forEach(function (l) { usados[cuiAtoi(l)] = 1; });
  for (var t = 0; t < 64; t++) {
    var id = 1 + Math.floor(Math.random() * 2147483647);   // 1 a 2147483647
    if (!usados[id]) return id;
  }
  // 64 sorteios sem achar um livre nao acontece com dezenas de colecoes; se
  // acontecer, o sequencial e melhor que devolver id repetido.
  var maior = 0;
  (cols || CUI.cols).forEach(function (c) { if (c.id > maior) maior = c.id; });
  return maior + 1;
}

/* O LimparCompostas do app: a uniao perde a origem que nao resolve, e a
   composta que fica sem origem nenhuma e apagada. A intersecao NAO e podada:
   tirar um fator ALARGA o resultado, entao a origem morta fica, a intersecao
   fica vazia e isso aparece, em vez de um conjunto errado passar despercebido.
   Repete ate parar: apagar uma uniao pode esvaziar a intersecao que a usava.
   Devolve os nomes das apagadas. */
function cuiLimparCompostas(cols) {
  var apagadas = [], mexeu = true;
  while (mexeu) {
    mexeu = false;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c.tipo === "jogos") continue;
      var antes = c.origens.length;
      if (c.tipo === "uniao") c.origens = c.origens.filter(function (o) {
        var oc = null;
        for (var k = 0; k < cols.length; k++) if (cols[k].id === o) { oc = cols[k]; break; }
        return cuiPodeSerOrigem(oc, "uniao");
      });
      if (c.origens.length !== antes) mexeu = true;
      if (!c.origens.length) { apagadas.push(c.nome); cols.splice(i, 1); mexeu = true; break; }
    }
  }
  return apagadas;
}

/* strtoul(p, NULL, 16) e atoi(p) do C++: espaco na frente, sinal, e o que
   houver de numero no comeco vale ("4D53082Dx" e 4D53082D); sem numero, 0. */
function cuiStrtoulHex(t) {
  var m = /^[ \t\n\v\f\r]*([+-]?)(?:0[xX])?([0-9a-fA-F]*)/.exec(t);
  var d = m[2].replace(/^0+/, "");
  if (!d) return 0;
  var v = d.length > 8 ? 0xFFFFFFFF : parseInt(d, 16);   // estouro: ULONG_MAX
  if (m[1] === "-" && d.length <= 8) v = (0x100000000 - v) % 0x100000000;
  return v >>> 0;
}
function cuiAtoi(t) {
  var m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(t);
  return m ? parseInt(m[1], 10) : 0;
}

/* Le o colecoes.txt como o Carregar do app/src/colecoes.cpp, decisao por decisao,
   porque o Vault regrava o arquivo inteiro a partir do que leu: o que a leitura
   descarta some do console no proximo export, sem aviso.
   - O que separa colecao de comentario e a BARRA, nao o "#": uma colecao
     chamada "#1 favoritos" e valida. O cabecalho nao tem barra.
   - Formato novo quando abre com numero, barra, e tem a SEGUNDA barra ("1942|
     FFED0707" e uma colecao antiga chamada 1942: o antigo nunca tem duas).
   - Tipo que o Vault nao conhece: a linha nao e lida, e guardada inteira em
     cols.extras e volta igual no export. Vao existir tipos novos; descartar a
     linha a apagaria do console na primeira regravacao.
   - Composta cortada no meio (sem o conteudo) tambem e guardada como chegou:
     sem origem ela seria apagada.
   - Colecao de jogos cortada no meio ("9|jogos|Nome"): fica, sem conteudo.
   - Formato antigo: nome ate a primeira barra, Title IDs no resto.
   - Id 0 e as antigas ganham id sorteado depois, na ordem do arquivo.
   - Id repetido: a SEGUNDA ganha id sorteado e isso vira aviso (cols.avisos). E a
     primeira que o app ja devolvia ao procurar pelo id, entao as unioes que
     existem continuam apontando para onde apontavam.
   - Id igual ao de uma linha guardada: a colecao viva ganha id sorteado, e as
     origens que apontavam para ele vao junto (so a viva podia ser a origem).
   - Title ID repetido fica, e 0 sai; origem de composta em decimal, so > 0.
   A unica tolerancia a mais e o BOM no comeco do arquivo, que o app nao espera. */
var CUI_TIPOS = ["jogos", "uniao", "intersecao"];
function cuiLer(txt) {
  var cols = [], extras = [];
  String(txt).replace(/^\uFEFF/, "").split("\n").forEach(function (l) {
    l = l.replace(/[\r\n]+$/, "");
    var barra = l.indexOf("|");
    if (barra < 0) return;
    var b2 = l.indexOf("|", barra + 1);
    var tipo = b2 < 0 ? "" : l.slice(barra + 1, b2);
    var novo = barra > 0 && /^\d+$/.test(l.slice(0, barra)) && b2 > 0;
    var b3 = novo ? l.indexOf("|", b2 + 1) : -1;
    if (novo && (CUI_TIPOS.indexOf(tipo) < 0 || (tipo !== "jogos" && b3 < 0))) { extras.push(l); return; }
    var c = { id: 0, tipo: "jogos", nome: "", ids: [], origens: [] }, conteudo = "";
    if (novo) {
      c.id = cuiAtoi(l.slice(0, barra));
      c.tipo = tipo;
      if (b3 < 0) c.nome = l.slice(b2 + 1);
      else { c.nome = l.slice(b2 + 1, b3); conteudo = l.slice(b3 + 1); }
    } else {
      c.nome = l.slice(0, barra);
      conteudo = l.slice(barra + 1);
    }
    c.nome = cuiSanearArquivo(c.nome);
    conteudo.split(",").forEach(function (t) {
      if (!t) return;                              // o strtok pula token vazio
      if (c.tipo !== "jogos") { var o = cuiAtoi(t); if (o > 0) c.origens.push(o); }
      else {
        var v = cuiStrtoulHex(t);
        if (v) c.ids.push(("0000000" + v.toString(16).toUpperCase()).slice(-8));
      }
    });
    cols.push(c);
  });
  cols.forEach(function (c) { if (c.id === 0) c.id = cuiProximoId(cols, extras); });
  cols.avisos = [];
  for (var i = 0; i < cols.length; i++) {
    for (var k = 0; k < i; k++) {
      if (cols[k].id !== cols[i].id) continue;
      var novo = cuiProximoId(cols, extras);
      cols.avisos.push('"' + cols[i].nome + '" tinha o id ' + cols[i].id + " repetido e virou " + novo);
      cols[i].id = novo;
      break;
    }
  }
  var guardados = {};
  extras.forEach(function (l) { guardados[cuiAtoi(l)] = 1; });
  cols.forEach(function (c) {
    if (!guardados[c.id]) return;
    var era = c.id, novo = cuiProximoId(cols, extras);
    cols.forEach(function (u) {
      if (u.tipo !== "jogos") u.origens = u.origens.map(function (o) { return o === era ? novo : o; });
    });
    c.id = novo;
  });
  if (extras.length) cols.avisos.push(extras.length + (extras.length > 1 ? " linhas" : " linha") +
    " de tipo que o Vault não conhece, guardada" + (extras.length > 1 ? "s" : "") + " como veio");
  cuiLimparCompostas(cols);
  cols.extras = extras;
  return cols;
}

function cuiTexto() {
  cuiLimparCompostas(CUI.cols);
  var L = ["# CollectionUI: uma colecao por linha, no formato",
           "#   id, tipo, nome, conteudo -- separados por barra vertical",
           "#   tipo jogos: TitleIds em hexa",
           "#   tipo uniao e intersecao: ids de colecao, em decimal"];
  CUI.cols.forEach(function (c) {
    L.push(c.id + "|" + c.tipo + "|" + cuiSanearArquivo(c.nome) + "|" +
      (c.tipo !== "jogos" ? c.origens.join(",") : c.ids.join(",")));
  });
  return L.concat(CUI.extras).join("\r\n") + "\r\n";
}

function cuiMudou() { cuiSelIds = null; cuiSalvar(); }

function cuiIr(tela) {
  cuiFecharAviso();
  cuiTela = tela;
  document.body.dataset.tela = tela;
  render();
  window.scrollTo(0, 0);
}

function cuiAbrir(id) { CUI.sel = id; cuiAviso = ""; cuiMudou(); cuiIr("jogos"); }

function cuiAdicionar() {
  var c = cuiPorId(CUI.sel);
  if (!c || c.tipo !== "jogos") return;
  cuiRascunho = c.ids.slice(); cuiRascunhoSet = new Set(cuiRascunho); cuiForaSet = new Set(cuiRascunho);
  // Com o inventario, o fluxo principal e montar com o que o console tem; as
  // outras abas continuam ali para olhar o catalogo.
  if (CUI_INV) { cuiOwnAntes = F.own; F.own = "console"; marcarVista(); }
  cuiAviso = ""; cuiIr("adicionar");
}

/* Saiu do Adicionar: o rascunho vai embora e o catalogo volta a sua aba. */
function cuiSairAdicionar() {
  cuiRascunho = cuiRascunhoSet = cuiForaSet = null;
  if (cuiOwnAntes !== null) { F.own = cuiOwnAntes; cuiOwnAntes = null; marcarVista(); }
}

function cuiConcluir() {
  var c = cuiPorId(CUI.sel);
  if (c && cuiRascunho) { c.ids = cuiRascunho; cuiMudou(); }
  cuiSairAdicionar();
  cuiIr("jogos");
}

function cuiCancelar() { cuiSairAdicionar(); cuiIr("jogos"); }

/* O id da ROM, como o console calcula: FNV-1a 32 semeado com o Title ID do
   emulador, sobre os BYTES CRUS do nome do arquivo, com a minuscula do console
   (A-Z e o Latin-1 maiusculo, menos o x de multiplicacao), e nao a do JS. */
function cuiMinuscula(b) {
  if (b >= 0x41 && b <= 0x5A) return b + 32;
  if (b >= 0xC0 && b <= 0xDE && b !== 0xD7) return b + 32;
  return b;
}
function cuiIdDaRom(emulador, bytes) {
  var h = (2166136261 ^ emulador) >>> 0;
  for (var i = 0; i < bytes.length; i++) {
    h = (h ^ cuiMinuscula(bytes[i])) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/* Le o vault.txt, o export do CollectionUI para o Vault: o inventario do console
   e as colecoes num arquivo so.
   - Linha de dado comeca com JOGO|, ROM| ou COLECAO|; todo o resto e comentario
     (o proprio cabecalho tem linha com barra).
   - JOGO e ROM tem 7 campos: tipo|id|contentType|emulador|item|nome|arquivo.
     COLECAO e a linha do colecoes.txt com o prefixo, e vai pelo cuiLer.
   - UTF-8. O hash da ROM e sobre os bytes crus do campo arquivo, entao a linha
     e partida em bytes antes de virar texto.
   - O rodape "# total: N jogos, N ROMs, N colecoes" e obrigatorio e tem de bater:
     e o que separa arquivo inteiro de arquivo cortado. Sem ele nada e trocado.
   Devolve { cols, itens, avisos }, ou lanca Error com a mensagem para a pessoa. */
function cuiLerVault(buf) {
  var b = new Uint8Array(buf), dec = new TextDecoder("utf-8");
  var hex = /^[0-9A-Fa-f]{8}$/, ini = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF ? 3 : 0;
  var itens = [], colLinhas = [], avisos = [], chaves = {}, n = { JOGO: 0, ROM: 0, COLECAO: 0 };
  var rodape = null, ruins = 0, roms = 0;
  for (var i = ini; i <= b.length; i++) {
    if (i < b.length && b[i] !== 0x0A) continue;
    var fim = i;
    while (fim > ini && b[fim - 1] === 0x0D) fim--;
    var l = b.subarray(ini, fim);
    ini = i + 1;
    var s = dec.decode(l), tipo = s.slice(0, s.indexOf("|"));
    if (tipo === "COLECAO") { n.COLECAO++; colLinhas.push(s.slice(8)); continue; }
    if (tipo !== "JOGO" && tipo !== "ROM") {
      var r = /^# total: (\d+) jogos, (\d+) ROMs, (\d+) colecoes\s*$/.exec(s);
      if (r) rodape = { JOGO: +r[1], ROM: +r[2], COLECAO: +r[3] };
      continue;
    }
    n[tipo]++;
    var f = [], a = 0;
    for (var k = 0; k <= l.length; k++) if (k === l.length || l[k] === 0x7C) { f.push(l.subarray(a, k)); a = k + 1; }
    var t = f.map(function (x) { return dec.decode(x); });
    var rom = tipo === "ROM";
    if (f.length !== 7 || !hex.test(t[1]) || !hex.test(t[2]) || !hex.test(rom ? t[3] : t[4])) { ruins++; continue; }
    var it = { k: "", rom: rom, tid: t[1].toUpperCase(), ct: t[2].toUpperCase(), emu: "", nome: t[5], arq: t[6] };
    if (rom) {
      it.emu = t[3].toUpperCase();
      it.k = "R" + it.tid;
      if (cuiIdDaRom(parseInt(it.emu, 16), f[6]) !== parseInt(it.tid, 16)) roms++;
    } else it.k = "J" + t[4].toUpperCase();
    if (chaves[it.k]) { ruins++; continue; }
    chaves[it.k] = 1;
    itens.push(it);
  }
  if (!rodape)
    throw new Error("O vault.txt não tem a linha de total no fim: parece cortado. Nada foi trocado; exporte de novo no console.");
  if (rodape.JOGO !== n.JOGO || rodape.ROM !== n.ROM || rodape.COLECAO !== n.COLECAO)
    throw new Error("O vault.txt diz ter " + rodape.JOGO + " jogos, " + rodape.ROM + " ROMs e " + rodape.COLECAO +
      " coleções, mas veio com " + n.JOGO + ", " + n.ROM + " e " + n.COLECAO + ". Nada foi trocado; exporte de novo no console.");
  if (ruins) avisos.push(ruins + " linha" + (ruins > 1 ? "s" : "") + " de jogo fora do formato ficou de fora");
  if (roms) avisos.push(roms + " ROM" + (roms > 1 ? "s" : "") + " com id que não bate com o nome do arquivo");
  var cols = cuiLer(colLinhas.join("\n"));
  return { cols: cols, itens: itens, avisos: cols.avisos.concat(avisos) };
}

/* O arquivo que entra pelo menu: o vault.txt (inventario e colecoes) ou o
   colecoes.txt (so as colecoes). Quem diz e o conteudo, nao o nome. */
function cuiImportar(buf) {
  var txt = new TextDecoder("utf-8").decode(buf);
  if (/^(JOGO|ROM|COLECAO)\|/m.test(txt)) return cuiImportarVault(buf);
  var cols = cuiLer(txt);
  if (!cols.length) { alert("Nenhuma coleção nesse arquivo."); return; }
  if (CUI.cols.length && !confirm("Substituir as " + CUI.cols.length + " coleções daqui pelas " +
      cols.length + " do arquivo?")) return;
  CUI.cols = cols; CUI.extras = cols.extras;
  CUI.sel = null;
  cuiAviso = cols.length + " coleç" + (cols.length > 1 ? "ões importadas" : "ão importada") + "." +
    (cols.avisos.length ? " " + cols.avisos.join("; ") + "." : "");
  cuiMudou(); cuiIr("colecoes");
}

function cuiImportarVault(buf) {
  var v;
  try { v = cuiLerVault(buf); } catch (e) { alert(e.message); return; }
  if (CUI.cols.length && !confirm("Substituir as " + CUI.cols.length + " coleções daqui pelas " +
      v.cols.length + " do console? O inventário do console também é trocado pelo do arquivo.")) return;
  CUI.cols = v.cols; CUI.extras = v.cols.extras;
  CUI.sel = null;
  CUI_INV = { t: Date.now(), itens: v.itens };
  try { localStorage.setItem(CUI_INV_KEY, JSON.stringify(CUI_INV)); } catch (e) {}
  var nr = v.itens.filter(function (it) { return it.rom; }).length;
  cuiAviso = "Importado do console: " + v.cols.length + " coleç" + (v.cols.length === 1 ? "ão" : "ões") + ", " +
    (v.itens.length - nr) + " jogos e " + nr + " ROMs." + (v.avisos.length ? " " + v.avisos.join("; ") + "." : "");
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
  var g = jogoDoCard(card);
  if (!cuiRascunho || !g || !g._tids.length) return;
  var dentro = cuiNoRascunho(g);
  if (dentro) cuiRascunho = cuiRascunho.filter(function (t) { return g._tids.indexOf(t) < 0; });
  else g._tids.forEach(function (t) { if (!cuiRascunhoSet.has(t)) cuiRascunho.push(t); });
  cuiRascunhoSet = new Set(cuiRascunho);
  // O que divide Title ID com ele muda junto, e o card tem de dizer isso.
  [card].concat($$(".card").filter(function (x) {
    return (g._junto || []).some(function (j) { return j.id === x.dataset.id; });
  })).forEach(function (x) {
    x.classList.toggle("nacol", !dentro);
    x.classList.toggle("apagado", dentro);
  });
  cuiPintar();
}

/* Dentro da colecao: o botao do canto tira o jogo, com todos os Title IDs dele. */
function cuiRemover(card) {
  var c = cuiPorId(CUI.sel);
  var g = jogoDoCard(card);
  if (!c || c.tipo !== "jogos" || !g) return;
  var antes = c.ids.slice();
  c.ids = c.ids.filter(function (t) { return g._tids.indexOf(t) < 0; });
  cuiMudou();
  // Quem divide Title ID com ele sai junto: ai a lista e refeita inteira.
  if (g._junto) render();
  else { removeCard(card); updateStats(filtered(null)); cuiPintar(); }
  // Sem confirmacao: remover e frequente e facil de refazer, entao o que protege
  // do clique errado e o Desfazer, que devolve a lista de Title IDs como estava
  // (mesma ordem, o arquivo exportado nao muda).
  cuiAvisar(g.title + " removido da coleção", function () {
    var atual = cuiPorId(c.id);
    if (!atual) return;
    atual.ids = antes;
    cuiMudou(); render();
  });
}

/* Aviso embaixo da tela com um Desfazer. Some sozinho em 6 s, ao desfazer e ao
   sair da tela: desfazer em outra tela mexeria no que a pessoa nao esta vendo. */
var cuiAvisoTimer = null, cuiDesfazer = null;
function cuiAvisar(texto, desfazer) {
  $("#aviso-txt").textContent = texto;
  cuiDesfazer = desfazer;
  $("#aviso").hidden = false;
  clearTimeout(cuiAvisoTimer);
  cuiAvisoTimer = setTimeout(cuiFecharAviso, 6000);
}
function cuiFecharAviso() {
  clearTimeout(cuiAvisoTimer);
  cuiDesfazer = null;
  $("#aviso").hidden = true;
}

/* A tela inicial: um quadrado por colecao, com a colagem de tres capas da previa
   (grupo30). A busca do topo filtra pelo nome da colecao. */
function cuiTelaColecoes() {
  var q = F.q;
  var lista = cuiOrdenadas().filter(function (c) { return !q || norm(c.nome).indexOf(q) >= 0; });
  var h = '<div class="cui-grade"><button class="cui-tile cui-tile-nova" id="cui-nova">' +
    "<span>+</span><b>Nova coleção</b></button>";
  lista.forEach(function (c) {
    var capas = [], vistos = new Set();
    cuiIds(c).forEach(function (t) {
      cuiDonos(t).forEach(function (g) {
        if (g.image && capas.length < 3 && !vistos.has(g.image)) { vistos.add(g.image); capas.push(g); }
      });
    });
    h += '<button class="cui-tile" data-col="' + c.id + '"><span class="colagem">' +
      capas.map(function (g) {
        return '<img loading="lazy" src="' + esc(g.image) + '" alt="" onerror="this.remove()">';
      }).join("") + "</span>" + cuiEmblema(c.tipo) + '<span class="cui-tile-txt"><b>' + esc(c.nome) +
      "</b><i>( " + cuiContar(c).n + " )</i></span></button>";
  });
  $("#main").innerHTML = h + "</div>";
  cuiPintar();
}

/* O emblema do canto de cima, o mesmo da previa do console: o raio na juncao e,
   na intersecao, dois circulos vazados com a lente cheia. A contagem embaixo e
   sempre a resolvida, entao e o emblema que diz que a colecao e composta. */
var CUI_NOME_TIPO = { jogos: "Coleção Manual", uniao: "Junção", intersecao: "Interseção" };
var CUI_EFEITO = { uniao: "em qualquer uma delas", intersecao: "só em todas elas" };
function cuiEmblema(tipo) {
  if (tipo !== "uniao" && tipo !== "intersecao") return "";
  var d = tipo === "uniao"
    ? '<path d="M.62 .02 .17 .56H.44L.34 .98 .82 .42H.54Z"/>'
    : '<g fill="none" stroke="currentColor" stroke-width=".11"><circle cx=".35" cy=".5" r=".27"/>' +
      '<circle cx=".65" cy=".5" r=".27"/></g><path d="M.5 .2755A.27 .27 0 0 1 .5 .7245 .27 .27 0 0 1 .5 .2755Z"/>';
  return '<svg class="cui-emblema" viewBox="0 0 1 1" fill="currentColor" role="img" aria-label="' +
    CUI_NOME_TIPO[tipo] + ": " + CUI_EFEITO[tipo] + '"><title>' + CUI_NOME_TIPO[tipo] + ": " +
    CUI_EFEITO[tipo] + "</title>" + d + "</svg>";
}

function cuiFormulario(titulo, c) {
  var novo = !c;
  return "<h3>" + titulo + "</h3>" +
    '<input type="text" id="cui-nome" maxlength="28" placeholder="Ex.: Para jogar em dois" value="' +
      esc(c ? c.nome : "") + '">' +
    (novo ? '<div class="seg" role="radiogroup" aria-label="Tipo">' +
      ["jogos", "uniao", "intersecao"].map(function (t) {
        return '<label><input type="radio" name="cui-tipo" value="' + t + '"' + (t === "jogos" ? " checked" : "") +
          "> " + CUI_NOME_TIPO[t] + "</label>";
      }).join("") + "</div>" : "") +
    '<div id="cui-origens"></div>' +
    '<button class="btn primary" id="cui-ok">' + (novo ? "Criar" : "Salvar") + "</button>";
}

/* As origens que o tipo aceita, pela escada, nunca a propria colecao, e embaixo
   quantos jogos daria agora: uma intersecao esvazia facil, e descobrir o ( 0 )
   depois de criar e tarde. */
function cuiPintarOrigens(tipo, c, marcadas) {
  var box = $("#cui-origens");
  box.hidden = tipo === "jogos";
  if (box.hidden) return;
  var L = cuiOrdenadas().filter(function (x) { return x !== c && cuiPodeSerOrigem(x, tipo); });
  box.innerHTML = '<p>Os jogos que estão ' + CUI_EFEITO[tipo] + ":</p>" +
    (L.length ? L.map(function (x) {
      return '<label class="chk"><input type="checkbox" class="cui-origem" value="' + x.id + '"' +
        (marcadas.indexOf(x.id) >= 0 ? " checked" : "") + "> " + esc(x.nome) + cuiEmblema(x.tipo) + "</label>";
    }).join("") : "<p>" + (tipo === "uniao" ? "Crie antes uma coleção manual." : "Crie antes uma coleção para cruzar.") + "</p>") +
    '<p class="cui-daria" id="cui-daria"></p>';
  var daria = function () {
    var os = cuiOrigensMarcadas();
    $("#cui-daria").textContent = os.length
      ? "Daria " + cuiContarIds(cuiIds({ tipo: tipo, ids: [], origens: os })).n + " jogos." : "";
  };
  $$(".cui-origem").forEach(function (x) { x.onchange = daria; });
  daria();
}
function cuiOrigensMarcadas() {
  return $$(".cui-origem").filter(function (x) { return x.checked; }).map(function (x) { return +x.value; });
}

function cuiAbrirForm(c) {
  openModal(cuiFormulario(c ? (cuiComposta(c) ? "Editar " + CUI_NOME_TIPO[c.tipo].toLowerCase() : "Renomear coleção")
    : "Nova coleção", c));
  var nome = $("#cui-nome");
  nome.focus();
  var tipo = c ? c.tipo : "jogos";
  cuiPintarOrigens(tipo, c, c ? c.origens : []);
  $$("input[name=cui-tipo]").forEach(function (r) {
    r.onchange = function () { if (r.checked) { tipo = r.value; cuiPintarOrigens(tipo, c, cuiOrigensMarcadas()); } };
  });
  var salvar = function () {
    var n = cuiSanear(nome.value);
    if (!n) { nome.focus(); return; }
    var origens = cuiOrigensMarcadas();
    if (tipo !== "jogos" && !origens.length) { alert("Escolha ao menos uma coleção."); return; }
    if (c) { c.nome = n; if (cuiComposta(c)) c.origens = origens; }
    else {
      c = { id: cuiProximoId(), tipo: tipo, nome: n, ids: [], origens: tipo !== "jogos" ? origens : [] };
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
  var foram = cuiLimparCompostas(CUI.cols);
  CUI.sel = null;
  cuiAviso = foram.length ? "Apagada junto, por ficar sem origem: " + foram.join(", ") + "." : "";
  cuiMudou(); cuiIr("colecoes");
}

function cuiPintar() {
  if (AREA !== "cui") return;
  var c = cuiPorId(CUI.sel), h = "";
  if (cuiTela === "colecoes") {
    if (!CUI.cols.length)
      h = "<span>Nenhuma coleção ainda. Importe o vault.txt do console pelo menu Arquivo, ou crie uma em Nova coleção.</span>";
    if (CUI_INV) {
      var nr = CUI_INV.itens.filter(function (it) { return it.rom; }).length, nj = CUI_INV.itens.length - nr;
      var d = new Date(CUI_INV.t);
      h += '<div class="cui-nota cui-inv">Console: ' + nj + " jogo" + (nj === 1 ? "" : "s") + " e " + nr +
        " ROM" + (nr === 1 ? "" : "s") + ", importados em " + d.toLocaleDateString("pt-BR") + " às " +
        d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + ".</div>";
    }
  } else if (cuiTela === "jogos" && c) {
    var k = cuiContar(c);
    // Trilha no tamanho de titulo: o nivel de cima e link cinza, o atual em destaque.
    h = '<button class="cui-seta" id="cui-voltar" title="Voltar para as coleções" aria-label="Voltar">‹</button>' +
      '<div class="cui-trilha"><button id="cui-voltar2">Coleções</button><i>/</i><b>' + esc(c.nome) + "</b></div>" +
      '<span class="cui-conta">' + k.n + " jogo" + (k.n === 1 ? "" : "s") +
      (cuiComposta(c) ? " · " + (c.tipo === "uniao" ? "em qualquer uma: " : "em todas: ") +
        esc(c.origens.map(cuiPorId).filter(Boolean).map(function (o) { return o.nome; }).join(", ")) : "") +
      "</span>" +
      '<div class="cui-acoes">' +
      (cuiComposta(c) ? '<button class="btn" id="cui-editar">Editar</button>'
               : '<button class="btn primary" id="cui-add">Adicionar jogos</button>' +
                 '<button class="btn" id="cui-editar">Renomear</button>') +
      '<button class="btn perigo" id="cui-apagar">Apagar</button></div>' +
      (k.fora.length ? '<div class="cui-nota">' + k.fora.length + " desta coleção não aparece" +
        (k.fora.length > 1 ? "m" : "") + " no catálogo e continua no arquivo: " +
        k.fora.map(function (t) { return "<code>" + t + "</code>"; }).join(" ") + "</div>" : "") +
      (cuiOrigemMorta(c) ? '<div class="cui-nota">Uma das coleções desta interseção não existe mais, e por isso ' +
        "ela está vazia. Escolha as coleções de novo em Editar.</div>" : "");
  } else if (cuiTela === "adicionar" && c) {
    var n = cuiContarIds(cuiRascunho).n;
    // Sair pela trilha e o mesmo que Cancelar: o rascunho nao e gravado.
    h = '<button class="cui-seta" id="cui-trilha-col" title="Voltar para a coleção, sem gravar" aria-label="Voltar">‹</button>' +
      '<div class="cui-trilha"><button id="cui-voltar">Coleções</button><i>/</i>' +
      '<button id="cui-trilha-col2">' + esc(c.nome) + "</button><i>/</i><b>Adicionar jogos</b></div>" +
      '<span class="cui-conta">' + n + " marcado" + (n === 1 ? "" : "s") + "</span>" +
      '<div class="cui-acoes"><button class="btn" id="cui-cancelar">Cancelar</button>' +
      '<button class="btn primary" id="cui-concluir">Concluir</button></div>';
  }
  if (cuiAviso) h += '<div class="cui-nota">' + esc(cuiAviso) + "</div>";
  $("#cui-barra").innerHTML = h;
  var abas = !(CUI_INV && cuiTela === "adicionar");
  $("#vista-con").hidden = $("#vista-fora").hidden = abas;
  if (CUI_INV) $("#s-con").textContent = CUI_INV.itens.length.toLocaleString("pt-BR");
  // A contagem e a do rascunho ao vivo: diz quanto do console ainda falta pôr.
  if (!abas) $("#s-fora").textContent = cuiConsole().lista.filter(function (g) {
    return g._tids.length && !cuiNoRascunho(g);
  }).length.toLocaleString("pt-BR");
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
  cuiSelIds = null; cuiAviso = ""; cuiSairAdicionar();
  cuiFecharAviso();
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
    if (id === "cui-voltar" || id === "cui-voltar2") { cuiSairAdicionar(); CUI.sel = null; cuiMudou(); cuiIr("colecoes"); }
    else if (id === "cui-add") cuiAdicionar();
    else if (id === "cui-concluir") cuiConcluir();
    else if (id === "cui-cancelar" || id === "cui-trilha-col" || id === "cui-trilha-col2") cuiCancelar();
    else if (id === "cui-editar") cuiAbrirForm(cuiPorId(CUI.sel));
    else if (id === "cui-apagar") cuiApagar();
  });
  $("#aviso-desfazer").onclick = function () {
    var f = cuiDesfazer;
    cuiFecharAviso();
    if (f) f();
  };
  $("#btn-cui-import").onclick = function () { $("#file-cui").click(); };
  $("#btn-cui-export").onclick = cuiExportar;
  $("#file-cui").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f) f.arrayBuffer().then(cuiImportar);
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
