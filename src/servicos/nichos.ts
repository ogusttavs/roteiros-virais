/**
 * Nicho pelo admin (etapa 24, parte 1 do plano): criar, editar, ativar e
 * desativar nicho, e acrescentar contas semente. So admin usa isto
 * (`garantirSessaoAdmin` nas Server Actions de `src/app/admin/nichos/acoes.ts`).
 */
import { and, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { contas, nichos, type Conta, type Nicho, type Plataforma } from "@/db/schema";

/** Nome com mensagem para a tela (plataforma/CLAUDE.md, convencao de erros). */
export class ErroNicho extends Error {}

const TERMOS_MIN = 5;
const TERMOS_MAX = 20;
const CONTAS_SEMENTE_MAX = 10;

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

/** Desativar tira o nicho de /comecar e das coletas; reativar volta. Nunca apaga nada. */
export async function alternarAtivoNicho(id: number, ativo: boolean): Promise<Nicho> {
  const [nicho] = await db().update(nichos).set({ ativo }).where(eq(nichos.id, id)).returning();
  if (!nicho) throw new ErroNicho("nicho nao encontrado.");
  return nicho;
}

/**
 * So a forma da URL (sem consultar a plataforma na hora de salvar, decisao 2
 * do PROXIMO.md). O handle guardado bate com o formato que a coleta de
 * verdade grava em `contas.handle` para cada plataforma (upsertConta,
 * normalizadores/*), para uma conta semente e a mesma conta descoberta pela
 * coleta nunca virarem duas linhas: YouTube guarda com "@" (ou o id do canal
 * em /channel/), TikTok e Instagram guardam sem "@".
 */
export function analisarUrlPerfil(bruta: string): { plataforma: Plataforma; handle: string } | null {
  let url: URL;
  try {
    url = new URL(bruta.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const segmentos = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com") {
    if (segmentos.length === 1 && segmentos[0].startsWith("@")) {
      return { plataforma: "youtube", handle: segmentos[0] };
    }
    if (segmentos[0] === "channel" && segmentos[1]) {
      return { plataforma: "youtube", handle: segmentos[1] };
    }
    return null;
  }
  if (host === "tiktok.com") {
    if (segmentos.length === 1 && segmentos[0].startsWith("@")) {
      return { plataforma: "tiktok", handle: segmentos[0].slice(1) };
    }
    return null;
  }
  if (host === "instagram.com") {
    if (segmentos.length === 1) {
      return { plataforma: "instagram", handle: segmentos[0] };
    }
    return null;
  }
  return null;
}

/**
 * Ate 10 URLs por linha (decisao 2 do PROXIMO.md). Valida a forma de todas
 * antes de gravar qualquer uma (nada gravado pela metade); numa transacao
 * pelo mesmo motivo. Conta que ja existe (mesma plataforma e handle, de uma
 * coleta anterior) so passa a `vigiada = true`, sem duplicar linha.
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

  return db().transaction(async (tx) => {
    const contasCriadas: Conta[] = [];
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
      contasCriadas.push(conta);
    }
    return contasCriadas;
  });
}
