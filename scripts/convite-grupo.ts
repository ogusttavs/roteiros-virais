/**
 * npm run convite:grupo -- --rotulo "texto" --ramo <nichoId> [--marcas N] [--dias N] [--sem-cortesia]
 * npm run convite:grupo -- --listar
 * npm run convite:grupo -- --desativar <id>
 *
 * Convite de grupo (27/11/2026): gera um link de uso unico para um dono de varias empresas (ex.: um grupo de clinicas). Quem abre o link cria o proprio e-mail e senha e a primeira
 * empresa, no ramo do convite; depois cria outras ate `--marcas` e da acesso a equipe dentro do aplicativo. O codigo tem 32 bytes aleatorios e NUNCA fica no banco (so o hash): o link
 * aparece UMA vez, na saida deste comando. Perdeu o link? Desative o convite e gere outro.
 *
 * - `--rotulo`: nome interno do convite, so para o admin se achar na lista (obrigatorio).
 * - `--ramo`: id do ramo (nichos.id) das empresas do grupo (obrigatorio; tem de existir).
 * - `--marcas`: quantas empresas o dono pode ter, contando a primeira (padrao 5, maximo 20).
 * - `--dias`: validade do link (padrao 7, maximo 30).
 * - `--sem-cortesia`: as empresas nascem sem cortesia (padrao: com cortesia, que so vale com a cobranca ligada).
 *
 * Rodar dentro do container do worker, como o `marca:demonstracao` (deploy/README.md).
 */
import { parseArgs } from "node:util";

import { getPool } from "@/db";
import { config } from "@/lib/config";
import { criarConviteDeGrupo, desativarConviteDeGrupo, listarConvitesDeGrupo } from "@/servicos/convite-de-grupo";

class ErroDoScript extends Error {}

function numero(valor: string | undefined, nome: string): number | undefined {
  if (valor === undefined) return undefined;
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new ErroDoScript(`${nome} precisa ser um numero inteiro.`);
  return n;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      rotulo: { type: "string" },
      ramo: { type: "string" },
      marcas: { type: "string" },
      dias: { type: "string" },
      "sem-cortesia": { type: "boolean", default: false },
      listar: { type: "boolean", default: false },
      desativar: { type: "string" },
    },
    strict: true,
  });

  if (values.listar) {
    const linhas = await listarConvitesDeGrupo();
    if (linhas.length === 0) console.log("nenhum convite de grupo ainda.");
    for (const l of linhas) {
      const situacao = l.desativado ? "desativado" : l.usado ? "usado" : l.expiraEm.getTime() <= Date.now() ? "vencido" : "aberto";
      console.log(`#${l.id} ${l.rotulo} | ramo ${l.ramo} | ${situacao} | vale ate ${l.expiraEm.toISOString()} | empresas ${l.marcasCriadas} de ${l.marcasMax}`);
    }
    return;
  }

  if (values.desativar !== undefined) {
    const id = numero(values.desativar, "--desativar");
    if (id === undefined || !(await desativarConviteDeGrupo(id))) throw new ErroDoScript(`o convite ${values.desativar} nao existe.`);
    console.log(`convite #${id} desativado: o link deixou de valer.`);
    return;
  }

  if (!values.rotulo || values.ramo === undefined) {
    throw new ErroDoScript('uso: npm run convite:grupo -- --rotulo "texto" --ramo <nichoId> [--marcas N] [--dias N] [--sem-cortesia] | --listar | --desativar <id>');
  }
  try {
    const convite = await criarConviteDeGrupo({
      rotulo: values.rotulo,
      nichoId: numero(values.ramo, "--ramo") as number,
      marcasMax: numero(values.marcas, "--marcas"),
      dias: numero(values.dias, "--dias"),
      cortesia: !values["sem-cortesia"],
    });
    console.log(`convite #${convite.id} criado. Vale ate ${convite.expiraEm.toISOString()}.`);
    console.log("O link aparece so agora; guarde-o (so o hash fica no banco):");
    console.log(`${config.appUrl}/convite/${convite.codigo}`);
  } catch (erro) {
    throw erro instanceof ErroDoScript ? erro : new ErroDoScript(erro instanceof Error ? erro.message : String(erro));
  }
}

/** O Vitest nao importa este arquivo, mas a guarda segue o `marca-demonstracao.ts`. */
if (!process.env.VITEST) {
  main()
    .then(async () => {
      await getPool().end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e instanceof ErroDoScript ? `Nao foi possivel: ${e.message}` : e);
      await getPool().end();
      process.exit(1);
    });
}
