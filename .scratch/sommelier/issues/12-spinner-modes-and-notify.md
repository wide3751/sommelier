# 12: spinner 模式與 notify 通知

**What to build:** spinner 後綴依 `spinner` 設定顯示 full／model／changes／off；toast 依 `notify` 設定：important（覆寫造成 cache 重建、Jev 連續失敗 3 次）、switches（再加上每次換模型，只調 effort 不跳）、off。同一輪最多一則，10 秒內多則只顯示最新。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] spinner 四種模式文字正確，原因使用短中文標籤
- [ ] notify 三段行為正確；只調 effort 不跳 toast
- [ ] 同輪最多一則、10 秒合併（`mock.clock` 測試）
- [ ] 以上行為皆有自動化測試
