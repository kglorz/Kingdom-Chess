/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { BattleLogEntry } from '../types';

interface HistoryLogProps {
  history: BattleLogEntry[];
}

export default function HistoryLog({ history }: HistoryLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of logs on new entry
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [history]);

  const getLogColorClass = (type: string): string => {
    switch (type) {
      case 'death': return 'text-red-500 font-bold';
      case 'heal': return 'text-emerald-400';
      case 'ability': return 'text-sky-400';
      case 'super': return 'text-amber-400 font-black';
      case 'system': return 'text-zinc-500 italic';
      default: return 'text-stone-300';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0f12] p-4 rounded-lg border border-stone-800">
      <h3 className="text-[10px] uppercase tracking-[0.2em] text-[#6b7280] mb-3 border-b border-[#1a1c22] pb-1 font-bold">
        Battle Records
      </h3>
      
      <div
        ref={containerRef}
        className="flex-1 font-mono text-[11px] overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-stone-800"
      >
        {history.length === 0 ? (
          <div className="flex h-full items-center justify-center text-stone-600 text-[10px] uppercase tracking-wider font-mono italic">
            No history recorded
          </div>
        ) : (
          history.map((entry) => (
            <div key={entry.id} className="flex items-start leading-relaxed border-b border-stone-900/40 pb-1">
              {/* Turn Number prefix */}
              <span className="text-[#c5a059] mr-2 font-bold shrink-0">
                T{entry.turn.toString().padStart(2, '0')}.
              </span>
              
              {/* Log Message with dynamic coloring */}
              <span className={`${getLogColorClass(entry.type)} flex-1 break-words`}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
