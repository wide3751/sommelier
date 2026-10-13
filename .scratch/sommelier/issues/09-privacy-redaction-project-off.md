# 09: 隱私：遮蔽、專案停用、第一次開啟確認

**What to build:** 送給 Jev 之前遮蔽常見密鑰格式；`/somm off --project`／`on --project` 讓特定 repo 完全不送；第一次 `/somm on` 時說明會送出什麼、送到哪裡並請使用者確認；紀錄只存 prompt 前 40 字（遮蔽後）。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 送出的 body 中 `sk-`、`AKIA`、私鑰區塊、`password=`、JWT、`Bearer`、`ghp_`、`xox[bp]-`、`AIza`、長十六進位字串皆為 `[REDACTED]`
- [ ] 專案停用的 repo 不呼叫 `http.fetch`，原因記為 `project_off`
- [ ] 第一次開啟需要確認，之後不再詢問
- [ ] 紀錄摘要 ≤ 40 字且已遮蔽
- [ ] 以上行為皆有自動化測試
