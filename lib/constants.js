/**
 * YouTube Subtitle Click & Copy - Global Constants & Configuration
 * Supports Browser (Window), Chrome Extension Service Worker (self), and Node.js (CommonJS).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.APP_CONSTANTS = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NEON_CONFIG = {
    DEFAULT_DB_URL: 'postgresql://neondb_owner:YOUR_PASSWORD_HERE@ep-super-cake-az82uvk1-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    PROJECT_ID: 'wild-band-00612836',
    BRANCH: 'production',
    DEFAULT_HOST: 'ep-super-cake-az82uvk1-pooler.c-3.ap-southeast-1.aws.neon.tech',
    MAX_FETCH_LIMIT: 500,
    POPUP_FETCH_LIMIT: 30
  };

  const AI_PROVIDERS = {
    NINE_ROUTER: 'nine_router'
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    copyMode: 'full', // 'full' (entire caption line/sentence) or 'segment' (clicked word/phrase)
    autoPause: false, // Automatically pause video when caption is clicked
    showToast: true, // Display floating toast notification on YouTube player
    showHighlight: true, // Pulse flash animation on clicked subtitle segment
    copyHistory: [],

    // AI Translation Configuration (9Router AI Gateway)
    aiProvider: AI_PROVIDERS.NINE_ROUTER,
    nineRouterBaseUrl: 'http://localhost:20128/v1',
    nineRouterApiKey: '',
    nineRouterModel: 'ag/gemini-3.8-flash-low',
    aiConcurrency: 4,
    autoAiTranslate: false,

    // Neon Postgres Configuration
    neonDatabaseUrl: '',
    neonProjectId: NEON_CONFIG.PROJECT_ID,
    neonBranch: NEON_CONFIG.BRANCH
  };

  const STORAGE_KEYS = {
    SETTINGS: Object.keys(DEFAULT_SETTINGS),
    COPY_HISTORY: 'copyHistory',
    ENABLED: 'enabled',
    COPY_MODE: 'copyMode',
    AUTO_PAUSE: 'autoPause',
    SHOW_TOAST: 'showToast',
    SHOW_HIGHLIGHT: 'showHighlight',
    AI_PROVIDER: 'aiProvider',
    NEON_DB_URL: 'neonDatabaseUrl'
  };

  const YOUTUBE_SELECTORS = {
    CAPTION_SEGMENT: '.ytp-caption-segment',
    CAPTION_CONTAINER: '.ytp-caption-segment, .caption-window, .ytp-caption-window-bottom, .ytp-caption-window-rollup, .captions-text',
    PLAYER: '#movie_player, .html5-video-player, ytd-player',
    VIDEO: 'video.html5-main-video, video',
    TITLE: 'h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title, .ytp-title-link'
  };

  const MESSAGES = {
    OPEN_DASHBOARD: 'openDashboard',
    NEON_QUERY: 'neon_query',
    NEON_SAVE_SUBTITLE: 'neon_saveSubtitle',
    NEON_UPDATE_SUBTITLE: 'neon_updateSubtitle',
    NEON_DELETE_SUBTITLE: 'neon_deleteSubtitle',
    NEON_DELETE_SUBTITLES: 'neon_deleteSubtitles',
    NEON_CLEAR_ALL: 'neon_clearAllSubtitles',
    TRANSLATE_TEXT: 'translateText',
    SHOW_TOAST: 'showToast',
    CAPTURE_CURRENT_SUBTITLE: 'captureCurrentSubtitle'
  };

  return Object.freeze({
    NEON_CONFIG,
    AI_PROVIDERS,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    YOUTUBE_SELECTORS,
    MESSAGES
  });
});
