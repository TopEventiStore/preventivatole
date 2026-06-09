// Funzione serverless: interpreta la mail del cliente con Claude e restituisce una bozza di preventivo in JSON.
// La chiave NON è nel codice: va impostata in Netlify > Site settings > Environment variables come ANTHROPIC_API_KEY.

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON non valido' }, 400); }
  const { emailText, catalog, rules } = body || {};
  if (!emailText) return json({ error: 'emailText mancante' }, 400);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'ANTHROPIC_API_KEY non configurata su Netlify' }, 500);
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const system = [
    'Sei l\'assistente operativo di "Top Eventi Noleggio", societa di noleggio per eventi.',
    'Ricevi il testo di una mail di richiesta di un cliente e proponi una BOZZA di preventivo che un\'operatrice umana verifichera. Lavora in italiano.',
    'Hai il CATALOGO prodotti (array JSON; ogni elemento: id numerico, n=nome, c=categoria, pmin=prezzo minimo, varianti=eventuale elenco di varianti).',
    'Compiti:',
    '1) Abbina i prodotti richiesti al catalogo SOLO tramite "id". Se un prodotto ha varianti, scegli la piu coerente e mettine il testo in "variante". Non inventare prodotti assenti: se un articolo richiesto non esiste, ignoralo e citalo nella interpretazione.',
    '2) Stima le quantita dal testo (se mancanti: 1, e segnalalo).',
    '3) Modalita: "consegna" (a domicilio), "ritiro" (cliente ritira in magazzino) o "dacalcolare" se il trasporto e incerto. Se consegna estrai "indirizzo". Se ritiro scegli "magazzino" tra "Milano Opera" e "Vicenza Brendola".',
    '4) Date in formato YYYY-MM-DD (data_consegna, data_ritiro) se presenti, altrimenti stringa vuota.',
    '5) Fasce orarie scegliendo tra: "Giornata intera 9:00-18:00","Mattino 9:00-13:00","Pomeriggio 14:00-18:00","Straordinaria 6:00-9:00","Straordinaria 18:00-22:00","Notturno 22:00-24:00","Notturno 00:00-6:00". Se indicano un orario preciso diverso, riportalo testualmente.',
    '6) Proponi il furgone con LOGICA di capienza in base a quantita e ingombro: "Doblo" (max 500 kg, 3 m3, pochi/piccoli pezzi), "Jumper" (max 1000 kg, 8 m3, quantita medie), "Cassonato" (max 1500 kg, 20 m3, grandi quantita o arredi voluminosi). Indica "carico": 50 o 100 (percentuale stimata di riempimento).',
    '7) "interpretazione": breve spiegazione in italiano di cosa hai capito, assunzioni, dubbi e cosa l\'operatrice dovrebbe verificare.',
    'Rispetta con priorita alta le REGOLE APPRESE dall\'operatrice fornite nel messaggio.',
    'Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo prima o dopo, con questa forma:',
    '{"prodotti":[{"id":0,"qta":1,"variante":""}],"modalita":"consegna","magazzino":"","indirizzo":"","data_consegna":"","data_ritiro":"","fascia_consegna":"","fascia_ritiro":"","veicolo":"Jumper","carico":100,"interpretazione":"..."}'
  ].join('\n');

  const userMsg = 'CATALOGO:\n' + JSON.stringify(catalog) +
    '\n\nREGOLE APPRESE:\n' + ((rules && rules.length) ? rules.map(r => '- ' + r).join('\n') : '(nessuna)') +
    '\n\nMAIL DEL CLIENTE:\n"""\n' + emailText + '\n"""\n\nRestituisci solo il JSON.';

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2000, system, messages: [{ role: 'user', content: userMsg }] })
    });
  } catch (e) { return json({ error: 'Connessione AI fallita' }, 502); }

  if (!r.ok) { const t = await r.text(); return json({ error: 'AI ' + r.status, detail: t.slice(0, 300) }, 502); }
  const data = await r.json();
  const text = (data.content || []).map(b => b.text || '').join('');
  const slice = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let parsed;
  try { parsed = JSON.parse(slice); } catch { return json({ error: 'Risposta AI non interpretabile', raw: text.slice(0, 300) }, 502); }
  return json(parsed, 200);
};

function cors() { return { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }; }
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json', ...cors() } }); }
