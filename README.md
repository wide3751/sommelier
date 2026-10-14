<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier：Claude Code 自動切換模型的 plugin" width="420">
</p>

[English](README.en.md)

# sommelier：Claude Code 自動選模型的 plugin（Claude Code mods）

依任務替 Claude Code 自動挑選「模型 · effort」的 plugin，用 **Claude Code mods**（mods API 的 `turn.step`）實作。簡單的請求交給 **Claude Haiku**，明確的實作交給 **Claude Sonnet**，需要調查或設計的交給 **Claude Opus**，用 **TypeSafe Jev** 分類請求，在不犧牲品質的前提下節省 Claude Code 的用量與額度。

就像侍酒師依菜色挑酒，sommelier 在你送出每個新請求時，請 [TypeSafe Jev](https://docs.typesafe.ai)（一個回傳機率的分類 API）判斷三件事：**需要多深的推理**、**是不是新話題**、**是不是高風險操作**，再對應到一張可調整的階梯表：

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

重新啟動 Claude Code 就會自動開啟，不用另外設定：

1. 送出一個請求，例如「幫 parseDate 加上時區參數」
2. spinner 會顯示選到的檔位，例如 `sonnet·medium L1 · 新話題`

不想用了就輸入 `/somm off`。詳細步驟見[安裝](#安裝)與[使用](#使用)。

## 讓 AI agent 幫你安裝

先準備好 TypeSafe API key。key 不要交給 agent，自己設定成環境變數：

1. 到 [TypeSafe console](https://console.typesafe.ai/keys) 建立 API key
2. 在終端機執行下面這行，把 `your-api-key` 換成你的 key，寫進 `~/.zshrc`：

   ```bash
   echo 'export TYPESAFE_API_KEY="your-api-key"' >> ~/.zshrc
   ```

3. 重新開啟終端機和 Claude Code，讓新的環境變數生效

設定好之後，把這句話貼給 Claude Code 或其他 coding agent：

> 照 https://github.com/wide3751/sommelier/blob/main/INSTALL-AGENT.md 安裝 sommelier

## 需求

- Claude Code **v2.1.287 以上**（終端機），或 Desktop app 內建版本 **v2.1.286 以上**（在 Code tab 輸入 `/status` 查看）
- TypeSafe API key（到 [TypeSafe console](https://console.typesafe.ai/keys) 建立）

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

安裝後預設**開啟**，不用另外輸入 `/somm on`。

| 指令 | 說明 |
|---|---|
| `/somm on` | 重新開啟。接下來你送出的第一句話會交給 Jev 判斷 |
| `/somm off` | 關閉，沿用 session 自己的模型與 effort |
| `/somm status` | 顯示開關、API key 是否設定、本 session 的檔位 |
| `/somm log [n]` | 最近 n 筆分派紀錄：選了哪個檔位、Jev 的機率、cache 讀寫量 |

開啟後，prompt 下方的狀態列會顯示實際回答的模型，例如 `🍷 實際模型 haiku·medium（預設 opus）`。括號裡是 session 自己設定的模型，只有被 sommelier 換掉時才會出現。

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
- **不划算就不降級**：換模型要把整段對話重寫進新模型的 cache。往下降時，sommelier 會用 Claude Code 回報的 context 大小（`$.session.usage().context.tokens`）和回應裡的 cache TTL，比較「重寫成本」和「預估 5 輪能省回的錢」，省不回來就沿用原模型，並在這個 session 停止判斷。往上升不受影響。價格用的是官方定價，寫在 `hooks/decide.ts`。
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

sommelier 安裝後預設開啟，開啟時會把資料送到 TypeSafe 判斷。用 `/somm off` 關閉後就不會送出任何東西。

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
