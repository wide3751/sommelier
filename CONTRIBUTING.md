# 參與開發

## 開發環境

```bash
claude --plugin-dir ~/Projects/sommelier   # 載入開發中的版本，存檔後自動重新載入
claude plugin validate ~/Projects/sommelier
cd ~/Projects/sommelier && claude plugin test
```

正式安裝的版本會依 `plugin.json` 的 `version` 快取一份副本。改了程式碼後要先把版本號加一，再重新安裝，改動才會生效。開發時建議用 `--plugin-dir`。

**版本號規則**（`.claude-plugin/plugin.json`）：

- 每個會改變 mod 行為的 PR 升第三位（patch），例如 0.6.0 → 0.6.1
- 一組 issue 完成，或有不相容的改動（例如設定的儲存格式）時才升第二位（minor），升之前先跟維護者確認
- 只改文件、測試或 CI 的 PR 不升版本
- 1.0.0 等一週使用與校準（#14）完成後再決定

**離線評測**：不經過 Claude Code，直接呼叫 Jev，量測判斷品質與延遲：

```bash
TYPESAFE_API_KEY=... python3 eval/run_eval.py --tag 名稱
```

題目定義只有一份，放在 [hooks/questions.ts](hooks/questions.ts)，mod 和評測腳本共用。題庫在 [eval/dataset.jsonl](eval/dataset.jsonl)，報告輸出到 `eval/reports/`。

## 專案結構

```
hooks/
  hooks.json     宣告 mod 模組（只載入 register.ts）
  register.ts    mod 進入點：指令、turn 事件、同意與專案停用、呼叫 Jev（所有 $ 呼叫都在這裡）
  decide.ts      分派邏輯：階梯表、累積機率、cache 帳與升降級規則（純函式）
  jevState.ts    組成送給 Jev 的對話內容（只取文字、先遮蔽再截斷、保留結尾）
  redact.ts      送出前遮蔽常見密鑰格式（純函式，規則只增不減）
  questions.ts   送給 Jev 的三題定義
tests/           claude plugin test 的自動化測試
eval/            離線評測題庫、腳本與報告
GLOSSARY.md      領域用語
```
