"use client";

import { Button } from "@/components/ui";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Derive the A-Z bucket for a key. Non-alpha (or empty) → "#". */
export function letterOf(key: string): string {
  const c = (key ?? "").trim().charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
}

/** Build the set of letters that have at least one matching item. */
export function activeLettersFor(keys: string[]): Set<string> {
  const set = new Set<string>();
  for (const k of keys) set.add(letterOf(k));
  return set;
}

interface Props {
  /** Items to derive letters from (kept for API completeness / callers). */
  items: { key: string }[];
  /** Letters that have at least one item. */
  activeLetters: Set<string>;
  /** Currently selected letter. "" means "All". */
  selected: string;
  onSelect: (letter: string) => void;
}

export function LetterFilterBar({ activeLetters, selected, onSelect }: Props) {
  const buckets = [...LETTERS, "#"];
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        size="sm"
        variant={selected === "" ? "primary" : "outline"}
        onClick={() => onSelect("")}
        className="h-7 px-2.5 text-xs"
      >
        All
      </Button>
      {buckets.map((l) => {
        const enabled = activeLetters.has(l);
        const isSelected = selected === l;
        return (
          <Button
            key={l}
            size="sm"
            variant={isSelected ? "primary" : "ghost"}
            disabled={!enabled}
            onClick={() => onSelect(l)}
            className="h-7 w-7 px-0 text-xs"
            aria-pressed={isSelected}
          >
            {l}
          </Button>
        );
      })}
    </div>
  );
}
