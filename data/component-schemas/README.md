# Bundled component schemas

This tree mirrors `ai-site-components/src/components/**/\*.schema.json` so production (e.g. Vercel) can load the manifest without a sibling repo or `@ai-site/components` install.

When you add or change schemas in the component library, copy only the `*.schema.json` files here (same folder layout).

```bash
# From ai-site-components repo root:
find src/components -name '*.schema.json' -print0 | while IFS= read -r -d '' f; do
  dest="../ai-site-admin/data/component-schemas/$f"
  mkdir -p "$(dirname "$dest")"
  cp "$f" "$dest"
done
```

Override with `COMPONENT_LIBRARY_ROOT` if you point at a full library checkout instead.
