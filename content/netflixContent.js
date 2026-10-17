/**
 * AF English - Netflix Content Script
 * Injects the Netflix bridge, renders floating subtitle & vocab control widget on Netflix player,
 * and handles subtitle downloads and vocabulary analysis.
 */

(function () {
  'use strict';

  if (window.__afNetflixContentInjected) return;
  window.__afNetflixContentInjected = true;

  const UTILS = (typeof APP_UTILS !== 'undefined') ? APP_UTILS : null;
  const PARSER = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER : null;

  let currentMovieData = {
    movieId: null,
    title: '',
    season: null,
    episode: null,
    episodeTitle: '',
    isSeries: false,
    tracks: [],
    selectedTrack: null,
    cues: [],
    analysis: null
  };

  /**
   * Inject MAIN world bridge script.
   */
  function injectBridgeScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/netflixInjected.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[AF Netflix] Failed to inject bridge script:', e);
    }
  }

  /**
   * Listen for bridge events from injected script.
   */
  window.addEventListener('af_netflix_bridge_event', (e) => {
    const { type, data } = e.detail || {};
    if (!data) return;

    if (type === 'metadata_ready' || type === 'tracks_ready') {
      if (data.movieId) currentMovieData.movieId = data.movieId;
      if (data.title) currentMovieData.title = data.title;
      if (data.season !== undefined) currentMovieData.season = data.season;
      if (data.episode !== undefined) currentMovieData.episode = data.episode;
      if (data.episodeTitle) currentMovieData.episodeTitle = data.episodeTitle;
      if (data.isSeries !== undefined) currentMovieData.isSeries = data.isSeries;

      if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        currentMovieData.tracks = data.tracks;
        // Prefer English tracks
        const enTrack = data.tracks.find(t => t.isEnglish && !t.isForced) || data.tracks.find(t => t.isEnglish) || data.tracks[0];
        currentMovieData.selectedTrack = enTrack;
      }

      updateWidgetUI();
    }
  });

  /**
   * Format full movie/episode display title.
   */
  function getFullDisplayTitle() {
    let title = currentMovieData.title || document.title.replace(' - Netflix', '').trim() || 'Netflix Title';
    if (currentMovieData.isSeries && currentMovieData.season && currentMovieData.episode) {
      const s = String(currentMovieData.season).padStart(2, '0');
      const ep = String(currentMovieData.episode).padStart(2, '0');
      title = `${title} S${s}E${ep}`;
      if (currentMovieData.episodeTitle) {
        title += ` - ${currentMovieData.episodeTitle}`;
      }
    }
    return title;
  }

  /**
   * Floating Widget Component
   */
  let widgetContainer = null;
  let modalContainer = null;

  function createWidget() {
    try {
      document.getElementById('af-netflix-widget')?.remove();
      document.getElementById('af-modal-backdrop')?.remove();
    } catch (e) {}
  }

  function updateWidgetUI() {
    try {
      document.getElementById('af-netflix-widget')?.remove();
    } catch (e) {}
  }

  /**
   * Fetch and parse subtitle content from track download URL.
   */
  async function fetchSubtitles() {
    if (currentMovieData.cues.length > 0) return currentMovieData.cues;

    if (!currentMovieData.selectedTrack || !currentMovieData.selectedTrack.downloadUrl) {
      // Trigger request to refresh tracks
      window.dispatchEvent(new CustomEvent('af_netflix_request_info'));
      throw new Error('Chưa tìm thấy đường dẫn phụ đề. Hãy chắc chắn phim đang phát và đã bật phụ đề tiếng Anh trên Netflix.');
    }

    const resp = await fetch(currentMovieData.selectedTrack.downloadUrl);
    if (!resp.ok) throw new Error(`Không thể tải file phụ đề (HTTP ${resp.status})`);

    const rawText = await resp.text();
    const cues = PARSER ? PARSER.parse(rawText) : [];
    if (!cues || cues.length === 0) {
      throw new Error('Không phân tích được nội dung phụ đề từ Netflix.');
    }

    currentMovieData.cues = cues;
    return cues;
  }

  /**
   * Modal Dialog UI
   */
  function openVocabModal() {
    if (!modalContainer) {
      modalContainer = document.createElement('div');
      modalContainer.id = 'af-netflix-modal-backdrop';
      modalContainer.className = 'af-modal-backdrop';
      document.body.appendChild(modalContainer);
    }

    const displayTitle = getFullDisplayTitle();
    const hasTrack = Boolean(currentMovieData.selectedTrack);

    modalContainer.innerHTML = `
      <div class="af-modal-card">
        <!-- Header -->
        <div class="af-modal-header">
          <div class="af-modal-title-group">
            <span class="af-modal-tag">🎬 Netflix English Studio</span>
            <h2 class="af-modal-title">${UTILS ? UTILS.escapeHtml(displayTitle) : displayTitle}</h2>
          </div>
          <button class="af-modal-close" id="af-modal-btn-close">&times;</button>
        </div>

        <!-- Body -->
        <div class="af-modal-body">
          <!-- Track Selector -->
          <div class="af-track-selector-bar">
            <label class="af-field-label">Kênh phụ đề:</label>
            <select id="af-select-track" class="af-select">
              ${(currentMovieData.tracks || []).map((t, idx) => `
                <option value="${idx}" ${t === currentMovieData.selectedTrack ? 'selected' : ''}>
                  ${t.label} (${t.language}) ${t.isClosedCaptions ? '[CC]' : ''}
                </option>
              `).join('')}
              ${(!currentMovieData.tracks || currentMovieData.tracks.length === 0) ? '<option value="">(Chưa bắt được phụ đề - hãy Play video 1 vài giây)</option>' : ''}
            </select>
          </div>

          <!-- Action Buttons Bar -->
          <div class="af-actions-row">
            <button id="af-btn-analyze" class="af-btn af-btn-primary" ${!hasTrack ? 'disabled' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>Phân loại từ vựng (Nouns, Verbs, Adj, Adv)</span>
            </button>

            <div class="af-download-btn-group">
              <button id="af-btn-download-srt" class="af-btn af-btn-outline" title="Tải file SubRip .SRT">
                <span>⬇ .SRT</span>
              </button>
              <button id="af-btn-download-vtt" class="af-btn af-btn-outline" title="Tải file WebVTT .VTT">
                <span>⬇ .VTT</span>
              </button>
              <button id="af-btn-download-txt" class="af-btn af-btn-outline" title="Tải văn bản transcript .TXT">
                <span>⬇ .TXT</span>
              </button>
            </div>

            <button id="af-btn-open-dashboard" class="af-btn af-btn-secondary" title="Mở trang Dashboard đầy đủ">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              <span>Mở Studio</span>
            </button>
          </div>

          <!-- Loading Spinner -->
          <div id="af-modal-loading" class="af-loading-state" style="display:none;">
            <div class="af-spinner"></div>
            <span id="af-loading-text">Đang tải và phân loại từ vựng...</span>
          </div>

          <!-- Analysis Results Container -->
          <div id="af-analysis-results" class="af-analysis-results" style="display:none;">
            <!-- POS Stat Pills -->
            <div class="af-pos-tabs">
              <button class="af-pos-tab active" data-pos="all">Tất cả (<span id="count-all">0</span>)</button>
              <button class="af-pos-tab" data-pos="noun">📘 Danh từ (<span id="count-noun">0</span>)</button>
              <button class="af-pos-tab" data-pos="verb">📙 Động từ (<span id="count-verb">0</span>)</button>
              <button class="af-pos-tab" data-pos="adjective">📗 Tính từ (<span id="count-adj">0</span>)</button>
              <button class="af-pos-tab" data-pos="adverb">📕 Trạng từ (<span id="count-adv">0</span>)</button>
            </div>

            <!-- Search inside words -->
            <div class="af-search-bar">
              <input type="text" id="af-search-words" placeholder="Tìm nhanh từ vựng hoặc nghĩa tiếng Việt...">
              <button id="af-btn-export-anki" class="af-btn-sm af-btn-anki">🗂️ Xuất Anki</button>
              <button id="af-btn-export-csv" class="af-btn-sm af-btn-csv">📊 Xuất CSV</button>
            </div>

            <!-- Words List Grid -->
            <div id="af-words-grid" class="af-words-grid"></div>
          </div>
        </div>
      </div>
    `;

    modalContainer.style.display = 'flex';

    // Bind event handlers
    document.getElementById('af-modal-btn-close').onclick = () => {
      modalContainer.style.display = 'none';
    };

    modalContainer.onclick = (e) => {
      if (e.target === modalContainer) modalContainer.style.display = 'none';
    };

    const trackSelect = document.getElementById('af-select-track');
    if (trackSelect) {
      trackSelect.onchange = () => {
        const idx = parseInt(trackSelect.value, 10);
        if (!isNaN(idx) && currentMovieData.tracks[idx]) {
          currentMovieData.selectedTrack = currentMovieData.tracks[idx];
          currentMovieData.cues = [];
          currentMovieData.analysis = null;
          updateWidgetUI();
        }
      };
    }

    // Download handlers
    document.getElementById('af-btn-download-srt').onclick = () => handleDownload('srt');
    document.getElementById('af-btn-download-vtt').onclick = () => handleDownload('vtt');
    document.getElementById('af-btn-download-txt').onclick = () => handleDownload('txt');

    // Analyze handler
    document.getElementById('af-btn-analyze').onclick = () => runVocabularyAnalysis();

    // Open Dashboard
    document.getElementById('af-btn-open-dashboard').onclick = () => {
      // Store current subtitle and cues in local storage for Dashboard to pick up
      if (currentMovieData.cues.length > 0) {
        chrome.storage.local.set({
          pendingVocabStudio: {
            title: getFullDisplayTitle(),
            url: window.location.href,
            cues: currentMovieData.cues,
            analysis: currentMovieData.analysis
          }
        }, () => {
          chrome.runtime.sendMessage({ action: 'openDashboard' });
        });
      } else {
        chrome.runtime.sendMessage({ action: 'openDashboard' });
      }
    };
  }

  /**
   * Run VOCABULARY ANALYSIS on current Netflix subtitle cues.
   */
  async function runVocabularyAnalysis() {
    const loadingEl = document.getElementById('af-modal-loading');
    const loadingText = document.getElementById('af-loading-text');
    const resultsEl = document.getElementById('af-analysis-results');

    try {
      loadingEl.style.display = 'flex';
      loadingText.textContent = 'Đang tải phụ đề tiếng Anh từ Netflix...';

      const cues = await fetchSubtitles();

      loadingText.textContent = `Đang phân loại ${cues.length} câu phụ đề (Nouns, Verbs, Adj, Adv)...`;

      // Request background or local analyzer
      chrome.runtime.sendMessage({
        action: 'analyze_subtitles',
        cues: cues,
        options: {
          videoTitle: getFullDisplayTitle(),
          videoUrl: window.location.href
        }
      }, (response) => {
        loadingEl.style.display = 'none';

        if (response && response.success && response.analysis) {
          currentMovieData.analysis = response.analysis;
          resultsEl.style.display = 'block';
          renderAnalysisUI(response.analysis);
        } else {
          alert('Lỗi phân tích: ' + (response ? response.error : 'Không có phản hồi từ background worker'));
        }
      });
    } catch (err) {
      loadingEl.style.display = 'none';
      alert(err.message || 'Lỗi khi tải và phân tích phụ đề');
    }
  }

  /**
   * Render Analysis UI with tabs and word cards.
   */
  let activePosFilter = 'all';

  function renderAnalysisUI(analysis) {
    if (!analysis) return;
    const { summary, posGroups, allWords } = analysis;

    document.getElementById('count-all').textContent = summary.uniqueWords;
    document.getElementById('count-noun').textContent = summary.nounCount;
    document.getElementById('count-verb').textContent = summary.verbCount;
    document.getElementById('count-adj').textContent = summary.adjCount;
    document.getElementById('count-adv').textContent = summary.advCount;

    // Tabs setup
    const tabs = document.querySelectorAll('.af-pos-tab');
    tabs.forEach((tab) => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activePosFilter = tab.getAttribute('data-pos');
        filterAndRenderWords(allWords);
      };
    });

    const searchInput = document.getElementById('af-search-words');
    searchInput.oninput = () => {
      filterAndRenderWords(allWords, searchInput.value.trim().toLowerCase());
    };

    // Export Anki & CSV
    document.getElementById('af-btn-export-anki').onclick = () => {
      chrome.runtime.sendMessage({
        action: 'export_vocab',
        format: 'anki',
        words: getFilteredWords(allWords, activePosFilter, searchInput.value.trim().toLowerCase()),
        title: getFullDisplayTitle()
      });
    };

    document.getElementById('af-btn-export-csv').onclick = () => {
      chrome.runtime.sendMessage({
        action: 'export_vocab',
        format: 'csv',
        words: getFilteredWords(allWords, activePosFilter, searchInput.value.trim().toLowerCase()),
        title: getFullDisplayTitle()
      });
    };

    filterAndRenderWords(allWords);
  }

  function getFilteredWords(words, posFilter, query = '') {
    return words.filter((w) => {
      if (posFilter !== 'all' && w.pos !== posFilter) return false;
      if (query) {
        return w.word.toLowerCase().includes(query) || (w.translation && w.translation.toLowerCase().includes(query));
      }
      return true;
    });
  }

  function filterAndRenderWords(words, query = '') {
    const grid = document.getElementById('af-words-grid');
    if (!grid) return;

    const filtered = getFilteredWords(words, activePosFilter, query);

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
        <div class="af-word-card" data-word="${UTILS ? UTILS.escapeHtml(item.word) : item.word}">
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
              <button class="af-btn-seek" data-sec="${firstCtx.startSec}" title="Nhảy tới đoạn này trong phim">
                ▶ ${firstCtx.startTime}
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Bind speak buttons
    grid.querySelectorAll('.af-btn-speak').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const text = btn.getAttribute('data-speak');
        if (UTILS && UTILS.speakText) UTILS.speakText(text);
      };
    });

    // Bind seek buttons
    grid.querySelectorAll('.af-btn-seek').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const sec = parseFloat(btn.getAttribute('data-sec'));
        if (!isNaN(sec)) {
          window.dispatchEvent(new CustomEvent('af_netflix_seek', { detail: { seconds: sec } }));
        }
      };
    });
  }

  /**
   * Handle Subtitle File Downloads (.srt, .vtt, .txt)
   */
  async function handleDownload(format) {
    try {
      const cues = await fetchSubtitles();
      const safeTitle = (getFullDisplayTitle() || 'netflix_subtitles').replace(/[/\\?%*:|"<>]/g, '_');
      let content = '';
      let filename = `${safeTitle}.${format}`;
      let mimeType = 'text/plain;charset=utf-8;';

      if (format === 'srt') {
        content = PARSER.toSRT(cues);
        mimeType = 'application/x-subrip;charset=utf-8;';
      } else if (format === 'vtt') {
        content = PARSER.toWebVTT(cues);
        mimeType = 'text/vtt;charset=utf-8;';
      } else if (format === 'txt') {
        content = PARSER.toReadableTranscript(cues);
      }

      if (UTILS && UTILS.downloadFile) {
        UTILS.downloadFile(content, filename, mimeType);
      }
    } catch (err) {
      alert(err.message || 'Không thể tải file phụ đề');
    }
  }

  // Message listener for popup/background commands
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'get_media_info') {
        sendResponse({
          success: true,
          platform: 'netflix',
          title: getFullDisplayTitle(),
          movieId: currentMovieData.movieId,
          hasTracks: currentMovieData.tracks && currentMovieData.tracks.length > 0,
          tracksCount: currentMovieData.tracks ? currentMovieData.tracks.length : 0,
          selectedTrack: currentMovieData.selectedTrack ? {
            id: currentMovieData.selectedTrack.id,
            label: currentMovieData.selectedTrack.label || currentMovieData.selectedTrack.language
          } : null
        });
        return false;
      }

      if (msg.action === 'open_vocab_modal') {
        openVocabModal();
        sendResponse({ success: true });
        return false;
      }

      if (msg.action === 'download_subtitles') {
        handleDownload(msg.format || 'srt').then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
        return true;
      }
    });
  }

  // Initial startup
  function init() {
    injectBridgeScript();
    createWidget();

    // Re-check periodically when URL changes (user navigates between episodes)
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        currentMovieData.cues = [];
        currentMovieData.analysis = null;
        window.dispatchEvent(new CustomEvent('af_netflix_request_info'));
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
