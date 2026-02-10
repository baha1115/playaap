/* app.js - SPA Offline (Players + Settings + Quiz + XO + Memory) */
(() => {
  "use strict";

  // ========= Helpers =========
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  function uid() {
    return (Math.random().toString(16).slice(2, 10) + Date.now().toString(16)).toUpperCase();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // ========= Persistent Storage =========
  const STORAGE_KEY = "tataouine_it_games_v1";

  const DEFAULT_SETTINGS = {
    winPoints: 3,
    drawPoints: 1,
    quiz: {
      questionCount: 10,
      secondsPerQuestion: 15,
      correctPoints: 1,
      speedBonusPoints: 1
    },
    memory: {
      grid: "4x4" // "4x4" or "6x4"
    }
  };

  function deepMerge(base, extra) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const k in extra || {}) {
      const v = extra[k];
      if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(base[k] || {}, v);
      else out[k] = v;
    }
    return out;
  }

  function loadPersistent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        players: Array.isArray(parsed.players) ? parsed.players : [],
        settings: deepMerge(DEFAULT_SETTINGS, parsed.settings || {})
      };
    } catch {
      return null;
    }
  }

  function savePersistent() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      players: state.players,
      settings: state.settings
    }));
  }

  // ========= App State =========
  const saved = loadPersistent();
  const state = {
    players: saved?.players || [],
    settings: saved?.settings || deepMerge(DEFAULT_SETTINGS, {}),
    ui: { view: "home", params: {} },
    round: null,        // active round data
    roundResult: null   // last result
  };

  // ========= UI Elements =========
  const appEl = $("#app");
  const sbEl = $("#scoreboard");
  const overlayEl = $("#overlay");
  const modalEl = $("#modal");
  const toastEl = $("#toast");
  const confettiEl = $("#confetti");

  let activeCleanup = null; // cleanup when switching views (timers/keydown)

  // ========= Toast / Modal =========
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add("hidden"), 2600);
  }

  function closeModal() {
    overlayEl.classList.add("hidden");
    overlayEl.setAttribute("aria-hidden", "true");
    modalEl.classList.add("hidden");
    modalEl.innerHTML = "";
  }

  function openModal(title, bodyHtml, actionsHtml) {
    overlayEl.classList.remove("hidden");
    overlayEl.setAttribute("aria-hidden", "false");
    modalEl.classList.remove("hidden");

    modalEl.innerHTML = `
      <div class="panel" style="padding:14px;">
        <h2 style="margin:0 0 10px;">${escapeHtml(title)}</h2>
        <div style="color:var(--muted);line-height:1.7;margin-bottom:12px;">${bodyHtml}</div>
        <div class="actions-row" style="margin-top:10px;">
          ${actionsHtml || `<button class="btn ghost" id="modalClose">إغلاق</button>`}
        </div>
      </div>
    `;

    const closeBtn = $("#modalClose");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
  }

  overlayEl.addEventListener("click", closeModal);

  // ========= Confetti =========
  function celebrate() {
    confettiEl.innerHTML = "";
    const pieces = 80;
    const colors = ["#2a4bff", "#12d18e", "#ffb020", "#ff3b3b", "#b9c0ff", "#ffffff"];

    for (let i = 0; i < pieces; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "vw";
      p.style.top = (-10 - Math.random() * 30) + "px";
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      p.style.animationDuration = (1100 + Math.random() * 900) + "ms";
      p.style.opacity = String(0.7 + Math.random() * 0.3);
      confettiEl.appendChild(p);
    }
    setTimeout(() => (confettiEl.innerHTML = ""), 1700);
  }

  // ========= Fullscreen =========
  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      showToast("لم يتم تفعيل ملء الشاشة (ربما المتصفح يمنع ذلك).");
    }
  }

  $("#btnFullscreen").addEventListener("click", toggleFullscreen);
  $("#btnHome").addEventListener("click", () => go("home"));

  // ========= Players / Scores =========
  function getPlayer(id) { return state.players.find(p => p.id === id) || null; }
  function getPlayerName(id) { return getPlayer(id)?.name || "—"; }

  function addPoints(playerId, points) {
    const p = getPlayer(playerId);
    if (!p) return;
    p.score = (p.score || 0) + points;
    savePersistent();
    renderScoreboard();
  }

  function resetAllScores() {
    state.players.forEach(p => p.score = 0);
    savePersistent();
    renderScoreboard();
    showToast("تم تصفير النقاط ✅");
  }

  function removePlayer(playerId) {
    state.players = state.players.filter(p => p.id !== playerId);
    savePersistent();
  }

  function renamePlayer(playerId, newName) {
    const p = getPlayer(playerId);
    if (!p) return;
    p.name = newName;
    savePersistent();
  }

  function ensureAtLeastTwoPlayers() {
    if (state.players.length < 2) {
      showToast("يلزم إضافة لاعبين على الأقل قبل بدء الألعاب.");
      go("players");
      return false;
    }
    return true;
  }

  // ========= Game titles =========
  function gameTitle(game) {
    if (game === "quiz") return "🧠 الكويز";
    if (game === "ttt") return "🖱️⌨️ لعبة XO (Mouse vs Keyboard)";
    if (game === "memory") return "🃏 لعبة الذاكرة";
    return "لعبة";
  }

  // ========= Routing / Rendering =========
  function go(view, params = {}) {
    if (activeCleanup) {
      try { activeCleanup(); } catch {}
      activeCleanup = null;
    }
    state.ui.view = view;
    state.ui.params = params;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    renderScoreboard();
    const v = state.ui.view;

    if (v === "home") renderHome();
    else if (v === "players") renderPlayers();
    else if (v === "settings") renderSettings();
    else if (v === "round") renderRoundSetup(state.ui.params.game, state.ui.params);
    else if (v === "quiz") renderQuiz();
    else if (v === "ttt") renderTTT();
    else if (v === "memory") renderMemory();
    else if (v === "result") renderResult();
    else renderHome();
  }

  // ========= Scoreboard =========
  function renderScoreboard() {
    const playersSorted = state.players.slice().sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name, "ar"));
    const roundInfo = state.round
      ? `${escapeHtml(getPlayerName(state.round.p1Id))} 🆚 ${escapeHtml(getPlayerName(state.round.p2Id))} — ${escapeHtml(gameTitle(state.round.game))}`
      : "لا توجد جولة الآن";

    sbEl.innerHTML = `
      <div class="sb-header">
        <div>
          <h2>لوحة الترتيب</h2>
          <div class="sb-sub">${roundInfo}</div>
        </div>
        <button class="btn small ghost sb-toggle" id="sbToggle" title="إظهار/إخفاء">☰</button>
      </div>

      <div class="sb-body" id="sbBody">
        <div class="sb-actions">
          <button class="btn small" id="sbPlayers">👥 لاعبين</button>
          <button class="btn small" id="sbSettings">⚙️ إعدادات</button>
          <button class="btn small danger" id="sbReset">🧹 Reset</button>
        </div>

        ${playersSorted.length ? `
          <ol class="sb-list">
            ${playersSorted.map(p => `
              <li>
                <span class="sb-name">${escapeHtml(p.name)}</span>
                <span class="sb-score">${p.score || 0}</span>
              </li>
            `).join("")}
          </ol>
        ` : `
          <div class="empty">لا يوجد لاعبين بعد. اضغط "👥 لاعبين" لإضافة أسماء.</div>
        `}
      </div>
    `;

    $("#sbPlayers")?.addEventListener("click", () => go("players"));
    $("#sbSettings")?.addEventListener("click", () => go("settings"));
    $("#sbReset")?.addEventListener("click", () => {
      openModal(
        "تصفير النقاط",
        "هل تريد تصفير نقاط جميع اللاعبين؟",
        `
          <button class="btn danger" id="confirmReset">نعم، صفّر</button>
          <button class="btn ghost" id="modalClose">إلغاء</button>
        `
      );
      $("#confirmReset")?.addEventListener("click", () => {
        closeModal();
        resetAllScores();
      });
    });

    $("#sbToggle")?.addEventListener("click", () => sbEl.classList.toggle("collapsed"));
  }

  // ========= Home =========
  function startGameFlow(game) {
    if (!ensureAtLeastTwoPlayers()) return;
    go("round", { game });
  }

  function renderHome() {
    appEl.innerHTML = `
      <section class="panel">
        <h2>👋 مرحبًا!</h2>
        <p class="desc">
          هذا موقع تفاعلي للمنافسة في الثقافة العامة حول الإعلامية.
          اختَر لعبة، ثم اختَر لاعبين للجولة، وابدأ اللعب أمام الطلبة على البروجكتور.
        </p>

        <div class="kpi">
          <span class="pill">👥 عدد اللاعبين: <span class="muted">${state.players.length}</span></span>
          <span class="pill">🏆 نقاط الفوز: <span class="muted">+${state.settings.winPoints}</span></span>
          <span class="pill">🤝 نقاط التعادل: <span class="muted">+${state.settings.drawPoints}</span></span>
        </div>

        <hr class="sep" />

        <div class="grid cols-3">
          <button class="btn" id="goPlayers">👥 إدارة اللاعبين</button>
          <button class="btn" id="goSettings">⚙️ الإعدادات</button>
          <button class="btn ghost" id="showHelp">ℹ️ طريقة اللعب</button>
        </div>
      </section>

      <section class="panel" style="margin-top:16px;">
        <h2>🎮 الألعاب</h2>
        <p class="desc">اختَر لعبة ثم حدّد لاعبين للجولة.</p>

        <div class="grid cols-3">
          <button class="btn good" data-game="quiz">🧠 الكويز</button>
          <button class="btn" data-game="ttt">🖱️⌨️ Mouse vs Keyboard XO</button>
          <button class="btn warn" data-game="memory">🃏 Memory Cards</button>
        </div>
      </section>
    `;

    $("#goPlayers").addEventListener("click", () => go("players"));
    $("#goSettings").addEventListener("click", () => go("settings"));

    $("#showHelp").addEventListener("click", () => {
      openModal(
        "طريقة اللعب (سريعة)",
        `
        <ul style="margin:0; padding-right:18px; line-height:1.9; color:var(--muted);">
          <li>أولًا: أضف أسماء اللاعبين (طلبة/حاضرين).</li>
          <li>ثانيًا: اختر لعبة.</li>
          <li>ثالثًا: اختر لاعبين للجولة (يدوي أو عشوائي).</li>
          <li>رابعًا: العبوا، والنتيجة تُضاف تلقائيًا للوحة الترتيب.</li>
        </ul>
        `
      );
    });

    $$("[data-game]").forEach(btn => {
      btn.addEventListener("click", () => startGameFlow(btn.getAttribute("data-game")));
    });
  }

  // ========= Players Screen =========
  function renderPlayers() {
    const playersSorted = state.players.slice().sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name, "ar"));

    appEl.innerHTML = `
      <section class="panel">
        <h2>👥 إدارة اللاعبين</h2>
        <p class="desc">أضف أسماء الطلبة/الحاضرين. يمكنك إضافة اسم واحد أو لصق قائمة (كل سطر اسم).</p>

        <div class="row">
          <div>
            <label class="badge">إضافة اسم واحد</label>
            <div style="display:flex; gap:10px; margin-top:10px;">
              <input class="input" id="playerName" placeholder="مثال: سارة" maxlength="30" />
              <button class="btn" id="addOne">إضافة</button>
            </div>
            <div class="empty" style="margin-top:8px;">نصيحة: اكتب الاسم ثم اضغط Enter.</div>
          </div>

          <div>
            <label class="badge">إضافة عدة أسماء (كل سطر اسم)</label>
            <textarea class="textarea" id="bulkNames" placeholder="علي
مريم
آدم"></textarea>
            <div class="actions-row">
              <button class="btn good" id="addBulk">إضافة القائمة</button>
              <button class="btn ghost" id="clearBulk">مسح</button>
            </div>
          </div>
        </div>

        <hr class="sep" />

        <div class="actions-row">
          <button class="btn ghost" id="backHome">⟵ العودة</button>
          <button class="btn warn" id="quickDemo">✨ إضافة لاعبين تجريبيين</button>
        </div>
      </section>

      <section class="panel" style="margin-top:16px;">
        <h2>🏷️ قائمة اللاعبين</h2>
        <p class="desc">اضغط ✏️ لتغيير الاسم أو 🗑️ للحذف.</p>

        ${playersSorted.length ? `
          <table class="table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th style="width:110px;">النقاط</th>
                <th style="width:170px;">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${playersSorted.map(p => `
                <tr>
                  <td><strong>${escapeHtml(p.name)}</strong></td>
                  <td><span class="sb-score">${p.score || 0}</span></td>
                  <td>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                      <button class="btn small" data-action="rename" data-id="${p.id}">✏️ تعديل</button>
                      <button class="btn small danger" data-action="del" data-id="${p.id}">🗑️ حذف</button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `
          <div class="empty">لا توجد أسماء بعد. أضف أسماء من الأعلى.</div>
        `}
      </section>
    `;

    $("#backHome").addEventListener("click", () => go("home"));

    $("#quickDemo").addEventListener("click", () => {
      const demo = ["سارة", "آدم", "مريم", "محمد", "ريم", "أيمن"];
      demo.forEach(name => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (state.players.some(p => p.name === trimmed)) return;
        state.players.push({ id: uid(), name: trimmed, score: 0 });
      });
      savePersistent();
      showToast("تمت إضافة أسماء تجريبية ✅");
      render();
    });

    $("#addOne").addEventListener("click", () => {
      const input = $("#playerName");
      const name = input.value.trim();
      if (!name) return showToast("اكتب اسمًا أولًا.");
      if (state.players.some(p => p.name === name)) return showToast("هذا الاسم موجود بالفعل.");
      state.players.push({ id: uid(), name, score: 0 });
      savePersistent();
      input.value = "";
      input.focus();
      render();
    });

    $("#playerName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#addOne").click();
    });

    $("#addBulk").addEventListener("click", () => {
      const lines = $("#bulkNames").value.split("\n").map(s => s.trim()).filter(Boolean);
      if (!lines.length) return showToast("الصق أسماء (كل سطر اسم).");

      let added = 0;
      lines.forEach(name => {
        if (!state.players.some(p => p.name === name)) {
          state.players.push({ id: uid(), name, score: 0 });
          added++;
        }
      });
      savePersistent();
      showToast(`تمت إضافة ${added} اسم/أسماء ✅`);
      render();
    });

    $("#clearBulk").addEventListener("click", () => $("#bulkNames").value = "");

    $$("[data-action='del']").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        openModal(
          "حذف لاعب",
          "هل تريد حذف هذا اللاعب؟",
          `
            <button class="btn danger" id="confirmDel">نعم، احذف</button>
            <button class="btn ghost" id="modalClose">إلغاء</button>
          `
        );
        $("#confirmDel")?.addEventListener("click", () => {
          closeModal();
          removePlayer(id);
          showToast("تم الحذف ✅");
          render();
        });
      });
    });

    $$("[data-action='rename']").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const p = getPlayer(id);
        if (!p) return;

        openModal(
          "تعديل الاسم",
          `
            <div style="margin-top:8px;">
              <input class="input" id="newName" value="${escapeHtml(p.name)}" maxlength="30" />
              <div class="empty" style="margin-top:8px;">ملاحظة: تجنّب التكرار.</div>
            </div>
          `,
          `
            <button class="btn good" id="confirmRename">حفظ</button>
            <button class="btn ghost" id="modalClose">إلغاء</button>
          `
        );

        $("#confirmRename")?.addEventListener("click", () => {
          const newName = $("#newName").value.trim();
          if (!newName) return showToast("الاسم لا يمكن أن يكون فارغًا.");
          if (state.players.some(x => x.name === newName && x.id !== id)) return showToast("هذا الاسم موجود بالفعل.");
          renamePlayer(id, newName);
          closeModal();
          showToast("تم التعديل ✅");
          render();
        });

        $("#newName")?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") $("#confirmRename")?.click();
        });
      });
    });
  }

  // ========= Settings Screen =========
  function renderSettings() {
    appEl.innerHTML = `
      <section class="panel">
        <h2>⚙️ الإعدادات</h2>
        <p class="desc">غيّر نظام النقاط العام. (نقاط الكويز التفصيلية تُضبط أيضًا عند بدء جولة كويز).</p>

        <div class="row">
          <div>
            <label class="badge">🏆 نقاط الفوز في لعبة</label>
            <input class="input" id="winPoints" type="number" min="0" max="20" value="${state.settings.winPoints}" />
          </div>
          <div>
            <label class="badge">🤝 نقاط التعادل</label>
            <input class="input" id="drawPoints" type="number" min="0" max="20" value="${state.settings.drawPoints}" />
          </div>
        </div>

        <hr class="sep" />

        <div class="row">
          <div>
            <label class="badge">🧠 افتراضي الكويز: عدد الأسئلة</label>
            <input class="input" id="qCount" type="number" min="5" max="20" value="${state.settings.quiz.questionCount}" />
          </div>
          <div>
            <label class="badge">⏱️ افتراضي الكويز: ثواني لكل سؤال</label>
            <input class="input" id="qSeconds" type="number" min="10" max="45" value="${state.settings.quiz.secondsPerQuestion}" />
          </div>
        </div>

        <div class="row" style="margin-top:12px;">
          <div>
            <label class="badge">✅ نقاط الإجابة الصحيحة</label>
            <input class="input" id="qCorrect" type="number" min="0" max="10" value="${state.settings.quiz.correctPoints}" />
          </div>
          <div>
            <label class="badge">⚡ Bonus السرعة (0 أو 1 أو 2)</label>
            <input class="input" id="qBonus" type="number" min="0" max="5" value="${state.settings.quiz.speedBonusPoints}" />
          </div>
        </div>

        <hr class="sep" />

        <div class="actions-row">
          <button class="btn good" id="saveSettings">حفظ</button>
          <button class="btn ghost" id="resetSettings">استرجاع الافتراضي</button>
          <button class="btn ghost" id="backHome">⟵ العودة</button>
        </div>
      </section>
    `;

    $("#backHome").addEventListener("click", () => go("home"));

    $("#resetSettings").addEventListener("click", () => {
      state.settings = deepMerge(DEFAULT_SETTINGS, {});
      savePersistent();
      showToast("تم استرجاع الإعدادات الافتراضية ✅");
      render();
    });

    $("#saveSettings").addEventListener("click", () => {
      const win = clamp(parseInt($("#winPoints").value, 10) || 0, 0, 999);
      const draw = clamp(parseInt($("#drawPoints").value, 10) || 0, 0, 999);

      const qCount = clamp(parseInt($("#qCount").value, 10) || 10, 5, 50);
      const qSec = clamp(parseInt($("#qSeconds").value, 10) || 15, 5, 120);
      const qCorrect = clamp(parseInt($("#qCorrect").value, 10) || 0, 0, 999);
      const qBonus = clamp(parseInt($("#qBonus").value, 10) || 0, 0, 999);

      state.settings.winPoints = win;
      state.settings.drawPoints = draw;
      state.settings.quiz.questionCount = qCount;
      state.settings.quiz.secondsPerQuestion = qSec;
      state.settings.quiz.correctPoints = qCorrect;
      state.settings.quiz.speedBonusPoints = qBonus;

      savePersistent();
      showToast("تم حفظ الإعدادات ✅");
      renderScoreboard();
    });
  }

  // ========= Round Setup =========
  function pickRandomTwoPlayers() {
    const arr = shuffle(state.players);
    return arr.length >= 2 ? [arr[0].id, arr[1].id] : [null, null];
  }

  function playersOptionsHtml(selectedId) {
    return state.players.map(p => `
      <option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>
        ${escapeHtml(p.name)} (${p.score || 0})
      </option>
    `).join("");
  }

  function renderRoundSetup(game, params = {}) {
    if (!game) return go("home");
    if (!ensureAtLeastTwoPlayers()) return;

    const [rnd1, rnd2] = pickRandomTwoPlayers();
    const pre = params.preselect || null;

    let p1Id = pre?.[0] || rnd1;
    let p2Id = pre?.[1] || rnd2;

    if (p1Id === p2Id) {
      const other = state.players.find(x => x.id !== p1Id)?.id;
      if (other) p2Id = other;
    }

    // default per game options
    const quizDefaults = { ...state.settings.quiz };
    const memoryDefaultGrid = state.settings.memory.grid;

    appEl.innerHTML = `
      <section class="panel">
        <h2>🎯 إعداد الجولة — ${escapeHtml(gameTitle(game))}</h2>
        <p class="desc">
          اختر لاعبين لهذه الجولة. يمكنك اختيار عشوائي لتسهيل العرض أمام الطلبة.
        </p>

        <div class="row">
          <div>
            <label class="badge">اللاعب 1</label>
            <select class="select" id="p1">${playersOptionsHtml(p1Id)}</select>
          </div>
          <div>
            <label class="badge">اللاعب 2</label>
            <select class="select" id="p2">${playersOptionsHtml(p2Id)}</select>
          </div>
        </div>

        <div class="actions-row">
          <button class="btn ghost" id="randomPick">🎲 اختيار عشوائي</button>
          <button class="btn good" id="startRound">▶️ ابدأ اللعبة</button>
          <button class="btn ghost" id="backHome">⟵ العودة</button>
        </div>

        <hr class="sep" />

        <div id="gameOptions"></div>
      </section>
    `;

    $("#backHome").addEventListener("click", () => go("home"));

    $("#randomPick").addEventListener("click", () => {
      const [a, b] = pickRandomTwoPlayers();
      $("#p1").value = a;
      $("#p2").value = b;
    });

    // Render game-specific options
    const gameOptionsEl = $("#gameOptions");

    if (game === "quiz") {
      gameOptionsEl.innerHTML = `
        <h2 style="margin-top:0;">🧠 إعدادات الكويز</h2>
        <p class="desc">هذه الإعدادات تخص هذه الجولة فقط.</p>
        <div class="row">
          <div>
            <label class="badge">عدد الأسئلة</label>
            <input class="input" id="optQCount" type="number" min="5" max="20" value="${quizDefaults.questionCount}" />
          </div>
          <div>
            <label class="badge">ثواني لكل سؤال</label>
            <input class="input" id="optQSec" type="number" min="10" max="45" value="${quizDefaults.secondsPerQuestion}" />
          </div>
        </div>

        <div class="row" style="margin-top:12px;">
          <div>
            <label class="badge">نقاط الإجابة الصحيحة</label>
            <input class="input" id="optQCorrect" type="number" min="0" max="5" value="${quizDefaults.correctPoints}" />
          </div>
          <div>
            <label class="badge">Bonus السرعة</label>
            <input class="input" id="optQBonus" type="number" min="0" max="3" value="${quizDefaults.speedBonusPoints}" />
          </div>
        </div>

        <div class="empty" style="margin-top:10px;">
          ملاحظة: في الكويز، نقاط الإجابات الصحيحة تُضاف مباشرة للوحة الترتيب + تُضاف نقاط الفوز/التعادل في النهاية.
        </div>
      `;
    } else if (game === "memory") {
      gameOptionsEl.innerHTML = `
        <h2 style="margin-top:0;">🃏 إعدادات لعبة الذاكرة</h2>
        <p class="desc">اختر حجم الشبكة.</p>

        <div class="row">
          <div>
            <label class="badge">حجم الشبكة</label>
            <select class="select" id="optGrid">
              <option value="4x4" ${memoryDefaultGrid === "4x4" ? "selected" : ""}>4×4 (8 أزواج)</option>
              <option value="6x4" ${memoryDefaultGrid === "6x4" ? "selected" : ""}>6×4 (12 زوج)</option>
            </select>
          </div>
          <div>
            <label class="badge">قواعد سريعة</label>
            <div class="pill">كل تطابق = نقطة داخل الجولة</div>
            <div class="empty">الفائز (أكثر أزواج) يأخذ نقاط الفوز العامة.</div>
          </div>
        </div>
      `;
    } else {
      gameOptionsEl.innerHTML = `
        <h2 style="margin-top:0;">🖱️⌨️ XO</h2>
        <p class="desc">اللاعب 1 = 🖱️ (Mouse) / اللاعب 2 = ⌨️ (Keyboard)</p>
        <div class="empty">الفائز يأخذ نقاط الفوز العامة (+${state.settings.winPoints}).</div>
      `;
    }

    $("#startRound").addEventListener("click", () => {
      const a = $("#p1").value;
      const b = $("#p2").value;
      if (!a || !b) return showToast("اختر لاعبين.");
      if (a === b) return showToast("اللاعبان يجب أن يكونا مختلفين.");

      // Prepare round state
      if (game === "quiz") {
        const count = clamp(parseInt($("#optQCount").value, 10) || state.settings.quiz.questionCount, 5, 20);
        const sec = clamp(parseInt($("#optQSec").value, 10) || state.settings.quiz.secondsPerQuestion, 10, 60);
        const correctPts = clamp(parseInt($("#optQCorrect").value, 10) || 0, 0, 10);
        const bonusPts = clamp(parseInt($("#optQBonus").value, 10) || 0, 0, 10);

        const bank = Array.isArray(window.QUIZ_QUESTIONS) ? window.QUIZ_QUESTIONS : [];
        if (bank.length < 10) return showToast("بنك الأسئلة غير جاهز.");
        const q = shuffle(bank).slice(0, Math.min(count, bank.length));

        state.round = {
          game: "quiz",
          p1Id: a,
          p2Id: b,
          startedAt: Date.now(),
          quiz: {
            options: { questionCount: q.length, secondsPerQuestion: sec, correctPoints: correctPts, speedBonusPoints: bonusPts },
            questions: q,
            index: 0,
            turnPlayerId: a, // يبدأ اللاعب 1
            roundScore: { [a]: 0, [b]: 0 },
            locked: false
          }
        };
        state.roundResult = null;
        go("quiz");
      }

      if (game === "ttt") {
        state.round = {
          game: "ttt",
          p1Id: a,
          p2Id: b,
          startedAt: Date.now(),
          ttt: {
            board: Array(9).fill(null),
            turn: "mouse", // mouse يبدأ
            winner: null,
            winLine: null
          }
        };
        state.roundResult = null;
        go("ttt");
      }

      if (game === "memory") {
        const grid = $("#optGrid").value || "4x4";
        state.settings.memory.grid = grid; // حفظ كافتراضي لاحقًا
        savePersistent();

        const pairsNeeded = grid === "6x4" ? 12 : 8;
        const items = Array.isArray(window.MEMORY_ITEMS) ? window.MEMORY_ITEMS : [];
        if (items.length < pairsNeeded) return showToast("بيانات الذاكرة غير كافية.");

        const chosen = shuffle(items).slice(0, pairsNeeded);
        const deck = shuffle(chosen.flatMap(it => ([
          { id: uid(), key: it.key, label: it.label, icon: it.icon },
          { id: uid(), key: it.key, label: it.label, icon: it.icon }
        ])));

        state.round = {
          game: "memory",
          p1Id: a,
          p2Id: b,
          startedAt: Date.now(),
          memory: {
            grid,
            deck,
            flipped: [],
            matched: [],
            lock: false,
            turnPlayerId: a,
            pairsFound: { [a]: 0, [b]: 0 }
          }
        };
        state.roundResult = null;
        go("memory");
      }
    });
  }

  // ========= Quiz =========
  function renderQuiz() {
    if (!state.round || state.round.game !== "quiz") return go("home");
    const r = state.round;
    const qState = r.quiz;
    const p1 = getPlayer(r.p1Id);
    const p2 = getPlayer(r.p2Id);

    const total = qState.questions.length;
    const idx = qState.index;

    if (idx >= total) {
      // safety
      finishQuiz();
      return;
    }

    const current = qState.questions[idx];
    const activeId = qState.turnPlayerId;
    const activeName = getPlayerName(activeId);

    appEl.innerHTML = `
      <section class="panel">
        <h2>🧠 الكويز</h2>
        <p class="desc">
          الدور بالتناوب. اضغط على الإجابة أو استخدم لوحة المفاتيح (1-4).
        </p>

        <div class="kpi">
          <span class="pill">السؤال: <span class="muted">${idx + 1}/${total}</span></span>
          <span class="pill">الدور: <span class="muted">${escapeHtml(activeName)}</span></span>
          <span class="pill">فئة: <span class="muted">${escapeHtml(current.category)}</span></span>
        </div>

        <div class="kpi" style="margin-top:10px;">
          <span class="pill">👤 ${escapeHtml(p1?.name || "—")}: <span class="muted">${qState.roundScore[r.p1Id] || 0}</span> (عام: ${p1?.score || 0})</span>
          <span class="pill">👤 ${escapeHtml(p2?.name || "—")}: <span class="muted">${qState.roundScore[r.p2Id] || 0}</span> (عام: ${p2?.score || 0})</span>
        </div>

       

        <div class="question">${escapeHtml(current.question)}</div>

        <div class="options" id="options">
          ${current.options.map((opt, i) => `
            <button class="btn option" data-idx="${i}">
              ${i + 1}. ${escapeHtml(opt)}
            </button>
          `).join("")}
        </div>

        <div id="feedback" class="feedback" style="display:none;"></div>

        <div class="actions-row">
          <button class="btn ghost" id="quitQuiz">⟵ إنهاء الجولة</button>
        </div>
      </section>
    `;

    $("#quitQuiz").addEventListener("click", () => {
      openModal(
        "إنهاء الجولة",
        "هل تريد إنهاء جولة الكويز الآن؟ (لن تُحسب نقاط الفوز/التعادل، لكن نقاط الإجابات التي أُضيفت مسبقًا ستبقى).",
        `
          <button class="btn danger" id="confirmQuit">إنهاء</button>
          <button class="btn ghost" id="modalClose">إلغاء</button>
        `
      );
      $("#confirmQuit")?.addEventListener("click", () => {
        closeModal();
        state.round = null;
        go("home");
      });
    });

    const optsEl = $("#options");
    const feedbackEl = $("#feedback");
   
   let locked = !!qState.locked;

   

  

    function setOptionsDisabled(disabled) {
      $$(".option").forEach(b => b.disabled = disabled);
    }

    function markOptions(correctIndex, chosenIndex) {
      $$(".option").forEach(b => {
        const i = parseInt(b.getAttribute("data-idx"), 10);
        if (i === correctIndex) b.classList.add("correct");
        if (chosenIndex !== null && chosenIndex !== undefined && i === chosenIndex && chosenIndex !== correctIndex) {
          b.classList.add("wrong");
        }
      });
    }

    function onAnswer(chosenIndex) {
  if (locked) return;
  locked = true;
  qState.locked = true;

  setOptionsDisabled(true);

  const correctIndex = current.correctIndex;
  const isCorrect = chosenIndex === correctIndex;

  const earned = isCorrect ? qState.options.correctPoints : 0;

  // update round score
  qState.roundScore[activeId] = (qState.roundScore[activeId] || 0) + earned;

  // update global score (directly for quiz answers)
  if (earned > 0) addPoints(activeId, earned);

  markOptions(correctIndex, chosenIndex);

  const expl = escapeHtml(current.explanation);
  const status = isCorrect ? "✅ إجابة صحيحة!" : "❌ إجابة خاطئة!";
  const extra = isCorrect ? `(+${earned} نقطة)` : "(0 نقطة)";

  feedbackEl.style.display = "block";
  feedbackEl.innerHTML = `
    <div style="font-weight:900; font-size:16px;">${status} <span class="muted">${extra}</span></div>
    <div style="margin-top:8px;">
      <strong>الشرح:</strong> <span class="muted">${expl}</span>
    </div>
  `;

  setTimeout(() => {
    qState.index++;
    qState.turnPlayerId = (activeId === r.p1Id) ? r.p2Id : r.p1Id;
    qState.locked = false;

    if (qState.index >= total) finishQuiz();
    else renderQuiz();
  }, 1400);
}

    // Click handlers
    $$(".option").forEach(btn => {
      btn.addEventListener("click", () => {
        const chosen = parseInt(btn.getAttribute("data-idx"), 10);
        onAnswer(chosen);

      });
    });

    // Keyboard support 1-4
    function onKey(e) {
      if (locked) return;
      const map = { "1": 0, "2": 1, "3": 2, "4": 3 };
      if (map.hasOwnProperty(e.key)) {
        const idx = map[e.key];
        const btn = $(`.option[data-idx="${idx}"]`);
        if (btn && !btn.disabled) btn.click();
      }
    }
    document.addEventListener("keydown", onKey);

    // Start timer
   
    

    activeCleanup = () => {
      
      document.removeEventListener("keydown", onKey);
    };
  }

  function finishQuiz() {
    if (!state.round || state.round.game !== "quiz") return;

    const r = state.round;
    const p1Id = r.p1Id;
    const p2Id = r.p2Id;

    const p1Score = r.quiz.roundScore[p1Id] || 0;
    const p2Score = r.quiz.roundScore[p2Id] || 0;

    let winnerId = null;
    let draw = false;

    if (p1Score > p2Score) winnerId = p1Id;
    else if (p2Score > p1Score) winnerId = p2Id;
    else draw = true;

    const winPts = state.settings.winPoints;
    const drawPts = state.settings.drawPoints;

    let awardP1 = 0, awardP2 = 0;

    if (draw) {
      awardP1 = drawPts;
      awardP2 = drawPts;
      addPoints(p1Id, drawPts);
      addPoints(p2Id, drawPts);
    } else {
      if (winnerId === p1Id) { awardP1 = winPts; addPoints(p1Id, winPts); }
      if (winnerId === p2Id) { awardP2 = winPts; addPoints(p2Id, winPts); }
      celebrate();
    }

    state.roundResult = {
      game: "quiz",
      title: "نتيجة الكويز",
      p1Id, p2Id,
      p1RoundPoints: p1Score,
      p2RoundPoints: p2Score,
      awardP1, awardP2,
      winnerId,
      draw,
      extra: {
        questions: r.quiz.questions.length,
        secondsPerQuestion: r.quiz.options.secondsPerQuestion,
        correctPoints: r.quiz.options.correctPoints,
        speedBonusPoints: r.quiz.options.speedBonusPoints
      }
    };

    state.round = null;
    go("result");
  }

  // ========= Tic-Tac-Toe =========
  const WIN_LINES = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];

  function symbolToEmoji(sym) {
    if (sym === "mouse") return "🖱️";
    if (sym === "keyboard") return "⌨️";
    return "";
  }

  function checkTTT(board) {
    for (const line of WIN_LINES) {
      const [a,b,c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { winner: board[a], line };
      }
    }
    if (board.every(Boolean)) return { winner: "draw", line: null };
    return { winner: null, line: null };
  }

  function renderTTT() {
    if (!state.round || state.round.game !== "ttt") return go("home");
    const r = state.round;
    const t = r.ttt;

    const p1Name = getPlayerName(r.p1Id);
    const p2Name = getPlayerName(r.p2Id);

    const turnName = (t.turn === "mouse") ? p1Name : p2Name;

    appEl.innerHTML = `
      <section class="panel">
        <h2>🖱️⌨️ XO (Mouse vs Keyboard)</h2>
        <p class="desc">
          اللاعب 1 = 🖱️ (${escapeHtml(p1Name)}) / اللاعب 2 = ⌨️ (${escapeHtml(p2Name)}).
          أول من يحقق 3 في صف/عمود/قطر يفوز.
        </p>

        <div class="kpi">
          <span class="pill">الدور الآن: <span class="muted">${escapeHtml(turnName)}</span></span>
          <span class="pill">🏆 الفوز: <span class="muted">+${state.settings.winPoints}</span></span>
          <span class="pill">🤝 التعادل: <span class="muted">+${state.settings.drawPoints}</span></span>
        </div>

        <div class="board" id="board">
          ${t.board.map((cell, i) => `
            <button class="btn cell" data-i="${i}" ${cell || t.winner ? "disabled" : ""} aria-label="خانة ${i+1}">
              ${cell ? symbolToEmoji(cell) : ""}
            </button>
          `).join("")}
        </div>

        <div class="actions-row">
          <button class="btn ghost" id="restartTTT">🔁 إعادة مباراة</button>
          <button class="btn ghost" id="backSetup">👥 اختيار لاعبين</button>
          <button class="btn ghost" id="backHome">🏠 الرئيسية</button>
        </div>
      </section>
    `;

    $("#backHome").addEventListener("click", () => { state.round = null; go("home"); });
    $("#backSetup").addEventListener("click", () => { state.round = null; go("round", { game: "ttt" }); });

    $("#restartTTT").addEventListener("click", () => {
      r.ttt = { board: Array(9).fill(null), turn: "mouse", winner: null, winLine: null };
      renderTTT();
    });

    $$(".cell").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-i"), 10);
        if (t.board[i] || t.winner) return;

        t.board[i] = t.turn;
        const res = checkTTT(t.board);
        if (res.winner) {
          t.winner = res.winner;
          t.winLine = res.line;
          finishTTT(res.winner);
          return;
        }
        t.turn = (t.turn === "mouse") ? "keyboard" : "mouse";
        renderTTT();
      });
    });
  }

  function finishTTT(winnerSym) {
    const r = state.round;
    if (!r || r.game !== "ttt") return;

    const p1Id = r.p1Id;
    const p2Id = r.p2Id;

    let winnerId = null;
    let draw = false;

    if (winnerSym === "draw") draw = true;
    else if (winnerSym === "mouse") winnerId = p1Id;
    else if (winnerSym === "keyboard") winnerId = p2Id;

    const winPts = state.settings.winPoints;
    const drawPts = state.settings.drawPoints;

    let awardP1 = 0, awardP2 = 0;

    if (draw) {
      awardP1 = drawPts; awardP2 = drawPts;
      addPoints(p1Id, drawPts);
      addPoints(p2Id, drawPts);
    } else {
      if (winnerId === p1Id) { awardP1 = winPts; addPoints(p1Id, winPts); }
      if (winnerId === p2Id) { awardP2 = winPts; addPoints(p2Id, winPts); }
      celebrate();
    }

    state.roundResult = {
      game: "ttt",
      title: "نتيجة XO",
      p1Id, p2Id,
      awardP1, awardP2,
      winnerId,
      draw,
      extra: {
        p1Symbol: "🖱️",
        p2Symbol: "⌨️"
      }
    };

    state.round = null;
    go("result");
  }

  // ========= Memory =========
  function renderMemory() {
    if (!state.round || state.round.game !== "memory") return go("home");
    const r = state.round;
    const m = r.memory;

    const p1Id = r.p1Id;
    const p2Id = r.p2Id;
    const p1Name = getPlayerName(p1Id);
    const p2Name = getPlayerName(p2Id);

    const turnName = getPlayerName(m.turnPlayerId);

    const p1Pairs = m.pairsFound[p1Id] || 0;
    const p2Pairs = m.pairsFound[p2Id] || 0;

    const gridClass = (m.grid === "6x4") ? "grid-6x4" : "grid-4x4";

    appEl.innerHTML = `
      <section class="panel">
        <h2>🃏 لعبة الذاكرة</h2>
        <p class="desc">
          افتح بطاقتين. إذا تطابقوا تحصل على نقطة وتلعب مرة أخرى.
          إذا لم يتطابقوا يتحول الدور للخصم.
        </p>

        <div class="kpi">
          <span class="pill">الدور الآن: <span class="muted">${escapeHtml(turnName)}</span></span>
          <span class="pill">${escapeHtml(p1Name)}: <span class="muted">${p1Pairs}</span> أزواج</span>
          <span class="pill">${escapeHtml(p2Name)}: <span class="muted">${p2Pairs}</span> أزواج</span>
        </div>

        <div class="memory-grid ${gridClass}" id="memGrid">
          ${m.deck.map(card => {
            const isMatched = m.matched.includes(card.id);
            const isRevealed = isMatched || m.flipped.includes(card.id);
            return `
              <div class="card ${isMatched ? "matched" : (isRevealed ? "revealed" : "")}" data-id="${card.id}">
                ${isRevealed ? `
                  <div class="front">${escapeHtml(card.icon)}</div>
                  <small>${escapeHtml(card.label)}</small>
                ` : `
                  <div class="back">؟</div>
                `}
              </div>
            `;
          }).join("")}
        </div>

        <div class="actions-row">
          <button class="btn ghost" id="restartMem">🔁 إعادة خلط</button>
          <button class="btn ghost" id="backSetup">👥 اختيار لاعبين</button>
          <button class="btn ghost" id="backHome">🏠 الرئيسية</button>
        </div>
      </section>
    `;

    $("#backHome").addEventListener("click", () => { state.round = null; go("home"); });
    $("#backSetup").addEventListener("click", () => { state.round = null; go("round", { game: "memory" }); });

    $("#restartMem").addEventListener("click", () => {
      // نفس العناصر لكن shuffle جديد
      const pairsNeeded = (m.grid === "6x4") ? 12 : 8;
      const items = Array.isArray(window.MEMORY_ITEMS) ? window.MEMORY_ITEMS : [];
      const chosen = shuffle(items).slice(0, pairsNeeded);
      const deck = shuffle(chosen.flatMap(it => ([
        { id: uid(), key: it.key, label: it.label, icon: it.icon },
        { id: uid(), key: it.key, label: it.label, icon: it.icon }
      ])));

      r.memory.deck = deck;
      r.memory.flipped = [];
      r.memory.matched = [];
      r.memory.lock = false;
      r.memory.turnPlayerId = r.p1Id;
      r.memory.pairsFound = { [r.p1Id]: 0, [r.p2Id]: 0 };
      renderMemory();
    });

    $$(".card").forEach(cardEl => {
      cardEl.addEventListener("click", () => onFlipMemory(cardEl.getAttribute("data-id")));
    });
  }

  function onFlipMemory(cardId) {
    const r = state.round;
    if (!r || r.game !== "memory") return;
    const m = r.memory;

    if (m.lock) return;
    if (m.matched.includes(cardId)) return;
    if (m.flipped.includes(cardId)) return;

    // reveal
    m.flipped.push(cardId);

    // if only 1 flipped, rerender
    if (m.flipped.length < 2) {
      renderMemory();
      return;
    }

    // if 2 flipped, lock then evaluate
    m.lock = true;
    renderMemory();

    const [aId, bId] = m.flipped;
    const a = m.deck.find(x => x.id === aId);
    const b = m.deck.find(x => x.id === bId);

    setTimeout(() => {
      if (a && b && a.key === b.key) {
        // match!
        m.matched.push(aId, bId);
        m.pairsFound[m.turnPlayerId] = (m.pairsFound[m.turnPlayerId] || 0) + 1;
        m.flipped = [];
        m.lock = false;

        // check end
        if (m.matched.length === m.deck.length) {
          finishMemory();
          return;
        }

        // نفس اللاعب يلعب مرة أخرى
        renderMemory();
      } else {
        // no match
        m.flipped = [];
        m.lock = false;

        // switch turn
        m.turnPlayerId = (m.turnPlayerId === r.p1Id) ? r.p2Id : r.p1Id;
        renderMemory();
      }
    }, 900);
  }

  function finishMemory() {
    const r = state.round;
    if (!r || r.game !== "memory") return;

    const p1Id = r.p1Id;
    const p2Id = r.p2Id;
    const p1Pairs = r.memory.pairsFound[p1Id] || 0;
    const p2Pairs = r.memory.pairsFound[p2Id] || 0;

    let winnerId = null;
    let draw = false;

    if (p1Pairs > p2Pairs) winnerId = p1Id;
    else if (p2Pairs > p1Pairs) winnerId = p2Id;
    else draw = true;

    const winPts = state.settings.winPoints;
    const drawPts = state.settings.drawPoints;

    let awardP1 = 0, awardP2 = 0;

    if (draw) {
      awardP1 = drawPts; awardP2 = drawPts;
      addPoints(p1Id, drawPts);
      addPoints(p2Id, drawPts);
    } else {
      if (winnerId === p1Id) { awardP1 = winPts; addPoints(p1Id, winPts); }
      if (winnerId === p2Id) { awardP2 = winPts; addPoints(p2Id, winPts); }
      celebrate();
    }

    state.roundResult = {
      game: "memory",
      title: "نتيجة لعبة الذاكرة",
      p1Id, p2Id,
      awardP1, awardP2,
      winnerId,
      draw,
      extra: {
        p1Pairs, p2Pairs,
        grid: r.memory.grid
      }
    };

    state.round = null;
    go("result");
  }

  // ========= Result Screen =========
  function renderResult() {
    const res = state.roundResult;
    if (!res) return go("home");

    const p1Name = getPlayerName(res.p1Id);
    const p2Name = getPlayerName(res.p2Id);
    const winnerName = res.winnerId ? getPlayerName(res.winnerId) : null;

    let headline = "";
    if (res.draw) headline = "🤝 تعادل!";
    else headline = `🏆 الفائز: ${escapeHtml(winnerName)}`;

    const awardLine = res.draw
      ? `تم إضافة +${state.settings.drawPoints} نقطة لكل لاعب.`
      : `تم إضافة +${state.settings.winPoints} نقطة للفائز.`;

    let detailsHtml = "";
    if (res.game === "quiz") {
      detailsHtml = `
        <div class="kpi">
          <span class="pill">${escapeHtml(p1Name)}: <span class="muted">${res.p1RoundPoints}</span> (نقاط إجابات الجولة)</span>
          <span class="pill">${escapeHtml(p2Name)}: <span class="muted">${res.p2RoundPoints}</span> (نقاط إجابات الجولة)</span>
        </div>
        <div class="kpi" style="margin-top:10px;">
          <span class="pill">عدد الأسئلة: <span class="muted">${res.extra.questions}</span></span>
          <span class="pill">الوقت/سؤال: <span class="muted">${res.extra.secondsPerQuestion}s</span></span>
          <span class="pill">✅ صحيح: <span class="muted">+${res.extra.correctPoints}</span></span>
          <span class="pill">⚡ Bonus: <span class="muted">+${res.extra.speedBonusPoints}</span></span>
        </div>
        <div class="empty" style="margin-top:10px;">
          ملاحظة: نقاط الإجابات الصحيحة تُضاف مباشرة أثناء اللعب، ثم تُضاف نقاط الفوز/التعادل هنا.
        </div>
      `;
    } else if (res.game === "memory") {
      detailsHtml = `
        <div class="kpi">
          <span class="pill">${escapeHtml(p1Name)}: <span class="muted">${res.extra.p1Pairs}</span> أزواج</span>
          <span class="pill">${escapeHtml(p2Name)}: <span class="muted">${res.extra.p2Pairs}</span> أزواج</span>
          <span class="pill">الشبكة: <span class="muted">${escapeHtml(res.extra.grid)}</span></span>
        </div>
      `;
    } else {
      detailsHtml = `
        <div class="kpi">
          <span class="pill">الرموز: <span class="muted">${res.extra.p1Symbol} vs ${res.extra.p2Symbol}</span></span>
          <span class="pill">الفوز: <span class="muted">+${state.settings.winPoints}</span></span>
          <span class="pill">التعادل: <span class="muted">+${state.settings.drawPoints}</span></span>
        </div>
      `;
    }

    appEl.innerHTML = `
      <section class="panel">
        <h2>📣 ${escapeHtml(res.title)}</h2>
        <p class="desc" style="font-size:16px;">
          <strong>${headline}</strong><br/>
          <span class="muted">${escapeHtml(awardLine)}</span>
        </p>

        ${detailsHtml}

        <hr class="sep" />

        <div class="actions-row">
          <button class="btn good" id="playAgainSame">🔁 لعب نفس اللعبة (نفس اللاعبين)</button>
          <button class="btn" id="newPlayers">👥 اختيار لاعبين جدد</button>
          <button class="btn ghost" id="goHome">🏠 الرئيسية</button>
        </div>
      </section>
    `;

    $("#goHome").addEventListener("click", () => go("home"));
    $("#newPlayers").addEventListener("click", () => go("round", { game: res.game }));

    $("#playAgainSame").addEventListener("click", () => {
      go("round", { game: res.game, preselect: [res.p1Id, res.p2Id] });
    });
  }

  // ========= Init =========
  render();
})();
