/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PlayerColor = 'white' | 'black';

export interface Position {
  r: number; // Row (0-7, 0 is top/black side, 7 is bottom/white side)
  c: number; // Column (0-7, A-H)
}

export type StatusEffectType = 'frozen' | 'armor' | 'charmed' | 'greyShield';

export interface StatusEffect {
  type: StatusEffectType;
  duration: number; // Turns remaining
  value?: number;   // E.g., amount of armor
  casterColor?: PlayerColor; // The color of the player who casted this status
  casterId?: string;         // The ID of the specific piece that casted this status
  isNew?: boolean;           // To prevent decrementing on the same turn it was casted
}

export interface Piece {
  id: string;
  type: PieceType;
  color: PlayerColor;
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  cooldowns: {
    ability: number; // Turns left on ability cooldown
  };
  superProgress: number; // Numerical progress or count (e.g. freeze count, heal count)
  superUnlocked: boolean;
  statusEffects: StatusEffect[];
  // Turn count or logs specific to passives
  passiveCooldown: number; // For knight's evasion or rook's block
  hasSufferedDamageThisTurn?: boolean;
  
  // Custom properties for Charmed status
  originalColor?: PlayerColor;
  charmedByQueenId?: string;
  
  // Custom properties for Rook Iron Shell
  ironShellState?: 'charging' | 'ready';
  ironShellProgress?: number;
  rookSuperTurns?: number;

  // Track if piece has moved (important for King and Rook castling)
  hasMoved?: boolean;

  // Last Stand Mode flags (specific to the King)
  inLastStand?: boolean;
  lastStandUsed?: boolean;
  consecutiveCheckCount?: number;
}

export interface Wall {
  id: string;
  position: Position;
  duration: number; // Remaining turns
  color: PlayerColor; // Placed by which player
}

export type GameMode = 'pvp' | 'pve';
export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface BattleLogEntry {
  id: string;
  turn: number;
  color: PlayerColor;
  message: string;
  type: 'move' | 'attack' | 'ability' | 'super' | 'death' | 'heal' | 'system';
}

export interface GameState {
  mode: GameMode;
  difficulty: AIDifficulty;
  currentPlayer: PlayerColor;
  turnNumber: number;
  pieces: Piece[];
  walls: Wall[];
  selectedPieceId: string | null;
  activeAction: 'move' | 'ability' | 'super' | null;
  history: BattleLogEntry[];
  winner: PlayerColor | null;
  gameStarted: boolean;
  isPaused: boolean;
  promotionPending: {
    pieceId: string;
    position: Position;
  } | null;
  // Stats tracked for Super Unlocks
  whiteSuperStats: {
    bishopHealed: number; // bishop total heal amount
    knightKills: number;  // knight total kills
    queenFreezes: Set<string>; // IDs of different enemy pieces frozen
    rookDamageAbsorbed: number; // damage absorbed by rook/shield
  };
  blackSuperStats: {
    bishopHealed: number;
    knightKills: number;
    queenFreezes: Set<string>;
    rookDamageAbsorbed: number;
  };
}

export interface GameSettings {
  volume: number;
  musicEnabled: boolean;
  sfxEnabled: boolean;
}

export interface VisualEffect {
  id: string;
  type: 'attack' | 'ability' | 'super' | 'lastStand';
  source: Position;
  target?: Position;
  actorType: string;
  actorColor: PlayerColor;
  targetType?: string;
  timestamp: number;
  damageDealt?: number;
  healAmount?: number;
}
