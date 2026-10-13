# 07: 高風險、ultrathink 與 effort 升級

**What to build:** `high_risk` 超過門檻時，目標檔位至少為 base，且只有本輪 effort 提高為 high、下一輪恢復；prompt 含 ultrathink 類關鍵字（排除程式碼區塊）時目標為 opus · high；同模型的升級只調 effort（依 01 的 cache 結論，若改 effort 會失效則改為只在邊界做）。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `high_risk ≥ τ_risk` → 模型至少 base 並黏住；effort high 只在本輪
- [ ] ultrathink／「仔細想」「深入想」完整詞比對，程式碼區塊內不觸發
- [ ] opus · medium → opus · high 只改 effort，不換模型
- [ ] 依 01 (b) 的結論處理 effort 與 cache；結論不同時行為與 spec 一致
- [ ] 以上行為皆有自動化測試
