/**
 * As regras da senha que a pessoa escolhe (E58), sem banco nem servidor, para a tela e o servidor usarem as mesmas. O mínimo de 8 é o do pedido da etapa; o teto de 128 é o do
 * better-auth (`auth.ts` configura os dois).
 */
export const SENHA_MINIMO = 8;
export const SENHA_MAXIMO = 128;

export type ProblemaDaSenhaNova = "curta" | "longa" | "nao_conferem";

/** A senha nova serve? `repetida` só entra na conta quando a tela pede a repetição. */
export function conferirSenhaNova(nova: string, repetida?: string): ProblemaDaSenhaNova | null {
  if (nova.length < SENHA_MINIMO) return "curta";
  if (nova.length > SENHA_MAXIMO) return "longa";
  if (repetida !== undefined && repetida !== nova) return "nao_conferem";
  return null;
}
