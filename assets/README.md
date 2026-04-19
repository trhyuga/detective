# assets

雪嶺の二重奏 の画像・音声素材。Gemini などで生成したファイルを以下の命名規約で配置する。

```
assets/
├─ images/
│  ├─ bg/         背景画像（9:16, スマホ縦想定）
│  ├─ characters/ 立ち絵（背景白単色, 2:3, 表情違い）
│  └─ misc/       回想・UI挿絵など
└─ audio/
   ├─ bgm/        BGM ループ
   └─ se/         効果音
```

- 現時点のゲームはアセットを参照していない。素材を置いたら `scenario.js` 内の
  各シーンに `bgImage`・`bgm`・`se` などのキーを追加して割り当てる拡張予定。
- ファイル名はすべて半角英数・ハイフン区切り推奨（例：`bg-exterior-arrival.webp`）。
