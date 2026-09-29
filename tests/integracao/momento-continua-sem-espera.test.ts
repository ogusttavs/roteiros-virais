/**
 * V11, item 4: a base do botão "Voltar depois" da `TelaEscrevendo`. PROXIMO.md
 * pede para confirmar, com um teste de integração, que `gerarRoteiroMomentoAction`
 * termina e grava o roteiro mesmo sem quem chamou esperar a promessa, antes de
 * decidir se o botão pode só navegar.
 *
 * O que este teste prova: nada no caminho de `gerarRoteiroMomentoAction` até o
 * `insert` em `roteiros` depende de quem chamou continuar esperando a promessa
 * (nenhum `AbortController` nem sinal de requisição atado à execução, conferido
 * por leitura de código em toda a cadeia: a Server Action, `gerarRoteiro`,
 * `gerarConteudo`, `gerarComVerificacao`). O disparo abaixo não aguarda o
 * retorno da action, só o efeito no banco, do jeito que uma sessão nova (a
 * pessoa reabrindo o Histórico depois de fechar a aba) enxergaria.
 *
 * O que este teste NÃO prova: que o navegador de verdade, fechando a aba no
 * meio, não interrompe o processo do Node por outro caminho (um proxy, um
 * balanceador). A plataforma roda `node server.js` num processo próprio,
 * atrás do Caddy (`deploy/compose.prod.yml`), sem função serverless nem
 * timeout de borda que mataria a execução ao perder o cliente; é essa
 * combinação, código sem sinal de cancelamento mais um processo persistente,
 * que sustenta a decisão de item 4.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, roteiros, user, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";

import { resetarSchema } from "../../scripts/resetar-schema";
import { gerarRoteiroMomentoAction } from "../../src/app/(painel)/(completo)/hoje/momento/acoes";

const PERFIL: PerfilCompilado = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
    clienteIdeal: "mora em apartamento",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: [],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

/**
 * Uma frase natural (não uma constante em caixa alta): o verificador do mock
 * (`ia/verificador.ts`) reprova um gancho que não parece citar de verdade o
 * que a pessoa descreveu, e um marcador gritado não passa nessa checagem.
 */
const MARCADOR = "consertando a esteira modelo testemomentosemesperav11 que trava toda hora";

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

async function esperarAte<T>(consultar: () => Promise<T | undefined>, tentativas = 40, intervaloMs = 250): Promise<T> {
  for (let i = 0; i < tentativas; i++) {
    const achado = await consultar();
    if (achado !== undefined) return achado;
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
  throw new Error("o roteiro nao apareceu no banco a tempo");
}

let marca: { id: number; usuarioId: string };

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db().insert(nichos).values({ slug: "momento-sem-espera-teste", nome: "Momento sem espera teste" }).returning();

  await db().insert(user).values({ id: "momento-sem-espera", name: "[teste] Sem espera", email: "sem-espera@momento.teste" });

  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: "momento-sem-espera", nome: "[teste] Marca sem espera", nichoId: nicho.id })
    .returning();

  await db().insert(membrosMarca).values({ usuarioId: "momento-sem-espera", clienteId: cliente.id, papel: "dono" });
  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL });

  marca = { id: cliente.id, usuarioId: cliente.usuarioId! };
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("gerarRoteiroMomentoAction, sem quem chamou esperar a promessa", () => {
  it(
    "grava o roteiro mesmo quando o disparo nao aguarda o retorno (a base do Voltar depois)",
    async () => {
      vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe(marca.usuarioId));

      // Dispara e não segura a promessa: nenhum `await`, nenhum `.then` no caminho crítico, do jeito
      // que uma aba fechada deixa de estar interessada na resposta sem cancelar o que já começou.
      void gerarRoteiroMomentoAction({
        onde: "na oficina",
        oQueEstaAcontecendo: MARCADOR,
        oQueDaParaMostrar: "as peças novas na bancada",
        objetivo: "engajamento",
      });

      const roteiro = await esperarAte(async () => {
        const [linha] = await db()
          .select()
          .from(roteiros)
          .where(and(eq(roteiros.clienteId, marca.id), sql`momento ->> 'oQueEstaAcontecendo' = ${MARCADOR}`));
        return linha;
      });

      expect(roteiro.status).toBe("gerado");
      expect(roteiro.momento?.oQueEstaAcontecendo).toBe(MARCADOR);
    },
    30_000,
  );
});
