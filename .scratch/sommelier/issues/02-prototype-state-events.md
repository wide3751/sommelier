# 02: 雛形 B：狀態事件

**What to build:** 驗證 sommelier 需要的狀態來源在真實 session 中的行為：手動換模型、自動 fallback、清除／恢復／壓縮對話、API key、這一輪是否由使用者發起。驗證 spec 雛形清單 (d)(e)(g)(h)，結果寫回 `docs/spec.md`。不實作分派邏輯，只把觀察到的事件與欄位用 log 或 `/somm` 回覆呈現。

**Blocked by:** None (can start immediately)；前置：Claude Code ≥ v2.1.287

**Status:** ready-for-agent

- [ ] (d) `/model` 觸發 `classic.PreModelSwitch` 且帶 `to_model`／`requested_model`；選回 Default 時 `requested_model` 為 null；`$.session.model()` 在 Default 時的回傳值、別名與完整模型 ID 的對應都已記錄
- [ ] (d) 能觸發或模擬一次 `classic.PostModelSwitch`（source=auto），或記錄無法觸發時的替代判斷方式
- [ ] (e) `classic.SessionStart` 的 `source` 能分辨 clear／resume／compact／startup；`/clear` 後 `$.state` 確實被重設；compact 的摘要請求是否經過 `turn.step` 已記錄
- [ ] (g) `register(on, options)` 的 `options` 讀得到 sensitive 的 `typesafe_api_key`；讀不到時 `$.env` 的 `TYPESAFE_API_KEY` 可用
- [ ] (h) 在 `turn.start` 能從 `$.session.messages()` 分辨使用者發起的輪與通知／排程／其他 mod 發起的輪
- [ ] 結論寫入 spec，與原設計不符之處標明需要的設計調整
