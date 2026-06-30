/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Piece, PlayerColor } from '../types';

interface GraveyardProps {
  graveyard: Piece[];
  color: PlayerColor;
}

export default function Graveyard({ graveyard, color }: GraveyardProps) {
  // Filter pieces by color
  const deadPieces = graveyard.filter(p => p.color === color);

  const getPieceSymbol = (type: string): string => {
    switch (type) {
      case 'king': return '♚';
      case 'queen': return '♛';
      case 'rook': return '♜';
      case 'bishop': return '♝';
      case 'knight': return '♞';
      case 'pawn': return '♟';
      default: return '';
    }
  };

  return (
    <div className="flex-1 min-h-[100px] bg-[#0d0f12] rounded-lg p-3 border border-stone-800">
      <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#6b7280] mb-3 border-b border-[#1a1c22] pb-1 font-bold">
        {color === 'white' ? "White Fallen" : "Black Fallen"} ({deadPieces.length})
      </h3>
      
      {deadPieces.length === 0 ? (
        <div className="flex h-12 items-center justify-center">
          <span className="text-[10px] text-stone-600 uppercase tracking-widest italic font-mono">None</span>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2 max-h-[140px] overflow-y-auto pr-1">
          {deadPieces.map((p, idx) => (
            <div
              key={p.id || idx}
              title={`${p.type.toUpperCase()} (Fallen)`}
              className="w-8 h-8 bg-[#1a1d23] flex items-center justify-center rounded border border-[#c5a05915] text-stone-500 text-lg hover:border-red-900/30 hover:bg-red-950/10 transition-colors"
            >
              {getPieceSymbol(p.type)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
