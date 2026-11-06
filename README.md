# RZVN — Portfolio

Web & UI/UX designer portfolio (Chișinău, Moldova). Strict monochrome, Chakra Petch,
zero runtime libraries. **RO / EN / RU** (client-side i18n).

## Live site

https://rzvn332.github.io/portfolio/

## Structure

```
index.html            single page (semantic HTML + inline SVG sprite + JSON-LD)
css/style.css         hand-written stylesheet (tokens, components, motion)
css/fonts.css         @font-face — self-hosted subsets (Chakra Petch latin/latin-ext, Play cyrillic)
js/app.js             app logic: i18n, menu, filters, project modal, image viewer
js/starfield.js       ~2.5 KB canvas particle field (tsparticles replacement)
data/projects.js      project data (window.PROJECTS) — edit to add/remove work
data/translations.js  interface translations (window.I18N)
img/projects/         optimized WebP: name.webp = thumb, name-f.webp = full size
img/fonts/            font subsets (woff2)
```

## Local development

```bash
python3 -m http.server 8080     # then open http://localhost:8080
```

(No build step, no dependencies — serve the folder and it works.)

## Adding a project

1. Drop two processed WebP assets into `img/projects/`: `p9-1.webp` (900px wide thumb)
   and `p9-1-f.webp` (up to 1440px full size).
2. Append an entry to `data/projects.js` (see existing records for the shape).
3. Add display strings for `ro` / `ru` if different from English.
4. That's it — the filter tallies (`[n]`) and their localized aria labels are
   recomputed from the data automatically.

## Performance notes (what was optimized)

- Removed Tailwind CDN runtime, Font Awesome webfonts, tsparticles (~650 KB JS) —
  replaced with hand-written CSS, an inline SVG sprite and a tiny canvas field.
- Self-hosted font subsets (~80 KB total, loaded only for the scripts actually used;
  Cyrillic renders in Play via `unicode-range` merging under the same family).
- Images are local WebP derivatives (628 KB thumbs + 1.3 MB fulls for the whole
  library) instead of hot-linked Behance originals (7.1 MB) that were force-preloaded.
- Language switching updates text nodes in place — no flash, no lost state.
- Entrance animations are gated behind `html.js`; the page renders fully without JS.
- Modal / viewer are real dialogs: keyboard, focus trap, Escape, focus restore.
