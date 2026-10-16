<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier: Claude Code용 자동 모델 선택 plugin" width="420">
</p>

[繁體中文](README.md) | [简体中文](README.zh-CN.md) | [English](README.en.md) | [日本語](README.ja.md)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Y8H028VWRF)

# sommelier: Claude Code용 자동 모델 선택 plugin (Claude Code mods)

작업에 맞춰 Claude Code의 「모델 · effort」를 자동으로 골라 주는 plugin으로, **Claude Code mods**(mods API의 `turn.step`)로 구현했습니다. 간단한 요청은 **Claude Haiku**, 분명한 구현은 **Claude Sonnet**, 조사나 설계가 필요한 작업은 **Claude Opus**에 맡기며, **TypeSafe Jev**가 요청을 분류합니다. 품질을 떨어뜨리지 않으면서 Claude Code의 사용량과 한도를 아낄 수 있습니다.

소믈리에가 요리에 맞춰 와인을 고르듯, sommelier는 새 요청을 보낼 때마다 [TypeSafe Jev](https://docs.typesafe.ai)(확률을 반환하는 분류 API)에게 세 가지를 판단하게 합니다. **얼마나 깊은 추론이 필요한지**, **새로운 주제인지**, **위험도가 높은 작업인지**를 판단한 뒤, 조정 가능한 단계표에 대응시킵니다.

| 추론 깊이 | 기본 단계 | 예시 |
|---|---|---|
| L0 조회 또는 기계적인 수정 | haiku · medium | 「package.json의 version을 확인해 줘」 |
| L1 목표와 방법이 분명함 | sonnet · medium | 「parseDate에 시간대 매개변수를 추가해 줘」 |
| L2 먼저 조사하거나 비교해야 함 | `base`(opus · medium) | 「로그인이 가끔 401이 나는데 원인을 찾아 줘」 |
| L3 뚜렷한 경계가 없고 오래 추론해야 함 | opus · high | 「멀티 테넌트 권한 아키텍처를 설계해 줘」 |

**왜 매 턴마다 모델을 바꾸지 않나요?** 모델마다 prompt cache가 따로 있어서, 모델을 바꾸면 대화 전체를 cache에 다시 써야 하고 이 역시 한도를 소모합니다. 그래서 sommelier의 원칙은 **올리는 것은 언제든 가능하고, 내리는 것은 이득일 때만** 하는 것입니다. 즉 새 주제이면서 전환 비용이 절약할 수 있는 한도보다 낮을 때만 내립니다.

## 빠른 시작

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
# 다음 줄을 실행한 뒤 TypeSafe API key를 붙여 넣고 Enter를 누르세요(화면에 key는 표시되지 않습니다)
read -rs TYPESAFE_API_KEY
# key를 macOS Keychain에 저장
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

API key는 [TypeSafe console](https://console.typesafe.ai/keys)에서 만듭니다. 이미 `~/.zshrc`에 `TYPESAFE_API_KEY`를 설정해 두었다면 `read` 줄은 건너뛰어도 됩니다.

Claude Code를 다시 시작하면 자동으로 켜지며, 따로 설정할 것은 없습니다.

1. 요청을 하나 보냅니다. 예: 「parseDate에 시간대 매개변수를 추가해 줘」
2. spinner에 선택된 단계가 표시됩니다. 예: `sonnet·medium L1 · 新話題，降級` (새 주제, 다운그레이드)

더 이상 쓰지 않으려면 `/somm off`를 입력하세요. 자세한 절차는 [설치](#설치)와 [사용법](#사용법)을 참고하세요.

## AI agent로 설치하기

먼저 TypeSafe API key를 준비하세요. key는 agent에게 넘기지 말고 직접 환경 변수로 설정합니다.

1. [TypeSafe console](https://console.typesafe.ai/keys)에서 API key를 만듭니다
2. 터미널에서 아래 줄을 실행해 `~/.zshrc`에 추가합니다. `your-api-key`는 본인의 key로 바꾸세요.

   ```bash
   echo 'export TYPESAFE_API_KEY="your-api-key"' >> ~/.zshrc
   ```

3. 새 환경 변수가 적용되도록 터미널과 Claude Code를 다시 엽니다

설정이 끝나면 아래 문장을 Claude Code 또는 다른 coding agent에 붙여 넣으세요.

> https://github.com/wide3751/sommelier/blob/main/INSTALL-AGENT.md 를 따라 sommelier를 설치해 줘

## 요구 사항

- Claude Code **v2.1.287 이상**(터미널), 또는 Desktop app 내장 버전 **v2.1.286 이상**(Code tab에서 `/status`를 입력해 확인)
- TypeSafe API key([TypeSafe console](https://console.typesafe.ai/keys)에서 생성)

## 설치

1. marketplace를 추가하고 설치합니다. 두 가지 방법이 있으며, **GitHub 방식을 권장합니다**.

   **방법 A: GitHub에서 설치(권장)**. 프로젝트를 내려받을 필요가 없습니다.

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
```

   나중에 새 버전으로 업데이트하려면 marketplace를 먼저 업데이트하고, 이어서 plugin을 업데이트한 다음 Claude Code를 다시 시작하세요(이미 설치된 상태에서 `install`을 다시 실행해도 업그레이드되지 않습니다).

```bash
claude plugin marketplace update sommelier
claude plugin update sommelier@sommelier
```

   **방법 B: 로컬 폴더에서 설치**. 프로젝트를 이미 clone했고, 직접 수정한 버전을 설치하고 싶을 때 적합합니다.

```bash
git clone https://github.com/wide3751/sommelier.git ~/Projects/sommelier
claude plugin marketplace add ~/Projects/sommelier
claude plugin install sommelier@sommelier
```

2. TypeSafe API key를 설정합니다(macOS Keychain에 저장). 터미널 버전에서는 session 안에서 `/plugin configure sommelier@sommelier`를 실행할 수 있습니다. Desktop app의 Code tab에서는 입력창이 나타나지 않으니 터미널에서 실행하세요.

```bash
# 다음 줄을 실행한 뒤 TypeSafe API key를 붙여 넣고 Enter를 누르세요(화면에 key는 표시되지 않습니다)
read -rs TYPESAFE_API_KEY
# key를 macOS Keychain에 저장
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

   key를 명령어에 직접 쓸 필요는 없습니다. `read`가 붙여 넣기를 기다렸다가 이 터미널의 `TYPESAFE_API_KEY` 변수에 담고, 다음 줄에서 그것을 Keychain에 저장하므로 key가 shell 히스토리에 남지 않습니다. 이미 `~/.zshrc`에 `TYPESAFE_API_KEY`를 설정해 두었다면 `read` 줄은 건너뛸 수 있지만, 현재 shell에서 읽을 수 있는지 확인하세요(예: 새 터미널 창 열기). 환경 변수 `TYPESAFE_API_KEY`만 설정해 대체 수단으로 쓸 수도 있지만, Dock에서 연 Desktop app은 `~/.zshrc`를 읽지 못합니다.

### Windows 설치

1단계(marketplace 추가 및 설치)의 명령어는 PowerShell에서도 그대로 동작합니다. 로컬 폴더 방식은 경로를 Windows 경로로 바꾸세요. 예: `claude plugin marketplace add C:\Projects\sommelier`.

2단계의 `read -rs`는 PowerShell에 없으므로, 아래 코드를 PowerShell에서 실행하세요(Windows PowerShell 5.1과 PowerShell 7 모두 사용 가능).

```powershell
# 다음 줄을 실행한 뒤 TypeSafe API key를 붙여 넣고 Enter를 누르세요(화면에 key는 표시되지 않습니다)
$s = Read-Host "TypeSafe API key" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $s).Password
# Claude Code에 넘겨 plugin 설정으로 저장
'{"typesafe_api_key":"' + $key + '"}' | claude plugin configure sommelier@sommelier --values-stdin
Remove-Variable key, s
```

Keychain은 macOS에만 있으며, Windows에서는 key가 Claude Code의 plugin 설정에 저장됩니다. 환경 변수를 대체 수단으로 쓰려면 key를 사용자 환경 변수에 영구적으로 기록(`your-api-key`를 본인의 key로 변경)한 뒤 터미널과 Claude Code를 다시 여세요.

```powershell
[Environment]::SetEnvironmentVariable("TYPESAFE_API_KEY", "your-api-key", "User")
```

3. Claude Code를 다시 시작하고 `/somm status`를 입력해 「API key 已設定」(API key가 설정되었습니다)이라고 표시되는지 확인합니다.

## 사용법

설치 후 기본값은 **켜짐**이므로 `/somm on`을 따로 입력할 필요가 없습니다. 요청을 처음 TypeSafe로 보내기 전에 먼저 동의 확인이 나타납니다. 동의하면 다시 묻지 않으며, 동의하지 않으면 이번 턴은 원래 모델을 그대로 쓰고 sommelier를 끕니다.

| 명령어 | 설명 |
|---|---|
| `/somm on` | 다시 켭니다. 이후 보내는 모든 요청을 Jev가 판단합니다(짧은 응답 제외) |
| `/somm off` | 끄고 session 자체의 모델과 effort를 그대로 사용합니다 |
| `/somm off --project` | 현재 프로젝트에서만 비활성화합니다. 이 프로젝트의 내용은 전송되지 않으며, `/somm on --project`로 복원합니다 |
| `/somm status` | 켜짐/꺼짐 여부, 이 프로젝트의 비활성화 여부, API key 설정 여부, 이 session의 단계를 표시합니다 |
| `/somm log [n]` | 최근 n건의 분배 기록: 선택된 단계, Jev의 확률, cache 읽기/쓰기량 |
| `/somm events` | 최근 20건의 상태 이벤트(모델 전환, 대화 초기화 또는 재개, prompt 출처, 턴별 분배 결과). sommelier가 왜 모델을 바꾸지 않았는지 조사할 때 사용합니다 |
| `/somm config` | 현재 설정을 나열합니다. `/somm config <이름> <값>`으로 변경하며 즉시 적용됩니다 |

**설정**(`/somm config <이름> <값>`):

| 이름 | 기본값 | 사용 가능한 값 |
|---|---|---|
| `enabled` | on | on／off. `/somm on`, `/somm off`와 같습니다 |
| `base` | opus | 조사나 비교가 필요한 요청(L2)에 쓰는 단계이며, 위험도가 높은 요청의 최소 모델이기도 합니다. `haiku`／`sonnet`／`opus`, effort를 붙일 수 있습니다. 예: `opus:high` |
| `profile` | balanced | `saver`(한도 절약: opus를 덜 쓰고 주제 전환을 늦게 인식), `balanced`(균형), `quality`(품질 우선: sonnet／opus를 더 일찍 쓰고, haiku는 15k 이하 대화에만 사용). 중국어 이름으로 써도 됩니다 |
| `allowed` | haiku-opus | sommelier가 고를 수 있는 모델 범위. 예: `sonnet-opus`는 haiku를 쓰지 않습니다. `somm:` 오버라이드는 제한을 받지 않습니다 |
| `spinner` | on | Claude가 작업하는 동안 spinner 옆에 이번 턴의 판단을 표시할지 여부 |
| `cache` | on | 상태 표시줄에 cache 게이지를 표시할지 여부. `off`이면 모델과 effort만 표시합니다 |
| `notify` | important | 중요 알림을 띄웁니다: 오버라이드나 다운그레이드로 cache를 다시 써야 할 때, Jev가 연속 3회 판단에 실패했을 때, API key가 없을 때(한 번만 알림). 같은 턴에는 최대 한 건이며, 10초 안에 여러 건이 생기면 가장 최근 것 하나만 추가로 표시합니다. `off`이면 알림을 띄우지 않습니다 |
| `skills` | off | skill 힌트 스위치(beta, 기본값 꺼짐). `on`으로 켭니다. `off`는 skill 힌트만 끄며 모델 선택은 그대로 동작합니다 |
| `skills-allow` | (전체) | 지정한 skill만 후보로 삼습니다. 쉼표로 구분하며, 이름은 `/skills`에 나열된 그대로 씁니다. 예: `mattpocock-skills:tdd,grilling`. `none`으로 비웁니다 |
| `skills-exclude` | (없음) | 지정한 skill에는 힌트를 주지 않습니다. 작성 방식은 위와 같으며, `skills-allow`와 둘 다 나열된 skill은 제외가 우선합니다 |

켜져 있으면 prompt 아래 상태 표시줄에 실제로 응답한 모델, 버전, effort가 표시되고, 그 뒤에 cache 게이지가 이어집니다. 예: `🍷 opus 5.5·medium ▰▰▱▱▱ 95k`. 옆에 Claude Code가 자체적으로 표시하는 것은 session의 모델입니다.

**cache 게이지**: 숫자는 현재 모델에 누적된 cache 양입니다. 5칸은 allowed 범위 안에서 한 단계 낮은 모델로 바꿀 때의 전환 비용(cache를 다시 쓰는 비용)이 예상 절감 한도의 얼마를 차지하는지를 나타내며, 한 칸이 20%입니다. 칸이 찰수록 내려가는 것이 손해에 가까워집니다. 가득 찬 칸에 `⚠`가 붙으면(예: `▰▰▰▰▰⚠ 243k`) 전환 비용이 절감액을 넘었다는 뜻이며, 이때 sommelier는 다운그레이드를 막고 직접 바꾸는 것도 권장하지 않습니다. cache가 만료되었거나 이미 allowed 안에서 가장 낮은 모델이면 칸이 모두 비어 있습니다. 상태 표시줄은 색을 입힐 수 없어서 가득 찬 칸과 `⚠`를 경고 표시로 씁니다. 화면이 답답하면 `/somm config cache off`로 끌 수 있습니다.

<img src="assets/status-line/status-line.en.png" alt="상태 표시줄 cache 게이지의 네 가지 상황별 모습(예시 이미지, 영어 표기)" width="640">

<sub>예시 이미지: 막 시작한 대화, 길어진 대화, 모델 전환을 권장하지 않는 상태, 이미 가장 낮은 모델인 상태.</sub>

`/somm`을 다른 plugin이 사용 중이면 자동으로 `/sommelier`로 대체됩니다.

**모델을 직접 지정하기(오버라이드)**: prompt 앞에 `somm:opus`, `somm:sonnet`, `somm:haiku`(대소문자 무관)를 쓰면 그 요청은 지정한 모델(effort medium)을 사용하며 Jev에는 보내지 않습니다. 접두어는 먼저 제거되므로 모델에게는 보이지 않습니다. 이후 같은 주제에서는 Jev가 새 주제로 판단하거나, `/clear`를 하거나, `/model`로 모델을 바꿀 때까지 이 모델을 계속 사용합니다. 접두어만 쓰고 내용이 없으면 아무것도 보내지 않고, 이어서 쓸 모델만 설정합니다. 모델을 바꾸면서 cache를 다시 써야 할 때는 몇 token을 다시 써야 하는지와 대략적인 비용을 알려 주는 알림이 나타납니다.

**요청마다 결정하는 방식:**
- **업그레이드**: 더 강한 모델이나 더 높은 effort가 필요하다고 판단되면 언제든 올립니다
- **고위험**: 데이터를 삭제하거나 덮어쓰는 요청, 운영 환경이나 권한을 바꾸는 요청은 모델을 최소 base(기본 opus)까지 올리고, 그 요청의 effort를 high로 높이며, 다음 요청에서는 원래 effort로 돌아갑니다
- **깊은 사고 요청**: prompt에 `ultrathink`, 「仔細想」(자세히 생각해), 「深入想」(깊이 생각해)이 있으면(코드 블록 안은 제외) Jev에 보내지 않고 곧바로 opus · high를 사용합니다
- **다운그레이드**: 새 주제이면서 예상 절감 한도가 cache를 다시 쓰는 비용보다 클 때만 내리며, 그렇지 않으면 그 요청은 현재 모델을 유지합니다
- **유지**: 같은 주제에서 더 낮게 판단되었을 때, 짧은 응답(예: 「好」(좋아), 「繼續」(계속). Jev에 보내지 않음), Jev가 시간 초과되거나 오류를 반환했을 때는 현재 모델을 유지합니다
- **긴 대화에는 haiku 미사용**: 대화가 30k tokens를 넘으면 haiku로 내리지 않으며, 이미 haiku를 쓰던 대화가 이 길이를 넘으면 sonnet으로 바꿉니다

**skill 힌트**(beta, 기본값 꺼짐. `/somm config skills on`으로 켬): 모델을 판단할 때 Jev가 이 요청에 skill이 필요한지, 어느 skill이 가장 알맞은지도 함께 판단합니다. 충분히 확신할 때(「skill이 필요함」 ≥ 0.30이고 1순위 ≥ 0.5) sommelier는 그 요청 옆에 Claude를 위한 힌트를 덧붙입니다. 예: 「이 요청에는 skill『tdd』가 적합할 수 있습니다(틀릴 수 있음)」. 이는 제안일 뿐이며, Claude가 적합하지 않다고 판단하면 무시합니다. 힌트는 모델에 영향을 주지 않습니다. 후보는 이 session에서 Claude가 스스로 호출할 수 있고 설명이 있는 skill이며, `skills-allow`와 `skills-exclude`로 좁힐 수 있습니다. 같은 주제 안에서는 같은 skill을 한 번만 알리고, 주제가 바뀌거나 `/clear`를 한 뒤에야 다시 알립니다. 힌트가 있으면 spinner에 `💡tdd`가 표시되고, `/somm log`에는 Claude가 채택했는지 여부가 기록됩니다. skill 힌트를 켜면 Jev의 판단이 끝나야 힌트를 붙일 수 있으므로, prompt를 보낸 뒤 먼저 Jev를 기다립니다(최대 1.5초).

### 선택 가능한 모델과 skill

**모델**: sommelier는 아래 세 모델 중에서만 고르며, effort는 medium 또는 high만 사용합니다.

| 모델 | 전송되는 모델 ID | sommelier가 선택하는 경우 |
|---|---|---|
| haiku | `claude-haiku-5-5` | L0. 대화가 30k tokens를 넘으면 사용하지 않음 |
| sonnet | `claude-sonnet-5-5` | L1. haiku를 쓰던 대화가 길어졌을 때도 이 모델로 바꿈 |
| opus | `claude-opus-5-5` | L2(base, medium), L3, 깊은 사고 요청(high). 고위험 요청은 최소 base 사용 |

날짜 접미사가 붙은 ID(예: `claude-sonnet-5-5-20261001`)도 인식합니다. 선택 가능한 범위를 바꾸려면:

- **범위 좁히기**: `/somm config allowed sonnet-opus`는 haiku를 쓰지 않고, `opus-opus`는 opus만 쓰는 것과 같습니다
- **L2 단계 바꾸기**: `/somm config base sonnet` 또는 `opus:high`. 어떤 모델이든 medium／high를 붙일 수 있지만 `allowed` 범위 안이어야 합니다
- **이 주제에 모델 지정**: prompt 앞에 `somm:haiku`, `somm:sonnet`, `somm:opus`를 씁니다(effort는 medium 고정이며 `allowed`의 제한을 받지 않음)
- **완전히 직접 결정**: `/model`로 session의 모델을 바꿉니다. Default로 되돌리기 전까지 sommelier는 모델을 바꾸지 않습니다

**skill**(skill 힌트가 켜져 있을 때): 힌트를 줄 수 있는 후보 skill은 이 session이 결정하므로 따로 등록할 필요가 없습니다.

- **후보가 되는 skill**: Claude가 스스로 호출할 수 있고 설명이 있는 skill, 즉 `/skills`에 나열되며 수동 호출 전용으로 지정되지 않은 것들입니다. plugin의 skill은 `plugin이름:skill이름` 형식으로 씁니다. 예: `mattpocock-skills:tdd`
- **개수**: 이름순으로 정렬해 최대 255개이며, 넘는 것은 건너뜁니다. 2개 미만이면 Jev에게 skill 관련 질문을 하지 않습니다
- **일부만 힌트 주기**: `/somm config skills-allow mattpocock-skills:tdd,grilling`. `none`으로 비우면 전체로 돌아갑니다
- **일부 제외하기**: `/somm config skills-exclude cost-today`. 두 목록에 모두 있으면 제외가 우선합니다
- **효과 확인**: `/somm log`에 문장마다 어떤 skill을 알렸는지, Claude가 채택했는지가 기록됩니다

**다음 경우에는 sommelier가 모델을 바꾸지 않습니다:**
- 꺼져 있거나 현재 프로젝트가 비활성화된 경우
- 처음 전송 전 확인에 동의하지 않은 경우
- session의 첫 요청에서 Jev가 실패했거나 API key가 설정되지 않은 경우(이후 요청에서 실패하면 현재 모델 유지)
- subagent의 요청

### 예시

plugin이 실제로 표시하는 문자열은 현재 중국어(번체)이며, 한국어 설명은 주석이나 괄호로 덧붙였습니다.

켠 뒤 「parseDate에 시간대 매개변수를 추가해 줘」를 보내면, Jev가 L1으로 판단하여 session의 opus에서 sonnet으로 내려가고 spinner에 다음과 같이 표시됩니다.

```
sonnet·medium L1 · 新話題，降級   # 새 주제, 다운그레이드
```

이어서 「좋아」라고 답하면 짧은 응답은 Jev에 보내지 않고 같은 단계를 유지합니다.

```
sonnet·medium · 沿用             # 유지
```

다시 「멀티 테넌트 권한 아키텍처를 설계해 줘」를 요청하면 Jev가 L3으로 판단하여 업그레이드합니다.

```
opus·high L3 · 升級              # 업그레이드
```

`/somm status`:

```
sommelier 開啟｜API key 已設定｜本 session 檔位 sonnet·medium
# sommelier 켜짐 | API key 설정됨 | 이 session의 단계 sonnet·medium
```

`/somm log 3`: P는 Jev가 L0／L1／L2／L3으로 판단한 확률입니다. `session`은 이번 턴에 session 자체의 모델을 썼다는 뜻이고, 「回答」(응답)은 실제로 응답한 모델이며, 대괄호는 session ID의 앞 6자리입니다.

```
sonnet·medium · 回答 sonnet · downgrade P=0.05/0.90/0.05/0.00 jev 820ms cache read 0 write 18342 [a1b2c3]
sonnet·medium · 回答 sonnet · continuation cache read 18342 write 1204 [a1b2c3]
opus·high · 回答 opus · upgrade P=0.02/0.08/0.20/0.70 jev 410ms cache read 0 write 21530 [a1b2c3]
```

## 제한 사항

- **수동 `/model`**: `/model`로 모델을 바꾼 뒤에는 `/clear`와 대화 재개 후에도 `/model`에서 Default를 다시 고를 때까지 sommelier가 모델을 바꾸지 않습니다. Claude Code가 자동으로 다른 모델로 fallback한 뒤에도, 직접 `/model`을 실행할 때까지 손을 떼고 있습니다.
- **판단하지 않는 턴**: 알림, 예약 작업, 다른 session이나 다른 plugin이 보낸 메시지, slash 명령은 현재 모델을 유지하며 Jev에 보내지 않습니다. session 모델이 Opus／Sonnet／Haiku 5.5가 아닌 경우(예: `[1m]` 버전이나 이전 버전) sommelier는 아무것도 바꾸지 않습니다.
- **이득이 없으면 다운그레이드하지 않음**: 모델마다 cache가 따로 있어서, 모델을 바꾸면 대화를 새 모델의 cache에 써야 합니다. sommelier는 모델별 cache가 어디까지 채워져 있는지 기록해 둡니다. 한 번도 쓰지 않았거나 cache 유효 시간을 넘겨 유휴 상태인 모델로 바꾸면 전체를 다시 써야 하고, 방금 쓴 모델로 돌아가면 차이분만 채우며, `/clear`, compact, resume 뒤에는 시스템 프롬프트만 cache에 남습니다. 내릴 때는 「다시 쓰는 비용」과 「3턴 동안 절약할 수 있는 예상 금액」을 비교하여, 회수하지 못하면 그 요청은 원래 모델을 유지하고 다음 새 주제에서 다시 평가합니다. 올리는 경우에는 영향이 없습니다. 가격은 공식 정가를 사용하며 `hooks/decide.ts`에 있습니다.
- **모델 선택 메뉴에는 session 모델이 표시됨**: sommelier는 session 자체의 모델이 아니라 전송되는 요청마다 모델을 바꾸므로, `/model`과 Desktop의 모델 선택 메뉴에는 계속 원래 모델이 표시됩니다. 실제로 응답한 모델은 상태 표시줄 🍷 뒤의 모델을 보세요.
- **Jev의 판단에는 시간이 걸림**: 요청마다 판단을 최대 1.5초까지 기다립니다(오프라인 평가 p95 약 0.4초). 짧은 응답은 Jev에 보내지 않으므로 기다리지 않습니다.
- **Desktop app**: Code tab에서는 `/plugin configure`로 API key를 입력할 수 없으므로 터미널에서 설정해야 합니다(「설치」 참고).

## 문제 해결

| 증상 | 해결 방법 |
|---|---|
| `/somm status`에 「API key 未設定」(API key 미설정)이라고 표시됨 | 「설치」의 2단계를 다시 수행하세요. 환경 변수에만 의존한다면 Claude Code를 시작한 shell에서 `TYPESAFE_API_KEY`를 읽을 수 있는지 확인하세요. Dock에서 연 Desktop app은 `~/.zshrc`를 읽지 못합니다 |
| spinner에 `Jev 失敗`(Jev 실패)가 표시됨 | `/somm log`로 원인을 확인하세요. `no_key`는 key 없음, `timeout`은 1.5초 초과, `http_401` 등은 API가 반환한 오류, `fetch_failed`는 TypeSafe에 연결할 수 없음을 뜻합니다. 이번 턴은 현재 모델을 유지하며, session의 첫 요청에서 실패했다면 session 자체의 모델을 사용합니다 |
| `/somm` 명령이 보이지 않음 | 다른 plugin이 사용 중이므로 `/sommelier`를 사용하세요 |
| 코드를 고쳤는데 반영되지 않음 | 정식 설치본은 `plugin.json`의 `version`을 기준으로 cache됩니다. 버전 번호를 올린 뒤 `claude plugin update sommelier@sommelier`를 실행하고 다시 시작하거나, 개발할 때는 `--plugin-dir`을 사용하세요 |

## 개인정보 및 데이터

sommelier는 설치 후 기본값이 켜짐이며, 켜져 있는 동안에는 판단을 위해 데이터를 TypeSafe로 보냅니다. 처음 전송하기 전에 동의 여부를 먼저 묻고, `/somm off`로 끄면 아무것도 전송하지 않습니다.

- **언제 보내나**: 새 요청마다 보냅니다. 짧은 응답(공백과 문장부호를 제외하고 8자 이내, 예: 「好」「繼續」)은 보내지 않습니다
- **무엇을 보내나**: 이번 요청(최대 2000자)과 최근 3턴 대화의 텍스트(항목당 최대 500자, 끝부분만 유지). skill 힌트를 켜면 후보 skill의 이름과 설명(항목당 최대 300자)도 함께 보냅니다. 처음 사용할 때의 동의 확인에는 skill이 포함되지 않으며, skill 힌트를 켠 뒤 skill 데이터를 처음 보내기 전에 별도로 한 번 더 확인합니다. 동의하지 않으면 skill 힌트만 꺼집니다
- **전송 전 마스킹**: 흔한 비밀 값 형식은 `[REDACTED]`로 바뀝니다. `sk-`, `AKIA`, `ghp_`, `xoxb-`／`xoxp-`, `AIza`, `Bearer`, `password=`, JWT, 개인 키 블록, 32자 이상의 16진수 문자열이 포함됩니다
- **보내지 않는 것**: 파일 내용, 도구 호출과 도구 출력, subagent의 요청, 그리고 `/somm off --project`로 비활성화한 프로젝트
- **로컬 기록**: `/somm log`의 기록에는 단계, Jev의 확률, 지연 시간, cache 읽기/쓰기량, 힌트를 준 skill과 채택 여부, prompt의 앞 40자(마스킹 후)가 저장되며, 비활성화한 프로젝트는 prompt를 저장하지 않습니다. 이와 별도로 session별 분배 상태(현재 단계, cache 장부, 오버라이드 잠금 등. prompt는 포함하지 않음)도 로컬에 저장되어, plugin을 업데이트한 뒤에도 실행 중인 session이 이어서 동작할 수 있습니다. 최근 20개 session만 보관합니다
- **API key**: macOS Keychain(`/plugin configure`)에 저장하거나, 환경 변수 `TYPESAFE_API_KEY`에서 읽습니다

## 개발 참여

개발 환경, 오프라인 평가, 프로젝트 구조는 [CONTRIBUTING.md](CONTRIBUTING.md)(중국어)를 참고하세요.

## 문서

- [GLOSSARY.md](GLOSSARY.md): 용어 정의(단계, 새 주제, cache 장부…)

## 라이선스

[MIT](LICENSE)
