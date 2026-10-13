# 13: pane

**What to build:** `/somm` 不帶參數時打開 pane：最近 N 筆分派紀錄（depth 四機率、`new_task`、`high_risk`、原因、cache token）、開關按鈕、本 session 各模型次數、目前任務檔位、覆寫鎖定與手動／fallback／專案停用狀態。不能畫的環境改回文字回覆。

**Blocked by:** 11, 12

**Status:** ready-for-agent

- [ ] pane 顯示上述所有內容，終端機與 Desktop 皆可繪製（`$.ui.mount` 測試兩種 surface）
- [ ] 開關按鈕切換 enabled 並寫入 store
- [ ] 不能繪製的環境回覆文字摘要
- [ ] 以上行為皆有自動化測試
