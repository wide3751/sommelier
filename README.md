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

## 需求

- Claude Code **v2.1.287 以上**（終端機），或 Desktop app 內建版本 **v2.1.286 以上**（在 Code tab 輸入 `/status` 查看）
- TypeSafe API key

## 安裝

1. 加入本機 marketplace 並安裝：

```bash
claude plugin marketplace add ~/Projects/sommelier
```

```bash
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

**隱私**：開啟後，每次判斷會把「這一句」和「最近 3 輪對話的文字」送到 TypeSafe，不包含檔案內容與工具輸出。送出前遮蔽密鑰、依專案停用等功能規劃在 ticket 09。

## 開發

```bash
claude --plugin-dir ~/Projects/sommelier   # 載入開發中的版本，存檔後自動重新載入
claude plugin validate ~/Projects/sommelier
cd ~/Projects/sommelier && claude plugin test
```

正式安裝的版本會依 `plugin.json` 的 `version` 快取一份副本。改了程式碼後要先把版本號加一，再重新安裝，改動才會生效。開發時建議用 `--plugin-dir`。

**離線評測**：不經過 Claude Code，直接呼叫 Jev，量測判斷品質與延遲：

```bash
TYPESAFE_API_KEY=... python3 eval/run_eval.py --tag 名稱
```

題目定義只有一份，放在 [hooks/questions.ts](hooks/questions.ts)，mod 和評測腳本共用。題庫在 [eval/dataset.jsonl](eval/dataset.jsonl)，報告輸出到 `eval/reports/`。

## 專案結構

```
hooks/
  register.ts    mod 進入點：指令、turn 事件、呼叫 Jev（所有 $ 呼叫都在這裡）
  decide.ts      分派邏輯：階梯表與累積機率規則（純函式）
  jevState.ts    組成送給 Jev 的對話內容（只取文字、保留結尾）
  questions.ts   送給 Jev 的三題定義
tests/           claude plugin test 的自動化測試
eval/            離線評測題庫、腳本與報告
GLOSSARY.md      領域用語
```

## 文件

- [GLOSSARY.md](GLOSSARY.md)：用語定義（檔位、新話題、cache 帳…）
