require("dotenv").config();
const { MovieDb } = require("moviedb-promise");
const Utils = require("../utils/parseProps");
const moviedb = new MovieDb(process.env.TMDB_API);
const { getEpisodes } = require("./getEpisodes");
const { getImdbRating } = require("./getImdbRating");


async function getMeta(type, language, tmdbId, rpdbkey) {
  // Extract country code from ISO 3166-1 language format (e.g., "en-US")
  const country = language.slice(-2);
  if (type === "movie") {
    const meta = await moviedb
      .movieInfo({ id: tmdbId, language, append_to_response: "videos,credits,release_dates", })
      .then(async (res) => {
        const releaseDates = res.release_dates.results;

        // Helper function to find certification by country code
        const findCertification = (countryCode) => {
          for (const releaseDate of releaseDates) {
            if (releaseDate.iso_3166_1 === countryCode) {
              for (const date of releaseDate.release_dates) {
                if (date.certification) {
                  return date.certification;
                }
              }
            }
          }
          return "";
        };

        // Try to find certification for the specified country, otherwise fallback to "US"
        const ageRating = findCertification(country) || findCertification("US");
        const imdbRating = res.imdb_id
          ? await getImdbRating(res.imdb_id, type) ?? res.vote_average.toFixed(1).toString()
          : res.vote_average.toFixed(1).toString();


        const resp = {
          imdb_id: res.imdb_id,
          cast: Utils.parseCast(res.credits),
          country: Utils.parseCoutry(res.production_countries),
          description: res.overview,
          director: Utils.parseDirector(res.credits),
          genre: Utils.parseGenres(res.genres),
          imdbRating: imdbRating,
          ageRating: ageRating,
          name: res.title,
          released: new Date(res.release_date),
          slug: Utils.parseSlug(type, res.title, res.imdb_id),
          type: type,
          writer: Utils.parseWriter(res.credits),
          year: res.release_date ? res.release_date.substr(0, 4) : "",
          trailers: Utils.parseTrailers(res.videos),
          background: `https://image.tmdb.org/t/p/original${res.backdrop_path}`,
          poster: await Utils.parsePoster(type, tmdbId, res.poster_path, language, rpdbkey),
          runtime: Utils.parseRunTime(res.runtime),
          id: `tmdb:${tmdbId}`,
          genres: Utils.parseGenres(res.genres),
          releaseInfo: res.release_date ? res.release_date.substr(0, 4) : "",
          trailerStreams: Utils.parseTrailerStream(res.videos),
          logo: `https://images.metahub.space/logo/medium/${res.imdb_id}/img`,
          links: new Array(
            Utils.parseImdbLink(imdbRating, res.imdb_id),
            Utils.parseShareLink(res.title, res.imdb_id, type),
            ...Utils.parseGenreLink(res.genres, type, language),
            ...Utils.parseCreditsLink(res.credits)
          ),
          behaviorHints: {
            defaultVideoId: res.imdb_id ? res.imdb_id : `tmdb:${res.id}`,
            hasScheduledVideos: false
          },
        };
        return resp;
      })
      .catch(console.error);
    return Promise.resolve({ meta });
  } else {
    const meta = await moviedb
      .tvInfo({ id: tmdbId, language, append_to_response: "videos,credits,external_ids,content_ratings", })
      .then(async (res) => {
        const imdbRating = res.external_ids.imdb_id
          ? await getImdbRating(res.external_ids.imdb_id, type) ?? res.vote_average.toFixed(1).toString()
          : res.vote_average.toFixed(1).toString();
        const runtime = res.episode_run_time?.[0] ?? res.next_episode_to_air?.runtime ?? res.last_episode_to_air?.runtime ?? null;
        const contentRatings = res.content_ratings.results;

        const findAgeRating = (countryCode) => {
          const rating = contentRatings.find(r => r.iso_3166_1 === countryCode);
          return rating ? rating.rating : "";
        };

        let ageRating = findAgeRating(country) || findAgeRating("US");
        const resp = {
          cast: Utils.parseCast(res.credits),
          country: Utils.parseCoutry(res.production_countries),
          description: res.overview,
          genre: Utils.parseGenres(res.genres),
          imdbRating: imdbRating,
          ageRating: ageRating,
          imdb_id: res.external_ids.imdb_id,
          name: res.name,
          poster: await Utils.parsePoster(type, tmdbId, res.poster_path, language, rpdbkey),
          released: new Date(res.first_air_date),
          runtime: Utils.parseRunTime(runtime),
          status: res.status,
          type: type,
          writer: Utils.parseCreatedBy(res.created_by),
          year: Utils.parseYear(res.status, res.first_air_date, res.last_air_date),
          background: `https://image.tmdb.org/t/p/original${res.backdrop_path}`,
          slug: Utils.parseSlug(type, res.name, res.external_ids.imdb_id),
          id: `tmdb:${tmdbId}`,
          logo: `https://images.metahub.space/logo/medium/${res.external_ids.imdb_id}/img`,
          genres: Utils.parseGenres(res.genres),
          releaseInfo: Utils.parseYear(res.status, res.first_air_date, res.last_air_date),
          videos: [],
          links: new Array(
            Utils.parseImdbLink(imdbRating, res.external_ids.imdb_id),
            Utils.parseShareLink(res.name, res.external_ids.imdb_id, type),
            ...Utils.parseGenreLink(res.genres, type, language),
            ...Utils.parseCreditsLink(res.credits)
          ),
          trailers: Utils.parseTrailers(res.videos),
          trailerStreams: Utils.parseTrailerStream(res.videos),
          behaviorHints: {
            defaultVideoId: null,
            hasScheduledVideos: true
          }
        };
        try {
          resp.videos = await getEpisodes(language, tmdbId, res.external_ids.imdb_id, res.seasons);
        } catch (e) {
          console.log(`warning: episodes could not be retrieved for ${tmdbId} - ${type}`);
          console.log((e || {}).message || "unknown error");
        }
        return resp;

      })
      .catch(console.error);
    return Promise.resolve({ meta });
  }
}

module.exports = { getMeta };
