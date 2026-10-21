# 画面・入力項目識別子台帳

この文書に記載した識別子は、画面表示名や配置に依存しない恒久的な管理キーです。文言・デザイン・並び順が変わっても、同じ役割の画面・入力項目・ダイアログには原則として同じ識別子を使います。識別子は表内およびアプリ全体で重複させません。

新しい画面、入力項目、ダイアログを追加するときは、実装へ一意の `data-screen-id`・`data-field-id`・`data-dialog-id` を付け、この台帳にも用途と対応HTML IDを登録してください。役割が変わるなど既存キーを維持できない場合は、新しい識別子を追加し、この台帳を更新してください。

現在画面の識別子は、表示中の状態に応じて `main[data-screen-id]` に設定します。朗読用の `#reading` は本文朗読と時間計測で共用し、計測フェーズごとに画面識別子を切り替えます。結果画面は選択中のタブを識別します。フッターが表示されている画面では「よみじたく」をクリックまたはキーボード操作すると、この識別子をコピーできます。

## 画面

| 識別子 | 画面名 | 用途 | 対応HTML ID・画面状態 |
| --- | --- | --- | --- |
| `SCR-HOME` | ホーム | 2つの機能入口 | `#home` |
| `SCR-READ-INPUT` | 文章を読む：本文入力 | 朗読する文章と原稿ファイルを指定 | `#read-input` |
| `SCR-READ-VIEW` | 文章を読む：朗読画面 | 本文を表示・書き込み | `#reading`、`mode=read` |
| `SCR-TIME-INPUT` | 朗読時間を調べる：入力 | 計測元・本文・条件を指定 | `#time-input` |
| `SCR-TIME-PREP` | 計測準備 | 本文確認と計測条件を準備 | `#reading`、`mode=time` かつ `phase=idle` |
| `SCR-TIME-COUNTDOWN` | カウントダウン | 計測開始までのカウント | `#reading`、`mode=time` かつ `phase=countdown` |
| `SCR-TIME-RUN` | 計測中 | 朗読時間を計測 | `#reading`、`mode=time` かつ `phase=running` |
| `SCR-RESULT-TIME` | 計測結果：朗読時間 | 作品全体の推定時間を表示 | `#results`、朗読時間タブ選択中 |
| `SCR-RESULT-SPEED` | 計測結果：朗読速度 | 時間あたりの推定文字数を表示 | `#results`、朗読速度タブ選択中 |

## 入力項目

| 識別子 | 用途 | 対応HTML ID・セレクター |
| --- | --- | --- |
| `FLD-READ-BODY` | 朗読する本文 | `#read-text` |
| `FLD-READ-MANUSCRIPT-FILE` | 原稿JSONファイル | `#manuscript-file` |
| `FLD-TIME-SOURCE-SAMPLE` | 例文を計測元に選択 | `[name=source][value=sample]` |
| `FLD-TIME-SOURCE-CUSTOM` | 自分の文章を計測元に選択 | `[name=source][value=custom]` |
| `FLD-TIME-SAMPLE-LENGTH` | 例文の長さ | `#sample-level` |
| `FLD-TIME-SAMPLE-MOOD` | 例文の雰囲気 | `#sample-mood` |
| `FLD-TIME-BODY` | 計測する本文 | `#time-text` |
| `FLD-TIME-PARTIAL-ENABLED` | 入力画面で冒頭計測を有効化 | `#partial-enabled` |
| `FLD-TIME-PARTIAL-LIMIT` | 入力画面で読む文字数の目安 | `#partial-limit` |
| `FLD-TIME-TARGET` | 作品全体の文字数（入力画面） | `#target-count` |
| `FLD-PREP-PARTIAL-ENABLED` | 計測準備画面で冒頭計測を有効化 | `#preparation-partial-enabled` |
| `FLD-PREP-PARTIAL-LIMIT` | 計測準備画面で読む文字数の目安 | `#preparation-partial-limit` |
| `FLD-PREP-TARGET` | 作品全体の文字数（計測準備画面） | `#preparation-target` |
| `FLD-RESULT-TARGET` | 作品全体の文字数（結果画面） | `#result-target` |
| `FLD-RESULT-PLANNED-MINUTES` | 予定朗読時間 | `#planned-minutes` |
| `FLD-SETTINGS-READER-WIDTH` | 本文表示幅 | `#reader-width` |
| `FLD-SETTINGS-COLUMNS` | 1行の文字数目安 | `#columns` |
| `FLD-SETTINGS-LINE-HEIGHT` | 行間 | `#line-height` |
| `FLD-SETTINGS-BREAK-LINES` | 自動区切りの表示行数 | `#break-lines` |
| `FLD-RUBY-TEXT` | 読み仮名の本文 | `#ruby-input` |
| `FLD-MEMO-FONT-SIZE` | 全メモ共通の文字サイズ | `#memo-font-size` |
| `FLD-MEMO-OPACITY` | 全メモ共通の不透明度 | `#memo-opacity` |
| `FLD-MEMO-TEXT` | 文字メモ本文 | `#writing-memo-input` |

## ダイアログ

| 識別子 | 用途 | 対応HTML ID |
| --- | --- | --- |
| `DLG-SETTINGS` | 表示設定 | `#settings-dialog` |
| `DLG-PDF` | PDF出力案内 | `#pdf-dialog` |
| `DLG-RUBY` | 読み仮名の追加・編集 | `#ruby-dialog` |
| `DLG-MEMO-SETTINGS` | 全メモ共通設定 | `#memo-settings-dialog` |
| `DLG-MEMO` | 文字メモの追加・編集 | `#writing-memo-dialog` |
| `DLG-SAVE-NAVIGATION` | 原稿保存・画面移動の確認 | `#save-navigation-dialog` |
| `DLG-CONFIRM` | 汎用操作確認 | `#confirm-dialog` |
