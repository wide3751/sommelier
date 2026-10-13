// The three questions sommelier asks Jev (docs/spec.md「Jev 請求」).
// Single source of truth: eval/run_eval.py reads the JSON literal below, so keep
// it valid JSON (double quotes, no trailing commas) between the markers.
// BEGIN JEV QUESTIONS
export const JEV = {
  "model": "jev-1.13.0",
  "questions": {
    "depth": {
      "type": "score",
      "instructions": "判斷完成 `current_request` 接下來這一步需要多深的推理。若它是在延續 `recent_turns` 的任務，就以那個任務的這一步來判斷。",
      "criteria": [
        "只需讀取或回報，或照明確指示做一處機械性修改：問一個事實、顯示檔案內容、把指定的字或名稱改掉、執行使用者給的單一指令並回報輸出",
        "目標和做法都已明確，照著做完即可：在已指名的一兩個檔案內修改、補一個寫法已知的函式或測試、說明一段程式在做什麼",
        "動手前要先調查或比較：找出原因還不知道的錯誤、修改或重構多個檔案或模組、在兩三種做法之間取捨",
        "問題沒有明確邊界、需要長時間推演：規劃整個系統或模組的架構、偶發或只在特定環境出現的錯誤、從零規劃一個新功能"
      ]
    },
    "new_task": {
      "type": "noul",
      "instructions": "`current_request` 是否開始一件跟 `recent_turns` 無關的新工作。"
    },
    "high_risk": {
      "type": "noul",
      "instructions": "`current_request` 是否會刪除或覆寫資料、檔案、分支、資料庫或雲端資源，或變更正式環境、權限、安全設定。修改或刪除程式碼本身不算。"
    }
  }
}
// END JEV QUESTIONS
