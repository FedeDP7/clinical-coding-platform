// Demo Popup — Approccio WHO CODIT Standard (popover floating embedded search).
//
// Flow:
//   - popupMode:true --> window come popover floating sotto l'input.
//   - keepWindowOnSelect:true --> la window resta aperta + interattiva dopo selectEntity
//     (l'utente può cliccare un altro risultato per cambiare scelta).
//   - selectedEntityFunction inietta un banner ".ict-selected-banner" dentro
//     ".ict-results-header" (accanto al titolo "Risultati"). Re-select aggiorna il banner.

CODIT.Handler.configure({
  apiBaseUrl: "http://localhost:8000/api/index.php",
  releaseId: "20251215",
  popupMode: true,
  keepWindowOnSelect: true,
});
