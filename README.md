# WINS人狼競馬メモ

Discordに残してある競馬の回顧メモと、その週のJRA出走馬を照合し、**今週出走するメモ馬だけ**を公開サイトに表示するNext.jsアプリです。

## 更新と表示の構成

公開ページはDiscordやnetkeibaを直接取得しません。Vercel Cronまたは保護された管理APIが、取得・照合・保存を先に済ませます。閲覧時は非公開Vercel Blobに保存した週別スナップショットだけを読みます。

1. Discordメモを初回だけ履歴取得し、以後はチャンネルごとの最新メッセージID以降だけ増分取得
2. 今週分のnetkeiba出走情報だけを指定日に更新
3. 出走馬と保存済みメモを照合
4. `keiba-cache/snapshots/YYYY-MM-DD.json` に完成済み表示データを保存
5. 公開ページは保存済みJSONだけを表示

保存データは非公開Blobです。Discord Bot Token、Blob認証情報、Cron Secretはいずれもクライアントへ送信しません。

## 定期更新（日本時間）

- 月曜 5時台: Discord週末回顧メモのみ増分更新
- 木曜 16時台: Discord増分更新 + 土日月の出走情報更新 + 再照合
- 金曜 16時台: 同上（馬番・枠順公開後の更新）
- 土曜 6時30分台: 当日分だけ出走情報更新 + 再照合
- 日曜 6時30分台: 当日分だけ出走情報更新 + 再照合
- 月曜 6時30分台: 3日間開催の月曜分だけ更新 + 再照合

CronはUTCで`vercel.json`に定義しています。Hobbyプランでは実行時刻に最大59分程度の幅があります。

## 永続化

Vercel Blob（private）を使用します。

- `keiba-cache/discord-memos.json`: メモ本体とチャンネル別の最新メッセージID
- `keiba-cache/races/YYYY-MM-DD.json`: 週単位の出走情報
- `keiba-cache/snapshots/YYYY-MM-DD.json`: 公開ページ用の照合済みデータ

ローカル開発では、Blob接続がなければ同じ構造を`.data/`に保存します。

## 管理用の手動更新

公開画面に更新ボタンはありません。`CRON_SECRET`と同じBearer認証が必要です。

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://wins-jinro-keiba-memo-vercel-v3.vercel.app/api/admin/sync?scope=all"
```

`scope`は`all`、`discord`、`races`、`today`のいずれかです。SecretをURLへ含めないでください。

## 主な機能

- Discordの複数チャンネルを横断して過去メッセージを取得
- 1メッセージに複数頭のメモが書かれていても、該当馬の段落だけ抽出
- 今週のJRA開催日を出走データから自動判定し、通常は土日・3日間開催は土日月を表示
- 各開催日の出走馬とDiscordメモを馬名照合
- メモがある馬だけ表示
- 競馬場 → R → 馬名 → メモ の順で整理
- 同一馬の複数メモ、複数チャンネルのメモをまとめて表示
- Bot Tokenはサーバー側だけで利用し、ブラウザへ送信しない
- 自動出走データ取得失敗時は手動JSONへ切り替え可能

## 最短の公開方法（iPhoneでも可）

1. このZIPを保存する
2. Safariで `https://vercel.com/drop` を開く
3. ZIPをアップロードする
4. Project Name を `wins-jinro-keiba-memo` などにして Deploy
5. デプロイ後、Vercelの Project → Settings → Environment Variables を開く
6. 下記の環境変数を設定する
7. Redeployする

## 必須の環境変数

### DISCORD_BOT_TOKEN
Discord Developer PortalでコピーしたBot Token。

**絶対にGitHubや公開ファイルへ書かないでください。**

### DISCORD_CHANNEL_IDS
このままコピーできます。

```text
1373132065243136095,1435891059485053021
```

Botには両方のチャンネルで以下の権限が必要です。

- チャンネルを見る
- メッセージ履歴を読む

Discord Developer Portalでは Message Content Intent もONにしてください。

## 推奨の環境変数

```text
DISCORD_HISTORY_DAYS=730
DISCORD_HISTORY_MAX_MESSAGES=4000
RACE_SOURCE=netkeiba
```

古いメモまで必要なら `DISCORD_HISTORY_DAYS` を増やします。取得量が増えるほど初回表示は遅くなります。

## 出走データについて

初期設定では公開されているnetkeibaのJRAレースページから出走馬をサーバー側で取得します。外部サイト側のHTML変更・アクセス制限などで取得できなくなる可能性があるため、画面最下部の「取得状況・トラブル確認」で取得件数とエラーを確認できます。

最終的な出走情報はJRA主催者発表と照合してください。

## 緊急時の手動データ

自動取得に失敗したときだけ、Vercelの環境変数 `MANUAL_RACES_JSON` にJSONを入れ、`RACE_SOURCE=manual` にすると動かせます。

例：

```json
[
  {
    "date": "2026-09-19",
    "venue": "中山",
    "raceNumber": 8,
    "raceName": "3歳以上1勝クラス",
    "raceId": "manual-nakayama-8",
    "horses": [
      { "number": 7, "name": "モンローウォーク" },
      { "number": 10, "name": "サンプルホース" }
    ]
  }
]
```

## セキュリティ

- `DISCORD_BOT_TOKEN` は `.env` やVercel Environment Variablesのみに保存
- `NEXT_PUBLIC_` を付けない
- GitHubへBot Tokenをコミットしない
- Botには管理者権限を与えず、対象メモチャンネルの閲覧権限だけにする

## 補足

Discordメモの抽出は、まず空行区切りの段落から該当馬名を含む部分を取り出します。段落として認識できない場合は、馬名が含まれる行の前後を抜き出します。
# 先週の開催を使った照合テスト

通常のURLは従来どおり今週の開催を表示します。`?week=last` を付けた場合だけ、通常の取得候補（土・日・月）を7日前にずらします。日付の基準は日本時間です。実際にレースが取得できた日だけタブに表示する既存の3日間開催対応は共通で使用します。

テスト画面には対象期間と「今週の開催に戻る」リンクを表示します。Discordの取得範囲・環境変数は変更しません。これは過去出走馬と現在取得できるメモの照合であり、レース当時に存在したメモだけを使うバックテストではありません。

`競馬場 + R + 着順 + 馬名` 形式の見出しがある投稿は、その明示された馬だけに紐付けます。本文で比較相手として言及された別馬へは紐付けません。その形式と見出しのない文章が混在する投稿では、見出しのない部分の救済抽出は行いません。

`npm test` で日付境界・年越し・3日間の取得候補・馬名の部分一致防止・別馬の回顧混入防止を検証できます。
