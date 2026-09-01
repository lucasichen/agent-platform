---
name: pocock-to-spec
description: "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed."
---
<!-- Vendored from skills/engineering/to-spec/SKILL.md @ 6654f6b60cd9d5be8b54c6fafe44346dabeb3b76; adaptations logged in ../../VENDOR.md. MIT (c) 2026 Matt Pocock. -->

Note: upstream marks this skill `disable-model-invocation: true` — it is meant to be invoked explicitly (by name, or by a session that already decided the situation calls for it), not auto-triggered by the model from its description alone.

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations.

3. Write the spec using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label - no need for additional triage.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>

## Platform integration

On this platform, "publish it to the project issue tracker" means producing the F.2 spec shape (`roles/F2-specifier.md`), not a tracker issue. Adapt step 3's template to that contract without dropping any of its sections: fold **Problem Statement** and **Solution** into the observable journey, keep **User Stories** as the testable requirement statements, keep **Implementation Decisions** as references to upstream ADRs/architecture (by id — do not restate them, per spec §3.2's DRY rule) rather than as prose invention, and turn **Testing Decisions** into this spec's verification section. The one rule that is not optional: **every requirement must map to at least one verification line** concrete enough for F.7 to execute in principle without asking the author anything (spec §6.1) — a user story with no matching verification line is an incomplete spec, not a stylistic gap. Write the result to the mission's spec artifact rather than an issue tracker entry, and if a high-risk question surfaces that step 1's exploration cannot resolve, stop and return it to F.1/F.1A/F.3 (per `roles/F2-specifier.md` step 5) instead of synthesizing over the gap.
