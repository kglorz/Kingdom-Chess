/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Piece, PieceType, PlayerColor, GameMode } from '../types';
import { getEffectiveAttack, isFrozen, isAbilitySuppressed, getArmor } from '../utils/gameLogic';

interface InspectorProps {
  piece: Piece | null;
  onAbilityClick: () => void;
  onSuperClick: () => void;
  activeAction: 'move' | 'ability' | 'super' | null;
  allPieces: Piece[];
  graveyard?: Piece[];
  currentPlayerColor?: PlayerColor;
  mode?: GameMode;
  humanColor?: PlayerColor;
}

export default function Inspector({
  piece,
  onAbilityClick,
  onSuperClick,
  activeAction,
  allPieces,
  graveyard = [],
  currentPlayerColor,
  mode = 'pve',
  humanColor
}: InspectorProps) {
  if (!piece) {
    return (
      <div className="w-[300px] bg-[#111318] border-l border-[#1a1c22] p-6 flex flex-col justify-center items-center text-center">
        <div className="text-stone-600 text-5xl mb-4">♟</div>
        <p className="text-stone-400 font-serif text-sm">Select a piece to inspect its tactical properties, status, and abilities.</p>
      </div>
    );
  }

  const isEnemy = mode === 'pve'
    ? (humanColor ? piece.color !== humanColor : false)
    : (currentPlayerColor ? piece.color !== currentPlayerColor : false);

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

  const getAbilityInfo = (type: PieceType) => {
    switch (type) {
      case 'king':
        return {
          name: 'Royal Call',
          cooldown: 3,
          desc: 'Summon a brand new allied Pawn onto an adjacent square. Requires fewer than 8 friendly Pawns on the board.'
        };
      case 'queen':
        return {
          name: 'Charm',
          cooldown: 3,
          desc: 'Charm the first enemy piece in line of sight (orthogonally or diagonally) for 1 turn, converting them to your side. Cannot target Kings or Queens. Walls block line of sight.'
        };
      case 'bishop':
        return {
          name: 'Divine Heal',
          cooldown: 3,
          desc: 'Heal any ally within 3 squares for 30% of their max HP (rounded up). Walls block line of sight.'
        };
      case 'knight':
        return {
          name: 'Iron Charge',
          cooldown: 3,
          desc: 'Perform normal knight movement (2 splash damage to adjacent enemies). If an enemy in L-shaped range can be killed by a standard attack, you can charge directly onto them to deal 5 damage and 2 splash damage to all other surrounding enemies.'
        };
      case 'rook':
        return {
          name: 'Grey Bastion',
          cooldown: 3,
          desc: 'Grant a Grey Shield (3 turns duration) to a friendly ally within 2 squares. The shield reduces the damage they receive by 50%, and the remaining 50% is absorbed by the Rook.'
        };
      case 'pawn':
        return {
          name: 'Shield Brace',
          cooldown: 2,
          desc: 'Fortify itself, raising a complete damage-blocking shield for 1 turn (consumed when attacked).'
        };
    }
  };

  const getSuperInfo = (type: PieceType) => {
    switch (type) {
      case 'king':
        return {
          name: "King's Command",
          req: 'Survive to Turn 12',
          desc: 'Gain one additional full turn immediately.'
        };
      case 'queen':
        return {
          name: 'Royal Lockdown',
          req: 'Charm 2 enemy pieces',
          desc: 'Freeze all visible enemy pieces along a chosen line of sight for 2 turns.'
        };
      case 'bishop':
        return {
          name: 'Resurrection',
          req: 'Heal 12 total HP',
          desc: 'Revive a defeated allied piece (except King) with half HP onto your back rank.'
        };
      case 'knight':
        return {
          name: 'Decisive Strike',
          req: 'Perform 2 eliminations',
          desc: 'Instantly defeat an enemy occupying any of your 8 landing squares (cannot target enemy Kings).'
        };
      case 'rook':
        return {
          name: "Rook's Bastion",
          req: 'Absorb 12 damage',
          desc: 'Lock into place for 5 turns, extending a 3-tile damage-mitigation aura. Friendly allies inside take 50% less damage (rounded up). Rook absorbs the remainder at a 50% reduction.'
        };
      default:
        return null;
    }
  };

  const getPassiveInfo = (type: PieceType) => {
    switch (type) {
      case 'king':
        return {
          name: 'Sovereign Guard',
          desc: 'Immune to all crowd-control effects (cannot be frozen).'
        };
      case 'queen':
        return {
          name: 'Dominion Field',
          desc: 'Enemies within 2 squares are suppressed and cannot activate abilities.'
        };
      case 'bishop':
        return {
          name: 'Divine Presence',
          desc: 'At the start of the turn, heals the lowest HP friendly ally by 1 HP. Prioritizes Royals (King/Queen), then Officials (Rook/Bishop/Knight), then Pawns. If there are multiple Bishops, they cannot heal the same ally. (3T Cooldown)'
        };
      case 'knight':
        return {
          name: 'Tactical Evasion',
          desc: 'Upon surviving damage, choose an empty L-shaped square to reposition (3T cooldown).'
        };
      case 'rook':
        return {
          name: 'Iron Shell',
          desc: 'Two states: Charging and Ready. Negates the next incoming damage when Ready. Takes 5 turns to charge.'
        };
      case 'pawn':
        return {
          name: 'Determination',
          desc: 'While below 50% HP, gain +2 Attack power (bonus is lost when healed).'
        };
    }
  };

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

  const ability = getAbilityInfo(piece.type);
  const superInfo = getSuperInfo(piece.type);
  const passive = getPassiveInfo(piece.type);
  const effectiveAtk = getEffectiveAttack(piece);
  const isSuppressed = isAbilitySuppressed(piece, allPieces);
  const armorEffect = piece.statusEffects.find(se => se.type === 'armor');
  const armorDuration = armorEffect ? armorEffect.duration : 0;
  const armorVal = armorEffect ? (armorEffect.value || 0) : 0;

  const alliedPawnsCount = piece.type === 'king' ? allPieces.filter(p => p.color === piece.color && p.type === 'pawn' && p.hp > 0).length : 0;
  const isKingAbilityUnavailable = piece.type === 'king' && alliedPawnsCount >= 8;

  const hasFallenAllies = piece.type === 'bishop'
    ? graveyard.some(p => p.color === piece.color && p.type !== 'king')
    : true;
  const isBishopSuperUnavailable = piece.type === 'bishop' && !hasFallenAllies;

  return (
    <div className="w-[300px] bg-[#111318] border-l border-[#1a1c22] p-5 flex flex-col justify-between h-full overflow-y-auto">
      <div>
        {/* Piece Header */}
        <div className="text-center mb-6 relative">
          {isEnemy && (
            <div className="mb-3 inline-flex items-center gap-1 bg-red-950/80 text-red-400 border border-red-500/30 text-[9px] font-mono font-bold tracking-widest px-2.5 py-0.5 rounded uppercase shadow-md animate-pulse">
              ⚠️ Enemy Piece
            </div>
          )}
          <div className="text-5xl mb-2 text-white drop-shadow-[0_2px_8px_rgba(197,160,89,0.3)]">
            {getPieceSymbol(piece.type)}
          </div>
          <h2 className="text-xl font-serif text-white tracking-wide uppercase">{getPieceTitle(piece.type)}</h2>
          <p className="text-[10px] uppercase text-[#c5a059] tracking-widest font-mono">
            {piece.color === 'white' ? 'White Kingdom' : 'Black Kingdom'}
          </p>
        </div>

        {/* HP Bar and Base Stats */}
        <div className="space-y-4 mb-6">
          <div className="flex justify-between items-end">
            <span className="text-xs text-[#9ca3af] uppercase tracking-wider font-bold">Health Points</span>
            <div className="flex items-center gap-1.5 font-mono text-sm">
              {((piece.type === 'rook' && piece.ironShellState === 'ready') || armorVal > 0) && (
                <span className="text-xs text-blue-400 font-bold flex items-center gap-0.5" title={piece.type === 'rook' ? "Iron Shell Ready" : `Shield active for 1 turn only`}>
                  🛡️{piece.type === 'rook' ? "Iron Shell Ready" : (piece.type === 'pawn' ? "1 Turn Only" : `${armorVal} (${armorDuration}T)`)}
                </span>
              )}
              <span className="text-white font-bold">{piece.hp} / {piece.maxHp}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-3 bg-[#1a1d23] rounded border border-[#c5a05933] overflow-hidden relative">
              {/* Real Health Bar */}
              <div
                className={`absolute left-0 top-0 h-full bg-gradient-to-r ${
                  (mode === 'pve'
                    ? piece.color === humanColor
                    : piece.color === currentPlayerColor)
                    ? 'from-emerald-500 to-emerald-600'
                    : 'from-red-500 to-red-600'
                } transition-all duration-300`}
                style={{ width: `${(piece.hp / piece.maxHp) * 100}%` }}
              />
            </div>
            {/* Blue Shield Bar on the right side */}
            {((piece.type === 'rook' && piece.ironShellState === 'ready') || armorVal > 0) && (
              <div className="w-16 h-3 bg-[#1a1d23] border border-blue-500/30 rounded overflow-hidden shrink-0 relative flex items-center">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ 
                    width: (piece.type === 'rook' && piece.ironShellState === 'ready') ? '100%' : `${Math.min(100, (armorVal / 4) * 100)}%` 
                  }}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col bg-[#1a1d23] p-2 rounded border border-[#c5a05915] items-center">
              <span className="text-[10px] text-[#9ca3af] uppercase font-bold tracking-tight">Attack Power</span>
              <span className="text-lg font-bold text-[#ef4444] font-mono flex items-center gap-1">
                {effectiveAtk}
                {effectiveAtk > piece.attack && (
                  <span className="text-xs text-amber-400 font-bold" title="Determination Passive active!">(+2)</span>
                )}
              </span>
            </div>
            <div className="flex flex-col bg-[#1a1d23] p-2 rounded border border-[#c5a05915] items-center">
              <span className="text-[10px] text-[#9ca3af] uppercase font-bold tracking-tight">Status Armor</span>
              <span className="text-lg font-bold text-sky-400 font-mono">
                {getArmor(piece)}
              </span>
            </div>
          </div>
        </div>

        {/* Abilities & Supers */}
        <div className="space-y-4">
          <h4 className="text-[10px] uppercase tracking-widest text-[#c5a059] border-b border-[#c5a05933] pb-1 font-bold">
            Special Actions
          </h4>

          {/* Active Ability Button */}
          <button
            onClick={onAbilityClick}
            disabled={isEnemy || piece.cooldowns.ability > 0 || isSuppressed || isFrozen(piece) || isKingAbilityUnavailable}
            className={`w-full text-left p-3 rounded border transition-all duration-200 ${
              isEnemy
                ? 'bg-[#0d0f12]/60 border-stone-800 opacity-60 cursor-not-allowed'
                : activeAction === 'ability'
                ? 'bg-[#c5a05922] border-[#c5a059] shadow-[0_0_10px_rgba(197,160,89,0.2)]'
                : piece.cooldowns.ability > 0 || isSuppressed || isFrozen(piece) || isKingAbilityUnavailable
                ? 'bg-[#0d0f12] border-stone-800 opacity-40 cursor-not-allowed'
                : 'bg-[#1a1d23] border-[#c5a05944] hover:bg-[#20242c] hover:border-[#c5a05988]'
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <span className="text-xs font-bold text-white uppercase tracking-wider">{ability.name}</span>
              <span className="text-[9px] font-mono text-[#c5a059] bg-black/40 px-1.5 py-0.5 rounded">
                {isEnemy ? 'ENEMY PIECE' : piece.cooldowns.ability > 0 ? `CD: ${piece.cooldowns.ability}T` : isSuppressed ? 'SUPPRESSED' : isKingAbilityUnavailable ? 'UNAVAILABLE (8 PAWNS)' : 'READY'}
              </span>
            </div>
            <p className="text-[10px] text-[#9ca3af] leading-relaxed">{ability.desc}</p>
          </button>

          {/* Ultimate/Super Ability Button */}
          {superInfo && (
            <button
              onClick={onSuperClick}
              disabled={isEnemy || !piece.superUnlocked || isFrozen(piece) || isBishopSuperUnavailable}
              className={`w-full text-left p-3 rounded border transition-all duration-200 ${
                isEnemy
                  ? 'bg-[#0d0f12]/60 border-stone-800 opacity-60 cursor-not-allowed'
                  : activeAction === 'super'
                  ? 'bg-[#c5a05933] border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                  : piece.superUnlocked && !isFrozen(piece) && !isBishopSuperUnavailable
                  ? 'bg-gradient-to-br from-[#2a1e0b] to-[#111318] border-amber-500 animate-pulse hover:border-amber-400'
                  : 'bg-[#0d0f12] border-stone-800 opacity-40 cursor-not-allowed'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">{superInfo.name}</span>
                <span className="text-[9px] font-mono text-amber-200 bg-amber-950/60 px-1.5 py-0.5 rounded font-black">
                  {isEnemy ? 'ENEMY' : isBishopSuperUnavailable ? 'UNAVAILABLE (NO DEFEATED ALLIES)' : piece.superUnlocked ? 'ULTIMATE UNLOCKED' : 'LOCKED'}
                </span>
              </div>
              <p className="text-[10px] text-stone-400 leading-relaxed mb-2">{superInfo.desc}</p>
              {!piece.superUnlocked && (
                <div className="flex items-center gap-1.5 mt-1 bg-black/30 p-1.5 rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[9px] font-mono text-amber-500 font-bold uppercase">
                    Condition: {superInfo.req} ({piece.superProgress})
                  </span>
                </div>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Passive Ability Banner at bottom */}
      <div className="mt-6">
        <div className="bg-[#0a0a0b] p-3 border-l-2 border-emerald-500 rounded-r border border-stone-900">
          <h5 className="text-[10px] text-emerald-400 uppercase font-black tracking-widest font-mono mb-1">
            Passive: {passive.name}
          </h5>
          <p className="text-[10px] text-stone-400 leading-relaxed mb-1">{passive.desc}</p>
          {piece.type === 'rook' && (
            <div className="text-[9px] font-mono text-amber-500 mt-1 font-bold">
              Iron Shell State: {piece.ironShellState === 'ready' ? '🛡️ READY (Negates next damage!)' : `⏳ CHARGING (${piece.ironShellProgress || 0}/5)`}
            </div>
          )}
          {piece.passiveCooldown !== undefined && piece.passiveCooldown > 0 && (
            <div className="text-[9px] font-mono text-amber-500 mt-1 font-bold">
              Cooldown: ⏳ {piece.passiveCooldown} turn{piece.passiveCooldown > 1 ? 's' : ''} left
            </div>
          )}
          {piece.passiveCooldown !== undefined && piece.passiveCooldown === 0 && (piece.type === 'bishop' || piece.type === 'knight') && (
            <div className="text-[9px] font-mono text-emerald-400 mt-1 font-bold animate-pulse">
              🛡️ READY
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
