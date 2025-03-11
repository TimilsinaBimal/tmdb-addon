const express = require("express");
const path = require("path");
const addon = express();
const { getCatalog } = require("./lib/getCatalog");
const { getSearch } = require("./lib/getSearch");
const { getManifest, DEFAULT_LANGUAGE } = require("./lib/getManifest");
const { getMeta } = require("./lib/getMeta");
const { getTmdb } = require("./lib/getTmdb");
const { cacheWrapCatalog, cacheWrapMeta } = require("./lib/getCache");
const { getTrending } = require("./lib/getTrending");
const { parseConfig, getRpdbPoster, checkIfExists } = require("./utils/parseProps");
const { getRequestToken, getSessionId } = require("./lib/getSession");
const { getFavorites, getWatchList } = require("./lib/getPersonalLists");
const analyticsMiddleware = require("./middleware/analytics.middleware");
const stats = require("./utils/stats");

// Apply middleware
addon.use(analyticsMiddleware());
addon.use(express.static(path.join(__dirname, "../dist")));
addon.use("/streaming", express.static(path.join(__dirname, "../public/streaming")));
addon.use("/configure", express.static(path.join(__dirname, "../dist")));

const getCacheHeaders = (opts = {}) => {
  if (!Object.keys(opts).length) return false;
  const headers = {
    cacheMaxAge: "max-age",
    staleRevalidate: "stale-while-revalidate",
    staleError: "stale-if-error",
  };
  return Object.entries(headers)
    .map(([key, val]) => opts[key] ? `${val}=${opts[key]}` : false)
    .filter(Boolean)
    .join(", ");
};

const respond = (res, data, opts = {}) => {
  const cacheHeader = getCacheHeaders(opts);
  if (cacheHeader) res.setHeader("Cache-Control", `${cacheHeader}, public`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");
  res.send(data);
};

addon.get("/", (_, res) => res.redirect("/configure"));

addon.get("/request_token", async (req, res) => {
  respond(res, await getRequestToken());
});

addon.get("/session_id", async (req, res) => {
  respond(res, await getSessionId(req.query.request_token));
});

addon.get("/api/stats", (req, res) => respond(res, stats.getStats()));

addon.use("/configure", (req, res, next) => {
  const config = parseConfig(req.params.catalogChoices);
  require("./utils/analytics").trackConfigUpdate({
    language: config.language || DEFAULT_LANGUAGE,
    catalogs: config.catalogs || [],
    integrations: {
      rpdb: !!config.rpdbkey,
      tmdb: !!config.sessionId,
    },
  });
  next();
});

addon.get("/:catalogChoices?/configure", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

addon.get("/:catalogChoices?/manifest.json", async (req, res) => {
  const config = parseConfig(req.params.catalogChoices);
  const manifest = await getManifest(config);
  stats.trackInstallation(req.ip);

  const cacheOpts = {
    cacheMaxAge: 12 * 60 * 60,
    staleRevalidate: 14 * 24 * 60 * 60,
    staleError: 30 * 24 * 60 * 60,
  };
  respond(res, manifest, cacheOpts);
});

addon.get("/:catalogChoices?/catalog/:type/:id/:extra?.json", async (req, res) => {
  const { catalogChoices, type, id, extra } = req.params;
  const config = parseConfig(catalogChoices);
  const language = config.language || DEFAULT_LANGUAGE;
  const rpdbkey = config.rpdbkey;
  const sessionId = config.sessionId;

  const { genre, skip, search } = extra
    ? Object.fromEntries(new URLSearchParams(req.url.split("/").pop().split("?")[0].slice(0, -5)).entries())
    : {};

  const page = Math.ceil(skip ? skip / 20 + 1 : undefined) || 1;
  let metas = [];

  try {
    if (search) {
      metas = await getSearch(type, language, search, config);
    } else {
      switch (id) {
        case "tmdb.trending":
          metas = await getTrending(type, language, page, genre);
          break;
        case "tmdb.favorites":
          metas = await getFavorites(type, language, page, genre, sessionId);
          break;
        case "tmdb.watchlist":
          metas = await getWatchList(type, language, page, genre, sessionId);
          break;
        default:
          metas = await cacheWrapCatalog(`${language}:${type}:${id}:${genre}:${page}`, () => getCatalog(type, language, page, id, genre, config));
      }
    }

    if (rpdbkey && metas?.metas?.length) {
      metas.metas = await Promise.all(metas.metas.map(async el => {
        const img = getRpdbPoster(type, el.id.replace("tmdb:", ""), language, rpdbkey);
        el.poster = await checkIfExists(img) ? img : el.poster;
        return el;
      }));
    }

    respond(res, metas, {
      cacheMaxAge: 12 * 60 * 60, // 12 hours
      staleRevalidate: 7 * 24 * 60 * 60,
      staleError: 14 * 24 * 60 * 60,
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

const fetchMeta = async (req, type, language, id, rpdbkey) => {
  const userAgent = req.headers["user-agent"] || "";
  const tmdbId = id.split(":").pop();
  const imdbId = id.split(":")[0];
  const spacing = userAgent.toLowerCase().includes("stremio-apple") ? "\u0020\u0020⦁\u0020\u0020" : "\u2003\u2003";

  if (id.includes("tmdb:")) {
    const resp = await cacheWrapMeta(`${language}:${type}:${tmdbId}`, () => getMeta(type, language, tmdbId, rpdbkey, userAgent));
    const { imdbRating, ageRating } = resp.meta;
    // Modify only if userAgent is not empty or null
    if (userAgent) {
    resp.meta.imdbRating = ageRating ? `${ageRating}${spacing}${imdbRating || ""}` : imdbRating;
      // Also change in links
      if (resp.meta.links) {
        resp.meta.links = resp.meta.links.map((link) => {
          if (link.category === "imdb") {
            link.name = ageRating ? `${ageRating}${spacing}${imdbRating || ""}` : imdbRating;
          }
          return link;
        });
      }
    }
    return resp;
  } else if (id.includes("tt")) {
    const tmdbId = await getTmdb(type, imdbId);
    if (tmdbId) {
      const resp = await cacheWrapMeta(`${language}:${type}:${tmdbId}`, () => getMeta(type, language, tmdbId, rpdbkey));
      // Modify only if userAgent is not empty or null
      if (userAgent) {
        resp.meta.imdbRating = ageRating ? `${ageRating}${spacing}${imdbRating || ""}` : imdbRating;
          // Also change in links
          if (resp.meta.links) {
            resp.meta.links = resp.meta.links.map((link) => {
              if (link.category === "imdb") {
                link.name = ageRating ? `${ageRating}${spacing}${imdbRating || ""}` : imdbRating;
              }
              return link;
            });
          }
        }
      return resp;
    }
    return { meta: null };
  }
};

addon.get("/:catalogChoices?/meta/:type/:id.json", async (req, res) => {
  const { catalogChoices, type, id } = req.params;
  const config = parseConfig(catalogChoices);
  const language = config.language || DEFAULT_LANGUAGE;
  const rpdbkey = config.rpdbkey;
  const meta = await fetchMeta(req, type, language, id, rpdbkey);
  respond(res, meta, {
    cacheMaxAge: 12 * 60 * 60, // 12 hours
    staleRevalidate: 1 * 24 * 60 * 60,  // 1 day
    staleError: 14 * 24 * 60 * 60,
  });
});

addon.get("/:catalogChoices?/catalog/series/calendar-videos/:calendarVideosids.json", async (req, res) => {
  const { catalogChoices, calendarVideosids } = req.params;
  const config = parseConfig(catalogChoices);
  const language = config.language || DEFAULT_LANGUAGE;
  const rpdbkey = config.rpdbkey;
  const ids = calendarVideosids.split(",");

  try {
    const metasDetailed = await Promise.all(ids.map(id => fetchMeta(req, "series", language, id, rpdbkey).then(r => r.meta)));
    respond(res, { metasDetailed });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

module.exports = addon;
