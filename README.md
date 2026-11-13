# PDF Studio

**Private PDF tools that run in your browser.** Merge, split, compress, organise, annotate, sign, redact and watermark PDFs without uploading them anywhere. No sign-up, no tracking and no build step.

![PDF Studio](og-image.png)

## Tools

| | Tool | Where it runs |
|---|---|---|
| 01 | Merge PDF | Your device |
| 02 | Split PDF | Your device |
| 03 | Compress PDF | Your device |
| 04 | Images to PDF | Your device |
| 05 | Organize Pages (reorder, rotate, delete) | Your device |
| 06 | Annotate (pen, highlighter, shapes, arrows) | Your device |
| 07 | Add Text | Your device |
| 08 | Add Image | Your device |
| 09 | Watermark (text or image, live preview) | Your device |
| 10 | Page Numbers | Your device |
| 11 | Redact | Your device |
| 12 | Sign PDF | Your device |
| 13 | Protect PDF (AES-256 password) | Conversion server |
| 14 | PDF to Word | Conversion server |
| 15 | PDF to Excel | Conversion server |
| 16 | PDF to PowerPoint | Conversion server |

Files up to 100 MB are supported.

## Privacy

- **Tools 01 to 12** never send your file anywhere. Once the page has loaded, they also work offline thanks to a service worker.
- **Tools 13 to 16** send the file to the companion server ([pdf-studio-server](https://github.com/TonyMcSauce/pdf-studio-server)) over HTTPS. It is processed in memory and deleted once the result is returned. For Protect, the password is sent along with the file.
- No analytics, no ads and no cookies. Only your theme choice is saved, in local storage.

## How output quality is preserved

Pages are copied into the new file as real PDF objects with [pdf-lib](https://pdf-lib.js.org/), so text stays selectable and searchable, and links, fonts and vector graphics come through untouched. Rotation is saved as page metadata, which loses nothing. Anything you add (text, images, signatures, watermarks, page numbers, annotations) is drawn on a transparent layer at 3× resolution and stamped on top.

A page is flattened to an image in only two cases:

- **Redact.** Pages with redactions are flattened so the hidden text is actually removed rather than just covered.
- **Compress.** This tool re-renders pages at the quality you pick.

## Project structure

```
index.html            Layout and markup
style.css             "Proof Room" design system (light and dark themes)
js/core.js            Config, state, helpers, rendering, preview, buildPdf()
js/assemble.js        Merge, split, compress, images to PDF, organize pages
js/annotate.js        Annotate
js/text.js            Add Text and Add Image
js/watermark.js       Watermark
js/pagenumbers.js     Page numbers
js/redact.js          Redact
js/signature.js       Sign
js/server.js          Protect and Office conversions (server-backed)
js/init.js            Main download button, start-up, service worker
sw.js                 Offline cache
manifest.webmanifest  Install as an app (PWA)
favicon.svg, icon-*.png, og-image.png
```

Each tool lives in its own file and shares the globals set up in `core.js`. If one tool ever throws an error while loading, the others keep working.

## Libraries

| Library | Purpose |
|---|---|
| [PDF.js 3.11](https://mozilla.github.io/pdf.js/) | Render pages to canvas |
| [pdf-lib 1.17](https://pdf-lib.js.org/) | Build, copy and edit PDFs |
| [SortableJS 1.15](https://sortablejs.github.io/Sortable/) | Drag-to-reorder |
| [Font Awesome 6 (free)](https://fontawesome.com/) | Icons |
| Instrument Serif, Bricolage Grotesque, IBM Plex Mono | Typefaces (Google Fonts) |

## Deploy on GitHub Pages

1. Go to **Settings → Pages** and set the source to the `main` branch, root folder.
2. The site goes live at `https://<username>.github.io/<repo>/`.

There's no build step: it's plain HTML, CSS and JavaScript. To point the server tools at a different backend, change `CFG.SERVER_URL` in `js/core.js`.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` straight from disk also works, but offline caching needs a real `http://` origin.
