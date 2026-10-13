# 11: status、export 與 cache 帳檢視

**What to build:** `/somm status` 顯示開關、base、profile、任務檔位、覆寫鎖定、手動／fallback 狀態、最近一次決定，並在 session 模型與 base 不一致、或長對話無法降級時給提示；`/somm export` 輸出 JSON 並附敏感提示；cache 帳摘要與「估算 vs 實際」cache 讀寫的比較可在 status 查看。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] status 內容完整，含兩種提示（不一致、建議先 `/clear`）
- [ ] export 輸出全部紀錄並附提醒
- [ ] status 顯示 cache 帳摘要（各模型冷熱、估計冷 token）與最近 N 輪估算誤差
- [ ] 紀錄超過上限依 key 刪最舊
- [ ] 以上行為皆有自動化測試
