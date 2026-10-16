# Femoral Morphology Analyzer（FMA）運用メモ

更新日：2026-10-15

## 正本と使用先

- コードの正本：このGitHubリポジトリの `v2.1.2-cloud` ブランチ。
- `main` への変更は、現在の自動反映の対象外。
- アプリはGoogle Apps Script（GAS）の既存Webアプリとして使用する。
- Driveにバージョン別HTMLを増やさず、変更履歴はGitのcommit、必要な区切りはtagで管理する。
- 研究計画・測定仕様・SAP等の正本は別途管理する。コード変更だけで研究上の仕様を変更した扱いにしない。

[コードの正本](https://github.com/shimizutom1981-ship-it/Femoral-Morphology-Analyzer/tree/v2.1.2-cloud)

[使用中のWebアプリ](https://script.google.com/macros/s/AKfycbwjM7bGEl9Enx8-67okUubpr33A8ZL_xdJHd_YHHJZNHeY-gRZOEXPZuS4tQHN8-d3kLg/exec)

[Apps Scriptエディタ](https://script.google.com/u/0/home/projects/16z7wkj_s9dhTElKUNaYFmtaJ1JgpbwE9J5kduYpFE-jDBFd_9VWWsFyC/edit)

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面・計測・操作を含むアプリ本体 |
| `Code.gs` | GAS側の処理。Drive・スプレッドシートへの保存など |
| `appsscript.json` | GASの実行設定。現行設定は実行者がデプロイ所有者、アクセスは所有者のみ |
| `.clasp.json` | 同期先のApps ScriptプロジェクトID |
| `.claspignore` | GASに転送するファイルを限定 |
| `.github/workflows/gas-sync.yml` | GitHub Actionsによる自動転送・既存デプロイ更新 |
| `training/` | AI学習・推論コード。GASへの転送対象外 |

## 通常の修正手順

1. `v2.1.2-cloud` ブランチのコードを修正する。
2. 変更内容に応じて構文、計測結果、操作、保存処理を確認する。
3. 内容が分かるメッセージでcommitし、GitHubに反映する。
4. GitHub Actionsの「Sync FMA to existing GAS deployment」が成功したことを確認する。
5. 使用中のWebアプリを再読み込みして動作確認する。画面表示と、症例保存を伴う動作確認は区別する。保存確認には識別可能なテスト用データを使い、研究データへ混入させない。

GASエディタへ全文を貼り直したり、新しいWebアプリURLを発行したりする通常操作は不要。

AIへ修正を依頼する場合の例：
「Femoral-Morphology-Analyzerのv2.1.2-cloudブランチのindex.htmlを修正して。変更をcommitし、GAS自動反映の成功まで確認して。」

## 自動反映の対象と動作

`v2.1.2-cloud` ブランチで以下のファイルを更新すると起動する。

- `index.html`
- `Code.gs`
- `appsscript.json`
- `.clasp.json`
- `.claspignore`
- `.github/workflows/gas-sync.yml`

READMEや学習コードだけの変更では起動しない。

処理は「前提条件確認 → Google認証 → clasp push --force → 既存デプロイ更新」の順。
既存のデプロイIDを更新するため、使用中のWebアプリURLを維持する。
このブランチへの対象ファイルのcommitは、そのまま使用中アプリへの反映につながるため、未完成の変更は別ブランチで準備する。

[GAS同期の実行履歴](https://github.com/shimizutom1981-ship-it/Femoral-Morphology-Analyzer/actions)

## 認証の管理

- GitHub ActionsのRepository secret `CLASP_AUTH` にGoogle認証情報を登録済み。
- 認証情報はローカルでclasp loginにより生成した `.clasprc.json` に由来する。
- `.clasprc.json` の内容をコード、README、チャットへ貼らない。Gitにcommitしない。
- 認証が失効・取り消しされた場合は、Googleへの再認証と `CLASP_AUTH` の更新が必要。
- Apps Script APIを有効にして使用する。

## 失敗した場合

1. Actionsで失敗した実行を開き、失敗したステップとログを確認する。
2. 原因を修正する。認証エラーなら再認証・Secret更新、コードや設定の問題ならGitHub側を修正する。
3. コード変更後は新しいcommitの実行結果を確認する。Secretだけ更新した場合などは、該当する最新実行の失敗ジョブを再実行する。
4. コード転送成功とデプロイ更新成功を別々に確認する。転送だけ成功しても、使用中のURLに反映されたとは扱わない。

GASを直接修正した場合、その変更はGitHubに自動で戻らない。次の同期でGitHubの内容に上書きされるため、緊急修正も必ずGitHubの正本へ取り込んでから次の同期を行う。

## 不具合時に以前のコードへ戻す

- GitHubの履歴から、問題を生んだ変更をrevertするなどして、動作確認済みの内容を `v2.1.2-cloud` に復元する。
- そのcommitによる同期成功を確認し、Webアプリを再読み込みして確認する。
- コードを戻しても、すでに保存・変更されたDriveやスプレッドシートのデータは元に戻らない。データへの影響は別途確認する。
- 公開済み履歴を強制的に書き換える運用は避け、復元操作もcommitとして残す。

## 確認済みの状態

2026-10-15：manifest登録、Google認証情報登録後、GASへのコード転送と既存デプロイ更新がともに成功。

[初回同期成功の実行結果](https://github.com/shimizutom1981-ship-it/Femoral-Morphology-Analyzer/actions/runs/38668948304)

この確認は配信処理の成功を示す。計測精度・臨床的妥当性・実際の症例保存についての検証完了を意味しない。

## v2.1.3 保存仕様（2026-10-15）

- 保存前にResearch ID・Observer ID・反復番号（1以上の整数）・匿名Image IDを入力する。同じ画像の再計測ではImage IDを変えず反復番号を変える。
- measurement_keyはResearch ID / Observer ID / 反復番号 / Image ID / 左右 / 画像区分を結合する。
- record_keyはmeasurement_keyに保存ごとのUUIDを追加する。各保存を別ファイル・台帳の別行として残す。同じ計測の修正履歴はmeasurement_keyでまとめる。
- 既存の症例IDだけのファイル・台帳行は書き換えない。新しい台帳列はヘッダー名で対応付けて追加する。旧データの評価者・反復番号・確認状況を推測で補わない。
- 校正径、LT視認性、二重皮質、適格性は未入力・未評価から開始する。欠測はJSONでnull、台帳では空欄。画像切替時には前症例の校正・画質情報を引き継がない。
- 未校正のまま途中保存は可能だが、mmを使う計測値は欠測となる。校正が未完了でも輪郭座標は保存できる。
- AIモデル版は推定して埋めない。JSON内のmodel_versionがあれば取り込み、PNGだけの場合などは実際に使った重みの版を入力する。不明なら空欄・unknownとして残す。
- 配信時にGitHub Actionsが実際の40桁commit SHAを埋め込む。台帳に画面側algorithm_git_hashと保存サーバ側server_git_hashを記録する。GitHubから直接ダウンロードした未ビルドHTMLではSHAはnullとなる。
- 新しい保存を開始する前にアプリを再読み込みする。旧画面からの保存は識別項目不足として拒否する。
- tests/save-regression.cjsで欠測、校正変更、モデル版、評価者・反復分離、保存履歴、旧台帳保持を検証する。実Driveでの症例保存の動作確認は別途必要。
- 学習用に利用する際は履歴を全件独立症例として投入しない。採用する教師記録を選び、Research ID／患者単位で分割する。現行trainingスクリプトは従来の症例フォルダ・ファイル名を要求するため、新保存形式からの選定・入力変換が必要。

### 輪郭精度についての未解決事項

現在のPNG読込では、髄腔輪郭に合わせてステムをクリップし、さらに各輪郭を平滑化・制御点削減する。表示の誤差だけからAIモデル由来とは断定できない。元の予測mask、表示輪郭、手動修正後の書出maskを同一画像で比較すること。

表示は平滑曲線、教師mask書出は制御点を結ぶ直線のため、境界が完全に一致するとは限らない。今回の保存仕様修正では輪郭アルゴリズムを変更していない。

リポジトリのtraining/train_fma_jang_ap.pyは元画像を512角へ直接resizeする一方、アプリの教師maskは縦横比を保って余白を付ける。非正方形画像では学習入力とmaskが位置一致しない可能性があり、次の再学習前に前処理の統一が必要。実際に使われた学習コード・重みとの対応は未確認。
