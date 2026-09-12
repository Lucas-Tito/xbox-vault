/* Stub da File System Access API, injetado antes dos scripts da pagina.
   Um "arquivo" em memoria com a mesma interface, para testar o modulo de sync
   sem o seletor de arquivo (que exige interacao real do usuario). */
(function () {
  window.__fakeFile = { conteudo: "" };
  var h = {
    name: "colecao-teste.json",
    queryPermission: function () { return Promise.resolve("granted"); },
    requestPermission: function () { return Promise.resolve("granted"); },
    getFile: function () {
      return Promise.resolve({ text: function () { return Promise.resolve(window.__fakeFile.conteudo); } });
    },
    createWritable: function () {
      return Promise.resolve({
        write: function (d) { window.__fakeFile.conteudo = d; return Promise.resolve(); },
        close: function () { return Promise.resolve(); }
      });
    }
  };
  window.__fakeHandle = h;
  window.showSaveFilePicker = function () { return Promise.resolve(h); };
})();
