/** Do erro cru de uma rotina para uma frase em língua de gente (E46 PR 3). O texto técnico fica só no detalhe. */
export const FRASE_DE_ERRO_GENERICA = "Não terminou; veja o detalhe técnico.";

const CASOS: { quando: RegExp; frase: string }[] = [
  { quando: /request limit reached|limite da meta|meta api indisponivel \(codigo (4|17|32|613)\)|\(#4\)/i, frase: "O limite da Meta (Instagram) foi atingido; a rotina continua na hora seguinte." },
  { quando: /credit balance|cr[eé]dito|insufficient (funds|credit)/i, frase: "O crédito da API de IA acabou." },
  { quando: /apify.*(limit|limite|usage|quota|monthly|exceed)|(limit|limite|quota).*apify/i, frase: "O limite da conta de coleta (Apify) acabou." },
  { quando: /youtube.*(bot|sign in|bloque|403|cookies|po token|quota|cota)|(quota|cota).*youtube/i, frase: "O YouTube bloqueou ou esgotou a cota da busca." },
  { quando: /timeout|timed out|etimedout|tempo limite|prazo|aborted/i, frase: "Passou do tempo limite e foi interrompida." },
  { quando: /econnrefused|connection terminated|too many clients|deadlock|database|postgres|banco de dados/i, frase: "Falha ao falar com o banco de dados." },
];

/** A frase do caso conhecido, ou a genérica. Nunca devolve o texto cru. */
export function fraseDoErro(cru: string | null | undefined): string {
  if (!cru) return FRASE_DE_ERRO_GENERICA;
  return CASOS.find((c) => c.quando.test(cru))?.frase ?? FRASE_DE_ERRO_GENERICA;
}
