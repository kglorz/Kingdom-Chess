/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Piece, Position, Wall, PlayerColor, VisualEffect, GameMode } from '../types';
import { getPieceAt, isFrozen, getArmor, isSquareUnderThreat } from '../utils/gameLogic';
import { motion, AnimatePresence } from 'motion/react';

interface BoardProps {
  pieces: Piece[];
  walls: Wall[];
  selectedPieceId: string | null;
  activeAction: 'move' | 'ability' | 'super' | null;
  highlightedSquares: Position[];
  currentPlayer: PlayerColor;
  onSquareClick: (pos: Position) => void;
  activeEffects?: VisualEffect[];
  mode?: GameMode;
  humanColor: PlayerColor;
  repositionPending?: any;
}

export default function Board({
  pieces,
  walls,
  selectedPieceId,
  activeAction,
  highlightedSquares,
  currentPlayer,
  onSquareClick,
  activeEffects = [],
  mode,
  humanColor,
  repositionPending
}: BoardProps) {
  
  const getPieceSymbol = (type: string, color: PlayerColor): string => {
    switch (type) {
      case 'king': return color === 'white' ? '♚' : '♚';
      case 'queen': return color === 'white' ? '♛' : '♛';
      case 'rook': return color === 'white' ? '♜' : '♜';
      case 'bishop': return color === 'white' ? '♝' : '♝';
      case 'knight': return color === 'white' ? '♞' : '♞';
      case 'pawn': return color === 'white' ? '♟' : '♟';
      default: return '';
    }
  };

  const selectedPiece = pieces.find(p => p.id === selectedPieceId) || null;

  const isWithinAbilityRange = (r: number, c: number): boolean => {
    if (activeAction !== 'ability' || !selectedPiece) return false;
    
    const actorR = selectedPiece.position.r;
    const actorC = selectedPiece.position.c;
    
    // Skip the piece's own position except for pawn which self-targets
    if (selectedPiece.type !== 'pawn' && actorR === r && actorC === c) return false;

    switch (selectedPiece.type) {
      case 'king': {
        const dist = Math.max(Math.abs(r - actorR), Math.abs(c - actorC));
        return dist === 1;
      }
      case 'queen': {
        const dr = Math.abs(r - actorR);
        const dc = Math.abs(c - actorC);
        return dr === dc || dr === 0 || dc === 0;
      }
      case 'bishop': {
        const dist = Math.max(Math.abs(r - actorR), Math.abs(c - actorC));
        return dist <= 3;
      }
      case 'knight': {
        const dr = Math.abs(r - actorR);
        const dc = Math.abs(c - actorC);
        return (dr === 1 && dc === 2) || (dr === 2 && dc === 1);
      }
      case 'rook': {
        const dist = Math.max(Math.abs(r - actorR), Math.abs(c - actorC));
        return dist <= 2;
      }
      case 'pawn': {
        return actorR === r && actorC === c;
      }
      default:
        return false;
    }
  };

  const getCellHighlightClass = (r: number, c: number): string => {
    const isHighlighted = highlightedSquares.some(pos => pos.r === r && pos.c === c);
    if (!isHighlighted) return '';

    if (repositionPending) {
      return 'after:absolute after:inset-0 after:bg-blue-500/25 after:border-2 after:border-blue-400 after:animate-pulse z-10 cursor-pointer';
    }

    if (activeAction === 'ability') {
      return 'after:absolute after:inset-0 after:bg-blue-500/20 after:border-2 after:border-blue-400 after:animate-pulse z-10 cursor-pointer';
    }
    if (activeAction === 'super') {
      return 'after:absolute after:inset-0 after:bg-amber-500/20 after:border-2 after:border-amber-400 after:animate-pulse z-10 cursor-pointer';
    }

    // Move or Attack highlights
    const piece = getPieceAt({ r, c }, pieces);
    if (piece && piece.color !== currentPlayer) {
      return 'after:absolute after:inset-0 after:bg-red-500/20 after:border-2 after:border-red-400 z-10 cursor-pointer';
    }
    return 'after:absolute after:w-3 after:h-3 after:rounded-full after:bg-emerald-400/50 cursor-pointer hover:bg-emerald-500/10';
  };

  const isSquareHighlighted = (r: number, c: number): boolean => {
    return highlightedSquares.some(pos => pos.r === r && pos.c === c);
  };

  const activeSuper = activeEffects.find(e => e.type === 'super');
  const activeLastStand = activeEffects.find(e => e.type === 'lastStand');
  const isFlipped = mode === 'pvp' ? (currentPlayer === 'black') : (humanColor === 'black');
  const rowLabels = isFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const colLabels = isFlipped ? ['H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'] : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  return (
    <div className="relative p-6 border-8 border-[#1a1d23] shadow-2xl bg-[#0d0f12] rounded-xl overflow-hidden">
      {/* File Coordinates */}
      <div className="absolute -left-6 top-0 bottom-0 flex flex-col justify-around text-[11px] font-mono font-bold text-[#6b7280]">
        {rowLabels.map(n => <span key={n}>{n}</span>)}
      </div>
      
      {/* Rank Coordinates */}
      <div className="absolute -bottom-6 left-0 right-0 flex justify-around text-[11px] font-mono font-bold text-[#6b7280]">
        {colLabels.map(c => <span key={c}>{c}</span>)}
      </div>

      <div className="relative grid grid-cols-8 grid-rows-8 w-[520px] h-[520px] border border-[#1a1c22]">
        {Array.from({ length: 64 }).map((_, idx) => {
          const rowIdx = Math.floor(idx / 8);
          const colIdx = idx % 8;
          const r = isFlipped ? 7 - rowIdx : rowIdx;
          const c = isFlipped ? 7 - colIdx : colIdx;
          const pos = { r, c };

          // Basic board checkerboard coloring
          const isLight = (r + c) % 2 === 0;
          const baseBg = isLight ? 'bg-[#2a2e37]' : 'bg-[#15171c]';

          const piece = getPieceAt(pos, pieces);
          const wall = walls.find(w => w.position.r === r && w.position.c === c);
          const isSelected = selectedPieceId && piece && piece.id === selectedPieceId;
          
          const rookWithBastion = pieces.find(p => 
            p.type === 'rook' && 
            p.hp > 0 && 
            p.rookSuperTurns !== undefined && 
            p.rookSuperTurns > 0 &&
            Math.max(Math.abs(p.position.r - r), Math.abs(p.position.c - c)) <= 3
          );
          
          const highlightClass = getCellHighlightClass(r, c);

          // Get active visual effects on this cell
          const cellEffects = activeEffects.filter(e => e.target && e.target.r === r && e.target.c === c);
          const sourceEffects = activeEffects.filter(e => e.type !== 'attack' && e.source.r === r && e.source.c === c);

          return (
            <div
              key={idx}
              onClick={() => onSquareClick(pos)}
              className={`relative flex items-center justify-center select-none transition-all duration-200 ${baseBg} ${highlightClass} ${
                isSelected ? 'outline outline-3 outline-[#c5a059] bg-[#c5a05915] z-10 shadow-[0_0_15px_rgba(197,160,89,0.3)]' : ''
              }`}
              style={{ contentVisibility: 'auto' }}
            >
              {/* Ability Range Highlight */}
              {isWithinAbilityRange(r, c) && (
                <div className="absolute inset-0.5 border border-dashed border-sky-400/40 bg-sky-500/10 pointer-events-none z-0 rounded-sm animate-[pulse_2s_infinite]" />
              )}

              {/* Rook Bastion Aura */}
              {rookWithBastion && (
                <div className={`absolute inset-0 pointer-events-none z-0 transition-all duration-300 ${
                  rookWithBastion.color === 'white' 
                    ? 'bg-amber-500/5 border border-amber-500/15' 
                    : 'bg-purple-500/5 border border-purple-500/15'
                }`} />
              )}

              {/* Display Impassable Wall */}
              {wall && (
                <div className="absolute inset-0 flex items-center justify-center bg-stone-700/80 border-2 border-stone-500 rounded z-10 animate-[bounce_0.4s_ease-out_1]">
                  <span className="text-xl font-bold text-stone-300">🧱</span>
                  <span className="absolute bottom-1 right-1 text-[9px] font-mono bg-black/50 text-stone-200 px-1 rounded">
                    {wall.duration}T
                  </span>
                </div>
              )}

              {/* Display Piece */}
              {piece && (() => {
                const charmEffect = piece.statusEffects.find(se => se.type === 'charmed');
                const charmDuration = charmEffect ? charmEffect.duration : 0;
                const freezeEffect = piece.statusEffects.find(se => se.type === 'frozen');
                const freezeDuration = freezeEffect ? freezeEffect.duration : 0;
                const armorEffect = piece.statusEffects.find(se => se.type === 'armor');
                const armorDuration = armorEffect ? armorEffect.duration : 0;
                const armorVal = armorEffect ? (armorEffect.value || 0) : 0;
                const greyShieldEffect = piece.statusEffects.find(se => se.type === 'greyShield');
                const greyShieldDuration = greyShieldEffect ? greyShieldEffect.duration : 0;
                const isCastingGreyShield = pieces.some(p => p.hp > 0 && p.statusEffects.some(se => se.type === 'greyShield' && se.casterId === piece.id));

                const isKing = piece.type === 'king';
                const isKingUnderCheck = isKing && isSquareUnderThreat(piece.position, piece.color, pieces, walls);

                return (
                  <div className="relative flex flex-col items-center justify-center w-full h-full cursor-pointer group">
                    {/* Fire aura for King in Last Stand */}
                    {piece.inLastStand && (
                      <div className="absolute w-14 h-14 rounded-full bg-orange-600/25 border border-orange-500 shadow-[0_0_20px_10px_rgba(234,88,12,0.4)] animate-pulse -z-10" />
                    )}

                    {/* Red pulsing check aura */}
                    {isKingUnderCheck && !piece.inLastStand && (
                      <div className="absolute w-12 h-12 rounded-full bg-red-600/25 border border-red-500 shadow-[0_0_15px_5px_rgba(239,68,68,0.5)] animate-pulse -z-10" />
                    )}

                    {/* Glowing yellow aura below pieces with available super */}
                    {piece.superUnlocked && !piece.inLastStand && (
                      <div className="absolute w-12 h-12 rounded-full bg-amber-500/10 border border-amber-400/30 shadow-[0_0_20px_10px_rgba(245,158,11,0.25)] animate-pulse -z-10" />
                    )}

                    {/* Grey shield aura ring */}
                    {(greyShieldDuration > 0 || isCastingGreyShield) && (
                      <div className="absolute w-12 h-12 rounded-full border-2 border-dashed border-stone-400/80 animate-spin [animation-duration:8s] -z-10" />
                    )}

                    {/* Health & Shield Timer Bar at the top */}
                    <div className="absolute top-1 left-1.5 right-1.5 flex items-center gap-1 z-10">
                      {/* Health Bar container (Complete like before) */}
                      <div className="flex-1 h-1.5 bg-[#1a1d23] border border-[#c5a05922] rounded overflow-hidden relative">
                        {/* Real Health Bar */}
                        <div
                          className={`absolute left-0 top-0 h-full ${
                            (mode === 'pve'
                              ? piece.color === humanColor
                              : piece.color === currentPlayer)
                              ? 'bg-emerald-500'
                              : 'bg-red-500'
                          } transition-all duration-300`}
                          style={{ width: `${(piece.hp / piece.maxHp) * 100}%` }}
                        />
                        {/* Blue Shield Bar overlay on the right side covering the real health bar */}
                        {(armorVal > 0 || (piece.type === 'rook' && piece.ironShellState === 'ready')) && (
                          <div
                            className="absolute right-0 top-0 h-full bg-blue-600 transition-all duration-300"
                            style={{ 
                              width: (piece.type === 'rook' && piece.ironShellState === 'ready') || (piece.type === 'pawn' && armorVal > 0)
                                ? '100%'
                                : `${Math.min(100, (armorVal / piece.maxHp) * 100)}%`
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Corner Badge: Charm Duration */}
                    {charmDuration > 0 && (
                      <div className="absolute top-2 right-1.5 flex items-center bg-pink-950/90 text-pink-200 border border-pink-400 rounded-full px-1 py-0.5 text-[8px] font-mono font-bold scale-90 leading-none z-10 shadow-sm" title={`Charmed for ${charmDuration} turn(s)`}>
                        💖 {charmDuration}
                      </div>
                    )}

                    {/* Corner Badge: Grey Shield Duration */}
                    {greyShieldDuration > 0 && (
                      <div className="absolute top-2 right-1.5 flex items-center bg-stone-700/95 text-stone-100 border border-stone-400 rounded-full px-1.5 py-0.5 text-[8px] font-mono font-bold scale-90 leading-none z-10 shadow-md animate-pulse" title={`Grey Shield split active: ${greyShieldDuration} turn(s) left`}>
                        🛡️ {greyShieldDuration}
                      </div>
                    )}

                    {/* Corner Badge: Freeze Duration */}
                    {freezeDuration > 0 && (
                      <div className="absolute top-2 left-1.5 flex items-center bg-cyan-950/90 text-cyan-200 border border-cyan-400 rounded-full px-1 py-0.5 text-[8px] font-mono font-bold scale-90 leading-none z-10 shadow-sm" title={`Frozen for ${freezeDuration} turn(s)`}>
                        ❄️ {freezeDuration}
                      </div>
                    )}

                    {/* Corner Badge: Ability Cooldown */}
                    {piece.cooldowns.ability > 0 && (
                      <div className="absolute bottom-1.5 left-1 flex items-center bg-stone-950/90 text-stone-300 border border-stone-600 rounded-full px-1 py-0.5 text-[8px] font-mono scale-90 leading-none z-10 shadow-sm" title={`Ability Cooldown: ${piece.cooldowns.ability}T`}>
                        ⏳ {piece.cooldowns.ability}
                      </div>
                    )}

                    {/* Corner Badge: Rook Iron Shell Charging Progress */}
                    {piece.type === 'rook' && piece.ironShellState !== 'ready' && (
                      <div className="absolute bottom-1.5 right-1 flex items-center bg-stone-900/90 text-stone-400 border border-stone-600 rounded-full px-1 py-0.5 text-[8px] font-mono scale-90 leading-none z-10 shadow-sm" title={`Iron Shell Charging: ${piece.ironShellProgress || 0}/5`}>
                        🛡️ {piece.ironShellProgress || 0}/5
                      </div>
                    )}

                    {/* Corner Badge: Rook Super active turns */}
                    {piece.type === 'rook' && piece.rookSuperTurns !== undefined && piece.rookSuperTurns > 0 && (
                      <div className="absolute top-1.5 right-1 flex items-center bg-amber-500/95 text-stone-950 border border-amber-300 rounded-full px-1 py-0.5 text-[8px] font-bold font-mono scale-90 leading-none z-10 shadow-lg animate-pulse" title={`Bastion Active: ${piece.rookSuperTurns} turns left`}>
                        🏰 {piece.rookSuperTurns}T
                      </div>
                    )}

                    {/* Piece Symbol */}
                    <span
                      className={`transition-all duration-300 group-hover:scale-110 ${
                        piece.inLastStand 
                          ? 'text-5xl font-extrabold animate-[pulse_1.5s_infinite] scale-125 select-none' 
                          : 'text-3xl'
                      } ${
                        piece.color === 'white' 
                          ? 'text-white drop-shadow-[0_2px_4px_rgba(255,255,255,0.2)]' 
                          : 'text-zinc-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]'
                      } ${isFrozen(piece) ? 'filter saturate-50 brightness-75 text-cyan-200 animate-pulse' : ''}`}
                    >
                      {getPieceSymbol(piece.type, piece.color)}
                    </span>

                    {/* Frozen Overlay indicator */}
                    {isFrozen(piece) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-cyan-500/25 pointer-events-none border border-cyan-400/50">
                        <span className="text-[10px] bg-cyan-900/80 text-cyan-200 px-1 rounded font-bold uppercase tracking-tight scale-75">
                          FROZEN
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* RENDER SOURCE EFFECTS */}
              {sourceEffects.map(e => {
                if (e.actorType === 'bishop') {
                  return (
                    <React.Fragment key={`src-${e.id}`}>
                      {/* Green pulsating healing source aura on the bishop */}
                      <motion.div
                        initial={{ opacity: 0.9, scale: 0.8 }}
                        animate={{ opacity: [0.9, 0], scale: [0.8, 1.4] }}
                        transition={{ duration: 0.6 }}
                        className="absolute inset-0 bg-emerald-500/20 border-4 border-emerald-400 rounded-full pointer-events-none z-20 shadow-[0_0_20px_rgba(16,185,129,0.8)]"
                      />
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.5 }}
                        animate={{ opacity: [0, 1, 1, 0], y: [10, -10, -25], scale: [0.5, 1, 1, 0.8] }}
                        transition={{ duration: 0.9 }}
                        className="absolute pointer-events-none z-30 bg-emerald-950/95 border border-emerald-400 text-emerald-300 text-[10px] font-mono font-black px-1.5 py-0.5 rounded shadow-[0_2px_5px_rgba(0,0,0,0.5)] whitespace-nowrap"
                      >
                        ✨ HEALER ✨
                      </motion.div>
                    </React.Fragment>
                  );
                }
                return (
                  <motion.div
                    key={`src-${e.id}`}
                    initial={{ opacity: 0.8, scale: 0.9 }}
                    animate={{ opacity: 0, scale: 1.3 }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-0 border-2 border-amber-400/60 rounded pointer-events-none z-20"
                  />
                );
              })}

              {/* RENDER ATTACK EFFECTS */}
              {cellEffects.filter(e => e.type === 'attack').map(e => (
                <React.Fragment key={e.id}>
                  {/* Slash Slash graphic effect */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.3, rotate: -45 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.3, 1.1, 0.9], rotate: [-45, 10, 10, 40] }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="absolute inset-0 pointer-events-none z-30 flex items-center justify-center"
                  >
                    <div className="absolute w-full h-1.5 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,1)] rounded-full transform" />
                    <div className="absolute text-red-500 font-extrabold text-2xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] select-none">
                      💥
                    </div>
                  </motion.div>

                  {/* Floating Damage Number */}
                  {e.damageDealt !== undefined && (
                    <motion.div
                      initial={{ opacity: 0, y: 5, scale: 0.4 }}
                      animate={{ opacity: [0, 1, 1, 0], y: [5, -25, -45, -55], scale: [0.4, 1.3, 1.2, 0.8] }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                      className="absolute pointer-events-none z-40 text-red-400 font-black text-sm drop-shadow-[0_2px_6px_rgba(0,0,0,1)] select-none font-mono"
                    >
                      -{e.damageDealt} HP
                    </motion.div>
                  )}
                </React.Fragment>
              ))}

              {/* RENDER ABILITY EFFECTS */}
              {cellEffects.filter(e => e.type === 'ability').map(e => {
                let colorClass = 'border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.7)]';
                let symbol = '✨';
                if (e.actorType === 'bishop') {
                  colorClass = 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.7)]';
                  symbol = '💚';
                } else if (e.actorType === 'rook') {
                  colorClass = 'border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.7)]';
                  symbol = '🧱';
                } else if (e.actorType === 'king') {
                  colorClass = 'border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.7)]';
                  symbol = '👑';
                } else if (e.actorType === 'pawn') {
                  colorClass = 'border-slate-400 shadow-[0_0_20px_rgba(148,163,184,0.7)]';
                  symbol = '🛡️';
                }

                return (
                  <React.Fragment key={e.id}>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.4 }}
                      animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.3, 1.5, 1.7] }}
                      transition={{ duration: 0.7, ease: 'easeInOut' }}
                      className={`absolute w-12 h-12 rounded-full border-4 pointer-events-none z-30 ${colorClass}`}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: [0, 1, 1, 0], y: [5, -15, -25] }}
                      transition={{ duration: 0.7 }}
                      className="absolute pointer-events-none z-40 text-xl"
                    >
                      {symbol}
                    </motion.div>

                    {/* Floating Heal value if any */}
                    {e.healAmount !== undefined && e.healAmount > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 5, scale: 0.4 }}
                        animate={{ opacity: [0, 1, 1, 0], y: [5, -25, -45, -55], scale: [0.4, 1.3, 1.2, 0.8] }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                        className="absolute pointer-events-none z-45 text-emerald-400 font-black text-sm drop-shadow-[0_2px_6px_rgba(0,0,0,1)] select-none font-mono"
                      >
                        +{e.healAmount} HP
                      </motion.div>
                    )}
                  </React.Fragment>
                );
              })}

              {/* RENDER SUPER EFFECTS */}
              {cellEffects.filter(e => e.type === 'super').map(e => {
                let colorClass = 'bg-amber-500/20 border-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.8)]';
                let particles = '🔥';
                if (e.actorType === 'queen') {
                  colorClass = 'bg-cyan-500/20 border-cyan-300 shadow-[0_0_30px_rgba(6,182,212,0.8)]';
                  particles = '❄️';
                } else if (e.actorType === 'bishop') {
                  colorClass = 'bg-emerald-500/20 border-emerald-300 shadow-[0_0_30px_rgba(16,185,129,0.8)]';
                  particles = '🌟';
                } else if (e.actorType === 'knight') {
                  colorClass = 'bg-red-600/20 border-red-400 shadow-[0_0_30px_rgba(220,38,38,0.8)]';
                  particles = '⚔️';
                } else if (e.actorType === 'king') {
                  colorClass = 'bg-yellow-500/20 border-yellow-300 shadow-[0_0_30px_rgba(234,179,8,0.8)]';
                  particles = '👑';
                }

                return (
                  <React.Fragment key={e.id}>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.2 }}
                      animate={{ opacity: [0, 1, 1, 0], scale: [0.2, 1.4, 1.8, 2.2] }}
                      transition={{ duration: 1.2, ease: 'easeOut' }}
                      className={`absolute inset-0 border-4 pointer-events-none z-30 ${colorClass}`}
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0, rotate: 0 }}
                      animate={{ opacity: [0, 1, 1, 0], scale: [0, 1.8, 1.8, 0], rotate: [0, 180, 360, 540] }}
                      transition={{ duration: 1.2 }}
                      className="absolute pointer-events-none z-40 text-2xl"
                    >
                      {particles}
                    </motion.div>
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}

        {/* FULL BOARD EPIC SUPER TITLE CARD OVERLAY */}
        <AnimatePresence>
          {activeSuper && (
            <motion.div
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0 }}
              transition={{ duration: 0.35, ease: 'easeInOut' }}
              className="absolute inset-x-0 top-1/4 bottom-1/4 bg-black/95 border-y-4 border-amber-500 z-50 flex flex-col items-center justify-center overflow-hidden pointer-events-none"
            >
              <motion.div
                initial={{ x: -250, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 120 }}
                className="flex items-center space-y-1 flex-col p-4 text-center"
              >
                <span className="text-[10px] font-mono font-bold tracking-[0.25em] text-amber-400 uppercase">
                  {activeSuper.actorColor} {activeSuper.actorType.toUpperCase()} UNLEASHES
                </span>
                <h2 className="text-2xl font-serif font-black text-white tracking-wider uppercase drop-shadow-[0_2px_10px_rgba(245,158,11,0.5)]">
                  {activeSuper.actorType === 'king' && "👑 KING'S COMMAND 👑"}
                  {activeSuper.actorType === 'queen' && "❄️ ABSOLUTE DOMINION ❄️"}
                  {activeSuper.actorType === 'bishop' && "🌟 RESURRECTION 🌟"}
                  {activeSuper.actorType === 'knight' && "⚔️ DECISIVE STRIKE ⚔️"}
                  {activeSuper.actorType === 'rook' && "💥 ROOK'S CANNONADE 💥"}
                </h2>
                <span className="text-[11px] font-sans text-stone-400 italic max-w-[380px]">
                  {activeSuper.actorType === 'king' && "Sovereign gains 1 extra immediate turn!"}
                  {activeSuper.actorType === 'queen' && "Freeze all enemies in target row, column & diagonal!"}
                  {activeSuper.actorType === 'bishop' && "Revive a fallen ally at half maximum health!"}
                  {activeSuper.actorType === 'knight' && "Instantly execute target adjacent enemy piece!"}
                  {activeSuper.actorType === 'rook' && "Heavy mortar artillery fires in all four directions!"}
                </span>
              </motion.div>
            </motion.div>
          )}

          {activeLastStand && (
            <motion.div
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0 }}
              transition={{ duration: 0.35, ease: 'easeInOut' }}
              className="absolute inset-x-0 top-1/4 bottom-1/4 bg-black/95 border-y-4 border-red-500 z-50 flex flex-col items-center justify-center overflow-hidden pointer-events-none"
            >
              <motion.div
                initial={{ x: 250, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 120 }}
                className="flex items-center space-y-1 flex-col p-4 text-center"
              >
                <span className="text-[10px] font-mono font-bold tracking-[0.25em] text-red-500 uppercase">
                  {activeLastStand.actorColor} KING ENTERING DEFEAT THRESHOLD
                </span>
                <h2 className="text-2xl font-serif font-black text-white tracking-wider uppercase drop-shadow-[0_2px_10px_rgba(239,68,68,0.5)] flex items-center gap-2">
                  🔥 LAST STAND 🔥
                </h2>
                <span className="text-[11px] font-sans text-stone-300 italic max-w-[380px] font-medium">
                  The Sovereign refuses to fall! Damage is doubled and movement range increased!
                </span>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
