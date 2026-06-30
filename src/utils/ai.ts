/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Piece, PieceType, PlayerColor, Position, Wall, GameState } from '../types';
import {
  getLegalMoves,
  getLegalAttacks,
  getAbilityTargets,
  getSuperTargets,
  getEffectiveAttack,
  isFrozen,
  isAbilitySuppressed,
  getArmor,
  inBounds,
  isSquareUnderThreat,
  getThreats,
  canPieceKillThreat
} from './gameLogic';

export interface AIAction {
  type: 'move' | 'attack' | 'ability' | 'super';
  pieceId: string;
  target: Position;
}

// Generate all possible actions for a player
export function generateAllActions(
  color: PlayerColor,
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[]
): AIAction[] {
  const actions: AIAction[] = [];

  const playerPieces = pieces.filter(p => p.color === color && p.hp > 0);

  for (const p of playerPieces) {
    if (isFrozen(p)) continue;

    // 1. Movement actions
    const moves = getLegalMoves(p, pieces, walls);
    for (const pos of moves) {
      actions.push({ type: 'move', pieceId: p.id, target: pos });
    }

    // 2. Attack actions
    const attacks = getLegalAttacks(p, pieces, walls);
    for (const pos of attacks) {
      actions.push({ type: 'attack', pieceId: p.id, target: pos });
    }

    // 3. Ability actions
    if (p.cooldowns.ability === 0 && !isAbilitySuppressed(p, pieces)) {
      const abilityTargets = getAbilityTargets(p, pieces, walls);
      for (const pos of abilityTargets) {
         actions.push({ type: 'ability', pieceId: p.id, target: pos });
      }
    }

    // 4. Super actions
    if (p.superUnlocked) {
      const superTargets = getSuperTargets(p, pieces, walls, graveyard);
      for (const pos of superTargets) {
        actions.push({ type: 'super', pieceId: p.id, target: pos });
      }
    }
  }

  return actions;
}

// Base value for pieces
const PIECE_VALUES: Record<PieceType, number> = {
  king: 10000,
  queen: 900,
  rook: 500,
  knight: 450,
  bishop: 400,
  pawn: 100
};

// Helper to calculate Manhattan distance to nearest enemy piece
function getDistanceToNearestEnemy(pos: Position, pieces: Piece[], myColor: PlayerColor): number {
  const enemies = pieces.filter(enemy => enemy.color !== myColor && enemy.hp > 0);
  if (enemies.length === 0) return 0;
  let minD = Infinity;
  for (const enemy of enemies) {
    const d = Math.abs(pos.r - enemy.position.r) + Math.abs(pos.c - enemy.position.c);
    if (d < minD) minD = d;
  }
  return minD;
}

// Priority-based piece value mapping for different AI difficulties
function getPieceValue(p: Piece, difficulty: 'easy' | 'medium' | 'hard'): number {
  if (difficulty === 'easy') {
    return PIECE_VALUES[p.type];
  }

  // Normal AI (medium) and Hard Piece Priority
  // Priority order: 1. King, 2. Queen, 3. Rook, 4. Knight, 5. Bishop, 6. Promoted Pieces, 7. Pawn
  const isPromoted = p.id.includes('-pawn-') && p.type !== 'pawn';
  if (isPromoted) {
    return 300; // Promoted Piece value (higher than standard Pawn, but below Bishop)
  }

  const values: Record<PieceType, number> = {
    king: 10000,
    queen: 900,
    rook: 500,
    knight: 450,
    bishop: 400,
    pawn: 100
  };
  return values[p.type];
}

// Calculate opportunistic tactical situational bonuses for the Normal (medium) AI
function getNormalTacticalBonus(
  act: AIAction,
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[]
): number {
  const actor = pieces.find(p => p.id === act.pieceId);
  if (!actor) return 0;

  if (act.type === 'ability') {
    if (actor.type === 'king') {
      // Royal Call
      const deadPawn = graveyard.find(p => p.color === actor.color && p.type === 'pawn');
      if (deadPawn) {
        return 150; // Replaces a defeated pawn
      }
      return 50; // Reinforce/summon new pawn
    }

    if (actor.type === 'queen') {
      // Charm: Prioritize Bishop, Rook, Knight, Pawn
      const target = pieces.find(p => p.position.r === act.target.r && p.position.c === act.target.c && p.hp > 0);
      if (target && target.color !== actor.color) {
        if (target.type === 'bishop') return 300;
        if (target.type === 'rook') return 200;
        if (target.type === 'knight') return 150;
        if (target.type === 'pawn') return 100;
        return 80;
      }
    }

    if (actor.type === 'bishop') {
      // Heal: Heal the highest-value injured ally
      const target = pieces.find(p => p.position.r === act.target.r && p.position.c === act.target.c && p.hp > 0);
      if (target && target.color === actor.color) {
        const hpLoss = target.maxHp - target.hp;
        if (hpLoss > 0) {
          const baseVal = getPieceValue(target, 'medium');
          return (baseVal * (hpLoss / target.maxHp)) * 0.5;
        }
      }
    }

    if (actor.type === 'knight') {
      // Charge: Use Charge when it secures a better trade (i.e. threatens or approaches valuable enemy)
      const enemies = pieces.filter(p => p.color !== actor.color && p.hp > 0);
      let threatensValuable = false;
      for (const enemy of enemies) {
        const dist = Math.abs(act.target.r - enemy.position.r) + Math.abs(act.target.c - enemy.position.c);
        if (dist <= 2) {
          threatensValuable = true;
          break;
        }
      }
      return threatensValuable ? 120 : 40;
    }

    if (actor.type === 'rook') {
      // Barricade: Place Barricades to slow enemy movement or defend important lanes
      if (act.target.c >= 2 && act.target.c <= 5 && act.target.r >= 2 && act.target.r <= 5) {
        return 100;
      }
      return 40;
    }

    if (actor.type === 'pawn') {
      // Brace: Use Brace before expected combat
      const underThreat = isSquareUnderThreat(actor.position, actor.color, pieces, walls);
      return underThreat ? 150 : 30;
    }
  }

  if (act.type === 'super') {
    if (actor.type === 'queen') {
      // Royal Lockdown: Freeze 2+ enemy pieces OR 1 particularly valuable enemy
      const dr = Math.sign(act.target.r - actor.position.r);
      const dc = Math.sign(act.target.c - actor.position.c);
      let count = 0;
      let hasValuable = false;
      if (dr !== 0 || dc !== 0) {
        let step = 1;
        while (true) {
          const nr = actor.position.r + step * dr;
          const nc = actor.position.c + step * dc;
          if (!inBounds(nr, nc)) break;
          if (walls.some(w => w.position.r === nr && w.position.c === nc)) break;
          const target = pieces.find(p => p.position.r === nr && p.position.c === nc && p.hp > 0);
          if (target) {
            if (target.color !== actor.color) {
              count++;
              if (target.type === 'king' || target.type === 'queen' || target.type === 'rook') {
                hasValuable = true;
              }
            }
          }
          step++;
        }
      }
      if (count >= 2) return 400;
      if (count === 1 && hasValuable) return 300;
      if (count === 1) return 100;
      return 0;
    }

    if (actor.type === 'bishop') {
      // Resurrection: Prefer reviving Officials over Pawns
      const dead = graveyard.find(p => p.color === actor.color && p.type !== 'king');
      if (dead) {
        if (dead.type !== 'pawn') {
          return 300;
        }
        return 100;
      }
      return 0;
    }

    if (actor.type === 'knight') {
      // Decisive Strike: Use against valuable targets
      const target = pieces.find(p => p.position.r === act.target.r && p.position.c === act.target.c && p.hp > 0);
      if (target && target.color !== actor.color) {
        const val = getPieceValue(target, 'medium');
        return val * 0.8;
      }
    }

    if (actor.type === 'rook') {
      // Rook's Bastion: Use when there are friendly allies nearby within 3 tiles to protect
      const friendlyAllies = pieces.filter(
        p => p.color === actor.color && p.hp > 0 && p.id !== actor.id
      );
      const nearbyAllies = friendlyAllies.filter(ally => {
        const dist = Math.max(Math.abs(actor.position.r - ally.position.r), Math.abs(actor.position.c - ally.position.c));
        return dist <= 3;
      });
      if (nearbyAllies.length >= 2) return 300;
      if (nearbyAllies.length === 1) return 100;
      return 0;
    }
  }

  if (act.type === 'move' && actor.type === 'pawn') {
    // Advance for Promotion when reasonably safe
    const targetSafe = !isSquareUnderThreat(act.target, actor.color, pieces, walls);
    if (targetSafe) {
      const isMovingForward = actor.color === 'white'
        ? act.target.r < actor.position.r
        : act.target.r > actor.position.r;
      if (isMovingForward) {
        const rowValue = actor.color === 'white' ? (7 - act.target.r) : act.target.r;
        return 50 + rowValue * 15;
      }
    }
  }

  return 0;
}

// Board state evaluation function (Positive for AI color, Negative for Opponent color)
function evaluateState(pieces: Piece[], walls: Wall[], currentPlayer: PlayerColor, difficulty: 'easy' | 'medium' | 'hard', aiColor: PlayerColor = 'black'): number {
  let score = 0;

  for (const p of pieces) {
    if (p.hp <= 0) continue;

    const baseVal = getPieceValue(p, difficulty);
    const hpRatio = p.hp / p.maxHp;
    
    // Core value of the piece weighted by its remaining health
    let pieceVal = baseVal * (0.6 + 0.4 * hpRatio);
    
    // Include active status effects (Freeze penalty)
    if (p.statusEffects.some(se => se.type === 'frozen')) {
      pieceVal -= baseVal * (difficulty === 'hard' ? 0.3 : 0.2);
    }

    // Include charm duration bonus if applicable
    const charmEffect = p.statusEffects.find(se => se.type === 'charmed');
    if (charmEffect && difficulty === 'hard') {
      pieceVal += baseVal * 0.4 * charmEffect.duration;
    }

    // Include armor
    const armor = getArmor(p);
    pieceVal += armor * 20;

    // Cooldown penalty
    if (p.cooldowns.ability > 0) {
      pieceVal -= p.cooldowns.ability * 10;
    }

    // Super progression / unlock bonus
    if (p.superUnlocked) {
      pieceVal += 150;
    } else {
      pieceVal += p.superProgress * 15;
    }

    // Rook Iron Shell bonus
    if (p.type === 'rook' && p.ironShellState === 'ready' && difficulty === 'hard') {
      pieceVal += 100;
    }

    // Add positional bonuses (e.g. pawns advancing, pieces controlling center)
    const { r, c } = p.position;
    const centerFactor = (3.5 - Math.abs(3.5 - r)) + (3.5 - Math.abs(3.5 - c));
    pieceVal += centerFactor * 5;

    // Hard AI tracks threats and tempo penalties
    if (difficulty === 'hard') {
      const underThreat = isSquareUnderThreat(p.position, p.color, pieces, walls);
      if (underThreat) {
        pieceVal -= baseVal * 0.3; // Threat penalty
      }

      // Track promotion threats and progress
      if (p.type === 'pawn') {
        const promotionDist = p.color === 'white' ? p.position.r : (7 - p.position.r);
        const progress = 6 - promotionDist;
        pieceVal += progress * 25;
      }
    }

    // Direct score calculation (positive for AI, negative for opponent)
    if (p.color === aiColor) {
      score += pieceVal;
    } else {
      score -= pieceVal;
    }
  }

  // Factor in walls owned (barricades and control)
  for (const w of walls) {
    const wallWeight = difficulty === 'hard' ? 25 : 15;
    if (w.color === aiColor) {
      score += wallWeight * w.duration;
    } else {
      score -= wallWeight * w.duration;
    }
  }

  return score;
}

// Simulate execution of an action to compute the resulting state(s) (handles Knight's Evasion branching)
export function simulateActionBranches(
  action: AIAction,
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[]
): { simulatedPieces: Piece[]; simulatedWalls: Wall[]; simulatedGraveyard: Piece[] }[] {
  // Deep clone pieces & walls
  const simulatedPieces: Piece[] = pieces.map(p => ({
    ...p,
    position: { ...p.position },
    cooldowns: { ...p.cooldowns },
    statusEffects: p.statusEffects.map(se => ({ ...se }))
  }));

  const simulatedWalls: Wall[] = walls.map(w => ({
    ...w,
    position: { ...w.position }
  }));

  const simulatedGraveyard: Piece[] = [...graveyard];

  const actor = simulatedPieces.find(p => p.id === action.pieceId);
  if (!actor) {
    return [{ simulatedPieces, simulatedWalls, simulatedGraveyard }];
  }

  const targetSquare = action.target;
  const triggeredEvasions = new Set<string>();

  function applySimulatedDamage(target: Piece, dmg: number) {
    if (target.type === 'rook' && target.ironShellState === 'ready') {
      target.ironShellState = 'charging';
      target.ironShellProgress = 0;
      return;
    }
    if (target.type === 'pawn' && target.statusEffects.some(se => se.type === 'armor')) {
      target.statusEffects = target.statusEffects.filter(se => se.type !== 'armor');
      return;
    }

    const armor = getArmor(target);
    const netDmg = Math.max(0, dmg - armor);

    if (armor > 0) {
      const armorEffect = target.statusEffects.find(se => se.type === 'armor');
      if (armorEffect && armorEffect.value) {
        armorEffect.value = Math.max(0, armorEffect.value - dmg);
        if (armorEffect.value === 0) {
          target.statusEffects = target.statusEffects.filter(se => se.type !== 'armor');
        }
      }
    }

    target.hp = Math.max(0, target.hp - netDmg);

    if (target.hp > 0) {
      if (target.type === 'knight' && target.passiveCooldown === 0) {
        triggeredEvasions.add(target.id);
      }
    }
  }

  if (action.type === 'move') {
    // Castling check in simulation
    if (actor.type === 'king' && Math.abs(targetSquare.c - actor.position.c) === 2) {
      const isKingside = targetSquare.c === 6;
      const rookColSrc = isKingside ? 7 : 0;
      const rookColDst = isKingside ? 5 : 3;
      const rook = simulatedPieces.find(p => p.position.r === actor.position.r && p.position.c === rookColSrc && p.color === actor.color && p.type === 'rook');
      if (rook) {
        rook.position = { r: actor.position.r, c: rookColDst };
        rook.hasMoved = true;
      }
    }
    actor.position = { ...targetSquare };
    actor.hasMoved = true;
  } else if (action.type === 'attack') {
    actor.hasMoved = true;
    const originalPos = { ...actor.position };
    const targetPiece = simulatedPieces.find(
      p => p.position.r === targetSquare.r && p.position.c === targetSquare.c && p.hp > 0
    );
    
    // Determine pre-attack position
    let preAttackPos = { ...actor.position };
    if (actor.type === 'queen' || actor.type === 'bishop' || actor.type === 'rook') {
      const dr = Math.sign(targetSquare.r - actor.position.r);
      const dc = Math.sign(targetSquare.c - actor.position.c);
      preAttackPos = { r: targetSquare.r - dr, c: targetSquare.c - dc };
    } else if (actor.type === 'knight') {
      preAttackPos = { ...targetSquare };
    }

    actor.position = preAttackPos;

    if (targetPiece) {
      applySimulatedDamage(targetPiece, getEffectiveAttack(actor));
      if (targetPiece.hp <= 0) {
        simulatedGraveyard.push({ ...targetPiece });
        actor.position = { ...targetSquare }; // Occupies defeated square
      } else {
        if (actor.type === 'knight') {
          actor.position = originalPos; // Knight returns to original square
        }
      }
    }
  } else if (action.type === 'ability') {
    actor.cooldowns.ability = actor.type === 'pawn' ? 2 : 3;

    if (actor.type === 'king') {
      // Royal Call
      const deadPawn = simulatedGraveyard.find(p => p.color === actor.color && p.type === 'pawn');
      if (deadPawn) {
        const revived = {
          ...deadPawn,
          id: `${actor.color}-pawn-revived-${Date.now() + Math.random()}`,
          hp: 4,
          maxHp: 4,
          position: { ...targetSquare },
          cooldowns: { ability: 0 },
          statusEffects: [],
          superProgress: 0,
          superUnlocked: false
        };
        simulatedPieces.push(revived);
        const deadIdx = simulatedGraveyard.findIndex(p => p.id === deadPawn.id);
        if (deadIdx > -1) simulatedGraveyard.splice(deadIdx, 1);
      } else {
        const summoned = {
          id: `${actor.color}-pawn-summoned-${Date.now() + Math.random()}`,
          type: 'pawn' as const,
          color: actor.color,
          position: { ...targetSquare },
          hp: 4,
          maxHp: 4,
          attack: 2,
          cooldowns: { ability: 0 },
          superProgress: 0,
          superUnlocked: false,
          statusEffects: [],
          passiveCooldown: 0
        };
        simulatedPieces.push(summoned);
      }
    } else if (actor.type === 'queen') {
      // Charm: flip piece color and attach charmed status
      const targetPiece = simulatedPieces.find(
        p => p.position.r === targetSquare.r && p.position.c === targetSquare.c && p.hp > 0
      );
      if (targetPiece && targetPiece.type !== 'king' && targetPiece.type !== 'queen') {
        targetPiece.originalColor = targetPiece.color;
        targetPiece.color = actor.color;
        targetPiece.charmedByQueenId = actor.id;
        targetPiece.statusEffects.push({ type: 'charmed', duration: 1, casterColor: actor.color });
      }
    } else if (actor.type === 'bishop') {
      // Heal (only heal 30% of max hp rounded up)
      const targetPiece = simulatedPieces.find(
        p => p.position.r === targetSquare.r && p.position.c === targetSquare.c && p.hp > 0
      );
      if (targetPiece) {
        const healAmt = Math.ceil(targetPiece.maxHp * 0.3);
        targetPiece.hp = Math.min(targetPiece.maxHp, targetPiece.hp + healAmt);
      }
    } else if (actor.type === 'knight') {
      // Charge
      const targetPos = targetSquare;
      const opponentColor = actor.color === 'white' ? 'black' : 'white';
      
      const targetPieceOnSquare = simulatedPieces.find(
        p => p.position.r === targetPos.r && p.position.c === targetPos.c && p.color === opponentColor && p.hp > 0
      );
      
      actor.position = { ...targetPos };
      actor.cooldowns.ability = 3;
      
      if (targetPieceOnSquare) {
        applySimulatedDamage(targetPieceOnSquare, 5);
        if (targetPieceOnSquare.hp <= 0) {
          simulatedGraveyard.push({ ...targetPieceOnSquare });
        }
      }
      
      // Adjacent splash: 2 damage to surrounding pieces
      const adjacentDirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dr, dc] of adjacentDirs) {
        const nr = targetPos.r + dr;
        const nc = targetPos.c + dc;
        const adjEnemy = simulatedPieces.find(
          p => p.position.r === nr && p.position.c === nc && p.color === opponentColor && p.hp > 0 && p.id !== targetPieceOnSquare?.id
        );
        if (adjEnemy) {
          applySimulatedDamage(adjEnemy, 2);
          if (adjEnemy.hp <= 0) {
            simulatedGraveyard.push({ ...adjEnemy });
          }
        }
      }
    } else if (actor.type === 'rook') {
      // Barricade
      simulatedWalls.push({
        id: `wall-${Date.now() + Math.random()}`,
        position: { ...targetSquare },
        duration: 2,
        color: actor.color
      });
    } else if (actor.type === 'pawn') {
      // Brace
      const existingArmorIdx = actor.statusEffects.findIndex(se => se.type === 'armor');
      if (existingArmorIdx > -1) {
        actor.statusEffects[existingArmorIdx].value = (actor.statusEffects[existingArmorIdx].value || 0) + 2;
        actor.statusEffects[existingArmorIdx].duration = 2;
        actor.statusEffects[existingArmorIdx].isNew = true;
      } else {
        actor.statusEffects.push({ type: 'armor', duration: 2, value: 2, casterColor: actor.color, isNew: true });
      }
      actor.cooldowns.ability = 2;
    }
  } else if (action.type === 'super') {
    actor.superUnlocked = false; // Expend super
    actor.superProgress = 0; // Reset progress

    if (actor.type === 'king') {
      // extra turn simulated
    } else if (actor.type === 'queen') {
      // Royal Lockdown
      const dr = Math.sign(targetSquare.r - actor.position.r);
      const dc = Math.sign(targetSquare.c - actor.position.c);
      if (dr !== 0 || dc !== 0) {
        let step = 1;
        while (true) {
          const nr = actor.position.r + step * dr;
          const nc = actor.position.c + step * dc;
          if (!inBounds(nr, nc)) break;
          if (simulatedWalls.some(w => w.position.r === nr && w.position.c === nc)) {
            break;
          }
          const target = simulatedPieces.find(p => p.position.r === nr && p.position.c === nc && p.hp > 0);
          if (target) {
            if (target.color !== actor.color) {
              target.statusEffects.push({ type: 'frozen', duration: 2 });
            }
          }
          step++;
        }
      }
    } else if (actor.type === 'bishop') {
      // Resurrection (Prioritize higher tier pieces, avoid King)
      const deadCandidates = simulatedGraveyard.filter(p => p.color === actor.color && p.type !== 'king');
      const typePriority: Record<string, number> = { queen: 5, rook: 4, knight: 3, bishop: 3, pawn: 1 };
      const dead = [...deadCandidates].sort((a, b) => (typePriority[b.type] || 0) - (typePriority[a.type] || 0))[0];
      if (dead) {
        const revived = {
          ...dead,
          id: `${actor.color}-revived-${Date.now() + Math.random()}`,
          hp: Math.floor(dead.maxHp / 2),
          position: { ...targetSquare },
          cooldowns: { ability: 0 },
          statusEffects: [],
          superProgress: 0,
          superUnlocked: false
        };
        simulatedPieces.push(revived);
        const deadIdx = simulatedGraveyard.findIndex(p => p.id === dead.id);
        if (deadIdx > -1) simulatedGraveyard.splice(deadIdx, 1);
      }
    } else if (actor.type === 'knight') {
      // Decisive Strike
      const targetPiece = simulatedPieces.find(
        p => p.position.r === targetSquare.r && p.position.c === targetSquare.c && p.hp > 0
      );
      if (targetPiece && targetPiece.type !== 'king') {
        targetPiece.hp = 0;
        simulatedGraveyard.push({ ...targetPiece });
      }
    } else if (actor.type === 'rook') {
      // Rook's Bastion: lock in place
      const freshRook = simulatedPieces.find(p => p.id === actor.id);
      if (freshRook) {
        freshRook.rookSuperTurns = 5;
      }
    }
  }

  // Filter out dead pieces from main pieces list
  const finalPieces = simulatedPieces.filter(p => p.hp > 0);

  const branches: { simulatedPieces: Piece[]; simulatedWalls: Wall[]; simulatedGraveyard: Piece[] }[] = [];

  if (triggeredEvasions.size > 0) {
    const knightId = Array.from(triggeredEvasions)[0];
    const knight = finalPieces.find(p => p.id === knightId);
    if (knight) {
      const jumps = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2],  [1, 2],  [2, -1],  [2, 1]
      ];
      const escapes: Position[] = [];
      for (const [dr, dc] of jumps) {
        const nr = knight.position.r + dr;
        const nc = knight.position.c + dc;
        if (inBounds(nr, nc)) {
          const pos = { r: nr, c: nc };
          const blockedByWall = simulatedWalls.some(w => w.position.r === nr && w.position.c === nc);
          const blockedByPiece = finalPieces.some(p => p.position.r === nr && p.position.c === nc && p.id !== knightId);
          if (!blockedByWall && !blockedByPiece) {
            escapes.push(pos);
          }
        }
      }

      if (escapes.length > 0) {
        for (const escapePos of escapes) {
          const branchedPieces = finalPieces.map(p => {
            if (p.id === knightId) {
              return {
                ...p,
                position: { ...escapePos },
                passiveCooldown: 3
              };
            }
            return p;
          });
          branches.push({
            simulatedPieces: branchedPieces,
            simulatedWalls,
            simulatedGraveyard
          });
        }
      }
    }
  }

  if (branches.length === 0) {
    branches.push({
      simulatedPieces: finalPieces,
      simulatedWalls,
      simulatedGraveyard
    });
  }

  return branches;
}

// Single state simulation (returns first branch)
export function simulateAction(
  action: AIAction,
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[]
): { simulatedPieces: Piece[]; simulatedWalls: Wall[]; simulatedGraveyard: Piece[] } {
  const branches = simulateActionBranches(action, pieces, walls, graveyard);
  return branches[0];
}

// Determines if a specific simulated action successfully escapes Check
export function isActionSaving(
  act: AIAction,
  color: PlayerColor,
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[]
): boolean {
  const actor = pieces.find(p => p.id === act.pieceId);
  if (!actor) return false;

  // King's Command (Super) multi-turn simulation
  if (actor.type === 'king' && act.type === 'super') {
    const branches = simulateActionBranches(act, pieces, walls, graveyard);
    for (const branch of branches) {
      // Generate and evaluate secondary-turn actions
      const secondActions = generateAllActions(color, branch.simulatedPieces, branch.simulatedWalls, branch.simulatedGraveyard);
      for (const secondAct of secondActions) {
        const secondBranches = simulateActionBranches(secondAct, branch.simulatedPieces, branch.simulatedWalls, branch.simulatedGraveyard);
        for (const secBranch of secondBranches) {
          const simKing = secBranch.simulatedPieces.find(pk => pk.color === color && pk.type === 'king' && pk.hp > 0);
          if (simKing) {
            const isSafe = !isSquareUnderThreat(simKing.position, color, secBranch.simulatedPieces, secBranch.simulatedWalls);
            if (isSafe) {
              return true; // Escaped check!
            }
          }
        }
      }
    }
    return false;
  }

  // Standard simulation
  const branches = simulateActionBranches(act, pieces, walls, graveyard);
  for (const branch of branches) {
    const simKing = branch.simulatedPieces.find(pk => pk.color === color && pk.type === 'king' && pk.hp > 0);
    if (simKing) {
      const isSafe = !isSquareUnderThreat(simKing.position, color, branch.simulatedPieces, branch.simulatedWalls);
      if (isSafe) {
        return true; // Escaped check!
      }
    }
  }

  return false;
}

// Prioritizes list of actions based on escape priority
export function prioritizeActions(
  actions: AIAction[],
  color: PlayerColor,
  pieces: Piece[],
  walls: Wall[]
): AIAction[] {
  const threats = getThreats(color, pieces, walls);
  const threatPosSet = new Set(threats.map(t => `${t.position.r},${t.position.c}`));

  const getPriority = (act: AIAction): number => {
    const p = pieces.find(piece => piece.id === act.pieceId);
    if (!p) return 6;

    // 1. King movement
    if (p.type === 'king' && act.type === 'move') {
      return 1;
    }

    // 2. Directly defeating the attacking piece
    const isTargetThreat = threatPosSet.has(`${act.target.r},${act.target.c}`);
    if (isTargetThreat) {
      if (act.type === 'attack') return 2;
      if (p.type === 'knight' && (act.type === 'ability' || act.type === 'super')) return 2;
    }
    if (p.type === 'rook' && act.type === 'super') {
      const isThreatInLine = threats.some(t => t.position.r === p.position.r || t.position.c === p.position.c);
      if (isThreatInLine) return 2;
    }

    // 3. Blocking the attack (movement, Royal Call, Barricade, Resurrection)
    if (p.type !== 'king' && act.type === 'move') return 3;
    if (p.type === 'king' && act.type === 'ability') return 3; // Royal Call
    if (p.type === 'rook' && act.type === 'ability') return 3; // Barricade
    if (p.type === 'bishop' && act.type === 'super') return 3; // Resurrection

    // 4. Disabling the attacker (Charm, Royal Lockdown)
    if (p.type === 'queen' && (act.type === 'ability' || act.type === 'super')) return 4;

    // 5. Actions enabled by King's Command
    if (p.type === 'king' && act.type === 'super') return 5;

    // 6. All remaining legal actions
    return 6;
  };

  return [...actions].sort((a, b) => getPriority(a) - getPriority(b));
}

export function hasNormalSavingMoves(color: PlayerColor, pieces: Piece[], walls: Wall[], graveyard: Piece[]): boolean {
  const king = pieces.find(p => p.color === color && p.type === 'king' && p.hp > 0);
  if (!king) return false;

  const kingUnderThreat = isSquareUnderThreat(king.position, color, pieces, walls);
  if (!kingUnderThreat) return true; // Safe

  let actions = generateAllActions(color, pieces, walls, graveyard);
  actions = prioritizeActions(actions, color, pieces, walls);

  for (const act of actions) {
    if (isActionSaving(act, color, pieces, walls, graveyard)) {
      return true; // Found at least one saving move!
    }
  }

  return false;
}

function filterThreatActions(
  actions: AIAction[],
  color: PlayerColor,
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[]
): AIAction[] {
  const king = pieces.find(p => p.color === color && p.type === 'king' && p.hp > 0);
  if (!king) return actions;

  const kingUnderThreat = isSquareUnderThreat(king.position, color, pieces, walls);
  const isCheckmate = kingUnderThreat && (!hasNormalSavingMoves(color, pieces, walls, graveyard) || (king.consecutiveCheckCount || 0) >= 5);

  const allowedActions = actions.filter(act => {
    const actor = pieces.find(p => p.id === act.pieceId);
    if (actor && actor.type === 'king' && act.type === 'super') return true;

    // In checkmate, allow the King to move/attack still so that it can eventually escape if possible!
    if (actor && actor.type === 'king' && isCheckmate) {
      return true;
    }

    // Special rule: if the King is pushed to a corner without any safe squares to go to, 
    // allow the King to attack any adjacent enemy piece that is currently threatening the King,
    // even if the simulated final position is still under threat.
    if (actor && actor.type === 'king' && act.type === 'attack' && isCheckmate) {
      const targetEnemy = pieces.find(
        enemy => enemy.position.r === act.target.r && enemy.position.c === act.target.c && enemy.color !== color && enemy.hp > 0
      );
      if (targetEnemy && !isFrozen(targetEnemy)) {
        const enemyAttacks = getLegalAttacks(targetEnemy, pieces, walls);
        const isThreateningKing = enemyAttacks.some(atk => atk.r === king.position.r && atk.c === king.position.c);
        if (isThreateningKing) {
          return true;
        }
      }
    }

    // Rule for other pieces: if the King is pushed to a corner without any safe squares to go to,
    // allow other pieces to attack the piece or pieces threatening the King, as long as
    // they can eventually generate a safe square for the King (i.e. in simulation, either the King
    // is no longer under threat, or has at least one safe move square to go to).
    if (actor && actor.type !== 'king' && isCheckmate && (act.type === 'attack' || act.type === 'ability' || act.type === 'super')) {
      const targetEnemy = pieces.find(
        enemy => enemy.position.r === act.target.r && enemy.position.c === act.target.c && enemy.color !== color && enemy.hp > 0
      );
      if (targetEnemy && !isFrozen(targetEnemy)) {
        const enemyAttacks = getLegalAttacks(targetEnemy, pieces, walls);
        const isThreateningKing = enemyAttacks.some(atk => atk.r === king.position.r && atk.c === king.position.c);
        if (isThreateningKing) {
          const sim = simulateAction(act, pieces, walls, graveyard);
          const simKing = sim.simulatedPieces.find(pk => pk.color === color && pk.type === 'king' && pk.hp > 0);
          if (simKing) {
            const isKingPosSafe = !isSquareUnderThreat(simKing.position, color, sim.simulatedPieces, sim.simulatedWalls);
            const simKingMoves = getLegalMoves(simKing, sim.simulatedPieces, sim.simulatedWalls);
            const hasSafeSimKingMove = simKingMoves.some(m => !isSquareUnderThreat(m, color, sim.simulatedPieces, sim.simulatedWalls));
            if (isKingPosSafe || hasSafeSimKingMove) {
              return true;
            }
          }
        }
      }
    }

    const sim = simulateAction(act, pieces, walls, graveyard);
    const simKing = sim.simulatedPieces.find(pk => pk.color === color && pk.type === 'king' && pk.hp > 0);
    if (!simKing) return false;
    return !isSquareUnderThreat(simKing.position, color, sim.simulatedPieces, sim.simulatedWalls);
  });

  // Second-time checkmate bypass
  const isSecondCheckmate = kingUnderThreat && king.lastStandUsed && allowedActions.length === 0;
  if (isSecondCheckmate) {
    return actions;
  }

  if (kingUnderThreat) {
    return allowedActions.length > 0 ? allowedActions : actions;
  }

  return allowedActions;
}

// Alpha-Beta Minimax search
function minimax(
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[],
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  difficulty: 'easy' | 'medium' | 'hard',
  aiColor: PlayerColor = 'black'
): { score: number; action: AIAction | null } {
  const opponentColor = aiColor === 'white' ? 'black' : 'white';
  const aiKing = pieces.find(p => p.color === aiColor && p.type === 'king' && p.hp > 0);
  const opponentKing = pieces.find(p => p.color === opponentColor && p.type === 'king' && p.hp > 0);

  if (!opponentKing) return { score: 100000 + depth, action: null }; // AI wins
  if (!aiKing) return { score: -100000 - depth, action: null }; // Opponent wins

  if (depth === 0) {
    return { score: evaluateState(pieces, walls, isMaximizing ? aiColor : opponentColor, difficulty, aiColor), action: null };
  }

  if (isMaximizing) {
    let maxScore = -Infinity;
    let bestAction: AIAction | null = null;
    
    // Generate AI actions (If AI King is threatened, restrict to King actions or threat killing actions)
    let actions = generateAllActions(aiColor, pieces, walls, graveyard);
    actions = filterThreatActions(actions, aiColor, pieces, walls, graveyard);

    // Prioritize actions (heuristics to speed up pruning)
    actions.sort((a, b) => {
      const typeWeight = { super: 4, attack: 3, ability: 2, move: 1 };
      return typeWeight[b.type] - typeWeight[a.type];
    });

    for (const act of actions.slice(0, 30)) { // Branch limit for search speed
      const { simulatedPieces, simulatedWalls, simulatedGraveyard } = simulateAction(act, pieces, walls, graveyard);
      const evalRes = minimax(simulatedPieces, simulatedWalls, simulatedGraveyard, depth - 1, alpha, beta, false, difficulty, aiColor);

      if (evalRes.score > maxScore) {
        maxScore = evalRes.score;
        bestAction = act;
      }
      alpha = Math.max(alpha, evalRes.score);
      if (beta <= alpha) break; // Beta cut-off
    }

    return { score: maxScore, action: bestAction };
  } else {
    let minScore = Infinity;
    let bestAction: AIAction | null = null;
    
    // Generate opponent actions (If opponent King is threatened, restrict to opponent King actions or threat killing actions)
    let actions = generateAllActions(opponentColor, pieces, walls, graveyard);
    actions = filterThreatActions(actions, opponentColor, pieces, walls, graveyard);

    actions.sort((a, b) => {
      const typeWeight = { super: 4, attack: 3, ability: 2, move: 1 };
      return typeWeight[b.type] - typeWeight[a.type];
    });

    for (const act of actions.slice(0, 30)) {
      const { simulatedPieces, simulatedWalls, simulatedGraveyard } = simulateAction(act, pieces, walls, graveyard);
      const evalRes = minimax(simulatedPieces, simulatedWalls, simulatedGraveyard, depth - 1, alpha, beta, true, difficulty, aiColor);

      if (evalRes.score < minScore) {
        minScore = evalRes.score;
        bestAction = act;
      }
      beta = Math.min(beta, evalRes.score);
      if (beta <= alpha) break; // Alpha cut-off
    }

    return { score: minScore, action: bestAction };
  }
}

// Select move based on difficulty
export function getBestAction(
  difficulty: 'easy' | 'medium' | 'hard',
  pieces: Piece[],
  walls: Wall[],
  graveyard: Piece[],
  aiColor: PlayerColor = 'black'
): AIAction | null {
  let actions = generateAllActions(aiColor, pieces, walls, graveyard);
  actions = filterThreatActions(actions, aiColor, pieces, walls, graveyard);

  if (actions.length === 0) return null;

  if (difficulty === 'easy') {
    // Easy AI Priorities:
    // 1. Attack if possible (sometimes miss opportunities intentionally)
    const attacks = actions.filter(a => a.type === 'attack');
    if (attacks.length > 0) {
      const lethalAttacks = attacks.filter(act => {
        const p = pieces.find(piece => piece.id === act.pieceId);
        const target = pieces.find(piece => piece.position.r === act.target.r && piece.position.c === act.target.c && piece.hp > 0);
        if (p && target) {
          if (target.type === 'rook' && target.ironShellState === 'ready') return false;
          if (target.type === 'pawn' && target.statusEffects.some(se => se.type === 'armor')) return false;
          const dmg = getEffectiveAttack(p);
          const armor = getArmor(target);
          return target.hp <= Math.max(0, dmg - armor);
        }
        return false;
      });
      const nonLethalAttacks = attacks.filter(act => !lethalAttacks.includes(act));

      // Intentionally miss lethal opportunity 40% of the time if non-lethal is available
      if (Math.random() < 0.4 && nonLethalAttacks.length > 0) {
        return nonLethalAttacks[Math.floor(Math.random() * nonLethalAttacks.length)];
      } else {
        return attacks[Math.floor(Math.random() * attacks.length)];
      }
    }

    // 2. Move toward nearest enemy
    const moves = actions.filter(a => a.type === 'move');
    if (moves.length > 0) {
      const movesWithDist = moves.map(act => {
        const p = pieces.find(piece => piece.id === act.pieceId);
        const currentDist = p ? getDistanceToNearestEnemy(p.position, pieces, aiColor) : Infinity;
        const targetDist = getDistanceToNearestEnemy(act.target, pieces, aiColor);
        return { act, currentDist, targetDist };
      });

      const closerMoves = movesWithDist.filter(m => m.targetDist < m.currentDist);
      if (closerMoves.length > 0 && Math.random() < 0.8) {
        return closerMoves[Math.floor(Math.random() * closerMoves.length)].act;
      }
    }

    // 3. Use Ability if available
    const abilities = actions.filter(a => a.type === 'ability');
    if (abilities.length > 0) {
      return abilities[Math.floor(Math.random() * abilities.length)];
    }

    // 4. Otherwise perform a random legal action
    return actions[Math.floor(Math.random() * actions.length)];
  }

  if (difficulty === 'medium') {
    // Normal AI (medium): Depth 2 Minimax look-ahead
    let bestScore = -Infinity;
    let bestActions: AIAction[] = [];

    for (const act of actions) {
      const { simulatedPieces, simulatedWalls, simulatedGraveyard } = simulateAction(act, pieces, walls, graveyard);
      
      const opponentEval = minimax(simulatedPieces, simulatedWalls, simulatedGraveyard, 1, -Infinity, Infinity, false, 'medium', aiColor);
      let score = opponentEval.score;

      // Add situational tactical opportunistic bonuses
      const tacticalBonus = getNormalTacticalBonus(act, pieces, walls, graveyard);
      score += tacticalBonus;
      
      // Jitter score to prevent mechanical repetition
      const jitterScore = score + (Math.random() - 0.5) * 15;

      if (jitterScore > bestScore) {
        bestScore = jitterScore;
        bestActions = [act];
      } else if (Math.abs(jitterScore - bestScore) < 5) {
        bestActions.push(act);
      }
    }

    return bestActions[Math.floor(Math.random() * bestActions.length)];
  }

  // Hard AI: Minimax depth 3 with full alpha-beta pruning (highly strategic look ahead)
  const result = minimax(pieces, walls, graveyard, 3, -Infinity, Infinity, true, 'hard', aiColor);
  return result.action || actions[Math.floor(Math.random() * actions.length)];
}
