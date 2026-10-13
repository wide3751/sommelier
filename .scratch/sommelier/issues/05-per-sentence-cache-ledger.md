# 05: 逐句判斷與 cache 帳：升級與降級規則

**What to build:** sommelier 每一句各自判斷，不累積任務狀態。維護一本 cache 帳（每個模型最後使用時間、涵蓋的 token 數、當時的訊息數，來自 API 回報）。判斷比目前檔位高就升級；不是新話題就不降級；是新話題（session 第一輪、`new_task` ≥ τ_new、`somm:auto`）時，用 cache 帳估算切到目標模型的冷 token 與切換成本，預期省下（H 輪）大於切換成本才降級，否則成本擋下。降到 haiku 受對話長度上限；目前在 haiku 且對話過長時升到 sonnet。依據見 ADR 0002。

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] cache 帳在每個主對話請求後依 `result.usage` 更新；`/clear`／compact／resume（`classic.SessionStart`）後所有模型標為冷；閒置超過 TTL 視為冷
- [ ] 冷 token 估算：從沒用過或已冷 → 整段（扣掉穩定前綴）；訊息數差超過 lookback 上限 → 整段；否則只補差額
- [ ] 升級一律允許並成為新的目前檔位
- [ ] 不是新話題時判斷較低也維持
- [ ] 新話題：預期省下 ≥ 切換成本才降級，否則 `cost_blocked`
- [ ] 對話超過 `haiku_max_ctx` 時不降到 haiku（改評估 sonnet）；目前在 haiku 且超過上限 → 升到 sonnet
- [ ] 每筆紀錄同時寫入估算的冷 token／切換成本與實際 cache 讀寫
- [ ] 門檻暫用「平衡」profile 的寫死值（10 會改為讀設定）
- [ ] 以上行為皆有自動化測試（`mock.clock` 處理 TTL）
