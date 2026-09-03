/**
 * Seletor puro dos instantes de quadro para a analise visual (etapa 9,
 * decisao 1 do `PROXIMO.md`): tres instantes fixos (0,5 s, 2 s, 4 s) mais
 * cinco proporcionais, a cada 15% da duracao do video (15, 30, 45, 60,
 * 75%). Video curto nao pode pedir quadro depois do fim: qualquer instante
 * e recortado em `duracao - 0,1`, nunca abaixo de zero. Sem I/O, para
 * testar sem ffmpeg.
 */
const QUADROS_FIXOS_S = [0.5, 2, 4];
const QUADROS_PROPORCOES = [0.15, 0.3, 0.45, 0.6, 0.75];

function arredondar(s: number): number {
  return Math.round(s * 1000) / 1000;
}

export function temposDeQuadro(duracaoS: number): number[] {
  const limite = Math.max(duracaoS - 0.1, 0);
  const fixos = QUADROS_FIXOS_S.map((s) => arredondar(Math.min(s, limite)));
  const proporcionais = QUADROS_PROPORCOES.map((p) => arredondar(Math.min(duracaoS * p, limite)));
  return [...fixos, ...proporcionais];
}
