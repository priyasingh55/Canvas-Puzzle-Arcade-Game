import { useEffect, useRef, useState } from "react";
import { GAMES, HubScreen, type GameId } from "./game/hub";
import { WordSearchGame } from "./game/wordsearch";
import { WaterSortGame } from "./game/watersort";
import { WordScrambleGame } from "./game/scramble";
import { SnakeGame } from "./game/snake";
import { LudoGame } from "./game/ludo";
import { SpeedTyperGame } from "./game/typer";
import { BowBrawlGame } from "./game/archers";
import { MemoryMatchGame } from "./game/memory";
import { FourInARowGame } from "./game/connect4";
import { MakeTenGame } from "./game/maketen";
import { NumberMatchGame } from "./game/numatch";
import { SumChainGame } from "./game/sumchain";
import { MergeDoubleGame } from "./game/merge";
import { TileSlideGame } from "./game/tileslide";
import { GlowGridGame } from "./game/glow";
import { PipeGardenGame } from "./game/pipes";
import { QuizBuilderGame } from "./game/quiz";
import { CritterKeeperGame } from "./game/pets";
import { MazeMakerGame } from "./game/maze";
import { BubbleSortGame } from "./game/bubbles";
import { BubbleBurstGame } from "./game/burst";
import { HoopPopGame } from "./game/hoopshot";
import { SlingSquadGame } from "./game/sling";
import { CannonDropGame } from "./game/cannon";
import { HillRiderGame } from "./game/hill";
import { PlanetMergeGame } from "./game/planets";

type View = "hub" | GameId;

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>(() => {
    // deep link support: e.g. index.html#archers opens Bow Brawl directly
    const id = (typeof location !== "undefined" ? location.hash.slice(1) : "") as GameId;
    return GAMES.some((g) => g.id === id) ? id : "hub";
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const home = () => setView("hub");
    let game: { destroy: () => void };
    switch (view) {
      case "wordsearch": game = new WordSearchGame(canvas, home); break;
      case "watersort": game = new WaterSortGame(canvas, home); break;
      case "scramble": game = new WordScrambleGame(canvas, home); break;
      case "snake": game = new SnakeGame(canvas, home); break;
      case "ludo": game = new LudoGame(canvas, home); break;
      case "typer": game = new SpeedTyperGame(canvas, home); break;
      case "archers": game = new BowBrawlGame(canvas, home); break;
      case "memory": game = new MemoryMatchGame(canvas, home); break;
      case "connect4": game = new FourInARowGame(canvas, home); break;
      case "tens": game = new MakeTenGame(canvas, home); break;
      case "numatch": game = new NumberMatchGame(canvas, home); break;
      case "sumchain": game = new SumChainGame(canvas, home); break;
      case "merge": game = new MergeDoubleGame(canvas, home); break;
      case "tileslide": game = new TileSlideGame(canvas, home); break;
      case "glow": game = new GlowGridGame(canvas, home); break;
      case "pipes": game = new PipeGardenGame(canvas, home); break;
      case "quiz": game = new QuizBuilderGame(canvas, home); break;
      case "pets": game = new CritterKeeperGame(canvas, home); break;
      case "maze": game = new MazeMakerGame(canvas, home); break;
      case "bubbles": game = new BubbleSortGame(canvas, home); break;
      case "burst": game = new BubbleBurstGame(canvas, home); break;
      case "hooppop": game = new HoopPopGame(canvas, home); break;
      case "sling": game = new SlingSquadGame(canvas, home); break;
      case "cannon": game = new CannonDropGame(canvas, home); break;
      case "hill": game = new HillRiderGame(canvas, home); break;
      case "planets": game = new PlanetMergeGame(canvas, home); break;
      default: game = new HubScreen(canvas, (id) => setView(id));
    }
    return () => game.destroy();
  }, [view]);

  return <canvas key={view} ref={ref} style={{ display: "block", touchAction: "none" }} />;
}
