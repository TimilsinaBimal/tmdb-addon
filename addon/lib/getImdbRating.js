const axios = require('axios');

async function getImdbRating(imdbId, type) {
  try {
    const response = await axios.get(`https://cinemeta-live.strem.io/meta/${type}/${imdbId}.json`);
    const data = response.data.meta;
    return data.imdbRating;
  } catch (error) {
    console.error('Erro ao obter dados do Cinemeta:', error);
    throw error;
  }
}

module.exports = { getImdbRating }