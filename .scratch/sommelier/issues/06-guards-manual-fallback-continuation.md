# 06: 關卡：手動指定、fallback、沿用上一輪

**What to build:** 在不該介入的情況下 sommelier 一律退回或沿用：使用者手動換模型（直到選回 Default，`/clear`／resume 後仍記得）、Claude Code 自動 fallback 之後、session 模型不是支援的 5.5 系列、非使用者發起的輪、短回覆與延續詞（不送 Jev）、slash 指令（預設沿用，對照表可指定但受降級規則約束）。

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] `classic.PreModelSwitch` 設定手動指定，`requested_model` 為 null 時解除；`/clear` 後依「session 模型 ≠ 啟動模型」補回
- [ ] `classic.PostModelSwitch` source=auto 後不再改寫，直到手動 `/model`
- [ ] 支援清單以正規化後的完整模型 ID 比對，不以別名比對
- [ ] 非使用者發起的輪沿用上一輪決定，不呼叫 Jev
- [ ] ≤ 8 字或延續詞清單內的回覆不呼叫 Jev、沿用任務檔位
- [ ] slash 指令不送 Jev；對照表命中時仍經降級規則
- [ ] 以上行為皆有自動化測試
