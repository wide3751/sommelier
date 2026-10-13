# 03: 離線評測與題目定稿

**What to build:** 建立一套不經過 Claude Code、直接打 Jev API 的評測：約 40 句中英混合題庫（三分之一是多輪接續），每句標好預期的 depth 等級、`new_task`、`high_risk`。跑出報告後定稿三題的措辭，以及三個 profile 的門檻初值。題庫標註交使用者審核。

**Blocked by:** None (can start immediately)；需要 TypeSafe API key

**Status:** ready-for-agent

- [ ] 題庫約 40 句，涵蓋 L0–L3、高風險與非高風險（含「刪掉這個 console.log」類）、多輪接續（如 L2 討論後「好，照這樣改」）；標註經使用者審核
- [ ] 評測腳本可重跑，輸出報告到 repo（題庫與報告摘要進版控）
- [ ] 報告含：depth 混淆矩陣、嚴重錯誤率（L2／L3 或高風險被分到 haiku）、`new_task` 準確率、`high_risk` 誤判率、Jev 延遲 p50／p95、三個 profile 下各檔位分佈
- [ ] 嚴重錯誤率在「平衡」profile 為 0；做不到時在報告中說明並提出措辭或門檻調整
- [ ] 可選：中文與英文 instructions 的 A/B 結果
- [ ] 定稿的措辭與門檻寫回 `docs/spec.md`
