// Demo Browser — live-search + tree gerarchico, sempre reattivo.
//
// Flow:
//   - showWordList:false --> la window mostra solo "Risultati" (1-col).
//   - revealInTreeOnSearch:false --> digitando l'albero NON si auto-rivela; solo
//     il click esplicito su un risultato sincronizza l'albero.
//   - Click su un risultato --> syncBrowserToCode allinea l'albero al codice
//     selezionato (browserInstances[ino] bound via data-icb-ino="1").
//   - clearInputOnSelect:true --> input host pulito post-select: l'utente torna
//     nella barra senza dover svuotare manualmente e digita una nuova ricerca.

ICT.Handler.configure({
  apiBaseUrl: "http://localhost:8000/api/index.php",
  releaseId: "20251215",
  showWordList: false,
  revealInTreeOnSearch: false,
  clearInputOnSelect: true,
});
