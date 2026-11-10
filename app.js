/* =====================================================================
   Mi Prime — app.js  (JavaScript puro, sin compilar)
   Estructura de datos en Firestore:
     users/{uid}/plans/{planId}                       → un "mes": hábitos y metas
     users/{uid}/months/{YYYY-MM}/days/{YYYY-MM-DD}   → un día: { checks, note }
   ===================================================================== */
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ---------------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS2 = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];
const DIAS1 = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ORDEN = [1, 2, 3, 4, 5, 6, 0]; // semana empieza en lunes

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const today = () => ymd(new Date());
const monthKey = (s) => s.slice(0, 7);
const dow = (s) => parse(s).getDay();
const fmtShort = (s) => { const d = parse(s); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
const fmtLong = (s) => { const d = parse(s); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function* eachDate(a, b) { for (let d = a; d <= b; d = addDays(d, 1)) yield d; }
const weekendKey = (d) => (dow(d) === 0 ? addDays(d, -1) : d); // domingo se agrupa con su sábado

/** Crea elementos DOM sin innerHTML (así el texto del usuario nunca se interpreta como HTML). */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  let deferredValue;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v; // solo para SVG/HTML estático propio
    else if (k === 'value') deferredValue = v;
    else if (k === 'for') e.htmlFor = v;
    else if (k in e && typeof v !== 'object') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  if (deferredValue !== undefined) e.value = deferredValue;
  return e;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f97316', '#22c55e', '#facc15', '#38bdf8', '#f472b6'];
  const cx = innerWidth / 2, cy = innerHeight * 0.35;
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 140;
    const p = h('span', { class: 'confetti' });
    p.style.cssText = `left:${cx}px;top:${cy}px;background:${colors[i % colors.length]};` +
      `--dx:${Math.cos(a) * r}px;--dy:${Math.sin(a) * r + 60}px;--rot:${Math.random() * 540}deg`;
    document.body.append(p);
    setTimeout(() => p.remove(), 1200);
  }
}

/* ---------------------------------------------------------------------
   Horario (fijo, solo lectura)  →  [hora, actividad, emoji, tipo]
   --------------------------------------------------------------------- */
const BASE_SEMANA = [
  ['5:50', 'Desayuno', '🍳'],
  ['6:40', 'Expreso', '🚌'],
  ['7:30 – 15:30', 'Pasantía', '💼'],
  ['Almuerzo', 'Publicar en AutoNet', '📣']
];
const HORARIO = {
  1: [['17:30', 'Comer y descansar', '😌'], ['18:00', 'Estudio', '📚'], ['19:15', 'Gym', '🏋️'], ['21:00', 'Cena y preparar el día siguiente', '🍽️'], ['22:30', 'Dormir', '😴']],
  2: [['16:15 – 21:00', 'Clase', '🎓'], ['22:30', 'Llego a casa y a dormir', '😴']],
  3: [['17:30', 'Comer y descansar', '😌'], ['18:00', 'Estudio', '📚'], ['19:15', 'Gym', '🏋️'], ['21:00', 'Cena y preparar el día siguiente', '🍽️'], ['22:30', 'Dormir', '😴']],
  4: [['16:15 – 17:15', 'Clase', '🎓'], ['19:15', 'Gym', '🏋️'], ['21:00', 'Cena', '🍽️'], ['22:30', 'Dormir', '😴']],
  5: [['Hasta 15:00', 'Clase', '🎓'], ['16:30 – 17:00', 'Llego a casa', '🏠'], ['19:15', 'Gym', '🏋️'], ['Noche', 'Libre', '🎉', 'free']],
  6: [['8:00 – 14:00', 'Mecánica y grabar clips', '🔧'], ['15:00 – 16:00', 'Editar TikToks', '🎬'], ['Noche', 'Libre', '🎉', 'free']],
  0: [['8:00 – 14:00', 'Mecánica o estudiar mecánica', '🔧'], ['15:00', 'Programar posts de AutoNet', '🗓️'], ['16:00', 'Revisión semanal', '✅'], ['Noche', 'Libre', '🎉', 'free']]
};
const scheduleFor = (d) => (d >= 1 && d <= 5 ? [...BASE_SEMANA, ...HORARIO[d]] : HORARIO[d]);

/* ---------------------------------------------------------------------
   Plan por defecto: "Mes 1" (10 nov → 9 dic)
   --------------------------------------------------------------------- */
function defaultPlan() {
  const now = new Date();
  let y = now.getFullYear();
  if (now > new Date(y, 11, 9, 23, 59)) y += 1; // si ya pasó el 9 dic, usa el año siguiente
  const s = `${y}-11-10`;
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const habits = [
    { id: 'desayuno', label: 'Desayuné', icon: '🍳', days: ALL, type: 'check' },
    { id: 'autonet', label: 'Publiqué en AutoNet', icon: '📣', days: ALL, type: 'check' },
    { id: 'gym', label: 'Gym', icon: '🏋️', days: [1, 3, 4, 5], type: 'check' },          // martes: clase 16:15–21:00
    { id: 'estudio', label: 'Bloque de estudio (2 pomodoros)', icon: '📚', days: [0, 1, 3, 4, 5, 6], type: 'check' },
    { id: 'sueno', label: 'Dormí a las 22:30', icon: '😴', days: ALL, type: 'check' },
    { id: 'mecanica', label: 'Mecánica', icon: '🔧', days: [6, 0], type: 'check' },
    { id: 'clips', label: 'Grabé clips', icon: '🎥', days: [6, 0], type: 'check' },
    { id: 'tiktok', label: 'Edité/subí TikTok', icon: '🎬', days: [6, 0], type: 'count' },
    { id: 'posts', label: 'Programé posts de AutoNet', icon: '🗓️', days: [6, 0], type: 'check' },
    { id: 'revision', label: 'Revisión semanal', icon: '✅', days: [0], type: 'check' }
  ];
  const g = (id, label, habit, mode, target) => ({ id, label, kind: 'habit', habit, mode, target });
  const m = (id, label) => ({ id, label, kind: 'manual', target: 1 });
  return {
    id: s, name: 'Mes 1', start: s, end: addDays(s, 29), habits, manual: {},
    monthGoals: [
      g('m_gym', '12 días de gym', 'gym', 'days', 12),
      g('m_autonet', '30 posts en AutoNet', 'autonet', 'days', 30),
      g('m_tiktok', '8 TikToks', 'tiktok', 'sum', 8),
      g('m_mecanica', '4 fines de semana de mecánica', 'mecanica', 'weekends', 4),
      m('proyecto_entregado', 'Proyecto entregado')
    ],
    weeks: [
      { id: 'w1', name: 'Semana 1', start: s, end: addDays(s, 6), goals: [
        g('w1_gym', 'Gym 2 días', 'gym', 'days', 2),
        g('w1_autonet', 'AutoNet 7/7', 'autonet', 'days', 7),
        g('w1_desayuno', 'Desayunar 4 días', 'desayuno', 'days', 4),
        m('w1_tiktok_cuenta', 'Crear cuenta de TikTok'),
        m('w1_proyecto', 'Avanzar el proyecto de Ingeniería de Software II')
      ] },
      { id: 'w2', name: 'Semana 2', start: addDays(s, 7), end: addDays(s, 13), goals: [
        m('proyecto_entregado', 'Entregar el proyecto (19 nov)'),
        g('w2_gym', 'Gym 3 días', 'gym', 'days', 3),
        g('w2_autonet', 'AutoNet 7/7', 'autonet', 'days', 7),
        g('w2_clips', 'Grabar los primeros clips', 'clips', 'days', 1),
        g('w2_tiktok', '1 TikTok', 'tiktok', 'sum', 1)
      ] },
      { id: 'w3', name: 'Semana 3', start: addDays(s, 14), end: addDays(s, 20), goals: [
        g('w3_gym', 'Gym 3 días', 'gym', 'days', 3),
        g('w3_autonet', 'AutoNet 7/7', 'autonet', 'days', 7),
        g('w3_tiktok', '3 TikToks', 'tiktok', 'sum', 3),
        m('w3_frenos', 'Estudiar frenos'),
        g('w3_sueno', 'Dormir a las 22:30 al menos 4 días', 'sueno', 'days', 4)
      ] },
      { id: 'w4', name: 'Semana 4', start: addDays(s, 21), end: addDays(s, 29), goals: [
        g('w4_gym', 'Gym 4 días', 'gym', 'days', 4),
        g('w4_autonet', 'AutoNet 9/9', 'autonet', 'days', 9),
        g('w4_tiktok', '4 TikToks', 'tiktok', 'sum', 4),
        m('w4_suspension', 'Estudiar suspensión'),
        m('w4_revisar', 'Revisar el mes')
      ] }
    ]
  };
}

function normalizePlan(p) {
  return {
    id: p.id, name: p.name || 'Mes', start: p.start, end: p.end || p.start,
    habits: Array.isArray(p.habits) ? p.habits : [],
    monthGoals: Array.isArray(p.monthGoals) ? p.monthGoals : [],
    weeks: Array.isArray(p.weeks) ? p.weeks : [],
    manual: p.manual && typeof p.manual === 'object' ? p.manual : {},
    virtual: !!p.virtual
  };
}

/* ---------------------------------------------------------------------
   Estado
   --------------------------------------------------------------------- */
const S = {
  user: null,
  plans: [], planId: null,
  monthDays: {},   // 'YYYY-MM' → { 'YYYY-MM-DD': datos }
  loaded: {},      // meses cuyo primer snapshot ya llegó
  monthSubs: {}, unsubPlans: null,
  tab: 'hoy', date: today(), weekIdx: null, schedDay: null, schedAll: false,
  pop: null, noteDate: null, editor: null
};
try { const t = localStorage.getItem('mp_tab'); if (t) S.tab = t; } catch { /* sin storage */ }

/* ---------------------------------------------------------------------
   Firebase
   --------------------------------------------------------------------- */
const configured = firebaseConfig && firebaseConfig.apiKey && !/^PEGA/i.test(firebaseConfig.apiKey);
let auth, db;

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (e) {
    console.warn('Sin caché offline persistente:', e);
    db = initializeFirestore(app, {});
  }
}

const planCol = () => collection(db, 'users', S.user.uid, 'plans');
const planRef = (id) => doc(db, 'users', S.user.uid, 'plans', id);
const daysCol = (mk) => collection(db, 'users', S.user.uid, 'months', mk, 'days');
const dayRef = (date) => doc(db, 'users', S.user.uid, 'months', monthKey(date), 'days', date);

function subscribePlans() {
  S.unsubPlans = onSnapshot(planCol(), (snap) => {
    let list = snap.docs.map((d) => normalizePlan({ ...d.data(), id: d.id }));
    if (!list.length) {
      const def = defaultPlan();
      list = [normalizePlan({ ...def, virtual: true })];
      if (!snap.metadata.fromCache) {
        // Cuenta nueva (confirmado por el servidor): guardamos el plan inicial.
        setDoc(planRef(def.id), def).catch((e) => console.error(e));
      }
    }
    S.plans = list.sort((a, b) => a.start.localeCompare(b.start));
    if (!S.planId || !S.plans.some((p) => p.id === S.planId)) S.planId = (planForDate(today()) || S.plans[0]).id;
    syncMonthSubs();
    scheduleRender();
  }, (e) => { console.error(e); toast('No se pudieron cargar tus metas'); });
}

function syncMonthSubs() {
  if (!S.user) return;
  const need = new Set();
  const t = today();
  need.add(monthKey(t)); need.add(monthKey(addDays(t, -31))); need.add(monthKey(S.date));
  const p = currentPlan();
  if (p) {
    let [y, m] = p.start.slice(0, 7).split('-').map(Number);
    const endK = monthKey(p.end);
    for (let i = 0; i < 24; i++) {
      const k = `${y}-${pad(m)}`;
      need.add(k);
      if (k >= endK) break;
      if (++m > 12) { m = 1; y++; }
    }
  }
  for (const k of Object.keys(S.monthSubs)) {
    if (!need.has(k)) { S.monthSubs[k](); delete S.monthSubs[k]; }
  }
  for (const k of need) {
    if (S.monthSubs[k]) continue;
    S.monthSubs[k] = onSnapshot(daysCol(k), (snap) => {
      const m = {};
      snap.docs.forEach((d) => { m[d.id] = d.data(); });
      S.monthDays[k] = m;
      S.loaded[k] = true;
      scheduleRender();
    }, (e) => console.error(e));
  }
}

function teardown() {
  if (S.unsubPlans) S.unsubPlans();
  S.unsubPlans = null;
  Object.values(S.monthSubs).forEach((u) => u());
  S.monthSubs = {}; S.monthDays = {}; S.loaded = {}; S.plans = []; S.planId = null;
}

/* ---------------------------------------------------------------------
   Lectura de datos y cálculos
   --------------------------------------------------------------------- */
const getDay = (date) => (S.monthDays[monthKey(date)] || {})[date];
const isLoaded = (date) => !!S.loaded[monthKey(date)];
const currentPlan = () => S.plans.find((p) => p.id === S.planId) || S.plans[0];

function planForDate(date) {
  if (!S.plans.length) return null;
  const inside = S.plans.find((p) => date >= p.start && date <= p.end);
  if (inside) return inside;
  const before = S.plans.filter((p) => p.start <= date);
  return before.length ? before[before.length - 1] : S.plans[0];
}

function habitsFor(date) {
  const p = planForDate(date);
  if (!p) return [];
  const w = dow(date);
  return p.habits.filter((x) => (x.days || []).includes(w));
}

function doneValue(day, habit) {
  const v = day && day.checks ? day.checks[habit.id] : 0;
  return habit.type === 'count' ? Math.max(0, Number(v) || 0) : (v ? 1 : 0);
}
const isDone = (day, habit) => doneValue(day, habit) > 0;

/** 'complete' | 'partial' | 'none' | 'future' */
function statusOf(date) {
  const habits = habitsFor(date);
  const day = getDay(date);
  const done = day ? habits.filter((x) => isDone(day, x)).length : 0;
  if (habits.length && done === habits.length) return 'complete';
  if (done > 0) return 'partial';
  return date > today() ? 'future' : 'none';
}

function computeStreaks() {
  const t = today();
  const walk = (ok, from) => {
    let n = 0, d = from;
    for (let i = 0; i < 400; i++) { if (!ok(statusOf(d))) break; n++; d = addDays(d, -1); }
    return n;
  };
  const anyDone = (s) => s === 'complete' || s === 'partial';
  const cur = walk(anyDone, statusOf(t) === 'none' ? addDays(t, -1) : t);
  const perfect = walk((s) => s === 'complete', statusOf(t) !== 'complete' ? addDays(t, -1) : t);
  let best = 0, run = 0;
  const months = Object.keys(S.monthDays).sort();
  if (months.length) {
    for (const d of eachDate(`${months[0]}-01`, t)) {
      if (anyDone(statusOf(d))) { run++; best = Math.max(best, run); } else run = 0;
    }
  }
  return { cur, perfect, best: Math.max(best, cur) };
}

/** Valor actual de una meta en el rango [start, end]. */
function goalValue(g, start, end, plan) {
  if (g.kind === 'manual') return plan.manual[g.id] ? 1 : 0;
  const hab = plan.habits.find((x) => x.id === g.habit);
  if (!hab) return 0;
  if (g.mode === 'weekends') {
    const set = new Set();
    for (const d of eachDate(start, end)) {
      const w = dow(d);
      if ((w === 0 || w === 6) && isDone(getDay(d), hab)) set.add(weekendKey(d));
    }
    return set.size;
  }
  let v = 0;
  for (const d of eachDate(start, end)) {
    const n = doneValue(getDay(d), hab);
    v += g.mode === 'sum' ? n : (n > 0 ? 1 : 0);
  }
  return v;
}
const goalTarget = (g) => (g.kind === 'manual' ? 1 : Math.max(1, Number(g.target) || 1));
function goalsFraction(goals, start, end, plan) {
  if (!goals.length) return 0;
  return goals.reduce((a, g) => a + clamp01(goalValue(g, start, end, plan) / goalTarget(g)), 0) / goals.length;
}

/* ---------------------------------------------------------------------
   Escrituras
   --------------------------------------------------------------------- */
function patchLocalDay(date, fn) {
  const mk = monthKey(date);
  const m = (S.monthDays[mk] = S.monthDays[mk] || {});
  const d = (m[date] = m[date] || {});
  fn(d);
}

function setCheck(date, habit, value) {
  const before = statusOf(date);
  patchLocalDay(date, (d) => { d.checks = d.checks || {}; d.checks[habit.id] = value; });
  S.pop = habit.id;
  render();
  if (before !== 'complete' && statusOf(date) === 'complete') { toast('¡Día completo! 🎉'); confetti(); }
  setDoc(dayRef(date), { checks: { [habit.id]: value }, updatedAt: serverTimestamp() }, { merge: true })
    .catch((e) => { console.error(e); toast('No se pudo guardar. Reintentaré al volver la conexión.'); });
}

async function toggleManual(plan, goalId) {
  if (plan.virtual) { toast('Aún cargando tu plan… intenta de nuevo'); return; }
  const value = !plan.manual[goalId];
  plan.manual[goalId] = value;
  render();
  setDoc(planRef(plan.id), { manual: { [goalId]: value } }, { merge: true })
    .catch((e) => { console.error(e); toast('No se pudo guardar'); });
}

// Nota del día (con retraso para no escribir en cada tecla)
let noteTimer = null, notePending = null;
async function flushNote() {
  clearTimeout(noteTimer);
  if (!notePending) return;
  const { date, text } = notePending;
  notePending = null;
  patchLocalDay(date, (d) => { d.note = text; });
  try {
    await setDoc(dayRef(date), { note: text, updatedAt: serverTimestamp() }, { merge: true });
    $('#noteState').textContent = 'Guardado ✓';
  } catch (e) { console.error(e); $('#noteState').textContent = 'No se pudo guardar'; }
}

/* ---------------------------------------------------------------------
   Render general
   --------------------------------------------------------------------- */
let raf = 0;
function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

function render() {
  if (!S.user || !S.plans.length) return;
  renderChrome();
  for (const v of ['hoy', 'semana', 'mes', 'horario']) $(`#view-${v}`).classList.toggle('hidden', v !== S.tab);
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  ({ hoy: renderToday, semana: renderWeek, mes: renderMonth, horario: renderSchedule })[S.tab]();
  S.pop = null;
}

function renderChrome() {
  const on = navigator.onLine;
  const pill = $('#syncPill');
  pill.textContent = on ? 'Sincronizado' : 'Sin conexión';
  pill.className = 'pill ' + (on ? 'ok' : 'off');
}

function ring(frac, size, stroke, label) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
  return h('div', { class: 'ring' + (frac >= 1 ? ' full' : ''), style: { width: size + 'px', height: size + 'px' } },
    h('div', {
      html: `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle class="ring-bg" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>` +
        `<circle class="ring-fg" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp01(frac))}" transform="rotate(-90 ${mid} ${mid})"/></svg>`
    }),
    h('span', {}, label));
}

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/* ---------------------------------------------------------------------
   HOY
   --------------------------------------------------------------------- */
function renderToday() {
  const date = S.date, t = today();
  const habits = habitsFor(date);
  const day = getDay(date) || {};
  const done = habits.filter((x) => isDone(day, x)).length;
  const frac = habits.length ? done / habits.length : 0;
  const st = computeStreaks();
  const first = (S.user.displayName || '').split(' ')[0];

  let msg;
  if (!habits.length) msg = 'Hoy no hay nada programado.';
  else if (done === habits.length) msg = '¡Día completo! 🎉';
  else if (done === 0) msg = 'Empieza con algo pequeño: 10 minutos cuentan.';
  else msg = `Te ${habits.length - done === 1 ? 'falta' : 'faltan'} ${habits.length - done}. ¡Vas bien!`;

  const nav = h('div', { class: 'date-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Día anterior', onclick: () => changeDate(addDays(date, -1)) }, '‹'),
    h('div', { class: 'title' },
      h('div', { class: 'muted small' }, date === t ? `Hola${first ? ', ' + first : ''} 👋` : (date < t ? 'Día pasado' : 'Día futuro')),
      h('h1', {}, fmtLong(date))),
    h('button', { class: 'icon-btn', 'aria-label': 'Día siguiente', onclick: () => changeDate(addDays(date, 1)) }, '›'));

  const summary = h('div', { class: 'card hoy-card' },
    ring(frac, 78, 9, `${done}/${habits.length}`),
    h('div', { class: 'grow' },
      h('div', { class: 'big' }, msg),
      h('div', { class: 'chips' },
        h('span', { class: 'chip-s fire' }, `🔥 Racha ${st.cur}`),
        h('span', { class: 'chip-s' }, `⭐ Perfecta ${st.perfect}`),
        date !== t && h('button', { class: 'chip-s', style: { border: 0, cursor: 'pointer' }, onclick: () => changeDate(t) }, 'Ir a hoy'))));

  $('#hoyHead').replaceChildren(h('div', { class: 'hoy-top' }, nav, summary));

  // Aviso de la regla: ayer en blanco y hoy todavía nada
  const y = addDays(t, -1);
  const firstStart = S.plans[0].start;
  const showAlert = date === t && done === 0 && y >= firstStart && isLoaded(y) && statusOf(y) === 'none';
  $('#hoyAlert').replaceChildren(showAlert
    ? h('div', { class: 'alert' }, h('span', {}, '⚠️'), h('span', {}, 'Ayer no marcaste nada. Hoy no se falla: nunca dos días seguidos. Aunque sea 10 minutos.'))
    : '');

  $('#hoyList').replaceChildren(...habits.map((hb) => habitRow(hb, day, date)));

  // Nota
  const note = $('#note');
  if (S.noteDate !== date) {
    flushNote();
    note.value = day.note || '';
    S.noteDate = date;
    $('#noteState').textContent = '';
  } else if (document.activeElement !== note && !notePending) {
    note.value = day.note || '';
  }
}

function changeDate(d) {
  flushNote();
  S.date = d;
  syncMonthSubs();
  render();
}

function habitRow(hb, day, date) {
  const done = isDone(day, hb);
  const cls = 'habit' + (done ? ' done' : '') + (S.pop === hb.id ? ' pop' : '');
  const icon = h('span', { class: 'ico' }, hb.icon || '•');
  if (hb.type === 'count') {
    const n = doneValue(day, hb);
    return h('div', { class: cls },
      icon, h('span', { class: 'label' }, hb.label),
      h('div', { class: 'stepper' },
        h('button', { 'aria-label': 'Quitar uno', onclick: () => n > 0 && setCheck(date, hb, n - 1) }, '−'),
        h('span', { class: 'num' }, n),
        h('button', { 'aria-label': 'Sumar uno', onclick: () => setCheck(date, hb, Math.min(99, n + 1)) }, '+')));
  }
  return h('button', { class: cls, 'aria-pressed': done, onclick: () => setCheck(date, hb, !done) },
    icon, h('span', { class: 'label' }, hb.label),
    h('span', { class: 'check', html: CHECK_SVG }));
}

/* ---------------------------------------------------------------------
   SEMANA
   --------------------------------------------------------------------- */
function goalRow(g, plan, start, end) {
  const val = goalValue(g, start, end, plan);
  const target = goalTarget(g);
  const complete = val >= target;
  const pct = Math.round(clamp01(val / target) * 100);
  const inner = [
    h('div', { class: 'goal-top' },
      g.kind === 'manual' && h('span', { class: 'mini-check', html: CHECK_SVG }),
      h('span', { class: 'goal-label' }, g.label, g.kind === 'manual' && h('span', { class: 'tag' }, 'manual')),
      h('span', { class: 'goal-count' }, g.kind === 'manual' ? (complete ? 'Listo' : 'Pendiente') : `${Math.min(val, 999)}/${target}`)),
    h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } }))
  ];
  if (g.kind === 'manual') {
    return h('div', { class: 'goal' + (complete ? ' done' : '') },
      h('button', { class: 'goal-manual', 'aria-pressed': complete, onclick: () => toggleManual(plan, g.id) }, inner));
  }
  return h('div', { class: 'goal' + (complete ? ' done' : '') }, inner);
}

function renderWeek() {
  const plan = currentPlan();
  const view = $('#view-semana');
  const weeks = plan.weeks;
  if (!weeks.length) {
    view.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Este mes no tiene semanas. Agrégalas con “Editar mes” en la pestaña Mes.')));
    return;
  }
  const t = today();
  if (S.weekIdx == null || S.weekIdx >= weeks.length || S.weekPlan !== plan.id) {
    let i = weeks.findIndex((w) => t >= w.start && t <= w.end);
    if (i < 0) i = t < weeks[0].start ? 0 : weeks.length - 1;
    S.weekIdx = i; S.weekPlan = plan.id;
  }
  const w = weeks[S.weekIdx];
  const frac = goalsFraction(w.goals, w.start, w.end, plan);

  const seg = h('div', { class: 'seg' }, weeks.map((x, i) =>
    h('button', { class: i === S.weekIdx ? 'on' : '', onclick: () => { S.weekIdx = i; render(); } },
      h('span', {}, x.name), h('small', {}, `${fmtShort(x.start)} – ${fmtShort(x.end)}`))));

  const days = h('div', { class: 'days-row' }, [...eachDate(w.start, w.end)].map((d) =>
    h('div', { class: 'wd' + (d === t ? ' today' : '') },
      h('i', { class: 'st-' + statusOf(d), title: fmtLong(d) }), DIAS2[dow(d)])));

  const card = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, w.name), h('div', { class: 'muted small' }, `${fmtShort(w.start)} – ${fmtShort(w.end)} · ${plan.name}`)),
      ring(frac, 58, 7, Math.round(frac * 100) + '%')),
    days,
    w.goals.length
      ? h('div', { class: 'goals' }, w.goals.map((g) => goalRow(g, plan, w.start, w.end)))
      : h('p', { class: 'muted' }, 'Sin metas esta semana.'));

  view.replaceChildren(seg, card,
    h('p', { class: 'muted small', style: { textAlign: 'center' } }, 'Las barras se llenan solas con lo que marcas en “Hoy”. Las metas “manual” se tocan para marcarlas.'));
}

/* ---------------------------------------------------------------------
   MES
   --------------------------------------------------------------------- */
function renderMonth() {
  const plan = currentPlan();
  const view = $('#view-mes');
  const t = today();
  const frac = goalsFraction(plan.monthGoals, plan.start, plan.end, plan);
  const total = diffDays(plan.start, plan.end) + 1;
  let sub;
  if (t < plan.start) sub = `Empieza en ${diffDays(t, plan.start)} ${diffDays(t, plan.start) === 1 ? 'día' : 'días'}`;
  else if (t > plan.end) sub = 'Mes terminado';
  else sub = `Día ${diffDays(plan.start, t) + 1} de ${total}`;
  const st = computeStreaks();

  const head = h('div', { class: 'plan-head' },
    S.plans.length > 1
      ? h('select', { class: 'select', 'aria-label': 'Mes', value: plan.id, onchange: (e) => { S.planId = e.target.value; S.weekIdx = null; syncMonthSubs(); render(); } },
        S.plans.map((p) => h('option', { value: p.id }, `${p.name} · ${fmtShort(p.start)} – ${fmtShort(p.end)}`)))
      : h('div', {}, h('h2', {}, plan.name), h('div', { class: 'muted small' }, `${fmtShort(plan.start)} – ${fmtShort(plan.end)}`)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost sm', onclick: () => openEditor('edit') }, '✏️ Editar'),
      h('button', { class: 'btn primary sm', onclick: () => openEditor('next') }, '＋ Mes siguiente')));

  const rule = h('div', { class: 'card rule' },
    h('b', {}, 'Nunca fallar dos días seguidos.'),
    h('span', {}, 'Si es un día malo, 10 minutos cuentan.'));

  const progress = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, 'Meta del mes'), h('div', { class: 'muted small' }, sub)),
      ring(frac, 64, 8, Math.round(frac * 100) + '%')),
    plan.monthGoals.length
      ? h('div', { class: 'goals' }, plan.monthGoals.map((g) => goalRow(g, plan, plan.start, plan.end)))
      : h('p', { class: 'muted' }, 'Sin metas del mes. Agrégalas con “Editar”.'));

  const streak = h('div', { class: 'card' },
    h('h2', { style: { marginBottom: '12px' } }, 'Racha'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, `🔥 ${st.cur}`), h('span', {}, 'días seguidos')),
      h('div', { class: 'stat' }, h('b', {}, `⭐ ${st.perfect}`), h('span', {}, 'días perfectos')),
      h('div', { class: 'stat' }, h('b', {}, `🏆 ${st.best}`), h('span', {}, 'mejor racha'))),
    h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Un día cuenta para la racha si marcaste al menos un hábito. “Perfecto” = todos.'));

  view.replaceChildren(head, rule, progress, streak, calendarCard(plan));
}

function calendarCard(plan) {
  const t = today();
  const gridStart = addDays(plan.start, -((dow(plan.start) + 6) % 7));
  const gridEnd = addDays(plan.end, (7 - dow(plan.end)) % 7);
  const cells = [];
  for (const d of eachDate(gridStart, gridEnd)) {
    const inPlan = d >= plan.start && d <= plan.end;
    const dn = parse(d).getDate();
    const showMonth = inPlan && (dn === 1 || d === plan.start);
    const cls = 'cell' + (inPlan ? ' st-' + statusOf(d) : ' out') + (d === t ? ' today' : '');
    const kids = [showMonth && h('small', {}, MESES[parse(d).getMonth()].slice(0, 3)), String(dn)];
    cells.push(inPlan
      ? h('button', { class: cls, title: fmtLong(d), 'aria-label': fmtLong(d), onclick: () => { S.tab = 'hoy'; changeDate(d); window.scrollTo({ top: 0 }); } }, kids)
      : h('div', { class: cls }, kids));
  }
  return h('div', { class: 'card' },
    h('h2', { style: { marginBottom: '12px' } }, 'Calendario'),
    h('div', { class: 'cal' }, ORDEN.map((d) => h('div', { class: 'cal-h' }, DIAS1[d])), cells),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'st-complete' }), 'Completo'),
      h('span', {}, h('i', { class: 'st-partial' }), 'Parcial'),
      h('span', {}, h('i', { class: 'st-none' }), 'No hecho')),
    h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Toca un día para verlo o corregirlo.'));
}

/* ---------------------------------------------------------------------
   HORARIO
   --------------------------------------------------------------------- */
function scheduleTable(d, markNow) {
  const rows = scheduleFor(d);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const startOf = (time) => { const m = /^(\d{1,2}):(\d{2})/.exec(time); return m ? +m[1] * 60 + +m[2] : null; };
  let nowIdx = -1;
  if (markNow) rows.forEach((r, i) => { const s = startOf(r[0]); if (s != null && s <= nowMin) nowIdx = i; });
  return h('div', { class: 'tbl' }, rows.map((r, i) =>
    h('div', { class: 'tr' + (r[3] === 'free' ? ' free' : '') + (i === nowIdx ? ' now' : '') },
      h('div', { class: 't' }, r[0]),
      h('div', { class: 'a' }, h('span', { class: 'e' }, r[2]), r[1]))));
}

function renderSchedule() {
  const view = $('#view-horario');
  const t = dow(today());
  if (S.schedDay == null) S.schedDay = t;

  const chips = h('div', { class: 'seg days' }, [
    ...ORDEN.map((d) => h('button', {
      class: (!S.schedAll && d === S.schedDay ? 'on ' : '') + (d === t ? 'today' : ''),
      onclick: () => { S.schedDay = d; S.schedAll = false; render(); }
    }, h('span', {}, DIAS2[d]))),
    h('button', { class: S.schedAll ? 'on' : '', onclick: () => { S.schedAll = true; render(); } }, h('span', {}, 'Toda'))
  ]);

  if (S.schedAll) {
    view.replaceChildren(chips, ...ORDEN.map((d) =>
      h('div', { class: 'card' },
        h('div', { class: 'sched-title' }, h('h2', {}, DIAS[d]), d === t && h('span', { class: 'chip-s fire' }, 'Hoy')),
        scheduleTable(d, false))));
    return;
  }
  const d = S.schedDay;
  view.replaceChildren(chips,
    h('div', { class: 'card' },
      h('div', { class: 'sched-title' }, h('h2', {}, DIAS[d]), d === t && h('span', { class: 'chip-s fire' }, 'Hoy')),
      scheduleTable(d, d === t)));
}

/* ---------------------------------------------------------------------
   Editor de mes (editar el actual o crear el siguiente)
   --------------------------------------------------------------------- */
function nextName(name) {
  const m = /^(.*?)(\d+)\s*$/.exec(name || '');
  return m ? `${m[1]}${+m[2] + 1}` : `${name || 'Mes'} (siguiente)`;
}

function makeWeeks(p) {
  const total = diffDays(p.start, p.end) + 1;
  const n = Math.max(1, Math.floor(total / 7));
  const weeks = [];
  for (let i = 0; i < n; i++) {
    const s = addDays(p.start, 7 * i);
    const e = i === n - 1 ? p.end : addDays(s, 6);
    const len = diffDays(s, e) + 1;
    const goals = p.monthGoals
      .filter((g) => g.kind === 'habit' && (g.mode === 'days' || g.mode === 'sum'))
      .map((g) => {
        let target = Math.max(1, Math.round(goalTarget(g) * len / total));
        if (g.mode === 'days') target = Math.min(target, len);
        return { id: uid('w'), label: g.label.replace(/\d+/, String(target)), kind: 'habit', habit: g.habit, mode: g.mode, target };
      });
    weeks.push({ id: uid('wk'), name: `Semana ${i + 1}`, start: s, end: e, goals });
  }
  return weeks;
}

function buildNextPlan(prev) {
  const start = addDays(prev.end, 1);
  const p = {
    id: null, name: nextName(prev.name), start, end: addDays(start, 29),
    habits: clone(prev.habits),
    monthGoals: clone(prev.monthGoals).map((g) => ({ ...g, id: uid('m') })),
    weeks: [], manual: {}
  };
  p.weeks = makeWeeks(p);
  return p;
}

function openEditor(mode) {
  const cur = currentPlan();
  if (!cur) return;
  const draft = mode === 'edit' ? clone(cur) : buildNextPlan(cur);
  delete draft.virtual;
  S.editor = { mode, draft };
  $('#modal').classList.remove('hidden');
  document.body.classList.add('noscroll');
  renderEditor();
}

function closeEditor() {
  S.editor = null;
  $('#modal').classList.add('hidden');
  document.body.classList.remove('noscroll');
}

function renderEditor() {
  const { mode, draft } = S.editor;
  const sheet = $('#sheet');
  const scroll = $('.sheet-body', sheet);
  const top = scroll ? scroll.scrollTop : 0;

  const field = (label, input) => h('label', { class: 'field' }, label, input);
  const sec = (title, ...kids) => h('div', { class: 'ed-sec' }, h('h3', {}, title), ...kids);
  const sel = (opts, val, onchange, cls = 'select') =>
    h('select', { class: cls, value: val, onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v }, l)));

  const goalEditor = (g, list) => {
    const habitOpts = draft.habits.map((x) => [x.id, `${x.icon || ''} ${x.label}`.trim()]);
    return h('div', { class: 'ed-card' },
      h('div', { class: 'ed-line' },
        h('input', { class: 'inp grow', value: g.label, placeholder: 'Meta (ej. Gym 3 días)', oninput: (e) => { g.label = e.target.value; } }),
        h('button', { class: 'icon-btn danger', 'aria-label': 'Quitar meta', onclick: () => { list.splice(list.indexOf(g), 1); renderEditor(); } }, '🗑')),
      h('div', { class: 'ed-line' },
        sel([['habit', 'Automática'], ['manual', 'Manual']], g.kind, (v) => {
          g.kind = v;
          if (v === 'habit') { g.habit = g.habit || (draft.habits[0] && draft.habits[0].id); g.mode = g.mode || 'days'; g.target = g.target || 1; }
          renderEditor();
        }),
        g.kind === 'habit' && habitOpts.length > 0 && sel(habitOpts, g.habit, (v) => { g.habit = v; }),
        g.kind === 'habit' && sel([['days', 'días'], ['sum', 'suma'], ['weekends', 'fines de semana']], g.mode || 'days', (v) => { g.mode = v; }),
        g.kind === 'habit' && h('input', { class: 'inp num', type: 'number', min: 1, max: 999, value: g.target || 1, 'aria-label': 'Objetivo', oninput: (e) => { g.target = Math.max(1, +e.target.value || 1); } })));
  };

  const habitEditor = (hb) => h('div', { class: 'ed-card' },
    h('div', { class: 'ed-line' },
      h('input', { class: 'inp emoji', value: hb.icon || '', maxLength: 4, 'aria-label': 'Ícono', oninput: (e) => { hb.icon = e.target.value; } }),
      h('input', { class: 'inp grow', value: hb.label, placeholder: 'Nombre del hábito', oninput: (e) => { hb.label = e.target.value; } }),
      h('button', { class: 'icon-btn danger', 'aria-label': 'Quitar hábito', onclick: () => { draft.habits.splice(draft.habits.indexOf(hb), 1); renderEditor(); } }, '🗑')),
    h('div', { class: 'ed-line' },
      sel([['check', 'Marcar (sí/no)'], ['count', 'Contador (+/−)']], hb.type || 'check', (v) => { hb.type = v; }),
      h('div', { class: 'daychips' }, ORDEN.map((d) =>
        h('button', {
          type: 'button', class: 'chip' + (hb.days.includes(d) ? ' on' : ''), title: DIAS[d],
          onclick: (e) => {
            hb.days = hb.days.includes(d) ? hb.days.filter((x) => x !== d) : [...hb.days, d];
            e.currentTarget.classList.toggle('on');
          }
        }, DIAS2[d])))));

  const weekEditor = (w) => h('div', { class: 'week-box' },
    h('div', { class: 'ed-line' },
      h('input', { class: 'inp grow', value: w.name, oninput: (e) => { w.name = e.target.value; } }),
      h('button', { class: 'icon-btn danger', 'aria-label': 'Quitar semana', onclick: () => { draft.weeks.splice(draft.weeks.indexOf(w), 1); renderEditor(); } }, '🗑')),
    h('div', { class: 'ed-line' },
      field('Desde', h('input', { class: 'inp date', type: 'date', value: w.start, onchange: (e) => { if (e.target.value) w.start = e.target.value; } })),
      field('Hasta', h('input', { class: 'inp date', type: 'date', value: w.end, onchange: (e) => { if (e.target.value) w.end = e.target.value; } }))),
    w.goals.map((g) => goalEditor(g, w.goals)),
    h('button', { class: 'btn ghost sm', onclick: () => { w.goals.push(newGoal(draft)); renderEditor(); } }, '＋ Meta de la semana'));

  const canDelete = mode === 'edit' && S.plans.length > 1 && !currentPlan().virtual;

  sheet.replaceChildren(
    h('div', { class: 'sheet-head' },
      h('h2', {}, mode === 'edit' ? 'Editar mes' : 'Crear mes siguiente'),
      h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: closeEditor }, '✕')),
    h('div', { class: 'sheet-body' },
      sec('Datos del mes',
        h('div', { class: 'ed-line' },
          field('Nombre', h('input', { class: 'inp', value: draft.name, oninput: (e) => { draft.name = e.target.value; } }))),
        h('div', { class: 'ed-line' },
          field('Inicio', h('input', { class: 'inp', type: 'date', value: draft.start, onchange: (e) => { if (e.target.value) draft.start = e.target.value; } })),
          field('Fin', h('input', { class: 'inp', type: 'date', value: draft.end, onchange: (e) => { if (e.target.value) draft.end = e.target.value; } })))),
      sec('Hábitos de cada día',
        draft.habits.map(habitEditor),
        h('button', { class: 'btn ghost sm', onclick: () => { draft.habits.push({ id: uid('h'), label: '', icon: '⭐', days: [0, 1, 2, 3, 4, 5, 6], type: 'check' }); renderEditor(); } }, '＋ Hábito')),
      sec('Metas del mes',
        draft.monthGoals.map((g) => goalEditor(g, draft.monthGoals)),
        h('button', { class: 'btn ghost sm', onclick: () => { draft.monthGoals.push(newGoal(draft)); renderEditor(); } }, '＋ Meta del mes')),
      sec('Metas por semana',
        draft.weeks.map(weekEditor),
        h('div', { class: 'ed-line' },
          h('button', { class: 'btn ghost sm', onclick: () => { const last = draft.weeks[draft.weeks.length - 1]; const s = last ? addDays(last.end, 1) : draft.start; draft.weeks.push({ id: uid('wk'), name: `Semana ${draft.weeks.length + 1}`, start: s, end: addDays(s, 6), goals: [] }); renderEditor(); } }, '＋ Semana'),
          h('button', { class: 'btn ghost sm', onclick: () => { if (confirm('Esto reemplaza las semanas actuales usando las fechas y metas del mes. ¿Continuar?')) { draft.weeks = makeWeeks(draft); renderEditor(); } } }, '↻ Regenerar semanas')))),
    h('div', { class: 'sheet-foot' },
      canDelete && h('button', { class: 'btn danger', onclick: deletePlan }, 'Eliminar'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: closeEditor }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: saveEditor }, mode === 'edit' ? 'Guardar' : 'Crear mes')));

  $('.sheet-body', sheet).scrollTop = top;
}

function newGoal(draft) {
  const first = draft.habits[0];
  return first
    ? { id: uid('g'), label: '', kind: 'habit', habit: first.id, mode: 'days', target: 1 }
    : { id: uid('g'), label: '', kind: 'manual', target: 1 };
}

async function saveEditor() {
  const { mode, draft } = S.editor;
  const name = (draft.name || '').trim();
  if (!name) return toast('Ponle un nombre al mes');
  if (!draft.start || !draft.end || draft.start > draft.end) return toast('Revisa las fechas: el inicio debe ser antes del fin');

  const habits = draft.habits.filter((x) => (x.label || '').trim()).map((x) => ({
    id: x.id, label: x.label.trim(), icon: (x.icon || '').trim() || '⭐', days: [...new Set(x.days)].sort(), type: x.type === 'count' ? 'count' : 'check'
  }));
  const ids = new Set(habits.map((x) => x.id));
  const cleanGoals = (list) => list.filter((g) => (g.label || '').trim()).map((g) => {
    const ok = g.kind === 'habit' && ids.has(g.habit);
    return ok
      ? { id: g.id, label: g.label.trim(), kind: 'habit', habit: g.habit, mode: g.mode || 'days', target: Math.max(1, Number(g.target) || 1) }
      : { id: g.id, label: g.label.trim(), kind: 'manual', target: 1 };
  });
  const weeks = draft.weeks
    .filter((w) => w.start && w.end && w.start <= w.end)
    .map((w) => ({ id: w.id, name: (w.name || '').trim() || 'Semana', start: w.start, end: w.end, goals: cleanGoals(w.goals) }))
    .sort((a, b) => a.start.localeCompare(b.start));

  let id = draft.id;
  if (mode === 'next') {
    id = draft.start;
    if (S.plans.some((p) => p.id === id)) id = `${draft.start}_${Date.now().toString(36)}`;
  }
  const plan = clone({ id, name, start: draft.start, end: draft.end, habits, monthGoals: cleanGoals(draft.monthGoals), weeks, manual: draft.manual || {} });
  try {
    await setDoc(planRef(id), plan);
    S.planId = id; S.weekIdx = null;
    closeEditor();
    toast(mode === 'edit' ? 'Cambios guardados ✓' : 'Mes creado ✓');
    syncMonthSubs();
    render();
  } catch (e) { console.error(e); toast('No se pudo guardar. Revisa tu conexión.'); }
}

async function deletePlan() {
  const p = currentPlan();
  if (!confirm(`¿Eliminar “${p.name}”? Tus días marcados no se borran, solo este plan de metas.`)) return;
  try {
    await deleteDoc(planRef(p.id));
    S.planId = null;
    closeEditor();
    toast('Mes eliminado');
  } catch (e) { console.error(e); toast('No se pudo eliminar'); }
}

/* ---------------------------------------------------------------------
   Arranque, login y eventos
   --------------------------------------------------------------------- */
const show = (id, on) => $(id).classList.toggle('hidden', !on);

function setScreen(name) {
  show('#screen-setup', name === 'setup');
  show('#screen-login', name === 'login');
  show('#app', name === 'app');
}

$$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  S.tab = b.dataset.tab;
  try { localStorage.setItem('mp_tab', S.tab); } catch { /* sin storage */ }
  render();
  window.scrollTo({ top: 0 });
}));

const note = $('#note');
note.addEventListener('input', () => {
  notePending = { date: S.date, text: note.value };
  $('#noteState').textContent = 'Guardando…';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(flushNote, 700);
});
note.addEventListener('blur', flushNote);

$('#avatarBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#userMenu').classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#userMenu')) $('#userMenu').classList.add('hidden'); });
$('#logoutBtn').addEventListener('click', () => { $('#userMenu').classList.add('hidden'); signOut(auth); });
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeEditor(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.editor) closeEditor(); });
addEventListener('online', render);
addEventListener('offline', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.user) {
    // Si dejaste la app abierta y cambió el día, pasa al día nuevo.
    if (S.date < today() && !S.editor && S.tab === 'hoy' && S.lastToday !== today()) { S.date = today(); syncMonthSubs(); }
    S.lastToday = today();
    render();
  }
});
S.lastToday = today();

$('#loginBtn').addEventListener('click', async () => {
  const err = $('#loginError');
  err.classList.add('hidden');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Nota: no usamos signInWithRedirect; Safari (iPhone) lo rompe por la partición de almacenamiento.
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    console.error(e);
    if (e.code === 'auth/unauthorized-domain') {
      err.textContent = 'Este dominio no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados).';
    } else if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      err.textContent = 'Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio, o ábrelo directamente en Safari/Chrome (no desde WhatsApp u otra app).';
    } else {
      err.textContent = `No se pudo iniciar sesión (${e.code || e.message}).`;
    }
    err.classList.remove('hidden');
  }
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW:', e)));
}

if (!configured) {
  setScreen('setup');
} else {
  onAuthStateChanged(auth, (user) => {
    teardown();
    S.user = user;
    if (!user) { setScreen('login'); return; }
    const av = $('#avatarBtn');
    if (user.photoURL) { av.style.backgroundImage = `url("${user.photoURL}")`; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = (user.displayName || user.email || '?')[0].toUpperCase(); }
    $('#userName').textContent = user.displayName || 'Mi cuenta';
    $('#userEmail').textContent = user.email || '';
    S.date = today();
    setScreen('app');
    subscribePlans();
    syncMonthSubs();
  });
}
