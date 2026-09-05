(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  
  let toastTimer = null;

  const elements = {
    toast: $('#toast'),
    pageTitle: $('#page-title'),
    pageKicker: $('#page-kicker'),
    sheet: $('#word-sheet'),
    sheetBackdrop: $('#sheet-backdrop'),
    manualSheet: $('#manual-sheet'),
    manualBackdrop: $('#manual-backdrop')
  };

  const VIEW_TITLES = {
    home: { kicker: 'FOCUS SANCTUARY · 专注空间', title: '心流专注与今日节奏' },
    learn: { kicker: 'ACTIVE RECALL · 主动回忆工作台', title: '把每一个词，真正刻进长期记忆' },
    reading: { kicker: 'CONTEXTUAL STORYTELLER · AI 语境阅读室', title: '在鲜活的情境短文中，与单词重逢' },
    calendar: { kicker: 'ARCHIVE · 学习档案', title: '学习日历与成就热力图' },
    settings: { kicker: 'CONFIGURATION · 系统设置', title: '模型与应用偏好设置' },
    chat: { kicker: 'AI ASSISTANT · 智能辅学对话', title: '全天候英语智能助教 · 深度问答与模拟' }
  };

  function refreshIcons() {
    try {
      if (window.lucide?.createIcons) {
        window.lucide.createIcons();
      }
    } catch (e) {}
  }

  function showToast(message, type = 'info') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast is-visible' + (type ? ' toast-' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
    }, 2800);
  }

  function speakWord(text) {
    if (!text || !('speechSynthesis' in window)) {
      showToast('当前浏览器不支持语音朗读');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => (v.lang === 'en-US' || v.lang.startsWith('en')) && (v.name.includes('Samantha') || v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Daniel')));
    if (preferredVoice) utterance.voice = preferredVoice;

    window.speechSynthesis.speak(utterance);
  }

  function switchView(view) {
    $$('.view').forEach(v => {
      const isActive = v.dataset.view === view;
      v.classList.toggle('is-active', isActive);
      if (isActive) v.removeAttribute('hidden');
      else v.setAttribute('hidden', '');
    });

    $$('[data-view-target]').forEach(v => {
      v.classList.toggle('is-active', v.dataset.viewTarget === view);
    });

    const meta = VIEW_TITLES[view];
    if (meta) {
      const kicker = $('#page-kicker');
      const title = $('#page-title');
      if (kicker) kicker.textContent = meta.kicker;
      if (title) title.textContent = meta.title;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    refreshIcons();

    window.dispatchEvent(new CustomEvent('viewswitched', { detail: { view } }));
  }

  function renderWordInput(words = []) {
    const countEl = $('#reading-word-count') || $('#word-count');
    if (countEl) countEl.textContent = words.length + ' 个';
  }

  function buildWordPattern(word) {
    const w = String(word || '').trim();
    if (!w) return '';
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (w.endsWith('e')) {
      return `${escaped.slice(0, -1)}(?:e|es|ed|ing)?`;
    }
    if (w.endsWith('y') && !/[aeiou]y$/i.test(w)) {
      return `(?:${escaped}|${escaped.slice(0, -1)}(?:ies|ied|ying))`;
    }
    return `${escaped}(?:s|es|ed|ing|ly)?`;
  }

  function openWordSheet(wordObj, contextSentence = '') {
    const sheet = $('#word-sheet');
    const backdrop = $('#sheet-backdrop');
    if (!sheet) return;

    const w = typeof wordObj === 'string' ? { word: wordObj } : (wordObj || {});
    const wordText = w.word || 'Word';
    
    const wordEl = $('#sheet-word');
    if (wordEl) wordEl.textContent = wordText;

    const ipaEl = $('#sheet-ipa');
    if (ipaEl) ipaEl.textContent = w.ipa || w.accent || '';

    const partEl = $('#sheet-part');
    if (partEl) partEl.textContent = w.partOfSpeech || w.pos || '核心词';

    const defEl = $('#sheet-definition');
    if (defEl) defEl.textContent = w.definition || w.def || w.mean_cn || '暂无详细释义';

    const ctx = contextSentence || w.sentence || w.context || w.sen || '';
    const ctxBox = sheet.querySelector('.sheet-context-box') || sheet.querySelector('.context-note');
    if (ctxBox) {
      ctxBox.style.display = ctx ? 'block' : 'none';
      const ctxEl = $('#sheet-context');
      if (ctxEl) {
        if (ctx && wordText) {
          const reg = new RegExp('\\b(' + wordText + '[a-z]*)\\b', 'gi');
          ctxEl.innerHTML = escapeHtml(ctx).replace(reg, '<strong style="color:var(--accent-system); text-decoration:underline;">$1</strong>');
        } else {
          ctxEl.textContent = ctx;
        }
      }
    }

    const exp = w.explanation || w.word_etyma || w.mne || w.trans || '';
    const expBox = sheet.querySelector('.sheet-explanation-box') || sheet.querySelector('.explanation-note');
    if (expBox) {
      expBox.style.display = exp ? 'block' : 'none';
      const expEl = $('#sheet-explanation');
      if (expEl) expEl.textContent = exp;
    }

    const audioBtn = $('#sheet-audio-btn');
    if (audioBtn) {
      audioBtn.onclick = () => speakWord(wordText);
    }

    sheet.removeAttribute('hidden');
    sheet.classList.add('is-visible');
    if (backdrop) {
      backdrop.removeAttribute('hidden');
      backdrop.classList.add('is-visible');
    }

    refreshIcons();
  }

  function closeWordSheet() {
    const sheet = $('#word-sheet');
    const backdrop = $('#sheet-backdrop');
    if (sheet) {
      sheet.classList.remove('is-visible');
      setTimeout(() => sheet.setAttribute('hidden', ''), 320);
    }
    if (backdrop) {
      backdrop.classList.remove('is-visible');
      setTimeout(() => backdrop.setAttribute('hidden', ''), 320);
    }
  }

  function openManual() {
    const sheet = $('#manual-sheet');
    const backdrop = $('#manual-backdrop');
    if (sheet) {
      sheet.removeAttribute('hidden');
      sheet.classList.add('is-visible');
    }
    if (backdrop) {
      backdrop.removeAttribute('hidden');
      backdrop.classList.add('is-visible');
    }
    refreshIcons();
  }

  function closeManual() {
    const sheet = $('#manual-sheet');
    const backdrop = $('#manual-backdrop');
    if (sheet) {
      sheet.classList.remove('is-visible');
      setTimeout(() => sheet.setAttribute('hidden', ''), 320);
    }
    if (backdrop) {
      backdrop.classList.remove('is-visible');
      setTimeout(() => backdrop.setAttribute('hidden', ''), 320);
    }
  }

  function flashSpellingResult(inputEl, isCorrect, targetWord = '') {
    if (!inputEl) return;
    inputEl.classList.remove('is-right', 'is-wrong');
    void inputEl.offsetWidth;
    
    if (isCorrect) {
      inputEl.classList.add('is-right');
      showToast('拼写完全正确！🎉', 'success');
    } else {
      inputEl.classList.add('is-wrong');
      showToast('拼写有误，正确答案为: ' + targetWord, 'error');
    }
  }

  function renderReading(session, onWordClick) {
    if (!session) return;
    const title = $('#reading-article-title');
    if (title) title.textContent = session.title || "Today's Reading";

    const body = $('#reading-article-body');
    if (body) {
      let raw = session.body || '';
      const words = (session.words || []).filter(Boolean);

      if (words.length) {
        const sortedWords = [...words].sort((a, b) => b.length - a.length);
        const reCombined = new RegExp('\\b(' + sortedWords.map(buildWordPattern).join('|') + ')\\b', 'gi');

        raw = escapeHtml(raw).replace(reCombined, (match) => {
          const matchLower = match.toLowerCase();
          const base = sortedWords.find(w => {
            const wLow = w.toLowerCase();
            return matchLower === wLow || matchLower.startsWith(wLow.slice(0, Math.max(3, wLow.length - 2)));
          }) || matchLower;

          return `<span class="word-highlight" data-base-word="${base.toLowerCase()}" data-current-word="${matchLower}">${match}</span>`;
        });
      } else {
        raw = escapeHtml(raw);
      }

      body.innerHTML = raw.split(/\n\n+/).map(p => '<p>' + p + '</p>').join('');

      body.querySelectorAll('.word-highlight').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const baseWord = el.dataset.baseWord;
          const currentWord = el.dataset.currentWord;

          const pEl = el.closest('p');
          let contextSentence = '';
          if (pEl) {
            const text = pEl.textContent || '';
            const sentences = text.split(/(?<=[.?!])\s+/);
            contextSentence = sentences.find(s => s.toLowerCase().includes(currentWord)) || text;
          }

          onWordClick?.(baseWord, contextSentence, currentWord);
        });
      });
    }

    const meta = $('#reading-article-meta');
    if (meta) {
      const wordsCount = (session.words || []).length;
      const readingMinutes = Math.max(1, Math.ceil((session.body || '').split(/\s+/).length / 140));
      meta.textContent = (session.difficulty || '四级') + ' · ' + wordsCount + ' 个生词 · 约 ' + readingMinutes + ' 分钟精读';
    }

    const src = $('#reading-article-source');
    if (src) src.textContent = session.source || 'AI 语境短文';

    refreshIcons();
  }

  function renderReadingDirectory(sessions = [], activeId = '', onSelect) {
    const list = $('#reading-directory');
    const count = $('#reading-directory-count');
    if (count) count.textContent = sessions.length + ' 篇';
    if (!list) return;

    if (!sessions.length) {
      list.innerHTML = '<p class="history-empty">生成短文后会自动归档在此。</p>';
      return;
    }

    list.innerHTML = sessions.map(s => `
      <button class="directory-item ${s.id === activeId ? 'is-active' : ''}" data-session-id="${escapeHtml(s.id)}" type="button">
        <div class="dir-item-content">
          <strong>${escapeHtml(s.title || '未命名短文')}</strong>
          <small>${escapeHtml(s.date || '')} · ${(s.words || []).length} 词 · ${escapeHtml(s.genre || '故事')}</small>
        </div>
        <i data-lucide="chevron-right"></i>
      </button>
    `).join('');

    list.querySelectorAll('[data-session-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        onSelect?.(btn.dataset.sessionId);
      });
    });

    refreshIcons();
  }

  function renderCalendar(sessions = [], monthDate = new Date(), onSelectDate) {
    const label = $('#calendar-label');
    const grid = $('#calendar-grid');
    const summary = $('#archive-summary');
    const archive = $('#archive-list');
    if (!label || !grid) return;

    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    label.textContent = y + ' 年 ' + (m + 1) + ' 月';

    const counts = {};
    const sessionsByDate = {};
    sessions.forEach(s => {
      if (s.date) {
        counts[s.date] = (counts[s.date] || 0) + 1;
        if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
        sessionsByDate[s.date].push(s);
      }
    });

    const firstDay = new Date(y, m, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const totalDays = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    const toKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const todayKey = toKey(today);

    let html = Array.from({ length: offset }, () => '<div class="calendar-day is-blank"></div>').join('');
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(y, m, d);
      const k = toKey(date);
      const count = counts[k] || 0;
      const isToday = k === todayKey;
      html += `
        <button type="button" class="calendar-day ${count ? 'has-session' : ''} ${isToday ? 'is-today' : ''}" 
          data-date="${k}" ${count ? '' : 'disabled'} title="${count ? k + ': ' + count + ' 次学习' : ''}">
          <span class="day-num">${d}</span>
          ${count ? '<span class="day-dot"></span>' : ''}
        </button>
      `;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('[data-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        onSelectDate?.(btn.dataset.date, sessionsByDate[btn.dataset.date] || []);
      });
    });

    if (summary) {
      const totalWords = sessions.reduce((sum, s) => sum + (s.words || []).length, 0);
      summary.innerHTML = `
        <div class="summary-chip"><i data-lucide="award"></i> 累计打卡 <strong>${sessions.length}</strong> 次</div>
        <div class="summary-chip"><i data-lucide="book-marked"></i> 掌握生词 <strong>${totalWords}</strong> 词</div>
      `;
    }

    if (archive) {
      if (!sessions.length) {
        archive.innerHTML = '<p class="history-empty">暂无学习打卡历史，快去背词或生成短文吧！</p>';
      } else {
        archive.innerHTML = sessions.slice(0, 15).map(s => `
          <button class="archive-item" data-session-id="${escapeHtml(s.id)}" type="button">
            <div class="archive-info">
              <strong>${escapeHtml(s.title || '背词与情境精读')}</strong>
              <small>${escapeHtml(s.date || '')} · ${(s.words || []).length} 个核心词 · ${escapeHtml(s.difficulty || '四级')}</small>
            </div>
            <span class="archive-badge">${escapeHtml(s.source || '已完成')}</span>
          </button>
        `).join('');

        archive.querySelectorAll('[data-session-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            const sid = btn.dataset.sessionId;
            const sess = sessions.find(s => s.id === sid);
            if (sess) {
              switchView('reading');
              renderReading(sess, (baseWord, contextSentence) => {
                const def = (sess.definitions || []).find(d => d.word.toLowerCase() === baseWord.toLowerCase())
                  || (window.LexoraApi?.lookupLexicon ? window.LexoraApi.lookupLexicon(baseWord) : { word: baseWord });
                openWordSheet(def || { word: baseWord }, contextSentence);
              });
            }
          });
        });
      }
    }

    refreshIcons();
  }

  function renderTodayGoal(learnedCount = 0, goalTarget = 20) {
    const countEl = $('#today-learned-count');
    const targetEl = $('#today-goal-target');
    const badgeEl = $('#today-percent-badge');
    const fillEl = $('#today-goal-progress-fill');
    const selectEl = $('#daily-target-words');

    if (countEl) countEl.textContent = learnedCount;
    if (targetEl) targetEl.textContent = goalTarget;
    if (selectEl && String(selectEl.value) !== String(goalTarget)) selectEl.value = String(goalTarget);

    const pct = Math.max(0, Math.min(100, Math.round((learnedCount / Math.max(1, goalTarget)) * 100)));
    if (badgeEl) {
      if (pct >= 100) {
        badgeEl.textContent = '已达成 🎉';
        badgeEl.style.background = 'rgba(48, 209, 88, 0.18)';
        badgeEl.style.color = '#30d158';
        badgeEl.style.borderColor = '#30d158';
      } else {
        badgeEl.textContent = pct + '%';
        badgeEl.style.background = '';
        badgeEl.style.color = '';
        badgeEl.style.borderColor = '';
      }
    }
    if (fillEl) fillEl.style.width = pct + '%';
  }

  function renderYesterdayReview(yesterdayData = { count: 0, words: [], date: '' }, isReviewActive = false) {
    const badgeEl = $('#yesterday-count-badge');
    const dateTag = $('#yesterday-date-tag');
    const descEl = $('#yesterday-desc-text');
    const btn = $('#start-yesterday-review-btn');
    const label = $('#yesterday-btn-label');

    const count = yesterdayData?.count || 0;
    if (badgeEl) badgeEl.textContent = count > 0 ? `${count} 词待复习` : '暂无记忆欠款';
    if (dateTag && yesterdayData?.date) {
      dateTag.textContent = yesterdayData.date.slice(5);
    }

    if (descEl) {
      if (count > 0) {
        descEl.textContent = `检索到昨日打卡沉淀的 ${count} 个词汇，及时巩固遗忘率骤降 80%`;
      } else {
        descEl.textContent = '昨日词汇已全部巩固完毕或昨日暂无新学，可直接开始今日新词！';
      }
    }

    if (btn && label) {
      if (isReviewActive) {
        btn.classList.add('is-active');
        label.textContent = '正在复习昨日词汇 (点击切回顺序选组)';
      } else {
        btn.classList.remove('is-active');
        label.textContent = count > 0 ? `开启昨日复习 (${count} 词)` : '昨日无待复习词汇';
      }
      btn.disabled = count === 0 && !isReviewActive;
    }
  }

  function renderSyncStatus(state = 'offline', authInfo = {}) {
    const btn = $('#open-auth-modal');
    const txt = $('#sync-status-text');

    if (btn) {
      btn.className = 'cloud-sync-status-btn state-' + state;
    }

    if (txt) {
      if (state === 'synced') {
        txt.textContent = authInfo.username ? `已同步 · ${authInfo.username}` : '已同步云端';
      } else if (state === 'syncing') {
        txt.textContent = '正在同步...';
      } else if (state === 'error') {
        txt.textContent = '同步异常';
      } else {
        txt.textContent = '云同步 (离线)';
      }
    }
  }

  function openAuthModal() {
    const modal = $('#auth-modal');
    const backdrop = $('#auth-modal-backdrop');
    if (modal) modal.removeAttribute('hidden');
    if (backdrop) backdrop.removeAttribute('hidden');
    refreshIcons();
  }

  function closeAuthModal() {
    const modal = $('#auth-modal');
    const backdrop = $('#auth-modal-backdrop');
    if (modal) modal.setAttribute('hidden', '');
    if (backdrop) backdrop.setAttribute('hidden', '');
  }

  function renderAuthModal(authInfo = {}, activeTab = 'login') {
    const loggedInPanel = $('#auth-logged-in-panel');
    const formPanel = $('#auth-form-panel');
    const isLogged = !!(authInfo.token && authInfo.username);

    if (isLogged) {
      if (loggedInPanel) loggedInPanel.removeAttribute('hidden');
      if (formPanel) formPanel.setAttribute('hidden', '');
      const nameEl = $('#auth-logged-username');
      const avatarEl = $('#auth-user-avatar');
      const timeEl = $('#auth-sync-last-time');

      if (nameEl) nameEl.textContent = authInfo.username;
      if (avatarEl) avatarEl.textContent = (authInfo.username[0] || 'U').toUpperCase();
      if (timeEl) {
        const t = authInfo.lastSyncTime ? new Date(authInfo.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '刚刚';
        timeEl.textContent = `已连接 · 最近同步 ${t}`;
      }
    } else {
      if (loggedInPanel) loggedInPanel.setAttribute('hidden', '');
      if (formPanel) formPanel.removeAttribute('hidden');

      $$('.auth-tab-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.authTab === activeTab);
      });
      const submitText = $('#auth-submit-text');
      const titleEl = $('#auth-modal-title');
      if (submitText) {
        submitText.textContent = activeTab === 'register' ? '立即注册账号' : '立即登录';
      }
      if (titleEl) {
        titleEl.textContent = activeTab === 'register' ? '注册新账号' : '账号登录';
      }
    }
    refreshIcons();
  }

  function setGenerating(flag) {
    const btn = $('#reading-generate-button');
    if (btn) {
      btn.disabled = flag;
      btn.classList.toggle('is-loading', flag);
      btn.innerHTML = flag 
        ? '<i data-lucide="loader-2" class="spin"></i><span>AI 正在织入生词...</span>' 
        : '<i data-lucide="wand-sparkles"></i><span>生成情境短文</span>';
    }
    refreshIcons();
  }

  window.LexoraUI = {
    elements,
    refreshIcons,
    showToast,
    speakWord,
    switchView,
    renderWordInput,
    openWordSheet,
    closeWordSheet,
    openManual,
    closeManual,
    flashSpellingResult,
    renderReading,
    renderReadingDirectory,
    renderCalendar,
    setGenerating,
    renderTodayGoal,
    renderYesterdayReview,
    renderSyncStatus,
    openAuthModal,
    closeAuthModal,
    renderAuthModal
  };

  // 全局别名兼容，确保各独立模块均可安全调用 UI 方法
  window.UI = window.LexoraUI;
})();