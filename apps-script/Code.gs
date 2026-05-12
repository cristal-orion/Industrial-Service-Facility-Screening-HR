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
const HEADERS = [
  'timestamp','id','nome','cognome','email','telefono','citta','posizione',
  'q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12','q13','q14','q15','q16',
  'relazionale','mindset','organizzazione','flessibilita','fitSettore',
  'potenziale','overall','categoria'
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

    if (action === 'submit')  return json(handleSubmit(body));
    if (action === 'login')   return json(handleLogin(body));
    if (action === 'list')    return json(handleList(body));

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

  // Normalizza risposte: array di 16 valori (si|incerto|no|na|null)
  const answers = Array(16).fill(null);
  if (Array.isArray(payload.risposte)) {
    for (const r of payload.risposte) {
      if (r && r.questionId >= 1 && r.questionId <= 16) {
        answers[r.questionId - 1] = sanitizeValue(r.value);
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
    potenziale, overall, categoria
  ];

  sheet.appendRow(row);
  return { ok: true, id, categoria, overall };
}

function s(v) { return v == null ? '' : String(v); }

function sanitizeValue(v) {
  const ok = ['si', 'incerto', 'no', 'na'];
  return ok.indexOf(v) >= 0 ? v : null;
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
      answers.push({ questionId: i, value: obj['q' + i] || null });
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
