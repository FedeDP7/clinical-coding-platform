// Demo SDO — tutta la logica (campi diagnosi, daga/asterisco, dettagli,
// modali) vive nel modulo CODIT.SDO della libreria. L'host fornisce solo
// il container e i settings API.
CODIT.SDO.init({
  container: "#sdo",
  settings: {
    apiBaseUrl: "../../api/index.php",
    releaseId: "20260216",
  },
});
