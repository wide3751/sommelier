# 01: 雛形 A：改模型與 effort、cache 量測

**What to build:** 不接 Jev。`/somm on` 之後，主對話的每個請求被改寫成一個寫死的檔位（可用 `/somm` 參數切換寫死值），spinner 顯示實際送出的模型 · effort。用這個雛形在真實 session 驗證 spec「開發順序」雛形清單中的 (a)(b)(c)(f)(i)(j)，把結果寫回 `docs/spec.md` 與 ADR 0001。任一項不成立時，先記錄並回報，不自行改設計。

**Blocked by:** None (can start immediately)；前置：Claude Code ≥ v2.1.287

**Status:** ready-for-agent

- [ ] (a) `turn.step` 改 `model` 生效，同一輪多個請求都套用，subagent（帶 `agentId`）不受影響
- [ ] (b) 在 opus 上只改 `effort`（medium → high）時，下一個請求的 `cache_read_input_tokens` 沒有歸零；結論記入 spec
- [ ] (c) 送出 prompt 時 Claude 仍在工作（排隊）的情況下，`turnId` 與判斷結果對應正確
- [ ] (f) 從 `turn.step` 的結果拿得到每個請求的 cache 讀寫 token；實測「切到另一模型幾輪再切回」時的 cache 命中，結果記入 spec Further Notes
- [ ] (i) 在 `turn.step` 等待 3 秒不會觸到 hook 時限
- [ ] (j) 在 `turn.start` 發出的非同步工作（以 3 秒延遲模擬 Jev）能在第一個請求前完成並套用 effort
- [ ] 自動化測試涵蓋：同輪多請求同檔位、`agentId` 放行
