require("dotenv").config();
const { MovieDb } = require("moviedb-promise");
const moviedb = new MovieDb(process.env.TMDB_API);
const diferentOrder = require("../static/diferentOrder.json");
const diferentImdbId = require("../static/diferentImdbId.json");

function genSeasonsString(seasons) {
  if (seasons.length <= 20) {
    return [
      seasons.map((season) => `season/${season.season_number}`).join(","),
    ];
  } else {
    const result = new Array(Math.ceil(seasons.length / 20))
      .fill()
      .map((_) => seasons.splice(0, 20));
    return result.map((arr) => {
      return arr.map((season) => `season/${season.season_number}`).join(",");
    });
  }
}

async function getEpisodes(language, tmdbId, imdb_id, seasons) {
  const seasonString = genSeasonsString(seasons);
  const difOrder = diferentOrder.find((data) => data.tmdbId === tmdbId);
  const difImdbId = diferentImdbId.find((data) => data.tmdbId === tmdbId);
  imdb_id = !difImdbId ? imdb_id : difImdbId.imdbId;
  if (difOrder != undefined) {
    return await moviedb
      .episodeGroup({ language: language, id: difOrder.episodeGroupId })
      .then((episodeGroups) =>
        episodeGroups.groups
          .map((group) =>
            group.episodes.map((episode, index) => ({
              id: difOrder.watchOrderOnly
                ? `${imdb_id}:${episode.season_number}:${episode.episode_number}`
                : `${imdb_id}:${group.order}:${index + 1}`,
              name: episode.name,
              season: group.order,
              episode: index + 1,
              thumbnail: `https://image.tmdb.org/t/p/w500${episode.still_path}`,
              overview: episode.overview,
              description: episode.overview,
              rating: episode.vote_average,
              firstAired: difOrder.watchOrderOnly
                ? new Date(new Date(Date.parse(group.episodes[0].air_date) + index).toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }))
                : new Date(new Date(Date.parse(episode.air_date) + index).toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' })),
              released: difOrder.watchOrderOnly
                ? new Date(new Date(Date.parse(group.episodes[0].air_date) + index).toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }))
                : new Date(new Date(Date.parse(episode.air_date) + index).toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' })),
            }))
          )
          .reduce((a, b) => a.concat(b), [])
      )
      .catch(console.error);
  } else {
    const episodes = [];
    await Promise.all(
      seasonString.map(async (el) => {
        await moviedb
          .tvInfo({ id: tmdbId, language, append_to_response: el })
          .then((res) => {
            const splitSeasons = el.split(",");
            splitSeasons.map((season) => {
              if (res[season]) {
                res[season].episodes.map((episode, index) => {
                  episodes.push({
                    id: imdb_id
                      ? `${imdb_id}:${episode.season_number}:${index + 1}`
                      : `tmdb:${tmdbId}:${episode.season_number}:${index + 1}`,
                    name: episode.name,
                    season: episode.season_number,
                    number: index + 1,
                    episode: index + 1,
                    thumbnail: `https://image.tmdb.org/t/p/w500${episode.still_path}`,
                    overview: episode.overview,
                    description: episode.overview,
                    rating: episode.vote_average.toString(),
                    firstAired: new Date(
                      Date.parse(episode.air_date) + episode.season_number
                    ),
                    released: new Date(
                      Date.parse(episode.air_date) + episode.season_number
                    ),
                  });
                });
              }
            });
          })
          .catch(console.error);
      })
    );
    return episodes;
  }
}

module.exports = { getEpisodes };
