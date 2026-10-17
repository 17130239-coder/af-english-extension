/**
 * YouTube Subtitle Click & Copy - Utility Functions
 * Supports Browser (Window), Chrome Extension Service Worker (self), and Node.js (CommonJS).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.APP_UTILS = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Escape HTML special characters to prevent XSS injection.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Escape string for CSV export compliant with RFC 4180.
   * @param {any} val
   * @returns {string}
   */
  function escapeCsv(val) {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  }

  /**
   * Format relative human-friendly time string (Vietnamese).
   * @param {number|string|Date} timestamp
   * @returns {string}
   */
  function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    if (isNaN(ts)) return '';

    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return 'Vừa xong';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;

    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Generate unique timestamped ID for subtitle items.
   * @param {string} prefix
   * @returns {string}
   */
  function generateId(prefix = 'sub') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Sanitize video titles by removing emojis and normalizing whitespace.
   * @param {string} title
   * @returns {string}
   */
  function cleanTitle(title) {
    if (!title) return 'YouTube Video';
    const cleaned = String(title)
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'YouTube Video';
  }

  /**
   * Clean and normalize subtitle text (removes zero-width characters, emojis, decodes HTML entities, and normalizes whitespaces).
   * @param {string} text
   * @returns {string}
   */
  function cleanSubtitleText(text) {
    if (!text) return '';
    return String(text)
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu, '')
      .replace(/\r?\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim();
  }

  /**
   * Safely extract and parse JSON object from LLM response (supports markdown code blocks, think tags, and partial fences).
   * @param {string} raw
   * @returns {{ keyPhrase: string, phraseTranslation: string, translation: string, explanation: string, synonyms: Array<string>, examples: Array<{context: string, sentence: string, translation: string}>, exampleSentence: string, exampleTranslation: string }}
   */
  function parseJsonSafely(raw) {
    const emptyResult = {
      keyPhrase: '',
      phraseTranslation: '',
      translation: '',
      explanation: '',
      synonyms: [],
      examples: [],
      exampleSentence: '',
      exampleTranslation: ''
    };

    if (!raw) return emptyResult;

    // 0. Strip reasoning / thinking tags (e.g. <think>...</think>) from models like Gemini 3.8 / DeepSeek
    let cleaned = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // 1. Strip markdown code fences (```json ... ```)
    cleaned = cleaned
      .replace(/^```json\s*/im, '')
      .replace(/^```\s*/im, '')
      .replace(/```\s*$/m, '')
      .trim();

    function formatResult(parsed) {
      if (!parsed || typeof parsed !== 'object') return emptyResult;

      const keyPhrase = String(parsed.keyPhrase || parsed.phrase || parsed.word || '').trim();
      const phraseTranslation = String(parsed.phraseTranslation || parsed.keyPhraseTranslation || '').trim();
      const translation = String(parsed.translation || '').trim();
      const explanation = String(parsed.explanation || '').trim();

      // Synonyms array
      let synonyms = [];
      if (Array.isArray(parsed.synonyms)) {
        synonyms = parsed.synonyms.map(s => String(s).trim()).filter(Boolean);
      } else if (typeof parsed.synonyms === 'string') {
        synonyms = parsed.synonyms.split(',').map(s => s.trim()).filter(Boolean);
      }

      // 3 Examples array
      let examples = [];
      if (Array.isArray(parsed.examples)) {
        examples = parsed.examples.map((ex, idx) => ({
          context: String(ex.context || `Ngữ cảnh ${idx + 1}`).trim(),
          sentence: String(ex.sentence || ex.en || '').trim(),
          translation: String(ex.translation || ex.vi || '').trim()
        })).filter(ex => ex.sentence);
      }

      // Backward compatibility fallback for legacy 1-example fields
      if (examples.length === 0 && (parsed.exampleSentence || parsed.example)) {
        const sentence = String(parsed.exampleSentence || parsed.example || '').trim();
        const trans = String(parsed.exampleTranslation || '').trim();
        if (sentence) {
          examples.push({
            context: 'Ví dụ',
            sentence: sentence,
            translation: trans
          });
        }
      }

      const firstEx = examples[0] || { sentence: '', translation: '' };

      return {
        keyPhrase: keyPhrase,
        phraseTranslation: phraseTranslation,
        translation: translation,
        explanation: explanation,
        synonyms: synonyms,
        examples: examples,
        exampleSentence: String(parsed.exampleSentence || firstEx.sentence || '').trim(),
        exampleTranslation: String(parsed.exampleTranslation || firstEx.translation || '').trim()
      };
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === 'object' && parsed !== null) {
        return formatResult(parsed);
      }
    } catch (e) {
      // 2. Try regex extraction of JSON block
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return formatResult(parsed);
        } catch (e2) {
          // ignore
        }
      }

      // 3. Regex fallback for individual keys
      const kpMatch = cleaned.match(/"keyPhrase"\s*:\s*"([^"]+)"/i);
      const kpTransMatch = cleaned.match(/"phraseTranslation"\s*:\s*"([^"]+)"/i);
      const transMatch = cleaned.match(/"translation"\s*:\s*"([^"]+)"/i);
      const expMatch = cleaned.match(/"explanation"\s*:\s*"([^"]+)"/i);
      const exMatch = cleaned.match(/"exampleSentence"\s*:\s*"([^"]+)"/i);
      const exViMatch = cleaned.match(/"exampleTranslation"\s*:\s*"([^"]+)"/i);

      const sentence = exMatch ? exMatch[1].trim() : '';
      const exVi = exViMatch ? exViMatch[1].trim() : '';

      return {
        keyPhrase: kpMatch ? kpMatch[1].trim() : '',
        phraseTranslation: kpTransMatch ? kpTransMatch[1].trim() : '',
        translation: transMatch ? transMatch[1].trim() : cleaned.trim(),
        explanation: expMatch ? expMatch[1].trim() : '',
        synonyms: [],
        examples: sentence ? [{ context: 'Ví dụ', sentence, translation: exVi }] : [],
        exampleSentence: sentence,
        exampleTranslation: exVi
      };
    }

    return emptyResult;
  }

  /**
   * Standard debounce function.
   * @param {Function} fn
   * @param {number} delay
   * @returns {Function}
   */
  function debounce(fn, delay = 200) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fn.apply(this, args);
      }, delay);
    };
  }

  /**
   * Client-side file download helper.
   * @param {string} content
   * @param {string} filename
   * @param {string} mimeType
   */
  function downloadFile(content, filename, mimeType = 'text/plain;charset=utf-8;') {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Parse timestamp in seconds from a YouTube URL.
   * Handles ?t=120s, ?t=120, ?t=1h2m3s, ?t=12m8s, ?start=120.
   * @param {string} url
   * @returns {number|null} seconds or null
   */
  function parseYouTubeTimestamp(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      const isYT = parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be');
      if (!isYT) return null;

      const t = parsed.searchParams.get('t') || parsed.searchParams.get('start');
      if (!t) return null;

      // Pure digits or digits with 's' (e.g. 728, 728s)
      if (/^\d+s?$/i.test(t)) {
        const sec = parseInt(t, 10);
        return (!isNaN(sec) && sec >= 0) ? sec : null;
      }

      // Format like 1h2m3s or 12m8s
      let totalSeconds = 0;
      let matched = false;
      const hourMatch = t.match(/(\d+)\s*h/i);
      const minMatch = t.match(/(\d+)\s*m/i);
      const secMatch = t.match(/(\d+)\s*s/i);

      if (hourMatch) {
        totalSeconds += parseInt(hourMatch[1], 10) * 3600;
        matched = true;
      }
      if (minMatch) {
        totalSeconds += parseInt(minMatch[1], 10) * 60;
        matched = true;
      }
      if (secMatch) {
        totalSeconds += parseInt(secMatch[1], 10);
        matched = true;
      }

      return (matched && totalSeconds >= 0) ? totalSeconds : null;
    } catch (e) {
      // Fallback regex for partial or malformed URL strings
      const match = url.match(/[?&](?:t|start)=([0-9hms]+)/i);
      if (match && match[1]) {
        const val = match[1];
        if (/^\d+s?$/i.test(val)) {
          return parseInt(val, 10);
        }
      }
      return null;
    }
  }

  /**
   * Format seconds into friendly video timestamp strings.
   * @param {number} seconds
   * @returns {{ seconds: number, timeStr: string, label: string }}
   */
  function formatVideoTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    let timeStr = '';
    if (hrs > 0) {
      timeStr = `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
      timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    return {
      seconds: total,
      timeStr: timeStr,
      label: `${total}s (${timeStr})`
    };
  }

  /**
   * Ensure YouTube URL has &t=...s parameter.
   * Also converts /shorts/ID to standard watch format for reliable timestamp seeking.
   * @param {string} url
   * @param {number} [fallbackSeconds]
   * @returns {string}
   */
  function ensureYouTubeTimestampUrl(url, fallbackSeconds = null) {
    if (!url || typeof url !== 'string') return url || '';
    try {
      const parsed = new URL(url);
      const isYouTube = parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be');
      if (!isYouTube) return url;

      // Extract existing seconds or fallback
      let sec = parseYouTubeTimestamp(url);
      if (sec === null && fallbackSeconds !== null && !isNaN(fallbackSeconds) && fallbackSeconds >= 0) {
        sec = Math.floor(fallbackSeconds);
      }

      if (sec === null) return url;

      // Normalize Shorts to standard watch URL
      if (parsed.pathname.startsWith('/shorts/')) {
        const shortId = parsed.pathname.split('/')[2];
        if (shortId) {
          return `https://www.youtube.com/watch?v=${shortId}&t=${sec}s`;
        }
      }

      parsed.searchParams.set('t', `${sec}s`);
      return parsed.toString();
    } catch (e) {
      return url;
    }
  }

  /**
   * Standard Subtitle Entity Factory.
   * Ensures consistent data structure across all contexts (Content, Popup, Dashboard, Background).
   * @param {Object} data
   * @returns {Object}
   */
  function createSubtitleEntity(data = {}) {
    const text = cleanSubtitleText(data.text || '');

    // Format examples array
    let examples = [];
    if (Array.isArray(data.examples)) {
      examples = data.examples.map((ex, idx) => ({
        context: String(ex.context || `Ngữ cảnh ${idx + 1}`).trim(),
        sentence: String(ex.sentence || ex.en || '').trim(),
        translation: String(ex.translation || ex.vi || '').trim()
      })).filter(ex => ex.sentence);
    } else if (data.exampleSentence) {
      examples = [{
        context: 'Ví dụ',
        sentence: String(data.exampleSentence).trim(),
        translation: String(data.exampleTranslation || '').trim()
      }];
    }

    const firstEx = examples[0] || { sentence: '', translation: '' };

    // Format synonyms array
    let synonyms = [];
    if (Array.isArray(data.synonyms)) {
      synonyms = data.synonyms.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof data.synonyms === 'string') {
      synonyms = data.synonyms.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Ensure URL has timestamp parameter if seconds provided or present
    const rawUrl = String(data.url || '').trim();
    const finalUrl = ensureYouTubeTimestampUrl(rawUrl, data.playbackSeconds ?? data.seconds);

    return {
      id: String(data.id || generateId('sub')),
      text: text,
      timestamp: Number(data.timestamp) || Date.now(),
      videoTitle: cleanTitle(data.videoTitle || 'YouTube Video'),
      url: finalUrl,
      keyPhrase: String(data.keyPhrase || '').trim(),
      phraseTranslation: String(data.phraseTranslation || '').trim(),
      translation: String(data.translation || '').trim(),
      explanation: String(data.explanation || '').trim(),
      synonyms: synonyms,
      examples: examples,
      exampleSentence: String(data.exampleSentence || firstEx.sentence || '').trim(),
      exampleTranslation: String(data.exampleTranslation || firstEx.translation || '').trim(),
      isFavorite: Boolean(data.isFavorite),
      status: String(data.status || (data.translation ? 'translated' : 'pending'))
    };
  }

  /**
   * Play speech using Web Speech API with pause/resume bug workaround.
   * @param {string} text
   * @param {Object} [options]
   */
  function speakText(text, options = {}) {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang || 'en-US';
      utterance.rate = options.rate || 0.95;
      utterance.pitch = options.pitch || 1.0;
      if (typeof options.onEnd === 'function') {
        utterance.onend = options.onEnd;
      }
      if (typeof options.onError === 'function') {
        utterance.onerror = options.onError;
      }
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[Speech] Synthesis error:', e);
    }
  }

  return Object.freeze({
    escapeHtml,
    escapeCsv,
    formatRelativeTime,
    generateId,
    cleanSubtitleText,
    cleanTitle,
    parseJsonSafely,
    debounce,
    downloadFile,
    createSubtitleEntity,
    speakText,
    parseYouTubeTimestamp,
    formatVideoTime,
    ensureYouTubeTimestampUrl
  });
});
