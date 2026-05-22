/* NammaBengaluruTimes — vanilla JS client-side news aggregator. */
(function () {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────────────

  const FEEDS = [
    { sourceName: "Times of India",
      url:  "https://timesofindia.indiatimes.com/rssfeeds/-2128833038.cms" },
    { sourceName: "Hindustan Times",
      url:  "https://www.hindustantimes.com/feeds/rss/cities/bengaluru-news/rssfeed.xml" },
    { sourceName: "The Hindu",
      url:  "https://www.thehindu.com/news/cities/bangalore/feeder/default.rss" },
  ];

  // Proxies that return raw XML (no JSON wrapping). Tried in order; first
  // one that returns a parseable RSS document wins. corsproxy.io is the
  // most reliable for TOI's slightly quirky .cms endpoint.
  const PROXIES = [
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  const FALLBACK_IMAGE =
    "https://images.unsplash.com/photo-1495020689067-958852a7765e?q=80&w=1600&auto=format&fit=crop";

  const THEMES = ["noir", "sunset", "forest", "ocean", "candy"];
  const THEME_KEY = "nbt-theme";

  // ── Pure helpers ───────────────────────────────────────────────────────

  function safeUrl(url) {
    if (typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("//")) return "https:" + trimmed;
    try {
      const u = new URL(trimmed);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch (_) {}
    return "";
  }

  const cleanText = (t) =>
    t == null ? "" : String(t).replace(/\s+/g, " ").trim();

  const stripHtml = (h) =>
    typeof h === "string" ? cleanText(h.replace(/<[^>]*>/g, "")) : "";

  const truncate = (s, max) => {
    const t = cleanText(s);
    return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
  };

  function formatDate(s) {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }
  function formatDateShort(s) {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }

  const STOP_WORDS = new Set([
    "bengaluru","bangalore","india","times","hindu","hindustan","city","news",
    "today","after","over","with","from","this","that","have","will","into",
    "their","they","there","about","been","more","than","some","what","when",
    "where","while","your","said","says","amid","near","year","years","also",
  ]);

  function trendingKeywords(articles, limit = 8) {
    const text = articles.map(a => `${a.title || ""} ${a.description || ""}`).join(" ");
    const words = (text.match(/\b[A-Za-z]{4,}\b/g) || []).map(w => w.toLowerCase());
    const freq = Object.create(null);
    for (const w of words) {
      if (STOP_WORDS.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    return Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, limit);
  }

  function dedupe(articles) {
    const seen = new Set();
    const out = [];
    for (const a of articles) {
      const key = (a.link || a.id || a.title || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  }

  // ── DOM helpers (safe; no innerHTML interpolation of feed data) ────────

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "dataset") for (const dk in v) n.dataset[dk] = v[dk];
      else if (k === "onclick") n.addEventListener("click", v);
      else if (k === "href" || k === "src") {
        const u = safeUrl(v);
        if (u) n.setAttribute(k, u);
      } else n.setAttribute(k, v);
    }
    if (children) for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }
  const clear = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); };

  function imgFallback(src, alt) {
    const img = el("img", {
      src: safeUrl(src) || FALLBACK_IMAGE,
      alt: alt || "News image",
      loading: "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer",
    });
    img.addEventListener("error", () => {
      if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE;
    }, { once: true });
    return img;
  }

  const chip = (text, variant = "nbt-chip--soft") =>
    el("span", { class: "nbt-chip " + variant }, [text]);

  // ── RSS fetching ───────────────────────────────────────────────────────

  async function fetchViaProxies(url) {
    for (const buildProxy of PROXIES) {
      const proxied = buildProxy(url);
      try {
        const res = await fetch(proxied, { cache: "no-store" });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || text.length < 80) continue;
        const doc = new DOMParser().parseFromString(text, "text/xml");
        if (doc.getElementsByTagName("parsererror").length) continue;
        if (!doc.querySelector("item")) continue;
        return doc;
      } catch (err) {
        console.warn("[NBT] proxy failed:", proxied, err);
      }
    }
    return null;
  }

  function getText(node, sel) {
    if (!node) return "";
    const e = node.querySelector(sel);
    return e ? cleanText(e.textContent) : "";
  }
  function getTagText(node, tag) {
    if (!node || !node.getElementsByTagName) return "";
    const e = node.getElementsByTagName(tag)[0];
    return e ? cleanText(e.textContent) : "";
  }

  function extractImage(item) {
    try {
      const mc = item.querySelector("media\\:content, content[url]");
      if (mc) { const u = safeUrl(mc.getAttribute("url")); if (u) return u; }
    } catch (_) {}
    try {
      const th = item.querySelector("media\\:thumbnail, thumbnail[url]");
      if (th) { const u = safeUrl(th.getAttribute("url")); if (u) return u; }
    } catch (_) {}
    const enc = item.querySelector("enclosure");
    if (enc && (enc.getAttribute("type") || "").startsWith("image/")) {
      const u = safeUrl(enc.getAttribute("url")); if (u) return u;
    }
    const desc = getText(item, "description") || getTagText(item, "content:encoded");
    const m = desc && desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) { const u = safeUrl(m[1]); if (u) return u; }
    return "";
  }

  function extractEnclosure(item) {
    const enc = item.querySelector("enclosure");
    if (!enc) return null;
    const url = safeUrl(enc.getAttribute("url"));
    const type = (enc.getAttribute("type") || "").trim();
    return url ? { url, type } : null;
  }

  function parseRSS(xmlDoc, sourceName) {
    if (!xmlDoc) return [];
    const channel = xmlDoc.querySelector("channel");
    const feedTitle = channel ? getText(channel, "title") : sourceName;
    const feedLink = safeUrl(channel ? getText(channel, "link") : "");
    const out = [];
    xmlDoc.querySelectorAll("item").forEach((item) => {
      const title = cleanText(getText(item, "title"));
      if (!title) return;
      const link = safeUrl(getText(item, "link")) || feedLink;
      const description = truncate(stripHtml(getText(item, "description")), 320);
      const pubDate = getText(item, "pubDate") || getTagText(item, "dc:date");
      const guid = getText(item, "guid");
      const author = cleanText(
        getTagText(item, "dc:creator") || getText(item, "author") || feedTitle
      );
      const categories = [
        ...new Set(
          Array.from(item.getElementsByTagName("category"))
            .map(c => cleanText(c.textContent))
            .filter(Boolean)
        ),
      ].slice(0, 4);

      out.push({
        id: guid || link || title,
        title, link, sourceName, feedLink,
        description, pubDate, author, categories,
        image: extractImage(item),
        enclosure: extractEnclosure(item),
        contentHTML: getTagText(item, "content:encoded") || getText(item, "description"),
      });
    });
    return out;
  }

  // ── Sanitize article HTML for the drawer (strict allowlist) ────────────

  const ALLOWED_TAGS = new Set([
    "P","BR","STRONG","EM","B","I","U","A","UL","OL","LI",
    "BLOCKQUOTE","H2","H3","H4","H5","FIGURE","FIGCAPTION","IMG","SPAN","DIV",
  ]);
  const ALLOWED_ATTRS = { A: ["href","title"], IMG: ["src","alt","title"] };

  function sanitize(html) {
    const frag = document.createDocumentFragment();
    if (typeof html !== "string" || !html.trim()) return frag;
    const inert = new DOMParser().parseFromString(
      `<!doctype html><body>${html}`, "text/html"
    );
    (function walk(node, target) {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 3) { target.appendChild(document.createTextNode(c.nodeValue)); continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME") continue;
        if (!ALLOWED_TAGS.has(tag)) {
          const tmp = document.createElement("span");
          walk(c, tmp);
          while (tmp.firstChild) target.appendChild(tmp.firstChild);
          continue;
        }
        const safe = document.createElement(tag.toLowerCase());
        for (const a of (ALLOWED_ATTRS[tag] || [])) {
          if (!c.hasAttribute(a)) continue;
          const v = c.getAttribute(a);
          if (a === "href" || a === "src") {
            const u = safeUrl(v);
            if (u) safe.setAttribute(a, u);
          } else safe.setAttribute(a, v);
        }
        if (tag === "A") { safe.setAttribute("target","_blank"); safe.setAttribute("rel","noopener noreferrer"); }
        if (tag === "IMG") { safe.setAttribute("loading","lazy"); safe.setAttribute("referrerpolicy","no-referrer"); }
        walk(c, safe);
        target.appendChild(safe);
      }
    })(inert.body, frag);
    return frag;
  }

  // ── State + DOM refs ───────────────────────────────────────────────────

  const state = {
    all: [], filtered: [], hero: [], grid: [],
    buckets: new Map(),
    swiper: null,
  };

  const $ = (id) => document.getElementById(id);
  const dateEl = $("nbt-date");
  const yearEl = $("nbt-year");
  const countEl = $("nbt-articles-count");
  const keywordsEl = $("nbt-trending-keywords");
  const heroSlidesEl = $("hero-slides");
  const heroItemBgEl = $("hero-item-bg");
  const stripsEl = $("nbt-category-strips");
  const gridEl = $("nbt-grid");
  const statusEl = $("nbt-status");
  const drawerEl = $("nbt-article");
  const overlayEl = $("nbt-article-overlay");
  const closeBtn  = $("nbt-article-close");
  const aSourceEl = $("nbt-article-source");
  const aCatEl    = $("nbt-article-category");
  const aHeroEl   = $("nbt-article-hero");
  const aTitleEl  = $("nbt-article-title");
  const aAuthorEl = $("nbt-article-author");
  const aDateEl   = $("nbt-article-date");
  const aContentEl= $("nbt-article-content");
  const aEncEl    = $("nbt-article-enclosure");
  const aLinkEl   = $("nbt-article-link");

  function setStatus(msg, kind) {
    if (!statusEl) return;
    if (!msg) { statusEl.hidden = true; statusEl.textContent = ""; return; }
    statusEl.hidden = false;
    statusEl.dataset.kind = kind || "";
    statusEl.textContent = msg;
  }

  // ── Theme ──────────────────────────────────────────────────────────────

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = "noir";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    document.querySelectorAll(".nbt-theme-dot").forEach(btn => {
      btn.setAttribute("aria-pressed", btn.dataset.themeValue === theme ? "true" : "false");
    });
  }

  function initTheme() {
    let saved = "noir";
    try { saved = localStorage.getItem(THEME_KEY) || "noir"; } catch (_) {}
    applyTheme(saved);
    document.querySelectorAll(".nbt-theme-dot").forEach(btn => {
      btn.addEventListener("click", () => applyTheme(btn.dataset.themeValue));
    });
  }

  // ── Hero ───────────────────────────────────────────────────────────────

  function renderHero(articles) {
    clear(heroSlidesEl);
    state.hero = articles
      .filter(a => a.image)
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
      .slice(0, 8);

    state.hero.forEach((article) => {
      const slide = el("div", {
        class: "news-slider__item swiper-slide",
        dataset: { articleId: article.id },
        onclick: () => openArticle(article),
      }, [
        el("a", {
          href: "javascript:void(0)", class: "news__item",
          role: "button", "aria-label": article.title,
        }, [
          el("div", { class: "news-date" }, [
            el("span", { class: "news-date__title", text: formatDateShort(article.pubDate) || "—" }),
            el("span", { class: "news-date__txt", text: article.sourceName }),
          ]),
          el("div", { class: "news__title", text: article.title }),
          el("div", { class: "news__meta" }, [
            el("span", {}, ["By ", article.author]),
            el("span", {}, [formatDateShort(article.pubDate) || ""]),
          ]),
          el("div", { class: "news__txt", text: article.description }),
          el("div", { class: "news__chips" },
            (article.categories.length ? article.categories : ["Bengaluru"]).map(c => chip(c))
          ),
          el("div", { class: "news__img" }, [imgFallback(article.image, article.title)]),
        ]),
      ]);
      heroSlidesEl.appendChild(slide);
    });

    initSwiper();
  }

  function initSwiper() {
    if (state.swiper) { state.swiper.destroy(true, true); state.swiper = null; }
    if (typeof Swiper === "undefined" || state.hero.length === 0) return;
    state.swiper = new Swiper("#hero-swiper", {
      effect: "coverflow", grabCursor: true, centeredSlides: true,
      slidesPerView: "auto", spaceBetween: 16,
      loop: state.hero.length > 2, speed: 450,
      coverflowEffect: { rotate: 0, stretch: 0, depth: 180, modifier: 2.6, slideShadows: false },
      navigation: { nextEl: ".news-slider-next", prevEl: ".news-slider-prev" },
      pagination: { el: ".news-slider__pagination", clickable: true },
      on: { init: syncBg, slideChangeTransitionEnd: syncBg, resize: syncBg },
    });
  }

  function syncBg() {
    const active = document.querySelector("#hero-swiper .swiper-slide-active .news__item");
    if (!active || !heroItemBgEl) return;
    const r = active.getBoundingClientRect();
    const cr = heroSlidesEl.getBoundingClientRect();
    heroItemBgEl.style.opacity = "0.6";
    heroItemBgEl.style.transform = `translate3d(${r.left - cr.left}px, ${r.top - cr.top}px, 0)`;
    heroItemBgEl.style.width = `${r.width}px`;
    heroItemBgEl.style.height = `${r.height}px`;
  }

  // ── Category strips ────────────────────────────────────────────────────

  function buildBuckets(articles) {
    state.buckets.clear();
    articles.forEach(a => {
      const cats = a.categories.length ? a.categories : ["General"];
      cats.forEach(c => {
        if (!state.buckets.has(c)) state.buckets.set(c, []);
        state.buckets.get(c).push(a);
      });
    });
  }

  function renderStrips() {
    clear(stripsEl);
    const entries = Array.from(state.buckets.entries())
      .filter(([, arr]) => arr.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8);

    entries.forEach(([cat, articles]) => {
      const lane = el("div", { class: "nbt-strip__lane" });
      articles
        .slice()
        .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
        .slice(0, 12)
        .forEach((article) => {
          lane.appendChild(el("div", {
            class: "nbt-strip-card",
            dataset: { articleId: article.id },
            onclick: () => openArticle(article),
          }, [
            el("div", { class: "nbt-strip-card__title", text: article.title }),
            el("div", { class: "nbt-strip-card__meta" }, [
              el("span", { class: "nbt-strip-card__source", text: article.sourceName }),
              el("span", { class: "nbt-strip-card__date", text: formatDateShort(article.pubDate) }),
            ]),
            el("div", { class: "nbt-strip-card__desc", text: article.description }),
          ]));
        });

      stripsEl.appendChild(el("div", { class: "nbt-strip" }, [
        el("div", { class: "nbt-strip__header" }, [
          el("div", { class: "nbt-strip__header-left" }, [
            chip("#" + cat),
            el("span", { text: `${articles.length} stories` }),
          ]),
          el("div", { class: "nbt-strip__scroll", text: "Swipe →" }),
        ]),
        lane,
      ]));
    });
  }

  // ── Grid ───────────────────────────────────────────────────────────────

  function renderGrid(articles) {
    clear(gridEl);
    state.grid = articles;
    if (articles.length === 0) {
      gridEl.appendChild(el("div", {
        class: "nbt-empty",
        text: "No stories match the selected sources.",
      }));
      return;
    }
    articles.forEach((article) => {
      gridEl.appendChild(el("article", {
        class: "nbt-grid-card",
        dataset: { articleId: article.id },
        onclick: () => openArticle(article),
      }, [
        el("div", { class: "nbt-grid-card__image" }, [imgFallback(article.image, article.title)]),
        el("div", { class: "nbt-grid-card__body" }, [
          el("div", { class: "nbt-grid-card__title", text: article.title }),
          el("div", { class: "nbt-grid-card__meta" }, [
            el("span", { text: article.sourceName }),
            el("span", { text: formatDateShort(article.pubDate) }),
          ]),
          el("div", { class: "nbt-grid-card__desc", text: article.description }),
        ]),
      ]));
    });
  }

  // ── Drawer ─────────────────────────────────────────────────────────────

  function openArticle(article) {
    if (!article) return;
    aSourceEl.textContent = article.sourceName || "";
    aCatEl.textContent = article.categories[0] || "Bengaluru Story";

    clear(aHeroEl);
    if (article.image) aHeroEl.appendChild(imgFallback(article.image, article.title));

    aTitleEl.textContent = article.title || "";
    aAuthorEl.textContent = article.author ? `By ${article.author}` : "";
    aDateEl.textContent = article.pubDate ? formatDate(article.pubDate) : "";

    clear(aContentEl);
    const frag = sanitize(article.contentHTML);
    if (frag.hasChildNodes()) aContentEl.appendChild(frag);
    else aContentEl.textContent = article.description || "";

    clear(aEncEl);
    if (article.enclosure) {
      const { url, type } = article.enclosure;
      aEncEl.appendChild(el("p", {}, ["Attached media: ", el("code", { text: type })]));
      if (type.startsWith("audio/")) {
        aEncEl.appendChild(el("audio", { controls: "", src: url, style: "width:100%;margin-top:0.4rem;" }));
      } else if (type.startsWith("video/")) {
        aEncEl.appendChild(el("video", { controls: "", src: url, style: "width:100%;margin-top:0.4rem;" }));
      } else {
        aEncEl.appendChild(el("p", {}, [el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "Open attachment" })]));
      }
    }

    const linkHref = safeUrl(article.link) || safeUrl(article.feedLink);
    aLinkEl.href = linkHref || "#";
    aLinkEl.setAttribute("target", "_blank");
    aLinkEl.setAttribute("rel", "noopener noreferrer");

    drawerEl.classList.add("nbt-article--open");
    drawerEl.setAttribute("aria-hidden", "false");
  }

  function closeArticle() {
    drawerEl.classList.remove("nbt-article--open");
    drawerEl.setAttribute("aria-hidden", "true");
  }

  // ── Filters ────────────────────────────────────────────────────────────

  function applyFilter() {
    const checked = Array.from(document.querySelectorAll(".nbt-source input:checked"))
      .map(i => i.value);
    state.filtered = state.all.filter(a => checked.includes(a.sourceName));

    countEl.textContent = `${state.filtered.length} stories`;

    const kw = trendingKeywords(state.filtered);
    clear(keywordsEl);
    keywordsEl.appendChild(document.createTextNode("Trending: "));
    keywordsEl.appendChild(el("span", { text: kw.length ? kw.join(", ") : "—" }));

    renderHero(state.filtered);
    buildBuckets(state.filtered);
    renderStrips();
    renderGrid(state.filtered);
  }

  // ── Load ───────────────────────────────────────────────────────────────

  async function loadAll() {
    setStatus("Loading Bengaluru news…", "loading");

    const results = await Promise.allSettled(
      FEEDS.map(async (feed) => {
        const doc = await fetchViaProxies(feed.url);
        if (!doc) throw new Error("all proxies failed");
        const parsed = parseRSS(doc, feed.sourceName);
        if (!parsed.length) throw new Error("no items parsed");
        return parsed;
      })
    );

    const all = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") all.push(...r.value);
      else failed.push(FEEDS[i].sourceName);
    });

    state.all = dedupe(all).sort(
      (a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0)
    );

    if (state.all.length === 0) {
      setStatus(
        "Could not load news right now. Public RSS proxies may be rate-limited — please refresh in a minute.",
        "error"
      );
    } else if (failed.length) {
      setStatus(
        `Showing ${state.all.length} stories. Some sources unavailable: ${failed.join(", ")}. Try refreshing.`,
        "warn"
      );
    } else {
      setStatus("", "");
    }

    applyFilter();
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init() {
    initTheme();

    const now = new Date();
    dateEl.textContent = now.toLocaleString("en-IN", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
    });
    yearEl.textContent = now.getFullYear();

    document.querySelectorAll(".nbt-source input").forEach(i =>
      i.addEventListener("change", applyFilter)
    );

    overlayEl.addEventListener("click", closeArticle);
    closeBtn.addEventListener("click", closeArticle);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeArticle();
    });

    loadAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();