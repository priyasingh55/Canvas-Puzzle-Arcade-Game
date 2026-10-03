// Built-in "Quiz Quest" campaign for Quiz Builder.
// World 1 is generated maths (fresh questions every attempt); worlds 2–5 are hand-written trivia.
// In every item the FIRST answer is the correct one — answers are shuffled when played.

export interface QWorld { name: string; color: string; sub: string; time: number }
export interface QItem { text: string; answers: string[] }
type MathKind = "add" | "sub" | "mul" | "div" | "mix";
export interface QLevel { name: string; world: number; items?: QItem[]; gen?: MathKind }

export const PER_LEVEL = 5;
export const PASS = 3;
export const levelStars = (correct: number) => (correct >= 5 ? 3 : correct === 4 ? 2 : correct === 3 ? 1 : 0);

export const QUIZ_WORLDS: QWorld[] = [
  { name: "Number Island", color: "#f59e0b", sub: "Quick-fire maths", time: 15 },
  { name: "Animal Park", color: "#22c55e", sub: "Creatures great and small", time: 15 },
  { name: "Space & Earth", color: "#6366f1", sub: "Our planet and beyond", time: 14 },
  { name: "Science Lab", color: "#0ea5e9", sub: "How the world works", time: 12 },
  { name: "Around the World", color: "#ec4899", sub: "Places, flags and languages", time: 10 },
];

const q = (text: string, ...answers: string[]): QItem => ({ text, answers });

export const QUIZ_LEVELS: QLevel[] = [
  // ---- World 1 · Number Island (generated) ----
  { name: "Adding Up", world: 0, gen: "add" },
  { name: "Taking Away", world: 0, gen: "sub" },
  { name: "Times Tables", world: 0, gen: "mul" },
  { name: "Sharing Out", world: 0, gen: "div" },
  { name: "Brain Buster", world: 0, gen: "mix" },
  // ---- World 2 · Animal Park ----
  { name: "Pets & Farm", world: 1, items: [
    q("What sound does a cow make?", "Moo", "Woof", "Quack", "Neigh"),
    q("A baby dog is called a…", "Puppy", "Kitten", "Calf", "Foal"),
    q("Which of these animals lays eggs?", "Chicken", "Cow", "Horse", "Pig"),
    q("How many legs does a cat have?", "4", "2", "6", "8"),
    q("What do caterpillars turn into?", "Butterflies", "Bees", "Birds", "Frogs"),
  ] },
  { name: "Wild Things", world: 1, items: [
    q("Which animal is often called the king of the jungle?", "Lion", "Tiger", "Bear", "Wolf"),
    q("What is the tallest animal in the world?", "Giraffe", "Elephant", "Camel", "Horse"),
    q("Which animal has black and white stripes?", "Zebra", "Leopard", "Lion", "Hippo"),
    q("Where do polar bears live?", "The Arctic", "The Sahara", "The Amazon", "Australia"),
    q("What does a panda mostly eat?", "Bamboo", "Fish", "Insects", "Cheese"),
  ] },
  { name: "Ocean Life", world: 1, items: [
    q("Which of these sea creatures is a mammal?", "Dolphin", "Shark", "Tuna", "Octopus"),
    q("How many arms does an octopus have?", "8", "6", "10", "4"),
    q("What do fish use to breathe underwater?", "Gills", "Lungs", "Fins", "Scales"),
    q("Which sea creature has a shell and walks sideways?", "Crab", "Jellyfish", "Starfish", "Seal"),
    q("What is a group of fish called?", "A school", "A pack", "A herd", "A flock"),
  ] },
  { name: "Birds & Bugs", world: 1, items: [
    q("Which of these birds cannot fly?", "Penguin", "Eagle", "Sparrow", "Parrot"),
    q("How many legs does an insect have?", "6", "8", "4", "10"),
    q("Which insect makes honey?", "Bee", "Ant", "Fly", "Beetle"),
    q("What is a baby frog called?", "Tadpole", "Chick", "Cub", "Joey"),
    q("Which bird is a well-known symbol of peace?", "Dove", "Crow", "Owl", "Vulture"),
  ] },
  { name: "Animal Records", world: 1, items: [
    q("What is the largest land animal?", "African elephant", "Giraffe", "Hippo", "Rhino"),
    q("Which animal is famous for moving very slowly?", "Sloth", "Cheetah", "Hare", "Horse"),
    q("How many hearts does an octopus have?", "3", "1", "2", "4"),
    q("Which mammal can truly fly?", "Bat", "Flying squirrel", "Ostrich", "Penguin"),
    q("What is a baby kangaroo called?", "Joey", "Kid", "Pup", "Calf"),
  ] },
  // ---- World 3 · Space & Earth ----
  { name: "Our Planet", world: 2, items: [
    q("What is the largest ocean on Earth?", "Pacific", "Atlantic", "Indian", "Arctic"),
    q("How many continents are there?", "7", "5", "6", "8"),
    q("What do plants use to make their food?", "Sunlight", "Sand", "Salt", "Plastic"),
    q("Which is the coldest continent?", "Antarctica", "Europe", "Asia", "Africa"),
    q("What is frozen water called?", "Ice", "Steam", "Fog", "Dew"),
  ] },
  { name: "Sun & Moon", world: 2, items: [
    q("What is the Sun?", "A star", "A planet", "A moon", "A comet"),
    q("How long does Earth take to travel around the Sun?", "About a year", "About a day", "About a week", "About a month"),
    q("What causes day and night?", "Earth spinning", "The Moon moving", "Clouds", "The Sun switching off"),
    q("Who was the first person to walk on the Moon?", "Neil Armstrong", "Buzz Aldrin", "Yuri Gagarin", "Sally Ride"),
    q("What force pulls things towards the ground?", "Gravity", "Magnetism", "Wind", "Light"),
  ] },
  { name: "The Planets", world: 2, items: [
    q("Which is the biggest planet in our solar system?", "Jupiter", "Saturn", "Earth", "Neptune"),
    q("Which planet is closest to the Sun?", "Mercury", "Venus", "Earth", "Mars"),
    q("Which planet spins tipped over on its side?", "Uranus", "Mars", "Earth", "Mercury"),
    q("Which planet has the hottest surface?", "Venus", "Mercury", "Mars", "Jupiter"),
    q("What is Earth's only natural satellite?", "The Moon", "The Sun", "Mars", "A comet"),
  ] },
  { name: "Weather & Rocks", world: 2, items: [
    q("What is melted rock called once it flows out of a volcano?", "Lava", "Magma", "Ash", "Steam"),
    q("What is a scientist who studies the weather called?", "Meteorologist", "Geologist", "Astronomer", "Biologist"),
    q("Which gas do people need to breathe in to live?", "Oxygen", "Carbon dioxide", "Helium", "Neon"),
    q("What is the layer of air around Earth called?", "The atmosphere", "The crust", "The core", "The orbit"),
    q("What makes a rainbow?", "Sunlight and raindrops", "Wind and dust", "Moonlight and snow", "Thunder and clouds"),
  ] },
  { name: "Space Pros", world: 2, items: [
    q("How many planets in our solar system have rings?", "4", "1", "2", "8"),
    q("What is the name of our galaxy?", "The Milky Way", "Andromeda", "The Big Dipper", "Orion"),
    q("About how long does sunlight take to reach Earth?", "About 8 minutes", "About 8 seconds", "About 8 hours", "About 8 days"),
    q("Who was the first person to travel into space?", "Yuri Gagarin", "Neil Armstrong", "John Glenn", "Alan Shepard"),
    q("What is a 'shooting star' really?", "A meteor", "A dying star", "A planet", "A satellite"),
  ] },
  // ---- World 4 · Science Lab ----
  { name: "Body Basics", world: 3, items: [
    q("How many bones does an adult human have?", "206", "106", "306", "186"),
    q("Which organ pumps blood around the body?", "Heart", "Brain", "Lungs", "Liver"),
    q("What do we use our lungs for?", "Breathing", "Thinking", "Digesting food", "Seeing"),
    q("Which sense do you use your nose for?", "Smell", "Taste", "Touch", "Hearing"),
    q("What is the largest organ of the human body?", "Skin", "Heart", "Liver", "Brain"),
  ] },
  { name: "Materials", world: 3, items: [
    q("Which of these is magnetic?", "Iron", "Wood", "Glass", "Plastic"),
    q("What is water made of?", "Hydrogen and oxygen", "Carbon and oxygen", "Salt and sugar", "Nitrogen and helium"),
    q("At what temperature does water boil at sea level?", "100 °C", "50 °C", "0 °C", "200 °C"),
    q("What happens to ice when it gets warm?", "It melts", "It freezes", "It burns", "It grows"),
    q("Which material is see-through?", "Glass", "Brick", "Wood", "Metal"),
  ] },
  { name: "Plant Power", world: 3, items: [
    q("Which part of a plant takes in water from the soil?", "Roots", "Petals", "Leaves", "Flowers"),
    q("Which gas do plants take in to make their food?", "Carbon dioxide", "Oxygen", "Helium", "Neon"),
    q("What is the green substance in leaves called?", "Chlorophyll", "Chalk", "Pollen", "Sap"),
    q("What do bees carry from flower to flower?", "Pollen", "Seeds", "Water", "Leaves"),
    q("Which part of a plant can grow into a new plant?", "Seed", "Stem", "Petal", "Thorn"),
  ] },
  { name: "Energy & Forces", world: 3, items: [
    q("Which force slows down an object sliding across the floor?", "Friction", "Gravity", "Magnetism", "Electricity"),
    q("Which of these is a renewable energy source?", "Wind", "Coal", "Oil", "Gas"),
    q("What does a thermometer measure?", "Temperature", "Weight", "Speed", "Time"),
    q("What kind of energy does a battery store?", "Chemical", "Sound", "Light", "Heat"),
    q("Sound travels fastest through…", "Solids", "Liquids", "Gases", "Empty space"),
  ] },
  { name: "Lab Legends", world: 3, items: [
    q("What is the chemical symbol for gold?", "Au", "Ag", "Go", "Gd"),
    q("What is the hardest natural material?", "Diamond", "Gold", "Iron", "Quartz"),
    q("Which scientist is famous for a story about a falling apple and gravity?", "Isaac Newton", "Albert Einstein", "Galileo", "Charles Darwin"),
    q("What is the centre of an atom called?", "The nucleus", "The electron", "The molecule", "The cell"),
    q("How many colours are usually listed in a rainbow?", "7", "5", "6", "9"),
  ] },
  // ---- World 5 · Around the World ----
  { name: "Capital Cities", world: 4, items: [
    q("What is the capital of France?", "Paris", "Rome", "Madrid", "Berlin"),
    q("What is the capital of Japan?", "Tokyo", "Beijing", "Seoul", "Bangkok"),
    q("What is the capital of Italy?", "Rome", "Milan", "Venice", "Naples"),
    q("What is the capital of Egypt?", "Cairo", "Alexandria", "Luxor", "Giza"),
    q("What is the capital of Canada?", "Ottawa", "Toronto", "Vancouver", "Montreal"),
  ] },
  { name: "Landmarks", world: 4, items: [
    q("In which country is the Great Pyramid of Giza?", "Egypt", "Mexico", "Peru", "India"),
    q("The Eiffel Tower is in which city?", "Paris", "London", "New York", "Rome"),
    q("Which country is home to the Great Wall?", "China", "India", "Japan", "Russia"),
    q("In which city is the Colosseum?", "Rome", "Athens", "Paris", "Madrid"),
    q("The Statue of Liberty stands in which city?", "New York", "Washington", "Chicago", "Boston"),
  ] },
  { name: "Geography", world: 4, items: [
    q("What is the longest river in Africa?", "The Nile", "The Congo", "The Niger", "The Zambezi"),
    q("What is the largest desert in Africa?", "The Sahara", "The Gobi", "The Kalahari", "The Namib"),
    q("Mount Everest sits on the border of Nepal and which country?", "China", "India", "Bhutan", "Pakistan"),
    q("Which country is shaped like a boot?", "Italy", "Spain", "Greece", "Chile"),
    q("Which is the smallest continent by area?", "Australia", "Europe", "Antarctica", "South America"),
  ] },
  { name: "Flags & Languages", world: 4, items: [
    q("Which language is mainly spoken in Brazil?", "Portuguese", "Spanish", "English", "French"),
    q("What colour is the circle on Japan's flag?", "Red", "Blue", "Yellow", "Green"),
    q("How many stars are on the flag of the USA?", "50", "13", "48", "52"),
    q("Which country's flag has a maple leaf?", "Canada", "Australia", "Switzerland", "Norway"),
    q("'Hola' means hello in which language?", "Spanish", "Italian", "German", "Dutch"),
  ] },
  { name: "World Masters", world: 4, items: [
    q("Which ocean lies between Africa and Australia?", "Indian", "Atlantic", "Pacific", "Arctic"),
    q("What is the capital of Australia?", "Canberra", "Sydney", "Melbourne", "Perth"),
    q("Which is the largest country by area?", "Russia", "Canada", "China", "USA"),
    q("In which country is Machu Picchu?", "Peru", "Mexico", "Chile", "Brazil"),
    q("What is the capital of Kenya?", "Nairobi", "Mombasa", "Kampala", "Addis Ababa"),
  ] },
];

const R = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

function distractors(ans: number): string[] {
  const cands = [ans + 1, ans - 1, ans + 2, ans - 2, ans + 10, ans - 10, ans + R(3, 6), ans - R(3, 6), ans + R(7, 12)];
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  const out: number[] = [];
  for (const c of cands) if (c >= 0 && c !== ans && !out.includes(c) && out.length < 3) out.push(c);
  for (let k = 3; out.length < 3; k++) if (!out.includes(ans + k)) out.push(ans + k);
  return out.map(String);
}

function mathItems(kind: MathKind): QItem[] {
  const out: QItem[] = [];
  const seen = new Set<string>();
  while (out.length < PER_LEVEL) {
    let text: string, ans: number;
    if (kind === "add") { const a = R(3, 20), b = R(2, 15); text = `${a} + ${b} = ?`; ans = a + b; }
    else if (kind === "sub") { const a = R(12, 40), b = R(3, a - 2); text = `${a} − ${b} = ?`; ans = a - b; }
    else if (kind === "mul") { const a = R(2, 10), b = R(2, 10); text = `${a} × ${b} = ?`; ans = a * b; }
    else if (kind === "div") { const b = R(2, 10), k = R(2, 10); text = `${b * k} ÷ ${b} = ?`; ans = k; }
    else {
      const a = R(2, 9), b = R(2, 9);
      if (Math.random() < 0.5) { const c = R(2, 20); text = `${a} × ${b} + ${c} = ?`; ans = a * b + c; }
      else { const c = R(1, a * b - 1); text = `${a} × ${b} − ${c} = ?`; ans = a * b - c; }
    }
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, answers: [String(ans), ...distractors(ans)] });
  }
  return out;
}

export function levelItems(i: number): QItem[] {
  const L = QUIZ_LEVELS[i];
  return L.items ? L.items.map((x) => ({ text: x.text, answers: x.answers.slice() })) : mathItems(L.gen ?? "add");
}
