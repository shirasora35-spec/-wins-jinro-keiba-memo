# WINS人狼競馬メモ

Discordに残してある競馬の回顧メモと、その週のJRA出走馬を照合し、**今週出走するメモ馬だけ**を公開サイトに表示するNext.jsアプリです。

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
