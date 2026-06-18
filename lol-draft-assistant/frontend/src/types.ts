export interface Champion {
  id: number
  key: string
  name: string
  title: string
  tags: string[]
  image: string
  squareImage: string
}

export interface Pick {
  championId: number
  team: 'blue' | 'red'
  cellId: number
}

export interface Ban {
  championId: number
  team: 'blue' | 'red'
  cellId: number
}

export interface TeamMember {
  cellId: number
  summonerId: string
  puuid?: string
  championId?: number
  assignedPosition?: string
}

export interface DraftState {
  status: 'disconnected' | 'idle' | 'in_draft'
  picks: Pick[]
  bans: Ban[]
  blueTeam: TeamMember[]
  redTeam: TeamMember[]
  myTeam: 'blue' | 'red'
  localPlayerCellId: number
  currentAction?: {
    actorCellId: number
    type: 'pick' | 'ban'
    isInProgress: boolean
    championId: number
  }
  timer?: { adjustedTimeLeftInPhase: number }
}

export interface RankedEntry {
  queueType: string
  tier: string
  rank: string
  leaguePoints: number
  wins: number
  losses: number
}

export interface MasteryEntry {
  championId: number
  championLevel: number
  championPoints: number
}

export interface MobalyticsChamp {
  championId: number
  championName: string
  games: number
  wins: number
  winRate: number
  kda: number
  grade: string
  role: string
}

export interface SummonerData {
  summonerId: string
  gameName: string
  tagLine: string
  profile?: {
    summonerLevel: number
    ranked: RankedEntry[]
    mastery: MasteryEntry[]
  }
  mobalytics?: {
    ranking?: { tier: string; division: string; lp: number; wins: number; losses: number }
  }
  championPool: MobalyticsChamp[]
  mastery: MasteryEntry[]
  ranked: RankedEntry[]
}

export interface Suggestion {
  championId: number
  totalScore: number
  scores: {
    tier: number
    counter: number
    synergy: number
    familiarity: number
    compNeed: number
  }
  role: string
}

export interface BanSuggestion {
  championId: number
  threatScore: number
}

export interface WsMessage {
  type: 'status' | 'draft_update'
  payload: string | {
    draft: DraftState
    summoners: Record<string, SummonerData>
    suggestions: { picks: Suggestion[]; bans: BanSuggestion[] }
  }
}
