/**
 * AF English - Netflix Injected Script (Runs in page context: MAIN world)
 * Intercepts Netflix manifest and metadata requests to capture direct subtitle URLs,
 * video metadata (movie/show title, season, episode), and communicates with content script.
 */

(function () {
  'use strict';

  if (window.__afNetflixInjected) return;
  window.__afNetflixInjected = true;

  const MANIFEST_PATTERN = /manifest|licensedManifest/i;
  const METADATA_PATTERN = /\/metadata\?/i;

  const ALL_FORMATS = ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'imsc1.1', 'simplesdh'];

  let activeVideoData = {
    movieId: null,
    title: '',
    episodeTitle: '',
    season: null,
    episode: null,
    isSeries: false,
    tracks: []
  };

  /**
   * Dispatch structured event to isolated content script.
   */
  function dispatchToContent(type, data) {
    try {
      window.dispatchEvent(new CustomEvent('af_netflix_bridge_event', {
        detail: { type, data }
      }));
    } catch (e) {
      console.warn('[AF Netflix Injected] Dispatch error:', e);
    }
  }

  /**
   * Process and normalize subtitle tracks from Netflix manifest.
   */
  function processManifestTracks(manifestResult) {
    if (!manifestResult) return;
    const rawTracks = manifestResult.timedtexttracks || manifestResult.textTracks;
    if (!Array.isArray(rawTracks) || rawTracks.length === 0) return;

    const movieId = manifestResult.movieId;
    if (movieId) activeVideoData.movieId = movieId;

    const parsedTracks = [];

    for (const track of rawTracks) {
      if (track.isNoneTrack) continue;

      const lang = track.language || track.bcp47 || 'unknown';
      const label = track.label || track.displayName || lang;
      const isCC = track.rawTrackType === 'closedcaptions' || Boolean(track.isClosedCaptions);
      const isForced = Boolean(track.isForcedNarrative);

      // Find best available format: prioritize WebVTT, then DFXP/XML
      let downloadUrl = null;
      let format = null;

      const downloadables = track.ttDownloadables || track.downloadables;
      if (downloadables) {
        for (const fmt of ALL_FORMATS) {
          const item = downloadables[fmt];
          if (item) {
            if (item.downloadUrls) {
              const urls = Object.values(item.downloadUrls);
              if (urls.length > 0) {
                downloadUrl = urls[0];
                format = fmt;
                break;
              }
            } else if (Array.isArray(item.urls) && item.urls.length > 0) {
              downloadUrl = item.urls[0].url || item.urls[0];
              format = fmt;
              break;
            }
          }
        }
      }

      if (downloadUrl) {
        parsedTracks.push({
          language: lang,
          label: label,
          isEnglish: lang.toLowerCase().startsWith('en'),
          isClosedCaptions: isCC,
          isForced: isForced,
          downloadUrl: downloadUrl,
          format: format
        });
      }
    }

    if (parsedTracks.length > 0) {
      activeVideoData.tracks = parsedTracks;
      // Notify content script
      dispatchToContent('tracks_ready', {
        movieId: activeVideoData.movieId,
        title: activeVideoData.title,
        tracks: parsedTracks
      });
    }
  }

  /**
   * Process metadata response for show/movie titles.
   */
  function processMetadata(data) {
    if (!data || !data.video) return;
    const v = data.video;
    activeVideoData.title = v.title || document.title.replace(' - Netflix', '').trim();
    activeVideoData.isSeries = v.type === 'show';

    if (activeVideoData.isSeries && Array.isArray(v.seasons)) {
      for (const season of v.seasons) {
        if (Array.isArray(season.episodes)) {
          for (const ep of season.episodes) {
            if (ep.id === v.currentEpisode) {
              activeVideoData.season = season.seq;
              activeVideoData.episode = ep.seq;
              activeVideoData.episodeTitle = ep.title || '';
              break;
            }
          }
        }
      }
    }

    dispatchToContent('metadata_ready', {
      movieId: v.id || v.currentEpisode,
      title: activeVideoData.title,
      season: activeVideoData.season,
      episode: activeVideoData.episode,
      episodeTitle: activeVideoData.episodeTitle,
      isSeries: activeVideoData.isSeries
    });
  }

  /**
   * Intercept JSON.parse & fetch & XMLHttpRequest
   */
  (function (origParse, origFetch, origOpen) {
    // 1. Intercept JSON.parse
    JSON.parse = function (text) {
      const data = origParse.apply(this, arguments);
      try {
        if (data && data.result && (data.result.timedtexttracks || data.result.textTracks)) {
          processManifestTracks(data.result);
        }
      } catch (e) {}
      return data;
    };

    // 2. Intercept fetch for /metadata and /manifest
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (METADATA_PATTERN.test(url)) {
          const clone = res.clone();
          clone.json().then(processMetadata).catch(() => {});
        } else if (MANIFEST_PATTERN.test(url)) {
          const clone = res.clone();
          clone.json().then((d) => {
            if (d && d.result) processManifestTracks(d.result);
          }).catch(() => {});
        }
      } catch (e) {}
      return res;
    };

    // 3. Intercept XMLHttpRequest
    XMLHttpRequest.prototype.open = function (...args) {
      const url = args[1];
      if (typeof url === 'string') {
        if (METADATA_PATTERN.test(url) || MANIFEST_PATTERN.test(url)) {
          this.addEventListener('load', function () {
            try {
              let resp = this.response;
              if (typeof resp === 'string') resp = origParse(resp);
              if (resp) {
                if (METADATA_PATTERN.test(url)) processMetadata(resp);
                if (MANIFEST_PATTERN.test(url) && resp.result) processManifestTracks(resp.result);
              }
            } catch (e) {}
          }, false);
        }
      }
      return origOpen.apply(this, args);
    };
  })(JSON.parse, window.fetch, XMLHttpRequest.prototype.open);

  /**
   * Direct Player API Polling Fallback
   */
  function checkPlayerAPI() {
    try {
      const playerApp = window.netflix?.appContext?.state?.playerApp;
      if (!playerApp) return;

      const api = playerApp.getAPI?.();
      if (!api) return;

      const videoPlayer = api.videoPlayer;
      if (!videoPlayer) return;

      const sessionIds = videoPlayer.getAllPlayerSessionIds?.();
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) return;

      const player = videoPlayer.getVideoPlayerBySessionId(sessionIds[0]);
      if (!player) return;

      const movieId = player.getMovieId?.();
      if (movieId && !activeVideoData.movieId) {
        activeVideoData.movieId = movieId;
      }

      // Check tracks
      const tracks = player.getTimedTextTrackList?.();
      if (Array.isArray(tracks) && tracks.length > 0 && activeVideoData.tracks.length === 0) {
        // Player API gives track metadata (language, label)
        // If download URLs were captured via manifest, merge them
      }
    } catch (e) {}
  }

  setInterval(checkPlayerAPI, 3000);

  // Listen for request from content script
  window.addEventListener('af_netflix_request_info', () => {
    checkPlayerAPI();
    dispatchToContent('tracks_ready', {
      movieId: activeVideoData.movieId,
      title: activeVideoData.title || document.title.replace(' - Netflix', '').trim(),
      season: activeVideoData.season,
      episode: activeVideoData.episode,
      episodeTitle: activeVideoData.episodeTitle,
      tracks: activeVideoData.tracks
    });
  });

  // Listen for seek command from content script
  window.addEventListener('af_netflix_seek', (e) => {
    try {
      const seconds = Number(e.detail && e.detail.seconds);
      if (isNaN(seconds) || seconds < 0) return;

      const playerApp = window.netflix?.appContext?.state?.playerApp;
      const sessionIds = playerApp?.getAPI?.()?.videoPlayer?.getAllPlayerSessionIds?.();
      if (sessionIds && sessionIds.length > 0) {
        const player = playerApp.getAPI().videoPlayer.getVideoPlayerBySessionId(sessionIds[0]);
        if (player && typeof player.seek === 'function') {
          player.seek(seconds * 1000);
        }
      }
    } catch (err) {}
  });

  console.log('[AF English] Netflix Injected Script successfully loaded');
})();
