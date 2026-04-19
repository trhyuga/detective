// ==========================================================================
// audio-engine.js — 雪嶺の二重奏 サウンドモジュール
//
// 役割：
//  - 既存の goToScene(key) をラップし、シーンごとに BGM/SE を自動切替
//  - シーン側オーバーライド: scene.bgm = 'true'  / scene.se = 'door'
//  - bg クラスからのデフォルトマッピング (BG_TO_BGM)
//  - ブラウザ自動再生ポリシーに対応：最初のユーザ操作までは pending
//  - ミュートボタン UI（右上、HUD 隣に挿入）
//  - 設定は localStorage 'setsurei_audio' に保存
//
// この場所のグローバル: scenes / goToScene / showFin が同一ページ内で
// 既に定義されている前提（scenario.js + index.html 内の inline script）。
// 本ファイルは <script src="audio-engine.js" defer></script> で
// scenario.js の直後に置く。
// ==========================================================================
(function () {
  'use strict';

  const STORAGE_KEY = 'setsurei_audio';
  const BGM_DIR = 'assets/audio/bgm/';
  const SE_DIR = 'assets/audio/se/';

  // ---- ファイル定義 ----
  const BGM_FILES = {
    main:      BGM_DIR + 'bgm-main.mp3',       // タイトル
    main2:     BGM_DIR + 'bgm-main2.mp3',      // 最終回タイトル
    daily:     BGM_DIR + 'bgm-daily.mp3',      // 日常
    tension:   BGM_DIR + 'bgm-tension.mp3',    // 不穏
    shock:     BGM_DIR + 'bgm-shock.mp3',      // 事件発生
    deduce:    BGM_DIR + 'bgm-deduce.mp3',     // 推理
    accuse:    BGM_DIR + 'bgm-accuse.mp3',     // 告発
    flashback: BGM_DIR + 'bgm-flashback.mp3',  // 回想
    bad:       BGM_DIR + 'bgm-bad.mp3',        // バッドエンド
    true:      BGM_DIR + 'bgm-true.mp3',       // 真相
    dawn:      BGM_DIR + 'bgm-dawn.mp3'        // 雪解け
  };

  const SE_FILES = {
    bell:      SE_DIR + 'se-bell.mp3',
    blizzard:  SE_DIR + 'se-blizzard.mp3',
    break:     SE_DIR + 'se-break.mp3',
    clock:     SE_DIR + 'se-clock.mp3',
    door:      SE_DIR + 'se-door.mp3',
    fireplace: SE_DIR + 'se-fireplace.mp3',
    footstep:  SE_DIR + 'se-footstep.mp3',
    heartbeat: SE_DIR + 'se-heartbeat.mp3',
    phone:     SE_DIR + 'se-phone-noise.mp3',
    snow:      SE_DIR + 'se-snow.mp3'
  };

  // ---- bg クラスからの BGM デフォルトマップ ----
  const BG_TO_BGM = {
    exterior:     'daily',
    dining:       'daily',
    hall:         'daily',
    corridor:     'tension',
    bedroom:      'tension',
    study:        'tension',
    'study-body': 'shock',
    cellar:       'bad',
    courtyard:    'bad',
    salon:        'daily',
    accuse:       'accuse',
    flashback:    'flashback',
    dawn:         'dawn'
  };

  // ---- 状態 ----
  const state = {
    bgmEl: null,
    currentBgm: null,
    pendingBgm: null,
    pendingSe: null,
    interacted: false,
    muted: false,
    bgmVolume: 0.42,
    seVolume: 0.7
  };

  // ---- 設定の永続化 ----
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (typeof obj.muted === 'boolean') state.muted = obj.muted;
    } catch (e) { /* ignore */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: state.muted }));
    } catch (e) { /* ignore */ }
  }

  // ---- ミュートボタン UI ----
  function setupUI() {
    const css = document.createElement('style');
    css.textContent = `
      #audio-mute-btn {
        position: absolute;
        top: calc(0.6em + env(safe-area-inset-top));
        right: calc(5.4em + env(safe-area-inset-right));
        z-index: 17;
        background: rgba(5, 8, 16, 0.65);
        border: 1px solid rgba(184, 153, 104, 0.3);
        color: #b89968;
        font-family: inherit;
        font-size: 0.75rem;
        letter-spacing: 0.15em;
        padding: 0.4em 0.7em;
        cursor: pointer;
        border-radius: 2px;
        min-height: 2.2em;
        min-width: 2.4em;
        transition: background-color 0.2s, color 0.2s, border-color 0.2s;
      }
      #audio-mute-btn:active {
        background: rgba(184, 153, 104, 0.25);
        transform: scale(0.96);
      }
      @media (hover: hover) {
        #audio-mute-btn:hover {
          color: #c9593a;
          border-color: #c9593a;
        }
      }
      @media (max-width: 520px) {
        #audio-mute-btn {
          right: calc(0.6em + env(safe-area-inset-right));
          top: calc(3em + env(safe-area-inset-top));
        }
      }
    `;
    document.head.appendChild(css);

    const btn = document.createElement('button');
    btn.id = 'audio-mute-btn';
    btn.title = '音声 ON/OFF';
    btn.textContent = state.muted ? '♪OFF' : '♪ON';
    btn.addEventListener('click', toggleMute);
    document.body.appendChild(btn);
  }

  function toggleMute() {
    state.muted = !state.muted;
    savePrefs();
    const btn = document.getElementById('audio-mute-btn');
    if (btn) btn.textContent = state.muted ? '♪OFF' : '♪ON';
    if (state.bgmEl) state.bgmEl.muted = state.muted;
  }

  // ---- BGM 切替（クロスフェード） ----
  function playBgm(key) {
    if (!key || state.currentBgm === key) return;
    if (!state.interacted) {
      state.pendingBgm = key;
      return;
    }
    const url = BGM_FILES[key];
    if (!url) {
      console.warn('[audio] unknown BGM key:', key);
      return;
    }
    const old = state.bgmEl;
    const next = new Audio(url);
    next.loop = true;
    next.volume = 0;
    next.muted = state.muted;
    next.play().catch(err => {
      console.warn('[audio] BGM play failed:', err.message);
    });

    let t = 0;
    const target = state.bgmVolume;
    const step = 0.08;
    const fade = setInterval(() => {
      t += step;
      const f = Math.min(1, t);
      next.volume = f * target;
      if (old) old.volume = (1 - f) * target;
      if (f >= 1) {
        clearInterval(fade);
        if (old) {
          try { old.pause(); old.src = ''; } catch (e) {}
        }
      }
    }, 80);

    state.bgmEl = next;
    state.currentBgm = key;
  }

  function stopBgm(fadeMs) {
    if (!state.bgmEl) return;
    const old = state.bgmEl;
    state.bgmEl = null;
    state.currentBgm = null;
    const ms = fadeMs || 1200;
    let t = 0;
    const start = old.volume;
    const fade = setInterval(() => {
      t += 80;
      old.volume = Math.max(0, start * (1 - t / ms));
      if (t >= ms) {
        clearInterval(fade);
        try { old.pause(); old.src = ''; } catch (e) {}
      }
    }, 80);
  }

  // ---- SE 一発再生 ----
  function playSe(key) {
    if (!key) return;
    if (state.muted) return;
    if (!state.interacted) {
      state.pendingSe = key;
      return;
    }
    const url = SE_FILES[key];
    if (!url) {
      console.warn('[audio] unknown SE key:', key);
      return;
    }
    const a = new Audio(url);
    a.volume = state.seVolume;
    a.play().catch(() => { /* ignored */ });
  }

  // ---- 初回ユーザ操作で pending を流す ----
  function setupFirstInteraction() {
    const handler = () => {
      if (state.interacted) return;
      state.interacted = true;
      if (state.pendingBgm) {
        const k = state.pendingBgm;
        state.pendingBgm = null;
        playBgm(k);
      } else {
        // タイトル画面ならメインテーマを鳴らす
        playBgm('main');
      }
      if (state.pendingSe) {
        const k = state.pendingSe;
        state.pendingSe = null;
        playSe(k);
      }
      ['click', 'touchstart', 'keydown'].forEach(ev =>
        document.removeEventListener(ev, handler, true)
      );
    };
    ['click', 'touchstart', 'keydown'].forEach(ev =>
      document.addEventListener(ev, handler, true)
    );
  }

  // ---- goToScene のフック ----
  function hookGoToScene() {
    if (typeof window.goToScene !== 'function') {
      // 未定義なら少し待ってリトライ（defer 後だが念のため）
      setTimeout(hookGoToScene, 100);
      return;
    }
    const original = window.goToScene;
    window.goToScene = function (key) {
      const result = original.apply(this, arguments);
      try {
        const scene = (typeof scenes !== 'undefined') ? scenes[key] : null;
        if (scene) {
          // BGM 決定：scene.bgm 優先、無ければ bg からデフォルト
          let bgmKey = scene.bgm;
          if (!bgmKey && scene.bg) bgmKey = BG_TO_BGM[scene.bg];
          if (bgmKey) playBgm(bgmKey);
          if (scene.se) playSe(scene.se);
        }
      } catch (e) {
        console.warn('[audio] scene hook error:', e);
      }
      return result;
    };
  }

  // ---- showFin / restart のフック ----
  function hookEndingHandlers() {
    if (typeof window.showFin === 'function') {
      const orig = window.showFin;
      window.showFin = function () {
        stopBgm(2400);
        return orig.apply(this, arguments);
      };
    } else {
      setTimeout(hookEndingHandlers, 200);
    }
  }

  // ---- 公開 API（必要なら手動呼び出し） ----
  window.audioEngine = {
    playBgm,
    stopBgm,
    playSe,
    toggleMute,
    isMuted: () => state.muted
  };

  // ---- 初期化 ----
  function init() {
    try { loadPrefs(); } catch (e) { console.warn('[audio] loadPrefs:', e); }
    try { setupUI(); } catch (e) { console.warn('[audio] setupUI:', e); }
    try { setupFirstInteraction(); } catch (e) { console.warn('[audio] setupFI:', e); }
    try { hookGoToScene(); } catch (e) { console.warn('[audio] hookGoToScene:', e); }
    try { hookEndingHandlers(); } catch (e) { console.warn('[audio] hookEnd:', e); }
    console.log('[audio] engine ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
