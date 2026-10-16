<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier：Claude Code 向けの自動モデルルーティングプラグイン" width="420">
</p>

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | 日本語 | [한국어](README.ko.md)

# sommelier：Claude Code の自動モデルルーティング（Claude Code mod）

**Claude Code mods**（mods API の `turn.step`）上に構築された **Claude Code プラグイン**で、タスクごとにモデルと effort を自動で選びます。ちょっとした確認は **Claude Haiku** に、仕様が明確な変更は **Claude Sonnet** に、調査や設計は **Claude Opus** に振り分け、各リクエストの分類は **TypeSafe Jev** が行います。品質を落とさずに Claude Code の使用量を節約できます。

ソムリエが料理ごとにワインを選ぶように、sommelier は新しいリクエストごとに [TypeSafe Jev](https://docs.typesafe.ai)（確率を返す分類 API）へ 3 つの質問をします。**どれだけの推論が必要か**、**新しいタスクの始まりか**、**高リスクな操作か**です。その答えを、設定可能なラダー（段階表）に当てはめます。

| 推論の深さ | デフォルトの段 | 例 |
|---|---|---|
| L0 確認・機械的な編集 | haiku · medium | 「package.json のバージョンを確認して」 |
| L1 目標と方針が明確 | sonnet · medium | 「parseDate にタイムゾーン引数を追加して」 |
| L2 調査や比較検討が必要 | `base`（opus · medium） | 「ログインがときどき 401 を返すので原因を調べて」 |
| L3 範囲が広く、じっくり考える必要がある | opus · high | 「マルチテナントの権限アーキテクチャを設計して」 |

**なぜ毎ターンモデルを切り替えないのか？** モデルごとにプロンプトキャッシュが別々に保持されるため、モデルを切り替えると会話全体をキャッシュに書き直すことになり、それにも使用量がかかります。sommelier のルールは **アップグレードはいつでも、ダウングレードは得になるときだけ** です。つまり新しいタスクのときに限り、かつ切り替えコストが節約分より小さい場合にだけダウングレードします。

## クイックスタート

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
# 次の行を実行したら、TypeSafe の API キーを貼り付けて Enter を押します（キーは表示されません）
read -rs TYPESAFE_API_KEY
# キーを macOS のキーチェーンに保存します
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

API キーは [TypeSafe コンソール](https://console.typesafe.ai/keys)で作成してください。`~/.zshrc` で `TYPESAFE_API_KEY` をすでに設定している場合は、`read` の行は飛ばしてかまいません。

Claude Code を再起動すれば sommelier が有効になります。ほかに設定は必要ありません。

1. リクエストを送ります。たとえば「parseDate にタイムゾーン引数を追加して」
2. スピナーに選ばれた段が表示されます。たとえば `sonnet·medium L1 · 新話題，降級`（新しい話題、ダウングレード）

止めるには `/somm off` を実行します。詳しくは[インストール](#インストール)と[使い方](#使い方)を参照してください。

## AI エージェントでインストールする

まず TypeSafe の API キーを用意してください。キーはエージェントに渡さず、ご自身で環境変数に設定します。

1. [TypeSafe コンソール](https://console.typesafe.ai/keys)で API キーを作成します
2. ターミナルで次を実行し（`your-api-key` はご自身のキーに置き換えてください）、`~/.zshrc` に追加します。

   ```bash
   echo 'export TYPESAFE_API_KEY="your-api-key"' >> ~/.zshrc
   ```

3. 新しい環境変数を読み込ませるため、ターミナルと Claude Code を再起動します

そのうえで、Claude Code やほかのコーディングエージェントに次の文を貼り付けてください。

> Install sommelier by following https://github.com/wide3751/sommelier/blob/main/INSTALL-AGENT.md

## 動作要件

- Claude Code **v2.1.287 以降**（ターミナル）、またはデスクトップアプリ同梱の **v2.1.286 以降**（Code タブで `/status` と入力すると確認できます）
- TypeSafe の API キー（[TypeSafe コンソール](https://console.typesafe.ai/keys)で作成します）

## インストール

1. マーケットプレイスを追加してインストールします。方法は 2 つあり、**GitHub からの方法をおすすめします**。

   **方法 A：GitHub から（おすすめ）** — プロジェクトをダウンロードする必要はありません。

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
```

   あとで新しいバージョンに更新するときは、マーケットプレイス、プラグインの順に更新してから Claude Code を再起動します（インストール済みのプラグインに `install` を再実行してもアップグレードされません）。

```bash
claude plugin marketplace update sommelier
claude plugin update sommelier@sommelier
```

   **方法 B：ローカルフォルダから** — プロジェクトを clone して、自分で加えた変更をインストールしたい場合に使います。

```bash
git clone https://github.com/wide3751/sommelier.git ~/Projects/sommelier
claude plugin marketplace add ~/Projects/sommelier
claude plugin install sommelier@sommelier
```

2. TypeSafe の API キーを設定します（macOS のキーチェーンに保存されます）。ターミナル版ではセッション内で `/plugin configure sommelier@sommelier` を実行できます。デスクトップアプリの Code タブには入力欄が表示されないため、代わりにターミナルで次を実行してください。

```bash
# 次の行を実行したら、TypeSafe の API キーを貼り付けて Enter を押します（キーは表示されません）
read -rs TYPESAFE_API_KEY
# キーを macOS のキーチェーンに保存します
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

   キーをコマンドに直接書く必要はありません。`read` はこのターミナルの `TYPESAFE_API_KEY` 変数にキーが貼り付けられるのを待ち、次の行がそれをキーチェーンに保存するので、キーがシェルの履歴に残ることはありません。`~/.zshrc` で `TYPESAFE_API_KEY` をすでに設定している場合は `read` の行を飛ばせますが、現在のシェルから見えることを確認してください（たとえば新しいターミナルウィンドウを開きます）。フォールバックとして `TYPESAFE_API_KEY` 環境変数だけに頼ることもできますが、Dock から起動したデスクトップアプリは `~/.zshrc` を読み込みません。

### Windows でのインストール

手順 1（マーケットプレイスの追加とインストール）のコマンドは PowerShell でもそのまま動きます。ローカルフォルダの方法では、`claude plugin marketplace add C:\Projects\sommelier` のように Windows のパスを使ってください。

手順 2 の `read -rs` は PowerShell にはありません。代わりに次を実行してください（Windows PowerShell 5.1 と PowerShell 7 で動作します）。

```powershell
# 次の行を実行したら、TypeSafe の API キーを貼り付けて Enter を押します（何も表示されません）
$s = Read-Host "TypeSafe API key" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $s).Password
# Claude Code に渡してプラグイン設定として保存します
'{"typesafe_api_key":"' + $key + '"}' | claude plugin configure sommelier@sommelier --values-stdin
Remove-Variable key, s
```

キーチェーンは macOS 専用のため、Windows ではキーは Claude Code のプラグイン設定に保存されます。代わりに環境変数をフォールバックとして使う場合は、ユーザー環境変数として永続的に設定し（`your-api-key` はご自身のキーに置き換えてください）、ターミナルと Claude Code を開き直します。

```powershell
[Environment]::SetEnvironmentVariable("TYPESAFE_API_KEY", "your-api-key", "User")
```

3. Claude Code を再起動して `/somm status` を実行し、API キーが設定済みであること（「API key 已設定」）を確認します。

## 使い方

インストール後はデフォルトで有効なので、`/somm on` を実行する必要はありません。リクエストを初めて TypeSafe に送る前に、sommelier が同意を求めます。同意すれば二度と聞かれません。拒否すると、そのターンはセッションのモデルのままとなり、sommelier はオフになります。

| コマンド | 説明 |
|---|---|
| `/somm on` | 再びオンにします。以降に送るプロンプトはすべて Jev が判定します（短い返答を除く） |
| `/somm off` | オフにし、セッション本来のモデルと effort を維持します |
| `/somm off --project` | 現在のプロジェクトだけをオフにし、そのプロジェクトからは何も送信しません。`/somm on --project` で元に戻せます |
| `/somm status` | オン／オフ、このプロジェクトがオフかどうか、API キーが設定済みかどうか、このセッションの段を表示します |
| `/somm log [n]` | 直近 n 件のルーティング記録です。選ばれた段、Jev の確率、キャッシュの読み込みと書き込みを表示します |
| `/somm events` | 直近 20 件の状態イベント（モデルの切り替え、会話のクリアや再開、プロンプトの出どころ、各ターンのルーティング）を表示します。sommelier が切り替えなかった理由を調べるのに使います |
| `/somm config` | 設定を一覧表示します。`/somm config <name> <value>` で 1 つ変更でき、すぐに反映されます |

**設定**（`/somm config <name> <value>`）：

| 名前 | デフォルト | 値 |
|---|---|---|
| `enabled` | on | on／off。`/somm on`、`/somm off` と同じです |
| `base` | opus | 調査や比較が必要なリクエスト（L2）の段で、高リスクなリクエストの最低モデルでもあります。`haiku`／`sonnet`／`opus`。`opus:high` のように effort も指定できます |
| `profile` | balanced | `saver`（opus を使う頻度を下げ、新しい話題と早めに判断します）、`balanced`、`quality`（sonnet と opus を早めに使い、haiku は 15k 未満の会話に限ります） |
| `allowed` | haiku-opus | sommelier が選んでよいモデルです。たとえば `sonnet-opus` なら haiku は使いません。`somm:` によるオーバーライドはこの制限を受けません |
| `spinner` | on | Claude が作業している間、スピナーにこのターンのルーティングを表示するかどうか |
| `cache` | on | ステータスラインにキャッシュゲージを表示するかどうか。`off` ではモデルと effort だけを表示します |
| `notify` | important | 重要な通知です。キャッシュを書き直すオーバーライドやダウングレード、Jev の 3 回連続失敗、API キー未設定（1 回だけ表示）が対象です。1 ターンにつき最大 1 件で、10 秒以内に複数発生した場合は 10 秒経過後に最新のものだけを表示します。`off` では何も表示しません |
| `skills` | off | スキルヒントのオン／オフ（ベータ版、デフォルトはオフ）。`on` で有効になります。`off` で止まるのはスキルヒントだけで、モデルのルーティングは続きます |
| `skills-allow` | （すべて） | 候補にするスキルをこれだけに限定します。カンマ区切りで、`/skills` に表示される名前で指定します（例：`mattpocock-skills:tdd,grilling`）。`none` でクリアします |
| `skills-exclude` | （なし） | これらのスキルは決してヒントに出しません。書き方は同じです。両方のリストにあるスキルは除外されます |

オンのとき、プロンプト下のステータスラインには、実際に回答したモデル、そのバージョン、effort に続いてキャッシュゲージが表示されます。たとえば `🍷 opus 5.5·medium ▰▰▱▱▱ 95k` です。その隣に Claude Code が表示するモデルは、セッション本来のモデルです。

**キャッシュゲージ**：数字は、現在のモデルに蓄積されたキャッシュの量です。5 つのセルは、`allowed` の範囲で 1 つ下のモデルへ切り替える場合の切り替えコスト（キャッシュを書き直す代金）が、その切り替えで節約できると見込まれる使用量に占める割合を示し、1 セルが 20% にあたります。セルが埋まっているほど、下のモデルへ切り替える得は小さくなります。セルがすべて埋まって `⚠` が付いている場合（たとえば `▰▰▰▰▰⚠ 243k`）は、切り替えコストが節約分を上回るため、sommelier はダウングレードを見送ります。ご自身で切り替えることもおすすめしません。キャッシュの有効期限が切れたとき、またはすでに許可された最も低いモデルを使っているときは、セルは空になります。ステータスラインには色を付けられないため、赤い警告の代わりに埋まったセルと `⚠` を使っています。表示が窮屈に感じる場合は `/somm config cache off` でオフにできます。

<img src="assets/status-line/status-line.en.png" alt="4 つの状況でのステータスラインのキャッシュゲージ（イメージ図）" width="640">

<sub>イメージ図：始まったばかりの会話、長めの会話、切り替えても得にならない場合、すでに最も低いモデルの場合。</sub>

ほかのプラグインがすでに `/somm` を使っている場合、コマンドは `/sommelier` になります。

**モデルを自分で選ぶ（オーバーライド）**：プロンプトの先頭に `somm:opus`、`somm:sonnet`、`somm:haiku`（大文字小文字は問いません）を付けると、Jev に問い合わせずにそのリクエストでそのモデル（effort は medium）を使います。プレフィックスはモデルがプロンプトを見る前に取り除かれます。同じモデルは、Jev が新しい話題と判断するか、`/clear` するか、`/model` で切り替えるまで、その話題の間ずっと使われます。後ろに何も書かずにプレフィックスだけを送ると、何も送信されず、以降のモデルだけが設定されます。切り替えによってキャッシュが書き直される場合は、何トークン分で、おおよそどれだけのコストかが通知されます。

**各リクエストの判断方法：**
- **アップグレード**：より強いモデルや高い effort が必要なリクエストでは、いつでも上の段に移ります
- **高リスク**：データの削除や上書き、本番環境や権限の変更を伴うリクエストは、最低でも base（デフォルトは opus）に移り、そのリクエストに限り effort は high になります
- **じっくり考えるよう求める**：`ultrathink`、「仔細想」（よく考えて）、「深入想」（深く考えて）を含むプロンプト（コード内は除く）は、Jev に問い合わせずに直接 opus · high になります
- **ダウングレード**：新しい話題のときだけ、かつ見込まれる節約分がキャッシュを書き直すコストを上回るときだけ行います。そうでなければ、そのリクエストは現在のモデルのままです
- **維持**：同じ話題で判定が下がったとき、短い返答（「ok」「続けて」など。Jev には送りません）のとき、Jev がタイムアウトやエラーになったときは、現在のモデルのままです
- **長い会話には haiku を使わない**：30k トークンを超える会話は haiku に下げません。すでに haiku で動いている会話は、それを超えた時点で sonnet に移ります

**スキルヒント**（ベータ版、デフォルトはオフ。`/somm config skills on` で有効にします）：モデルと合わせて、Jev はそのリクエストにスキルが必要か、どのスキルが最も合うかを判定します。十分な確信がある場合（「スキルが必要」≥ 0.30 かつ最上位のスキル ≥ 0.5）、sommelier はプロンプトの横に、このリクエストはそのスキルに向いているかもしれない（外れている可能性もあります）という Claude 向けのメモを添えます。あくまで提案なので、合わない場合 Claude は無視し、モデルが変わることもありません。候補は、このセッションで Claude が自分で呼び出せて説明文を持つスキルで、`skills-allow` と `skills-exclude` で絞り込めます。同じスキルのヒントは話題ごとに 1 回だけで、次に出るのは新しい話題か `/clear` の後です。ヒントはスピナーに `💡tdd` のように表示され、Claude がそれを採用したかどうかは `/somm log` に記録されます。スキルヒントがオンの場合、ヒントを一緒に届けられるよう、プロンプトは送信後に Jev を待ちます（最大 1.5 秒）。

**sommelier がモデルを変えないケース：**
- オフになっている、または現在のプロジェクトでオフにされている
- 初回送信前の同意確認に同意しなかった
- セッションの最初のリクエストで Jev が失敗した、または API キーが設定されていない（2 回目以降の失敗では現在のモデルを維持します）
- リクエストがサブエージェントから来ている

### 例

現在、プラグインのメッセージは中国語です。日本語訳はコメントに記載しています。

オンにして「parseDate にタイムゾーン引数を追加して」と送ります。Jev は L1 と判定し、セッションの opus が sonnet に下がって、スピナーに次のように表示されます。

```
sonnet·medium L1 · 新話題，降級   # 新しい話題、ダウングレード
```

「ok」と返答します。短い返答は Jev に送られず、同じ段のままです。

```
sonnet·medium · 沿用             # 維持
```

続いて「マルチテナントの権限アーキテクチャを設計して」と頼みます。Jev は L3 と判定し、上の段に移ります。

```
opus·high L3 · 升級              # アップグレード
```

`/somm status`：

```
sommelier 開啟｜API key 已設定｜本 session 檔位 sonnet·medium
# sommelier オン｜API キー設定済み｜このセッションの段 sonnet·medium
```

`/somm log 3` — P は Jev による L0/L1/L2/L3 の確率です。判定に失敗したターンは `session` と表示され、元のモデルを維持します。「回答」は実際に回答したモデルで、角かっこ内はセッション ID の先頭 6 文字です。

```
sonnet·medium · 回答 sonnet · downgrade P=0.05/0.90/0.05/0.00 jev 820ms cache read 0 write 18342 [a1b2c3]
sonnet·medium · 回答 sonnet · continuation cache read 18342 write 1204 [a1b2c3]
opus·high · 回答 opus · upgrade P=0.02/0.08/0.20/0.70 jev 410ms cache read 0 write 21530 [a1b2c3]
```

## 制限事項

- **手動の `/model`**：`/model` でモデルを切り替えると、`/model` で Default を選び直すまで、sommelier はモデルを変更しなくなります。これは `/clear` や再開をまたいでも続きます。Claude Code が自動で別のモデルにフォールバックした後も、ご自身で `/model` を実行するまで sommelier は手を出しません。
- **判定されないターン**：通知、スケジュール、ほかのセッションやプラグインからのメッセージ、およびスラッシュコマンドは、現在のモデルのままで Jev には送られません。セッションのモデルが Opus、Sonnet、Haiku 5.5 以外（たとえば `[1m]` 版や旧バージョン）の場合、sommelier は何も変更しません。
- **得にならないダウングレードはしない**：モデルごとにキャッシュが別々なので、切り替えると会話が新しいモデルのキャッシュに書き込まれます。sommelier は各モデルのキャッシュがどこまで有効かを記録しています。一度も使っていないモデルや、キャッシュの TTL を超えて使われていないモデルでは会話全体を書き直す必要があります。少し前に使ったモデルに戻る場合は、新しい部分を追加するだけで済みます。`/clear`、compact、再開の後は、システムプロンプトだけがキャッシュに残っています。ダウングレードの前に、その書き直しコストと、安いモデルで約 3 ターン進めた場合の節約分を比べます。得にならなければ、そのリクエストは現在のモデルのままとし、次の新しい話題で改めて比較します。アップグレードには影響しません。価格は `hooks/decide.ts` にある定価です。
- **モデルピッカーにはセッションのモデルが表示される**：sommelier が変更するのは送信される各リクエストであり、セッション自体のモデルではないため、`/model` やデスクトップアプリのモデルピッカーには元のモデルが表示されたままです。実際に回答したモデルは、ステータスラインの 🍷 の後ろに表示されるものです。
- **判定には時間がかかる**：各リクエストの判定は最大 1.5 秒待ちます（オフライン評価での p95 は約 0.4 秒）。短い返答は送信されないため待ちません。
- **デスクトップアプリ**：Code タブでは `/plugin configure` で API キーを受け付けられません。代わりにターミナルから設定してください（「インストール」を参照）。

## トラブルシューティング

| 症状 | 対処方法 |
|---|---|
| `/somm status` で API キーが未設定と表示される（「API key 未設定」） | 「インストール」の手順 2 をやり直してください。環境変数だけに頼っている場合は、Claude Code を起動するシェルから `TYPESAFE_API_KEY` が見えることを確認してください。Dock から起動したデスクトップアプリは `~/.zshrc` を読み込みません |
| スピナーに `Jev 失敗`（Jev の失敗）と表示される | `/somm log` で原因を確認してください。`no_key` はキーがない、`timeout` は 1.5 秒を超えた、`http_401` などは API エラー、`fetch_failed` は TypeSafe に接続できなかったことを意味します。そのターンは現在のモデルを維持します。セッションの最初のリクエストで失敗した場合は、セッション本来のモデルを使います |
| `/somm` が見つからない | ほかのプラグインが使っています。`/sommelier` を使ってください |
| コードの変更が反映されない | インストール済みのコピーは `plugin.json` の `version` ごとにキャッシュされます。バージョンを上げて `claude plugin update sommelier@sommelier` を実行し再起動するか、開発中は `--plugin-dir` を使ってください |

## プライバシーとデータ

sommelier はインストール後デフォルトで有効になり、有効な間は判定のためにデータを TypeSafe に送信します。初回送信の前に同意を求め、`/somm off` を実行した後は何も送信しません。

- **送信のタイミング**：新しいリクエストごとです。短い返答（スペースと句読点を除いて 8 文字以下、たとえば「ok」や「続けて」）は送信しません
- **送信する内容**：現在のリクエスト（最大 2,000 文字）と直近 3 ターンのテキスト（各最大 500 文字、末尾を残します）。スキルヒントがオンの場合は、候補スキルの名前と説明（各最大 300 文字）も送ります。初回の確認ではスキルは対象外で、スキルヒントをオンにした後、スキルのデータを初めて送る前に改めて確認します。拒否した場合はスキルヒントだけがオフになります
- **送信前のマスキング**：一般的な秘密情報の形式は `[REDACTED]` に置き換えます。対象は `sk-`、`AKIA`、`ghp_`、`xoxb-`/`xoxp-`、`AIza`、`Bearer`、`password=`、JWT、秘密鍵ブロック、32 文字以上の 16 進文字列です
- **送信しない内容**：ファイルの内容、ツール呼び出しとツールの出力、サブエージェントのリクエスト、`/somm off --project` でオフにしたプロジェクト
- **ローカルの記録**：`/somm log` の記録には、段、Jev の確率、レイテンシ、キャッシュの読み込みと書き込み、ヒントに出したスキルとその採用有無、プロンプトの先頭 40 文字（マスキング済み）が保存されます。オフにしたプロジェクトではプロンプトは保存しません。また、プラグインを更新しても実行中のセッションが続けられるよう、各セッションのルーティング状態（現在の段、キャッシュ台帳、オーバーライドのロックなど。プロンプトは含みません）もローカルに保存します。保存するのは最新の 20 セッション分だけです
- **API キー**：macOS のキーチェーン（`/plugin configure`）に保存されるか、`TYPESAFE_API_KEY` 環境変数から読み込まれます

## コントリビュート

開発環境の構築、オフライン評価、プロジェクト構成については [CONTRIBUTING.md](CONTRIBUTING.md)（中国語）を参照してください。

## ドキュメント

- [GLOSSARY.md](GLOSSARY.md)：用語集（段、新しいタスク、キャッシュ台帳…）

## ライセンス

[MIT](LICENSE)
