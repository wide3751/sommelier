<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier：Claude Code のモデルを自動で切り替える plugin" width="420">
</p>

[繁體中文](README.md) | [简体中文](README.zh-CN.md) | [English](README.en.md) | [한국어](README.ko.md)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Y8H028VWRF)

# sommelier：Claude Code のモデルを自動で選ぶ plugin（Claude Code mods）

タスクに応じて Claude Code の「モデル · effort」を自動で選ぶ plugin です。**Claude Code mods**（mods API の `turn.step`）で実装しています。単純なリクエストは **Claude Haiku**、実装内容が明確なものは **Claude Sonnet**、調査や設計が必要なものは **Claude Opus** に振り分けます。リクエストの分類には **TypeSafe Jev** を使い、品質を落とさずに Claude Code の使用量と枠を節約します。

ソムリエが料理に合わせてワインを選ぶように、sommelier は新しいリクエストを送信するたびに [TypeSafe Jev](https://docs.typesafe.ai)（確率を返す分類 API）に 3 点を判定させます。**どれだけ深い推論が必要か**、**新しい話題かどうか**、**リスクの高い操作かどうか**です。その結果を、調整可能な段階表に対応させます。

| 推論の深さ | デフォルトの段 | 例 |
|---|---|---|
| L0 参照または機械的な修正 | haiku · medium | 「package.json の version を確認して」 |
| L1 目的もやり方も明確 | sonnet · medium | 「parseDate にタイムゾーン引数を追加して」 |
| L2 先に調査や比較検討が必要 | `base`（opus · medium） | 「ログインが時々 401 になる。原因を探して」 |
| L3 明確な境界がなく、長い推論が必要 | opus · high | 「マルチテナントの権限アーキテクチャを設計して」 |

**なぜ毎ターンモデルを切り替えないのか？** モデルごとに prompt cache が別々にあるため、モデルを切り替えると会話全体を cache に書き直すことになり、これも枠を消費します。そこで sommelier の方針は、**上げるのはいつでも行い、下げるのは割に合うときだけ行う**ことです。つまり、新しい話題であり、かつ切り替えコストが節約できる枠より小さい場合に限ります。

## クイックスタート

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
# 次の行を実行したら TypeSafe API key を貼り付けて Enter を押します（key は画面に表示されません）
read -rs TYPESAFE_API_KEY
# key を macOS Keychain に保存します
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

API key は [TypeSafe console](https://console.typesafe.ai/keys) で作成します。`~/.zshrc` に `TYPESAFE_API_KEY` をすでに設定している場合は、`read` の行を省略できます。

Claude Code を再起動すると自動的に有効になり、ほかに設定は不要です。

1. リクエストを送信します（例：「parseDate にタイムゾーン引数を追加して」）
2. spinner に選ばれた段が表示されます（例：`sonnet·medium L1 · 新話題，降級`（新しい話題、ダウングレード））

使うのをやめるときは `/somm off` と入力します。詳しい手順は[インストール](#インストール)と[使い方](#使い方)を参照してください。

## AI agent にインストールを任せる

まず TypeSafe API key を用意します。key は agent に渡さず、自分で環境変数として設定してください。

1. [TypeSafe console](https://console.typesafe.ai/keys) で API key を作成します
2. ターミナルで次の行を実行し、`your-api-key` を自分の key に置き換えて `~/.zshrc` に書き込みます。

   ```bash
   echo 'export TYPESAFE_API_KEY="your-api-key"' >> ~/.zshrc
   ```

3. ターミナルと Claude Code を開き直して、新しい環境変数を反映させます

設定が済んだら、次の文を Claude Code などの coding agent に貼り付けます。

> https://github.com/wide3751/sommelier/blob/main/INSTALL-AGENT.md に従って sommelier をインストールして

## 必要環境

- Claude Code **v2.1.287 以上**（ターミナル）、または Desktop app 内蔵の **v2.1.286 以上**（Code tab で `/status` を入力して確認）
- TypeSafe API key（[TypeSafe console](https://console.typesafe.ai/keys) で作成）

## インストール

1. marketplace を追加してインストールします。方法は 2 つあり、**GitHub からの方法をおすすめします**。

   **方法 A：GitHub からインストール（おすすめ）**。プロジェクトのダウンロードは不要です。

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
```

   あとで新しいバージョンに更新するときは、marketplace、plugin の順に更新してから Claude Code を再起動します（インストール済みの状態で `install` を再実行しても更新されません）。

```bash
claude plugin marketplace update sommelier
claude plugin update sommelier@sommelier
```

   **方法 B：ローカルフォルダからインストール**。すでにプロジェクトを clone していて、自分で変更したバージョンを入れたい場合に向いています。

```bash
git clone https://github.com/wide3751/sommelier.git ~/Projects/sommelier
claude plugin marketplace add ~/Projects/sommelier
claude plugin install sommelier@sommelier
```

2. TypeSafe API key を設定します（macOS Keychain に保存）。ターミナル版では session 内で `/plugin configure sommelier@sommelier` を実行できます。Desktop app の Code tab では入力欄が表示されないため、ターミナルで次を実行してください。

```bash
# 次の行を実行したら TypeSafe API key を貼り付けて Enter を押します（key は画面に表示されません）
read -rs TYPESAFE_API_KEY
# key を macOS Keychain に保存します
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

   key をコマンドに直接書く必要はありません。`read` が貼り付けを待ち、このターミナルの `TYPESAFE_API_KEY` 変数に保持し、次の行でそれを Keychain に保存します。そのため key が shell の履歴に残りません。`~/.zshrc` に `TYPESAFE_API_KEY` をすでに設定している場合は `read` の行を省略できますが、現在の shell から読めることを確認してください（たとえば新しいターミナルウィンドウを開きます）。環境変数 `TYPESAFE_API_KEY` だけをフォールバックとして使うこともできますが、Dock から起動した Desktop app は `~/.zshrc` を読みません。

### Windows でのインストール

手順 1（marketplace の追加とインストール）のコマンドは PowerShell でもそのまま使えます。ローカルフォルダを使う場合はパスを Windows 形式にします（例：`claude plugin marketplace add C:\Projects\sommelier`）。

手順 2 の `read -rs` は PowerShell にないため、代わりに次のコードを PowerShell で実行します（Windows PowerShell 5.1 と PowerShell 7 の両方で動作します）。

```powershell
# 次の行を実行したら TypeSafe API key を貼り付けて Enter を押します（key は画面に表示されません）
$s = Read-Host "TypeSafe API key" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $s).Password
# Claude Code に渡して plugin の設定として保存します
'{"typesafe_api_key":"' + $key + '"}' | claude plugin configure sommelier@sommelier --values-stdin
Remove-Variable key, s
```

Keychain は macOS 専用です。Windows では key は Claude Code の plugin 設定に保存されます。環境変数をフォールバックとして使いたい場合は、key をユーザー環境変数として永続的に書き込み（`your-api-key` を自分の key に置き換えます）、ターミナルと Claude Code を開き直してください。

```powershell
[Environment]::SetEnvironmentVariable("TYPESAFE_API_KEY", "your-api-key", "User")
```

3. Claude Code を再起動し、`/somm status` と入力して「API key 已設定」（API key 設定済み）と表示されることを確認します。

## 使い方

インストール後はデフォルトで**有効**です。`/somm on` を別途入力する必要はありません。リクエストを初めて TypeSafe に送る前に確認が表示されます。同意すれば二度と尋ねられません。同意しない場合、そのターンは元のモデルのまま進み、sommelier は無効になります。

| コマンド | 説明 |
|---|---|
| `/somm on` | 再び有効にします。以降に送信するすべてのリクエストを Jev が判定します（短い返答を除く） |
| `/somm off` | 無効にし、session 自身のモデルと effort をそのまま使います |
| `/somm off --project` | 現在のプロジェクトだけ無効にします。このプロジェクトの内容は送信されません。`/somm on --project` で元に戻せます |
| `/somm status` | 有効／無効、このプロジェクトが無効かどうか、API key が設定済みかどうか、この session の段を表示します |
| `/somm log [n]` | 直近 n 件の振り分け記録：選ばれた段、Jev の確率、cache の読み書き量 |
| `/somm events` | 直近 20 件の状態イベント（モデルの切り替え、会話のクリアや再開、prompt の出どころ、各ターンの振り分け結果）。sommelier がなぜモデルを切り替えなかったのかを調べるのに使います |
| `/somm config` | 現在の設定を一覧表示します。`/somm config <名前> <値>` で変更でき、すぐに反映されます |

**設定**（`/somm config <名前> <値>`）：

| 名前 | デフォルト | 指定できる値 |
|---|---|---|
| `enabled` | on | on／off。`/somm on`、`/somm off` と同じ |
| `base` | opus | 調査や比較が必要なリクエスト（L2）に使う段で、高リスクのリクエストの最低モデルでもあります。`haiku`／`sonnet`／`opus`。effort を付けられます（例：`opus:high`） |
| `profile` | balanced | `saver`（枠の節約優先：opus の利用を控えめにし、話題の切り替えを遅めに判断）、`balanced`（バランス）、`quality`（品質優先：sonnet／opus を早めに使い、haiku は 15k 以内の会話だけ）。中国語名でも指定できます |
| `allowed` | haiku-opus | sommelier が選べるモデルの範囲。たとえば `sonnet-opus` なら haiku は使いません。`somm:` による上書きは制限されません |
| `spinner` | on | Claude の作業中に spinner の横にこのターンの判定を表示するかどうか |
| `cache` | on | ステータスラインに cache ゲージを表示するかどうか。`off` ではモデルと effort だけを表示します |
| `notify` | important | 重要な通知を表示します：上書きやダウングレードで cache の書き直しが発生するとき、Jev が 3 回連続で判定に失敗したとき、API key がないとき（一度だけ通知）。同じターンでは最大 1 件で、10 秒以内に複数ある場合は最新の 1 件だけを後から表示します。`off` で通知しません |
| `skills` | off | skill ヒントのオン／オフ（beta、デフォルトはオフ）。`on` で有効になります。`off` は skill ヒントだけを止め、モデル選択は通常どおり動きます |
| `skills-allow` | （すべて） | ここに挙げた skill だけを候補にします。カンマ区切りで、名前は `/skills` に表示されるとおりに書きます（例：`mattpocock-skills:tdd,grilling`）。`none` で空にします |
| `skills-exclude` | （なし） | ここに挙げた skill はヒントに出しません。書き方は上と同じです。`skills-allow` と両方に挙げた skill は除外が優先されます |

有効にすると、prompt の下のステータスラインに、実際に回答したモデル・バージョン・effort が表示され、続けて cache ゲージが表示されます（例：`🍷 opus 5.5·medium ▰▰▱▱▱ 95k`）。その横に Claude Code 自身が表示するのは session のモデルです。

**cache ゲージ**：数字は現在のモデルに蓄積された cache の量です。5 つのセルは、allowed の範囲内で 1 つ下のモデルへ切り替えるコスト（cache を書き直す費用）が、見込まれる節約枠のどれくらいにあたるかを表し、1 セルが 20% です。セルが埋まるほど、下げても割に合いません。全セルが埋まったうえで `⚠` が付く場合（例：`▰▰▰▰▰⚠ 243k`）は、切り替えコストが節約できる枠を上回っていることを示し、sommelier はこのときダウングレードを止めます。自分で切り替えることもおすすめしません。cache の期限が切れている場合や、すでに allowed 内で最も低いモデルを使っている場合は、セルはすべて空になります。ステータスラインは色を付けられないため、全セル埋まり＋`⚠` を警告の代わりにしています。表示が窮屈に感じるときは `/somm config cache off` でオフにできます。

<img src="assets/status-line/status-line.en.png" alt="ステータスラインの cache ゲージの 4 つの状況での表示（イメージ図）" width="640">

<sub>イメージ図：会話の開始直後、会話が長くなった状態、モデルの切り替えが推奨されない状態、すでに最も低いモデルを使っている状態。</sub>

`/somm` が他の plugin に使われている場合は、自動的に `/sommelier` に切り替わります。

**モデルを自分で指定する（上書き）**：prompt の先頭に `somm:opus`、`somm:sonnet`、`somm:haiku` のいずれかを書く（大文字小文字は区別しません）と、その 1 文は指定したモデル（effort は medium）で処理され、Jev には送りません。接頭辞は先に取り除かれるため、モデルには見えません。以降、同じ話題の間はこのモデルが使われ続け、Jev が新しい話題と判定するか、`/clear` するか、`/model` でモデルを変更するまで続きます。接頭辞だけで内容がない場合は何も送信せず、以降に使うモデルだけを設定します。モデルの切り替えで cache の書き直しが発生する場合は、書き直すトークン数とおおよその金額を知らせる通知が表示されます。

**各リクエストの決まり方：**
- **アップグレード**：より強いモデルやより高い effort が必要と判断されたら、いつでも上に切り替えます
- **高リスク**：データの削除や上書き、本番環境や権限の変更にあたるリクエストは、モデルを少なくとも base（デフォルトは opus）にし、その 1 文だけ effort を high に引き上げ、次の 1 文では元の effort に戻します
- **深く考えるよう要求**：prompt に `ultrathink`、「仔細想」、「深入想」が含まれる場合（コードブロック内は対象外）、Jev に送らず直接 opus · high を使います
- **ダウングレード**：新しい話題であり、かつ見込まれる節約枠が cache の書き直しコストを上回る場合にだけ下げます。それ以外は、その 1 文は現在のモデルのままです
- **維持**：同じ話題で判定が低いとき、短い返答（例：「好」「繼續」。Jev には送りません）のとき、Jev がタイムアウトしたりエラーを返したときは、現在のモデルを維持します
- **長い会話では haiku を使わない**：会話が 30k tokens を超えている場合は haiku に下げません。すでに haiku を使っている会話がこの長さを超えたら、sonnet に切り替えます

**skill ヒント**（beta、デフォルトはオフ。`/somm config skills on` で有効化）：モデルを判定するのと同時に、Jev はこの 1 文に skill が必要かどうか、必要ならどれが最適かも判定します。十分な確信が得られた場合（「skill が必要」≥ 0.30 かつ 1 位が ≥ 0.5）、sommelier はその 1 文の横に Claude 向けのヒントを添えます（例：「このリクエストには skill『tdd』が合いそうです（誤りの可能性あり）」）。これはあくまで提案であり、Claude が当てはまらないと判断すれば無視されます。ヒントがモデルに影響することはありません。候補は、この session で Claude が自分で呼び出せて、かつ説明が付いている skill で、`skills-allow` と `skills-exclude` で絞り込めます。同じ話題の中では同じ skill を一度しかヒントに出さず、話題が変わるか `/clear` した後に再び出ます。ヒントがあるときは spinner に `💡tdd` が表示され、`/somm log` には Claude が採用したかどうかが記録されます。skill ヒントを有効にしている間は、ヒントを添えるために Jev の判定を待つ必要があるため、prompt を送信した後は Jev をまず待ちます（最大 1.5 秒）。

### 選べるモデルと skill

**モデル**：sommelier は下の 3 つのモデルの中からだけ選び、effort は medium か high だけを使います。

| モデル | 送信するモデル ID | sommelier がこのモデルを選ぶ場面 |
|---|---|---|
| haiku | `claude-haiku-5-5` | L0。会話が 30k tokens を超えたら使わない |
| sonnet | `claude-sonnet-5-5` | L1。haiku の会話が長くなったときにもこちらに切り替える |
| opus | `claude-opus-5-5` | L2（base、medium）、L3、深く考えるよう要求された場合（high）。高リスクのリクエストは少なくとも base を使う |

日付サフィックス付きの ID（例：`claude-sonnet-5-5-20261001`）も認識されます。選べる範囲を変えるには次のようにします。

- **範囲を狭める**：`/somm config allowed sonnet-opus` なら haiku を使いません。`opus-opus` は opus だけを使う設定です
- **L2 の段を変える**：`/somm config base sonnet` または `opus:high`。どのモデルにも medium／high を付けられますが、`allowed` の範囲内である必要があります
- **この話題だけモデルを指定する**：prompt の先頭に `somm:haiku`、`somm:sonnet`、`somm:opus` を書きます（effort は medium 固定で、`allowed` の制限を受けません）
- **完全に自分で決める**：`/model` で session のモデルを変更します。Default に戻すまで、sommelier はモデルを変更しません

**skill**（skill ヒントが有効な場合）：ヒントの候補になる skill はその session で決まり、別途登録する必要はありません。

- **候補になるもの**：Claude が自分で呼び出せて、かつ説明が付いている skill、つまり `/skills` に一覧表示され、手動呼び出し専用に設定されていないものです。plugin の skill は `plugin名:skill名` の形式で書きます（例：`mattpocock-skills:tdd`）
- **数**：名前順に並べて最大 255 個まで。超えた分は無視されます。2 個未満のときは Jev に skill の質問をしません
- **特定のものだけヒントにする**：`/somm config skills-allow mattpocock-skills:tdd,grilling`。`none` で空にすると、すべてが対象に戻ります
- **特定のものを除外する**：`/somm config skills-exclude cost-today`。両方のリストに載っている場合は除外が優先されます
- **効果を確認する**：`/somm log` に、各文でどの skill をヒントに出したか、Claude が採用したかどうかが記録されます

**次の場合、sommelier はモデルを変更しません：**
- 無効のとき、または現在のプロジェクトが無効にされているとき
- 初回送信前の確認に同意しなかったとき
- session の最初の 1 文で Jev が失敗したとき、または API key が設定されていないとき（それ以降の文で失敗した場合は現在のモデルを維持します）
- subagent のリクエストのとき

### 例

プラグインのメッセージは現在中国語で表示されます。日本語の説明はコメントで添えています。

有効にした状態で「parseDate にタイムゾーン引数を追加して」と送信します。Jev が L1 と判定し、session の opus から sonnet に下がり、spinner には次のように表示されます。

```
sonnet·medium L1 · 新話題，降級   # 新しい話題、ダウングレード
```

続けて「好」（OK）と返信します。短い返答は Jev に送られず、同じ段が維持されます。

```
sonnet·medium · 沿用             # 維持
```

さらに「マルチテナントの権限アーキテクチャを設計して」と依頼します。Jev が L3 と判定し、アップグレードされます。

```
opus·high L3 · 升級              # アップグレード
```

`/somm status`：

```
sommelier 開啟｜API key 已設定｜本 session 檔位 sonnet·medium
# sommelier 有効｜API key 設定済み｜この session の段は sonnet·medium
```

`/somm log 3`：P は Jev が L0／L1／L2／L3 と判定した確率です。`session` は、そのターンで session 自身のモデルが使われたことを表します。「回答」は実際に回答したモデルで、角かっこ内は session の先頭 6 文字です。

```
sonnet·medium · 回答 sonnet · downgrade P=0.05/0.90/0.05/0.00 jev 820ms cache read 0 write 18342 [a1b2c3]
sonnet·medium · 回答 sonnet · continuation cache read 18342 write 1204 [a1b2c3]
opus·high · 回答 opus · upgrade P=0.02/0.08/0.20/0.70 jev 410ms cache read 0 write 21530 [a1b2c3]
```

## 制限事項

- **手動の `/model`**：`/model` でモデルを変更すると、sommelier はそれ以降モデルを変更しなくなります。`/clear` や会話の再開をした後も同様で、`/model` で Default に戻すまで続きます。Claude Code が自動で別のモデルに fallback した場合も、手動で `/model` を実行するまで sommelier は手を引きます。
- **判定しないターン**：通知、スケジュール、他の session や他の plugin から届くメッセージ、および slash コマンドは、現在のモデルのまま処理され、Jev には送られません。session のモデルが Opus／Sonnet／Haiku 5.5 でない場合（例：`[1m]` 版や旧バージョン）、sommelier は何も変更しません。
- **割に合わないなら下げない**：モデルごとに cache が別々にあり、モデルを切り替えると会話を新しいモデルの cache に書き込むことになります。sommelier は各モデルの cache がどこまで及んでいるかを記録しています。一度も使っていないモデルや、cache の有効期間を超えて放置されたモデルに切り替えると、全体を書き直す必要があります。直前まで使っていたモデルに戻す場合は差分だけを補います。`/clear`、compact、resume の後は、システムプロンプトだけが cache に残っています。下げるときは「書き直しコスト」と「見込まれる 3 ターン分の節約額」を比較し、元が取れないならその 1 文は元のモデルのまま進め、次の新しい話題で改めて評価します。上げる場合は影響を受けません。価格は公式の定価を使っており、`hooks/decide.ts` に記載しています。
- **モデル選択メニューに表示されるのは session のモデル**：sommelier が変更するのは送信される個々のリクエストであり、session 自体のモデルは変更しません。そのため `/model` や Desktop のモデル選択メニューには、元のモデルが表示され続けます。実際に回答したモデルは、ステータスラインの 🍷 の後ろのモデルで確認できます。
- **Jev の判定には時間がかかる**：各リクエストの判定は最大 1.5 秒待ちます（オフライン評価の p95 は約 0.4 秒）。短い返答は Jev に送らないので、待つ必要はありません。
- **Desktop app**：Code tab では `/plugin configure` で API key を入力できないため、ターミナルで設定してください（「インストール」を参照）。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `/somm status` に「API key 未設定」（API key が未設定）と表示される | 「インストール」の手順 2 をやり直してください。環境変数だけに頼っている場合は、Claude Code を起動した shell から `TYPESAFE_API_KEY` が読めることを確認してください。Dock から起動した Desktop app は `~/.zshrc` を読みません |
| spinner に「Jev 失敗」（Jev が失敗）と表示される | `/somm log` で原因を確認してください。`no_key` は key がないこと、`timeout` は 1.5 秒を超えたこと、`http_401` などは API が返したエラー、`fetch_failed` は TypeSafe に接続できないことを表します。そのターンは現在のモデルのまま進みます。session の最初の 1 文で失敗した場合は、session 自身のモデルを使います |
| `/somm` コマンドが見つからない | 他の plugin に使われているため、`/sommelier` を使ってください |
| コードを変更したのに反映されない | 正式にインストールしたものは `plugin.json` の `version` でキャッシュされます。バージョン番号を上げてから `claude plugin update sommelier@sommelier` を実行して再起動するか、開発中は `--plugin-dir` を使ってください |

## プライバシーとデータ

sommelier はインストール後にデフォルトで有効になり、有効な間は判定のためにデータを TypeSafe に送信します。初めて送信する前に同意を求められます。`/somm off` で無効にすると、何も送信されなくなります。

- **送信するタイミング**：新しいリクエストはすべて送信します。短い返答（空白や句読点を除いて 8 文字以内。例：「好」「繼續」）は送信しません
- **送信する内容**：その 1 文のリクエスト（最大 2000 文字）と、直近 3 ターンの会話のテキスト（1 件につき最大 500 文字で、末尾を残します）。skill ヒントが有効な場合は、これに加えて候補 skill の名前と説明（1 件につき最大 300 文字）も送ります。初回の確認には skill は含まれません。skill ヒントを有効にした後、skill のデータを初めて送る前に別途確認があり、同意しなかった場合は skill ヒントだけが無効になります
- **送信前のマスキング**：一般的な秘密情報の形式は `[REDACTED]` に置き換えられます。対象は `sk-`、`AKIA`、`ghp_`、`xoxb-`／`xoxp-`、`AIza`、`Bearer`、`password=`、JWT、秘密鍵ブロック、および 32 文字以上の 16 進数文字列です
- **送信しないもの**：ファイルの内容、ツール呼び出しとツールの出力、subagent のリクエスト、および `/somm off --project` で無効にしたプロジェクト
- **ローカルの記録**：`/somm log` の記録には、選ばれた段、Jev の確率、レイテンシ、cache の読み書き量、ヒントに出した skill と採用されたかどうか、そして prompt の先頭 40 文字（マスキング後）が保存されます。無効にしたプロジェクトでは prompt を保存しません。そのほか、各 session の振り分け状態（現在の段、cache の台帳、上書きロックなど。prompt は含まない）もローカルに保存され、plugin の更新後も実行中の session が続行できるようになっています。保存されるのは最新の 20 session だけです
- **API key**：macOS Keychain に保存されます（`/plugin configure`）。または環境変数 `TYPESAFE_API_KEY` から読み取ります

## 開発に参加する

開発環境、オフライン評価、プロジェクト構成については [CONTRIBUTING.md](CONTRIBUTING.md)（中国語）を参照してください。

## ドキュメント

- [GLOSSARY.md](GLOSSARY.md)：用語の定義（段、新しい話題、cache の台帳…）

## ライセンス

[MIT](LICENSE)
