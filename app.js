// ============================================================================
// CUENTA CONJUNTA · APP MÓVIL Y WEB CON SINCRONIZACIÓN EN SUPABASE
// ============================================================================

const STORAGE_KEY = 'cuenta_conjunta_v2';
const SB_CREDS_KEY = 'cuenta_conjunta_sb_creds';

const DEFAULT_SUPABASE_URL = 'https://kabhcziezseedckgpgwu.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Wn-0AnL3OIEFAzuMTe9aFA_J1AaRnBT';

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
  return `${MONTH_NAMES_ES[idx] || m} ${y}`;
}

function getDefaultState() {
  const ym = getCurrentYearMonth();
  return {
    config: {
      user1Name: 'Yo',
      user2Name: 'Mi Novia',
      jointPercentage: 25
    },
    selectedMonth: ym,
    incomes: [
      { id: 'inc-1', month: ym, owner: 'user1', source: 'Nómina', amount: 2100, collected: true },
      { id: 'inc-2', month: ym, owner: 'user2', source: 'Trabajo 1', amount: 1250, collected: true },
      { id: 'inc-3', month: ym, owner: 'user2', source: 'Trabajo 2', amount: 650, collected: false }
    ],
    contributions: {
      [`${ym}_user1`]: 525,
      [`${ym}_user2`]: 200
    },
    expenses: [
      { id: 'exp-1', name: 'Fibra e Internet', type: 'fixed', baseAmount: 35 },
      { id: 'exp-2', name: 'Suscripciones (Netflix, Spotify...)', type: 'fixed', baseAmount: 25 },
      { id: 'exp-3', name: 'Luz (Electricidad)', type: 'variable', baseAmount: 68 },
      { id: 'exp-4', name: 'Gas (Cada 2 meses)', type: 'periodic', baseAmount: 55 },
      { id: 'exp-5', name: 'Agua (Cada 2-3 meses)', type: 'periodic', baseAmount: 38 }
    ],
    monthlyExpenseOverrides: {
      [`${ym}_exp-4`]: { active: true, amount: 55 },
      [`${ym}_exp-5`]: { active: false, amount: 38 }
    }
  };
}

let state = loadLocalState();
let sbCreds = loadSbCreds();
let supabaseClient = null;
let isSaving = false;

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw);
    return {
      ...getDefaultState(),
      ...parsed,
      config: {
        ...getDefaultState().config,
        ...(parsed.config || {})
      }
    };
  } catch (e) {
    return getDefaultState();
  }
}

function loadSbCreds() {
  try {
    const raw = localStorage.getItem(SB_CREDS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      url: parsed.url || DEFAULT_SUPABASE_URL,
      key: parsed.key || DEFAULT_SUPABASE_ANON_KEY
    };
  } catch (e) {
    return { url: DEFAULT_SUPABASE_URL, key: DEFAULT_SUPABASE_ANON_KEY };
  }
}

function updateSyncIndicator(status, text) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-status-text');
  if (!dot || !label) return;

  if (status === 'cloud') {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0';
    label.textContent = text || 'Sincronizado en la nube';
  } else if (status === 'syncing') {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0';
    label.textContent = text || 'Guardando cambios...';
  } else if (status === 'error') {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0';
    label.textContent = text || 'Error de conexión con Supabase';
  } else {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0';
    label.textContent = text || 'Guardado en este dispositivo';
  }
}

function ensureSupabaseClient() {
  if (!sbCreds.url || !sbCreds.key || !window.supabase) {
    supabaseClient = null;
    updateSyncIndicator('local');
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(sbCreds.url, sbCreds.key);
  }
  return supabaseClient;
}

// Descarga el estado más reciente desde Supabase al abrir la app
async function pullStateFromSupabase() {
  const client = ensureSupabaseClient();
  if (!client || isSaving) return;

  try {
    updateSyncIndicator('syncing', 'Sincronizando...');
    const { data, error } = await client
      .from('couple_state')
      .select('data')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.warn('Supabase aviso:', error.message);
      updateSyncIndicator('error', 'Error al leer de Supabase');
      return;
    }

    if (data && data.data && Object.keys(data.data).length > 0) {
      const currentMonth = state.selectedMonth;
      state = {
        ...getDefaultState(),
        ...data.data,
        config: {
          ...getDefaultState().config,
          ...(data.data.config || {})
        },
        selectedMonth: currentMonth
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderApp();
      updateSyncIndicator('cloud', 'Sincronizado en la nube');
    } else {
      await pushStateToSupabase();
    }
  } catch (err) {
    console.error(err);
    updateSyncIndicator('error');
  }
}

// Sube nuestro estado actual a Supabase inmediatamente
async function pushStateToSupabase() {
  const client = ensureSupabaseClient();
  if (!client) return;

  try {
    isSaving = true;
    updateSyncIndicator('syncing', 'Guardando en la nube...');
    const payload = JSON.parse(JSON.stringify(state));
    const { error } = await client
      .from('couple_state')
      .upsert({ id: 1, data: payload, updated_at: new Date().toISOString() });

    if (error) {
      console.error(error);
      updateSyncIndicator('error', 'Error al guardar en la nube');
    } else {
      updateSyncIndicator('cloud', 'Cambios guardados en la nube');
    }
  } catch (err) {
    console.error(err);
    updateSyncIndicator('error');
  } finally {
    isSaving = false;
  }
}

async function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  await pushStateToSupabase();
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

function getExpenseForMonth(exp, month) {
  const key = `${month}_${exp.id}`;
  const override = state.monthlyExpenseOverrides[key];
  const defaultActive = exp.type !== 'periodic';
  const active = override && typeof override.active === 'boolean' ? override.active : defaultActive;
  const amount = override && override.amount !== undefined ? Number(override.amount) : Number(exp.baseAmount);
  return { active, amount };
}

// ============================================================================
// RENDERIZADO PRINCIPAL
// ============================================================================
function renderApp() {
  const pct = state.config.jointPercentage;
  const month = state.selectedMonth;

  document.getElementById('header-pct-badge').textContent = `${pct}%`;
  document.querySelectorAll('.pct-label').forEach(el => (el.textContent = pct));
  document.getElementById('month-picker').value = month;
  document.getElementById('month-human-label').textContent = `Resumen de ${formatYearMonthES(month)}`;

  const s1 = getMemberStats('user1', month);
  const s2 = getMemberStats('user2', month);

  let totalMonthExpenses = 0;
  let activeExpensesCount = 0;
  state.expenses.forEach(exp => {
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
  if (totalMissing <= 0.01 && totalExpected > 0) {
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

function renderReminderBanner(s1, s2) {
  const banner = document.getElementById('reminder-banner');
  const pendingMessages = [];

  if (s1.remainingTotal > 0.01) {
    pendingMessages.push(
      `<strong>${escapeHtml(state.config.user1Name)}</strong> (${formatEUR(s1.remainingTotal)}` +
        (s1.pendingIncome > 0 ? ` · 1 cobro pendiente` : '') + `)`
    );
  }
  if (s2.remainingTotal > 0.01) {
    pendingMessages.push(
      `<strong>${escapeHtml(state.config.user2Name)}</strong> (${formatEUR(s2.remainingTotal)}` +
        (s2.pendingIncome > 0 ? ` · 1 cobro pendiente` : '') + `)`
    );
  }

  if (pendingMessages.length === 0) {
    banner.classList.add('hidden');
    return;
  }

  banner.className = 'rounded-2xl p-3.5 border bg-amber-50 border-amber-200 text-amber-950 flex items-center gap-2.5 text-xs';
  banner.innerHTML = `
    <span class="text-base shrink-0">🔔</span>
    <div>
      <span class="font-semibold">Pendiente de aportar a la conjunta:</span>
      <span class="ml-1">${pendingMessages.join(' y ')}</span>
    </div>
  `;
  banner.classList.remove('hidden');
}

function renderMemberCard(userKey, name, stats) {
  const pct = state.config.jointPercentage;
  const container = document.getElementById(`member-card-${userKey}`);
  const progressPct = stats.targetTotalShare > 0
    ? Math.min(100, Math.round((stats.alreadyContributed / stats.targetTotalShare) * 100))
    : 0;
  const isComplete = stats.targetTotalShare > 0 && stats.remainingTotal <= 0.01;

  container.innerHTML = `
    <div class="space-y-3.5">
      <div class="flex items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
        <div class="min-w-0">
          <h3 class="font-bold text-slate-900 text-base truncate">👤 ${escapeHtml(name)}</h3>
          <p class="text-xs text-slate-500">Ingresos mes: <strong class="text-slate-700">${formatEUR(stats.totalIncome)}</strong></p>
        </div>
        ${
          isComplete
            ? `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 shrink-0">✅ Al día</span>`
            : `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shrink-0">Faltan ${formatEUR(stats.remainingTotal)}</span>`
        }
      </div>

      <!-- Pagadores / Sueldos -->
      <div class="space-y-2">
        ${
          stats.incomes.length === 0
            ? `<p class="text-xs text-slate-400 italic py-1">Sin sueldos anotados este mes.</p>`
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
                    <input type="number" step="0.01" min="0" value="${inc.amount}"
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
          <input id="inc-src-${userKey}" type="text" required placeholder="Añadir pagador / extra..."
            class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <input id="inc-amt-${userKey}" type="number" step="0.01" min="0" required placeholder="€"
            class="w-20 px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <button type="submit"
            class="px-3 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition shrink-0">
            +
          </button>
        </form>
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

      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        <form onsubmit="handleAddPartialContribution(event, '${userKey}')" class="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <input id="partial-input-${userKey}" type="number" step="0.01" placeholder="Aportar € parcial..."
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
      </div>
    </div>
  `;
}

function renderExpensesList() {
  const listEl = document.getElementById('expenses-list');
  const month = state.selectedMonth;

  if (state.expenses.length === 0) {
    listEl.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">Añade vuestros gastos comunes abajo.</div>`;
    return;
  }

  const badgeByType = {
    fixed: `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">📌 Fijo</span>`,
    variable: `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">⚡ Variable</span>`,
    periodic: `<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-purple-50 text-purple-700">🗓️ 2-3 meses</span>`
  };

  listEl.innerHTML = state.expenses
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
  const existingInNewMonth = state.incomes.filter(i => i.month === newMonth);
  if (existingInNewMonth.length === 0) {
    const prevIncomes = state.incomes.filter(i => i.month === state.selectedMonth);
    prevIncomes.forEach((inc, idx) => {
      state.incomes.push({
        id: `inc-${Date.now()}-${idx}`,
        month: newMonth,
        owner: inc.owner,
        source: inc.source,
        amount: inc.amount,
        collected: true
      });
    });
  }
  state.selectedMonth = newMonth;
  renderApp();
  saveState();
}

function handleAddIncome(e, userKey) {
  e.preventDefault();
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
  if (!item) return;
  item.amount = parseFloat(newVal) || 0;
  renderApp();
  saveState();
}

function toggleIncomeCollected(id) {
  const item = state.incomes.find(i => i.id === id);
  if (!item) return;
  item.collected = !item.collected;
  renderApp();
  saveState();
}

function deleteIncome(id) {
  state.incomes = state.incomes.filter(i => i.id !== id);
  renderApp();
  saveState();
}

function handleAddPartialContribution(e, userKey) {
  e.preventDefault();
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
  const key = `${state.selectedMonth}_${userKey}`;
  state.contributions[key] = Math.round(targetAmount * 100) / 100;
  renderApp();
  saveState();
}

function resetContribution(userKey) {
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

  const newExp = {
    id: 'exp-' + Date.now(),
    name: nameEl.value.trim(),
    type: typeEl.value,
    baseAmount: parseFloat(amtEl.value) || 0
  };

  state.expenses.push(newExp);
  if (newExp.type === 'periodic') {
    state.monthlyExpenseOverrides[`${state.selectedMonth}_${newExp.id}`] = {
      active: true,
      amount: newExp.baseAmount
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

  if (exp.type === 'fixed') {
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

function openSettingsModal() {
  document.getElementById('set-user1-name').value = state.config.user1Name;
  document.getElementById('set-user2-name').value = state.config.user2Name;
  document.getElementById('set-joint-pct').value = state.config.jointPercentage;
  document.getElementById('set-sb-url').value = sbCreds.url || '';
  document.getElementById('set-sb-key').value = sbCreds.key || '';
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings(e) {
  e.preventDefault();
  state.config.user1Name = document.getElementById('set-user1-name').value.trim() || 'Persona 1';
  state.config.user2Name = document.getElementById('set-user2-name').value.trim() || 'Persona 2';
  state.config.jointPercentage = Number(document.getElementById('set-joint-pct').value) || 25;

  const newUrl = document.getElementById('set-sb-url').value.trim() || DEFAULT_SUPABASE_URL;
  const newKey = document.getElementById('set-sb-key').value.trim() || DEFAULT_SUPABASE_ANON_KEY;
  const credsChanged = newUrl !== sbCreds.url || newKey !== sbCreds.key;

  sbCreds = { url: newUrl, key: newKey };
  localStorage.setItem(SB_CREDS_KEY, JSON.stringify(sbCreds));
  if (credsChanged) {
    supabaseClient = null;
    ensureSupabaseClient();
  }

  closeSettingsModal();
  renderApp();
  await saveState();
}

async function resetDemoData() {
  localStorage.removeItem(STORAGE_KEY);
  state = getDefaultState();
  closeSettingsModal();
  renderApp();
  await saveState();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  renderApp();
  pullStateFromSupabase();
});

// Al volver a abrir la pestaña en el móvil, sincroniza con la nube
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    pullStateFromSupabase();
  }
});
