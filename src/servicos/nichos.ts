/**
 * Nicho pelo admin (etapa 24, parte 1 do plano): criar, editar, ativar e
 * desativar nicho, e acrescentar contas semente. So admin usa isto
 * (`garantirSessaoAdmin` nas Server Actions de `src/app/admin/nichos/acoes.ts`).
 */
import { and, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { contas, nichos, type Conta, type Nicho } from "@/db/schema";
import { boss, existeJobPendente, FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { analisarUrlPerfil } from "@/lib/perfil-redes";

/** Nome com mensagem para a tela (plataforma/CLAUDE.md, convencao de erros). */
export class ErroNicho extends Error {}

const TERMOS_MIN = 5;
const TERMOS_MAX = 20;
/**
 * De 10 para 40 (preparacao da viagem, item 1): sem o Apify (suspenso), a
 * conta semente do admin e a unica porta de entrada de conta do Instagram
 * num nicho novo, e o Bruno e o Uli vao montar dois nichos novos (Overtake,
 * Velura) de fora, sem o motor de descoberta por termo ajudando.
 */
const CONTAS_SEMENTE_MAX = 40;

/** Minusculo, sem acento, hifens; nunca sufixo automatico em colisao (decisao 1 do PROXIMO.md). */
export function gerarSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Um termo por linha, sem repeticao ignorando caixa e acento (decisao 2 do
 * PROXIMO.md). Linha em branco e ignorada, nunca conta como termo vazio.
 */
export function normalizarTermos(bruto: string): string[] {
  const vistos = new Set<string>();
  const termos: string[] = [];
  for (const linha of bruto.split("\n")) {
    const termo = linha.trim();
    if (!termo) continue;
    const chave = termo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    termos.push(termo);
  }
  return termos;
}

function validarTermos(termos: string[]): void {
  if (termos.length < TERMOS_MIN || termos.length > TERMOS_MAX) {
    throw new ErroNicho(`escolha de ${TERMOS_MIN} a ${TERMOS_MAX} termos de busca, um por linha.`);
  }
}

async function slugJaExiste(slug: string): Promise<boolean> {
  const [linha] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.slug, slug));
  return Boolean(linha);
}

export async function criarNicho(dados: {
  nome: string;
  descricao?: string;
  termosBruto: string;
}): Promise<Nicho> {
  const nome = dados.nome.trim();
  if (!nome) throw new ErroNicho("informe um nome para o nicho.");

  const termos = normalizarTermos(dados.termosBruto);
  validarTermos(termos);

  const slug = gerarSlug(nome);
  if (!slug) throw new ErroNicho("esse nome nao gera um endereco valido; tente outro.");
  if (await slugJaExiste(slug)) {
    throw new ErroNicho(`ja existe um nicho parecido com esse nome (${slug}); escolha outro.`);
  }

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug, nome, descricao: dados.descricao?.trim() || null, termos, ativo: true })
    .returning();

  /**
   * M2, item 1: "o próprio agente tem que fazer uma pesquisa antes de começar o setor" (decisão
   * do Gustavo em 30/09/2026). A fila nunca derruba a criação do setor (mesma regra de
   * `enfileirarLeituraDoDia`, acima): se o pg-boss estiver fora do ar, o erro fica só no log.
   */
  try {
    await garantirBossPronto();
    await boss().send(FILAS.pesquisaDeSetor, { nichoId: nicho.id });
  } catch (erro) {
    logger.error({ err: erro, nichoId: nicho.id }, "nao foi possivel enfileirar a pesquisa de setor do nicho novo");
  }

  return nicho;
}

/** O slug nao muda na edicao: e o endereco da tela, e trocar quebraria o link. */
export async function atualizarNicho(
  id: number,
  dados: { nome: string; descricao?: string; termosBruto: string },
): Promise<Nicho> {
  const nome = dados.nome.trim();
  if (!nome) throw new ErroNicho("informe um nome para o nicho.");

  const termos = normalizarTermos(dados.termosBruto);
  validarTermos(termos);

  const [nicho] = await db()
    .update(nichos)
    .set({ nome, descricao: dados.descricao?.trim() || null, termos })
    .where(eq(nichos.id, id))
    .returning();
  if (!nicho) throw new ErroNicho("nicho nao encontrado.");
  return nicho;
}

/**
 * Aceita um termo ou hashtag sugerido pela pesquisa de setor (M2, item 6: "termo muda a busca de
 * todo dia, então esse o Gustavo confirma", um toque no admin). Ignora se já existe (mesma
 * normalização de `normalizarTermos`) ou se o nicho já está no teto de termos.
 */
export async function aceitarTermoSugerido(id: number, termo: string): Promise<Nicho> {
  const [nicho] = await db().select().from(nichos).where(eq(nichos.id, id));
  if (!nicho) throw new ErroNicho("nicho nao encontrado.");

  const chave = termo.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const jaTem = nicho.termos.some((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === chave);
  if (jaTem) return nicho;
  if (nicho.termos.length >= TERMOS_MAX) {
    throw new ErroNicho(`no maximo ${TERMOS_MAX} termos de busca; remova um antes de aceitar este.`);
  }

  const [atualizado] = await db()
    .update(nichos)
    .set({ termos: [...nicho.termos, termo.trim()] })
    .where(eq(nichos.id, id))
    .returning();
  return atualizado;
}

/**
 * M3: a régua por setor (`nichos.piso_views`, `proporcao_brasil`, `video_sem_fala_vale`).
 * `null` em qualquer campo volta ao padrão de `config.regras` (`reguaDoSetor`); "voltar ao
 * padrão" no admin chama isto com o campo em `null`. Mesmas faixas que fazem sentido para um
 * número de views e uma proporção, para o campo nunca gravar um valor sem sentido (visão errada
 * de dedo, por exemplo, piso negativo ou proporção de 200%).
 */
export type DadosRegua = {
  pisoViews: number | null;
  proporcaoBrasil: number | null;
  videoSemFalaVale: boolean | null;
};

export async function atualizarRegua(id: number, dados: DadosRegua): Promise<Nicho> {
  if (dados.pisoViews !== null && (!Number.isFinite(dados.pisoViews) || dados.pisoViews < 0)) {
    throw new ErroNicho("o piso de views precisa ser um numero de zero para cima.");
  }
  if (dados.proporcaoBrasil !== null && (!Number.isFinite(dados.proporcaoBrasil) || dados.proporcaoBrasil < 0 || dados.proporcaoBrasil > 1)) {
    throw new ErroNicho("a proporcao de video brasileiro precisa ser de 0% a 100%.");
  }

  const [nicho] = await db()
    .update(nichos)
    .set({
      pisoViews: dados.pisoViews,
      proporcaoBrasil: dados.proporcaoBrasil === null ? null : dados.proporcaoBrasil.toFixed(3),
      videoSemFalaVale: dados.videoSemFalaVale,
    })
    .where(eq(nichos.id, id))
    .returning();
  if (!nicho) throw new ErroNicho("nicho nao encontrado.");
  return nicho;
}

/** Desativar tira o nicho de /comecar e das coletas; reativar volta. Nunca apaga nada. */
export async function alternarAtivoNicho(id: number, ativo: boolean): Promise<Nicho> {
  const [nicho] = await db().update(nichos).set({ ativo }).where(eq(nichos.id, id)).returning();
  if (!nicho) throw new ErroNicho("nicho nao encontrado.");
  return nicho;
}

/**
 * `analisarUrlPerfil` mudou para `src/lib/perfil-redes.ts` (V12c, item 3b, a E37b): precisa
 * rodar no cliente também. Reexportada aqui para nenhum import existente quebrar.
 */
export { analisarUrlPerfil } from "@/lib/perfil-redes";

/**
 * Ate `CONTAS_SEMENTE_MAX` URLs por linha (decisao 2 do PROXIMO.md; teto
 * subiu de 10 para 40 na preparacao da viagem, item 1). Valida a forma de
 * todas antes de gravar qualquer uma (nada gravado pela metade); numa
 * transacao pelo mesmo motivo. Conta que ja existe (mesma plataforma e
 * handle, de uma coleta anterior) so passa a `vigiada = true`, sem
 * duplicar linha. Depois de gravar, enfileira a leitura do mesmo dia
 * (item 3, `enfileirarLeituraDoDia`).
 */
export async function adicionarContasSemente(nichoId: number, urlsBruto: string): Promise<Conta[]> {
  const linhas = [...new Set(urlsBruto.split("\n").map((l) => l.trim()).filter(Boolean))];
  if (linhas.length === 0) throw new ErroNicho("cole ao menos uma URL de perfil.");

  const analisadas = linhas.map((linha) => ({ linha, resultado: analisarUrlPerfil(linha) }));
  const invalidas = analisadas.filter((a) => !a.resultado).map((a) => a.linha);
  if (invalidas.length > 0) {
    throw new ErroNicho(
      `URL de perfil invalida (precisa ser um link de perfil do YouTube, TikTok ou Instagram): ${invalidas.join(", ")}`,
    );
  }

  const [{ total: existentes }] = await db()
    .select({ total: count() })
    .from(contas)
    .where(and(eq(contas.nichoId, nichoId), eq(contas.origem, "curadoria")));
  if (existentes + analisadas.length > CONTAS_SEMENTE_MAX) {
    throw new ErroNicho(
      `no maximo ${CONTAS_SEMENTE_MAX} contas semente por nicho (este nicho ja tem ${existentes}).`,
    );
  }

  const contasCriadas = await db().transaction(async (tx) => {
    const criadas: Conta[] = [];
    for (const { resultado } of analisadas) {
      const { plataforma, handle } = resultado!;
      const [conta] = await tx
        .insert(contas)
        .values({ plataforma, handle, nichoId, vigiada: true, origem: "curadoria" })
        .onConflictDoUpdate({
          target: [contas.plataforma, contas.handle],
          set: { vigiada: true, atualizadoEm: new Date() },
        })
        .returning();
      criadas.push(conta);
    }
    return criadas;
  });

  await enfileirarLeituraDoDia(nichoId, contasCriadas);

  return contasCriadas;
}

/**
 * A semente é lida no mesmo dia (preparação da viagem, item 3): sem isso,
 * o cliente só veria vídeo da conta que acabou de colar na coleta de
 * madrugada do dia seguinte. Só enfileira o job que a fila ainda não tem
 * pendente para este nicho (`existeJobPendente`, a mesma checagem da rota
 * `POST /api/jobs/[nome]`); a fila fora do ar nunca derruba a ação de
 * adicionar conta semente, só fica registrado no log (mesmo raciocínio do
 * item 6 do acabamento da E27).
 */
async function enfileirarLeituraDoDia(nichoId: number, contasCriadas: Conta[]): Promise<void> {
  const plataformas = new Set(contasCriadas.map((c) => c.plataforma));
  const filas: string[] = [];
  if (plataformas.has("instagram") && config.coleta.metaAtivo) filas.push(FILAS.metaContas);
  if (plataformas.has("youtube")) filas.push(FILAS.coletaYoutube);
  if (filas.length === 0) return;

  try {
    await garantirBossPronto();
    for (const fila of filas) {
      if (await existeJobPendente(fila, nichoId)) continue;
      await boss().send(fila, { nichoId });
    }
  } catch (erro) {
    logger.error({ err: erro, nichoId }, "nao foi possivel enfileirar a leitura do mesmo dia das contas semente");
  }
}

/**
 * "Tirar" uma conta semente no admin do setor (M2, item 3): marca `removida_em` em vez de apagar,
 * para o histórico de vídeo já coletado continuar valendo; `pesquisa-de-setor` nunca propõe de
 * novo um handle com essa marca, e a vigilância para de tratar a conta como semente sempre vigiada.
 */
export async function tirarConta(contaId: number): Promise<void> {
  await db().update(contas).set({ removidaEm: new Date(), vigiada: false }).where(eq(contas.id, contaId));
}
