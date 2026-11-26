/**
 * Os freios de entrar no painel (auditoria de segurança de 26/11/2026, achados A3 e M7), sem banco nem servidor, para a tela e o servidor usarem os mesmos números e
 * os mesmos códigos de erro. Quem aplica é `servicos/freios-de-entrada.ts`, chamado pelos ganchos de `lib/auth.ts`.
 */

/** A senha provisória do convite (a que o admin passa para a pessoa) vale 48 horas; depois disso só o link do e-mail ou uma senha nova gerada pelo admin. */
export const VALIDADE_DA_SENHA_PROVISORIA_EM_HORAS = 48;

/** Quantas senhas erradas seguidas o mesmo e-mail aguenta antes de travar o entrar com senha. */
export const LIMITE_DE_SENHAS_ERRADAS = 5;

/** Por quanto tempo o entrar com senha fica travado depois da última senha errada (o link por e-mail continua valendo). */
export const TRAVA_EM_MINUTOS = 15;

/** Quantos links de entrar sem senha o mesmo e-mail pode pedir numa hora (o teto por IP do better-auth continua valendo por cima). */
export const LIMITE_DE_LINKS_POR_HORA = 5;

/** O `code` que o servidor devolve em cada recusa, para a tela trocar a frase sem depender só do número do erro. */
export const CODIGOS_DE_ENTRADA = {
  contaTravada: "CONTA_TRAVADA",
  senhaProvisoriaVencida: "SENHA_PROVISORIA_VENCIDA",
  linksDemais: "LINKS_DEMAIS",
} as const;

/** O e-mail como o better-auth o procura (`findUserByEmail` passa para minúsculas); o espaço das pontas também sai, para o mesmo endereço contar uma vez só. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A senha provisória nascida em `criadaEm` já venceu em `agora`? Vence exatamente ao completar as 48 horas. */
export function provisoriaVencida(criadaEm: Date, agora: Date): boolean {
  return agora.getTime() - criadaEm.getTime() >= VALIDADE_DA_SENHA_PROVISORIA_EM_HORAS * 60 * 60 * 1000;
}
