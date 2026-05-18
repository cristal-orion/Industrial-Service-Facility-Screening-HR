/**
 * Industrial Service & Facility — Screening HR
 * Apps Script per:
 *   - ricevere submit candidature dal form (POST)
 *   - calcolare scoring e categorizzare
 *   - scrivere riga nel foglio "Candidature"
 *   - login admin (POST action=login)
 *   - lettura candidature per dashboard (POST action=list)
 *
 * DEPLOY:
 *   1. Apri lo Sheet → Estensioni → Apps Script
 *   2. Incolla TUTTO questo file in Code.gs
 *   3. Imposta le Properties (vedi setProperties() in fondo, oppure
 *      Project Settings → Script properties manualmente):
 *        - ADMIN_PASSWORD : la password di accesso alla dashboard
 *        - ADMIN_TOKEN    : una stringa lunga e casuale (32+ caratteri)
 *   4. Deploy → New deployment → Tipo: Web app
 *        - Execute as: Me (te stesso)
 *        - Who has access: Anyone
 *      Salva l'URL "Web app URL" (termina con /exec)
 *   5. Incolla l'URL nel front-end (vedi guida deploy)
 */

const SHEET_NAME = 'Candidature';
const POSITIONS_SHEET_NAME = 'Posizioni';
const POSITIONS_HEADERS = ['id','attivo','titolo','descrizione','ral','location','ordine','updated_at'];
// Le colonne q*_time sono in coda per non disallineare le righe già scritte
// prima dell'introduzione della metrica tempo (vecchie candidature compatibili).
const HEADERS = [
  'timestamp','id','nome','cognome','email','telefono','citta','posizione',
  'q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12','q13','q14','q15','q16',
  'relazionale','mindset','organizzazione','flessibilita','fitSettore',
  'potenziale','overall','categoria',
  'q1_time','q2_time','q3_time','q4_time','q5_time','q6_time','q7_time','q8_time',
  'q9_time','q10_time','q11_time','q12_time','q13_time','q14_time','q15_time','q16_time'
];

// ============================================================
// QUESTIONARIO — risposta ideale e (per Q13/Q15) risposta critica
// ============================================================
const QUESTIONS = [
  { id: 1,  dim: 'relazionale',    ideal: 'si', critical: null },
  { id: 2,  dim: 'relazionale',    ideal: 'si', critical: null },
  { id: 3,  dim: 'relazionale',    ideal: 'no', critical: null },
  { id: 4,  dim: 'organizzazione', ideal: 'no', critical: null },
  { id: 5,  dim: 'flessibilita',   ideal: 'no', critical: null },
  { id: 6,  dim: 'mindset',        ideal: 'si', critical: null },
  { id: 7,  dim: 'organizzazione', ideal: 'no', critical: null },
  { id: 8,  dim: 'mindset',        ideal: 'no', critical: null },
  { id: 9,  dim: 'relazionale',    ideal: 'si', critical: null },
  { id: 10, dim: 'flessibilita',   ideal: 'no', critical: null },
  { id: 11, dim: 'mindset',        ideal: 'no', critical: null },
  { id: 12, dim: 'flessibilita',   ideal: 'no', critical: null },
  { id: 13, dim: 'fitSettore',     ideal: 'si', critical: 'no' },
  { id: 14, dim: 'fitSettore',     ideal: 'si', critical: null },
  { id: 15, dim: 'fitSettore',     ideal: 'si', critical: 'no' },
  { id: 16, dim: 'fitSettore',     ideal: 'si', critical: null }
];

// ============================================================
// ENTRY POINTS HTTP
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || 'submit';

    if (action === 'submit')              return json(handleSubmit(body));
    if (action === 'login')               return json(handleLogin(body));
    if (action === 'list')                return json(handleList(body));
    if (action === 'check_duplicate')     return json(handleCheckDuplicate(body));
    if (action === 'list_positions')      return json(handleListPositions(body, false));
    if (action === 'list_positions_admin')return json(handleListPositions(body, true));
    if (action === 'save_position')       return json(handleSavePosition(body));
    if (action === 'delete_position')     return json(handleDeletePosition(body));

    return json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet(e) {
  // healthcheck pubblico
  return json({ ok: true, service: 'isf-hr', version: 1 });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SUBMIT CANDIDATURA
// ============================================================
function handleSubmit(payload) {
  const sheet = getSheet();

  // Dedup: stessa email o stesso telefono normalizzato → rifiuto
  const c0 = payload.contatto || {};
  if (isDuplicate(sheet, c0.email, c0.telefono)) {
    return { ok: false, error: 'already_submitted' };
  }

  // Normalizza risposte: array di 16 valori (si|incerto|no|na|null) + 16 tempi in ms
  const answers = Array(16).fill(null);
  const times = Array(16).fill('');
  if (Array.isArray(payload.risposte)) {
    for (const r of payload.risposte) {
      if (r && r.questionId >= 1 && r.questionId <= 16) {
        answers[r.questionId - 1] = sanitizeValue(r.value);
        times[r.questionId - 1] = sanitizeTime(r.timeMs);
      }
    }
  }

  const dims = computeDimensions(answers);
  const potenziale = computePotenziale(dims);
  const overall = computeOverall(dims);
  const categoria = categorize(dims);

  const id = 'c_' + Utilities.getUuid().slice(0, 8);
  const timestamp = payload.timestamp || new Date().toISOString();
  const c = payload.contatto || {};

  const row = [
    timestamp, id,
    s(c.nome), s(c.cognome), s(c.email), s(c.telefono), s(c.citta),
    s(payload.posizione || payload.posizioneKey),
    ...answers,
    dims.relazionale, dims.mindset, dims.organizzazione, dims.flessibilita, dims.fitSettore,
    potenziale, overall, categoria,
    ...times
  ];

  sheet.appendRow(row);
  return { ok: true, id, categoria, overall };
}

function s(v) { return v == null ? '' : String(v); }

function sanitizeValue(v) {
  const ok = ['si', 'incerto', 'no', 'na'];
  return ok.indexOf(v) >= 0 ? v : null;
}

function sanitizeTime(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return '';
  // hard cap a 30 minuti per evitare valori sballati da tab tenute aperte
  return Math.min(Math.round(n), 30 * 60 * 1000);
}

// ============================================================
// LOGIN ADMIN
// ============================================================
function handleLogin(payload) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('ADMIN_PASSWORD');
  const token = props.getProperty('ADMIN_TOKEN');

  if (!expected || !token) {
    return { ok: false, error: 'admin_not_configured' };
  }
  if (payload.password !== expected) {
    return { ok: false, error: 'bad_password' };
  }
  return { ok: true, token };
}

// ============================================================
// LIST CANDIDATURE (per dashboard)
// ============================================================
function handleList(payload) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ADMIN_TOKEN');
  if (!payload.token || payload.token !== token) {
    return { ok: false, error: 'unauthorized' };
  }

  const sheet = getSheet();
  const range = sheet.getDataRange().getValues();
  if (range.length <= 1) return { ok: true, candidates: [] };

  const header = range[0];
  const rows = range.slice(1);

  const candidates = rows.map(r => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i]; });
    // ricompone struttura amica per il client
    const answers = [];
    for (let i = 1; i <= 16; i++) {
      const t = obj['q' + i + '_time'];
      const timeMs = (t === '' || t == null) ? null : Number(t);
      answers.push({
        questionId: i,
        value: obj['q' + i] || null,
        timeMs: isFinite(timeMs) ? timeMs : null
      });
    }
    return {
      id: obj.id,
      timestamp: obj.timestamp instanceof Date ? obj.timestamp.toISOString() : String(obj.timestamp),
      nome: obj.nome, cognome: obj.cognome,
      email: obj.email, telefono: obj.telefono, citta: obj.citta,
      posizione: obj.posizione,
      answers,
      dims: {
        relazionale:    Number(obj.relazionale) || 0,
        mindset:        Number(obj.mindset) || 0,
        organizzazione: Number(obj.organizzazione) || 0,
        flessibilita:   Number(obj.flessibilita) || 0,
        fitSettore:     Number(obj.fitSettore) || 0
      },
      potenziale: Number(obj.potenziale) || 0,
      overall: Number(obj.overall) || 0,
      categoria: obj.categoria
    };
  });

  return { ok: true, candidates };
}

// ============================================================
// DEDUPLICA CANDIDATURE (email / telefono)
// ============================================================
function handleCheckDuplicate(payload) {
  const sheet = getSheet();
  const exists = isDuplicate(sheet, payload.email, payload.telefono);
  return { ok: true, exists };
}

function isDuplicate(sheet, email, phone) {
  const e = normalizeEmail(email);
  const p = normalizePhone(phone);
  if (!e && !p) return false;
  const last = sheet.getLastRow();
  if (last < 2) return false;
  // colonne: A timestamp, B id, C nome, D cognome, E email, F telefono
  const values = sheet.getRange(2, 5, last - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    const rowEmail = normalizeEmail(values[i][0]);
    const rowPhone = normalizePhone(values[i][1]);
    if (e && rowEmail && rowEmail === e) return true;
    if (p && rowPhone && rowPhone === p) return true;
  }
  return false;
}

function normalizeEmail(v) {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

function normalizePhone(v) {
  if (v == null) return '';
  // tieni solo cifre, poi normalizza prefisso internazionale italiano
  let s = String(v).replace(/\D+/g, '');
  if (s.startsWith('0039')) s = s.slice(2);   // 0039xxx → 39xxx
  if (s.startsWith('39') && s.length >= 11) s = s.slice(2); // 39xxx → xxx
  if (s.startsWith('0')) s = s.slice(1);
  return s;
}

// ============================================================
// SCORING
// ============================================================
function scoreAnswer(q, value) {
  if (value === q.ideal) return 100;
  if (value === 'incerto') return 50;
  if (value === 'na') return 25;
  return q.critical === value ? 0 : 20;
}

function computeDimensions(answers) {
  const buckets = { relazionale: [], mindset: [], organizzazione: [], flessibilita: [], fitSettore: [] };
  for (const q of QUESTIONS) {
    const v = answers[q.id - 1];
    if (v) buckets[q.dim].push(scoreAnswer(q, v));
  }
  const out = {};
  for (const k in buckets) {
    const arr = buckets[k];
    out[k] = arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
  }
  return out;
}

function computePotenziale(d) {
  return Math.round((d.relazionale + d.mindset + d.organizzazione + d.flessibilita) / 4);
}

function computeOverall(d) {
  return Math.round((d.relazionale + d.mindset + d.organizzazione + d.flessibilita + d.fitSettore) / 5);
}

function categorize(d) {
  const fit = d.fitSettore;
  const pot = computePotenziale(d);
  if (fit >= 65 && pot >= 65) return 'pronti';
  if (fit < 50 && pot >= 65)  return 'diamante';
  if (fit < 50 && pot < 50)   return 'non_ora';
  return 'medio';
}

// ============================================================
// GESTIONE POSIZIONI (CRUD)
// ============================================================
function handleListPositions(payload, admin) {
  if (admin) {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('ADMIN_TOKEN');
    if (!payload.token || payload.token !== token) return { ok: false, error: 'unauthorized' };
  }
  const sheet = getPositionsSheet();
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, positions: [] };
  const range = sheet.getRange(2, 1, last - 1, POSITIONS_HEADERS.length).getValues();
  const out = range.map(rowToPosition).filter(p => p && p.id);
  const filtered = admin ? out : out.filter(p => p.attivo);
  filtered.sort((a, b) => (a.ordine - b.ordine) || a.titolo.localeCompare(b.titolo));
  return { ok: true, positions: filtered };
}

function handleSavePosition(payload) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ADMIN_TOKEN');
  if (!payload.token || payload.token !== token) return { ok: false, error: 'unauthorized' };

  const p = payload.position || {};
  const titolo = String(p.titolo || '').trim();
  if (!titolo) return { ok: false, error: 'missing_titolo' };

  const sheet = getPositionsSheet();
  const id = String(p.id || '').trim() || 'p_' + Utilities.getUuid().slice(0, 8);

  const newRow = [
    id,
    p.attivo === false ? false : true,
    titolo,
    String(p.descrizione || ''),
    String(p.ral || ''),
    String(p.location || ''),
    Number(p.ordine) || 0,
    new Date().toISOString()
  ];

  const idx = findPositionRowIndex(sheet, id);
  if (idx > 0) {
    sheet.getRange(idx, 1, 1, POSITIONS_HEADERS.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }
  return { ok: true, id };
}

function handleDeletePosition(payload) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ADMIN_TOKEN');
  if (!payload.token || payload.token !== token) return { ok: false, error: 'unauthorized' };
  const id = String(payload.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  const sheet = getPositionsSheet();
  const idx = findPositionRowIndex(sheet, id);
  if (idx > 0) sheet.deleteRow(idx);
  return { ok: true };
}

function rowToPosition(row) {
  return {
    id: String(row[0] || ''),
    attivo: row[1] === true || String(row[1]).toUpperCase() === 'TRUE',
    titolo: String(row[2] || ''),
    descrizione: String(row[3] || ''),
    ral: String(row[4] || ''),
    location: String(row[5] || ''),
    ordine: Number(row[6]) || 0,
    updatedAt: row[7] instanceof Date ? row[7].toISOString() : String(row[7] || '')
  };
}

function findPositionRowIndex(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

function getPositionsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(POSITIONS_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(POSITIONS_SHEET_NAME);
    sh.appendRow(POSITIONS_HEADERS);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(POSITIONS_HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Eseguila UNA VOLTA dall'editor per popolare la tab Posizioni con le 4 esistenti.
// Idempotente: se l'id esiste già, aggiorna; altrimenti inserisce.
function seedPositions() {
  const seed = [
    { id: 'qhse', attivo: true, titolo: 'QHSE Junior',
      descrizione: 'Supporto ai processi di qualità, salute, sicurezza e ambiente nel settore energia rinnovabile',
      ral: '€ 20.000 – 25.000', location: 'Napoli', ordine: 10 },
    { id: 'gare', attivo: true, titolo: 'Responsabile Ufficio Gare',
      descrizione: 'Gestione e coordinamento delle procedure di gara e appalto per progetti nel settore energetico',
      ral: '€ 25.000 – 35.000', location: 'Napoli', ordine: 20 },
    { id: 'elettricista', attivo: true, titolo: 'Elettricista Trasfertista',
      descrizione: 'Installazione e manutenzione di impianti elettrici su cantieri fotovoltaici ed eolici in trasferta',
      ral: '€ 20.000 – 30.000', location: 'Napoli', ordine: 30 },
    { id: 'spontanea', attivo: true, titolo: 'Candidatura spontanea',
      descrizione: 'Non hai trovato una posizione in linea con il tuo profilo? Inviaci la tua candidatura spontanea.',
      ral: 'Da valutare', location: 'Napoli', ordine: 100 }
  ];
  const sheet = getPositionsSheet();
  for (const p of seed) {
    const idx = findPositionRowIndex(sheet, p.id);
    const row = [p.id, p.attivo, p.titolo, p.descrizione, p.ral, p.location, p.ordine, new Date().toISOString()];
    if (idx > 0) sheet.getRange(idx, 1, 1, POSITIONS_HEADERS.length).setValues([row]);
    else sheet.appendRow(row);
  }
  Logger.log('Posizioni seeded.');
}

// ============================================================
// SHEET HELPERS
// ============================================================
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ============================================================
// UTILITY: setup iniziale (esegui UNA VOLTA da editor)
// ============================================================
function setupProperties() {
  // Personalizza questi valori e clicca "Run" in editor (autorizza accessi alla prima esecuzione)
  PropertiesService.getScriptProperties().setProperties({
    ADMIN_PASSWORD: 'CAMBIA-QUESTA-PASSWORD',
    ADMIN_TOKEN: 'CAMBIA-CON-TOKEN-CASUALE-LUNGO-32-CARATTERI-MIN'
  });
  Logger.log('Properties impostate.');
}

function ensureHeaders() {
  const sh = getSheet();
  const firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const missing = HEADERS.some((h, i) => firstRow[i] !== h);
  if (missing) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    Logger.log('Headers riscritti.');
  } else {
    Logger.log('Headers OK.');
  }
}
