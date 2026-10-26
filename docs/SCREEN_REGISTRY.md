# SCREEN_REGISTRY — 画面・入力項目・ダイアログ識別子台帳

- 対象アプリ：よみじたく（ReadingSupportTool）
- 版：1.3
- 制定日：2026-10-21／最終更新：2026-10-26
- 状態：識別子台帳。従来分の識別属性・画面IDコピーは実装済み。追加入力・ダイアログの識別属性は未付与
- 対応元：`main` の `index.html` と `app.js`（2026-10-26・ユーザーライブラリ統合後を照合）

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

主要HTML領域は `home`、`read-input`、`time-input`、`reading`、`results`、`estimate` の6つ。計測状態の違いを区別した現行の画面IDは11件です。

| 画面ID | 画面名 | 現行HTMLの領域 | 状態の判定 |
| --- | --- | --- | --- |
| `SCR-HOME` | ホーム・本棚 | `#home` | `view === 'home'` |
| `SCR-READ-INPUT` | 原稿の本文入力 | `#read-input` | `view === 'read-input'` |
| `SCR-READ-VIEW` | 原稿画面 | `#reading` | `view === 'reading'`、`mode === 'read'` |
| `SCR-TIME-INPUT` | 朗読速度を測る：入力 | `#time-input` | `view === 'time-input'` |
| `SCR-TIME-PREP` | 計測準備 | `#reading` | `mode === 'time'`、`phase === 'idle'` |
| `SCR-TIME-COUNTDOWN` | 計測開始カウントダウン | `#reading` | `phase === 'countdown'` |
| `SCR-TIME-RUN` | 計測中 | `#reading` | `phase === 'running'` |
| `SCR-TIME-PAUSED` | 一時停止中 | `#reading` | `phase === 'paused'` |
| `SCR-TIME-RESUME-COUNTDOWN` | 計測の再開準備 | `#reading` | `phase === 'resuming'` |
| `SCR-RESULT-TIME` | 計測結果（速度・時間を同時表示） | `#results` | `view === 'results'` |
| `SCR-ESTIMATE` | 朗読時間を見積もる | `#estimate` | `view === 'estimate'` |

### 画面状態と旧識別子

- 計測準備から再開準備までの行は、すべて `view === 'reading'`、`mode === 'time'` を前提とします。同じ `#reading` 領域を状態ごとに区別するもので、独立したHTMLの `section` ではありません。
- **`SCR-RESULT-SPEED` は旧結果画面の速度タブ用の識別子で、現在のコードからは生成されません。**過去のIssue・報告との互換参照として保持し、再利用しません。現在は `SCR-RESULT-TIME` で両方の数値を含む共通結果画面を示します。
- 起動時はホームを無効化した状態で `DLG-STARTUP` を開きます。書込メニューの開閉・ツール切替は `SCR-READ-VIEW` 内の操作状態であり、別画面とはしません。
- 各結果の表示上の切替・計測状態の識別により、既存HTML IDやUI文言を変更する指示ではありません。

## 3. 入力項目識別子（FLD）

| 項目ID | 入力項目・用途 | 現行HTML IDまたはセレクター |
| --- | --- | --- |
| `FLD-READ-BODY` | 文章閲覧用の本文 | `#read-text` |
| `FLD-MANUSCRIPT-TITLE` | 原稿のタイトル | `#manuscript-title` |
| `FLD-PROFILE-NAME` | ユーザーの表示名 | `#profile-name` |
| `FLD-USER-FILE` | ユーザーデータJSONの選択 | `#user-file` |
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
| `FLD-ESTIMATE-BOOK` | 本棚から見積もり対象を選ぶ | `#estimate-book` |
| `FLD-ESTIMATE-TARGET` | 見積もり対象の作品全体文字数 | `#estimate-target` |
| `FLD-ESTIMATE-MINUTES` | 見積もり用の予定朗読時間 | `#estimate-minutes` |
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
- 作品全体文字数の入力欄は4か所ある。値が相互に同期されていても、操作対象の位置を区別するため `FLD-TIME-TARGET`、`FLD-PREP-TARGET`、`FLD-RESULT-TARGET`、`FLD-ESTIMATE-TARGET` とする。
- 計測元のラジオボタン2つには現行のHTML `id` がないため、`name` と `value` によるセレクターで特定する。台帳作成だけのためにHTML `id` は追加しない。
- 2026-10-26追加の6項目には現行HTMLの `data-field-id` 属性がない。台帳では既存のHTML `id` で対応付ける。属性の追加は文書更新の範囲外。
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
| `DLG-STARTUP` | 起動時のJSON読込・新規作成 | `#startup-dialog` |
| `DLG-DOWNLOAD-CONFIRM` | 通常ダウンロードの保存確認 | `#download-confirm-dialog` |

追加2件のダイアログは現在 `data-dialog-id` 未付与です。HTML `id` との管理上の対応を記録し、コードの属性追加は別の改修とします。

## 5. サイト名クリックによる画面IDコピー

通常画面のフッターに表示される「よみじたく」のサイト名部分をクリック・タップすると、**現在の画面ID（例：`SCR-READ-INPUT`）のみ**をクリップボードへコピーする。

- コピー成功時は既存の通知UIで「画面IDをコピーしました：SCR-READ-INPUT」のように通知する。
- コピー失敗時は成功扱いにせず、失敗を通知する。
- サイト名はキーボードでも操作できるようにする。
- クリックしても画面遷移しない。
- サイト名・サブタイトル・フッターの見た目は原則として維持する。
- 画面IDを常時表示する、隠し文字を配置する、専用アイコンや設定項目を追加することはしない。
- 現行仕様どおり、`#reading` 表示中はフッターを非表示とする。原稿画面・計測準備・カウントダウン・計測中のためにコピー導線を増設しない。
- 結果画面は `SCR-RESULT-TIME`、独立した見積もり画面は `SCR-ESTIMATE` をコピーする。

コピー機能を使わない場合も、各識別子は台帳を通じて参照可能とする。

## 6. 実装との対応と運用

- `main[data-screen-id]` に現在の画面識別子を設定する。共通の `#reading` 表示は `mode` と `phase`、結果画面は選択中のタブに応じて更新する。
- 従来の入力要素・ダイアログには `data-field-id` と `data-dialog-id` がある。今回追加した管理識別子の対象はまだ属性未付与のため、既存HTML `id` で対応付ける。既存HTML `id`、CSSクラス、入力制約、イベント処理はそのまま維持する。
- フッターのサイト名から現在の画面IDをコピーし、既存通知UIで成功または失敗を知らせる。`#reading` 表示中は従来どおりフッターを非表示とし、別のコピー操作を追加しない。
- 画面・入力・ダイアログを追加する場合は一意の識別子を付け、本台帳も同時に更新する。識別子は種類をまたいで重複させない。
- 入力値、本文の保持・保存、計測データ、PDF、書き込み、既存の画面遷移には影響させない。

## 7. 変更履歴

| 日付 | 版 | 変更 |
| --- | --- | --- |
| 2026-10-21 | 1.0 | 画面9件・入力項目23件・ダイアログ7件の識別子とコピー仕様を登録 |
| 2026-10-21 | 1.1 | 現行コードの識別属性・画面状態連動・フッターの画面IDコピー実装を反映 |
| 2026-10-21 | 1.2 | `SCR-READ-VIEW` を「原稿画面」と命名し、書込メニュー開閉は同一画面内の操作状態と明記。SCR 9件・FLD 23件・DLG 7件の割当ては不変 |
| 2026-10-26 | 1.3 | JSON正本のユーザーデータ管理・見積もり専用画面・一時停止／再開を反映。現行SCR 11件・FLD 29件・DLG 9件。旧`SCR-RESULT-SPEED`は参照用に保持 |
