/**
 * YouTube Subtitle Click & Copy - AI Vocabulary Dashboard
 * Architecture: Clean Component Model (Store, CardRenderer, BatchTranslator, ExportService, ModalManager)
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const UTILS = (typeof APP_UTILS !== 'undefined') ? APP_UTILS : null;
  const CONSTANTS = (typeof APP_CONSTANTS !== 'undefined') ? APP_CONSTANTS : null;
  const $ = (id) => document.getElementById(id);

  // -------------------------------------------------------------
  // 1. Toast Notification Manager
  // -------------------------------------------------------------
  const DashboardToast = {
    el: $('dash-toast'),
    timer: null,

    show(msg, type = 'success') {
      if (!this.el) return;
      if (this.timer) clearTimeout(this.timer);

      let iconSvg = '';
      if (type === 'error') {
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
      } else if (type === 'warning') {
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      } else {
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      }

      this.el.innerHTML = `${iconSvg}<span>${msg}</span>`;
      this.el.classList.remove('hidden');

      this.timer = setTimeout(() => {
        this.el.classList.add('hidden');
      }, 3000);
    }
  };

  /**
   * Safe keyword highlighter for example sentences
   */
  function highlightPhrase(sentence, phrase) {
    if (!sentence) return '';
    // Normalize whitespace before punctuation: e.g. "right there ." -> "right there."
    const normalized = String(sentence).replace(/\s+([.,!?;:])/g, '$1');
    const safeSentence = (UTILS && UTILS.escapeHtml) ? UTILS.escapeHtml(normalized) : normalized;
    if (!phrase) return safeSentence;

    const core = String(phrase)
      .replace(/\b(someone|something|sb|sth|one's|somebody|anything|anybody)\b/gi, '')
      .replace(/[()]/g, '')
      .trim();

    if (!core || core.length < 2) return safeSentence;

    const escapedPattern = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const regex = new RegExp(`\\b(${escapedPattern})\\b`, 'gi');
      return safeSentence.replace(regex, '<mark class="ai-kw-highlight">$1</mark>');
    } catch (e) {
      return safeSentence;
    }
  }

  // -------------------------------------------------------------
  // 2. Dashboard State Store
  // -------------------------------------------------------------
  const DashboardStore = {
    subtitles: [],
    filteredSubtitles: [],
    activeFilter: 'all', // 'all' | 'pending' | 'translated' | 'favorite'
    selectedVideo: 'all',
    searchQuery: '',
    sortOrder: 'newest', // 'newest' | 'oldest' | 'alphabetical'
    isInternalUpdate: false,

    selectedIds: new Set(),
    selectionListeners: [],

    aiSettings: {
      aiProvider: 'nine_router',
      nineRouterBaseUrl: 'http://localhost:20128/v1',
      nineRouterApiKey: '',
      nineRouterModel: 'ag/gemini-3.8-flash-low',
      aiConcurrency: 4,
      geminiApiKey: '',
      geminiModel: 'gemini-1.5-flash',
      openaiApiKey: '',
      openaiModel: 'gpt-4o-mini'
    },

    listeners: [],

    subscribe(listener) {
      this.listeners.push(listener);
    },

    subscribeSelection(listener) {
      this.selectionListeners.push(listener);
    },

    notify() {
      this.computeFiltered();
      this.listeners.forEach(fn => fn(this));
    },

    notifySelection() {
      this.selectionListeners.forEach(fn => fn(this));
    },

    toggleSelect(id) {
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
      } else {
        this.selectedIds.add(id);
      }
      this.notifySelection();
    },

    selectAllFiltered() {
      this.filteredSubtitles.forEach(s => this.selectedIds.add(s.id));
      this.notifySelection();
    },

    clearSelection() {
      this.selectedIds.clear();
      this.notifySelection();
    },

    async deleteSelected() {
      if (this.selectedIds.size === 0) return;
      const idsToDelete = Array.from(this.selectedIds);
      const count = idsToDelete.length;

      this.subtitles = this.subtitles.filter(s => !this.selectedIds.has(s.id));
      this.selectedIds.clear();
      this.saveSubtitles();

      if (typeof neonClient !== 'undefined' && neonClient.deleteSubtitles) {
        neonClient.deleteSubtitles(idsToDelete).catch((err) => {
          console.warn('[Neon Storage] deleteSubtitles in Neon failed:', err);
        });
      }

      this.notify();
      this.notifySelection();
      DashboardToast.show(`Đã xóa ${count} câu đã chọn!`, 'success');
    },

    loadSettings() {
      chrome.storage.local.get([
        'aiProvider',
        'nineRouterBaseUrl',
        'nineRouterApiKey',
        'nineRouterModel',
        'aiConcurrency',
        'geminiApiKey',
        'geminiModel',
        'openaiApiKey',
        'openaiModel'
      ], (res) => {
        if (!res) return;
        this.aiSettings = { ...this.aiSettings, ...res };
      });
    },

    async loadSubtitles() {
      let neonSucceeded = false;
      const badgeNeon = $('badge-neon');
      const statNeonStatus = $('stat-neon-status');

      if (typeof neonClient !== 'undefined' && neonClient.getAllSubtitles) {
        try {
          const neonItems = await neonClient.getAllSubtitles(500);
          if (Array.isArray(neonItems)) {
            this.subtitles = neonItems;
            neonSucceeded = true;
            if (statNeonStatus) statNeonStatus.textContent = 'Connected';
            if (badgeNeon) badgeNeon.classList.remove('offline');

            // Cache in local storage without triggering recursive sync
            this.isInternalUpdate = true;
            chrome.storage.local.set({ copyHistory: this.subtitles }, () => {
              setTimeout(() => { this.isInternalUpdate = false; }, 100);
            });
          }
        } catch (err) {
          console.warn('[Neon Storage] Could not fetch from Neon, loading local cache:', err);
          if (statNeonStatus) statNeonStatus.textContent = 'Offline (Cache)';
          if (badgeNeon) badgeNeon.classList.add('offline');
        }
      }

      if (!neonSucceeded) {
        chrome.storage.local.get(['copyHistory'], (res) => {
          this.subtitles = res.copyHistory || [];
          this.notify();
        });
        return;
      }

      this.notify();
    },

    saveSubtitles() {
      this.isInternalUpdate = true;
      chrome.storage.local.set({ copyHistory: this.subtitles }, () => {
        setTimeout(() => { this.isInternalUpdate = false; }, 100);
        this.notify();
      });
    },

    computeFiltered() {
      let list = [...this.subtitles];

      // 1. Status Filter
      if (this.activeFilter === 'pending') {
        list = list.filter(s => !s.translation);
      } else if (this.activeFilter === 'translated') {
        list = list.filter(s => !!s.translation);
      } else if (this.activeFilter === 'favorite') {
        list = list.filter(s => !!s.isFavorite);
      }

      // 2. Video Filter
      if (this.selectedVideo !== 'all') {
        list = list.filter(s => s.videoTitle === this.selectedVideo);
      }

      // 3. Search Filter
      const q = this.searchQuery.trim().toLowerCase();
      if (q) {
        list = list.filter(s =>
          (s.text && s.text.toLowerCase().includes(q)) ||
          (s.translation && s.translation.toLowerCase().includes(q)) ||
          (s.videoTitle && s.videoTitle.toLowerCase().includes(q)) ||
          (s.explanation && s.explanation.toLowerCase().includes(q))
        );
      }

      // 4. Sort Order
      if (this.sortOrder === 'newest') {
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      } else if (this.sortOrder === 'oldest') {
        list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      } else if (this.sortOrder === 'az' || this.sortOrder === 'alphabetical') {
        list.sort((a, b) => (a.text || '').localeCompare(b.text || ''));
      }

      this.filteredSubtitles = list;
    },

    async toggleFavorite(id) {
      const item = this.subtitles.find(s => s.id === id);
      if (!item) return;

      item.isFavorite = !item.isFavorite;
      this.saveSubtitles();

      if (typeof neonClient !== 'undefined' && neonClient.setFavorite) {
        neonClient.setFavorite(item.id, item.isFavorite).catch((err) => {
          console.warn('[Neon Storage] setFavorite in Neon failed:', err);
        });
      }

      DashboardToast.show(item.isFavorite ? 'Đã thêm vào mục yêu thích!' : 'Đã bỏ yêu thích.', '⭐');
    },

    async deleteItem(id) {
      const idx = this.subtitles.findIndex(s => s.id === id);
      if (idx === -1) return;

      const [removed] = this.subtitles.splice(idx, 1);
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
        this.notifySelection();
      }
      this.saveSubtitles();

      if (typeof neonClient !== 'undefined' && neonClient.deleteSubtitle) {
        neonClient.deleteSubtitle(removed.id).catch((err) => {
          console.warn('[Neon Storage] deleteSubtitle in Neon failed:', err);
        });
      }

      DashboardToast.show('Đã xóa câu khỏi danh sách!', 'success');
    },

    async updateItem(updatedItem) {
      const idx = this.subtitles.findIndex(s => s.id === updatedItem.id);
      if (idx === -1) return;

      this.subtitles[idx] = updatedItem;
      this.saveSubtitles();

      if (typeof neonClient !== 'undefined' && neonClient.updateSubtitle) {
        neonClient.updateSubtitle(updatedItem).catch((err) => {
          console.warn('[Neon Storage] updateSubtitle in Neon failed:', err);
        });
      }
    },

    async addItem(newItem) {
      this.subtitles.unshift(newItem);
      this.saveSubtitles();

      if (typeof neonClient !== 'undefined' && neonClient.saveSubtitle) {
        neonClient.saveSubtitle(newItem).catch((err) => {
          console.warn('[Neon Storage] saveSubtitle in Neon failed:', err);
        });
      }
    }
  };

  // -------------------------------------------------------------
  // 3. Subtitle Card Renderer
  // -------------------------------------------------------------
  const CardRenderer = {
    container: $('cards-container'),
    emptyState: $('empty-state'),

    render(store) {
      if (!this.container) return;
      this.container.innerHTML = '';

      if (store.filteredSubtitles.length === 0) {
        if (this.emptyState) this.emptyState.classList.remove('hidden');
        return;
      }

      if (this.emptyState) this.emptyState.classList.add('hidden');

      const fragment = document.createDocumentFragment();
      store.filteredSubtitles.forEach(item => {
        fragment.appendChild(this.createCardElement(item));
      });
      this.container.appendChild(fragment);
    },

    createCardElement(item) {
      const isSelected = DashboardStore.selectedIds.has(item.id);
      const card = document.createElement('div');
      card.className = `subtitle-card ${item.translation ? 'is-translated' : ''} ${item.isFavorite ? 'is-favorite' : ''} ${isSelected ? 'is-selected' : ''}`;
      card.id = `card-${item.id}`;

      // 1. DÒNG 1: Card Header (Metadata & Hover Actions)
      const header = document.createElement('div');
      header.className = 'card-header';

      // Left: Checkbox (hidden until hover) + Play Video Link (▶ 12:08 · [Title])
      const headerLeft = document.createElement('div');
      headerLeft.className = 'card-header-left';

      // Selection Checkbox
      const selectLabel = document.createElement('label');
      selectLabel.className = 'card-select-label';
      selectLabel.title = 'Chọn thẻ';

      const selectCheckbox = document.createElement('input');
      selectCheckbox.type = 'checkbox';
      selectCheckbox.className = 'card-checkbox';
      selectCheckbox.checked = isSelected;
      selectCheckbox.addEventListener('click', (e) => {
        e.stopPropagation();
        DashboardStore.toggleSelect(item.id);
      });
      selectLabel.appendChild(selectCheckbox);
      headerLeft.appendChild(selectLabel);

      // Play & Video Title (linked directly, no separate 🔗 icon, no red badge, only formatted time)
      const ytSeconds = (UTILS && UTILS.parseYouTubeTimestamp) ? UTILS.parseYouTubeTimestamp(item.url) : null;
      const timeInfo = (ytSeconds !== null && UTILS && UTILS.formatVideoTime) ? UTILS.formatVideoTime(ytSeconds) : null;
      const timeDisplay = timeInfo ? timeInfo.timeStr : (ytSeconds !== null ? `${ytSeconds}s` : null);

      const rawTitle = item.videoTitle || 'YouTube Video';
      const cleanTitleText = (UTILS && UTILS.cleanTitle) ? UTILS.cleanTitle(rawTitle) : rawTitle;

      const videoLink = document.createElement('a');
      videoLink.className = 'card-video-meta';
      videoLink.href = item.url || '#';
      if (item.url) {
        videoLink.target = '_blank';
        videoLink.rel = 'noopener noreferrer';
        videoLink.title = timeDisplay
          ? `Mở video YouTube tại ${timeDisplay} (${cleanTitleText})`
          : `Mở video YouTube: ${cleanTitleText}`;
      }
      videoLink.innerHTML = `
        <span class="card-play-icon">▶</span>
        ${timeDisplay ? `<span class="card-time-str">${timeDisplay}</span><span class="card-meta-dot">·</span>` : ''}
        <span class="card-video-name">${cleanTitleText}</span>
      `;
      headerLeft.appendChild(videoLink);

      // Right: Saved Date by default (e.g. 12/10/2026), replaced by Hover Actions on card hover
      const headerRight = document.createElement('div');
      headerRight.className = 'card-header-right';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'card-date-meta';
      dateSpan.textContent = (UTILS && UTILS.formatRelativeTime)
        ? UTILS.formatRelativeTime(item.timestamp)
        : new Date(item.timestamp).toLocaleDateString();
      headerRight.appendChild(dateSpan);

      // Hover Actions Container: Star (Favorite), Edit, Copy, Retranslate, Delete
      const hoverActions = document.createElement('div');
      hoverActions.className = 'card-hover-actions';

      // Favorite Button
      const btnFav = document.createElement('button');
      btnFav.type = 'button';
      btnFav.className = `btn-card-action btn-fav ${item.isFavorite ? 'active' : ''}`;
      btnFav.title = item.isFavorite ? 'Bỏ yêu thích' : 'Thêm vào yêu thích';
      btnFav.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${item.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      `;
      btnFav.addEventListener('click', (e) => {
        e.stopPropagation();
        DashboardStore.toggleFavorite(item.id);
      });

      // Edit Button
      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-card-action btn-edit';
      btnEdit.title = 'Chỉnh sửa';
      btnEdit.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>
      `;
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        ModalManager.openEdit(item);
      });

      // Copy Button
      const btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.className = 'btn-card-action btn-copy';
      btnCopy.title = 'Sao chép câu tiếng Anh';
      btnCopy.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      btnCopy.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(item.text);
          DashboardToast.show('Đã sao chép câu vào clipboard!', 'success');
        } catch (err) {
          DashboardToast.show('Không thể sao chép!', 'warning');
        }
      });

      // Retranslate Button
      const btnRetranslate = document.createElement('button');
      btnRetranslate.type = 'button';
      btnRetranslate.className = 'btn-card-action btn-retranslate';
      btnRetranslate.title = 'Dịch lại với AI';
      btnRetranslate.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
        </svg>
      `;
      btnRetranslate.addEventListener('click', async (e) => {
        e.stopPropagation();
        btnRetranslate.disabled = true;
        try {
          await BatchTranslator.translateSingleItem(item);
        } catch (err) {
          DashboardToast.show(`Lỗi dịch: ${err.message}`, 'error');
          btnRetranslate.disabled = false;
        }
      });

      // Delete Button
      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn-card-action btn-del';
      btnDel.title = 'Xóa câu';
      btnDel.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
        </svg>
      `;
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Bạn có chắc muốn xóa câu này?')) {
          DashboardStore.deleteItem(item.id);
        }
      });

      hoverActions.appendChild(btnFav);
      hoverActions.appendChild(btnEdit);
      hoverActions.appendChild(btnCopy);
      hoverActions.appendChild(btnRetranslate);
      hoverActions.appendChild(btnDel);
      headerRight.appendChild(hoverActions);

      header.appendChild(headerLeft);
      header.appendChild(headerRight);

      // 1. Khối nội dung phía trên (flex-1 để kéo giãn đều nhau)
      const topContent = document.createElement('div');
      topContent.className = 'card-content-top';
      topContent.appendChild(header);

      // 2. DÒNG 2 & 3: Câu gốc tiếng Anh (inline loa không bao giờ rớt dòng) & Nghĩa tiếng Việt
      const sentenceSection = document.createElement('div');
      sentenceSection.className = 'card-sentence-section';

      const origText = document.createElement('p');
      origText.className = 'card-original-text';

      const highlightedHtml = highlightPhrase(item.text, item.keyPhrase);
      const origSpan = document.createElement('span');

      // Borderless inline speaker icon at the end of the English sentence
      const btnSpeak = document.createElement('button');
      btnSpeak.type = 'button';
      btnSpeak.className = 'btn-inline-speak';
      btnSpeak.title = 'Phát âm tiếng Anh (TTS)';
      btnSpeak.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
      `;
      btnSpeak.addEventListener('click', (e) => {
        e.stopPropagation();
        if (UTILS && UTILS.speakText) UTILS.speakText(item.text);
      });

      // Glue the last word and speaker button together with nowrap so the icon never drops alone
      const lastSpaceIdx = highlightedHtml.lastIndexOf(' ');
      if (lastSpaceIdx !== -1) {
        const lead = highlightedHtml.substring(0, lastSpaceIdx + 1);
        const lastWord = highlightedHtml.substring(lastSpaceIdx + 1);
        origSpan.innerHTML = lead;
        const glueSpan = document.createElement('span');
        glueSpan.style.whiteSpace = 'nowrap';
        glueSpan.innerHTML = lastWord;
        glueSpan.appendChild(btnSpeak);
        origText.appendChild(origSpan);
        origText.appendChild(glueSpan);
      } else {
        origSpan.innerHTML = highlightedHtml;
        origSpan.appendChild(btnSpeak);
        origText.appendChild(origSpan);
      }
      sentenceSection.appendChild(origText);

      // Vietnamese translation right below English sentence (no 'VI' badge)
      if (item.translation) {
        const transText = document.createElement('p');
        transText.className = 'card-translation-text';
        transText.textContent = item.translation;
        sentenceSection.appendChild(transText);
      }

      topContent.appendChild(sentenceSection);

      // 3. DÒNG 4, 5, 6: Cụm từ trọng tâm, Đồng nghĩa & Lưu ý (De-boxing)
      const hasKeyPhrase = Boolean(item.keyPhrase);
      const synList = Array.isArray(item.synonyms) ? item.synonyms : [];
      const hasSynonyms = synList.length > 0;
      const hasExplanation = Boolean(item.explanation);
      const examplesList = (item.examples && item.examples.length > 0)
        ? item.examples
        : (item.exampleSentence ? [{ context: 'Ví dụ', sentence: item.exampleSentence, translation: item.exampleTranslation }] : []);
      const hasExamples = examplesList.length > 0;

      if (hasKeyPhrase || hasSynonyms || hasExplanation) {
        const vocabBox = document.createElement('div');
        vocabBox.className = 'card-vocab-box';

        // 4.1 Cụm từ trọng tâm: `keyPhrase` → `phraseTranslation` 🔊
        if (hasKeyPhrase) {
          const kpRow = document.createElement('div');
          kpRow.className = 'card-keyphrase-row';

          const kpEn = document.createElement('span');
          kpEn.className = 'card-kp-en';
          kpEn.textContent = item.keyPhrase;
          kpRow.appendChild(kpEn);

          if (item.phraseTranslation) {
            const kpArrow = document.createElement('span');
            kpArrow.className = 'card-kp-arrow';
            kpArrow.textContent = '→';
            const kpVi = document.createElement('span');
            kpVi.className = 'card-kp-vi';
            kpVi.textContent = item.phraseTranslation;
            kpRow.appendChild(kpArrow);
            kpRow.appendChild(kpVi);
          }

          const btnListenKp = document.createElement('button');
          btnListenKp.type = 'button';
          btnListenKp.className = 'btn-inline-speak sm';
          btnListenKp.title = 'Nghe phát âm cụm từ';
          btnListenKp.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          `;
          btnListenKp.addEventListener('click', (e) => {
            e.stopPropagation();
            if (UTILS && UTILS.speakText) UTILS.speakText(item.keyPhrase);
          });
          kpRow.appendChild(btnListenKp);

          vocabBox.appendChild(kpRow);
        }

        // 4.2 Từ đồng nghĩa
        if (hasSynonyms) {
          const synRow = document.createElement('div');
          synRow.className = 'card-synonyms-row';

          const synLabel = document.createElement('span');
          synLabel.className = 'card-syn-label';
          synLabel.textContent = 'Đồng nghĩa: ';
          synRow.appendChild(synLabel);

          synList.forEach((syn, sIdx) => {
            const synSpan = document.createElement('span');
            synSpan.className = 'card-syn-item';
            synSpan.textContent = syn;
            synSpan.title = 'Click để nghe phát âm';
            synSpan.addEventListener('click', (e) => {
              e.stopPropagation();
              if (UTILS && UTILS.speakText) UTILS.speakText(syn);
            });
            synRow.appendChild(synSpan);

            if (sIdx < synList.length - 1) {
              const sep = document.createElement('span');
              sep.className = 'card-syn-sep';
              sep.textContent = ', ';
              synRow.appendChild(sep);
            }
          });

          vocabBox.appendChild(synRow);
        }

        // 4.3 Lưu ý sử dụng
        if (hasExplanation) {
          const expRow = document.createElement('div');
          expRow.className = 'card-explanation-quote';
          expRow.textContent = item.explanation;
          vocabBox.appendChild(expRow);
        }

        topContent.appendChild(vocabBox);
      }

      card.appendChild(topContent);

      // 4. DÒNG 7: Ví dụ minh họa (Đẩy xuống sát đáy thẻ mt-auto pt-3)
      if (hasExamples) {
        const exWrapper = document.createElement('div');
        exWrapper.className = 'card-examples-accordion mt-auto pt-3';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn-toggle-examples';
        toggleBtn.innerHTML = `<span>▸ Xem ${examplesList.length} ví dụ ngữ cảnh</span>`;

        const exList = document.createElement('div');
        exList.className = 'card-examples-list hidden';

        examplesList.forEach((ex, idx) => {
          const exItem = document.createElement('div');
          exItem.className = 'card-example-item';

          const exHead = document.createElement('div');
          exHead.className = 'card-example-head';

          const label = document.createElement('span');
          label.className = 'card-example-context-label';
          label.textContent = ex.context || `Ngữ cảnh ${idx + 1}`;

          const btnListenEx = document.createElement('button');
          btnListenEx.type = 'button';
          btnListenEx.className = 'btn-inline-speak sm';
          btnListenEx.title = 'Phát âm ví dụ';
          btnListenEx.innerHTML = `
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          `;
          btnListenEx.addEventListener('click', (e) => {
            e.stopPropagation();
            if (UTILS && UTILS.speakText) UTILS.speakText(ex.sentence);
          });

          exHead.appendChild(label);
          exHead.appendChild(btnListenEx);

          const exEn = document.createElement('div');
          exEn.className = 'card-example-en';
          exEn.innerHTML = highlightPhrase(ex.sentence, item.keyPhrase);

          exItem.appendChild(exHead);
          exItem.appendChild(exEn);

          if (ex.translation) {
            const exVi = document.createElement('div');
            exVi.className = 'card-example-vi';
            exVi.textContent = ex.translation;
            exItem.appendChild(exVi);
          }

          exList.appendChild(exItem);
        });

        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isHidden = exList.classList.toggle('hidden');
          toggleBtn.innerHTML = isHidden
            ? `<span>▸ Xem ${examplesList.length} ví dụ ngữ cảnh</span>`
            : `<span>▾ Thu gọn ví dụ</span>`;
        });

        exWrapper.appendChild(toggleBtn);
        exWrapper.appendChild(exList);
        card.appendChild(exWrapper);
      }

      // Untranslated State: Action button (đẩy sát đáy)
      if (!item.translation) {
        const untranslatedBox = document.createElement('div');
        untranslatedBox.className = 'card-untranslated-box mt-auto pt-3';

        const btnTrigger = document.createElement('button');
        btnTrigger.type = 'button';
        btnTrigger.className = 'btn-trigger-ai';
        btnTrigger.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
          <span>Dịch với AI</span>
        `;
        btnTrigger.addEventListener('click', async (e) => {
          e.stopPropagation();
          btnTrigger.disabled = true;
          btnTrigger.innerHTML = `<span>Đang dịch...</span>`;
          try {
            await BatchTranslator.translateSingleItem(item);
          } catch (err) {
            DashboardToast.show(`Lỗi dịch: ${err.message}`, 'error');
            btnTrigger.disabled = false;
            btnTrigger.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
              <span>Thử lại</span>
            `;
          }
        });

        untranslatedBox.appendChild(btnTrigger);
        card.appendChild(untranslatedBox);
      }

      return card;
    },

    updateSingleCardInDom(item) {
      const existing = document.getElementById(`card-${item.id}`);
      if (existing) {
        const replacement = this.createCardElement(item);
        existing.replaceWith(replacement);
      }
    },

    updateSelectionState() {
      if (!this.container) return;
      const cards = this.container.querySelectorAll('.subtitle-card');
      cards.forEach(card => {
        const id = card.id.replace('card-', '');
        const isSelected = DashboardStore.selectedIds.has(id);
        card.classList.toggle('is-selected', isSelected);
        const cb = card.querySelector('.card-checkbox');
        if (cb) cb.checked = isSelected;
      });
    }
  };

  // -------------------------------------------------------------
  // 4. Batch Translation Manager (High-speed Parallel Engine)
  // -------------------------------------------------------------
  const BatchTranslator = {
    isRunning: false,
    cancelRequested: false,

    elements: {
      btnTranslateAll: $('btn-translate-all'),
      container: $('batch-progress'),
      text: $('batch-progress-text'),
      fill: $('batch-progress-fill'),
      btnCancel: $('btn-cancel-batch')
    },

    init() {
      if (this.elements.btnTranslateAll) {
        this.elements.btnTranslateAll.addEventListener('click', () => this.start());
      }
      if (this.elements.btnCancel) {
        this.elements.btnCancel.addEventListener('click', () => this.cancel());
      }
    },

    async translateSingleItem(item) {
      if (typeof aiService === 'undefined' || !aiService.translateText) {
        throw new Error('Dịch vụ AI không khả dụng');
      }

      const aiResult = await aiService.translateText(item.text, DashboardStore.aiSettings);
      item.keyPhrase = aiResult.keyPhrase || '';
      item.phraseTranslation = aiResult.phraseTranslation || '';
      item.translation = aiResult.translation || '';
      item.explanation = aiResult.explanation || '';
      item.synonyms = aiResult.synonyms || [];
      item.examples = aiResult.examples || [];
      item.exampleSentence = aiResult.exampleSentence || '';
      item.exampleTranslation = aiResult.exampleTranslation || '';
      item.status = 'translated';

      await DashboardStore.updateItem(item);
      CardRenderer.updateSingleCardInDom(item);

      // Persist to Neon Postgres
      if (typeof neonClient !== 'undefined' && neonClient.updateAiResult) {
        neonClient.updateAiResult(item.id, aiResult).catch((err) => {
          console.warn(`[Neon Storage] updateAiResult failed for ${item.id}:`, err);
        });
      }

      DashboardToast.show('Dịch thành công!', 'success');
    },

    async processItemsInParallel(items, label = 'Đang dịch với AI song song') {
      if (this.isRunning) return;
      if (!items || items.length === 0) return;

      this.isRunning = true;
      this.cancelRequested = false;
      const concurrency = Math.max(1, parseInt(DashboardStore.aiSettings.aiConcurrency, 10) || 4);

      if (this.elements.btnTranslateAll) this.elements.btnTranslateAll.disabled = true;
      const btnBatchTrans = $('btn-batch-translate');
      if (btnBatchTrans) btnBatchTrans.disabled = true;
      if (this.elements.container) this.elements.container.classList.remove('hidden');

      let nextIndex = 0;
      let completed = 0;
      const total = items.length;

      const updateProgress = (lastItem) => {
        if (this.elements.text) {
          const snippet = lastItem ? ` ("${lastItem.text.substring(0, 22)}...")` : '';
          this.elements.text.textContent = `${label} (${completed}/${total}) [${concurrency} luồng]${snippet}`;
        }
        if (this.elements.fill) {
          this.elements.fill.style.width = `${Math.round((completed / total) * 100)}%`;
        }
      };

      updateProgress();

      const worker = async () => {
        while (nextIndex < total && !this.cancelRequested) {
          const idx = nextIndex++;
          const item = items[idx];
          try {
            if (typeof aiService !== 'undefined' && aiService.translateText) {
              const aiResult = await aiService.translateText(item.text, DashboardStore.aiSettings);
              item.keyPhrase = aiResult.keyPhrase || '';
              item.phraseTranslation = aiResult.phraseTranslation || '';
              item.translation = aiResult.translation || '';
              item.explanation = aiResult.explanation || '';
              item.synonyms = aiResult.synonyms || [];
              item.examples = aiResult.examples || [];
              item.exampleSentence = aiResult.exampleSentence || '';
              item.exampleTranslation = aiResult.exampleTranslation || '';
              item.status = 'translated';

              // Persist to Neon Postgres in background
              if (typeof neonClient !== 'undefined' && neonClient.updateAiResult) {
                neonClient.updateAiResult(item.id, aiResult).catch((err) => {
                  console.warn(`[Neon Storage] updateAiResult failed for ${item.id}:`, err);
                });
              }

              // Update this card live in DOM!
              CardRenderer.updateSingleCardInDom(item);
            }
          } catch (err) {
            console.warn(`Lỗi dịch item ${item.id}:`, err);
          } finally {
            completed++;
            updateProgress(item);
          }
        }
      };

      const workerCount = Math.min(concurrency, total);
      const workers = Array.from({ length: workerCount }, () => worker());
      await Promise.all(workers);

      // Finish & Save state
      DashboardStore.saveSubtitles();
      this.isRunning = false;
      if (this.elements.btnTranslateAll) this.elements.btnTranslateAll.disabled = false;
      if (btnBatchTrans) btnBatchTrans.disabled = false;
      if (this.elements.container) this.elements.container.classList.add('hidden');

      if (!this.cancelRequested) {
        DashboardToast.show(`Đã hoàn thành dịch song song ${completed}/${total} câu với AI!`, 'success');
      } else {
        DashboardToast.show('Đã dừng dịch hàng loạt.', 'warning');
      }
    },

    async start() {
      const pending = DashboardStore.subtitles.filter(s => !s.translation);
      if (pending.length === 0) {
        DashboardToast.show('Tất cả các câu đã được dịch bằng AI!', 'success');
        return;
      }
      await this.processItemsInParallel(pending, 'Đang dịch tất cả với AI song song');
    },

    async translateSelected() {
      const selected = DashboardStore.subtitles.filter(s => DashboardStore.selectedIds.has(s.id));
      if (selected.length === 0) {
        DashboardToast.show('Chưa chọn câu nào để dịch!', 'warning');
        return;
      }
      await this.processItemsInParallel(selected, 'Đang dịch các câu đã chọn');
      DashboardStore.clearSelection();
    },

    cancel() {
      this.cancelRequested = true;
      if (this.elements.text) {
        this.elements.text.textContent = 'Đang dừng dịch hàng loạt...';
      }
    }
  };

  // -------------------------------------------------------------
  // Selection Action Bar Manager
  // -------------------------------------------------------------
  const SelectionBarManager = {
    elements: {
      bar: $('selection-action-bar'),
      selectAllCheckbox: $('checkbox-select-all'),
      selectedCount: $('selected-count'),
      btnBatchTranslate: $('btn-batch-translate'),
      btnBatchDelete: $('btn-batch-delete'),
      btnClearSelection: $('btn-clear-selection')
    },

    init() {
      if (this.elements.selectAllCheckbox) {
        this.elements.selectAllCheckbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            DashboardStore.selectAllFiltered();
          } else {
            DashboardStore.clearSelection();
          }
        });
      }

      if (this.elements.btnClearSelection) {
        this.elements.btnClearSelection.addEventListener('click', () => {
          DashboardStore.clearSelection();
        });
      }

      if (this.elements.btnBatchDelete) {
        this.elements.btnBatchDelete.addEventListener('click', () => {
          const count = DashboardStore.selectedIds.size;
          if (count === 0) return;
          if (confirm(`Bạn có chắc chắn muốn xóa ${count} câu đã chọn khỏi danh sách?`)) {
            DashboardStore.deleteSelected();
          }
        });
      }

      if (this.elements.btnBatchTranslate) {
        this.elements.btnBatchTranslate.addEventListener('click', () => {
          BatchTranslator.translateSelected();
        });
      }

      DashboardStore.subscribeSelection(() => {
        this.render();
        CardRenderer.updateSelectionState();
      });
    },

    render() {
      const count = DashboardStore.selectedIds.size;
      const bar = this.elements.bar;
      if (!bar) return;

      if (count > 0) {
        bar.classList.remove('hidden');
        if (this.elements.selectedCount) {
          this.elements.selectedCount.textContent = count;
        }
        if (this.elements.selectAllCheckbox) {
          const allFilteredSelected = DashboardStore.filteredSubtitles.length > 0 &&
            DashboardStore.filteredSubtitles.every(s => DashboardStore.selectedIds.has(s.id));
          this.elements.selectAllCheckbox.checked = allFilteredSelected;
        }
      } else {
        bar.classList.add('hidden');
        if (this.elements.selectAllCheckbox) {
          this.elements.selectAllCheckbox.checked = false;
        }
      }
    }
  };

  // -------------------------------------------------------------
  // 5. Export Service
  // -------------------------------------------------------------
  const ExportService = {
    exportAnki(subtitles) {
      if (subtitles.length === 0) {
        DashboardToast.show('Chưa có dữ liệu để xuất!', 'warning');
        return;
      }

      const cleanField = (str) => String(str || '').replace(/\r?\n|\r/g, '<br>').replace(/\t/g, ' ').trim();

      const lines = subtitles.map(s => {
        const textClean = cleanField(s.text);
        const kpClean = cleanField(s.keyPhrase);
        const kpTransClean = cleanField(s.phraseTranslation);
        const transClean = cleanField(s.translation);
        const expClean = cleanField(s.explanation);
        const synClean = cleanField(Array.isArray(s.synonyms) ? s.synonyms.join(', ') : s.synonyms);

        let exListClean = '';
        if (Array.isArray(s.examples) && s.examples.length > 0) {
          exListClean = s.examples.map((ex, i) => `<br><small><b>[${ex.context || i + 1}]</b> <i>${cleanField(ex.sentence)}</i>: ${cleanField(ex.translation)}</small>`).join('');
        } else if (s.exampleSentence) {
          exListClean = `<br><small><i>${cleanField(s.exampleSentence)}</i>: ${cleanField(s.exampleTranslation)}</small>`;
        }

        const front = kpClean
          ? `<b>${kpClean}</b>${kpTransClean ? ' (' + kpTransClean + ')' : ''}<br><br><small style="color:#888;">Ngữ cảnh: "${textClean}"</small>`
          : `<b>${textClean}</b>`;

        const back = `<b>${transClean}</b>${expClean ? '<br><br>' + expClean : ''}${synClean ? '<br><small><b>Đồng nghĩa:</b> ' + synClean + '</small>' : ''}${exListClean ? '<br><br><b>Ví dụ:</b>' + exListClean : ''}`;
        return `${front}\t${back}`;
      });

      const content = lines.join('\n');
      if (UTILS && UTILS.downloadFile) {
        UTILS.downloadFile(content, 'youtube_anki_flashcards.txt', 'text/plain;charset=utf-8;');
      }
      DashboardToast.show('Đã xuất file Anki Flashcards thành công!');
    },

    exportCSV(subtitles) {
      if (subtitles.length === 0) {
        DashboardToast.show('Chưa có dữ liệu để xuất!', 'warning');
        return;
      }

      const escape = (UTILS && UTILS.escapeCsv) ? UTILS.escapeCsv : (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      const headers = ['"Cụm từ trọng tâm"', '"Nghĩa cụm từ"', '"Câu gốc tiếng Anh"', '"Dịch câu gốc"', '"Đồng nghĩa"', '"Giải thích"', '"Câu ví dụ"', '"Dịch ví dụ"', '"Video"', '"Link Video"', '"Ngày lưu"'];
      const rows = subtitles.map(s => {
        const synStr = Array.isArray(s.synonyms) ? s.synonyms.join(', ') : (s.synonyms || '');
        const exEnStr = Array.isArray(s.examples) && s.examples.length > 0 ? s.examples.map(e => `[${e.context}] ${e.sentence}`).join(' | ') : (s.exampleSentence || '');
        const exViStr = Array.isArray(s.examples) && s.examples.length > 0 ? s.examples.map(e => `[${e.context}] ${e.translation}`).join(' | ') : (s.exampleTranslation || '');

        return [
          escape(s.keyPhrase),
          escape(s.phraseTranslation),
          escape(s.text),
          escape(s.translation),
          escape(synStr),
          escape(s.explanation),
          escape(exEnStr),
          escape(exViStr),
          escape(s.videoTitle),
          escape(s.url),
          escape(new Date(s.timestamp || Date.now()).toLocaleDateString())
        ].join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
      if (UTILS && UTILS.downloadFile) {
        UTILS.downloadFile(csvContent, 'youtube_subtitles_export.csv', 'text/csv;charset=utf-8;');
      }
      DashboardToast.show('Đã xuất file CSV thành công!', 'success');
    },

    exportJSON(subtitles) {
      if (subtitles.length === 0) {
        DashboardToast.show('Chưa có dữ liệu để xuất!', 'warning');
        return;
      }

      const content = JSON.stringify(subtitles, null, 2);
      if (UTILS && UTILS.downloadFile) {
        UTILS.downloadFile(content, 'youtube_subtitles_backup.json', 'application/json');
      }
      DashboardToast.show('Đã xuất file JSON sao lưu thành công!');
    }
  };

  // -------------------------------------------------------------
  // 6. Modal Manager (Settings, Add, Edit, Export)
  // -------------------------------------------------------------
  const ModalManager = {
    init() {
      // Settings Modal
      $('btn-open-settings')?.addEventListener('click', () => this.openSettings());
      $('btn-close-settings')?.addEventListener('click', () => this.closeSettings());
      $('btn-save-settings')?.addEventListener('click', () => this.saveSettings());
      $('btn-test-ai')?.addEventListener('click', () => this.testAiConnection());

      // Key toggle visibility
      this.bindPasswordToggle('toggle-nine-router-key', 'input-nine-router-key');

      // Manual Add Modal
      $('btn-add-manual')?.addEventListener('click', () => this.openAdd());
      $('btn-close-add-phrase')?.addEventListener('click', () => this.closeAdd());
      $('btn-cancel-add')?.addEventListener('click', () => this.closeAdd());
      $('btn-submit-add')?.addEventListener('click', () => this.submitAdd());

      // Edit Modal
      $('btn-close-edit')?.addEventListener('click', () => this.closeEdit());
      $('btn-cancel-edit')?.addEventListener('click', () => this.closeEdit());
      $('btn-save-edit')?.addEventListener('click', () => this.saveEdit());
      $('btn-edit-reai')?.addEventListener('click', () => this.reaiEdit());

      // Export Modal
      $('btn-export')?.addEventListener('click', () => $('modal-export')?.classList.remove('hidden'));
      $('btn-close-export')?.addEventListener('click', () => $('modal-export')?.classList.add('hidden'));
      $('btn-close-export-footer')?.addEventListener('click', () => $('modal-export')?.classList.add('hidden'));

      $('btn-export-json')?.addEventListener('click', () => {
        ExportService.exportJSON(DashboardStore.subtitles);
        $('modal-export')?.classList.add('hidden');
      });
    },

    bindPasswordToggle(btnId, inputId) {
      const btn = $(btnId);
      const input = $(inputId);
      if (btn && input) {
        btn.addEventListener('click', () => {
          input.type = input.type === 'password' ? 'text' : 'password';
        });
      }
    },

    // Settings
    openSettings() {
      const s = DashboardStore.aiSettings;
      if ($('input-nine-router-url')) $('input-nine-router-url').value = s.nineRouterBaseUrl || 'http://localhost:20128/v1';
      if ($('input-nine-router-key')) $('input-nine-router-key').value = s.nineRouterApiKey || '';
      if ($('select-nine-router-model')) $('select-nine-router-model').value = s.nineRouterModel || 'ag/gemini-3.8-flash-low';
      if ($('select-ai-concurrency')) $('select-ai-concurrency').value = String(s.aiConcurrency || 4);

      $('modal-settings')?.classList.remove('hidden');
    },

    closeSettings() {
      $('modal-settings')?.classList.add('hidden');
    },

    updateProviderUI() {
      // 9Router is the exclusive AI provider
    },

    saveSettings() {
      const toSave = {
        aiProvider: 'nine_router',
        nineRouterBaseUrl: $('input-nine-router-url')?.value.trim() || 'http://localhost:20128/v1',
        nineRouterApiKey: $('input-nine-router-key')?.value.trim() || '',
        nineRouterModel: $('select-nine-router-model')?.value || 'ag/gemini-3.8-flash-low',
        aiConcurrency: parseInt($('select-ai-concurrency')?.value || '4', 10)
      };

      chrome.storage.local.set(toSave, () => {
        DashboardStore.aiSettings = { ...DashboardStore.aiSettings, ...toSave };
        DashboardToast.show('Đã lưu cấu hình AI 9Router thành công!', 'success');
        this.closeSettings();
      });
    },

    async testAiConnection() {
      const btn = $('btn-test-ai');
      const box = $('connection-test-result');
      if (!btn || !box) return;

      const testConfig = {
        aiProvider: 'nine_router',
        nineRouterBaseUrl: $('input-nine-router-url')?.value.trim() || 'http://localhost:20128/v1',
        nineRouterApiKey: $('input-nine-router-key')?.value.trim() || '',
        nineRouterModel: $('select-nine-router-model')?.value || 'ag/gemini-3.8-flash-low'
      };

      btn.disabled = true;
      btn.textContent = 'Đang kiểm tra...';
      box.classList.remove('hidden', 'success', 'error');
      box.textContent = 'Đang gửi prompt kiểm tra đến 9Router Gateway...';

      try {
        if (typeof aiService === 'undefined' || !aiService.translateText) {
          throw new Error('Dịch vụ AI không khả dụng');
        }
        const res = await aiService.translateText('Knowledge is power.', testConfig);
        box.classList.add('success');
        box.innerHTML = `<strong>Thành công!</strong> Đã nhận bản dịch:<br><b>${res.keyPhrase || 'knowledge'}</b>: ${res.phraseTranslation || ''}<br>"${res.translation}"<br><small><i>${res.explanation}</i></small>`;
      } catch (err) {
        box.classList.add('error');
        box.innerHTML = `<strong>Lỗi kết nối:</strong> ${err.message}`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Kiểm tra kết nối';
      }
    },

    // Manual Add
    openAdd() {
      if ($('input-manual-text')) $('input-manual-text').value = '';
      if ($('input-manual-title')) $('input-manual-title').value = '';
      if ($('input-manual-url')) $('input-manual-url').value = '';
      $('modal-add-phrase')?.classList.remove('hidden');
      $('input-manual-text')?.focus();
    },

    closeAdd() {
      $('modal-add-phrase')?.classList.add('hidden');
    },

    async submitAdd() {
      const text = $('input-manual-text')?.value.trim();
      if (!text) {
        DashboardToast.show('Vui lòng nhập câu tiếng Anh!', 'warning');
        $('input-manual-text')?.focus();
        return;
      }

      const title = $('input-manual-title')?.value.trim() || 'Ghi chép thủ công (Dashboard)';
      const rawUrl = $('input-manual-url')?.value.trim() || '';
      const finalUrl = (UTILS && UTILS.ensureYouTubeTimestampUrl) ? UTILS.ensureYouTubeTimestampUrl(rawUrl) : rawUrl;

      const btn = $('btn-submit-add');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Đang dịch AI...';
      }

      let aiResult = { keyPhrase: '', phraseTranslation: '', translation: '', explanation: '', synonyms: [], examples: [], exampleSentence: '', exampleTranslation: '' };
      try {
        if (typeof aiService !== 'undefined' && aiService.translateText) {
          aiResult = await aiService.translateText(text, DashboardStore.aiSettings);
        }
      } catch (err) {
        console.warn('AI translation error during manual add:', err);
      }

      const newItem = (UTILS && UTILS.createSubtitleEntity)
        ? UTILS.createSubtitleEntity({
            text,
            videoTitle: title,
            url: finalUrl,
            keyPhrase: aiResult.keyPhrase || '',
            phraseTranslation: aiResult.phraseTranslation || '',
            translation: aiResult.translation || '',
            explanation: aiResult.explanation || '',
            synonyms: aiResult.synonyms || [],
            examples: aiResult.examples || [],
            exampleSentence: aiResult.exampleSentence || '',
            exampleTranslation: aiResult.exampleTranslation || '',
            status: aiResult.translation ? 'translated' : 'pending'
          })
        : {
            id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            text,
            timestamp: Date.now(),
            videoTitle: title,
            url: finalUrl,
            keyPhrase: aiResult.keyPhrase || '',
            phraseTranslation: aiResult.phraseTranslation || '',
            translation: aiResult.translation || '',
            explanation: aiResult.explanation || '',
            synonyms: aiResult.synonyms || [],
            examples: aiResult.examples || [],
            exampleSentence: aiResult.exampleSentence || '',
            exampleTranslation: aiResult.exampleTranslation || '',
            isFavorite: false,
            status: aiResult.translation ? 'translated' : 'pending'
          };

      await DashboardStore.addItem(newItem);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Thêm & Dịch ngay';
      }
      this.closeAdd();
      DashboardToast.show('Đã thêm từ vựng thành công!', 'success');
    },

    // Edit
    openEdit(item) {
      if ($('edit-phrase-id')) $('edit-phrase-id').value = item.id;
      if ($('edit-phrase-text')) $('edit-phrase-text').value = item.text || '';
      if ($('edit-phrase-keyphrase')) $('edit-phrase-keyphrase').value = item.keyPhrase || '';
      if ($('edit-phrase-phrase-trans')) $('edit-phrase-phrase-trans').value = item.phraseTranslation || '';
      if ($('edit-phrase-synonyms')) $('edit-phrase-synonyms').value = (Array.isArray(item.synonyms) ? item.synonyms : []).join(', ');
      if ($('edit-phrase-translation')) $('edit-phrase-translation').value = item.translation || '';
      if ($('edit-phrase-explanation')) $('edit-phrase-explanation').value = item.explanation || '';
      if ($('edit-phrase-example-sentence')) $('edit-phrase-example-sentence').value = item.exampleSentence || '';
      if ($('edit-phrase-example-translation')) $('edit-phrase-example-translation').value = item.exampleTranslation || '';
      if ($('edit-phrase-title')) $('edit-phrase-title').value = item.videoTitle || '';
      if ($('edit-phrase-url')) $('edit-phrase-url').value = item.url || '';

      $('modal-edit-phrase')?.classList.remove('hidden');
    },

    closeEdit() {
      $('modal-edit-phrase')?.classList.add('hidden');
    },

    async saveEdit() {
      const id = $('edit-phrase-id')?.value;
      const text = $('edit-phrase-text')?.value.trim();
      if (!id || !text) {
        DashboardToast.show('Câu tiếng Anh không được để trống!', 'warning');
        return;
      }

      const original = DashboardStore.subtitles.find(s => s.id === id);
      if (!original) return;

      const rawSyn = $('edit-phrase-synonyms')?.value || '';
      const synList = rawSyn.split(',').map(s => s.trim()).filter(Boolean);
      const rawUrl = $('edit-phrase-url')?.value.trim() || original.url || '';
      const finalUrl = (UTILS && UTILS.ensureYouTubeTimestampUrl) ? UTILS.ensureYouTubeTimestampUrl(rawUrl) : rawUrl;

      const updated = {
        ...original,
        text,
        keyPhrase: $('edit-phrase-keyphrase')?.value.trim() || '',
        phraseTranslation: $('edit-phrase-phrase-trans')?.value.trim() || '',
        synonyms: synList,
        translation: $('edit-phrase-translation')?.value.trim() || '',
        explanation: $('edit-phrase-explanation')?.value.trim() || '',
        exampleSentence: $('edit-phrase-example-sentence')?.value.trim() || '',
        exampleTranslation: $('edit-phrase-example-translation')?.value.trim() || '',
        videoTitle: $('edit-phrase-title')?.value.trim() || original.videoTitle,
        url: finalUrl,
        status: $('edit-phrase-translation')?.value.trim() ? 'translated' : 'pending'
      };

      await DashboardStore.updateItem(updated);
      this.closeEdit();
      DashboardToast.show('Đã cập nhật câu thành công!', 'success');
    },

    async reaiEdit() {
      const text = $('edit-phrase-text')?.value.trim();
      if (!text) {
        DashboardToast.show('Vui lòng nhập câu tiếng Anh cần dịch!', 'warning');
        $('edit-phrase-text')?.focus();
        return;
      }

      const btn = $('btn-edit-reai');
      const oldHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>Đang dịch...</span>`;
      }

      try {
        if (typeof aiService === 'undefined' || !aiService.translateText) {
          throw new Error('Dịch vụ AI không khả dụng');
        }
        const res = await aiService.translateText(text, DashboardStore.aiSettings);
        if ($('edit-phrase-keyphrase')) $('edit-phrase-keyphrase').value = res.keyPhrase || '';
        if ($('edit-phrase-phrase-trans')) $('edit-phrase-phrase-trans').value = res.phraseTranslation || '';
        if ($('edit-phrase-synonyms')) $('edit-phrase-synonyms').value = (res.synonyms || []).join(', ');
        if ($('edit-phrase-translation')) $('edit-phrase-translation').value = res.translation || '';
        if ($('edit-phrase-explanation')) $('edit-phrase-explanation').value = res.explanation || '';
        if ($('edit-phrase-example-sentence')) $('edit-phrase-example-sentence').value = res.exampleSentence || '';
        if ($('edit-phrase-example-translation')) $('edit-phrase-example-translation').value = res.exampleTranslation || '';
        DashboardToast.show('AI đã dịch xong! Nhấn "Lưu thay đổi" để áp dụng.', 'success');
      } catch (err) {
        DashboardToast.show(`Lỗi dịch AI: ${err.message}`, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = oldHtml;
        }
      }
    }
  };

  // -------------------------------------------------------------
  // 7. Stats & Filter Dropdowns
  // -------------------------------------------------------------
  function updateStatsUI(store) {
    const total = store.subtitles.length;
    const translated = store.subtitles.filter(s => !!s.translation).length;
    const favorite = store.subtitles.filter(s => !!s.isFavorite).length;
    const pending = total - translated;

    if ($('stat-total')) $('stat-total').textContent = total;
    if ($('stat-translated')) $('stat-translated').textContent = translated;
    if ($('stat-favorite')) $('stat-favorite').textContent = favorite;

    if ($('count-all')) $('count-all').textContent = total;
    if ($('count-pending')) $('count-pending').textContent = pending;
    if ($('count-translated')) $('count-translated').textContent = translated;
    if ($('count-fav')) $('count-fav').textContent = favorite;
  }

  function updateVideoDropdown(store) {
    const select = $('select-video-filter');
    if (!select) return;

    const currentVal = select.value || 'all';
    const videos = [...new Set(store.subtitles.map(s => s.videoTitle).filter(Boolean))];

    select.innerHTML = '<option value="all">Tất cả video nguồn</option>';
    videos.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      const cleanV = (UTILS && UTILS.cleanTitle) ? UTILS.cleanTitle(v) : v;
      opt.textContent = cleanV.length > 45 ? cleanV.substring(0, 42) + '...' : cleanV;
      select.appendChild(opt);
    });

    if (videos.includes(currentVal)) {
      select.value = currentVal;
    }
  }

  // -------------------------------------------------------------
  // 8. Application Bootstrap & Event Setup
  // -------------------------------------------------------------
  function setupAppEvents() {
    // Search Input with Debounce
    const searchInput = $('search-input');
    const btnClearSearch = $('btn-clear-search');

    if (searchInput) {
      const onSearch = (UTILS && UTILS.debounce)
        ? UTILS.debounce((val) => {
            DashboardStore.searchQuery = val;
            DashboardStore.notify();
          }, 200)
        : (val) => {
            DashboardStore.searchQuery = val;
            DashboardStore.notify();
          };

      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (btnClearSearch) btnClearSearch.classList.toggle('visible', val.length > 0);
        onSearch(val);
      });
    }

    if (btnClearSearch && searchInput) {
      btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        btnClearSearch.classList.remove('visible');
        DashboardStore.searchQuery = '';
        DashboardStore.notify();
        searchInput.focus();
      });
    }

    // Filter Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        DashboardStore.activeFilter = btn.dataset.filter || 'all';
        DashboardStore.notify();
      });
    });

    // Video Filter Dropdown
    $('select-video-filter')?.addEventListener('change', (e) => {
      DashboardStore.selectedVideo = e.target.value;
      DashboardStore.notify();
    });

    // Sort Dropdown
    $('select-sort')?.addEventListener('change', (e) => {
      DashboardStore.sortOrder = e.target.value;
      DashboardStore.notify();
    });

    // Empty state open YouTube button
    $('btn-open-youtube')?.addEventListener('click', () => {
      window.open('https://www.youtube.com', '_blank');
    });

    // OS-aware shortcut labels in empty state (macOS Option vs Windows Alt)
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const kbdC = $('dash-kbd-c');
    const kbdS = $('dash-kbd-s');
    if (kbdC) kbdC.textContent = isMac ? '⌥ Option + C' : 'Alt + C';
    if (kbdS) kbdS.textContent = isMac ? '⌥ Option + S' : 'Alt + S';

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $('modal-settings')?.classList.add('hidden');
        $('modal-add-phrase')?.classList.add('hidden');
        $('modal-edit-phrase')?.classList.add('hidden');
        $('modal-export')?.classList.add('hidden');
      }
    });
  }

  // Neon Health Check
  if (typeof neonClient !== 'undefined' && neonClient.initSchema) {
    neonClient.initSchema().then(() => {
      if ($('stat-neon-status')) $('stat-neon-status').textContent = 'Connected';
      $('badge-neon')?.classList.remove('offline');
    }).catch((err) => {
      console.warn('[Neon Storage] Schema init error:', err);
      if ($('stat-neon-status')) $('stat-neon-status').textContent = 'Offline (Cache)';
      $('badge-neon')?.classList.add('offline');
    });
  }

  // Subscribe UI to Store changes
  DashboardStore.subscribe((store) => {
    CardRenderer.render(store);
    SelectionBarManager.render();
    updateStatsUI(store);
    updateVideoDropdown(store);
  });

  // Storage Change Listener (Tab/Content Sync)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.copyHistory && !DashboardStore.isInternalUpdate) {
        DashboardStore.loadSubtitles();
      }
      if (changes.aiProvider || changes.geminiApiKey || changes.openaiApiKey || changes.nineRouterModel || changes.aiConcurrency) {
        DashboardStore.loadSettings();
      }
    }
  });

  // =============================================================
  // 12. Subtitle & Vocabulary Studio Manager (Netflix & YouTube)
  // =============================================================
  const VocabStudioManager = {
    cues: [],
    analysis: null,
    videoTitle: '',
    videoUrl: '',
    sourcePlatform: 'unknown',
    activePosFilter: 'all',
    activeCefrFilter: 'all',
    activeMinFreq: 1,
    activeSort: 'freq',
    searchQuery: '',
    currentCardIndex: 0,
    filteredWords: [],
    isCardFlipped: false,

    init() {
      this.bindViewSwitcher();
      this.bindActiveMediaBanner();
      this.bindUploadAndPaste();
      this.bindFiltersAndSearch();
      this.bindExportsAndDownloads();
      this.bindFlashcards();
      this.checkPendingStudioData();
      this.pollActiveMediaTab();
    },

    bindViewSwitcher() {
      const btnStudio = $('view-tab-vocab-studio');
      const btnSaved = $('view-tab-saved-list');
      const viewStudio = $('view-vocab-studio');
      const viewSaved = $('view-saved-subtitles');

      if (btnStudio && btnSaved && viewStudio && viewSaved) {
        btnStudio.onclick = () => {
          btnStudio.classList.add('active');
          btnSaved.classList.remove('active');
          viewStudio.classList.remove('hidden');
          viewSaved.classList.add('hidden');
        };

        btnSaved.onclick = () => {
          btnSaved.classList.add('active');
          btnStudio.classList.remove('active');
          viewSaved.classList.remove('hidden');
          viewStudio.classList.add('hidden');
        };
      }
    },

    checkPendingStudioData() {
      chrome.storage.local.get(['pendingVocabStudio'], (res) => {
        if (res && res.pendingVocabStudio) {
          const data = res.pendingVocabStudio;
          chrome.storage.local.remove(['pendingVocabStudio']);
          if (data.cues && data.cues.length > 0) {
            this.videoTitle = data.title || 'Movie / Video';
            this.videoUrl = data.url || '';
            this.loadAnalysis(data.cues, {
              videoTitle: this.videoTitle,
              videoUrl: this.videoUrl
            });
            // Switch to studio view
            $('view-tab-vocab-studio')?.click();
          }
        }
      });
    },

    async pollActiveMediaTab() {
      const banner = $('vs-active-media-banner');
      const tag = $('vs-platform-tag');
      const pill = $('vs-status-pill');
      const titleEl = $('vs-media-title');
      const descEl = $('vs-media-desc');
      const btnCapture = $('vs-btn-capture-active');

      if (!banner) return;

      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'get_active_tab_media_status' }, resolve);
        });

        if (res && res.isMedia) {
          this.targetMediaTabId = res.tabId;
          this.sourcePlatform = res.platform;
          this.videoTitle = res.title ? res.title.replace(' - YouTube', '').replace(' - Netflix', '').trim() : 'Media Video';
          this.videoUrl = res.url || '';

          tag.textContent = res.platform === 'netflix' ? '🎬 Netflix' : '🔴 YouTube';
          pill.textContent = 'Sẵn sàng tải';
          pill.classList.add('active');
          titleEl.textContent = this.videoTitle;
          descEl.textContent = `Đã phát hiện video từ ${res.platform === 'netflix' ? 'Netflix' : 'YouTube'}. Nhấn nút để tải phụ đề và phân loại từ vựng ngay.`;
          btnCapture.disabled = false;
        } else {
          pill.textContent = 'Chưa kết nối';
          pill.classList.remove('active');
          btnCapture.disabled = true;
        }
      } catch (e) {
        console.warn('[Studio] Poll error:', e);
      }
    },

    bindActiveMediaBanner() {
      const btnCapture = $('vs-btn-capture-active');
      if (btnCapture) {
        btnCapture.onclick = async () => {
          btnCapture.disabled = true;
          this.showLoading('Đang kết nối tới tab phim/video để lấy phụ đề...');

          try {
            let targetTabId = this.targetMediaTabId;
            let targetTab = null;
            if (targetTabId) {
              try {
                targetTab = await chrome.tabs.get(targetTabId);
              } catch (e) {}
            }
            if (!targetTab) {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              targetTab = tab;
              targetTabId = tab?.id;
            }
            if (!targetTabId) throw new Error('Không tìm thấy tab đang phát.');

            // Execute extractor script in active tab
            const results = await chrome.scripting.executeScript({
              target: { tabId: targetTabId },
              func: async () => {
                const isNetflix = window.location.hostname.includes('netflix.com');
                const isYT = window.location.hostname.includes('youtube.com');

                if (isYT) {
                  const player = document.getElementById('movie_player');
                  const pResp = (player && typeof player.getPlayerResponse === 'function') ? player.getPlayerResponse() : (window.ytInitialPlayerResponse || null);
                  const tracks = pResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
                  const enTrack = tracks.find(t => (t.languageCode || '').startsWith('en') && t.kind !== 'asr') || tracks.find(t => (t.languageCode || '').startsWith('en')) || tracks[0];
                  if (!enTrack || !enTrack.baseUrl) {
                    return { error: 'Không tìm thấy phụ đề tiếng Anh cho video này. Hãy bật CC trên YouTube.' };
                  }
                  const resp = await fetch(enTrack.baseUrl + '&fmt=vtt');
                  const text = await resp.text();
                  const title = pResp?.videoDetails?.title || document.title.replace(' - YouTube', '').trim();
                  return { success: true, text, title, platform: 'youtube' };
                }

                if (isNetflix) {
                  // Check if netflix subtitle bridge has captured tracks
                  return { error: 'Trên Netflix, hãy nhấn nút "AF Phụ đề & Từ vựng" trực tiếp trên trình phát để tải chính xác nhất.' };
                }

                return { error: 'Trang hiện tại không phải Netflix hoặc YouTube.' };
              }
            });

            this.hideLoading();
            btnCapture.disabled = false;

            if (results && results[0] && results[0].result) {
              const res = results[0].result;
              if (res.error) {
                DashboardToast.show(res.error, 'warning');
                return;
              }
              if (res.success && res.text) {
                const parser = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER : null;
                const cues = parser ? parser.parse(res.text) : [];
                if (cues.length === 0) throw new Error('Không thể phân tích file phụ đề.');
                this.videoTitle = res.title || this.videoTitle;
                this.loadAnalysis(cues, {
                  videoTitle: this.videoTitle,
                  videoUrl: tab.url || ''
                });
                DashboardToast.show(`Đã phân tích thành công ${cues.length} câu phụ đề!`);
              }
            }
          } catch (err) {
            this.hideLoading();
            btnCapture.disabled = false;
            DashboardToast.show(err.message || 'Lỗi khi lấy phụ đề từ tab', 'error');
          }
        };
      }
    },

    bindUploadAndPaste() {
      const btnToggle = $('vs-btn-toggle-upload');
      const box = $('vs-upload-box');
      const tabFile = $('vs-tab-file');
      const tabPaste = $('vs-tab-paste');
      const panelFile = $('vs-file-panel');
      const panelPaste = $('vs-paste-panel');
      const fileInput = $('vs-file-input');
      const dropZone = $('vs-drop-zone');
      const btnAnalyzePasted = $('vs-btn-analyze-pasted');
      const pasteInput = $('vs-paste-input');
      const pasteTitle = $('vs-paste-title');

      if (btnToggle && box) {
        btnToggle.onclick = () => box.classList.toggle('hidden');
      }

      if (tabFile && tabPaste && panelFile && panelPaste) {
        tabFile.onclick = () => {
          tabFile.classList.add('active');
          tabPaste.classList.remove('active');
          panelFile.classList.remove('hidden');
          panelPaste.classList.add('hidden');
        };
        tabPaste.onclick = () => {
          tabPaste.classList.add('active');
          tabFile.classList.remove('active');
          panelPaste.classList.remove('hidden');
          panelFile.classList.add('hidden');
        };
      }

      const handleFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target.result;
          const parser = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER : null;
          const cues = parser ? parser.parse(text) : [];
          if (cues.length === 0) {
            DashboardToast.show('Không thể phân tích file phụ đề. Vui lòng kiểm tra định dạng .srt hoặc .vtt.', 'error');
            return;
          }
          const cleanName = file.name.replace(/\.[^/.]+$/, '');
          this.videoTitle = cleanName;
          this.loadAnalysis(cues, { videoTitle: cleanName });
          DashboardToast.show(`Đã tải file ${file.name} (${cues.length} câu thoại)`);
          box.classList.add('hidden');
        };
        reader.readAsText(file);
      };

      if (fileInput) {
        fileInput.onchange = (e) => {
          const file = e.target.files && e.target.files[0];
          handleFile(file);
        };
      }

      if (dropZone) {
        dropZone.ondragover = (e) => {
          e.preventDefault();
          dropZone.style.borderColor = '#f97316';
        };
        dropZone.ondragleave = () => {
          dropZone.style.borderColor = '';
        };
        dropZone.ondrop = (e) => {
          e.preventDefault();
          dropZone.style.borderColor = '';
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          handleFile(file);
        };
      }

      if (btnAnalyzePasted && pasteInput) {
        btnAnalyzePasted.onclick = () => {
          const raw = pasteInput.value.trim();
          if (!raw) {
            DashboardToast.show('Vui lòng dán nội dung phụ đề trước khi phân tích.', 'warning');
            return;
          }
          const parser = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER : null;
          const cues = parser ? parser.parse(raw) : [];
          if (cues.length === 0) {
            DashboardToast.show('Không nhận diện được cấu trúc phụ đề SRT hoặc VTT.', 'error');
            return;
          }
          const title = (pasteTitle && pasteTitle.value.trim()) ? pasteTitle.value.trim() : 'Pasted Subtitle';
          this.videoTitle = title;
          this.loadAnalysis(cues, { videoTitle: title });
          DashboardToast.show(`Đã phân loại thành công ${cues.length} câu thoại!`);
          box.classList.add('hidden');
        };
      }
    },

    bindFiltersAndSearch() {
      const tabs = document.querySelectorAll('.vs-tab');
      tabs.forEach((t) => {
        t.onclick = () => {
          tabs.forEach(x => x.classList.remove('active'));
          t.classList.add('active');
          this.activePosFilter = t.getAttribute('data-pos');
          this.renderWorkspace();
        };
      });

      // POS cards in summary bar
      document.querySelectorAll('.vs-pos-stat-card').forEach((card) => {
        card.onclick = () => {
          const target = card.getAttribute('data-target-pos');
          const matchingTab = document.querySelector(`.vs-tab[data-pos="${target}"]`);
          if (matchingTab) matchingTab.click();
        };
      });

      const searchInput = $('vs-search-input');
      if (searchInput) {
        searchInput.oninput = () => {
          this.searchQuery = searchInput.value.trim().toLowerCase();
          this.renderWorkspace();
        };
      }

      const btnClearSearch = $('vs-btn-clear-search');
      if (btnClearSearch && searchInput) {
        btnClearSearch.onclick = () => {
          searchInput.value = '';
          this.searchQuery = '';
          this.renderWorkspace();
        };
      }

      const selectCefr = $('vs-select-cefr');
      if (selectCefr) {
        selectCefr.onchange = () => {
          this.activeCefrFilter = selectCefr.value;
          this.renderWorkspace();
        };
      }

      const selectFreq = $('vs-select-freq');
      if (selectFreq) {
        selectFreq.onchange = () => {
          this.activeMinFreq = parseInt(selectFreq.value, 10) || 1;
          this.renderWorkspace();
        };
      }

      const selectSort = $('vs-select-sort');
      if (selectSort) {
        selectSort.onchange = () => {
          this.activeSort = selectSort.value;
          this.renderWorkspace();
        };
      }
    },

    bindExportsAndDownloads() {
      const parser = (typeof APP_SUBTITLE_PARSER !== 'undefined') ? APP_SUBTITLE_PARSER : null;
      const analyzer = (typeof APP_VOCAB_ANALYZER !== 'undefined') ? APP_VOCAB_ANALYZER : null;

      const getFilenameBase = () => (this.videoTitle || 'subtitles').replace(/[/\\?%*:|"<>]/g, '_');

      $('vs-dl-srt')?.addEventListener('click', () => {
        if (!parser || this.cues.length === 0) return;
        const content = parser.toSRT(this.cues);
        UTILS.downloadFile(content, `${getFilenameBase()}.srt`, 'application/x-subrip;charset=utf-8;');
        DashboardToast.show('Đã tải file phụ đề .SRT');
      });

      $('vs-dl-vtt')?.addEventListener('click', () => {
        if (!parser || this.cues.length === 0) return;
        const content = parser.toWebVTT(this.cues);
        UTILS.downloadFile(content, `${getFilenameBase()}.vtt`, 'text/vtt;charset=utf-8;');
        DashboardToast.show('Đã tải file phụ đề .VTT');
      });

      $('vs-dl-txt')?.addEventListener('click', () => {
        if (!parser || this.cues.length === 0) return;
        const content = parser.toReadableTranscript(this.cues);
        UTILS.downloadFile(content, `${getFilenameBase()}_transcript.txt`, 'text/plain;charset=utf-8;');
        DashboardToast.show('Đã tải transcript sạch .TXT');
      });

      $('vs-btn-anki')?.addEventListener('click', () => {
        if (!analyzer || this.filteredWords.length === 0) return;
        const content = analyzer.exportToAnkiFormat(this.filteredWords);
        UTILS.downloadFile(content, `${getFilenameBase()}_anki.txt`, 'text/plain;charset=utf-8;');
        DashboardToast.show(`Đã xuất ${this.filteredWords.length} thẻ Anki!`);
      });

      $('vs-btn-csv')?.addEventListener('click', () => {
        if (!analyzer || this.filteredWords.length === 0) return;
        const content = analyzer.exportToCsvFormat(this.filteredWords);
        UTILS.downloadFile(content, `${getFilenameBase()}_vocab.csv`, 'text/csv;charset=utf-8;');
        DashboardToast.show(`Đã xuất ${this.filteredWords.length} từ vựng sang file CSV!`);
      });

      $('vs-btn-save-neon')?.addEventListener('click', async () => {
        if (this.filteredWords.length === 0) return;
        const btn = $('vs-btn-save-neon');
        btn.disabled = true;
        btn.textContent = 'Đang lưu vào Neon...';

        try {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'save_vocab_batch_neon',
              words: this.filteredWords
            }, resolve);
          });

          btn.disabled = false;
          btn.innerHTML = '🐘 Lưu vào Neon DB';

          if (res && res.success) {
            DashboardToast.show(`Đã đồng bộ ${res.count} từ vựng lên Neon Postgres!`);
            // Refresh main store
            DashboardStore.loadSubtitles();
          } else {
            throw new Error(res?.error || 'Lỗi khi lưu Neon');
          }
        } catch (e) {
          btn.disabled = false;
          btn.innerHTML = '🐘 Lưu vào Neon DB';
          DashboardToast.show(e.message || 'Lỗi khi lưu vào Neon DB', 'error');
        }
      });
    },

    bindFlashcards() {
      const card = $('vs-flashcard');
      if (card) {
        card.onclick = () => {
          this.isCardFlipped = !this.isCardFlipped;
          card.classList.toggle('flipped', this.isCardFlipped);
        };
      }

      $('fc-btn-speak')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = this.filteredWords[this.currentCardIndex];
        if (current && UTILS && UTILS.speakText) {
          UTILS.speakText(current.word);
        }
      });

      $('fc-btn-next')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.nextCard();
      });

      $('fc-btn-prev')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.prevCard();
      });

      $('fc-btn-good')?.addEventListener('click', (e) => {
        e.stopPropagation();
        DashboardToast.show('Đã ghi nhớ từ này! ✓');
        this.nextCard();
      });

      $('fc-btn-again')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.nextCard();
      });

      // Keyboard navigation (Space to flip, Left/Right arrows)
      document.addEventListener('keydown', (e) => {
        if (this.activePosFilter !== 'flashcards') return;
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea') return;

        if (e.code === 'Space') {
          e.preventDefault();
          if (card) card.click();
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          this.nextCard();
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          this.prevCard();
        }
      });
    },

    showLoading(text = 'Đang phân loại từ vựng...') {
      $('vs-loading')?.classList.remove('hidden');
      if ($('vs-loading-text')) $('vs-loading-text').textContent = text;
      $('vs-workspace')?.classList.add('hidden');
    },

    hideLoading() {
      $('vs-loading')?.classList.add('hidden');
    },

    loadAnalysis(cues, options = {}) {
      const analyzer = (typeof APP_VOCAB_ANALYZER !== 'undefined') ? APP_VOCAB_ANALYZER : null;
      if (!analyzer) return;

      this.cues = cues;
      const analysis = analyzer.analyzeSubtitles(cues, options);
      this.analysis = analysis;

      // Update Header Stats
      $('vs-source-badge').textContent = options.videoUrl?.includes('netflix.com') ? 'Netflix' : 'YouTube';
      $('vs-current-title').textContent = options.videoTitle || 'Movie / Video';
      $('vs-cues-count').textContent = `${analysis.summary.totalCues} câu thoại`;
      $('vs-total-words-count').textContent = `${analysis.summary.totalWords.toLocaleString()} từ`;
      $('vs-unique-words-count').textContent = `${analysis.summary.uniqueWords} từ vựng riêng biệt`;

      // Update 4 POS Summary Badges
      $('vs-count-nouns').textContent = analysis.summary.nounCount;
      $('vs-count-verbs').textContent = analysis.summary.verbCount;
      $('vs-count-adjs').textContent = analysis.summary.adjCount;
      $('vs-count-advs').textContent = analysis.summary.advCount;

      $('vs-tab-badge-all').textContent = analysis.summary.uniqueWords;
      $('vs-tab-badge-noun').textContent = analysis.summary.nounCount;
      $('vs-tab-badge-verb').textContent = analysis.summary.verbCount;
      $('vs-tab-badge-adj').textContent = analysis.summary.adjCount;
      $('vs-tab-badge-adv').textContent = analysis.summary.advCount;

      $('vs-workspace')?.classList.remove('hidden');
      this.renderWorkspace();
    },

    getFilteredWords() {
      if (!this.analysis) return [];
      let list = this.analysis.allWords || [];

      // 1. Filter by POS
      if (this.activePosFilter !== 'all' && this.activePosFilter !== 'flashcards') {
        list = list.filter(w => w.pos === this.activePosFilter);
      }

      // 2. Filter by CEFR
      if (this.activeCefrFilter === 'basic') {
        list = list.filter(w => w.cefr === 'A1' || w.cefr === 'A2');
      } else if (this.activeCefrFilter === 'intermediate') {
        list = list.filter(w => w.cefr === 'B1' || w.cefr === 'B2');
      } else if (this.activeCefrFilter === 'advanced') {
        list = list.filter(w => w.cefr === 'C1' || w.cefr === 'C2');
      }

      // 3. Filter by Frequency
      if (this.activeMinFreq > 1) {
        list = list.filter(w => (w.frequency || 1) >= this.activeMinFreq);
      }

      // 4. Search query
      if (this.searchQuery) {
        list = list.filter(w => {
          return w.word.toLowerCase().includes(this.searchQuery) ||
                 (w.translation && w.translation.toLowerCase().includes(this.searchQuery)) ||
                 (w.ipa && w.ipa.toLowerCase().includes(this.searchQuery));
        });
      }

      // 5. Sorting
      if (this.activeSort === 'az') {
        list.sort((a, b) => a.word.localeCompare(b.word));
      } else if (this.activeSort === 'timeline') {
        list.sort((a, b) => (a.firstSeenSec || 0) - (b.firstSeenSec || 0));
      } else {
        list.sort((a, b) => b.frequency - a.frequency || a.word.localeCompare(b.word));
      }

      this.filteredWords = list;
      return list;
    },

    renderWorkspace() {
      const words = this.getFilteredWords();
      const grid = $('vs-words-container');
      const flashcardWrap = $('vs-flashcard-container');

      if (this.activePosFilter === 'flashcards') {
        grid?.classList.add('hidden');
        flashcardWrap?.classList.remove('hidden');
        this.currentCardIndex = 0;
        this.renderFlashcardContent();
        return;
      }

      flashcardWrap?.classList.add('hidden');
      grid?.classList.remove('hidden');

      if (!grid) return;

      if (words.length === 0) {
        grid.innerHTML = '<div class="af-empty-vocab" style="grid-column:1/-1;text-align:center;padding:50px;color:#64748b;">Không tìm thấy từ vựng nào khớp với bộ lọc.</div>';
        return;
      }

      grid.innerHTML = words.map((item) => {
        const firstCtx = (item.contexts && item.contexts[0]) ? item.contexts[0] : null;
        let sentenceHtml = '';
        if (firstCtx) {
          const s = firstCtx.sentence;
          const hl = firstCtx.highlightWord || item.word;
          const reg = new RegExp(`\\b(${hl})\\b`, 'gi');
          sentenceHtml = s.replace(reg, '<strong class="vs-hl-word">$1</strong>');
        }

        const inflectionText = (item.inflections && item.inflections.length > 0) ? item.inflections.join(', ') : '';

        return `
          <div class="vs-word-card">
            <div class="vs-word-header">
              <div class="vs-word-title-box">
                <span class="vs-word-lemma">${item.word}</span>
                ${item.ipa ? `<span class="vs-word-ipa">${item.ipa}</span>` : ''}
                <button class="vs-btn-tts" data-speak="${item.word}" title="Nghe phát âm bản xứ">🔊</button>
              </div>

              <div class="vs-word-badges">
                <span class="badge-pos badge-pos-${item.pos}">${item.posLabelVi}</span>
                <span class="badge-cefr">${item.cefr}</span>
                <span class="badge-freq">${item.frequency}x</span>
              </div>
            </div>

            ${item.translation ? `<div class="vs-word-trans">${item.translation}</div>` : ''}

            ${inflectionText ? `<div class="vs-inflections-row">Dạng xuất hiện: ${inflectionText}</div>` : ''}

            ${firstCtx ? `
              <div class="vs-context-accordion">
                <p class="vs-context-sentence">"${sentenceHtml}"</p>
                <button class="vs-btn-timestamp" data-sec="${firstCtx.startSec}" title="Xem thời điểm phát trong phim">
                  ▶ ${firstCtx.startTime}
                </button>
              </div>
            ` : ''}

            <div class="vs-card-actions">
              <button class="vs-btn-action btn-save-cloud" data-save-word="${item.word}" title="Lưu từ này vào cơ sở dữ liệu Neon">
                🐘 Lưu Neon DB
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Bind speech buttons
      grid.querySelectorAll('.vs-btn-tts').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const word = btn.getAttribute('data-speak');
          if (UTILS && UTILS.speakText) UTILS.speakText(word);
        };
      });

      // Bind save single word buttons
      grid.querySelectorAll('.btn-save-cloud').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const wordText = btn.getAttribute('data-save-word');
          const targetItem = words.find(w => w.word === wordText);
          if (!targetItem) return;

          btn.disabled = true;
          btn.textContent = 'Đang lưu...';

          try {
            const firstCtx = (targetItem.contexts && targetItem.contexts[0]) ? targetItem.contexts[0] : null;
            const entity = (UTILS && UTILS.createSubtitleEntity) ? UTILS.createSubtitleEntity({
              text: targetItem.word,
              translation: targetItem.translation || '',
              explanation: `${targetItem.posLabelVi} | CEFR ${targetItem.cefr} | Xuất hiện ${targetItem.frequency} lần trong phim`,
              exampleSentence: firstCtx ? firstCtx.sentence : '',
              videoTitle: this.videoTitle,
              url: this.videoUrl
            }) : { text: targetItem.word, timestamp: Date.now() };

            if (neonClient && neonClient.saveSubtitle) {
              await neonClient.saveSubtitle(entity);
            }
            btn.textContent = '✓ Đã lưu Neon';
            btn.style.color = '#10b981';
            DashboardToast.show(`Đã lưu "${targetItem.word}" vào Neon DB!`);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Lỗi lưu';
            DashboardToast.show(err.message || 'Lỗi lưu Neon', 'error');
          }
        };
      });
    },

    renderFlashcardContent() {
      const words = this.filteredWords;
      if (words.length === 0) return;

      if (this.currentCardIndex >= words.length) this.currentCardIndex = 0;
      if (this.currentCardIndex < 0) this.currentCardIndex = words.length - 1;

      const item = words[this.currentCardIndex];
      const card = $('vs-flashcard');
      this.isCardFlipped = false;
      card?.classList.remove('flipped');

      $('fc-pos-badge').textContent = (item.posLabelVi || item.pos).toUpperCase();
      $('fc-word').textContent = item.word;
      $('fc-ipa').textContent = item.ipa || '';
      $('fc-trans').textContent = item.translation || '(Chưa có bản dịch)';
      $('fc-cefr').textContent = `CEFR ${item.cefr}`;

      const firstCtx = (item.contexts && item.contexts[0]) ? item.contexts[0] : null;
      if (firstCtx) {
        $('fc-sentence').textContent = `"${firstCtx.sentence}"`;
        $('fc-time').textContent = `▶ ${firstCtx.startTime}`;
      } else {
        $('fc-sentence').textContent = '';
        $('fc-time').textContent = '';
      }

      $('fc-progress-text').textContent = `Thẻ ${this.currentCardIndex + 1} / ${words.length}`;
    },

    nextCard() {
      if (this.filteredWords.length === 0) return;
      this.currentCardIndex = (this.currentCardIndex + 1) % this.filteredWords.length;
      this.renderFlashcardContent();
    },

    prevCard() {
      if (this.filteredWords.length === 0) return;
      this.currentCardIndex = (this.currentCardIndex - 1 + this.filteredWords.length) % this.filteredWords.length;
      this.renderFlashcardContent();
    }
  };

  // Initialize Modules
  setupAppEvents();
  ModalManager.init();
  SelectionBarManager.init();
  BatchTranslator.init();
  VocabStudioManager.init();
  DashboardStore.loadSettings();
  DashboardStore.loadSubtitles();
});
