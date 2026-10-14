// The questions sommelier asks Jev (docs/spec.md「Jev 請求」).
// Single source of truth: eval/run_eval.py reads the JSON literals below, so
// keep them valid JSON (double quotes, no trailing commas) between the markers.
// BEGIN JEV QUESTIONS
export const JEV = {
  "model": "jev-1.13.0",
  "questions": {
    "depth": {
      "type": "score",
      "instructions": "How much reasoning does the next step of `current_request` need? If it continues a task from `recent_turns`, judge this step of that task.",
      "criteria": [
        "Only reading or reporting, or one mechanical edit given explicitly: ask a fact, show a file's content, rename a given word or identifier, run a single command the user gave and report its output",
        "The goal and the way are both clear, it only needs doing: change one or two named files, add a function or test whose shape is known, explain what a piece of code does",
        "Needs investigation or comparison before acting: find the cause of an error not yet known, change or refactor several files or modules, choose between two or three approaches",
        "No clear boundary, needs long deliberation: plan the architecture of a whole system or module, an intermittent bug or one that only shows in a particular environment, plan a new feature from scratch"
      ]
    },
    "new_task": {
      "type": "noul",
      "instructions": "Does `current_request` start new work unrelated to `recent_turns`?"
    },
    "high_risk": {
      "type": "noul",
      "instructions": "Would `current_request` delete or overwrite data, files, branches, databases or cloud resources, or change production, permissions or security settings? Editing or deleting source code itself does not count."
    }
  }
}
// END JEV QUESTIONS

// The two questions behind a skill hint (skill 提示), sent with the ones above
// when skill hints are on. The choice's criteria are the candidate skills,
// filled in per request: name → description.
// BEGIN SKILL QUESTIONS
export const SKILL_QUESTIONS = {
  "needs_skill": {
    "type": "noul",
    "instructions": "Would `current_request` be handled better by loading one specific skill (a packaged set of instructions for a kind of task, such as a review checklist, a test-first workflow or a document format) than by answering directly?"
  },
  "skill": {
    "type": "choice",
    "instructions": "Which skill best fits the work `current_request` asks for next? Judge by each skill's description."
  }
}
// END SKILL QUESTIONS
