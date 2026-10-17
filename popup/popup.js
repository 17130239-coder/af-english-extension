/**
 * YouTube Subtitle Click & Copy - Popup Script
 * Architecture: Declarative SettingsBinder, QuickAddManager, and HistoryRenderer
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const UTILS = (typeof APP_UTILS !== 'undefined') ? APP_UTILS : null;
  const CONSTANTS = (typeof APP_CONSTANTS !== 'undefined') ? APP_CONSTANTS : null;
  const STORAGE_KEYS = CONSTANTS ? CONSTANTS.STORAGE_KEYS : {
    ENABLED: 'enabled',
    COPY_MODE: 'copyMode',
    AUTO_PAUSE: 'autoPause',
    SHOW_TOAST: 'showToast',
    SHOW_HIGHLIGHT: 'showHighlight',
    COPY_HISTORY: 'copyHistory'
  };

  // DOM Query Helpers
  const $ = (id) => document.getElementById(id);

  const elements = {
    toggleEnabled: $('toggle-enabled'),
    modeFull: $('mode-full'),
    modeSegment: $('mode-segment'),
    toggleAutoPause: $('toggle-auto-pause'),
    toggleToast: $('toggle-toast'),
    toggleHighlight: $('toggle-highlight'),
    historyList: $('history-list'),
    btnClearHistory: $('btn-clear-history'),
    btnOpenDashboard: $('btn-open-dashboard'),
    inputQuickAdd: $('input-quick-add'),
    btnQuickAdd: $('btn-quick-add'),
    kbdCapture: $('kbd-capture'),
    kbdSave: $('kbd-save'),
    mediaCard: $('media-card'),
    mediaBadge: $('media-badge'),
    mediaStatus: $('media-status'),
    mediaTrackName: $('media-track-name'),
    mediaTitle: $('media-title'),
    btnMediaSplitVocab: $('btn-media-split-vocab'),
    btnDlSrt: $('btn-dl-srt'),
    btnDlVtt: $('btn-dl-vtt'),
    btnDlTxt: $('btn-dl-txt')
  };

  /**
   * OS-aware Keyboard Shortcut Labels (macOS Option vs Windows Alt)
   */
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (elements.kbdCapture) {
    elements.kbdCapture.textContent = isMac ? '⌥C' : 'Alt+C';
  }
  if (elements.kbdSave) {
    elements.kbdSave.textContent = isMac ? '⌥S' : 'Alt+S';
  }

  /**
   * Navigation to Full Dashboard
   */
  if (elements.btnOpenDashboard) {
    elements.btnOpenDashboard.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    });
  }

  /**
   * Declarative Settings Binder
   */
  const SettingsBinder = {
    keys: [
      STORAGE_KEYS.ENABLED || 'enabled',
      STORAGE_KEYS.COPY_MODE || 'copyMode',
      STORAGE_KEYS.AUTO_PAUSE || 'autoPause',
      STORAGE_KEYS.SHOW_TOAST || 'showToast',
      STORAGE_KEYS.SHOW_HIGHLIGHT || 'showHighlight'
    ],

    init() {
      chrome.storage.local.get(this.keys, (res) => {
        if (!res) return;
        if (elements.toggleEnabled && res.enabled !== undefined) {
          elements.toggleEnabled.checked = res.enabled;
        }
        if (elements.modeSegment && elements.modeFull) {
          if (res.copyMode === 'segment') {
            elements.modeSegment.checked = true;
          } else {
            elements.modeFull.checked = true;
          }
        }
        if (elements.toggleAutoPause && res.autoPause !== undefined) {
          elements.toggleAutoPause.checked = res.autoPause;
        }
        if (elements.toggleToast && res.showToast !== undefined) {
          elements.toggleToast.checked = res.showToast;
        }
        if (elements.toggleHighlight && res.showHighlight !== undefined) {
          elements.toggleHighlight.checked = res.showHighlight;
        }
      });

      this.bindEvents();
    },

    bindEvents() {
      if (elements.toggleEnabled) {
        elements.toggleEnabled.addEventListener('change', () => {
          chrome.storage.local.set({ enabled: elements.toggleEnabled.checked });
        });
      }

      if (elements.modeFull) {
        elements.modeFull.addEventListener('change', () => {
          if (elements.modeFull.checked) chrome.storage.local.set({ copyMode: 'full' });
        });
      }

      if (elements.modeSegment) {
        elements.modeSegment.addEventListener('change', () => {
          if (elements.modeSegment.checked) chrome.storage.local.set({ copyMode: 'segment' });
        });
      }

      if (elements.toggleAutoPause) {
        elements.toggleAutoPause.addEventListener('change', () => {
          chrome.storage.local.set({ autoPause: elements.toggleAutoPause.checked });
        });
      }

      if (elements.toggleToast) {
        elements.toggleToast.addEventListener('change', () => {
          chrome.storage.local.set({ showToast: elements.toggleToast.checked });
        });
      }

      if (elements.toggleHighlight) {
        elements.toggleHighlight.addEventListener('change', () => {
          chrome.storage.local.set({ showHighlight: elements.toggleHighlight.checked });
        });
      }
    }
  };

  /**
   * Quick Add Manager
   */
  const QuickAddManager = {
    init() {
      if (!elements.btnQuickAdd || !elements.inputQuickAdd) return;

      elements.btnQuickAdd.addEventListener('click', () => this.handleAdd());
      elements.inputQuickAdd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleAdd();
        }
      });
    },

    handleAdd() {
      const text = elements.inputQuickAdd.value.trim();
      if (!text) {
        elements.inputQuickAdd.focus();
        return;
      }

      const newItem = (UTILS && UTILS.createSubtitleEntity)
        ? UTILS.createSubtitleEntity({
            text: text,
            videoTitle: 'Ghi chép thủ công (Popup)',
            status: 'pending'
          })
        : {
            id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            text: text,
            timestamp: Date.now(),
            videoTitle: 'Ghi chép thủ công (Popup)',
            url: '',
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
        history = history.filter(item => item.text.trim().toLowerCase() !== text.toLowerCase());
        history.unshift(newItem);
        if (history.length > 500) history = history.slice(0, 500);
        chrome.storage.local.set({ copyHistory: history }, () => {
          HistoryRenderer.render(history);
        });
      });

      // 2. Persist to Neon Postgres
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'neon_saveSubtitle', item: newItem });
      } else if (typeof neonClient !== 'undefined' && neonClient.saveSubtitle) {
        neonClient.saveSubtitle(newItem).catch(console.warn);
      }

      // 3. Button feedback
      elements.inputQuickAdd.value = '';
      elements.btnQuickAdd.classList.add('added');
      elements.btnQuickAdd.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Đã thêm</span>
      `;
      setTimeout(() => {
        elements.btnQuickAdd.classList.remove('added');
        elements.btnQuickAdd.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Thêm</span>
        `;
      }, 1200);
    }
  };

  /**
   * History Renderer Component
   */
  const HistoryRenderer = {
    render(items) {
      if (!elements.historyList) return;
      elements.historyList.innerHTML = '';

      if (!items || items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = 'Chưa có phụ đề nào được copy. Mở video YouTube và bấm vào phụ đề để trải nghiệm!';
        elements.historyList.appendChild(empty);
        return;
      }

      items.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'history-item';

        const textBox = document.createElement('div');
        textBox.className = 'history-text-box';

        const textSpan = document.createElement('span');
        textSpan.className = 'history-text';
        textSpan.textContent = item.text;
        textSpan.title = item.text;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'history-time';
        timeSpan.textContent = (UTILS && UTILS.formatRelativeTime)
          ? UTILS.formatRelativeTime(item.timestamp)
          : new Date(item.timestamp).toLocaleDateString();

        textBox.appendChild(textSpan);

        if (item.keyPhrase && item.phraseTranslation) {
          const kpSpan = document.createElement('span');
          kpSpan.className = 'history-kp';
          kpSpan.innerHTML = `<b>${item.keyPhrase}</b>: ${item.phraseTranslation}`;
          textBox.appendChild(kpSpan);
        } else if (item.translation) {
          const transSpan = document.createElement('span');
          transSpan.className = 'history-kp';
          transSpan.textContent = item.translation;
          textBox.appendChild(transSpan);
        }

        const metaRow = document.createElement('div');
        metaRow.className = 'history-meta-row';
        metaRow.appendChild(timeSpan);

        const ytSec = (UTILS && UTILS.parseYouTubeTimestamp) ? UTILS.parseYouTubeTimestamp(item.url) : null;
        if (ytSec !== null) {
          const timeInfo = (UTILS && UTILS.formatVideoTime) ? UTILS.formatVideoTime(ytSec) : null;
          const timeDisplay = timeInfo ? timeInfo.timeStr : `${ytSec}s`;
          const tsBadge = document.createElement('a');
          tsBadge.className = 'popup-timestamp-link';
          tsBadge.href = item.url;
          tsBadge.target = '_blank';
          tsBadge.title = `Mở YouTube tại ${timeDisplay}`;
          tsBadge.textContent = `· ${timeDisplay}`;
          tsBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: item.url });
          });
          metaRow.appendChild(tsBadge);
        }

        textBox.appendChild(metaRow);

        // Actions
        const actionsBox = document.createElement('div');
        actionsBox.className = 'history-actions';

        // TTS Pronounce Button
        const speakBtn = document.createElement('button');
        speakBtn.className = 'btn-speak-item';
        speakBtn.title = 'Phát âm (TTS)';
        speakBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        `;
        speakBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (UTILS && UTILS.speakText) {
            UTILS.speakText(item.text);
          }
        });

        // Edit Button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-item';
        editBtn.title = 'Chỉnh sửa câu';
        editBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
          </svg>
        `;
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showInlineEdit(div, item);
        });

        // Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-copy-item';
        copyBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        `;
        copyBtn.title = 'Sao chép lại';
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(item.text);
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
            setTimeout(() => {
              copyBtn.classList.remove('copied');
              copyBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              `;
            }, 1200);
          } catch (e) {
            console.error('Copy failed:', e);
          }
        });

        actionsBox.appendChild(speakBtn);
        actionsBox.appendChild(editBtn);
        actionsBox.appendChild(copyBtn);

        div.appendChild(textBox);
        div.appendChild(actionsBox);
        elements.historyList.appendChild(div);
      });
    },

    showInlineEdit(container, item) {
      container.innerHTML = '';
      const editBox = document.createElement('div');
      editBox.className = 'inline-edit-box';

      const input = document.createElement('textarea');
      input.rows = 2;
      input.className = 'inline-edit-textarea';
      input.value = item.text;

      const actRow = document.createElement('div');
      actRow.className = 'inline-edit-actions';

      const btnSave = document.createElement('button');
      btnSave.className = 'btn-inline-save';
      btnSave.textContent = 'Lưu';

      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn-inline-cancel';
      btnCancel.textContent = 'Hủy';

      btnSave.addEventListener('click', () => {
        const newText = input.value.trim();
        if (!newText) return;
        item.text = newText;

        chrome.storage.local.get(['copyHistory'], (res) => {
          let history = res.copyHistory || [];
          const idx = history.findIndex(h => h.id === item.id);
          if (idx !== -1) {
            history[idx].text = newText;
          }
          chrome.storage.local.set({ copyHistory: history }, () => {
            this.render(history);
          });
        });

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'neon_updateSubtitle', item: item });
        } else if (typeof neonClient !== 'undefined' && neonClient.updateSubtitle) {
          neonClient.updateSubtitle(item).catch(console.warn);
        }
      });

      btnCancel.addEventListener('click', () => {
        chrome.storage.local.get(['copyHistory'], (res) => {
          this.render(res.copyHistory || []);
        });
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          btnSave.click();
        }
        if (e.key === 'Escape') btnCancel.click();
      });

      actRow.appendChild(btnCancel);
      actRow.appendChild(btnSave);
      editBox.appendChild(input);
      editBox.appendChild(actRow);
      container.appendChild(editBox);
      input.focus();
      input.select();
    }
  };

  /**
   * Clear History Button
   */
  if (elements.btnClearHistory) {
    elements.btnClearHistory.addEventListener('click', () => {
      if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử phụ đề trên cả tiện ích và Neon Cloud?')) {
        return;
      }
      if (typeof neonClient !== 'undefined' && neonClient.clearAllSubtitles) {
        neonClient.clearAllSubtitles().catch(console.warn);
      }
      chrome.storage.local.set({ copyHistory: [] }, () => {
        HistoryRenderer.render([]);
      });
    });
  }

  /**
   * Active Media Manager (Netflix & YouTube Live Detection & Subtitles)
   */
  const ActiveMediaManager = {
    activeTab: null,
    mediaInfo: null,

    async init() {
      if (!elements.mediaCard) return;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
          elements.mediaCard.style.display = 'none';
          return;
        }

        const isYouTube = tab.url.includes('youtube.com/watch') || tab.url.includes('youtube.com/shorts/');
        const isNetflix = tab.url.includes('netflix.com/watch/');

        if (!isYouTube && !isNetflix) {
          elements.mediaCard.style.display = 'none';
          return;
        }

        this.activeTab = tab;
        const platform = isNetflix ? 'netflix' : 'youtube';

        // Query active content script for media details
        chrome.tabs.sendMessage(tab.id, { action: 'get_media_info' }, (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            this.renderFallback(platform, tab.title);
            return;
          }

          this.mediaInfo = response;
          this.render(platform, response);
        });

        this.bindEvents();
      } catch (err) {
        console.warn('[Popup] Active media detection error:', err);
      }
    },

    renderFallback(platform, title) {
      if (!elements.mediaCard) return;
      elements.mediaCard.style.display = 'flex';
      if (elements.mediaBadge) {
        elements.mediaBadge.textContent = platform === 'netflix' ? 'Netflix' : 'YouTube';
        elements.mediaBadge.className = `media-badge ${platform === 'netflix' ? 'nflx' : 'yt'}`;
      }
      if (elements.mediaStatus) elements.mediaStatus.textContent = 'Đang phát';
      if (elements.mediaTrackName) elements.mediaTrackName.textContent = 'Auto';
      if (elements.mediaTitle) {
        elements.mediaTitle.textContent = (title || 'Video đang phát').replace(' - YouTube', '').replace(' - Netflix', '');
      }
    },

    render(platform, info) {
      if (!elements.mediaCard) return;
      elements.mediaCard.style.display = 'flex';
      if (elements.mediaBadge) {
        elements.mediaBadge.textContent = platform === 'netflix' ? 'Netflix' : 'YouTube';
        elements.mediaBadge.className = `media-badge ${platform === 'netflix' ? 'nflx' : 'yt'}`;
      }
      if (elements.mediaStatus) {
        elements.mediaStatus.textContent = info.hasTracks ? '✓ Sẵn sàng' : 'Chờ phụ đề';
      }
      if (elements.mediaTrackName) {
        elements.mediaTrackName.textContent = info.selectedTrack?.label || (info.hasTracks ? 'English' : 'Chưa có track');
      }
      if (elements.mediaTitle) {
        elements.mediaTitle.textContent = info.title || (this.activeTab?.title || 'Video').replace(' - YouTube', '').replace(' - Netflix', '');
      }
    },

    bindEvents() {
      if (elements.btnMediaSplitVocab) {
        elements.btnMediaSplitVocab.addEventListener('click', () => {
          if (!this.activeTab) return;
          chrome.tabs.sendMessage(this.activeTab.id, { action: 'open_vocab_modal' }, () => {
            window.close();
          });
        });
      }

      const downloadHandler = (format) => {
        if (!this.activeTab) return;
        chrome.tabs.sendMessage(this.activeTab.id, { action: 'download_subtitles', format }, (res) => {
          if (chrome.runtime.lastError || (res && !res.success)) {
            alert('Không thể tải file phụ đề từ trang này. Vui lòng đảm bảo video đã bật phụ đề tiếng Anh.');
          }
        });
      };

      if (elements.btnDlSrt) elements.btnDlSrt.addEventListener('click', () => downloadHandler('srt'));
      if (elements.btnDlVtt) elements.btnDlVtt.addEventListener('click', () => downloadHandler('vtt'));
      if (elements.btnDlTxt) elements.btnDlTxt.addEventListener('click', () => downloadHandler('txt'));
    }
  };

  // -------------------------------------------------------------
  // Initialization & Live Storage Sync
  // -------------------------------------------------------------
  SettingsBinder.init();
  QuickAddManager.init();
  ActiveMediaManager.init();

  // Load History from storage cache, then refresh from Neon
  chrome.storage.local.get(['copyHistory'], (res) => {
    HistoryRenderer.render(res.copyHistory || []);

    if (typeof neonClient !== 'undefined' && neonClient.getAllSubtitles) {
      neonClient.getAllSubtitles(25).then((items) => {
        if (Array.isArray(items) && items.length > 0) {
          HistoryRenderer.render(items);
        }
      }).catch(console.warn);
    }
  });

  // Observe live history updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.copyHistory) {
      HistoryRenderer.render(changes.copyHistory.newValue || []);
    }
  });
});
