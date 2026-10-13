# 11: status、export 與成本試算（shadow）

**What to build:** `/somm status` 顯示開關、base、profile、任務檔位、覆寫鎖定、手動／fallback 狀態、最近一次決定，並在 session 模型與 base 不一致、或長對話無法降級時給提示；`/somm export` 輸出 JSON 並附敏感提示；每輪背景計算完整成本公式並寫入紀錄，不影響分派。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] status 內容完整，含兩種提示（不一致、建議先 `/clear`）
- [ ] export 輸出全部紀錄並附提醒
- [ ] shadow 成本試算（切換成本、預期省下、是否會換）寫入每筆紀錄
- [ ] 紀錄超過上限依 key 刪最舊
- [ ] 以上行為皆有自動化測試
