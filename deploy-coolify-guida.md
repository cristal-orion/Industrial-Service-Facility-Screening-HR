# Guida Deploy su Coolify — Sito Astro Statico

Guida basata sull'esperienza del progetto Plus Vending. Tutto quello che serve per mettere online un sito Astro statico su Coolify senza impazzire.

---

## Architettura

```
Browser → Traefik (porta 80/443, gestito da Coolify) → Container Docker (nginx porta 4321)
```

Coolify usa **Traefik** come reverse proxy. Il tuo container gira internamente su una porta qualsiasi (noi usiamo 4321), Traefik lo espone su 80/443 con SSL automatico.

---

## Stack consigliato

- **Astro** con output statico (`output: 'static'` in `astro.config.mjs`)
- **Nginx Alpine** come web server per i file buildati
- **Dockerfile multi-stage** (build con Node + serve con Nginx)
- **Build pack Coolify: Dockerfile** (NON Nixpacks)

---

## Il Dockerfile

Copia questo nella root del progetto e adattalo:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

# Copia solo package.json (SENZA package-lock) per installazione
# pulita con i binari nativi corretti per Linux (rolldown, sharp, ecc.)
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Runtime: nginx per servire i file statici ---
FROM nginx:alpine

RUN printf 'server {\n\
    listen 4321;\n\
    server_name _;\n\
    port_in_redirect off;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    location / {\n\
        try_files $uri $uri/ =404;\n\
    }\n\
\n\
    error_page 404 /index.html;\n\
\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml image/svg+xml;\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 4321
CMD ["nginx", "-g", "daemon off;"]
```

---

## Trappole e soluzioni

### 1. `port_in_redirect off` — OBBLIGATORIO

Nginx ascolta su porta 4321 (interna), ma Traefik espone su 80/443.
Senza `port_in_redirect off`, i redirect 301 (es. `/pagina` → `/pagina/`) includono la porta interna:

```
Location: http://dominio:4321/pagina/   ← ERRORE, porta non esposta
```

Con `port_in_redirect off`:

```
Location: http://dominio/pagina/         ← CORRETTO
```

**Non togliere mai questa direttiva.**

### 2. NON committare package-lock.json

Il lockfile generato su Windows/macOS contiene riferimenti a binari nativi per quella piattaforma. Nel container Linux Alpine questi binari non esistono → build fallita.

Soluzione: copiare solo `package.json` e fare `npm install` fresco nel Dockerfile. Aggiungere al `.gitignore`:

```
package-lock.json
```

### 3. NON usare Nixpacks

Abbiamo provato, non funziona per siti Astro statici per due motivi:
- **Binding nativi mancanti** — rolldown/sharp richiedono binari Linux non presenti nel lockfile generato su altra piattaforma
- **Nessun start command** — Nixpacks non sa come servire i file statici buildati da Astro

La soluzione definitiva è il Dockerfile multi-stage sopra.

---

## Setup su Coolify

### Passo per passo

1. **Collega il repo GitHub** tramite la GitHub App configurata su Coolify
2. **Imposta il build pack su "Dockerfile"** (non Nixpacks, non Docker Compose)
3. **Porta esposta:** 4321 (quella nel Dockerfile)
4. **Auto-deploy:** attivalo per deploy automatici su ogni push
5. **Variabili d'ambiente:** nessuna necessaria per un sito statico (le chiavi di servizi client-side come EmailJS stanno nel frontend)
6. **Dominio:** configuralo nella sezione domini di Coolify, Traefik gestisce SSL via Let's Encrypt

### Verifica post-deploy

- Apri l'URL temporaneo `*.sslip.io` che Coolify assegna
- Naviga su una sotto-pagina (es. `/contatti`) e verifica che il redirect non mostri `:4321` nell'URL
- Testa il caricamento diretto di una sotto-pagina (copia l'URL e incollalo in una nuova tab)

---

## Aggiungere nuove pagine

Astro genera pagine statiche come `dist/nomepagina/index.html`.
Nginx con `try_files $uri $uri/ =404` + `index index.html` le serve automaticamente.
**Non serve toccare la config nginx quando aggiungi nuove pagine.**

---

## Checklist pre-push

- [ ] `npm run build` funziona in locale senza errori
- [ ] `package-lock.json` NON è nel commit
- [ ] Il Dockerfile è nella root del repo
- [ ] `port_in_redirect off` è presente nella config nginx del Dockerfile
- [ ] Build pack su Coolify impostato su "Dockerfile"

---

## Comandi utili

```bash
# Build locale di test
npm run build

# Test locale con Docker (simula esattamente il deploy)
docker build -t nome-sito . && docker run -p 4321:4321 nome-sito
# poi apri http://localhost:4321
```
