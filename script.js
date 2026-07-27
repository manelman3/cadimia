/* ==========================================================================
   GYM — Rastreador de Exercícios com Sessões (Treinos) e Progresso por Séries
   Aplicação 100% client-side. Nenhum backend é necessário: tudo é
   persistido no localStorage do navegador.

   Modelo de dados:

   session: { id, name, notes, createdAt }

   exercise: {
     id, name, category, time, points, totalSets, notes, createdAt,
     sessionIds: [sessionId, ...]           // um exercício pode pertencer
                                             // a várias sessões (treinos)
     sets: [ null | 'YYYY-MM-DD', ... ],    // null = série pendente,
                                             // data = série concluída naquele dia
     bankedPoints: number                   // pontos "guardados" de treinos
                                             // já concluídos (ver item 11b)
   }

   history entry: { id, exerciseId, date: 'YYYY-MM-DD', points }
                                             // registro de pontos guardados ao
                                             // concluir um treino, usado só
                                             // para calcular "pontos hoje"
                                             // depois que as séries já
                                             // foram reiniciadas.

   Pontuação é sempre CALCULADA a partir do progresso (nunca acumulada à
   parte "do nada"). A pontuação total de um exercício é sempre
   bankedPoints + progresso atual das séries. Isso garante que marcar/
   desmarcar uma série, concluir um treino, ou excluir um exercício/sessão
   inteira, atualiza a pontuação total automaticamente e sem deixar dados
   órfãos.

   Navegação:
   - HOME: lista de sessões (treinos) que o usuário criou.
   - SESSÃO: ao clicar numa sessão, mostra somente os exercícios daquela
     sessão, com filtro por categoria muscular dentro dela.

   Índice:
   1. Constantes e configuração
   2. Estado da aplicação
   3. Persistência (localStorage) + migração de dados antigos
   4. Utilitários de data
   5. Cálculo de progresso e pontuação
   6. Navegação entre HOME e SESSÃO
   7. Renderização — HOME (sessões)
   8. Renderização — SESSÃO (exercícios)
   9. CRUD de sessões (modal)
   10. CRUD de exercícios (modal)
   11. Marcação de séries
   11b. Conclusão de treino (bancar pontos e reiniciar séries)
   12. Toasts e confirmação
   13. Inicialização e listeners
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. CONSTANTES
   -------------------------------------------------------------------------- */

const STORAGE_KEY = 'gym_state_v1';

const ICONS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  points: '<circle cx="12" cy="12" r="9"/><path d="M9 12.8l2 2 4-4.6"/>',
  muscle: '<path d="M6.5 6.5c-1.5 0-2.5 1.2-2.5 2.6 0 1 .5 1.7 1 2.4-.7.5-1 1.2-1 2 0 1.5 1.2 2.7 2.7 2.7.5 1.7 2 3 3.9 3H14c2.8 0 5-2.2 5-5v-2c0-3.3-2.7-6-6-6H9.7c-1 0-2 .3-2.8.9"/>',
  dumbbell: '<line x1="4" y1="12" x2="20" y2="12"/><line x1="6" y1="7" x2="6" y2="17"/><line x1="18" y1="7" x2="18" y2="17"/><line x1="2" y1="9" x2="2" y2="15"/><line x1="22" y1="9" x2="22" y2="15"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
};

// Taxonomia fixa de categorias musculares.
const CATEGORIES = {
  peito: { label: 'Peito', color: 'var(--cat-peito)' },
  costas: { label: 'Costas', color: 'var(--cat-costas)' },
  ombros: { label: 'Ombros', color: 'var(--cat-ombros)' },
  biceps: { label: 'Bíceps', color: 'var(--cat-biceps)' },
  triceps: { label: 'Tríceps', color: 'var(--cat-triceps)' },
  antebraco: { label: 'Antebraço', color: 'var(--cat-antebraco)' },
  abdomen: { label: 'Abdômen', color: 'var(--cat-abdomen)' },
  quadriceps: { label: 'Quadríceps', color: 'var(--cat-quadriceps)' },
  posterior: { label: 'Posterior de coxa', color: 'var(--cat-posterior)' },
  panturrilha: { label: 'Panturrilha', color: 'var(--cat-panturrilha)' },
};

// Paleta rotativa usada para colorir os cartões de sessão (não tem relação
// com a categoria muscular, é só uma identidade visual por sessão).
const SESSION_COLORS = [
  'var(--cat-peito)', 'var(--cat-costas)', 'var(--cat-ombros)', 'var(--cat-biceps)',
  'var(--cat-triceps)', 'var(--cat-antebraco)', 'var(--cat-abdomen)', 'var(--cat-quadriceps)',
];

function sessionColor(session) {
  const idx = state.sessions.findIndex((s) => s.id === session.id);
  return SESSION_COLORS[Math.max(0, idx) % SESSION_COLORS.length];
}

/* --------------------------------------------------------------------------
   2. ESTADO DA APLICAÇÃO
   -------------------------------------------------------------------------- */

let state = {
  sessions: [],
  exercises: [],
  history: [],
  ui: {
    view: 'home',           // 'home' | 'session'
    activeSessionId: null,
    activeCategory: 'all',
  },
};

let editingExerciseId = null;
let editingSessionId = null;
let confirmCallback = null;

/* --------------------------------------------------------------------------
   3. PERSISTÊNCIA + MIGRAÇÃO
   -------------------------------------------------------------------------- */

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sessions: state.sessions,
    exercises: state.exercises,
    history: state.history,
  }));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.exercises)) state.exercises = parsed.exercises;
    if (Array.isArray(parsed.sessions)) state.sessions = parsed.sessions;
    if (Array.isArray(parsed.history)) state.history = parsed.history;
    migrateLegacyData();
  } catch (e) {
    console.warn('Não foi possível carregar dados salvos:', e);
  }
}

// Dados de versões anteriores não tinham o conceito de sessão. Se
// encontrarmos exercícios sem sessionIds (ou nenhuma sessão cadastrada mas
// já existem exercícios), criamos uma sessão padrão e movemos tudo pra lá,
// sem perder nenhum progresso já feito.
function migrateLegacyData() {
  let changed = false;

  if (state.exercises.length > 0 && state.sessions.length === 0) {
    const legacySession = {
      id: generateId(),
      name: 'Treino geral',
      notes: 'Sessão criada automaticamente para seus exercícios antigos.',
      createdAt: todayStr(),
    };
    state.sessions.push(legacySession);
    state.exercises.forEach((ex) => {
      if (!Array.isArray(ex.sessionIds) || ex.sessionIds.length === 0) {
        ex.sessionIds = [legacySession.id];
      }
    });
    changed = true;
  }

  state.exercises.forEach((ex) => {
    if (!Array.isArray(ex.sessionIds)) {
      ex.sessionIds = [];
      changed = true;
    }
    if (typeof ex.bankedPoints !== 'number') {
      ex.bankedPoints = 0;
      changed = true;
    }
  });

  if (!Array.isArray(state.history)) {
    state.history = [];
    changed = true;
  }

  if (changed) saveState();
}

/* --------------------------------------------------------------------------
   4. UTILITÁRIOS DE DATA
   -------------------------------------------------------------------------- */

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStr() {
  return toDateStr(new Date());
}

const WEEKDAY_FULL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function formatFullDate(date) {
  return `${WEEKDAY_FULL[date.getDay()]}, ${date.getDate()} de ${MONTH_NAMES[date.getMonth()].toLowerCase()} de ${date.getFullYear()}`;
}

/* --------------------------------------------------------------------------
   5. CÁLCULO DE PROGRESSO E PONTUAÇÃO
   (recebem uma lista de exercícios — pode ser todos, ou só os de 1 sessão)
   -------------------------------------------------------------------------- */

function doneCount(ex) {
  return ex.sets.filter((s) => s !== null).length;
}

function progressPercent(ex) {
  if (ex.totalSets === 0) return 0;
  return (doneCount(ex) / ex.totalSets) * 100;
}

function earnedPoints(ex) {
  const banked = ex.bankedPoints || 0;
  if (ex.totalSets === 0) return banked;
  return banked + Math.round((ex.points * doneCount(ex)) / ex.totalSets);
}

function isCompleted(ex) {
  return doneCount(ex) === ex.totalSets && ex.totalSets > 0;
}

function getTotalPoints(list) {
  return list.reduce((sum, ex) => sum + earnedPoints(ex), 0);
}

function getTodayPoints(list) {
  const tStr = todayStr();
  let total = 0;
  list.forEach((ex) => {
    const doneToday = ex.sets.filter((s) => s === tStr).length;
    total += (ex.points * doneToday) / ex.totalSets;
  });

  // Pontos guardados hoje ao concluir um treino também contam como "hoje",
  // mesmo que as séries que os geraram já tenham sido reiniciadas.
  const exIds = new Set(list.map((ex) => ex.id));
  state.history.forEach((h) => {
    if (h.date === tStr && exIds.has(h.exerciseId)) total += h.points;
  });

  return Math.round(total);
}

function getTotalSetsCompleted(list) {
  return list.reduce((sum, ex) => sum + doneCount(ex), 0);
}

function getAverageCompletion(list) {
  if (list.length === 0) return 0;
  const sum = list.reduce((s, ex) => s + progressPercent(ex), 0);
  return Math.round(sum / list.length);
}

function getCompletedExercisesCount(list) {
  return list.filter(isCompleted).length;
}

// Exercícios de uma sessão específica.
function getSessionExercises(sessionId) {
  return state.exercises.filter((ex) => ex.sessionIds.includes(sessionId));
}

/* --------------------------------------------------------------------------
   6. NAVEGAÇÃO ENTRE HOME E SESSÃO
   -------------------------------------------------------------------------- */

function goHome() {
  state.ui.view = 'home';
  state.ui.activeSessionId = null;
  render();
}

function openSession(sessionId) {
  state.ui.view = 'session';
  state.ui.activeSessionId = sessionId;
  state.ui.activeCategory = 'all';
  render();
}

/* --------------------------------------------------------------------------
   7. RENDERIZAÇÃO — GERAL
   -------------------------------------------------------------------------- */

function render() {
  renderHeaderDate();

  const isHome = state.ui.view === 'home';
  document.getElementById('homeView').classList.toggle('hidden', !isHome);
  document.getElementById('sessionView').classList.toggle('hidden', isHome);
  document.getElementById('addSessionBtn').classList.toggle('hidden', !isHome);

  if (isHome) {
    renderHome();
  } else {
    renderSessionView();
  }
}

function renderHeaderDate() {
  document.getElementById('currentDate').textContent = formatFullDate(new Date());
}

/* --------------------------------------------------------------------------
   7b. RENDERIZAÇÃO — HOME (sessões)
   -------------------------------------------------------------------------- */

function renderHome() {
  const allExercises = state.exercises;

  document.getElementById('homeStatSessions').textContent = state.sessions.length;
  document.getElementById('homeStatTotalPoints').textContent = getTotalPoints(allExercises);
  document.getElementById('homeStatTodayPoints').textContent = getTodayPoints(allExercises);
  document.getElementById('homeStatExercises').textContent = allExercises.length;
  document.getElementById('homeStatAvgCompletion').textContent = `${getAverageCompletion(allExercises)}%`;

  const grid = document.getElementById('sessionsGrid');
  const empty = document.getElementById('emptySessionsState');

  if (state.sessions.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = state.sessions.map(sessionCardHTML).join('');

  state.sessions.forEach((s) => {
    const card = grid.querySelector(`[data-session-id="${s.id}"]`);
    card.addEventListener('click', () => openSession(s.id));
    card.querySelector('.js-edit-session').addEventListener('click', (e) => {
      e.stopPropagation();
      openSessionModal(s.id);
    });
  });
}

function sessionCardHTML(session) {
  const exs = getSessionExercises(session.id);
  const color = sessionColor(session);
  const pct = getAverageCompletion(exs);
  const earned = getTotalPoints(exs);
  const totalPts = exs.reduce((sum, ex) => sum + ex.points, 0);
  const completedCount = getCompletedExercisesCount(exs);

  const categorySet = [...new Set(exs.map((ex) => ex.category))];
  const dotsHTML = categorySet
    .slice(0, 6)
    .map((catKey) => {
      const cat = CATEGORIES[catKey];
      return cat ? `<span class="session-card__dot" style="--cat-color:${cat.color}" title="${cat.label}"></span>` : '';
    })
    .join('');

  return `
    <article class="session-card js-open-session" data-session-id="${session.id}" style="--session-color:${color}">
      <div class="session-card__top">
        <div class="session-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS.dumbbell}</svg></div>
        <button type="button" class="js-edit-session icon-btn" title="Editar sessão" aria-label="Editar sessão">
          <svg class="icon" viewBox="0 0 24 24">${ICONS.edit}</svg>
        </button>
      </div>

      <div class="session-card__name">${escapeHtml(session.name)}</div>
      ${session.notes ? `<p class="session-card__notes">${escapeHtml(session.notes)}</p>` : ''}

      <div class="session-card__dots">${dotsHTML || '<span class="session-card__dots-empty">Sem exercícios ainda</span>'}</div>

      <div class="progress-row">
        <div class="progress-bar"><div class="progress-bar__fill" style="width:${pct}%"></div></div>
        <span class="progress-pct">${pct}%</span>
      </div>

      <div class="session-card__footer">
        <span>${exs.length} exercício${exs.length === 1 ? '' : 's'} · ${completedCount} concluído${completedCount === 1 ? '' : 's'}</span>
        <span class="session-card__points"><strong>${earned}</strong> / ${totalPts} pts</span>
      </div>

      <div class="session-card__enter">Abrir sessão <svg class="icon" viewBox="0 0 24 24">${ICONS.chevron}</svg></div>
    </article>`;
}

/* --------------------------------------------------------------------------
   8. RENDERIZAÇÃO — SESSÃO (exercícios)
   -------------------------------------------------------------------------- */

function renderSessionView() {
  const session = state.sessions.find((s) => s.id === state.ui.activeSessionId);
  if (!session) {
    goHome();
    return;
  }

  const sessionExercises = getSessionExercises(session.id);

  document.getElementById('sessionViewName').textContent = session.name;
  document.getElementById('sessionViewCount').textContent =
    `${sessionExercises.length} exercício${sessionExercises.length === 1 ? '' : 's'}`;

  renderSessionStats(sessionExercises);
  renderCategoryChips(sessionExercises);
  renderExerciseGrid(sessionExercises);
}

function renderSessionStats(sessionExercises) {
  document.getElementById('statTotalPoints').textContent = getTotalPoints(sessionExercises);
  document.getElementById('statTodayPoints').textContent = getTodayPoints(sessionExercises);
  document.getElementById('statCompletedExercises').textContent = getCompletedExercisesCount(sessionExercises);
  document.getElementById('statTotalSets').textContent = getTotalSetsCompleted(sessionExercises);
  document.getElementById('statAvgCompletion').textContent = `${getAverageCompletion(sessionExercises)}%`;
}

function renderCategoryChips(sessionExercises) {
  const container = document.getElementById('categoryChips');
  const usedCategories = [...new Set(sessionExercises.map((ex) => ex.category))];

  const chips = [{ key: 'all', label: 'Todas', color: null }].concat(
    Object.entries(CATEGORIES)
      .filter(([key]) => usedCategories.includes(key))
      .map(([key, c]) => ({ key, label: c.label, color: c.color }))
  );

  container.innerHTML = chips
    .map((c) => {
      const active = state.ui.activeCategory === c.key ? 'active' : '';
      const style = c.color ? `style="--cat-color:${c.color}"` : '';
      const dot = c.color ? `<span class="chip__dot"></span>` : '';
      return `<button type="button" class="chip ${active}" data-category="${c.key}" ${style}>${dot}${c.label}</button>`;
    })
    .join('');

  container.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ui.activeCategory = btn.dataset.category;
      renderSessionView();
    });
  });
}

function renderExerciseGrid(sessionExercises) {
  const visible = sessionExercises.filter(
    (ex) => state.ui.activeCategory === 'all' || ex.category === state.ui.activeCategory
  );

  const grid = document.getElementById('exerciseGrid');
  const empty = document.getElementById('emptyState');

  if (visible.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = visible.map(exerciseCardHTML).join('');

  visible.forEach((ex) => {
    const card = grid.querySelector(`[data-exercise-id="${ex.id}"]`);
    card.querySelector('.js-edit').addEventListener('click', () => openExerciseModal(ex.id));
    card.querySelector('.js-delete').addEventListener('click', () => confirmDeleteExercise(ex.id));
    card.querySelectorAll('.set-square').forEach((sq) => {
      sq.addEventListener('click', () => toggleSet(ex.id, Number(sq.dataset.index)));
    });
  });
}

function exerciseCardHTML(ex) {
  const cat = CATEGORIES[ex.category] || CATEGORIES.peito;
  const pct = progressPercent(ex);
  const completed = isCompleted(ex);
  const earned = earnedPoints(ex);

  const setsHTML = ex.sets
    .map((s, i) => {
      const done = s !== null;
      return `<button type="button" class="set-square ${done ? 'done' : ''}" data-index="${i}" style="--cat-color:${cat.color}" aria-label="Série ${i + 1}${done ? ' concluída' : ''}" title="Série ${i + 1}">${done ? `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${ICONS.check}</svg>` : i + 1}</button>`;
    })
    .join('');

  const otherSessionsCount = ex.sessionIds.length - 1;
  const otherSessionsBadge = otherSessionsCount > 0
    ? `<span class="exercise-card__multi" title="Também em outra${otherSessionsCount > 1 ? 's' : ''} sessão${otherSessionsCount > 1 ? 'ões' : ''}">+${otherSessionsCount} sessão${otherSessionsCount > 1 ? 'ões' : ''}</span>`
    : '';

  return `
    <article class="exercise-card ${completed ? 'completed' : ''}" data-exercise-id="${ex.id}" style="--cat-color:${cat.color}">
      <div class="exercise-card__top">
        <div class="exercise-card__heading">
          <span class="exercise-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS.muscle}</svg></span>
          <div>
            <div class="exercise-card__name">${escapeHtml(ex.name)}</div>
            <div class="exercise-card__category">${cat.label}</div>
          </div>
        </div>
        <div class="exercise-card__points"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.points}</svg>${ex.points} pts</div>
      </div>

      ${ex.notes ? `<p class="exercise-card__notes">${escapeHtml(ex.notes)}</p>` : ''}

      <div class="exercise-card__meta">
        ${ex.time ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.clock}</svg>${ex.time}</span>` : ''}
        <span>${ex.totalSets} séries · ${(ex.points / ex.totalSets).toFixed(1)} pts/série</span>
        ${otherSessionsBadge}
      </div>

      <div class="progress-row">
        <div class="progress-bar"><div class="progress-bar__fill" style="width:${pct}%"></div></div>
        <span class="progress-pct">${Math.round(pct)}%</span>
      </div>

      <div class="sets-grid">${setsHTML}</div>

      <div class="exercise-card__footer">
        <span class="exercise-card__earned"><strong>${earned}</strong> / ${ex.points} pts</span>
        <div class="exercise-card__actions">
          <button type="button" class="js-edit" title="Editar" aria-label="Editar"><svg class="icon" viewBox="0 0 24 24">${ICONS.edit}</svg></button>
          <button type="button" class="js-delete" title="Excluir" aria-label="Excluir"><svg class="icon" viewBox="0 0 24 24">${ICONS.trash}</svg></button>
        </div>
      </div>
    </article>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* --------------------------------------------------------------------------
   9. CRUD DE SESSÕES (MODAL)
   -------------------------------------------------------------------------- */

function openSessionModal(sessionId) {
  editingSessionId = sessionId || null;
  const s = sessionId ? state.sessions.find((x) => x.id === sessionId) : null;

  document.getElementById('sessionModalTitle').textContent = s ? 'Editar sessão' : 'Nova sessão';
  document.getElementById('sessionId').value = sessionId || '';
  document.getElementById('sessionName').value = s ? s.name : '';
  document.getElementById('sessionNotes').value = s ? (s.notes || '') : '';

  document.getElementById('deleteSessionBtn').classList.toggle('hidden', !s);

  document.getElementById('sessionModal').classList.remove('hidden');
  document.getElementById('sessionName').focus();
}

function closeSessionModal() {
  document.getElementById('sessionModal').classList.add('hidden');
  editingSessionId = null;
}

function handleSessionFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('sessionName').value.trim();
  if (!name) return;
  const notes = document.getElementById('sessionNotes').value.trim();

  if (editingSessionId) {
    const s = state.sessions.find((x) => x.id === editingSessionId);
    Object.assign(s, { name, notes });
    showToast(`Sessão "${name}" atualizada.`, 'success');
  } else {
    const newSession = { id: generateId(), name, notes, createdAt: todayStr() };
    state.sessions.push(newSession);
    showToast(`Sessão "${name}" criada. Agora adicione exercícios a ela.`, 'success');
  }

  saveState();
  closeSessionModal();
  render();
}

function confirmDeleteSession(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  const affected = getSessionExercises(sessionId);
  const onlyHere = affected.filter((ex) => ex.sessionIds.length === 1);

  let message = `A sessão "${session.name}" será apagada permanentemente.`;
  if (onlyHere.length > 0) {
    message += ` ${onlyHere.length} exercício${onlyHere.length === 1 ? '' : 's'} que só ${onlyHere.length === 1 ? 'existe' : 'existem'} nela ${onlyHere.length === 1 ? 'será excluído' : 'serão excluídos'} junto.`;
  }
  if (affected.length - onlyHere.length > 0) {
    message += ` Os demais exercícios continuam em suas outras sessões.`;
  }

  showConfirm('Excluir sessão?', message, () => {
    // Remove a sessão de cada exercício; se um exercício ficar sem nenhuma
    // sessão, ele é removido — sem deixar dados órfãos.
    state.exercises.forEach((ex) => {
      ex.sessionIds = ex.sessionIds.filter((id) => id !== sessionId);
    });
    state.exercises = state.exercises.filter((ex) => ex.sessionIds.length > 0);
    state.sessions = state.sessions.filter((s) => s.id !== sessionId);

    saveState();
    goHome();
    showToast('Sessão excluída.', 'danger');
  });
}

/* --------------------------------------------------------------------------
   10. CRUD DE EXERCÍCIOS (MODAL)
   -------------------------------------------------------------------------- */

function populateCategorySelect() {
  const select = document.getElementById('exerciseCategory');
  select.innerHTML = Object.entries(CATEGORIES)
    .map(([key, c]) => `<option value="${key}">${c.label}</option>`)
    .join('');
}

function populateExerciseSessionsCheckboxes(ex) {
  const container = document.getElementById('exerciseSessions');

  if (state.sessions.length === 0) {
    container.innerHTML = '<p class="field-hint">Crie uma sessão primeiro.</p>';
    return;
  }

  const checkedIds = ex
    ? ex.sessionIds
    : (state.ui.activeSessionId ? [state.ui.activeSessionId] : [state.sessions[0].id]);

  container.innerHTML = state.sessions
    .map((s) => {
      const checked = checkedIds.includes(s.id) ? 'checked' : '';
      return `
        <label class="checkbox-item">
          <input type="checkbox" value="${s.id}" ${checked}>
          <span>${escapeHtml(s.name)}</span>
        </label>`;
    })
    .join('');
}

function getCheckedSessionIds() {
  return [...document.querySelectorAll('#exerciseSessions input[type="checkbox"]:checked')].map((i) => i.value);
}

function updateSetsHint() {
  const points = Math.max(1, Number(document.getElementById('exercisePoints').value) || 1);
  const sets = Math.max(1, Number(document.getElementById('exerciseSets').value) || 1);
  const perSet = (points / sets).toFixed(1);
  const pct = (100 / sets).toFixed(1);
  document.getElementById('setsHint').textContent = `Cada série vale ${pct}% (${perSet} pontos).`;
}

function openExerciseModal(exerciseId) {
  if (state.sessions.length === 0) {
    showToast('Crie uma sessão antes de adicionar exercícios.', 'danger');
    return;
  }

  editingExerciseId = exerciseId || null;
  const ex = exerciseId ? state.exercises.find((e) => e.id === exerciseId) : null;

  document.getElementById('modalTitle').textContent = ex ? 'Editar exercício' : 'Novo exercício';
  document.getElementById('exerciseId').value = exerciseId || '';
  document.getElementById('exerciseName').value = ex ? ex.name : '';
  document.getElementById('exerciseCategory').value = ex ? ex.category : 'peito';
  document.getElementById('exerciseTime').value = ex ? ex.time : '';
  document.getElementById('exercisePoints').value = ex ? ex.points : 100;
  document.getElementById('exerciseSets').value = ex ? ex.totalSets : 4;
  document.getElementById('exerciseNotes').value = ex ? ex.notes : '';

  populateExerciseSessionsCheckboxes(ex);
  updateSetsHint();
  document.getElementById('deleteExerciseBtn').classList.toggle('hidden', !ex);

  document.getElementById('exerciseModal').classList.remove('hidden');
  document.getElementById('exerciseName').focus();
}

function closeExerciseModal() {
  document.getElementById('exerciseModal').classList.add('hidden');
  editingExerciseId = null;
}

// Ajusta o array de séries quando o usuário muda a quantidade de séries de
// um exercício já existente, preservando o progresso já feito sempre que
// possível.
function resizeSets(existingSets, newTotal) {
  const sets = [...existingSets];
  if (newTotal > sets.length) {
    while (sets.length < newTotal) sets.push(null);
  } else if (newTotal < sets.length) {
    sets.length = newTotal;
  }
  return sets;
}

function handleExerciseFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('exerciseName').value.trim();
  if (!name) return;

  const sessionIds = getCheckedSessionIds();
  if (sessionIds.length === 0) {
    showToast('Selecione ao menos uma sessão para o exercício.', 'danger');
    return;
  }

  const totalSets = Math.max(1, Math.min(30, Number(document.getElementById('exerciseSets').value) || 1));
  const points = Math.max(1, Number(document.getElementById('exercisePoints').value) || 1);

  const payload = {
    name,
    category: document.getElementById('exerciseCategory').value,
    time: document.getElementById('exerciseTime').value,
    points,
    totalSets,
    notes: document.getElementById('exerciseNotes').value.trim(),
    sessionIds,
  };

  if (editingExerciseId) {
    const ex = state.exercises.find((e) => e.id === editingExerciseId);
    ex.sets = resizeSets(ex.sets, totalSets);
    Object.assign(ex, payload);
    showToast(`Exercício "${name}" atualizado.`, 'success');
  } else {
    state.exercises.push({
      id: generateId(),
      createdAt: todayStr(),
      sets: new Array(totalSets).fill(null),
      bankedPoints: 0,
      ...payload,
    });
    showToast(`Exercício "${name}" adicionado.`, 'success');
  }

  saveState();
  closeExerciseModal();
  render();
}

function generateId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function confirmDeleteExercise(exerciseId) {
  const ex = state.exercises.find((e) => e.id === exerciseId);
  if (!ex) return;
  const earned = earnedPoints(ex);
  const note = earned > 0 ? ` Os ${earned} pontos conquistados por ele serão removidos do total automaticamente.` : '';
  showConfirm('Excluir exercício?', `"${ex.name}" e todo o seu progresso serão apagados permanentemente de todas as sessões.${note}`, () => {
    // A pontuação total é sempre derivada da lista de exercícios, então
    // remover o exercício já remove seus pontos automaticamente — sem
    // deixar nenhum dado órfão.
    state.exercises = state.exercises.filter((e) => e.id !== exerciseId);
    saveState();
    render();
    showToast(earned > 0 ? `Exercício excluído. -${earned} pontos removidos.` : 'Exercício excluído.', 'danger');
  });
}

/* --------------------------------------------------------------------------
   11. MARCAÇÃO DE SÉRIES
   -------------------------------------------------------------------------- */

function toggleSet(exerciseId, index) {
  const ex = state.exercises.find((e) => e.id === exerciseId);
  if (!ex) return;

  const wasCompleted = isCompleted(ex);

  if (ex.sets[index] !== null) {
    ex.sets[index] = null; // desmarcar: pontos daquela série somem automaticamente (cálculo derivado)
  } else {
    ex.sets[index] = todayStr();
    const square = document.querySelector(`[data-exercise-id="${exerciseId}"] .set-square[data-index="${index}"]`);
    if (square) {
      square.classList.add('pulse');
      setTimeout(() => square.classList.remove('pulse'), 400);
    }
  }

  saveState();
  render();

  if (!wasCompleted && isCompleted(ex)) {
    showToast(`🏆 "${ex.name}" concluído 100%! +${ex.points} pts`, 'success');
  }
}

/* --------------------------------------------------------------------------
   11b. CONCLUSÃO DE TREINO (bancar pontos e reiniciar séries)

   Ao concluir o treino de uma sessão, os pontos já conquistados nas séries
   marcadas são "guardados" (bankedPoints) em cada exercício — passando a
   fazer parte permanente do total, mesmo depois que as séries forem
   desmarcadas para o próximo treino. Nada é perdido: apenas as marcações
   de série voltam ao zero para o ciclo seguinte.
   -------------------------------------------------------------------------- */

function finishSession(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  const exs = getSessionExercises(sessionId);
  if (exs.length === 0) {
    showToast('Esta sessão ainda não tem exercícios.', 'danger');
    return;
  }

  const cycleEarned = exs.reduce((sum, ex) => {
    if (ex.totalSets === 0) return sum;
    return sum + Math.round((ex.points * doneCount(ex)) / ex.totalSets);
  }, 0);

  const anySetMarked = exs.some((ex) => doneCount(ex) > 0);
  if (!anySetMarked) {
    showToast('Marque ao menos uma série antes de concluir o treino.', 'danger');
    return;
  }

  showConfirm(
    'Concluir treino?',
    `Todas as séries desta sessão serão desmarcadas para o próximo treino. Os ${cycleEarned} pontos conquistados agora ficam guardados no total — nada se perde.`,
    () => {
      const today = todayStr();
      exs.forEach((ex) => {
        if (ex.totalSets > 0) {
          const earnedThisCycle = Math.round((ex.points * doneCount(ex)) / ex.totalSets);
          if (earnedThisCycle > 0) {
            ex.bankedPoints = (ex.bankedPoints || 0) + earnedThisCycle;
            state.history.push({ id: generateId(), exerciseId: ex.id, date: today, points: earnedThisCycle });
          }
        }
        ex.sets = new Array(ex.totalSets).fill(null);
      });

      saveState();
      render();
      showToast(`🏁 Treino concluído! +${cycleEarned} pts guardados. Séries reiniciadas.`, 'success');
    }
  );
}

/* --------------------------------------------------------------------------
   12. TOASTS E CONFIRMAÇÃO
   -------------------------------------------------------------------------- */

function showToast(message, type = '') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

function showConfirm(title, message, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = onConfirm;
  document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirm() {
  document.getElementById('confirmModal').classList.add('hidden');
  confirmCallback = null;
}

/* --------------------------------------------------------------------------
   13. INICIALIZAÇÃO E LISTENERS
   -------------------------------------------------------------------------- */

function init() {
  loadState();
  populateCategorySelect();
  render();
  attachEventListeners();

  // Atualiza a data/estatísticas periodicamente para refletir a virada do dia.
  setInterval(render, 60 * 1000);
}

function attachEventListeners() {
  // Navegação
  document.getElementById('backToHomeBtn').addEventListener('click', goHome);

  // Sessões
  document.getElementById('addSessionBtn').addEventListener('click', () => openSessionModal(null));
  document.getElementById('editSessionBtn').addEventListener('click', () => openSessionModal(state.ui.activeSessionId));
  document.getElementById('finishSessionBtn').addEventListener('click', () => finishSession(state.ui.activeSessionId));
  document.getElementById('closeSessionModalBtn').addEventListener('click', closeSessionModal);
  document.getElementById('cancelSessionBtn').addEventListener('click', closeSessionModal);
  document.getElementById('sessionModal').addEventListener('click', (e) => {
    if (e.target.id === 'sessionModal') closeSessionModal();
  });
  document.getElementById('sessionForm').addEventListener('submit', handleSessionFormSubmit);
  document.getElementById('deleteSessionBtn').addEventListener('click', () => {
    if (editingSessionId) {
      const id = editingSessionId;
      closeSessionModal();
      confirmDeleteSession(id);
    }
  });

  // Exercícios
  document.getElementById('addExerciseBtn').addEventListener('click', () => openExerciseModal(null));
  document.getElementById('closeModalBtn').addEventListener('click', closeExerciseModal);
  document.getElementById('cancelExerciseBtn').addEventListener('click', closeExerciseModal);
  document.getElementById('exerciseModal').addEventListener('click', (e) => {
    if (e.target.id === 'exerciseModal') closeExerciseModal();
  });
  document.getElementById('exerciseForm').addEventListener('submit', handleExerciseFormSubmit);
  document.getElementById('exercisePoints').addEventListener('input', updateSetsHint);
  document.getElementById('exerciseSets').addEventListener('input', updateSetsHint);
  document.getElementById('deleteExerciseBtn').addEventListener('click', () => {
    if (editingExerciseId) {
      const id = editingExerciseId;
      closeExerciseModal();
      confirmDeleteExercise(id);
    }
  });

  // Confirmação genérica
  document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirm);
  document.getElementById('confirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'confirmModal') closeConfirm();
  });
  document.getElementById('confirmOkBtn').addEventListener('click', () => {
    const cb = confirmCallback;
    closeConfirm();
    if (cb) cb();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeExerciseModal();
      closeSessionModal();
      closeConfirm();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
