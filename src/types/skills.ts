export interface Skill {
  id: string;
  name: string;
  description: string;
  userInvocable: boolean;
  content: string;
  tokens: number;
  path: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  tokens: number;
  userInvocable: boolean;
}
