require("dotenv").config();
const { MovieDb } = require("moviedb-promise");
const Utils = require("../utils/parseProps");
const moviedb = new MovieDb(process.env.TMDB_API);
const { getEpisodes } = require("./getEpisodes");
const { getImdbRating } = require("./getImdbRating");

async function getMeta(type, language, tmdbId, rpdbkey) {
  const country = language.slice(-2);
  const mediaType = type === "movie" ? "movieInfo" : "tvInfo";
  const appendResponse = type === "movie" ? "videos,credits,release_dates" : "videos,credits,external_ids,content_ratings";

  try {
    const res = await moviedb[mediaType]({ id: tmdbId, language, append_to_response: appendResponse });

    // Fetch IMDb rating in parallel
    const imdbId = type === "movie" ? res.imdb_id : res.external_ids?.imdb_id;
    const imdbRatingPromise = imdbId ? getImdbRating(imdbId, type) : null;

    // Extract ageRating efficiently
    const ratings = type === "movie" ? res.release_dates?.results : res.content_ratings?.results;
    let ageRating = getAgeRating(ratings, country) || getAgeRating(ratings, "US");

    // Await IMDb Rating
    const imdbRating = (await imdbRatingPromise) ?? res.vote_average?.toFixed(1)?.toString();

    // Parallel poster and videos fetch
    const [poster, videos] = await Promise.all([
      Utils.parsePoster(type, tmdbId, res.poster_path, language, rpdbkey),
      type === "tv" ? getEpisodes(language, tmdbId, imdbId, res.seasons) : []
    ]);

    const resp = {
      imdb_id: imdbId,
      cast: Utils.parseCast(res.credits),
      country: Utils.parseCoutry(res.production_countries),
      description: res.overview,
      director: type === "movie" ? Utils.parseDirector(res.credits) : undefined,
      genre: Utils.parseGenres(res.genres),
      imdbRating,
      ageRating,
      name: type === "movie" ? res.title : res.name,
      released: new Date(type === "movie" ? res.release_date : res.first_air_date),
      slug: Utils.parseSlug(type, type === "movie" ? res.title : res.name, imdbId),
      type,
      writer: type === "movie" ? Utils.parseWriter(res.credits) : Utils.parseCreatedBy(res.created_by),
      year: (type === "movie" ? res.release_date : res.first_air_date)?.substr(0, 4),
      trailers: Utils.parseTrailers(res.videos),
      background: `https://image.tmdb.org/t/p/original${res.backdrop_path}`,
      poster,
      runtime: Utils.parseRunTime(type === "movie" ? res.runtime : res.episode_run_time?.[0]),
      id: `tmdb:${tmdbId}`,
      genres: Utils.parseGenres(res.genres),
      releaseInfo: (type === "movie" ? res.release_date : res.first_air_date)?.substr(0, 4),
      trailerStreams: Utils.parseTrailerStream(res.videos),
      links: [
        Utils.parseImdbLink(imdbRating, imdbId),
        Utils.parseShareLink(type === "movie" ? res.title : res.name, imdbId, type),
        ...Utils.parseGenreLink(res.genres, type, language),
        ...Utils.parseCreditsLink(res.credits)
      ],
      behaviorHints: {
        defaultVideoId: type === "tv" ? null : (imdbId || `tmdb:${res.id}`),
        hasScheduledVideos: type === "tv"
      },
      videos
    };

    try {
      resp.logo = `https://images.metahub.space/logo/medium/${imdbId}/img`;
    } catch (e) {
      console.warn(`Logo not found for ${tmdbId} - ${type}`);
    }

    return { meta: resp };

  } catch (error) {
    console.error(error);
    return { meta: null };
  }
}

// Helper function to extract age rating
function getAgeRating(ratings, country) {
  return ratings?.find(r => r.iso_3166_1 === country)?.release_dates?.find(d => d.certification)?.certification ||
    ratings?.find(r => r.iso_3166_1 === country)?.rating;
}


module.exports = { getMeta };