const cacheManager = require("cache-manager");
const mongoStore = require("cache-manager-mongodb");

const GLOBAL_KEY_PREFIX = "tmdb-addon";
const META_KEY_PREFIX = `${GLOBAL_KEY_PREFIX}|meta`;
const CATALOG_KEY_PREFIX = `${GLOBAL_KEY_PREFIX}|catalog`;

const META_TTL = parseInt(process.env.META_TTL || 24 * 60 * 60); // 24 hours
const CATALOG_TTL = parseInt(process.env.CATALOG_TTL || 12 * 60 * 60); // 12 hours
const MONGO_URI = process.env.MONGODB_URI;
const NO_CACHE = process.env.NO_CACHE === "true";

let cache;

function initiateCache() {
  if (NO_CACHE) return null;

  if (MONGO_URI) {
    return cacheManager.caching({
      store: mongoStore,
      uri: MONGO_URI,
      options: {
        collection: "tmdb_cache",
        ttl: META_TTL,
        compression: false,
        useUnifiedTopology: true,
      },
      ttl: META_TTL,
    });
  }

  return cacheManager.caching({ store: "memory", ttl: META_TTL });
}

cache = initiateCache();

function cacheWrap(key, method, ttl) {
  if (NO_CACHE || !cache) return method();
  return cache.wrap(key, method, { ttl: ttl || META_TTL });
}

function cacheWrapCatalog(id, method) {
  return cacheWrap(`${CATALOG_KEY_PREFIX}:${id}`, method, CATALOG_TTL);
}

function cacheWrapMeta(id, method) {
  return cacheWrap(`${META_KEY_PREFIX}:${id}`, method, META_TTL);
}

function clearCache() {
  if (cache && cache.reset) {
    return cache.reset();
  }
  return Promise.resolve();
}

module.exports = {
  cacheWrapCatalog,
  cacheWrapMeta,
  clearCache,
};
