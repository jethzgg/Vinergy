# Vinergy

An academic web demo for finding charging/swapping stations and reserving one compatible battery through a form or chatbot. **Requirements status: Draft — team review pending.** Application features, tests, provider setup and deployment are not implemented by this documentation package.

## Requirements package

| File | Purpose |
| --- | --- |
| [Software Requirements Specification](docs/requirements/SRS.md) | Canonical scope, rules, functional/nonfunctional requirements, nine-field use cases, semantic data draft and open decisions |
| [Product Backlog](docs/requirements/Product_Backlog.md) | Required stories/enablers for all three sprints, acceptance criteria and actual WBS mapping |
| [Acceptance Examples and Sample Data](docs/requirements/Acceptance_Examples_and_Sample_Data.md) | 24 proposed acceptance examples, fixture definitions and calculated distance oracles |
| [Station fixture JSON](data/seed_stations_v0.json) | 18 fictional Hanoi-area records, two fictional families and empty starting orders/drafts; data only, no executable loader |

Task 1.1.1 (2–4 Nov 2026) produces these draft inputs for architecture, UI, data and test planning. Review/approval and implementation evidence must be recorded later. The [master plan](../Vinergy_Project_Plan.xlsx) and [detailed plan](../Vinergy_Detail_Plan.xlsx) own scheduling and Story Points; this package does not alter them or introduce work-hour assumptions.

## Scope decisions

- Charging is discovery only. Only an eligible swapping station can reserve **exactly one battery**.
- `FAM_A`/`FAM_B` and all stations are fictional fixture categories, not real battery specifications or operator/manufacturer affiliations. Coordinates are approximate illustrations, not verified physical sites.
- A compatible zero-stock station remains discoverable but cannot be booked. Booking's nearest candidate must be open, compatible, swapping-capable and currently stocked.
- Drafts hold no stock. Confirmation, atomic checks, idempotency, ownership and release-once cancellation/expiry are shared by form and chat.
- An active-order-per-user cap, hold durations, provider configuration and numeric latency thresholds remain explicit review decisions, not invented commitments.

Sprint 1 (2–15 Nov) delivers discovery and an LLM tool spike; Sprint 2 (16–29 Nov) the form reservation lifecycle; Sprint 3 (30 Nov–13 Dec) full bounded chat and the frozen release. **17 Dec 2026 is one presentation session**, with no new development week.

The requirements are written in English; Vietnamese sample utterances represent the intended demo conversations.
