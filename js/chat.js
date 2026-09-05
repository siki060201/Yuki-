/**
 * Lexora AI Assistant - 原生单页 AI 学习对话助手模块
 * 
 * [开源致谢与设计启发 / Credits & Attribution]
 * 本模块在交互架构、多会话管理与流式消息管道上深度借鉴并吸收自优秀开源项目：
 * STA1N156/AI-Chat (https://github.com/STA1N156/AI-Chat)
 * 原始作者：STA1N (https://github.com/STA1N156)
 * 在此特别向 STA1N156 原作者表达诚挚致敬与开源感谢！
 */

(() => {
  'use strict';

  const STORAGE_KEY = 'lexora_chat_sessions_v1';
  // 严格杜绝硬编码 API Key，保障多用户云端部署时每个人的密钥独立安全
  const DEFAULT_FALLBACK_BASE = 'https://api.openai.com/v1';
  const DEFAULT_FALLBACK_MODEL = 'gpt-4o-mini';

  const getUI = () => window.LexoraUI || window.UI;

  const SYSTEM_PROMPT = `You are Lexora AI, an elite, patient, and warm English learning tutor and language specialist.
Your core mission is to help Chinese students master English through active recall, deep grammatical comprehension, etymology, real-world collocations, and communicative practice.
When explaining words or grammar:
1. Provide accurate phonetic transcription (IPA), part of speech, concise Chinese definitions, and natural sample sentences.
2. Highlight memory hooks, roots/affixes, and nuances between confusing synonyms.
3. Be encouraging, clear, formatted neatly with markdown bolding, bullet points, and code blocks when appropriate.`;

  // 状态管理
  let state = {
    sessions: [],
    activeSessionId: null,
    isGenerating: false,
    abortController: null
  };

  // DOM 元素缓存
  const elements = {};

  function initElements() {
    elements.view = document.getElementById('view-chat');
    elements.sidebar = document.getElementById('chat-sidebar');
    elements.toggleSidebarBtn = document.getElementById('chat-toggle-sidebar-btn');
    elements.sessionsList = document.getElementById('chat-sessions-list');
    elements.btnNew = document.getElementById('chat-btn-new');
    elements.btnClearAll = document.getElementById('chat-btn-clear-all');
    elements.activeTitle = document.getElementById('chat-active-title');
    elements.activeSub = document.getElementById('chat-active-sub');
    elements.activeModel = document.getElementById('chat-active-model');
    elements.messagesContainer = document.getElementById('chat-messages-container');
    elements.inputBox = document.getElementById('chat-input-box');
    elements.btnSend = document.getElementById('chat-btn-send');
  }

  // 本地存储
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
        state.activeSessionId = data.activeSessionId || null;
      }
    } catch (e) {
      console.warn('Failed to parse chat sessions from storage:', e);
    }

    if (!state.sessions || state.sessions.length === 0) {
      createInitialSession();
    } else if (!state.activeSessionId || !state.sessions.find(s => s.id === state.activeSessionId)) {
      state.activeSessionId = state.sessions[0].id;
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId
      }));
    } catch (e) {
      console.warn('Failed to save chat sessions:', e);
    }
  }

  function createInitialSession() {
    const session = {
      id: 'session_' + Date.now(),
      title: '学习助教引导',
      createdAt: Date.now(),
      messages: [
        {
          role: 'assistant',
          content: '👋 你好！我是你的 **Lexora 专属 AI 英语助教**。\n\n无论是在背词中遇到生词考点、阅读短文中碰到长难句，还是想进行雅思口语模拟、语法辨析，我都可以为你即时解答！\n\n💡 *试着点击下方的快捷标签，或直接在输入框中向我提问吧！*',
          time: Date.now()
        }
      ]
    };
    state.sessions = [session];
    state.activeSessionId = session.id;
    saveToStorage();
  }

  function getActiveSession() {
    return state.sessions.find(s => s.id === state.activeSessionId) || state.sessions[0];
  }

  // 会话操作
  function createNewSession(initialTitle = '新对话') {
    if (state.isGenerating && state.abortController) {
      state.abortController.abort();
    }
    const session = {
      id: 'session_' + Date.now(),
      title: initialTitle,
      createdAt: Date.now(),
      messages: [
        {
          role: 'assistant',
          content: '已为你开启全新对话！请告诉我你想探讨的英语单词、语法难点或练习场景。',
          time: Date.now()
        }
      ]
    };
    state.sessions.unshift(session);
    state.activeSessionId = session.id;
    saveToStorage();
    renderAll();
    if (window.innerWidth < 768 && elements.sidebar) {
      elements.sidebar.classList.remove('is-open');
    }
    elements.inputBox?.focus();
  }

  function switchSession(sessionId) {
    if (state.activeSessionId === sessionId) return;
    if (state.isGenerating && state.abortController) {
      state.abortController.abort();
    }
    state.activeSessionId = sessionId;
    saveToStorage();
    renderAll();
    if (window.innerWidth < 768 && elements.sidebar) {
      elements.sidebar.classList.remove('is-open');
    }
  }

  function deleteSession(sessionId, e) {
    e?.stopPropagation();
    if (state.sessions.length <= 1) {
      clearAllSessions();
      return;
    }
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    if (state.activeSessionId === sessionId) {
      state.activeSessionId = state.sessions[0].id;
    }
    saveToStorage();
    renderAll();
  }

  function clearAllSessions() {
    if (state.isGenerating && state.abortController) {
      state.abortController.abort();
    }
    createInitialSession();
    renderAll();
    getUI()?.showToast('已重置并清空所有历史对话');
  }

  // 渲染函数
  function renderSessionsList() {
    if (!elements.sessionsList) return;
    elements.sessionsList.innerHTML = '';

    state.sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'chat-session-item' + (session.id === state.activeSessionId ? ' is-active' : '');
      item.onclick = () => switchSession(session.id);

      item.innerHTML = `
        <i data-lucide="message-square" class="chat-session-icon"></i>
        <span class="chat-session-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</span>
        <button type="button" class="chat-session-del-btn" title="删除该对话" aria-label="删除">
          <i data-lucide="x"></i>
        </button>
      `;

      const delBtn = item.querySelector ? item.querySelector('.chat-session-del-btn') : null;
      if (delBtn) {
        delBtn.onclick = (e) => deleteSession(session.id, e);
      }

      elements.sessionsList.appendChild(item);
    });

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  function renderMessages() {
    if (!elements.messagesContainer) return;
    const session = getActiveSession();
    if (!session) return;

    if (elements.activeTitle) {
      elements.activeTitle.textContent = session.title || 'AI 智能学习对话';
    }

    elements.messagesContainer.innerHTML = '';

    session.messages.forEach((msg, idx) => {
      appendMessageDOM(msg.role, msg.content, false);
    });

    scrollToBottom();
  }

  function appendMessageDOM(role, content, isTemporary = false) {
    if (!elements.messagesContainer) return null;

    const row = document.createElement('div');
    row.className = `chat-message-row role-${role}` + (isTemporary ? ' is-temp' : '');

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.innerHTML = role === 'user' 
      ? '<i data-lucide="user"></i>' 
      : '<i data-lucide="bot"></i>';

    const contentBox = document.createElement('div');
    contentBox.className = 'chat-message-content';

    const bubble = document.createElement('div');
    bubble.className = 'chat-message-bubble';
    bubble.innerHTML = renderMarkdown(content);

    // 复制按钮与代码处理
    bindBubbleActions(bubble, content);

    contentBox.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(contentBox);

    elements.messagesContainer.appendChild(row);

    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }

    scrollToBottom();
    return row;
  }

  function scrollToBottom() {
    if (!elements.messagesContainer) return;
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }

  // 绑定气泡复制与交互
  function bindBubbleActions(bubble, text) {
    // 为代码块添加复制按钮
    const preList = bubble.querySelectorAll('pre');
    preList.forEach(pre => {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'code-copy-btn';
      copyBtn.innerHTML = '<i data-lucide="copy"></i><span>复制</span>';
      copyBtn.onclick = () => {
        const codeText = pre.querySelector('code')?.innerText || pre.innerText;
        navigator.clipboard?.writeText(codeText).then(() => {
          copyBtn.innerHTML = '<i data-lucide="check"></i><span>已复制</span>';
          setTimeout(() => {
            copyBtn.innerHTML = '<i data-lucide="copy"></i><span>复制</span>';
            if (window.lucide?.createIcons) window.lucide.createIcons();
          }, 2000);
        });
      };
      pre.appendChild(copyBtn);
    });
  }

  // 轻量 Markdown 渲染器 (支持标题、列表、粗体、代码块等)
  function renderMarkdown(md) {
    if (!md) return '';
    let html = escapeHtml(md);

    // 代码块 ```lang ... ```
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // 行内代码 `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体 **bold**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 斜体 *italic*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 无序列表 - item
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // 换行替换
    html = html.replace(/\n\n+/g, '</p><p>');
    html = html.replace(/\n/g, '<br/>');

    return `<p>${html}</p>`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 消息发送与网络请求
  async function handleSend() {
    if (state.isGenerating) {
      if (state.abortController) {
        state.abortController.abort();
        state.isGenerating = false;
        updateSendBtnUI();
        getUI()?.showToast('已中断本次生成');
      }
      return;
    }

    const text = elements.inputBox?.value.trim();
    if (!text) return;

    const session = getActiveSession();
    if (!session) return;

    // 添加用户消息
    const userMsg = { role: 'user', content: text, time: Date.now() };
    session.messages.push(userMsg);

    // 自动更新对话标题（若还是新对话或首个问题）
    if (session.messages.filter(m => m.role === 'user').length === 1 || session.title === '新对话') {
      session.title = text.slice(0, 16) + (text.length > 16 ? '...' : '');
    }

    saveToStorage();
    renderSessionsList();
    appendMessageDOM('user', text);

    // 清空输入框并重置高度
    if (elements.inputBox) {
      elements.inputBox.value = '';
      elements.inputBox.style.height = 'auto';
    }

    // 显示 Assistant 占位消息
    state.isGenerating = true;
    updateSendBtnUI();

    const tempRow = appendMessageDOM('assistant', '正在思考中...', true);
    const bubble = tempRow.querySelector('.chat-message-bubble');

    state.abortController = new AbortController();

    // 读取当前登录用户/当前客户端保存在本地的专属配置（严格个人隔离，防止串号）
    const settings = window.LexoraStorage?.getSettings ? window.LexoraStorage.getSettings() : {};
    const baseUrl = (settings.baseUrl && settings.baseUrl.trim()) ? settings.baseUrl.trim().replace(/\/+$/, '') : DEFAULT_FALLBACK_BASE;
    const apiKey = (settings.apiKey && settings.apiKey.trim()) ? settings.apiKey.trim() : '';
    const model = (settings.model && settings.model.trim()) ? settings.model.trim() : DEFAULT_FALLBACK_MODEL;

    if (elements.activeModel) {
      elements.activeModel.textContent = apiKey ? model : '未配置个人密钥';
    }

    // 严格校验：若未配置个人 API Key，拒绝请求并指引用户到设置页填写专属密钥
    if (!apiKey) {
      state.isGenerating = false;
      updateSendBtnUI();
      tempRow.classList.remove('is-temp');
      const tipMsg = `🔐 **请先在设置中配置您的 API Key**\n\n「AI 语境阅读短文」与「AI 智能对话助教」**全站共用同一套接口配置**。一处保存，全局立即生效！\n\n👉 <button type="button" class="chat-jump-settings-btn" data-view-target="settings" style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;margin-top:6px;border-radius:12px;background:#007aff;color:#fff;border:none;font-size:12px;font-weight:600;cursor:pointer;"><span>前往系统设置配置密钥</span><i data-lucide="arrow-right"></i></button>`;
      bubble.innerHTML = renderMarkdown(tipMsg);
      const jumpBtn = bubble.querySelector('.chat-jump-settings-btn');
      jumpBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        getUI()?.switchView('settings');
      });
      if (window.lucide?.createIcons) window.lucide.createIcons();

      session.messages.push({
        role: 'assistant',
        content: '请先前往系统设置配置 API Key 与模型（全站共用）。',
        time: Date.now()
      });
      saveToStorage();
      getUI()?.showToast('请在系统设置中配置个人 API Key（全站共用）', 'warning');
      return;
    }

    // 构建上下文
    const messagesPayload = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...session.messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
    ];

    let fullAnswer = '';

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: messagesPayload,
          temperature: 0.7,
          stream: true
        }),
        signal: state.abortController.signal
      });

      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})：${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');

      if (!reader) {
        // 非流式回退
        const data = await response.json();
        fullAnswer = data?.choices?.[0]?.message?.content || '未获取到回复内容。';
        bubble.innerHTML = renderMarkdown(fullAnswer);
      } else {
        // SSE 流式接收
        bubble.innerHTML = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullAnswer += delta;
                bubble.innerHTML = renderMarkdown(fullAnswer);
                scrollToBottom();
              }
            } catch (err) {
              // 忽略个别片段解析错误
            }
          }
        }
      }

      tempRow.classList.remove('is-temp');
      bindBubbleActions(bubble, fullAnswer);

      // 持久化助手消息
      session.messages.push({
        role: 'assistant',
        content: fullAnswer || '（回复完毕）',
        time: Date.now()
      });
      saveToStorage();

    } catch (err) {
      if (err.name === 'AbortError') {
        fullAnswer = fullAnswer ? (fullAnswer + ' *(已中断)*') : '*(生成已取消)*';
      } else {
        fullAnswer = `⚠️ **请求出现错误**：${err.message || err}\n\n*提示：可在系统设置中核对 API Key、接口地址和模型名称。*`;
      }
      tempRow.classList.remove('is-temp');
      bubble.innerHTML = renderMarkdown(fullAnswer);
      session.messages.push({
        role: 'assistant',
        content: fullAnswer,
        time: Date.now()
      });
      saveToStorage();
    } finally {
      state.isGenerating = false;
      state.abortController = null;
      updateSendBtnUI();
      scrollToBottom();
    }
  }

  function updateSendBtnUI() {
    if (!elements.btnSend) return;
    if (state.isGenerating) {
      elements.btnSend.innerHTML = '<i data-lucide="square"></i><span>停止</span>';
      elements.btnSend.classList.add('is-stopping');
      elements.btnSend.title = '停止生成';
    } else {
      elements.btnSend.innerHTML = '<i data-lucide="send"></i><span>发送</span>';
      elements.btnSend.classList.remove('is-stopping');
      elements.btnSend.title = '发送消息';
    }
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  // 快捷预设与辅助功能
  function bindPresets() {
    // 快捷助学 chips
    document.querySelectorAll('.chat-preset-chip').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.preset;
        let promptText = '';
        if (type === 'grammar') {
          promptText = '请详细拆解并剖析以下语法现象与考点规则：\n';
        } else if (type === 'sentence') {
          promptText = '请结合地道语境，用这个单词给出 3 个四六级/考研级别的地道高分例句：\n';
        } else if (type === 'reading') {
          promptText = '请帮我精读并逐句拆解以下长难句（说明主干结构、修饰成分与精准译文）：\n';
        } else if (type === 'oral') {
          promptText = '我想模拟一场 5 分钟的日常/雅思英语对话。请你扮演考官并给出第一句开场白：';
        }
        if (elements.inputBox) {
          elements.inputBox.value = promptText;
          elements.inputBox.focus();
          autoResizeTextarea(elements.inputBox);
        }
      };
    });

    // 快捷标签 prompt tags
    document.querySelectorAll('.chat-quick-prompt-tag').forEach(tag => {
      tag.onclick = () => {
        const text = tag.dataset.prompt;
        if (elements.inputBox && text) {
          elements.inputBox.value = text;
          elements.inputBox.focus();
          autoResizeTextarea(elements.inputBox);
        }
      };
    });
  }

  function exportCurrentConversation() {
    const session = getActiveSession();
    if (!session || !session.messages.length) {
      getUI()?.showToast('当前暂无可导出的对话记录');
      return;
    }

    let md = `# ${session.title || 'AI 对话记录'}\n\n`;
    md += `*导出时间: ${new Date().toLocaleString('zh-CN')}*\n\n---\n\n`;

    session.messages.forEach(m => {
      const roleName = m.role === 'user' ? '👤 学习者 (User)' : '🤖 AI 助教 (Lexora Assistant)';
      md += `### ${roleName}\n\n${m.content}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lexora-Chat-${session.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    getUI()?.showToast('已导出 Markdown 对话记录');
  }

  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function renderAll() {
    renderSessionsList();
    renderMessages();
  }

  // 初始化入口
  function init() {
    initElements();
    loadFromStorage();
    renderAll();
    bindPresets();

    // 事件绑定
    elements.btnNew?.addEventListener('click', () => createNewSession());
    elements.btnClearAll?.addEventListener('click', () => {
      if (confirm('确定要清空所有历史对话记录吗？此操作无法撤销。')) {
        clearAllSessions();
      }
    });

    elements.toggleSidebarBtn?.addEventListener('click', () => {
      elements.sidebar?.classList.toggle('is-open');
    });

    elements.btnSend?.addEventListener('click', handleSend);

    elements.inputBox?.addEventListener('input', () => {
      autoResizeTextarea(elements.inputBox);
    });

    elements.inputBox?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    const modelPill = document.getElementById('chat-model-config-pill') || document.querySelector('.chat-model-pill');
    modelPill?.addEventListener('click', (e) => {
      e.preventDefault();
      getUI()?.switchView('settings');
      getUI()?.showToast('已跳转至系统设置：此处配置的接口与密钥全站共用');
    });

    function updateActiveModelDisplay() {
      const settings = window.LexoraStorage?.getSettings ? window.LexoraStorage.getSettings() : {};
      if (elements.activeModel) {
        const hasKey = Boolean(settings.apiKey && settings.apiKey.trim());
        elements.activeModel.textContent = hasKey ? (settings.model || DEFAULT_FALLBACK_MODEL) : '配置个人密钥';
        if (!hasKey) {
          elements.activeModel.style.color = '#ff9f0a';
        } else {
          elements.activeModel.style.color = '';
        }
      }
    }

    // 监听视图切换与设置保存事件
    window.addEventListener('viewswitched', (e) => {
      if (e.detail?.view === 'chat') {
        updateActiveModelDisplay();
        scrollToBottom();
      }
    });

    window.addEventListener('settingsupdated', () => {
      updateActiveModelDisplay();
    });
  }

  // 外部直接唤起指定提问（如背词时点击问问 AI）
  function askAI(prompt) {
    getUI()?.switchView('chat');
    if (elements.inputBox && prompt) {
      elements.inputBox.value = prompt;
      elements.inputBox.focus();
      autoResizeTextarea(elements.inputBox);
    }
  }

  window.LexoraChat = {
    init,
    askAI,
    createNewSession,
    clearAllSessions
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
