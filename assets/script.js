document.addEventListener("DOMContentLoaded", () => {
  loadAlbums();
  loadMovies();
});

async function loadAlbums() {
  /* try {
    const res = await fetch("data/albums.json");
    const albums = await res.json();
    const container = document.getElementById("albums-container");
    container.innerHTML = albums.map(renderAlbum).join("");
  } catch (err) {
    console.error("Error loading albums:", err);
  }*/
}


async function loadMovies() {
  /* try {
    const res = await fetch("data/movies.json");
    const movies = await res.json();
    const container = document.getElementById("movies-container");
    container.innerHTML = movies.map(renderMovie).join("");
  } catch (err) {
    console.error("Error loading movies:", err);
  }*/
}


function renderAlbum(album) {
  let genres = [];

  try {
    if (Array.isArray(album.genres)) {
      genres = album.genres;
    } else if (typeof album.genres === "string") {
      genres = JSON.parse(album.genres.replace(/'/g, '"'));
    }
  } catch (e) {
    console.warn(`Invalid genres for album: ${album.title}`, album.genres);
  }

  const imgSrc = album.imageUrl || 'covers/default.png';

  return `
    <div class="album">
      <img src="${imgSrc}" alt="${album.title}" onerror="this.src='covers/default.png';" />
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

