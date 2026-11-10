import manifest from '~~/content/free-games.json'
import { parseFreeGames, type FreeGame } from '~~/shared/utils/freeGames'

const games: FreeGame[] = parseFreeGames(manifest)

/** Freely redistributable games from content/free-games.json (validated at build time). */
export function useFreeGames() {
  return { games }
}
