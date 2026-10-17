/**
 * af-english - Unified AI Translation Service (9Router AI Gateway)
 * Local / Remote AI Gateway proxying Google Gemini 3.8 Flash, Claude & GPT.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const utils = require('./utils.js');
    const constants = require('./constants.js');
    module.exports = factory(utils, constants);
  } else {
    root.aiService = factory(root.APP_UTILS, root.APP_CONSTANTS);
  }
})(typeof self !== 'undefined' ? self : this, function (utils, constants) {
  'use strict';

  const parseJsonSafely = utils ? utils.parseJsonSafely : (r) => ({ translation: r, explanation: '', exampleSentence: '', exampleTranslation: '' });
  const AI_PROVIDERS = (constants && constants.AI_PROVIDERS) || {
    NINE_ROUTER: 'nine_router'
  };

  /**
   * Standard translation prompt template
   */
  function buildPrompt(text) {
    return `Phân tích câu hoặc từ tiếng Anh sau:
"${text}"

QUY TẮC BẮT BUỘC (NGẮN GỌN - DỄ HIỂU - THỰC TẾ):
1. keyPhrase: Trích xuất cụm từ có ý nghĩa nhất (phrasal verb, idiom, collocation, hoặc từ khóa cốt lõi) ở dạng từ điển/nguyên thể kèm tân ngữ đại diện nếu có (ví dụ: "run into someone", "look forward to doing something"). Nếu chỉ có 1 từ thì lấy từ đó.
2. phraseTranslation: Dịch nghĩa của cụm từ đó sang tiếng Việt cực kỳ súc tích (chỉ từ 2 đến 5 từ).
3. synonyms: Đúng 2-3 từ hoặc cụm từ đồng nghĩa THÔNG DỤNG NHẤT trong đời sống hàng ngày (từ vựng cấp độ A2-B2 thuộc 3000 từ phổ biến, TUYỆT ĐỐI TRÁNH từ hiếm, cổ, hoặc quá hàn lâm).
4. examples: Đúng 3 ví dụ minh hoạ dễ hiểu trong các ngữ cảnh khác nhau (MỖI CÂU DƯỚI 12 TỪ), dùng từ vựng tự nhiên, dễ nhớ, chia đều cho 3 ngữ cảnh thực tế: "Giao tiếp", "Công việc", "Đời sống", kèm bản dịch tiếng Việt tương ứng cho từng câu.
5. translation: Dịch toàn bộ câu gốc sang tiếng Việt tự nhiên, chuẩn văn phong đời thường.
6. explanation: 1 câu giải thích ngắn gọn (dưới 15 từ) về ngữ cảnh hoặc sắc thái sử dụng.

Yêu cầu BẮT BUỘC trả về DUY NHẤT một chuỗi JSON hợp lệ (không markdown, không giải thích bên ngoài):
{
  "keyPhrase": "cụm từ nguyên thể kèm tân ngữ nếu có",
  "phraseTranslation": "nghĩa tiếng Việt của cụm từ (2-5 từ)",
  "translation": "bản dịch tiếng Việt tự nhiên của cả câu",
  "explanation": "giải thích ngắn gọn dưới 15 từ",
  "synonyms": ["từ/cụm từ đồng nghĩa 1", "từ/cụm từ đồng nghĩa 2"],
  "examples": [
    {
      "context": "Giao tiếp",
      "sentence": "Câu tiếng Anh dưới 12 từ",
      "translation": "Dịch tiếng Việt"
    },
    {
      "context": "Công việc",
      "sentence": "Câu tiếng Anh dưới 12 từ",
      "translation": "Dịch tiếng Việt"
    },
    {
      "context": "Đời sống",
      "sentence": "Câu tiếng Anh dưới 12 từ",
      "translation": "Dịch tiếng Việt"
    }
  ]
}`;
  }

  /**
   * 9Router AI Gateway (Local / Remote OpenAI-compatible gateway)
   */
  async function callNineRouter(text, config = {}) {
    const baseUrl = (config.nineRouterBaseUrl || 'http://localhost:20128/v1').replace(/\/+$/, '');
    const apiKey = config.nineRouterApiKey || '';
    const model = config.nineRouterModel || 'ag/gemini-3.8-flash-low';
    const endpoint = `${baseUrl}/chat/completions`;

    const payload = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a pragmatic English language tutor. Output ONLY valid JSON. Prioritize conciseness, everyday practical vocabulary (Oxford 3000), and short natural examples (< 12 words).'
        },
        {
          role: 'user',
          content: buildPrompt(text)
        }
      ],
      stream: false
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${res.status}`;
      throw new Error(`9Router API (${res.status}): ${msg}`);
    }

    const data = await res.json();
    const rawText = data?.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('9Router không trả về nội dung.');

    return parseJsonSafely(rawText);
  }

  /**
   * Main Translation Dispatcher (Exclusively uses 9Router AI Gateway)
   *
   * @param {string} text
   * @param {Object} settings
   * @returns {Promise<Object>}
   */
  async function translateText(text, settings = {}) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return {
        keyPhrase: '',
        phraseTranslation: '',
        translation: '',
        explanation: '',
        synonyms: [],
        examples: [],
        exampleSentence: '',
        exampleTranslation: ''
      };
    }

    return await callNineRouter(trimmed, settings);
  }

  /**
   * Connection tester for Settings modal
   */
  async function testConnection(provider, config = {}) {
    const sampleText = 'Knowledge is power.';
    const res = await callNineRouter(sampleText, config);
    return {
      ok: true,
      model: config.nineRouterModel || 'ag/gemini-3.8-flash-low',
      sample: res
    };
  }

  return {
    AI_PROVIDERS,
    buildPrompt,
    callNineRouter,
    translateText,
    testConnection
  };
});
