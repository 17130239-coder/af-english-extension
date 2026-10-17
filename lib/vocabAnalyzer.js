/**
 * AF English - Advanced Vocabulary Analyzer & POS Categorizer
 * Splits subtitle text into Nouns, Verbs, Adjectives, Adverbs with lemmatization,
 * frequency analysis, movie context sentences, timestamps, and CEFR levels.
 * Compatible with Browser, Service Worker, and Node.js.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const nlp = require('./compromise.js');
    const cefrDict = require('./cefrDict.js');
    module.exports = factory(nlp, cefrDict);
  } else {
    root.APP_VOCAB_ANALYZER = factory(root.nlp, root.APP_CEFR_DICT);
  }
})(typeof self !== 'undefined' ? self : this, function (nlpInstance, cefrDictInstance) {
  'use strict';

  // Auxiliary verbs to ignore from main lexical verbs list
  const AUXILIARY_VERBS = new Set([
    'be', 'is', 'am', 'are', 'was', 'were', 'been', 'being',
    'have', 'has', 'had', 'having',
    'do', 'does', 'did', 'doing',
    'can', 'could', 'will', 'would', 'shall', 'should',
    'may', 'might', 'must'
  ]);

  // Common pronouns and determiners to ignore from nouns
  const PRONOUN_BLACKLIST = new Set([
    'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their',
    'mine', 'yours', 'hers', 'ours', 'theirs',
    'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
    'this', 'that', 'these', 'those',
    'who', 'whom', 'whose', 'which', 'what',
    'someone', 'somebody', 'something',
    'anyone', 'anybody', 'anything',
    'everyone', 'everybody', 'everything',
    'no one', 'nobody', 'nothing',
    'none', 'all', 'any', 'some', 'each', 'every', 'either', 'neither'
  ]);

  // Common high-frequency stopwords that add little value to vocabulary study
  const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'so', 'yet',
    'at', 'by', 'for', 'from', 'in', 'into', 'of', 'off', 'on', 'onto', 'out', 'over', 'to', 'up', 'with',
    'as', 'if', 'than', 'because', 'while', 'though', 'although',
    'oh', 'ah', 'uh', 'um', 'yeah', 'yes', 'no', 'okay', 'ok', 'hey', 'hi', 'hello',
    'gonna', 'wanna', 'gotta', 'huh', 'wow', 'ooh'
  ]);

  /**
   * Helper to ensure NLP engine is available.
   */
  function getNlp() {
    if (nlpInstance) return nlpInstance;
    if (typeof nlp !== 'undefined') return nlp;
    if (typeof window !== 'undefined' && window.nlp) return window.nlp;
    if (typeof self !== 'undefined' && self.nlp) return self.nlp;
    if (typeof globalThis !== 'undefined' && globalThis.nlp) return globalThis.nlp;
    throw new Error('Compromise NLP library is not loaded. Please include lib/compromise.js');
  }

  /**
   * Helper to ensure CEFR dictionary is available.
   */
  function getCefrDict() {
    if (cefrDictInstance) return cefrDictInstance;
    if (typeof APP_CEFR_DICT !== 'undefined') return APP_CEFR_DICT;
    if (typeof window !== 'undefined' && window.APP_CEFR_DICT) return window.APP_CEFR_DICT;
    if (typeof self !== 'undefined' && self.APP_CEFR_DICT) return self.APP_CEFR_DICT;
    return null;
  }

  /**
   * Clean word string.
   */
  function cleanWord(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/^[^\w]+|[^\w]+$/g, '')
      .replace(/['’]s$/i, '')
      .trim();
  }

  /**
   * Main analyzer: Analyzes subtitle cues and groups vocabulary by POS.
   * @param {Array<Object>} cues - Subtitle cues: [{ startSec, endSec, start, end, text, cleanText }]
   * @param {Object} [options] - Options: videoTitle, videoUrl, minFrequency, etc.
   */
  function analyzeSubtitles(cues, options = {}) {
    if (!Array.isArray(cues) || cues.length === 0) {
      return {
        summary: {
          totalWords: 0,
          uniqueWords: 0,
          nounCount: 0,
          verbCount: 0,
          adjCount: 0,
          advCount: 0,
          totalCues: 0
        },
        posGroups: {
          nouns: [],
          verbs: [],
          adjectives: [],
          adverbs: []
        },
        nouns: [],
        verbs: [],
        adjectives: [],
        adverbs: [],
        allWords: []
      };
    }

    const nlp = getNlp();
    const cefr = getCefrDict();
    const videoTitle = options.videoTitle || 'Movie / Video';
    const videoUrl = options.videoUrl || '';

    // Step 1: Preprocess cues into sentences with accurate timestamps
    // Subtitles are often broken across lines; we combine cues into sentences
    const sentences = [];
    let currentSentence = '';
    let currentStartSec = 0;
    let currentStartTime = '';

    cues.forEach((cue) => {
      const text = (cue.cleanText || cue.text || '').trim();
      if (!text) return;

      if (!currentSentence) {
        currentStartSec = cue.startSec;
        currentStartTime = cue.start || '00:00:00';
      }

      currentSentence += (currentSentence ? ' ' : '') + text;

      // When sentence ends with . ? ! or length exceeds limit
      if (/[.!?]$/.test(text) || currentSentence.length > 250) {
        sentences.push({
          text: currentSentence,
          startSec: currentStartSec,
          startTime: currentStartTime
        });
        currentSentence = '';
      }
    });

    if (currentSentence) {
      sentences.push({
        text: currentSentence,
        startSec: currentStartSec,
        startTime: currentStartTime
      });
    }

    // Step 2: Extract & Tag Words with Compromise NLP
    // Maps: lemma -> WordRecord
    const wordMap = new Map();
    let totalWordCount = 0;

    sentences.forEach((sentenceObj) => {
      const doc = nlp(sentenceObj.text);
      doc.compute('root');

      // Process all terms in this sentence
      const jsonDocs = doc.json();
      if (!Array.isArray(jsonDocs)) return;

      jsonDocs.forEach((docItem) => {
        if (!docItem.terms || !Array.isArray(docItem.terms)) return;

        docItem.terms.forEach((term) => {
          const rawText = term.text || '';
          const cleaned = cleanWord(rawText);
          if (!cleaned || cleaned.length <= 1) return;
          if (STOPWORDS.has(cleaned)) return;

          totalWordCount++;

          const tags = new Set(term.tags || []);

          // Classify primary Part of Speech
          let primaryPos = null;

          if (tags.has('Pronoun')) {
            // Ignore pronouns from nouns
            return;
          } else if (tags.has('Noun')) {
            if (PRONOUN_BLACKLIST.has(cleaned)) return;
            primaryPos = 'noun';
          } else if (tags.has('Verb')) {
            if (tags.has('Auxiliary') || AUXILIARY_VERBS.has(cleaned)) {
              return; // Ignore auxiliary verbs like is, was, have, do
            }
            primaryPos = 'verb';
          } else if (tags.has('Adjective')) {
            primaryPos = 'adjective';
          } else if (tags.has('Adverb')) {
            primaryPos = 'adverb';
          }

          if (!primaryPos) return;

          // Lemmatization: base form
          let root = (term.root || term.normal || cleaned).toLowerCase().trim();
          root = cleanWord(root);
          // For adverbs ending in 'ly', keep the adverb form (e.g. 'quickly' instead of 'quick')
          if (primaryPos === 'adverb' && cleaned.endsWith('ly') && cleaned.length > 3) {
            root = cleaned;
          }
          if (!root || root.length <= 1) root = cleaned;

          // Build or update WordRecord
          let record = wordMap.get(root);
          if (!record) {
            // Dictionary & CEFR lookup
            const dictInfo = cefr ? cefr.lookup(root) : null;
            const cefrLevel = dictInfo ? dictInfo.cefr : (cefr ? cefr.getLevel(root) : 'B1');
            const ipa = dictInfo ? dictInfo.ipa : '';
            const viTranslation = dictInfo ? dictInfo.vi : '';

            record = {
              word: root,
              pos: primaryPos, // 'noun' | 'verb' | 'adjective' | 'adverb'
              frequency: 0,
              cefr: cefrLevel,
              ipa: ipa,
              translation: viTranslation,
              inflections: new Map(), // surface form -> count
              contexts: [], // array of example sentences with timestamps
              firstSeenSec: sentenceObj.startSec,
              videoTitle: videoTitle,
              videoUrl: videoUrl
            };
            wordMap.set(root, record);
          } else {
            // If already exists, preserve most specific POS or prioritize lexical
            if (record.pos !== primaryPos) {
              if (primaryPos === 'verb' && record.pos === 'noun' && tags.has('Verb')) {
                // Keep POS consistent with highest usage
              }
            }
          }

          record.frequency++;

          // Track inflected forms (e.g. running: 3, ran: 1)
          const currInflectionCount = record.inflections.get(cleaned) || 0;
          record.inflections.set(cleaned, currInflectionCount + 1);

          // Add movie context example if not already full (store up to 5 best examples)
          if (record.contexts.length < 5) {
            const alreadyHasSentence = record.contexts.some(c => c.sentence === sentenceObj.text);
            if (!alreadyHasSentence) {
              record.contexts.push({
                sentence: sentenceObj.text,
                startSec: sentenceObj.startSec,
                startTime: sentenceObj.startTime,
                highlightWord: cleaned
              });
            }
          }
        });
      });
    });

    // Step 3: Format word records into organized arrays
    const allWords = Array.from(wordMap.values()).map((record) => {
      // Format inflections array
      const inflectionList = Array.from(record.inflections.entries()).map(([form, count]) => {
        return count > 1 ? `${form} (${count}x)` : form;
      });

      return {
        word: record.word,
        pos: record.pos,
        posLabelVi: getPosLabelVi(record.pos),
        frequency: record.frequency,
        cefr: record.cefr,
        ipa: record.ipa,
        translation: record.translation,
        inflections: inflectionList,
        contexts: record.contexts,
        firstSeenSec: record.firstSeenSec,
        videoTitle: record.videoTitle,
        videoUrl: record.videoUrl
      };
    });

    // Sort by frequency descending by default
    allWords.sort((a, b) => b.frequency - a.frequency || a.word.localeCompare(b.word));

    // Split into 4 POS groups
    const nouns = allWords.filter(w => w.pos === 'noun');
    const verbs = allWords.filter(w => w.pos === 'verb');
    const adjectives = allWords.filter(w => w.pos === 'adjective');
    const adverbs = allWords.filter(w => w.pos === 'adverb');

    return {
      summary: {
        totalWords: totalWordCount,
        uniqueWords: allWords.length,
        nounCount: nouns.length,
        verbCount: verbs.length,
        adjCount: adjectives.length,
        advCount: adverbs.length,
        totalCues: cues.length,
        videoTitle: videoTitle
      },
      posGroups: {
        nouns: nouns,
        verbs: verbs,
        adjectives: adjectives,
        adverbs: adverbs
      },
      nouns: nouns,
      verbs: verbs,
      adjectives: adjectives,
      adverbs: adverbs,
      allWords: allWords
    };
  }

  /**
   * Helper for Vietnamese POS labels.
   */
  function getPosLabelVi(pos) {
    switch (pos) {
      case 'noun': return 'Danh từ';
      case 'verb': return 'Động từ';
      case 'adjective': return 'Tính từ';
      case 'adverb': return 'Trạng từ';
      default: return 'Từ vựng';
    }
  }

  /**
   * Export vocabulary list to Anki format (.txt / .csv).
   * Fields: Word | POS | Phonetic | Vietnamese Translation | Context Sentence | Video Source
   */
  function exportToAnkiFormat(words) {
    if (!Array.isArray(words) || words.length === 0) return '';
    const lines = [];

    // Header comment for Anki import
    lines.push('#separator:Tab');
    lines.push('#html:true');
    lines.push('#tags:af-english subtitle-vocab');

    words.forEach((item) => {
      const word = item.word || '';
      const pos = item.posLabelVi || item.pos || '';
      const ipa = item.ipa ? `[${item.ipa}]` : '';
      const trans = item.translation || '';

      const firstContext = (item.contexts && item.contexts[0]) ? item.contexts[0] : null;
      let sentenceHtml = '';
      if (firstContext) {
        const sentence = firstContext.sentence || '';
        const hl = firstContext.highlightWord || word;
        // Bold the target word in context sentence safely
        const escapedHl = String(hl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b(${escapedHl})\\b`, 'gi');
        sentenceHtml = sentence.replace(regex, '<b>$1</b>');
        if (firstContext.startTime) {
          sentenceHtml += ` <small style="color:#f97316;">(${firstContext.startTime})</small>`;
        }
      }

      const backCard = `<div style="font-size:18px;font-weight:bold;color:#f97316;">${trans}</div><div style="font-size:13px;color:#888;">${pos} ${ipa}</div><div style="margin-top:8px;font-style:italic;">${sentenceHtml}</div>`;

      // Front: Word + IPA + POS badge
      const frontCard = `<div style="font-size:22px;font-weight:bold;">${word}</div><span style="font-size:12px;background:#333;color:#f8fafc;padding:2px 6px;border-radius:4px;">${pos}</span>`;

      // Sanitize tab and newline characters so Anki delimiter is not corrupted
      const sanitizedFront = frontCard.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
      const sanitizedBack = backCard.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');

      lines.push(`${sanitizedFront}\t${sanitizedBack}`);
    });

    return lines.join('\n');
  }

  /**
   * Export vocabulary list to CSV format compliant with Excel.
   */
  function exportToCsvFormat(words) {
    if (!Array.isArray(words) || words.length === 0) return '';
    const header = ['"Từ vựng"', '"Loại từ"', '"Phiên âm"', '"Cấp độ CEFR"', '"Tần suất"', '"Nghĩa tiếng Việt"', '"Câu ngữ cảnh phim"', '"Thời điểm (timestamp)"', '"Nguồn phim/video"'];
    const lines = [header.join(',')];

    words.forEach((w) => {
      const firstCtx = (w.contexts && w.contexts[0]) ? w.contexts[0] : { sentence: '', startTime: '' };
      const row = [
        `"${(w.word || '').replace(/"/g, '""')}"`,
        `"${(w.posLabelVi || w.pos || '').replace(/"/g, '""')}"`,
        `"${(w.ipa || '').replace(/"/g, '""')}"`,
        `"${(w.cefr || '').replace(/"/g, '""')}"`,
        w.frequency || 1,
        `"${(w.translation || '').replace(/"/g, '""')}"`,
        `"${(firstCtx.sentence || '').replace(/"/g, '""')}"`,
        `"${(firstCtx.startTime || '').replace(/"/g, '""')}"`,
        `"${(w.videoTitle || '').replace(/"/g, '""')}"`
      ];
      lines.push(row.join(','));
    });

    return lines.join('\n');
  }

  return Object.freeze({
    analyzeSubtitles,
    getPosLabelVi,
    exportToAnkiFormat,
    exportToCsvFormat
  });
});
