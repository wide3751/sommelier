# 08: 單輪覆寫 `somm:`

**What to build:** 使用者在 prompt 開頭寫 `somm:opus`、`somm:sonnet`、`somm:haiku`（可加 `:medium`／`:high`）時，前綴被剝除、不呼叫 Jev，目前檔位設為指定值並鎖定到下一個新話題；`somm:auto` 代表使用者宣告新話題，依 Jev 與 cache 帳判斷（可降級）。覆寫造成 cache 重建時提示。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] 前綴被剝除後才送給模型；不以 `!` 開頭（避免 bash 模式）
- [ ] 指定檔位鎖定到下一個新話題；鎖定期間自動判斷不改檔位；`:high` 生效
- [ ] `somm:auto` 視為新話題，依 cache 帳判斷是否降級
- [ ] 會重建 cache 的覆寫在 `notify` 非 off 時跳 toast（12 完成前可先用 log）
- [ ] 紀錄原因為 `override`／`override_auto`
- [ ] 以上行為皆有自動化測試
