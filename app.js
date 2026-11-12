// ============================================================================
// CUENTA CONJUNTA · AUTENTICACIÓN POR ROLES + SINCRONIZACIÓN SEGURA SUPABASE
// ============================================================================

const STORAGE_KEY = 'cuenta_conjunta_clean_v3';
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

// Estado inicial 100% vacío de datos inventados
function getEmptyState() {
  return {
    config: {
      user1Name: 'Miguel',
      user2Name: 'Ana',
      jointPercentage: 25
    },
    selectedMonth: getCurrentYearMonth(),
    incomes: [],
    contributions: {},
    expenses: [],
    monthlyExpenseOverrides: {}
  };
}

let state = getEmptyState();
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

// Comprueba si el usuario conectado tiene permiso para editar la tarjeta de 'user1' o 'user2'
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
    label.textContent = text || 'Guardando...';
  } else if (status === 'error') {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0';
    label.textContent = text || 'Error de red';
  }
}

// ============================================================================
// AUTENTICACIÓN Y COMUNICACIÓN CON SUPABASE RPC
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

    // Notificar al gestor de contraseñas / biometría del teléfono (Android / iOS)
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
    expenses: Array.isArray(remoteData && remoteData.expenses) ? remoteData.expenses : [],
    contributions: (remoteData && remoteData.contributions) || {},
    monthlyExpenseOverrides: (remoteData && remoteData.monthlyExpenseOverrides) || {},
    selectedMonth: currentMonth
  };
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
      // Si la contraseña cambió o expiró, volvemos al login
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
      updateSyncIndicator('cloud', 'Guardado en la nube');
    }
  } catch (err) {
    console.error(err);
    updateSyncIndicator('error');
  } finally {
    isSaving = false;
  }
}

function formatEUR(val) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(val) || 0);
}

// ============================================================================
// CÁLCULOS DE CADA MIEMBRO EN EL MES SELECCIONADO
// ============================================================================
function getMemberStats(userKey, month) {
  const pct = (Number(state.config.jointPercentage) || 25) / 100;
  const userIncomes = state.incomes.filter(i => i.owner === userKey && i.month === month);

  let totalIncome = 0;
  let collectedIncome = 0;
  let pendingIncome = 0;

  userIncomes.forEach(inc => {
    const amt = Number(inc.amount) || 0;
    totalIncome += amt;
    if (inc.collected) {
      collectedIncome += amt;
    } else {
      pendingIncome += amt;
    }
  });

  const targetTotalShare = Math.round(totalIncome * pct * 100) / 100;
  const targetCollectedShare = Math.round(collectedIncome * pct * 100) / 100;
  const alreadyContributed = Number(state.contributions[`${month}_${userKey}`]) || 0;
  const remainingTotal = Math.max(0, Math.round((targetTotalShare - alreadyContributed) * 100) / 100);

  return {
    incomes: userIncomes,
    totalIncome,
    collectedIncome,
    pendingIncome,
    targetTotalShare,
    targetCollectedShare,
    alreadyContributed,
    remainingTotal
  };
}

function getVisibleExpensesForMonth(month) {
  return state.expenses.filter(exp => {
    if (exp.type === 'oneoff') {
      return exp.createdMonth === month;
    }
    return true;
  });
}

function getExpenseForMonth(exp, month) {
  const key = `${month}_${exp.id}`;
  const override = state.monthlyExpenseOverrides[key];

  if (exp.type === 'fixed') {
    return { active: true, amount: Number(exp.baseAmount) || 0 };
  }

  if (exp.type === 'variable') {
    // En gastos variables, el resto de meses queda a 0 € hasta que se introduzca el valor de ese mes
    const amt = override && override.amount !== undefined ? Number(override.amount) : 0;
    return { active: true, amount: amt };
  }

  if (exp.type === 'periodic') {
    // Ocasional: desmarcado por defecto salvo los meses en que se active
    const active = override && typeof override.active === 'boolean' ? override.active : false;
    const amt = override && override.amount !== undefined ? Number(override.amount) : Number(exp.baseAmount) || 0;
    return { active, amount: amt };
  }

  if (exp.type === 'oneoff') {
    // Puntual: solo existe en el mes en que se creó
    const isThisMonth = exp.createdMonth === month;
    const amt = override && override.amount !== undefined ? Number(override.amount) : Number(exp.baseAmount) || 0;
    return { active: isThisMonth, amount: isThisMonth ? amt : 0 };
  }

  return { active: true, amount: Number(exp.baseAmount) || 0 };
}

// ============================================================================
// RENDERIZADO PRINCIPAL
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
  document.getElementById('month-human-label').textContent = `Resumen de ${formatYearMonthES(month)}`;

  // Etiqueta del usuario que ha iniciado sesión
  const roleLabel =
    currentSession.role === 'admin'
      ? '🛡️ Admin (Acceso total)'
      : currentSession.role === 'user1'
      ? state.config.user1Name
      : state.config.user2Name;
  document.getElementById('logged-user-badge').textContent = roleLabel;

  const s1 = getMemberStats('user1', month);
  const s2 = getMemberStats('user2', month);

  let totalMonthExpenses = 0;
  let activeExpensesCount = 0;
  const visibleExpenses = getVisibleExpensesForMonth(month);
  visibleExpenses.forEach(exp => {
    const mExp = getExpenseForMonth(exp, month);
    if (mExp.active) {
      totalMonthExpenses += mExp.amount;
      activeExpensesCount++;
    }
  });

  const totalTransferred = s1.alreadyContributed + s2.alreadyContributed;
  const totalExpected = s1.targetTotalShare + s2.targetTotalShare;
  const totalMissing = s1.remainingTotal + s2.remainingTotal;
  const netResult = totalExpected - totalMonthExpenses;

  document.getElementById('global-transferred').textContent = formatEUR(totalTransferred);
  document.getElementById('global-expected').textContent = `aportados de ${formatEUR(totalExpected)}`;

  const pill = document.getElementById('global-status-pill');
  if (totalExpected === 0 && totalTransferred === 0) {
    pill.textContent = 'Sin ingresos aún';
    pill.className = 'inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300';
  } else if (totalMissing <= 0.01) {
    pill.textContent = '✅ Todo aportado';
    pill.className = 'inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-400/20 text-emerald-300';
  } else {
    pill.textContent = `Faltan ${formatEUR(totalMissing)}`;
    pill.className = 'inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-400/20 text-amber-300';
  }

  document.getElementById('global-expenses').textContent = `-${formatEUR(totalMonthExpenses)}`;
  document.getElementById('global-expenses-count').textContent = `${activeExpensesCount} recibos activos`;

  const netEl = document.getElementById('global-net');
  const netSub = document.getElementById('global-net-sub');
  netEl.textContent = formatEUR(netResult);
  if (netResult >= 0) {
    netEl.className = 'text-base sm:text-lg font-bold text-emerald-400 mt-0.5';
    netSub.textContent = 'Colchón previsto este mes';
  } else {
    netEl.className = 'text-base sm:text-lg font-bold text-rose-400 mt-0.5';
    netSub.textContent = 'Falta para cubrir recibos';
  }

  renderReminderBanner(s1, s2);
  renderMemberCard('user1', state.config.user1Name, s1);
  renderMemberCard('user2', state.config.user2Name, s2);
  renderExpensesList();
}

function getMonthPendingDetails(s1, s2) {
  const missingIncomes = [];
  const missingContributions = [];

  if (s1.totalIncome <= 0) {
    missingIncomes.push(state.config.user1Name);
  } else if (s1.remainingTotal > 0.01) {
    missingContributions.push(
      `${state.config.user1Name} (${formatEUR(s1.remainingTotal)}${s1.pendingIncome > 0 ? ' · cobro pendiente' : ''})`
    );
  }

  if (s2.totalIncome <= 0) {
    missingIncomes.push(state.config.user2Name);
  } else if (s2.remainingTotal > 0.01) {
    missingContributions.push(
      `${state.config.user2Name} (${formatEUR(s2.remainingTotal)}${s2.pendingIncome > 0 ? ' · cobro pendiente' : ''})`
    );
  }

  const hasPending = missingIncomes.length > 0 || missingContributions.length > 0;
  const parts = [];
  if (missingIncomes.length > 0) {
    parts.push(`Falta añadir ingresos de ${missingIncomes.join(' y ')}`);
  }
  if (missingContributions.length > 0) {
    parts.push(`Falta aportar: ${missingContributions.join(' y ')}`);
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
      <span class="font-semibold">Pendiente este mes:</span>
      <span class="ml-1">${escapeHtml(details.summaryText)}</span>
    </div>
  `;
  banner.classList.remove('hidden');
}

// ============================================================================
// TARJETA DE MIEMBRO (EDITABLE SI ES TU USUARIO O ADMIN / SOLO LECTURA SI ES EL OTRO)
// ============================================================================
function renderMemberCard(userKey, name, stats) {
  const pct = state.config.jointPercentage;
  const editable = canEditMember(userKey);
  const container = document.getElementById(`member-card-${userKey}`);
  const progressPct = stats.targetTotalShare > 0
    ? Math.min(100, Math.round((stats.alreadyContributed / stats.targetTotalShare) * 100))
    : 0;
  const isComplete = stats.targetTotalShare > 0 && stats.remainingTotal <= 0.01;

  container.innerHTML = `
    <div class="space-y-3.5">
      <div class="flex items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <h3 class="font-bold text-slate-900 text-base truncate">👤 ${escapeHtml(name)}</h3>
            ${
              !editable
                ? `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 shrink-0">🔒 Solo lectura</span>`
                : ''
            }
          </div>
          <p class="text-xs text-slate-500">Ingresos mes: <strong class="text-slate-700">${formatEUR(stats.totalIncome)}</strong></p>
        </div>
        ${
          stats.targetTotalShare === 0
            ? `<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 shrink-0">0,00 €</span>`
            : isComplete
            ? `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 shrink-0">✅ Al día</span>`
            : `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shrink-0">Faltan ${formatEUR(stats.remainingTotal)}</span>`
        }
      </div>

      <!-- Pagadores / Sueldos -->
      <div class="space-y-2">
        ${
          stats.incomes.length === 0
            ? `<p class="text-xs text-slate-400 italic py-1">Sin ingresos anotados este mes.</p>`
            : stats.incomes
                .map(inc => {
                  if (editable) {
                    return `
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
                          <input type="number" step="0.01" min="0" value="${inc.amount}"
                            onchange="updateIncomeAmount('${inc.id}', this.value)"
                            class="w-20 text-right font-bold text-slate-900 bg-white px-2 py-1 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900" />
                          <span class="text-slate-500 font-semibold">€</span>
                          <button type="button" onclick="deleteIncome('${inc.id}')" class="p-1 text-slate-300 hover:text-rose-600">✕</button>
                        </div>
                      </div>
                    `;
                  } else {
                    return `
                      <div class="flex items-center justify-between gap-2 bg-slate-50/70 px-3 py-2 rounded-xl border border-slate-100 text-xs">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="px-2 py-0.5 rounded-md font-medium ${
                            inc.collected ? 'bg-emerald-100/70 text-emerald-800' : 'bg-amber-100/70 text-amber-800'
                          }">
                            ${inc.collected ? 'Cobrado' : '⏳ Pendiente'}
                          </span>
                          <span class="font-medium text-slate-700 truncate">${escapeHtml(inc.source)}</span>
                        </div>
                        <span class="font-bold text-slate-900 shrink-0">${formatEUR(inc.amount)}</span>
                      </div>
                    `;
                  }
                })
                .join('')
        }

        ${
          editable
            ? `<form onsubmit="handleAddIncome(event, '${userKey}')" class="flex gap-1.5 pt-1">
                <input id="inc-src-${userKey}" type="text" required placeholder="Añadir pagador / sueldo..."
                  class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <input id="inc-amt-${userKey}" type="number" step="0.01" min="0" required placeholder="€"
                  class="w-20 px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <button type="submit"
                  class="px-3 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition shrink-0">
                  +
                </button>
              </form>`
            : ''
        }
      </div>
    </div>

    <!-- Aportación parcial / total -->
    <div class="pt-3 border-t border-slate-100 space-y-2.5">
      <div class="flex items-center justify-between text-xs">
        <span class="text-slate-500">Le toca (${pct}%): <strong class="text-slate-900">${formatEUR(stats.targetTotalShare)}</strong></span>
        <span class="font-semibold text-indigo-600">Ya aportado: ${formatEUR(stats.alreadyContributed)}</span>
      </div>

      <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full ${isComplete ? 'bg-emerald-500' : 'bg-indigo-600'} transition-all" style="width: ${progressPct}%"></div>
      </div>

      ${
        stats.pendingIncome > 0
          ? `<p class="text-[11px] text-amber-700">
              💡 De lo ya cobrado hoy le toca aportar <strong>${formatEUR(stats.targetCollectedShare)}</strong>.
             </p>`
          : ''
      }

      ${
        editable
          ? `<div class="flex flex-wrap items-center gap-1.5 pt-1">
              <form onsubmit="handleAddPartialContribution(event, '${userKey}')" class="flex items-center gap-1.5 flex-1 min-w-[140px]">
                <input id="partial-input-${userKey}" type="number" step="0.01" placeholder="Importe €"
                  class="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-600" />
                <button type="submit"
                  class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold rounded-xl text-xs transition shrink-0">
                  + Sumar
                </button>
              </form>

              ${
                !isComplete && stats.targetTotalShare > 0
                  ? `<button type="button" onclick="completeContribution('${userKey}', ${stats.targetTotalShare})"
                      class="px-3 py-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-semibold rounded-xl text-xs transition shrink-0">
                      Completar
                     </button>`
                  : ''
              }

              ${
                stats.alreadyContributed > 0
                  ? `<button type="button" onclick="resetContribution('${userKey}')" title="Poner aportación a 0 €"
                      class="px-2.5 py-2 border border-slate-200 hover:bg-slate-100 text-slate-500 rounded-xl text-xs transition shrink-0">
                      0 €
                     </button>`
                  : ''
              }
            </div>`
          : ''
      }
    </div>
  `;
}

function renderExpensesList() {
  const listEl = document.getElementById('expenses-list');
  const month = state.selectedMonth;
  const visibleExpenses = getVisibleExpensesForMonth(month);

  if (visibleExpenses.length === 0) {
    listEl.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">Aún no hay recibos o gastos en este mes. Añádelos aquí abajo.</div>`;
    return;
  }

  const badgeByType = {
    fixed: `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">📌 Fijo</span>`,
    variable: `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">⚡ Variable</span>`,
    periodic: `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-purple-50 text-purple-700">🗓️ Ocasional</span>`,
    oneoff: `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800">🛒 Puntual</span>`
  };

  listEl.innerHTML = visibleExpenses
    .map(exp => {
      const mExp = getExpenseForMonth(exp, month);

      return `
        <div class="p-3.5 sm:px-5 flex items-center justify-between gap-2 ${
          mExp.active ? 'bg-white' : 'bg-slate-50/70 opacity-60'
        } transition">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-semibold text-slate-900 text-sm truncate ${!mExp.active ? 'line-through text-slate-400' : ''}">
                ${escapeHtml(exp.name)}
              </span>
              ${badgeByType[exp.type] || ''}
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            ${
              exp.type === 'periodic'
                ? `<button type="button" onclick="toggleExpenseActive('${exp.id}')"
                    class="px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition ${
                      mExp.active
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-white border-slate-200 text-slate-600'
                    }">
                    ${mExp.active ? '✓ Toca' : 'No toca'}
                   </button>`
                : ''
            }

            ${
              mExp.active
                ? `<div class="flex items-center gap-1">
                    <input type="number" step="0.01" min="0" value="${mExp.amount}"
                      onchange="updateExpenseMonthAmount('${exp.id}', this.value)"
                      class="w-20 text-right font-bold text-slate-900 text-sm px-2 py-1.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    <span class="text-xs font-semibold text-slate-500">€</span>
                   </div>`
                : `<span class="text-xs font-medium text-slate-400 px-1">0,00 €</span>`
            }

            <button type="button" onclick="deleteExpense('${exp.id}')" title="Borrar gasto"
              class="p-1 text-slate-300 hover:text-rose-600 text-sm">
              ✕
            </button>
          </div>
        </div>
      `;
    })
    .join('');
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
    amount: parseFloat(amtInput.value) || 0,
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
  item.amount = parseFloat(newVal) || 0;
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

function handleAddPartialContribution(e, userKey) {
  e.preventDefault();
  if (!canEditMember(userKey)) return;

  const input = document.getElementById(`partial-input-${userKey}`);
  const amountToAdd = parseFloat(input.value);
  if (!amountToAdd || amountToAdd <= 0) return;

  const key = `${state.selectedMonth}_${userKey}`;
  const current = Number(state.contributions[key]) || 0;
  state.contributions[key] = Math.round((current + amountToAdd) * 100) / 100;

  input.value = '';
  renderApp();
  saveState();
}

function completeContribution(userKey, targetAmount) {
  if (!canEditMember(userKey)) return;
  const key = `${state.selectedMonth}_${userKey}`;
  state.contributions[key] = Math.round(targetAmount * 100) / 100;
  renderApp();
  saveState();
}

function resetContribution(userKey) {
  if (!canEditMember(userKey)) return;
  const key = `${state.selectedMonth}_${userKey}`;
  state.contributions[key] = 0;
  renderApp();
  saveState();
}

function handleAddExpense(e) {
  e.preventDefault();
  const nameEl = document.getElementById('exp-name');
  const typeEl = document.getElementById('exp-type');
  const amtEl = document.getElementById('exp-amount');
  const enteredAmount = parseFloat(amtEl.value) || 0;

  const newExp = {
    id: 'exp-' + Date.now(),
    name: nameEl.value.trim(),
    type: typeEl.value,
    baseAmount: typeEl.value === 'variable' ? 0 : enteredAmount,
    createdMonth: state.selectedMonth
  };

  state.expenses.push(newExp);

  // Para Variable, Ocasional y Puntual guardamos el importe en el mes actual
  if (newExp.type === 'variable' || newExp.type === 'periodic' || newExp.type === 'oneoff') {
    state.monthlyExpenseOverrides[`${state.selectedMonth}_${newExp.id}`] = {
      active: true,
      amount: enteredAmount
    };
  }

  nameEl.value = '';
  amtEl.value = '';
  renderApp();
  saveState();
}

function toggleExpenseActive(expId) {
  const exp = state.expenses.find(x => x.id === expId);
  if (!exp) return;
  const current = getExpenseForMonth(exp, state.selectedMonth);
  const key = `${state.selectedMonth}_${expId}`;
  state.monthlyExpenseOverrides[key] = {
    active: !current.active,
    amount: current.amount
  };
  renderApp();
  saveState();
}

function updateExpenseMonthAmount(expId, newVal) {
  const exp = state.expenses.find(x => x.id === expId);
  if (!exp) return;
  const parsed = parseFloat(newVal) || 0;
  const current = getExpenseForMonth(exp, state.selectedMonth);
  const key = `${state.selectedMonth}_${expId}`;

  if (exp.type === 'fixed' || exp.type === 'oneoff') {
    exp.baseAmount = parsed;
  }

  state.monthlyExpenseOverrides[key] = {
    active: current.active,
    amount: parsed
  };
  renderApp();
  saveState();
}

function deleteExpense(expId) {
  state.expenses = state.expenses.filter(x => x.id !== expId);
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

    // Si el usuario cambió su propia contraseña, actualizamos su sesión activa
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
// PWA INSTALABLE (ANDROID & iOS) Y NOTIFICACIONES WEB PUSH (DÍA 1 Y DÍA 15)
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

  // Si ya están activadas, las desactivamos con un toque
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
      'Te avisaremos el día 1 y el día 15 si queda alguna aportación pendiente.'
    );
  } else {
    renderPushStatusUI();
    feedback.textContent = 'Permiso bloqueado en el navegador. Actívalo en el candado de la barra de direcciones.';
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

// Comprueba automáticamente el día 1 (del 1 al 5) y el día 15 (del 15 al 20) si falta añadir ingresos o aportar
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
    pullStateFromSupabase();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentSession) {
    pullStateFromSupabase();
  }
});
