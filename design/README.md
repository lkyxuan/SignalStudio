# Workbench design preview

Accepted palette requirements (2026-10-09): use Cyberight Capital as the reference, with black/white/gray surfaces and orange as the primary brand accent for key actions and selection. [Decision and approved preview scope](https://app.notion.com/p/3f4038a63d5a810c98bdee5d18e574cb).

`cyberight-workbench.html` is an interactive, standalone HTML fragment for reviewing the first dark workbench design. It does not load or modify application state, and is not imported by the application. It demonstrates graph selection, case switching, search, and horizontal table views. It includes a partial unmatched identity flow, not the complete saved graph.

Reference colors verified on the reference site's rendered page: background `#131419`, main text `#FFFFFF`, secondary text `#C5C5C5`. Preview orange `#FF8A24` is a design candidate, not a verified extraction of the brand's orange. Other surface and border values are preview choices. The optional host color control changes the primary accent; some supporting borders retain their initial orange in this prototype.

Content comes from the current graph's identity cards and `catalog/identity-flow-case.v1.json`. Saved Kaito input is observed; the lookup assumptions and target table rows are specified behavior, not executed backend results. The preview retains source/processing input and output columns, plain-language explanations, and horizontal raw tables. Source fields shown are a subset.

To render in Codex, display this fragment through the visualize skill. For a local browser review, use that skill's bundled renderer:

```sh
python3 "$VISUALIZE_SKILL_DIR/scripts/render.py" "/absolute/path/to/design/cyberight-workbench.html" --serve
```

Set `VISUALIZE_SKILL_DIR` to the installed visualize skill directory. The renderer snapshots the fragment when starting; restart it after edits.

Verified on 2026-10-09 in the Codex in-app browser: node selection, two-case selection, processing input/output, assets table opening, graph/table switching, search, and layout measurements at 1024px and 390px browser widths. No browser console errors were reported. No outer horizontal overflow was detected at those widths. Other browser engines, production integration, complete graph scale, and exact brand-orange matching remain unverified.
