import type { InsertAlbum } from "@shared/schema";
import { getManualCoverUrl, hasManualCover, preserveList } from "./manualCovers";

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SpotifyAlbumSearchResponse {
  albums: {
    items: Array<{
      id: string;
      name: string;
      artists: Array<{ name: string }>;
      images: Array<{ url: string; height: number; width: number }>;
      genres: string[];
      release_date: string;
    }>;
  };
}

class SpotifyAPI {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Spotify credentials not found');
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      throw new Error('Failed to get Spotify access token');
    }

    const data: SpotifyTokenResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 minute early

    return this.accessToken;
  }

  async searchAlbum(albumTitle: string, artist: string): Promise<{
    title: string;
    artist: string;
    imageUrl: string | null;
    spotifyId: string | null;
  } | null> {
    try {
      const token = await this.getAccessToken();
      
      // Try multiple search strategies for better results
      const searchStrategies = [
        // Exact match with quotes
        `album:"${albumTitle}" artist:"${artist}"`,
        // Without quotes
        `${albumTitle} ${artist}`,
        // Just album title for difficult cases
        `"${albumTitle}"`,
        // Album title with partial artist name
        `${albumTitle} ${artist.split(' ')[0]}`
      ];
      
      for (const queryStrategy of searchStrategies) {
        const query = encodeURIComponent(queryStrategy);
        
        const response = await fetch(
          `https://api.spotify.com/v1/search?q=${query}&type=album&limit=5`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (!response.ok) {
          console.error(`Spotify API error for "${albumTitle}" by ${artist}:`, response.statusText);
          continue;
        }

        const data: SpotifyAlbumSearchResponse = await response.json();
        
        if (data.albums.items.length === 0) {
          continue;
        }

        // Find the best match
        for (const album of data.albums.items) {
          const albumMatch = this.normalizeString(album.name).includes(this.normalizeString(albumTitle)) ||
                            this.normalizeString(albumTitle).includes(this.normalizeString(album.name));
          const artistMatch = album.artists.some(a => 
            this.normalizeString(a.name).includes(this.normalizeString(artist)) ||
            this.normalizeString(artist).includes(this.normalizeString(a.name))
          );
          
          if (albumMatch && (artistMatch || artist === "Unknown Artist")) {
            const imageUrl = album.images[0]?.url || null;
            
            // Special handling for specific albums to get correct versions
            if (albumTitle === "What's Going On" && artist === "Marvin Gaye") {
              // Prefer the original album over alternative versions
              if (!album.name.toLowerCase().includes("mix") && 
                  !album.name.toLowerCase().includes("deluxe") &&
                  !album.name.toLowerCase().includes("remaster")) {
                return {
                  title: album.name,
                  artist: album.artists[0]?.name || artist,
                  imageUrl,
                  spotifyId: album.id
                };
              }
            } else if (albumTitle === "Tha Carter V" && artist === "Lil Wayne") {
              // Ensure we get Carter V, not Carter VI
              if (album.name.toLowerCase().includes("carter v") && !album.name.toLowerCase().includes("carter vi")) {
                return {
                  title: album.name,
                  artist: album.artists[0]?.name || artist,
                  imageUrl,
                  spotifyId: album.id
                };
              }
            } else if (albumTitle === "The Blueprint" && artist === "Jay-Z") {
              // Get the original Blueprint, not Blueprint 2 or 3
              if (album.name.toLowerCase() === "the blueprint" || 
                  (album.name.toLowerCase().includes("blueprint") && 
                   !album.name.toLowerCase().includes("2") && 
                   !album.name.toLowerCase().includes("3"))) {
                return {
                  title: album.name,
                  artist: album.artists[0]?.name || artist,
                  imageUrl,
                  spotifyId: album.id
                };
              }
            } else if (albumTitle === "D-Day: A Gangsta Grillz Mixtape" && artist === "Dreamville") {
              // Look for the specific Dreamville D-Day Gangsta Grillz mixtape
              if (album.name.toLowerCase().includes("d-day") && 
                  (album.name.toLowerCase().includes("gangsta") || album.name.toLowerCase().includes("grillz")) &&
                  album.artists.some(a => a.name.toLowerCase().includes("dreamville") || a.name.toLowerCase().includes("j. cole"))) {
                return {
                  title: album.name,
                  artist: album.artists[0]?.name || artist,
                  imageUrl,
                  spotifyId: album.id
                };
              }
            } else {
              return {
                title: album.name,
                artist: album.artists[0]?.name || artist,
                imageUrl,
                spotifyId: album.id
              };
            }
          }
        }
      }
      
      console.log(`No suitable Spotify results for "${albumTitle}" by ${artist}`);
      return null;
    } catch (error) {
      console.error(`Error searching Spotify for "${albumTitle}" by ${artist}:`, error);
      return null;
    }
  }

  private normalizeString(str: string): string {
    return str.toLowerCase()
      .replace(/['"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export const spotifyAPI = new SpotifyAPI();