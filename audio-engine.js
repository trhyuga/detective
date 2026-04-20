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
        right: calc(7em + env(safe-area-inset-right));
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
          top: calc(3.6em + env(safe-area-inset-top));
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

  // 元データの音量が弱い SE を個別に増幅する係数
  // 1.0 基準。HTML Audio は volume の上限が 1.0 なので、それ以上は
  // WebAudio の GainNode で底上げする。
  const SE_GAIN = {
    fireplace: 2.8,   // 薪爆ぜが元から小さめ
    heartbeat: 1.3,
    clock: 1.2
  };

  // 「効果音扱いだが尺が長い」キー。章代わりや場所移動でブツッと残ると
  // 違和感があるので、シーン切り替え時にフェードアウトで切り落とす。
  const LONG_SE_KEYS = { blizzard: true, fireplace: true };
  let lastLongSeEl = null;
  let lastLongSeKey = null;
  let lastSceneBg = null;

  function stopLongSe(fadeMs) {
    if (!lastLongSeEl) { lastLongSeKey = null; return; }
    const old = lastLongSeEl;
    lastLongSeEl = null;
    lastLongSeKey = null;
    const ms = fadeMs || 500;
    let t = 0;
    const start = old.volume;
    const fade = setInterval(() => {
      t += 60;
      old.volume = Math.max(0, start * (1 - t / ms));
      if (t >= ms) {
        clearInterval(fade);
        try { old.pause(); old.src = ''; } catch (e) {}
      }
    }, 60);
  }

  let audioCtx = null;
  function getAudioContext() {
    if (audioCtx) return audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) {
      console.warn('[audio] AudioContext unavailable:', e);
    }
    return audioCtx;
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
    // 長尺 SE は前のものを切ってから鳴らす（同キーなら重ねない）
    const isLong = !!LONG_SE_KEYS[key];
    if (isLong) {
      if (lastLongSeKey === key && lastLongSeEl) return;
      stopLongSe(300);
    }
    const gain = SE_GAIN[key] || 1;
    const baseVol = state.seVolume;
    const a = new Audio(url);
    const rememberLong = () => {
      if (!isLong) return;
      lastLongSeEl = a;
      lastLongSeKey = key;
      a.addEventListener('ended', () => {
        if (lastLongSeEl === a) { lastLongSeEl = null; lastLongSeKey = null; }
      });
    };
    // 1.0 以下なら HTML audio の volume だけで済ます
    if (gain <= 1) {
      a.volume = Math.min(1, baseVol * gain);
      a.play().catch(() => {});
      rememberLong();
      return;
    }
    // 1.0 を超える増幅は WebAudio の GainNode で
    const ctx = getAudioContext();
    if (!ctx) {
      // フォールバック：volume を 1.0 にクランプして再生
      a.volume = Math.min(1, baseVol * gain);
      a.play().catch(() => {});
      rememberLong();
      return;
    }
    a.crossOrigin = 'anonymous';
    a.volume = 1.0;
    // MediaElement 経由で gain を掛ける
    try {
      const src = ctx.createMediaElementSource(a);
      const g = ctx.createGain();
      g.gain.value = baseVol * gain;
      src.connect(g).connect(ctx.destination);
      a.play().catch(() => {});
    } catch (e) {
      // 2 回目以降の createMediaElementSource は同じ element では呼べない等、
      // 失敗したらシンプル再生にフォールバック
      a.volume = Math.min(1, baseVol * gain);
      a.play().catch(() => {});
    }
    rememberLong();
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
      if (state.pendingAmbient) {
        const k = state.pendingAmbient;
        state.pendingAmbient = null;
        playAmbient(k);
      }
      ['click', 'touchstart', 'keydown'].forEach(ev =>
        document.removeEventListener(ev, handler, true)
      );
    };
    ['click', 'touchstart', 'keydown'].forEach(ev =>
      document.addEventListener(ev, handler, true)
    );
  }

  // ---- シーン切替フック（inline goToScene から呼ばれる） ----
  function onScene(scene) {
    if (!scene) return;
    try {
      // 章代わり or 場所移動で、前シーンから引きずってる長尺 SE／環境音を一旦切る。
      // 新シーンが同じキーを明示的に指定している場合だけ継続させる。
      const chapterChange = !!scene.chapter;
      const bgChanged = scene.bg !== undefined && scene.bg !== lastSceneBg;
      if (chapterChange || bgChanged) {
        const keepingLongSe = scene.se && LONG_SE_KEYS[scene.se] && scene.se === lastLongSeKey;
        if (!keepingLongSe) stopLongSe(400);
        // 環境音（ループ）は scene.ambient が未指定でも章またぎで切る。
        // 新シーンが同じ ambient を明示指定していれば playAmbient 側の同キー判定に任せる。
        const keepingAmbient = scene.ambient && scene.ambient !== 'stop' && scene.ambient === ambientKey;
        if (!keepingAmbient) stopAmbient(500);
      }
      if (scene.bg !== undefined) lastSceneBg = scene.bg;

      let bgmKey = scene.bgm;
      if (!bgmKey && scene.bg) bgmKey = BG_TO_BGM[scene.bg];
      if (bgmKey) playBgm(bgmKey);
      if (scene.se) playSe(scene.se);
      // 環境音（ループSE）。scene.ambient = 'fireplace' / 'blizzard' / null / 'stop'
      if (Object.prototype.hasOwnProperty.call(scene, 'ambient')) {
        if (scene.ambient && scene.ambient !== 'stop') {
          playAmbient(scene.ambient);
        } else {
          stopAmbient();
        }
      }
    } catch (e) {
      console.warn('[audio] onScene error:', e);
    }
  }

  // ---- 環境音（ループ SE）制御 ----
  let ambientEl = null;
  let ambientKey = null;
  function playAmbient(key) {
    if (!key) return;
    if (state.muted) return;
    if (!state.interacted) { state.pendingAmbient = key; return; }
    if (ambientKey === key && ambientEl) return; // 既に同じ環境音
    stopAmbient(400);
    const url = SE_FILES[key];
    if (!url) { console.warn('[audio] unknown ambient key:', key); return; }
    const gain = SE_GAIN[key] || 1;
    const baseVol = state.seVolume * 0.55;
    const a = new Audio(url);
    a.loop = true;
    a.volume = 0;
    a.play().catch(() => {});
    const target = Math.min(1, baseVol * gain);
    let t = 0;
    const fade = setInterval(() => {
      t += 0.08;
      const f = Math.min(1, t);
      a.volume = f * target;
      if (f >= 1) clearInterval(fade);
    }, 80);
    ambientEl = a;
    ambientKey = key;
  }
  function stopAmbient(fadeMs) {
    if (!ambientEl) { ambientKey = null; return; }
    const old = ambientEl;
    ambientEl = null;
    ambientKey = null;
    const ms = fadeMs || 600;
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

  // 行単位で背景が変わった時用：場所移動なら長尺 SE／環境音を切り落とす
  function onBgChange(bg, lineSe, lineAmbient) {
    if (bg === undefined || bg === null) return;
    if (bg === lastSceneBg) return;
    const keepingLongSe = lineSe && LONG_SE_KEYS[lineSe] && lineSe === lastLongSeKey;
    if (!keepingLongSe) stopLongSe(400);
    const keepingAmbient = lineAmbient && lineAmbient !== 'stop' && lineAmbient === ambientKey;
    if (!keepingAmbient) stopAmbient(500);
    lastSceneBg = bg;
  }

  // ---- 公開 API ----
  window.audioEngine = {
    playBgm,
    stopBgm,
    playSe,
    playAmbient,
    stopAmbient,
    toggleMute,
    isMuted: () => state.muted,
    onScene,  // inline goToScene が呼ぶ
    onBgChange  // showLine が line.bg 差し替え時に呼ぶ
  };

  // ---- 初期化 ----
  function init() {
    try { loadPrefs(); } catch (e) { console.warn('[audio] loadPrefs:', e); }
    try { setupUI(); } catch (e) { console.warn('[audio] setupUI:', e); }
    try { setupFirstInteraction(); } catch (e) { console.warn('[audio] setupFI:', e); }
    try { hookEndingHandlers(); } catch (e) { console.warn('[audio] hookEnd:', e); }
    console.log('[audio] engine ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
