// Demo Callback — WHO CODIT v1.8 canonical pattern.
//
//   CODIT.Handler.configure(mySettings, myCallbacks)
//
// Flow:
//   - selectedEntityFunction(selectedEntity) --> scrive selectedEntity.code in
//     <input id="paste-selectedEntity"> (target esterno, .value come da esempio WHO).
//   - clearInputOnSelect:true --> la lib pulisce l'input host post-select senza
//     re-entrare nel ciclo onClear (equivalente "fluido" del pattern WHO che
//     invoca CODIT.Handler.clear nel callback).
//   - showInlineDetails:false --> nessun pannello dettagli inline post-select.
//   - onClear --> resetta il target esterno quando l'utente clicca × sull'input.

const mySettings = {
  apiBaseUrl: "../../api/index.php",
  releaseId: "20260216",
  popupMode: false,
  showInlineDetails: false,
  clearInputOnSelect: true,
  inlineResults: true,
};

const myCallbacks = {
  selectedEntityFunction: (selectedEntity) => {
    document.getElementById("paste-selectedEntity").value = selectedEntity.code;
  },
  onClear: () => {
    document.getElementById("paste-selectedEntity").value = "";
  },
};

CODIT.Handler.configure(mySettings, myCallbacks);


