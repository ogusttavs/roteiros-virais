import type { ConsumoFonte, EstadoAgregado, LinhaAcompanhamentoDia, MarcaAcompanhamento, ResumoQuebradoAgora } from "@/servicos/admin-acompanhamento";

import { envolverEmail } from "./casca-email";

/**
 * O e-mail diario de acompanhamento da viagem (V10, item 4): so para o
 * Fable, as 08:00. Reaproveita a casca de `casca-email.ts`; o texto e novo
 * porque o publico e diferente (interno, tecnico, nunca o cliente), mas
 * ainda sem travessao nem emoji (regras 1 e 2 do CLAUDE.md valem para todo
 * texto, nao so o que o cliente le).
 */

const ROTULO_ESTADO: Record<EstadoAgregado, string> = {
  ok: "ok",
  erro: "erro",
  rodando: "rodando",
  sem_execucao: "sem execucao",
};

function linhaConsumo(c: ConsumoFonte): string {
  const contra = c.teto !== null ? ` de ${c.teto} por ${c.unidade}` : ` (sem teto configurado, por ${c.unidade})`;
  return `${c.fonte}: ${c.unidades}${contra}`;
}

function blocoQuebradoAgora(resumo: ResumoQuebradoAgora): string {
  const linhas: string[] = [];
  linhas.push(
    resumo.ultimoErroJob
      ? `Ultimo erro de job: ${resumo.ultimoErroJob.nome}, ${resumo.ultimoErroJob.mensagem}`
      : "Ultimo erro de job: nenhum registrado",
  );
  linhas.push(`Consumo agora: ${resumo.consumo.map(linhaConsumo).join("; ")}`);
  linhas.push(
    resumo.geracaoReprovadaDuasVezes
      ? `Geracao reprovada duas vezes: tarefa "${resumo.geracaoReprovadaDuasVezes.tarefa}", motivo: ${resumo.geracaoReprovadaDuasVezes.motivo}`
      : "Geracao reprovada duas vezes: nenhuma",
  );
  // M1, item 3: o lote de analise que passou de 2 horas parado no provedor.
  linhas.push(
    resumo.lotePendente
      ? `Lote de analise: pendente ha ${resumo.lotePendente.horasPendente} hora${resumo.lotePendente.horasPendente === 1 ? "" : "s"} (tarefa "${resumo.lotePendente.tarefa}")`
      : "Lote de analise: em dia",
  );
  return `<p><strong>O que esta quebrado agora</strong></p><p>${linhas.join("<br>")}</p>`;
}

function linhaDeOntemPorMarca(marca: MarcaAcompanhamento, ontem: string): string {
  const linha: LinhaAcompanhamentoDia | undefined = marca.linhas.find((l) => l.dia === ontem);
  if (!linha) return `${marca.nome}: sem dado de ontem`;
  return (
    `${marca.nome}: coleta ${ROTULO_ESTADO[linha.coleta.estado]} (${linha.coleta.novos} novos), ` +
    `transcricao ${ROTULO_ESTADO[linha.transcrever.estado]} (${linha.transcrever.transcritos} transcritos), ` +
    `${linha.temas} temas, ${linha.roteiros.total} roteiros (${linha.roteiros.gravados} gravados, ${linha.roteiros.postados} postados), ` +
    `${linha.curva.medidas} medidas de curva, plano ${linha.plano.sugerido} sugeridos/${linha.plano.aceito} aceitos/${linha.plano.pulado} pulados`
  );
}

export const textosEmailAcompanhamento = {
  assunto: "Acompanhamento da viagem, o resumo de ontem",
  corpo: (resumo: ResumoQuebradoAgora, marcas: MarcaAcompanhamento[], ontem: string) => {
    const linhasMarcas = marcas.map((marca) => `<p>${linhaDeOntemPorMarca(marca, ontem)}</p>`).join("");
    return envolverEmail(
      `${blocoQuebradoAgora(resumo)}<p><strong>Ontem, por marca</strong></p>${linhasMarcas || "<p>Nenhuma marca ativa.</p>"}`,
    );
  },
};
