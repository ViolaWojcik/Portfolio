/**
 * Read the numbers back out of PostHog: `npm run stats`.
 *
 * The site only ever WRITES to PostHog. The key in analytics.js is `phc_…`,
 * which by design cannot read a single event back. Reading needs a personal
 * key (`phx_…`), and a personal key is the whole account — so it never goes
 * near this repo. It lives in ~/.config/posthog/portfolio.json, chmod 600,
 * asked for once on the first run and never printed again.
 *
 * WHY THE $current_url FILTER
 * One PostHog project serves two sites (this one and the journal). The board
 * ships its own posthog-js config and does not send `$host`, so filtering on
 * that gives an empty report that looks exactly like "nobody visited".
 * Everything below filters on `$current_url` instead — same rule the two
 * dashboards use.
 *
 * WHY AN EMPTY REPORT RE-QUERIES ITSELF
 * Zero rows has two very different causes: no traffic, or a filter that no
 * longer matches. Those are indistinguishable from the output, so when the
 * filtered count comes back 0 the script asks a second, unfiltered question
 * and prints which URLs the project actually saw. Silence should have to
 * prove it is silence.
 *
 *   npm run stats                 last 7 days
 *   npm run stats -- --days 30    a different window
 *   npm run stats -- --json       also dump the raw rows to tools/reports/
 *   npm run stats -- --setup      re-enter the key / pick another project
 */

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = join(homedir(), '.config', 'posthog');
const CONFIG_FILE = join(CONFIG_DIR, 'portfolio.json');

/* EU account — a US one would need us.posthog.com here and in analytics.js. */
const DEFAULT_HOST = 'https://eu.posthog.com';
const DEFAULT_SITE = 'wioletawojcik.com';

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

if (flag('help')) {
  console.log(`
  npm run stats                  ostatnie 7 dni
  npm run stats -- --days 30     inne okno czasowe
  npm run stats -- --json        dodatkowo zrzut surowych danych do tools/reports/
  npm run stats -- --setup       ponowna konfiguracja klucza / projektu
  npm run stats -- --site x.com  inna domena niż ${DEFAULT_SITE}
`);
  process.exit(0);
}

const days = Number(flag('days', 7));
if (!Number.isInteger(days) || days < 1 || days > 365) {
  console.error('--days musi być liczbą całkowitą od 1 do 365.');
  process.exit(1);
}

const site = String(flag('site', DEFAULT_SITE));
/* The domain is interpolated into HogQL, so it may only look like a domain. */
if (!/^[a-z0-9.-]+$/i.test(site)) {
  console.error('--site wygląda podejrzanie; dozwolone są litery, cyfry, kropka i myślnik.');
  process.exit(1);
}

/* ---------- terminal input ---------- */

function ask(question, { secret = false } = {}) {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error(
        'Skrypt potrzebuje odpowiedzi, ale nie działa w terminalu.\n' +
          'Uruchom go ręcznie w Terminalu: cd ~/Desktop/Portfolio && npm run stats'
      )
    );
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => {
      if (!muted) write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      if (secret) process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = secret; /* set after the prompt itself has been printed */
  });
}

/* ---------- configuration ---------- */

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await chmod(CONFIG_FILE, 0o600);
  console.log(`\nZapisane w ${CONFIG_FILE} (tylko do odczytu dla Ciebie, chmod 600).`);
}

async function setup(existing) {
  const host = existing?.host || DEFAULT_HOST;

  console.log(`
Potrzebny jest osobisty klucz API PostHoga (zaczyna się od "phx_").

  1. Otwórz ${host}/settings/user-api-keys
  2. "Create personal API key", nazwa np. "portfolio-summary"
  3. Zakres: wystarczy dostęp DO ODCZYTU — zaznacz "Query: Read"
     oraz "Project: Read" (a jeśli chcesz linki do nagrań: "Session recording: Read")
  4. Skopiuj klucz — PostHog pokazuje go tylko raz.

Klucz nie trafi do repozytorium ani na ekran: wpisywanie jest zamaskowane,
a plik ląduje w ${CONFIG_FILE}.
`);

  /* Two checks, because they fail differently: the prefix catches a pasted
     `phc_` key instantly, and the round-trip catches a revoked or mistyped one
     now rather than eight queries later. A 403 here is fine — a narrowly
     scoped key is allowed to refuse this endpoint. */
  let key = process.env.POSTHOG_PERSONAL_API_KEY || '';
  for (;;) {
    if (!key.startsWith('phx_')) {
      if (key) console.log('To nie wygląda na klucz osobisty (powinien zaczynać się od "phx_").\n');
      key = await ask('Wklej klucz phx_… : ', { secret: true });
      continue;
    }
    try {
      await request(host, key, '/api/users/@me/');
      break;
    } catch (err) {
      if (err.status === 403) break;
      if (err.status === 401) {
        console.log('PostHog nie przyjął tego klucza. Sprawdź, czy skopiował się w całości.\n');
        key = '';
        continue;
      }
      throw err; /* brak sieci, zły region — to nie jest wina klucza */
    }
  }

  /* Which project? Ask PostHog rather than making her find the number. */
  let projects = [];
  for (const path of ['/api/projects/', '/api/organizations/@current/projects/']) {
    try {
      const data = await request(host, key, path);
      projects = (data.results || []).map((p) => ({ id: p.id, name: p.name }));
      if (projects.length) break;
    } catch {
      /* try the next shape, then fall back to asking */
    }
  }

  let projectId;
  if (projects.length === 1) {
    projectId = projects[0].id;
    console.log(`Projekt: ${projects[0].name} (${projectId})`);
  } else if (projects.length > 1) {
    console.log('\nProjekty na tym koncie:');
    projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}  (id ${p.id})`));
    let pick = NaN;
    while (!projects[pick - 1]) {
      pick = Number(await ask(`Który projekt (1-${projects.length})? `));
    }
    projectId = projects[pick - 1].id;
  } else {
    console.log(
      '\nNie udało się pobrać listy projektów (klucz może nie mieć zakresu "Project: Read").' +
        `\nNumer projektu widać w adresie panelu: ${host}/project/12345/…\n`
    );
    let typed = '';
    while (!/^\d+$/.test(typed)) typed = await ask('Numer projektu: ');
    projectId = Number(typed);
  }

  const config = { host, key, projectId };
  await saveConfig(config);
  return config;
}

/* ---------- PostHog API ---------- */

async function request(host, key, path, init = {}) {
  const res = await fetch(`${host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  if (res.ok) return res.json();

  const body = await res.text().catch(() => '');
  const detail = body.slice(0, 400);

  /* Callers need the code, not just the sentence: setup retries on 401 but
     shrugs off 403, because a scoped key legitimately refuses some endpoints. */
  const fail = (message) => {
    const err = new Error(message);
    err.status = res.status;
    return err;
  };

  if (res.status === 401) {
    throw fail(
      'PostHog odrzucił klucz (401). Klucz wygasł albo został usunięty.\n' +
        'Wygeneruj nowy i uruchom: npm run stats -- --setup'
    );
  }
  if (res.status === 403) {
    throw fail(
      'Klucz działa, ale nie ma uprawnień (403).\n' +
        'W PostHogu → Personal API keys dodaj zakresy "Query: Read" i "Project: Read",\n' +
        'albo wygeneruj nowy klucz i uruchom: npm run stats -- --setup\n\n' +
        detail
    );
  }
  if (res.status === 404) {
    throw fail(
      `Nie ma takiego zasobu (404): ${path}\n` +
        'Najczęściej to zły numer projektu albo zły region (EU vs US).\n' +
        'Popraw przez: npm run stats -- --setup'
    );
  }
  if (res.status === 429) {
    throw fail('PostHog przycina zapytania (429). Odczekaj minutę i uruchom ponownie.');
  }
  throw fail(`PostHog zwrócił ${res.status} dla ${path}\n${detail}`);
}

/* One HogQL question. Returns rows as objects, so the report below reads by
   column name and does not break when a column is inserted. */
async function hogql(config, sql) {
  const data = await request(config.host, config.key, `/api/projects/${config.projectId}/query/`, {
    method: 'POST',
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } })
  });
  const cols = data.columns || [];
  return (data.results || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

/* ---------- formatting ---------- */

const val = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

/* "$direct" is PostHog's marker for "no referrer", which reads as noise. */
const source = (v) => (v === '$direct' || v === null || v === '' ? 'wpisany bezpośrednio' : String(v));

const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function table(headers, rows) {
  if (!rows.length) {
    console.log('  (nic)');
    return;
  }
  const all = [headers, ...rows.map((r) => r.map(val))];
  const width = headers.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  const line = (cells, pad = ' ') =>
    '  ' + cells.map((c, i) => String(c).padEnd(width[i], pad)).join('  ').trimEnd();
  console.log(line(headers));
  console.log(line(width.map((w) => ''.padEnd(w, '─')), '─'));
  for (const r of rows) console.log(line(r.map(val)));
}

const heading = (text) => console.log(`\n\n${text}\n${'═'.repeat(text.length)}`);

/* ---------- the report ---------- */

async function main() {
  let config = await loadConfig();
  if (!config || flag('setup')) config = await setup(config);
  if (process.env.POSTHOG_PERSONAL_API_KEY) config = { ...config, key: process.env.POSTHOG_PERSONAL_API_KEY };

  const WINDOW = `timestamp >= now() - INTERVAL ${days} DAY`;
  const WHERE = `${WINDOW} AND properties.$current_url LIKE '%${site}%'`;
  const raw = {};

  /* One broken section should cost that section, not the report. A rejected
     key or a missing scope is different — that breaks everything downstream
     too, so those still stop the run. */
  const q = async (name, sql, { critical = false } = {}) => {
    try {
      return (raw[name] = await hogql(config, sql));
    } catch (err) {
      if (critical || [401, 403, 404, 429].includes(err.status)) throw err;
      console.log(`  (ta sekcja się nie policzyła: ${err.message.split('\n')[0]})`);
      return (raw[name] = []);
    }
  };

  console.log(`\nPostHog · ${site} · ostatnie ${days} dni`);

  const [overview] = await q(
    'overview',
    `SELECT count() AS events,
            countIf(event = '$pageview') AS pageviews,
            uniq(properties.$session_id) AS sessions,
            uniq(person_id) AS people,
            min(timestamp) AS first_seen,
            max(timestamp) AS last_seen
     FROM events WHERE ${WHERE}`,
    { critical: true }
  );

  /* Nothing came back. Before reporting "brak ruchu", make the project prove it. */
  if (!overview || Number(overview.events) === 0) {
    console.log(`\nZero zdarzeń z adresem zawierającym "${site}" w tym oknie.`);
    const [any] = await q('sanity_total', `SELECT count() AS events FROM events WHERE ${WINDOW}`);
    if (!any || Number(any.events) === 0) {
      console.log(
        `Ale i cały projekt jest pusty w tych ${days} dniach — czyli to naprawdę brak ruchu,\n` +
          'a nie zły filtr. (Warto sprawdzić, czy strona na produkcji nadal ładuje analytics.js.)'
      );
    } else {
      console.log(`Projekt w tym czasie zebrał ${any.events} zdarzeń — więc to filtr się rozjechał, nie ruch:`);
      const urls = await q(
        'sanity_urls',
        `SELECT toString(properties.$current_url) AS url, count() AS n
         FROM events WHERE ${WINDOW} GROUP BY url ORDER BY n DESC LIMIT 10`
      );
      table(['adres', 'zdarzeń'], urls.map((r) => [r.url, r.n]));
      console.log('\nJeśli domena wygląda inaczej niż zakładano: npm run stats -- --site prawdziwa-domena');
    }
    await maybeDump(raw);
    return;
  }

  heading('Podsumowanie');
  console.log(`  Sesje:            ${overview.sessions}`);
  console.log(`  Odsłony:          ${overview.pageviews}`);
  console.log(`  Wszystkie zdarzenia: ${overview.events}`);
  console.log(`  Pierwsze / ostatnie: ${when(overview.first_seen)} → ${when(overview.last_seen)}`);

  heading('Dzień po dniu');
  table(
    ['dzień', 'sesje', 'odsłony'],
    (
      await q(
        'by_day',
        `SELECT toDate(timestamp) AS day,
                uniq(properties.$session_id) AS sessions,
                countIf(event = '$pageview') AS pageviews
         FROM events WHERE ${WHERE} GROUP BY day ORDER BY day`
      )
    ).map((r) => [r.day, r.sessions, r.pageviews])
  );

  heading('Skąd przyszli');
  table(
    ['źródło', 'sesje'],
    (
      await q(
        'sources',
        `SELECT toString(properties.$referring_domain) AS src,
                uniq(properties.$session_id) AS sessions
         FROM events WHERE ${WHERE} GROUP BY src ORDER BY sessions DESC LIMIT 15`
      )
    ).map((r) => [source(r.src), r.sessions])
  );

  heading('Kraj i miasto');
  table(
    ['kraj', 'miasto', 'sesje'],
    (
      await q(
        'geo',
        `SELECT toString(properties.$geoip_country_name) AS country,
                toString(properties.$geoip_city_name) AS city,
                uniq(properties.$session_id) AS sessions
         FROM events WHERE ${WHERE} GROUP BY country, city ORDER BY sessions DESC LIMIT 15`
      )
    ).map((r) => [r.country, r.city, r.sessions])
  );

  heading('Urządzenia');
  table(
    ['urządzenie', 'przeglądarka', 'sesje'],
    (
      await q(
        'devices',
        `SELECT toString(properties.$device_type) AS device,
                toString(properties.$browser) AS browser,
                uniq(properties.$session_id) AS sessions
         FROM events WHERE ${WHERE} GROUP BY device, browser ORDER BY sessions DESC LIMIT 10`
      )
    ).map((r) => [r.device, r.browser, r.sessions])
  );

  heading('Strony');
  table(
    ['strona', 'odsłony', 'sesje'],
    (
      await q(
        'pages',
        `SELECT toString(properties.page) AS page,
                count() AS views,
                uniq(properties.$session_id) AS sessions
         FROM events WHERE ${WHERE} AND event = '$pageview'
         GROUP BY page ORDER BY views DESC LIMIT 20`
      )
    ).map((r) => [r.page, r.views, r.sessions])
  );

  /* The named events — the honest part. Autocapture below is texture. */
  heading('Konwersje (zdarzenia nazwane)');
  const labelOf = (r) => r.channel || r.project || r.file || r.page || '';
  table(
    ['zdarzenie', 'szczegół', 'ile', 'sesje'],
    (
      await q(
        'conversions',
        `SELECT event AS name,
                toString(properties.channel) AS channel,
                toString(properties.project) AS project,
                toString(properties.file) AS file,
                toString(properties.page) AS page,
                count() AS n,
                uniq(properties.$session_id) AS sessions
         FROM events
         WHERE ${WHERE} AND event IN ('cv_downloaded','contact_clicked','case_study_opened','case_study_read')
         GROUP BY name, channel, project, file, page ORDER BY n DESC`
      )
    ).map((r) => [r.name, labelOf(r), r.n, r.sessions])
  );

  heading('Najczęściej klikane elementy (autocapture)');
  table(
    ['element', 'kliknięcia'],
    (
      await q(
        'clicks',
        `SELECT toString(properties.$el_text) AS label, count() AS clicks
         FROM events
         WHERE ${WHERE} AND event = '$autocapture' AND toString(properties.$event_type) = 'click'
         GROUP BY label ORDER BY clicks DESC LIMIT 12`
      )
    ).map((r) => [String(r.label ?? '').replace(/\s+/g, ' ').slice(0, 40), r.clicks])
  );

  heading('Ostatnie sesje');
  const sessions = await q(
    'sessions',
    `SELECT toString(properties.$session_id) AS sid,
            min(timestamp) AS started,
            countIf(event = '$pageview') AS pageviews,
            countIf(event = 'cv_downloaded') AS cv,
            countIf(event = 'contact_clicked') AS contact,
            countIf(event = 'case_study_read') AS finished,
            any(properties.$geoip_city_name) AS city,
            any(properties.$geoip_country_name) AS country,
            any(properties.$referring_domain) AS src,
            any(properties.$device_type) AS device
     FROM events WHERE ${WHERE} GROUP BY sid ORDER BY started DESC LIMIT 20`
  );
  table(
    ['kiedy', 'skąd', 'miejsce', 'urządzenie', 'stron', 'sygnały'],
    sessions.map((r) => [
      when(r.started),
      source(r.src),
      [r.city, r.country].filter(Boolean).join(', '),
      r.device,
      r.pageviews,
      [r.cv ? 'CV' : null, r.contact ? 'kontakt' : null, r.finished ? 'doczytał' : null]
        .filter(Boolean)
        .join(' + ') || ''
    ])
  );

  if (sessions.length) {
    console.log('\n  Nagrania (jeśli sesja została nagrana — nagrywanie jest włączone dla portfolio):');
    for (const r of sessions.slice(0, 8)) {
      console.log(`  ${when(r.started).padEnd(14)} ${config.host}/project/${config.projectId}/replay/${r.sid}`);
    }
  }

  console.log(`
Czego te liczby NIE mówią:
  · Kim są odwiedzający. Strona nikogo nie identyfikuje — nie ma imion ani e-maili,
    są kraj i miasto z IP, urządzenie i źródło wejścia.
  · Ile osób wróciło. analytics.js trzyma stan w sessionStorage zamiast w ciasteczku
    (świadomie — dlatego nie ma banera zgody), więc ta sama osoba jutro liczy się od nowa.
  · Ilu odwiedzających blokuje analitykę. Ci nie pojawią się tu w ogóle.`);

  await maybeDump(raw);
}

async function maybeDump(raw) {
  if (!flag('json')) return;
  const dir = join(ROOT, 'tools', 'reports');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = typeof flag('json') === 'string' ? String(flag('json')) : join(dir, `posthog-${stamp}.json`);
  await writeFile(file, JSON.stringify({ site, days, generated: new Date().toISOString(), ...raw }, null, 2));
  console.log(`\nSurowe dane: ${file}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
