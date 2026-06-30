/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Piece, PieceType, PlayerColor, Position, StatusEffect, Wall, GameState } from '../types';

export function createInitialPieces(): Piece[] {
  const pieces: Piece[] = [];
  
  const setupRow = (color: PlayerColor, row: number) => {
    const types: PieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
    return types.map((type, col) => {
      let maxHp = 4;
      let attack = 2;
      switch (type) {
        case 'king': maxHp = 12; attack = 4; break;
        case 'queen': maxHp = 10; attack = 4; break;
        case 'rook': maxHp = 9; attack = 4; break;
        case 'knight': maxHp = 8; attack = 5; break;
        case 'bishop': maxHp = 8; attack = 2; break;
        case 'pawn': maxHp = 4; attack = 2; break;
      }
      return {
        id: `${color}-${type}-${col}-${Date.now() + Math.random()}`,
        type,
        color,
        position: { r: row, c: col },
        hp: maxHp,
        maxHp,
        attack,
        cooldowns: { ability: 0 },
        superProgress: 0,
        superUnlocked: false,
        statusEffects: [],
        passiveCooldown: 0,
        ironShellState: (type === 'rook' ? 'ready' : undefined) as 'ready' | 'charging' | undefined,
        ironShellProgress: type === 'rook' ? 0 : undefined,
        consecutiveCheckCount: type === 'king' ? 0 : undefined
      };
    });
  };

  const setupPawns = (color: PlayerColor, row: number) => {
    return Array.from({ length: 8 }).map((_, col) => ({
      id: `${color}-pawn-${col}-${Date.now() + Math.random()}`,
      type: 'pawn' as PieceType,
      color,
      position: { r: row, c: col },
      hp: 4,
      maxHp: 4,
      attack: 2,
      cooldowns: { ability: 0 },
      superProgress: 0,
      superUnlocked: false,
      statusEffects: [],
      passiveCooldown: 0
    }));
  };

  // Black pieces (top: rows 0 and 1)
  pieces.push(...setupRow('black', 0));
  pieces.push(...setupPawns('black', 1));

  // White pieces (bottom: rows 6 and 7)
  pieces.push(...setupPawns('white', 6));
  pieces.push(...setupRow('white', 7));

  return pieces;
}

// Helpers for board boundary checking
export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function isSquareBlockedByWall(pos: Position, walls: Wall[]): boolean {
  return walls.some(w => w.position.r === pos.r && w.position.c === pos.c);
}

export function getPieceAt(pos: Position, pieces: Piece[]): Piece | undefined {
  return pieces.find(p => p.position.r === pos.r && p.position.c === pos.c && p.hp > 0);
}

// Check if an ability is suppressed for a piece (Queen's passive: enemies within 2 squares can't use abilities. Immune for Royal pieces)
export function isAbilitySuppressed(piece: Piece, pieces: Piece[]): boolean {
  if (piece.type === 'king' || piece.type === 'queen') {
    return false;
  }
  const opponentColor = piece.color === 'white' ? 'black' : 'white';
  const enemyQueens = pieces.filter(p => p.color === opponentColor && p.type === 'queen' && p.hp > 0);
  
  for (const queen of enemyQueens) {
    const dr = Math.abs(queen.position.r - piece.position.r);
    const dc = Math.abs(queen.position.c - piece.position.c);
    if (Math.max(dr, dc) <= 2) {
      return true; // Queen passive within Chebyshev distance of 2
    }
  }
  return false;
}

export function getEffectiveAttack(piece: Piece): number {
  let atk = piece.attack;
  // Pawn Passive: Frenzy - Gain +2 Attack while below or equal 50% HP
  if (piece.type === 'pawn' && piece.hp <= piece.maxHp / 2) {
    atk += 2;
  }
  if (piece.type === 'king' && piece.inLastStand) {
    atk *= 2;
  }
  return atk;
}

export function isFrozen(piece: Piece): boolean {
  return piece.statusEffects.some(se => se.type === 'frozen' && se.duration > 0);
}

export function getArmor(piece: Piece): number {
  const armorEffect = piece.statusEffects.find(se => se.type === 'armor');
  return armorEffect ? (armorEffect.value || 0) : 0;
}

// Traditional legal movement paths
export function getLegalMoves(piece: Piece, pieces: Piece[], walls: Wall[]): Position[] {
  if (isFrozen(piece)) return [];
  if (piece.rookSuperTurns && piece.rookSuperTurns > 0) return [];
  
  const moves: Position[] = [];
  const { r, c } = piece.position;

  const addSlide = (dr: number, dc: number) => {
    let currR = r + dr;
    let currC = c + dc;
    while (inBounds(currR, currC)) {
      const pos = { r: currR, c: currC };
      if (isSquareBlockedByWall(pos, walls)) break;
      const other = getPieceAt(pos, pieces);
      if (other) {
        // Can't move onto occupied square, but wait, attack is separate!
        // In Kingdom Chess, "Move" is to an empty square, "Attack" is separate on occupied square.
        break;
      }
      moves.push(pos);
      currR += dr;
      currC += dc;
    }
  };

  switch (piece.type) {
    case 'king': {
      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      const maxSteps = piece.inLastStand ? 2 : 1;
      for (const [dr, dc] of dirs) {
        for (let step = 1; step <= maxSteps; step++) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (inBounds(nr, nc)) {
            const pos = { r: nr, c: nc };
            if (isSquareBlockedByWall(pos, walls) || getPieceAt(pos, pieces)) {
              break;
            }
            moves.push(pos);
          } else {
            break;
          }
        }
      }

      // Castling logic (Check restrictions removed to allow escaping check/checkmate)
      if (!piece.inLastStand && !piece.hasMoved) {
        // Kingside castling
        const rookKingside = pieces.find(p => p.position.r === r && p.position.c === 7 && p.color === piece.color && p.type === 'rook' && p.hp > 0);
        if (rookKingside && !rookKingside.hasMoved) {
          const pathEmpty = !getPieceAt({ r, c: 5 }, pieces) && !getPieceAt({ r, c: 6 }, pieces);
          const pathUnblocked = !isSquareBlockedByWall({ r, c: 5 }, walls) && !isSquareBlockedByWall({ r, c: 6 }, walls);
          if (pathEmpty && pathUnblocked) {
            moves.push({ r, c: 6 });
          }
        }

        // Queenside castling
        const rookQueenside = pieces.find(p => p.position.r === r && p.position.c === 0 && p.color === piece.color && p.type === 'rook' && p.hp > 0);
        if (rookQueenside && !rookQueenside.hasMoved) {
          const pathEmpty = !getPieceAt({ r, c: 1 }, pieces) && !getPieceAt({ r, c: 2 }, pieces) && !getPieceAt({ r, c: 3 }, pieces);
          const pathUnblocked = !isSquareBlockedByWall({ r, c: 1 }, walls) && !isSquareBlockedByWall({ r, c: 2 }, walls) && !isSquareBlockedByWall({ r, c: 3 }, walls);
          if (pathEmpty && pathUnblocked) {
            moves.push({ r, c: 2 });
          }
        }
      }
      break;
    }

    case 'queen': {
      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dr, dc] of dirs) {
        addSlide(dr, dc);
      }
      break;
    }

    case 'rook': {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        addSlide(dr, dc);
      }
      break;
    }

    case 'bishop': {
      const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [dr, dc] of dirs) {
        addSlide(dr, dc);
      }
      break;
    }

    case 'knight': {
      const jumps = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2],  [1, 2],  [2, -1],  [2, 1]
      ];
      for (const [dr, dc] of jumps) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc)) {
          const pos = { r: nr, c: nc };
          if (!isSquareBlockedByWall(pos, walls) && !getPieceAt(pos, pieces)) {
            moves.push(pos);
          }
        }
      }
      break;
    }

    case 'pawn': {
      // Pawn standard forward moves
      const dir = piece.color === 'white' ? -1 : 1;
      const startRow = piece.color === 'white' ? 6 : 1;

      // 1 step forward
      const pos1 = { r: r + dir, c };
      if (inBounds(pos1.r, pos1.c) && !isSquareBlockedByWall(pos1, walls) && !getPieceAt(pos1, pieces)) {
        moves.push(pos1);
        
        // 2 steps forward from starting row
        const pos2 = { r: r + 2 * dir, c };
        if (r === startRow && inBounds(pos2.r, pos2.c) && !isSquareBlockedByWall(pos2, walls) && !getPieceAt(pos2, pieces)) {
          moves.push(pos2);
        }
      }
      break;
    }
  }

  return moves;
}

export function isLineOfSightBlocked(p1: Position, p2: Position, walls: Wall[]): boolean {
  const dr = p2.r - p1.r;
  const dc = p2.c - p1.c;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return false;
  
  for (let i = 1; i < steps; i++) {
    const r = p1.r + Math.round((dr * i) / steps);
    const c = p1.c + Math.round((dc * i) / steps);
    if (isSquareBlockedByWall({ r, c }, walls)) {
      return true;
    }
  }
  return false;
}

// Return positions of enemy pieces that can be attacked
export function getLegalAttacks(piece: Piece, pieces: Piece[], walls: Wall[]): Position[] {
  if (isFrozen(piece)) return [];
  if (piece.rookSuperTurns && piece.rookSuperTurns > 0) return [];

  const attacks: Position[] = [];
  const { r, c } = piece.position;
  const opponentColor = piece.color === 'white' ? 'black' : 'white';

  const checkMeleeAttack = (dr: number, dc: number) => {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc)) {
      const pos = { r: nr, c: nc };
      if (!isSquareBlockedByWall(pos, walls)) {
        const other = getPieceAt(pos, pieces);
        if (other && other.color === opponentColor) {
          attacks.push(pos);
        }
      }
    }
  };

  const getSlidingAttacks = (dirs: number[][]) => {
    for (const [dr, dc] of dirs) {
      // 1. Check if immediate adjacent cell is an enemy (no move needed)
      const firstR = r + dr;
      const firstC = c + dc;
      if (inBounds(firstR, firstC)) {
        const firstPos = { r: firstR, c: firstC };
        if (!isSquareBlockedByWall(firstPos, walls)) {
          const firstPiece = getPieceAt(firstPos, pieces);
          if (firstPiece) {
            if (firstPiece.color === opponentColor) {
              attacks.push(firstPos);
            }
            continue; // Blocked by piece, cannot slide further
          }
        } else {
          continue; // Blocked by wall, cannot slide further
        }
      }

      // 2. Slide further: pre-attack cell must be empty and unblocked
      let step = 1;
      while (true) {
        const preR = r + step * dr;
        const preC = c + step * dc;
        if (!inBounds(preR, preC)) break;
        const prePos = { r: preR, c: preC };
        if (isSquareBlockedByWall(prePos, walls) || getPieceAt(prePos, pieces)) {
          break; // Obstacle blocks sliding movement
        }

        const nextR = r + (step + 1) * dr;
        const nextC = c + (step + 1) * dc;
        if (inBounds(nextR, nextC)) {
          const nextPos = { r: nextR, c: nextC };
          if (!isSquareBlockedByWall(nextPos, walls)) {
            const nextPiece = getPieceAt(nextPos, pieces);
            if (nextPiece) {
              if (nextPiece.color === opponentColor) {
                attacks.push(nextPos);
              }
              break; // Blocked after this target
            }
          } else {
            break; // Blocked by wall
          }
        } else {
          break; // Out of bounds
        }
        step++;
      }
    }
  };

  switch (piece.type) {
    case 'king': {
      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      if (piece.inLastStand) {
        for (const [dr, dc] of dirs) {
          // Check 1 step melee attack
          const nr1 = r + dr;
          const nc1 = c + dc;
          if (inBounds(nr1, nc1)) {
            const pos1 = { r: nr1, c: nc1 };
            if (!isSquareBlockedByWall(pos1, walls)) {
              const other1 = getPieceAt(pos1, pieces);
              if (other1) {
                if (other1.color === opponentColor) {
                  attacks.push(pos1);
                }
              } else {
                // If 1st step is empty, check 2nd step
                const nr2 = r + 2 * dr;
                const nc2 = c + 2 * dc;
                if (inBounds(nr2, nc2)) {
                  const pos2 = { r: nr2, c: nc2 };
                  if (!isSquareBlockedByWall(pos2, walls)) {
                    const other2 = getPieceAt(pos2, pieces);
                    if (other2 && other2.color === opponentColor) {
                      attacks.push(pos2);
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        for (const [dr, dc] of dirs) {
          checkMeleeAttack(dr, dc);
        }
      }
      break;
    }

    case 'queen': {
      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      getSlidingAttacks(dirs);
      break;
    }

    case 'rook': {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      getSlidingAttacks(dirs);
      break;
    }

    case 'bishop': {
      const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      getSlidingAttacks(dirs);
      break;
    }

    case 'knight': {
      const jumps = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2],  [1, 2],  [2, -1],  [2, 1]
      ];
      for (const [dr, dc] of jumps) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc)) {
          const targetPos = { r: nr, c: nc };
          const other = getPieceAt(targetPos, pieces);
          if (other && other.color === opponentColor) {
            attacks.push(targetPos);
          }
        }
      }
      break;
    }

    case 'pawn': {
      // Pawns attack diagonally forward
      const dir = piece.color === 'white' ? -1 : 1;
      const diagonalCols = [c - 1, c + 1];
      for (const col of diagonalCols) {
        if (inBounds(r + dir, col)) {
          const pos = { r: r + dir, c: col };
          if (!isSquareBlockedByWall(pos, walls)) {
            const other = getPieceAt(pos, pieces);
            if (other && other.color === opponentColor) {
              attacks.push(pos);
            }
          }
        }
      }
      break;
    }
  }

  return attacks;
}

// Determine if a square is under direct threat of attack by any active enemy piece
export function isSquareUnderThreat(pos: Position, defenderColor: PlayerColor, pieces: Piece[], walls: Wall[]): boolean {
  const enemies = pieces.filter(p => p.color !== defenderColor && p.hp > 0);
  for (const enemy of enemies) {
    if (isFrozen(enemy)) continue;
    const attacks = getLegalAttacks(enemy, pieces, walls);
    if (attacks.some(atk => atk.r === pos.r && atk.c === pos.c)) {
      return true;
    }
  }
  return false;
}

// Return potential targets for active special abilities
export function getAbilityTargets(piece: Piece, pieces: Piece[], walls: Wall[]): Position[] {
  if (isFrozen(piece) || piece.cooldowns.ability > 0 || isAbilitySuppressed(piece, pieces)) return [];

  const targets: Position[] = [];
  const { r, c } = piece.position;

  switch (piece.type) {
    case 'king': {
      // Royal Call: Summon a brand new allied Pawn onto an adjacent square. Max 8 allied Pawns on board.
      const alliedPawnsCount = pieces.filter(p => p.color === piece.color && p.type === 'pawn' && p.hp > 0).length;
      if (alliedPawnsCount >= 8) return [];

      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc)) {
          const pos = { r: nr, c: nc };
          if (!isSquareBlockedByWall(pos, walls) && !getPieceAt(pos, pieces)) {
            targets.push(pos);
          }
        }
      }
      break;
    }

    case 'queen': {
      // Charm: Target must be first enemy in horizontal, vertical or diagonal line of sight.
      // Cannot target enemy King or enemy Queen. Walls block line of sight.
      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dr, dc] of dirs) {
        let step = 1;
        while (true) {
          const nr = r + step * dr;
          const nc = c + step * dc;
          if (!inBounds(nr, nc)) break;
          const pos = { r: nr, c: nc };
          if (isSquareBlockedByWall(pos, walls)) {
            // Walls block line of sight
            break;
          }
          const other = getPieceAt(pos, pieces);
          if (other) {
            if (other.color !== piece.color) {
              if (other.type !== 'king' && other.type !== 'queen') {
                targets.push(pos);
              }
            }
            // Blocked by this piece
            break;
          }
          step++;
        }
      }
      break;
    }

    case 'bishop': {
      // Divine Heal: Range 3 squares, walls block healing. Friendly allies only (not self).
      const friendlyAllies = pieces.filter(
        p => p.color === piece.color && p.hp > 0 && p.hp < p.maxHp && p.id !== piece.id
      );
      friendlyAllies.forEach(ally => {
        const dist = Math.max(Math.abs(piece.position.r - ally.position.r), Math.abs(piece.position.c - ally.position.c));
        if (dist <= 3 && !isLineOfSightBlocked(piece.position, ally.position, walls)) {
          targets.push(ally.position);
        }
      });
      break;
    }

    case 'knight': {
      // Charge: Move normally, landing adjacent to an enemy deals 2 bonus damage.
      // Target squares are same as normal legal moves.
      targets.push(...getLegalMoves(piece, pieces, walls));

      // Also allow direct targeting of an enemy piece if a standard attack can kill it
      const attacks = getLegalAttacks(piece, pieces, walls);
      const dmg = getEffectiveAttack(piece);
      const opponentColor = piece.color === 'white' ? 'black' : 'white';
      
      for (const atkPos of attacks) {
        const target = pieces.find(p => p.position.r === atkPos.r && p.position.c === atkPos.c && p.color === opponentColor && p.hp > 0);
        if (target) {
          if (target.type === 'rook' && target.ironShellState === 'ready') continue;
          if (target.type === 'pawn' && target.statusEffects.some(se => se.type === 'armor')) continue;
          const armor = getArmor(target);
          const netDmg = Math.max(0, dmg - armor);
          if (target.hp <= netDmg) {
            targets.push(atkPos);
          }
        }
      }
      break;
    }

    case 'rook': {
      // Rook's new ability: Grey Shield to a friendly ally within 2 squares
      const friendlyAllies = pieces.filter(
        p => p.color === piece.color && p.hp > 0 && p.id !== piece.id
      );
      friendlyAllies.forEach(ally => {
        const dist = Math.max(Math.abs(piece.position.r - ally.position.r), Math.abs(piece.position.c - ally.position.c));
        if (dist <= 2) {
          targets.push(ally.position);
        }
      });
      break;
    }

    case 'pawn': {
      // Brace: Self-targeted. Gain 2 Armor.
      targets.push(piece.position);
      break;
    }
  }

  return targets;
}

// Return potential targets for Supers
export function getSuperTargets(piece: Piece, pieces: Piece[], walls: Wall[], graveyard: Piece[]): Position[] {
  if (isFrozen(piece) || !piece.superUnlocked) return [];

  const targets: Position[] = [];
  const { r, c } = piece.position;

  switch (piece.type) {
    case 'king': {
      // King's Command: Gain one additional full turn. Self-targeted.
      targets.push(piece.position);
      break;
    }

    case 'queen': {
      // Royal Lockdown: Choose one of the Queen's current lines of sight.
      // Every enemy piece currently visible along that line becomes Frozen.
      // We can target any square along Queen's line of sight up to first wall.
      const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
      ];
      for (const [dr, dc] of dirs) {
        let step = 1;
        while (true) {
          const nr = r + step * dr;
          const nc = c + step * dc;
          if (!inBounds(nr, nc)) break;
          const pos = { r: nr, c: nc };
          if (isSquareBlockedByWall(pos, walls)) {
            break;
          }
          targets.push(pos);
          step++;
        }
      }
      break;
    }

    case 'bishop': {
      // Resurrection: Revive one defeated ally (cannot revive King) onto caster's back rank.
      const hasDefeatedAllies = graveyard.some(p => p.color === piece.color && p.type !== 'king');
      if (hasDefeatedAllies) {
        const backRankRow = piece.color === 'white' ? 7 : 0;
        for (let col = 0; col < 8; col++) {
          const pos = { r: backRankRow, c: col };
          if (!isSquareBlockedByWall(pos, walls) && !getPieceAt(pos, pieces)) {
            targets.push(pos);
          }
        }
      }
      break;
    }

    case 'knight': {
      // Decisive Strike: Instantly defeat enemy occupying Knight landing square (cannot target Kings).
      const opponentColor = piece.color === 'white' ? 'black' : 'white';
      const jumps = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2],  [1, 2],  [2, -1],  [2, 1]
      ];
      for (const [dr, dc] of jumps) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc)) {
          const pos = { r: nr, c: nc };
          const other = getPieceAt(pos, pieces);
          if (other && other.color === opponentColor && other.type !== 'king') {
            targets.push(pos);
          }
        }
      }
      break;
    }

    case 'rook': {
      // Cannonade: Fire in four directions. Deals 5 damage to first enemy struck.
      // Self-targeted activation.
      targets.push(piece.position);
      break;
    }

    default:
      break;
  }

  // Deduplicate positions
  const seen = new Set<string>();
  return targets.filter(pos => {
    const key = `${pos.r},${pos.c}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getThreats(color: PlayerColor, pieces: Piece[], walls: Wall[]): Piece[] {
  const activeKing = pieces.find(p => p.color === color && p.type === 'king' && p.hp > 0);
  if (!activeKing) return [];

  return pieces.filter(enemy => 
    enemy.color !== color && 
    enemy.hp > 0 && 
    !isFrozen(enemy) && 
    getLegalAttacks(enemy, pieces, walls).some(atk => atk.r === activeKing.position.r && atk.c === activeKing.position.c)
  );
}

export function canPieceKillThreat(piece: Piece, pieces: Piece[], walls: Wall[], graveyard: Piece[]): boolean {
  const threats = getThreats(piece.color, pieces, walls);
  if (threats.length === 0) return false;

  // 1. Check if piece can kill any threat via normal attack
  const attacks = getLegalAttacks(piece, pieces, walls);
  const dmg = getEffectiveAttack(piece);
  for (const threat of threats) {
    const isTargetable = attacks.some(atk => atk.r === threat.position.r && atk.c === threat.position.c);
    if (isTargetable) {
      if (threat.type === 'rook' && threat.ironShellState === 'ready') continue;
      if (threat.type === 'pawn' && threat.statusEffects.some(se => se.type === 'armor')) continue;
      const armor = getArmor(threat);
      const netDmg = Math.max(0, dmg - armor);
      if (threat.hp <= netDmg) {
        return true;
      }
    }
  }

  // 2. Check if piece is a Knight with ready Decisive Strike
  if (piece.type === 'knight' && piece.superUnlocked) {
    const superTargets = getSuperTargets(piece, pieces, walls, graveyard);
    for (const threat of threats) {
      const isTargetable = superTargets.some(st => st.r === threat.position.r && st.c === threat.position.c);
      if (isTargetable && threat.type !== 'king') {
        return true;
      }
    }
  }

  return false;
}
