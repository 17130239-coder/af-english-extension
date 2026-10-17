/**
 * YouTube Subtitle Click & Copy - Background Service Worker
 * Architecture: Clean Service Worker with Command/Dispatcher Message Router
 */

'use strict';

// 1. Dependency Imports
if (typeof importScripts === 'function') {
  try {
    importScripts(
      '/lib/constants.js',
      '/lib/utils.js',
      '/lib/subtitleParser.js',
      '/lib/compromise.js',
      '/lib/cefrDict.js',
      '/lib/vocabAnalyzer.js',
      '/lib/neonClient.js',
      '/lib/aiService.js'
    );
  } catch (e) {
    try {
      importScripts(
        '../lib/constants.js',
        '../lib/utils.js',
        '../lib/subtitleParser.js',
        '../lib/compromise.js',
        '../lib/cefrDict.js',
        '../lib/vocabAnalyzer.js',
        '../lib/neonClient.js',
        '../lib/aiService.js'
      );
    } catch (e2) {
      console.error('[Neon Background] Failed to import dependencies:', e2);
    }
  }
}

const CONSTANTS = (typeof APP_CONSTANTS !== 'undefined') ? APP_CONSTANTS : null;
const UTILS = (typeof APP_UTILS !== 'undefined') ? APP_UTILS : null;
const DEFAULT_SETTINGS = CONSTANTS ? CONSTANTS.DEFAULT_SETTINGS : {};
const MESSAGES = CONSTANTS ? CONSTANTS.MESSAGES : {};

/**
 * Settings Lifecycle Service
 */
const SettingsService = {
  async initialize() {
    chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (result) => {
      const toSet = {};
      for (const key in DEFAULT_SETTINGS) {
        if (result[key] === undefined) {
          toSet[key] = DEFAULT_SETTINGS[key];
        }
      }
      // Ensure AI default provider is configured
      if (!result.aiProvider) {
        toSet.aiProvider = DEFAULT_SETTINGS.aiProvider || 'nine_router';
        toSet.nineRouterBaseUrl = DEFAULT_SETTINGS.nineRouterBaseUrl;
        toSet.nineRouterApiKey = DEFAULT_SETTINGS.nineRouterApiKey;
        toSet.nineRouterModel = DEFAULT_SETTINGS.nineRouterModel;
      }
      if (Object.keys(toSet).length > 0) {
        chrome.storage.local.set(toSet);
      }
    });
  }
};

/**
 * Neon Schema Initialization Service
 */
const DatabaseService = {
  async initSchema() {
    if (typeof neonClient !== 'undefined' && neonClient.initSchema) {
      try {
        await neonClient.initSchema();
        console.log('[Neon Background] Schema initialized successfully');
      } catch (err) {
        console.warn('[Neon Background] Schema init error:', err);
      }
    }
  }
};

/**
 * Selection Persistence & Notification Service
 */
const SelectionService = {
  async saveSelection(text, pageTitle = 'Web Selection', pageUrl = '', tab = null) {
    const selectedText = (text || '').trim();
    if (!selectedText) return null;

    const newItem = UTILS && UTILS.createSubtitleEntity
      ? UTILS.createSubtitleEntity({
          text: selectedText,
          videoTitle: pageTitle,
          url: pageUrl,
          status: 'pending'
        })
      : {
          id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          text: selectedText,
          timestamp: Date.now(),
          videoTitle: pageTitle,
          url: pageUrl,
          translation: '',
          explanation: '',
          exampleSentence: '',
          exampleTranslation: '',
          isFavorite: false,
          status: 'pending'
        };

    // 1. Cache to local storage
    chrome.storage.local.get(['copyHistory'], (res) => {
      let history = res.copyHistory || [];
      history = history.filter(item => item.text.trim().toLowerCase() !== selectedText.toLowerCase());
      history.unshift(newItem);
      if (history.length > 500) history = history.slice(0, 500);
      chrome.storage.local.set({ copyHistory: history });
    });

    // 2. Persist to Neon Postgres
    if (typeof neonClient !== 'undefined' && neonClient.saveSubtitle) {
      try {
        await neonClient.saveSubtitle(newItem);
        console.log('[Neon Background] Selection saved to Neon:', selectedText);
      } catch (err) {
        console.warn('[Neon Background] Selection save error:', err);
      }
    }

    // 3. System Notification
    this.showNotification(selectedText);

    // 4. Trigger Toast on YouTube if applicable
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: MESSAGES.SHOW_TOAST || 'showToast',
        text: selectedText
      }, () => {
        if (chrome.runtime.lastError) {
          // Ignore if tab not ready or not YouTube
        }
      });
    }

    return newItem;
  },

  showNotification(text, title = 'af-english - Đã lưu từ vựng') {
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: title,
        message: text.length > 55 ? text.substring(0, 52) + '...' : text
      });
    }
  }
};

/**
 * Keyboard Shortcut Command Service (Manifest commands: Alt+S)
 */
const ShortcutCommandService = {
  COMMAND_CAPTURE_SUBTITLE: 'capture-current-subtitle',
  COMMAND_ADD_SELECTION: 'add-selected-text',
  COMMAND_OPEN_DASHBOARD: 'open-dashboard',

  async handleCommand(command) {
    if (command === this.COMMAND_OPEN_DASHBOARD) {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      // Skip internal browser URLs
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        SelectionService.showNotification('Không thể dùng phím tắt trên trang hệ thống trình duyệt.', 'af-english');
        return;
      }

      // 1. Dedicated Command: Alt + C (Capture current subtitle without selecting)
      if (command === this.COMMAND_CAPTURE_SUBTITLE) {
        chrome.tabs.sendMessage(tab.id, { action: 'captureCurrentSubtitle' }, (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            this.executeDirectCaptureScript(tab);
          }
        });
        return;
      }

      // 2. Command: Alt + S (Add selected text or fallback to current subtitle on YouTube)
      if (command === this.COMMAND_ADD_SELECTION) {
        this.handleAddSelection(tab);
      }
    } catch (err) {
      console.warn('[ShortcutCommandService] Command execution error:', err);
    }
  },

  async executeDirectCaptureScript(tab) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const top = document.querySelector('.ytp-caption-window-container, .caption-window, .ytp-caption-window-bottom, .ytp-caption-window-rollup');
          const segs = (top || document).querySelectorAll('.ytp-caption-segment');
          let text = '';
          if (segs.length > 0) {
            text = Array.from(segs).map(s => (s.textContent || '').trim()).filter(Boolean).join(' ');
          } else {
            const fallback = document.querySelector('.caption-window, .ytp-caption-window-bottom, .captions-text');
            if (fallback) text = (fallback.textContent || '').trim();
          }

          const video = document.querySelector('video.html5-main-video, video');
          if (video && text) video.pause();

          let url = window.location.href;
          try {
            let seconds = null;
            const moviePlayer = document.getElementById('movie_player');
            if (moviePlayer && typeof moviePlayer.getCurrentTime === 'function') {
              const t = moviePlayer.getCurrentTime();
              if (!isNaN(t) && t >= 0) seconds = Math.floor(t);
            }
            if (seconds === null && video && !isNaN(video.currentTime) && video.currentTime >= 0) {
              seconds = Math.floor(video.currentTime);
            }

            if (seconds !== null && !isNaN(seconds)) {
              const parsed = new URL(url);
              if (parsed.pathname.startsWith('/shorts/')) {
                const shortId = parsed.pathname.split('/')[2];
                url = shortId ? `https://www.youtube.com/watch?v=${shortId}&t=${seconds}s` : url;
              } else {
                parsed.searchParams.set('t', `${seconds}s`);
                url = parsed.toString();
              }
            }
          } catch (e) {}

          const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title, .ytp-title-link');
          const title = titleEl ? titleEl.textContent.trim() : (document.title ? document.title.replace(' - YouTube', '').trim() : 'YouTube Video');

          return {
            text,
            title,
            url
          };
        }
      });

      if (results && results[0] && results[0].result) {
        const { text, title, url } = results[0].result;
        if (text) {
          await SelectionService.saveSelection(text, title, url, tab);
        } else {
          SelectionService.showNotification('Không tìm thấy phụ đề nào đang hiển thị.', 'af-english');
        }
      }
    } catch (e) {
      console.warn('[ShortcutCommandService] Direct capture script error:', e);
    }
  },

  async handleAddSelection(tab) {
    try {
      // Execute selection extraction script inside active tab
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sel = window.getSelection();
          let text = sel ? sel.toString().trim() : '';

          // If on YouTube and no manual selection, extract current subtitle from video player
          const isYouTube = window.location.hostname.includes('youtube.com');
          if (!text && isYouTube) {
            const container = document.querySelector('.ytp-caption-window-container, .caption-window, .ytp-caption-window-bottom, .captions-text');
            if (container) {
              const segs = container.querySelectorAll('.ytp-caption-segment');
              if (segs.length > 0) {
                text = Array.from(segs).map(s => (s.textContent || '').trim()).filter(Boolean).join(' ');
              } else {
                text = (container.textContent || '').trim();
              }
            }
          }

          // In-page floating pill feedback on non-YouTube pages
          if (text && !isYouTube) {
            try {
              const oldToast = document.getElementById('sub-ai-quick-toast');
              if (oldToast) oldToast.remove();
              const toast = document.createElement('div');
              toast.id = 'sub-ai-quick-toast';
              const display = text.length > 40 ? text.substring(0, 37) + '...' : text;
              toast.innerHTML = `<span style="color:#f97316;font-weight:700;margin-right:6px;">✓ af-english:</span>Đã lưu "${display}"`;
              Object.assign(toast.style, {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: '2147483647',
                background: 'rgba(15, 16, 19, 0.94)',
                color: '#f8fafc',
                padding: '8px 16px',
                borderRadius: '9999px',
                border: '1px solid rgba(249, 115, 22, 0.35)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: '12.5px',
                backdropFilter: 'blur(6px)',
                pointerEvents: 'none',
                transition: 'all 0.25s ease',
                opacity: '0',
                transform: 'translateY(-8px)'
              });
              document.body.appendChild(toast);
              requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateY(0)';
              });
              setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-8px)';
                setTimeout(() => toast.remove(), 300);
              }, 2200);
            } catch (e) {
              // ignore in-page DOM toast errors
            }
          }

          let url = window.location.href;
          const video = document.querySelector('video.html5-main-video, video');
          if (video && text) video.pause();

          if (isYouTube) {
            try {
              let seconds = null;
              const moviePlayer = document.getElementById('movie_player');
              if (moviePlayer && typeof moviePlayer.getCurrentTime === 'function') {
                const t = moviePlayer.getCurrentTime();
                if (!isNaN(t) && t >= 0) seconds = Math.floor(t);
              }
              if (seconds === null && video && !isNaN(video.currentTime) && video.currentTime >= 0) {
                seconds = Math.floor(video.currentTime);
              }

              if (seconds !== null && !isNaN(seconds)) {
                const parsed = new URL(url);
                if (parsed.pathname.startsWith('/shorts/')) {
                  const shortId = parsed.pathname.split('/')[2];
                  url = shortId ? `https://www.youtube.com/watch?v=${shortId}&t=${seconds}s` : url;
                } else {
                  parsed.searchParams.set('t', `${seconds}s`);
                  url = parsed.toString();
                }
              }
            } catch (e) {}
          }

          const pageTitle = isYouTube
            ? (document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title, .ytp-title-link')?.textContent?.trim() || (document.title ? document.title.replace(' - YouTube', '').trim() : 'YouTube Video'))
            : (document.title ? document.title.trim() : 'Web Selection');

          return {
            text,
            title: pageTitle,
            url
          };
        }
      });

      if (results && results[0] && results[0].result) {
        const { text, title, url } = results[0].result;
        if (text) {
          await SelectionService.saveSelection(text, title, url, tab);
        } else {
          SelectionService.showNotification('Vui lòng bôi đen (select) đoạn văn bản hoặc bật phụ đề trước khi bấm Option+S (hoặc Alt+S).', 'af-english');
        }
      }
    } catch (err) {
      console.warn('[ShortcutCommandService] Add selection error:', err);
    }
  }
};

/**
 * Context Menu Service
 */
const ContextMenuService = {
  MENU_ADD_SELECTION: 'add-selection-to-subtitle-list',
  MENU_OPEN_DASHBOARD: 'open-study-dashboard',

  setup() {
    if (typeof chrome === 'undefined' || !chrome.contextMenus) return;

    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: this.MENU_ADD_SELECTION,
        title: 'Thêm vào danh sách học từ ("%s")',
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: this.MENU_OPEN_DASHBOARD,
        title: 'Mở Dashboard học từ',
        contexts: ['page', 'action']
      });
    });
  },

  async handleMenuClick(info, tab) {
    if (info.menuItemId === this.MENU_OPEN_DASHBOARD) {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      return;
    }

    if (info.menuItemId === this.MENU_ADD_SELECTION && info.selectionText) {
      const selectedText = info.selectionText.trim();
      if (!selectedText) return;

      const pageTitle = (tab && tab.title) ? tab.title.trim() : 'Web Selection';
      let pageUrl = (tab && tab.url) ? tab.url : '';

      if (tab?.id && (pageUrl.includes('youtube.com') || pageUrl.includes('youtu.be'))) {
        try {
          const res = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const video = document.querySelector('video.html5-main-video, video');
              if (video) video.pause();
              const moviePlayer = document.getElementById('movie_player');
              if (moviePlayer && typeof moviePlayer.getCurrentTime === 'function') {
                const t = moviePlayer.getCurrentTime();
                if (!isNaN(t) && t >= 0) return Math.floor(t);
              }
              if (video && !isNaN(video.currentTime) && video.currentTime >= 0) {
                return Math.floor(video.currentTime);
              }
              return null;
            }
          });
          const seconds = res?.[0]?.result;
          if (seconds !== null && seconds !== undefined) {
            const parsed = new URL(pageUrl);
            if (parsed.pathname.startsWith('/shorts/')) {
              const shortId = parsed.pathname.split('/')[2];
              pageUrl = shortId ? `https://www.youtube.com/watch?v=${shortId}&t=${seconds}s` : pageUrl;
            } else {
              parsed.searchParams.set('t', `${seconds}s`);
              pageUrl = parsed.toString();
            }
          }
        } catch (e) {}
      }

      await SelectionService.saveSelection(selectedText, pageTitle, pageUrl, tab);
    }
  }
};

/**
 * Message Action Handlers (Command Pattern)
 */
const MessageDispatcher = {
  handlers: {
    // Open Dashboard Tab
    ['openDashboard']: async () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
      return { success: true };
    },

    // Neon Direct Query Proxy
    ['neon_query']: async (message) => {
      if (!neonClient || !neonClient.queryDirect) {
        throw new Error('neonClient is not available in background worker');
      }
      const rows = await neonClient.queryDirect(message.sql, message.params);
      return { success: true, rows };
    },

    // Neon Save Subtitle
    ['neon_saveSubtitle']: async (message) => {
      if (!neonClient || !neonClient.saveSubtitle) {
        throw new Error('neonClient is not available in background worker');
      }
      const data = await neonClient.saveSubtitle(message.item);
      return { success: true, data };
    },

    // Neon Update Subtitle
    ['neon_updateSubtitle']: async (message) => {
      if (!neonClient || !neonClient.updateSubtitle) {
        throw new Error('neonClient is not available in background worker');
      }
      const data = await neonClient.updateSubtitle(message.item);
      return { success: true, data };
    },

    // Neon Delete Subtitle
    ['neon_deleteSubtitle']: async (message) => {
      if (!neonClient || !neonClient.deleteSubtitle) {
        throw new Error('neonClient is not available in background worker');
      }
      const data = await neonClient.deleteSubtitle(message.id);
      return { success: true, data };
    },

    // Neon Delete Subtitles in Batch
    ['neon_deleteSubtitles']: async (message) => {
      if (!neonClient || !neonClient.deleteSubtitles) {
        throw new Error('neonClient is not available in background worker');
      }
      const data = await neonClient.deleteSubtitles(message.ids);
      return { success: true, data };
    },

    // Neon Clear All Subtitles
    ['neon_clearAllSubtitles']: async () => {
      if (!neonClient || !neonClient.clearAllSubtitles) {
        throw new Error('neonClient is not available in background worker');
      }
      const data = await neonClient.clearAllSubtitles();
      return { success: true, data };
    },

    // AI Translation Proxy
    ['translateText']: async (message) => {
      if (typeof aiService === 'undefined' || !aiService.translateText) {
        throw new Error('aiService is not available in background worker');
      }
      const result = await aiService.translateText(message.text, message.settings);
      return { success: true, data: result };
    },

    // Subtitle Vocabulary Analysis (POS tagging: Nouns, Verbs, Adjectives, Adverbs)
    ['analyze_subtitles']: async (message) => {
      const analyzer = (typeof APP_VOCAB_ANALYZER !== 'undefined') ? APP_VOCAB_ANALYZER : null;
      if (!analyzer || !analyzer.analyzeSubtitles) {
        throw new Error('APP_VOCAB_ANALYZER is not available in background worker');
      }
      const analysis = analyzer.analyzeSubtitles(message.cues, message.options);
      return { success: true, analysis };
    },

    // Vocabulary Export (Anki / CSV)
    ['export_vocab']: async (message) => {
      const analyzer = (typeof APP_VOCAB_ANALYZER !== 'undefined') ? APP_VOCAB_ANALYZER : null;
      if (!analyzer) throw new Error('APP_VOCAB_ANALYZER is not available in background worker');

      const words = message.words || [];
      const title = (message.title || 'vocab').replace(/[/\\?%*:|"<>]/g, '_');
      let content = '';
      let filename = '';
      let mime = 'text/plain;charset=utf-8;';

      if (message.format === 'anki') {
        content = analyzer.exportToAnkiFormat(words);
        filename = `${title}_anki.txt`;
      } else {
        content = analyzer.exportToCsvFormat(words);
        filename = `${title}_vocab.csv`;
        mime = 'text/csv;charset=utf-8;';
      }

      return { success: true, content, filename, mime };
    },

    // Save batch vocabulary words into Neon Postgres
    ['save_vocab_batch_neon']: async (message) => {
      if (!neonClient || !neonClient.saveSubtitle) {
        throw new Error('neonClient is not available in background worker');
      }
      const words = message.words || [];
      const saved = [];

      for (const w of words) {
        const firstCtx = (w.contexts && w.contexts[0]) ? w.contexts[0] : null;
        const entity = (UTILS && UTILS.createSubtitleEntity)
          ? UTILS.createSubtitleEntity({
              text: w.word,
              translation: w.translation || '',
              explanation: `${w.posLabelVi || w.pos} | CEFR: ${w.cefr || 'B1'} | Tần suất: ${w.frequency || 1}x`,
              exampleSentence: firstCtx ? firstCtx.sentence : '',
              videoTitle: w.videoTitle || 'Vocabulary Studio',
              url: w.videoUrl || '',
              status: w.translation ? 'translated' : 'pending'
            })
          : {
              id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              text: w.word,
              translation: w.translation || '',
              explanation: `${w.posLabelVi || w.pos} | CEFR: ${w.cefr || 'B1'}`,
              exampleSentence: firstCtx ? firstCtx.sentence : '',
              videoTitle: w.videoTitle || 'Vocabulary Studio',
              url: w.videoUrl || '',
              status: w.translation ? 'translated' : 'pending',
              timestamp: Date.now()
            };

        try {
          await neonClient.saveSubtitle(entity);
          saved.push(entity);
        } catch (e) {
          console.warn('[Background] Batch save item error:', e);
        }
      }

      return { success: true, count: saved.length };
    },

    // Fetch external URL (bypass CORS/CSP)
    ['fetch_external_url']: async (message) => {
      const resp = await fetch(message.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      return { success: true, text };
    },

    // Query active tab media status for Popup & Dashboard
    ['get_active_tab_media_status']: async () => {
      // 1. Try currently active tab first (ideal for Popup)
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url) {
          const isYT = activeTab.url.includes('youtube.com/watch') || activeTab.url.includes('youtube.com/shorts/');
          const isNF = activeTab.url.includes('netflix.com/watch/');
          if (isYT || isNF) {
            return {
              isMedia: true,
              platform: isNF ? 'netflix' : 'youtube',
              tabId: activeTab.id,
              title: activeTab.title || '',
              url: activeTab.url
            };
          }
        }
      } catch (e) {}

      // 2. Otherwise find any open Netflix or YouTube tab across all windows (ideal for Dashboard)
      try {
        const mediaTabs = await chrome.tabs.query({
          url: [
            '*://*.youtube.com/watch*',
            '*://*.youtube.com/shorts/*',
            '*://*.netflix.com/watch/*'
          ]
        });

        if (mediaTabs && mediaTabs.length > 0) {
          const tab = mediaTabs[0];
          const isNF = tab.url.includes('netflix.com/watch/');
          return {
            isMedia: true,
            platform: isNF ? 'netflix' : 'youtube',
            tabId: tab.id,
            title: tab.title || '',
            url: tab.url
          };
        }
      } catch (e) {}

      return { isMedia: false };
    }
  },

  /**
   * Dispatches incoming message to appropriate handler
   */
  dispatch(message, sender, sendResponse) {
    if (!message || !message.action) {
      return false;
    }

    const handler = this.handlers[message.action];
    if (typeof handler !== 'function') {
      return false;
    }

    // Execute async handler and safely wrap response
    Promise.resolve(handler(message, sender))
      .then((res) => {
        sendResponse(res || { success: true });
      })
      .catch((err) => {
        console.error(`[Background Message] Error processing '${message.action}':`, err);
        sendResponse({ success: false, error: err.message || String(err) });
      });

    return true; // Keep message channel open for async response
  }
};

// -------------------------------------------------------------
// Lifecycle Listeners
// -------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  SettingsService.initialize();
  DatabaseService.initSchema();
  ContextMenuService.setup();
});

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    ContextMenuService.setup();
  });
}

if (typeof chrome !== 'undefined' && chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    ContextMenuService.handleMenuClick(info, tab);
  });
}

if (typeof chrome !== 'undefined' && chrome.commands) {
  chrome.commands.onCommand.addListener((command) => {
    ShortcutCommandService.handleCommand(command);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return MessageDispatcher.dispatch(message, sender, sendResponse);
});
