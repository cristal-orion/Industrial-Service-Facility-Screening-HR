# Apps Script — Deploy guida

## 1. Foglio Google

1. Drive → Nuovo → Foglio Google. Rinominalo es. `ISF — Candidature HR`.
2. Rinomina la tab in basso da `Foglio1` a **`Candidature`** (esatto, con la C maiuscola).
3. Apri `apps-script/INTESTAZIONI_FOGLIO.txt` da questo repo, copia la riga separata da TAB, incollala in **A1**.
4. (Opzionale) Riga 1 grassetto, Visualizza → Blocca → 1 riga.

## 2. Apps Script

1. Dal foglio: **Estensioni → Apps Script**.
2. Cancella il codice di esempio in `Code.gs`.
3. Apri `apps-script/Code.gs` da questo repo, copia tutto, incollalo nell'editor.
4. Salva (`Ctrl+S`). Dai un nome al progetto, es. `ISF HR Backend`.

## 3. Configura le proprietà segrete

Due opzioni:

### Opzione A — via UI (consigliata)
1. In editor: icona ingranaggio sinistra → **Project Settings**.
2. Sezione **Script Properties** → **Add script property**.
3. Aggiungi:
   - `ADMIN_PASSWORD` → la password che vuoi per la dashboard
   - `ADMIN_TOKEN` → una stringa casuale lunga (32+ caratteri, es. genera con `openssl rand -hex 32`)
4. Salva.

### Opzione B — via funzione
1. Apri `setupProperties()` in Code.gs, modifica i valori delle costanti.
2. Run → `setupProperties` (autorizza al primo run: scegli il tuo account, "Avanzate" → "Vai a (sicuro)").
3. Dopo l'esecuzione, **rimuovi/sostituisci i valori in setupProperties** così non restano in chiaro nel codice.

## 4. Deploy come Web App

1. Editor → **Deploy → New deployment**.
2. Icona ingranaggio accanto a "Select type" → **Web app**.
3. Compila:
   - Description: `v1 production`
   - Execute as: **Me (tuo@gmail.com)**
   - Who has access: **Anyone**  ← importante, sennò il front-end non può chiamare l'endpoint
4. **Deploy** → autorizza permessi → copia l'URL della **Web app** (formato `https://script.google.com/macros/s/AKfy.../exec`).

## 5. Inserisci l'URL nel front-end

Apri `src/pages/index.astro` e cerca:
```js
const WEBHOOK_URL = '';
```
Sostituisci con l'URL della tua Web App:
```js
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

## 6. Test rapido

### Submit candidatura (dal sito)
- Apri http://localhost:4321/ → completa il questionario.
- Verifica: foglio Google riceve una nuova riga con scoring/categoria popolati.

### Login admin (curl)
```bash
curl -X POST 'https://script.google.com/macros/s/AKfy.../exec' \
  -H 'Content-Type: text/plain;charset=utf-8' \
  -d '{"action":"login","password":"LA_TUA_PASSWORD"}'
```
Risposta attesa: `{"ok":true,"token":"..."}`

### List candidati
```bash
curl -X POST 'https://script.google.com/macros/s/AKfy.../exec' \
  -H 'Content-Type: text/plain;charset=utf-8' \
  -d '{"action":"list","token":"IL_TOKEN_RICEVUTO"}'
```

## 7. Aggiornamenti futuri

Quando modifichi `Code.gs`:
- **Save** (Ctrl+S).
- **Deploy → Manage deployments** → matita sull'attivo → **Version: New version** → Deploy.
  L'URL `/exec` resta lo stesso.

## Note di sicurezza

- Password e token vivono solo nelle Script Properties, non finiscono mai nel front-end.
- Il front-end espone solo il **token di sessione**, non la password.
- Per ruotare le credenziali: aggiorna le Script Properties, fai un nuovo deploy.
- Logout admin: rimuovi `sessionStorage.isf_admin_session` dal browser.
