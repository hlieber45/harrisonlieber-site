import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSubmissionSchema } from "@shared/schema";
import { insertRecommendationSchema } from "@shared/recommendation";

export async function registerRoutes(app: Express): Promise<Server> {
  // Albums API
  app.get("/api/albums", async (req, res) => {
    try {
      const { genre } = req.query;
      const albums = genre 
        ? await storage.getAlbumsByGenre(genre as string)
        : await storage.getAlbums();
      res.json(albums);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch albums" });
    }
  });

  // Albums by genre API
  app.get("/api/albums/genre/:genre", async (req, res) => {
    try {
      const { genre } = req.params;
      const albums = await storage.getAlbumsByGenre(genre);
      res.json(albums);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch albums by genre" });
    }
  });

  // Movies API
  app.get("/api/movies", async (req, res) => {
    try {
      const { category } = req.query;
      const movies = category 
        ? await storage.getMoviesByCategory(category as string)
        : await storage.getMovies();
      res.json(movies);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch movies" });
    }
  });

  // Recently watched movies API
  app.get("/api/movies/recently-watched", async (req, res) => {
    try {
      const movies = await storage.getRecentlyWatchedMovies();
      res.json(movies);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recently watched movies" });
    }
  });

  // Recently released movies API
  app.get("/api/movies/recently-released", async (req, res) => {
    try {
      const movies = await storage.getRecentlyReleasedMovies();
      res.json(movies);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recently released movies" });
    }
  });

  // Entertainment API
  app.get("/api/entertainment", async (req, res) => {
    try {
      const { category } = req.query;
      const items = category 
        ? await storage.getEntertainmentItemsByCategory(category as string)
        : await storage.getEntertainmentItems();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch entertainment items" });
    }
  });

  // Contact API
  app.post("/api/contact", async (req, res) => {
    try {
      const validatedData = insertContactSubmissionSchema.parse(req.body);
      const submission = await storage.createContactSubmission(validatedData);
      res.json({ message: "Message sent successfully!", id: submission.id });
    } catch (error) {
      res.status(400).json({ message: "Invalid contact form data" });
    }
  });

  // Recommendations API
  app.post("/api/recommendations", async (req, res) => {
    try {
      const validatedData = insertRecommendationSchema.parse(req.body);
      const recommendation = await storage.createRecommendation(validatedData);
      res.json({ message: "Recommendation submitted successfully!", id: recommendation.id });
    } catch (error) {
      res.status(400).json({ message: "Invalid recommendation data" });
    }
  });

  app.get("/api/recommendations", async (req, res) => {
    try {
      const recommendations = await storage.getRecommendations();
      res.json(recommendations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
