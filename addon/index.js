const express = require("express");
const path = require("path");
const addon = express();
const { getCatalog } = require("./lib/getCatalog");
const { getSearch } = require("./lib/getSearch");
const { getManifest, DEFAULT_LANGUAGE } = require("./lib/getManifest");
const { getMeta } = require("./lib/getMeta");
const { getTmdb } = require("./lib/getTmdb");
const { cacheWrapMeta } = require("./lib/getCache");
const { getTrending } = require("./lib/getTrending");
const { parseConfig, getRpdbPoster, checkIfExists } = require("./utils/parseProps");
const { getRequestToken, getSessionId } = require("./lib/getSession");
const { getFavorites, getWatchList } = require("./lib/getPersonalLists");
const analyticsMiddleware = require("./middleware/analytics.middleware");
const stats = require("./utils/stats");

// Apply middleware
addon.use(analyticsMiddleware());

// Serve static files
addon.use(express.static(path.join(__dirname, "../dist")));
addon.use("/streaming", express.static(path.join(__dirname, "../public/streaming")));
addon.use("/configure", express.static(path.join(__dirname, "../dist")));

// Helper functions
const getCacheHeaders = (opts = {}) => {
  if (!Object.keys(opts).length) return false;
  const cacheHeaders = {
    cacheMaxAge: "max-age",
    staleRevalidate: "stale-while-revalidate",
    staleError: "stale-if-error",
  };
  return Object.keys(cacheHeaders)
    .map((prop) => opts[prop] ? `${cacheHeaders[prop]}=${opts[prop]}` : false)
    .filter(Boolean)
    .join(", ");
};

const respond = (res, data, opts) => {
  const cacheControl = getCacheHeaders(opts);
  if (cacheControl) res.setHeader("Cache-Control", `${cacheControl}, public`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");
  res.send(data);
};

// Redirect root to configure page
addon.get("/", (_, res) => res.redirect("/configure"));

// API Routes
addon.get("/request_token", async (req, res) => {
  const requestToken = await getRequestToken();
  respond(res, requestToken);
});

addon.get("/session_id", async (req, res) => {
  const requestToken = req.query.request_token;
  const sessionId = await getSessionId(requestToken);
  respond(res, sessionId);
});

addon.get("/api/stats", (req, res) => {
  respond(res, stats.getStats());
});

// Track configuration updates
addon.use("/configure", (req, res, next) => {
  const config = parseConfig(req.params.catalogChoices);
  const analytics = require("./utils/analytics");
  
  analytics.trackConfigUpdate({
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

// Manifest Route
addon.get("/:catalogChoices?/manifest.json", async (req, res) => {
  const { catalogChoices } = req.params;
  const config = parseConfig(catalogChoices);
  const manifest = await getManifest(config);
  
  stats.trackInstallation(req.ip);
  
  const cacheOpts = {
    cacheMaxAge: 12 * 60 * 60,
    staleRevalidate: 14 * 24 * 60 * 60,
    staleError: 30 * 24 * 60 * 60,
  };
  respond(res, manifest, cacheOpts);
});


// New function to fetch metadata with caching
async function fetchMetadataWithCaching(type, language, id, rpdbkey) {
  return cacheWrapMeta(`${language}:${type}:${id}`, async () => {
    return await getMeta(type, language, id, rpdbkey);
  });
}

// Catalog Route
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
    const args = [type, language, page];

    if (search) {
      metas = await getSearch(type, language, search, config);
    } else {
      switch (id) {
        case "tmdb.trending":
          metas = await getTrending(...args, genre);
          break;
        case "tmdb.favorites":
          metas = await getFavorites(...args, genre, sessionId);
          break;
        case "tmdb.watchlist":
          metas = await getWatchList(...args, genre, sessionId);
          break;
        default:
          metas = await getCatalog(...args, id, genre, config);
          break;
      }
    }
  } catch (e) {
    res.status(404).send(e?.message || "Not found");
    return;
  }

  const cacheOpts = {
    cacheMaxAge: 1 * 24 * 60 * 60,
    staleRevalidate: 7 * 24 * 60 * 60,
    staleError: 14 * 24 * 60 * 60,
  };
  // Use the new fetchMetadataWithCaching function for each item
  metas.metas = await Promise.all(
    metas.metas.map(async (meta) => {
      const modifiedId = meta.id.replace("tmdb:", "");
      const updatedMeta = await fetchMetadataWithCaching(meta.type, language, modifiedId, rpdbkey);
      const metaDict = updatedMeta.meta;
      const imdb_id = metaDict?.imdb_id;

      // Update the metadata with appropriate IDs
      return {
        ...metaDict,
        tmdb_id: meta.id,
        id: imdb_id || meta.id
      };
      // return metaDict;
    })
  );

  respond(res, metas, cacheOpts);
});

// Meta Route
addon.get("/:catalogChoices?/meta/:type/:id.json", async (req, res) => {
  const { catalogChoices, type, id } = req.params;
  const config = parseConfig(catalogChoices);
  const tmdbId = id.split(":")[1];
  const language = config.language || DEFAULT_LANGUAGE;
  const rpdbkey = config.rpdbkey;
  const imdbId = id.split(":")[0];

  if (id.includes("tmdb:")) {
    const resp = await cacheWrapMeta(`${language}:${type}:${tmdbId}`, async () => {
      return await getMeta(type, language, tmdbId, rpdbkey);
    });

    respond(res, resp, { staleRevalidate: 20 * 24 * 60 * 60, staleError: 30 * 24 * 60 * 60 });
  } else if (id.includes("tt")) {
    const tmdbId = await getTmdb(type, imdbId);
    if (tmdbId) {
      const resp = await cacheWrapMeta(`${language}:${type}:${tmdbId}`, async () => {
        return await getMeta(type, language, tmdbId, rpdbkey);
      });

      respond(res, resp, { staleRevalidate: 20 * 24 * 60 * 60, staleError: 30 * 24 * 60 * 60 });
    } else {
      respond(res, { meta: {} });
    }
  }
});

// Export for serverless deployment
module.exports = addon;