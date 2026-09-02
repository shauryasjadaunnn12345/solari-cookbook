# ShipProof 🚢

## Autonomous AI QA Engineer powered by Mistral + Solari

ShipProof is an autonomous AI-powered QA engineer that explores real web applications, identifies suspicious behavior, and then proves whether the suspected bug is actually reproducible.

Instead of simply asking an LLM to report bugs, ShipProof follows a stronger workflow:

    Explore
        ↓
    Detect
        ↓
    Reproduce
        ↓
    Verify
        ↓
    Capture Evidence
        ↓
    Report

> **Don't trust the AI. Make it prove the bug.**

---

# 🎯 What ShipProof Does

Give ShipProof a web application URL.

ShipProof then:

1. Opens the application using Solari Browser
2. Uses Mistral to reason about what to test
3. Interacts with the application autonomously
4. Observes page state and application behavior
5. Detects suspicious behavior
6. Marks suspicious behavior as a `potential_bug`
7. Enters Proof Mode
8. Reproduces the behavior in fresh sessions
9. Requires independent reproduction before calling something verified
10. Collects evidence
11. Generates a structured BugReport
12. Stores artifacts from the run for inspection

This makes ShipProof closer to an autonomous QA engineer than a simple browser chatbot.

---

# 🧠 Core Concept: Proof Mode

Traditional AI testing can produce false positives:

    AI sees something strange
            ↓
    AI assumes it is a bug
            ↓
    AI reports the bug

ShipProof uses a stricter workflow:

    AI sees something strange
            ↓
       Potential Bug
            ↓
       Fresh Session
            ↓
         Reproduce
            ↓
       Fresh Session
            ↓
       Reproduce Again
            ↓
    Enough successful reproductions?
            ↓
       ┌────┴────┐
       YES       NO
        ↓         ↓
    VERIFIED   UNCONFIRMED /
               INCONCLUSIVE

The system therefore separates:

- `potential_bug`
- `bug_verified`
- `unconfirmed`
- `inconclusive`

A suspicious observation is **not automatically treated as a confirmed defect**.

---

# 🏗️ Architecture

    ┌──────────────────────┐
    │      User URL        │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │     ShipProof CLI    │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │   Mistral Planner    │
    │                      │
    │ - Reason             │
    │ - Choose action      │
    │ - Recover from errors│
    │ - Identify bugs      │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │    Solari Browser    │
    │                      │
    │ - Navigate           │
    │ - Click              │
    │ - Type               │
    │ - Observe            │
    │ - Screenshot         │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Observation / State  │
    └──────────┬───────────┘
               │
          ┌────┴────┐
          │         │
          ▼         ▼
       Normal    Suspicious
      Progress     State
          │         │
          │         ▼
          │  ┌──────────────┐
          │  │  Proof Mode  │
          │  └──────┬───────┘
          │         │
          │         ▼
          │  Fresh Sessions
          │         │
          │         ▼
          │ Reproduction Runs
          │         │
          └────┬────┘
               │
               ▼
    ┌──────────────────────┐
    │ Evidence Collection  │
    │                      │
    │ - URL                │
    │ - Actions            │
    │ - Observations       │
    │ - Screenshots        │
    │ - Errors             │
    │ - Timestamps         │
    │ - Run ID             │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │      BugReport       │
    └──────────────────────┘

---

# 🤖 Mistral

ShipProof uses Mistral as the reasoning and planning layer.

Mistral is responsible for decisions such as:

- What should be tested?
- What action should happen next?
- Which page element should be interacted with?
- How should an execution error be recovered?
- Does observed behavior look suspicious?
- What is the expected behavior?
- What is the actual behavior?
- Is there enough evidence to classify the behavior as a bug?

The browser itself does not decide what to test.

The AI planner decides, while ShipProof enforces safety and execution constraints around those decisions.

---

# 🌐 Solari Browser

Solari provides the browser execution environment.

ShipProof uses Solari Browser for:

- Page navigation
- Browser sessions
- Persistent profiles
- DOM interaction
- Clicking
- Typing
- Page evaluation
- Screenshots
- Fresh-session reproduction

Solari is Playwright-compatible, allowing ShipProof to use familiar browser automation patterns.

---

# 🛡️ Selector Safety

One major failure mode in autonomous browser agents is unsafe or ambiguous selectors.

For example:

    button

might match several buttons.

An autonomous agent could accidentally click the wrong element.

ShipProof therefore validates action targets before execution.

Broad selectors such as:

    button
    input
    a
    *

are rejected when they are unsafe.

Selectors are checked against the live page.

The system distinguishes:

    Unique target
        ↓
    Allowed

    Zero targets
        ↓
    Recoverable planning error

    Multiple targets
        ↓
    Recoverable planning error

    Broad / unsafe selector
        ↓
    Rejected

This prevents the agent from blindly interacting with arbitrary elements.

---

# 🔄 Planner Recovery

Browser automation is inherently uncertain.

The AI may produce an invalid selector or encounter an unexpected page state.

ShipProof does not immediately terminate the run.

Instead:

    Planner Action
          ↓
       Validate
          ↓
       Execute
          ↓
       Failure?
       ┌──┴──┐
      NO    YES
      │       │
      ▼       ▼
    Continue Recovery
              │
              ▼
           Mistral
              │
              ▼
          New Action

Recoverable execution errors are fed back into the planning process.

This allows ShipProof to adapt rather than repeatedly executing the same invalid action.

---

# 📈 Progress Control

Autonomous agents can get stuck repeating the same behavior.

ShipProof tracks:

- Previous actions
- Action targets
- Page observations
- Observation fingerprints
- Repeated actions
- Per-test action budgets
- Observation budgets
- No-progress events

For example:

    click #openWorkspace
            ↓
    same observation
            ↓
    click #openWorkspace
            ↓
    same observation
            ↓
    repeated action detected
            ↓
    change strategy / investigate

The agent is therefore prevented from endlessly repeating an action that is producing no progress.

---

# 🧪 Test Isolation

Proof Mode uses isolated reproduction attempts.

The purpose is to reduce contamination from earlier exploration.

Conceptually:

    Exploration Session
            │
            ▼
       Potential Bug
            │
       ┌────┴────┐
       ▼         ▼
    Fresh     Fresh
    Session 1 Session 2
       │         │
       ▼         ▼
    Reproduce Reproduce
       │         │
       └────┬────┘
            ▼
     Compare Evidence
            │
            ▼
       Verification

This is important because an error from a previous workflow should not automatically become evidence for an unrelated bug.

---

# 📸 Evidence Collection

ShipProof collects evidence associated with a run.

Typical evidence includes:

- Run ID
- Timestamp
- URL
- Browser actions
- Action targets
- Page observations
- Errors
- Screenshots
- Reproduction count
- Bug status
- Expected behavior
- Actual behavior
- AI reasoning

The objective is to make the final report auditable instead of relying only on an LLM-generated description.

---

# 🐞 Bug Reports

ShipProof generates structured reports containing information such as:

- Bug ID
- Title
- Category
- Severity
- Status
- Expected behavior
- Actual behavior
- Reasoning
- Reproduction count
- Evidence
- Run information

Example:

    Bug ID: NAVI-94830

    Title:
    Open workspace navigates to an error page when no workspace is selected

    Status:
    VERIFIED

    Reproductions:
    3 / 3

    Severity:
    LOW

    Expected:
    The application should either prevent the action or provide
    a useful message when no workspace is selected.

    Actual:
    The application navigates to /missing-workspace and displays
    an error page.

    Evidence:
    - Browser actions
    - URL transition
    - Page observation
    - Reproduction sessions

---

# 🧪 Northstar Console

ShipProof includes a deterministic demo application called:

**Northstar Console**

It exists specifically to demonstrate autonomous QA behavior.

The application contains an intentional navigation bug.

The relevant workflow is:

    Northstar Console
           ↓
       Workspace
           ↓
    Open workspace
           ↓
    /missing-workspace
           ↓
      Error page

ShipProof can:

1. Discover the behavior
2. Identify it as suspicious
3. Enter Proof Mode
4. Create fresh browser sessions
5. Reproduce the behavior
6. Collect screenshots and run evidence
7. Generate a verified BugReport

The defect is intentional and exists specifically for QA testing.

---

# 🖥️ Dashboard

ShipProof includes a live dashboard for observing autonomous QA runs.

The dashboard displays:

- Target URL
- Test plan
- Live actions
- Observations
- Errors
- Potential bugs
- Proof Mode events
- Verification attempts
- Generated BugReports
- Evidence

Example event flow:

    test_plan
        ↓
    observe
        ↓
    act
        ↓
    potential_bug
        ↓
    Proof Mode
        ↓
    bug_verified

---

# 🧰 Technology Stack

| Component | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| AI reasoning | Mistral |
| Browser automation | Solari Browser |
| Browser API | Playwright-compatible |
| Demo application | Node.js |
| Testing | Node test runner + tsx |
| Configuration | dotenv |
| Dashboard | TypeScript |
| Evidence | Local run artifacts |

---

# 📁 Project Structure

    solari-cookbook/
    │
    ├── examples/
    │   ├── browser-quickstart-ts/
    │   ├── browser-profiles-ts/
    │   ├── browser-session-recording-py/
    │   ├── browser-stealth-proxy-ts/
    │   ├── sandbox-quickstart-ts/
    │   ├── sandbox-code-interpreter-py/
    │   ├── sandbox-port-preview-ts/
    │   └── desktop-computer-use-py/
    │
    └── shipproof/
        │
        ├── src/
        │   ├── cli.ts
        │   ├── dashboard.ts
        │   ├── integration.ts
        │   ├── demo-preview.ts
        │   ├── actions.ts
        │   ├── planner.ts
        │   ├── progress.ts
        │   ├── proof.ts
        │   ├── reports.ts
        │   ├── evidence.ts
        │   └── ...
        │
        ├── demo-app/
        │   └── server.ts
        │
        ├── tests/
        │   └── *.test.ts
        │
        ├── runs/
        │   └── generated run artifacts
        │
        ├── package.json
        ├── tsconfig.json
        ├── .env.example
        └── README.md

---

# ⚙️ Requirements

- Node.js
- npm
- Solari API key
- Mistral API key

Recommended:

    Node.js 20+
    npm

---

# 🚀 Installation

Clone the repository:

    git clone https://github.com/shauryasjadaunnn12345/solari-cookbook.git

Enter the ShipProof project:

    cd solari-cookbook/shipproof

Install dependencies:

    npm install

---

# 🔐 Environment Variables

Create a local `.env` file based on `.env.example`.

Example:

    SOLARI_API_KEY=your_solari_api_key
    MISTRAL_API_KEY=your_mistral_api_key
    MISTRAL_MODEL=mistral-small-latest
    SHIPPROOF_RUN_DIR=./runs

Never commit `.env`.

API keys must remain local.

---

# 🧪 Type Checking

Run:

    npm run typecheck

This verifies the TypeScript project without producing compiled output.

---

# ✅ Tests

Run:

    npm test

The test suite covers important autonomous-agent behavior including:

- Selector validation
- Ambiguous selectors
- Zero-match selectors
- Broad selectors
- Planner recovery
- Progress detection
- Proof Mode behavior
- Mistral error handling
- Retry behavior
- Structured output validation
- Bug classification

---

# 🖥️ Start the Demo Application

Start Northstar Console:

    npm run demo

The demo application runs locally on:

    http://127.0.0.1:4173

Open it in a browser to inspect the deterministic QA fixture.

---

# 📊 Start the Dashboard

Run:

    npm run dashboard

Dashboard:

    http://127.0.0.1:4174

The dashboard provides a visual interface for inspecting ShipProof runs and generated evidence.

---

# 🤖 Run ShipProof

The main CLI can be started with:

    npm start -- http://127.0.0.1:4173

The exact CLI arguments may evolve as the project develops.

---

# 🔬 Integration / Preview

Run:

    npm run integration

For the Solari preview workflow:

    npm run demo:preview

The preview workflow is useful when the remote Solari Browser needs access to the demo application through an exposed environment.

---

# 🔁 Example Autonomous Run

A typical run looks like:

    $ npm start -- http://127.0.0.1:4173

    ShipProof starting...

    Target:
    http://127.0.0.1:4173

    Initializing Solari Browser...

    Initializing Mistral planner...

    Exploration started

    → Observe page
    → Identify sign-in workflow
    → Inspect workspace controls
    → Create workspace
    → Open workspace

    Potential behavior detected

    Entering Proof Mode...

    Proof attempt 1/3
    Fresh session created

    Reproduction successful

    Proof attempt 2/3
    Fresh session created

    Reproduction successful

    Proof attempt 3/3
    Fresh session created

    Reproduction successful

    Bug verified

    Generating evidence...

    Bug report generated

    Run complete

---

# 🏆 Example Verified Bug

Example discovered behavior:

    Open workspace
          ↓
    Application navigates to:
          /missing-workspace
          ↓
       Error page

ShipProof can classify this as:

    potential_bug
          ↓
       Proof Mode
          ↓
    3/3 successful reproductions
          ↓
        VERIFIED

This is significantly stronger than simply asking an LLM:

    "Find bugs on this website."

---

# 💡 Why ShipProof Is Different

Many AI browser agents focus primarily on:

    "Can the AI use the browser?"

ShipProof focuses on:

    "Can the AI discover a problem and prove that it is real?"

The important engineering problems are therefore:

### 1. Planning

The AI must decide what to do next.

### 2. Execution

The browser must execute actions safely.

### 3. Recovery

The agent must recover from invalid actions.

### 4. Progress

The agent must avoid getting stuck.

### 5. Evidence

The system must collect meaningful evidence.

### 6. Verification

A suspected bug must be reproduced independently.

### 7. Reporting

The final result must be understandable to a human engineer.

---

# 🧩 Design Principles

## AI proposes, the system validates

Mistral can propose actions, but ShipProof validates them before execution.

## Suspicion is not proof

A strange observation becomes:

    potential_bug

before it becomes:

    bug_verified

## Fresh sessions matter

Reproduction should not depend on accidental state left behind by the initial exploration.

## Evidence matters

A bug report should explain:

    What happened?
    Why is it unexpected?
    Can it be reproduced?
    What evidence supports it?

## Fail safely

Invalid selectors and unsafe actions should produce recoverable errors rather than arbitrary browser interactions.

---

# 🔒 Security

Never commit API keys.

The following should remain local:

    .env
    API keys
    tokens
    private credentials
    session secrets

`.gitignore` excludes sensitive environment configuration and generated run artifacts.

If an API key is accidentally exposed publicly, revoke or rotate it immediately.

---

# 📌 Current Project Status

ShipProof currently demonstrates:

- Mistral-powered planning
- Solari Browser execution
- Autonomous browser exploration
- Selector safety validation
- Planner recovery
- Progress detection
- No-progress handling
- Potential bug detection
- Proof Mode
- Fresh-session reproduction
- Reproduction counting
- Structured bug classification
- Evidence collection
- Bug reports
- Deterministic Northstar Console fixture
- Automated tests
- Dashboard
- Solari preview workflow

The system is designed as a focused prototype demonstrating how autonomous AI can be combined with deterministic software controls to create a more reliable QA workflow.

---

# 🔮 Future Improvements

Potential future extensions include:

- Multi-page workflow generation
- Authentication-aware testing
- API + UI cross-validation
- Network request analysis
- Console error correlation
- Accessibility testing
- Performance regression detection
- Visual regression testing
- More advanced test-case generation
- Parallel proof sessions
- Persistent regression suites
- GitHub issue creation
- CI/CD integration
- Automatic regression testing on pull requests
- Historical bug tracking
- Browser matrix testing

---

# 📚 Solari Cookbook

ShipProof is implemented inside the Solari Cookbook repository so that it can directly build on the provided Solari examples and SDK patterns.

Repository:

    https://github.com/shauryasjadaunnn12345/solari-cookbook

ShipProof:

    https://github.com/shauryasjadaunnn12345/solari-cookbook/tree/main/shipproof

---

# 👨‍💻 Author

Built by **Shaurya Singh** for the Solari SWE Intern hiring challenge.

The project focuses on autonomous browser QA, reliable agent execution, evidence-driven bug verification, and practical AI engineering.

---

# ⭐ Final Idea

ShipProof is not designed to simply make an AI click buttons.

It is designed to make autonomous QA more trustworthy.

    AI proposes
        ↓
    ShipProof validates
        ↓
    Solari executes
        ↓
    Agent observes
        ↓
    Suspicion is detected
        ↓
    Proof Mode reproduces
        ↓
    Evidence is collected
        ↓
    Bug is verified
        ↓
    Human-readable BugReport

> **Don't trust the AI. Make it prove the bug.**
