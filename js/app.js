(() => {
  const { createDemoSession, detectModels, generateReading, getToday, parseWords } = window.LexoraApi || {};
  const { storage } = window.LexoraStorage || {};
  const Sync = window.LexoraSync;
  const UI = window.LexoraUI;
  const Audio = window.LexoraAudio || {};
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  let rawLexicon = Array.isArray(window.LEXORA_EMBEDDED_LEXICON) ? [...window.LEXORA_EMBEDDED_LEXICON] : [];
  let workingLexicon = [...rawLexicon];
  
  let currentGroup = 1;
  let wordsPerGroup = 10;
  let isRandomMode = false;
  let isYesterdayReviewMode = false;
  let yesterdayReviewData = null;
  let authActiveTab = 'login';
  let studyRoundWords = [];
  let studyQueue = [];
  let currentWord = null;
  let isRevealed = false;
  let learnedInRound = new Set();
  let studyStats = { total: 0, agains: 0 };
  let currentInputMode = 'keyboard'; // 'keyboard' | 'quick'
  let autoAudioEnabled = false;
  let lastWordSwitchedAt = 0;

  // 番茄钟
  let pomoTimer = null, pomoTotalSec = 25 * 60, pomoLeftSec = 25 * 60, pomoRunning = false, pomoRound = 1, pomoIsBreak = false;

  // 随机洗牌 (Fisher-Yates)
  function shuffle(arr) {
    const res = [...arr];
    for (let i = res.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [res[i], res[j]] = [res[j], res[i]];
    }
    return res;
  }

  function updateGroupSelector() {
    const sel = $('#lesson-group-select');
    if (!sel) return;
    const total = Math.max(1, Math.ceil(workingLexicon.length / wordsPerGroup));
    let html = '';
    for (let i = 1; i <= total; i++) {
      html += `<option value="${i}" ${i === currentGroup ? 'selected' : ''}>第 ${i} 组 (${(i-1)*wordsPerGroup+1}~${Math.min(i*wordsPerGroup, workingLexicon.length)}词)</option>`;
    }
    sel.innerHTML = html;
  }

  function startNewRound(groupNum = null) {
    if (groupNum !== null) currentGroup = groupNum;

    if (isRandomMode) {
      studyRoundWords = shuffle(rawLexicon).slice(0, wordsPerGroup);
    } else {
      const start = (currentGroup - 1) * wordsPerGroup;
      studyRoundWords = workingLexicon.slice(start, start + wordsPerGroup);
      if (studyRoundWords.length < wordsPerGroup) {
        studyRoundWords = studyRoundWords.concat(workingLexicon.slice(0, wordsPerGroup - studyRoundWords.length));
      }
    }

    studyQueue = [...studyRoundWords];
    learnedInRound.clear();
    studyStats = { total: studyRoundWords.length, agains: 0 };

    $('#study-card')?.removeAttribute('hidden');
    $('#study-complete')?.setAttribute('hidden', '');

    renderQueueSidebar();
    renderNextCard();
    updateMissionDashboard();
  }

  // 今日目标与昨日复习仪表盘数据刷新
  function updateMissionDashboard() {
    const todayInfo = storage?.getTodayLearnedWords?.() || { count: 0, words: [] };
    const goal = storage?.getDailyGoal?.() || 20;
    UI?.renderTodayGoal?.(todayInfo.count, goal);

    yesterdayReviewData = storage?.getYesterdayWords?.() || { count: 0, words: [], date: '' };
    UI?.renderYesterdayReview?.(yesterdayReviewData, isYesterdayReviewMode);
  }

  // 开启昨日复习特训模式 (艾宾浩斯强化)
  function startYesterdayReview() {
    if (!yesterdayReviewData || yesterdayReviewData.count === 0) {
      UI?.showToast('昨日没有需要复习的词汇，请继续今日选组学习', 'info');
      return;
    }

    isYesterdayReviewMode = true;
    studyRoundWords = yesterdayReviewData.words.map(wObj => {
      const full = window.LexoraApi?.lookupLexicon ? window.LexoraApi.lookupLexicon(wObj.word) : null;
      return full || wObj;
    });

    studyQueue = [...studyRoundWords];
    learnedInRound.clear();
    studyStats = { total: studyRoundWords.length, agains: 0 };

    $('#study-card')?.removeAttribute('hidden');
    $('#study-complete')?.setAttribute('hidden', '');

    updateMissionDashboard();
    renderQueueSidebar();
    renderNextCard();
    UI?.showToast(`🚀 已载入昨日 ${studyRoundWords.length} 个重点词汇，开启艾宾浩斯复习！`, 'success');
  }

  // 防剧透右侧面板
  function renderQueueSidebar() {
    const list = $('#vocab-queue-list');
    const countEl = $('#vocab-queue-count');
    if (countEl) countEl.textContent = `${learnedInRound.size}/${studyRoundWords.length} 词`;
    if (!list) return;

    list.innerHTML = studyRoundWords.map((item, idx) => {
      const isDone = learnedInRound.has(item.word);
      const isCurrent = currentWord && currentWord.word === item.word;
      
      let title = `单词 ${String(idx + 1).padStart(2, '0')}`;
      let hint = '待主动回忆 · 遮蔽防剧透';
      if (isDone) {
        title = item.word;
        hint = item.def || '✓ 已掌握';
      } else if (isCurrent) {
        title = '当前回忆挑战';
        hint = '先试着想出英文单词';
      }

      return `
        <div class="queue-item ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''} ${!isDone && !isCurrent ? 'is-spoiler-free' : ''}">
          <span>${idx + 1}</span>
          <div class="queue-word-info">
            <strong>${title}</strong>
            <small>${hint}</small>
          </div>
          ${isDone ? '<i data-lucide="check" class="queue-check-icon"></i>' : ''}
        </div>
      `;
    }).join('');

    UI?.refreshIcons();
  }

  function renderNextCard() {
    lastWordSwitchedAt = Date.now();
    isSpellingSubmitting = false;
    if (studyQueue.length === 0) {
      finishRound();
      return;
    }

    currentWord = studyQueue[0];
    isRevealed = false;

    const progressEl = $('#study-progress-label');
    const counterEl = $('#study-card-counter');
    const done = learnedInRound.size;
    const total = studyRoundWords.length;
    if (progressEl) progressEl.textContent = `${done} / ${total}`;
    if (counterEl) counterEl.textContent = `WORD ${done + 1} OF ${total}`;

    const defEl = $('#study-prompt-definition');
    if (defEl) defEl.textContent = currentWord.def || currentWord.definition || '请回忆这个单词';

    // 填空例句：用不带下划线的空白槽，彻底杜绝双横杠！
    const clozeEl = $('#study-prompt-sentence');
    if (clozeEl) {
      if (currentWord.sen) {
        const re = new RegExp('\\b' + currentWord.word + '[a-z]*\\b', 'gi');
        clozeEl.innerHTML = currentWord.sen.replace(re, '<span class="cloze-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>');
        clozeEl.style.display = 'block';
      } else {
        clozeEl.style.display = 'none';
      }
    }

    const spellInput = $('#keyboard-answer');
    const kbWrap = $('#keyboard-input');
    const tipText = $('#study-tip-text');
    const revealBtn = $('#reveal-answer');

    if (currentInputMode === 'keyboard') {
      kbWrap?.removeAttribute('hidden');
      if (tipText) tipText.textContent = '输入回忆出的英文单词，敲回车即刻判定对错';
      if (revealBtn) {
        revealBtn.classList.remove('is-quick-mode');
        const span = revealBtn.querySelector('span');
        if (span) span.textContent = '想不起来了？点击直接看答案与解析 (或敲回车)';
      }
      if (spellInput) {
        spellInput.value = '';
        spellInput.classList.remove('is-right', 'is-wrong');
        setTimeout(() => spellInput.focus(), 80);
      }
    } else {
      kbWrap?.setAttribute('hidden', '');
      if (tipText) tipText.textContent = '心算模式：默想该词的中文释义与拼写，直接翻牌';
      if (revealBtn) {
        revealBtn.classList.add('is-quick-mode');
        const span = revealBtn.querySelector('span');
        if (span) span.textContent = '👀 点击翻牌查看详细解析 (或敲回车/空格)';
      }
      if (spellInput) spellInput.blur();
    }

    const card = $('#study-card');
    if (card) card.classList.remove('is-revealed');
    $('#card-front')?.removeAttribute('hidden');
    $('#card-back')?.setAttribute('hidden', '');

    renderQueueSidebar();
  }

  function revealCard() {
    if (Date.now() - lastWordSwitchedAt < 150) return;
    isSpellingSubmitting = false;
    if (isRevealed || !currentWord) return;
    isRevealed = true;

    // 释放输入框焦点，防止阻碍后续评分快捷键
    const spellInput = $('#keyboard-answer');
    if (spellInput) spellInput.blur();

    const wEl = $('#study-answer-word');
    if (wEl) wEl.textContent = currentWord.word;

    const ipaEl = $('#study-answer-ipa');
    if (ipaEl) ipaEl.textContent = currentWord.ipa || '';

    const posEl = $('#study-answer-pos');
    if (posEl) posEl.textContent = currentWord.pos || '重点词';

    const defEl = $('#study-answer-definition');
    if (defEl) defEl.textContent = currentWord.def || currentWord.definition || '';

    const mneEl = $('#study-answer-mnemonic');
    if (mneEl) {
      const wrap = mneEl.closest('.word-detail-card');
      if (currentWord.mne) {
        mneEl.textContent = currentWord.mne;
        if (wrap) wrap.style.display = 'block';
      } else {
        if (wrap) wrap.style.display = 'none';
      }
    }

    const senEl = $('#study-answer-sentence');
    if (senEl) senEl.textContent = currentWord.sen || '暂无例句';

    $('#study-card')?.classList.add('is-revealed');
    $('#card-front')?.setAttribute('hidden', '');
    $('#card-back')?.removeAttribute('hidden');

    if (autoAudioEnabled) {
      UI?.speakWord(currentWord.word);
    }
    UI?.refreshIcons();
  }

  // SM-2 组内循环
  function rateWord(rating) {
    if (!currentWord) return;

    if (rating === 'again') {
      studyStats.agains++;
      const w = studyQueue.shift();
      studyQueue.push(w);
      Audio?.playBeep?.(false);
      UI?.showToast('已加入组内稍后复习队列 ↺', 'info');
    } else if (rating === 'hard') {
      studyStats.agains++;
      const w = studyQueue.shift();
      studyQueue.push(w);
      Audio?.playBeep?.(true);
      UI?.showToast('已标记模糊，将在本组末尾重现', 'info');
    } else {
      studyQueue.shift();
      learnedInRound.add(currentWord.word);
      Audio?.playBeep?.(true);
      UI?.showToast(rating === 'easy' ? '秒杀！词汇掌握度提升 ⚡' : '已掌握！继续前进 👍', 'success');
      updateMissionDashboard();
    }

    renderNextCard();
  }

  let isSpellingSubmitting = false;

  function handleSpellingSubmit() {
    if (isRevealed) {
      rateWord('good');
      return;
    }
    if (isSpellingSubmitting) return;

    const input = $('#keyboard-answer');
    if (!input || !currentWord) return;
    const val = input.value.trim().toLowerCase();
    const target = currentWord.word.toLowerCase();

    if (!val) {
      revealCard();
      return;
    }

    isSpellingSubmitting = true;
    const isCorrect = val === target;
    UI?.flashSpellingResult(input, isCorrect, currentWord.word);
    setTimeout(() => {
      isSpellingSubmitting = false;
      revealCard();
    }, isCorrect ? 350 : 650);
  }

  function finishRound() {
    $('#study-card')?.setAttribute('hidden', '');
    $('#study-complete')?.removeAttribute('hidden');

    const total = studyRoundWords.length;
    const rate = Math.max(60, Math.min(100, Math.round((total / (total + studyStats.agains)) * 100)));

    $('#summary-total-words').textContent = total;
    $('#summary-mastery-rate').textContent = rate + '%';

    if (storage) {
      const today = getToday ? getToday() : new Date().toISOString().slice(0, 10);
      const sessionData = {
        type: 'study', // 明确区分背词打卡与阅读短文
        date: today,
        title: isYesterdayReviewMode ? `完成昨日重点词汇巩固 (${total} 词)` : `完成第 ${currentGroup} 组主动回忆 (${total} 词)`,
        body: studyRoundWords.map(w => `${w.word}: ${w.def || ''}${w.sen ? '\n  例: ' + w.sen : ''}`).join('\n\n'),
        words: studyRoundWords.map(w => w.word),
        genre: '背词打卡',
        difficulty: '四级',
        targetWordCount: total,
        source: isYesterdayReviewMode ? '昨日复习特训' : (isRandomMode ? '随机乱序' : `第 ${currentGroup} 组`),
        createdAt: new Date().toISOString(),
        definitions: studyRoundWords.map(w => ({ word: w.word, ipa: w.ipa, pos: w.pos, definition: w.def, explanation: w.mne || '' }))
      };
      storage.saveSession(sessionData);
      updateStreak();
      updateMissionDashboard();
      UI?.renderCalendar(storage.getSessions());

      // 若已绑定云端账号，后台静默自动同步
      if (Sync?.getAuth()?.token) {
        Sync.pushData().catch(() => {});
      }
    }

    $('#summary-streak-days').textContent = ($('#streak-count')?.textContent || '1') + ' 天';
    UI?.showToast('🎉 本组单词全部掌握，已记录今日打卡！', 'success');
  }

  function updateStreak() {
    const sessions = storage?.getSessions() || [];
    const el = $('#streak-count');
    if (!el) return;
    const dates = new Set(sessions.map(s => s.date).filter(Boolean));
    let streak = 0, curr = new Date();
    while (true) {
      const k = curr.getFullYear() + '-' + String(curr.getMonth() + 1).padStart(2, '0') + '-' + String(curr.getDate()).padStart(2, '0');
      if (dates.has(k)) {
        streak++;
        curr.setDate(curr.getDate() - 1);
      } else {
        if (streak === 0) {
          curr.setDate(curr.getDate() - 1);
          const yk = curr.getFullYear() + '-' + String(curr.getMonth() + 1).padStart(2, '0') + '-' + String(curr.getDate()).padStart(2, '0');
          if (dates.has(yk)) { streak++; curr.setDate(curr.getDate() - 1); continue; }
        }
        break;
      }
    }
    el.textContent = streak;
  }

  // 番茄钟
  function initPomodoro() {
    const toggleBtn = $('#pomodoro-toggle');
    const resetBtn = $('#pomodoro-reset');
    const modeBtn = $('#pomodoro-mode');
    const applyBtn = $('#pomodoro-apply');
    const minutesInput = $('#pomodoro-minutes');

    function updateDisplay() {
      const m = Math.floor(pomoLeftSec / 60);
      const s = pomoLeftSec % 60;
      const str = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      $('#pomodoro-time').textContent = str;
      const progress = Math.max(0, Math.min(100, ((pomoTotalSec - pomoLeftSec) / pomoTotalSec) * 100));
      $('#pomodoro-progress').style.width = progress + '%';
    }

    function tick() {
      if (pomoLeftSec > 0) {
        pomoLeftSec--;
        updateDisplay();
      } else {
        clearInterval(pomoTimer);
        pomoRunning = false;
        Audio?.playBeep?.(true);
        toggleBtn.innerHTML = '<i data-lucide="play"></i><span>开始专注</span>';
        if (!pomoIsBreak) {
          UI?.showToast('🍅 恭喜完成一轮专注！休息 5 分钟吧。', 'success');
          pomoIsBreak = true; pomoTotalSec = 5 * 60; pomoLeftSec = 5 * 60;
          $('#pomodoro-state').textContent = '休息时间 ☕';
        } else {
          UI?.showToast('🔔 休息结束，准备开始下一轮深度专注！', 'info');
          pomoIsBreak = false; pomoRound++;
          pomoTotalSec = (parseInt(minutesInput?.value) || 25) * 60;
          pomoLeftSec = pomoTotalSec;
          $('#pomodoro-state').textContent = '准备专注';
          $('#pomodoro-round').textContent = `第 ${pomoRound} 轮专注`;
        }
        updateDisplay();
        UI?.refreshIcons();
      }
    }

    toggleBtn?.addEventListener('click', () => {
      if (!pomoRunning) {
        pomoRunning = true;
        pomoTimer = setInterval(tick, 1000);
        toggleBtn.innerHTML = '<i data-lucide="pause"></i><span>暂停计时</span>';
        $('#pomodoro-state').textContent = pomoIsBreak ? '休息中...' : '深度专注中...';
      } else {
        pomoRunning = false;
        clearInterval(pomoTimer);
        toggleBtn.innerHTML = '<i data-lucide="play"></i><span>继续专注</span>';
        $('#pomodoro-state').textContent = '已暂停';
      }
      UI?.refreshIcons();
    });

    resetBtn?.addEventListener('click', () => {
      clearInterval(pomoTimer);
      pomoRunning = false;
      pomoLeftSec = pomoTotalSec;
      updateDisplay();
      toggleBtn.innerHTML = '<i data-lucide="play"></i><span>开始专注</span>';
      $('#pomodoro-state').textContent = pomoIsBreak ? '准备休息' : '准备开始';
      UI?.refreshIcons();
    });

    modeBtn?.addEventListener('click', () => {
      clearInterval(pomoTimer);
      pomoRunning = false;
      pomoIsBreak = !pomoIsBreak;
      pomoTotalSec = (pomoIsBreak ? 5 : (parseInt(minutesInput?.value) || 25)) * 60;
      pomoLeftSec = pomoTotalSec;
      updateDisplay();
      toggleBtn.innerHTML = '<i data-lucide="play"></i><span>开始计时</span>';
      $('#pomodoro-state').textContent = pomoIsBreak ? '短休息模式' : '专注模式';
      UI?.refreshIcons();
    });

    applyBtn?.addEventListener('click', () => {
      const mins = Math.max(1, Math.min(180, parseInt(minutesInput.value) || 25));
      minutesInput.value = mins;
      pomoTotalSec = mins * 60;
      pomoLeftSec = pomoTotalSec;
      updateDisplay();
      UI?.showToast(`专注时长已设为 ${mins} 分钟`);
    });

    // 白噪音按钮响应：仅保留用户好评的温润细雨与深海潮汐自然音
    $$('.ambient-sound-btn').forEach(btn => {
      btn.onclick = () => {
        $$('.ambient-sound-btn').forEach(b => b.classList.remove('is-active'));
        const sound = btn.dataset.sound;
        
        if (sound === 'rain') {
          Audio?.playRainSound?.();
          btn.classList.add('is-active');
          UI?.showToast('🌧️ 已开启窗外温润细雨伴读');
        } else if (sound === 'waves') {
          Audio?.playWavesSound?.();
          btn.classList.add('is-active');
          UI?.showToast('🌊 已开启静谧深海潮汐伴读');
        } else {
          Audio?.stopAmbientSound?.();
          btn.classList.add('is-active');
          UI?.showToast('已关闭背景声音');
        }
      };
    });

    updateDisplay();
  }

  function bindEvents() {
    $$('[data-view-target]').forEach(btn => {
      btn.addEventListener('click', () => UI?.switchView(btn.dataset.viewTarget));
    });

    // 模式切换胶囊：绑定 .mode-segment-btn，支持拼写与心算瞬时切换
    $$('.mode-segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.inputMode;
        if (!mode) return;
        currentInputMode = mode;

        $$('.mode-segment-btn').forEach(b => b.classList.toggle('is-active', b.dataset.inputMode === mode));

        const kbWrap = $('#keyboard-input');
        const tipText = $('#study-tip-text');
        const revealBtn = $('#reveal-answer');
        const spellInput = $('#keyboard-answer');

        if (mode === 'keyboard') {
          kbWrap?.removeAttribute('hidden');
          if (tipText) tipText.textContent = '输入回忆出的英文单词，敲回车即刻判定对错';
          if (revealBtn) {
            revealBtn.classList.remove('is-quick-mode');
            const span = revealBtn.querySelector('span');
            if (span) span.textContent = '想不起来了？点击直接看答案与解析 (或敲回车)';
          }
          if (spellInput && !isRevealed) {
            spellInput.focus();
          }
        } else {
          kbWrap?.setAttribute('hidden', '');
          if (tipText) tipText.textContent = '心算模式：默想该词的中文释义与拼写，直接翻牌';
          if (revealBtn) {
            revealBtn.classList.add('is-quick-mode');
            const span = revealBtn.querySelector('span');
            if (span) span.textContent = '👀 点击翻牌查看详细解析 (或敲回车/空格)';
          }
          if (spellInput) spellInput.blur();
        }
      });
    });

    $('#reveal-answer')?.addEventListener('click', () => {
      if (currentInputMode === 'keyboard' && !isRevealed) {
        const input = $('#keyboard-answer');
        if (input && input.value.trim()) {
          handleSpellingSubmit();
        } else {
          revealCard();
        }
      } else {
        revealCard();
      }
    });

    $('#keyboard-answer')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (isRevealed) {
          rateWord('good');
        } else {
          handleSpellingSubmit();
        }
      } else if (isRevealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const map = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
        rateWord(map[e.key]);
      }
    });

    $$('.rating-btn').forEach(btn => {
      btn.addEventListener('click', () => rateWord(btn.dataset.rating));
    });

    $('#play-word-audio')?.addEventListener('click', () => {
      if (currentWord) UI?.speakWord(currentWord.word);
    });

    $('#auto-audio-toggle')?.addEventListener('click', () => {
      autoAudioEnabled = !autoAudioEnabled;
      $('#auto-audio-toggle')?.classList.toggle('is-active', autoAudioEnabled);
      UI?.showToast(autoAudioEnabled ? '已开启自动发音' : '已关闭自动发音');
    });

    $('#restart-study')?.addEventListener('click', () => startNewRound());

    $('#goto-reading-btn')?.addEventListener('click', () => {
      const words = studyRoundWords.map(w => w.word);
      const input = $('#reading-word-input');
      if (input) { input.value = words.join(', '); UI?.renderWordInput(words); }
      UI?.switchView('reading');
      UI?.showToast(`已将刚背诵的 ${words.length} 个生词填入阅读室 ✨`, 'success');
    });

    $('#import-studied-words-btn')?.addEventListener('click', () => {
      if (studyRoundWords.length === 0) { UI?.showToast('暂无背词记录，先去背一组吧'); return; }
      const words = studyRoundWords.map(w => w.word);
      const input = $('#reading-word-input');
      if (input) { input.value = words.join(', '); UI?.renderWordInput(words); UI?.showToast(`已导入本轮 ${words.length} 个生词`); }
    });

    $('#reading-word-input')?.addEventListener('input', (e) => {
      UI?.renderWordInput(parseWords ? parseWords(e.target.value) : []);
    });

    $('#clear-reading-words')?.addEventListener('click', () => {
      const input = $('#reading-word-input');
      if (input) { input.value = ''; UI?.renderWordInput([]); }
    });

    function getReadingSessions() {
      const all = storage?.getSessions() || [];
      return all.filter(s => s.type === 'reading' || (!s.type && s.genre !== '背词打卡'));
    }

    function refreshReadingLibrary(activeId = '') {
      const readings = getReadingSessions();
      UI?.renderReadingDirectory(readings, activeId, (sid) => {
        const s = readings.find(x => x.id === sid);
        if (s) {
          UI?.renderReading(s, (baseWord, contextSentence) => {
            const def = (s.definitions || []).find(d => d.word.toLowerCase() === baseWord.toLowerCase())
              || (window.LexoraApi?.lookupLexicon ? window.LexoraApi.lookupLexicon(baseWord) : { word: baseWord });
            UI?.openWordSheet(def || { word: baseWord }, contextSentence);
          });
          refreshReadingLibrary(sid);
        }
      });
    }

    $('#reading-generate-button')?.addEventListener('click', async () => {
      const raw = $('#reading-word-input')?.value || '';
      const words = parseWords ? parseWords(raw) : [];
      if (words.length === 0) { UI?.showToast('请至少输入 1 个有效英文单词'); return; }

      const genre = $('#reading-genre-select')?.value || '日常故事';
      const difficulty = $('#reading-difficulty-select')?.value || '四级';
      const targetWordCount = parseInt($('#reading-length-select')?.value || '120', 10);
      const settings = storage?.getSettings() || {};

      UI?.setGenerating(true);
      let session = null;
      try {
        session = await generateReading({ words, genre, difficulty, targetWordCount }, settings);
        session.type = 'reading';
      } catch (err) {
        console.warn('API 短文生成回退到离线精选引擎:', err);
        UI?.showToast('已加载精选情境短文', 'info');
        if (createDemoSession) {
          session = createDemoSession(words, genre, difficulty, targetWordCount);
          session.type = 'reading';
        }
      } finally {
        UI?.setGenerating(false);
      }

      if (session) {
        const savedSession = storage?.saveSession(session);
        const activeId = savedSession?.id || session.id;

        UI?.renderReading(savedSession || session, (baseWord, contextSentence) => {
          const def = (session.definitions || []).find(d => d.word.toLowerCase() === baseWord.toLowerCase())
            || (window.LexoraApi?.lookupLexicon ? window.LexoraApi.lookupLexicon(baseWord) : { word: baseWord });
          UI?.openWordSheet(def || { word: baseWord }, contextSentence);
        });

        refreshReadingLibrary(activeId);
        UI?.renderCalendar(storage?.getSessions() || []);
        updateStreak();
        Sync?.autoSave?.();
        UI?.showToast('🎉 短文已生成！点击文中高亮词可即刻查词与发音。', 'success');
      }
    });

    $('#copy-button')?.addEventListener('click', async () => {
      const title = $('#reading-article-title')?.textContent || 'YUKI Reading';
      const meta = $('#reading-article-meta')?.textContent || '';
      const ps = $$('#reading-article-body p').map(p => p.textContent.trim()).filter(Boolean);
      const text = `${title}\n${meta ? '[' + meta + ']\n\n' : '\n'}${ps.join('\n\n')}`;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        UI?.showToast('排版短文已复制到剪贴板 📋');
      } catch (e) { UI?.showToast('复制失败，请手动选取'); }
    });

    $('#export-button')?.addEventListener('click', () => {
      const title = $('#reading-article-title')?.textContent || 'YUKI_Reading';
      const meta = $('#reading-article-meta')?.textContent || '';
      const ps = $$('#reading-article-body p').map(p => p.textContent.trim()).filter(Boolean);
      const text = `${title}\n${meta ? '[' + meta + ']\n\n' : '\n'}${ps.join('\n\n')}`;
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      UI?.showToast('已导出纯文本文件 📥');
    });

    $('#close-sheet')?.addEventListener('click', () => UI?.closeWordSheet());
    $('#sheet-backdrop')?.addEventListener('click', () => UI?.closeWordSheet());
    $('#open-manual')?.addEventListener('click', () => UI?.openManual());
    $('#close-manual')?.addEventListener('click', () => UI?.closeManual());
    $('#manual-backdrop')?.addEventListener('click', () => UI?.closeManual());

    $('#theme-toggle')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('lexora.theme', next);
      UI?.showToast(`已切换至${next === 'light' ? '浅色' : '深色'}模式`);
    });

    // 选组与随机
    $('#lesson-group-select')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val) startNewRound(val);
    });

    $('#shuffle-mode-toggle')?.addEventListener('click', () => {
      isRandomMode = !isRandomMode;
      const btn = $('#shuffle-mode-toggle');
      if (btn) btn.classList.toggle('is-active', isRandomMode);
      UI?.showToast(isRandomMode ? '🎲 随机乱序模式已开启（全量洗牌）' : '已恢复顺序背词模式');
      startNewRound();
    });

    // 设置中心
    const settingsForm = $('#settings-form');
    if (settingsForm) {
      const baseUrlInput = $('#api-base-url');
      const modelInput = $('#api-model');
      const modelSelect = $('#api-model-select');
      const apiKeyInput = $('#api-key');
      const saved = storage?.getSettings() || {};
      if (baseUrlInput) baseUrlInput.value = saved.baseUrl || 'https://integrate.api.nvidia.com/v1';
      if (apiKeyInput) apiKeyInput.value = saved.apiKey || '';
      if (modelInput && saved.model) {
        modelInput.value = saved.model;
      }

      $('#test-connection')?.addEventListener('click', async () => {
        const btn = $('#test-connection');
        const prev = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>检测中...</span>';
        UI?.refreshIcons();
        try {
          const res = await detectModels({ baseUrl: baseUrlInput?.value?.trim(), apiKey: apiKeyInput?.value?.trim() });
          if (modelSelect && res.models?.length) {
            modelSelect.style.display = 'block';
            modelSelect.innerHTML = '<option value="">从检测结果选择...</option>' + res.models.map(m => `<option value="${m}">${m}</option>`).join('');
            modelSelect.onchange = () => {
              if (modelSelect.value && modelInput) {
                modelInput.value = modelSelect.value;
              }
            };
          }
          UI?.showToast(`✅ 成功检测到 ${res.models?.length || 0} 个可用模型！`, 'success');
        } catch (e) {
          UI?.showToast('检测失败: ' + (e.message || '请检查接口地址与密钥'), 'error');
        } finally {
          btn.innerHTML = prev;
          UI?.refreshIcons();
        }
      });

      $('#paste-api-key')?.addEventListener('click', async () => {
        try {
          if (navigator.clipboard?.readText) {
            const text = await navigator.clipboard.readText();
            if (apiKeyInput && text) { apiKeyInput.value = text.trim(); UI?.showToast('已从剪贴板粘贴密钥'); }
          }
        } catch (e) { UI?.showToast('请手动粘贴'); }
      });

      $('#toggle-api-key')?.addEventListener('click', () => {
        if (!apiKeyInput) return;
        const isPass = apiKeyInput.type === 'password';
        apiKeyInput.type = isPass ? 'text' : 'password';
        const icon = $('#toggle-api-key i');
        if (icon) icon.setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
        UI?.refreshIcons();
      });

      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        storage?.saveSettings({ baseUrl: baseUrlInput?.value?.trim(), model: modelInput?.value?.trim() || '', apiKey: apiKeyInput?.value?.trim() });
        UI?.showToast('设置已保存：阅读生成与 AI 对话全站同步生效 ✅', 'success');
        window.dispatchEvent(new CustomEvent('settingsupdated'));
      });
    }

    // 全局背词快捷键：心算与翻牌极速流
    document.addEventListener('keydown', (e) => {
      const learnView = $('.view[data-view="learn"]');
      if (!learnView || !learnView.classList.contains('is-active')) return;

      const isModalOpen = $('#auth-modal') && !$('#auth-modal').hasAttribute('hidden') && $('#auth-modal').style.display !== 'none';
      if (isModalOpen) return;

      const active = document.activeElement;
      const isInputFocused = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

      // 1. 卡片已经翻开状态：无论焦点在哪里，按数字 1~4 或 Enter/Space 均可极速评级切词
      if (isRevealed) {
        if (e.key === '1') {
          e.preventDefault();
          rateWord('again');
        } else if (e.key === '2') {
          e.preventDefault();
          rateWord('hard');
        } else if (e.key === '3') {
          e.preventDefault();
          rateWord('good');
        } else if (e.key === '4') {
          e.preventDefault();
          rateWord('easy');
        } else if (e.code === 'Space' || e.key === 'Enter') {
          // 翻牌后敲回车或空格：顺畅判定为已掌握，极速切词
          e.preventDefault();
          rateWord('good');
        }
        return;
      }

      // 2. 卡片尚未翻开状态：
      // 如果正在拼写输入框中打字，回车由输入框 keydown 负责判定
      if (isInputFocused && currentInputMode === 'keyboard') {
        return;
      }

      // 心算模式或焦点在别处：按空格或回车立即翻牌
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        revealCard();
      }
    });

    $('#daily-goal-select')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val) {
        wordsPerGroup = Math.max(3, Math.min(50, val));
        updateGroupSelector();
        startNewRound(1);
      }
    });

    // 1. 今日目标词数切换
    $('#daily-target-words')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val) {
        storage?.setDailyGoal(val);
        updateMissionDashboard();
        Sync?.autoSave?.();
        UI?.showToast(`今日学习目标已更新为 ${val} 词 🎯`);
      }
    });

    // 2. 昨日复习开启 / 恢复选组切换
    $('#start-yesterday-review-btn')?.addEventListener('click', () => {
      if (isYesterdayReviewMode) {
        isYesterdayReviewMode = false;
        startNewRound(currentGroup);
        updateMissionDashboard();
        UI?.showToast('已恢复常规选组背词模式');
      } else {
        startYesterdayReview();
      }
    });

    // 3. 云端多端同步中心视窗
    $('#open-auth-modal')?.addEventListener('click', () => {
      UI?.openAuthModal();
      UI?.renderAuthModal(Sync?.getAuth(), authActiveTab);
    });
    $('#close-auth-modal')?.addEventListener('click', () => UI?.closeAuthModal());
    $('#auth-modal-backdrop')?.addEventListener('click', () => UI?.closeAuthModal());

    $$('.auth-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        authActiveTab = btn.dataset.authTab || 'login';
        UI?.renderAuthModal(Sync?.getAuth(), authActiveTab);
      });
    });

    $('#auth-user-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = $('#auth-username')?.value?.trim();
      const password = $('#auth-password')?.value?.trim();
      const submitBtn = $('#btn-submit-auth');
      const prevText = submitBtn.innerHTML;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>正在连接云端...</span>';
      UI?.refreshIcons();

      try {
        if (authActiveTab === 'register') {
          await Sync?.register(username, password);
          UI?.showToast('🎉 账号注册成功！数据已自动保存进云端', 'success');
        } else {
          await Sync?.login(username, password);
          UI?.showToast(`👋 欢迎回来，${username}！数据已自动拉取并同步`, 'success');
        }
        updateMissionDashboard();
        UI?.renderCalendar(storage?.getSessions() || []);
        UI?.renderAuthModal(Sync?.getAuth());
        setTimeout(() => UI?.closeAuthModal(), 600);
      } catch (err) {
        UI?.showToast(err.message || '连接失败，请检查账号与密码', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = prevText;
        UI?.refreshIcons();
      }
    });

    $('#btn-manual-sync')?.addEventListener('click', async () => {
      const btn = $('#btn-manual-sync');
      const prev = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>同步中...</span>';
      UI?.refreshIcons();
      try {
        await Sync?.syncNow();
        updateMissionDashboard();
        UI?.renderCalendar(storage?.getSessions() || []);
        UI?.renderAuthModal(Sync?.getAuth());
        UI?.showToast('✅ 云端双向同步完成，所有设备数据一致！', 'success');
      } catch (err) {
        UI?.showToast('同步失败: ' + (err.message || '网络异常'), 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = prev;
        UI?.refreshIcons();
      }
    });

    $('#btn-auth-logout')?.addEventListener('click', () => {
      Sync?.logout();
      UI?.renderAuthModal(Sync?.getAuth(), 'login');
      UI?.showToast('已退出登录，本地学习数据已完整保留');
    });

    $('#btn-export-backup')?.addEventListener('click', () => {
      const data = storage?.exportAllData() || {};
      const today = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `yuki_vocabulary_backup_${today}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      UI?.showToast('已导出离线备份 JSON 文件 📥');
    });

    const fileInput = $('#backup-file-input');
    $('#btn-import-backup')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const json = JSON.parse(evt.target.result);
          const ok = storage?.importAllData(json, 'merge');
          if (ok) {
            updateMissionDashboard();
            UI?.renderCalendar(storage?.getSessions() || []);
            UI?.showToast('🎉 数据导入成功并已合并！', 'success');
            UI?.closeAuthModal();
          } else {
            UI?.showToast('导入失败，文件格式不匹配', 'error');
          }
        } catch (err) {
          UI?.showToast('解析 JSON 备份文件失败', 'error');
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  async function init() {
    const savedTheme = localStorage.getItem('lexora.theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    initPomodoro();
    bindEvents();
    updateGroupSelector();
    startNewRound(1);
    updateStreak();
    updateMissionDashboard();

    // 监听云同步状态通知
    Sync?.onSyncStateChange?.((state) => {
      UI?.renderSyncStatus(state, Sync?.getAuth());
      if (state === 'synced') {
        updateMissionDashboard();
        UI?.renderCalendar(storage?.getSessions() || []);
      }
    });
    UI?.renderSyncStatus(Sync?.getState() || 'offline', Sync?.getAuth() || {});

    const sessions = storage?.getSessions() || [];
    UI?.renderCalendar(sessions);

    const readingSessions = sessions.filter(s => s.type === 'reading' || (!s.type && s.genre !== '背词打卡'));
    UI?.renderReadingDirectory(readingSessions, '', (sid) => {
      const s = readingSessions.find(x => x.id === sid);
      if (s) {
        UI?.switchView('reading');
        UI?.renderReading(s, (baseWord, contextSentence) => {
          const def = (s.definitions || []).find(d => d.word.toLowerCase() === baseWord.toLowerCase())
            || (window.LexoraApi?.lookupLexicon ? window.LexoraApi.lookupLexicon(baseWord) : { word: baseWord });
          UI?.openWordSheet(def || { word: baseWord }, contextSentence);
        });
      }
    });

    UI?.refreshIcons();
    console.log('Lexora Active Recall Clean Engine Ready.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
