// ============================================================================
// CUENTA CONJUNTA · APP MÓVIL Y WEB CON SINCRONIZACIÓN EN SUPABASE
// ============================================================================

const STORAGE_KEY = 'cuenta_conjunta_v2';
const SB_CREDS_KEY = 'cuenta_conjunta_sb_creds';

// Si quieres que la web ya tenga las claves conectadas por defecto en todos los móviles
// sin pegarlas en Ajustes, ponlas aquí entre las comillas:
const DEFAULT_SUPABASE_URL = 'https://kabhcziezseedckgpgwu.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Wn-0AnL3OIEFAzuMTe9aFA_J1AaRnBT';

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    return { ...getDefaultState(), ...JSON.parse(raw) };
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
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500 shrink-0';
    label.textContent = text || 'Sincronizado en Supabase';
  } else if (status === 'syncing') {
    dot.className = 'w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0';
    label.textContent = text || 'Guardando en la nube...';
  } else if (status === 'error') {
    dot.className = 'w-2 h-2 rounded-full bg-rose-500 shrink-0';
    label.textContent = text || 'Error de conexión con Supabase';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-amber-400 shrink-0';
    label.textContent = text || 'Modo local · Conecta Supabase en ⚙️';
  }
}

async function initSupabaseAndSync() {
  if (!sbCreds.url || !sbCreds.key || !window.supabase) {
    supabaseClient = null;
    updateSyncIndicator('local');
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(sbCreds.url, sbCreds.key);
    updateSyncIndicator('syncing', 'Conectando con Supabase...');

    const { data, error } = await supabaseClient
      .from('couple_state')
      .select('data')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.warn('Supabase aviso:', error.message);
      updateSyncIndicator('error', 'Falta crear tabla en Supabase');
      return;
    }

    if (data && data.data && Object.keys(data.data).length > 0) {
      const currentMonth = state.selectedMonth;
      state = { ...getDefaultState(), ...data.data, selectedMonth: currentMonth };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderApp();
      updateSyncIndicator('cloud', 'Sincronizado en la nube');
    } else {
      // Subir nuestro estado inicial a la nube por primera vez
      await pushStateToSupabase();
    }
  } catch (err) {
    console.error(err);
    updateSyncIndicator('error');
  }
}

async function pushStateToSupabase() {
  if (!supabaseClient) return;
  try {
    updateSyncIndicator('syncing', 'Guardando...');
    const payload = { ...state };
    const { error } = await supabaseClient
      .from('couple_state')
      .upsert({ id: 1, data: payload, updated_at: new Date().toISOString() });

    if (error) {
      console.error(error);
      updateSyncIndicator('error', 'Error al guardar en Supabase');
    } else {
      updateSyncIndicator('cloud', 'Sincronizado en la nube');
    }
  } catch (err) {
    console.error(err);
    updateSyncIndicator('error');
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  pushStateToSupabase();
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

  const targetTotalShare = totalIncome * pct;
  const targetCollectedShare = collectedIncome * pct;
  const alreadyContributed = Number(state.contributions[`${month}_${userKey}`]) || 0;
  const remainingTotal = Math.max(0, targetTotalShare - alreadyContributed);

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
// RENDERIZADO PRINCIPAL (DISEÑO MÓVIL Y ESCRITORIO)
// ============================================================================
function renderApp() {
  const pct = state.config.jointPercentage;
  const month = state.selectedMonth;

  document.getElementById('header-pct-badge').textContent = `${pct}%`;
  document.querySelectorAll('.pct-label').forEach(el => (el.textContent = pct));
  document.getElementById('month-picker').value = month;

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
  document.getElementById('global-expected').textContent = `de ${formatEUR(totalExpected)}`;

  const pill = document.getElementById('global-status-pill');
  if (totalMissing <= 0.01 && totalExpected > 0) {
    pill.textContent = '✅ Todo aportado';
    pill.className = 'inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-400/20 text-emerald-300';
  } else {
    pill.textContent = `Faltan ${formatEUR(totalMissing)}`;
    pill.className = 'inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-400/20 text-amber-300';
  }

  document.getElementById('global-expenses').textContent = `-${formatEUR(totalMonthExpenses)}`;
  document.getElementById('global-expenses-count').textContent = `${activeExpensesCount} recibos este mes`;

  const netEl = document.getElementById('global-net');
  const netSub = document.getElementById('global-net-sub');
  netEl.textContent = formatEUR(netResult);
  if (netResult >= 0) {
    netEl.className = 'text-base sm:text-lg font-bold text-emerald-400 mt-0.5';
    netSub.textContent = 'Sobra de colchón';
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
      `<strong>${escapeHtml(state.config.user1Name)}</strong> (${formatEUR(s1.remainingTotal)})`
    );
  }
  if (s2.remainingTotal > 0.01) {
    pendingMessages.push(
      `<strong>${escapeHtml(state.config.user2Name)}</strong> (${formatEUR(s2.remainingTotal)}` +
        (s2.pendingIncome > 0 ? ` · 1 sueldo pendiente` : '') + `)`
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
      <span class="font-semibold">Pendiente de aportar:</span>
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
      <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div>
          <h3 class="font-bold text-slate-900 text-base">👤 ${escapeHtml(name)}</h3>
          <p class="text-xs text-slate-500">Ingresos mes: <strong class="text-slate-700">${formatEUR(stats.totalIncome)}</strong></p>
        </div>
        ${
          isComplete
            ? `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">✅ Al día</span>`
            : `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Faltan ${formatEUR(stats.remainingTotal)}</span>`
        }
      </div>

      <!-- Pagadores -->
      <div class="space-y-2">
        ${
          stats.incomes.length === 0
            ? `<p class="text-xs text-slate-400 italic py-1">Sin sueldos anotados este mes.</p>`
            : stats.incomes
                .map(
                  inc => `
                <div class="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 text-xs">
                  <div class="flex items-center gap-2 min-w-0">
                    <button onclick="toggleIncomeCollected('${inc.id}')"
                      class="px-2 py-1 rounded-lg font-medium shrink-0 transition ${
                        inc.collected
                          ? 'bg-emerald-100 text-emerald-800 active:bg-emerald-200'
                          : 'bg-amber-100 text-amber-800 active:bg-amber-200'
                      }">
                      ${inc.collected ? 'Cobrado' : '⏳ Pendiente'}
                    </button>
                    <span class="font-medium text-slate-800 truncate">${escapeHtml(inc.source)}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="font-bold text-slate-900">${formatEUR(inc.amount)}</span>
                    <button onclick="deleteIncome('${inc.id}')" class="p-1 text-slate-300 hover:text-rose-600">✕</button>
                  </div>
                </div>
              `
                )
                .join('')
        }

        <form onsubmit="handleAddIncome(event, '${userKey}')" class="flex gap-1.5 pt-1">
          <input id="inc-src-${userKey}" type="text" required placeholder="Añadir sueldo..."
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
        <span class="text-slate-500">Toca (${pct}%): <strong class="text-slate-900">${formatEUR(stats.targetTotalShare)}</strong></span>
        <span class="font-semibold text-indigo-600">Aportado: ${formatEUR(stats.alreadyContributed)}</span>
      </div>

      <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full ${isComplete ? 'bg-emerald-500' : 'bg-indigo-600'} transition-all" style="width: ${progressPct}%"></div>
      </div>

      ${
        stats.pendingIncome > 0
          ? `<p class="text-[11px] text-amber-700">
              💡 De lo ya cobrado le toca aportar <strong>${formatEUR(stats.targetCollectedShare)}</strong>.
             </p>`
          : ''
      }

      <div class="flex items-center gap-1.5 pt-1">
        <form onsubmit="handleAddPartialContribution(event, '${userKey}')" class="flex items-center gap-1.5 flex-1">
          <input id="partial-input-${userKey}" type="number" step="0.01" placeholder="Aportar €..."
            class="w-full min-w-[90px] px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-600" />
          <button type="submit"
            class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold rounded-xl text-xs transition shrink-0">
            + Sumar
          </button>
        </form>

        ${
          !isComplete && stats.targetTotalShare > 0
            ? `<button onclick="completeContribution('${userKey}', ${stats.targetTotalShare})"
                class="px-3 py-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-semibold rounded-xl text-xs transition shrink-0">
                Completar
               </button>`
            : `<button onclick="resetContribution('${userKey}')"
                class="px-2.5 py-2 border border-slate-200 hover:bg-slate-100 text-slate-500 rounded-xl text-xs transition shrink-0">
                0 €
               </button>`
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
                ? `<button onclick="toggleExpenseActive('${exp.id}')"
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
                : `<span class="text-xs font-medium text-slate-400 px-1">0 €</span>`
            }

            <button onclick="deleteExpense('${exp.id}')" title="Borrar gasto"
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
  saveState();
  renderApp();
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
  saveState();
  renderApp();
}

function toggleIncomeCollected(id) {
  const item = state.incomes.find(i => i.id === id);
  if (!item) return;
  item.collected = !item.collected;
  saveState();
  renderApp();
}

function deleteIncome(id) {
  state.incomes = state.incomes.filter(i => i.id !== id);
  saveState();
  renderApp();
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
  saveState();
  renderApp();
}

function completeContribution(userKey, targetAmount) {
  const key = `${state.selectedMonth}_${userKey}`;
  state.contributions[key] = Math.round(targetAmount * 100) / 100;
  saveState();
  renderApp();
}

function resetContribution(userKey) {
  const key = `${state.selectedMonth}_${userKey}`;
  state.contributions[key] = 0;
  saveState();
  renderApp();
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
  saveState();
  renderApp();
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
  saveState();
  renderApp();
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
  saveState();
  renderApp();
}

function deleteExpense(expId) {
  state.expenses = state.expenses.filter(x => x.id !== expId);
  saveState();
  renderApp();
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

  sbCreds = {
    url: document.getElementById('set-sb-url').value.trim(),
    key: document.getElementById('set-sb-key').value.trim()
  };
  localStorage.setItem(SB_CREDS_KEY, JSON.stringify(sbCreds));

  closeSettingsModal();
  renderApp();
  await initSupabaseAndSync();
  saveState();
}

function resetDemoData() {
  localStorage.removeItem(STORAGE_KEY);
  state = getDefaultState();
  saveState();
  closeSettingsModal();
  renderApp();
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
  initSupabaseAndSync();
});
