# Logo review assets

These are SVG design candidates, not active product assets. The approved design scope and review history are in the [Notion task](https://app.notion.com/p/3f4038a63d5a81ba916ee7c877e78826).

`build_sources.py` generates A and B marks, transparent wordmarks for dark/light backgrounds, transparent 1024px app-icon candidates, and `logo-review.svg`. Orange `#FF8A24` matches the UI preview candidate; it is not a confirmed final brand color. Wordmarks use live text with Helvetica Neue/Arial fallbacks; fonts have not been outlined for final distribution.

Regenerate SVGs with `python3 design/logo/build_sources.py`. Render the PNG review sheet and app icons with `node design/logo/render_png.cjs`, with `sharp` available on `NODE_PATH`. No changes to application configuration or the installed app are made by these scripts.
