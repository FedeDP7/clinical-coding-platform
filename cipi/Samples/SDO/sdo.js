// Demo SDO — multi-field via fields[] + ICT.attach (Popup modale per ogni campo).
//
// Flow:
//   - Handler.configure({ fields: [...] }) registra N campi indipendenti.
//   - Per ogni campo, click sul bottone "Cerca Codice" apre Popup modale.
//   - Selezione singola --> input host popolato + popup auto-chiuso.
//   - detailButton (opt) --> abilitato post-select --> click apre ICT.showDetail.
//   - bottone × --> reset input + disable detailButton.

ICT.Handler.configure({
  apiBaseUrl: "http://localhost:8000/api/index.php",
  releaseId: "20251215",
  placeholder: "Cerca per codice o testo (es. 00.00.0A, approccio)",

  // Callback unica: scrive nel campo associato.
  onFieldSelect(data, input) {
    input.value = `${data.code} — ${data.title || ""}`.trim();
  },

  // Mappa selettori --> modali. Una riga per campo. detailButton è opzionale:
  // se presente, viene auto-agganciato (disabled finché non si seleziona,
  // poi click --> ICT.showDetail(codice memorizzato)).
  fields: [
    { input: "#diag-principale", button: "#btn-diag-principale", detailButton: "#info-diag-principale", title: "Diagnosi Principale" },
    { input: "#diag-sec-1",      button: "#btn-diag-sec-1",      detailButton: "#info-diag-sec-1",      title: "Diagnosi Secondaria 1" },
    { input: "#diag-sec-2",      button: "#btn-diag-sec-2",      detailButton: "#info-diag-sec-2",      title: "Diagnosi Secondaria 2" },
    { input: "#diag-sec-3",      button: "#btn-diag-sec-3",      detailButton: "#info-diag-sec-3",      title: "Diagnosi Secondaria 3" },
    { input: "#diag-sec-4",      button: "#btn-diag-sec-4",      detailButton: "#info-diag-sec-4",      title: "Diagnosi Secondaria 4" },
  ],
});

document.querySelectorAll("button.sdo-clear").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tgt = document.getElementById(btn.getAttribute("data-target"));
    if (tgt) tgt.value = "";
    const infoId = btn.getAttribute("data-detail");
    if (infoId) {
      const info = document.getElementById(infoId);
      if (info) {
        info.disabled = true;
        delete info.dataset.ictCode;
      }
    }
  });
});
