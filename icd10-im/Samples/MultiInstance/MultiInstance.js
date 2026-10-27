// Demo MultiInstance — pattern WHO ECT v1.8 multi-istanza parallele.
//
// Tre input/window indipendenti (data-ict-ino="1|2|3") condividono la stessa
// configurazione globale. Il dispatching del target DOM avviene tramite il
// campo `iNo` del payload `selectedEntity` (WHO CODIT v1.8 standard).
//
// Flag scelti:
//   - inlineResults:true     --> la window risultati scorre nel flow del documento
//                                (no overlay flottante), coerente con il layout
//                                a card ".demo-instance" che incornicia ogni ECT.
//   - showInlineDetails:false --> nessun pannello dettagli inline post-select;
//                                 il target esterno mostra solo "code — title".
//   - clearInputOnSelect:true --> input host svuotato post-select per favorire
//                                 una nuova ricerca senza pulizia manuale.
//
// Nota: la lib NON espone `overwriteConfiguration(ino, partialConfig)` (WHO ECT).
// I flag per-instance (es. `chaptersFilter` / `language`) non sono applicabili
// finché non viene aggiunto quel hook. Qui le tre istanze condividono dataset e
// release, e si distinguono solo per il target DOM (via iNo).

const mySettings = {
  apiBaseUrl: "../../api/index.php",
  releaseId: "20260216",
  popupMode: false,
  inlineResults: true,
  showInlineDetails: false,
  clearInputOnSelect: true,
};

const myCallbacks = {
  selectedEntityFunction: (selectedEntity) => {
    const paste = document.getElementById("demo-paste-selected-" + selectedEntity.iNo);
    const wrapper = document.getElementById("demo-selected-" + selectedEntity.iNo);
    if (!paste || !wrapper) return;
    paste.textContent = selectedEntity.code + " — " + selectedEntity.title;
    wrapper.style.display = "inline";
  },
  onClear: (ino) => {
    const paste = document.getElementById("demo-paste-selected-" + ino);
    const wrapper = document.getElementById("demo-selected-" + ino);
    if (!paste || !wrapper) return;
    paste.textContent = "";
    wrapper.style.display = "none";
  },
};

CODIT.Handler.configure(mySettings, myCallbacks);
