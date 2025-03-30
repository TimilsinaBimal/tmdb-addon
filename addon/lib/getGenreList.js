require('dotenv').config()
const { MovieDb } = require('moviedb-promise')
const moviedb = new MovieDb(process.env.TMDB_API)
const cache = new Map();

const movieGenres = [
  { "id": 28, "name": "Action" },
  { "id": 12, "name": "Adventure" },
  { "id": 16, "name": "Animation" },
  { "id": 35, "name": "Comedy" },
  { "id": 80, "name": "Crime" },
  { "id": 99, "name": "Documentary" },
  { "id": 18, "name": "Drama" },
  { "id": 10751, "name": "Family" },
  { "id": 14, "name": "Fantasy" },
  { "id": 36, "name": "History" },
  { "id": 27, "name": "Horror" },
  { "id": 10402, "name": "Music" },
  { "id": 9648, "name": "Mystery" },
  { "id": 10749, "name": "Romance" },
  { "id": 878, "name": "Science Fiction" },
  { "id": 10770, "name": "TV Movie" },
  { "id": 53, "name": "Thriller" },
  { "id": 10752, "name": "War" },
  { "id": 37, "name": "Western" }
]

const seriesGenres = [
  { "id": 10759, "name": "Action & Adventure" },
  { "id": 16, "name": "Animation" },
  { "id": 35, "name": "Comedy" },
  { "id": 80, "name": "Crime" },
  { "id": 99, "name": "Documentary" },
  { "id": 18, "name": "Drama" },
  { "id": 10751, "name": "Family" },
  { "id": 10762, "name": "Kids" },
  { "id": 9648, "name": "Mystery" },
  { "id": 10763, "name": "News" },
  { "id": 10764, "name": "Reality" },
  { "id": 10765, "name": "Sci-Fi & Fantasy" },
  { "id": 10766, "name": "Soap" },
  { "id": 10767, "name": "Talk" },
  { "id": 10768, "name": "War & Politics" },
  { "id": 37, "name": "Western" }
]

async function getGenreList(language, type) {
  const cacheKey = `${type}-${language}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  let genre;

  if (type === "movie" && language === 'en-US') {
    genre = movieGenres;
  } else if (type === "tv" && language === 'en-US') {
    genre = seriesGenres;
  } else {
    try {
      const response = type === "movie"
        ? await moviedb.genreMovieList({ language })
        : await moviedb.genreTvList({ language });
      genre = response.genres;
    } catch (error) {
      console.error(error);
    }
  }

  cache.set(cacheKey, genre);
  return genre;
}

module.exports = { getGenreList };
