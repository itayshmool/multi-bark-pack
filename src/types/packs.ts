export interface Pack {
  id: string;
  name: string;
  names: string[];
  adjectives: string[];
  icon?: string;
  icons?: string[];
  builtin: boolean;
}

export interface PacksData {
  activePack: string;
  packs: Record<string, Pack>;
}
