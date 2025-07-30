// TMDB API integration for fetching movie posters
export interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
}

export interface TMDBSearchResponse {
  results: TMDBMovie[];
  total_results: number;
}

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';

export async function searchMovieOnTMDB(title: string, year?: number): Promise<string | null> {
  if (!TMDB_API_KEY) {
    console.error('TMDB_API_KEY not found');
    return null;
  }

  try {
    const searchQuery = encodeURIComponent(title);
    const yearParam = year ? `&year=${year}` : '';
    
    let url: string;
    let response: Response;
    let data: TMDBSearchResponse;
    
    // Special case: Loki should search TV series, not movies
    if (title.toLowerCase() === 'loki' && year === 2021) {
      url = `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${searchQuery}&first_air_date_year=${year}`;
      response = await fetch(url);
      
      if (!response.ok) {
        console.error(`TMDB API error: ${response.status} ${response.statusText}`);
        return null;
      }
      
      data = await response.json();
    } else {
      // Try movie search first for all other titles
      url = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${searchQuery}${yearParam}`;
      response = await fetch(url);
      
      if (!response.ok) {
        console.error(`TMDB API error: ${response.status} ${response.statusText}`);
        return null;
      }
      
      data = await response.json();
      
      // If no movie results, try TV search for shows/series
      if (data.results.length === 0) {
        url = `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${searchQuery}${yearParam ? `&first_air_date_year=${year}` : ''}`;
        response = await fetch(url);
        
        if (response.ok) {
          data = await response.json();
        }
      }
    }
    
    if (data.results.length === 0) {
      console.log(`No TMDB results for: ${title} (${year})`);
      return null;
    }
    
    // Get the first result (usually most relevant)
    const movie = data.results[0];
    
    if (!movie.poster_path) {
      console.log(`No poster available for: ${title} (${year})`);
      return null;
    }
    
    const posterUrl = `${POSTER_BASE_URL}${movie.poster_path}`;
    console.log(`Found poster for: ${title} -> ${posterUrl}`);
    return posterUrl;
    
  } catch (error) {
    console.error(`Error fetching poster for ${title}:`, error);
    return null;
  }
}

export async function fetchPostersForMovies(movies: Array<{title: string, year: number | null}>): Promise<Map<string, string>> {
  const posterMap = new Map<string, string>();
  const batchSize = 10; // Process in batches to avoid rate limiting
  
  console.log(`Starting to fetch posters for ${movies.length} movies...`);
  
  for (let i = 0; i < movies.length; i += batchSize) {
    const batch = movies.slice(i, i + batchSize);
    
    const promises = batch.map(async (movie) => {
      const posterUrl = await searchMovieOnTMDB(movie.title, movie.year || undefined);
      if (posterUrl) {
        const key = `${movie.title}${movie.year ? ` (${movie.year})` : ''}`;
        posterMap.set(key, posterUrl);
      }
      
      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    await Promise.all(promises);
    
    console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(movies.length / batchSize)}`);
    
    // Longer delay between batches
    if (i + batchSize < movies.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`Poster fetching complete. Found ${posterMap.size} posters out of ${movies.length} movies.`);
  return posterMap;
}