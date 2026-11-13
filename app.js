// ============================================================================
// CUENTA CONJUNTA · CONTROL DE APORTACIONES (GASTOS 2/3 + AHORRO 1/3)
// ============================================================================

const STORAGE_KEY = 'cuenta_conjunta_clean_v5';
const SESSION_KEY = 'cuenta_conjunta_auth_session_v3';

const SUPABASE_URL = 'https://kabhcziezseedckgpgwu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Wn-0AnL3OIEFAzuMTe9aFA_J1AaRnBT';

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatYearMonthES(ym) {
  if (!ym || !ym.includes('-')) return 'Resumen del mes';
  const [y, m] = ym.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTH_NAMES_ES[idx] || m} de ${y}`;
}

function getEmptyState() {
  return {
    config: {
      user1Name: 'Miguel',
      user2Name: 'Ana',
      jointPercentage: 25
    },
    selectedMonth: getCurrentYearMonth(),
    incomes: [],
    contributions: {}
  };
}

function loadCachedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getEmptyState();
    const parsed = JSON.parse(raw);
    return {
      ...getEmptyState(),
      ...parsed,
      selectedMonth: getCurrentYearMonth()
    };
  } catch (e) {
    return getEmptyState();
  }
}

let state = loadCachedState();
let currentSession = loadSession(); // { username, password, role: 'user1' | 'user2' | 'admin' }
let supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let isSaving = false;

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveSession(sess) {
  currentSession = sess;
  if (sess) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function canEditMember(userKey) {
  if (!currentSession) return false;
  if (currentSession.role === 'admin') return true;
  return currentSession.role === userKey;
}

function updateSyncIndicator(status, text) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-status-text');
  if (!dot || !label) return;

  if (status === 'cloud') {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0';
    label.textContent = text || 'Sincronizado';
  } else if (status === 'syncing') {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0';
    label.textContent = text || 'Actualizando...';
  } else if (status === 'error') {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0';
    label.textContent = text || 'Error de red';
  }
}

// Formato moneda limpio sin decimales (ej. "650 €")
function formatEUR(val) {
  const rounded = Math.round(Number(val) || 0);
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(rounded);
}

// ============================================================================
// ALGORITMO DE REDONDEO Y REPARTO: ~2/3 GASTOS y ~1/3 AHORRO (SIN CÉNTIMOS)
// ============================================================================
// - Redondea el total a aportar a decenas limpias (ej. 525 -> 530, 650 -> 650).
// - Calcula ~1/3 para Ahorro redondeado a múltiplos limpios (50 € o 100 € en importes altos,
//   10 € en importes pequeños) y el resto (~2/3) va a Gastos.
// Ejemplos:
//   600 € -> 200 € Ahorro + 400 € Gastos
//   650 € -> 200 € Ahorro + 450 € Gastos
//   700 € -> 250 € Ahorro + 450 € Gastos
function calculateRoundedSplit(rawAmount) {
  const raw = Number(rawAmount) || 0;
  if (raw <= 0) {
    return { total: 0, gastos: 0, ahorro: 0 };
  }

  // Redondear la aportación total a decenas limpias si supera 40 €
  const total = raw >= 40 ? Math.round(raw / 10) * 10 : Math.round(raw);

  let ahorro = 0;
  if (total >= 300) {
    // Redondear el tercio de ahorro al escalón de 50 € más cercano
    ahorro = Math.round((total / 3) / 50) * 50;
  } else if (total >= 60) {
    // En cantidades medianas, redondear el tercio de ahorro a decenas (10 €)
    ahorro = Math.round((total / 3) / 10) * 10;
  } else {
    ahorro = Math.round(total / 3);
  }

  const gastos = Math.max(0, total - ahorro);
  return { total, gastos, ahorro };
}

// ============================================================================
// AUTENTICACIÓN Y SINCRONIZACIÓN CON SUPABASE
// ============================================================================
async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorBox = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');

  const username = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  errorBox.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verificando...';

  try {
    const { data, error } = await supabaseClient.rpc('rpc_login_and_get_state', {
      p_username: username,
      p_password: password
    });

    if (error || !data) {
      errorBox.textContent = 'Usuario o contraseña incorrectos.';
      errorBox.classList.remove('hidden');
      return;
    }

    saveSession({
      username: data.username,
      password: password,
      role: data.role
    });

    try {
      if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
        const cred = new window.PasswordCredential({ id: data.username, password: password, name: data.username });
        navigator.credentials.store(cred).catch(() => {});
      }
    } catch (e) {}

    applyRemoteState(data.state);
    passwordInput.value = '';
    showAppScreen();
  } catch (err) {
    errorBox.textContent = 'No se pudo conectar con el servidor.';
    errorBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar';
  }
}

function handleLogout() {
  saveSession(null);
  localStorage.removeItem(STORAGE_KEY);
  state = getEmptyState();
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function showAppScreen() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  renderApp();
  updateSyncIndicator('cloud', 'Sincronizado');
  checkAutomaticDay1And15Push();
}

function applyRemoteState(remoteData) {
  const currentMonth = state.selectedMonth || getCurrentYearMonth();
  const base = getEmptyState();
  state = {
    ...base,
    ...(remoteData || {}),
    config: {
      ...base.config,
      ...((remoteData && remoteData.config) || {})
    },
    incomes: Array.isArray(remoteData && remoteData.incomes) ? remoteData.incomes : [],
    contributions: (remoteData && remoteData.contributions) || {},
    selectedMonth: currentMonth
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function pullStateFromSupabase() {
  if (!currentSession || !supabaseClient || isSaving) return;

  try {
    updateSyncIndicator('syncing', 'Sincronizando...');
    const { data, error } = await supabaseClient.rpc('rpc_login_and_get_state', {
      p_username: currentSession.username,
      p_password: currentSession.password
    });

    if (error || !data) {
      handleLogout();
      return;
    }

    currentSession.role = data.role;
    applyRemoteState(data.state);
    showAppScreen();
  } catch (err) {
    console.error(err);
    updateSyncIndicator('error');
  }
}

// Botón manual de Actualizar (ideal para iOS en modo pantalla de inicio)
async function handleManualRefresh() {
  const icon = document.getElementById('refresh-icon');
  if (icon) {
    icon.classList.remove('spin-anim');
    void icon.offsetWidth;
    icon.classList.add('spin-anim');
  }

  try {
    if (swRegistration && swRegistration.update) {
      await swRegistration.update();
    }
  } catch (e) {}

  await pullStateFromSupabase();
}

async function saveState() {
  if (!currentSession || !supabaseClient) return;

  try {
    isSaving = true;
    updateSyncIndicator('syncing', 'Guardando...');
    const payload = JSON.parse(JSON.stringify(state));

    const { data, error } = await supabaseClient.rpc('rpc_save_state', {
      p_username: currentSession.username,
      p_password: currentSession.password,
      p_new_state: payload
    });

    if (error) {
      console.error(error);
      updateSyncIndicator('error', 'Error al guardar');
    } else {
      if (data) applyRemoteState(data);
      renderApp();
      updateSyncIndicator('cloud', 'Guardado');
    }
  } catch (err) {
    console.error(err);
    updateSyncIndicator('error');
  } finally {
    isSaving = false;
  }
}

// ============================================================================
// CÁLCULOS DE CADA MIEMBRO EN EL MES SELECCIONADO (POR CUENTA: GASTOS Y AHORRO)
// ============================================================================
function getUserAccountContributions(userKey, month, targetGastos) {
  const key = `${month}_${userKey}`;
  const raw = state.contributions[key];

  if (raw && typeof raw === 'object') {
    return {
      gastos: Math.max(0, Math.round(Number(raw.gastos) || 0)),
      ahorro: Math.max(0, Math.round(Number(raw.ahorro) || 0))
    };
  }

  // Compatibilidad si había un número plano guardado de antes
  const legacyNum = Math.max(0, Math.round(Number(raw) || 0));
  if (legacyNum > 0) {
    const gastosPart = Math.min(targetGastos || legacyNum, legacyNum);
    const ahorroPart = Math.max(0, legacyNum - gastosPart);
    return { gastos: gastosPart, ahorro: ahorroPart };
  }

  return { gastos: 0, ahorro: 0 };
}

function getMemberStats(userKey, month) {
  const pct = (Number(state.config.jointPercentage) || 25) / 100;
  const userIncomes = state.incomes.filter(i => i.owner === userKey && i.month === month);

  let totalIncome = 0;
  let collectedIncome = 0;
  let pendingIncome = 0;

  userIncomes.forEach(inc => {
    const amt = Math.round(Number(inc.amount) || 0);
    totalIncome += amt;
    if (inc.collected) {
      collectedIncome += amt;
    } else {
      pendingIncome += amt;
    }
  });

  // Cálculo redondeado del total del mes y reparto Gastos (2/3) vs Ahorro (1/3)
  const totalSplit = calculateRoundedSplit(totalIncome * pct);
  const collectedSplit = calculateRoundedSplit(collectedIncome * pct);

  const targetTotalShare = totalSplit.total;
  const targetGastos = totalSplit.gastos;
  const targetAhorro = totalSplit.ahorro;

  const targetCollectedShare = collectedSplit.total;
  const acct = getUserAccountContributions(userKey, month, targetGastos);

  const contributedGastos = acct.gastos;
  const contributedAhorro = acct.ahorro;
  const remainingGastos = Math.max(0, targetGastos - contributedGastos);
  const remainingAhorro = Math.max(0, targetAhorro - contributedAhorro);

  const alreadyContributed = contributedGastos + contributedAhorro;
  const remainingTotal = remainingGastos + remainingAhorro;

  return {
    incomes: userIncomes,
    totalIncome,
    collectedIncome,
    pendingIncome,
    targetTotalShare,
    targetGastos,
    targetAhorro,
    targetCollectedShare,
    collectedGastos: collectedSplit.gastos,
    collectedAhorro: collectedSplit.ahorro,
    contributedGastos,
    contributedAhorro,
    remainingGastos,
    remainingAhorro,
    alreadyContributed,
    remainingTotal
  };
}

// ============================================================================
// RENDERIZADO PRINCIPAL (TU TARJETA PRIMERO + EL OTRO EN FORMATO BREVE)
// ============================================================================
function renderApp() {
  if (!currentSession) return;

  const pct = state.config.jointPercentage;
  const month = state.selectedMonth;

  document.getElementById('header-pct-badge').textContent = `${pct}%`;
  document.querySelectorAll('.pct-label').forEach(el => (el.textContent = pct));
  document.getElementById('month-picker').value = month;
  const displayEl = document.getElementById('month-display-text');
  if (displayEl) displayEl.textContent = formatYearMonthES(month);
  document.getElementById('month-human-label').textContent = `Resumen Conjunto · ${formatYearMonthES(month)}`;

  const roleLabel =
    currentSession.role === 'admin'
      ? '🛡️ Admin'
      : currentSession.role === 'user1'
      ? state.config.user1Name
      : state.config.user2Name;
  document.getElementById('logged-user-badge').textContent = roleLabel;

  const s1 = getMemberStats('user1', month);
  const s2 = getMemberStats('user2', month);

  // Resumen global centrado en Aportado, Pendiente y Progreso por Cuenta (Gastos y Ahorro)
  const totalTransferred = s1.alreadyContributed + s2.alreadyContributed;
  const totalExpected = s1.targetTotalShare + s2.targetTotalShare;
  const totalMissing = s1.remainingTotal + s2.remainingTotal;

  const totalGastosTarget = s1.targetGastos + s2.targetGastos;
  const totalGastosContributed = s1.contributedGastos + s2.contributedGastos;
  const totalGastosMissing = s1.remainingGastos + s2.remainingGastos;
  const gastosPct = totalGastosTarget > 0 ? Math.min(100, Math.round((totalGastosContributed / totalGastosTarget) * 100)) : 0;

  const totalAhorroTarget = s1.targetAhorro + s2.targetAhorro;
  const totalAhorroContributed = s1.contributedAhorro + s2.contributedAhorro;
  const totalAhorroMissing = s1.remainingAhorro + s2.remainingAhorro;
  const ahorroPct = totalAhorroTarget > 0 ? Math.min(100, Math.round((totalAhorroContributed / totalAhorroTarget) * 100)) : 0;

  document.getElementById('global-transferred').textContent = formatEUR(totalTransferred);
  document.getElementById('global-expected').textContent = `aportados de ${formatEUR(totalExpected)}`;

  // Actualizar caja global de Gastos
  const gText = document.getElementById('global-gastos-progress-text');
  const gBadge = document.getElementById('global-gastos-badge');
  const gBar = document.getElementById('global-gastos-bar');
  if (gText) {
    gText.innerHTML = `${formatEUR(totalGastosContributed)} <span class="text-xs font-normal text-slate-400">de ${formatEUR(totalGastosTarget)}</span>`;
  }
  if (gBadge) {
    if (totalGastosTarget === 0) {
      gBadge.textContent = 'Sin datos';
      gBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-700 text-slate-300';
    } else if (totalGastosMissing <= 0) {
      gBadge.textContent = '✅ Al día';
      gBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300';
    } else {
      gBadge.textContent = `Faltan ${formatEUR(totalGastosMissing)}`;
      gBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300';
    }
  }
  if (gBar) gBar.style.width = `${gastosPct}%`;

  // Actualizar caja global de Ahorro
  const aText = document.getElementById('global-ahorro-progress-text');
  const aBadge = document.getElementById('global-ahorro-badge');
  const aBar = document.getElementById('global-ahorro-bar');
  if (aText) {
    aText.innerHTML = `${formatEUR(totalAhorroContributed)} <span class="text-xs font-normal text-slate-400">de ${formatEUR(totalAhorroTarget)}</span>`;
  }
  if (aBadge) {
    if (totalAhorroTarget === 0) {
      aBadge.textContent = 'Sin datos';
      aBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-700 text-slate-300';
    } else if (totalAhorroMissing <= 0) {
      aBadge.textContent = '✅ Al día';
      aBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300';
    } else {
      aBadge.textContent = `Faltan ${formatEUR(totalAhorroMissing)}`;
      aBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300';
    }
  }
  if (aBar) aBar.style.width = `${ahorroPct}%`;

  const pill = document.getElementById('global-status-pill');
  if (totalExpected === 0 && totalTransferred === 0) {
    pill.textContent = 'Falta añadir ingresos';
    pill.className = 'inline-block px-3 py-1 rounded-full text-xs font-semibold bg-amber-400/20 text-amber-300';
  } else if (totalMissing <= 0) {
    pill.textContent = '✅ Mes completado';
    pill.className = 'inline-block px-3 py-1 rounded-full text-xs font-semibold bg-emerald-400/20 text-emerald-300';
  } else {
    pill.textContent = `Pendiente: ${formatEUR(totalMissing)}`;
    pill.className = 'inline-block px-3 py-1 rounded-full text-xs font-semibold bg-amber-400/20 text-amber-300';
  }

  renderReminderBanner(s1, s2);
  renderMembersArea(s1, s2);
}

// Renderiza primero la tarjeta completa del usuario que ha iniciado sesión
// y debajo un resumen compacto del otro usuario
function renderMembersArea(s1, s2) {
  const area = document.getElementById('members-Area');
  if (!area) return;

  if (currentSession.role === 'user2') {
    // Si entra Ana: primero Ana (completa) y debajo Miguel (resumen breve)
    area.innerHTML = `
      ${buildFullMemberCardHTML('user2', state.config.user2Name, s2)}
      ${buildCompactMemberCardHTML('user1', state.config.user1Name, s1)}
    `;
  } else if (currentSession.role === 'user1') {
    // Si entra Miguel: primero Miguel (completa) y debajo Ana (resumen breve)
    area.innerHTML = `
      ${buildFullMemberCardHTML('user1', state.config.user1Name, s1)}
      ${buildCompactMemberCardHTML('user2', state.config.user2Name, s2)}
    `;
  } else {
    // Si entra Admin: ve las dos tarjetas completas para poder gestionar ambas
    area.innerHTML = `
      ${buildFullMemberCardHTML('user1', state.config.user1Name, s1)}
      ${buildFullMemberCardHTML('user2', state.config.user2Name, s2)}
    `;
  }
}

function getMonthPendingDetails(s1, s2) {
  const missingIncomes = [];
  const missingContributions = [];

  if (s1.totalIncome <= 0) {
    missingIncomes.push(state.config.user1Name);
  } else if (s1.remainingTotal > 0) {
    const subParts = [];
    if (s1.remainingGastos > 0) subParts.push(`${formatEUR(s1.remainingGastos)} Gastos`);
    if (s1.remainingAhorro > 0) subParts.push(`${formatEUR(s1.remainingAhorro)} Ahorro`);
    missingContributions.push(`${state.config.user1Name} (${subParts.join(' + ')})`);
  }

  if (s2.totalIncome <= 0) {
    missingIncomes.push(state.config.user2Name);
  } else if (s2.remainingTotal > 0) {
    const subParts = [];
    if (s2.remainingGastos > 0) subParts.push(`${formatEUR(s2.remainingGastos)} Gastos`);
    if (s2.remainingAhorro > 0) subParts.push(`${formatEUR(s2.remainingAhorro)} Ahorro`);
    missingContributions.push(`${state.config.user2Name} (${subParts.join(' + ')})`);
  }

  const hasPending = missingIncomes.length > 0 || missingContributions.length > 0;
  const parts = [];
  if (missingIncomes.length > 0) {
    parts.push(`Falta añadir ingresos de ${missingIncomes.join(' y ')}`);
  }
  if (missingContributions.length > 0) {
    parts.push(`Pendiente de aportar: ${missingContributions.join(' · ')}`);
  }

  return {
    hasPending,
    summaryText: parts.join(' · ')
  };
}

function renderReminderBanner(s1, s2) {
  const banner = document.getElementById('reminder-banner');
  const details = getMonthPendingDetails(s1, s2);

  if (!details.hasPending) {
    banner.classList.add('hidden');
    return;
  }

  banner.className = 'rounded-2xl p-3.5 border bg-amber-50 border-amber-200 text-amber-950 flex items-center gap-2.5 text-xs';
  banner.innerHTML = `
    <span class="text-base shrink-0">🔔</span>
    <div>
      <span class="font-semibold">Estado del mes:</span>
      <span class="ml-1">${escapeHtml(details.summaryText)}</span>
    </div>
  `;
  banner.classList.remove('hidden');
}

// ============================================================================
// TARJETA COMPLETA DEL USUARIO ACTIVO (BARRA Y CONTROLES POR CADA CUENTA)
// ============================================================================
function buildFullMemberCardHTML(userKey, name, stats) {
  const pct = state.config.jointPercentage;
  const isAllComplete = stats.targetTotalShare > 0 && stats.remainingTotal <= 0;

  const gastosPct = stats.targetGastos > 0
    ? Math.min(100, Math.round((stats.contributedGastos / stats.targetGastos) * 100))
    : 0;
  const isGastosComplete = stats.targetGastos > 0 && stats.remainingGastos <= 0;

  const ahorroPct = stats.targetAhorro > 0
    ? Math.min(100, Math.round((stats.contributedAhorro / stats.targetAhorro) * 100))
    : 0;
  const isAhorroComplete = stats.targetAhorro > 0 && stats.remainingAhorro <= 0;

  return `
    <section class="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5 space-y-4">
      <!-- Cabecera de tu tarjeta -->
      <div class="flex items-center justify-between border-b border-slate-100 pb-3 gap-2">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="font-bold text-slate-900 text-base sm:text-lg">👤 ${escapeHtml(name)}</h2>
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700">Tu espacio</span>
          </div>
          <p class="text-xs text-slate-500 mt-0.5">
            Ingresos de este mes: <strong class="text-slate-800">${formatEUR(stats.totalIncome)}</strong>
          </p>
        </div>

        ${
          stats.targetTotalShare === 0
            ? `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shrink-0">Añade tu sueldo</span>`
            : isAllComplete
            ? `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 shrink-0">✅ Todo aportado</span>`
            : `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shrink-0">Faltan ${formatEUR(stats.remainingTotal)}</span>`
        }
      </div>

      <!-- 1. Lista de Sueldos / Pagadores -->
      <div class="space-y-2">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">1. Mis Sueldos / Ingresos del mes</p>

        ${
          stats.incomes.length === 0
            ? `<p class="text-xs text-slate-400 italic py-1">Aún no has añadido tu sueldo de este mes.</p>`
            : stats.incomes
                .map(
                  inc => `
                <div class="flex items-center justify-between gap-2 bg-slate-50 px-2.5 py-2 rounded-xl border border-slate-100 text-xs">
                  <div class="flex items-center gap-1.5 min-w-0 flex-1">
                    <button type="button" onclick="toggleIncomeCollected('${inc.id}')"
                      class="px-2 py-1 rounded-lg font-semibold shrink-0 transition ${
                        inc.collected
                          ? 'bg-emerald-100 text-emerald-800 active:bg-emerald-200'
                          : 'bg-amber-100 text-amber-800 active:bg-amber-200'
                      }">
                      ${inc.collected ? 'Cobrado' : '⏳ Pendiente'}
                    </button>
                    <span class="font-medium text-slate-800 truncate">${escapeHtml(inc.source)}</span>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <input type="number" step="1" min="0" value="${Math.round(inc.amount)}"
                      onchange="updateIncomeAmount('${inc.id}', this.value)"
                      class="w-20 text-right font-bold text-slate-900 bg-white px-2 py-1 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    <span class="text-slate-500 font-semibold">€</span>
                    <button type="button" onclick="deleteIncome('${inc.id}')" class="p-1 text-slate-300 hover:text-rose-600">✕</button>
                  </div>
                </div>
              `
                )
                .join('')
        }

        <form onsubmit="handleAddIncome(event, '${userKey}')" class="flex gap-1.5 pt-1">
          <input id="inc-src-${userKey}" type="text" required placeholder="Añadir sueldo / pagador..."
            class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <input id="inc-amt-${userKey}" type="number" step="1" min="0" required placeholder="Importe €"
            class="w-24 px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <button type="submit"
            class="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-bold rounded-xl text-xs transition shrink-0">
            +
          </button>
        </form>
      </div>

      <!-- 2. Desglose redondeado en 2 Cuentas con progreso independiente -->
      <div class="pt-3 border-t border-slate-100 space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            2. Tus Aportaciones por Cuenta (${pct}%)
          </p>
          <span class="text-xs font-bold text-slate-700">
            Aportado: <strong class="text-slate-950">${formatEUR(stats.alreadyContributed)}</strong> / ${formatEUR(stats.targetTotalShare)}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <!-- ============================================================= -->
          <!-- TARJETA CUENTA DE GASTOS (~2/3) CON SU PROPIA BARRA Y ESTADO  -->
          <!-- ============================================================= -->
          <div class="rounded-2xl p-3.5 border ${
            isGastosComplete
              ? 'bg-emerald-50/60 border-emerald-200'
              : 'bg-indigo-50/60 border-indigo-100'
          } flex flex-col justify-between space-y-2.5">
            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-1">
                <span class="text-xs font-bold text-indigo-950 flex items-center gap-1">
                  <span>🏦</span>
                  <span>Cuenta Gastos (~2/3)</span>
                </span>
                ${
                  stats.targetGastos === 0
                    ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-600">0 €</span>`
                    : isGastosComplete
                    ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900">✅ Completada</span>`
                    : `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900">Faltan ${formatEUR(stats.remainingGastos)}</span>`
                }
              </div>

              <div class="flex items-baseline justify-between">
                <p class="text-xl font-bold ${isGastosComplete ? 'text-emerald-700' : 'text-indigo-700'}">
                  ${formatEUR(stats.contributedGastos)}
                  <span class="text-xs font-medium text-slate-500">de ${formatEUR(stats.targetGastos)}</span>
                </p>
              </div>

              <!-- Barra de progreso exclusiva de Gastos -->
              <div class="w-full h-2 bg-white/90 rounded-full overflow-hidden border border-indigo-100">
                <div class="h-full ${isGastosComplete ? 'bg-emerald-500' : 'bg-indigo-600'} transition-all" style="width: ${gastosPct}%"></div>
              </div>
            </div>

            <!-- Botones de acción exclusivos de Gastos -->
            <div class="flex items-center gap-1.5 pt-0.5">
              ${
                stats.targetGastos > 0 && !isGastosComplete
                  ? `<button type="button" onclick="completeAccountContribution('${userKey}', 'gastos', ${stats.targetGastos})"
                      class="flex-1 py-2 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-xs transition shadow-2xs">
                      ✓ ${stats.contributedGastos > 0 ? `Completar (+${formatEUR(stats.remainingGastos)})` : `Aportar ${formatEUR(stats.targetGastos)}`}
                     </button>`
                  : stats.targetGastos > 0 && isGastosComplete
                  ? `<span class="flex-1 py-1.5 px-2.5 rounded-xl bg-emerald-100 text-emerald-800 font-semibold text-xs text-center">
                      ✅ Gastos al día
                     </span>`
                  : `<span class="text-[11px] text-slate-400 italic">Añade ingresos primero</span>`
              }
              ${
                stats.contributedGastos > 0
                  ? `<button type="button" onclick="resetAccountContribution('${userKey}', 'gastos')" title="Poner Cuenta Gastos a 0 €"
                      class="py-2 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-600 text-slate-500 font-semibold text-xs transition shrink-0">
                      0 €
                     </button>`
                  : ''
              }
            </div>
          </div>

          <!-- ============================================================= -->
          <!-- TARJETA CUENTA DE AHORRO (~1/3) CON SU PROPIA BARRA Y ESTADO  -->
          <!-- ============================================================= -->
          <div class="rounded-2xl p-3.5 border ${
            isAhorroComplete
              ? 'bg-emerald-50/70 border-emerald-200'
              : 'bg-teal-50/60 border-teal-100'
          } flex flex-col justify-between space-y-2.5">
            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-1">
                <span class="text-xs font-bold text-emerald-950 flex items-center gap-1">
                  <span>🐷</span>
                  <span>Cuenta Ahorro (~1/3)</span>
                </span>
                ${
                  stats.targetAhorro === 0
                    ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-600">0 €</span>`
                    : isAhorroComplete
                    ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900">✅ Completada</span>`
                    : `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900">Faltan ${formatEUR(stats.remainingAhorro)}</span>`
                }
              </div>

              <div class="flex items-baseline justify-between">
                <p class="text-xl font-bold text-emerald-700">
                  ${formatEUR(stats.contributedAhorro)}
                  <span class="text-xs font-medium text-slate-500">de ${formatEUR(stats.targetAhorro)}</span>
                </p>
              </div>

              <!-- Barra de progreso exclusiva de Ahorro -->
              <div class="w-full h-2 bg-white/90 rounded-full overflow-hidden border border-emerald-100">
                <div class="h-full bg-emerald-600 transition-all" style="width: ${ahorroPct}%"></div>
              </div>
            </div>

            <!-- Botones de acción exclusivos de Ahorro -->
            <div class="flex items-center gap-1.5 pt-0.5">
              ${
                stats.targetAhorro > 0 && !isAhorroComplete
                  ? `<button type="button" onclick="completeAccountContribution('${userKey}', 'ahorro', ${stats.targetAhorro})"
                      class="flex-1 py-2 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-xs transition shadow-2xs">
                      ✓ ${stats.contributedAhorro > 0 ? `Completar (+${formatEUR(stats.remainingAhorro)})` : `Aportar ${formatEUR(stats.targetAhorro)}`}
                     </button>`
                  : stats.targetAhorro > 0 && isAhorroComplete
                  ? `<span class="flex-1 py-1.5 px-2.5 rounded-xl bg-emerald-100 text-emerald-800 font-semibold text-xs text-center">
                      ✅ Ahorro al día
                     </span>`
                  : `<span class="text-[11px] text-slate-400 italic">Añade ingresos primero</span>`
              }
              ${
                stats.contributedAhorro > 0
                  ? `<button type="button" onclick="resetAccountContribution('${userKey}', 'ahorro')" title="Poner Cuenta Ahorro a 0 €"
                      class="py-2 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-600 text-slate-500 font-semibold text-xs transition shrink-0">
                      0 €
                     </button>`
                  : ''
              }
            </div>
          </div>
        </div>

        ${
          stats.pendingIncome > 0
            ? `<p class="text-[11px] text-amber-800 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200/70">
                💡 De lo ya cobrado hoy te toca aportar <strong>${formatEUR(stats.targetCollectedShare)}</strong>
                (<strong>${formatEUR(stats.collectedGastos)}</strong> a Gastos y <strong>${formatEUR(stats.collectedAhorro)}</strong> a Ahorro).
               </p>`
            : ''
        }

        <!-- Aportación manual eligiendo explícitamente a qué cuenta va -->
        ${
          stats.targetTotalShare > 0
            ? `
            <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-200/70 space-y-2">
              <p class="text-[11px] font-medium text-slate-500">
                ¿Has hecho una transferencia parcial de otro importe? Indica cuánto y a qué cuenta:
              </p>
              <div class="flex flex-wrap items-center gap-1.5">
                <input id="partial-input-${userKey}" type="number" step="1" min="1" placeholder="Cantidad €"
                  class="w-28 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <button type="button" onclick="addPartialToAccount('${userKey}', 'gastos')"
                  class="px-3 py-2 bg-indigo-100 hover:bg-indigo-200 active:bg-indigo-300 text-indigo-900 font-semibold rounded-xl text-xs transition">
                  + A Gastos 🏦
                </button>
                <button type="button" onclick="addPartialToAccount('${userKey}', 'ahorro')"
                  class="px-3 py-2 bg-emerald-100 hover:bg-emerald-200 active:bg-emerald-300 text-emerald-900 font-semibold rounded-xl text-xs transition">
                  + A Ahorro 🐷
                </button>
              </div>
            </div>
            `
            : ''
        }
      </div>
    </section>
  `;
}

// ============================================================================
// TARJETA REDUCIDA / COMPACTA DEL OTRO MIEMBRO DE LA PAREJA
// ============================================================================
function buildCompactMemberCardHTML(userKey, name, stats) {
  const isComplete = stats.targetTotalShare > 0 && stats.remainingTotal <= 0;
  const isGastosComplete = stats.targetGastos > 0 && stats.remainingGastos <= 0;
  const isAhorroComplete = stats.targetAhorro > 0 && stats.remainingAhorro <= 0;

  return `
    <section class="bg-white/90 rounded-2xl border border-slate-200/80 p-3.5 sm:px-5 shadow-2xs space-y-2.5">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-bold text-slate-800 text-sm truncate">👤 ${escapeHtml(name)}</span>
          <span class="text-[11px] text-slate-400">· Ingresos: <strong class="text-slate-600">${formatEUR(stats.totalIncome)}</strong></span>
        </div>

        ${
          stats.targetTotalShare === 0
            ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 shrink-0">Sin ingresos aún</span>`
            : isComplete
            ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 shrink-0">✅ Todo al día</span>`
            : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 shrink-0">Faltan ${formatEUR(stats.remainingTotal)}</span>`
        }
      </div>

      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-100 flex items-center justify-between">
          <span class="text-slate-600 font-medium">🏦 Gastos</span>
          <span class="font-bold ${isGastosComplete ? 'text-emerald-700' : 'text-indigo-700'}">
            ${formatEUR(stats.contributedGastos)} / ${formatEUR(stats.targetGastos)} ${isGastosComplete ? '✅' : ''}
          </span>
        </div>
        <div class="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-100 flex items-center justify-between">
          <span class="text-slate-600 font-medium">🐷 Ahorro</span>
          <span class="font-bold ${isAhorroComplete ? 'text-emerald-700' : 'text-teal-700'}">
            ${formatEUR(stats.contributedAhorro)} / ${formatEUR(stats.targetAhorro)} ${isAhorroComplete ? '✅' : ''}
          </span>
        </div>
      </div>
    </section>
  `;
}

// ============================================================================
// ACCIONES DEL USUARIO
// ============================================================================
function stepMonth(delta) {
  const [y, m] = state.selectedMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const newYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  changeMonth(newYm);
}

function changeMonth(newMonth) {
  if (!newMonth) return;
  state.selectedMonth = newMonth;
  renderApp();
}

function handleAddIncome(e, userKey) {
  e.preventDefault();
  if (!canEditMember(userKey)) return;

  const srcInput = document.getElementById(`inc-src-${userKey}`);
  const amtInput = document.getElementById(`inc-amt-${userKey}`);

  state.incomes.push({
    id: 'inc-' + Date.now(),
    month: state.selectedMonth,
    owner: userKey,
    source: srcInput.value.trim(),
    amount: Math.round(parseFloat(amtInput.value) || 0),
    collected: true
  });

  srcInput.value = '';
  amtInput.value = '';
  renderApp();
  saveState();
}

function updateIncomeAmount(id, newVal) {
  const item = state.incomes.find(i => i.id === id);
  if (!item || !canEditMember(item.owner)) return;
  item.amount = Math.round(parseFloat(newVal) || 0);
  renderApp();
  saveState();
}

function toggleIncomeCollected(id) {
  const item = state.incomes.find(i => i.id === id);
  if (!item || !canEditMember(item.owner)) return;
  item.collected = !item.collected;
  renderApp();
  saveState();
}

function deleteIncome(id) {
  const item = state.incomes.find(i => i.id === id);
  if (!item || !canEditMember(item.owner)) return;
  state.incomes = state.incomes.filter(i => i.id !== id);
  renderApp();
  saveState();
}

function completeAccountContribution(userKey, accountType, targetAmount) {
  if (!canEditMember(userKey)) return;
  const stats = getMemberStats(userKey, state.selectedMonth);
  const key = `${state.selectedMonth}_${userKey}`;
  const current = getUserAccountContributions(userKey, state.selectedMonth, stats.targetGastos);

  current[accountType] = Math.round(targetAmount);
  state.contributions[key] = current;
  renderApp();
  saveState();
}

function resetAccountContribution(userKey, accountType) {
  if (!canEditMember(userKey)) return;
  const stats = getMemberStats(userKey, state.selectedMonth);
  const key = `${state.selectedMonth}_${userKey}`;
  const current = getUserAccountContributions(userKey, state.selectedMonth, stats.targetGastos);

  current[accountType] = 0;
  state.contributions[key] = current;
  renderApp();
  saveState();
}

function addPartialToAccount(userKey, accountType) {
  if (!canEditMember(userKey)) return;
  const input = document.getElementById(`partial-input-${userKey}`);
  if (!input) return;

  const amountToAdd = Math.round(parseFloat(input.value) || 0);
  if (!amountToAdd || amountToAdd <= 0) return;

  const stats = getMemberStats(userKey, state.selectedMonth);
  const key = `${state.selectedMonth}_${userKey}`;
  const current = getUserAccountContributions(userKey, state.selectedMonth, stats.targetGastos);

  current[accountType] = (current[accountType] || 0) + amountToAdd;
  state.contributions[key] = current;

  input.value = '';
  renderApp();
  saveState();
}

// ============================================================================
// MODAL DE AJUSTES Y CAMBIO DE CONTRASEÑA
// ============================================================================
function openSettingsModal() {
  document.getElementById('set-user1-name').value = state.config.user1Name;
  document.getElementById('set-user2-name').value = state.config.user2Name;
  document.getElementById('set-joint-pct').value = state.config.jointPercentage;

  const adminBox = document.getElementById('admin-target-user-box');
  const targetSelect = document.getElementById('pwd-target-user');
  if (currentSession && currentSession.role === 'admin') {
    adminBox.classList.remove('hidden');
    targetSelect.value = 'admin';
  } else {
    adminBox.classList.add('hidden');
  }

  document.getElementById('pwd-new').value = '';
  document.getElementById('pwd-feedback').classList.add('hidden');
  document.getElementById('push-feedback').classList.add('hidden');
  renderPushStatusUI();
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings(e) {
  e.preventDefault();
  state.config.user1Name = document.getElementById('set-user1-name').value.trim() || 'Miguel';
  state.config.user2Name = document.getElementById('set-user2-name').value.trim() || 'Ana';
  state.config.jointPercentage = Number(document.getElementById('set-joint-pct').value) || 25;

  closeSettingsModal();
  renderApp();
  await saveState();
}

async function handleChangePassword(e) {
  e.preventDefault();
  if (!currentSession) return;

  const newPassword = document.getElementById('pwd-new').value;
  const targetUser =
    currentSession.role === 'admin'
      ? document.getElementById('pwd-target-user').value
      : currentSession.username;
  const feedback = document.getElementById('pwd-feedback');

  feedback.classList.add('hidden');

  try {
    const { data, error } = await supabaseClient.rpc('rpc_change_password', {
      p_username: currentSession.username,
      p_current_password: currentSession.password,
      p_target_username: targetUser,
      p_new_password: newPassword
    });

    if (error || !data) {
      feedback.textContent = 'No se pudo actualizar la contraseña.';
      feedback.className = 'text-xs p-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200';
      feedback.classList.remove('hidden');
      return;
    }

    if (targetUser === currentSession.username) {
      currentSession.password = newPassword;
      saveSession(currentSession);
    }

    document.getElementById('pwd-new').value = '';
    feedback.textContent = `✅ Contraseña de "${targetUser}" actualizada correctamente.`;
    feedback.className = 'text-xs p-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200';
    feedback.classList.remove('hidden');
  } catch (err) {
    feedback.textContent = 'Error de conexión al cambiar la contraseña.';
    feedback.className = 'text-xs p-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200';
    feedback.classList.remove('hidden');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// PWA INSTALABLE Y NOTIFICACIONES WEB PUSH (DÍA 1 Y DÍA 15)
// ============================================================================
let deferredInstallPrompt = null;
let swRegistration = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const banner = document.getElementById('install-pwa-banner');
  if (banner) banner.classList.remove('hidden');
});

async function triggerInstallPwa() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  const banner = document.getElementById('install-pwa-banner');
  if (banner) banner.classList.add('hidden');
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('ServiceWorker:', err);
    }
  }
}

async function showSystemNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;

  if (swRegistration && swRegistration.active) {
    swRegistration.active.postMessage({
      type: 'SHOW_NOTIFICATION',
      title,
      body
    });
    return true;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png'
    });
    return true;
  } catch (e) {
    new Notification(title, { body, icon: '/icon-192.png' });
    return true;
  }
}

function isPushEnabled() {
  return (
    'Notification' in window &&
    Notification.permission === 'granted' &&
    localStorage.getItem('cuenta_conjunta_push_enabled') === 'true'
  );
}

function renderPushStatusUI() {
  const badge = document.getElementById('push-status-badge');
  const toggleBtn = document.getElementById('push-toggle-btn');
  const testBtn = document.getElementById('push-test-btn');
  if (!badge || !toggleBtn) return;

  if (isPushEnabled()) {
    badge.textContent = '🟢 Activadas en este móvil';
    badge.className = 'text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
    toggleBtn.textContent = '🔕 Desactivar notificaciones';
    toggleBtn.className = 'flex-1 py-2.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition';
    if (testBtn) testBtn.classList.remove('hidden');
  } else {
    badge.textContent = '⚪ Desactivadas';
    badge.className = 'text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600';
    toggleBtn.textContent = '🔔 Activar notificaciones';
    toggleBtn.className = 'flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition';
    if (testBtn) testBtn.classList.add('hidden');
  }
}

async function togglePushNotifications() {
  const feedback = document.getElementById('push-feedback');
  feedback.classList.add('hidden');

  if (isPushEnabled()) {
    localStorage.setItem('cuenta_conjunta_push_enabled', 'false');
    renderPushStatusUI();
    feedback.textContent = '🔕 Notificaciones desactivadas en este teléfono.';
    feedback.className = 'text-xs p-2.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-200';
    feedback.classList.remove('hidden');
    return;
  }

  await enablePushNotifications();
}

async function enablePushNotifications() {
  const feedback = document.getElementById('push-feedback');
  feedback.classList.add('hidden');

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (!('Notification' in window)) {
    feedback.textContent = isIOS && !isStandalone
      ? '📲 En iPhone: primero toca el botón Compartir de Safari → "Añadir a pantalla de inicio", abre la app desde su icono nuevo y pulsa aquí.'
      : 'Este navegador no soporta notificaciones Push.';
    feedback.className = 'text-xs p-2.5 rounded-xl bg-amber-50 text-amber-900 border border-amber-200';
    feedback.classList.remove('hidden');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    localStorage.setItem('cuenta_conjunta_push_enabled', 'true');
    renderPushStatusUI();
    feedback.textContent = '✅ Notificaciones activadas en este teléfono para los días 1 y 15.';
    feedback.className = 'text-xs p-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200';
    feedback.classList.remove('hidden');

    await showSystemNotification(
      'Cuenta Conjunta · Avisos activos',
      'Te avisaremos el día 1 y el día 15 si falta añadir ingresos o aportar.'
    );
  } else {
    renderPushStatusUI();
    feedback.textContent = 'Permiso bloqueado en el navegador. Actívalo en los ajustes del navegador.';
    feedback.className = 'text-xs p-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200';
    feedback.classList.remove('hidden');
  }
}

async function sendTestNotification() {
  const feedback = document.getElementById('push-feedback');
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    await enablePushNotifications();
    return;
  }

  const ym = getCurrentYearMonth();
  const s1 = getMemberStats('user1', ym);
  const s2 = getMemberStats('user2', ym);
  const details = getMonthPendingDetails(s1, s2);

  const bodyText = details.hasPending
    ? details.summaryText
    : `¡Todo al día! Ambos habéis anotado vuestros ingresos y completado la aportación de este mes.`;

  await showSystemNotification('🔔 Cuenta Conjunta', bodyText);
  feedback.textContent = '🔔 Notificación enviada a tu teléfono.';
  feedback.className = 'text-xs p-2.5 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-200';
  feedback.classList.remove('hidden');
}

async function checkAutomaticDay1And15Push() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('cuenta_conjunta_push_enabled') !== 'true') return;

  const now = new Date();
  const day = now.getDate();
  const ym = getCurrentYearMonth();

  let period = null;
  if (day >= 1 && day <= 5) period = 'day1';
  if (day >= 15 && day <= 20) period = 'day15';
  if (!period) return;

  const notifiedKey = `notified_${ym}_${period}`;
  if (localStorage.getItem(notifiedKey)) return;

  const s1 = getMemberStats('user1', ym);
  const s2 = getMemberStats('user2', ym);
  const details = getMonthPendingDetails(s1, s2);

  if (details.hasPending) {
    localStorage.setItem(notifiedKey, 'true');
    const title = period === 'day1' ? '📅 Día 1 · Cuenta Conjunta' : '🔔 Día 15 · Cuenta Conjunta';
    await showSystemNotification(title, details.summaryText);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  if (currentSession) {
    showAppScreen();
    pullStateFromSupabase();
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentSession) {
    pullStateFromSupabase();
  }
});
