'use strict';


const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_COOKIE = 'construcalc_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]\n', 'utf8');

function readUsers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('No se pudo leer data/users.json:', error.message);
    return [];
  }
}

function writeUsers(users) {
  const tempFile = USERS_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(users, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempFile, USERS_FILE);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const data = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(data);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function getCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const piece of header.split(';')) {
    const index = piece.indexOf('=');
    if (index > -1) cookies[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  return cookies;
}

function getSession(req) {
  const token = getCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_DURATION_MS;
  return { token, ...session };
}

function cookieHeader(token, req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const secure = forwardedProto.includes('https') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${secure}`;
}

function clearSessionCookie(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const secure = forwardedProto.includes('https') ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 32 * 1024) {
        reject(new Error('El formulario es demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('El contenido enviado no es JSON válido.')); }
    });
    req.on('error', reject);
  });
}

function normalizeUsername(value) {
  return String(value || '').trim().toLocaleLowerCase('es');
}

function validUsername(value) {
  return typeof value === 'string' && value.trim().length >= 3 && value.trim().length <= 50;
}

async function hashPassword(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return { salt: saltHex, passwordHash: derived.toString('hex') };
}

async function passwordMatches(password, user) {
  try {
    const derived = await scrypt(password, Buffer.from(user.salt, 'hex'), 64);
    const known = Buffer.from(user.passwordHash, 'hex');
    return known.length === derived.length && crypto.timingSafeEqual(known, derived);
  } catch {
    return false;
  }
}

function cleanNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Escribe un valor válido y mayor que cero para: ${label}.`);
  return number;
}

function fmt(value, digits = 2) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

function resultItem(label, value) { return { label, value }; }

function calculate(type, values) {
  const items = [];
  let note = 'Estimación orientativa. Verifica las dimensiones, el tipo de material, las dosificaciones y las especificaciones técnicas antes de comprar o construir.';
  if (!values || typeof values !== 'object') throw new Error('No se recibieron las medidas.');

  if (type === 'muro') {
    const length = cleanNumber(values.largo, 'Largo');
    const height = cleanNumber(values.alto, 'Alto');
    const thickness = Number(values.espesor);
    if (![20, 30].includes(thickness)) throw new Error('Selecciona un espesor de muro válido.');
    const area = length * height;
    // Coeficientes de demostración; deben ajustarse al ladrillo y al mortero reales.
    const bricksPerM2 = thickness === 20 ? 30 : 45;
    const cementKgPerM2 = thickness === 20 ? 3.8 : 5.7;
    items.push(resultItem('Área del muro', `${fmt(area)} m²`));
    items.push(resultItem('Espesor elegido', `${thickness} cm`));
    items.push(resultItem('Ladrillos estimados', `${Math.ceil(area * bricksPerM2)} unidades`));
    items.push(resultItem('Cemento estimado', `${fmt(area * cementKgPerM2)} kg`));
    note = 'Estimación de demostración: supone 30 ladrillos/m² y 3,8 kg de cemento/m² para 20 cm; 45 ladrillos/m² y 5,7 kg/m² para 30 cm. Debes ajustar estos coeficientes al formato del ladrillo, las juntas, el mortero y las pérdidas reales.';
  } else if (type === 'viga') {
    const length = cleanNumber(values.largo, 'Largo de la viga');
    const volume = length * 0.20 * 0.30; // sección asumida 20 x 30 cm
    items.push(resultItem('Longitud', `${fmt(length)} m`));
    items.push(resultItem('Sección asumida', '20 × 30 cm'));
    items.push(resultItem('Volumen de concreto', `${fmt(volume, 3)} m³`));
    items.push(resultItem('Cemento estimado', `${fmt(volume * 350)} kg`));
    items.push(resultItem('Arena estimada', `${fmt(volume * 0.56, 3)} m³`));
    items.push(resultItem('Piedra/grava estimada', `${fmt(volume * 0.84, 3)} m³`));
    items.push(resultItem('Hierro Ø8 (referencia)', `${fmt(length * 5)} m`));
    items.push(resultItem('Hierro Ø4 (referencia)', `${fmt(length * 3.75)} m`));
    note = 'Se supone una sección de 20 × 30 cm y dosificaciones de referencia. El acero y las dimensiones de una viga deben definirse mediante el diseño estructural; no uses esta estimación para construir sin revisión profesional.';
  } else if (type === 'columna') {
    const height = cleanNumber(values.largo, 'Altura de la columna');
    const volume = height * 0.25 * 0.25; // sección asumida 25 x 25 cm
    const ties = Math.ceil(height / 0.15);
    items.push(resultItem('Altura', `${fmt(height)} m`));
    items.push(resultItem('Sección asumida', '25 × 25 cm'));
    items.push(resultItem('Volumen de concreto', `${fmt(volume, 3)} m³`));
    items.push(resultItem('Cemento estimado', `${fmt(volume * 350)} kg`));
    items.push(resultItem('Arena estimada', `${fmt(volume * 0.56, 3)} m³`));
    items.push(resultItem('Piedra/grava estimada', `${fmt(volume * 0.84, 3)} m³`));
    items.push(resultItem('Hierro Ø10 (referencia)', `${fmt(height * 4)} m`));
    items.push(resultItem('Estribos Ø4 (aprox.)', `${ties} unidades`));
    note = 'Se supone una sección de 25 × 25 cm, cuatro barras longitudinales y estribos cada 15 cm solo como ejemplo. El armado debe provenir del diseño estructural y de la normativa aplicable.';
  } else if (type === 'contrapiso') {
    const thicknessCm = cleanNumber(values.espesor, 'Espesor');
    const width = cleanNumber(values.ancho, 'Ancho');
    const length = cleanNumber(values.largo, 'Largo');
    const area = width * length;
    const volume = area * (thicknessCm / 100);
    items.push(resultItem('Superficie', `${fmt(area)} m²`));
    items.push(resultItem('Volumen', `${fmt(volume, 3)} m³`));
    items.push(resultItem('Cemento estimado', `${fmt(volume * 105)} kg`));
    items.push(resultItem('Arena estimada', `${fmt(volume * 0.45, 3)} m³`));
    items.push(resultItem('Piedra/grava estimada', `${fmt(volume * 0.9, 3)} m³`));
    note = 'Cálculo aproximado usando 105 kg de cemento, 0,45 m³ de arena y 0,90 m³ de piedra por cada m³ de mezcla. La dosificación real depende del uso y de la resistencia solicitada.';
  } else if (type === 'techo') {
    const thicknessCm = cleanNumber(values.espesor, 'Espesor');
    const width = cleanNumber(values.ancho, 'Ancho');
    const length = cleanNumber(values.largo, 'Largo');
    const area = width * length;
    const volume = area * (thicknessCm / 100);
    items.push(resultItem('Superficie', `${fmt(area)} m²`));
    items.push(resultItem('Volumen de concreto', `${fmt(volume, 3)} m³`));
    items.push(resultItem('Cemento estimado', `${fmt(volume * 330)} kg`));
    items.push(resultItem('Arena estimada', `${fmt(volume * 0.72, 3)} m³`));
    items.push(resultItem('Piedra/grava estimada', `${fmt(volume * 0.72, 3)} m³`));
    items.push(resultItem('Hierro Ø8 (referencia)', `${fmt(area * 7)} m`));
    items.push(resultItem('Hierro Ø6 (referencia)', `${fmt(area * 4)} m`));
    note = 'Estimación para aprendizaje; los coeficientes de mezcla y acero son referenciales. Una losa/techo necesita cálculo estructural específico, por lo que estas cantidades no sustituyen un diseño profesional.';
  } else if (type === 'piso') {
    const width = cleanNumber(values.ancho, 'Ancho');
    const length = cleanNumber(values.largo, 'Largo');
    const area = width * length;
    items.push(resultItem('Superficie base', `${fmt(area)} m²`));
    items.push(resultItem('Con 10 % adicional para cortes', `${fmt(area * 1.10)} m²`));
    note = 'El 10 % adicional es una reserva orientativa para cortes y desperdicio. Puede variar con el formato de la baldosa y el patrón de colocación.';
  } else if (type === 'pintura') {
    const area = cleanNumber(values.superficie, 'Superficie');
    const liters = area / 6; // rendimiento supuesto para una capa
    items.push(resultItem('Superficie', `${fmt(area)} m²`));
    items.push(resultItem('Pintura estimada para una capa', `${fmt(liters)} litros`));
    items.push(resultItem('Para dos capas (referencia)', `${fmt(liters * 2)} litros`));
    note = 'Se supone un rendimiento de 6 m² por litro y por capa. Revisa la cobertura indicada en el envase; la porosidad, el color y el estado de la superficie cambian el consumo.';
  } else {
    throw new Error('No se reconoce el tipo de cálculo.');
  }
  return { title: 'Resultado del cálculo', items, note };
}

const protectedPages = new Set([
  '/04-menu.html', '/05-muro.html', '/06-viga.html', '/07-columna.html',
  '/08-contrapiso.html', '/09-techo.html', '/10-piso.html', '/11-pintura.html'
]);

async function handleApi(req, res, url, session) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, application: 'CONSTRUCALC' });
  }
  if (req.method === 'GET' && url.pathname === '/api/me') {
    if (!session) return sendJson(res, 200, { loggedIn: false });
    const user = readUsers().find(item => item.usernameKey === session.usernameKey);
    return sendJson(res, 200, { loggedIn: Boolean(user), username: user ? user.username : '' });
  }
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const usernameKey = normalizeUsername(username);
    const password = String(body.password || '');
    if (!validUsername(username)) return sendJson(res, 400, { message: 'El usuario debe tener entre 3 y 50 caracteres.' });
    if (password.length < 8 || password.length > 200) return sendJson(res, 400, { message: 'La contraseña debe tener al menos 8 caracteres.' });
    const users = readUsers();
    if (users.some(user => user.usernameKey === usernameKey)) return sendJson(res, 409, { message: 'Ese usuario ya existe. Prueba iniciar sesión.' });
    const passwordData = await hashPassword(password);
    users.push({ username, usernameKey, ...passwordData, createdAt: new Date().toISOString() });
    writeUsers(users);
    return sendJson(res, 201, { message: 'Cuenta creada correctamente. Ahora puedes iniciar sesión.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readBody(req);
    const usernameKey = normalizeUsername(body.username);
    const password = String(body.password || '');
    const users = readUsers();
    const user = users.find(item => item.usernameKey === usernameKey);
    if (!user || !(await passwordMatches(password, user))) {
      return sendJson(res, 401, { message: 'Usuario o contraseña incorrectos.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { usernameKey: user.usernameKey, expiresAt: Date.now() + SESSION_DURATION_MS });
    return sendJson(res, 200, { message: 'Inicio de sesión correcto.' }, { 'Set-Cookie': cookieHeader(token, req) });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    if (session) sessions.delete(session.token);
    return sendJson(res, 200, { message: 'Sesión cerrada.' }, { 'Set-Cookie': clearSessionCookie(req) });
  }
  if (req.method === 'POST' && url.pathname === '/api/recover') {
    const body = await readBody(req);
    const usernameKey = normalizeUsername(body.username);
    const recoveryCode = String(body.recoveryCode || '');
    const newPassword = String(body.newPassword || '');
    if (!validUsername(String(body.username || ''))) return sendJson(res, 400, { message: 'Escribe el usuario de la cuenta.' });
    if (newPassword.length < 8 || newPassword.length > 200) return sendJson(res, 400, { message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    if (!recoveryCode || recoveryCode !== process.env.CONSTRUCALC_RESET_CODE && recoveryCode !== runtimeRecoveryCode) {
      return sendJson(res, 403, { message: 'Código de recuperación incorrecto. Solicita el código al administrador del proyecto.' });
    }
    const users = readUsers();
    const user = users.find(item => item.usernameKey === usernameKey);
    if (!user) return sendJson(res, 400, { message: 'No se pudo recuperar esa cuenta. Comprueba el usuario.' });
    const passwordData = await hashPassword(newPassword);
    user.salt = passwordData.salt;
    user.passwordHash = passwordData.passwordHash;
    writeUsers(users);
    for (const [token, value] of sessions.entries()) {
      if (value.usernameKey === usernameKey) sessions.delete(token);
    }
    return sendJson(res, 200, { message: 'Contraseña cambiada correctamente. Vuelve al inicio de sesión.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/calcular') {
    if (!session) return sendJson(res, 401, { message: 'Tu sesión terminó. Inicia sesión nuevamente.' });
    const body = await readBody(req);
    try {
      const payload = calculate(String(body.type || ''), body.values || {});
      return sendJson(res, 200, payload);
    } catch (error) {
      return sendJson(res, 400, { message: error.message || 'No se pudo realizar el cálculo.' });
    }
  }
  return sendJson(res, 404, { message: 'Ruta de API no encontrada.' });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const session = getSession(req);
  if (url.pathname.startsWith('/api/')) {
    try { return await handleApi(req, res, url, session); }
    catch (error) {
      if (!res.headersSent) return sendJson(res, 400, { message: error.message || 'No se pudo procesar la solicitud.' });
      return;
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Método no permitido.');

  let requested = url.pathname === '/' ? '/01-login.html' : decodeURIComponent(url.pathname);
  if (protectedPages.has(requested) && !session) {
    res.writeHead(302, { Location: '/01-login.html', 'Cache-Control': 'no-store' });
    return res.end();
  }
  const filePath = path.resolve(PUBLIC_DIR, '.' + requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) return sendText(res, 403, 'Acceso denegado.');
  let stat;
  try { stat = fs.statSync(filePath); } catch { return sendText(res, 404, 'No se encontró la página solicitada.'); }
  if (!stat.isFile()) return sendText(res, 404, 'No se encontró la página solicitada.');
  const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

// Código de recuperación de demostración. Solo se muestra en esta consola local.
const runtimeRecoveryCode = process.env.CONSTRUCALC_RESET_CODE || crypto.randomBytes(6).toString('hex').toUpperCase();
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { message: 'Ocurrió un error interno.' });
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log('---------------------------------------------');
  console.log('CONSTRUCALC listo.');
  console.log(`Node.js directo: http://${HOST}:${PORT}/01-login.html`);
  console.log(`Código de recuperación de demo: ${runtimeRecoveryCode}`);
  console.log('Mantén esta ventana abierta mientras uses la aplicación.');
  console.log('---------------------------------------------');
});

function cleanExit() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
