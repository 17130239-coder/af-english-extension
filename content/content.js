/**
 * YouTube Subtitle Click & Copy - Content Script
 * Allows 1-click copying of YouTube subtitles directly from the video player.
 * Architecture: Clean Component Model (ToastManager, SubtitleExtractor, PlayerController, HistoryRecorder)
 */

(function () {
  'use strict';

  // Prevent multiple script injections
  if (window.__ytSubtitleCopyInjected) return;
  window.__ytSubtitleCopyInjected = true;

  const CONSTANTS = (typeof APP_CONSTANTS !== 'undefined') ? APP_CONSTANTS : null;
  const UTILS = (typeof APP_UTILS !== 'undefined') ? APP_UTILS : null;
  const SELECTORS = CONSTANTS ? CONSTANTS.YOUTUBE_SELECTORS : {
    CAPTION_SEGMENT: '.ytp-caption-segment',
    CAPTION_CONTAINER: '.ytp-caption-segment, .caption-window, .ytp-caption-window-bottom, .ytp-caption-window-rollup, .captions-text',
    PLAYER: '#movie_player, .html5-video-player, ytd-player',
    VIDEO: 'video.html5-main-video, video',
    TITLE: 'h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title, .ytp-title-link'
  };

  // Extension Settings State
  let settings = {
    enabled: true,
    copyMode: 'full', // 'full' | 'segment'
    autoPause: false,
    showToast: true,
    showHighlight: true
  };

  /**
   * Load and observe settings from chrome.storage
   */
  function initSettings() {
    try {
      chrome.storage.local.get(Object.keys(settings), (result) => {
        if (result) {
          settings = { ...settings, ...result };
          updateBodyState();
        }
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          for (const key in changes) {
            if (key in settings) {
              settings[key] = changes[key].newValue;
            }
          }
          updateBodyState();
        }
      });
    } catch (e) {
      console.warn('[YT Subtitle Copy] Settings init error:', e);
    }
  }

  function updateBodyState() {
    if (settings.enabled) {
      document.body.classList.remove('yt-sub-copy-disabled');
    } else {
      document.body.classList.add('yt-sub-copy-disabled');
    }
  }

  /**
   * Clean text helper using shared utils or safe fallback
   */
  function cleanText(raw) {
    if (UTILS && UTILS.cleanSubtitleText) {
      return UTILS.cleanSubtitleText(raw);
    }
    if (!raw) return '';
    return String(raw)
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\r?\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Clipboard Helper
   */
  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('[YT Subtitle Copy] Clipboard API failed, attempting fallback...', err);
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (err) {
      console.error('[YT Subtitle Copy] Fallback copy failed:', err);
      return false;
    }
  }

  /**
   * Toast UI Manager (Cupertino / Dynamic Island Pill)
   */
  const ToastManager = {
    element: null,
    timer: null,

    getOrCreate() {
      if (!this.element) {
        this.element = document.createElement('div');
        this.element.className = 'yt-sub-copy-toast-container';
        this.element.innerHTML = `
          <span class="yt-sub-copy-toast-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <div class="yt-sub-copy-toast-content">
            <span class="yt-sub-copy-toast-label">Đã copy:</span>
            <span class="yt-sub-copy-toast-preview"></span>
          </div>
          <button class="yt-sub-copy-toast-btn-dash" title="Mở Dashboard AI">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            <span>Dashboard</span>
          </button>
          <button class="yt-sub-copy-toast-btn-dash af-toast-vocab-btn" title="Tải phụ đề và phân loại từ vựng">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>Tách từ vựng</span>
          </button>
        `;

        const dashBtn = this.element.querySelector('.yt-sub-copy-toast-btn-dash');
        if (dashBtn) {
          dashBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            chrome.runtime.sendMessage({ action: 'openDashboard' });
          });
        }

        const vocabBtn = this.element.querySelector('.af-toast-vocab-btn');
        if (vocabBtn) {
          vocabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (typeof YouTubeVocabManager !== 'undefined') {
              YouTubeVocabManager.openModal();
            }
          });
        }
      }
      return this.element;
    },

    show(text) {
      if (!settings.showToast || !text) return;
      const el = this.getOrCreate();
      const previewEl = el.querySelector('.yt-sub-copy-toast-preview');
      const truncated = text.length > 55 ? text.substring(0, 52) + '...' : text;
      previewEl.textContent = `"${truncated}"`;

      const playerContainer = document.querySelector(SELECTORS.PLAYER) || document.body;
      if (el.parentElement !== playerContainer) {
        playerContainer.appendChild(el);
      }

      requestAnimationFrame(() => {
        el.classList.add('yt-sub-toast-visible');
      });

      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.element) {
          this.element.classList.remove('yt-sub-toast-visible');
        }
      }, 2500);
    }
  };

  /**
   * Subtitle Extractor Component
   */
  const SubtitleExtractor = {
    findSubtitleElement(e) {
      const selector = SELECTORS.CAPTION_CONTAINER;

      if (e.target && typeof e.target.closest === 'function') {
        const match = e.target.closest(selector);
        if (match) return match;
      }

      if (e.composedPath) {
        const path = e.composedPath();
        for (const el of path) {
          if (el && el.nodeType === Node.ELEMENT_NODE && el.matches && el.matches(selector)) {
            return el;
          }
        }
      }

      return null;
    },

    extractText(subElem, isModifierActive) {
      // 1. If user manually highlighted text with mouse
      const currentSelection = window.getSelection() ? window.getSelection().toString().trim() : '';
      if (currentSelection.length > 0) {
        return cleanText(currentSelection);
      }

      // 2. Determine mode (modifier toggles)
      let mode = settings.copyMode;
      if (isModifierActive) {
        mode = (mode === 'full') ? 'segment' : 'full';
      }

      // 3. Segment Mode
      if (mode === 'segment') {
        const segment = subElem.classList.contains('ytp-caption-segment')
          ? subElem
          : (subElem.closest('.ytp-caption-segment') || subElem.querySelector('.ytp-caption-segment'));
        if (segment) {
          return cleanText(segment.textContent || segment.innerText);
        }
      }

      // 4. Full Mode: aggregate all visible segments in the entire caption window
      const topContainer = subElem.closest('.ytp-caption-window-container')
        || subElem.closest('.caption-window, .ytp-caption-window-bottom, .ytp-caption-window-rollup')
        || subElem.closest('.captions-text')
        || subElem.parentElement;

      if (topContainer) {
        const segments = topContainer.querySelectorAll('.ytp-caption-segment');
        if (segments && segments.length > 0) {
          const textParts = [];
          segments.forEach((seg) => {
            const win = seg.closest('.caption-window');
            if (win && (win.style.display === 'none' || win.style.visibility === 'hidden')) {
              return;
            }
            const t = (seg.textContent || seg.innerText || '').trim();
            if (t) textParts.push(t);
          });
          if (textParts.length > 0) {
            return cleanText(textParts.join(' '));
          }
        }
        return cleanText(topContainer.innerText || topContainer.textContent);
      }

      return cleanText(subElem.innerText || subElem.textContent);
    },

    getCurrentVisibleSubtitleText() {
      const player = document.querySelector(SELECTORS.PLAYER) || document;
      const topContainer = player.querySelector('.ytp-caption-window-container, .caption-window, .ytp-caption-window-bottom, .ytp-caption-window-rollup');

      const segments = (topContainer || document).querySelectorAll('.ytp-caption-segment');
      if (segments && segments.length > 0) {
        const textParts = [];
        segments.forEach((seg) => {
          const win = seg.closest('.caption-window');
          if (win) {
            const style = window.getComputedStyle(win);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return;
            }
          }
          const t = (seg.textContent || seg.innerText || '').trim();
          if (t) textParts.push(t);
        });

        if (textParts.length > 0) {
          return cleanText(textParts.join(' '));
        }
      }

      const fallbackContainer = document.querySelector('.caption-window, .ytp-caption-window-bottom, .captions-text');
      if (fallbackContainer) {
        const style = window.getComputedStyle(fallbackContainer);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return cleanText(fallbackContainer.innerText || fallbackContainer.textContent);
        }
      }

      return '';
    }
  };

  /**
   * Video Player Controller
   */
  const PlayerController = {
    pauseVideo() {
      if (!settings.autoPause) return;
      try {
        const video = document.querySelector(SELECTORS.VIDEO);
        if (video && !video.paused) {
          video.pause();
        }
      } catch (e) {
        console.warn('[YT Subtitle Copy] Could not pause video:', e);
      }
    },

    getVideoDetails() {
      // Video Title
      let videoTitle = '';
      const titleEl = document.querySelector(SELECTORS.TITLE);
      if (titleEl) {
        videoTitle = titleEl.textContent.trim();
      } else {
        videoTitle = document.title.replace(' - YouTube', '').trim();
      }

      // Deep link URL with timestamp (in seconds)
      let videoUrl = window.location.href;
      try {
        let seconds = null;
        const moviePlayer = document.getElementById('movie_player');
        if (moviePlayer && typeof moviePlayer.getCurrentTime === 'function') {
          const t = moviePlayer.getCurrentTime();
          if (!isNaN(t) && t >= 0) seconds = Math.floor(t);
        }

        if (seconds === null) {
          const videoEl = document.querySelector(SELECTORS.VIDEO);
          if (videoEl && !isNaN(videoEl.currentTime) && videoEl.currentTime >= 0) {
            seconds = Math.floor(videoEl.currentTime);
          }
        }

        if (seconds !== null && !isNaN(seconds)) {
          if (UTILS && UTILS.ensureYouTubeTimestampUrl) {
            videoUrl = UTILS.ensureYouTubeTimestampUrl(videoUrl, seconds);
          } else {
            const parsed = new URL(videoUrl);
            if (parsed.pathname.startsWith('/shorts/')) {
              const shortId = parsed.pathname.split('/')[2];
              videoUrl = shortId ? `https://www.youtube.com/watch?v=${shortId}&t=${seconds}s` : videoUrl;
            } else {
              parsed.searchParams.set('t', `${seconds}s`);
              videoUrl = parsed.toString();
            }
          }
        }
      } catch (e) {
        // ignore url parse issue
      }

      return { videoTitle, videoUrl };
    },

    triggerFlashEffect(element) {
      if (!settings.showHighlight || !element) return;
      const targets = element.classList.contains('ytp-caption-segment')
        ? [element]
        : (element.querySelectorAll('.ytp-caption-segment').length > 0
          ? element.querySelectorAll('.ytp-caption-segment')
          : [element]);

      targets.forEach((t) => {
        t.classList.remove('yt-sub-copy-flash');
        void t.offsetWidth; // Force reflow
        t.classList.add('yt-sub-copy-flash');
        setTimeout(() => {
          t.classList.remove('yt-sub-copy-flash');
        }, 450);
      });
    },

    ensureCaptionAttributes() {
      if (!settings.enabled) return;
      const captions = document.querySelectorAll('.caption-window, .ytp-caption-segment');
      captions.forEach((el) => {
        if (el.style.pointerEvents !== 'auto') {
          el.style.setProperty('pointer-events', 'auto', 'important');
        }
        if (el.style.cursor !== 'pointer') {
          el.style.setProperty('cursor', 'pointer', 'important');
        }
      });
    }
  };

  /**
   * History & Cloud Persistence
   */
  const HistoryRecorder = {
    record(text) {
      if (!text) return;
      const cleanT = text.trim();
      const { videoTitle, videoUrl } = PlayerController.getVideoDetails();

      chrome.storage.local.get(['copyHistory'], (result) => {
        let history = result.copyHistory || [];
        const existing = history.find(item => item.text.trim().toLowerCase() === cleanT.toLowerCase());
        history = history.filter(item => item.text.trim().toLowerCase() !== cleanT.toLowerCase());

        const newItem = (UTILS && UTILS.createSubtitleEntity)
          ? UTILS.createSubtitleEntity({
              id: existing?.id,
              text: cleanT,
              videoTitle,
              url: videoUrl,
              translation: existing?.translation || '',
              explanation: existing?.explanation || '',
              exampleSentence: existing?.exampleSentence || '',
              exampleTranslation: existing?.exampleTranslation || '',
              isFavorite: existing?.isFavorite || false,
              status: existing?.translation ? 'translated' : 'pending'
            })
          : {
              id: existing?.id || ('sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
              text: cleanT,
              timestamp: Date.now(),
              videoTitle,
              url: videoUrl,
              translation: existing?.translation || '',
              explanation: existing?.explanation || '',
              exampleSentence: existing?.exampleSentence || '',
              exampleTranslation: existing?.exampleTranslation || '',
              isFavorite: existing?.isFavorite || false,
              status: existing?.translation ? 'translated' : 'pending'
            };

        history.unshift(newItem);
        if (history.length > 500) history = history.slice(0, 500);

        // 1. Cache to local storage
        chrome.storage.local.set({ copyHistory: history });

        // 2. Persist to Neon Postgres via background worker proxy
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'neon_saveSubtitle', item: newItem }, (res) => {
            if (chrome.runtime.lastError) {
              console.warn('[Neon Storage] Background message error:', chrome.runtime.lastError.message);
            } else if (!res?.success) {
              console.warn('[Neon Storage] Save failed:', res?.error);
            }
          });
        }
      });
    }
  };

  /**
   * Pointer & Click Interaction Listeners (Capture Phase)
   */
  let pointerStartPos = null;

  function handlePointerDown(e) {
    if (!settings.enabled) return;
    const sub = SubtitleExtractor.findSubtitleElement(e);
    if (sub) {
      pointerStartPos = { x: e.clientX, y: e.clientY };
    } else {
      pointerStartPos = null;
    }
  }

  function handlePointerUp() {
    if (!settings.enabled) return;
  }

  async function handleClick(e) {
    if (!settings.enabled) return;
    const subElem = SubtitleExtractor.findSubtitleElement(e);
    if (!subElem) return;

    const dragDistance = pointerStartPos ? Math.hypot(e.clientX - pointerStartPos.x, e.clientY - pointerStartPos.y) : 0;

    // 1. Nếu người dùng vừa kéo chuột để bôi đen chọn từ / chọn cả 2 dòng
    if (dragDistance > 6) {
      const selected = window.getSelection() ? window.getSelection().toString().trim() : '';
      if (selected.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const textToCopy = cleanText(selected);
        const success = await copyToClipboard(textToCopy);
        if (success) {
          PlayerController.pauseVideo();
          ToastManager.show(textToCopy);
          HistoryRecorder.record(textToCopy);
        }
      }
      return;
    }

    // 2. Nếu người dùng nhấp đúp (double-click) để chọn 1 từ
    if (e.detail >= 2) {
      const selected = window.getSelection() ? window.getSelection().toString().trim() : '';
      if (selected.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const textToCopy = cleanText(selected);
        const success = await copyToClipboard(textToCopy);
        if (success) {
          PlayerController.pauseVideo();
          ToastManager.show(textToCopy);
          HistoryRecorder.record(textToCopy);
        }
        return;
      }
    }

    // 3. Nhấp chuột 1 chạm thông thường (chặn video pause/play gốc của YouTube)
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const isModifierActive = e.shiftKey || e.altKey;
    const textToCopy = SubtitleExtractor.extractText(subElem, isModifierActive);
    if (!textToCopy) return;

    const success = await copyToClipboard(textToCopy);
    if (success) {
      PlayerController.pauseVideo();
      PlayerController.triggerFlashEffect(subElem);
      ToastManager.show(textToCopy);
      HistoryRecorder.record(textToCopy);
    }
  }

  // Direct subtitle capture helper (for shortcuts Option+C / Option+S and background commands)
  async function captureCurrentSubtitleDirectly(preferSelection = false) {
    if (!settings.enabled) return false;

    let textToCopy = '';
    let flashTarget = null;
    const selection = window.getSelection() ? window.getSelection().toString().trim() : '';

    if (preferSelection && selection.length > 0) {
      // Khi dùng Option+S mà có bôi đen chữ: ưu tiên lấy đoạn bôi đen
      textToCopy = cleanText(selection);
    } else {
      // Khi dùng Option+C (hoặc Option+S không bôi đen): lấy ngay phụ đề video đang hiển thị
      textToCopy = SubtitleExtractor.getCurrentVisibleSubtitleText();
      flashTarget = document.querySelector('.ytp-caption-window-container, .caption-window:not([style*="display: none"]), .ytp-caption-segment');

      // Dự phòng: nếu không thấy phụ đề hiển thị mà có chữ đang bôi đen
      if (!textToCopy && selection.length > 0) {
        textToCopy = cleanText(selection);
      }
    }

    if (!textToCopy) {
      ToastManager.show('Không có phụ đề nào đang hiển thị.');
      return false;
    }

    const success = await copyToClipboard(textToCopy);
    if (success) {
      PlayerController.pauseVideo();
      if (flashTarget) {
        PlayerController.triggerFlashEffect(flashTarget);
      }
      ToastManager.show(textToCopy);
      HistoryRecorder.record(textToCopy);
      return true;
    }
    return false;
  }

  /**
   * YouTube Subtitle Downloader & Vocabulary Analyzer Manager
   */
  const YouTubeVocabManager = {
    tracks: [],
    selectedTrack: null,
    videoTitle: '',
    cues: [],
    analysis: null,
    widgetEl: null,
    modalEl: null,
    activePosFilter: 'all',

    init() {
      this.injectBridge();
      this.listenBridge();
      this.createWidget();
    },

    injectBridge() {
      try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('content/youtubeInjected.js');
        s.onload = function () { this.remove(); };
        (document.head || document.documentElement).appendChild(s);
      } catch (e) {
        console.warn('[AF YouTube] Bridge injection error:', e);
      }
    },

    listenBridge() {
      window.addEventListener('af_youtube_bridge_event', (e) => {
        const { type, data } = e.detail || {};
        if (type === 'youtube_tracks_ready' && data) {
          if (data.title) this.videoTitle = data.title;
          if (Array.isArray(data.tracks) && data.tracks.length > 0) {
            this.tracks = data.tracks;
            const enTrack = this.tracks.find(t => t.isEnglish && !t.isAutoGenerated) || this.tracks.find(t => t.isEnglish) || this.tracks[0];
            this.selectedTrack = enTrack;
            this.cues = [];
            this.analysis = null;
            this.updateWidget();
          }
        }
      });
    },

    createWidget() {
      try {
        document.getElementById('af-youtube-widget')?.remove();
        document.getElementById('af-modal-backdrop')?.remove();
      } catch (e) {}
    },

    updateWidget() {
      try {
        document.getElementById('af-youtube-widget')?.remove();
      } catch (e) {}
    },

    getTitle() {
      return this.videoTitle || document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title')?.textContent?.trim() || document.title.replace(' - YouTube', '').trim() || 'YouTube Video';
    },

    async fetchSubtitles() {
      if (this.cues.length > 0) return this.cues;
      if (!this.selectedTrack || !this.selectedTrack.baseUrl) {
        window.dispatchEvent(new CustomEvent('af_youtube_request_info'));
        throw new Error('Chưa tìm thấy đường dẫn phụ đề. Hãy chắc chắn video có phụ đề và đã bật CC.');
      }

      const url = this.selectedTrack.baseUrl + '&fmt=vtt';
      let rawText = '';
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          rawText = await resp.text();
        } else {
          throw new Error('Direct fetch failed');
        }
      } catch (err) {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'fetch_external_url', url }, resolve);
        });
        if (res && res.success) rawText = res.text;
        else throw new Error('Không thể tải file phụ đề từ YouTube');
      }

      const cues = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER.parse(rawText) : [];
      if (!cues || cues.length === 0) {
        throw new Error('Không phân tích được nội dung phụ đề.');
      }

      this.cues = cues;
      return cues;
    },

    openModal() {
      if (!this.modalEl) {
        this.modalEl = document.createElement('div');
        this.modalEl.id = 'af-youtube-modal-backdrop';
        this.modalEl.className = 'af-modal-backdrop';
        document.body.appendChild(this.modalEl);
      }

      const title = this.getTitle();
      const hasTrack = Boolean(this.selectedTrack);

      this.modalEl.innerHTML = `
        <div class="af-modal-card">
          <div class="af-modal-header">
            <div class="af-modal-title-group">
              <span class="af-modal-tag">🎬 YouTube English Studio</span>
              <h2 class="af-modal-title">${UTILS ? UTILS.escapeHtml(title) : title}</h2>
            </div>
            <button class="af-modal-close" id="af-yt-btn-close">&times;</button>
          </div>

          <div class="af-modal-body">
            <div class="af-track-selector-bar">
              <label class="af-field-label">Kênh phụ đề:</label>
              <select id="af-yt-select-track" class="af-select">
                ${(this.tracks || []).map((t, idx) => `
                  <option value="${idx}" ${t === this.selectedTrack ? 'selected' : ''}>
                    ${t.label} (${t.language})
                  </option>
                `).join('')}
                ${(!this.tracks || this.tracks.length === 0) ? '<option value="">(Chưa bắt được phụ đề - hãy Play video và bật CC)</option>' : ''}
              </select>
            </div>

            <div class="af-actions-row">
              <button id="af-yt-btn-analyze" class="af-btn af-btn-primary" ${!hasTrack ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <span>Phân loại từ vựng (Nouns, Verbs, Adj, Adv)</span>
              </button>

              <div class="af-download-btn-group">
                <button id="af-yt-btn-dl-srt" class="af-btn af-btn-outline" title="Tải file SubRip .SRT">⬇ .SRT</button>
                <button id="af-yt-btn-dl-vtt" class="af-btn af-btn-outline" title="Tải file WebVTT .VTT">⬇ .VTT</button>
                <button id="af-yt-btn-dl-txt" class="af-btn af-btn-outline" title="Tải transcript sạch .TXT">⬇ .TXT</button>
              </div>

              <button id="af-yt-btn-dashboard" class="af-btn af-btn-secondary" title="Mở trang Studio học tập đầy đủ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                <span>Mở Studio</span>
              </button>
            </div>

            <div id="af-yt-loading" class="af-loading-state" style="display:none;">
              <div class="af-spinner"></div>
              <span id="af-yt-loading-text">Đang tải và phân tích từ vựng...</span>
            </div>

            <div id="af-yt-results" class="af-analysis-results" style="display:none;">
              <div class="af-pos-tabs">
                <button class="af-pos-tab active" data-pos="all">Tất cả (<span id="yt-count-all">0</span>)</button>
                <button class="af-pos-tab" data-pos="noun">📘 Danh từ (<span id="yt-count-noun">0</span>)</button>
                <button class="af-pos-tab" data-pos="verb">📙 Động từ (<span id="yt-count-verb">0</span>)</button>
                <button class="af-pos-tab" data-pos="adjective">📗 Tính từ (<span id="yt-count-adj">0</span>)</button>
                <button class="af-pos-tab" data-pos="adverb">📕 Trạng từ (<span id="yt-count-adv">0</span>)</button>
              </div>

              <div class="af-search-bar">
                <input type="text" id="af-yt-search-words" placeholder="Tìm nhanh từ vựng hoặc nghĩa tiếng Việt...">
                <button id="af-yt-btn-export-anki" class="af-btn-sm af-btn-anki">🗂️ Xuất Anki</button>
                <button id="af-yt-btn-export-csv" class="af-btn-sm af-btn-csv">📊 Xuất CSV</button>
              </div>

              <div id="af-yt-words-grid" class="af-words-grid"></div>
            </div>
          </div>
        </div>
      `;

      this.modalEl.style.display = 'flex';

      document.getElementById('af-yt-btn-close').onclick = () => {
        this.modalEl.style.display = 'none';
      };

      this.modalEl.onclick = (e) => {
        if (e.target === this.modalEl) this.modalEl.style.display = 'none';
      };

      const trackSel = document.getElementById('af-yt-select-track');
      if (trackSel) {
        trackSel.onchange = () => {
          const idx = parseInt(trackSel.value, 10);
          if (!isNaN(idx) && this.tracks[idx]) {
            this.selectedTrack = this.tracks[idx];
            this.cues = [];
            this.analysis = null;
            this.updateWidget();
          }
        };
      }

      document.getElementById('af-yt-btn-dl-srt').onclick = () => this.handleDownload('srt');
      document.getElementById('af-yt-btn-dl-vtt').onclick = () => this.handleDownload('vtt');
      document.getElementById('af-yt-btn-dl-txt').onclick = () => this.handleDownload('txt');
      document.getElementById('af-yt-btn-analyze').onclick = () => this.runAnalysis();

      document.getElementById('af-yt-btn-dashboard').onclick = () => {
        if (this.cues.length > 0) {
          chrome.storage.local.set({
            pendingVocabStudio: {
              title: this.getTitle(),
              url: window.location.href,
              cues: this.cues,
              analysis: this.analysis
            }
          }, () => {
            chrome.runtime.sendMessage({ action: 'openDashboard' });
          });
        } else {
          chrome.runtime.sendMessage({ action: 'openDashboard' });
        }
      };
    },

    async handleDownload(format) {
      try {
        const cues = await this.fetchSubtitles();
        const safeTitle = (this.getTitle() || 'youtube_subtitles').replace(/[/\\?%*:|"<>]/g, '_');
        let content = '';
        let filename = `${safeTitle}.${format}`;
        let mime = 'text/plain;charset=utf-8;';

        if (format === 'srt') {
          content = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER.toSRT(cues) : '';
          mime = 'application/x-subrip;charset=utf-8;';
        } else if (format === 'vtt') {
          content = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER.toWebVTT(cues) : '';
          mime = 'text/vtt;charset=utf-8;';
        } else if (format === 'txt') {
          content = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER.toReadableTranscript(cues) : '';
        }

        if (UTILS && UTILS.downloadFile) {
          UTILS.downloadFile(content, filename, mime);
        }
      } catch (err) {
        alert(err.message || 'Không thể tải file phụ đề');
      }
    },

    async runAnalysis() {
      const loading = document.getElementById('af-yt-loading');
      const loadingText = document.getElementById('af-yt-loading-text');
      const resultsEl = document.getElementById('af-yt-results');

      try {
        loading.style.display = 'flex';
        loadingText.textContent = 'Đang tải phụ đề tiếng Anh từ YouTube...';

        const cues = await this.fetchSubtitles();
        loadingText.textContent = `Đang phân loại ${cues.length} câu phụ đề (Nouns, Verbs, Adj, Adv)...`;

        chrome.runtime.sendMessage({
          action: 'analyze_subtitles',
          cues: cues,
          options: {
            videoTitle: this.getTitle(),
            videoUrl: window.location.href
          }
        }, (response) => {
          loading.style.display = 'none';
          if (response && response.success && response.analysis) {
            this.analysis = response.analysis;
            resultsEl.style.display = 'block';
            this.renderAnalysis(response.analysis);
          } else {
            alert('Lỗi phân tích: ' + (response ? response.error : 'Không có phản hồi'));
          }
        });
      } catch (err) {
        loading.style.display = 'none';
        alert(err.message || 'Lỗi khi phân tích phụ đề');
      }
    },

    renderAnalysis(analysis) {
      const { summary, allWords } = analysis;
      document.getElementById('yt-count-all').textContent = summary.uniqueWords;
      document.getElementById('yt-count-noun').textContent = summary.nounCount;
      document.getElementById('yt-count-verb').textContent = summary.verbCount;
      document.getElementById('yt-count-adj').textContent = summary.adjCount;
      document.getElementById('yt-count-adv').textContent = summary.advCount;

      const tabs = this.modalEl.querySelectorAll('.af-pos-tab');
      tabs.forEach((tab) => {
        tab.onclick = () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.activePosFilter = tab.getAttribute('data-pos');
          this.renderGrid(allWords);
        };
      });

      const searchInput = document.getElementById('af-yt-search-words');
      searchInput.oninput = () => {
        this.renderGrid(allWords, searchInput.value.trim().toLowerCase());
      };

      document.getElementById('af-yt-btn-export-anki').onclick = () => {
        chrome.runtime.sendMessage({
          action: 'export_vocab',
          format: 'anki',
          words: this.getFilteredWords(allWords, searchInput.value.trim().toLowerCase()),
          title: this.getTitle()
        }, (res) => {
          if (res && res.success && UTILS && UTILS.downloadFile) {
            UTILS.downloadFile(res.content, res.filename, res.mime);
          }
        });
      };

      document.getElementById('af-yt-btn-export-csv').onclick = () => {
        chrome.runtime.sendMessage({
          action: 'export_vocab',
          format: 'csv',
          words: this.getFilteredWords(allWords, searchInput.value.trim().toLowerCase()),
          title: this.getTitle()
        }, (res) => {
          if (res && res.success && UTILS && UTILS.downloadFile) {
            UTILS.downloadFile(res.content, res.filename, res.mime);
          }
        });
      };

      this.renderGrid(allWords);
    },

    getFilteredWords(words, query = '') {
      return words.filter((w) => {
        if (this.activePosFilter !== 'all' && w.pos !== this.activePosFilter) return false;
        if (query) {
          return w.word.toLowerCase().includes(query) || (w.translation && w.translation.toLowerCase().includes(query));
        }
        return true;
      });
    },

    renderGrid(words, query = '') {
      const grid = document.getElementById('af-yt-words-grid');
      if (!grid) return;

      const filtered = this.getFilteredWords(words, query);
      if (filtered.length === 0) {
        grid.innerHTML = '<div class="af-empty-vocab">Không có từ vựng nào khớp với bộ lọc.</div>';
        return;
      }

      grid.innerHTML = filtered.map((item) => {
        const firstCtx = (item.contexts && item.contexts[0]) ? item.contexts[0] : null;
        let sentenceHtml = '';
        if (firstCtx) {
          const sentence = firstCtx.sentence;
          const hl = firstCtx.highlightWord || item.word;
          const reg = new RegExp(`\\b(${hl})\\b`, 'gi');
          sentenceHtml = sentence.replace(reg, '<strong class="af-hl-word">$1</strong>');
        }

        return `
          <div class="af-word-card">
            <div class="af-word-header">
              <div class="af-word-title-group">
                <span class="af-word-text">${item.word}</span>
                ${item.ipa ? `<span class="af-word-ipa">${item.ipa}</span>` : ''}
                <button class="af-btn-speak" title="Nghe phát âm" data-speak="${item.word}">🔊</button>
              </div>
              <div class="af-word-badges">
                <span class="af-badge-pos af-badge-${item.pos}">${item.posLabelVi}</span>
                <span class="af-badge-cefr">${item.cefr}</span>
                <span class="af-badge-freq">${item.frequency}x</span>
              </div>
            </div>

            ${item.translation ? `<div class="af-word-trans">${item.translation}</div>` : ''}

            ${firstCtx ? `
              <div class="af-word-context">
                <div class="af-context-text">"${sentenceHtml}"</div>
                <button class="af-btn-seek" data-sec="${firstCtx.startSec}" title="Nhảy tới giây này trong video">
                  ▶ ${firstCtx.startTime}
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      grid.querySelectorAll('.af-btn-speak').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const text = btn.getAttribute('data-speak');
          if (UTILS && UTILS.speakText) UTILS.speakText(text);
        };
      });

      grid.querySelectorAll('.af-btn-seek').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const sec = parseFloat(btn.getAttribute('data-sec'));
          if (!isNaN(sec)) {
            window.dispatchEvent(new CustomEvent('af_youtube_seek', { detail: { seconds: sec } }));
          }
        };
      });
    }
  };

  // -------------------------------------------------------------
  // Event Bindings & Lifecycle Observer
  // -------------------------------------------------------------
  ['pointerdown', 'mousedown'].forEach((evt) => {
    document.addEventListener(evt, handlePointerDown, true);
  });

  ['pointerup', 'mouseup'].forEach((evt) => {
    document.addEventListener(evt, handlePointerUp, true);
  });

  document.addEventListener('click', handleClick, true);

  // Keyboard shortcut: Option + C / Option + S (hoặc Alt + C / Alt + S trên Windows)
  document.addEventListener('keydown', (e) => {
    const isAltC = e.altKey && (e.code === 'KeyC' || e.key === 'c' || e.key === 'C' || e.key === 'ç' || e.key === 'Ç');
    const isAltS = e.altKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S' || e.key === 'ß');

    if (isAltC || isAltS) {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      captureCurrentSubtitleDirectly(isAltS);
    }
  }, true);

  // Message listener for background-triggered actions
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'showToast' && msg.text) {
      ToastManager.show(msg.text);
    }
    if (msg.action === 'captureCurrentSubtitle') {
      captureCurrentSubtitleDirectly().then((res) => {
        sendResponse({ success: res });
      });
      return true;
    }
    if (msg.action === 'get_media_info') {
      const title = (typeof YouTubeVocabManager !== 'undefined' && YouTubeVocabManager.videoTitle)
        ? YouTubeVocabManager.videoTitle
        : ((UTILS && UTILS.getVideoTitle) ? UTILS.getVideoTitle() : document.title.replace(' - YouTube', ''));

      const tracks = (typeof YouTubeVocabManager !== 'undefined') ? YouTubeVocabManager.tracks : [];
      const selected = (typeof YouTubeVocabManager !== 'undefined') ? YouTubeVocabManager.selectedTrack : null;

      sendResponse({
        success: true,
        platform: 'youtube',
        title: title || 'YouTube Video',
        hasTracks: tracks && tracks.length > 0,
        tracksCount: tracks ? tracks.length : 0,
        selectedTrack: selected ? {
          label: selected.name?.simpleText || selected.languageCode || 'English'
        } : null
      });
      return false;
    }
    if (msg.action === 'open_vocab_modal') {
      if (typeof YouTubeVocabManager !== 'undefined') {
        YouTubeVocabManager.openModal();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'YouTubeVocabManager not initialized' });
      }
      return false;
    }
    if (msg.action === 'download_subtitles') {
      if (typeof YouTubeVocabManager !== 'undefined') {
        YouTubeVocabManager.handleDownload(msg.format || 'srt').then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
        return true;
      } else {
        sendResponse({ success: false, error: 'YouTubeVocabManager not initialized' });
        return false;
      }
    }
  });

  // MutationObserver for dynamic captions
  const captionObserver = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        PlayerController.ensureCaptionAttributes();
        break;
      }
    }
  });

  function initObserver() {
    const player = document.querySelector(SELECTORS.PLAYER) || document.body;
    if (player) {
      captionObserver.observe(player, { childList: true, subtree: true });
    }
  }

  window.addEventListener('yt-navigate-finish', () => {
    initObserver();
    PlayerController.ensureCaptionAttributes();
    if (typeof YouTubeVocabManager !== 'undefined') {
      YouTubeVocabManager.cues = [];
      YouTubeVocabManager.analysis = null;
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('af_youtube_request_info'));
      }, 1000);
    }
  });

  // Startup
  initSettings();
  initObserver();
  PlayerController.ensureCaptionAttributes();
  if (typeof YouTubeVocabManager !== 'undefined') {
    YouTubeVocabManager.init();
  }
})();
