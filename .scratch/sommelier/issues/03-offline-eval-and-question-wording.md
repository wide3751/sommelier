# 03: 離線評測與題目定稿

**What to build:** 建立一套不經過 Claude Code、直接打 Jev API 的評測：約 40 句中英混合題庫（三分之一是多輪接續），每句標好預期的 depth 等級、`new_task`、`high_risk`。跑出報告後定稿三題的措辭，以及三個 profile 的門檻初值。題庫標註交使用者審核。

**Blocked by:** None (can start immediately)；需要 TypeSafe API key

**Status:** ready-for-agent

- [ ] 題庫約 40 句，涵蓋 L0–L3、高風險與非高風險（含「刪掉這個 console.log」類）、多輪接續（如 L2 討論後「好，照這樣改」）；標註經使用者審核
- [x] 評測腳本可重跑，輸出報告到 repo（題庫與報告摘要進版控）
- [x] 報告含：depth 混淆矩陣、嚴重錯誤率（L2／L3 或高風險被分到 haiku）、`new_task` 準確率、`high_risk` 誤判率、Jev 延遲 p50／p95、三個 profile 下各檔位分佈
- [x] 嚴重錯誤率在「平衡」profile 為 0；做不到時在報告中說明並提出措辭或門檻調整
- [ ] 可選：中文與英文 instructions 的 A/B 結果
- [ ] 定稿的措辭與門檻寫回 `docs/spec.md`

## Comments

- 2026-10-13：第一輪評測（`eval/reports/20261013-221444-baseline.md`）。40 題全部成功，Jev p50 334 ms、p95 385 ms。depth 完全正確 88%、相差不超過一級 100%。三個 profile 的嚴重錯誤（難題或高風險被分到 haiku）都是 0。「平衡」只有 r06 分派過高一級；`new_task` 把延續誤判為新話題（會導致錯誤降級的方向）三個 profile 都是 0，唯一漏判 m15 由 high_risk（0.98）補上。high_risk 在 0.5 門檻零漏判、零誤判，「刪掉 console.log」為 0.04。題庫標註待使用者審核；英文措辭 A/B 未做（中文表現已足夠，列為可選）。
