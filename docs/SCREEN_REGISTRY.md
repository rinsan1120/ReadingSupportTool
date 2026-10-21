# SCREEN_REGISTRY — 画面・入力項目・ダイアログ識別子台帳

- 対象アプリ：よみじたく（ReadingSupportTool）
- 版：1.0
- 制定日：2026-10-21
- 状態：識別子の仕様確定・台帳登録済み／コードへの反映は別作業
- 対応元：`main` の `index.html` および `app.js`（2026-10-21確認）

## 1. 目的と適用範囲

改修依頼、GitHub Issue、不具合報告、UI/UXレビューにおいて、対象の画面・入力項目・ダイアログを一意に指定できるようにする。

日常会話では自然な画面名を使ってよい。対象が曖昧になる場合や実装指示など、正確な特定が必要なときに本書の識別子を使う。

この台帳は、**管理上の識別子と現行HTML要素の対応表**である。既存のHTML `id`、画面構成、ユーザー向け表示文言を変更する指示ではない。

### 命名・運用規則

- 画面：`SCR-`、入力項目：`FLD-`、ダイアログ：`DLG-` を接頭辞に使用する。
- 識別子には英大文字・数字・ハイフンを使用し、種類をまたいで重複させない。
- 一度割り当てた識別子は、表示文言や並び順が変更されても、同じ役割を指す限り維持する。
- 項目の用途が変わるなど実質的に別物になった場合は、既存識別子の流用を避け、台帳で変更履歴を残す。
- 新しい画面・入力項目・ダイアログを追加するときは、この台帳にも識別子と対応先を登録する。
- HTMLの `id` はプログラム上の既存参照として維持し、管理識別子とは区別する。

## 2. 画面識別子（SCR）

同一のHTML `section` 内でも、利用者に見える状態・用途が異なるものは別画面として管理する。

| 画面ID | 画面名 | 現行HTMLの領域 | 状態の判定 |
| --- | --- | --- | --- |
| `SCR-HOME` | ホーム | `#home` | `view === 'home'` |
| `SCR-READ-INPUT` | 文章を読む：本文入力 | `#read-input` | `view === 'read-input'` |
| `SCR-READ-VIEW` | 文章を読む：朗読画面 | `#reading` | `view === 'reading'` かつ `mode === 'read'` |
| `SCR-TIME-INPUT` | 朗読時間を調べる：入力 | `#time-input` | `view === 'time-input'` |
| `SCR-TIME-PREP` | 計測準備 | `#reading` | `view === 'reading'`、`mode === 'time'`、`phase === 'idle'` |
| `SCR-TIME-COUNTDOWN` | カウントダウン | `#reading` | `view === 'reading'`、`mode === 'time'`、`phase === 'countdown'` |
| `SCR-TIME-RUN` | 時間計測中 | `#reading` | `view === 'reading'`、`mode === 'time'`、`phase === 'running'` |
| `SCR-RESULT-TIME` | 計測結果：朗読時間 | `#results` | `view === 'results'`、朗読時間タブ選択中 |
| `SCR-RESULT-SPEED` | 計測結果：朗読速度 | `#results` | `view === 'results'`、朗読速度タブ選択中 |

### 画面状態に関する補足

- HTML上の主要画面領域は `home`、`read-input`、`time-input`、`reading`、`results` の5つ。画面IDは、利用者に見える状態を区別して9種類とする。
- 計測準備・カウントダウン・計測中は独立したHTMLの `section` ではない。新しい `section` を作成する必要はない。
- 結果画面は `#result-time-tab` と `#result-speed-tab` の選択状態で区別する。
- 表示設定などのダイアログは画面IDとは別に管理する。ダイアログを開いても、その背後の画面IDは変えない。

## 3. 入力項目識別子（FLD）

| 項目ID | 入力項目・用途 | 現行HTML IDまたはセレクター |
| --- | --- | --- |
| `FLD-READ-BODY` | 文章閲覧用の本文 | `#read-text` |
| `FLD-READ-MANUSCRIPT-FILE` | 原稿JSONファイルの選択 | `#manuscript-file` |
| `FLD-TIME-SOURCE-SAMPLE` | 計測元に例文を選ぶ | `input[name="source"][value="sample"]` |
| `FLD-TIME-SOURCE-CUSTOM` | 計測元に自分の文章を選ぶ | `input[name="source"][value="custom"]` |
| `FLD-TIME-SAMPLE-LENGTH` | 例文の長さ | `#sample-level` |
| `FLD-TIME-SAMPLE-MOOD` | 例文の雰囲気 | `#sample-mood` |
| `FLD-TIME-BODY` | 時間計測用の本文 | `#time-text` |
| `FLD-TIME-PARTIAL-ENABLED` | 冒頭のみ計測するか | `#partial-enabled` |
| `FLD-TIME-PARTIAL-LIMIT` | 計測する文字数の目安 | `#partial-limit` |
| `FLD-TIME-TARGET` | 計測入力時の作品全体文字数 | `#target-count` |
| `FLD-PREP-PARTIAL-ENABLED` | 計測準備時の冒頭のみ計測 | `#preparation-partial-enabled` |
| `FLD-PREP-PARTIAL-LIMIT` | 計測準備時の文字数目安 | `#preparation-partial-limit` |
| `FLD-PREP-TARGET` | 計測準備時の作品全体文字数 | `#preparation-target` |
| `FLD-RESULT-TARGET` | 結果画面の作品全体文字数 | `#result-target` |
| `FLD-RESULT-PLANNED-MINUTES` | 結果画面の予定朗読時間 | `#planned-minutes` |
| `FLD-SETTINGS-READER-WIDTH` | 本文の表示幅 | `#reader-width` |
| `FLD-SETTINGS-COLUMNS` | 1行の文字数目安 | `#columns` |
| `FLD-SETTINGS-LINE-HEIGHT` | 行間 | `#line-height` |
| `FLD-SETTINGS-BREAK-LINES` | 自動区切り | `#break-lines` |
| `FLD-RUBY-TEXT` | 読み仮名の入力 | `#ruby-input` |
| `FLD-MEMO-FONT-SIZE` | メモの共通文字サイズ | `#memo-font-size` |
| `FLD-MEMO-OPACITY` | メモの共通不透明度 | `#memo-opacity` |
| `FLD-MEMO-TEXT` | 文字メモの本文 | `#writing-memo-input` |

### 入力項目に関する補足

- `FLD-READ-BODY` と `FLD-TIME-BODY` は、画面上で似た名称でも用途が異なるため、別IDとする。
- 作品全体文字数の入力欄は3か所ある。値が相互に同期されていても、操作対象の位置を区別するため `FLD-TIME-TARGET`、`FLD-PREP-TARGET`、`FLD-RESULT-TARGET` とする。
- 計測元のラジオボタン2つには現行のHTML `id` がないため、`name` と `value` によるセレクターで特定する。台帳作成だけのためにHTML `id` は追加しない。
- 対象は現行の固定入力要素（`input`、`textarea`、`select`）。朗読本文の描画領域、操作ボタン、動的に生成される個々のメモなどはこの表に含めない。

## 4. ダイアログ識別子（DLG）

| ダイアログID | 内容 | 現行HTML ID |
| --- | --- | --- |
| `DLG-SETTINGS` | 表示設定 | `#settings-dialog` |
| `DLG-PDF` | PDF出力の案内 | `#pdf-dialog` |
| `DLG-RUBY` | 読み仮名の追加・編集 | `#ruby-dialog` |
| `DLG-MEMO-SETTINGS` | 文字メモの共通設定 | `#memo-settings-dialog` |
| `DLG-MEMO` | 文字メモの追加・編集 | `#writing-memo-dialog` |
| `DLG-SAVE-NAVIGATION` | 原稿保存・画面移動の確認 | `#save-navigation-dialog` |
| `DLG-CONFIRM` | 操作確認 | `#confirm-dialog` |

## 5. サイト名クリックによる画面IDコピー（採用仕様・未実装）

通常画面のフッターに表示される「よみじたく」のサイト名部分をクリック・タップすると、**現在の画面ID（例：`SCR-READ-INPUT`）のみ**をクリップボードへコピーする。

- コピー成功時は既存の通知UIで「画面IDをコピーしました：SCR-READ-INPUT」のように通知する。
- コピー失敗時は成功扱いにせず、失敗を通知する。
- サイト名はキーボードでも操作できるようにする。
- クリックしても画面遷移しない。
- サイト名・サブタイトル・フッターの見た目は原則として維持する。
- 画面IDを常時表示する、隠し文字を配置する、専用アイコンや設定項目を追加することはしない。
- 現行仕様どおり、`#reading` 表示中はフッターを非表示とする。朗読画面・計測準備・カウントダウン・計測中のためにコピー導線を増設しない。
- 結果画面では、選択中のタブに対応する `SCR-RESULT-TIME` または `SCR-RESULT-SPEED` をコピーする。

コピー機能を使わない場合も、各識別子は台帳を通じて参照可能とする。

## 6. コード反映時の取り扱い

この章は将来の実装時の対応方針であり、**本書の新規作成によって実装されたものではない**。

- 既存HTML `id`・CSSクラス・イベント処理は維持し、画面の識別には `data-screen-id`、入力項目には `data-field-id`、ダイアログには `data-dialog-id` などの追加属性を用いる。
- `#reading` や `#results` のように複数の論理画面を持つ領域では、表示状態の変化に合わせて現在の画面IDを更新する仕組みを設ける。
- 入力値、本文の保持・保存、計測データ、PDF、書き込み、既存の画面遷移は変更しない。
- ユーザーが画面IDを知らなくても通常操作に支障がない状態を維持する。

### 実装状態

2026-10-21の `main` 確認時点では、`index.html` に `data-screen-id`、`data-field-id`、`data-dialog-id` はなく、フッターの画面IDコピー機能も未反映。

**識別子の制定・本台帳の保存と、コードへの属性追加・コピー機能の実装完了は別の状態として扱う。** コード反映後には、この実装状態の記述を更新する。

## 7. 変更履歴

| 日付 | 版 | 変更 |
| --- | --- | --- |
| 2026-10-21 | 1.0 | 画面9件・入力項目23件・ダイアログ7件の識別子、およびフッターからの画面IDコピー仕様を登録 |
