// Manual cover mappings for albums that need special handling
export const manualCoverMappings: Record<string, string> = {
  // Format: "title-by-artist": "filename.jpg"
  "jackboys-by-travis-scott": "jackboys.jpg",
  "how-do-you-sleep-at-night-by-teezo-touchdown": "how-do-you-sleep-at-night.jpg",
  "charm-by-clairo": "charm.png",
  "funk-wav-bounces-vol-1-by-calvin-harris": "funk-wav-bounces.png",
  "good-for-you-by-amine": "good-for-you.png",
  "lets-start-here-by-lil-yachty": "lets-start-here.png",
  "magna-carta-holy-grail-by-jay-z": "magna-carta-holy-grail.png",
  "kaytramine-by-kaytramine": "kaytramine.png",
};

// Function to get manual cover URL for an album
export function getManualCoverUrl(title: string, artist: string): string | null {
  const key = `${normalizeForMapping(title)}-by-${normalizeForMapping(artist)}`;
  const filename = manualCoverMappings[key];
  return filename ? `/covers/${filename}` : null;
}

// Function to check if manual cover exists
export function hasManualCover(title: string, artist: string): boolean {
  const key = `${normalizeForMapping(title)}-by-${normalizeForMapping(artist)}`;
  return key in manualCoverMappings;
}

function normalizeForMapping(str: string): string {
  return str.toLowerCase()
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks
    .replace(/[^\w\s-]/g, '') // Remove special chars except hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .trim();
}

// Albums that should be preserved from Spotify auto-corrections
export const preserveList = new Set([
  "JACKBOYS",
  "How Do You Sleep At Night?",
  "Kaytramine"
]);