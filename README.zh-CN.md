<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier：Claude Code 自动切换模型的 plugin" width="420">
</p>

[English](README.md) | [繁體中文](README.zh-TW.md) | 简体中文 | [日本語](README.ja.md) | [한국어](README.ko.md)

# sommelier：Claude Code 自动选模型的 plugin（Claude Code mods）

按任务为 Claude Code 自动挑选「模型 · effort」的 plugin，用 **Claude Code mods**（mods API 的 `turn.step`）实现。简单的请求交给 **Claude Haiku**，明确的实现交给 **Claude Sonnet**，需要调查或设计的交给 **Claude Opus**，用 **TypeSafe Jev** 对请求分类，在不牺牲质量的前提下节省 Claude Code 的用量与额度。

就像侍酒师按菜品挑酒，sommelier 在你发送每个新请求时，请 [TypeSafe Jev](https://docs.typesafe.ai)（一个返回概率的分类 API）判断三件事：**需要多深的推理**、**是不是新话题**、**是不是高风险操作**，再对应到一张可调整的阶梯表：

| 推理深度 | 默认档位 | 例子 |
|---|---|---|
| L0 查询或机械性修改 | haiku · medium | 「看一下 package.json 的 version」 |
| L1 目标和做法都明确 | sonnet · medium | 「给 parseDate 加上时区参数」 |
| L2 要先调查或权衡 | `base`（opus · medium） | 「登录偶尔 401，找出原因」 |
| L3 没有明确边界、需要长时间推演 | opus · high | 「设计多租户权限架构」 |

**为什么不每轮都换模型？** 每个模型各有一份 prompt cache，换模型就要把整段对话重新写入 cache，同样消耗额度。所以 sommelier 的原则是：**往上升随时可以；往下降只在划算时才做**，也就是新话题、而且切换成本低于能省下的额度时。

## 快速开始

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
# 执行下一行后粘贴你的 TypeSafe API key，按 Enter（屏幕上不会显示 key）
read -rs TYPESAFE_API_KEY
# 把 key 存进 macOS Keychain
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

API key 到 [TypeSafe console](https://console.typesafe.ai/keys) 创建。如果已经在 `~/.zshrc` 设置好 `TYPESAFE_API_KEY`，可以跳过 `read` 那行。

重新启动 Claude Code 就会自动开启，不用另外设置：

1. 发送一个请求，例如「给 parseDate 加上时区参数」
2. spinner 会显示选到的档位，例如 `sonnet·medium L1 · 新話題，降級`（新话题，降级）

不想用了就输入 `/somm off`。详细步骤见[安装](#安装)与[使用](#使用)。

## 让 AI agent 帮你安装

先准备好 TypeSafe API key。key 不要交给 agent，自己设置成环境变量：

1. 到 [TypeSafe console](https://console.typesafe.ai/keys) 创建 API key
2. 在终端执行下面这行，把 `your-api-key` 换成你的 key，写入 `~/.zshrc`：

   ```bash
   echo 'export TYPESAFE_API_KEY="your-api-key"' >> ~/.zshrc
   ```

3. 重新打开终端和 Claude Code，让新的环境变量生效

设置好之后，把这句话粘贴给 Claude Code 或其他 coding agent：

> 按照 https://github.com/wide3751/sommelier/blob/main/INSTALL-AGENT.md 安装 sommelier

## 需求

- Claude Code **v2.1.287 及以上**（终端），或 Desktop app 内置版本 **v2.1.286 及以上**（在 Code tab 输入 `/status` 查看）
- TypeSafe API key（到 [TypeSafe console](https://console.typesafe.ai/keys) 创建）

## 安装

1. 添加 marketplace 并安装。有两种方式，**建议用 GitHub**：

   **方式 A：从 GitHub 安装（建议）**，不用下载项目：

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
```

   之后要更新到新版本，先更新 marketplace，再更新插件，然后重启 Claude Code（已经装过时再运行 `install` 不会升级）：

```bash
claude plugin marketplace update sommelier
claude plugin update sommelier@sommelier
```

   **方式 B：从本地文件夹安装**，适合已经 clone 项目、想装自己改过的版本：

```bash
git clone https://github.com/wide3751/sommelier.git ~/Projects/sommelier
claude plugin marketplace add ~/Projects/sommelier
claude plugin install sommelier@sommelier
```

2. 设置 TypeSafe API key（存进 macOS Keychain）。终端版可以在 session 里执行 `/plugin configure sommelier@sommelier`；Desktop app 的 Code tab 不会弹出输入框，请改在终端执行：

```bash
# 执行下一行后粘贴你的 TypeSafe API key，按 Enter（屏幕上不会显示 key）
read -rs TYPESAFE_API_KEY
# 把 key 存进 macOS Keychain
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

   key 不用写进命令里：`read` 会等你粘贴，存在这个终端的 `TYPESAFE_API_KEY` 变量中，下一行再把它存进 Keychain，所以 key 不会留在 shell 历史记录里。已经在 `~/.zshrc` 设置好 `TYPESAFE_API_KEY` 的话，可以跳过 `read` 那行，但要确认当前的 shell 读得到它（例如新开一个终端窗口）。也可以只设置环境变量 `TYPESAFE_API_KEY` 作为备用，但从 Dock 打开的 Desktop app 读不到 `~/.zshrc`。

### Windows 安装

步骤 1（添加 marketplace 并安装）的命令在 PowerShell 一样能用。本地文件夹的方式把路径换成 Windows 路径，例如 `claude plugin marketplace add C:\Projects\sommelier`。

步骤 2 的 `read -rs` 在 PowerShell 中没有，改用下面这段，在 PowerShell 执行（Windows PowerShell 5.1 与 PowerShell 7 都能用）：

```powershell
# 执行下一行后粘贴你的 TypeSafe API key，按 Enter（屏幕上不会显示 key）
$s = Read-Host "TypeSafe API key" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $s).Password
# 交给 Claude Code 存成 plugin 设置
'{"typesafe_api_key":"' + $key + '"}' | claude plugin configure sommelier@sommelier --values-stdin
Remove-Variable key, s
```

Keychain 只有 macOS 才有；Windows 上 key 由 Claude Code 的 plugin 设置保存。想改用环境变量作为备用，把 key 永久写入用户环境变量（把 `your-api-key` 换成你的 key），再重新打开终端和 Claude Code：

```powershell
[Environment]::SetEnvironmentVariable("TYPESAFE_API_KEY", "your-api-key", "User")
```

3. 重新启动 Claude Code，输入 `/somm status`，确认显示「API key 已設定」（API key 已设置）。

## 使用

安装后默认**开启**，不用另外输入 `/somm on`。第一次要把请求发送给 TypeSafe 之前，会先弹出确认：同意后就不再询问；不同意的话，这一轮沿用原本的模型，并关闭 sommelier。

| 命令 | 说明 |
|---|---|
| `/somm on` | 重新开启。之后你发送的每个请求都会交给 Jev 判断（简短回复除外） |
| `/somm off` | 关闭，沿用 session 自己的模型与 effort |
| `/somm off --project` | 只在当前项目停用，这个项目的内容不会发送；`/somm on --project` 恢复 |
| `/somm status` | 显示开关、此项目是否停用、API key 是否设置、本 session 的档位 |
| `/somm log [n]` | 最近 n 条分派记录：选了哪个档位、Jev 的概率、cache 读写量 |
| `/somm events` | 最近 20 条状态事件（换模型、清除或恢复对话、prompt 来源、每轮的分派结果），用来排查 sommelier 为什么没换模型 |
| `/somm config` | 列出当前的设置；`/somm config <名称> <值>` 修改，立即生效 |

**设置**（`/somm config <名称> <值>`）：

| 名称 | 默认 | 可用的值 |
|---|---|---|
| `enabled` | on | on／off，等同 `/somm on`、`/somm off` |
| `base` | opus | 需要调查或比较的请求（L2）用的档位，也是高风险请求的最低模型。`haiku`／`sonnet`／`opus`，可加 effort，例如 `opus:high` |
| `profile` | balanced | `saver`（省额度：较少用 opus、较晚换话题）、`balanced`（平衡）、`quality`（质量优先：较早用 sonnet／opus、haiku 只接 15k 以内的对话）；也可以写中文名称 |
| `allowed` | haiku-opus | sommelier 可以选的模型范围，例如 `sonnet-opus` 就不会用 haiku。`somm:` 覆盖不受限制 |
| `spinner` | on | Claude 工作时 spinner 旁是否显示这一轮的判断 |
| `cache` | on | 状态栏是否显示 cache 量表；`off` 时只显示模型与 effort |
| `notify` | important | 弹出重要提示：覆盖或降级要重写 cache、Jev 连续 3 次判断失败、没有 API key（只提示一次）。同一轮最多一条，10 秒内有好几条时只补显示最新的一条；`off` 不弹提示 |
| `skills` | off | skill 提示的开关（beta，默认关闭）。`on` 开启；`off` 只关掉 skill 提示，选模型照常运作 |
| `skills-allow` | （全部） | 只让这些 skill 成为候选，逗号分隔，名称按 `/skills` 列出的写，例如 `mattpocock-skills:tdd,grilling`；`none` 清空 |
| `skills-exclude` | （无） | 不提示这些 skill，写法同上；与 `skills-allow` 都列了的以排除为准 |

开启后，prompt 下方的状态栏会显示实际回答的模型、版本与 effort，后面接着 cache 量表，例如 `🍷 opus 5.5·medium ▰▰▱▱▱ 95k`。旁边 Claude Code 自己显示的是 session 的模型。

**cache 量表**：数字是当前模型累积的 cache 量。5 格代表换到 allowed 范围内下一个较低模型的切换成本（重写 cache 的费用），占预估省回额度的比例，每格 20%。格子越满，换下去越不划算；满格再加上 `⚠`（例如 `▰▰▰▰▰⚠ 243k`）表示切换成本已经超过省回的额度，sommelier 这时会挡下降级，你自己换也不建议。cache 已过期、或已经是 allowed 内最低的模型时，格子全空。状态栏不能着色，所以用满格加 `⚠` 作为警示。嫌挤可以用 `/somm config cache off` 关掉。

<img src="assets/status-line/status-line.png" alt="状态栏 cache 量表在四种情境下的样子（示意图）" width="640">

<sub>示意图：刚开始的对话、对话变长、不建议切换模型、已在最低的模型。</sub>

`/somm` 如果被其他 plugin 占用，会自动改用 `/sommelier`。

**自己指定模型（覆盖）**：在 prompt 开头写 `somm:opus`、`somm:sonnet` 或 `somm:haiku`（不区分大小写），这一句就用指定的模型（effort medium），不发送给 Jev。前缀会先去掉，模型看不到。之后同一个话题都沿用这个模型，直到 Jev 判断出新话题、`/clear` 或你用 `/model` 换模型为止。只写前缀、不写内容时不会发送任何东西，只设置接下来要用的模型。换模型要重写 cache 时，会弹出提示说明要重写多少 token、大约多少钱。

**每个请求怎么决定：**
- **升级**：判断需要较强的模型或较高的 effort 时，随时往上换
- **高风险**：会删除或覆盖数据、改生产环境或权限的请求，模型至少换到 base（默认 opus），这一句 effort 提高为 high，下一句恢复原本的 effort
- **要求深入思考**：prompt 里有 `ultrathink`、「仔細想」或「深入想」（仔细想、深入想；代码块内不算）时直接用 opus · high，不发送给 Jev
- **降级**：只在新话题、而且预估省下的额度大于重写 cache 的成本时才往下换；否则这一句沿用当前的模型
- **沿用**：同一个话题判断较低时、简短回复（例如「好」「继续」，不发送给 Jev）、Jev 超时或返回错误时，维持当前的模型
- **对话太长不用 haiku**：对话超过 30k tokens 时不会降到 haiku；已经在 haiku 上的对话长到超过这个长度，会改用 sonnet

**skill 提示**（beta，默认关闭，用 `/somm config skills on` 开启）：判断模型的同时，Jev 也会判断这一句需不需要某个 skill、最适合哪一个。足够有把握时（「需要 skill」≥ 0.30，而且第一名 ≥ 0.5），sommelier 会在这一句旁边附一段提示给 Claude，例如「這個請求可能適合 skill『tdd』（可能有誤）」（这个请求可能适合 skill『tdd』（可能有误））。这只是建议，Claude 判断不适用就会忽略；提示不影响模型。候选是这个 session 里 Claude 能自己调用、而且有描述的 skill，可以用 `skills-allow`、`skills-exclude` 缩小范围。同一个话题里同一个 skill 只提示一次，换话题或 `/clear` 后才会再提示。有提示时 spinner 会显示 `💡tdd`，`/somm log` 会记下 Claude 有没有采用。开启 skill 提示时，因为要等 Jev 判断完才能附上提示，发送 prompt 后会先等 Jev（最多 1.5 秒）。

### 能选的模型与 skill

**模型**：sommelier 只会在下面三个模型之间挑选，effort 只用 medium 或 high。

| 模型 | 发送的模型 ID | sommelier 何时选它 |
|---|---|---|
| haiku | `claude-haiku-5-5` | L0；对话超过 30k tokens 时不用 |
| sonnet | `claude-sonnet-5-5` | L1；haiku 的对话变长时也改用它 |
| opus | `claude-opus-5-5` | L2（base，medium）、L3、要求深入思考（high）；高风险请求至少用 base |

带日期后缀的 ID（例如 `claude-sonnet-5-5-20261001`）也能识别。要改变能选的范围：

- **缩小范围**：`/somm config allowed sonnet-opus` 就不会用 haiku；`opus-opus` 等于只用 opus
- **换 L2 的档位**：`/somm config base sonnet` 或 `opus:high`，任一模型都可以加 medium／high，但要在 `allowed` 范围内
- **这个话题指定模型**：prompt 开头写 `somm:haiku`、`somm:sonnet`、`somm:opus`（effort 固定 medium，不受 `allowed` 限制）
- **完全自己决定**：用 `/model` 换 session 的模型，sommelier 在你换回 Default 之前都不改动模型

**skill**（skill 提示开启时）：能被提示的候选 skill 由这个 session 决定，不需要另外登记。

- **哪些会成为候选**：Claude 能自己调用、而且有描述的 skill，也就是 `/skills` 列出、没有被设成只能手动调用的那些。plugin 的 skill 写成 `plugin名:skill名`，例如 `mattpocock-skills:tdd`
- **数量**：按名称排序，最多 255 个，超过的跳过；少于 2 个时不会问 Jev skill 的问题
- **只提示某几个**：`/somm config skills-allow mattpocock-skills:tdd,grilling`；`none` 清空，恢复全部
- **排除某几个**：`/somm config skills-exclude cost-today`；同时出现在两份清单时以排除为准
- **确认效果**：`/somm log` 会记下每一句提示了哪个 skill、Claude 有没有采用

**以下情况 sommelier 不会改动模型：**
- 关闭时，或当前项目已停用
- 第一次发送前的确认没有同意
- session 的第一句 Jev 就失败，或没有设置 API key（之后的句子失败则沿用当前的模型）
- subagent 的请求

### 示例

开启后发送「给 parseDate 加上时区参数」，Jev 判断为 L1，从 session 的 opus 降到 sonnet，spinner 会显示：

```
sonnet·medium L1 · 新話題，降級
```

接着回「好」，简短回复不发送给 Jev，沿用同一个档位：

```
sonnet·medium · 沿用
```

再要求「设计多租户权限架构」，Jev 判断为 L3，升级：

```
opus·high L3 · 升級
```

`/somm status`：

```
sommelier 開啟｜API key 已設定｜本 session 檔位 sonnet·medium
```

`/somm log 3`：P 是 Jev 判断为 L0／L1／L2／L3 的概率；`session` 表示这一轮用 session 自己的模型；「回答」是实际回答的模型，方括号是 session 的前六位：

```
sonnet·medium · 回答 sonnet · downgrade P=0.05/0.90/0.05/0.00 jev 820ms cache read 0 write 18342 [a1b2c3]
sonnet·medium · 回答 sonnet · continuation cache read 18342 write 1204 [a1b2c3]
opus·high · 回答 opus · upgrade P=0.02/0.08/0.20/0.70 jev 410ms cache read 0 write 21530 [a1b2c3]
```

## 限制

- **手动 `/model`**：用 `/model` 换模型之后，sommelier 就不再改模型，`/clear` 和恢复对话之后也一样，直到你在 `/model` 选回 Default。Claude Code 自动 fallback 到其他模型之后也会停手，直到你手动 `/model`。
- **不判断的轮次**：通知、定时任务、其他 session 或其他 plugin 发来的消息，以及 slash 命令，都沿用当前的模型，不发送给 Jev。session 模型不是 Opus／Sonnet／Haiku 5.5（例如 `[1m]` 版本或旧版）时，sommelier 不做任何改变。
- **不划算就不降级**：每个模型各有一份 cache，换模型要把对话写入新模型的 cache。sommelier 会记下每个模型的 cache 覆盖到哪里：切到从没用过、或闲置超过 cache 有效期的模型要整段重写；切回刚用过的模型只补差额；`/clear`、compact、resume 之后只剩系统提示还在 cache 里。往下降时比较「重写成本」和「预估 3 轮能省回的钱」，省不回来就这一句沿用原模型，下一个新话题再重新评估。往上升不受影响。价格采用官方定价，写在 `hooks/decide.ts`。
- **模型菜单显示的是 session 模型**：sommelier 改的是每个发送的请求，不改 session 本身的模型，所以 `/model` 和 Desktop 的模型菜单一直显示原本的模型。实际回答的模型看状态栏 🍷 后面的模型。
- **Jev 判断需要时间**：每个请求的判断最多等 1.5 秒（离线评测 p95 约 0.4 秒），简短回复不发送给 Jev、不用等。
- **Desktop app**：Code tab 不能用 `/plugin configure` 输入 API key，要改在终端设置（见「安装」）。

## 故障排查

| 症状 | 解决方法 |
|---|---|
| `/somm status` 显示「API key 未設定」（API key 未设置） | 按照「安装」第 2 步重新设置。只靠环境变量的话，确认启动 Claude Code 的 shell 读得到 `TYPESAFE_API_KEY`；从 Dock 打开的 Desktop app 读不到 `~/.zshrc` |
| spinner 显示「Jev 失敗」（Jev 失败） | 用 `/somm log` 查看原因：`no_key` 是没有 key，`timeout` 是超过 1.5 秒，`http_401` 等是 API 返回错误，`fetch_failed` 是连不上 TypeSafe。这一轮沿用当前的模型；session 第一句就失败时用 session 自己的模型 |
| `/somm` 命令不见了 | 被其他 plugin 占用，改用 `/sommelier` |
| 改了代码没有生效 | 正式安装版按 `plugin.json` 的 `version` 缓存。版本号加一后执行 `claude plugin update sommelier@sommelier` 并重启，或开发时改用 `--plugin-dir` |

## 隐私与数据

sommelier 安装后默认开启，开启时会把数据发送到 TypeSafe 判断。第一次发送前会先询问你是否同意；用 `/somm off` 关闭后就不会发送任何东西。

- **什么时候发送**：每个新请求都会发送；简短回复（去掉空格和标点后 8 个字以内，例如「好」「继续」）不发送
- **发送什么**：这一句请求（最多 2000 字），以及最近 3 轮对话的文字（每条最多 500 字，只保留结尾）；开启 skill 提示时，另外发送候选 skill 的名称与描述（每条最多 300 字）。第一次使用时的确认不包含 skill；开启 skill 提示后，第一次发送 skill 数据前会另外确认一次，不同意只会关掉 skill 提示
- **发送前屏蔽**：常见的密钥格式会替换成 `[REDACTED]`，包括 `sk-`、`AKIA`、`ghp_`、`xoxb-`／`xoxp-`、`AIza`、`Bearer`、`password=`、JWT、私钥块，以及 32 个字符以上的十六进制字符串
- **不发送什么**：文件内容、工具调用与工具输出、subagent 的请求，以及用 `/somm off --project` 停用的项目
- **本地记录**：`/somm log` 的记录保存档位、Jev 的概率、延迟、cache 读写量、提示的 skill 与有没有采用，以及 prompt 的前 40 字（屏蔽后）；停用的项目不保存 prompt。另外每个 session 的分派状态（当前档位、cache 账、覆盖锁定等，不含 prompt）也保存在本地，让更新 plugin 后运行中的 session 能接续；只保留最近 20 个 session
- **API key**：存在 macOS Keychain（`/plugin configure`），或从环境变量 `TYPESAFE_API_KEY` 读取

## 参与开发

开发环境、离线评测与项目结构见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文档

- [GLOSSARY.md](GLOSSARY.md)：术语定义（档位、新话题、cache 账…）

## 许可证

[MIT](LICENSE)
