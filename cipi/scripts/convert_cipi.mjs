// scripts/convert_cipi.mjs — port Node di scripts/convert_cipi.php (one-shot generator)
// Replica esattamente la mappatura colonne + logica di derivazione parent del PHP.
// Uso: node scripts/convert_cipi.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { Buffer } from "node:buffer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const xlsxPath = process.argv[2] ?? resolve(projectRoot, "api/data/CIPI.xlsx");
const outputPath = process.argv[3] ?? resolve(projectRoot, "api/data/cipi.json");

if (!existsSync(xlsxPath)) {
  console.error("Errore: file non trovato:", xlsxPath);
  process.exit(1);
}

// Minimal xlsx (zip) parser — extract specific files via central directory.
function readZipEntry(buf, name) {
  // EOCD scan
  const eocdMin = 22;
  let eocdOff = -1;
  for (let i = buf.length - eocdMin; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error("EOCD not found");
  const cdSize = buf.readUInt32LE(eocdOff + 12);
  const cdOff = buf.readUInt32LE(eocdOff + 16);
  let p = cdOff;
  const end = cdOff + cdSize;
  while (p < end) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central dir sig");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const entryName = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    if (entryName === name) {
      // Read local header
      const lhNameLen = buf.readUInt16LE(localOff + 26);
      const lhExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      const compData = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) return compData;
      if (method === 8) {
        // raw deflate --> unzipSync expects deflate stream with proper header.
        // Use inflateRawSync via zlib.
        return Buffer.from(inflateRawSync(compData));
      }
      throw new Error("unsupported compression method: " + method);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("entry not found: " + name);
}

const xlsxBuf = readFileSync(xlsxPath);
const ssBuf = readZipEntry(xlsxBuf, "xl/sharedStrings.xml");
const sheetBuf = readZipEntry(xlsxBuf, "xl/worksheets/sheet1.xml");

// Parse sharedStrings.xml: extract each <si>...</si> block as text (handle <t> and <r><t>).
function parseSharedStrings(xml) {
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1];
    // Collect all <t ...>...</t> within (handles both plain and rich text)
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let text = "";
    let tm;
    while ((tm = tRe.exec(inner)) !== null) {
      text += tm[1];
    }
    out.push(decodeXml(text));
  }
  return out;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

const sharedStrings = parseSharedStrings(ssBuf.toString("utf8"));
console.log("Stringhe condivise caricate:", sharedStrings.length);

// Column letter --> 0-based index
function colToIndex(col) {
  col = col.toUpperCase().trim();
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    const c = col.charCodeAt(i) - 64;
    idx = idx * 26 + c;
  }
  return idx - 1;
}

function cellCol(ref) {
  const m = /^([A-Z]+)/.exec(ref.toUpperCase());
  return m ? m[1] : "A";
}

function parseValidity(v) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  if (m) return [`${m[3]}-${m[2]}-${m[1]}`, `${m[6]}-${m[5]}-${m[4]}`];
  return [null, null];
}

function classKind(type) {
  const t = type.toLowerCase();
  if (t.includes("2 cifre")) return "chapter";
  if (t.includes("3 cifre")) return "block";
  if (t.includes("4 cifre")) return "sottocategoria cat 4";
  if (t.includes("codificante")) return "codificante";
  return "altro";
}

// Caller garantisce code non vuoto e formato valido per il tipo.
function deriveParent(type, code) {
  const t = type.toLowerCase();
  if (t.includes("2 cifre")) return null;
  if (t.includes("3 cifre")) return code.slice(0, 2);
  if (t.includes("4 cifre")) return code.slice(0, -1);
  if (t.includes("codificante")) {
    const lastDot = code.lastIndexOf(".");
    return lastDot >= 0 ? code.slice(0, lastDot) : null;
  }
  return null;
}

const COL = {
  id: 0, section: 1, type: 2, title: 3, code: 4,
  icd9: 5, ahrq: 6, incl: 7, excl: 8, notes: 9, validity: 10,
};

// Parse sheet XML row by row.
const sheetXml = sheetBuf.toString("utf8");

// Match every <row r="N" ...>...</row>
const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
const DATA_START = 8;
const entities = [];
let rowCount = 0;
let skipped = 0;

let rm;
while ((rm = rowRe.exec(sheetXml)) !== null) {
  const attrs = rm[1];
  const inner = rm[2];
  const rMatch = /\br="(\d+)"/.exec(attrs);
  if (!rMatch) continue;
  const rowNum = parseInt(rMatch[1], 10);
  if (rowNum < DATA_START) continue;

  // Parse cells — matcha sia <c .../> sia <c ...>...</c>
  const cells = {};
  const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  let cm;
  while ((cm = cellRe.exec(inner)) !== null) {
    const cAttrs = cm[1];
    const cInner = cm[3] ?? "";
    const refM = /\br="([A-Z]+\d+)"/.exec(cAttrs);
    if (!refM) continue;
    const idx = colToIndex(cellCol(refM[1]));
    const tM = /\bt="([^"]+)"/.exec(cAttrs);
    const type = tM ? tM[1] : "";
    let value = "";
    if (type === "s") {
      const vM = /<v>([\s\S]*?)<\/v>/.exec(cInner);
      if (vM) value = sharedStrings[parseInt(vM[1], 10)] ?? "";
    } else if (type === "inlineStr") {
      const tIn = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cInner);
      if (tIn) value = decodeXml(tIn[1]);
    } else {
      const vM = /<v>([\s\S]*?)<\/v>/.exec(cInner);
      if (vM) value = decodeXml(vM[1]);
    }
    cells[idx] = value;
  }

  const get = (key) => (cells[COL[key]] ?? "").toString().trim();

  const id = get("id");
  const code = get("code");
  const type = get("type");
  if (!id || !code) { skipped++; continue; }

  const [validFrom, validTo] = parseValidity(get("validity"));

  let icd9 = get("icd9");
  if (!icd9 || icd9.toLowerCase() === "nd") icd9 = null;

  let ahrq = get("ahrq");
  if (!ahrq || ahrq.toLowerCase() === "nd") ahrq = null;

  const isTerminal = type.toLowerCase().includes("codificante");

  entities.push({
    id,
    code,
    title: get("title"),
    classKind: classKind(type),
    typeRaw: type,
    section: get("section") || null,
    parent: deriveParent(type, code),
    isTerminal,
    inclusions: get("incl") || null,
    exclusions: get("excl") || null,
    generalNotes: get("notes") || null,
    ahrqClass: ahrq,
    icd9cmCode: icd9,
    validFrom,
    validTo,
  });

  rowCount++;
  if (rowCount % 2000 === 0) console.log(`  Lette ${rowCount} entità...`);
}

console.log(`Entità lette: ${rowCount} (saltate: ${skipped})`);

// Synthesize missing intermediate parent entities — il dataset CIPI ha gap
// nella gerarchia (es. chapter "17", "85" assenti; alcuni 4 Cifre mancanti).
// Senza sintesi il /chapter tree non navigerebbe quelle sezioni.
function synthesizeKind(code) {
  if (code.length === 2) return ["chapter", "2 Cifre, Rubrica (sintetico)"];
  if (code.length === 4 && code[2] === ".") return ["block", "3 Cifre, Rubrica (sintetico)"];
  if (code.length === 5 && code[2] === ".") return ["sottocategoria cat 4", "4 Cifre, Rubrica (sintetico)"];
  return ["altro", "sintetico"];
}

function syntheticParent(code) {
  if (code.length <= 2) return null;
  if (code.length === 4) return code.slice(0, 2);          // "85.0" --> "85"
  if (code.length === 5) return code.slice(0, -1);         // "85.00" --> "85.0"
  return null;
}

const existing = new Set(entities.map((e) => e.code));
const toAdd = [];
const queue = [...new Set(entities.map((e) => e.parent).filter((p) => p && !existing.has(p)))];
const queued = new Set(queue);

while (queue.length > 0) {
  const code = queue.shift();
  if (existing.has(code)) continue;
  const [kind, typeLabel] = synthesizeKind(code);
  const parent = syntheticParent(code);
  toAdd.push({
    id: `SYNTH:${code}`,
    code,
    title: "(struttura sintetica — entità non presente nel sorgente CIPI)",
    classKind: kind,
    typeRaw: typeLabel,
    section: null,
    parent,
    isTerminal: false,
    inclusions: null,
    exclusions: null,
    generalNotes: null,
    ahrqClass: null,
    icd9cmCode: null,
    validFrom: null,
    validTo: null,
  });
  existing.add(code);
  if (parent && !existing.has(parent) && !queued.has(parent)) {
    queue.push(parent);
    queued.add(parent);
  }
}
if (toAdd.length > 0) {
  console.log(`Sintetizzate ${toAdd.length} entità mancanti nella gerarchia.`);
  entities.push(...toAdd);
}

const byCode = {};
const byParent = {};
const byIcd9 = {};
const chapters = [];

entities.forEach((e, i) => {
  byCode[e.code] = i;
  if (e.parent) (byParent[e.parent] ??= []).push(i);
  if (e.icd9cmCode) (byIcd9[e.icd9cmCode] ??= []).push(i);
  if (e.classKind === "chapter") chapters.push(i);
});

let orphanCount = 0;
for (const e of entities) {
  if (e.parent && !(e.parent in byCode)) orphanCount++;
}
if (orphanCount > 0) console.log(`AVVISO: ${orphanCount} entità con parent ancora non risolvibile dopo sintesi.`);

const totalCodable = entities.filter((e) => e.isTerminal).length;

const output = {
  release: {
    id: "20251215",
    description: "CIPI versione 2.0 (Dicembre 2025)",
    validFrom: "2025-12-15",
    validTo: "2026-12-31",
    source: "Ministero della Salute",
    license: "CC BY-NC-ND 4.0",
    totalEntities: entities.length,
    totalCodable,
    sourceRows: rowCount,
    syntheticEntities: entities.length - rowCount,
  },
  entities,
  byCode,
  byParent,
  byIcd9,
  chapters,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(output));

const sizeMb = (statSync(outputPath).size / 1024 / 1024).toFixed(1);
console.log(`Fatto! --> ${outputPath} (${sizeMb} MB)`);
console.log(`Entità totali (incl. sintetiche): ${entities.length} (sorgente: ${rowCount})`);
console.log(`Codici terminali: ${totalCodable}`);
console.log(`Capitoli:         ${chapters.length}`);
