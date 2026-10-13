# 05: 任務狀態：只升不降與降級規則

**What to build:** sommelier 開始追蹤任務：判斷比目前高就升級並黏到任務結束；任務邊界（沒有任務、`new_task` ≥ τ_new）時，只有在免費切換點（session 第一輪、`/clear`／`/compact`／resume 後、閒置超過 cache TTL）或對話還短時才降級，否則成本擋下並重設任務基準；降到 haiku 受對話長度上限；任務中途在 haiku 且對話過長時升到 sonnet。

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] 升級一律允許並黏住；任務中途判斷較低時維持
- [ ] `classic.SessionStart` 依 source 標記免費切換點並清除任務；`/clear` 後第一輪可降級
- [ ] 閒置超過 TTL（訂閱 60 分鐘）視為免費切換點
- [ ] 長對話中的新任務 → `cost_blocked`，任務基準重設為目前實際檔位
- [ ] `對話 token − baseline < short_ctx` 時可降級；`baseline` 於 `/clear` 後第一輪實測
- [ ] 對話超過 `haiku_max_ctx` 時不降到 haiku（改 sonnet）；中途在 haiku 且超過上限 → 升到 sonnet
- [ ] 門檻暫用「平衡」profile 的寫死值（10 會改為讀設定）
- [ ] 以上行為皆有自動化測試（`mock.clock` 處理 TTL）
