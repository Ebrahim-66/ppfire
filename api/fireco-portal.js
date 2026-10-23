import { neon } from '@neondatabase/serverless';
import { del, get, put } from '@vercel/blob';
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import clientsSeed from '../public/data/clients.json' with { type: 'json' };

const scrypt = promisify(scryptCb);
const SESSION_TTL = 60 * 60 * 8;
let sql;
let schemaPromise;
const json = (res, status, data, headers = {}) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(data));
};
const secret = () => {
  const value = process.env.PORTAL_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('Portal session secret is not configured');
  return value;
};
const db = () => {
  if (!process.env.DATABASE_URL) throw new Error('Portal database is not configured');
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
};
const emailValid = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const clean = (value, max = 2000) => String(value ?? '').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
const hashPassword = async password => {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(hash).toString('base64url')}`;
};
const verifyPassword = async (password, encoded) => {
  const [kind, saltText, hashText] = String(encoded || '').split('$');
  if (kind !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = Buffer.from(await scrypt(String(password), Buffer.from(saltText, 'base64url'), expected.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
const tokenSign = data => {
  const value = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${value}.${createHmac('sha256', secret()).update(value).digest('base64url')}`;
};
const tokenRead = value => {
  if (!value || value.length > 3000) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return data.exp > Math.floor(Date.now() / 1000) ? data : null;
  } catch { return null; }
};
const cookieValue = request => Object.fromEntries(String(request.headers.cookie || '').split(';').map(part => part.trim().split('=').map(decodeURIComponent))).portal_session;
const sessionCookie = token => `portal_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/api/portal; Max-Age=${SESSION_TTL}`;
const clearCookie = 'portal_session=; HttpOnly; Secure; SameSite=Strict; Path=/api/portal; Max-Age=0';
const isManager = user => user?.role === 'manager';
const requireManager = user => { if (!user) throw Object.assign(new Error('Sign in required'), { status: 401 }); if (!isManager(user)) throw Object.assign(new Error('Manager permission required'), { status: 403 }); };

async function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const q = db();
    await q`CREATE TABLE IF NOT EXISTS portal_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE, password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('manager','admin')), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS portal_enquiries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, company text NOT NULL DEFAULT '', email text NOT NULL, phone text NOT NULL DEFAULT '', location text NOT NULL, details text NOT NULL, status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','completed','archived')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS portal_applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL, phone text NOT NULL DEFAULT '', role text NOT NULL, message text NOT NULL, cv_pathname text NOT NULL, cv_filename text NOT NULL, status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','shortlisted','rejected','hired')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS portal_clients (id text PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS portal_analytics_daily (day date NOT NULL DEFAULT current_date, event text NOT NULL, label text NOT NULL DEFAULT '', count bigint NOT NULL DEFAULT 0, PRIMARY KEY (day,event,label))`;
    await q`CREATE TABLE IF NOT EXISTS portal_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS portal_login_attempts (id bigserial PRIMARY KEY, ip_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS portal_public_limits (id bigserial PRIMARY KEY, ip_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS portal_analytics_limits (ip_hash text PRIMARY KEY, last_event timestamptz NOT NULL DEFAULT now())`;
    const users = [
      { username: clean(process.env.PORTAL_MANAGER_USERNAME || 'MANAGER', 80).toLowerCase(), password: process.env.PORTAL_MANAGER_PASSWORD, role: 'manager' },
      { username: clean(process.env.PORTAL_ADMIN_USERNAME || 'admin', 80).toLowerCase(), password: process.env.PORTAL_ADMIN_PASSWORD, role: 'admin' },
    ];
    if(users.every(user=>user.password&&user.password.length>=12)){
      const managerHash=await hashPassword(users[0].password),adminHash=await hashPassword(users[1].password);
      await q`WITH gate AS (INSERT INTO portal_settings(key,value) VALUES ('accounts_bootstrapped','true') ON CONFLICT(key) DO NOTHING RETURNING key), manager_seed AS (INSERT INTO portal_users(username,password_hash,role) SELECT ${users[0].username},${managerHash},'manager' FROM gate ON CONFLICT(username) DO NOTHING RETURNING id), admin_seed AS (INSERT INTO portal_users(username,password_hash,role) SELECT ${users[1].username},${adminHash},'admin' FROM gate ON CONFLICT(username) DO NOTHING RETURNING id) SELECT 1`;
    }
    await q`INSERT INTO portal_settings (key,value) VALUES ('enquiry_email','info@firecots.com'),('careers_email','hr@firecots.com'),('profile_pathname','') ON CONFLICT (key) DO NOTHING`;
    await q`INSERT INTO portal_clients (id,data) SELECT lower(trim(both '-' from regexp_replace(coalesce(x->>'name_en',x->>'name_ar','client'), '[^a-zA-Z0-9]+', '-', 'g'))), x FROM jsonb_array_elements(${JSON.stringify(clientsSeed.clients)}::jsonb) x ON CONFLICT (id) DO NOTHING`;
  })().catch(error => { schemaPromise = null; throw error; });
  await schemaPromise;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = new Set([
    process.env.APP_ORIGIN,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    'https://ppfire.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter(Boolean).map(value => value.replace(/\/$/, '')));
  return allowed.has(origin.replace(/\/$/, ''));
}
function requestIpHash(req) {
  const day=new Date().toISOString().slice(0,10);
  return createHmac('sha256', secret()).update(`${day}:${String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()}`).digest('hex');
}
function requestUser(req) {
  const data = tokenRead(cookieValue(req));
  return data?.sub ? data : null;
}
function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}
async function sendNotice(to, subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
    });
    if (!response.ok) {
      console.error('Portal notification email failed', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Portal notification email request failed', error?.message || error);
    return false;
  }
}
const idParam = req => clean(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id, 80);
const pathOf = req => {
  const route = req.query?.path;
  if (route) return (Array.isArray(route) ? route : [route]).filter(Boolean).join('/');
  return new URL(req.url || '/', 'http://localhost').pathname
    .replace(/^\/api\/portal\/?/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
};
const settingRows = async () => (await db()`SELECT key,value FROM portal_settings ORDER BY key`).reduce((result, row) => ({ ...result, [row.key]: row.value }), {});

async function main(req, res) {
  const path = pathOf(req);
  const method = req.method || 'GET';
  if (method === 'OPTIONS') return json(res, 204, {}, { Allow: 'GET, POST, PATCH, PUT, DELETE, OPTIONS' });
  const publicMutation = ['auth/login','public/enquiry','public/application','analytics'].includes(path) && method === 'POST';
  if ((method !== 'GET' && method !== 'HEAD') || publicMutation) {
    if (!originAllowed(req)) return json(res, 403, { error: 'Request origin not allowed' });
  }
  if (path === 'health' && method === 'GET') {
    const config = { database: Boolean(process.env.DATABASE_URL), blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN), email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), session: Boolean(process.env.PORTAL_SESSION_SECRET && process.env.PORTAL_SESSION_SECRET.length >= 32), accounts: Boolean(process.env.PORTAL_MANAGER_PASSWORD?.length >= 12 && process.env.PORTAL_ADMIN_PASSWORD?.length >= 12) };
    return json(res, 200, { ready: ['database', 'blob', 'session', 'accounts'].every(key => config[key]), notificationsReady: config.email, config });
  }
  await ensureSchema();
  if (path === 'public/clients' && method === 'GET') {
    const rows = await db()`SELECT data FROM portal_clients ORDER BY created_at, id`;
    return json(res, 200, { clients: rows.map(row => row.data) });
  }
  if (path === 'public/profile' && method === 'GET') {
    const rows=await db()`SELECT value FROM portal_settings WHERE key='profile_pathname' LIMIT 1`;
    if(!rows[0]?.value){res.statusCode=302;res.setHeader('Location','/assets/FIRECO.pdf');res.setHeader('Cache-Control','no-store');return res.end();}
    if(!process.env.BLOB_READ_WRITE_TOKEN){res.statusCode=302;res.setHeader('Location','/assets/FIRECO.pdf');return res.end();}
    const file=await get(rows[0].value,{access:'private'});
    if(!file||file.statusCode!==200){res.statusCode=302;res.setHeader('Location','/assets/FIRECO.pdf');return res.end();}
    res.statusCode=200;res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="FIRECO-Company-Profile.pdf"');res.setHeader('Cache-Control','public, max-age=300, stale-while-revalidate=600');res.setHeader('X-Content-Type-Options','nosniff');
    return Readable.fromWeb(file.stream).pipe(res);
  }
  if (path === 'profile' && method === 'GET') {
    const auth=requestUser(req);if(!auth)return json(res,401,{error:'Sign in required'});
    const users=await db()`SELECT username,role,active FROM portal_users WHERE id=${auth.sub} LIMIT 1`;if(!users[0]?.active)return json(res,401,{error:'Session expired'});requireManager({...auth,...users[0]});
    const rows=await db()`SELECT value FROM portal_settings WHERE key='profile_pathname' LIMIT 1`;
    return json(res,200,{uploaded:Boolean(rows[0]?.value)});
  }
  if (path === 'profile' && method === 'PUT') {
    const auth=requestUser(req);if(!auth)return json(res,401,{error:'Sign in required'});
    const users=await db()`SELECT username,role,active FROM portal_users WHERE id=${auth.sub} LIMIT 1`;if(!users[0]?.active)return json(res,401,{error:'Session expired'});requireManager({...auth,...users[0]});
    if(!process.env.BLOB_READ_WRITE_TOKEN)return json(res,503,{error:'Private file storage is not configured.'});
    const body=getBody(req),filename=clean(body.filename,160);
    if(!filename.toLowerCase().endsWith('.pdf')||typeof body.pdf!=='string')return json(res,400,{error:'Upload a PDF company profile.'});
    const file=Buffer.from(body.pdf,'base64');
    if(file.length<12||file.length>3*1024*1024||file.subarray(0,5).toString()!=='%PDF-')return json(res,400,{error:'Profile must be a valid PDF up to 3 MB.'});
    const previous=await db()`SELECT value FROM portal_settings WHERE key='profile_pathname' LIMIT 1`;
    const blob=await put(`profiles/${Date.now()}-FIRECO-profile.pdf`,file,{access:'private',contentType:'application/pdf',addRandomSuffix:true});
    try{await db()`INSERT INTO portal_settings(key,value) VALUES ('profile_pathname',${blob.pathname}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`;}
    catch(error){await del(blob.pathname).catch(()=>{});throw error;}
    if(previous[0]?.value)await del(previous[0].value).catch(error=>console.error('Old profile PDF cleanup failed',error?.message||error));
    return json(res,200,{ok:true,uploaded:true});
  }
  if (path === 'analytics' && method === 'POST') {
    const body = getBody(req);
    const event = clean(body.event, 30);
    const allowedEvents = new Set(['page_view','whatsapp_click','phone_click','location_click','instagram_click','email_click']);
    if (!allowedEvents.has(event)) return json(res, 400, { error: 'Invalid analytics event' });
    const label = clean(body.label, 120);
    const ipHash=requestIpHash(req);
    const allowed=await db()`INSERT INTO portal_analytics_limits(ip_hash,last_event) VALUES (${ipHash},now()) ON CONFLICT (ip_hash) DO UPDATE SET last_event=now() WHERE portal_analytics_limits.last_event < now() - interval '2 seconds' RETURNING ip_hash`;
    if (!allowed.length) return json(res, 202, { ok:true, sampled:true });
    await db()`INSERT INTO portal_analytics_daily(day,event,label,count) VALUES (current_date,${event},${label},1) ON CONFLICT (day,event,label) DO UPDATE SET count = portal_analytics_daily.count + 1`;
    return json(res, 202, { ok: true });
  }
  if (path === 'public/enquiry' && method === 'POST') {
    const body = getBody(req);
    if (clean(body.website, 200)) return json(res, 202, { ok: true, notified: true });
    const name = clean(body.name, 120), company = clean(body.company, 160), email = clean(body.email, 180), phone = clean(body.phone, 60), location = clean(body.location, 100), details = clean(body.details, 4000);
    if (!name || !emailValid(email) || !location || details.length < 5) return json(res, 400, { error: 'Please complete the required fields correctly.' });
    const ipHash = requestIpHash(req);
    const recent = await db()`SELECT count(*)::int AS count FROM portal_public_limits WHERE ip_hash=${ipHash} AND created_at > now() - interval '10 minutes'`;
    if (recent[0].count > 20) return json(res, 429, { error: 'Please wait a few minutes before trying again.' });
    await db()`INSERT INTO portal_public_limits(ip_hash) VALUES (${ipHash})`;
    const rows = await db()`INSERT INTO portal_enquiries(name,company,email,phone,location,details) VALUES (${name},${company},${email},${phone},${location},${details}) RETURNING id,created_at`;
    const setting = await settingRows();
    const notified = await sendNotice(setting.enquiry_email || 'info@firecots.com', 'New FIRECO website enquiry', `Name: ${name}\nCompany: ${company}\nEmail: ${email}\nPhone: ${phone}\nLocation: ${location}\n\n${details}`);
    return json(res, 201, { ok: true, id: rows[0].id, notified });
  }
  if (path === 'public/application' && method === 'POST') {
    const body = getBody(req);
    if (clean(body.website, 200)) return json(res, 202, { ok: true, notified: true });
    const name = clean(body.name, 120), email = clean(body.email, 180), phone = clean(body.phone, 60), role = clean(body.role, 160), message = clean(body.message, 3000), filename = clean(body.filename, 150);
    if (!name || !emailValid(email) || !role || !filename.toLowerCase().endsWith('.pdf') || typeof body.cv !== 'string') return json(res, 400, { error: 'Enter your details and attach a PDF CV.' });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return json(res, 503, { error: 'CV storage is not configured yet.' });
    const ipHash=requestIpHash(req);
    const recent=await db()`SELECT count(*)::int AS count FROM portal_public_limits WHERE ip_hash=${ipHash} AND created_at > now() - interval '1 hour'`;
    if(recent[0].count>=5)return json(res,429,{error:'Please wait before submitting another application.'});
    await db()`INSERT INTO portal_public_limits(ip_hash) VALUES (${ipHash})`;
    const file = Buffer.from(body.cv, 'base64');
    if (file.length < 12 || file.length > 3 * 1024 * 1024 || file.subarray(0, 5).toString() !== '%PDF-') return json(res, 400, { error: 'CV must be a valid PDF up to 3 MB.' });
    const safeName = filename.replace(/[^\p{L}\p{N}._-]/gu, '_');
    let blob;
    try {
      blob = await put(`applications/${Date.now()}-${safeName}`, file, { access: 'private', contentType: 'application/pdf', addRandomSuffix: true });
      const rows = await db()`INSERT INTO portal_applications(name,email,phone,role,message,cv_pathname,cv_filename) VALUES (${name},${email},${phone},${role},${message},${blob.pathname},${safeName}) RETURNING id,created_at`;
      const settings = await settingRows();
      const notified = await sendNotice(settings.careers_email || 'hr@firecots.com', 'New FIRECO careers application', `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nPosition: ${role}\n\n${message}\n\nCV uploaded securely. Sign in to the FIRECO portal to view it.`);
      return json(res, 201, { ok: true, id: rows[0].id, notified });
    } catch (error) {
      if (blob?.pathname) await del(blob.pathname).catch(() => {});
      throw error;
    }
  }

  if (path === 'auth/login' && method === 'POST') {
    const body = getBody(req);
    const username = clean(body.username, 80).toLowerCase();
    const password = String(body.password || '');
    const ipHash = requestIpHash(req);
    const recent = await db()`SELECT count(*)::int AS count FROM portal_login_attempts WHERE ip_hash=${ipHash} AND created_at > now() - interval '15 minutes'`;
    if (recent[0].count >= 8) return json(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });
    await db()`INSERT INTO portal_login_attempts(ip_hash) VALUES (${ipHash})`;
    const rows = await db()`SELECT id,username,password_hash,role,active FROM portal_users WHERE username=${username} LIMIT 1`;
    const user = rows[0];
    const valid = user && user.active && await verifyPassword(password, user.password_hash);
    if (!valid) return json(res, 401, { error: 'The username or password is incorrect.' });
    const token = tokenSign({ sub: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now()/1000) + SESSION_TTL });
    return json(res, 200, { ok: true, user: { username: user.username, role: user.role } }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (path === 'auth/logout' && method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  if (path === 'auth/me' && method === 'GET') {
    const data = requestUser(req);
    if (!data) return json(res, 401, { error: 'Sign in required' });
    const users = await db()`SELECT username,role,active FROM portal_users WHERE id=${data.sub} LIMIT 1`;
    if (!users[0]?.active) return json(res, 401, { error: 'Session expired' }, { 'Set-Cookie': clearCookie });
    return json(res, 200, { user: { username: users[0].username, role: users[0].role } });
  }

  const auth = requestUser(req);
  if (!auth) return json(res, 401, { error: 'Sign in required' });
  const activeRows = await db()`SELECT username,role,active FROM portal_users WHERE id=${auth.sub} LIMIT 1`;
  if (!activeRows[0]?.active) return json(res, 401, { error: 'Session expired' }, { 'Set-Cookie': clearCookie });
  const user = { ...auth, ...activeRows[0] };

  if (path === 'dashboard' && method === 'GET') {
    requireManager(user);
    const [enquiries, applications, clients, users, events, recentEvents] = await Promise.all([
      db()`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='new')::int AS new FROM portal_enquiries`,
      db()`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='new')::int AS new FROM portal_applications`,
      db()`SELECT count(*)::int AS total FROM portal_clients`,
      db()`SELECT count(*)::int AS total FROM portal_users WHERE active=true`,
      db()`SELECT coalesce(sum(count),0)::bigint AS total FROM portal_analytics_daily WHERE day >= current_date - 29`,
      db()`SELECT day,event,label,count::int AS count FROM portal_analytics_daily WHERE day >= current_date - 29 ORDER BY day DESC,event,label LIMIT 250`,
    ]);
    return json(res, 200, { enquiries: enquiries[0], applications: applications[0], clients: clients[0], users: users[0], visits30d: Number(events[0].total), events: recentEvents });
  }
  if (path === 'enquiries' && method === 'GET') return json(res, 200, { enquiries: await db()`SELECT * FROM portal_enquiries ORDER BY created_at DESC LIMIT 500` });
  if (path.startsWith('enquiries/') && path.endsWith('/status') && method === 'PATCH') {
    requireManager(user);
    const id = path.split('/')[1], status = clean(getBody(req).status, 30);
    if (!['new','in_progress','completed','archived'].includes(status)) return json(res, 400, { error: 'Invalid enquiry status.' });
    const rows = await db()`UPDATE portal_enquiries SET status=${status},updated_at=now() WHERE id=${id} RETURNING id`;
    return json(res, rows.length ? 200 : 404, rows.length ? { ok: true } : { error: 'Enquiry not found.' });
  }
  if (path.startsWith('enquiries/') && method === 'DELETE') {
    requireManager(user);
    const id = path.split('/')[1], rows = await db()`DELETE FROM portal_enquiries WHERE id=${id} RETURNING id`;
    return json(res, rows.length ? 200 : 404, rows.length ? { ok: true } : { error: 'Enquiry not found.' });
  }
  if (path === 'applications' && method === 'GET') return json(res, 200, { applications: await db()`SELECT id,name,email,phone,role,message,cv_filename,status,created_at,updated_at FROM portal_applications ORDER BY created_at DESC LIMIT 500` });
  if (path.startsWith('applications/') && path.endsWith('/cv') && method === 'GET') {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return json(res, 503, { error: 'CV storage is not configured.' });
    const id = path.split('/')[1], rows = await db()`SELECT cv_pathname,cv_filename FROM portal_applications WHERE id=${id} LIMIT 1`;
    if (!rows[0]) return json(res, 404, { error: 'Application not found.' });
    const file = await get(rows[0].cv_pathname, { access: 'private' });
    if (!file || file.statusCode !== 200) return json(res, 404, { error: 'CV not found.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].cv_filename.replace(/["\\\r\n]/g,'_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return Readable.fromWeb(file.stream).pipe(res);
  }
  if (path.startsWith('applications/') && path.endsWith('/status') && method === 'PATCH') {
    requireManager(user);
    const id = path.split('/')[1], status = clean(getBody(req).status, 30);
    if (!['new','reviewing','shortlisted','rejected','hired'].includes(status)) return json(res, 400, { error: 'Invalid application status.' });
    const rows = await db()`UPDATE portal_applications SET status=${status},updated_at=now() WHERE id=${id} RETURNING id`;
    return json(res, rows.length ? 200 : 404, rows.length ? { ok: true } : { error: 'Application not found.' });
  }
  if (path.startsWith('applications/') && method === 'DELETE') {
    requireManager(user);
    const id = path.split('/')[1], rows = await db()`SELECT cv_pathname FROM portal_applications WHERE id=${id} LIMIT 1`;
    if (!rows[0]) return json(res, 404, { error: 'Application not found.' });
    await del(rows[0].cv_pathname);
    await db()`DELETE FROM portal_applications WHERE id=${id}`;
    return json(res, 200, { ok: true });
  }
  if (path === 'clients' && method === 'GET') { requireManager(user); return json(res, 200, { clients: (await db()`SELECT id,data FROM portal_clients ORDER BY created_at,id`).map(row => ({ id: row.id, ...row.data })) }); }
  if (path === 'clients' && method === 'POST') {
    requireManager(user);
    const body = getBody(req), name_en = clean(body.name_en,120), name_ar = clean(body.name_ar,120), sector = clean(body.sector,80), location_en = clean(body.location_en,120), location_ar = clean(body.location_ar,120);
    if (!name_en || !name_ar || !sector) return json(res, 400, { error: 'English name, Arabic name and sector are required.' });
    const id = createHash('sha256').update(name_en.toLowerCase()).digest('hex').slice(0,20);
    await db()`INSERT INTO portal_clients(id,data) VALUES (${id},${JSON.stringify({ name_en,name_ar,sector,location_en,location_ar })}::jsonb)`;
    return json(res, 201, { id });
  }
  if (path.startsWith('clients/') && method === 'PUT') {
    requireManager(user);
    const id = path.split('/')[1], body = getBody(req), name_en = clean(body.name_en,120), name_ar = clean(body.name_ar,120), sector = clean(body.sector,80), location_en = clean(body.location_en,120), location_ar = clean(body.location_ar,120);
    if (!name_en || !name_ar || !sector) return json(res, 400, { error: 'English name, Arabic name and sector are required.' });
    const rows = await db()`UPDATE portal_clients SET data=${JSON.stringify({name_en,name_ar,sector,location_en,location_ar})}::jsonb,updated_at=now() WHERE id=${id} RETURNING id`;
    return json(res, rows.length ? 200 : 404, rows.length ? { ok:true } : { error:'Client not found.' });
  }
  if (path.startsWith('clients/') && method === 'DELETE') {
    requireManager(user);
    const id = path.split('/')[1], rows = await db()`DELETE FROM portal_clients WHERE id=${id} RETURNING id`;
    return json(res, rows.length ? 200 : 404, rows.length ? { ok:true } : { error:'Client not found.' });
  }
  if (path === 'users' && method === 'GET') { requireManager(user); return json(res, 200, { users: await db()`SELECT id,username,role,active,created_at FROM portal_users ORDER BY created_at` }); }
  if (path === 'users' && method === 'POST') {
    requireManager(user);
    const body=getBody(req), username=clean(body.username,80).toLowerCase(), role=clean(body.role,20), password=String(body.password||'');
    if (!/^[a-z0-9._-]{3,80}$/.test(username) || !['manager','admin'].includes(role) || password.length<12) return json(res,400,{error:'Use a valid username, role and password of at least 12 characters.'});
    const rows=await db()`INSERT INTO portal_users(username,password_hash,role) VALUES (${username},${await hashPassword(password)},${role}) RETURNING id,username,role,active,created_at`;
    return json(res,201,{user:rows[0]});
  }
  if (path.startsWith('users/') && method === 'PATCH') {
    requireManager(user);
    const id=path.split('/')[1], body=getBody(req), username=body.username===undefined?null:clean(body.username,80).toLowerCase(), password=body.password===undefined?null:String(body.password), role=body.role===undefined?null:clean(body.role,20), active=body.active===undefined?null:Boolean(body.active);
    if (password!==null && password.length<12) return json(res,400,{error:'Password must be at least 12 characters.'});
    if (role!==null && !['manager','admin'].includes(role)) return json(res,400,{error:'Invalid role.'});
    if (username!==null && !/^[a-z0-9._-]{3,80}$/.test(username)) return json(res,400,{error:'Invalid username.'});
    const existing=await db()`SELECT role,active FROM portal_users WHERE id=${id} LIMIT 1`;
    if (!existing[0]) return json(res,404,{error:'User not found.'});
    const losesManager=existing[0].role==='manager' && ((role&&role!=='manager') || active===false);
    if (losesManager) { const count=await db()`SELECT count(*)::int AS count FROM portal_users WHERE role='manager' AND active=true`; if(count[0].count<=1) return json(res,400,{error:'Keep at least one active manager account.'}); }
    const nextHash=password===null?null:await hashPassword(password);
    const rows=await db()`UPDATE portal_users SET username=coalesce(${username},username),role=coalesce(${role},role),active=coalesce(${active},active),password_hash=coalesce(${nextHash},password_hash),updated_at=now() WHERE id=${id} RETURNING id,username,role,active,created_at`;
    return json(res,200,{user:rows[0]});
  }
  if (path.startsWith('users/') && method === 'DELETE') {
    requireManager(user);
    const id=path.split('/')[1];
    if(id===user.sub) return json(res,400,{error:'You cannot delete the account currently in use.'});
    const rows=await db()`SELECT role,active FROM portal_users WHERE id=${id} LIMIT 1`;
    if(!rows[0]) return json(res,404,{error:'User not found.'});
    if(rows[0].role==='manager'&&rows[0].active){const count=await db()`SELECT count(*)::int AS count FROM portal_users WHERE role='manager' AND active=true`;if(count[0].count<=1)return json(res,400,{error:'Keep at least one active manager account.'});}
    await db()`DELETE FROM portal_users WHERE id=${id}`;
    return json(res,200,{ok:true});
  }
  if (path === 'settings' && method === 'GET') { requireManager(user); return json(res,200,{settings:await settingRows()}); }
  if (path === 'settings' && method === 'PUT') {
    requireManager(user);
    const body=getBody(req), enquiry=clean(body.enquiry_email,180), careers=clean(body.careers_email,180);
    if(!emailValid(enquiry)||!emailValid(careers)) return json(res,400,{error:'Enter valid notification email addresses.'});
    await db()`UPDATE portal_settings SET value=${enquiry},updated_at=now() WHERE key='enquiry_email'`;
    await db()`UPDATE portal_settings SET value=${careers},updated_at=now() WHERE key='careers_email'`;
    return json(res,200,{settings:await settingRows()});
  }
  return json(res,404,{error:'Portal endpoint not found.'});
}

export default async function handler(req, res) {
  try { return await main(req,res); }
  catch (error) {
    console.error('Portal API error', error?.message || error);
    if(pathOf(req)==='public/profile' && req.method==='GET'){
      res.statusCode=302;res.setHeader('Location','/assets/FIRECO.pdf');res.setHeader('Cache-Control','no-store');return res.end();
    }
    const status=error?.status || (String(error?.message||'').includes('not configured') ? 503 : 500);
    return json(res,status,{error:status===503?error.message:'The request could not be completed. Please try again.'});
  }
}
