require('dotenv').config()
const { MovieDb } = require('moviedb-promise')
const moviedb = new MovieDb(process.env.TMDB_API)
const cache = new Map();

async function getGenreList(language, type) {
  const cacheKey = `${type}-${language}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  let genre;

  try {
    if (type === "movie") {
      const response = await moviedb.genreMovieList({ language });
      genre = response.genres;
    } else {
      const response = await moviedb.genreTvList({ language });
      genre = response.genres;
    }

    cache.set(cacheKey, genre);
  } catch (error) {
    console.error(error);
  }

  return genre;
}
module.exports = { getGenreList };
