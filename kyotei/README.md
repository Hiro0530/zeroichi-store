# kyotei — AI舟券 答え合わせ帳

公開ページ: https://hiro0530.github.io/zeroichi-store/kyotei/

- 毎朝 06:45 JST(`.github/workflows/kyotei.yml`): 前日の全レースを答え合わせ → 当日の予想 → このフォルダにコミット → gh-pages の `kyotei/index.html` だけを更新。
- `predictions/`(公開時刻つき・公開後は書き換えない。締切が公開時刻より前のレースは採点しない)/ `results/` / `summary.json` / `model.json`
- 比較の基準は常に「1号艇を毎回」。予想は無料の参考情報で、的中・利益を保証しない。過去の成績は将来を約束しない。20歳未満は投票不可。
- データ: BOAT RACE 公式のダウンロードデータ(番組表・競走成績)を1日数ファイル取得。生ファイルと学習用の履歴(hist/)は公開しない(Actionsのキャッシュに置く)。
- 手動実行: `trigger.txt` を書き換えてpush(`daily` / `backfill:60`)。
