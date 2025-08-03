async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return await res.json();
}

function renderAlbum(album) {
  const genres = Array.isArray(album.genres)
    ? album.genres
    : typeof album.genres === 'string'
      ? JSON.parse(album.genres.replace(/'/g, '"'))
      : [];

  return `
    <div class="album">
      <img src="${album.imageUrl}" alt="${album.title}" />
      <h3>${album.title}</h3>
      <p>${album.artist}</p>
      <p>${genres.join(', ')}</p>
    </div>
  `;
}

function renderMovie(movie) {
  return `
    <div class="movie">
      <h3>${movie.title} (${movie.year})</h3>
      <p>Rating: ${movie.rating} ⭐</p>
      <a href="${movie.letterboxdUrl}" target="_blank">View on Letterboxd</a>
    </div>
  `;
}

async function loadAlbums() {
  try {
    const albums = await fetchJSON('data/albums.json');
    const container = document.getElementById('albums-container');
    container.innerHTML = albums.map(renderAlbum).join('');
  } catch (err) {
    console.error('Error loading albums:', err);
  }
}

async function loadMovies() {
  try {
    const movies = await fetchJSON('data/movies.json');
    const container = document.getElementById('movies-container');
    container.innerHTML = movies.map(renderMovie).join('');
  } catch (err) {
    console.error('Error loading movies:', err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadAlbums();
  loadMovies();
});
