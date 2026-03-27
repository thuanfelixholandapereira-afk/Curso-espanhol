
(() => {
  const DATA = window.APP_DATA;
  const app = document.getElementById('app');
  const topbarTitle = document.getElementById('topbarTitle');
  const installBtn = document.getElementById('installBtn');
  const yearEl = document.getElementById('year');

  const flatModules = DATA.modules;
  const lessons = flatModules.flatMap((m, moduleIndex) =>
    m.lessons.map((l, lessonIndex) => ({ ...l, moduleId: m.id, moduleTitle: m.title, moduleIndex, lessonIndex, moduleIcon: m.icon, level: m.level, modes: m.mode }))
  );
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l]));
  const moduleMap = Object.fromEntries(flatModules.map(m => [m.id, m]));
  const simulatorMap = Object.fromEntries(DATA.simulators.map(s => [s.id, s]));

  let deferredPrompt = null;
  let runtimeSessions = {};
  let runtimeSimulatorSessions = {};

  function nowDateStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function tomorrowDateStr(days = 1) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeText(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function defaultState() {
    return {
      xp: 0,
      dailyGoal: 60,
      dailyXP: { date: nowDateStr(), amount: 0 },
      streak: { count: 0, lastDate: null },
      completedLessons: [],
      lessonResults: {},
      modeFilter: 'all',
      diagnostic: { done: false, score: 0, estimatedLevel: 'A1', finishedAt: null },
      errors: [],
      lessonReviews: [],
      simulatorHistory: {},
      dailyNotes: [],
      version: 1
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem('camino-espana-state'));
      const merged = { ...defaultState(), ...(saved || {}) };
      merged.dailyXP = merged.dailyXP || { date: nowDateStr(), amount: 0 };
      if (merged.dailyXP.date !== nowDateStr()) merged.dailyXP = { date: nowDateStr(), amount: 0 };
      return merged;
    } catch {
      return defaultState();
    }
  }

  let state = loadState();

  function saveState() {
    localStorage.setItem('camino-espana-state', JSON.stringify(state));
  }

  function updateDailyStreakIfNeeded() {
    const today = nowDateStr();
    const last = state.streak.lastDate;
    if (!last) {
      state.streak = { count: 1, lastDate: today };
      return;
    }
    if (last === today) return;
    const lastDate = new Date(last + 'T12:00:00');
    const todayDate = new Date(today + 'T12:00:00');
    const diff = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
    if (diff === 1) {
      state.streak.count += 1;
      state.streak.lastDate = today;
    } else if (diff > 1) {
      state.streak = { count: 1, lastDate: today };
    }
  }

  function awardXP(amount) {
    if (!amount) return;
    updateDailyStreakIfNeeded();
    if (state.dailyXP.date !== nowDateStr()) state.dailyXP = { date: nowDateStr(), amount: 0 };
    state.xp += amount;
    state.dailyXP.amount += amount;
    saveState();
  }

  function moduleProgress(moduleId) {
    const mod = moduleMap[moduleId];
    const done = mod.lessons.filter(l => state.completedLessons.includes(l.id)).length;
    const total = mod.lessons.length;
    return { done, total, pct: Math.round((done / total) * 100) };
  }

  function isModuleUnlocked(moduleId) {
    const idx = flatModules.findIndex(m => m.id === moduleId);
    if (idx <= 0) return true;
    const prev = flatModules[idx - 1];
    const prevProgress = moduleProgress(prev.id);
    if (state.diagnostic.done && ['B1', 'B2'].includes(state.diagnostic.estimatedLevel)) return true;
    return prevProgress.done >= Math.max(2, Math.ceil(prevProgress.total * 0.6));
  }

  function nextLesson() {
    for (const lesson of lessons) {
      if (!state.completedLessons.includes(lesson.id) && isModuleUnlocked(lesson.moduleId)) return lesson;
    }
    return lessons.find(l => !state.completedLessons.includes(l.id)) || lessons[0];
  }

  function estimatedLevel() {
    if (state.diagnostic.done) {
      const score = state.diagnostic.score;
      if (score >= 7) return 'B1';
      if (score >= 5) return 'A2';
      return 'A1';
    }
    const done = state.completedLessons.length;
    if (done >= 30) return 'B2';
    if (done >= 22) return 'B1';
    if (done >= 10) return 'A2';
    return 'A1';
  }

  function accuracy() {
    const values = Object.values(state.lessonResults);
    if (!values.length) return 0;
    const totalScore = values.reduce((acc, item) => acc + (item.score || 0), 0);
    const totalItems = values.reduce((acc, item) => acc + (item.total || 0), 0) || 1;
    return Math.round((totalScore / totalItems) * 100);
  }

  function scheduleLessonReview(lessonId, force = false) {
    const existing = state.lessonReviews.find(r => r.lessonId === lessonId);
    if (existing && !force) return;
    const item = existing || { id: uid(), lessonId, intervalIndex: 0, dueDate: tomorrowDateStr(1), type: 'lesson' };
    item.dueDate = tomorrowDateStr(1);
    item.intervalIndex = 0;
    if (!existing) state.lessonReviews.push(item);
  }

  function addErrorReview(lessonId, prompt, answer) {
    const normalizedPrompt = normalizeText(prompt);
    const existing = state.errors.find(e => normalizeText(e.prompt) === normalizedPrompt);
    if (existing) {
      existing.lessonId = lessonId;
      existing.answer = answer;
      existing.intervalIndex = 0;
      existing.dueDate = tomorrowDateStr(1);
      existing.lastFailedAt = nowDateStr();
    } else {
      state.errors.push({
        id: uid(),
        lessonId,
        prompt,
        answer,
        intervalIndex: 0,
        dueDate: tomorrowDateStr(1),
        type: 'error',
        lastFailedAt: nowDateStr()
      });
    }
  }

  function advanceReviewItem(collection, id, success) {
    const intervals = [1, 3, 7, 14, 30];
    const item = collection.find(i => i.id === id);
    if (!item) return;
    if (success) {
      item.intervalIndex = Math.min((item.intervalIndex || 0) + 1, intervals.length - 1);
      item.dueDate = tomorrowDateStr(intervals[item.intervalIndex]);
    } else {
      item.intervalIndex = 0;
      item.dueDate = tomorrowDateStr(1);
    }
    saveState();
    render();
  }

  function dailyReviewItems() {
    const today = nowDateStr();
    const dueErrors = state.errors.filter(e => e.dueDate <= today);
    const dueLessons = state.lessonReviews.filter(r => r.dueDate <= today);
    return { dueErrors, dueLessons };
  }

  function computeCourseProgress() {
    const total = lessons.length;
    const done = state.completedLessons.length;
    return Math.round((done / total) * 100);
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      alert('Seu navegador não suporta síntese de voz.');
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-ES';
    utter.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  function route() {
    const hash = window.location.hash.replace(/^#/, '') || 'home';
    const [name, id] = hash.split(':');
    return { name, id };
  }

  function go(hash) {
    window.location.hash = hash;
  }

  function render() {
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    const current = route();
    const pageName = current.name;
    const renderers = {
      home: renderHome,
      map: renderMap,
      module: () => renderModule(current.id),
      lesson: () => renderLesson(current.id),
      review: renderReview,
      library: renderLibrary,
      profile: renderProfile,
      simulator: renderSimulators,
      'sim-run': () => renderSimulatorRun(current.id),
      diagnostic: renderDiagnostic
    };
    const renderer = renderers[pageName] || renderHome;
    const html = renderer();
    app.innerHTML = html;
    updateTopbar(current);
    bindPostRender(current);
    updateBottomNav(current.name);
    saveState();
  }

  function updateTopbar(current) {
    const titles = {
      home: 'Camino España',
      map: 'Mapa de progresso',
      module: moduleMap[current.id]?.title || 'Módulo',
      lesson: lessonMap[current.id]?.title || 'Lição',
      review: 'Revisão diária',
      library: 'Biblioteca útil',
      profile: 'Desempenho',
      simulator: 'Simulador',
      'sim-run': simulatorMap[current.id]?.title || 'Simulador',
      diagnostic: 'Diagnóstico inicial'
    };
    topbarTitle.textContent = titles[current.name] || 'Camino España';
    installBtn.hidden = !deferredPrompt;
  }

  function updateBottomNav(active) {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === active);
    });
  }

  function modePill(mode, label) {
    const active = state.modeFilter === mode;
    return `<button class="segmented-btn ${active ? 'active' : ''}" data-action="set-mode" data-mode="${mode}">${label}</button>`;
  }

  function statsCards() {
    const progress = computeCourseProgress();
    const review = dailyReviewItems();
    return `
      <div class="stats-grid">
        <article class="stat-card">
          <div class="stat-label">XP total</div>
          <div class="stat-value">${state.xp}</div>
          <div class="stat-sub">Meta diária: ${state.dailyGoal} XP</div>
        </article>
        <article class="stat-card">
          <div class="stat-label">Streak</div>
          <div class="stat-value">${state.streak.count || 0}🔥</div>
          <div class="stat-sub">Continue hoje para manter</div>
        </article>
        <article class="stat-card">
          <div class="stat-label">Progresso</div>
          <div class="stat-value">${progress}%</div>
          <div class="stat-sub">${state.completedLessons.length}/${lessons.length} lições concluídas</div>
        </article>
        <article class="stat-card">
          <div class="stat-label">Revisões pendentes</div>
          <div class="stat-value">${review.dueErrors.length + review.dueLessons.length}</div>
          <div class="stat-sub">Erros + memórias espaçadas</div>
        </article>
      </div>
    `;
  }

  function renderHome() {
    const next = nextLesson();
    const progressPct = Math.min(100, Math.round((state.dailyXP.amount / state.dailyGoal) * 100));
    const lifeCount = flatModules.filter(m => m.mode.includes('vida-real')).length;
    const workCount = flatModules.filter(m => m.mode.includes('trabalho')).length;
    const recommendedMode = state.modeFilter === 'all' ? 'vida real + trabalho' : state.modeFilter.replace('-', ' ');
    const featuredModules = flatModules
      .filter(m => state.modeFilter === 'all' || m.mode.includes(state.modeFilter))
      .slice(0, 4)
      .map(m => {
        const p = moduleProgress(m.id);
        return `
          <button class="card card-button module-card" data-action="go-module" data-module="${m.id}">
            <div class="module-top">
              <span class="module-icon">${m.icon}</span>
              <span class="badge">${m.level}</span>
            </div>
            <h3>${m.title}</h3>
            <p>${m.description}</p>
            <div class="progress-line"><span style="width:${p.pct}%"></span></div>
            <div class="module-meta">${p.done}/${p.total} lições · ${m.mode.map(x => x === 'vida-real' ? 'vida real' : 'trabalho').join(' · ')}</div>
          </button>
        `;
      }).join('');

    return `
      <section class="hero">
        <div class="hero-copy">
          <div class="eyebrow">PWA premium · espanhol para imigração</div>
          <h1>${DATA.appName}</h1>
          <p>${DATA.tagline}</p>
          <div class="hero-actions">
            <button class="primary" data-action="go-lesson" data-lesson="${next.id}">Continuar missão</button>
            <button class="secondary" data-action="go-diagnostic">${state.diagnostic.done ? 'Refazer diagnóstico' : 'Fazer diagnóstico'}</button>
          </div>
        </div>
        <div class="hero-panel">
          <div class="mini-ring">
            <div class="ring-center">${progressPct}%</div>
          </div>
          <div>
            <div class="panel-label">Meta de hoje</div>
            <div class="panel-title">${state.dailyXP.amount}/${state.dailyGoal} XP</div>
            <div class="panel-muted">Nível estimado: ${estimatedLevel()} · modo ${recommendedMode}</div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="segmented">
          ${modePill('all', 'Tudo')}
          ${modePill('vida-real', 'Vida real')}
          ${modePill('trabalho', 'Trabalho')}
        </div>
      </section>

      <section class="section">
        ${statsCards()}
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Sua próxima lição</h2>
          <button class="link-btn" data-action="go-map">Ver trilha completa</button>
        </div>
        <article class="card next-lesson">
          <div class="lesson-kicker">${next.moduleIcon} ${next.moduleTitle} · ${next.level}</div>
          <h3>${next.title}</h3>
          <p>${next.objective}</p>
          <div class="chip-row">
            ${next.modes.map(m => `<span class="chip">${m === 'vida-real' ? 'vida real' : 'trabalho'}</span>`).join('')}
          </div>
          <button class="primary wide" data-action="go-lesson" data-lesson="${next.id}">Entrar na lição</button>
        </article>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Modos do app</h2>
        </div>
        <div class="feature-grid">
          <article class="card compact">
            <h3>Español para vida real</h3>
            <p>${lifeCount} módulos focados em moradia, transporte, saúde, mercado, burocracia e integração cultural.</p>
            <button class="secondary wide" data-action="set-mode" data-mode="vida-real">Ativar foco</button>
          </article>
          <article class="card compact">
            <h3>Español para trabalho</h3>
            <p>${workCount} módulos com currículo, entrevista, rotina profissional, negociação e linguagem funcional.</p>
            <button class="secondary wide" data-action="set-mode" data-mode="trabalho">Ativar foco</button>
          </article>
          <article class="card compact">
            <h3>Revisão inteligente</h3>
            <p>Seu histórico gera erros recorrentes e cartões de revisão espaçada para não esquecer o que aprendeu.</p>
            <button class="secondary wide" data-action="go-review">Revisar agora</button>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Trilhas em destaque</h2>
        </div>
        <div class="module-grid">${featuredModules}</div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Metodologia própria</h2>
        </div>
        <div class="feature-grid">
          ${DATA.methodology.pillars.map(p => `<article class="card compact"><h3>${p}</h3><p>Aplicado no app com atividades de alta utilidade, produção curta e checkpoints reais.</p></article>`).join('')}
        </div>
      </section>
    `;
  }

  function renderMap() {
    const modulesHtml = flatModules
      .filter(m => state.modeFilter === 'all' || m.mode.includes(state.modeFilter))
      .map((m, idx) => {
        const p = moduleProgress(m.id);
        const unlocked = isModuleUnlocked(m.id);
        return `
          <article class="card module-map ${unlocked ? '' : 'locked'}">
            <div class="module-top">
              <span class="module-icon large">${m.icon}</span>
              <div>
                <div class="eyebrow">Módulo ${idx + 1} · ${m.level}</div>
                <h3>${m.title}</h3>
              </div>
            </div>
            <p>${m.description}</p>
            <div class="progress-line"><span style="width:${p.pct}%"></span></div>
            <div class="module-meta">${p.done}/${p.total} lições concluídas · ${unlocked ? 'desbloqueado' : 'desbloqueie concluindo o módulo anterior'}</div>
            <div class="lesson-pill-grid">
              ${m.lessons.map((l, li) => {
                const completed = state.completedLessons.includes(l.id);
                return `<button class="lesson-pill ${completed ? 'done' : ''} ${!unlocked ? 'disabled' : ''}" data-action="go-lesson" data-lesson="${l.id}" ${!unlocked ? 'disabled' : ''}>${li + 1}. ${l.title}</button>`;
              }).join('')}
            </div>
            <button class="secondary wide" data-action="go-module" data-module="${m.id}" ${!unlocked ? 'disabled' : ''}>Abrir módulo</button>
          </article>
        `;
      }).join('');

    return `
      <section class="section">
        <div class="segmented">
          ${modePill('all', 'Tudo')}
          ${modePill('vida-real', 'Vida real')}
          ${modePill('trabalho', 'Trabalho')}
        </div>
      </section>
      <section class="section">
        ${statsCards()}
      </section>
      <section class="section">
        <div class="course-timeline">${modulesHtml}</div>
      </section>
    `;
  }

  function renderModule(moduleId) {
    const mod = moduleMap[moduleId];
    if (!mod) return renderHome();
    const unlocked = isModuleUnlocked(moduleId);
    const p = moduleProgress(moduleId);
    return `
      <section class="section">
        <article class="hero module-hero">
          <div class="hero-copy">
            <div class="eyebrow">${mod.icon} ${mod.level}</div>
            <h1>${mod.title}</h1>
            <p>${mod.description}</p>
            <div class="chip-row">${mod.mode.map(m => `<span class="chip">${m === 'vida-real' ? 'vida real' : 'trabalho'}</span>`).join('')}</div>
          </div>
          <div class="hero-panel">
            <div class="panel-label">Progresso do módulo</div>
            <div class="panel-title">${p.pct}%</div>
            <div class="panel-muted">${p.done}/${p.total} lições concluídas</div>
          </div>
        </article>
      </section>

      <section class="section">
        ${!unlocked ? `<div class="notice warning">Este módulo segue uma progressão por domínio. Conclua pelo menos 2 lições do módulo anterior para desbloquear.</div>` : ''}
        <div class="lesson-list">
          ${mod.lessons.map((lesson, i) => {
            const result = state.lessonResults[lesson.id];
            const done = state.completedLessons.includes(lesson.id);
            return `
              <article class="card lesson-row ${done ? 'done' : ''}">
                <div class="lesson-index">${String(i + 1).padStart(2, '0')}</div>
                <div class="lesson-content">
                  <div class="eyebrow">${lesson.objective}</div>
                  <h3>${lesson.title}</h3>
                  <p>${lesson.story}</p>
                  <div class="module-meta">${done ? `Concluída · ${result?.score || 0}/${result?.total || 0} pontos` : 'Ainda não concluída'}</div>
                </div>
                <button class="${done ? 'secondary' : 'primary'}" data-action="go-lesson" data-lesson="${lesson.id}" ${!unlocked ? 'disabled' : ''}>${done ? 'Revisitar' : 'Começar'}</button>
              </article>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderVocabulary(vocab) {
    return `
      <div class="vocab-grid">
        ${vocab.map(([es, pt]) => `
          <div class="vocab-card">
            <div class="vocab-head">
              <strong>${es}</strong>
              <button class="icon-btn speaker-btn" data-speak="${encodeURIComponent(es)}">🔊</button>
            </div>
            <span>${pt}</span>
          </div>`).join('')}
      </div>
    `;
  }

  function renderPhrases(phrases) {
    return `
      <div class="phrase-list">
        ${phrases.map(p => `
          <div class="phrase-item">
            <div>${p}</div>
            <button class="icon-btn speaker-btn" data-speak="${encodeURIComponent(p)}">🔊</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderExercise(ex, lessonId, index) {
    if (ex.type === 'mcq') {
      return `
        <div class="exercise-body">
          <h3>${ex.prompt}</h3>
          <div class="option-list">
            ${ex.options.map((opt, i) => `
              <label class="option-card">
                <input type="radio" name="choice-${lessonId}-${index}" value="${i}">
                <span>${opt}</span>
              </label>
            `).join('')}
          </div>
          <button class="primary wide" data-action="submit-exercise" data-lesson="${lessonId}" data-index="${index}">Responder</button>
        </div>
      `;
    }

    if (ex.type === 'match') {
      const right = [...ex.pairs.map(pair => pair[1])].sort(() => Math.random() - 0.5);
      return `
        <div class="exercise-body">
          <h3>${ex.prompt}</h3>
          <div class="match-grid">
            ${ex.pairs.map(([left]) => `
              <div class="match-row">
                <span class="match-left">${left}</span>
                <select class="match-select" data-left="${left}">
                  <option value="">Selecione</option>
                  ${right.map(item => `<option value="${item}">${item}</option>`).join('')}
                </select>
              </div>
            `).join('')}
          </div>
          <button class="primary wide" data-action="submit-exercise" data-lesson="${lessonId}" data-index="${index}">Verificar associação</button>
        </div>
      `;
    }

    if (ex.type === 'fill') {
      return `
        <div class="exercise-body">
          <h3>${ex.prompt}</h3>
          <input class="text-input" type="text" placeholder="Digite sua resposta" data-fill-input>
          <button class="primary wide" data-action="submit-exercise" data-lesson="${lessonId}" data-index="${index}">Verificar</button>
        </div>
      `;
    }

    if (ex.type === 'write') {
      return `
        <div class="exercise-body">
          <h3>${ex.prompt}</h3>
          <textarea class="text-area" placeholder="Escreva em espanhol aqui..." data-write-input></textarea>
          <div class="action-row">
            <button class="secondary" data-action="submit-write" data-result="review" data-lesson="${lessonId}" data-index="${index}">Preciso revisar</button>
            <button class="primary" data-action="submit-write" data-result="done" data-lesson="${lessonId}" data-index="${index}">Consegui escrever</button>
          </div>
        </div>
      `;
    }

    return `<div class="exercise-body"><p>Exercício indisponível.</p></div>`;
  }

  function renderLesson(lessonId) {
    const lesson = lessonMap[lessonId];
    if (!lesson) return renderHome();
    const session = runtimeSessions[lessonId] || { started: false, index: -1, score: 0, total: lesson.exercises.length, answers: [] };
    runtimeSessions[lessonId] = session;
    const result = state.lessonResults[lessonId];
    const done = state.completedLessons.includes(lessonId);

    if (!session.started) {
      return `
        <section class="section">
          <article class="hero lesson-hero">
            <div class="hero-copy">
              <div class="eyebrow">${lesson.moduleIcon} ${lesson.moduleTitle} · ${lesson.level}</div>
              <h1>${lesson.title}</h1>
              <p>${lesson.objective}</p>
              <div class="hero-actions">
                <button class="primary" data-action="start-lesson" data-lesson="${lessonId}">${done ? 'Refazer lição' : 'Começar lição'}</button>
                <button class="secondary" data-action="go-module" data-module="${lesson.moduleId}">Voltar ao módulo</button>
              </div>
            </div>
            <div class="hero-panel">
              <div class="panel-label">História-guia</div>
              <div class="panel-title small">${lesson.story}</div>
            </div>
          </article>
        </section>

        ${done && result ? `
          <section class="section">
            <div class="notice success">Você já concluiu esta lição com ${result.score}/${result.total} pontos.</div>
          </section>
        ` : ''}

        <section class="section">
          <div class="section-head"><h2>Vocabulário essencial</h2></div>
          ${renderVocabulary(lesson.vocab)}
        </section>

        <section class="section">
          <div class="section-head"><h2>Frases reais</h2></div>
          ${renderPhrases(lesson.phrases)}
        </section>

        <section class="section">
          <article class="card">
            <h3>Gramática aplicada</h3>
            <p>${lesson.grammar}</p>
          </article>
        </section>

        <section class="section">
          <article class="card checkpoint-card">
            <h3>Checkpoint da lição</h3>
            <p>Você vai passar por múltipla escolha, associação, completar e escrita curta. No final, o app marca XP, agenda revisão e guarda seus erros para treino futuro.</p>
          </article>
        </section>
      `;
    }

    if (session.index >= lesson.exercises.length) {
      const alreadyCompleted = state.completedLessons.includes(lessonId);
      if (!alreadyCompleted) {
        state.completedLessons.push(lessonId);
        state.lessonResults[lessonId] = { score: session.score, total: session.total, completedAt: nowDateStr() };
        awardXP(40 + session.score * 10);
        scheduleLessonReview(lessonId);
        saveState();
      } else {
        state.lessonResults[lessonId] = { score: Math.max(state.lessonResults[lessonId]?.score || 0, session.score), total: session.total, completedAt: nowDateStr() };
        awardXP(10 + session.score * 5);
        saveState();
      }
      const module = moduleMap[lesson.moduleId];
      const currentIdx = module.lessons.findIndex(l => l.id === lessonId);
      const nextInModule = module.lessons[currentIdx + 1];
      return `
        <section class="section">
          <article class="hero success-hero">
            <div class="hero-copy">
              <div class="eyebrow">Lição concluída</div>
              <h1>${lesson.title}</h1>
              <p>Você fechou esta missão com <strong>${session.score}/${session.total}</strong> pontos.</p>
              <div class="hero-actions">
                ${nextInModule ? `<button class="primary" data-action="go-lesson" data-lesson="${nextInModule.id}">Próxima lição</button>` : `<button class="primary" data-action="go-module" data-module="${lesson.moduleId}">Voltar ao módulo</button>`}
                <button class="secondary" data-action="go-review">Ir para revisão</button>
              </div>
            </div>
            <div class="hero-panel">
              <div class="panel-label">XP ganho</div>
              <div class="panel-title">${alreadyCompleted ? 10 + session.score * 5 : 40 + session.score * 10}</div>
              <div class="panel-muted">Seus erros entram automaticamente na revisão inteligente.</div>
            </div>
          </article>
        </section>
        <section class="section">
          <article class="card">
            <h3>Resumo estratégico</h3>
            <p>Objetivo: ${lesson.objective}</p>
            <p>História-base: ${lesson.story}</p>
            <p>Próximo passo sugerido: ${nextInModule ? nextInModule.title : 'revisar e avançar para o próximo módulo'}.</p>
          </article>
        </section>
      `;
    }

    const ex = lesson.exercises[session.index];
    return `
      <section class="section">
        <div class="lesson-runner-top">
          <div>
            <div class="eyebrow">${lesson.moduleTitle}</div>
            <h2>${lesson.title}</h2>
          </div>
          <div class="runner-progress">
            <span>${session.index + 1}/${lesson.exercises.length}</span>
            <div class="progress-line"><span style="width:${Math.round(((session.index) / lesson.exercises.length) * 100)}%"></span></div>
          </div>
        </div>
      </section>

      <section class="section">
        <article class="card exercise-card">
          <div class="badge badge-soft">${exerciseLabel(ex.type)}</div>
          ${renderExercise(ex, lessonId, session.index)}
        </article>
      </section>

      <section class="section">
        <article class="card compact">
          <h3>Revisão rápida</h3>
          <p>${lesson.grammar}</p>
          ${renderPhrases(lesson.phrases.slice(0, 2))}
        </article>
      </section>
    `;
  }

  function exerciseLabel(type) {
    return ({
      mcq: 'múltipla escolha',
      match: 'associação',
      fill: 'completar',
      write: 'escrita curta'
    })[type] || 'exercício';
  }

  function submitExercise(lessonId, index) {
    const lesson = lessonMap[lessonId];
    const ex = lesson.exercises[index];
    const session = runtimeSessions[lessonId];
    let success = false;
    let feedback = '';
    let correctAnswerLabel = '';

    if (ex.type === 'mcq') {
      const picked = document.querySelector(`input[name="choice-${lessonId}-${index}"]:checked`);
      if (!picked) return alert('Selecione uma opção.');
      const value = Number(picked.value);
      success = value === ex.answer;
      correctAnswerLabel = ex.options[ex.answer];
      feedback = success ? 'Boa! Resposta correta.' : `Resposta certa: ${correctAnswerLabel}. ${ex.explanation || ''}`;
    }

    if (ex.type === 'match') {
      const selects = [...document.querySelectorAll('.match-select')];
      if (selects.some(s => !s.value)) return alert('Complete todas as associações.');
      success = ex.pairs.every(([left, right]) => {
        const current = selects.find(s => s.dataset.left === left);
        return current?.value === right;
      });
      correctAnswerLabel = ex.pairs.map(([a, b]) => `${a} → ${b}`).join(' | ');
      feedback = success ? 'Excelente. Todas as associações estão certas.' : `Correção: ${correctAnswerLabel}`;
    }

    if (ex.type === 'fill') {
      const input = document.querySelector('[data-fill-input]');
      if (!input || !input.value.trim()) return alert('Digite sua resposta.');
      const typed = normalizeText(input.value);
      const accepted = ex.answers.map(a => normalizeText(a)).flatMap(ans => ans.split(/[;,]/).map(p => normalizeText(p)));
      success = accepted.includes(typed);
      correctAnswerLabel = ex.answers[0];
      feedback = success ? 'Boa! Você acertou.' : `Resposta esperada: ${correctAnswerLabel}`;
    }

    if (success) {
      session.score += 1;
      awardXP(10);
    } else {
      addErrorReview(lessonId, ex.prompt, correctAnswerLabel);
    }

    session.answers.push({ index, success, prompt: ex.prompt, answer: correctAnswerLabel });
    session.index += 1;
    saveState();
    alert(feedback);
    render();
  }

  function submitWrite(lessonId, index, result) {
    const lesson = lessonMap[lessonId];
    const ex = lesson.exercises[index];
    const textarea = document.querySelector('[data-write-input]');
    if (!textarea || !textarea.value.trim()) return alert('Escreva algo antes de continuar.');
    const session = runtimeSessions[lessonId];
    const success = result === 'done';
    if (success) {
      session.score += 1;
      awardXP(12);
    } else {
      addErrorReview(lessonId, ex.prompt, 'Revise a produção escrita desta lição e repita a estrutura-modelo.');
    }
    session.answers.push({ index, success, prompt: ex.prompt, answer: 'produção escrita' });
    session.index += 1;
    saveState();
    render();
  }

  function renderReview() {
    const { dueErrors, dueLessons } = dailyReviewItems();
    const total = dueErrors.length + dueLessons.length;

    return `
      <section class="section">
        <article class="hero review-hero">
          <div class="hero-copy">
            <div class="eyebrow">Repetição espaçada + revisão de erros</div>
            <h1>Revisão diária</h1>
            <p>O app combina o que você errou com lições já concluídas para evitar esquecimento.</p>
            <div class="hero-actions">
              <button class="primary" data-action="refresh-review">Atualizar fila</button>
            </div>
          </div>
          <div class="hero-panel">
            <div class="panel-label">Pendências do dia</div>
            <div class="panel-title">${total}</div>
            <div class="panel-muted">${dueErrors.length} erros · ${dueLessons.length} revisões de lição</div>
          </div>
        </article>
      </section>

      <section class="section">
        ${total === 0 ? `
          <article class="card">
            <h3>Fila limpa por hoje</h3>
            <p>Sem revisões vencidas. Continue aprendendo e volte amanhã para manter o vocabulário vivo.</p>
            <button class="primary wide" data-action="go-lesson" data-lesson="${nextLesson().id}">Avançar na trilha</button>
          </article>
        ` : ''}
        <div class="review-stack">
          ${dueErrors.map(item => `
            <article class="card review-card">
              <div class="badge badge-danger">erro recorrente</div>
              <h3>${item.prompt}</h3>
              <p class="review-answer">Resposta-modelo: <strong>${item.answer}</strong></p>
              <div class="action-row">
                <button class="secondary" data-action="mark-review" data-source="errors" data-id="${item.id}" data-success="0">Ainda erro</button>
                <button class="primary" data-action="mark-review" data-source="errors" data-id="${item.id}" data-success="1">Agora acertei</button>
              </div>
            </article>
          `).join('')}

          ${dueLessons.map(item => {
            const lesson = lessonMap[item.lessonId];
            return `
              <article class="card review-card">
                <div class="badge badge-soft">memória espaçada</div>
                <h3>${lesson.title}</h3>
                <p><strong>Objetivo:</strong> ${lesson.objective}</p>
                <p><strong>Frases-chave:</strong> ${lesson.phrases.slice(0, 2).join(' · ')}</p>
                <div class="action-row">
                  <button class="secondary" data-action="mark-review" data-source="lessonReviews" data-id="${item.id}" data-success="0">Preciso rever</button>
                  <button class="primary" data-action="mark-review" data-source="lessonReviews" data-id="${item.id}" data-success="1">Lembro bem</button>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderLibrary() {
    const phrases = DATA.phraseLibrary
      .map(item => `
        <article class="card phrase-card">
          <div class="badge">${item.category}</div>
          <h3>${item.es}</h3>
          <p>${item.pt}</p>
          <button class="secondary" data-speak="${encodeURIComponent(item.es)}">Ouvir pronúncia</button>
        </article>
      `).join('');

    const friends = DATA.falseFriends
      .map(item => `
        <article class="card compact false-friend">
          <h3>${item.pt}</h3>
          <p><strong>Significa:</strong> ${item.meaning}</p>
          <p>${item.warning}</p>
        </article>
      `).join('');

    return `
      <section class="section">
        <div class="section-head"><h2>Biblioteca de frases úteis</h2></div>
        <div class="feature-grid">${phrases}</div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Falsos amigos essenciais</h2></div>
        <div class="feature-grid">${friends}</div>
      </section>
    `;
  }

  function renderSimulators() {
    return `
      <section class="section">
        <article class="hero">
          <div class="hero-copy">
            <div class="eyebrow">Situações reais</div>
            <h1>Simulador prático</h1>
            <p>Treine decisões linguísticas em moradia, trabalho, saúde e emergência. Cada escolha gera feedback imediato.</p>
          </div>
          <div class="hero-panel">
            <div class="panel-label">Cenários</div>
            <div class="panel-title">${DATA.simulators.length}</div>
            <div class="panel-muted">Treino rápido e repetível</div>
          </div>
        </article>
      </section>
      <section class="section">
        <div class="feature-grid">
          ${DATA.simulators.map(sim => `
            <article class="card">
              <div class="badge">${sim.mode === 'vida-real' ? 'vida real' : 'trabalho'}</div>
              <h3>${sim.title}</h3>
              <p>${sim.description}</p>
              <button class="primary wide" data-action="go-sim-run" data-sim="${sim.id}">Iniciar simulação</button>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderSimulatorRun(simId) {
    const sim = simulatorMap[simId];
    if (!sim) return renderSimulators();

    const session = runtimeSimulatorSessions[simId] || { index: 0, score: 0, complete: false };
    runtimeSimulatorSessions[simId] = session;

    if (session.index >= sim.steps.length) {
      const finalScore = session.score;
      state.simulatorHistory[simId] = { score: finalScore, completedAt: nowDateStr() };
      awardXP(20 + finalScore * 8);
      saveState();
      return `
        <section class="section">
          <article class="hero success-hero">
            <div class="hero-copy">
              <div class="eyebrow">Simulação concluída</div>
              <h1>${sim.title}</h1>
              <p>Você fechou o cenário com <strong>${finalScore}/${sim.steps.length * 2}</strong> pontos.</p>
              <div class="hero-actions">
                <button class="primary" data-action="restart-sim" data-sim="${simId}">Repetir cenário</button>
                <button class="secondary" data-action="go-simulator">Voltar aos simuladores</button>
              </div>
            </div>
            <div class="hero-panel">
              <div class="panel-label">XP ganho</div>
              <div class="panel-title">${20 + finalScore * 8}</div>
              <div class="panel-muted">Treino de resposta rápida e adequação social.</div>
            </div>
          </article>
        </section>
      `;
    }

    const step = sim.steps[session.index];
    return `
      <section class="section">
        <article class="card simulator-card">
          <div class="eyebrow">${sim.title} · passo ${session.index + 1}/${sim.steps.length}</div>
          <h2>${step.speaker}</h2>
          <p class="sim-text">${step.text}</p>
          <div class="option-list">
            ${step.choices.map((choice, index) => `
              <button class="option-button" data-action="choose-sim" data-sim="${simId}" data-choice="${index}">
                ${choice.text}
              </button>
            `).join('')}
          </div>
        </article>
      </section>
    `;
  }

  function renderProfile() {
    const level = estimatedLevel();
    const moduleRows = flatModules.map(m => {
      const p = moduleProgress(m.id);
      return `<div class="performance-row"><span>${m.title}</span><strong>${p.done}/${p.total}</strong></div>`;
    }).join('');
    const diagnosticText = state.diagnostic.done ? `Feito em ${state.diagnostic.finishedAt} · ${state.diagnostic.score}/8` : 'Ainda não realizado';
    const next = nextLesson();

    return `
      <section class="section">
        <article class="hero">
          <div class="hero-copy">
            <div class="eyebrow">Painel de desempenho</div>
            <h1>Nível atual: ${level}</h1>
            <p>Acompanhamento voltado para uso real do idioma, não apenas gamificação vazia.</p>
            <div class="hero-actions">
              <button class="primary" data-action="go-diagnostic">${state.diagnostic.done ? 'Refazer diagnóstico' : 'Fazer diagnóstico'}</button>
              <button class="secondary" data-action="go-lesson" data-lesson="${next.id}">Próxima missão</button>
            </div>
          </div>
          <div class="hero-panel">
            <div class="panel-label">Precisão geral</div>
            <div class="panel-title">${accuracy()}%</div>
            <div class="panel-muted">Baseado nas lições concluídas</div>
          </div>
        </article>
      </section>

      <section class="section">
        ${statsCards()}
      </section>

      <section class="section">
        <div class="feature-grid">
          <article class="card compact">
            <h3>Diagnóstico inicial</h3>
            <p>${diagnosticText}</p>
          </article>
          <article class="card compact">
            <h3>Erros guardados</h3>
            <p>${state.errors.length} cartões de erro salvos para revisão.</p>
          </article>
          <article class="card compact">
            <h3>Memórias espaçadas</h3>
            <p>${state.lessonReviews.length} lições com reforço programado.</p>
          </article>
        </div>
      </section>

      <section class="section">
        <article class="card">
          <h3>Andamento por módulo</h3>
          <div class="performance-list">${moduleRows}</div>
        </article>
      </section>

      <section class="section">
        <article class="card">
          <h3>Escala de nível</h3>
          <div class="level-rail">
            ${['A1','A2','B1','B2'].map(l => `<div class="level-stop ${level === l ? 'active' : ''}">${l}</div>`).join('')}
          </div>
          <p class="panel-muted">O nível estimado mistura diagnóstico inicial, progresso e histórico de acertos.</p>
        </article>
      </section>
    `;
  }

  function renderDiagnostic() {
    const session = runtimeSessions['__diagnostic__'] || { started: false, index: -1, score: 0, total: DATA.diagnosticQuestions.length };
    runtimeSessions['__diagnostic__'] = session;

    if (!session.started) {
      return `
        <section class="section">
          <article class="hero">
            <div class="hero-copy">
              <div class="eyebrow">Entrada inteligente</div>
              <h1>Diagnóstico inicial</h1>
              <p>Em 8 perguntas, o app estima seu ponto de partida e libera uma rota mais adequada.</p>
              <div class="hero-actions">
                <button class="primary" data-action="start-diagnostic">Começar</button>
                <button class="secondary" data-action="go-home">Agora não</button>
              </div>
            </div>
            <div class="hero-panel">
              <div class="panel-label">Abrange</div>
              <div class="panel-title">A1 → B2</div>
              <div class="panel-muted">Sobrevivência, trabalho e integração</div>
            </div>
          </article>
        </section>
      `;
    }

    if (session.index >= DATA.diagnosticQuestions.length) {
      const score = session.score;
      const level = score >= 7 ? 'B1' : score >= 5 ? 'A2' : 'A1';
      state.diagnostic = { done: true, score, estimatedLevel: level, finishedAt: nowDateStr() };
      awardXP(30 + score * 5);
      saveState();
      return `
        <section class="section">
          <article class="hero success-hero">
            <div class="hero-copy">
              <div class="eyebrow">Diagnóstico concluído</div>
              <h1>Seu ponto de partida é ${level}</h1>
              <p>Acertos: <strong>${score}/8</strong>. O app continuará te empurrando para situações reais acima do seu conforto.</p>
              <div class="hero-actions">
                <button class="primary" data-action="go-home">Voltar à home</button>
                <button class="secondary" data-action="go-map">Ver trilha</button>
              </div>
            </div>
            <div class="hero-panel">
              <div class="panel-label">Rota sugerida</div>
              <div class="panel-title">${level === 'A1' ? 'Fundamentos e comunicação' : level === 'A2' ? 'Moradia, docs e trabalho' : 'Fluência prática e integração'}</div>
              <div class="panel-muted">Você pode refazer o diagnóstico quando quiser.</div>
            </div>
          </article>
        </section>
      `;
    }

    const q = DATA.diagnosticQuestions[session.index];
    return `
      <section class="section">
        <article class="card exercise-card">
          <div class="lesson-runner-top">
            <div>
              <div class="eyebrow">Diagnóstico</div>
              <h2>Pergunta ${session.index + 1}/${DATA.diagnosticQuestions.length}</h2>
            </div>
            <span class="badge">${q.level}</span>
          </div>
          <h3>${q.prompt}</h3>
          <div class="option-list">
            ${q.options.map((opt, i) => `
              <label class="option-card">
                <input type="radio" name="diagnostic-choice" value="${i}">
                <span>${opt}</span>
              </label>
            `).join('')}
          </div>
          <button class="primary wide" data-action="submit-diagnostic">Responder</button>
        </article>
      </section>
    `;
  }

  function bindPostRender(current) {
    document.querySelectorAll('.speaker-btn, [data-speak]').forEach(btn => {
      btn.addEventListener('click', () => speak(decodeURIComponent(btn.dataset.speak)));
    });
  }

  function handleClick(event) {
    const target = event.target.closest('[data-action], [data-nav]');
    if (!target) return;

    if (target.dataset.nav) {
      const nav = target.dataset.nav;
      const mapping = { home: 'home', map: 'map', review: 'review', library: 'library', profile: 'profile' };
      go(mapping[nav]);
      return;
    }

    const action = target.dataset.action;
    switch (action) {
      case 'go-home':
        go('home');
        break;
      case 'go-map':
        go('map');
        break;
      case 'go-module':
        go(`module:${target.dataset.module}`);
        break;
      case 'go-lesson':
        go(`lesson:${target.dataset.lesson}`);
        break;
      case 'go-review':
        go('review');
        break;
      case 'go-diagnostic':
        delete runtimeSessions['__diagnostic__'];
        go('diagnostic');
        break;
      case 'go-simulator':
        go('simulator');
        break;
      case 'go-sim-run':
        go(`sim-run:${target.dataset.sim}`);
        break;
      case 'set-mode':
        state.modeFilter = target.dataset.mode;
        saveState();
        render();
        break;
      case 'start-lesson': {
        const lessonId = target.dataset.lesson;
        runtimeSessions[lessonId] = { started: true, index: 0, score: 0, total: lessonMap[lessonId].exercises.length, answers: [] };
        render();
        break;
      }
      case 'submit-exercise':
        submitExercise(target.dataset.lesson, Number(target.dataset.index));
        break;
      case 'submit-write':
        submitWrite(target.dataset.lesson, Number(target.dataset.index), target.dataset.result);
        break;
      case 'mark-review': {
        const source = target.dataset.source;
        const success = target.dataset.success === '1';
        advanceReviewItem(state[source], target.dataset.id, success);
        if (success) awardXP(8);
        break;
      }
      case 'refresh-review':
        render();
        break;
      case 'start-diagnostic':
        runtimeSessions['__diagnostic__'] = { started: true, index: 0, score: 0, total: DATA.diagnosticQuestions.length };
        render();
        break;
      case 'submit-diagnostic': {
        const picked = document.querySelector('input[name="diagnostic-choice"]:checked');
        if (!picked) return alert('Selecione uma opção.');
        const session = runtimeSessions['__diagnostic__'];
        const q = DATA.diagnosticQuestions[session.index];
        if (Number(picked.value) === q.answer) session.score += 1;
        session.index += 1;
        render();
        break;
      }
      case 'choose-sim': {
        const simId = target.dataset.sim;
        const session = runtimeSimulatorSessions[simId];
        const sim = simulatorMap[simId];
        const step = sim.steps[session.index];
        const choice = step.choices[Number(target.dataset.choice)];
        session.score += choice.score;
        session.index += 1;
        alert(choice.feedback);
        render();
        break;
      }
      case 'restart-sim':
        runtimeSimulatorSessions[target.dataset.sim] = { index: 0, score: 0, complete: false };
        render();
        break;
      default:
        break;
    }
  }

  window.addEventListener('hashchange', render);
  document.addEventListener('click', handleClick);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  render();
})();
