# KOC Context Glossary

## conversationSummary

`conversationSummary` is the rolling summary of earlier messages within one conversation scope after those messages fall outside the recent raw-message context window. It is scene-scoped conversation memory, not user long-term memory, not a saved persona, not a trend analysis result, not draft content, and not the full source conversation used for explicit progress summarization.

## conversationScope

`conversationScope` is the memory boundary for one continuous business conversation. Continuing from a saved trend record stays in the same scope and shares the same raw-message budget.

## currentArtifact

`currentArtifact` is the latest structured note or structured business output within the current conversation scope. Examples include a persona draft in persona work, a complete trend analysis in trend tracking, or a content draft/revision in content writing. It belongs to the current conversation scope and must not be confused with artifacts from other history records.

## Rolling Memory

Rolling Memory is the scene-scoped short-term memory layer that combines a `conversationSummary` with the latest raw messages. It is the first-stage conversation memory and is separate from future user long-term memory or MCP-backed memory.

## recentMessages

`recentMessages` are the latest raw messages in a conversation scope that stay outside `conversationSummary` so the Agent can read the immediate dialogue verbatim. They take precedence over `conversationSummary` when the two conflict.

## summarySourceConversation

`summarySourceConversation` is the full source dialogue currently used by trend tracking for explicit progress summarization. It is a legacy full-source input and should not be confused with `conversationSummary`.

## memoryMeta

`memoryMeta` is metadata that records how a conversation scope's Rolling Memory was maintained, such as scope identity, summary version, raw-message limit, recent-message limit, and update status.

## summaryStatus

`summaryStatus` is the health state of a conversation scope's `conversationSummary`. A stale or rebuild-needed status means business output may continue, but the Rolling Memory should be refreshed before older raw messages are discarded.
