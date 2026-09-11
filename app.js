/* Xbox Vault — app principal. Dados vêm de data/db.js (window.XBX_DB). */
(function () {
"use strict";

var DB = window.XBX_DB || { games: [], generated: null };
var GAMES = DB.games || [];
var OWNED_KEY = "xbx.owned.v1";
var FILT_KEY  = "xbx.filters.v1";
var BATCH = 120;

/* ---------------- estado ---------------- */
var owned = new Set();
try { owned = new Set(JSON.parse(localStorage.getItem(OWNED_KEY) || "[]")); } catch (e) {}

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
  if (f.xblig) h.push('<span class="tag">INDIE</span>');
  if (f.kinect) h.push('<span class="tag">KINECT</span>');
  if (f.stereo3d) h.push('<span class="tag">3D</span>');
  if (g.category) h.push('<span class="tag">' + esc(g.category.toUpperCase()) + "</span>");
  return h.join("");
}

function cardHtml(g) {
  var img = g.image
    ? '<img loading="lazy" src="' + esc(g.image) + '" alt="' + esc(g.title) + '" onerror="this.parentNode.innerHTML=\'<div class=ph>' + esc(g.title).replace(/'/g, "") + '</div>\'">'
    : '<div class="ph">' + esc(g.title) + "</div>";
  var sub = g.platform === "homebrew"
    ? esc(g.description || g.category || "")
    : esc([g.genre, (g.developers || [])[0]].filter(Boolean).join(" · "));
  var link = g.wiki
    ? '<a href="https://en.wikipedia.org/wiki/' + encodeURIComponent(g.wiki) + '" target="_blank" rel="noopener">' + esc(g.title) + "</a>"
    : (g.url ? '<a href="' + esc(g.url) + '" target="_blank" rel="noopener">' + esc(g.title) + "</a>" : esc(g.title));

  return '<article class="card' + (owned.has(g.id) ? " own" : "") + '" data-id="' + esc(g.id) + '">' +
    '<button class="own-btn" title="Marcar como “tenho”">' + (owned.has(g.id) ? "✓" : "+") + "</button>" +
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

/* ---------------- coleção ---------------- */
function saveOwned() {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(Array.from(owned))); }
  catch (e) { alert("Não consegui salvar no navegador: " + e.message); }
}
function toggleOwn(id, card) {
  if (owned.has(id)) owned.delete(id); else owned.add(id);
  saveOwned();
  if (card) {
    card.classList.toggle("own", owned.has(id));
    card.querySelector(".own-btn").textContent = owned.has(id) ? "✓" : "+";
  }
  updateStats(filtered(null));
  if (F.own !== "all") render();
}

/* ---------------- export / import ---------------- */
function doExport() {
  var payload = {
    app: "xbox-vault", version: 1,
    exportedAt: new Date().toISOString(),
    catalogGenerated: DB.generated || null,
    count: owned.size,
    owned: Array.from(owned).sort()
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
  var ids = Array.isArray(data) ? data : (data.owned || data.ids || []);
  if (!Array.isArray(ids)) throw new Error("Formato não reconhecido: faltou a lista 'owned'.");
  return ids.filter(function (x) { return typeof x === "string"; });
}

function applyImport(ids, mode) {
  var known = new Set(GAMES.map(function (g) { return g.id; }));
  var ok = ids.filter(function (i) { return known.has(i); });
  var unknown = ids.length - ok.length;
  if (mode === "replace") owned = new Set(ok);
  else ok.forEach(function (i) { owned.add(i); });
  saveOwned(); render();
  closeModal();
  alert("Importado: " + ok.length + " jogo(s)" +
    (unknown ? "\n" + unknown + " id(s) do arquivo não existem neste catálogo e foram ignorados." : "") +
    "\nTotal na coleção agora: " + owned.size);
}

function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; }

var pendingIds = null;
function importFlow(text) {
  try { pendingIds = parseImport(text); }
  catch (e) { alert("Arquivo inválido: " + e.message); return; }
  openModal(
    "<h3>Importar coleção</h3><p>O arquivo tem <b>" + pendingIds.length +
    "</b> jogo(s). Como aplicar?</p>" +
    '<button class="btn primary" id="imp-merge">➕ Somar à minha coleção atual (' + owned.size + " jogos)</button>" +
    '<button class="btn" id="imp-replace">♻️ Substituir tudo pelo arquivo</button>');
  $("#imp-merge").onclick = function () { applyImport(pendingIds, "merge"); };
  $("#imp-replace").onclick = function () {
    if (confirm("Isso apaga sua coleção atual (" + owned.size + " jogos) e usa só a do arquivo. Confirmar?"))
      applyImport(pendingIds, "replace");
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
    if (card) toggleOwn(card.dataset.id, card);
  });

  $("#btn-export").onclick = doExport;
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
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  $("#btn-filters").onclick = function () { $("#side").classList.toggle("open"); };
  $("#btn-reset").onclick = function () {
    F = { q: "", own: "all", plats: ["x360", "xbox", "homebrew"], modes: [], flags: [],
          plScope: "any", plMin: 0, y1: "", y2: "", bc: "all", cat: "", genres: [], sort: "year-desc" };
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
}
})();
