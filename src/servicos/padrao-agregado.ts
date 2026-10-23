/**
 * A porta do que circula entre marcas (E16, nível nicho e geral). Regra fixa do produto: circula
 * padrão, nunca conteúdo, e padrão que identifica uma marca não circula. Hoje nada agregado
 * circula (o nível conta é de uma marca só, `desempenho-da-conta.ts`); quando o resultado real dos
 * clientes entrar no modelo do setor ou no geral, passa por aqui antes de chegar a qualquer prompt.
 *
 * O limite (decisão proposta em 22/10/2026, a confirmar com o Gustavo; mudar é trocar as
 * constantes): no mínimo 5 marcas distintas, de pelo menos 3 donos distintos (quem tem várias
 * marcas conta uma vez), 10 vídeos no total, e nenhuma marca com mais da metade dos vídeos do
 * padrão (senão o "padrão" é, na prática, uma marca só).
 */
export const MINIMO_MARCAS_DO_PADRAO = 5;
export const MINIMO_DONOS_DO_PADRAO = 3;
export const MINIMO_VIDEOS_DO_PADRAO = 10;
/** Nenhuma marca pode passar desta fração dos vídeos do padrão. */
export const MAXIMO_FRACAO_DE_UMA_MARCA = 0.5;

/** O que uma marca contribuiu para um padrão: quantos vídeos dela entraram, e quem é o dono. */
export type ContribuicaoDeMarca = { marcaId: number; donoId: string; videos: number };

export type DecisaoDoPadrao =
  | { pode: true }
  | { pode: false; motivo: "poucas_marcas" | "poucos_donos" | "poucos_videos" | "uma_marca_domina" };

export function podeCircularPadrao(contribuicoes: ContribuicaoDeMarca[]): DecisaoDoPadrao {
  const validas = contribuicoes.filter((c) => c.videos > 0);
  const porMarca = new Map<number, number>();
  for (const c of validas) porMarca.set(c.marcaId, (porMarca.get(c.marcaId) ?? 0) + c.videos);
  if (porMarca.size < MINIMO_MARCAS_DO_PADRAO) return { pode: false, motivo: "poucas_marcas" };

  const donos = new Set(validas.map((c) => c.donoId));
  if (donos.size < MINIMO_DONOS_DO_PADRAO) return { pode: false, motivo: "poucos_donos" };

  const total = [...porMarca.values()].reduce((soma, v) => soma + v, 0);
  if (total < MINIMO_VIDEOS_DO_PADRAO) return { pode: false, motivo: "poucos_videos" };

  const maior = Math.max(...porMarca.values());
  if (maior / total > MAXIMO_FRACAO_DE_UMA_MARCA) return { pode: false, motivo: "uma_marca_domina" };

  return { pode: true };
}
