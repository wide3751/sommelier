# 04: 最小可用版本：第一輪依 Jev 分派

**What to build:** 使用者 `/somm on` 後，session 第一個由使用者發起的請求會被送去 Jev（三題同一請求，1.5 秒逾時），依累積機率規則對應到階梯表預設值，並套用到該輪所有主對話請求。之後的輪次暫時沿用第一輪的檔位。Jev 失敗或逾時就退回 session 的模型 · effort。spinner 顯示結果，每輪寫一筆分派紀錄。`/somm off` 關閉，預設關閉。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 預設關閉；`/somm on`／`/somm off` 切換並存在 store（`somm:` 前綴）
- [ ] 第一輪送給 Jev 的 body 含 `current_request` 與最近 3 輪文字（不含工具輸出、保留結尾）
- [ ] 累積機率規則正確對應到 L0–L3 檔位（措辭讀 `eval/questions.json`，已於 ticket 03 定稿）
- [ ] Jev 逾時（以 `$.clock` race 實作）、429、壞回應、無 key → 不改檔位、紀錄原因；晚到的回應被丟棄
- [ ] 同一輪多個請求同一檔位、Jev 只呼叫一次；帶 `agentId` 的請求不動
- [ ] 分派紀錄每筆一個 key，含機率、檔位、原因、cache token
- [ ] spinner 顯示 `🍷 <模型>·<effort>` 與原因
- [ ] hooks 模組的自動化測試涵蓋以上行為
