//  Sports List
export interface Sports {
  id: string;
  name: string;
}

// Series Or Competition List
export interface CompetitionItem {
  competition: {
    id: string;
    name: string;
  };
  marketCount: number;
  competitionRegion: string;
}

// Match List
export interface MatchItem {
  event: {
    id: string;
    name: string;
    countryCode: string;
    timezone: string;
    openDate: string; // ISO date string
  };
  marketCount: number;
  scoreboard_id: string;
  selections: string;
  liability_type: number;
  undeclared_markets: number;
}

// Market List
export interface MarketItem {
  marketId: string;
  marketTime: string; // ISO date string
  marketType: string; // e.g., "MATCH_ODDS", "TIED_MATCH", "OVERS"
  bettingType: string; // e.g., "ODDS", "LINE", "BOOKMAKER"
  marketName: string;
  provider: string; // e.g., "BETFAIR", "SKY", "BETHUBS"
  sportingEvent: boolean;
  marketCondition: {
    marketId: string;
    betLock: boolean;
    minBet: number;
    maxBet: number;
    maxProfit: number;
    betDelay: number;
    mtp: number;
    allowUnmatchBet: boolean;
    potLimit: number;
    volume: number;
  };
  status: "OPEN" | "CLOSED" | "INACTIVE" | "SUSPENDED";
  inPlay: boolean;
  sortPriority: number;
  runners: {
    id: number;
    name: string;
    sortPriority: number;
    metadata: {
      runnerId: string;
    } | null;
  }[];
  odds?: any | null; // Optional odds data
}

export interface Runner {
  selectionId: number;
  runnerName: string;
  handicap?: number;
  sortPriority: number;
}

// BookMaker List

export interface BookmakerMarket {
  marketId: string;
  marketName: string;
  marketStartTime: string; // can be empty
  totalMatched: string;
  runners: Runner[];
}

// Score Data
export interface Score {
  message: string;
  code: number;
  error: boolean;
  data: {
    match_id: number;
    match_name: string;
    match_date: string;
    venue: string;
    msg: string;
    teams: {
      team_name: string;
      team_short_name: string;
      score: string;
    }[];
    currentRunRate: string;
    current_inning: string;
    remaining_overs: number;
    requireRunRate: string;
    runNeeded: string;
    ballsRemaining: number;
    target: number;
    current_over: string;
    current_score: string;
    current_wickets: string;
    match_format: string;
    currentPlayersScore: {
      Batsman: {
        id: number;
        on_play: string;
        player_id: number;
        team_id: number;
        match_id: string;
        inning: string;
        runs: string;
        balls: string;
        fours: string;
        sixes: string;
        is_out: string;
        out_text: string;
        strike_rate: string;
      }[];
      partnership: string;
      lastWicket: string;
      bowler: {
        player_name: string;
      };
    };
    last24balls: {
      score_card: string;
      out_text: string;
      comment: string;
    }[];
    last24ballsNew: {
      score_card: string;
      out_text: string;
      comment: string;
    }[];
    completed_message: string;
  };
}

// Score Matched List
export interface ScoreMatches {
  message: string;
  code: number;
  error: boolean;
  data: {
    match_id: number;
    match_name: string;
    match_date: string;
    venue: string;
    teams: {
      name: string;
    }[];
  };
}
