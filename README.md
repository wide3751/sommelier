<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier" width="420">
</p>

[English](README.en.md)

依任務替 Claude Code 挑選「模型 · effort」的 plugin（mod）。

就像侍酒師依菜色挑酒，sommelier 在你送出每個新請求時，請 [TypeSafe Jev](https://docs.typesafe.ai) 判斷三件事：**需要多深的推理**、**是不是新話題**、**是不是高風險操作**，再對應到一張可調整的階梯表：

| 推理深度 | 預設檔位 | 例子 |
|---|---|---|
| L0 查詢或機械性修改 | haiku · medium | 「看一下 package.json 的 version」 |
| L1 目標和做法都明確 | sonnet · medium | 「幫 parseDate 加上時區參數」 |
| L2 要先調查或取捨 | `base`（opus · medium） | 「登入偶爾 401，找出原因」 |
| L3 沒有明確邊界、需要長時間推演 | opus · high | 「設計多租戶權限架構」 |

**為什麼不每輪都換模型？** 每個模型各有一份 prompt cache，換模型就要把整段對話重新寫入 cache，同樣消耗額度。所以 sommelier 的原則是：**往上升隨時可以；往下降只在划算時才做**，也就是新話題、而且切換成本低於能省下的額度時。

## 快速開始

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

重新啟動 Claude Code 後：

1. 輸入 `/somm on`
2. 送出一個請求，例如「幫 parseDate 加上時區參數」
3. spinner 會顯示選到的檔位，例如 `sonnet·medium L1 · 新話題`

不想用了就輸入 `/somm off`。詳細步驟見[安裝](#安裝)與[使用](#使用)。

## 需求

- Claude Code **v2.1.287 以上**（終端機），或 Desktop app 內建版本 **v2.1.286 以上**（在 Code tab 輸入 `/status` 查看）
- TypeSafe API key

## 安裝

1. 加入 marketplace 並安裝。有兩種方式，**建議用 GitHub**：

   **方式 A：從 GitHub 安裝（建議）**，不用下載專案：

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
```

   之後要更新到新版本，執行 `claude plugin marketplace update sommelier` 再重新安裝。

   **方式 B：從本機資料夾安裝**，適合已經 clone 專案、想裝自己改過的版本：

```bash
git clone https://github.com/wide3751/sommelier.git ~/Projects/sommelier
claude plugin marketplace add ~/Projects/sommelier
claude plugin install sommelier@sommelier
```

2. 設定 TypeSafe API key（存進 macOS Keychain）。終端機版可以在 session 裡執行 `/plugin configure sommelier@sommelier`；Desktop app 的 Code tab 不會跳出輸入框，請改在終端機執行：

```bash
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

   執行前要確認目前的 shell 讀得到 `TYPESAFE_API_KEY`（例如新開一個終端機視窗）。也可以只設定環境變數 `TYPESAFE_API_KEY` 當作備援，但從 Dock 開啟的 Desktop app 讀不到 `~/.zshrc`。

3. 重新啟動 Claude Code，輸入 `/somm status`，確認顯示「API key 已設定」。

## 使用

預設是**關閉**的。

| 指令 | 說明 |
|---|---|
| `/somm on` | 開啟。接下來你送出的第一句話會交給 Jev 判斷 |
| `/somm off` | 關閉，沿用 session 自己的模型與 effort |
| `/somm status` | 顯示開關、API key 是否設定、本 session 的檔位 |
| `/somm log [n]` | 最近 n 筆分派紀錄：選了哪個檔位、Jev 的機率、cache 讀寫量 |

`/somm` 如果被其他 plugin 占用，會自動改用 `/sommelier`。

**以下情況 sommelier 不會改動模型：**
- 關閉時
- Jev 逾時（1.5 秒）、回傳錯誤，或沒有設定 API key
- subagent 的請求

### 範例

開啟後送出「幫 parseDate 加上時區參數」，Jev 判斷為 L1，spinner 會顯示：

```
sonnet·medium L1 · 新話題
```

之後的每一輪沿用同一個檔位：

```
sonnet·medium · 沿用
```

`/somm status`：

```
sommelier 開啟｜API key 已設定｜本 session 檔位 sonnet·medium
```

`/somm log 3`：P 是 Jev 判斷為 L0／L1／L2／L3 的機率；判斷失敗的那一輪會顯示 `session`，沿用原本的模型：

```
sonnet·medium · first_turn P=0.05/0.90/0.05/0.00 jev 820ms cache read 0 write 18342
sonnet·medium · continuation cache read 18342 write 1204
session · jev_failed:timeout cache read 0 write 15873
```

## 限制

- **只判斷第一句**：開啟後只有 session 的第一個請求交給 Jev 判斷，之後每一輪都沿用同一個檔位。換話題不會重新判斷。
- **手動 `/model` 和 `/clear`**：手動切換模型、清除或恢復對話之後，sommelier 的行為還沒驗證完，結果可能不如預期。需要固定模型時，建議先 `/somm off`。
- **Jev 判斷要時間**：每次判斷最多等 1.5 秒，第一個請求的回應會稍微慢一點。
- **Desktop app**：Code tab 不能用 `/plugin configure` 輸入 API key，要改在終端機設定（見「安裝」）。

## 疑難排解

| 症狀 | 做法 |
|---|---|
| `/somm status` 顯示「API key 未設定」 | 照「安裝」第 2 步重新設定。只靠環境變數的話，確認啟動 Claude Code 的 shell 讀得到 `TYPESAFE_API_KEY`；從 Dock 開啟的 Desktop app 讀不到 `~/.zshrc` |
| spinner 顯示「session · Jev 失敗」 | 用 `/somm log` 看原因：`no_key` 是沒有 key，`timeout` 是超過 1.5 秒，`http_401` 等是 API 回傳錯誤，`fetch_failed` 是連不上 TypeSafe。這一輪會沿用 session 自己的模型 |
| `/somm` 指令不見了 | 被其他 plugin 占用，改用 `/sommelier` |
| 改了程式碼沒有生效 | 正式安裝版依 `plugin.json` 的 `version` 快取。版本號加一後重新安裝，或開發時改用 `--plugin-dir` |

## 隱私與資料

開啟後，sommelier 會把資料送到 TypeSafe 判斷。關閉時不會送出任何東西。

- **什麼時候送**：目前只有 session 的第一個請求會送出（之後逐句判斷時，每個新請求都會送）
- **送出什麼**：這一句請求（最多 2000 字），以及最近 3 輪對話的文字（每則最多 500 字，只保留結尾）
- **不送什麼**：檔案內容、工具呼叫與工具輸出、subagent 的請求
- **本機紀錄**：`/somm log` 的紀錄只存檔位、Jev 的機率、延遲與 cache 讀寫量，不存對話內容
- **API key**：存在 macOS Keychain（`/plugin configure`），或從環境變數 `TYPESAFE_API_KEY` 讀取

送出前遮蔽密鑰、依專案停用等功能還在規劃中。

## 參與開發

開發環境、離線評測與專案結構見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文件

- [GLOSSARY.md](GLOSSARY.md)：用語定義（檔位、新話題、cache 帳…）

## 授權

[MIT](LICENSE)
