/**
 * Agrupamento de `/historico` por semana (etapa 12, decisão 3 do
 * `PROXIMO.md`, `HistoricoTela.dc.html`): "Esta semana" e "Semana passada"
 * pelas duas segundas-feiras mais recentes (`segundaFeiraIso`, mesmo
 * raciocínio de fuso do Brasil); antes disso, pelo nome do mês
 * (capitalizado). Função pura, sem banco, para testar sem Postgres.
 */
import { segundaFeiraIso } from "@/lib/semana";

export type GrupoHistorico<T> = { rotulo: string; itens: T[] };

const NOME_MES = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function rotuloDoGrupo(data: string, segundaEstaSemana: string, segundaSemanaPassada: string): string {
  if (data >= segundaEstaSemana) return "Esta semana";
  if (data >= segundaSemanaPassada) return "Semana passada";
  return capitalizar(NOME_MES.format(new Date(`${data}T12:00:00`)));
}

/** `itens` precisa vir ordenado por `data` decrescente; grupos saem na mesma ordem. */
export function agruparPorSemana<T extends { data: string }>(itens: T[], hoje = new Date()): GrupoHistorico<T>[] {
  const segundaEstaSemana = segundaFeiraIso(hoje);
  const seteDiasAtras = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);
  const segundaSemanaPassada = segundaFeiraIso(seteDiasAtras);

  const grupos: GrupoHistorico<T>[] = [];
  for (const item of itens) {
    const rotulo = rotuloDoGrupo(item.data, segundaEstaSemana, segundaSemanaPassada);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(item);
    else grupos.push({ rotulo, itens: [item] });
  }
  return grupos;
}
