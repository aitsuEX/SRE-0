````md
# SRE-Zero — AI Incident Commander

Voice-native AI incident commander built on **Agora Conversational AI**. SRE-Zero joins a live engineering war room, listens to multiple participants, organizes incident evidence, detects conflicts, coordinates actions, and keeps humans in control of critical production decisions.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Create environment file
cp env.local.example .env.local

# 3. Configure .env.local
# Add your Agora credentials and incident integrations

# 4. Start the development server
pnpm dev

# 5. Open
http://localhost:3000
````

## Environment Variables

Create a `.env.local` file:

```env
# Agora
NEXT_PUBLIC_AGORA_APP_ID=your_agora_app_id
NEXT_AGORA_APP_CERTIFICATE=your_agora_app_certificate

# MCP
MCP_SERVER_URL=https://your-public-url/api/mcp

# Incident configuration
INCIDENT_NAME=your_incident_name
INCIDENT_WEBSITE_URL=https://your-incident-website.com
INCIDENT_GITHUB_REPO_URL=https://github.com/your-org/your-repository
INCIDENT_TESTSPRITE_URL=
INCIDENT_MONITORING_URL=https://www.githubstatus.com/

# Optional incident metadata
INCIDENT_ID=
INCIDENT_SEVERITY=
INCIDENT_DESCRIPTION=
INCIDENT_GITHUB_BRANCH=
INCIDENT_MONITORING_SERVICE=

# Safety
SRE_ZERO_ALLOW_DESTRUCTIVE_ACTIONS=false

# MCP authentication
MCP_AUTH_TOKEN=

# Jira
INCIDENT_JIRA_URL=https://your-instance.atlassian.net
INCIDENT_JIRA_PROJECT_KEY=YOUR_PROJECT_KEY
INCIDENT_JIRA_EMAIL=your-email@example.com
INCIDENT_JIRA_API_TOKEN=your_jira_api_token
```

> **Security:** Never commit `.env.local` or expose Agora App Certificates, Jira API tokens, or other secrets in source control.

Get your Agora App ID and App Certificate from the [Agora Console](https://console.agora.io/).

---

## How It Works

### Room Codes — Multi-Participant War Rooms

1. **Start Incident:** One participant creates an incident war room and receives a room code such as `SRE-AB12`.
2. **Share the code:** Other engineers enter the same room code.
3. **Join the Agora channel:** All participants join the same real-time voice channel.
4. **SRE-Zero joins:** The AI incident commander joins the same channel and listens to the team.

The first participant starts the AI agent. Subsequent participants reuse the existing agent for that incident room, preventing duplicate agents.

### Join Form — Name + Role

When starting or joining an incident, participants provide:

* **Name**
* **Role**

  * Engineer
  * SRE
  * Support
  * Business
  * Manager
  * Other operational roles

The participant roster is provided to the AI agent at runtime so SRE-Zero knows who is present and can associate incident information with the appropriate participant.

---

## AI Agent — Agora Conversational AI

SRE-Zero uses **Agora Conversational AI** for real-time voice interaction.

### Voice Pipeline

* **Speech-to-Text:** Deepgram Nova-3
* **LLM:** OpenAI GPT-4o-mini
* **Text-to-Speech:** MiniMax Speech 2.6 Turbo
* **Realtime communication:** Agora RTC
* **AI agent orchestration:** Agora Conversational AI

The voice pipeline allows SRE-Zero to participate directly in the live incident room instead of operating as a separate chatbot.

---

## Multi-Participant Audio

SRE-Zero subscribes to all remote participants in the Agora channel, allowing the AI agent to hear multiple engineers in the same incident room.

Each participant has an Agora RTC UID associated with the incident roster. Transcribed speech can therefore be associated with the corresponding participant when the identity information is available.

The system is designed for real-time team participation rather than a single-user voice interaction.

### Known Limitation

SRE-Zero uses participant RTC identities for attribution and does not perform independent voice-print identification.

If multiple people share the same browser, microphone, or RTC identity, the system cannot reliably distinguish those individuals.

---

## Real-Time Chat

The incident room supports team communication alongside live voice.

### Everyone

Messages sent to **Everyone** are visible to participants in the incident room and can contribute to incident context.

### Direct Messages

Participants can communicate privately through direct messages.

Direct messages are not automatically treated as public incident facts.

### Incident Context

Information from private communication should only become part of the shared incident context when it is explicitly shared with the incident room.

```text
Voice
   │
   ▼
SRE-Zero

Everyone Chat
   │
   ▼
Incident Context

Direct Chat
   │
   ├── Private
   │
   └── Explicitly Shared → Incident Context
```

---

## Evidence-First Incident Intelligence

SRE-Zero maintains structured incident state throughout the investigation.

The system separates different types of information instead of treating every statement as fact.

### Incident State

* Confirmed facts
* Supported observations
* Hypotheses
* Evidence
* Decisions
* Actions
* Owners
* Timeline
* Conflicts
* Missing information
* Unresolved risks
* Participant status

SRE-Zero follows an **evidence-first approach**.

It does not automatically treat an engineer's assumption as a confirmed fact and does not claim a root cause unless available evidence supports it.

When evidence is unavailable, the system should represent the information as **UNKNOWN** or **UNAVAILABLE** rather than inventing a result.

---

## External Evidence & Integrations

SRE-Zero can connect to external incident sources through its MCP layer.

### Incident Website

The configured incident website can be inspected to understand the current application or service state.

### GitHub

SRE-Zero can inspect configured repository evidence such as recent commits to help correlate code changes with an incident.

### Monitoring

A configured monitoring or status source can provide service health and operational metrics.

### TestSprite

TestSprite can be configured as an additional testing and evidence source.

### Jira

SRE-Zero can create and populate Jira incident tickets with relevant incident information.

---

## MCP Tools

The MCP server exposes incident-response tools including:

* `check_monitoring`
* `get_recent_commits`
* `create_jira`
* `record_fact`
* `get_incident_state`
* `detect_conflict`
* `request_approval`
* `execute_rollback`

These tools allow the AI agent to interact with the incident state and configured external systems through controlled tool calls.

---

## Jira Incident Management

SRE-Zero connects live incident coordination with engineering workflows through Jira.

It can create and populate incident tickets with information such as:

* Incident description
* Severity
* Current status
* Evidence
* Confirmed facts
* Hypotheses
* Decisions
* Actions
* Owners
* Timeline
* Unresolved risks

Jira credentials are provided through environment variables and should never be committed to the repository.

---

## Human-in-the-Loop Safety

SRE-Zero is designed to assist with critical remediation while keeping humans in control.

For example, SRE-Zero can identify and prepare a rollback workflow, but critical production actions require explicit human approval.

The safety configuration can disable destructive actions:

```env
SRE_ZERO_ALLOW_DESTRUCTIVE_ACTIONS=false
```

This prevents the AI from independently performing high-impact production operations when destructive actions are disabled.

### Principle

```text
AI identifies and prepares
        ↓
Human reviews
        ↓
Human approves
        ↓
Critical action executes
```

SRE-Zero therefore acts as an incident coordinator and assistant rather than an autonomous production operator.

---

## Live Incident Report

During an active incident, SRE-Zero maintains a live text-based incident report.

The report evolves with the incident and can contain:

* Incident overview
* Current status
* Confirmed facts
* Observations
* Hypotheses
* Evidence
* Decisions
* Actions
* Owners
* Conflicts
* Missing information
* Timeline
* Unresolved risks

This gives the team a continuously updated operational view of the incident.

---

## Final Incident & Conversation Report

After the incident, SRE-Zero can generate a final report based on the actual incident state and conversation.

### Conversation Report

The conversation layer preserves what actually happened during the incident, including:

* Timestamps
* Speaker names
* Participant roles
* Voice transcripts
* Public room messages
* SRE-Zero responses
* Relevant shared messages
* System events
* Tool activity

Conversation sources can be distinguished by type:

```text
[VOICE]
[CHAT → EVERYONE]
[DIRECT CHAT]
[SYSTEM]
[TOOL]
[SRE-ZERO]
```

Private direct messages remain private unless explicitly shared with the incident room.

### Incident Intelligence Report

The operational layer contains:

* Incident overview
* Evidence
* Confirmed facts
* Supported observations
* Hypotheses and confidence
* Decisions
* Actions and owners
* Conflicts
* Missing information
* Unresolved risks
* Recovery status
* Root-cause status

If the root cause has not been established by sufficient evidence, the report explicitly states that the root cause remains unconfirmed rather than inventing one.

---

## Architecture

```text
                    HUMAN TEAM
                        │
                  Live Voice / Chat
                        │
                        ▼
             ┌─────────────────────┐
             │      Agora          │
             │ Conversational AI   │
             └──────────┬──────────┘
                        │
                 Tool / MCP Calls
                        │
                        ▼
             ┌─────────────────────┐
             │   SRE-Zero Core     │
             │                     │
             │ Facts               │
             │ Hypotheses          │
             │ Evidence            │
             │ Decisions           │
             │ Actions             │
             │ Owners              │
             │ Timeline            │
             │ Conflicts           │
             │ Risks               │
             └──────────┬──────────┘
                        │
                        ▼
             ┌─────────────────────┐
             │    MCP Middleware   │
             └──────────┬──────────┘
                        │
       ┌────────────────┼────────────────┐
       │                │                │
       ▼                ▼                ▼
   Website           GitHub          Monitoring
       │                │                │
       └────────────────┼────────────────┘
                        │
             ┌──────────┴──────────┐
             │                     │
             ▼                     ▼
          TestSprite             Jira

                        │
                        ▼
              Incident Reports
```

---

## Project Structure

```text
Browser (Next.js + Tailwind CSS)
  │
  ├── LandingPage.tsx
  │     └── Incident war room UI
  │
  ├── ConversationComponent.tsx
  │     └── Agora RTC + RTM voice/chat logic
  │
  └── IncidentSidebar.tsx
        └── Live incident state

API Routes
  ├── /api/invite-agent
  │     └── Start Agora Conversational AI agent
  │
  ├── /api/stop-conversation
  │     └── Stop AI agent
  │
  ├── /api/generate-agora-token
  │     └── RTC + RTM token generation
  │
  ├── /api/roster
  │     └── Participant roster management
  │
  ├── /api/incident-message
  │     └── Incident room messaging
  │
  ├── /api/chat/completions
  │     └── Chat interaction
  │
  ├── /api/approvals
  │     └── Human approval workflow
  │
  └── /api/mcp
        └── MCP incident tool server

Lib
  ├── room-registry.ts
  │     └── Channel, agent and participant tracking
  │
  ├── agora.ts
  │     └── Agora configuration
  │
  ├── incident-state.ts
  │     └── Incident state management
  │
  └── adapters/
        └── External evidence integrations
```

---

## Tech Stack

* **Next.js 14** — App Router
* **TypeScript**
* **Tailwind CSS**
* **Agora Conversational AI**
* **Agora RTC + RTM**
* **Deepgram Nova-3**
* **OpenAI GPT-4o-mini**
* **MiniMax Speech 2.6 Turbo**
* **MCP**
* **Jira**
* **GitHub**
* **TestSprite**
* **Monitoring / Status APIs**
* **Real-time incident state management**

---

## Core Design Principles

### Evidence Over Assumptions

Statements made during an incident are not automatically treated as facts.

### Human Control

Critical production actions require explicit human approval.

### Real-Time Coordination

Voice, chat, evidence, decisions, and actions are maintained as part of the same incident context.

### Operational Memory

SRE-Zero continuously maintains the incident timeline and structured state so important information is not lost during the response.

### Honest Uncertainty

When information cannot be verified, SRE-Zero reports it as unknown or unresolved instead of fabricating an answer.

### Platform-Aware Incident Response

The AI coordinates with external engineering systems through controlled MCP tools rather than directly performing unrestricted actions.

---

## What SRE-Zero Does

SRE-Zero helps engineering teams:

* Join live incident war rooms
* Listen to multiple participants
* Attribute conversation to participants
* Maintain incident context
* Investigate available evidence
* Distinguish facts from hypotheses
* Detect conflicting information
* Identify missing information
* Track decisions
* Track actions and owners
* Maintain a live incident timeline
* Create Jira incident tickets
* Assist with remediation workflows
* Require human approval for critical actions
* Generate live incident reports
* Generate final incident and conversation reports

---

## Project Goal

SRE-Zero is designed to turn a live technical incident room into an **intelligent, evidence-driven command center**.

Instead of replacing the incident response team, SRE-Zero assists the team by listening, investigating, organizing, coordinating, and documenting the incident while keeping humans in control of critical decisions and production actions.

```
```
