/**
 * Os oito motivos de reprovar um roteiro (E27, parte 1; `entrega/telas/
 * Roteiro.dc.html`, folha "reprovar"; `PROXIMO.md`, item 1). Id estável
 * para o dado (`geracoes_ia.motivos_avaliacao`, nunca muda depois de
 * gravado) e rótulo de tela nesta ordem exata, a mesma dos chips do
 * desenho. Reaproveitado pelo prompt (`src/ia/prompts/roteiro.ts`, os
 * rótulos entram na entrada) e pelo admin (`/admin/geracoes`, a contagem
 * por motivo).
 */
export type IdMotivoReprovacao =
  | "nao_e_assim_que_eu_falo"
  | "nao_da_para_gravar_hoje"
  | "ja_falei_disso"
  | "nao_e_o_meu_cliente"
  | "muito_longo"
  | "nao_combina_com_o_objetivo"
  | "gancho_fraco"
  | "outro_motivo";

export type MotivoReprovacao = { id: IdMotivoReprovacao; rotulo: string };

export const MOTIVOS_REPROVACAO: MotivoReprovacao[] = [
  { id: "nao_e_assim_que_eu_falo", rotulo: "Não é assim que eu falo" },
  { id: "nao_da_para_gravar_hoje", rotulo: "Não dá para gravar isso hoje" },
  { id: "ja_falei_disso", rotulo: "Já falei disso" },
  { id: "nao_e_o_meu_cliente", rotulo: "Não é o meu cliente" },
  { id: "muito_longo", rotulo: "Muito longo" },
  { id: "nao_combina_com_o_objetivo", rotulo: "Não combina com o objetivo" },
  { id: "gancho_fraco", rotulo: "Gancho fraco" },
  { id: "outro_motivo", rotulo: "Outro motivo" },
];

const ROTULO_POR_ID = new Map(MOTIVOS_REPROVACAO.map((m) => [m.id, m.rotulo]));

/** Rótulo de um id de motivo; o próprio id, sem quebrar, se algum dia aparecer um id desconhecido. */
export function rotuloDoMotivo(id: string): string {
  return ROTULO_POR_ID.get(id as IdMotivoReprovacao) ?? id;
}
