/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Piece,
  Position,
  Wall,
  PlayerColor,
  GameMode,
  AIDifficulty,
  BattleLogEntry,
  GameState,
  GameSettings,
  PieceType,
  VisualEffect
} from './types';
import {
  createInitialPieces,
  getLegalMoves,
  getLegalAttacks,
  getAbilityTargets,
  getSuperTargets,
  isFrozen,
  isAbilitySuppressed,
  getEffectiveAttack,
  getArmor,
  inBounds,
  getPieceAt,
  isSquareBlockedByWall,
  isSquareUnderThreat,
  canPieceKillThreat,
  getThreats
} from './utils/gameLogic';
import { getBestAction, AIAction, simulateAction } from './utils/ai';
import { sound } from './utils/sound';

import Board from './components/Board';
import Inspector from './components/Inspector';
import Graveyard from './components/Graveyard';
import HistoryLog from './components/HistoryLog';

const AUTOSAVE_KEY = 'kingdom_chess_autosave_v1';
const SETTINGS_KEY = 'kingdom_chess_settings_v1';

export default function App() {
  // Game state
  const [mode, setMode] = useState<GameMode>('pve');
  const [difficulty, setDifficulty] = useState<AIDifficulty>('medium');
  const [currentPlayer, setCurrentPlayer] = useState<PlayerColor>('white');
  const [humanColor, setHumanColor] = useState<PlayerColor>('white');
  const [turnNumber, setTurnNumber] = useState<number>(1);
  const [specialTurn, setSpecialTurn] = useState<boolean>(false);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'move' | 'ability' | 'super' | null>(null);
  const [history, setHistory] = useState<BattleLogEntry[]>([]);
  const [winner, setWinner] = useState<PlayerColor | null>(null);
  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [promotionPending, setPromotionPending] = useState<{ pieceId: string; position: Position } | null>(null);
  const [resurrectionPending, setResurrectionPending] = useState<{
    actorId: string;
    position: Position;
    nextPieces: Piece[];
    nextWalls: Wall[];
    nextGraveyard: Piece[];
  } | null>(null);
  const [repositionPending, setRepositionPending] = useState<{ pieceId: string; allowedSquares: Position[] } | null>(null);
  const [graveyard, setGraveyard] = useState<Piece[]>([]);
  const [activeEffects, setActiveEffects] = useState<VisualEffect[]>([]);
  const [aiMoveTrigger, setAiMoveTrigger] = useState<number>(0);

  const triggerVisualEffect = (
    type: 'attack' | 'ability' | 'super' | 'lastStand',
    source: Position,
    target?: Position,
    actorType?: string,
    actorColor?: PlayerColor,
    targetType?: string,
    damageDealt?: number,
    healAmount?: number
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    const newEffect: VisualEffect = {
      id,
      type,
      source,
      target,
      actorType: actorType || 'pawn',
      actorColor: actorColor || 'white',
      targetType,
      timestamp: Date.now(),
      damageDealt,
      healAmount
    };
    setActiveEffects(prev => [...prev, newEffect]);
    setTimeout(() => {
      setActiveEffects(prev => prev.filter(e => e.id !== id));
    }, (type === 'super' || type === 'lastStand') ? 2000 : (type === 'ability' ? 1000 : 600));
  };

  // Super unlock statistics
  const [whiteSuperStats, setWhiteSuperStats] = useState({
    bishopHealed: 0,
    knightKills: 0,
    queenFreezes: new Set<string>(),
    rookDamageAbsorbed: 0
  });
  const [blackSuperStats, setBlackSuperStats] = useState({
    bishopHealed: 0,
    knightKills: 0,
    queenFreezes: new Set<string>(),
    rookDamageAbsorbed: 0
  });

  // Settings state
  const [settings, setSettings] = useState<GameSettings>({
    volume: 0.5,
    musicEnabled: true,
    sfxEnabled: true
  });

  const selectedPiece = pieces.find(p => p.id === selectedPieceId && p.hp > 0) || null;

  // Initialize and load saved settings / autosave
  useEffect(() => {
    // Load Settings
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings(parsed);
        sound.setVolume(parsed.volume);
        sound.setSFXEnabled(parsed.sfxEnabled);
      } catch (e) {
        console.error(e);
      }
    } else {
      sound.setVolume(0.5);
      sound.setSFXEnabled(true);
    }

    // Check for existing autosave to offer load
    const autosave = localStorage.getItem(AUTOSAVE_KEY);
    if (autosave) {
      // We will present a "Continue" button on the start screen if present
    }
  }, []);

  // Save Settings when changed
  const updateSettings = (updates: Partial<GameSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
    sound.setVolume(newSettings.volume);
    sound.setSFXEnabled(newSettings.sfxEnabled);
  };

  // Start a completely fresh game
  const startNewGame = (selectedMode: GameMode, selectedDifficulty: AIDifficulty) => {
    sound.playClick();
    const assignedColor = selectedMode === 'pve' ? (Math.random() < 0.5 ? 'white' : 'black') : 'white';
    setHumanColor(assignedColor);

    const initialPieces = createInitialPieces();
    setPieces(initialPieces);
    setWalls([]);
    setGraveyard([]);
    setCurrentPlayer('white');
    setTurnNumber(1);
    setSpecialTurn(false);
    setSelectedPieceId(null);
    setActiveAction(null);
    setWinner(null);
    setPromotionPending(null);
    setRepositionPending(null);
    setMode(selectedMode);
    setDifficulty(selectedDifficulty);
    
    // Reset stats
    setWhiteSuperStats({
      bishopHealed: 0,
      knightKills: 0,
      queenFreezes: new Set<string>(),
      rookDamageAbsorbed: 0
    });
    setBlackSuperStats({
      bishopHealed: 0,
      knightKills: 0,
      queenFreezes: new Set<string>(),
      rookDamageAbsorbed: 0
    });

    const welcomeLog: BattleLogEntry = {
      id: `system-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      turn: 1,
      color: 'white',
      message: `The battle begins! Mode: ${selectedMode === 'pvp' ? 'Player vs Player' : `Player vs AI (${(selectedDifficulty === 'medium' ? 'normal' : selectedDifficulty).toUpperCase()})`}.`,
      type: 'system'
    };
    setHistory([welcomeLog]);
    setGameStarted(true);
    setIsPaused(false);

    // Save initial state
    setTimeout(() => {
      saveGameState(initialPieces, [], [], 'white', 1, false, selectedMode, selectedDifficulty, [welcomeLog], {
        bishopHealed: 0, knightKills: 0, queenFreezes: [], rookDamageAbsorbed: 0
      }, {
        bishopHealed: 0, knightKills: 0, queenFreezes: [], rookDamageAbsorbed: 0
      });
    }, 100);
  };

  // Load game from autosave
  const loadAutosave = () => {
    sound.playClick();
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      setMode(data.mode);
      setDifficulty(data.difficulty);
      setCurrentPlayer(data.currentPlayer);
      setTurnNumber(data.turnNumber);
      setSpecialTurn(data.specialTurn || false);
      setPieces(data.pieces);
      setWalls(data.walls);
      setGraveyard(data.graveyard || []);
      setHistory(data.history);
      setWinner(data.winner);
      setHumanColor(data.humanColor || 'white');
      setPromotionPending(null);
      setRepositionPending(null);
      setSelectedPieceId(null);
      setActiveAction(null);

      // Reconstruct Sets from Arrays
      setWhiteSuperStats({
        bishopHealed: data.whiteSuperStats.bishopHealed,
        knightKills: data.whiteSuperStats.knightKills,
        queenFreezes: new Set(data.whiteSuperStats.queenFreezes || []),
        rookDamageAbsorbed: data.whiteSuperStats.rookDamageAbsorbed || 0
      });
      setBlackSuperStats({
        bishopHealed: data.blackSuperStats.bishopHealed,
        knightKills: data.blackSuperStats.knightKills,
        queenFreezes: new Set(data.blackSuperStats.queenFreezes || []),
        rookDamageAbsorbed: data.blackSuperStats.rookDamageAbsorbed || 0
      });

      setGameStarted(true);
      setIsPaused(false);
    } catch (e) {
      console.error("Failed to load autosave", e);
    }
  };

  // Save state helper
  const saveGameState = (
    currentPieces: Piece[],
    currentWalls: Wall[],
    currentGraveyard: Piece[],
    nextPlayer: PlayerColor,
    currentTurn: number,
    nextSpecialTurn: boolean,
    currentGameMode: GameMode,
    currentDiff: AIDifficulty,
    currentHistory: BattleLogEntry[],
    wStats: any,
    bStats: any
  ) => {
    // Prepare structures with serializable elements (Set to Array)
    const stateToSave = {
      mode: currentGameMode,
      difficulty: currentDiff,
      currentPlayer: nextPlayer,
      turnNumber: currentTurn,
      specialTurn: nextSpecialTurn,
      pieces: currentPieces,
      walls: currentWalls,
      graveyard: currentGraveyard,
      history: currentHistory,
      winner,
      humanColor,
      whiteSuperStats: {
        ...wStats,
        queenFreezes: Array.from(wStats.queenFreezes)
      },
      blackSuperStats: {
        ...bStats,
        queenFreezes: Array.from(bStats.queenFreezes)
      }
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(stateToSave));
  };

  const addLog = (message: string, type: BattleLogEntry['type'] = 'move', color: PlayerColor = currentPlayer) => {
    const entry: BattleLogEntry = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      turn: turnNumber,
      color,
      message,
      type
    };
    setHistory(prev => [...prev, entry]);
    return entry;
  };

  const getNormalSavingMovesForPiece = (
    p: Piece,
    customPieces = pieces,
    customWalls = walls,
    customGraveyard = graveyard
  ): AIAction[] => {
    const actions: AIAction[] = [];
    const moves = getLegalMoves(p, customPieces, customWalls);
    for (const m of moves) {
      actions.push({ pieceId: p.id, type: 'move', target: m });
    }
    const attacks = getLegalAttacks(p, customPieces, customWalls);
    for (const atk of attacks) {
      actions.push({ pieceId: p.id, type: 'attack', target: atk });
    }
    if (p.cooldowns.ability === 0 && !isAbilitySuppressed(p, customPieces)) {
      const abilityTargets = getAbilityTargets(p, customPieces, customWalls);
      for (const t of abilityTargets) {
        actions.push({ pieceId: p.id, type: 'ability', target: t });
      }
    }
    if (p.superUnlocked) {
      const superTargets = getSuperTargets(p, customPieces, customWalls, customGraveyard);
      for (const t of superTargets) {
        actions.push({ pieceId: p.id, type: 'super', target: t });
      }
    }
    
    const activeKing = customPieces.find(pk => pk.color === p.color && pk.type === 'king' && pk.hp > 0);
    if (!activeKing) return [];

    return actions.filter(act => {
      if (p.type === 'king' && act.type === 'super') return true;
      const sim = simulateAction(act, customPieces, customWalls, customGraveyard);
      const simKing = sim.simulatedPieces.find(pk => pk.color === p.color && pk.type === 'king' && pk.hp > 0);
      if (!simKing) return false;
      return !isSquareUnderThreat(simKing.position, p.color, sim.simulatedPieces, sim.simulatedWalls);
    });
  };

  const getSavingMovesForPiece = (
    p: Piece,
    customPieces = pieces,
    customWalls = walls,
    customGraveyard = graveyard
  ): AIAction[] => {
    const actions: AIAction[] = [];
    
    // 1. Normal moves
    const moves = getLegalMoves(p, customPieces, customWalls);
    for (const m of moves) {
      actions.push({ pieceId: p.id, type: 'move', target: m });
    }
    
    // 2. Attacks
    const attacks = getLegalAttacks(p, customPieces, customWalls);
    for (const atk of attacks) {
      actions.push({ pieceId: p.id, type: 'attack', target: atk });
    }
    
    // 3. Special ability
    if (p.cooldowns.ability === 0 && !isAbilitySuppressed(p, customPieces)) {
      const abilityTargets = getAbilityTargets(p, customPieces, customWalls);
      for (const t of abilityTargets) {
        actions.push({ pieceId: p.id, type: 'ability', target: t });
      }
    }
    
    // 4. Super
    if (p.superUnlocked) {
      const superTargets = getSuperTargets(p, customPieces, customWalls, customGraveyard);
      for (const t of superTargets) {
        actions.push({ pieceId: p.id, type: 'super', target: t });
      }
    }
    
    const activeKing = customPieces.find(pk => pk.color === p.color && pk.type === 'king' && pk.hp > 0);
    if (!activeKing) return [];
    
    const isUnderThreat = activeKing && isSquareUnderThreat(activeKing.position, p.color, customPieces, customWalls);
    const hasAnyNormalSavingMoves = customPieces
      .filter(pk => pk.color === p.color && pk.hp > 0)
      .some(pk => getNormalSavingMovesForPiece(pk, customPieces, customWalls, customGraveyard).length > 0);
    const isCheckmate = (isUnderThreat && !hasAnyNormalSavingMoves) || (isUnderThreat && (activeKing.consecutiveCheckCount || 0) >= 5);

    return actions.filter(act => {
      if (p.type === 'king' && act.type === 'super') return true;

      // If the King is in checkmate (i.e., has no safe squares to go to anymore),
      // allow the King to move/attack still so that it can eventually escape if possible!
      if (p.type === 'king' && isCheckmate) {
        return true;
      }

      // Special rule: if the King is pushed to a corner without any safe squares to go to, 
      // allow the King to attack any adjacent enemy piece that is currently threatening the King,
      // even if the simulated final position is still under threat.
      if (p.type === 'king' && act.type === 'attack' && isCheckmate) {
        const targetEnemy = customPieces.find(
          enemy => enemy.position.r === act.target.r && enemy.position.c === act.target.c && enemy.color !== p.color && enemy.hp > 0
        );
        if (targetEnemy && !isFrozen(targetEnemy)) {
          const enemyAttacks = getLegalAttacks(targetEnemy, customPieces, customWalls);
          const isThreateningKing = enemyAttacks.some(atk => atk.r === activeKing.position.r && atk.c === activeKing.position.c);
          if (isThreateningKing) {
            return true;
          }
        }
      }

      // Rule for other pieces: if the King is pushed to a corner without any safe squares to go to,
      // allow other pieces to attack the piece or pieces threatening the King, as long as
      // they can eventually generate a safe square for the King (i.e. in simulation, either the King
      // is no longer under threat, or has at least one safe move square to go to).
      if (p.type !== 'king' && isCheckmate && (act.type === 'attack' || act.type === 'ability' || act.type === 'super')) {
        const targetEnemy = customPieces.find(
          enemy => enemy.position.r === act.target.r && enemy.position.c === act.target.c && enemy.color !== p.color && enemy.hp > 0
        );
        if (targetEnemy && !isFrozen(targetEnemy)) {
          const enemyAttacks = getLegalAttacks(targetEnemy, customPieces, customWalls);
          const isThreateningKing = enemyAttacks.some(atk => atk.r === activeKing.position.r && atk.c === activeKing.position.c);
          if (isThreateningKing) {
            const sim = simulateAction(act, customPieces, customWalls, customGraveyard);
            const simKing = sim.simulatedPieces.find(pk => pk.color === p.color && pk.type === 'king' && pk.hp > 0);
            if (simKing) {
              const isKingPosSafe = !isSquareUnderThreat(simKing.position, p.color, sim.simulatedPieces, sim.simulatedWalls);
              const simKingMoves = getLegalMoves(simKing, sim.simulatedPieces, sim.simulatedWalls);
              const hasSafeSimKingMove = simKingMoves.some(m => !isSquareUnderThreat(m, p.color, sim.simulatedPieces, sim.simulatedWalls));
              if (isKingPosSafe || hasSafeSimKingMove) {
                return true;
              }
            }
          }
        }
      }

      const sim = simulateAction(act, customPieces, customWalls, customGraveyard);
      const simKing = sim.simulatedPieces.find(pk => pk.color === p.color && pk.type === 'king' && pk.hp > 0);
      if (!simKing) return false;
      return !isSquareUnderThreat(simKing.position, p.color, sim.simulatedPieces, sim.simulatedWalls);
    });
  };

  // Calculate high-highlight targets based on current state and active menu choice
  const getHighlights = (): Position[] => {
    if (repositionPending) {
      return repositionPending.allowedSquares;
    }
    if (!selectedPiece) return [];
    if (selectedPiece.color !== currentPlayer) return [];

    const activeKing = pieces.find(p => p.color === currentPlayer && p.type === 'king' && p.hp > 0);
    const isUnderThreat = activeKing && isSquareUnderThreat(activeKing.position, currentPlayer, pieces, walls);
    
    const hasAnySavingMoves = pieces
      .filter(p => p.color === currentPlayer && p.hp > 0)
      .some(p => getNormalSavingMovesForPiece(p).length > 0);
    const isCheckmate = (isUnderThreat && !hasAnySavingMoves) || (isUnderThreat && activeKing && (activeKing.consecutiveCheckCount || 0) >= 5);
    const isSecondCheckmate = isCheckmate && activeKing && activeKing.lastStandUsed;

    if (isSecondCheckmate) {
      if (activeAction === 'ability') {
        return getAbilityTargets(selectedPiece, pieces, walls);
      }
      if (activeAction === 'super') {
        return getSuperTargets(selectedPiece, pieces, walls, graveyard);
      }
      const moves = getLegalMoves(selectedPiece, pieces, walls);
      const attacks = getLegalAttacks(selectedPiece, pieces, walls);
      return [...moves, ...attacks];
    }

    const savingActions = getSavingMovesForPiece(selectedPiece);
    if (activeAction === 'ability') {
      return savingActions.filter(act => act.type === 'ability').map(act => act.target);
    }
    if (activeAction === 'super') {
      return savingActions.filter(act => act.type === 'super').map(act => act.target);
    }
    // Default: show both movement paths and legal attack targets together
    return savingActions.filter(act => act.type === 'move' || act.type === 'attack').map(act => act.target);
  };

  const highlightedSquares = getHighlights();

  // Passive processing at the start of a player's turn
  const handleStartOfTurnPassives = (color: PlayerColor, currentPieces: Piece[]) => {
    let updated = currentPieces.map(p => ({ ...p }));
    let logMessages: string[] = [];

    // Reduce cooldowns for the active player's pieces first
    updated = updated.map(p => {
      if (p.color === color) {
        const nextAbilityCooldown = Math.max(0, p.cooldowns.ability - 1);
        const nextPassiveCooldown = Math.max(0, p.passiveCooldown - 1);
        return {
          ...p,
          cooldowns: { ability: nextAbilityCooldown },
          passiveCooldown: nextPassiveCooldown,
          hasSufferedDamageThisTurn: false // Reset turn-level damage shield flags
        };
      }
      return p;
    });

    // Find all active bishops of the active color whose passiveCooldown is 0
    const activeBishops = updated.filter(p => p.color === color && p.type === 'bishop' && p.hp > 0 && p.passiveCooldown === 0);

    const healedAllyIdsThisTurn = new Set<string>();
    
    // Track healed amount in a local variable to prevent React state stale reads in the loop
    const initialStats = color === 'white' ? whiteSuperStats : blackSuperStats;
    let localBishopHealed = initialStats.bishopHealed;

    const getCategory = (p: Piece) => {
      if (p.type === 'king' || p.type === 'queen') return 1;
      if (p.type === 'rook' || p.type === 'bishop' || p.type === 'knight') return 2;
      return 3; // pawn
    };

    for (const bishop of activeBishops) {
      // Find eligible friendly allies
      const eligibleAllies = updated.filter(p => 
        p.color === color &&
        p.hp > 0 &&
        p.id !== bishop.id &&
        !healedAllyIdsThisTurn.has(p.id) &&
        p.hp < p.maxHp
      );

      if (eligibleAllies.length > 0) {
        // Sort: category first (lower value is higher priority), then lowest HP
        eligibleAllies.sort((a, b) => {
          const catA = getCategory(a);
          const catB = getCategory(b);
          if (catA !== catB) return catA - catB;
          return a.hp - b.hp;
        });

        const targetAlly = eligibleAllies[0];

        // Heal target by 1 HP
        const targetIdx = updated.findIndex(p => p.id === targetAlly.id);
        if (targetIdx !== -1) {
          updated[targetIdx] = {
            ...updated[targetIdx],
            hp: Math.min(updated[targetIdx].maxHp, updated[targetIdx].hp + 1)
          };
          healedAllyIdsThisTurn.add(targetAlly.id);

          // Increment local healed count
          localBishopHealed += 1;
          const currentSuperUnlocked = localBishopHealed >= 12;

          // Put bishop on passive cooldown and update its super progress
          const bishopIdx = updated.findIndex(p => p.id === bishop.id);
          if (bishopIdx !== -1) {
            const wasSuperUnlocked = updated[bishopIdx].superUnlocked;
            updated[bishopIdx] = {
              ...updated[bishopIdx],
              passiveCooldown: 3, // 3 turns cooldown
              superProgress: localBishopHealed,
              superUnlocked: wasSuperUnlocked || currentSuperUnlocked
            };

            if (currentSuperUnlocked && !wasSuperUnlocked) {
              logMessages.push(`🌸 Bishop's Resurrection Super UNLOCKED!`);
            }
          }

          // Trigger visual effect on both the Bishop and the healed Ally!
          triggerVisualEffect(
            'ability',
            bishop.position,
            targetAlly.position,
            'bishop',
            color,
            targetAlly.type,
            undefined,
            1
          );

          // Add log message
          logMessages.push(`🌸 Bishop Divine Presence: Restored 1 HP to ${targetAlly.type.toUpperCase()}!`);
        }
      }
    }

    // Now update the React state once with the final cumulative stats
    if (localBishopHealed !== initialStats.bishopHealed) {
      const stats = color === 'white' ? { ...whiteSuperStats } : { ...blackSuperStats };
      stats.bishopHealed = localBishopHealed;
      if (color === 'white') {
        setWhiteSuperStats(stats);
      } else {
        setBlackSuperStats(stats);
      }
    }

    logMessages.forEach(msg => {
      addLog(msg, 'heal', color);
    });

    return updated;
  };

  // Transition turn to the next player
  const transitionToNextPlayer = (
    pendingPieces: Piece[],
    pendingWalls: Wall[],
    pendingGraveyard: Piece[],
    nextPlayer: PlayerColor,
    nextTurnNumber: number,
    nextSpecialTurn: boolean
  ) => {
    // Check if opponent King is dead (Victory conditions)
    const whiteKingAlive = pendingPieces.some(p => p.color === 'white' && p.type === 'king' && p.hp > 0);
    const blackKingAlive = pendingPieces.some(p => p.color === 'black' && p.type === 'king' && p.hp > 0);

    let nextWinner: PlayerColor | null = null;
    if (!whiteKingAlive) {
      nextWinner = 'black';
      setWinner('black');
      sound.playVictory();
      addLog("Black has defeated the White King! Black is Victorious!", "death", "black");
    } else if (!blackKingAlive) {
      nextWinner = 'white';
      setWinner('white');
      sound.playVictory();
      addLog("White has defeated the Black King! White is Victorious!", "heal", "white");
    }

    // Trigger start-of-turn passives for the next player
    let finalPieces = handleStartOfTurnPassives(nextPlayer, pendingPieces);

    // 1. Process ending player's King (currentPlayer) escaping check/Last Stand
    const endingPlayerKingIdx = finalPieces.findIndex(p => p.color === currentPlayer && p.type === 'king' && p.hp > 0);
    if (endingPlayerKingIdx !== -1) {
      const endingKing = finalPieces[endingPlayerKingIdx];
      const endingCheck = isSquareUnderThreat(endingKing.position, currentPlayer, finalPieces, pendingWalls);
      if (!endingCheck) {
        finalPieces[endingPlayerKingIdx] = {
          ...endingKing,
          consecutiveCheckCount: 0,
          inLastStand: false
        };
        if (endingKing.inLastStand) {
          addLog(`🛡️ The ${currentPlayer.toUpperCase()} King has escaped checkmate and returned to normal form.`, 'system', currentPlayer);
        }
      }
    }

    // 2. Process starting player's King (nextPlayer) under check / checkmate / Last Stand
    const nextPlayerKingIdx = finalPieces.findIndex(p => p.color === nextPlayer && p.type === 'king' && p.hp > 0);
    if (nextPlayerKingIdx !== -1) {
      const nextKing = finalPieces[nextPlayerKingIdx];
      const isUnderCheck = isSquareUnderThreat(nextKing.position, nextPlayer, finalPieces, pendingWalls);
      if (isUnderCheck) {
        const nextCount = (nextKing.consecutiveCheckCount || 0) + 1;
        finalPieces[nextPlayerKingIdx] = {
          ...nextKing,
          consecutiveCheckCount: nextCount
        };
        const updatedKing = finalPieces[nextPlayerKingIdx];

        // Find if they have any legal saving moves under current state (excluding Last Stand)
        const hasSavingMovesBeforeLastStand = finalPieces
          .filter(p => p.color === nextPlayer && p.hp > 0)
          .some(p => getNormalSavingMovesForPiece(p, finalPieces, pendingWalls, pendingGraveyard).length > 0);

        if (!hasSavingMovesBeforeLastStand) {
          // This is a checkmate!
          if (!updatedKing.lastStandUsed) {
            // Activate Last Stand Mode!
            finalPieces[nextPlayerKingIdx] = {
              ...updatedKing,
              inLastStand: true,
              lastStandUsed: true
            };
            addLog(`👑 LAST STAND ACTIVATED! The Sovereign of ${nextPlayer.toUpperCase()} enters Last Stand! Damage is doubled and the King can now move 2 tiles in any direction!`, 'super', nextPlayer);
            triggerVisualEffect('lastStand', updatedKing.position, updatedKing.position, 'king', nextPlayer);
            sound.playSuper();
          } else {
            // Checkmate but already used last stand!
            addLog(`⚠️ CHECKMATE! ${nextPlayer.toUpperCase()} King is checkmated a second time! Normal movement restrictions are lifted until the King falls.`, 'system', nextPlayer);
          }
        } else {
          // Normal check (not checkmate)
          if (nextCount >= 5) {
            addLog(`👑 Sovereign's Perseverance: The ${nextPlayer.toUpperCase()} King has been under check for ${nextCount} consecutive turns! Normal movement and combat restrictions are lifted.`, 'super', nextPlayer);
          } else {
            addLog(`⚠️ CHECK! The ${nextPlayer.toUpperCase()} King is under threat!`, 'system', nextPlayer);
          }
        }
      } else {
        // If not under check, make sure to exit Last Stand if we were in it, and reset check count
        finalPieces[nextPlayerKingIdx] = {
          ...nextKing,
          consecutiveCheckCount: 0,
          inLastStand: false
        };
        if (nextKing.inLastStand) {
          addLog(`🛡️ The ${nextPlayer.toUpperCase()} King has escaped checkmate and returned to normal form.`, 'system', nextPlayer);
        }
      }
    }

    setPieces(finalPieces);
    setWalls(pendingWalls);
    setGraveyard(pendingGraveyard);
    setCurrentPlayer(nextPlayer);
    setTurnNumber(nextTurnNumber);
    setSpecialTurn(nextSpecialTurn);
    setSelectedPieceId(null);
    setActiveAction(null);

    // Save and queue AI play if PvE
    saveGameState(
      finalPieces,
      pendingWalls,
      pendingGraveyard,
      nextPlayer,
      nextTurnNumber,
      nextSpecialTurn,
      mode,
      difficulty,
      history,
      whiteSuperStats,
      blackSuperStats
    );

    // Trigger AI move if PvE
    if (mode === 'pve' && nextPlayer !== humanColor) {
      setAiMoveTrigger(prev => prev + 1);
    }
  };

  // Turn management flow transitioning turns
  const endTurn = (updatedPieces: Piece[], updatedWalls: Wall[], updatedGraveyard: Piece[]) => {
    // Process wall durations (decrement remaining turns for walls matching the ending player)
    const nextWalls = updatedWalls
      .map(w => {
        if (w.color === currentPlayer) {
          return { ...w, duration: w.duration - 1 };
        }
        return w;
      })
      .filter(w => w.duration > 0);

    let nextPlayer: PlayerColor;
    let nextTurnNumber: number;
    let nextSpecialTurn = false;

    if (specialTurn) {
      // Ending a special turn - transition back to his original turn (same player)
      nextPlayer = currentPlayer;
      nextTurnNumber = turnNumber;
      nextSpecialTurn = false;
    } else {
      // Normal flow
      nextPlayer = currentPlayer === 'white' ? 'black' : 'white';
      nextTurnNumber = nextPlayer === 'white' ? turnNumber + 1 : turnNumber;
      nextSpecialTurn = false;
    }

    // Process piece status effects and Rook Iron Shell charging at the end of caster's turn
    const processedPieces = updatedPieces.map(p => {
      let nextStatusEffects = [...p.statusEffects];
      let nextColor = p.color;
      let nextOriginalColor = p.originalColor;
      let nextCharmedBy = p.charmedByQueenId;

      // 1. Decrement status effects casted by currentPlayer (only if not newly applied)
      nextStatusEffects = nextStatusEffects.map(se => {
        if (se.casterColor === currentPlayer) {
          if (se.isNew) {
            return { ...se, isNew: false };
          } else {
            return { ...se, duration: se.duration - 1 };
          }
        }
        return se;
      }).filter(se => se.duration > 0);

      // 2. Revert Charmed color if charm wore off
      const wasCharmed = p.statusEffects.some(se => se.type === 'charmed');
      const isCharmed = nextStatusEffects.some(se => se.type === 'charmed');
      if (wasCharmed && !isCharmed && p.originalColor) {
        nextColor = p.originalColor;
        nextOriginalColor = undefined;
        nextCharmedBy = undefined;
        addLog(`${p.type.toUpperCase()}'s charm wore off. Reverted to original owner.`, 'system', nextColor);
      }

      // 3. Rook Iron Shell Passive charging
      let nextIronShellState = p.ironShellState;
      let nextIronShellProgress = p.ironShellProgress;
      if (p.type === 'rook' && p.color === currentPlayer) {
        if (p.ironShellState === 'charging') {
          if (p.hasSufferedDamageThisTurn) {
            nextIronShellProgress = 0;
          } else {
            const currentProgress = p.ironShellProgress || 0;
            nextIronShellProgress = currentProgress + 1;
            if (nextIronShellProgress >= 5) {
              nextIronShellState = 'ready';
              nextIronShellProgress = 0;
              addLog(`Rook's Iron Shell is now READY!`, 'system', p.color);
            }
          }
        }
      }

      // 4. Check King survival metric for King Super Command (Reach Turn 12)
      let nextSuperProgress = p.superProgress;
      let nextSuperUnlocked = p.superUnlocked;
      if (p.type === 'king' && p.hp > 0 && !p.superUnlocked) {
        if (p.color === currentPlayer) {
          const nextProgress = p.superProgress + 1;
          const unlocked = nextProgress >= 12;
          nextSuperProgress = unlocked ? 12 : nextProgress;
          nextSuperUnlocked = unlocked;
          if (unlocked) {
            addLog(`King's Command Super UNLOCKED!`, 'system', p.color);
          }
        }
      }

      // 5. Decrement Rook active super turns
      let nextRookSuperTurns = p.rookSuperTurns;
      if (p.type === 'rook' && p.color === currentPlayer && p.rookSuperTurns !== undefined && p.rookSuperTurns > 0) {
        nextRookSuperTurns = p.rookSuperTurns - 1;
        if (nextRookSuperTurns === 0) {
          addLog(`Rook's Bastion has ended. Movement unlocked.`, 'system', p.color);
        }
      }

      return {
        ...p,
        statusEffects: nextStatusEffects,
        color: nextColor,
        originalColor: nextOriginalColor,
        charmedByQueenId: nextCharmedBy,
        ironShellState: nextIronShellState,
        ironShellProgress: nextIronShellProgress,
        superProgress: nextSuperProgress,
        superUnlocked: nextSuperUnlocked,
        rookSuperTurns: nextRookSuperTurns
      };
    });

    // Otherwise transition immediately
    transitionToNextPlayer(processedPieces, nextWalls, updatedGraveyard, nextPlayer, nextTurnNumber, nextSpecialTurn);
  };

  // AI execution trigger logic
  useEffect(() => {
    if (!gameStarted || winner || isPaused || promotionPending || repositionPending || resurrectionPending) return;

    if (mode === 'pve' && currentPlayer !== humanColor) {
      const timer = setTimeout(() => {
        executeAIMove();
      }, 1000); // 1-second strategic delay to make the move human-readable
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameStarted, isPaused, mode, winner, promotionPending, repositionPending, resurrectionPending, aiMoveTrigger, humanColor, specialTurn]);

  const executeAIMove = () => {
    const aiAction = getBestAction(difficulty, pieces, walls, graveyard, currentPlayer);
    if (!aiAction) {
      // Pass turn if no actions available
      endTurn(pieces, walls, graveyard);
      return;
    }

    const actor = pieces.find(p => p.id === aiAction.pieceId);
    if (!actor) {
      endTurn(pieces, walls, graveyard);
      return;
    }

    // Select piece to visualize AI action
    setSelectedPieceId(actor.id);

    setTimeout(() => {
      handleCellAction(actor, aiAction.target, aiAction.type);
    }, 400);
  };

  // Core cell clicks or Action triggers
  const onSquareClick = (pos: Position) => {
    if (repositionPending) {
      const isAllowed = repositionPending.allowedSquares.some(sq => sq.r === pos.r && sq.c === pos.c);
      if (isAllowed) {
        resolveReposition(pos);
      } else {
        const knight = pieces.find(p => p.id === repositionPending.pieceId);
        addLog(`Invalid destination! You must move the Knight to an empty L-shaped square.`, 'system', knight?.color);
      }
      return;
    }
    if (!gameStarted || winner || isPaused || promotionPending || resurrectionPending) return;
    if (mode === 'pve' && currentPlayer !== humanColor) return; // Blocks clicks during AI turns

    const clickedPiece = getPieceAt(pos, pieces);

    // If a piece is already selected and we click on a highlighted action square:
    if (selectedPiece && highlightedSquares.some(sq => sq.r === pos.r && sq.c === pos.c)) {
      let actionType: 'move' | 'attack' | 'ability' | 'super' = 'move';
      if (activeAction) {
        actionType = activeAction;
      } else if (clickedPiece && clickedPiece.color !== currentPlayer) {
        actionType = 'attack';
      }
      handleCellAction(selectedPiece, pos, actionType);
      return;
    }

    // Otherwise, select/deselect pieces
    if (clickedPiece && clickedPiece.color === currentPlayer) {
      const activeKing = pieces.find(p => p.color === currentPlayer && p.type === 'king' && p.hp > 0);
      const isUnderThreat = activeKing && isSquareUnderThreat(activeKing.position, currentPlayer, pieces, walls);
      const hasAnySavingMoves = pieces
        .filter(p => p.color === currentPlayer && p.hp > 0)
        .some(p => getNormalSavingMovesForPiece(p).length > 0);
      const isCheckmate = (isUnderThreat && !hasAnySavingMoves) || (isUnderThreat && activeKing && (activeKing.consecutiveCheckCount || 0) >= 5);
      const isSecondCheckmate = isCheckmate && activeKing && activeKing.lastStandUsed;

      if (isUnderThreat && !isSecondCheckmate) {
        const savingMoves = getSavingMovesForPiece(clickedPiece);
        if (savingMoves.length === 0) {
          addLog(`Your King is under threat! This piece has no moves that can protect your King or resolve the threat.`, 'system', currentPlayer);
          return;
        }
      }
      sound.playClick();
      setSelectedPieceId(clickedPiece.id);
      setActiveAction(null);
    } else if (clickedPiece) {
      // It's an enemy piece! Select it to inspect status without any operational actions.
      sound.playClick();
      setSelectedPieceId(clickedPiece.id);
      setActiveAction(null);
    } else {
      setSelectedPieceId(null);
      setActiveAction(null);
    }
  };

  // General damage handler implementing Rook shield, Pawn frenzy, Knight evasion
  const applyDamage = (victim: Piece, attacker: Piece, dmg: number, currentPieces: Piece[], currentGraveyard: Piece[]) => {
    let updated = currentPieces.map(p => ({ ...p }));
    let target = updated.find(p => p.id === victim.id);
    if (!target) return { updatedPieces: updated, updatedGraveyard: currentGraveyard, survived: false, damageDealt: 0 };

    let actualDmg = dmg;

    // Rook's Bastion Super Area check:
    // If the target is NOT a Rook with an active Bastion (rookSuperTurns > 0),
    // and there is an active friendly Rook with an active Bastion within 3 tiles,
    // reduce damage to 50% rounded up and redirect the remaining damage with 50% reduction to that Rook.
    if (target.type !== 'rook' || !target.rookSuperTurns || target.rookSuperTurns <= 0) {
      const activeSuperRook = updated.find(p => 
        p.type === 'rook' && 
        p.color === target.color && 
        p.hp > 0 && 
        p.rookSuperTurns !== undefined && 
        p.rookSuperTurns > 0 &&
        Math.max(Math.abs(p.position.r - target.position.r), Math.abs(p.position.c - target.position.c)) <= 3
      );
      if (activeSuperRook && actualDmg > 0) {
        const targetDmg = Math.ceil(actualDmg / 2);
        const remainingDmg = actualDmg - targetDmg;
        const rookDmg = Math.floor(remainingDmg / 2);

        addLog(`🛡️ BASTION SHIELD: ${target.type.toUpperCase()} within Rook's Bastion takes reduced ${targetDmg} damage! Rook absorbs ${rookDmg} damage!`, 'system', target.color);

        if (rookDmg > 0) {
          const rookRes = applyDamage(activeSuperRook, attacker, rookDmg, updated, currentGraveyard);
          updated = rookRes.updatedPieces;
          currentGraveyard = rookRes.updatedGraveyard;
        }

        // Re-find the target because updated list has changed
        target = updated.find(p => p.id === victim.id);
        if (!target) {
          return { updatedPieces: updated, updatedGraveyard: currentGraveyard, survived: false, damageDealt: rookDmg };
        }
        
        actualDmg = targetDmg;
      }
    }

    // Grey Shield check: split damage between the target and the Rook caster
    const greyShieldEffect = target.statusEffects.find(se => se.type === 'greyShield');
    if (greyShieldEffect && greyShieldEffect.casterId && dmg > 0) {
      const rookPiece = updated.find(p => p.id === greyShieldEffect.casterId && p.hp > 0);
      if (rookPiece) {
        const rookDmg = Math.floor(dmg / 2);
        const targetDmg = dmg - rookDmg;
        
        addLog(`🛡️ Grey Shield: ${target.type.toUpperCase()} takes ${targetDmg} dmg, Rook takes ${rookDmg} absorbed dmg!`, 'system', target.color);
        
        // 1. Deal rookDmg to Rook (recursive applyDamage call)
        const rookRes = applyDamage(rookPiece, attacker, rookDmg, updated, currentGraveyard);
        updated = rookRes.updatedPieces;
        currentGraveyard = rookRes.updatedGraveyard;
        
        // 2. Track this damage absorption for Rook Super progress!
        const freshRook = updated.find(p => p.id === rookPiece.id);
        if (freshRook) {
          const stats = freshRook.color === 'white' ? { ...whiteSuperStats } : { ...blackSuperStats };
          const nextAbsorbed = stats.rookDamageAbsorbed + rookDmg;
          stats.rookDamageAbsorbed = nextAbsorbed;
          
          if (freshRook.color === 'white') {
            setWhiteSuperStats(stats);
          } else {
            setBlackSuperStats(stats);
          }
          
          freshRook.superProgress = nextAbsorbed;
          if (nextAbsorbed >= 12 && !freshRook.superUnlocked) {
            freshRook.superUnlocked = true;
            addLog(`Rook's Bastion Super UNLOCKED!`, 'system', freshRook.color);
          }
        }
        
        // Re-find the target because updated list has changed
        target = updated.find(p => p.id === victim.id);
        if (!target) {
          return { updatedPieces: updated, updatedGraveyard: currentGraveyard, survived: false, damageDealt: rookDmg };
        }
        
        actualDmg = targetDmg;
      }
    }

    // Rook Passive check: Iron Shell negates damage entirely when Ready
    if (target.type === 'rook' && target.ironShellState === 'ready') {
      target.ironShellState = 'charging';
      target.ironShellProgress = 0;
      target.hasSufferedDamageThisTurn = true; // Mark as suffered damage so charge does not progress this turn
      addLog(`Rook's Iron Shell negated the damage entirely! Now charging.`, 'system', target.color);

      // Track Rook passive damage absorption
      const stats = target.color === 'white' ? { ...whiteSuperStats } : { ...blackSuperStats };
      const nextAbsorbed = stats.rookDamageAbsorbed + actualDmg;
      stats.rookDamageAbsorbed = nextAbsorbed;
      if (target.color === 'white') {
        setWhiteSuperStats(stats);
      } else {
        setBlackSuperStats(stats);
      }

      target.superProgress = nextAbsorbed;
      if (nextAbsorbed >= 12 && !target.superUnlocked) {
        target.superUnlocked = true;
        addLog(`Rook's Bastion Super UNLOCKED!`, 'system', target.color);
      }

      return { updatedPieces: updated, updatedGraveyard: currentGraveyard, survived: true, damageDealt: 0 };
    }

    // Pawn Shield check: Negates damage entirely when active
    const hasPawnShield = target.type === 'pawn' && target.statusEffects.some(se => se.type === 'armor');
    if (hasPawnShield) {
      target.statusEffects = target.statusEffects.filter(se => se.type !== 'armor');
      addLog(`Pawn's Shield braced, negated the damage entirely, and was consumed!`, 'system', target.color);
      return { updatedPieces: updated, updatedGraveyard: currentGraveyard, survived: true, damageDealt: 0 };
    }

    const armor = getArmor(target);
    const netDmg = Math.max(0, actualDmg - armor);

    // Reduce Armor status value
    if (armor > 0) {
      target.statusEffects = target.statusEffects.map(se => {
        if (se.type === 'armor') {
          const nextVal = Math.max(0, (se.value || 0) - actualDmg);
          return { ...se, value: nextVal };
        }
        return se;
      }).filter(se => se.type !== 'armor' || (se.value && se.value > 0));
    }

    const finalHp = Math.max(0, target.hp - netDmg);
    target.hp = finalHp;
    target.hasSufferedDamageThisTurn = true;

    let survived = finalHp > 0;
    let finalGraveyard = [...currentGraveyard];

    let repoPending: { pieceId: string; allowedSquares: Position[] } | null = null;

    if (!survived) {
      sound.playDeath();
      addLog(`${target.color.toUpperCase()} ${target.type.toUpperCase()} was eliminated!`, 'death', target.color);
      finalGraveyard.push({ ...target });
      updated = updated.filter(p => p.id !== target.id);

      // Track Knight Kill Super Metric
      if (attacker.type === 'knight') {
        const stats = attacker.color === 'white' ? { ...whiteSuperStats } : { ...blackSuperStats };
        const nextKills = stats.knightKills + 1;
        stats.knightKills = nextKills;
        if (attacker.color === 'white') {
          setWhiteSuperStats(stats);
        } else {
          setBlackSuperStats(stats);
        }

        // Update attacker unlock flag directly if matching criteria
        const attackerPiece = updated.find(p => p.id === attacker.id);
        if (attackerPiece) {
          attackerPiece.superProgress = nextKills;
          if (nextKills >= 2) attackerPiece.superUnlocked = true;
        }
      }
    } else {
      sound.playHit();
      addLog(`${target.type.toUpperCase()} took ${netDmg} damage (${target.hp}/${target.maxHp} HP left).`, 'attack', target.color);

      // Knight Passive: Tactical Evasion (Move in L-shaped movement after taking damage)
      if (target.type === 'knight' && target.passiveCooldown === 0) {
        const jumps = [
          [-2, -1], [-2, 1], [-1, -2], [-1, 2],
          [1, -2],  [1, 2],  [2, -1],  [2, 1]
        ];
        const escapes: Position[] = [];
        for (const [dr, dc] of jumps) {
          const nr = target.position.r + dr;
          const nc = target.position.c + dc;
          if (inBounds(nr, nc)) {
            const pos = { r: nr, c: nc };
            const blockedByWall = walls.some(w => w.position.r === nr && w.position.c === nc);
            const blockedByPiece = updated.some(p => p.position.r === nr && p.position.c === nc && p.hp > 0);
            if (!blockedByWall && !blockedByPiece) {
              escapes.push(pos);
            }
          }
        }

        if (escapes.length > 0) {
          target.passiveCooldown = 3;
          const ownerColor = target.color;
          const isAI = mode === 'pve' && ownerColor !== humanColor;
          if (isAI) {
            const escapePos = escapes[Math.floor(Math.random() * escapes.length)];
            target.position = escapePos;
            addLog(`AI Knight used Tactical Evasion to escape to Row ${8 - escapePos.r}, Col ${String.fromCharCode(65 + escapePos.c)}!`, 'ability', target.color);
          } else {
            repoPending = { pieceId: target.id, allowedSquares: escapes };
            addLog(`Knight triggers Tactical Evasion! Reposition pending...`, 'ability', target.color);
          }
        }
      }
    }

    return { updatedPieces: updated, updatedGraveyard: finalGraveyard, survived, damageDealt: netDmg, repositionPending: repoPending };
  };

  // Perform selected action
  const handleCellAction = (actor: Piece, targetPos: Position, actionType: 'move' | 'attack' | 'ability' | 'super') => {
    let nextPieces = pieces.map(p => ({ ...p }));
    let nextWalls = [...walls];
    let nextGraveyard = [...graveyard];
    let pendingRepo: { pieceId: string; allowedSquares: Position[] } | null = null;

    const actorIdx = nextPieces.findIndex(p => p.id === actor.id);
    if (actorIdx === -1) return;

    if (actionType === 'move') {
      sound.playMove();
      
      // Update coordinates
      const startCell = `${String.fromCharCode(65 + actor.position.c)}${8 - actor.position.r}`;
      const endCell = `${String.fromCharCode(65 + targetPos.c)}${8 - targetPos.r}`;
      
      // Castling Check!
      if (actor.type === 'king' && Math.abs(targetPos.c - actor.position.c) === 2) {
        const isKingside = targetPos.c === 6;
        const rookColSrc = isKingside ? 7 : 0;
        const rookColDst = isKingside ? 5 : 3;
        const rookIdx = nextPieces.findIndex(p => p.position.r === actor.position.r && p.position.c === rookColSrc && p.color === actor.color && p.type === 'rook');
        if (rookIdx !== -1) {
          nextPieces[rookIdx].position = { r: actor.position.r, c: rookColDst };
          nextPieces[rookIdx].hasMoved = true;
          addLog(`${actor.color.toUpperCase()} castled ${isKingside ? 'Kingside' : 'Queenside'}.`, 'move');
        }
      }

      nextPieces[actorIdx].position = { ...targetPos };
      nextPieces[actorIdx].hasMoved = true;
      addLog(`${actor.color.toUpperCase()} ${actor.type.toUpperCase()} moved from ${startCell} to ${endCell}.`, 'move');

      // Check standard Pawn Promotion trigger condition
      const isPromotionRow = actor.color === 'white' ? targetPos.r === 0 : targetPos.r === 7;
      if (actor.type === 'pawn' && isPromotionRow) {
        if (mode === 'pve' && currentPlayer !== humanColor) {
          promotePawnDirectly(actor.id, targetPos, 'queen', nextPieces, nextWalls, nextGraveyard);
          return;
        } else {
          setPromotionPending({ pieceId: actor.id, position: targetPos });
          setPieces(nextPieces);
          return; // Pause turn cycle waiting for promotion choice
        }
      }

      endTurn(nextPieces, nextWalls, nextGraveyard);
    } else if (actionType === 'attack') {
      const victim = nextPieces.find(p => p.position.r === targetPos.r && p.position.c === targetPos.c && p.hp > 0);
      let dmgDealt = 0;
      let survived = true;

      // Determine pre-attack position
      let preAttackPos = { ...actor.position };
      if (actor.type === 'queen' || actor.type === 'bishop' || actor.type === 'rook') {
        const dr = Math.sign(targetPos.r - actor.position.r);
        const dc = Math.sign(targetPos.c - actor.position.c);
        preAttackPos = { r: targetPos.r - dr, c: targetPos.c - dc };
      } else if (actor.type === 'knight') {
        const adjacentDirs = [
          [-1, 0], [1, 0], [0, -1], [0, 1],
          [-1, -1], [-1, 1], [1, -1], [1, 1]
        ];
        const landing = adjacentDirs
          .map(([dr, dc]) => ({ r: targetPos.r + dr, c: targetPos.c + dc }))
          .find(pos => inBounds(pos.r, pos.c) && !isSquareBlockedByWall(pos, nextWalls) && !getPieceAt(pos, nextPieces));
        if (landing) {
          preAttackPos = landing;
        }
      }

      if (victim) {
        const dmg = getEffectiveAttack(actor);
        const dmgRes = applyDamage(victim, actor, dmg, nextPieces, nextGraveyard);
        nextPieces = dmgRes.updatedPieces;
        nextGraveyard = dmgRes.updatedGraveyard;
        dmgDealt = dmgRes.damageDealt;
        survived = dmgRes.survived;
        if (dmgRes.repositionPending) {
          pendingRepo = dmgRes.repositionPending;
        }
      }

      // Update position of the attacker based on survival/defeat outcome
      const currentActor = nextPieces.find(p => p.id === actor.id);
      if (currentActor) {
        currentActor.hasMoved = true;
        if (!survived) {
          // Occupies defeated piece's square
          currentActor.position = { ...targetPos };
          addLog(`${actor.type.toUpperCase()} moved onto defeated piece's square at Row ${8 - targetPos.r}, Col ${String.fromCharCode(65 + targetPos.c)}.`, 'move');
        } else {
          if (actor.type === 'queen' || actor.type === 'bishop' || actor.type === 'rook') {
            currentActor.position = { ...preAttackPos };
            addLog(`${actor.type.toUpperCase()} slid to adjacent square Row ${8 - preAttackPos.r}, Col ${String.fromCharCode(65 + preAttackPos.c)} as enemy survived.`, 'move');
          } else if (actor.type === 'knight') {
            // Knight returns to starting square
            currentActor.position = { ...actor.position };
            addLog(`Knight returned to original square Row ${8 - actor.position.r}, Col ${String.fromCharCode(65 + actor.position.c)} as enemy survived.`, 'move');
          } else {
            // King and Pawn remain on starting square
            currentActor.position = { ...actor.position };
          }
        }

        // Check Pawn Promotion trigger condition after occupying defeated square on back rank
        const isPromotionRow = actor.color === 'white' ? currentActor.position.r === 0 : currentActor.position.r === 7;
        if (actor.type === 'pawn' && isPromotionRow) {
          if (mode === 'pve' && currentPlayer !== humanColor) {
            promotePawnDirectly(actor.id, currentActor.position, 'queen', nextPieces, nextWalls, nextGraveyard);
            return;
          } else {
            setPromotionPending({ pieceId: actor.id, position: currentActor.position });
            setPieces(nextPieces);
            return; // Pause turn cycle waiting for promotion choice
          }
        }
      }

      triggerVisualEffect(
        'attack',
        actor.position,
        targetPos,
        actor.type,
        actor.color,
        victim ? victim.type : undefined,
        dmgDealt
      );

      if (pendingRepo) {
        setRepositionPending(pendingRepo);
        setPieces(nextPieces);
        setWalls(nextWalls);
        setGraveyard(nextGraveyard);
        setSelectedPieceId(pendingRepo.pieceId);
        setActiveAction(null);
        return;
      }

      endTurn(nextPieces, nextWalls, nextGraveyard);
    } else if (actionType === 'ability') {
      // Cooldown set
      nextPieces[actorIdx].cooldowns.ability = actor.type === 'pawn' ? 2 : 3;

      if (actor.type === 'king') {
        // Royal Call (Summon Pawn)
        sound.playHeal();
        const deadPawn = nextGraveyard.find(p => p.color === actor.color && p.type === 'pawn');
        if (deadPawn) {
          const summonedPawn: Piece = {
            ...deadPawn,
            id: `${actor.color}-pawn-summoned-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            hp: 4,
            maxHp: 4,
            position: { ...targetPos },
            cooldowns: { ability: 0 },
            superProgress: 0,
            superUnlocked: false,
            statusEffects: [],
            passiveCooldown: 0
          };
          nextPieces.push(summonedPawn);
          nextGraveyard = nextGraveyard.filter(p => p.id !== deadPawn.id);
          addLog(`King summoned a Sentry Pawn adjacent to Row ${8 - targetPos.r}, Col ${String.fromCharCode(65 + targetPos.c)}!`, 'ability');
        } else {
          const summonedPawn: Piece = {
            id: `${actor.color}-pawn-summoned-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            type: 'pawn',
            color: actor.color,
            position: { ...targetPos },
            hp: 4,
            maxHp: 4,
            attack: 2,
            cooldowns: { ability: 0 },
            superProgress: 0,
            superUnlocked: false,
            statusEffects: [],
            passiveCooldown: 0
          };
          nextPieces.push(summonedPawn);
          addLog(`King summoned a Sentry Pawn adjacent to Row ${8 - targetPos.r}, Col ${String.fromCharCode(65 + targetPos.c)}!`, 'ability');
        }
        triggerVisualEffect('ability', actor.position, targetPos, actor.type, actor.color);
      } else if (actor.type === 'queen') {
        // Charm (Convert target piece for 1 turn, cannot target King/Queen)
        sound.playFreeze();
        const targetPiece = nextPieces.find(p => p.position.r === targetPos.r && p.position.c === targetPos.c && p.hp > 0);
        if (targetPiece && targetPiece.type !== 'king' && targetPiece.type !== 'queen') {
          if (!targetPiece.originalColor) {
            targetPiece.originalColor = targetPiece.color;
          }
          targetPiece.color = actor.color;
          targetPiece.charmedByQueenId = actor.id;
          targetPiece.statusEffects.push({ type: 'charmed', duration: 1, casterColor: actor.color, isNew: true });
          addLog(`Queen charmed enemy ${targetPiece.type.toUpperCase()}! They now fight for the ${actor.color.toUpperCase()} Kingdom.`, 'ability');

          // Track Queen unique charm count for Super Unlock (Royal Lockdown)
          const stats = actor.color === 'white' ? { ...whiteSuperStats } : { ...blackSuperStats };
          stats.queenFreezes.add(targetPiece.id); // Reusing queenFreezes Set for unique charm tracking
          if (actor.color === 'white') {
            setWhiteSuperStats(stats);
          } else {
            setBlackSuperStats(stats);
          }

          // Update Queen super unlock progress
          const currentQueen = nextPieces.find(p => p.id === actor.id);
          if (currentQueen) {
            const count = stats.queenFreezes.size;
            currentQueen.superProgress = count;
            if (count >= 2) {
              currentQueen.superUnlocked = true;
              addLog(`Queen's Royal Lockdown Super UNLOCKED!`, 'system', actor.color);
            }
          }
        }
        triggerVisualEffect('ability', actor.position, targetPos, actor.type, actor.color, targetPiece?.type);
      } else if (actor.type === 'bishop') {
        // Heal
        sound.playHeal();
        const targetPiece = nextPieces.find(p => p.position.r === targetPos.r && p.position.c === targetPos.c && p.hp > 0);
        let healAmount = 0;
        if (targetPiece) {
          const maxHeal = Math.ceil(targetPiece.maxHp * 0.3);
          healAmount = Math.min(targetPiece.maxHp - targetPiece.hp, maxHeal);
          targetPiece.hp = targetPiece.hp + healAmount;
          addLog(`Bishop healed ${targetPiece.type.toUpperCase()} (+${healAmount} HP restored, 30% of max HP)!`, 'heal');

          // Track Bishop healing stats
          const stats = actor.color === 'white' ? { ...whiteSuperStats } : { ...blackSuperStats };
          const totalHealed = stats.bishopHealed + healAmount;
          stats.bishopHealed = totalHealed;
          if (actor.color === 'white') {
            setWhiteSuperStats(stats);
          } else {
            setBlackSuperStats(stats);
          }

          // Bishop Super progress
          const currentBishop = nextPieces.find(p => p.id === actor.id);
          if (currentBishop) {
            currentBishop.superProgress = totalHealed;
            if (totalHealed >= 12) currentBishop.superUnlocked = true;
          }
        }
        triggerVisualEffect('ability', actor.position, targetPos, actor.type, actor.color, targetPiece?.type, undefined, healAmount);
      } else if (actor.type === 'knight') {
        // Move & Charge
        sound.playMove();
        
        const opponentColor = actor.color === 'white' ? 'black' : 'white';
        // Check if there is an enemy piece on the target square directly
        const targetPieceOnSquare = nextPieces.find(p => p.position.r === targetPos.r && p.position.c === targetPos.c && p.color === opponentColor && p.hp > 0);
        
        nextPieces[actorIdx].position = { ...targetPos };
        
        if (targetPieceOnSquare) {
          addLog(`Knight charges directly into ${targetPieceOnSquare.type.toUpperCase()}, dealing massive 5 damage!`, 'ability');
          const dmgRes = applyDamage(targetPieceOnSquare, actor, 5, nextPieces, nextGraveyard);
          nextPieces = dmgRes.updatedPieces;
          nextGraveyard = dmgRes.updatedGraveyard;
          if (dmgRes.repositionPending) {
            pendingRepo = dmgRes.repositionPending;
          }
          triggerVisualEffect('attack', actor.position, targetPos, actor.type, actor.color, targetPieceOnSquare.type, 5);
        }

        const adjacentDirs = [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
          [1, -1],  [1, 0],  [1, 1]
        ];
        
        const enemiesToHit: Piece[] = [];
        for (const [dr, dc] of adjacentDirs) {
          const nr = targetPos.r + dr;
          const nc = targetPos.c + dc;
          const enemy = nextPieces.find(p => p.position.r === nr && p.position.c === nc && p.color === opponentColor && p.hp > 0 && p.id !== targetPieceOnSquare?.id);
          if (enemy && !enemiesToHit.some(e => e.id === enemy.id)) {
            enemiesToHit.push(enemy);
          }
        }

        for (const enemyToHit of enemiesToHit) {
          const currentEnemy = nextPieces.find(p => p.id === enemyToHit.id);
          if (currentEnemy && currentEnemy.hp > 0) {
            if (targetPieceOnSquare) {
              addLog(`Knight's Iron Charge shockwave deals 2 damage to ${currentEnemy.type.toUpperCase()}!`, 'ability');
            } else {
              addLog(`Knight charges and hit ${currentEnemy.type.toUpperCase()} with adjacent shockwave!`, 'ability');
            }
            const dmgRes = applyDamage(currentEnemy, actor, 2, nextPieces, nextGraveyard);
            nextPieces = dmgRes.updatedPieces;
            nextGraveyard = dmgRes.updatedGraveyard;
            if (dmgRes.repositionPending) {
              pendingRepo = dmgRes.repositionPending;
            }
            triggerVisualEffect('attack', targetPos, currentEnemy.position, actor.type, actor.color, currentEnemy.type, 2);
          }
        }
        triggerVisualEffect('ability', actor.position, targetPos, actor.type, actor.color);
      } else if (actor.type === 'rook') {
        // Grey Bastion: Grant a Grey Shield to a friendly ally within 2 squares
        sound.playHeal();
        const targetPiece = nextPieces.find(p => p.position.r === targetPos.r && p.position.c === targetPos.c && p.hp > 0);
        if (targetPiece) {
          // Remove any existing grey shield from this target to prevent duplication
          targetPiece.statusEffects = targetPiece.statusEffects.filter(se => se.type !== 'greyShield');
          
          targetPiece.statusEffects.push({
            type: 'greyShield',
            duration: 3,
            casterColor: actor.color,
            casterId: actor.id,
            isNew: true
          });
          addLog(`Rook raised Grey Bastion shield on allied ${targetPiece.type.toUpperCase()}! They will split incoming damage with the Rook for 3 turns.`, 'ability');
        }
        triggerVisualEffect('ability', actor.position, targetPos, actor.type, actor.color, targetPiece?.type);
      } else if (actor.type === 'pawn') {
        // Brace (Armor)
        sound.playHeal();
        const targetPiece = nextPieces[actorIdx];
        const existingArmorIdx = targetPiece.statusEffects.findIndex(se => se.type === 'armor');
        if (existingArmorIdx > -1) {
          targetPiece.statusEffects[existingArmorIdx].value = 2;
          targetPiece.statusEffects[existingArmorIdx].duration = 1; // 1 turn duration (removed after next turn)
          targetPiece.statusEffects[existingArmorIdx].isNew = true;  // Mark as new so it doesn't count down this turn
        } else {
          targetPiece.statusEffects.push({ type: 'armor', duration: 1, value: 2, casterColor: actor.color, isNew: true });
        }
        addLog(`Pawn fortified itself, raising a complete damage-blocking shield!`, 'ability');
        triggerVisualEffect('ability', actor.position, actor.position, actor.type, actor.color);
      }

      if (pendingRepo) {
        setRepositionPending(pendingRepo);
        setPieces(nextPieces);
        setWalls(nextWalls);
        setGraveyard(nextGraveyard);
        setSelectedPieceId(pendingRepo.pieceId);
        setActiveAction(null);
        return;
      }

      endTurn(nextPieces, nextWalls, nextGraveyard);
    } else if (actionType === 'super') {
      sound.playSuper();
      nextPieces[actorIdx].superUnlocked = false; // Expend super
      nextPieces[actorIdx].superProgress = 0; // Reset progress

      // Reset corresponding player stats for this super type
      const stats = actor.color === 'white' ? { ...whiteSuperStats } : { ...blackSuperStats };
      if (actor.type === 'queen') {
        stats.queenFreezes = new Set<string>();
      } else if (actor.type === 'bishop') {
        stats.bishopHealed = 0;
      } else if (actor.type === 'knight') {
        stats.knightKills = 0;
      } else if (actor.type === 'rook') {
        stats.rookDamageAbsorbed = 0;
      }

      if (actor.color === 'white') {
        setWhiteSuperStats(stats);
      } else {
        setBlackSuperStats(stats);
      }

      if (actor.type === 'king') {
        // King's Command (Extra Turn)
        const entry = addLog(`KING'S COMMAND: Sovereign gain 1 extra immediate turn!`, 'super');
        triggerVisualEffect('super', actor.position, actor.position, actor.type, actor.color);
        
        // Instead of ending the turn, we give them a special turn directly without ending the current turn.
        setPieces(nextPieces);
        setSpecialTurn(true);
        setSelectedPieceId(null);
        setActiveAction(null);

        saveGameState(
          nextPieces,
          nextWalls,
          nextGraveyard,
          currentPlayer,
          turnNumber,
          true,
          mode,
          difficulty,
          [...history, entry],
          whiteSuperStats,
          blackSuperStats
        );
        return;
      } else if (actor.type === 'queen') {
        // Royal Lockdown (Freeze all visible enemy pieces along a chosen line of sight for 2 turns)
        const dr = Math.sign(targetPos.r - actor.position.r);
        const dc = Math.sign(targetPos.c - actor.position.c);
        addLog(`QUEEN'S DECREE: Royal Lockdown unleashed!`, 'super');

        let step = 1;
        while (true) {
          const nr = actor.position.r + step * dr;
          const nc = actor.position.c + step * dc;
          if (!inBounds(nr, nc)) break;
          const pos = { r: nr, c: nc };
          if (isSquareBlockedByWall(pos, nextWalls)) {
            break; // Blocked by wall
          }
          const targetPiece = nextPieces.find(p => p.position.r === nr && p.position.c === nc && p.hp > 0);
          if (targetPiece) {
            if (targetPiece.color !== actor.color) {
              if (targetPiece.type === 'king') {
                addLog(`Sovereign Guard: Enemy King is immune to freeze CC!`, 'system');
              } else {
                targetPiece.statusEffects.push({ type: 'frozen', duration: 2, casterColor: actor.color, isNew: true });
                addLog(`Opponent ${targetPiece.type.toUpperCase()} frozen in line of sight!`, 'system');
              }
            }
          }
          step++;
        }
        triggerVisualEffect('super', actor.position, targetPos, actor.type, actor.color);
      } else if (actor.type === 'bishop') {
        // Resurrection (Defeated piece must not be a King)
        if (mode === 'pve' && currentPlayer !== humanColor) {
          // AI automatically chooses the best piece to revive (prioritize officials over pawns)
          const deadCandidates = nextGraveyard.filter(p => p.color === actor.color && p.type !== 'king');
          const typePriority: Record<string, number> = { queen: 5, rook: 4, knight: 3, bishop: 3, pawn: 1 };
          const sortedFallen = [...deadCandidates].sort((a, b) => (typePriority[b.type] || 0) - (typePriority[a.type] || 0));
          const dead = sortedFallen[0];
          
          if (dead) {
            const revived: Piece = {
              ...dead,
              id: `${actor.color}-revived-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
              hp: Math.floor(dead.maxHp / 2),
              position: { ...targetPos },
              cooldowns: { ability: 0 },
              superProgress: 0,
              superUnlocked: false,
              statusEffects: [],
              passiveCooldown: 0
            };
            nextPieces.push(revived);
            nextGraveyard = nextGraveyard.filter(p => p.id !== dead.id);
            addLog(`RESURRECTION: Bishop revived fallen ${dead.type.toUpperCase()} with half health!`, 'super');
          }
          triggerVisualEffect('super', actor.position, targetPos, actor.type, actor.color);
          endTurn(nextPieces, nextWalls, nextGraveyard);
          return;
        } else {
          // Player's Bishop Super Resurrection: ask player which fallen piece to revive
          setResurrectionPending({
            actorId: actor.id,
            position: targetPos,
            nextPieces,
            nextWalls,
            nextGraveyard
          });
          return; // Pause turn cycle waiting for piece choice
        }
      } else if (actor.type === 'knight') {
        // Decisive Strike (Instantly slay target and leap onto their square)
        const victim = nextPieces.find(p => p.position.r === targetPos.r && p.position.c === targetPos.c && p.hp > 0);
        if (victim && victim.type !== 'king') {
          victim.hp = 0;
          nextGraveyard.push({ ...victim });
          nextPieces = nextPieces.filter(p => p.id !== victim.id);
          addLog(`DECISIVE STRIKE: Knight executed opponent ${victim.type.toUpperCase()} instantly and leaped onto their square!`, 'super');
          
          const currentActorIdx = nextPieces.findIndex(p => p.id === actor.id);
          if (currentActorIdx !== -1) {
            nextPieces[currentActorIdx].position = { ...targetPos };
          }
        }
        triggerVisualEffect('super', actor.position, targetPos, actor.type, actor.color, victim?.type);
      } else if (actor.type === 'rook') {
        // Rook's Bastion: lock into place for 5 turns
        const currentActorIdx = nextPieces.findIndex(p => p.id === actor.id);
        if (currentActorIdx !== -1) {
          nextPieces[currentActorIdx].rookSuperTurns = 5;
        }
        addLog(`ROOK'S BASTION: Rook locks into place, creating a massive 3-tile damage mitigation field for 5 turns!`, 'super');
        triggerVisualEffect('super', actor.position, actor.position, actor.type, actor.color);
      }

      if (pendingRepo) {
        setRepositionPending(pendingRepo);
        setPieces(nextPieces);
        setWalls(nextWalls);
        setGraveyard(nextGraveyard);
        setSelectedPieceId(pendingRepo.pieceId);
        setActiveAction(null);
        return;
      }

      endTurn(nextPieces, nextWalls, nextGraveyard);
    }
  };

  // Complete Pawn promotion automatically for AI
  const promotePawnDirectly = (
    pieceId: string,
    position: Position,
    type: PieceType,
    currentPieces: Piece[],
    currentWalls: Wall[],
    currentGraveyard: Piece[]
  ) => {
    sound.playHeal();
    const nextPieces = currentPieces.map(p => {
      if (p.id === pieceId) {
        let maxHp = 4;
        let attack = 2;
        switch (type) {
          case 'queen': maxHp = 10; attack = 4; break;
          case 'rook': maxHp = 9; attack = 4; break;
          case 'knight': maxHp = 8; attack = 5; break;
          case 'bishop': maxHp = 8; attack = 2; break;
        }
        return {
          ...p,
          type,
          hp: maxHp,
          maxHp,
          attack,
          cooldowns: { ability: 0 },
          superProgress: 0,
          superUnlocked: false,
          statusEffects: []
        };
      }
      return p;
    });

    addLog(`Pawn promoted to ${type.toUpperCase()} at Row ${8 - position.r}, Col ${String.fromCharCode(65 + position.c)}!`, 'heal');
    endTurn(nextPieces, currentWalls, currentGraveyard);
  };

  // Complete Pawn promotion choices
  const resolvePromotion = (type: PieceType) => {
    sound.playHeal();
    if (!promotionPending) return;

    const { pieceId, position } = promotionPending;
    let nextPieces = pieces.map(p => {
      if (p.id === pieceId) {
        let maxHp = 4;
        let attack = 2;
        switch (type) {
          case 'queen': maxHp = 10; attack = 4; break;
          case 'rook': maxHp = 9; attack = 4; break;
          case 'knight': maxHp = 8; attack = 5; break;
          case 'bishop': maxHp = 8; attack = 2; break;
        }
        return {
          ...p,
          type,
          hp: maxHp,
          maxHp,
          attack,
          cooldowns: { ability: 0 },
          superProgress: 0,
          superUnlocked: false,
          statusEffects: []
        };
      }
      return p;
    });

    addLog(`Pawn promoted to ${type.toUpperCase()} at Row ${8 - position.r}, Col ${String.fromCharCode(65 + position.c)}!`, 'heal');
    setPromotionPending(null);
    endTurn(nextPieces, walls, graveyard);
  };

  // Complete Resurrection piece selection
  const resolveResurrection = (deadPieceId: string) => {
    sound.playHeal();
    if (!resurrectionPending) return;

    const { actorId, position, nextPieces, nextWalls, nextGraveyard } = resurrectionPending;
    const actor = nextPieces.find(p => p.id === actorId);
    if (!actor) {
      setResurrectionPending(null);
      return;
    }

    const dead = nextGraveyard.find(p => p.id === deadPieceId);
    if (dead) {
      const revived: Piece = {
        ...dead,
        id: `${actor.color}-revived-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        hp: Math.floor(dead.maxHp / 2),
        position: { ...position },
        cooldowns: { ability: 0 },
        superProgress: 0,
        superUnlocked: false,
        statusEffects: [],
        passiveCooldown: 0
      };
      const finalPieces = [...nextPieces, revived];
      const finalGraveyard = nextGraveyard.filter(p => p.id !== dead.id);
      addLog(`RESURRECTION: Bishop revived fallen ${dead.type.toUpperCase()} with half health!`, 'super');
      triggerVisualEffect('super', actor.position, position, actor.type, actor.color);
      setResurrectionPending(null);
      endTurn(finalPieces, nextWalls, finalGraveyard);
    } else {
      setResurrectionPending(null);
    }
  };

  // Complete Knight Tactical Evasion repositioning
  const resolveReposition = (pos: Position) => {
    if (!repositionPending) return;
    const { pieceId } = repositionPending;

    let nextPieces = pieces.map(p => {
      if (p.id === pieceId) {
        return { ...p, position: { ...pos } };
      }
      return p;
    });

    const knight = pieces.find(p => p.id === pieceId);
    if (knight) {
      addLog(`Knight used Tactical Evasion to escape to Row ${8 - pos.r}, Col ${String.fromCharCode(65 + pos.c)}!`, 'ability', knight.color);
    }

    sound.playMove();
    setPieces(nextPieces);
    setRepositionPending(null);
    setSelectedPieceId(null);
    endTurn(nextPieces, walls, graveyard);
  };

  const whiteKing = pieces.find(p => p.color === 'white' && p.type === 'king');
  const blackKing = pieces.find(p => p.color === 'black' && p.type === 'king');
  const activeKing = pieces.find(p => p.color === currentPlayer && p.type === 'king' && p.hp > 0);
  const isKingThreatened = activeKing ? isSquareUnderThreat(activeKing.position, currentPlayer, pieces, walls) : false;

  return (
    <div className="flex flex-col h-screen w-full max-w-[1200px] mx-auto bg-[#0a0a0b] text-[#d1d5db] font-sans overflow-hidden border-4 border-[#1a1c22] shadow-2xl">
      {/* Starting Welcome Screen / Menu */}
      {!gameStarted ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0d0f12] p-8 text-center bg-radial from-[#151820] to-[#0a0a0b]">
          <h1 className="text-5xl font-serif text-white tracking-widest uppercase font-extrabold mb-2 drop-shadow-[0_2px_10px_rgba(197,160,89,0.3)]">
            Kingdom Chess
          </h1>
          <p className="text-[#c5a059] uppercase tracking-widest text-xs mb-8 font-mono">
            Tactical Chess Variant RPG
          </p>

          <div className="w-full max-w-md bg-[#111318] p-6 rounded-xl border border-[#c5a05933] shadow-2xl space-y-6">
            <h3 className="text-sm uppercase tracking-wider text-[#9ca3af] border-b border-[#c5a05915] pb-2 font-bold">
              Choose Match Mode
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setMode('pve')}
                className={`py-3 rounded font-bold text-sm tracking-wider border transition-colors ${
                  mode === 'pve'
                    ? 'bg-[#c5a059] text-black border-transparent shadow-[0_0_15px_rgba(197,160,89,0.3)]'
                    : 'bg-[#1a1d23] text-stone-300 border-[#c5a05933] hover:bg-[#20242c]'
                }`}
              >
                SOLO (VS AI)
              </button>
              <button
                onClick={() => setMode('pvp')}
                className={`py-3 rounded font-bold text-sm tracking-wider border transition-colors ${
                  mode === 'pvp'
                    ? 'bg-[#c5a059] text-black border-transparent shadow-[0_0_15px_rgba(197,160,89,0.3)]'
                    : 'bg-[#1a1d23] text-stone-300 border-[#c5a05933] hover:bg-[#20242c]'
                }`}
              >
                VERSUS (PVP)
              </button>
            </div>

            {mode === 'pve' && (
              <div className="space-y-2 text-left">
                <label className="text-[10px] text-stone-400 uppercase tracking-wider font-bold">AI Difficulty</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['easy', 'medium', 'hard'] as AIDifficulty[]).map((diff) => (
                    <button
                      key={diff}
                      onClick={() => setDifficulty(diff)}
                      className={`py-2 rounded font-mono text-xs font-bold uppercase border transition-colors ${
                        difficulty === diff
                          ? 'bg-[#c5a059] text-black border-transparent'
                          : 'bg-[#1a1d23] text-stone-300 border-stone-800 hover:bg-[#20242c]'
                      }`}
                    >
                      {diff === 'medium' ? 'normal' : diff}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 pt-4 border-t border-[#c5a05915]">
              <button
                onClick={() => startNewGame(mode, difficulty)}
                className="w-full py-3 bg-[#c5a059] hover:bg-[#b08e4d] text-black font-black text-sm tracking-widest uppercase shadow-lg transition-transform duration-200 active:scale-95"
              >
                Initialize Battle
              </button>

              {localStorage.getItem(AUTOSAVE_KEY) && (
                <button
                  onClick={loadAutosave}
                  className="w-full py-2.5 bg-[#1a1d23] hover:bg-[#252a35] text-[#c5a059] border border-[#c5a05966] font-bold text-xs tracking-widest uppercase transition-colors"
                >
                  Continue Saved Game
                </button>
              )}
            </div>
          </div>

          <div className="mt-8 text-stone-500 font-mono text-[10px] max-w-sm">
            Traditional chess movement applies. Instead of instant captures, chess units lose HP, execute active abilities, utilize passive skills, and unlock ultimate powers. Defeat the enemy King to win.
          </div>
        </div>
      ) : (
        <>
          {/* Top HUD bar */}
          <div className="h-16 flex items-center justify-between px-8 border-b border-[#c5a05933] bg-[#111318]">
            <div className="flex items-center space-x-6">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-[#c5a059] font-bold font-mono">PHASE</span>
                <span className={`text-lg font-serif font-black ${currentPlayer === 'white' ? 'text-white' : 'text-stone-400'} flex items-center`}>
                  {specialTurn ? "SPECIAL TURN" : (currentPlayer === 'white' ? "WHITE'S TURN" : "BLACK'S TURN")}
                  {mode === 'pve' && currentPlayer !== humanColor && " (AI)"}
                  {repositionPending && (
                    <span className="text-xs bg-blue-950 text-blue-400 border border-blue-800 px-2 py-0.5 rounded animate-pulse font-mono font-bold tracking-wider ml-2">
                      🛡️ REPOSITION KNIGHT!
                    </span>
                  )}
                </span>
              </div>
              <div className="h-8 w-px bg-[#c5a05933]" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-[#c5a059] font-bold font-mono">TURN</span>
                <span className="text-lg font-mono text-white italic font-black">
                  {specialTurn ? "SP" : turnNumber.toString().padStart(2, '0')}
                </span>
              </div>
              <div className="h-8 w-px bg-[#c5a05933]" />
              <div className="flex items-center space-x-6">
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase tracking-wider text-stone-500 font-bold font-mono leading-none mb-1">WHITE LAST STAND</span>
                  <span className={`text-xs font-mono font-bold leading-none ${whiteKing?.lastStandUsed ? 'text-rose-500/80' : 'text-emerald-500'}`}>
                    {whiteKing?.lastStandUsed ? 'CONSUMED' : 'AVAILABLE'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase tracking-wider text-stone-500 font-bold font-mono leading-none mb-1">BLACK LAST STAND</span>
                  <span className={`text-xs font-mono font-bold leading-none ${blackKing?.lastStandUsed ? 'text-rose-500/80' : 'text-emerald-500'}`}>
                    {blackKing?.lastStandUsed ? 'CONSUMED' : 'AVAILABLE'}
                  </span>
                </div>
                {whiteKing && whiteKing.consecutiveCheckCount !== undefined && whiteKing.consecutiveCheckCount > 0 ? (
                  <>
                    <div className="h-6 w-px bg-[#c5a05933]" />
                    <div className="flex flex-col animate-pulse">
                      <span className="text-[9px] uppercase tracking-wider text-amber-500 font-bold font-mono leading-none mb-1">WHITE CONSECUTIVE CHECKS</span>
                      <span className="text-xs font-mono font-bold leading-none text-amber-400">
                        {whiteKing.consecutiveCheckCount}/5
                      </span>
                    </div>
                  </>
                ) : null}
                {blackKing && blackKing.consecutiveCheckCount !== undefined && blackKing.consecutiveCheckCount > 0 ? (
                  <>
                    <div className="h-6 w-px bg-[#c5a05933]" />
                    <div className="flex flex-col animate-pulse">
                      <span className="text-[9px] uppercase tracking-wider text-amber-500 font-bold font-mono leading-none mb-1">BLACK CONSECUTIVE CHECKS</span>
                      <span className="text-xs font-mono font-bold leading-none text-amber-400">
                        {blackKing.consecutiveCheckCount}/5
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {/* Ultimate trackers */}
            <div className="hidden md:flex flex-col items-center">
              <span className="text-[9px] uppercase tracking-wider text-[#c5a059] mb-1 font-bold">
                King's Sovereign Command Meter
              </span>
              <div className="w-48 h-2.5 bg-[#1a1d23] rounded-full border border-[#c5a05933] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-500"
                  style={{ width: `${Math.min(100, (turnNumber / 12) * 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="px-4 py-1.5 border border-[#c5a05966] text-[#c5a059] text-xs uppercase font-mono tracking-wider hover:bg-[#c5a05911] transition-colors"
              >
                Settings
              </button>
              <button
                onClick={() => {
                  sound.playClick();
                  setGameStarted(false);
                }}
                className="px-4 py-1.5 bg-[#ef4444] hover:bg-red-600 text-white font-black text-xs uppercase tracking-wider transition-colors"
              >
                Surrender
              </button>
            </div>
          </div>

          {/* Main layout contents */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* Left Sidebar: Graveyards and logs */}
            <div className="w-[260px] border-r border-[#1a1c22] bg-[#0d0f12] flex flex-col p-4 space-y-4">
              <Graveyard graveyard={graveyard} color="white" />
              <Graveyard graveyard={graveyard} color="black" />
              <div className="h-[220px]">
                <HistoryLog history={history} />
              </div>
            </div>

            {/* Center Area: interactive chessboard */}
            <div className="flex-1 flex items-center justify-center bg-[#0a0a0b]">
              <Board
                pieces={pieces}
                walls={walls}
                selectedPieceId={selectedPieceId}
                activeAction={activeAction}
                highlightedSquares={highlightedSquares}
                currentPlayer={currentPlayer}
                onSquareClick={onSquareClick}
                activeEffects={activeEffects}
                mode={mode}
                humanColor={humanColor}
                repositionPending={repositionPending}
              />
            </div>

            {/* Right Sidebar: piece inspector details */}
            <Inspector
              piece={selectedPiece}
              onAbilityClick={() => {
                sound.playClick();
                if (selectedPiece && selectedPiece.type === 'pawn') {
                  handleCellAction(selectedPiece, selectedPiece.position, 'ability');
                } else {
                  setActiveAction(activeAction === 'ability' ? null : 'ability');
                }
              }}
              onSuperClick={() => {
                sound.playClick();
                if (selectedPiece && (selectedPiece.type === 'king' || selectedPiece.type === 'rook')) {
                  handleCellAction(selectedPiece, selectedPiece.position, 'super');
                } else {
                  setActiveAction(activeAction === 'super' ? null : 'super');
                }
              }}
              activeAction={activeAction}
              allPieces={pieces}
              graveyard={graveyard}
              currentPlayerColor={currentPlayer}
              mode={mode}
              humanColor={humanColor}
            />

            {/* Promo Selector popup modal */}
            {promotionPending && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
                <div className="bg-[#111318] p-6 rounded-xl border-2 border-amber-500 max-w-sm text-center shadow-2xl">
                  <h3 className="text-xl font-serif text-white font-bold mb-2 tracking-wide uppercase">Pawn Promoted!</h3>
                  <p className="text-xs text-stone-400 mb-6 font-mono">Choose a high tier battlefield class for your vanguard:</p>
                  <div className="grid grid-cols-2 gap-3">
                    {['queen', 'rook', 'knight', 'bishop'].map((type) => {
                      return (
                        <button
                          key={type}
                          onClick={() => resolvePromotion(type as PieceType)}
                          className="py-3 rounded font-bold text-xs uppercase border tracking-wider transition-all duration-150 bg-[#1a1d23] border-[#c5a05933] text-stone-300 hover:border-amber-400 hover:bg-[#20242c]"
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Resurrection Selector popup modal */}
            {resurrectionPending && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
                <div className="bg-[#111318] p-6 rounded-xl border-2 border-amber-500 max-w-md w-full text-center shadow-2xl">
                  <h3 className="text-xl font-serif text-white font-bold mb-2 tracking-wide uppercase">Resurrection!</h3>
                  <p className="text-xs text-stone-400 mb-6 font-mono">Choose an allied soul to restore to the battlefield:</p>
                  <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto pr-1">
                    {resurrectionPending.nextGraveyard
                      .filter(p => p.color === pieces.find(x => x.id === resurrectionPending.actorId)?.color && p.type !== 'king')
                      .map((deadPiece) => {
                        const getPieceSymbol = (type: PieceType): string => {
                          switch (type) {
                            case 'king': return '♚';
                            case 'queen': return '♛';
                            case 'rook': return '♜';
                            case 'bishop': return '♝';
                            case 'knight': return '♞';
                            case 'pawn': return '♟';
                          }
                        };
                        const getPieceTitle = (type: PieceType): string => {
                          switch (type) {
                            case 'king': return 'Lord Sovereign';
                            case 'queen': return 'Arch Duchess';
                            case 'rook': return 'Fortress Golem';
                            case 'knight': return 'Grand Paladin';
                            case 'bishop': return 'High Priest';
                            case 'pawn': return 'Vanguard Sentry';
                          }
                        };
                        return (
                          <button
                            key={deadPiece.id}
                            onClick={() => resolveResurrection(deadPiece.id)}
                            className="flex items-center gap-4 p-3 rounded font-bold text-xs border tracking-wider transition-all duration-150 bg-[#1a1d23] border-[#c5a05933] text-stone-300 hover:border-amber-400 hover:bg-[#20242c]"
                          >
                            <span className="text-2xl text-amber-500">{getPieceSymbol(deadPiece.type)}</span>
                            <div className="text-left flex-1">
                              <div className="text-sm font-serif text-white">{getPieceTitle(deadPiece.type)}</div>
                              <div className="text-[10px] text-stone-400 font-mono">HP: {Math.floor(deadPiece.maxHp / 2)} (Half of max)</div>
                            </div>
                            <span className="text-[10px] text-amber-400 uppercase font-mono px-2 py-1 bg-amber-950/40 rounded">Revive</span>
                          </button>
                        );
                      })}
                  </div>
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={() => {
                        setResurrectionPending(null);
                        setActiveAction(null);
                      }}
                      className="px-6 py-2 rounded text-xs font-mono font-bold tracking-wider uppercase border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-all duration-150"
                    >
                      Cancel Resurrection
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Settings Dialog Overlay */}
            {showSettings && (
              <div className="absolute inset-0 bg-black/75 flex items-center justify-center z-50 animate-fade-in">
                <div className="bg-[#111318] p-6 rounded-xl border border-[#c5a05944] max-w-sm w-full shadow-2xl">
                  <div className="flex justify-between items-center border-b border-stone-800 pb-3 mb-4">
                    <h3 className="text-base font-serif text-white uppercase font-bold tracking-widest">Tactical Options</h3>
                    <button onClick={() => setShowSettings(false)} className="text-[#c5a059] font-bold text-sm">✕</button>
                  </div>

                  <div className="space-y-4">
                    {/* Volume setting control */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-stone-300 font-mono">
                        <span>Master Volume</span>
                        <span>{Math.round(settings.volume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={settings.volume}
                        onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
                        className="w-full accent-[#c5a059]"
                      />
                    </div>

                    {/* SFX trigger option */}
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs text-stone-300 font-mono">Sound Effects (SFX)</span>
                      <button
                        onClick={() => updateSettings({ sfxEnabled: !settings.sfxEnabled })}
                        className={`px-3 py-1 rounded text-xs font-bold font-mono border ${
                          settings.sfxEnabled ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500' : 'bg-red-950/40 text-red-400 border-red-500'
                        }`}
                      >
                        {settings.sfxEnabled ? 'ENABLED' : 'MUTED'}
                      </button>
                    </div>

                    <div className="pt-4 border-t border-stone-800 flex space-x-2">
                      <button
                        onClick={() => {
                          sound.playClick();
                          localStorage.removeItem(AUTOSAVE_KEY);
                          setGameStarted(false);
                        }}
                        className="flex-1 py-2 bg-red-900/20 hover:bg-red-900/40 text-red-200 border border-red-800 text-xs font-bold uppercase rounded transition-colors"
                      >
                        Delete Save & Quit
                      </button>
                      <button
                        onClick={() => setShowSettings(false)}
                        className="flex-1 py-2 bg-[#c5a059] hover:bg-[#b08e4d] text-black text-xs font-bold uppercase rounded transition-colors"
                      >
                        Resume Game
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Victory overlay modal dialog */}
            {winner && (
              <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-50 text-center p-6 animate-fade-in">
                <span className="text-stone-500 text-6xl mb-2">♚</span>
                <h2 className="text-4xl font-serif font-black tracking-widest text-white uppercase mb-2">
                  {winner === 'white' ? "White Victory" : "Black Victory"}
                </h2>
                <p className="text-stone-400 font-mono text-xs max-w-sm mb-8">
                  {winner === 'white'
                    ? "The Lord Sovereign has unified the realm and crushed the dark forces."
                    : "The Dark Legion has usurped the throne and conquered the capital."}
                </p>

                <div className="space-x-4">
                  <button
                    onClick={() => {
                      sound.playClick();
                      setGameStarted(false);
                    }}
                    className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-stone-300 font-bold text-xs uppercase tracking-widest border border-stone-700 transition-colors"
                  >
                    Return to Menu
                  </button>
                  <button
                    onClick={() => startNewGame(mode, difficulty)}
                    className="px-6 py-2.5 bg-[#c5a059] hover:bg-[#b08e4d] text-black font-black text-xs uppercase tracking-widest shadow-lg transition-transform duration-200 active:scale-95"
                  >
                    Rematch
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Bar: Status Indicators */}
          <div className="h-12 bg-[#0d0f12] border-t border-[#1a1c22] flex items-center px-6 space-x-12 shrink-0">
            <div className="flex items-center space-x-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-[10px] uppercase font-mono tracking-wider text-[#9ca3af]">
                White Legion: {pieces.filter(p => p.color === 'white' && p.hp > 0).length} units
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
              <span className="text-[10px] uppercase font-mono tracking-wider text-[#9ca3af]">
                Black Legion: {pieces.filter(p => p.color === 'black' && p.hp > 0).length} units
              </span>
            </div>
            <div className="hidden sm:block flex-1" />
            <div className="hidden sm:block text-[10px] font-mono italic text-stone-600">
              "Every sacrifice paveth the road to supreme sovereignty."
            </div>
          </div>
        </>
      )}
    </div>
  );
}
