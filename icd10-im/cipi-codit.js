/**
 * CIPI-CODIT — Embedded Coding Tool per CIPI.
 *
 * Libreria singola-file (IIFE su window) che fornisce:
 *  - ricerca live su API REST (debounce + cache + abort)
 *  - browser ad albero gerarchico (lazy-loading dei figli)
 *  - modali di dettaglio / gerarchia / preview-confirm
 *  - integrazione plug-and-play via attributi `data-ict-ino` / `data-icb-ino`
 *
 * Espone due alias globali identici: `window.ICT` e `window.CODIT`.
 *
 * Tutti gli stili sono prefissati `.ict-*` in cipi-codit.css --> zero collisioni
 * con il CSS della pagina ospite.
 */

(function (global) {
  "use strict";

  // Configurazione condivisa da tutte le istanze
  // sovrascrivibile via ICT.Handler.configure()
  const DEFAULT_CONFIG = {
    apiBaseUrl: "http://localhost:8000/api/index.php",
    releaseId: "20251215",
    source: "cipi",
    debounceMs: 150,
    pageSize: 15,
    terminalOnly: false,
    popupMode: false, // se true: ogni input data-ict-ino apre un popup invece di renderizzare inline
    keepWindowOnSelect: false, // se true: la window resta visibile + interattiva dopo selectEntity
    showInlineDetails: true, // se false: non renderizza il pannello dettagli inline post-select (popupMode:false)
    showWordList: true, // se false: nasconde la colonna "Elenco Termini" nei risultati di ricerca (1-col)
    clearInputOnSelect: false, // se true: dopo selectEntity pulisce l'input host invece di mostrare "code — title"
    revealInTreeOnSearch: true, // se false: la digitazione non auto-rivela il primo risultato nell'albero (solo click esplicito sincronizza il tree)
    inlineResults: false, // se true: la window dei risultati scorre inline nel layout (no dropdown absolute, no overlay)
    isDisabled: null,  // callback(code, ino) -> true se il risultato deve apparire disabilitato
    onSelect: null,
    onClear: null,
    onSearchStart: null,
    onSearchEnd: null,
    // WHO CODIT v1.8 callbacks (callbacks{} param). Alias di onSelect.
    selectedEntityFunction: null,
  };

  let config = { ...DEFAULT_CONFIG };

  // Mappa ino -> stato istanza (input, window, selected, resolvedSelection, ...)
  const instances = {};

  // Mappa ino -> callback per-istanza (override dei callback globali per quel campo)
  // Usata da ICT.Popup per intercettare la selezione di un singolo input senza
  // toccare la config globale di Handler.
  const instanceCallbacks = {};

  // Cache in-memory delle risposte GET idempotenti (/entity, /resolve, /children,
  // /ancestors, /chapter, /associations, /crosswalk). La ricerca (/search) NON viene
  // mai cachata: è dinamica (query/paginazione/terminalOnly) e deve restare fresca.
  // Conserva sia Promise in-flight (per dedup di chiamate concorrenti) sia il JSON
  // finale risolto. Le risposte vengono clonate prima di essere restituite per
  // impedire mutazioni accidentali da parte dei consumer.
  const apiCache = new Map();

  /**
   * Genera una chiave di cache deterministica basata sul path e i parametri.
   * I parametri vengono ordinati alfabeticamente per garantire che lo stesso set
   * di input produca sempre la stessa chiave.
   *
   * @param {string} path   - Endpoint API (es. "/resolve").
   * @param {Object} params - Parametri query.
   * @returns {string} Chiave univoca per la cache.
   */
  function buildCacheKey(path, params) {
    const sp = new URLSearchParams();
    Object.keys(params).sort().forEach((k) => {
      if (params[k] != null) sp.set(k, params[k]);
    });
    return `${path}?${sp.toString()}`;
  }

  /**
   * Verifica se un determinato endpoint dell'API è idoneo per il caching.
   * La ricerca (/search) è esclusa perché dinamica e dipendente dal tempo/contesto.
   *
   * @param {string} path - Path dell'API da verificare.
   * @returns {boolean} True se il path è cachabile.
   */
  function isCacheablePath(path) {
    return !/\/search(?:$|[/?])/.test(path);
  }

  /**
   * Crea una copia profonda di un oggetto JSON-safe.
   * Utilizzato per isolare le risposte restituite dalla cache ed evitare
   * mutazioni accidentali dei dati condivisi.
   *
   * @param {*} value - Valore da clonare.
   * @returns {*} Copia isolata del valore.
   */
  function cloneJson(value) {
    if (value == null || typeof value !== "object") return value;
    if (typeof structuredClone === "function") {
      try { return structuredClone(value); } catch (_) { /* fall through */ }
    }
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  // API

  /**
   * Esegue una richiesta GET verso l'API.
   * Gestisce automaticamente il routing via query param (index.php),
   * il caching idempotente e l'annullamento via AbortSignal.
   *
   * @param {string} path   - Endpoint API (senza releaseId).
   * @param {Object} [params={}] - Parametri query aggiuntivi.
   * @param {Object} [opts={}]   - Opzioni extra (signal, noCache).
   * @param {AbortSignal} [opts.signal] - Segnale per annullare la fetch.
   * @param {boolean}     [opts.noCache] - Se true, ignora la cache.
   * @returns {Promise<Object>} Risposta JSON dell'API.
   * @throws {Error} In caso di fallimento HTTP o timeout.
   */
  async function apiGet(path, params = {}, opts = {}) {
    const { signal, noCache } = opts;
    const useCache = !noCache && isCacheablePath(path);
    const cacheKey = useCache ? buildCacheKey(path, params) : null;

    if (useCache && apiCache.has(cacheKey)) {
      const cached = apiCache.get(cacheKey);
      // In-flight (Promise) o JSON già risolto: in entrambi i casi restituisci un clone.
      if (cached && typeof cached.then === "function") {
        return cached.then(cloneJson);
      }
      return cloneJson(cached);
    }

    let baseUrl = config.apiBaseUrl;
    if (!/^https?:\/\//i.test(baseUrl)) {
      baseUrl = new URL(baseUrl, window.location.origin).toString();
    }

    const url = new URL("", baseUrl);
    url.searchParams.set("route", path);
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) url.searchParams.set(k, v);
    });

    const fetchPromise = (async () => {
      const resp = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${resp.status}`);
      }
      return resp.json();
    })();

    if (useCache) {
      apiCache.set(cacheKey, fetchPromise);
      try {
        const data = await fetchPromise;
        // Sostituisci la Promise con il JSON risolto --> letture successive O(1).
        apiCache.set(cacheKey, data);
        return cloneJson(data);
      } catch (err) {
        // Abort o errore --> evict per consentire un retry pulito al prossimo apiGet.
        apiCache.delete(cacheKey);
        throw err;
      }
    }

    return fetchPromise;
  }

  // Prefisso path API per la release corrente (es. "/release/20251215").
  function releaseBase() {
    const pfx = config.source ? `/${config.source}` : "";
    return `${pfx}/release/${config.releaseId}`;
  }

  // Wrapper su /resolve/{code}: restituisce dati risolti del codice selezionato.
  async function resolveSelection(code, opts) {
    return apiGet(`${releaseBase()}/resolve/${encodeURIComponent(code)}`, {}, opts);
  }

  // URI canonico dell'entità: URL assoluto al documento /entity/{code} dell'API release corrente.
  function entityUri(code) {
    let base = config.apiBaseUrl;
    if (!/^https?:\/\//i.test(base)) {
      base = new URL(base, window.location.origin).toString();
    }
    const u = new URL("", base);
    u.searchParams.set("route", `${releaseBase()}/entity/${code}`);
    return u.toString();
  }

  // UTILS

  // Ritarda l'esecuzione fino a quando l'utente smette di digitare
  function debounce(callback, delay) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => callback(...args), delay);
    };
  }

  /**
   * Esegue l'escaping dei caratteri HTML speciali per prevenire attacchi XSS.
   * Necessario quando si inseriscono stringhe dinamiche via innerHTML.
   *
   * @param {string} str - Stringa da processare.
   * @returns {string} Stringa sanitizzata.
   */
  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Helper per la creazione di elementi DOM in stile funzionale.
   *
   * @param {string} tag             - Tag HTML.
   * @param {Object} [attributes={}] - Mappa di attributi (class, on, data-*, etc).
   * @param {...(string|Node|Array)} children - Figli testuali o nodi DOM.
   * @returns {HTMLElement} Elemento creato.
   */
  function element(tag, attributes = {}, ...children) {
    const e = document.createElement(tag);
    Object.entries(attributes).forEach(([k, v]) => {
      if (k === "class") e.className = v;
      else if (k === "on")
        Object.entries(v).forEach(([ev, h]) => e.addEventListener(ev, h));
      else e.setAttribute(k, v);
    });
    children.flat().forEach((c) => {
      if (typeof c === "string") e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    });
    return e;
  }

  /**
   * createSkeletonDetails — placeholder animato per il pannello dettagli.
   *
   * Restituisce un frammento DOM con barre dimensionate in modo plausibile (titolo,
   * meta, griglia, sezioni testo) --> quando il contenuto reale subentra il layout
   * resta stabile (no cumulative layout shift). Animazione shimmer in CSS via
   * keyframe `ict-skeleton-shimmer`.
   *
   * @returns {DocumentFragment}
   */
  function createSkeletonDetails() {
    const frag = document.createDocumentFragment();
    const wrapper = element("div", { class: "ict-skeleton-wrapper", "aria-hidden": "true" },
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--title" }),
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--meta" }),
      element("div", { class: "ict-skeleton-grid" },
        element("div", { class: "ict-skeleton-bar ict-skeleton-bar--cell" }),
        element("div", { class: "ict-skeleton-bar ict-skeleton-bar--cell" }),
        element("div", { class: "ict-skeleton-bar ict-skeleton-bar--cell" })
      ),
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--section" }),
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--line" }),
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--line ict-skeleton-bar--short" }),
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--section" }),
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--line" }),
      element("div", { class: "ict-skeleton-bar ict-skeleton-bar--line ict-skeleton-bar--medium" })
    );
    frag.appendChild(wrapper);
    return frag;
  }

  /**
   * Mostra un messaggio di feedback temporaneo (toast) all'utente.
   *
   * @param {string} message - Testo del messaggio.
   * @param {number} [ms=1400] - Durata della visualizzazione.
   */
  function showToast(message, ms = 1400) {
    if (!message) return;
    const t = document.createElement("div");
    t.className = "ict-toast";
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("ict-toast-out"), ms);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, ms + 350);
  }

  // RENDER

  /**
   * Crea l'elemento DOM per un singolo risultato di ricerca.
   * Gestisce lo stato disabilitato (se già selezionato), la navigazione da tastiera
   * e il caricamento asincrono dei dettagli (MT list).
   *
   * @param {Object} entity - Dati dell'entità da renderizzare.
   * @param {string|number} ino - Identificatore istanza.
   * @returns {HTMLElement} Nodo DOM del risultato.
   */
  function renderResult(entity, ino) {
    const disabled = typeof config.isDisabled === "function" && config.isDisabled(entity.code, ino);

    const onActivate = () => {
      selectEntity(entity, ino);
    };

    const mtList = element("div", { class: "ict-mt-list ict-result-details" });
    mtList.style.display = "none";
    const mtToggle = element("div", {
      class: "ict-mt-toggle",
      role: "button",
      tabindex: "0",
      on: {
        click: async (e) => {
          e.stopPropagation();
          const open = mtToggle.classList.toggle("ict-mt-open");
          mtToggle.firstChild.textContent = (open ? "▾" : "▸") + " Dettagli";
          mtList.style.display = open ? "" : "none";
          if (open && !mtList.dataset.loaded) {
            // Skeleton in attesa del fetch --> no layout shift al render finale.
            mtList.innerHTML = "";
            mtList.appendChild(createSkeletonDetails());
            try {
              const [full, resolved] = await Promise.all([
                apiGet(`${releaseBase()}/entity/${encodeURIComponent(entity.code)}`),
                apiGet(`${releaseBase()}/resolve/${encodeURIComponent(entity.code)}`).catch(() => null),
              ]);
              mtList.innerHTML = "";
              mtList.appendChild(buildResultDetailsDom(entity, resolved, full));
              wireHierarchyButtons(mtList, ino);
              wireAssocLinks(mtList, ino);
              mtList.dataset.loaded = "1";
            } catch (err) {
              mtList.innerHTML = "";
              mtList.appendChild(element("div", { class: "ict-error" }, err.message || "Errore"));
            }
          }
        },
        keydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            mtToggle.click();
          }
        },
      },
    }, element("span", { class: "ict-mt-label" }, "▸ Dettagli"));

    const handlers = disabled ? {} : {
      click: onActivate,
      keydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const inst = instances[ino];
          if (!inst) return;
          const scope = inst.windowBody || inst.window;
          const items = [...scope.querySelectorAll(".ict-result:not(.ict-result-disabled)")];
          const idx = items.indexOf(e.currentTarget);
          if (e.key === "ArrowDown" && idx < items.length - 1) {
            items[idx + 1].focus();
            items[idx + 1].scrollIntoView({ block: "nearest" });
          }
          if (e.key === "ArrowUp") {
            if (idx > 0) {
              items[idx - 1].focus();
              items[idx - 1].scrollIntoView({ block: "nearest" });
            }
            else inst.input.focus();
          }
        }
        else if (e.key === "ArrowRight") {
          e.preventDefault();
          if (!mtToggle.classList.contains("ict-mt-open")) mtToggle.click();
        }
        else if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (mtToggle.classList.contains("ict-mt-open")) mtToggle.click();
        }
        else if (e.key === "Escape") {
          e.preventDefault();
          if (mtToggle.classList.contains("ict-mt-open")) {
            mtToggle.click();
          } else {
            clearWindow(ino);
            const inst = instances[ino];
            if (inst) inst.input.focus();
          }
        }
      },
    };

    const attrs = {
      class: "ict-result" +
        (entity.isTerminal ? " ict-terminal" : " ict-non-terminal") +
        (disabled ? " ict-result-disabled" : ""),
      tabindex: disabled ? "-1" : "0",
      role: "option",
      "aria-label": `${entity.code} ${entity.title || ""}`,
      on: handlers,
    };

    const row = element("div", attrs,
      element("div", { class: "ict-res-code" }, entity.code),
      element("div", { class: "ict-res-title" }, entity.title || ""),
      element("div", { class: "ict-res-bottom" },
        entity.matchIn ? element("span", { class: "ict-res-match" }, `Match: ${entity.matchIn}`) : null,
        entity.icd9cmCode ? element("span", { class: "ict-res-icd9" }, `[ICD-9: ${entity.icd9cmCode}]`) : null,
        disabled ? element("span", { class: "ict-res-disabled-label" }, "(già selezionato)") : null
      )
    );

    const wrapper = element("div", { class: "ict-result-wrapper" }, row, mtToggle, mtList);
    return wrapper;
  }

  // Helper: nodo titolo di sezione (riusato dai builder di dettagli).
  function sectionTitle(text) {
    return element("div", { class: "ict-details-section-title" }, text);
  }

  /**
   * Converte una stringa con newline in un frammento DOM con tag <br>.
   *
   * @param {string} text - Testo da processare.
   * @returns {DocumentFragment} Frammento con testo e interruzioni di riga.
   */
  function textWithLineBreaks(text) {
    const frag = document.createDocumentFragment();
    String(text).split("\n").forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement("br"));
      frag.appendChild(document.createTextNode(line));
    });
    return frag;
  }

  /**
   * Crea il pulsante "Vedi nella gerarchia" per un codice specifico.
   *
   * @param {string} code - Codice target.
   * @returns {HTMLElement} Elemento div contenente il pulsante.
   */
  function buildHierarchyActionButton(code) {
    return element("div", { class: "ict-details-actions" },
      element("button", {
        type: "button",
        class: "ict-hierarchy-btn",
        "data-action": "see-in-hierarchy",
        "data-code": code,
      },
        element("span", { class: "ict-hierarchy-icon", "aria-hidden": "true" }, "⌘"),
        " Vedi nella gerarchia"
      )
    );
  }

  /**
   * Crea una lista (UL) di link associati cliccabili.
   *
   * @param {Array<{code: string, title?: string}>} items - Lista di entità associate.
   * @param {boolean} [withTitle=true] - Se mostrare anche il titolo accanto al codice.
   * @returns {HTMLElement} Elemento UL.
   */
  function buildAssocLinkList(items, withTitle = true) {
    const ul = element("ul", { class: "ict-details-assoc-list" });
    items.forEach((it) => {
      const li = element("li", {},
        element("span", { class: "ict-assoc-link", "data-code": it.code }, it.code)
      );
      if (withTitle && it.title) {
        li.appendChild(document.createTextNode(" "));
        li.appendChild(element("span", { class: "ict-assoc-title" }, it.title));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  /**
   * buildResultDetailsDom — pannello Details inline sotto un risultato di ricerca.
   * Sezioni: Termini Corrispondenti, Descrizione, Inclusioni, Esclusioni,
   * Categorie correlate (perinatale), Vedi nella gerarchia.
   *
   * Ritorna un DocumentFragment costruito tramite element() --> tutti i valori
   * dinamici (titoli, descrizioni, codici) sono nodi di testo nativi: nessuna
   * concatenazione HTML, niente innerHTML in this code path --> XSS structurally
   * impossibile (i dati API non possono iniettare markup).
   *
   * @param {Object} entity     — risultato di ricerca (shape leggero).
   * @param {Object} resolved   — payload di /resolve (non usato attualmente).
   * @param {Object} fullEntity — payload di /entity con incl/excl.
   * @returns {DocumentFragment}
   */
  function buildResultDetailsDom(entity, resolved, fullEntity) {
    const frag = document.createDocumentFragment();

    const terms = getMatchingTerms(entity, fullEntity);
    if (terms.length > 0) {
      frag.appendChild(sectionTitle("Termini Corrispondenti"));
      const ul = element("ul", { class: "ict-details-terms" });
      terms.forEach((t) => ul.appendChild(element("li", {}, t)));
      frag.appendChild(ul);
    }

    const inclusions = fullEntity.inclusions || entity.inclusions || "";
    if (inclusions) {
      frag.appendChild(sectionTitle("Inclusioni"));
      const box = element("div", { class: "ict-details-meta" });
      box.appendChild(textWithLineBreaks(inclusions));
      frag.appendChild(box);
    }

    const exclusions = fullEntity.exclusions || entity.exclusions || "";
    if (exclusions) {
      const exclNode = renderExclusionsDom(exclusions);
      if (exclNode) {
        frag.appendChild(sectionTitle("Esclusioni"));
        frag.appendChild(exclNode);
      }
    }

    if (entity.code) {
      frag.appendChild(buildHierarchyActionButton(entity.code));
    }

    if (!frag.childNodes.length) {
      frag.appendChild(element("div", { class: "ict-mt-empty" }, "—"));
    }
    return frag;
  }

  /**
   * Chiude la finestra dei risultati per una specifica istanza.
   * Invalida anche eventuali ricerche asincrone in corso.
   *
   * @param {string|number} ino - Identificatore istanza.
   */
  function clearWindow(ino) {
    const inst = instances[ino];
    if (!inst) return;
    // Invalida fetch in-flight: response obsolete vengono scartate da doSearch
    inst.searchGen = (inst.searchGen || 0) + 1;
    if (inst.windowBody) inst.windowBody.innerHTML = "";
    if (inst.window) inst.window.style.display = "none";
  }

  /**
   * Rimuove il pannello dei dettagli inline associato a un'istanza.
   *
   * @param {Object} inst - Oggetto stato dell'istanza.
   */
  function clearDetails(inst) {
    if (inst.detailsBox) {
      inst.detailsBox.remove();
      inst.detailsBox = null;
    }
  }



  /**
   * Costruisce l'elenco dei termini suggeriti basato sui risultati correnti.
   * Filtra per frequenza e pertinenza rispetto alla query.
   *
   * @param {Array} results - Risultati della ricerca.
   * @param {string} query  - Stringa cercata dall'utente.
   * @returns {string[]} Lista di termini (max 30).
   */
  function buildWordList(results, query) {
    const counts = new Map();
    const qLow = (query || "").toLowerCase().trim();
    const STOP = new Set(["per", "con", "del", "della", "delle", "dei", "degli", "una", "uno", "gli", "sul", "sui", "sulla", "alla", "alle", "dal", "dalla", "nel", "nella", "non", "che", "ecc", "via", "cui", "ad", "dello", "loro", "tra", "fra"]);
    results.forEach((r) => {
      const text = (r.title || "");
      text.split(/[\s,;:.()\[\]\/\-+'"`]+/).forEach((w) => {
        const wn = w.toLowerCase().replace(/[^a-zà-ÿ0-9]+/gi, "");
        if (wn.length < 3) return;
        if (STOP.has(wn)) return;
        if (qLow && !wn.includes(qLow)) return;
        counts.set(wn, (counts.get(wn) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([w]) => w);
  }

  /**
   * Estrae i termini corrispondenti (titolo, preferred term, inclusioni) per un'entità.
   * Utilizzato per popolare la sezione "Termini Corrispondenti".
   *
   * @param {Object} entity     - Entità base.
   * @param {Object} fullEntity - Dati completi dell'entità.
   * @returns {string[]} Lista di termini univoci.
   */
  function getMatchingTerms(entity, fullEntity) {
    const terms = [];
    const seen = new Set();
    const push = (t) => {
      const v = (t || "").trim();
      if (!v) return;
      const k = v.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      terms.push(v);
    };
    push(fullEntity.title || entity.title);
    push(fullEntity.preferredTerm);
    const incl = fullEntity.inclusions || entity.inclusions;
    if (incl) incl.split(/\n+/).forEach(push);
    return terms;
  }

  /**
   * Analizza il testo delle esclusioni per estrarre descrizioni e codici associati.
   *
   * @param {string} text - Testo crudo delle esclusioni.
   * @returns {Array<{name: string, codes: string[]}>} Lista di esclusioni parlate.
   */
  function parseExclusions(text) {
    const codeRe = /\[([A-Z]\d{2}(?:\.[\d-]+)?(?:-[A-Z]?\d{2}(?:\.[\d-]+)?)?)\]/g;
    const raw = String(text || "").split("\n").map(l => l.trim()).filter(Boolean);
    // Merge: linea che termina con ":" --> unisci con la successiva (es.
    // "meningite da:" + "herpes virus [B00.3]" --> "meningite da: herpes virus [B00.3]").
    const lines = [];
    for (let i = 0; i < raw.length; i++) {
      let line = raw[i];
      // Merge incatenati: "a:\nb:\nc" --> "a: b: c". Sequenze di ":" continuano fino a riga non terminante in ":".
      while (line.endsWith(":") && i + 1 < raw.length) {
        i++;
        line = line + " " + raw[i];
      }
      lines.push(line);
    }
    return lines.map(line => {
      const codes = [];
      const name = line.replace(codeRe, (_, c) => { codes.push(c); return ""; })
        .replace(/\s+/g, " ").trim();
      return { name, codes };
    });
  }

  /**
   * renderExclusionsDom — costruisce la lista esclusioni (.ict-excl-list) come
   * vero albero DOM. Ogni codice diventa un <span.ict-assoc-link data-code="…">
   * con il codice come nodo di testo (no innerHTML).
   *
   * @param {string} text — testo dal campo `exclusions` dell'entità.
   * @returns {HTMLUListElement|null} — null se non ci sono righe valide.
   */
  function renderExclusionsDom(text) {
    const items = parseExclusions(text);
    if (!items.length) return null;
    const ul = element("ul", { class: "ict-excl-list" });
    items.forEach(({ name, codes }) => {
      const li = element("li", { class: "ict-excl-item" },
        element("span", { class: "ict-excl-name" }, name)
      );
      if (codes.length) {
        const codesWrap = element("span", { class: "ict-excl-codes" });
        codes.forEach((c, i) => {
          if (i > 0) codesWrap.appendChild(document.createTextNode(" "));
          codesWrap.appendChild(
            element("span", { class: "ict-assoc-link", "data-code": c }, `[${c}]`)
          );
        });
        li.appendChild(codesWrap);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  /**
   * getDetailsDom — pannello dettagli completo come DocumentFragment.
   *
   * Riusato sia dal popup inline (renderDetails) sia dal pannello destro del
   * Browser (selectBrowserNode) sia dalla modale ICT.showDetail. Le sezioni
   * sono identiche al precedente getDetailsHTML, ma la costruzione è 100%
   * DOM-based via element(): zero `innerHTML`, zero concatenazione di stringhe
   * --> niente vettore XSS anche se l'API ritornasse markup non-sanitizzato.
   *
   * @param {Object} entity     — entità "leggera" (da search/click) o full.
   * @param {Object} resolved   — payload di /resolve (può essere null).
   * @param {Object} fullEntity — payload di /entity (può coincidere con entity).
   * @param {{showHierarchyButton?: boolean}} [opts]
   *   showHierarchyButton: se false, omette il bottone "Vedi nella gerarchia"
   *   (default true; usato false dentro la stessa gerarchia per evitare loop UX).
   * @returns {DocumentFragment}
   */
  function getDetailsDom(entity, resolved, fullEntity, opts = {}) {
    const { showHierarchyButton = true } = opts;
    const frag = document.createDocumentFragment();

    // Header (titolo + codice)
    const headerClass = "ict-details-header" + (entity.classKind === "chapter" ? " ict-details-chapter" : "");
    const header = element("div", { class: headerClass });
    if (entity.classKind === "chapter") {
      header.appendChild(
        element("div", { class: "ict-details-code" }, element("strong", {}, entity.code || ""))
      );
      header.appendChild(element("div", { class: "ict-details-title-text" }, entity.title || ""));
    } else {
      header.appendChild(
        element("span", { class: "ict-details-code" }, element("strong", {}, entity.code || ""))
      );
      header.appendChild(
        element("span", {
          class: "ict-details-title-text",
          style: "display:inline-block; margin-left:6px;",
        }, entity.title || "")
      );
    }
    frag.appendChild(header);

    // Badge meta (ICD-9-CM, AHRQ, validità)
    const metaBadges = [];
    const icd9 = fullEntity.icd9cmCode || entity.icd9cmCode;
    if (icd9) metaBadges.push(`ICD-9-CM: ${icd9}`);
    const ahrq = fullEntity.ahrqClass || entity.ahrqClass;
    if (ahrq) metaBadges.push(`AHRQ: ${ahrq}`);
    if (fullEntity.validFrom) metaBadges.push(`Valido dal: ${fullEntity.validFrom}`);
    if (fullEntity.validTo) metaBadges.push(`Valido al: ${fullEntity.validTo}`);

    if (metaBadges.length > 0) {
      const badges = element("div", { class: "ict-details-badges" });
      metaBadges.forEach((b) => badges.appendChild(element("span", { class: "ict-details-badge" }, b)));
      frag.appendChild(badges);
    }

    // Griglia meta (Padre, Tipo, Terminale)
    const grid = element("div", { class: "ict-details-grid" });
    const gridItem = (label, valueNode) => {
      const it = element("div", { class: "ict-details-grid-item" },
        element("span", { class: "ict-details-grid-label" }, label)
      );
      const valueWrap = element("span", { class: "ict-details-grid-value" });
      if (valueNode instanceof Node) valueWrap.appendChild(valueNode);
      else valueWrap.appendChild(document.createTextNode(String(valueNode ?? "N/D")));
      it.appendChild(valueWrap);
      return it;
    };
    if (entity.classKind !== "chapter") {
      const parentNode = entity.parent
        ? element("span", { class: "ict-assoc-link", "data-code": entity.parent }, entity.parent)
        : null;
      grid.appendChild(gridItem("Padre", parentNode || "N/D"));
    }
    grid.appendChild(gridItem("Tipo", entity.classKind || "N/D"));
    grid.appendChild(gridItem("Terminale", entity.isTerminal ? "sì" : "no"));
    frag.appendChild(grid);

    // Termini Corrispondenti
    const terms = getMatchingTerms(entity, fullEntity);
    if (terms.length > 0) {
      frag.appendChild(sectionTitle("Termini Corrispondenti"));
      const ul = element("ul", { class: "ict-details-terms" });
      terms.forEach((t) => ul.appendChild(element("li", {}, t)));
      frag.appendChild(ul);
    }

    // Inclusioni
    const inclusions = fullEntity.inclusions || entity.inclusions || "";
    if (inclusions) {
      frag.appendChild(sectionTitle("Inclusioni"));
      const box = element("div", { class: "ict-details-meta" });
      box.appendChild(textWithLineBreaks(inclusions));
      frag.appendChild(box);
    }

    // Esclusioni
    const exclusions = fullEntity.exclusions || entity.exclusions || "";
    if (exclusions) {
      const exclNode = renderExclusionsDom(exclusions);
      if (exclNode) {
        frag.appendChild(sectionTitle("Esclusioni"));
        frag.appendChild(exclNode);
      }
    }

    // Note generali
    const notes = fullEntity.generalNotes || entity.generalNotes || "";
    if (notes) {
      frag.appendChild(sectionTitle("Note"));
      const box = element("div", { class: "ict-details-meta" });
      box.appendChild(textWithLineBreaks(notes));
      frag.appendChild(box);
    }

    // See in hierarchy
    if (showHierarchyButton && entity.code) {
      frag.appendChild(buildHierarchyActionButton(entity.code));
    }

    return frag;
  }

  /**
   * Collega i pulsanti "Vedi nella gerarchia" all'interno di un contenitore.
   * Se l'istanza è associata a un Browser, sincronizza l'albero; altrimenti apre un popup.
   *
   * @param {HTMLElement} container - Elemento contenitore dei pulsanti.
   * @param {string|number} ino     - Identificatore istanza.
   */
  function wireHierarchyButtons(container, ino) {
    container.querySelectorAll('[data-action="see-in-hierarchy"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const code = btn.getAttribute("data-code");
        if (!code) return;
        if (ino && browserInstances[ino]) {
          syncBrowserToCode(code, ino);
          const bInst = browserInstances[ino];
          if (bInst?.container?.scrollIntoView) {
            bInst.container.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        } else {
          // Pass ino --> popup mostra btn "Seleziona" che invoca selectEntity sull'input host.
          ICT.showHierarchy(code, { ino });
        }
      });
    });
  }

  // Wira i link `.ict-assoc-link` (codici cliccabili in Exclusions / Codici associati / etc.)
  // dentro `container` agganciandoli all'input host `ino`. Strategia:
  //  - codice singolo (es. 87.92.00) --> selectEntity diretto (fetch interno)
  //  - range / stem (es. 00.00.0A-00.00.0F) --> riempie input + ricerca
  function wireAssocLinks(container, ino) {
    if (!container || ino == null) return;
    const singleRe = /^[A-Z]\d{2}(?:\.\d+)?$/;
    container.querySelectorAll(".ict-assoc-link").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const code = link.getAttribute("data-code");
        if (!code) return;
        if (singleRe.test(code)) {
          selectEntity({ code }, ino);
        } else {
          // range/stem --> search per prefisso pulito
          const inst = instances[ino];
          if (!inst) return;
          const q = code.replace(/[\.\-]+$/, "");
          inst.input.value = q;
          doSearch(q, ino);
        }
      });
    });
  }

  // Inserisce il pannello .ict-details-box inline subito dopo la finestra
  // risultati (popupMode=false + showInlineDetails=true). Aggancia il click
  // sui codici associati (es. parent) e sul pulsante "Vedi nella gerarchia".
  function renderDetails(entity, resolved, fullEntity, inst) {
    clearDetails(inst);

    const box = document.createElement("div");
    box.className = "ict-details-box";
    box.appendChild(getDetailsDom(entity, resolved, fullEntity));
    box.querySelectorAll(".ict-assoc-link").forEach(link => {
      link.addEventListener("click", () => {
        const assocCode = link.getAttribute("data-code");
        const ino = inst.input.getAttribute("data-ict-ino");
        inst.input.value = assocCode;
        doSearch(assocCode, ino);
      });
    });

    wireHierarchyButtons(box, inst.input.getAttribute("data-ict-ino"));

    if (inst.window && inst.window.parentNode) {
      inst.window.parentNode.insertBefore(box, inst.window.nextSibling);
    } else {
      inst.input.parentNode.appendChild(box);
    }
    inst.detailsBox = box;
  }

  // SELEZIONE

  /**
   * selectEntity — seleziona un'entità:
   *  1. Aggiorna l'input con codice + titolo
   *  2. Chiama /resolve per dati risolti
   *  3. Chiama /entity per inclusioni, esclusioni, note
   *  4. Aggiorna UI (popup dettagli o Browser)
   *  5. Invoca onSelect con i dati completi
   */
  async function selectEntity(entity, ino) {
    const inst = instances[ino];
    if (!inst) return;

    inst.selected = entity;
    inst.resolvedSelection = null;

    // clearInputOnSelect: integrazioni dove la selezione è mostrata fuori dall'input
    // (es. target esterno via selectedEntityFunction) --> input pulito, niente stato
    // "selected" visivo, pronto per una nuova ricerca senza svuotamento manuale.
    if (config.clearInputOnSelect) {
      inst.input.value = "";
      inst.input.removeAttribute("data-selected-code");
      inst.input.classList.remove("ict-input-selected");
    } else {
      inst.input.value = [entity.code, entity.title].filter(Boolean).join(" — ");
      inst.input.setAttribute("data-selected-code", entity.code);
      inst.input.classList.add("ict-input-selected");
    }
    inst.clearBtn.style.display = "flex";

    // keepWindowOnSelect: lascia la window aperta + i listener intatti --> host può
    // mutare l'header (es. banner di conferma) e l'utente può re-cliccare un altro
    // risultato per cambiare selezione senza ri-fare la ricerca.
    if (!config.keepWindowOnSelect) clearWindow(ino);

    // Anti-race: gen counter scarta callback obsoleti (utente fast-clicks 2 risultati).
    const myGen = (inst.selectGen = (inst.selectGen || 0) + 1);

    // Abort selectEntity precedente in volo --> libera fetch /resolve+/entity stale.
    if (inst.selectAbortController) {
      try { inst.selectAbortController.abort(); } catch (_) { /* no-op */ }
    }
    inst.selectAbortController = new AbortController();
    const signal = inst.selectAbortController.signal;

    try {
      // 1. Risolvi selezione (dati canonici)
      const resolved = await resolveSelection(entity.code, { signal });
      if (myGen !== inst.selectGen) return; // selezione superata da una nuova
      inst.resolvedSelection = resolved;

      // 2. Dettagli (inclusioni, esclusioni, note)
      let fullEntity = {};
      try {
        fullEntity = await apiGet(
          `${releaseBase()}/entity/${encodeURIComponent(entity.code)}`, {}, { signal }
        );
      } catch (err) {
        if (err?.name === "AbortError" || err instanceof DOMException) throw err;
        console.warn("Dettagli aggiuntivi indisponibili", err);
      }
      if (myGen !== inst.selectGen) return;

      // Se entity originale priva di title (es. click assoc-link con solo code),
      // riallinea input.value con title risolto dal fetch.
      // Skip se clearInputOnSelect: l'input deve restare vuoto.
      if (!entity.title && fullEntity?.title && !config.clearInputOnSelect) {
        inst.input.value = [entity.code, fullEntity.title].filter(Boolean).join(" — ");
      }

      // 3. Se abbinato a un Browser, aggiorna l'albero; altrimenti mostra popup inline.
      //    In popupMode i dettagli stanno nella modale gerarchia --> niente render inline.
      //    showInlineDetails:false sopprime il pannello inline (host gestisce via callback).
      if (!config.popupMode) {
        if (browserInstances[ino]) {
          syncBrowserToCode(entity.code, ino);
        } else if (config.showInlineDetails) {
          renderDetails(entity, resolved, fullEntity, inst);
        }
      }

      const uri = entityUri(entity.code);
      const selectionData = {
        iNo: ino,
        code: entity.code,
        uri,
        title: entity.title,
        preferredTerm: fullEntity.preferredTerm || entity.preferredTerm || entity.title,
        icd9cmCode: fullEntity.icd9cmCode || entity.icd9cmCode,
        ahrqClass: fullEntity.ahrqClass || entity.ahrqClass,
        isTerminal: entity.isTerminal,
        parent: entity.parent,
        classKind: entity.classKind,
        section: fullEntity.section || entity.section,
      };

      // popupMode: banner di selezione nell'header della finestra (lib-managed).
      if (config.popupMode) updateSelectedBanner(selectionData);

      if (typeof config.selectedEntityFunction === "function") {
        try { config.selectedEntityFunction(selectionData); } catch (e) { console.error(e); }
      }
      if (typeof config.onSelect === "function") {
        // Wrap try/catch: throw dell'host NON deve far cadere nel catch outer -->
        // evita double-fire con errorPayload.
        try { config.onSelect(selectionData); } catch (e) { console.error(e); }
      }
      const icb = instanceCallbacks[ino];
      if (icb && typeof icb.onSelect === "function") {
        try { icb.onSelect(selectionData); } catch (e) { console.error(e); }
      }
    } catch (err) {
      // Selezione superata o abortita: no callback host (race-safe).
      if (myGen !== inst.selectGen) return;
      if (err?.name === "AbortError" || err instanceof DOMException) return;

      // Fallback senza risoluzione: onSelect riceve i dati base + resolutionError
      const errorPayload = {
        iNo: ino,
        code: entity.code,
        uri: entityUri(entity.code),
        title: entity.title,
        preferredTerm: entity.preferredTerm || entity.title,
        icd9cmCode: entity.icd9cmCode,
        ahrqClass: entity.ahrqClass,
        isTerminal: entity.isTerminal,
        parent: entity.parent,
        classKind: entity.classKind,
        section: entity.section,
        resolutionError: err.message,
      };

      inst.resolvedSelection = errorPayload;

      if (typeof config.selectedEntityFunction === "function") {
        try { config.selectedEntityFunction(errorPayload); } catch (e) { console.error(e); }
      }
      if (typeof config.onSelect === "function") {
        try { config.onSelect(errorPayload); } catch (e) { console.error(e); }
      }
      const icb = instanceCallbacks[ino];
      if (icb && typeof icb.onSelect === "function") {
        try { icb.onSelect(errorPayload); } catch (e) { console.error(e); }
      }
    }
  }

  // RICERCA

  /**
   * doSearch — esegue la ricerca e popola la finestra risultati.
   */
  async function doSearch(q, ino) {
    const inst = instances[ino];
    if (!inst) return;

    const myGen = ++inst.searchGen;
    const win = inst.window;
    const winBody = inst.windowBody || win;

    if (q.length < 2) {
      clearWindow(ino);
      return;
    }

    // Annulla fisicamente la fetch precedente (se ancora pendente) --> libera
    // banda client + connessione server invece di lasciarla droppare al `searchGen` check.
    if (inst.searchAbortController) {
      try { inst.searchAbortController.abort(); } catch (_) { /* no-op */ }
    }
    inst.searchAbortController = new AbortController();
    const signal = inst.searchAbortController.signal;

    if (typeof config.onSearchStart === "function") config.onSearchStart(ino);
    winBody.innerHTML = '<div class="ict-loading">Ricerca in corso…</div>';
    win.style.display = "flex";

    try {
      const data = await apiGet(`${releaseBase()}/search`, {
        q,
        terminalOnly: config.terminalOnly || undefined,
        pageSize: config.pageSize,
      }, { signal });

      if (myGen !== inst.searchGen) return; // risposta obsoleta la scarta
      winBody.innerHTML = "";

      if (!data.results || data.results.length === 0) {
        winBody.appendChild(
          element("div", { class: "ict-empty" }, `Nessun risultato per "${q}"`),
        );
        return;
      }

      // Layout: Word list (sinistra, opzionale) + Destination Entities (destra)
      const layout = element("div", { class: "ict-search-layout" });

      // Word list: tokens unici dai title dei risultati che contengono la query.
      // showWordList:false --> 1-col layout (solo Destination Entities), utile per
      // integrazioni con Browser tree dove i suggerimenti termini sono ridondanti.
      if (config.showWordList) {
        const wlCol = element("div", { class: "ict-wordlist-col" });
        wlCol.appendChild(
          element("div", { class: "ict-results-header ict-wordlist-header" },
            element("span", { class: "ict-res-head-title" }, "Elenco Termini")
          )
        );
        const words = buildWordList(data.results, q);
        if (words.length === 0) {
          wlCol.appendChild(element("div", { class: "ict-empty" }, "—"));
        } else {
          const wlBox = element("div", { class: "ict-wordlist" });
          words.forEach((w) => {
            wlBox.appendChild(element("div", {
              class: "ict-wordlist-item",
              on: {
                click: (e) => {
                  // stopPropagation: doSearch sostituisce winEl.innerHTML -->
                  // e.target diventa orfano --> document click handler vedrebbe
                  // !winEl.contains(target) e chiuderebbe la window.
                  e.stopPropagation();
                  inst.input.value = w;
                  inst.input.removeAttribute("data-selected-code");
                  inst.input.classList.remove("ict-input-selected");
                  inst.selected = null;
                  inst.resolvedSelection = null;
                  inst.clearBtn.style.display = "flex";
                  inst.input.focus();
                  doSearch(w, ino);
                },
              },
            }, w));
          });
          wlCol.appendChild(wlBox);
        }
        layout.appendChild(wlCol);
      }

      // Destination Entities: risultati API con MT espandibili
      const deCol = element("div", { class: "ict-results-col" });
      const kbShortcuts = element("div", { class: "ict-keyboard-shortcuts" });
      kbShortcuts.innerHTML = `
        <span class="ict-keyboard-icon">⌨</span>
        <div class="ict-keyboard-tooltip">
          <div class="ict-kb-title">⌨ Scorciatoie da tastiera:</div>
          <ul class="ict-kb-list">
            <li><span class="ict-kb-key">Freccia Giù</span> e <span class="ict-kb-key">Freccia Su</span> per scorrere i Risultati</li>
            <li><span class="ict-kb-key">Freccia Destra</span> per aprire i dettagli</li>
            <li><span class="ict-kb-key">Freccia Sinistra</span> o <span class="ict-kb-key">Esc</span> per chiudere i dettagli</li>
            <li><span class="ict-kb-key">Invio</span> per selezionare il codice</li>
          </ul>
        </div>
      `;

      deCol.appendChild(
        element("div", { class: "ict-results-header" },
          element("span", { class: "ict-res-head-title" }, "Risultati"),
          element("div", { class: "ict-res-head-right" },
            element("span", { class: "ict-res-head-sort" }, "ordina per: Corrispondenza"),
            kbShortcuts
          )
        )
      );
      const list = element("div", { class: "ict-results", role: "listbox" });
      data.results.forEach((r) => list.appendChild(renderResult(r, ino)));
      deCol.appendChild(list);

      if (data.total > data.pageSize) {
        deCol.appendChild(
          element(
            "div",
            { class: "ict-more" },
            `Mostrati ${data.results.length} di ${data.total} risultati`,
          ),
        );
      }

      layout.appendChild(deCol);
      winBody.appendChild(layout);

      // Se popupMode: pulisci eventuali banner di selezioni precedenti su nuova ricerca.
      if (config.popupMode) {
        const header = deCol.querySelector(".ict-results-header");
        const prev = header?.querySelector(".ict-selected-banner");
        if (prev) prev.remove();
      }

      // Reattività browser tree: posiziona l'albero sul primo risultato della ricerca.
      // Solo se esiste un Browser legato a questo ino e revealInTreeOnSearch=true.
      if (config.revealInTreeOnSearch && browserInstances[ino] && data.results[0]?.code) {
        revealInTree(data.results[0].code, ino).catch(() => { });
      }
    } catch (err) {
      if (myGen !== inst.searchGen) return;
      // Abort intenzionale: no errore in UI (richiesta superata da una nuova).
      if (err?.name === "AbortError" || err instanceof DOMException) return;
      winBody.innerHTML = `<div class="ict-error">Errore: ${esc(err.message)}</div>`;
    } finally {
      if (typeof config.onSearchEnd === "function") config.onSearchEnd(ino);
    }
  }

  /**
   * initInstance — collega un <input data-ict-ino> alla logica CODIT.
   *
   * DOM prodotto:
   *   <div class="ict-input-wrapper">  --> position:relative, serve al pulsante ×
   *     <input class="ict-input" />
   *     <button class="ict-clear-btn">×</button>
   *     <div class="ict-window" />     --> popup risultati, position:absolute
   *   </div>
   */
  function initInstance(inputEl) {
    // Input agganciato a popup (popupMode/attach) --> non istanziare inline
    if (inputEl.dataset.ictPopupAttached) return;

    let ino = inputEl.getAttribute("data-ict-ino");

    if (!ino) {
      ino = "1";
      console.warn('CIPI-CODIT: data-ict-ino mancante, uso fallback "1"');
      inputEl.setAttribute("data-ict-ino", ino);
    }

    if (instances[ino]) {
      console.warn(`CIPI-CODIT: istanza "${ino}" già inizializzata, input ignorato`);
      return;
    }

    // input nel wrapper se non è già presente (necessario per position:absolute del ×)
    let wrapper = inputEl.parentNode;
    if (!wrapper || !wrapper.classList.contains("ict-input-wrapper")) {
      wrapper = document.createElement("div");
      wrapper.className = "ict-input-wrapper";
      inputEl.parentNode.insertBefore(wrapper, inputEl);
      wrapper.appendChild(inputEl);
    }
    // inlineResults: layout a blocco full-width, window in flow normale invece di dropdown.
    if (config.inlineResults) wrapper.classList.add("ict-input-wrapper--inline");

    let clearBtn = wrapper.querySelector(".ict-clear-btn");
    if (!clearBtn) {
      clearBtn = document.createElement("button");
      clearBtn.className = "ict-clear-btn";
      clearBtn.type = "button";
      clearBtn.innerHTML = "&times;";
      clearBtn.title = "Pulisci ricerca";
      wrapper.appendChild(clearBtn);
    }

    // La finestra risultati viene creata se non esiste già nel DOM.
    // Struttura: .ict-window > [.ict-popover-header (popupMode)] + .ict-window-body
    let winEl = document.querySelector(`.ict-window[data-ict-ino="${ino}"]`);
    if (!winEl) {
      winEl = document.createElement("div");
      winEl.className = "ict-window";
      winEl.setAttribute("data-ict-ino", ino);
    }
    if (winEl.parentNode !== wrapper) {
      wrapper.appendChild(winEl);
    }
    winEl.style.display = "none";
    // inlineResults: variante "static flow" mutuamente esclusiva con popupMode.
    if (config.inlineResults && !config.popupMode) winEl.classList.add("ict-window--inline");

    // Header floating popover (popupMode=true): solo X chiudi (no titolo)
    if (config.popupMode) {
      winEl.classList.add("ict-window--popover");
      const winHeader = document.createElement("div");
      winHeader.className = "ict-popover-header";
      const hClose = document.createElement("button");
      hClose.type = "button";
      hClose.className = "ict-popover-close";
      hClose.innerHTML = "&times;";
      hClose.title = "Chiudi";
      hClose.addEventListener("click", (e) => {
        e.stopPropagation();
        ICT.Handler.clear(ino);
      });
      winHeader.appendChild(hClose);
      winEl.appendChild(winHeader);
    }

    // Body container: dove vengono renderizzati risultati / vista dettagli
    let winBody = winEl.querySelector(".ict-window-body");
    if (!winBody) {
      winBody = document.createElement("div");
      winBody.className = "ict-window-body";
      winEl.appendChild(winBody);
    }

    clearBtn.addEventListener("click", () => {
      ICT.Handler.clear(ino);
      inputEl.focus();
    });

    const debouncedSearch = debounce((q) => doSearch(q, ino), config.debounceMs);

    // Clear btn: sempre visibile accanto all'input (no toggle).
    clearBtn.style.display = "flex";

    // Focus su input con codice già selezionato --> select-all per facilitare la riscrittura
    inputEl.addEventListener("focus", () => {
      if (inputEl.getAttribute("data-selected-code")) {
        setTimeout(() => inputEl.select(), 0);
      }
    });

    inputEl.addEventListener("input", (e) => {
      const q = e.target.value.trim();

      if (inputEl.getAttribute("data-selected-code")) {
        inputEl.removeAttribute("data-selected-code");
        inputEl.classList.remove("ict-input-selected");
        const inst = instances[ino];
        if (inst) {
          inst.selected = null;
          inst.resolvedSelection = null;
        }
      }

      if (!q) {
        clearWindow(ino);
        if (typeof config.onClear === "function") config.onClear(ino);
      } else {
        debouncedSearch(q);
      }
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        clearWindow(ino);
        inputEl.blur();
        return;
      }

      const inst = instances[ino];
      if (!inst) return;

      const scope = inst.windowBody || inst.window;
      const items = scope.querySelectorAll(".ict-result:not(.ict-result-disabled)");
      if (!items.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[0].focus();
        items[0].scrollIntoView({ block: "nearest" });
      }
    });

    // Doc click handler salvato in inst così deregister può rimuoverlo (no leak).
    const onDocClick = (e) => {
      // Skip se click dentro un popup ICT (modale gerarchia/dettagli) --> evita
      // che interazioni con tree/dettagli nel popup chiudano la window inline sotto.
      if (e.target.closest && e.target.closest(".ict-popup-overlay")) return;
      if (!inputEl.contains(e.target) && !winEl.contains(e.target) && !clearBtn.contains(e.target))
        clearWindow(ino);
    };
    document.addEventListener("click", onDocClick);

    instances[ino] = {
      input: inputEl,
      window: winEl,
      windowBody: winBody,
      clearBtn: clearBtn,
      detailsBox: null,
      selected: null,
      resolvedSelection: null,
      searchGen: 0,
      selectGen: 0,
      // AbortController della fetch /search corrente. Annullato da doSearch
      // su nuova digitazione e da Handler.deregister sull'unmount.
      searchAbortController: null,
      // AbortController della selezione corrente (/resolve+/entity). Annullato
      // da selectEntity su nuova selezione e da Handler.deregister.
      selectAbortController: null,
      onDocClick,
    };
  }

  /**
   * Aggiorna il banner informativo del codice selezionato nell'header (popupMode:true).
   *
   * @param {SelectionData} data - Dati della selezione.
   */
  function updateSelectedBanner(data) {
    const inst = instances[data.iNo];
    if (!inst) return;
    const header = inst.windowBody?.querySelector(".ict-results-col .ict-results-header")
      || inst.window?.querySelector(".ict-results-col .ict-results-header");
    if (!header) return;

    const prev = header.querySelector(".ict-selected-banner");
    if (prev) prev.remove();

    const banner = document.createElement("span");
    banner.className = "ict-selected-banner";
    banner.textContent = `Selezione: ${data.code}`;

    const title = header.querySelector(".ict-res-head-title");
    if (title) title.insertAdjacentElement("afterend", banner);
    else header.appendChild(banner);
  }

  // Impedisce doppia inizializzazione se configure() è già stato chiamato esplicitamente
  let isAutoConfigured = false;

  // PUBLIC API

  /**
   * @typedef {Object} HandlerFieldSpec
   * @property {string|HTMLInputElement} input       — selettore o elemento input host.
   * @property {string|HTMLElement}     [button]     — trigger esterno (apre Popup).
   * @property {string|HTMLElement}     [detailButton] — tasto "Vedi Dettagli" abilitato post-select.
   * @property {string}  [title]
   * @property {string}  [placeholder]
   * @property {boolean} [withBrowser]
   * @property {function}[format]      — `(data) => string` per la scrittura nell'input host.
   * @property {function}[onSelect]    — `(data, inputEl) => void` override per-field.
   * @property {function}[onClose]
   * @property {"focus"|"click"|"button"} [trigger]
   * @property {boolean|string|function}  [feedback]
   */

  /**
   * @typedef {Object} HandlerSettings
   * @property {string}   [apiBaseUrl]      — endpoint API base (default `http://localhost:8000/api/index.php`).
   * @property {string}   [releaseId]       — ID release CIPI (default "20251215").
   * @property {number}   [debounceMs]      — debounce ricerca (default 150ms).
   * @property {number}   [pageSize]        — risultati per pagina (default 15).
   * @property {boolean}  [terminalOnly]    — se true mostra solo terminali.
   * @property {boolean}  [popupMode]       — render window come popover floating.
   * @property {function} [isDisabled]      — `(code, ino) => boolean` per disabilitare codici già selezionati altrove.
   * @property {HandlerFieldSpec[]} [fields] — auto-attach lista di input.
   * @property {function} [onSelect]
   * @property {function} [onClear]
   * @property {function} [onSearchStart]
   * @property {function} [onSearchEnd]
   * @property {function} [selectedEntityFunction] — alias WHO CODIT v1.8 di onSelect.
   */

  /**
   * @typedef {Object} HandlerCallbacks
   * @property {function} [onSelect]               — `(data) => void` su selezione.
   * @property {function} [onClear]                — `(ino) => void` su clear.
   * @property {function} [onSearchStart]
   * @property {function} [onSearchEnd]
   * @property {function} [selectedEntityFunction] — standard WHO CODIT v1.8, invocato PRIMA di onSelect.
   */

  /**
   * @typedef {Object} SelectionData
   * @property {string}  iNo
   * @property {string}  code
   * @property {string}  uri
   * @property {string}  [title]
   * @property {string}  [preferredTerm]
   * @property {string}  [icd9cmCode]
   * @property {string}  [ahrqClass]
   * @property {string}  [section]
   * @property {boolean} [isTerminal]
   * @property {string}  [parent]
   * @property {string}  [classKind]
   * @property {string}  [resolutionError]     — presente solo se /resolve fallisce.
   */

  /**
   * ICT — interfaccia pubblica della libreria.
   *
   *   ICT.Handler  --> gestione input di ricerca
   *   ICT.Browser  --> browser ad albero gerarchico (modulo opzionale)
   *
   *   entry point diverso (ICT vs CODIT, data-ict-ino vs data-ino)
   */
  const ICT = {
    Handler: {
      /**
       * Configura la libreria globalmente e collega tutti gli input
       * `<input data-ict-ino="…">` presenti nel DOM. Idempotente: una seconda
       * chiamata sovrascrive la config corrente. Compatibile WHO CODIT v1.8:
       * `callbacks.selectedEntityFunction` viene invocata PRIMA di `onSelect`
       * (entrambi vengono comunque chiamati per retrocompatibilità).
       *
       * Pickup precedenza per ogni callback: `callbacks.X ?? settings.X ?? null`.
       *
       * @param {HandlerSettings}  [settings]   — config globale.
       * @param {HandlerCallbacks} [callbacks]  — callback (firma 2-param WHO CODIT v1.8).
       * @returns {void}
       *
       * @example
       * CODIT.Handler.configure({ apiBaseUrl, releaseId }, {
       *   selectedEntityFunction: (data) => console.log(data.code),
       * });
       */
      configure(settings = {}, callbacks = {}) {
        isAutoConfigured = true;
        config = {
          ...DEFAULT_CONFIG,
          ...settings,
          onSelect: callbacks.onSelect ?? settings.onSelect ?? null,
          onClear: callbacks.onClear ?? settings.onClear ?? null,
          onSearchStart: callbacks.onSearchStart ?? settings.onSearchStart ?? null,
          onSearchEnd: callbacks.onSearchEnd ?? settings.onSearchEnd ?? null,
          // WHO CODIT v1.8: callbacks.selectedEntityFunction (alias di onSelect).
          // Se entrambi presenti, vengono invocati entrambi (callbacks.selectedEntityFunction prima).
          selectedEntityFunction:
            callbacks.selectedEntityFunction ?? settings.selectedEntityFunction ?? null,
        };

        // Ultra-low-code: settings.fields = [{input, button?, title?, placeholder?,
        // withBrowser?, format?, onSelect?, onClose?, trigger?}, ...]
        // Per ogni voce viene chiamata ICT.attach con i parametri specificati.
        // PRIMA del scan inline: attach marca gli input host (dataset.ictPopupAttached)
        // così initInstance li salta --> no double behavior (inline + popup).
        if (Array.isArray(settings.fields)) {
          settings.fields.forEach((f) => {
            if (!f || !f.input) return;
            ICT.attach(f.input, {
              trigger: f.trigger || (f.button ? "button" : "focus"),
              button: f.button,
              detailButton: f.detailButton,
              title: f.title,
              placeholder: f.placeholder ?? settings.placeholder,
              withBrowser: f.withBrowser ?? settings.withBrowser ?? true,
              format: f.format ?? settings.format,
              onSelect: f.onSelect ?? settings.onFieldSelect,
              onClose: f.onClose,
              feedback: f.feedback ?? settings.feedback,
            });
          });
        }

        // Ricerca SEMPRE inline (2-col Word list + Destination Entities).
        // Quando popupMode=true, il click su un risultato apre la modale
        // gerarchia+dettagli con bottone "Seleziona" (vedi renderResult).
        document.querySelectorAll("input[data-ict-ino]").forEach(initInstance);
      },

      /**
       * Esegue programmaticamente una ricerca su una specifica istanza,
       * aggiornando il valore dell'input host. La debounce non viene applicata
       * (caller-driven).
       *
       * @param {string|number} ino — identificatore istanza (`data-ict-ino`).
       * @param {string}        q   — query (min 2 char per innescare fetch).
       * @returns {void}
       */
      search(ino, q) {
        const inst = instances[String(ino)];
        if (!inst) return;
        inst.input.value = q;
        doSearch(q, String(ino));
      },

      /**
       * Resetta una istanza al suo stato neutro: pulisce l'input, rimuove la
       * selezione corrente, chiude la finestra risultati + pannello dettagli
       * inline, collassa il Browser tree (se presente) e invoca i callback
       * `onClear` (globale e per-istanza, in quest'ordine).
       *
       * @param {string|number} ino
       * @returns {void}
       */
      clear(ino) {
        const inst = instances[String(ino)];
        if (!inst) return;
        inst.input.value = "";
        inst.input.removeAttribute("data-selected-code");
        inst.input.classList.remove("ict-input-selected");
        inst.selected = null;
        inst.resolvedSelection = null;
        inst.clearBtn.style.display = "flex";
        // Aborta fetch /search pendente --> no banda sprecata, onSearchEnd subito.
        if (inst.searchAbortController) {
          try { inst.searchAbortController.abort(); } catch (_) { /* no-op */ }
          inst.searchAbortController = null;
        }
        // Aborta selezione in volo --> niente callback obsoleti post-clear.
        if (inst.selectAbortController) {
          try { inst.selectAbortController.abort(); } catch (_) { /* no-op */ }
          inst.selectAbortController = null;
        }
        clearWindow(String(ino));
        clearDetails(inst);

        if (browserInstances[ino]) {
          ICT.Browser.resetTree(ino);
        }

        if (typeof config.onClear === "function") config.onClear(String(ino));
        const icb = instanceCallbacks[String(ino)];
        if (icb && typeof icb.onClear === "function") icb.onClear(String(ino));
      },

      /**
       * @param {string|number} ino
       * @returns {Object|null} l'entità selezionata grezza (shape risultato di ricerca) o null.
       */
      getSelected(ino) {
        return instances[String(ino)]?.selected ?? null;
      },

      /**
       * @param {string|number} ino
       * @returns {Object|null} il payload `/resolve` dell'ultima selezione o null se non risolto.
       */
      getResolvedSelection(ino) {
        return instances[String(ino)]?.resolvedSelection ?? null;
      },

      /**
       * Seleziona un'entità direttamente, bypassando la ricerca testuale.
       * Equivale al click su un risultato: aggiorna UI + invoca `onSelect`.
       *
       * @param {string|number} ino
       * @param {Object} entity — almeno `{ code }`, opzionale `title`.
       * @returns {void}
       */
      selectDirect(ino, entity) {
        selectEntity(entity, String(ino));
      },

      /**
       * Rimuove un'istanza: detach document-click listener, abort fetch /search
       * pendenti, pulisce window + details. Necessario prima di re-istanziare
       * un campo con lo stesso `ino` (es. cambio popupMode).
       *
       * @param {string|number} ino
       * @returns {void}
       */
      deregister(ino) {
        const key = String(ino);
        const inst = instances[key];
        if (inst) {
          if (inst.onDocClick) document.removeEventListener("click", inst.onDocClick);
          // Abort di eventuali fetch /search ancora pendenti --> no leak di richieste in volo.
          if (inst.searchAbortController) {
            try { inst.searchAbortController.abort(); } catch (_) { /* no-op */ }
            inst.searchAbortController = null;
          }
          // Abort selezione in volo (/resolve+/entity) --> no callback host post-unmount.
          if (inst.selectAbortController) {
            try { inst.selectAbortController.abort(); } catch (_) { /* no-op */ }
            inst.selectAbortController = null;
          }
          clearWindow(key);
          clearDetails(inst);
        }
        delete instances[key];
        delete instanceCallbacks[key];
      },

      /**
       * Imposta callback specifici per una singola istanza (es. una Popup),
       * invocati DOPO i callback globali di `Handler.configure`. Passare `null`
       * per rimuoverli.
       *
       * @param {string|number} ino
       * @param {?{onSelect?: function, onClear?: function}} cbs
       * @returns {void}
       */
      setInstanceCallbacks(ino, cbs) {
        const key = String(ino);
        if (cbs == null) delete instanceCallbacks[key];
        else instanceCallbacks[key] = cbs;
      },

      /**
       * Registra eventuali nuovi `<input data-ict-ino>` aggiunti al DOM dopo la
       * chiamata iniziale a `configure()`. Idempotente.
       *
       * @returns {void}
       */
      scanNew() {
        document.querySelectorAll("input[data-ict-ino]").forEach((el) => {
          if (!instances[el.getAttribute("data-ict-ino")]) initInstance(el);
        });
      },

      /**
       * Mostra uno stato "Caricamento…" nella finestra risultati. Utile per
       * indicare al volo un'operazione async iniziata fuori dalla ricerca standard.
       *
       * @param {string|number} ino
       * @param {string} [msg="Caricamento…"]
       * @returns {void}
       */
      showLoading(ino, msg) {
        const inst = instances[String(ino)];
        if (!inst) return;
        const body = inst.windowBody || inst.window;
        body.innerHTML = `<div class="ict-loading">${esc(msg || "Caricamento…")}</div>`;
        inst.window.style.display = "flex";
      },

      /**
       * Popola la finestra risultati con un set pre-caricato di entità,
       * bypassando la fetch `/search`. Stessa shape di un risultato di ricerca.
       *
       * @param {string|number} ino
       * @param {Object[]} results
       * @param {string} [headerText="Risultati"]
       * @returns {void}
       */
      showResults(ino, results, headerText) {
        const inst = instances[String(ino)];
        if (!inst) return;
        const body = inst.windowBody || inst.window;
        body.innerHTML = "";
        if (!results || results.length === 0) {
          body.appendChild(
            element("div", { class: "ict-empty" }, headerText || "Nessun risultato")
          );
          inst.window.style.display = "flex";
          return;
        }
        const list = element("div", { class: "ict-results", role: "listbox" });
        list.appendChild(
          element("div", { class: "ict-results-header" },
            element("span", { class: "ict-res-head-title" }, headerText || "Risultati")
          )
        );
        results.forEach(r => list.appendChild(renderResult(r, String(ino))));
        body.appendChild(list);
        inst.window.style.display = "flex";
      },
    },
  };

  //Browser — albero navigabile dei codici CIPI.
  const browserInstances = {};

  // Mappa ino -> callback chiamata su ogni click di nodo nell'albero.
  // Usata da ICT.Popup per "pescare" il codice dal tree e aggiornare l'anteprima.
  // Il payload è un oggetto selezione completo (stesso shape di selectionData).
  const browserSelectCallbacks = {};

  /**
   * Inizializza un'istanza del Browser tree all'interno di un contenitore.
   * Crea i pannelli di navigazione (sinistro) e di dettaglio (destro).
   *
   * @param {HTMLElement} containerEl - Elemento contenitore (div[data-icb-ino]).
   * @returns {Promise<void>}
   */
  async function initBrowserInstance(containerEl) {
    let ino = containerEl.getAttribute("data-icb-ino");
    if (!ino) {
      ino = "1";
      containerEl.setAttribute("data-icb-ino", ino);
    }
    if (browserInstances[ino]) return;

    containerEl.classList.add("ict-browser-container");

    const leftPane = document.createElement("div");
    leftPane.className = "ict-browser-tree";

    const searchWrap = document.createElement("div");
    searchWrap.className = "ict-browser-tree-search";

    // Se esiste un input Handler con lo stesso ino, lo incorpora nel pannello sinistro
    const extInput = document.querySelector(`input[data-ict-ino="${ino}"]`);
    const extWindow = document.querySelector(`.ict-window[data-ict-ino="${ino}"]`);

    if (extInput) {
      const wrapper = extInput.closest(".ict-input-wrapper") || extInput;
      searchWrap.appendChild(wrapper);
    }
    if (extWindow) {
      searchWrap.appendChild(extWindow);
    }
    searchWrap.style.position = "relative";

    // Senza input esterno la barra search è vuota --> nascondi per evitare gap
    if (!extInput && !extWindow) {
      searchWrap.style.display = "none";
    }

    if (extWindow) {
      extWindow.style.left = "0";
      extWindow.style.right = "0";
      extWindow.style.top = "100%";
      extWindow.style.width = "auto";
    }

    const scrollPane = document.createElement("div");
    scrollPane.className = "ict-browser-tree-scroll";

    leftPane.appendChild(searchWrap);
    leftPane.appendChild(scrollPane);

    const rightPane = document.createElement("div");
    rightPane.className = "ict-browser-details";
    rightPane.innerHTML = `<div class="ict-empty" style="text-align:center; margin-top:20px; color:#6b7280;">Seleziona un nodo dall'albero per vederne i dettagli...</div>`;

    containerEl.appendChild(leftPane);
    containerEl.appendChild(rightPane);

    browserInstances[ino] = {
      container: containerEl,
      left: leftPane,
      scrollPane: scrollPane,
      right: rightPane,
      selectedNode: null
    };

    scrollPane.innerHTML = '<div class="ict-loading">Caricamento capitoli...</div>';

    try {
      const chapterData = await apiGet(`${releaseBase()}/chapter`);
      scrollPane.innerHTML = "";
      const ul = document.createElement("ul");
      ul.className = "ict-tree-list";

      chapterData.chapters.forEach(ch => {
        const li = createTreeNode(ch, ino);
        ul.appendChild(li);
      });
      scrollPane.appendChild(ul);
    } catch (err) {
      scrollPane.innerHTML = `<div class="ict-error">Impossibile caricare i capitoli: ${esc(err.message)}</div>`;
    }
  }

  // Crea un nodo <li> dell'albero con espansore e label codice+titolo
  function createTreeNode(entity, ino) {
    const li = document.createElement("li");
    li.className = "ict-tree-node";
    li.setAttribute("data-code", entity.code);

    const row = document.createElement("div");
    row.className = "ict-tree-row";
    row.setAttribute("tabindex", "0"); // focusable via Tab --> consente Enter shortcut

    const expander = document.createElement("span");
    expander.className = "ict-tree-expander";

    // Considera il nodo espandibile se ha figli noti, o se isTerminal è false/undefined
    const hasChildren = (entity.childrenCount !== undefined && entity.childrenCount > 0)
      || (entity.isTerminal === false)
      || (entity.childrenCount === undefined && entity.isTerminal === undefined);

    if (hasChildren) {
      expander.innerHTML = "▶";
      expander.classList.add("ict-has-children");
      expander.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTreeNode(li, entity.code, ino, expander);
      });
    } else {
      expander.innerHTML = '<span style="opacity: 0;">▶</span>';
    }
    row.appendChild(expander);

    const label = document.createElement("span");
    label.className = "ict-tree-label";
    if (entity.code) {
      const strong = document.createElement("strong");
      strong.textContent = entity.code;
      label.appendChild(strong);

      label.appendChild(document.createTextNode(" "));
    }
    label.appendChild(document.createTextNode(entity.title || ""));

    row.appendChild(label);

    row.addEventListener("click", () => {
      selectBrowserNode(li, entity.code, ino);
    });

    li.appendChild(row);
    return li;
  }

  /**
   * toggleTreeNode -> espande/collassa un nodo
   * I figli vengono caricati via API solo al primo expand (lazy loading)
   * forceExpand=true espande anche se già aperto (usato da syncBrowserToCode
   * per garantire che i figli siano nel DOM prima di cercarne uno specifico)
   */
  async function toggleTreeNode(li, code, ino, expander, forceExpand = false) {
    const isExpanded = li.classList.contains("ict-expanded");
    if (isExpanded && !forceExpand) {
      li.classList.remove("ict-expanded");
      expander.innerHTML = "▶";
    } else if (!isExpanded || forceExpand) {
      li.classList.add("ict-expanded");
      expander.innerHTML = "▼";

      let ul = li.querySelector("ul");
      if (!ul) {
        expander.innerHTML = "⏳";
        try {
          const data = await apiGet(`${releaseBase()}/entity/${encodeURIComponent(code)}/children`);
          ul = document.createElement("ul");
          ul.className = "ict-tree-list";
          data.children.forEach(c => {
            ul.appendChild(createTreeNode(c, ino));
          });
          li.appendChild(ul);
        } catch (err) {
          console.error("Errore caricamento figli:", err);
        } finally {
          expander.innerHTML = "▼";
        }
      }
    }
  }

  // Selezione di un nodo dell'albero: evidenzia la riga, carica /entity +
  // /resolve per il pannello dettagli destro e fa fire l'eventuale callback
  // registrata via Browser.setSelectCallback (usato dalla Popup per anteprima).
  async function selectBrowserNode(li, code, ino) {
    const inst = browserInstances[ino];
    if (!inst) return;
    if (inst.selectedNode) {
      const prevRow = inst.selectedNode.querySelector(".ict-tree-row");
      if (prevRow) prevRow.classList.remove("ict-tree-selected");
    }
    const row = li.querySelector(".ict-tree-row");
    if (row) row.classList.add("ict-tree-selected");
    inst.selectedNode = li;

    // Anti-race: gen counter scarta response obsolete (utente cambia nodo durante fetch).
    inst.detailGen = (inst.detailGen || 0) + 1;
    const myGen = inst.detailGen;

    // Annulla il caricamento dettagli precedente (se l'utente clicca un altro nodo
    // mentre la fetch è in volo) --> rilascia subito la connessione lato server.
    if (inst.detailAbortController) {
      try { inst.detailAbortController.abort(); } catch (_) { /* no-op */ }
    }
    inst.detailAbortController = new AbortController();
    const signal = inst.detailAbortController.signal;

    // Skeleton loader --> niente layout shift al termine del render reale.
    inst.right.innerHTML = "";
    inst.right.appendChild(createSkeletonDetails());

    try {
      const fullEntity = await apiGet(
        `${releaseBase()}/entity/${encodeURIComponent(code)}`, {}, { signal }
      );
      if (myGen !== inst.detailGen) return;
      let resolved = null;
      try {
        resolved = await apiGet(
          `${releaseBase()}/resolve/${encodeURIComponent(code)}`, {}, { signal }
        );
      } catch (e) {
        // /resolve è opzionale. Eccezione AbortError viene gestita dal catch outer.
        if (e?.name === "AbortError") throw e;
      }
      if (myGen !== inst.detailGen) return;

      const box = document.createElement("div");
      box.className = "ict-details-box";
      box.style.border = "none";
      box.style.boxShadow = "none";
      // Già dentro la gerarchia --> nascondi il btn "See in hierarchy" (no-op visivo).
      box.appendChild(getDetailsDom(fullEntity, resolved, fullEntity, { showHierarchyButton: false }));

      inst.right.innerHTML = "";
      inst.right.appendChild(box);

      box.querySelectorAll(".ict-assoc-link").forEach(link => {
        link.addEventListener("click", () => {
          syncBrowserToCode(link.getAttribute("data-code"), ino);
        });
      });

      // "See in hierarchy" --> scrolla l'albero corrente al codice
      wireHierarchyButtons(box, ino);

      // Notifica chi ascolta (es. ICT.Popup) che un nodo dell'albero è stato
      // "pescato" --> aggiorna anteprima e abilita conferma.
      const cb = browserSelectCallbacks[ino];
      if (typeof cb === "function") {
        cb(buildSelectionPayload(fullEntity, resolved, ino));
      }

    } catch (err) {
      if (myGen !== inst.detailGen) return;
      // Richiesta abortita dall'utente (click rapido su un altro nodo): no errore UI.
      if (err?.name === "AbortError" || err instanceof DOMException) return;
      inst.right.innerHTML = `<div class="ict-error" style="padding: 20px;">Si è verificato un errore nel caricamento: ${esc(err.message)}</div>`;
    }
  }

  /**
   * Costruisce un payload di selezione normalizzato da dati completi.
   * Garantisce coerenza tra selezioni da ricerca e da albero.
   *
   * @param {Object} fullEntity - Dati completi dall'API.
   * @param {Object} resolved   - Dati risolti (composizioni).
   * @param {string|number} ino - Identificatore istanza.
   * @returns {SelectionData} Oggetto selezione coerente.
   */
  function buildSelectionPayload(fullEntity, resolved, ino) {
    return {
      iNo: ino,
      code: fullEntity.code,
      uri: entityUri(fullEntity.code),
      title: fullEntity.title,
      preferredTerm: fullEntity.preferredTerm || fullEntity.title,
      icd9cmCode: fullEntity.icd9cmCode,
      ahrqClass: fullEntity.ahrqClass,
      section: fullEntity.section,
      isTerminal: fullEntity.isTerminal,
      parent: fullEntity.parent,
      classKind: fullEntity.classKind,
    };
  }

  /**
   * revealInTree -> espande l'albero fino a un codice senza selezionarlo.
   * Usato durante la ricerca testuale per posizionare l'albero sul primo
   * risultato pertinente (feedback visivo "branca attiva").
   */
  async function revealInTree(code, ino) {
    const inst = browserInstances[ino];
    if (!inst || !code) return;
    try {
      const pathData = await apiGet(`${releaseBase()}/entity/${encodeURIComponent(code)}/ancestors`);
      const ancestors = pathData.ancestors || [];
      for (const anc of ancestors) {
        const ancLi = inst.scrollPane.querySelector(`li[data-code="${anc.code}"]`);
        if (!ancLi) continue;
        if (!ancLi.classList.contains("ict-expanded")) {
          const expander = ancLi.querySelector(".ict-tree-expander");
          if (expander && expander.classList.contains("ict-has-children")) {
            await toggleTreeNode(ancLi, anc.code, ino, expander, true);
          }
        }
      }
      const targetLi = inst.scrollPane.querySelector(`li[data-code="${code}"]`);
      if (targetLi) {
        inst.scrollPane.querySelectorAll(".ict-tree-row.ict-tree-revealed")
          .forEach(r => r.classList.remove("ict-tree-revealed"));
        const row = targetLi.querySelector(".ict-tree-row");
        if (row) row.classList.add("ict-tree-revealed");
        targetLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) {
      // silenzioso: reveal è UX, non funzionale
    }
  }

  /**
   * syncBrowserToCode -> sincronizza l'albero al codice selezionato nel coding tool
   *
   * Algoritmo:
   *  1. GET /ancestors -> lista ordinata [root … parent] del codice target
   *  2. Per ogni antenato: cerca il suo <li> nel DOM; se non espanso, espandi
   *     (toggleTreeNode con forceExpand=true carica i figli via API se serve)
   *  3. Cerca il <li> del codice target nel DOM (ora visibile dopo gli expand)
   *  4. Seleziona il nodo e scrolla a centro schermo
   */
  async function syncBrowserToCode(code, ino) {
    const inst = browserInstances[ino];
    if (!inst) return;

    try {
      const pathData = await apiGet(`${releaseBase()}/entity/${encodeURIComponent(code)}/ancestors`);
      const ancestors = pathData.ancestors || [];

      for (const anc of ancestors) {
        const ancLi = inst.scrollPane.querySelector(`li[data-code="${anc.code}"]`);
        if (!ancLi) continue;
        if (!ancLi.classList.contains("ict-expanded")) {
          const expander = ancLi.querySelector(".ict-tree-expander");
          if (expander && expander.classList.contains("ict-has-children")) {
            await toggleTreeNode(ancLi, anc.code, ino, expander, true);
          }
        }
      }

      const targetLi = inst.scrollPane.querySelector(`li[data-code="${code}"]`);
      if (targetLi) {
        selectBrowserNode(targetLi, code, ino);
        targetLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

    } catch (e) {
      console.warn("Impossibile sincronizzare la vista albero: ", e);
    }
  }

  ICT.Browser = {
    /**
     * Scansiona il DOM e inizializza tutti i `<div data-icb-ino="…">` come
     * Browser tree (lazy-load di capitoli/figli, due-pane). Idempotente.
     * @returns {void}
     */
    configure() {
      document.querySelectorAll("div[data-icb-ino]").forEach(initBrowserInstance);
    },

    /**
     * Registra una callback chiamata ad ogni click su un nodo del tree
     * (con un'entità "full" risolta). Usata da `Popup.open` per "pescare" il
     * codice e abilitare la conferma. Passare `null` per rimuovere.
     *
     * @param {string|number} ino
     * @param {?function(SelectionData): void} fn
     * @returns {void}
     */
    setSelectCallback(ino, fn) {
      const key = String(ino);
      if (typeof fn === "function") browserSelectCallbacks[key] = fn;
      else delete browserSelectCallbacks[key];
    },

    /**
     * Reset visivo dell'albero: deseleziona, collassa tutti i nodi, scrolla in cima
     * e ripristina il pannello destro al placeholder.
     * @param {string|number} ino
     * @returns {void}
     */
    resetTree(ino) {
      const bInst = browserInstances[String(ino)];
      if (!bInst) return;

      bInst.selectedNode = null;
      bInst.right.innerHTML = '<div class="ict-empty" style="text-align:center; margin-top:20px; color:#6b7280;">Seleziona un nodo dall\'albero per vederne i dettagli...</div>';

      bInst.scrollPane.querySelectorAll(".ict-tree-selected").forEach(el => el.classList.remove("ict-tree-selected"));

      bInst.scrollPane.querySelectorAll(".ict-expanded").forEach(li => {
        li.classList.remove("ict-expanded");
        const exp = li.querySelector(".ict-tree-expander");
        if (exp && exp.classList.contains("ict-has-children")) exp.innerHTML = "▶";
      });

      bInst.scrollPane.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // POPUP — modale "plug-and-play" con barra ricerca + Browser tree integrato.
  //
  // Uso:
  //   const popup = ICT.Popup.open({
  //     title: "Cerca procedura",
  //     withBrowser: true,
  //     onSelect: (data) => { input.value = `${data.code} ${data.title}`; }
  //   });
  //   // popup.close() per chiusura programmatica
  //
  // Internamente crea un input data-ict-ino + (opzionale) div data-icb-ino,
  // riusa Handler/Browser esistenti, e su selezione invoca onSelect e chiude il modale.

  let popupSeq = 0;

  // Costruisce lo scheletro DOM di una modale (overlay + box + header + body
  // + footer opzionale). Restituisce i riferimenti utili al chiamante per
  // popolare il body e gestire la chiusura. Usato da Popup.open + showDetail +
  // showHierarchy --> layout coerente tra le tre modali.
  function buildPopupDom(title, opts = {}) {
    const { withFooter = false } = opts;
    const overlay = element("div", { class: "ict-popup-overlay", role: "dialog", "aria-modal": "true" });
    const modal = element("div", { class: "ict-popup-modal" });
    const closeBtn = element("button", {
      class: "ict-popup-close",
      type: "button",
      "aria-label": "Chiudi",
    }, "×");
    const header = element("div", { class: "ict-popup-header" },
      element("div", { class: "ict-popup-title" }, title || "Cerca codice"),
      closeBtn,
    );
    const body = element("div", { class: "ict-popup-body" });
    modal.appendChild(header);
    modal.appendChild(body);

    let footer = null, previewLabel = null, confirmBtn = null, cancelBtn = null;
    if (withFooter) {
      previewLabel = element("div", { class: "ict-popup-preview-label" }, "Nessun codice selezionato");
      cancelBtn = element("button", { class: "ict-popup-btn ict-popup-cancel", type: "button" }, "Annulla");
      confirmBtn = element("button", { class: "ict-popup-btn ict-popup-confirm", type: "button", disabled: "true" }, "Conferma selezione");
      const actions = element("div", { class: "ict-popup-actions" }, cancelBtn, confirmBtn);
      footer = element("div", { class: "ict-popup-footer" }, previewLabel, actions);
      modal.appendChild(footer);
    }

    overlay.appendChild(modal);
    return { overlay, modal, body, closeBtn, footer, previewLabel, confirmBtn, cancelBtn };
  }

  ICT.Popup = {
    /**
     * Apre un modale plug-and-play con barra di ricerca + Browser tree integrato.
     * Internamente crea un input `data-ict-ino` dinamico e (opzionalmente) un
     * `<div data-icb-ino>`, riusando Handler/Browser.
     *
     * Flusso DEFAULT (`confirmable: true`): preview-then-confirm. Il click su un
     * risultato o nodo tree bufferizza la selezione + abilita "Conferma". La
     * chiusura via "Conferma" invoca `onSelect(data)`; la chiusura via × / Esc /
     * "Annulla" NON invoca `onSelect`.
     *
     * Flusso ALTERNATIVO (`confirmable: false`): browse-only. `onSelect` viene
     * invocato ad ogni preview, il popup resta aperto. Comodo per esplorazioni
     * multiple senza dover ri-aprire.
     *
     * `settings`: applicato via `Handler.configure` prima di aprire. La config
     * globale viene poi RIPRISTINATA su `close()` --> nessun side effect persistente
     * su altri input dell'host application.
     *
     * @param {Object} [opts]
     * @param {string}                       [opts.title]
     * @param {boolean}                      [opts.withBrowser=true]
     * @param {function(SelectionData): void}[opts.onSelect]
     * @param {function(): void}             [opts.onClose]
     * @param {string}                       [opts.placeholder]
     * @param {HandlerSettings}              [opts.settings]
     * @param {string|function(SelectionData): string} [opts.previewLabel="Anteprima"]
     *   prefisso o formatter del label di preview.
     * @param {boolean}                      [opts.confirmable=true]
     * @returns {{close: function(): void, confirm: function(): void}}
     */
    open(opts = {}) {
      const {
        title, withBrowser = true, onSelect, onClose, placeholder, settings,
        previewLabel: previewLabelOpt, confirmable = true,
      } = opts;

      // Save+restore config: Popup è modulo indipendente --> non deve lasciare
      // config globale mutata dopo close (es. callback onSelect dell'Handler host).
      let prevConfig = null;
      if (settings && typeof settings === "object") {
        prevConfig = { ...config };
        ICT.Handler.configure(settings);
      }

      const ino = `popup-${++popupSeq}`;

      // Footer con anteprima + Conferma/Annulla --> flusso preview-then-confirm.
      const { overlay, body, closeBtn, previewLabel, confirmBtn, cancelBtn } =
        buildPopupDom(title, { withFooter: true });

      const input = document.createElement("input");
      input.type = "text";
      input.className = "ict-input";
      input.autocomplete = "off";
      input.setAttribute("data-ict-ino", ino);
      input.placeholder = placeholder || "Cerca per codice o testo…";

      body.appendChild(input);

      let browserDiv = null;
      if (withBrowser) {
        browserDiv = document.createElement("div");
        browserDiv.className = "ict-browser ict-popup-browser";
        browserDiv.setAttribute("data-icb-ino", ino);
        body.appendChild(browserDiv);
      }

      document.body.appendChild(overlay);

      ICT.Handler.scanNew();
      if (withBrowser) ICT.Browser.configure();

      // Buffer di anteprima: ultima selezione "pescata" da search OR tree click.
      // Confermata solo al click su "Conferma selezione".
      let previewBuffer = null;
      // Flag dblclick: se utente fa dblclick prima che setPreview venga chiamato
      // (selectEntity/selectBrowserNode async), la conferma scatta su prossimo setPreview.
      let confirmOnNextPreview = false;

      function formatPreviewText(data) {
        if (!data) return "Nessun codice selezionato";
        if (typeof previewLabelOpt === "function") return previewLabelOpt(data);
        const prefix = previewLabelOpt || "Anteprima";
        return `${prefix}: ${data.code} — ${data.title || ""}`.trim();
      }

      function setPreview(data) {
        previewBuffer = data || null;
        if (previewLabel) {
          previewLabel.textContent = formatPreviewText(data);
          previewLabel.classList.toggle("ict-popup-preview-active", !!data);
        }
        if (confirmBtn) {
          if (data) confirmBtn.removeAttribute("disabled");
          else confirmBtn.setAttribute("disabled", "true");
        }
        // Modalità non-confermabile: onSelect fired al volo, popup resta aperto.
        if (!confirmable && data && typeof onSelect === "function") {
          try { onSelect(data); } catch (e) { console.error(e); }
        }
        // Conferma differita (dblclick --> buffer ora popolato dall'async).
        if (confirmable && confirmOnNextPreview && data) {
          confirmOnNextPreview = false;
          confirm();
        }
      }

      let closed = false;
      function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey);
        ICT.Handler.deregister(ino);
        ICT.Browser.setSelectCallback(ino, null);
        if (browserInstances[ino]) delete browserInstances[ino];
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        // Ripristina config globale se era stata mutata da settings.
        if (prevConfig) { config = prevConfig; prevConfig = null; }
        if (typeof onClose === "function") onClose();
      }

      // Selezione da risultato di ricerca --> bufferizza, NON chiude.
      ICT.Handler.setInstanceCallbacks(ino, {
        onSelect(data) { setPreview(data); },
      });

      // Selezione da click su nodo dell'albero --> bufferizza, NON chiude.
      if (withBrowser) {
        ICT.Browser.setSelectCallback(ino, (data) => setPreview(data));
      }

      function confirm() {
        if (!previewBuffer) return;
        const data = previewBuffer;
        try { if (typeof onSelect === "function") onSelect(data); }
        finally { close(); }
      }

      if (confirmable) {
        if (confirmBtn) confirmBtn.addEventListener("click", confirm);
        if (cancelBtn) cancelBtn.addEventListener("click", close);
      } else {
        // Non-confermabile: rimuovi pulsanti, mantieni solo label di stato.
        if (confirmBtn?.parentNode) confirmBtn.parentNode.removeChild(confirmBtn);
        if (cancelBtn?.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
      }

      // Doppio click rapido sui risultati / nodi tree = scorciatoia di conferma.
      // Usa delegazione: ascolta dblclick su tutto il modale.
      // Race: selectEntity/selectBrowserNode sono async --> buffer può non essere
      // ancora pronto. Se vuoto, alza il flag e setPreview farà confirm()
      // appena arriva il payload. No setTimeout (perderebbe la race).
      overlay.addEventListener("dblclick", (e) => {
        if (!confirmable) return;
        if (e.target.closest(".ict-result, .ict-tree-row")) {
          if (previewBuffer) confirm();
          else confirmOnNextPreview = true;
        }
      });

      // Enter quando c'è un buffer = conferma.
      function onKey(e) {
        if (e.key === "Escape") close();
        if (confirmable && e.key === "Enter" && previewBuffer && document.activeElement !== input) {
          confirm();
        }
      }
      document.addEventListener("keydown", onKey);

      // Click su overlay disabilitato: chiusura solo via × o Esc.
      closeBtn.addEventListener("click", close);

      setTimeout(() => input.focus(), 30);

      return { close, confirm };
    },
  };

  /**
   * Apre una modale read-only con i dettagli completi di un codice (inclusioni,
   * esclusioni, note). Pensata per essere richiamata dall'app host in qualsiasi
   * momento (es. un tasto "Dettagli" che persiste dopo la chiusura della ricerca).
   *
   * Link `.ict-assoc-link` interni navigano cambiando il codice mostrato (no nuove
   * modali). "Vedi nella gerarchia" chiude la modale corrente e apre `showHierarchy`.
   *
   * @param {string} code
   * @param {Object} [opts]
   * @param {string} [opts.title]            — header custom (default `Dettagli {code}`).
   * @param {string|number} [opts.ino]       — propagato a `showHierarchy` per abilitare
   *                                           il bottone "Seleziona" se l'host è registrato.
   * @returns {Promise<{close: function(): void}|null>}
   *
   * @example
   * ICT.showDetail("87.92.00");
   * ICT.showDetail("87.92.00", { title: "Dettagli 87.92.00", ino: "1" });
   */
  ICT.showDetail = async function showDetail(code, opts = {}) {
    if (!code) return null;

    const { title } = opts;
    const { overlay, body, closeBtn } = buildPopupDom(title || `Dettagli ${code}`);
    body.classList.add("ict-popup-detail-body");
    body.innerHTML = "";
    body.appendChild(createSkeletonDetails());
    document.body.appendChild(overlay);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onEsc);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onEsc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onEsc);
    closeBtn.addEventListener("click", close);

    try {
      const fullEntity = await apiGet(`${releaseBase()}/entity/${encodeURIComponent(code)}`);
      let resolved = null;
      try {
        resolved = await apiGet(`${releaseBase()}/resolve/${encodeURIComponent(code)}`);
      } catch (e) { /* resolved opzionale */ }

      if (closed) return null;

      body.innerHTML = "";
      const box = document.createElement("div");
      box.className = "ict-details-box ict-popup-detail-box";
      box.appendChild(getDetailsDom(fullEntity, resolved, fullEntity));
      body.appendChild(box);

      // I link associati interni navigano cambiando il codice mostrato (no nuove modali).
      box.querySelectorAll(".ict-assoc-link").forEach((link) => {
        link.addEventListener("click", () => {
          const next = link.getAttribute("data-code");
          if (!next) return;
          close();
          ICT.showDetail(next, opts);
        });
      });

      // "See in hierarchy" --> chiude detail, apre tree popup sul codice
      box.querySelectorAll('[data-action="see-in-hierarchy"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const next = btn.getAttribute("data-code");
          if (!next) return;
          close();
          ICT.showHierarchy(next, { ino: opts.ino });
        });
      });
      return { close };
    } catch (err) {
      body.innerHTML = "";
      body.appendChild(
        element("div", { class: "ict-error" }, `Errore caricamento dettagli: ${err.message || ""}`)
      );
      return { close };
    }
  };

  /**
   * Helper "poche righe" per integrare CODIT su un input HTML esistente.
   * Aggancia l'input host al meccanismo `Popup.open`: trigger via `focus`
   * (default), `click` sull'input stesso, oppure `button` su un elemento esterno.
   *
   * Su selezione, scrive nel'input host il valore formattato (default
   * `${code} — ${title}`) o invoca `onSelect(data, inputEl)` se fornito.
   * Marca l'input host con `dataset.ictPopupAttached = "1"` --> `initInstance` lo
   * salta, evitando doppio comportamento (live-search inline + popup).
   *
   * @param {string|HTMLInputElement} target — selettore o elemento input host.
   * @param {Object} [opts]
   * @param {"focus"|"click"|"button"} [opts.trigger="focus"]
   * @param {string|HTMLElement} [opts.button]        — usato con `trigger:"button"`.
   * @param {string|HTMLElement} [opts.detailButton]  — tasto "Vedi Dettagli" abilitato
   *                                                    post-select (memorizza `dataset.ictCode`).
   * @param {function(SelectionData): string} [opts.format]
   * @param {function(SelectionData, HTMLInputElement): void} [opts.onSelect]
   * @param {function(HTMLInputElement): void}                [opts.onClose]
   * @param {boolean} [opts.withBrowser=true]
   * @param {string}  [opts.title]
   * @param {string}  [opts.placeholder]
   * @param {HandlerSettings} [opts.settings]
   * @param {boolean|string|function(SelectionData, HTMLInputElement): void} [opts.feedback]
   *   `false` --> no toast; string --> toast custom; function --> callback custom.
   * @returns {{open: function(): void, detach: function(): void}}
   *
   * @example
   * ICT.attach("#procedura-1");
   * ICT.attach("#procedura-2", { trigger: "button", button: "#cerca-btn-2" });
   * ICT.attach(myInput, { onSelect: (data, el) => el.value = data.code });
   */
  ICT.attach = function attach(target, opts = {}) {
    const inputEl = typeof target === "string" ? document.querySelector(target) : target;
    if (!inputEl) {
      console.warn("ICT.attach: target non trovato", target);
      return { open() { }, detach() { } };
    }

    const {
      trigger = "focus",
      button = null,
      detailButton = null,
      format,
      onSelect,
      onClose,
      withBrowser = true,
      title,
      placeholder,
      settings,
      feedback,
    } = opts;

    // Aggancio automatico del tasto "Dettagli" (opzionale).
    // Comportamento: disabled finché non viene selezionato un codice; alla
    // selezione viene abilitato + memorizza il codice in dataset.ictCode.
    // Click --> ICT.showDetail(code). La memoria persiste oltre la chiusura
    // del popup di ricerca (per ri-consultazione successiva).
    const detailBtnEl = detailButton
      ? (typeof detailButton === "string" ? document.querySelector(detailButton) : detailButton)
      : null;

    if (detailBtnEl) {
      // Inizializza disabilitato se nessun codice già presente
      if (!detailBtnEl.dataset.ictCode) {
        detailBtnEl.disabled = true;
      }
      detailBtnEl.addEventListener("click", () => {
        const c = detailBtnEl.dataset.ictCode;
        // Propaga ino --> "See in hierarchy" mostra btn Seleziona (vedi showDetail/#26)
        if (c) ICT.showDetail(c, { ino: inputEl.getAttribute("data-ict-ino") });
      });
    }

    const fmt = typeof format === "function"
      ? format
      : (d) => `${d.code} — ${d.title || ""}`.trim();

    // feedback default: toast solo quando viene applicata la scrittura di default.
    // false --> disabilita; string --> messaggio custom; function --> chiamato con data.
    const showFb = (data) => {
      if (feedback === false) return;
      if (typeof feedback === "function") feedback(data, inputEl);
      else if (typeof feedback === "string") showToast(feedback);
      else showToast(`Codice ${data.code} selezionato`);
    };

    let popupRef = null;

    function open() {
      if (popupRef) return;
      // Blur per evitare loop focus-popup-focus-popup quando trigger="focus"
      if (typeof inputEl.blur === "function") inputEl.blur();
      popupRef = ICT.Popup.open({
        title,
        placeholder,
        withBrowser,
        settings,
        // confirmable:false --> onSelect fired al primo click su risultato/nodo,
        // senza step di "Conferma". L'auto-close avviene subito dopo aver
        // popolato l'input host.
        confirmable: false,
        onSelect(data) {
          if (typeof onSelect === "function") {
            onSelect(data, inputEl);
          } else {
            inputEl.value = fmt(data);
            showFb(data);
          }
          // Persisti il codice sul tasto Dettagli (anche dopo chiusura popup)
          if (detailBtnEl && data?.code) {
            detailBtnEl.dataset.ictCode = data.code;
            detailBtnEl.disabled = false;
          }
          // Selezione singola --> popup chiusa subito (no "Conferma").
          if (popupRef && typeof popupRef.close === "function") {
            popupRef.close();
          }
        },
        onClose() {
          popupRef = null;
          if (typeof onClose === "function") onClose(inputEl);
        },
      });
    }

    let triggerEl, eventName;
    if (trigger === "button") {
      triggerEl = typeof button === "string" ? document.querySelector(button) : button;
      if (!triggerEl) {
        console.warn("ICT.attach: trigger 'button' richiede opzione 'button' valida");
        return { open, detach() { } };
      }
      eventName = "click";
    } else if (trigger === "click") {
      triggerEl = inputEl;
      eventName = "click";
    } else {
      triggerEl = inputEl;
      eventName = "focus";
    }

    // Marca host input --> autoInit/Handler.configure non lo trasforma in inline
    // (guard L916). Previene doppio comportamento (live search inline + popup).
    inputEl.dataset.ictPopupAttached = "1";

    triggerEl.addEventListener(eventName, open);

    return {
      open,
      detach() {
        triggerEl.removeEventListener(eventName, open);
        if (popupRef) popupRef.close();
      },
    };
  };

  /**
   * Apre una modale con il Browser tree pre-rivelato sul codice indicato.
   *
   * Se `opts.ino` punta ad un'istanza Handler valida, l'header espone un
   * bottone "Seleziona" che invoca `selectEntity` sul nodo correntemente
   * selezionato nel tree --> fires `onSelect` dell'host. Senza `ino` la modale
   * resta in modalità browse-only.
   *
   * Race condition: il fetch /entity (per popolare immediatamente il payload e
   * abilitare "Seleziona") corre in parallelo al sync del tree. Vince il primo
   * che arriva — entrambi i path sono idempotenti.
   *
   * @param {string} code
   * @param {Object} [opts]
   * @param {string}        [opts.title]
   * @param {string|number} [opts.ino]   — se valido, abilita "Seleziona" --> selectEntity.
   * @returns {{close: function(): void}|null}
   *
   * @example
   * ICT.showHierarchy("87.92.00");
   * ICT.showHierarchy("87.92.00", { ino: "1" });
   */
  ICT.showHierarchy = function showHierarchy(code, opts = {}) {
    if (!code) return null;
    const { title, ino: hostIno } = opts;
    const hasHost = hostIno != null && instances[hostIno];

    const { overlay, modal, body, closeBtn } = buildPopupDom(title || `Gerarchia: ${code}`);
    const titleEl = modal.querySelector(".ict-popup-title");

    // Bottone "Seleziona" + chiudi clusterati a destra dell'header (solo se host valido)
    let selectBtn = null;
    if (hasHost) {
      selectBtn = element("button", {
        class: "ict-popup-btn ict-popup-confirm ict-popup-select-btn",
        type: "button",
      }, "Seleziona");
      const headerActions = element("div", { class: "ict-popup-header-actions" });
      const headerEl = closeBtn.parentNode;
      headerEl.insertBefore(headerActions, closeBtn);
      headerActions.appendChild(selectBtn);
      headerActions.appendChild(closeBtn);
    }

    document.body.appendChild(overlay);

    const ino = `hier-${++popupSeq}`;
    const browserDiv = document.createElement("div");
    browserDiv.className = "ict-browser ict-popup-browser";
    browserDiv.setAttribute("data-icb-ino", ino);
    body.appendChild(browserDiv);

    // Selezione corrente: parte null, popolata da fetch entità (in parallelo al
    // tree sync) o da click su nodo del tree, qualunque arrivi prima.
    // Btn Seleziona disabled fino a popolamento --> evita selectEntity con title
    // sbagliato (era il title del popup) se utente clicca pre-sync.
    let currentSelection = null;
    let closed = false;
    if (hasHost && selectBtn) selectBtn.disabled = true;
    if (hasHost) {
      // Fetch entità per popolare subito il payload + abilitare Seleziona
      // anche se il tree sync è lento o /ancestors fallisce.
      apiGet(`${releaseBase()}/entity/${encodeURIComponent(code)}`)
        .then(fullEntity => {
          if (closed) return;
          if (currentSelection) return; // tree click ha già vinto la corsa
          currentSelection = fullEntity;
          if (selectBtn) selectBtn.disabled = false;
          if (titleEl) {
            titleEl.textContent = fullEntity.title
              ? `${fullEntity.code} — ${fullEntity.title}` : fullEntity.code;
          }
        })
        .catch(() => {
          if (closed || currentSelection) return;
          // Fallback minimal: selectEntity farà comunque /resolve + /entity.
          currentSelection = { code };
          if (selectBtn) selectBtn.disabled = false;
        });

      ICT.Browser.setSelectCallback(ino, (data) => {
        if (data?.code) {
          currentSelection = data;
          if (selectBtn) selectBtn.disabled = false;
          if (titleEl) {
            titleEl.textContent = data.title ? `${data.code} — ${data.title}` : data.code;
          }
        }
      });
    }

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      if (hasHost) ICT.Browser.setSelectCallback(ino, null);
      if (browserInstances[ino]) delete browserInstances[ino];
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function confirm() {
      if (hasHost && currentSelection?.code) {
        selectEntity(currentSelection, hostIno);
      }
      close();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
      if (e.key === "Enter" && hasHost && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        confirm();
      }
    }
    document.addEventListener("keydown", onKey);
    closeBtn.addEventListener("click", close);
    if (selectBtn) selectBtn.addEventListener("click", confirm);

    // Inizializza il Browser e poi sincronizza al codice una volta caricati i capitoli.
    initBrowserInstance(browserDiv).then(() => {
      syncBrowserToCode(code, ino).catch(() => { });
    });

    return { close };
  };

  // INIT

  global.ICT = ICT;
  global.CODIT = ICT; // alias (README usa CODIT.Handler.configure)

  /**
   * autoInit -> inizializzazione automatica al caricamento della pagina
   * Handler e Browser si auto-inizializzano se trovano i rispettivi attributi
   * nel DOM (data-ict-ino / data-icb-ino), senza richiedere configure() esplicito.
   * Se configure() è già stato chiamato (isAutoConfigured=true), l'Handler non viene
   * ri-inizializzato; Browser ha guardia interna per-istanza, sicuro chiamarlo sempre.
   */
  function autoInit() {
    if (!isAutoConfigured) {
      if (document.querySelectorAll("input[data-ict-ino]").length > 0) {
        ICT.Handler.configure();
      }
    }
    if (document.querySelectorAll("div[data-icb-ino]").length > 0) {
      ICT.Browser.configure();
    }
  }

  if (document.readyState !== 'loading') {
    autoInit();
  } else {
    document.addEventListener('DOMContentLoaded', autoInit);
  }
})(window);
