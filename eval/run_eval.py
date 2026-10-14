#!/usr/bin/env python3
"""sommelier 離線評測：直接打 Jev，量判斷品質與延遲（ticket 03、#27）。

用法：
  TYPESAFE_API_KEY=... python3 eval/run_eval.py [--tag 名稱] [--no-skills]

題目讀自 hooks/questions.ts（mod 與評測共用同一份定義）。預設與 mod 一樣，
每個請求都帶 skill 的兩題，候選 skill 用 eval/skill_candidates.json；
eval/skill_dataset.jsonl 另外量 skill 提示的準確度。--no-skills 只送三題。

輸出：
  eval/results/<時間>-<tag>.json   每題原始回應（題庫是合成的，可以進版控）
  eval/reports/<時間>-<tag>.md     報告：混淆矩陣、嚴重錯誤率、new_task／high_risk、延遲、各 profile 分佈
只用標準函式庫。
"""
import argparse
import json
import os
import statistics
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
URL = "https://api.typesafe.ai/v1/systemone"

# 與 spec「參數三層」的 profile 表一致
PROFILES = {
    "省額度": {"t_opus": 0.5, "t_sonnet": 0.5, "t_new": 0.6, "t_risk": 0.5},
    "平衡": {"t_opus": 0.35, "t_sonnet": 0.35, "t_new": 0.7, "t_risk": 0.5},
    "品質優先": {"t_opus": 0.25, "t_sonnet": 0.2, "t_new": 0.8, "t_risk": 0.4},
}
MODELS = ["haiku", "sonnet", "opus"]


# 與 hooks/decide.ts 的 SKILL_THRESHOLDS 一致
SKILL_NEEDS = 0.3
SKILL_TOP = 0.5


def load_questions(path, marker="JEV QUESTIONS"):
    """讀 hooks/questions.ts 中 BEGIN／END 標記之間的 JSON 字面值。"""
    text = path.read_text()
    block = text.split(f"// BEGIN {marker}", 1)[1].split(f"// END {marker}", 1)[0]
    return json.loads(block.split("=", 1)[1])


def skill_hint(answers):
    """依 mod 的規則：needs_skill 與第一名都過門檻才提示第一名。"""
    probs = answers["skill"]["probabilities"]
    top = max(probs, key=probs.get)
    return top if answers["needs_skill"]["noul"] >= SKILL_NEEDS and probs[top] >= SKILL_TOP else None


def ask(key, model, questions, item):
    body = json.dumps({
        "model": model,
        "state": {"current_request": item["current_request"], "recent_turns": item["recent_turns"]},
        "questions": questions,
    }).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    return resp, (time.perf_counter() - t0) * 1000


def route(probs, high_risk, p):
    """spec 分派決策第 8 點：累積機率 → 模型（不含 ultrathink 等程式規則）。"""
    p0, p1, p2, p3 = (probs[str(i)] for i in range(4))
    if p2 + p3 >= p["t_opus"]:
        model = "opus"
    elif p1 + p2 + p3 >= p["t_sonnet"]:
        model = "sonnet"
    else:
        model = "haiku"
    if high_risk >= p["t_risk"]:
        model = "opus"  # 至少 base（opus · medium）
    return model


def expected_model(exp):
    if exp["high_risk"] or exp["depth"] >= 2:
        return "opus"
    return ["haiku", "sonnet"][exp["depth"]]


def pct(n, d):
    return f"{n}/{d}（{n / d * 100:.0f}%）" if d else "0/0"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--questions", default=str(HERE.parent / "hooks" / "questions.ts"))
    ap.add_argument("--dataset", default=str(HERE / "dataset.jsonl"))
    ap.add_argument("--tag", default="baseline")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--skill-dataset", default=str(HERE / "skill_dataset.jsonl"))
    ap.add_argument("--skill-candidates", default=str(HERE / "skill_candidates.json"))
    ap.add_argument("--no-skills", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise SystemExit("TYPESAFE_API_KEY is not set")
    qdef = load_questions(Path(args.questions))
    questions = dict(qdef["questions"])
    if not args.no_skills:
        sq = load_questions(Path(args.questions), "SKILL QUESTIONS")
        candidates = json.loads(Path(args.skill_candidates).read_text())
        questions["needs_skill"] = sq["needs_skill"]
        questions["skill"] = {**sq["skill"], "criteria": candidates}
    items = [json.loads(line) for line in Path(args.dataset).read_text().splitlines() if line.strip()]
    skill_items = [] if args.no_skills else [
        json.loads(line) for line in Path(args.skill_dataset).read_text().splitlines() if line.strip()]

    def run(item):
        try:
            resp, ms = ask(key, qdef["model"], questions, item)
            return {**item, "answers": resp["answers"], "served_model": resp.get("model"),
                    "input_tokens": (resp.get("usage") or {}).get("input_tokens"), "ms": ms}
        except Exception as err:  # 記錄失敗，不中斷整批
            return {**item, "error": repr(err)}

    with ThreadPoolExecutor(args.workers) as pool:
        results = list(pool.map(run, items))
        skill_results = list(pool.map(run, skill_items))

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "reports").mkdir(exist_ok=True)
    (HERE / "results" / f"{stamp}-{args.tag}.json").write_text(json.dumps(results + skill_results, ensure_ascii=False, indent=1))

    ok = [r for r in results if "answers" in r]
    failed = [r for r in results if "error" in r]
    L = []
    L.append(f"# 離線評測報告：{args.tag}（{stamp}）\n")
    L.append(f"- 題數：{len(results)}（成功 {len(ok)}，失敗 {len(failed)}）；Jev 模型：{', '.join(sorted({r['served_model'] for r in ok}))}")
    lat = sorted(r["ms"] for r in ok)
    if lat:
        p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))]
        L.append(f"- 延遲：p50 {statistics.median(lat):.0f} ms，p95 {p95:.0f} ms，最大 {lat[-1]:.0f} ms（並行 {args.workers}）")
        L.append(f"- 每題 input tokens：平均 {statistics.mean(r['input_tokens'] or 0 for r in ok):.0f}\n")

    # depth 混淆矩陣（以機率最高的等級為預測）
    L.append("## depth 混淆矩陣（列：預期，欄：Jev 最可能等級）\n")
    L.append("| 預期 \\ 預測 | L0 | L1 | L2 | L3 |\n|---|---|---|---|---|")
    m = [[0] * 4 for _ in range(4)]
    for r in ok:
        probs = r["answers"]["depth"]["probabilities"]
        pred = max(range(4), key=lambda i: probs[str(i)])
        m[r["expect"]["depth"]][pred] += 1
    for i in range(4):
        L.append(f"| L{i} | " + " | ".join(str(x) for x in m[i]) + " |")
    exact = sum(m[i][i] for i in range(4))
    within1 = sum(m[i][j] for i in range(4) for j in range(4) if abs(i - j) <= 1)
    L.append(f"\n完全正確 {pct(exact, len(ok))}；相差不超過一級 {pct(within1, len(ok))}\n")

    # 各 profile：模型分派
    L.append("## 各 profile 的模型分派\n")
    L.append("| profile | 嚴重錯誤（難題或高風險 → haiku） | 分派過低 | 分派過高 | haiku／sonnet／opus | new_task 錯判（延續→新話題／新話題→延續） | high_risk 漏判／誤判 |")
    L.append("|---|---|---|---|---|---|---|")
    detail = {}
    for name, p in PROFILES.items():
        severe, low, high, dist, nt_fp, nt_fn, hr_fn, hr_fp = [], [], [], {m_: 0 for m_ in MODELS}, [], [], [], []
        for r in ok:
            a, e = r["answers"], r["expect"]
            got = route(a["depth"]["probabilities"], a["high_risk"]["noul"], p)
            want = expected_model(e)
            dist[got] += 1
            if got == "haiku" and want == "opus":
                severe.append(r["id"])
            if MODELS.index(got) < MODELS.index(want):
                low.append(r["id"])
            elif MODELS.index(got) > MODELS.index(want):
                high.append(r["id"])
            is_new = a["new_task"]["noul"] >= p["t_new"]
            if is_new and not e["new_task"]:
                nt_fp.append(r["id"])
            if not is_new and e["new_task"]:
                nt_fn.append(r["id"])
            is_risk = a["high_risk"]["noul"] >= p["t_risk"]
            if e["high_risk"] and not is_risk:
                hr_fn.append(r["id"])
            if is_risk and not e["high_risk"]:
                hr_fp.append(r["id"])
        detail[name] = dict(severe=severe, low=low, high=high, nt_fp=nt_fp, nt_fn=nt_fn, hr_fn=hr_fn, hr_fp=hr_fp)
        L.append(f"| {name} | **{len(severe)}** | {len(low)} | {len(high)} | {dist['haiku']}／{dist['sonnet']}／{dist['opus']} | "
                 f"{len(nt_fp)}／{len(nt_fn)} | {len(hr_fn)}／{len(hr_fp)} |")
    L.append("")
    for name, d in detail.items():
        L.append(f"- **{name}**：" + "；".join(f"{k} {', '.join(v)}" for k, v in d.items() if v) if any(d.values()) else f"- **{name}**：無錯誤")
    L.append("")

    # 逐題明細
    L.append("## 逐題明細\n")
    L.append("| id | 請求 | 預期 depth／新話題／高風險 | P(L0..L3) | new_task | high_risk |")
    L.append("|---|---|---|---|---|---|")
    for r in ok:
        a, e = r["answers"], r["expect"]
        probs = a["depth"]["probabilities"]
        L.append(f"| {r['id']} | {r['current_request'][:40]} | L{e['depth']}／{'是' if e['new_task'] else '否'}／{'是' if e['high_risk'] else '否'} | "
                 f"{' '.join(f'{probs[str(i)]:.2f}' for i in range(4))} | {a['new_task']['noul']:.2f} | {a['high_risk']['noul']:.2f} |")
    for r in failed:
        L.append(f"| {r['id']} | {r['current_request'][:40]} | 失敗：{r['error'][:60]} | | | |")

    # skill 提示（#27）
    if not args.no_skills:
        L.append("\n## skill 提示\n")
        L.append(f"門檻：needs_skill ≥ {SKILL_NEEDS}，第一名 ≥ {SKILL_TOP}；候選 {len(candidates)} 個。\n")
        sk_ok = [r for r in skill_results if "answers" in r]
        right = [r for r in sk_ok if skill_hint(r["answers"]) == r["expect"]["skill"]]
        wrong = [r for r in sk_ok if skill_hint(r["answers"]) and skill_hint(r["answers"]) != r["expect"]["skill"]]
        missed = [r for r in sk_ok if r["expect"]["skill"] and not skill_hint(r["answers"])]
        # 一般題庫沒有標 skill，列出來供人工檢查（例如查 bug 的題目提示 diagnosing-bugs 是合理的）
        stray = [r for r in ok if skill_hint(r["answers"])]
        L.append(f"- skill 題庫完全正確 {pct(len(right), len(sk_ok))}；提示錯 skill {len(wrong)}，該提示沒提示 {len(missed)}")
        L.append(f"- 一般題庫出現提示 {pct(len(stray), len(ok))}（未標註，供人工檢查）：" + (", ".join(f"{r['id']}→{skill_hint(r['answers'])}" for r in stray) or "無") + "\n")
        L.append("| id | 請求 | 預期 | 提示 | needs_skill | 第一名 |")
        L.append("|---|---|---|---|---|---|")
        for r in sk_ok:
            a = r["answers"]
            probs = a["skill"]["probabilities"]
            top = max(probs, key=probs.get)
            L.append(f"| {r['id']} | {r['current_request'][:40]} | {r['expect']['skill'] or '—'} | {skill_hint(a) or '—'} | "
                     f"{a['needs_skill']['noul']:.2f} | {top} {probs[top]:.2f} |")
        for r in skill_results:
            if "error" in r:
                L.append(f"| {r['id']} | {r['current_request'][:40]} | 失敗：{r['error'][:60]} | | | |")

    out = HERE / "reports" / f"{stamp}-{args.tag}.md"
    out.write_text("\n".join(L) + "\n")
    print(out)


if __name__ == "__main__":
    main()
