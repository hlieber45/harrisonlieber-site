document.addEventListener("DOMContentLoaded", () => {
  loadAlbums();
  loadMovies();
});

async function loadAlbums() {
  try {
    const res = await fetch("data/albums.json");
    const albums = await res.json();
    const container = document.getElementById("albums-container");
    container.innerHTML = albums.map(renderAlbum).join("");
  } catch (err) {
    console.error("Error loading albums:", err);
  }
}

async function loadMovies() {
  try {
    const res = await fetch("data/movies.json");
    const movies = await res.json();
    const container = document.getElementById("movies-container");
    container.innerHTML = movies.map(renderMovie).join("");
  } catch (err) {
    console.error("Error loading movies:", err);
  }
}

function renderAlbum(album) {
  const genres = Array.isArray(album.genres)
    ? album.genres
    : typeof album.genres === "string"
    ? JSON.parse(album.genres.replace(/'/g, '"'))
    : [];

  return `
    <div class="album">
      <img src="${album.imageUrl || 'covers/default.png'}" alt="${album.title}" />
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
      <p>Rating: ${movie.rating ?? "N/A"}</p>
      <p><a href="${movie.letterboxdUrl}" target="_blank">View on Letterboxd</a></p>
    </div>
  `;
}

