const express = require("express");
const path = require("path");
const addon = express();
require("dotenv").config();
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

const { MovieDb } = require("moviedb-promise");
const moviedb = new MovieDb(process.env.TMDB_API);

addon.use(express.static(path.join(__dirname, "../dist")));
addon.use("/streaming", express.static(path.join(__dirname, "../public/streaming")));
addon.use("/configure", express.static(path.join(__dirname, "../dist")));

const getCacheHeaders = (opts = {}) => {
  if (!Object.keys(opts).length) return false;
  const headers = {
    cacheMaxAgeVercel: "s-maxage",
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
  // res.setHeader('Vary', 'User-Agent');
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

  const cacheOpts = {
    cacheMaxAge: 12 * 60 * 60,
    staleRevalidate: 14 * 24 * 60 * 60,
    staleError: 30 * 24 * 60 * 60,
  };
  respond(res, manifest, cacheOpts);
});

const BATCH_SIZE = 20; // Set based on TMDB rate limits

// Function to process in batches
async function fetchImdbIdsInBatches(metas, type) {
  const batchedMetas = [];

  for (let i = 0; i < metas.length; i += BATCH_SIZE) {
    const batch = metas.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (el) => {
      try {
        const tmdbId = el.id.replace("tmdb:", "");
        const externalIds = type === "movie"
          ? await moviedb.movieExternalIds({ id: tmdbId })
          : await moviedb.tvExternalIds({ id: tmdbId });

        el[type === "movie" ? "moviedb_id" : "tvdb_id"] = tmdbId;

        if (externalIds && externalIds.imdb_id) {
          el.id = externalIds.imdb_id;
        }
      } catch (error) {
        console.error(`Failed to fetch external IDs for ${el.id}:`, error.message || error);
      }
      return el;
    });

    // Wait for all requests in the current batch to complete
    batchedMetas.push(...(await Promise.all(batchPromises)));
  }

  return batchedMetas;
}


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
          metas = await getCatalog(type, language, page, id, genre, config);
      }
    }

    metas.metas = await fetchImdbIdsInBatches(metas.metas, type);

    respond(res, metas, {
      cacheMaxAge: 4 * 60 * 60, // 12 hours
      cacheMaxAgeVercel: 4 * 60 * 60, // 12 hours
      staleRevalidate: 0.5 * 60 * 60,
      staleError: 60 * 60,
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

const fetchMeta = async (type, language, id, rpdbkey) => {
  const tmdbId = id.split(":").pop();
  const imdbId = id.split(":")[0];

  if (id.includes("tmdb:")) {
    return getMeta(type, language, tmdbId, rpdbkey);
  } else if (id.includes("tt")) {
    const tmdbId = await getTmdb(type, imdbId);
    if (tmdbId) {
      return getMeta(type, language, tmdbId, rpdbkey);
    }
    return { meta: null };
  }
};

addon.get("/:catalogChoices?/meta/:type/:id.json", async (req, res) => {
  const { catalogChoices, type, id } = req.params;
  const config = parseConfig(catalogChoices);
  const language = config.language || DEFAULT_LANGUAGE;
  const rpdbkey = config.rpdbkey;
  const meta = await fetchMeta(type, language, id, rpdbkey);
  respond(res, meta, {
    cacheMaxAge: 4 * 60 * 60, // 12 hours
    cacheMaxAgeVercel: 4 * 60 * 60, // 12 hours
    staleRevalidate: 0.5 * 60 * 60,
    staleError: 60 * 60,
  });
});

module.exports = addon;
