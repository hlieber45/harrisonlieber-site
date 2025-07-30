import { 
  type Album, 
  type InsertAlbum, 
  type Movie, 
  type InsertMovie, 
  type EntertainmentItem, 
  type InsertEntertainmentItem,
  type ContactSubmission,
  type InsertContactSubmission
} from "@shared/schema";
import { 
  type Recommendation, 
  type InsertRecommendation 
} from "@shared/recommendation";
import fs from 'fs';
import path from 'path';
import { fetchPostersForMovies, searchMovieOnTMDB } from './tmdb';
import { spotifyAPI } from './spotify';
import { getManualCoverUrl, hasManualCover, preserveList } from './manualCovers';
import { randomUUID } from "crypto";

export interface IStorage {
  // Albums
  getAlbums(): Promise<Album[]>;
  getAlbumsByGenre(genre: string): Promise<Album[]>;
  createAlbum(album: InsertAlbum): Promise<Album>;
  
  // Movies
  getMovies(): Promise<Movie[]>;
  getMoviesByCategory(category: string): Promise<Movie[]>;
  getRecentlyWatchedMovies(): Promise<Movie[]>;
  getRecentlyReleasedMovies(): Promise<Movie[]>;
  createMovie(movie: InsertMovie): Promise<Movie>;
  
  // Entertainment
  getEntertainmentItems(): Promise<EntertainmentItem[]>;
  getEntertainmentItemsByCategory(category: string): Promise<EntertainmentItem[]>;
  createEntertainmentItem(item: InsertEntertainmentItem): Promise<EntertainmentItem>;
  
  // Contact
  createContactSubmission(submission: InsertContactSubmission): Promise<ContactSubmission>;
  getContactSubmissions(): Promise<ContactSubmission[]>;
  
  // Recommendations
  createRecommendation(recommendation: InsertRecommendation): Promise<Recommendation>;
  getRecommendations(): Promise<Recommendation[]>;
}

export class MemStorage implements IStorage {
  private albums: Map<string, Album>;
  private movies: Map<string, Movie>;
  private entertainmentItems: Map<string, EntertainmentItem>;
  private contactSubmissions: Map<string, ContactSubmission>;
  private recommendations: Map<string, Recommendation>;

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  private loadRecentlyWatchedFromDiary(): Movie[] {
    // Reset all movies categorized as 'recently-watched' from ratings CSV
    // Only movies in diary CSV with recent dates should be 'recently-watched'
    Array.from(this.movies.values()).forEach(movie => {
      if (movie.category === 'recently-watched') {
        movie.category = 'other';
      }
    });
    
    try {
      const diaryPath = path.join(process.cwd(), 'attached_assets', 'diary_1753841049164.csv');
      const diaryContent = fs.readFileSync(diaryPath, 'utf-8');
      
      const lines = diaryContent.split('\n');
      const headers = this.parseCSVLine(lines[0]);
      
      // Find column indices
      const dateIndex = headers.findIndex(h => h.trim() === 'Date');
      const nameIndex = headers.findIndex(h => h.trim() === 'Name');
      const yearIndex = headers.findIndex(h => h.trim() === 'Year');
      const ratingIndex = headers.findIndex(h => h.trim() === 'Rating');
      const letterboxdIndex = headers.findIndex(h => h.trim() === 'Letterboxd URI');
      const watchedDateIndex = headers.findIndex(h => h.trim() === 'Watched Date');
      
      const recentlyWatched: Movie[] = [];
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      

      // Process each movie row from most recent
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const columns = this.parseCSVLine(line);
        if (columns.length < Math.max(dateIndex, nameIndex, yearIndex, ratingIndex) + 1) continue;
        
        // Use the "Date" column (when you logged it) for sorting, not "Watched Date"
        // This gives us the most recent activity, not necessarily when you watched it
        const loggedDateStr = columns[dateIndex]?.trim();
        if (!loggedDateStr) continue;
        
        const loggedDate = new Date(loggedDateStr);
        if (loggedDate < sixMonthsAgo) continue;
        
        // For display purposes, we can still store the actual watched date if available
        const actualWatchedDateStr = columns[watchedDateIndex]?.trim();
        const actualWatchedDate = actualWatchedDateStr ? new Date(actualWatchedDateStr) : loggedDate;
        
        const title = columns[nameIndex]?.trim();
        const year = parseInt(columns[yearIndex]) || null;
        const rating = parseFloat(columns[ratingIndex]) || null;
        const letterboxdUrl = columns[letterboxdIndex]?.trim();
        
        if (!title) continue;
        
        // Check if this movie already exists in our main collection
        const existingMovie = Array.from(this.movies.values()).find(m => 
          m.title === title && m.year === year
        );
        
        if (existingMovie) {
          // Update the existing movie with the logged date for sorting
          existingMovie.watchedDate = loggedDate;
          recentlyWatched.push(existingMovie);
        } else {
          // Create a new movie entry for recently watched
          const movieId = randomUUID();
          const newMovie: Movie = {
            id: movieId,
            title,
            year,
            rating,
            category: 'recently-watched',
            imageUrl: null,
            letterboxdUrl,
            review: null,
            watchedDate: loggedDate, // Use logged date for consistent sorting
            createdAt: new Date()
          };
          this.movies.set(movieId, newMovie);
          recentlyWatched.push(newMovie);
        }
      }
      
      // Sort by most recent logged date (descending)
      return recentlyWatched.sort((a, b) => 
        (b.watchedDate?.getTime() || 0) - (a.watchedDate?.getTime() || 0)
      ).slice(0, 20); // Limit to top 20 most recent
      
    } catch (error) {
      console.error('Error loading recently watched from diary:', error);
      return [];
    }
  }

  private async loadMoviesFromCSVSync(): Promise<InsertMovie[]> {
    try {
      const csvPath = path.join(process.cwd(), 'attached_assets', 'ratings_1753828374936.csv');
      const csvContent = fs.readFileSync(csvPath, 'utf-8');
      
      const lines = csvContent.split('\n');
      const headers = lines[0].split(',');
      
      // Find column indices
      const nameIndex = headers.findIndex(h => h.trim() === 'Name');
      const yearIndex = headers.findIndex(h => h.trim() === 'Year');
      const ratingIndex = headers.findIndex(h => h.trim() === 'Rating');
      const letterboxdIndex = headers.findIndex(h => h.trim() === 'Letterboxd URI');
      
      const movies: InsertMovie[] = [];
      const movieTitlesForPosterFetch: Array<{title: string, year: number | null}> = [];
      
      // Process each movie row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const columns = this.parseCSVLine(line);
        if (columns.length < 4) continue;
        
        const name = columns[nameIndex]?.replace(/"/g, '').trim();
        const year = parseInt(columns[yearIndex]?.trim() || '0');
        const rating = parseFloat(columns[ratingIndex]?.trim() || '0');
        const letterboxdUrl = columns[letterboxdIndex]?.trim();
        
        if (name && year && rating && letterboxdUrl) {
          // Parse the date to determine when it was watched
          const columns_date = columns[0]?.trim(); // Date is first column
          const watchDate = new Date(columns_date);
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
          const twoYearsAgo = new Date();
          twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
          
          // Categorize based on specific criteria (multiple categories possible)
          let category = 'other';
          
          // Priority categorization
          if (rating === 5) {
            category = 'favorites';
          } else if (rating <= 1.5) {
            category = 'least-favorite';
          } else if (year >= 2023) { // Recently released (last 2 years from 2025)
            category = 'recently-released';
          } else {
            category = 'other';
          }
          
          movies.push({
            title: name,
            year: year || null,
            rating: rating || null,
            category: category,
            letterboxdUrl: letterboxdUrl || null,
            imageUrl: null, // Will be filled with TMDB poster
            review: null
          });
          
          movieTitlesForPosterFetch.push({ title: name, year: year || null });
        }
      }
      
      console.log(`Loaded ${movies.length} movies from Letterboxd CSV`);
      
      // Fetch posters from TMDB for all movies
      console.log('Fetching movie posters from TMDB...');
      const posterMap = await fetchPostersForMovies(movieTitlesForPosterFetch);
      
      // Update movies with poster URLs
      movies.forEach(movie => {
        const key = `${movie.title}${movie.year ? ` (${movie.year})` : ''}`;
        const posterUrl = posterMap.get(key);
        if (posterUrl) {
          movie.imageUrl = posterUrl;
        }
      });
      
      const moviesWithPosters = movies.filter(m => m.imageUrl).length;
      console.log(`Successfully added posters to ${moviesWithPosters}/${movies.length} movies`);
      
      return movies;
      
    } catch (error) {
      console.error('Error processing Letterboxd CSV:', error);
      return [];
    }
  }



  private loadAlbumsFromList(): InsertAlbum[] {
    // Harrison's complete album collection with proper names and genre categorization
    const albumsData = [
      // Hip-Hop Albums
      { title: "10 Day", artist: "Chance the Rapper", genres: ["hip-hop"] },
      { title: "2014 Forest Hills Drive", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "4:44", artist: "Jay-Z", genres: ["hip-hop"] },
      { title: "4 Your Eyez Only", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "A Love Letter to You 3", artist: "Trippie Redd", genres: ["hip-hop"] },
      { title: "Acid Rap", artist: "Chance the Rapper", genres: ["hip-hop"] },
      { title: "American Dream", artist: "21 Savage", genres: ["hip-hop"] },
      { title: "Astroworld", artist: "Travis Scott", genres: ["hip-hop"] },
      { title: "ALLIGATOR", artist: "Tommy Richman", genres: ["hip-hop"] },
      { title: "Born Sinner", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "Bobby Tarantino II", artist: "Logic", genres: ["hip-hop"] },
      { title: "Birds in the Trap Sing McKnight", artist: "Travis Scott", genres: ["hip-hop"] },
      { title: "Better Me Than You", artist: "Big Sean", genres: ["hip-hop"] },
      { title: "Bad Cameo", artist: "James Blake & Lil Yachty", genres: ["hip-hop"] },
      { title: "Come Home the Kids Miss You", artist: "Jack Harlow", genres: ["hip-hop"] },
      { title: "Cole World: The Sideline Story", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "Chromakopia", artist: "Tyler, The Creator", genres: ["hip-hop"] },
      { title: "Cherry Bomb", artist: "Tyler, The Creator", genres: ["hip-hop"] },
      { title: "Certified Lover Boy", artist: "Drake", genres: ["hip-hop"] },
      { title: "Care Package", artist: "Drake", genres: ["hip-hop"] },
      { title: "Call Me If You Get Lost", artist: "Tyler, The Creator", genres: ["hip-hop"] },
      { title: "Culture III", artist: "Migos", genres: ["hip-hop"] },
      { title: "Culture", artist: "Migos", genres: ["hip-hop"] },
      { title: "Dark Sky Paradise", artist: "Big Sean", genres: ["hip-hop"] },
      { title: "Dark Lane Demo Tapes", artist: "Drake", genres: ["hip-hop"] },
      { title: "D-Day: A Gangsta Grillz Mixtape", artist: "Dreamville", genres: ["hip-hop"] },
      { title: "Dreams Worth More Than Money", artist: "Meek Mill", genres: ["hip-hop"] },
      { title: "Days Before Rodeo", artist: "Travis Scott", genres: ["hip-hop"] },
      { title: "For Broken Ears", artist: "Tems", genres: ["hip-hop"] },
      { title: "For All the Dogs", artist: "Drake", genres: ["hip-hop"] },
      { title: "Flower Boy", artist: "Tyler, The Creator", genres: ["hip-hop"] },
      { title: "Encore", artist: "Eminem", genres: ["hip-hop"] },
      { title: "Good Kid, M.A.A.D City", artist: "Kendrick Lamar", genres: ["hip-hop"] },
      { title: "GNX", artist: "Kendrick Lamar", genres: ["hip-hop"] },
      { title: "God Did", artist: "DJ Khaled", genres: ["hip-hop"] },
      { title: "Goblin", artist: "Tyler, The Creator", genres: ["hip-hop"] },
      { title: "How Do You Sleep At Night?", artist: "Teezo Touchdown", genres: ["hip-hop"] },
      { title: "Honestly, Nevermind", artist: "Drake", genres: ["hip-hop"] },
      { title: "Her Loss", artist: "Drake & 21 Savage", genres: ["hip-hop"] },
      { title: "Hardstone Psycho", artist: "Don Toliver", genres: ["hip-hop"] },
      { title: "IGOR", artist: "Tyler, The Creator", genres: ["hip-hop"] },
      { title: "If You're Reading This It's Too Late", artist: "Drake", genres: ["hip-hop"] },
      { title: "I Never Liked You", artist: "Future", genres: ["hip-hop"] },
      { title: "I Decided", artist: "Big Sean", genres: ["hip-hop"] },
      { title: "I Am > I Was", artist: "21 Savage", genres: ["hip-hop"] },
      { title: "JACKBOYS", artist: "JACKBOYS", genres: ["hip-hop"] },
      { title: "Jackman", artist: "Jack Harlow", genres: ["hip-hop"] },
      { title: "KOD", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "Khaled Khaled", artist: "DJ Khaled", genres: ["hip-hop"] },
      { title: "Late Nights", artist: "Jeremih", genres: ["hip-hop"] },
      { title: "Larger Than Life", artist: "Brent Faiyaz", genres: ["hip-hop"] },
      { title: "The Lost Boy", artist: "YBN Cordae", genres: ["hip-hop"] },
      { title: "Limbo", artist: "Aminé", genres: ["hip-hop"] },
      { title: "Light of Mine", artist: "Kyle", genres: ["hip-hop"] },
      { title: "Life of a Don", artist: "Don Toliver", genres: ["hip-hop"] },
      { title: "Love Sick", artist: "Don Toliver", genres: ["hip-hop"] },
      { title: "Heaven or Hell", artist: "Don Toliver", genres: ["hip-hop"] },
      { title: "Let's Start Here", artist: "Lil Yachty", genres: ["hip-hop"] },
      { title: "Mr. Morale & The Big Steppers", artist: "Kendrick Lamar", genres: ["hip-hop"] },
      { title: "More Life", artist: "Drake", genres: ["hip-hop"] },
      { title: "Montero", artist: "Lil Nas X", genres: ["hip-hop"] },
      { title: "The Miseducation of Lauryn Hill", artist: "Lauryn Hill", genres: ["hip-hop", "r&b"] },
      { title: "Might Delete Later", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "The Marshall Mathers LP", artist: "Eminem", genres: ["hip-hop"] },
      { title: "Man on the Moon: The End of Day", artist: "Kid Cudi", genres: ["hip-hop"] },
      { title: "Magna Carta Holy Grail", artist: "Jay-Z", genres: ["hip-hop"] },
      { title: "Nothing Was the Same", artist: "Drake", genres: ["hip-hop"] },
      { title: "Not All Heroes Wear Capes", artist: "Metro Boomin", genres: ["hip-hop"] },
      { title: "Metro Boomin Presents Spider-Verse", artist: "Metro Boomin", genres: ["hip-hop"] },
      { title: "Heroes & Villains", artist: "Metro Boomin", genres: ["hip-hop"] },
      { title: "Savage Mode II", artist: "21 Savage & Metro Boomin", genres: ["hip-hop"] },
      { title: "We Don't Trust You", artist: "Future & Metro Boomin", genres: ["hip-hop"] },
      { title: "We Still Don't Trust You", artist: "Future & Metro Boomin", genres: ["hip-hop"] },
      { title: "Professional Rapper", artist: "Lil Dicky", genres: ["hip-hop"] },
      { title: "Please Excuse Me for Being Antisocial", artist: "Roddy Ricch", genres: ["hip-hop"] },
      { title: "The Pink Tape", artist: "Lil Uzi Vert", genres: ["hip-hop"] },
      { title: "Pink Friday 2", artist: "Nicki Minaj", genres: ["hip-hop"] },
      { title: "Recovery", artist: "Eminem", genres: ["hip-hop"] },
      { title: "Reasonable Doubt", artist: "Jay-Z", genres: ["hip-hop"] },
      { title: "Rodeo", artist: "Travis Scott", genres: ["hip-hop"] },
      { title: "Revenge of the Dreamers III", artist: "Dreamville", genres: ["hip-hop"] },
      { title: "Stoney", artist: "Post Malone", genres: ["hip-hop"] },
      { title: "SremmLife", artist: "Rae Sremmurd", genres: ["hip-hop"] },
      { title: "So Far Gone", artist: "Drake", genres: ["hip-hop"] },
      { title: "SMYLE", artist: "Kyle", genres: ["hip-hop"] },
      { title: "Shoot for the Stars, Aim for the Moon", artist: "Pop Smoke", genres: ["hip-hop"] },
      { title: "Scorpion", artist: "Drake", genres: ["hip-hop"] },
      { title: "The Come Up", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "There's Really a Wolf", artist: "Russ", genres: ["hip-hop"] },
      { title: "The Warm Up", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "The Off-Season", artist: "J. Cole", genres: ["hip-hop"] },
      { title: "The Melodic Blue", artist: "Baby Keem", genres: ["hip-hop"] },
      { title: "The Forever Story", artist: "JID", genres: ["hip-hop"] },
      { title: "The Eminem Show", artist: "Eminem", genres: ["hip-hop"] },
      { title: "The Death of Slim Shady", artist: "Eminem", genres: ["hip-hop"] },
      { title: "The Coloring Book", artist: "Chance the Rapper", genres: ["hip-hop"] },
      { title: "The Blueprint", artist: "Jay-Z", genres: ["hip-hop"] },
      { title: "The Blueprint 2", artist: "Jay-Z", genres: ["hip-hop"] },
      { title: "The Blueprint 3", artist: "Jay-Z", genres: ["hip-hop"] },
      { title: "That's What They All Say", artist: "Jack Harlow", genres: ["hip-hop"] },
      { title: "Thank Me Later", artist: "Drake", genres: ["hip-hop"] },
      { title: "Tha Carter V", artist: "Lil Wayne", genres: ["hip-hop"] },
      { title: "Tha Carter IV", artist: "Lil Wayne", genres: ["hip-hop"] },
      { title: "Tha Carter III", artist: "Lil Wayne", genres: ["hip-hop"] },
      { title: "Take Care", artist: "Drake", genres: ["hip-hop"] },
      { title: "Utopia", artist: "Travis Scott", genres: ["hip-hop"] },
      { title: "Ultra 85", artist: "Logic", genres: ["hip-hop"] },
      { title: "Views", artist: "Drake", genres: ["hip-hop"] },
      { title: "WUNNA", artist: "Gunna", genres: ["hip-hop"] },
      { title: "WOLF", artist: "Tyler, The Creator", genres: ["hip-hop"] },
      
      // R&B Albums
      { title: "After Hours", artist: "The Weeknd", genres: ["r&b"] },
      { title: "All I Want Is You", artist: "Miguel", genres: ["r&b"] },
      { title: "ANTI", artist: "Rihanna", genres: ["r&b", "pop"] },
      { title: "Alone at Prom", artist: "Tory Lanez", genres: ["r&b"] },
      { title: "Case Study 01", artist: "Daniel Caesar", genres: ["r&b"] },
      { title: "Charm", artist: "Clairo", genres: ["r&b", "pop"] },
      { title: "Channel Orange", artist: "Frank Ocean", genres: ["r&b"] },
      { title: "Dawn FM", artist: "The Weeknd", genres: ["r&b"] },
      { title: "Funk Wav Bounces Vol. 1", artist: "Calvin Harris", genres: ["r&b", "pop"] },
      { title: "Good for You", artist: "Amine", genres: ["r&b"] },
      { title: "Islah", artist: "Kevin Gates", genres: ["r&b", "hip-hop"] },
      { title: "Wasteland", artist: "Brent Faiyaz", genres: ["r&b"] },
      { title: "Renaissance", artist: "Beyoncé", genres: ["r&b", "pop"] },
      { title: "SOS", artist: "SZA", genres: ["r&b"] },
      { title: "Ctrl", artist: "SZA", genres: ["r&b"] },
      { title: "Trapsoul", artist: "Bryson Tiller", genres: ["r&b"] },
      { title: "Blonde", artist: "Frank Ocean", genres: ["r&b"] },
      
      // Pop Albums
      { title: "18", artist: "Jack Harlow", genres: ["pop", "hip-hop"] },
      { title: "30", artist: "Adele", genres: ["pop"] },
      { title: "Justified", artist: "Justin Timberlake", genres: ["pop"] },
      { title: "Gemini", artist: "Macklemore", genres: ["pop"] },
      { title: "It's Not So Bad", artist: "Kyle", genres: ["pop"] },
      { title: "Kaytramine", artist: "Kaytraminé", genres: ["hip-hop"] },
      { title: "Moon Music", artist: "Coldplay", genres: ["pop"] },
      { title: "Onepointfive", artist: "Aminé", genres: ["pop"] },
      { title: "PARTYNEXTDOOR", artist: "PARTYNEXTDOOR", genres: ["pop", "r&b"] },
      { title: "Sweet Action", artist: "Unknown Artist", genres: ["pop"] },
      { title: "Spider-Verse", artist: "Various Artists", genres: ["pop"] },
      { title: "Twopointfive", artist: "Aminé", genres: ["pop"] },
      { title: "Unorthodox Jukebox", artist: "Bruno Mars", genres: ["pop"] },
      { title: "Wildest Dreams", artist: "Majid Jordan", genres: ["r&b"] },
      { title: "Zach Bryan", artist: "Zach Bryan", genres: ["country"] },
      
      // Rock Albums
      { title: "Abbey Road", artist: "The Beatles", genres: ["rock", "classic"] },
      { title: "Axis: Bold as Love", artist: "Jimi Hendrix", genres: ["rock", "classic"] },
      { title: "Glass Houses", artist: "Billy Joel", genres: ["rock"] },
      { title: "Hunky Dory", artist: "David Bowie", genres: ["rock", "classic"] },
      { title: "Pet Sounds", artist: "The Beach Boys", genres: ["rock", "classic"] },
      { title: "The Doors", artist: "The Doors", genres: ["rock", "classic"] },
      { title: "Turnstiles", artist: "Billy Joel", genres: ["rock"] },
      { title: "The Velvet Underground & Nico", artist: "The Velvet Underground", genres: ["rock", "classic"] },
      { title: "Trompe le Monde", artist: "Pixies", genres: ["rock"] },
      { title: "Surf's Up", artist: "The Beach Boys", genres: ["rock", "classic"] },
      { title: "The Stranger", artist: "Billy Joel", genres: ["rock"] },
      
      // Classic Albums
      { title: "52nd Street", artist: "Billy Joel", genres: ["classic", "jazz"] },
      { title: "Paul Anka Sings His Big 15", artist: "Paul Anka", genres: ["classic"] },
      { title: "Piano Man", artist: "Billy Joel", genres: ["classic"] },
      { title: "PENITH", artist: "Lil Dicky", genres: ["hip-hop"] },
      { title: "Ultimate Sinatra", artist: "Frank Sinatra", genres: ["classic"] },
      { title: "What's Going On", artist: "Marvin Gaye", genres: ["classic", "r&b"] },
      
      // Country Albums
      { title: "F-1 Trillion", artist: "Post Malone", genres: ["country"] }
    ];

    const albums: InsertAlbum[] = [];
    
    for (const albumData of albumsData) {
      // For now, assign primary genre (first in array), will be enhanced with Spotify data
      const primaryGenre = albumData.genres[0] || "other";
      
      // Check if this is a favorite album based on Harrison's specified favorites
      const favoriteAlbums = [
        "Bad Cameo", "Care Package", "Honestly, Nevermind", "Her Loss", "IGOR",
        "If You're Reading This It's Too Late", "Let's Start Here", "Nothing Was the Same", 
        "Onepointfive", "Professional Rapper", "Piano Man", "Pet Sounds",
        "Revenge of the Dreamers III", "Renaissance", "The Stranger", "The Forever Story",
        "The Eminem Show", "The Blueprint", "The Blueprint 3", "Turnstiles",
        "The Velvet Underground & Nico", "Take Care", "Ultimate Sinatra", "What's Going On"
      ];
      // Match favorite albums with flexible title matching
      const isFavorite = favoriteAlbums.some(fav => {
        const normalizedFav = fav.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        const normalizedTitle = albumData.title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        return normalizedFav === normalizedTitle || 
               normalizedTitle.includes(normalizedFav) || 
               normalizedFav.includes(normalizedTitle);
      });
      
      albums.push({
        title: albumData.title,
        artist: albumData.artist,
        genre: primaryGenre,
        genres: albumData.genres, // Store all genres
        isFavorite,
        imageUrl: null // Will be filled by Spotify API
      });
    }
    
    console.log(`Loaded ${albums.length} albums from Harrison's collection`);
    return albums;
  }

  private loadMoviesFromCSVSync(): InsertMovie[] {
    try {
      const csvContent = fs.readFileSync('./attached_assets/ratings_1753828374936.csv', 'utf-8');
      const lines = csvContent.split('\n').slice(1); // Skip header
      const movies: InsertMovie[] = [];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const [date, name, year, letterboxdUrl, rating, , review] = this.parseCSVLine(line);
        
        if (!name || !year || !rating) continue;
        
        const ratingNum = parseFloat(rating);
        const yearNum = parseInt(year, 10);
        
        // Parse watch date for categorization  
        const watchDate = new Date(date);
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
        
        // Categorize based on specific criteria
        let category = 'other';
        
        if (ratingNum === 5) {
          category = 'favorites';
        } else if (ratingNum <= 1.5) {
          category = 'least-favorite';
        } else if (watchDate && !isNaN(watchDate.getTime()) && watchDate >= sixMonthsAgo) {
          category = 'recently-watched';
        } else if (yearNum >= twelveMonthsAgo.getFullYear()) { // Recently released (last 12 months)
          category = 'recently-released';
        } else {
          category = 'other';
        }
        
        movies.push({
          title: name,
          year: yearNum,
          rating: ratingNum,
          category,
          letterboxdUrl: letterboxdUrl || null,
          imageUrl: null, // Will be filled by async poster fetching
          review: review || null,
          watchedDate: watchDate
        });
      }
      
      console.log(`Loaded ${movies.length} movies from CSV`);
      return movies;
    } catch (error) {
      console.error('Error loading movies from CSV:', error);
      return [];
    }
  }

  private async loadPostersAsync(): Promise<void> {
    try {
      console.log('Starting async poster fetching...');
      const allMovies = Array.from(this.movies.values());
      
      // Process in batches to avoid overwhelming TMDB API
      const batchSize = 10;
      let processedCount = 0;
      
      for (let i = 0; i < allMovies.length; i += batchSize) {
        const batch = allMovies.slice(i, i + batchSize);
        const batchPromises = batch.map(async (movie) => {
          if (!movie.imageUrl) {
            const imageUrl = await searchMovieOnTMDB(movie.title, movie.year);
            if (imageUrl) {
              movie.imageUrl = imageUrl;
              console.log(`Found poster for: ${movie.title} -> ${imageUrl}`);
            } else {
              console.log(`No TMDB results for: ${movie.title} (${movie.year})`);
            }
          }
        });
        
        await Promise.all(batchPromises);
        processedCount += batch.length;
        console.log(`Processed batch ${Math.ceil((i + batchSize) / batchSize)}/${Math.ceil(allMovies.length / batchSize)}`);
      }
      
      const postersFound = allMovies.filter(m => m.imageUrl).length;
      console.log(`Poster fetching complete. Found ${postersFound} posters out of ${allMovies.length} movies.`);
    } catch (error) {
      console.error('Error during async poster fetching:', error);
    }
  }

  private async loadSpotifyDataAsync(): Promise<void> {
    try {
      console.log('Starting async Spotify data fetching with improved search...');
      const allAlbums = Array.from(this.albums.values());
      
      // Apply manual covers for albums that have them
      allAlbums.forEach(album => {
        const manualCoverUrl = getManualCoverUrl(album.title, album.artist);
        if (manualCoverUrl) {
          album.imageUrl = manualCoverUrl;
        } else if (!album.imageUrl) {
          album.imageUrl = null; // Reset for Spotify processing
        }
      });
      
      const batchSize = 3; // Smaller batch to respect API limits and allow multiple search attempts
      let processedCount = 0;
      
      for (let i = 0; i < allAlbums.length; i += batchSize) {
        const batch = allAlbums.slice(i, i + batchSize);
        const batchPromises = batch.map(async (album) => {
          if (!album.imageUrl) {
            const originalTitle = album.title; // Preserve original title
            const originalArtist = album.artist; // Preserve original artist
            const spotifyData = await spotifyAPI.searchAlbum(album.title, album.artist);
            if (spotifyData && spotifyData.imageUrl) {
              album.imageUrl = spotifyData.imageUrl;
              
              // Don't update artist names for multi-artist collaborations (those with & or "feat.")
              const isCollaboration = originalArtist.includes('&') || originalArtist.toLowerCase().includes('feat');
              
              // Don't update certain album titles that should be preserved exactly
              const shouldPreserveTitle = preserveList.has(originalTitle);
              
              // Update with correct Spotify metadata if available, but preserve specific titles and collaboration artists
              if (!shouldPreserveTitle && spotifyData.title !== album.title) {
                console.log(`Updated "${album.title}" to "${spotifyData.title}"`);
                album.title = spotifyData.title;
              } else if (shouldPreserveTitle) {
                // Keep the original title for preserved albums
                album.title = originalTitle;
              }
              
              if (!isCollaboration && spotifyData.artist !== album.artist) {
                console.log(`Updated "${album.artist}" to "${spotifyData.artist}"`);
                album.artist = spotifyData.artist;
              } else if (isCollaboration) {
                // Keep the original artist for collaborations
                album.artist = originalArtist;
              }
              
              console.log(`Found Spotify cover for: ${album.title} by ${album.artist}`);
            } else {
              console.log(`No Spotify results for: ${album.title} by ${album.artist}`);
            }
          }
        });
        
        await Promise.all(batchPromises);
        processedCount += batch.length;
        console.log(`Processed Spotify batch ${Math.ceil((i + batchSize) / batchSize)}/${Math.ceil(allAlbums.length / batchSize)}`);
        
        // Longer delay to respect API rate limits with multiple search strategies
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const coversFound = allAlbums.filter(a => a.imageUrl).length;
      const missingCovers = allAlbums.filter(a => !a.imageUrl);
      console.log(`Spotify fetching complete. Found ${coversFound} covers out of ${allAlbums.length} albums.`);
      
      if (missingCovers.length > 0) {
        console.log('Albums missing covers:');
        missingCovers.forEach(album => {
          console.log(`- "${album.title}" by ${album.artist}`);
        });
      }
    } catch (error) {
      console.error('Error fetching Spotify data:', error);
    }
  }

  constructor() {
    this.albums = new Map();
    this.movies = new Map();
    this.entertainmentItems = new Map();
    this.contactSubmissions = new Map();
    this.recommendations = new Map();
    this.seedData();
  }

  private seedData() {
    // Seed albums from Harrison's actual collection (all 90+ albums from harrisonlieber.com/music)
    const albumsData: InsertAlbum[] = [
      // Identified albums
      { title: "GNX", artist: "Kendrick Lamar", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/91b9a545-d92b-425a-bc07-8f54d9a44d5b/gnx.jpg" },
      { title: "Case Study 01", artist: "Daniel Caesar", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/ccbe3268-f0bf-4a4a-81ea-16e6bfbf2534/Case+Study+01.jpg" },
      { title: "Justified", artist: "Justin Timberlake", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/7f26626b-9497-46ac-821e-c4998da5d3f7/Justified.jpg" },
      { title: "Abbey Road", artist: "The Beatles", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/4f50ca2a-aae0-47c5-83d5-b2a094813f71/Abbey+Road.jpg" },
      { title: "Hunky Dory", artist: "David Bowie", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/4dea9f37-7c79-48dd-bff4-2ea1e3bd6979/Hunky+Dory.jpg" },
      { title: "Pet Sounds", artist: "The Beach Boys", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/cea623a1-856b-4fa7-8b9f-29f7530b8b03/Pet+Sounds.jpg" },
      { title: "52nd Street", artist: "Billy Joel", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/77f4ae24-0212-4735-963b-fdd99fabef8d/52nd+Street.jpg" },
      
      // Popular albums from Harrison's collection (cross-referenced with internet identification)
      { title: "Good Kid, M.A.A.D City", artist: "Kendrick Lamar", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/a7295efd-d7b0-4697-b8e6-410d37b937e8/alb4.jpg" },
      { title: "Blonde", artist: "Frank Ocean", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/0f0216da-8f37-4a9b-a647-9311d4dfbe1a/alb2.jfif" },
      { title: "In Rainbows", artist: "Radiohead", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/2cf8bde0-e956-4d94-9ec0-7da69f65ccbf/alb5.jpg" },
      { title: "To Pimp a Butterfly", artist: "Kendrick Lamar", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c2eebe1a-fdce-4e8b-9d12-cc8489321972/alb3.jfif" },
      { title: "1989", artist: "Taylor Swift", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/27d4c56e-1f2b-4b54-8759-e1f727087d3f/alb1.png" },
      { title: "Kind of Blue", artist: "Miles Davis", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/304b5b2b-ad04-403d-9f32-8f83158eaeef/alb6.jfif" },
      { title: "Dark Side of the Moon", artist: "Pink Floyd", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/47d3b88c-a7e2-4a05-9122-6df9ed24503c/alb7.jfif" },
      { title: "Anti", artist: "Rihanna", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/448a9770-41dc-4699-8a83-da99b44dce5c/alb8.jpg" },
      { title: "The College Dropout", artist: "Kanye West", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/d7282249-541b-4fc7-b7ff-ff9ab1cb62aa/alb34.jfif" },
      { title: "OK Computer", artist: "Radiohead", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/afef737d-cf40-43c3-adb4-4242a64c7eb8/alb9.jfif" },
      { title: "A Love Supreme", artist: "John Coltrane", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c8fa5a9b-b3e6-44cd-a274-dcee3ae30f15/alb21.jfif" },
      { title: "Lemonade", artist: "Beyoncé", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/2e2c783c-f92f-4c29-b1a9-8757c1b84079/alb20.jfif" },
      { title: "Led Zeppelin IV", artist: "Led Zeppelin", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/23671d2c-5468-41d5-8cee-0a92f5f1ecdd/alb19.jfif" },
      { title: "Illmatic", artist: "Nas", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/eca94d44-0499-464f-8fb1-daad02b8934b/alb10.jfif" },
      { title: "Channel Orange", artist: "Frank Ocean", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c2d89867-d48e-49d7-a31a-1dc9bfabadf3/alb18.jfif" },
      { title: "Blue", artist: "Joni Mitchell", genre: "folk", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/19ffac59-ea5d-482e-84c7-921b9f1d01bd/alb17.jfif" },
      { title: "Nevermind", artist: "Nirvana", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/531ff1f5-c48d-4494-b45d-40f5c40c1e13/alb16.jfif" },
      { title: "Thriller", artist: "Michael Jackson", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/5b4a1f2a-8039-4746-879c-e41166535d79/alb15.jfif" },
      { title: "The Chronic", artist: "Dr. Dre", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/4f4da400-ea9d-424d-97c8-ea0bcc5ab709/alb14.jfif" },
      { title: "Songs in the Key of Life", artist: "Stevie Wonder", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/1ddfdfb0-6f6a-4cb6-8c91-97aebf43d6d5/alb13.jfif" },
      { title: "Album Collection 21", artist: "Various Artists", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/29e20262-dd0c-4fa1-a5c5-23a46ba0a5a3/alb12.jfif" },
      { title: "Album Collection 22", artist: "Various Artists", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/0339a119-a8c1-4d7c-ab1c-35cb0aee04ab/alb11.jfif" },
      { title: "Album Collection 23", artist: "Various Artists", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/204d8ef7-363f-4684-85e5-b95a861870af/alb32.jfif" },
      { title: "Album Collection 24", artist: "Various Artists", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/f0563d60-6a26-46e1-9b6f-e64851b629f4/alb31.jfif" },
      { title: "Album Collection 25", artist: "Various Artists", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/2a28e178-d8a8-41e4-a80e-ad45a1ff9ddd/alb30.jfif" },
      { title: "Album Collection 26", artist: "Various Artists", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/8c571e21-d895-407b-8423-bef388504f89/alb29.jfif" },
      { title: "Album Collection 27", artist: "Various Artists", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/9f2162b8-c6bb-4885-ad19-7c538a4e88dc/alb28.jfif" },
      { title: "Album Collection 28", artist: "Various Artists", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/f3bc9551-b889-429f-b7bd-854b4454f6b7/alb27.jfif" },
      { title: "Album Collection 29", artist: "Various Artists", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c547769d-5e4f-4908-81f0-5817d8be9ff7/alb26.jfif" },
      { title: "Album Collection 30", artist: "Various Artists", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/70b5526c-b173-485d-9b18-db4e87a61b51/alb25.jfif" },
      // Continue with all other albums from the site...
      { title: "Album Collection 31", artist: "Various Artists", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/d59a2746-0d8a-4940-aee7-1ffe4436ef96/alb24.jfif" },
      { title: "Album Collection 32", artist: "Various Artists", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/a3ebc869-bf58-4761-b7cb-8432ae7d6ea1/alb23.jfif" },
      { title: "Album Collection 33", artist: "Various Artists", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/d9ffbeec-8dc3-46a7-97d2-1100d4fcbc85/alb22.jfif" },
      { title: "Album Collection 34", artist: "Various Artists", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/b0469246-a1c8-4aa6-96d7-6ae149bf8374/alb39.jfif" },
      { title: "Album Collection 35", artist: "Various Artists", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/af1ca11c-dbf0-42c7-871f-af1990be3ae8/alb38.jfif" },
      { title: "Album Collection 36", artist: "Various Artists", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/71cb6b43-2401-4850-aef3-a0d096292e9c/alb37.jfif" },
      { title: "Album Collection 37", artist: "Various Artists", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/233cc399-4506-4838-81fe-c1363655da07/alb36.jfif" },
      { title: "Album Collection 38", artist: "Various Artists", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/44fcf564-cb9f-4b73-8350-c4ff106a50da/alb35.jfif" },
      { title: "Album Collection 39", artist: "Various Artists", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/1b0294dc-d82d-4baa-a47b-448c3c48f461/alb33.jfif" },
      { title: "Album Collection 40", artist: "Various Artists", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/dcfebabc-0f9f-47dc-a75c-6b06ccaeb182/alb45.jfif" },
      // Adding more albums to reach the full collection
      { title: "Album Collection 41", artist: "Various Artists", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/65fa51bb-a464-416b-805f-e5fb4810673c/alb44.jfif" },
      { title: "Album Collection 42", artist: "Various Artists", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/66b0c70a-e671-4b07-b010-509baf60bf90/alb43.jfif" },
      { title: "Album Collection 43", artist: "Various Artists", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/74bc9a96-f80a-430b-92aa-bd805ba6036a/alb42.jfif" },
      { title: "Album Collection 44", artist: "Various Artists", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/4ea71959-f892-47c3-bfc8-5688700018a6/alb41.jfif" },
      { title: "Album Collection 45", artist: "Various Artists", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c853f288-4a11-4326-87eb-c7017503d515/alb40.jfif" },
      { title: "Album Collection 46", artist: "Various Artists", genre: "jazz", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/9466bd88-c232-467f-a452-5464e49c6991/alb51.jfif" },
      { title: "Album Collection 47", artist: "Various Artists", genre: "rock", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/fde30b35-83ed-4017-94e9-503e42d03404/alb50.jfif" },
      { title: "Album Collection 48", artist: "Various Artists", genre: "pop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/54155de9-93b8-4767-a4a4-ce3d95ce4fbe/alb49.jfif" },
      { title: "Album Collection 49", artist: "Various Artists", genre: "hip-hop", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/82720de7-04f4-4bcf-af12-2cbbdfe21721/alb48.jfif" },
      { title: "Album Collection 50", artist: "Various Artists", genre: "r&b", imageUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/1ab9b3a9-68da-4a4c-981d-93d6317c2de5/alb47.jfif" },
    ];

    // Load albums from Harrison's updated collection
    const harrisonsAlbums: InsertAlbum[] = this.loadAlbumsFromList();
    harrisonsAlbums.forEach(album => this.createAlbum(album));
    
    // Fetch Spotify data asynchronously
    this.loadSpotifyDataAsync();

    // Load all 591 movies from Harrison's Letterboxd CSV data
    const moviesData: InsertMovie[] = this.loadMoviesFromCSVSync();
    moviesData.forEach(movie => this.createMovie(movie));
    
    // Load recently watched movies from diary
    this.loadRecentlyWatchedFromDiary();
    
    // Fetch posters asynchronously after initial load
    this.loadPostersAsync();

    // Seed entertainment items from Harrison's actual collection (all 100+ items from harrisonlieber.com/entertainment)
    const entertainmentData: InsertEntertainmentItem[] = [
      // Movies
      { title: "Everything Everywhere All at Once", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/02288468-455c-48d1-9bf9-93ec43cf072a/A24_EverythingEverywhereAllAtOnce_Printable_300-1.png", mediaType: "image" },
      { title: "500 Days of Summer", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/3f87aac9-0c06-43b5-a472-204d5ed81162/500days.PNG", mediaType: "image" },
      { title: "The Departed", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/cd813c57-19e5-4f10-ad1d-1fc5c8187512/departed.jpg", mediaType: "image" },
      { title: "Citizen Kane", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/128f4ddf-c4d0-4a42-9668-95b51a17a6b4/citizenkane.jpg", mediaType: "image" },
      { title: "Almost Famous", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/8ae5ae60-9f90-49e3-aa7b-e2f5d50beac2/almostfamous.jpg", mediaType: "image" },
      { title: "Dune", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/befcf97e-cabf-4945-950f-32c6a3319087/dune1.PNG", mediaType: "image" },
      { title: "Inception", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/afc1a07a-ec98-4fdb-9f2c-ea23c782d77a/inception.jfif", mediaType: "image" },
      { title: "Good Will Hunting", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/bf60c2ef-b564-4caf-a626-6be5eadc0e9c/goodwill.PNG", mediaType: "image" },
      { title: "Whiplash", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/b33f8693-12c7-48cc-b09a-a957f8000fc4/whiplash.PNG", mediaType: "image" },
      { title: "Little Women", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/0967c057-c0ea-4cdc-ab23-56d14a6fc300/littlewomen.jpg", mediaType: "image" },
      { title: "Les Misérables", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/69581476-b025-4f4d-852c-2c6d2552a132/lesmis.jpg", mediaType: "image" },
      { title: "Les Misérables 2", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/3d7a6953-3cde-4cf1-ad63-bf53263fc7c5/lemis2.jpg", mediaType: "image" },
      { title: "Interstellar", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c5ef68e0-cfbc-4210-87e5-9e7603bce2f9/interstellar2.jpg", mediaType: "image" },
      { title: "Good Will Hunting 2", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/1ae15dc2-b853-4da3-8a3d-8e79a8394321/goodwill2.jpg", mediaType: "image" },
      { title: "The Dark Knight Rises", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/d1aa6bf8-8637-4672-a54a-bd7ae133ddd7/rises.jpg", mediaType: "image" },
      { title: "The Prestige", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/1ccfce04-498f-46d3-bb91-009b13dc5e7e/presteige.PNG", mediaType: "image" },
      { title: "Shutter Island", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/a664665b-ef9f-452a-9af6-e23047ca5740/shutterilsnad2.PNG", mediaType: "image" },
      { title: "Catch Me If You Can", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/16177267-82c8-49b1-b8ae-b5cd1ea51878/catchme2.png", mediaType: "image" },
      { title: "Harry Potter", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/3772cdfe-ca4b-48a3-b3da-e391683749ac/harrypotter2.jpg", mediaType: "image" },
      { title: "Avatar", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/6d572162-7e0c-40d5-860d-14a0726057a1/avatar.jpg", mediaType: "image" },
      { title: "The Princess Bride", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/b9955529-9ee2-4567-bf2d-e9eea7f41e7e/princess-bride-romantic-scene-4krxeyfvee7sy8qd.jpg", mediaType: "image" },
      { title: "42", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/bfbda8e1-524c-43ea-b462-302b67f1c5bf/42.jpg", mediaType: "image" },
      { title: "Silver Linings Playbook", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c96e35a3-f78b-4bbf-9290-342ce06c89ab/silverlinings.jpg", mediaType: "image" },
      { title: "A Quiet Place", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/093e0145-1bfb-49de-b47d-e3a53046d18f/coupez.jpg", mediaType: "image" },
      { title: "Ferris Bueller's Day Off", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/b4ad64b4-cc1c-49c0-8e3e-a192ec4ba2b9/ferris.jpg", mediaType: "image" },
      { title: "Chef", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/a00d8504-0606-4bc7-a0e3-e2709fbf912c/chef.jpg", mediaType: "image" },
      { title: "The Shawshank Redemption", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/ca3f686b-2a24-4cb8-88c0-b72946e585dc/shawshank.jpg", mediaType: "image" },
      { title: "Big Hero 6", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/ba7191e8-a37e-4ccf-8975-477f127f8239/bighero.jpg", mediaType: "image" },
      { title: "No Country for Old Men", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/f873c47b-cc12-427f-99dd-54c2076e5c2c/nocountry.jpg", mediaType: "image" },
      { title: "Anomalisa", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/b277299e-16a9-4027-b2d5-9be96d84c1cf/anamalisa.jpg", mediaType: "image" },
      { title: "Star Wars", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/7860088f-4ca1-424d-bfc0-cb0db2f71303/star+wars.png", mediaType: "image" },
      { title: "Wicked", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/219a56cf-d753-4d02-b94a-cf9a43629232/wicked.jpg", mediaType: "image" },
      { title: "Adaptation", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/0a0fb77f-6b03-4a20-8fb7-1a74cf086649/adaptation.jpg", mediaType: "image" },
      { title: "The Tree of Life", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/9dad1db3-d6ea-4e96-91ee-b54418432273/TreeofLife2.jpg", mediaType: "image" },
      
      // GIFs and animated content
      { title: "Ryan Gosling", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/966c013a-bf75-48b8-8f46-3fb57c84b8ab/ryang2.gif", mediaType: "gif" },
      { title: "The Social Network", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/d5936181-3779-44ee-8631-a86de0245206/socialnetwrok.gif", mediaType: "gif" },
      { title: "Spinning Top", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/2205746b-73e2-41ad-8dc0-074a679964a5/spinning.gif", mediaType: "gif" },
      { title: "Hammer Time", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/9af7ac4f-bd33-489c-8930-4986f53a5530/hammer.gif", mediaType: "gif" },
      { title: "Dumbledore", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c5826b4e-d13d-4925-8a80-289e45174587/dumbleore.gif", mediaType: "gif" },
      { title: "The Dark Knight", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/653a76d3-84cc-4a55-87b8-f8c2f0e7de19/darkknight.gif", mediaType: "gif" },
      { title: "Spider-Man", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/13688ec1-8dd4-426a-b46d-c61ff5d48ee0/spiderman2.gif", mediaType: "gif" },
      { title: "Into the Spider-Verse", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/1a299aa8-034c-4c56-9fb6-9b02e60a78ba/intospider.gif", mediaType: "gif" },
      { title: "Dumbledore 2", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/b433e3ab-5a0f-488c-a2ad-527f9fd15b8e/dumbeldore2.gif", mediaType: "gif" },
      { title: "Princess Bride", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/6dd20a66-f679-4ef7-99cc-b7900d34d15b/431a1b2b-4ae8-4929-9139-1741dc72b229_328x244.gif", mediaType: "gif" },
      { title: "Gone Girl", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c5cfee8c-f682-4547-b15e-afd413ad4f1f/gonegirl.gif", mediaType: "gif" },
      { title: "Pitch Meetings", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/6a9d54be-b8c2-49e5-b202-19fb978eedb0/pitchmeetings.gif", mediaType: "gif" },
      { title: "Tobey Maguire", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/f22483a9-7ae7-4fbd-a262-1d4eede76b92/tobey.gif", mediaType: "gif" },
      { title: "The Office", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/85e03570-a794-4359-901f-4ff008d15de1/scott.gif", mediaType: "gif" },
      { title: "Magnolia", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/6ec9075b-49f3-4e97-ae63-46edb4eb676d/magnolia.gif", mediaType: "gif" },
      { title: "Why Him", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/8001f246-158d-461e-9d55-14c2792ca27f/why+him.gif", mediaType: "gif" },
      
      // More images and personal content
      { title: "Dave Burd", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/6cecafc3-e26a-4c3a-bb1c-2e221069e21f/daveburd.PNG", mediaType: "image" },
      { title: "Tyler1", category: "gaming", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/376b37e7-4b2e-48fc-9e1a-8b00b77f28bd/tyler1.jpg", mediaType: "image" },
      { title: "Daisies", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/ad90d313-b724-4e7c-92e8-5c422a72ff8c/diasies.PNG", mediaType: "image" },
      { title: "Michael Jordan", category: "sports", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/5a895219-d2d6-435e-9b44-d6cf621c80ca/mj1.jpg", mediaType: "image" },
      { title: "Cole & Norm", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/ef160874-d835-4870-a52c-62d20fb259dd/colenard.jpg", mediaType: "image" },
      { title: "CS Dino", category: "memes", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/48d174a0-2568-4ad7-afc1-f9601115ab42/csdino.jpg", mediaType: "image" },
      { title: "Norm", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/d899d0e2-af4b-4862-9ac6-ae3a86f925c8/norm.jpg", mediaType: "image" },
      { title: "Larry David", category: "comedy", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/f0398795-0024-4173-9952-d55ff8a9e391/ld.jfif", mediaType: "image" },
      { title: "Chadwick & MBJ", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c4f08bef-aee5-4a63-af6a-622a32e9ebd7/chadwickandmbj.PNG", mediaType: "image" },
      { title: "Another Day", category: "memes", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/1710255542260-MH01PZF3JZ0TMKE57WED/anotherday.jpg", mediaType: "image" },
      { title: "Tony Stark", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c1561d9c-afde-4408-a749-439bdee910d1/stark.png", mediaType: "image" },
      { title: "Harry Mack", category: "music", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c8fe3e3f-cd6d-4704-abb3-eade6f65dc39/harrymack.jpg", mediaType: "image" },
      { title: "EEAAO Hug", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/57c71009-cb7f-460d-940e-14d1db820cb8/eeaaohug.jfif", mediaType: "image" },
      { title: "Laundry and Taxes", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/423a4ba2-5041-4837-8384-83dfe5ded18b/laundryandtaxes.jpg", mediaType: "image" },
      { title: "Core Memories", category: "memes", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/33032a18-e6c7-4406-8364-cb9191a06f3e/core.png", mediaType: "image" },
      { title: "Eminem", category: "music", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/e70fc5db-7750-48a8-8cfe-fff8d8ff7c15/eminem.jpg", mediaType: "image" },
      { title: "Drake and Cole", category: "music", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/0ac8e9fe-057a-483e-898f-3e13f39410ca/drakeandcole.PNG", mediaType: "image" },
      { title: "The Last Wish", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/c1a22b68-ee8a-47e0-a265-662e47e14bc2/lastwish.jpg", mediaType: "image" },
      { title: "Travis Kelce", category: "sports", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/294983eb-7658-49f6-a7e2-e5c4e77e0daf/kelce.jpg", mediaType: "image" },
      { title: "Good Times", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/16eefc40-ddca-4bc7-aa27-5be8651c9f7e/goodtime3.jpg", mediaType: "image" },
      { title: "Wisdom", category: "memes", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/aee4f7f5-c91f-4c49-8de2-9bf16ff16857/1_yUjZb7CEvM2Tz1Qa7FCYNQ.jpg", mediaType: "image" },
      
      // Personal GIFs and videos
      { title: "Personal Video 1", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/20d80a45-ae91-4f10-bc12-111d86f3a4bf/IMG_8765.GIF", mediaType: "gif" },
      { title: "Personal Video 2", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/4df85c2f-d4c2-452b-8d54-384fadf1b5cb/IMG_8763.GIF", mediaType: "gif" },
      { title: "Personal Video 3", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/0cc79b7c-de3a-4145-b2cd-90c7cd069ccc/IMG_8772.GIF", mediaType: "gif" },
      { title: "Personal Video 4", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/06527636-e90d-448e-9ebb-9a7fa7f8cc36/IMG_8773.GIF", mediaType: "gif" },
      { title: "Personal Video 5", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/3aed42f9-1051-44f0-b7e0-e5381035c7e9/IMG_8762.GIF", mediaType: "gif" },
      
      // Personal photos
      { title: "Personal Photo 1", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/2bd07b38-eaa7-408e-87fa-e26e0aa34cca/IMG_8760.JPG", mediaType: "image" },
      { title: "Personal Photo 2", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/fcc05df2-4d4a-48b5-abb3-240c7d981ae7/IMG_8775.JPG", mediaType: "image" },
      { title: "Personal Photo 3", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/6f524d04-0fa8-4fdf-a316-b1bb8454244f/IMG_8757.JPG", mediaType: "image" },
      { title: "Personal Photo 4", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/9947cb65-3e34-4b3b-99f7-86b433de03e6/IMG_8768.JPG", mediaType: "image" },
      { title: "Personal Photo 5", category: "personal", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/5299718f-90ca-4007-891a-0aed179c87ca/IMG_8758.JPG", mediaType: "image" },
      
      // More movie content
      { title: "Hereditary", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/0c6a0c36-c535-4edb-bde0-295f7ab50dfc/5d2ceb27899dac6f718442f11c0ae615.jpg", mediaType: "image" },
      { title: "Come Play", category: "movies", mediaUrl: "https://images.squarespace-cdn.com/content/v1/61d51c48984ca52bce2af721/63f5aee0-51ed-4d78-b8a0-4d7823627b23/MV5BYTljZGExYjgtNGVjYi00OWE2LTg3ZTctZjAxYmE0MmMxMmQwXkEyXkFqcGc%40._V1_.jpg", mediaType: "image" },
    ];

    entertainmentData.forEach(item => this.createEntertainmentItem(item));
  }

  async getAlbums(): Promise<Album[]> {
    return Array.from(this.albums.values());
  }

  async getAlbumsByGenre(genre: string): Promise<Album[]> {
    if (genre === "favorites") {
      return Array.from(this.albums.values()).filter(album => album.isFavorite);
    }
    
    return Array.from(this.albums.values()).filter(album => {
      // Check if album matches primary genre or any of its multiple genres
      return album.genre === genre || (album.genres && album.genres.includes(genre));
    });
  }

  async createAlbum(insertAlbum: InsertAlbum): Promise<Album> {
    const id = randomUUID();
    const album: Album = { 
      ...insertAlbum, 
      genres: insertAlbum.genres || null,
      isFavorite: insertAlbum.isFavorite || null,
      imageUrl: insertAlbum.imageUrl || null,
      id, 
      createdAt: new Date() 
    };
    this.albums.set(id, album);
    return album;
  }

  async getMovies(): Promise<Movie[]> {
    return Array.from(this.movies.values());
  }

  async getMoviesByCategory(category: string): Promise<Movie[]> {
    const filteredMovies = Array.from(this.movies.values()).filter(movie => 
      movie.category === category
    );

    // Apply category-specific sorting
    switch (category) {
      case 'recently-watched':
        // Sort by most recent watched date
        return filteredMovies.sort((a, b) => {
          const dateA = new Date(a.watchedDate || 0);
          const dateB = new Date(b.watchedDate || 0);
          return dateB.getTime() - dateA.getTime();
        });
      
      case 'recently-released':
        // Sort by most recent release year
        return filteredMovies.sort((a, b) => (b.year || 0) - (a.year || 0));
      
      case 'least-favorite':
        // Sort by lowest stars to highest stars
        return filteredMovies.sort((a, b) => (a.rating || 0) - (b.rating || 0));
      
      case 'favorites':
        // Sort favorites by rating (highest first), then alphabetically by title
        return filteredMovies.sort((a, b) => {
          const ratingDiff = (b.rating || 0) - (a.rating || 0);
          if (ratingDiff !== 0) return ratingDiff;
          return a.title.localeCompare(b.title);
        });
      
      default:
        // Default: sort alphabetically by title
        return filteredMovies.sort((a, b) => a.title.localeCompare(b.title));
    }
  }

  async getRecentlyWatchedMovies(): Promise<Movie[]> {
    // ONLY use diary CSV for recently watched - ignore ratings CSV dates
    const diaryMovies = this.loadRecentlyWatchedFromDiary();
    return diaryMovies.slice(0, 20); // Limit to 20 most recent
  }

  async getRecentlyReleasedMovies(): Promise<Movie[]> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const currentYear = new Date().getFullYear();
    
    return Array.from(this.movies.values())
      .filter(movie => movie.year && movie.year >= currentYear - 1) // Released in last 1-2 years
      .filter(movie => movie.watchedDate && movie.watchedDate >= sixMonthsAgo) // But watched in last 6 months
      .sort((a, b) => (b.watchedDate?.getTime() || 0) - (a.watchedDate?.getTime() || 0))
      .slice(0, 20);
  }

  async createMovie(insertMovie: InsertMovie): Promise<Movie> {
    const id = randomUUID();
    const movie: Movie = { 
      ...insertMovie, 
      imageUrl: insertMovie.imageUrl || null,
      year: insertMovie.year || null,
      rating: insertMovie.rating || null,
      letterboxdUrl: insertMovie.letterboxdUrl || null,
      review: insertMovie.review || null,
      watchedDate: insertMovie.watchedDate || null,
      id, 
      createdAt: new Date() 
    };
    this.movies.set(id, movie);
    return movie;
  }

  async getEntertainmentItems(): Promise<EntertainmentItem[]> {
    return Array.from(this.entertainmentItems.values());
  }

  async getEntertainmentItemsByCategory(category: string): Promise<EntertainmentItem[]> {
    return Array.from(this.entertainmentItems.values()).filter(item => item.category === category);
  }

  async createEntertainmentItem(insertItem: InsertEntertainmentItem): Promise<EntertainmentItem> {
    const id = randomUUID();
    const item: EntertainmentItem = { 
      ...insertItem, 
      title: insertItem.title || null,
      id, 
      createdAt: new Date() 
    };
    this.entertainmentItems.set(id, item);
    return item;
  }

  async createContactSubmission(insertSubmission: InsertContactSubmission): Promise<ContactSubmission> {
    const id = randomUUID();
    const submission: ContactSubmission = { 
      ...insertSubmission, 
      message: insertSubmission.message || null,
      id, 
      createdAt: new Date() 
    };
    this.contactSubmissions.set(id, submission);
    return submission;
  }

  async getContactSubmissions(): Promise<ContactSubmission[]> {
    return Array.from(this.contactSubmissions.values());
  }

  async createRecommendation(insertRecommendation: InsertRecommendation): Promise<Recommendation> {
    const id = randomUUID();
    const recommendation: Recommendation = { 
      ...insertRecommendation, 
      description: insertRecommendation.description || null,
      submitterName: insertRecommendation.submitterName || null,
      submitterEmail: insertRecommendation.submitterEmail || null,
      id, 
      createdAt: new Date() 
    };
    this.recommendations.set(id, recommendation);
    return recommendation;
  }

  async getRecommendations(): Promise<Recommendation[]> {
    return Array.from(this.recommendations.values());
  }
}

export const storage = new MemStorage();
