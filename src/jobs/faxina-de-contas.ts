/**
 * Job `faxina-de-contas` (22/10/2026, semanal, domingo 04:10, junto da base lenta e antes da vigilância das 04:30 e dos comentários das 04:45): a conferência por CONTA, por ramo.
 *
 * O achado do Gustavo: no ramo "Empreendedorismo e Construção de Marcas", 15 dos 30 vídeos mais vistos acima do piso eram de outro assunto, 9 de UMA conta só (curiosidades e ciência),
 * que a coleta por termo e hashtag trouxe e que a lista de vigilância mantinha. A conferência barata do vídeo (`conferirVideoDoSetor`, hotfix #187) só protegia a leitura dos comentários.
 * Esta rotina sobe um degrau: olha a conta.
 *
 * Para cada ramo ativo: as contas com pelo menos `faxinaContaMinimoDeVideos` vídeos acima do piso do ramo nos últimos `faxinaJanelaDias` dias ficam com a amostra dos
 * `faxinaContaAmostra` mais vistos. Cada vídeo da amostra tem o veredito que a base já sabe (a análise ou a conferência guardada); os que ainda não têm vão numa conferência barata em
 * lote de 25 (a mesma do #187, a mesma coluna `videos.conferencia_setor`, os mais vistos das contas mais vistas primeiro), até o teto `faxinaVideosPorRodada` por ramo. Com o veredito de
 * cada um, `decidirContaDoSetor` decide: maioria fora, com o mínimo de vídeos conferidos, marca a conta como fora do setor NAQUELE ramo (`contas_fora_do_setor`). Nada é apagado.
 *
 * Fora da faxina, de propósito: a conta semente colada pelo admin ou indicada por um cliente (`origem` curadoria ou indicada) é escolha de gente, e só a pessoa tira ("Tirar do setor",
 * no admin); a conta que o admin já marcou ou desfez (a pessoa decidiu, a rotina não opina de novo).
 *
 * O que falha (a IA fora) deixa o resto do ramo sem decisão nova: as contas sem base suficiente ficam para a próxima rodada, e as já conferidas não se perguntam de novo. O custo é gravado
 * em `geracoes_ia` pela conferência (tarefa `conferirVideoDoSetor`, com o ramo) e somado no resumo da rodada.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { nichos, type ConferenciaDoSetor } from "@/db/schema";
import { VIDEOS_POR_CHAMADA } from "@/ia/prompts/conferirVideoDoSetor";
import { config } from "@/lib/config";
import { conferirLoteDoSetor, pertenceSegundoABase, type VideoParaConferir } from "@/servicos/conferencia-do-setor";
import { decidirContaDoSetor, marcarContaForaDoSetor, motivoDaMarca, regrasDaFaxina } from "@/servicos/contas-fora-do-setor";
import { DENTRO_DO_TETO_DE_DURACAO, incluirSeed, reguaDoSetor } from "@/servicos/pesquisa";

const DIA_MS = 24 * 60 * 60 * 1000;

type DepsFaxina = { agora?: Date };

type VideoDaAmostra = VideoParaConferir & { contaId: number; views: number };

type LinhaBruta = {
  id: number;
  conta_id: number;
  titulo: string | null;
  descricao: string | null;
  fala: string | null;
  analise_pertence: string | null;
  conferencia_setor: ConferenciaDoSetor | null;
  views: number;
};

/**
 * A amostra de cada conta do ramo que pode ser decidida: os mais vistos acima do piso, nos últimos dias da janela, só de conta com vídeos suficientes (abaixo do mínimo nada decide), sem as
 * contas semente (`curadoria`, `indicada`) e sem as que já têm marca ou desfeita neste ramo. Sem vídeo de seed fora do desenvolvimento.
 */
async function amostraPorConta(nichoId: number, agora: Date): Promise<VideoDaAmostra[]> {
  const regua = await reguaDoSetor(nichoId);
  const desde = new Date(agora.getTime() - config.regras.faxinaJanelaDias * DIA_MS);
  const semSeed = incluirSeed() ? sql`true` : sql`videos.origem <> 'seed'`;
  const resultado = await db().execute<LinhaBruta>(sql`
    WITH candidatos AS (
      SELECT
        videos.id, videos.conta_id, videos.titulo, videos.descricao, left(videos.transcricao, 400) AS fala,
        videos.analise ->> 'pertenceAoNicho' AS analise_pertence, videos.conferencia_setor, videos.views,
        count(*) OVER (PARTITION BY videos.conta_id) AS total_da_conta,
        row_number() OVER (PARTITION BY videos.conta_id ORDER BY videos.views DESC, videos.id ASC) AS posicao
      FROM videos
      JOIN contas ON contas.id = videos.conta_id
      WHERE videos.nicho_id = ${nichoId}
        AND videos.publicado_em >= ${desde}
        AND videos.views >= ${regua.pisoViews}
        AND ${DENTRO_DO_TETO_DE_DURACAO}
        AND ${semSeed}
        AND contas.origem NOT IN ('curadoria', 'indicada')
        AND NOT EXISTS (
          SELECT 1 FROM contas_fora_do_setor cfs WHERE cfs.conta_id = videos.conta_id AND cfs.nicho_id = videos.nicho_id
        )
    )
    SELECT id, conta_id, titulo, descricao, fala, analise_pertence, conferencia_setor, views
    FROM candidatos
    WHERE total_da_conta >= ${config.regras.faxinaContaMinimoDeVideos} AND posicao <= ${config.regras.faxinaContaAmostra}
    ORDER BY conta_id, posicao
  `);
  return resultado.rows.map((l) => ({
    id: l.id,
    contaId: l.conta_id,
    titulo: l.titulo,
    descricao: l.descricao,
    fala: l.fala,
    analisePertence: l.analise_pertence,
    conferencia: l.conferencia_setor,
    views: Number(l.views),
  }));
}

type ResumoDoRamo = {
  ramo: string;
  contasAvaliadas: number;
  contasMarcadas: number;
  contasSemBase: number;
  videosConferidosAgora: number;
  chamadasIA: number;
  custoUsd: number;
  erros: string[];
};

async function faxinarRamo(ramo: { id: number; slug: string; nome: string; descricao: string | null; termos: string[] }, agora: Date): Promise<ResumoDoRamo> {
  const resumo: ResumoDoRamo = { ramo: ramo.slug, contasAvaliadas: 0, contasMarcadas: 0, contasSemBase: 0, videosConferidosAgora: 0, chamadasIA: 0, custoUsd: 0, erros: [] };
  const amostra = await amostraPorConta(ramo.id, agora);
  if (amostra.length === 0) return resumo;

  const veredito = new Map<number, boolean>();
  for (const v of amostra) {
    const sabido = pertenceSegundoABase(v);
    if (sabido !== undefined) veredito.set(v.id, sabido);
  }

  // O que falta perguntar: as contas mais vistas primeiro (as que mais pesam nas referências), dentro de cada uma os mais vistos, até o teto da rodada.
  const viewsDaConta = new Map<number, number>();
  for (const v of amostra) viewsDaConta.set(v.contaId, (viewsDaConta.get(v.contaId) ?? 0) + v.views);
  const faltam = amostra
    .filter((v) => !veredito.has(v.id))
    .sort((a, b) => (viewsDaConta.get(b.contaId) ?? 0) - (viewsDaConta.get(a.contaId) ?? 0) || a.contaId - b.contaId || b.views - a.views || a.id - b.id)
    .slice(0, config.regras.faxinaVideosPorRodada);

  for (let i = 0; i < faltam.length; i += VIDEOS_POR_CHAMADA) {
    const lote = faltam.slice(i, i + VIDEOS_POR_CHAMADA);
    try {
      const resultado = await conferirLoteDoSetor({ id: ramo.id, nome: ramo.nome, descricao: ramo.descricao, termos: ramo.termos }, lote, agora, { origem: "faxina-de-contas" });
      resumo.chamadasIA += 1;
      resumo.custoUsd += resultado.custoUsd;
      for (const [videoId, pertence] of resultado.pertence) {
        veredito.set(videoId, pertence);
        resumo.videosConferidosAgora += 1;
      }
    } catch (erro) {
      // A IA fora: o resto do ramo não insiste (seria a mesma falha por lote). O que já foi conferido vale, e o resto volta na próxima rodada.
      resumo.erros.push(`conferencia das contas do ramo "${ramo.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
      break;
    }
  }

  const porConta = new Map<number, VideoDaAmostra[]>();
  for (const v of amostra) porConta.set(v.contaId, [...(porConta.get(v.contaId) ?? []), v]);
  const regras = regrasDaFaxina();
  for (const [contaId, videosDaConta] of porConta) {
    resumo.contasAvaliadas += 1;
    const conferidos = videosDaConta.filter((v) => veredito.has(v.id));
    const fora = conferidos.filter((v) => veredito.get(v.id) === false);
    const decisao = decidirContaDoSetor(conferidos.length, fora.length, regras);
    if (decisao === "sem_base") resumo.contasSemBase += 1;
    if (decisao !== "fora") continue;
    const marcou = await marcarContaForaDoSetor({
      contaId,
      nichoId: ramo.id,
      motivo: motivoDaMarca(conferidos.length, fora.length, fora.map((v) => v.titulo ?? "")),
      videosConferidos: conferidos.length,
      videosForaDoSetor: fora.length,
    });
    if (marcou) resumo.contasMarcadas += 1;
  }
  return resumo;
}

/** Sem `nichoId`, todo ramo ativo (o cron semanal); com, só aquele ramo ("rodar agora" no admin). */
export async function rodarFaxinaDeContas(nichoId?: number, deps: DepsFaxina = {}): Promise<Record<string, unknown>> {
  const agora = deps.agora ?? new Date();
  const ramos = await db()
    .select({ id: nichos.id, slug: nichos.slug, nome: nichos.nome, descricao: nichos.descricao, termos: nichos.termos })
    .from(nichos)
    .where(nichoId === undefined ? eq(nichos.ativo, true) : eq(nichos.id, nichoId));

  const porRamo: ResumoDoRamo[] = [];
  const erros: string[] = [];
  for (const ramo of ramos) {
    try {
      const resumo = await faxinarRamo(ramo, agora);
      erros.push(...resumo.erros);
      porRamo.push(resumo);
    } catch (erro) {
      // Um ramo que quebra (o banco recusou algo) não derruba os outros.
      erros.push(`faxina das contas do ramo "${ramo.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  const soma = (campo: "contasAvaliadas" | "contasMarcadas" | "contasSemBase" | "videosConferidosAgora" | "chamadasIA" | "custoUsd") => porRamo.reduce((total, r) => total + r[campo], 0);
  return {
    ramos: ramos.length,
    contasAvaliadas: soma("contasAvaliadas"),
    contasMarcadas: soma("contasMarcadas"),
    contasSemBase: soma("contasSemBase"),
    videosConferidosAgora: soma("videosConferidosAgora"),
    chamadasIA: soma("chamadasIA"),
    custoUsd: Number(soma("custoUsd").toFixed(4)),
    porRamo: porRamo
      .filter((r) => r.contasAvaliadas > 0)
      .map((r) => ({ ramo: r.ramo, contasAvaliadas: r.contasAvaliadas, contasMarcadas: r.contasMarcadas, contasSemBase: r.contasSemBase, videosConferidosAgora: r.videosConferidosAgora, chamadasIA: r.chamadasIA })),
    erros: erros.length > 0 ? erros : undefined,
  };
}
