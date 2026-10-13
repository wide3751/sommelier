# 10: 設定：`/somm config`、profile、base、階梯表

**What to build:** `/somm config <名稱> <值>` 調整 6 個日常設定（enabled、base、profile、allowed、spinner、notify），`/somm config --advanced` 編輯進階 JSON（階梯表各格、各門檻、逾時、延續詞、關鍵字、指令對照表、遮蔽樣式、紀錄上限、shadow 參數）。修改立即生效。把 05–09 中寫死的值改為讀設定。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 6 個日常設定可讀寫、有合法值檢查、立即生效
- [ ] profile 切換改變 τ_opus／τ_sonnet／τ_new／τ_risk／short_ctx／haiku_max_ctx
- [ ] `base` 改變 L2 檔位與退回參考；`allowed` 夾住檔位範圍
- [ ] 進階 JSON 可覆蓋單一參數；固定常數不可改
- [ ] 既有門檻與預設值全部改為讀設定，行為不變（既有測試仍通過）
- [ ] 以上行為皆有自動化測試
