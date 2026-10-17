/**
 * Neon Serverless Database Client for YouTube Subtitle Extension
 * Connects directly to Neon Postgres over HTTPS (/sql) without TCP/WebSocket dependencies.
 * Supports Browser (Window), Content Scripts (via Background Proxy), and Chrome Extension Service Worker (self).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const constants = require('./constants.js');
    module.exports = factory(constants);
  } else {
    root.neonClient = factory(root.APP_CONSTANTS);
  }
})(typeof self !== 'undefined' ? self : this, function (constants) {
  'use strict';

  const cfg = (constants && constants.NEON_CONFIG) || {
    DEFAULT_DB_URL: 'postgresql://neondb_owner:YOUR_PASSWORD_HERE@ep-super-cake-az82uvk1-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    PROJECT_ID: 'wild-band-00612836',
    BRANCH: 'production',
    DEFAULT_HOST: 'ep-super-cake-az82uvk1-pooler.c-3.ap-southeast-1.aws.neon.tech'
  };

  class NeonStorageClient {
    constructor() {
      this.dbUrl = cfg.DEFAULT_DB_URL;
      this.projectId = cfg.PROJECT_ID;
      this.branch = cfg.BRANCH;
      this.host = cfg.DEFAULT_HOST;
      this.endpoint = `https://${this.host}/sql`;
      this.isConfigured = true;
      this.initUrl(this.dbUrl);
    }

    /**
     * Parse connection string and set up HTTPS /sql endpoint.
     * Supports both postgresql:// and postgres:// formats.
     * @param {string} url
     */
    initUrl(url) {
      this.dbUrl = (url && String(url).trim()) || cfg.DEFAULT_DB_URL;
      try {
        const normalized = this.dbUrl.replace(/^postgres(ql)?:\/\//i, 'http://');
        const parsed = new URL(normalized);
        this.host = parsed.host || cfg.DEFAULT_HOST;
        this.endpoint = `https://${this.host}/sql`;
      } catch (e) {
        this.host = cfg.DEFAULT_HOST;
        this.endpoint = `https://${this.host}/sql`;
      }
    }

    /**
     * Asynchronously loads custom Neon configuration if configured by user in extension storage.
     */
    async loadConfig() {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['neonDatabaseUrl'], (res) => {
            if (res && res.neonDatabaseUrl) {
              this.initUrl(res.neonDatabaseUrl);
            }
            resolve(this.dbUrl);
          });
        } else {
          resolve(this.dbUrl);
        }
      });
    }

    /**
     * Direct HTTPS query to Neon /sql serverless endpoint.
     * @param {string} sql
     * @param {Array<any>} params
     * @returns {Promise<Array<any>>}
     */
    async queryDirect(sql, params = []) {
      await this.loadConfig();

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Neon-Connection-String': this.dbUrl
        },
        body: JSON.stringify({ query: sql, params })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let errMsg = `Neon HTTP Error (${res.status})`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.message) errMsg = errJson.message;
        } catch (e) {
          if (errText) errMsg += `: ${errText}`;
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      return data.rows || [];
    }

    /**
     * Unified Query Method.
     * In web page content scripts (e.g. youtube.com), direct fetch to external domains is blocked
     * by the page's Content Security Policy (CSP). Thus, content scripts proxy via background worker.
     * Everywhere else (background worker, dashboard, popup), direct HTTPS is used.
     *
     * @param {string} sql
     * @param {Array<any>} params
     * @returns {Promise<Array<any>>}
     */
    async query(sql, params = []) {
      const isContentScript =
        typeof window !== 'undefined' &&
        typeof window.location !== 'undefined' &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:');

      if (isContentScript && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'neon_query', sql, params }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!res || !res.success) {
              reject(new Error(res?.error || 'No response from Neon background worker'));
            } else {
              resolve(res.rows || []);
            }
          });
        });
      }

      return this.queryDirect(sql, params);
    }

    /**
     * Initialize Neon table schema if not already present.
     */
    async initSchema() {
      await this.query(`
        CREATE TABLE IF NOT EXISTS subtitles (
          id VARCHAR(100) PRIMARY KEY,
          text TEXT NOT NULL,
          video_title TEXT,
          url TEXT,
          timestamp BIGINT,
          translation TEXT,
          explanation TEXT,
          example_sentence TEXT,
          example_translation TEXT,
          key_phrase TEXT,
          phrase_translation TEXT,
          synonyms TEXT,
          examples JSONB,
          is_favorite BOOLEAN DEFAULT FALSE,
          status VARCHAR(50) DEFAULT 'pending',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      // Add optional columns if upgrading from existing database
      await this.query(`ALTER TABLE subtitles ADD COLUMN IF NOT EXISTS key_phrase TEXT;`).catch(() => {});
      await this.query(`ALTER TABLE subtitles ADD COLUMN IF NOT EXISTS phrase_translation TEXT;`).catch(() => {});
      await this.query(`ALTER TABLE subtitles ADD COLUMN IF NOT EXISTS synonyms TEXT;`).catch(() => {});
      await this.query(`ALTER TABLE subtitles ADD COLUMN IF NOT EXISTS examples JSONB;`).catch(() => {});

      await this.query(`CREATE INDEX IF NOT EXISTS idx_subtitles_timestamp ON subtitles (timestamp DESC);`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_subtitles_favorite ON subtitles (is_favorite);`);
      return true;
    }

    /**
     * Map database row to standard subtitle entity object.
     * @param {Object} row
     */
    mapRow(row) {
      if (!row) return null;

      let examples = [];
      if (row.examples) {
        try {
          examples = typeof row.examples === 'string' ? JSON.parse(row.examples) : row.examples;
        } catch (e) {
          examples = [];
        }
      }
      if (!Array.isArray(examples) || examples.length === 0) {
        if (row.example_sentence) {
          examples = [{
            context: 'Ví dụ',
            sentence: String(row.example_sentence || ''),
            translation: String(row.example_translation || '')
          }];
        }
      }

      let synonyms = [];
      if (row.synonyms) {
        try {
          synonyms = typeof row.synonyms === 'string'
            ? (row.synonyms.startsWith('[') ? JSON.parse(row.synonyms) : row.synonyms.split(',').map(s => s.trim()).filter(Boolean))
            : row.synonyms;
        } catch (e) {
          synonyms = String(row.synonyms).split(',').map(s => s.trim()).filter(Boolean);
        }
      }

      return {
        id: String(row.id),
        text: String(row.text || ''),
        videoTitle: String(row.video_title || 'YouTube Video'),
        url: String(row.url || ''),
        timestamp: Number(row.timestamp) || Date.now(),
        keyPhrase: String(row.key_phrase || ''),
        phraseTranslation: String(row.phrase_translation || ''),
        translation: String(row.translation || ''),
        explanation: String(row.explanation || ''),
        synonyms: Array.isArray(synonyms) ? synonyms : [],
        examples: Array.isArray(examples) ? examples : [],
        exampleSentence: String(row.example_sentence || (examples[0] && examples[0].sentence) || ''),
        exampleTranslation: String(row.example_translation || (examples[0] && examples[0].translation) || ''),
        isFavorite: Boolean(row.is_favorite),
        status: String(row.status || (row.translation ? 'translated' : 'pending')),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }

    /**
     * Fetch all subtitles from Neon.
     * @param {number} limit
     */
    async getAllSubtitles(limit = 500) {
      const sql = `
        SELECT * FROM subtitles 
        ORDER BY timestamp DESC 
        LIMIT $1;
      `;
      const rows = await this.query(sql, [limit]);
      return rows.map((r) => this.mapRow(r));
    }

    /**
     * Insert or update a subtitle in Neon.
     * @param {Object} item
     */
    async saveSubtitle(item) {
      if (!item || !item.text) return null;

      const id = item.id || `sub_${item.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const text = String(item.text).trim();
      const videoTitle = String(item.videoTitle || 'YouTube Video');
      const url = String(item.url || '');
      const timestamp = Number(item.timestamp) || Date.now();
      const keyPhrase = item.keyPhrase || null;
      const phraseTranslation = item.phraseTranslation || null;
      const translation = item.translation || null;
      const explanation = item.explanation || null;
      const exampleSentence = item.exampleSentence || (item.examples && item.examples[0] ? item.examples[0].sentence : null);
      const exampleTranslation = item.exampleTranslation || (item.examples && item.examples[0] ? item.examples[0].translation : null);
      const synonyms = item.synonyms ? JSON.stringify(item.synonyms) : null;
      const examples = item.examples && item.examples.length > 0 ? JSON.stringify(item.examples) : null;
      const isFavorite = Boolean(item.isFavorite);
      const status = item.status || (translation ? 'translated' : 'pending');

      const sql = `
        INSERT INTO subtitles (
          id, text, video_title, url, timestamp,
          translation, explanation, example_sentence, example_translation,
          key_phrase, phrase_translation, synonyms, examples,
          is_favorite, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          text = EXCLUDED.text,
          video_title = EXCLUDED.video_title,
          url = EXCLUDED.url,
          timestamp = EXCLUDED.timestamp,
          translation = COALESCE(EXCLUDED.translation, subtitles.translation),
          explanation = COALESCE(EXCLUDED.explanation, subtitles.explanation),
          example_sentence = COALESCE(EXCLUDED.example_sentence, subtitles.example_sentence),
          example_translation = COALESCE(EXCLUDED.example_translation, subtitles.example_translation),
          key_phrase = COALESCE(EXCLUDED.key_phrase, subtitles.key_phrase),
          phrase_translation = COALESCE(EXCLUDED.phrase_translation, subtitles.phrase_translation),
          synonyms = COALESCE(EXCLUDED.synonyms, subtitles.synonyms),
          examples = COALESCE(EXCLUDED.examples, subtitles.examples),
          is_favorite = COALESCE(EXCLUDED.is_favorite, subtitles.is_favorite),
          status = COALESCE(EXCLUDED.status, subtitles.status),
          updated_at = NOW()
        RETURNING *;
      `;

      const rows = await this.query(sql, [
        id,
        text,
        videoTitle,
        url,
        timestamp,
        translation,
        explanation,
        exampleSentence,
        exampleTranslation,
        keyPhrase,
        phraseTranslation,
        synonyms,
        examples,
        isFavorite,
        status
      ]);

      return this.mapRow(rows[0]);
    }

    /**
     * Update AI translation result fields for an existing subtitle.
     * @param {string} id
     * @param {Object} aiData
     */
    async updateAiResult(id, aiData) {
      const keyPhrase = aiData.keyPhrase || null;
      const phraseTranslation = aiData.phraseTranslation || null;
      const translation = aiData.translation || '';
      const explanation = aiData.explanation || '';
      const exampleSentence = aiData.exampleSentence || (aiData.examples && aiData.examples[0] ? aiData.examples[0].sentence : '');
      const exampleTranslation = aiData.exampleTranslation || (aiData.examples && aiData.examples[0] ? aiData.examples[0].translation : '');
      const synonyms = aiData.synonyms ? JSON.stringify(aiData.synonyms) : null;
      const examples = aiData.examples && aiData.examples.length > 0 ? JSON.stringify(aiData.examples) : null;

      const sql = `
        UPDATE subtitles
        SET 
          translation = $1,
          explanation = $2,
          example_sentence = $3,
          example_translation = $4,
          key_phrase = COALESCE($5, key_phrase),
          phrase_translation = COALESCE($6, phrase_translation),
          synonyms = COALESCE($7, synonyms),
          examples = COALESCE($8, examples),
          status = 'translated',
          updated_at = NOW()
        WHERE id = $9
        RETURNING *;
      `;

      const rows = await this.query(sql, [
        translation,
        explanation,
        exampleSentence,
        exampleTranslation,
        keyPhrase,
        phraseTranslation,
        synonyms,
        examples,
        id
      ]);

      return rows.length > 0 ? this.mapRow(rows[0]) : null;
    }

    /**
     * Update an entire subtitle entity (e.g. from Dashboard or Popup Edit).
     * @param {Object} item
     */
    async updateSubtitle(item) {
      if (!item || !item.id) return null;

      const keyPhrase = item.keyPhrase || null;
      const phraseTranslation = item.phraseTranslation || null;
      const synonyms = item.synonyms ? JSON.stringify(item.synonyms) : null;
      const examples = item.examples && item.examples.length > 0 ? JSON.stringify(item.examples) : null;

      const sql = `
        UPDATE subtitles
        SET 
          text = $1,
          translation = $2,
          explanation = $3,
          example_sentence = $4,
          example_translation = $5,
          key_phrase = $6,
          phrase_translation = $7,
          synonyms = $8,
          examples = $9,
          video_title = $10,
          is_favorite = $11,
          status = $12,
          updated_at = NOW()
        WHERE id = $13
        RETURNING *;
      `;

      const rows = await this.query(sql, [
        item.text || '',
        item.translation || '',
        item.explanation || '',
        item.exampleSentence || '',
        item.exampleTranslation || '',
        keyPhrase,
        phraseTranslation,
        synonyms,
        examples,
        item.videoTitle || 'YouTube Video',
        Boolean(item.isFavorite),
        item.status || (item.translation ? 'translated' : 'pending'),
        item.id
      ]);

      return rows.length > 0 ? this.mapRow(rows[0]) : null;
    }

    /**
     * Toggle favorite flag for a subtitle.
     * @param {string} id
     * @param {boolean} isFavorite
     */
    async setFavorite(id, isFavorite) {
      const sql = `
        UPDATE subtitles
        SET is_favorite = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *;
      `;
      const rows = await this.query(sql, [Boolean(isFavorite), id]);
      return this.mapRow(rows[0]);
    }

    /**
     * Delete a subtitle by ID.
     * @param {string} id
     */
    async deleteSubtitle(id) {
      const sql = `DELETE FROM subtitles WHERE id = $1 RETURNING id;`;
      const rows = await this.query(sql, [id]);
      return rows.length > 0;
    }

    /**
     * Delete multiple subtitles by IDs in batch.
     * @param {string[]} ids
     */
    async deleteSubtitles(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return true;
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const sql = `DELETE FROM subtitles WHERE id IN (${placeholders}) RETURNING id;`;
      const rows = await this.query(sql, ids);
      return rows.length > 0;
    }

    /**
     * Clear all subtitles from Neon database.
     */
    async clearAllSubtitles() {
      const sql = `DELETE FROM subtitles;`;
      await this.query(sql);
      return true;
    }

    /**
     * Check connection health to Neon database.
     */
    async checkHealth() {
      try {
        const rows = await this.query(`SELECT 1 as alive;`);
        const isAlive = rows.length > 0 && rows[0].alive == 1;
        return {
          ok: isAlive,
          projectId: this.projectId,
          branch: this.branch,
          host: this.host
        };
      } catch (err) {
        return {
          ok: false,
          error: err.message,
          projectId: this.projectId,
          branch: this.branch,
          host: this.host
        };
      }
    }
  }

  return new NeonStorageClient();
});
