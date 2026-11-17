# Femoral-Morphology-Analyzer
## 作業記録
- 2026-11-17 12:50 JST／ChatGPT（Codex）／feat/research-profile-101：devに固定端点101点・欠測/90%被覆率/%単位、骨側LT-mm固定の内外側皮質厚比較、Registry19/23列のJSON/CSV出力を追加。研究JSON再読込・校正精度保持・.fmaヘッダー互換を検証、合成テスト121件通過（ブラウザ1件スキップ）、既存保存/経時/Gruen回帰通過／残り：実ブラウザ/PNG・実画像・AP反復確認、軸位規約確定。main・公開サイト・GASへの反映はレビュー後。仕様と操作はRESEARCH_OUTPUT.md。

- 2026-11-05 11:03 JST／ChatGPT／採用済みアイコン192・512px、favicon、Apple用180px、manifest・HTML参照を更新（機能・計算・データ変更なし）／公開サイト検証、既存インストールの端末反映確認

- 2026-11-05 11:09 JST／ChatGPT／Pagesデプロイ成功、公開HTML・manifest・全アイコン照合、スクリプト不変・起動画面確認／端末の既存インストールへの反映は未確認

- 2026-11-12 22:10 JST／Claude／作業ブランチ feat/main-v2.2-gruen：dev/index.html を v2.2-axis-split に更新、沈下・内外反変化の経時比較を検証用HTMLから移植、Gruen zone（AP・7 zone）の計算部品と画面を追加。ルートの index.html（v1.0 FROZEN）と公開・GAS用ブランチは未変更。node テスト通過（合成データのみ）／残り：ブラウザでの表示確認、実画像での確認、main への反映判断、平均輝度

- 2026-11-12 22:30 JST／Claude／feat/main-v2.2-gruen：zone 7上端を「術直後像の骨切り線の内側端で決め、経過像ではその高さを引き継ぐ」1ルールに変更（カラー有無で分けない）。経過像で術直後のGruen結果JSONを読み込む機能と、骨の内側端の移動量（calcar）の表示を追加。lib/gruen-zones.js v0.2.0。node テスト通過（合成データのみ）／残り：ブラウザ・実画像での確認、main への反映判断

公開元は既存の `v2.0-ai-assisted` ブランチです。mainを正本とし、今回のアイコン・PWAメタデータのみ公開ブランチへ反映しました。両ブランチのアプリ本体は異なるため、自動同期や公開元切替は行っていません。StemAV用ZIP画像と192・512pxともバイト単位で一致します。
