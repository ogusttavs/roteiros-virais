import { describe, expect, it } from "vitest";

import { ACOES_LIVRES, AREAS_LIVRES, GUARDIOES, PAGINAS_FORA_DO_PORTAO, ROTAS_LIVRES, verificarAcoes, verificarGuardiao, verificarPagina, verificarRota, verificarTudo } from "./checar-portao-cobranca-regras";

const LIVRE = "src/app/(painel)/(completo)/criar/objetivo/acoes.ts";

describe("checar-portao-cobranca: Server Actions", () => {
  it("aceita o portão logo depois da recusa do 'ver como', nas duas formas, e depois da sessão", () => {
    const fonte = [
      '"use server";',
      "export async function geraAction(): Promise<ResultadoAcao<null>> {",
      "  const recusaVerComo = await recusaDoVerComo();",
      "  if (recusaVerComo) return { ok: false, erro: recusaVerComo };",
      "  await exigirAssinaturaValida();",
      "  await gastar();",
      "}",
      "export async function apagaAction(id: number): Promise<void> {",
      "  await exigirForaDoVerComo();",
      "  const sessao = await sessaoDoPainel();",
      "  await exigirAssinaturaValida({ soDepoisDoBriefing: true });",
      "  await apagar(id);",
      "}",
    ].join("\n");
    expect(verificarAcoes("src/app/x/acoes.ts", fonte)).toEqual([]);
  });

  it("reprova o portão depois de um gasto, ou a ação sem portão", () => {
    const fonte = [
      '"use server";',
      "export async function tarde(): Promise<void> {",
      "  await exigirForaDoVerComo();",
      "  await gastarIA();",
      "  await exigirAssinaturaValida();",
      "}",
      "export async function nunca(id: number): Promise<void> {",
      "  await exigirForaDoVerComo();",
      "  await gravar(id);",
      "}",
    ].join("\n");
    expect(verificarAcoes("src/app/x/acoes.ts", fonte).map((p) => p.motivo.split(":")[0])).toEqual(["tarde", "nunca"]);
  });

  it("um comentário com o nome do portão não vale", () => {
    const fonte = ['"use server";', "export async function a(): Promise<void> {", "  // await exigirAssinaturaValida();", "  await exigirForaDoVerComo();", "  await gastarIA();", "}"].join("\n");
    expect(verificarAcoes("src/app/x/acoes.ts", fonte)).toHaveLength(1);
  });

  it("a lista de livres vale por arquivo e função, e as áreas livres por pasta", () => {
    const fonte = '"use server";\nexport async function exemplosDaFichaAction(f: string) {\n  return [];\n}\n';
    expect(verificarAcoes(LIVRE, fonte)).toEqual([]);
    expect(verificarAcoes("src/app/(painel)/outro/acoes.ts", fonte)).toHaveLength(1);
    const casca = '"use server";\nexport async function qualquerAction() {\n  await gastar();\n}\n';
    expect(verificarAcoes("src/app/(painel)/_casca/nova-acoes.ts", casca)).toEqual([]);
    expect(verificarAcoes("src/app/(painel)/assinar/acoes.ts", casca)).toEqual([]);
  });

  it("arquivo que não é de Server Actions fica de fora", () => {
    expect(verificarAcoes("src/app/x/Tela.tsx", "export async function a() { await gastar(); }")).toEqual([]);
  });
});

describe("checar-portao-cobranca: rotas, páginas e guardiões", () => {
  it("rota que chama recusaDaCobranca ou roteiroDeQuemPediu passa; a que não chama reprova; as livres passam", () => {
    expect(verificarRota("src/app/api/a/route.ts", "const r = await recusaDaCobranca();")).toEqual([]);
    expect(verificarRota("src/app/api/b/route.ts", "const d = await roteiroDeQuemPediu(params);")).toEqual([]);
    expect(verificarRota("src/app/api/c/route.ts", "export async function GET() { return gastar(); }")).toHaveLength(1);
    expect(verificarRota("src/app/api/c/route.ts", "// recusaDaCobranca()\nexport async function GET() {}")).toHaveLength(1);
    expect(verificarRota("src/app/api/saude/route.ts", "export async function GET() {}")).toEqual([]);
  });

  it("página fora do grupo precisa chamar o portão; o guardião precisa seguir chamando", () => {
    expect(verificarPagina("p.tsx", "await exigirAssinaturaValida();")).toEqual([]);
    expect(verificarPagina("p.tsx", "export default function P() {}")).toHaveLength(1);
    expect(verificarGuardiao("g.ts", "const r = await recusaDaCobranca();", "recusaDaCobranca")).toEqual([]);
    expect(verificarGuardiao("g.ts", "const r = 1;", "recusaDaCobranca")).toHaveLength(1);
  });

  it("toda licença tem motivo escrito", () => {
    for (const lista of [ACOES_LIVRES, AREAS_LIVRES, ROTAS_LIVRES]) {
      for (const motivo of Object.values(lista)) expect(motivo.length).toBeGreaterThan(10);
    }
    expect(PAGINAS_FORA_DO_PORTAO.length).toBeGreaterThan(0);
    expect(Object.keys(GUARDIOES).length).toBeGreaterThan(0);
  });
});

describe("checar-portao-cobranca: o repositório de hoje", () => {
  it("não tem nenhum problema (nenhuma ação, rota ou página escapou, e nenhuma licença apodreceu)", () => {
    const { problemas, acoes, rotas } = verificarTudo();
    expect(problemas).toEqual([]);
    expect(acoes).toBeGreaterThan(50);
    expect(rotas).toBeGreaterThan(10);
  });
});
