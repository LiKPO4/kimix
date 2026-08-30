# Standard

* [Open Knowledge Format v0.1](okf-v0.1.md) - Pinned upstream specification facts, implementation caveats, and source links.
* [Kimi Code Subagent Model Pool](kimi-code-subagent-model-pool.md) - Official [secondary_model] pool config, validation, and Kimix integration caveats through 0.39.0.
* [Kimi Code Web Message Folding](kimi-code-web-message-folding.md) - Official turnFolding/activityRunFolding settings, fold-split algorithm, and the Kimix autoCollapseTurnProcess counterpart.
* [Kimi Code Web File Changes Card](kimi-code-web-file-changes.md) - No wire-level file-change event exists; official TurnFilesSummary derives from edit/multi_edit/write tool args client-side, and Kimix prefers the structured display.diff block.
* [Kimi Code Web Compaction Display](kimi-code-web-compaction-display.md) - Compaction summary is a synthetic user-role message marked metadata.origin.kind=compaction_summary; official renders a compact-divider with a side-panel summary, Kimix maps it onto the compaction card.
