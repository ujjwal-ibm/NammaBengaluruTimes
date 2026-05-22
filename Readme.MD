# NammaBengaluruTimes

A Bengaluru news feed. Single-page, client-side only. Blends live RSS streams
from Times of India, Hindustan Times, and The Hindu, with five
hand-tuned dark themes.

**Live site:** https://uibm.github.io/nammabengalurutimes/

## Features

- Live RSS blend from TOI, HT, and The Hindu (Bengaluru editions).
- Hero slider with cover-flow effect, category lanes, dense grid feed.
- Five themes: **Noir**, **Sunset**, **Forest**, **Ocean**, **Candy** —
  switchable from the header, choice is remembered.
- Source toggles, trending keywords, in-page article drawer.
- Multi-proxy fetch with automatic fallback (corsproxy.io →
  api.allorigins.win/raw → api.codetabs.com) for reliable loading.
- Strict client-side HTML sanitization for untrusted RSS content.
- Dedup across feeds, lazy-loaded images with fallback on error.
- No build step, no npm install — open `index.html` and it works.

## Running locally

Any static server works:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Or just double-click `index.html` (most browsers will run it directly).

## Security notes

RSS content comes from third parties through public CORS proxies and is
treated as untrusted. `script.js` never interpolates feed strings into
`innerHTML`. Titles, descriptions, authors, and categories are inserted
via `textContent`; the article body is parsed in an inert document and
filtered against a strict tag + attribute allowlist; every `href` and
`src` is validated to be `http(s)` before being assigned.

## Credits

Built and maintained by Ujjwal Kumar.

### News sources

Headlines, summaries, images, and links remain the property of the
originating publishers. NammaBengaluruTimes is a personal aggregator
that links back to the original articles — please read on the source
sites and respect their terms of use.

- [Times of India — Bengaluru](https://timesofindia.indiatimes.com/city/bengaluru)
- [Hindustan Times — Bengaluru](https://www.hindustantimes.com/cities/bengaluru-news)
- [The Hindu — Bengaluru](https://www.thehindu.com/news/cities/bangalore/)

### Third-party libraries

- [Swiper](https://swiperjs.com/) — touch slider used for the hero
  carousel. MIT License. © Vladimir Kharlampidi.
- [Font Awesome Free](https://fontawesome.com/) — icon set. Icons CC BY
  4.0, fonts SIL OFL 1.1, code MIT.

### Fonts

- [Inter](https://rsms.me/inter/) by Rasmus Andersson, served via
  [Google Fonts](https://fonts.google.com/specimen/Inter). SIL Open Font
  License 1.1.

### Infrastructure

- [corsproxy.io](https://corsproxy.io/) — primary CORS proxy for RSS.
- [AllOrigins](https://allorigins.win/) — fallback CORS proxy.
- [CodeTabs CORS proxy](https://codetabs.com/cors-proxy/cors-proxy.html)
  — second fallback proxy.
- [GitHub Pages](https://pages.github.com/) — static hosting.
- [Unsplash](https://unsplash.com/) — fallback hero image
  (`photo-1495020689067-958852a7765e`) used when an article has no
  artwork. Free under the Unsplash License.

If you are a rights holder and would like attribution adjusted or
content removed, please open an issue.

## License

Source code: see [LICENSE](LICENSE) (MIT). Third-party assets retain
their original licenses, listed above.