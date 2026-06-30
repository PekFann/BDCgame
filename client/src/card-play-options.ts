export interface PickOneOption {
  id: string;
  label: string;
}

/** Pick-one action cards — mirrors server pending options in actions.ts */
export const CARD_PICK_ONE_OPTIONS: Record<string, PickOneOption[]> = {
  prayer: [
    { id: "draw", label: "Draw 2 cards" },
    { id: "damage", label: "Deal 1 damage to a demon (+1 if another Prayer)" },
  ],
  caring: [
    { id: "friendship", label: "Gain 1 friendship" },
    { id: "heal", label: "Possessed gains 1 HP" },
  ],
  tea_for_two: [
    { id: "friendship2", label: "Gain 2 friendship" },
    { id: "heal2", label: "Possessed gains 2 HP" },
  ],
};

export function isPickOneEffect(effectId: string | undefined): boolean {
  return effectId !== undefined && effectId in CARD_PICK_ONE_OPTIONS;
}
