/**
 * Job `vigiar-disco` (29/10/2026): a cada 15 minutos mede o espaço livre do disco que o contêiner enxerga e o tamanho de `/var/edicao` e `/var/publicar`, guarda o estado (o Início do admin lê) e avisa:
 *  - atenção com 80% de uso e crítico com 90% (`DISCO_ATENCAO_PERCENTUAL` e `DISCO_CRITICO_PERCENTUAL`), um e-mail e um registro no Sentry por nível por dia;
 *  - "voltou ao normal" uma vez, na primeira medida normal depois de qualquer aviso;
 *  - no crítico, também pede a limpeza dos vídeos guardados na hora (`limpar-edicoes`), e a rota de envio do vídeo para editar recusa (`recusaPorDiscoCritico`).
 * A marca do dia só é gravada quando o envio deu certo; e-mail que falhou tenta de novo na medida seguinte. O resumo tem só números.
 */
import { config, hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { avisarDisco, registrarDiscoNoSentry, type ResultadoDoAvisoDeDisco } from "@/servicos/aviso-de-disco";
import {
  decidirAvisos,
  type DepsDaMedida,
  type EstadoDoAlarme,
  gravarEstadoDoAlarme,
  lerEstadoDoAlarme,
  limitesDoDisco,
  type LimitesDoDisco,
  medirDisco,
  type MedidaDoDisco,
  nivelDoUso,
  pedirLimpezaAgora,
} from "@/servicos/disco";
import type { NumerosDoAviso, TipoDoAviso } from "@/textos/aviso-disco";

export type DepsDoVigiarDisco = {
  agora?: () => Date;
  medir?: () => Promise<MedidaDoDisco>;
  limites?: LimitesDoDisco;
  avisar?: (tipo: TipoDoAviso, numeros: NumerosDoAviso) => Promise<ResultadoDoAvisoDeDisco>;
  sentry?: (tipo: "atencao" | "critico", numeros: NumerosDoAviso) => void;
  limparAgora?: () => Promise<unknown>;
  /** Só para os testes do `statfs` e das pastas. */
  medida?: DepsDaMedida;
};

export async function rodarVigiarDisco(deps: DepsDoVigiarDisco = {}): Promise<Record<string, unknown>> {
  const agora = deps.agora ? deps.agora() : new Date();
  const hoje = hojeISO(agora);
  const limites = deps.limites ?? limitesDoDisco(config.disco);

  const medida = await (deps.medir ?? (() => medirDisco(deps.medida)))();
  const anterior = await lerEstadoDoAlarme();
  const nivel = nivelDoUso(medida.usadoPercentual, limites, anterior?.nivel ?? null);
  const decisao = decidirAvisos(anterior, nivel, hoje);

  const numeros: NumerosDoAviso = { ...medida, limiteAtencao: limites.atencao, limiteCritico: limites.critico };
  const estado: EstadoDoAlarme = {
    nivel,
    desde: anterior && anterior.nivel === nivel ? anterior.desde : agora.toISOString(),
    medidoEm: agora.toISOString(),
    usadoPercentual: medida.usadoPercentual,
    livreBytes: medida.livreBytes,
    totalBytes: medida.totalBytes,
    edicaoBytes: medida.edicaoBytes,
    publicarBytes: medida.publicarBytes,
    emailEm: { ...(anterior?.emailEm ?? { atencao: null, critico: null }) },
    sentryEm: { ...(anterior?.sentryEm ?? { atencao: null, critico: null }) },
    voltaPendente: anterior?.voltaPendente ?? false,
  };

  let aviso: string | null = null;
  if (decisao.sentry) {
    (deps.sentry ?? registrarDiscoNoSentry)(decisao.sentry, numeros);
    estado.sentryEm[decisao.sentry] = hoje;
  }
  if (decisao.email) {
    try {
      const resultado = await (deps.avisar ?? ((tipo, n) => avisarDisco(tipo, n)))(decisao.email, numeros);
      if (resultado.enviado) {
        aviso = decisao.email;
        if (decisao.email === "voltou") estado.voltaPendente = false;
        else {
          estado.emailEm[decisao.email] = hoje;
          estado.voltaPendente = true;
        }
      } else {
        aviso = `nao enviado (${resultado.motivo ?? "sem motivo"})`;
      }
    } catch (erro) {
      logger.error({ err: erro }, "disco: o aviso quebrou");
      aviso = "nao enviado (erro)";
    }
  }
  // Mesmo sem e-mail, quem passou do limite já tem o que avisar de volta quando normalizar.
  if (nivel !== "normal") estado.voltaPendente = true;

  let limpezaPedida = false;
  if (nivel === "critico") {
    try {
      await (deps.limparAgora ?? pedirLimpezaAgora)();
      limpezaPedida = true;
    } catch (erro) {
      logger.warn({ err: erro }, "disco: nao foi possivel pedir a limpeza na hora");
    }
  }

  await gravarEstadoDoAlarme(estado);

  return {
    nivel,
    usadoPercentual: medida.usadoPercentual,
    livreGb: Math.round((medida.livreBytes / 1_000_000_000) * 10) / 10,
    edicaoMb: Math.round(medida.edicaoBytes / 1_000_000),
    publicarMb: Math.round(medida.publicarBytes / 1_000_000),
    aviso,
    limpezaPedida,
  };
}
