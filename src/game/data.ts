export interface Category {
  name: string;
  icon: string;
  color: string;
  words: string[];
}

export const CATEGORIES: Category[] = [
  { name: "Animals", icon: "🦁", color: "#f59e0b", words: ["LION", "TIGER", "ZEBRA", "GIRAFFE", "MONKEY", "PANDA", "KOALA", "RABBIT", "HORSE", "EAGLE", "SHARK", "WHALE", "OTTER", "CAMEL", "BEAR", "WOLF", "FOX", "MOOSE", "LLAMA", "HIPPO", "RHINO", "BADGER", "BEAVER", "PARROT"] },
  { name: "Fruits", icon: "🍓", color: "#ef4444", words: ["APPLE", "BANANA", "CHERRY", "GRAPE", "LEMON", "MANGO", "PEACH", "PEAR", "PLUM", "KIWI", "MELON", "ORANGE", "PAPAYA", "LIME", "FIG", "GUAVA", "APRICOT", "COCONUT", "DATE", "BERRY", "OLIVE", "QUINCE"] },
  { name: "Space", icon: "🚀", color: "#6366f1", words: ["PLANET", "COMET", "GALAXY", "ORBIT", "ROCKET", "MOON", "STAR", "SATURN", "MARS", "VENUS", "NEBULA", "METEOR", "COSMOS", "PULSAR", "JUPITER", "URANUS", "ECLIPSE", "ASTEROID", "SOLAR", "LUNAR", "ALIEN", "CRATER"] },
  { name: "Ocean", icon: "🐙", color: "#0ea5e9", words: ["CORAL", "WAVE", "TIDE", "SQUID", "OCTOPUS", "CRAB", "SHELL", "REEF", "DOLPHIN", "SEAL", "KELP", "LOBSTER", "SHRIMP", "PEARL", "ANCHOR", "SALT", "ISLAND", "BEACH", "SAND", "OYSTER", "CLAM", "TURTLE"] },
  { name: "Sports", icon: "⚽", color: "#22c55e", words: ["SOCCER", "TENNIS", "GOLF", "RUGBY", "HOCKEY", "BOXING", "SKIING", "ROWING", "CHESS", "KARATE", "JUDO", "POLO", "CYCLING", "DIVING", "SURFING", "ARCHERY", "FENCING", "BOWLING", "CRICKET", "RACING", "SKATING"] },
  { name: "Countries", icon: "🌍", color: "#14b8a6", words: ["FRANCE", "JAPAN", "CHINA", "BRAZIL", "CANADA", "EGYPT", "INDIA", "ITALY", "SPAIN", "PERU", "CHILE", "KENYA", "NEPAL", "MEXICO", "GREECE", "NORWAY", "SWEDEN", "POLAND", "TURKEY", "GHANA", "CUBA", "IRELAND"] },
  { name: "Colors", icon: "🎨", color: "#ec4899", words: ["RED", "BLUE", "GREEN", "YELLOW", "PURPLE", "ORANGE", "PINK", "BROWN", "BLACK", "WHITE", "GRAY", "CYAN", "MAGENTA", "INDIGO", "VIOLET", "TEAL", "BEIGE", "MAROON", "CORAL", "AMBER", "IVORY", "OLIVE"] },
  { name: "Music", icon: "🎸", color: "#a855f7", words: ["GUITAR", "PIANO", "DRUMS", "VIOLIN", "FLUTE", "CELLO", "HARP", "TRUMPET", "BANJO", "TUBA", "OBOE", "RHYTHM", "MELODY", "CHORD", "TEMPO", "SONG", "OPERA", "BASS", "LYRICS", "CHOIR", "BAND", "NOTE"] },
  { name: "Food", icon: "🍕", color: "#f97316", words: ["PIZZA", "PASTA", "BURGER", "SALAD", "BREAD", "CHEESE", "TACO", "SUSHI", "SOUP", "RICE", "NOODLE", "STEAK", "WAFFLE", "PANCAKE", "COOKIE", "DONUT", "HONEY", "BUTTER", "OMELET", "CURRY", "BAGEL", "MUFFIN"] },
  { name: "Weather", icon: "⛅", color: "#38bdf8", words: ["RAIN", "SNOW", "STORM", "CLOUD", "SUNNY", "WIND", "FOG", "HAIL", "THUNDER", "FROST", "BREEZE", "SLEET", "TORNADO", "RAINBOW", "HUMID", "MIST", "DRIZZLE", "BLIZZARD", "CLIMATE", "COLD", "WARM", "SHOWER"] },
  { name: "Jobs", icon: "👩‍🚒", color: "#e11d48", words: ["DOCTOR", "NURSE", "PILOT", "CHEF", "FARMER", "TEACHER", "LAWYER", "BAKER", "DENTIST", "ARTIST", "WRITER", "SINGER", "DRIVER", "WAITER", "ACTOR", "JUDGE", "PLUMBER", "SAILOR", "TAILOR", "BARBER", "COACH", "GUARD"] },
  { name: "Nature", icon: "🌲", color: "#16a34a", words: ["FOREST", "RIVER", "MOUNTAIN", "VALLEY", "FLOWER", "TREE", "LEAF", "STONE", "DESERT", "CANYON", "MEADOW", "LAKE", "CAVE", "HILL", "JUNGLE", "SWAMP", "GLACIER", "VOLCANO", "PEBBLE", "MOSS", "FERN", "BRANCH"] },
];

export interface Difficulty {
  name: string;
  size: number;
  count: number;
  dirs: [number, number][];
  color: string;
}

export const DIFFICULTIES: Difficulty[] = [
  { name: "Easy", size: 8, count: 6, dirs: [[0, 1], [1, 0]], color: "#22c55e" },
  { name: "Medium", size: 10, count: 8, dirs: [[0, 1], [1, 0], [1, 1], [-1, 1]], color: "#f59e0b" },
  { name: "Hard", size: 12, count: 11, dirs: [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]], color: "#ef4444" },
];

export const HIGHLIGHTS = ["#fca5a5", "#fdba74", "#fcd34d", "#86efac", "#67e8f9", "#93c5fd", "#c4b5fd", "#f9a8d4", "#a7f3d0", "#fde68a", "#bef264", "#fda4af"];
