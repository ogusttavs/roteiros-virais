import { describe, expect, it } from "vitest";

import {
  entradasPodres,
  funcoesExportadas,
  LEITURA_LIVRE,
  listarArquivos,
  listarRotas,
  metodosQueEscrevem,
  PADRAO_ROTAS,
  portasImportadasPelaRota,
  ROTAS_LIVRES,
  semComentarios,
  verificarArquivo,
  verificarConteudo,
  verificarPorta,
  verificarRota,
  verificarRotasDoRepositorio,
} from "./checar-ver-como-regras";

const LIVRE = "src/app/(painel)/(completo)/criar/objetivo/acoes.ts";

describe("checar-ver-como", () => {
  it("aceita a Server Action que recusa no modo como primeiro await, nas duas formas", () => {
    const fonte = [
      '"use server";',
      "export async function geraAction(): Promise<ResultadoAcao<null>> {",
      "  const recusaVerComo = await recusaDoVerComo();",
      "  if (recusaVerComo) return { ok: false, erro: recusaVerComo };",
      "  const cliente = await clienteDaSessaoAtual();",
      "  return { ok: true, dado: null };",
      "}",
      "export async function apagaAction(id: number): Promise<void> {",
      "  await exigirForaDoVerComo();",
      "  await apagar(id);",
      "}",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte)).toEqual([]);
  });

  it("reprova a Server Action que lê a sessão antes de recusar, ou que não recusa", () => {
    const fonte = [
      '"use server";',
      "export async function tarde(): Promise<void> {",
      "  const sessao = await sessaoDoPainel();",
      "  await exigirForaDoVerComo();",
      "}",
      "export async function nunca(id: number): Promise<{ ok: boolean }> {",
      "  await gravar(id);",
      "  return { ok: true };",
      "}",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte).map((p) => p.motivo.split(":")[0])).toEqual(["tarde", "nunca"]);
  });

  it("a lista de leitura livre vale por arquivo e função, não só por nome", () => {
    expect(Object.keys(LEITURA_LIVRE)).toContain("src/app/(painel)/_casca/ver-como-acoes.ts:sairDoVerComoAction");
    const fonte = '"use server";\nexport async function exemplosDaFichaAction(f: string) {\n  return [];\n}\n';
    expect(verificarConteudo(LIVRE, fonte)).toEqual([]);
    expect(verificarConteudo("src/app/(painel)/outro/acoes.ts", fonte)).toHaveLength(1);
  });

  it("acha as funções mesmo com tipo de retorno cheio de chaves", () => {
    const fonte = 'export async function a(x: { y: number }): Promise<ResultadoAcao<{ id: number }>> {\n  await exigirForaDoVerComo();\n}\n';
    expect(funcoesExportadas(fonte).map((f) => f.nome)).toEqual(["a"]);
    expect(verificarConteudo("x.ts", `"use server";\n${fonte}`)).toEqual([]);
  });

  it("vê as outras formas de exportar: seta, função anônima e export default", () => {
    const fonte = [
      '"use server";',
      "export const flecha = async (id: number) => {",
      "  await gravar(id);",
      "};",
      "export const anonima = async function (id: number) {",
      "  await gravar(id);",
      "};",
      "export default async function (id: number) {",
      "  await gravar(id);",
      "}",
      "export const certa = async () => {",
      "  await exigirForaDoVerComo();",
      "};",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte).map((p) => p.motivo.split(":")[0]).sort()).toEqual(["anonima", "default", "flecha"]);
  });

  it("aceita comentário antes da diretiva, e um comentário com o nome do guard não vale", () => {
    const fonte = [
      "/** Cabeçalho do arquivo. */",
      "// outro",
      '"use server";',
      "export async function falsa(): Promise<void> {",
      "  // await exigirForaDoVerComo();",
      "  await gravar();",
      "}",
    ].join("\n");
    expect(verificarConteudo("x.ts", fonte).map((p) => p.motivo.split(":")[0])).toEqual(["falsa"]);
  });

  it("recusaDoVerComo chamada sem devolver a recusa não vale", () => {
    const fonte = '"use server";\nexport async function a(): Promise<ResultadoAcao<null>> {\n  await recusaDoVerComo();\n  await gravar();\n  return { ok: true, dado: null };\n}\n';
    expect(verificarConteudo("x.ts", fonte)).toHaveLength(1);
  });

  it("Server Action inline reprova, e um .tsx comum sem a diretiva passa", () => {
    const inline = 'export function Tela() {\n  async function salvar() {\n    "use server";\n    await gravar();\n  }\n  return null;\n}\n';
    expect(verificarConteudo("x.tsx", inline)).toHaveLength(1);
    expect(verificarConteudo("x.tsx", "export function Tela() {\n  return null;\n}\n")).toEqual([]);
  });

  it("semComentarios mantém as linhas e não mexe em texto entre aspas", () => {
    const limpo = semComentarios('const a = "http://x"; // fora\n/* bloco\nlinhas */ const b = 1;');
    expect(limpo.split("\n")).toHaveLength(3);
    expect(limpo).toContain('"http://x"');
    expect(limpo).not.toContain("fora");
  });

  it("todas as Server Actions do painel do repositório estão em ordem", () => {
    const arquivos = listarArquivos();
    expect(arquivos.length).toBeGreaterThan(30);
    expect(arquivos.flatMap(verificarArquivo)).toEqual([]);
  });
});

// M3 da auditoria de segurança de 26/11/2026: as rotas /api que escrevem. Cada regra tem o caso que passa e o caso que reprova (a mutação da regra).
describe("checar-ver-como nas rotas /api", () => {
  const ROTA = "src/app/api/x/route.ts";
  const rotas = new Set([ROTA, "src/app/api/alvo/route.ts"]);
  const rota = (...linhas: string[]) => linhas.join("\n");
  const IMPORTA_A_PORTA = 'import { marcaDoCarrossel } from "@/lib/porta-do-carrossel";';
  const motivos = (fonte: string, caminho = ROTA) => verificarRota(caminho, fonte, rotas).map((p) => p.motivo.split(":")[0]);

  it("aceita os três jeitos de recusar o modo como primeiro await", () => {
    const fonte = rota(
      IMPORTA_A_PORTA,
      "export async function POST(request: Request) {",
      "  if (await modoVerComoLigado()) return NextResponse.json({ erro: MENSAGEM_VER_COMO_DESLIGADO }, { status: 403 });",
      "  const sessao = await sessaoAtual();",
      "}",
      "export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {",
      "  const marca = await marcaDoCarrossel();",
      "  if (marca instanceof NextResponse) return marca;",
      "  await gravar(marca.clienteId);",
      "}",
      "export async function PUT(request: Request) {",
      '  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return new Response(null, { status: 415 });',
      "  const sessao = await sessaoDoPainel();",
      "  if (!sessao) return NextResponse.json({}, { status: 401 });",
      "  if (sessao.verComo !== null) return NextResponse.json({}, { status: 403 });",
      "  await gravar(sessao.user.id);",
      "}",
    );
    expect(verificarRota(ROTA, fonte, rotas)).toEqual([]);
  });

  it("reprova o método que escreve sem recusar, ou que recusa depois de outro await", () => {
    const fonte = rota(
      "export async function POST(request: Request) {",
      "  const corpo = await request.json();",
      "  if (await modoVerComoLigado()) return NextResponse.json({}, { status: 403 });",
      "}",
      "export async function DELETE() {",
      "  await apagar();",
      "}",
    );
    expect(motivos(fonte)).toEqual(["POST", "DELETE"]);
  });

  it("chamar a recusa sem devolver a resposta não vale, em nenhum dos três jeitos", () => {
    expect(motivos(rota("export async function POST() {", "  await modoVerComoLigado();", "  await gravar();", "}"))).toEqual(["POST"]);
    expect(motivos(rota("export async function POST() {", "  const ligado = await modoVerComoLigado();", "  await gravar();", "}"))).toEqual(["POST"]);
    expect(motivos(rota("export async function POST() {", "  const marca = await marcaDoCarrossel();", "  await gravar();", "}"))).toEqual(["POST"]);
    expect(motivos(rota("export async function POST() {", "  const marca = await marcaDoCarrossel();", "  if (outra instanceof NextResponse) return outra;", "}"))).toEqual(["POST"]);
    expect(motivos(rota("export async function POST() {", "  const sessao = await sessaoDoPainel();", "  await gravar(sessao.user.id);", "  if (sessao.verComo !== null) return null;", "}"))).toEqual(["POST"]);
    // Uma função qualquer com nome de porta não vale: só as de PORTAS_DE_ROTA.
    expect(motivos(rota("export async function POST() {", "  const marca = await outraPorta();", "  if (marca instanceof NextResponse) return marca;", "}"))).toEqual(["POST"]);
  });

  it("a porta só vale se a rota a importa do arquivo da porta (alias ou caminho relativo)", () => {
    const corpo = ["export async function POST() {", "  const marca = await marcaDoCarrossel();", "  if (marca instanceof NextResponse) return marca;", "  await gravar(marca.clienteId);", "}"];
    // Bom: pelo alias, pelo caminho relativo, e com apelido (`as`).
    expect(motivos(rota(IMPORTA_A_PORTA, ...corpo))).toEqual([]);
    expect(motivos(rota('import { marcaDoCarrossel } from "../../../lib/porta-do-carrossel";', ...corpo))).toEqual([]);
    expect(motivos(rota('import { marcaDoCarrossel as marcaDoCarrossel, outra } from "@/lib/porta-do-carrossel.ts";', ...corpo))).toEqual([]);
    expect(motivos(rota('import { marcaDoCarrossel as entrada } from "@/lib/porta-do-carrossel";', ...corpo.map((l) => l.replace("marcaDoCarrossel", "entrada"))))).toEqual([]);
    // Ruim: sem import (nem declarada ali), função local, importada de outro lugar, de pacote, ou só como tipo.
    expect(motivos(rota(...corpo))).toEqual(["POST"]);
    expect(motivos(rota("async function marcaDoCarrossel() { return { clienteId: 1 }; }", ...corpo))).toEqual(["POST"]);
    expect(motivos(rota('import { marcaDoCarrossel } from "@/lib/outra-porta";', ...corpo))).toEqual(["POST"]);
    expect(motivos(rota('import { marcaDoCarrossel } from "pacote-externo";', ...corpo))).toEqual(["POST"]);
    expect(motivos(rota('import type { marcaDoCarrossel } from "@/lib/porta-do-carrossel";', ...corpo))).toEqual(["POST"]);
    // Importar outro nome do arquivo da porta não faz de uma função local a porta.
    expect(motivos(rota('import { SEM_CACHE } from "@/lib/porta-do-carrossel";', "async function marcaDoCarrossel() {}", ...corpo))).toEqual(["POST"]);
    // Um comentário com o import não vale.
    expect(motivos(rota('// import { marcaDoCarrossel } from "@/lib/porta-do-carrossel";', ...corpo))).toEqual(["POST"]);
  });

  it("as listas só valem por propriedade própria: `toString` e `constructor` não são porta", () => {
    expect(portasImportadasPelaRota(ROTA, 'import { toString, constructor } from "@/lib/porta-do-carrossel";').size).toBe(0);
    const corpo = ["export async function POST() {", "  const marca = await toString();", "  if (marca instanceof NextResponse) return marca;", "}"];
    expect(motivos(rota('import { toString } from "@/lib/porta-do-carrossel";', ...corpo))).toEqual(["POST"]);
    // A porta de verdade continua sendo reconhecida.
    expect(portasImportadasPelaRota(ROTA, IMPORTA_A_PORTA)).toEqual(new Set(["marcaDoCarrossel"]));
  });

  it("olha todo route handler do app que o Next aceita, e deixa de fora o admin", () => {
    expect(PADRAO_ROTAS).toBe("src/app/**/route.{ts,tsx,js,mjs}");
    const lista = listarRotas();
    expect(lista.some((r) => r.startsWith("src/app/api/"))).toBe(true);
    expect(lista.some((r) => r.startsWith("src/app/api/admin/") || r.startsWith("src/app/admin/"))).toBe(false);
    // Fora de /api: uma rota que escreve sem recusar reprova, em qualquer extensão; com a recusa passa; reexportar de uma rota .tsx conferida vale.
    const sem = ["export async function POST() {", "  await gravar();", "}"];
    const com = ["export async function POST() {", "  if (await modoVerComoLigado()) return null;", "}"];
    for (const caminho of ["src/app/webhook/route.ts", "src/app/(painel)/baixar/route.tsx", "src/app/feed/route.js", "src/app/feed/route.mjs"]) {
      expect(motivos(rota(...sem), caminho)).toEqual(["POST"]);
      expect(motivos(rota(...com), caminho)).toEqual([]);
    }
    const conferidas = new Set(["src/app/a/route.ts", "src/app/b/route.tsx"]);
    expect(verificarRota("src/app/a/route.ts", 'export { POST } from "../b/route";', conferidas)).toEqual([]);
    expect(verificarRota("src/app/a/route.ts", 'export { POST } from "../sumiu/route";', conferidas)).toHaveLength(1);
  });

  it("o GET fica de fora, e um comentário com a recusa não vale", () => {
    expect(motivos(rota("export async function GET() {", "  return NextResponse.json(await ler());", "}"))).toEqual([]);
    expect(motivos(rota("export async function POST() {", "  // if (await modoVerComoLigado()) return null;", "  await gravar();", "}"))).toEqual(["POST"]);
  });

  it("vê as outras formas de exportar: seta, desestruturada, export function sem async e embrulhada", () => {
    expect(motivos(rota("export const POST = async (request: Request) => {", "  await gravar();", "};"))).toEqual(["POST"]);
    expect(motivos(rota("export const PUT = async (request: Request) => {", "  if (await modoVerComoLigado()) return null;", "};"))).toEqual([]);
    expect(motivos(rota("export const { GET, POST } = toNextJsHandler(auth);"))).toEqual(["POST"]);
    expect(motivos(rota("export function DELETE() {", "  return apagar();", "}"))).toEqual(["DELETE"]);
    expect(motivos(rota("export const PATCH = comLimite(async () => gravar());"))).toEqual(["PATCH"]);
    expect(motivos(rota("async function gravarTudo() {}", "export { gravarTudo as POST };"))).toEqual(["POST"]);
  });

  it("a reexportação vale só para outra rota conferida", () => {
    const daRota = 'export { POST } from "../alvo/route";';
    expect(motivos(daRota)).toEqual([]);
    expect(motivos('export { POST } from "../sumiu/route";')).toEqual(["POST"]);
    expect(motivos('export { POST } from "@/lib/qualquer";')).toEqual(["POST"]);
  });

  it("a lista de rotas livres vale por arquivo e método, e a entrada podre reprova", () => {
    const auth = "src/app/api/auth/[...all]/route.ts";
    expect(Object.keys(ROTAS_LIVRES)).toContain(`${auth}:POST`);
    const fonte = "export const { GET, POST } = toNextJsHandler(auth);";
    expect(verificarRota(auth, fonte, rotas)).toEqual([]);
    expect(verificarRota("src/app/api/outra/route.ts", fonte, rotas)).toHaveLength(1);
    expect(metodosQueEscrevem(fonte).map((m) => m.metodo)).toEqual(["POST"]);
    const tudo = new Map(Object.keys(ROTAS_LIVRES).map((chave) => [chave.slice(0, chave.lastIndexOf(":")), new Set([chave.slice(chave.lastIndexOf(":") + 1)])]));
    expect(entradasPodres(tudo)).toEqual([]);
    tudo.delete(auth);
    expect(entradasPodres(tudo).map((p) => p.arquivo)).toEqual([auth]);
  });

  it("a porta comum precisa continuar recusando o modo como primeiro await", () => {
    const certa = rota(
      "export async function marcaDoCarrossel(): Promise<{ clienteId: number } | NextResponse> {",
      '  if (!carrosselAtivo()) return NextResponse.json({ erro: "nao encontrado" }, { status: 404 });',
      "  if (await modoVerComoLigado()) return respostaDeErro(MENSAGEM_VER_COMO_DESLIGADO, 403);",
      "  const sessao = await sessaoAtual();",
      "}",
    );
    expect(verificarPorta("marcaDoCarrossel", "p.ts", certa)).toEqual([]);
    const semRecusa = certa.replace("  if (await modoVerComoLigado()) return respostaDeErro(MENSAGEM_VER_COMO_DESLIGADO, 403);\n", "");
    expect(verificarPorta("marcaDoCarrossel", "p.ts", semRecusa)).toHaveLength(1);
    const recusaTarde = certa.replace("  const sessao = await sessaoAtual();", "").replace("  if (await modoVerComoLigado())", "  const sessao = await sessaoAtual();\n  if (await modoVerComoLigado())");
    expect(verificarPorta("marcaDoCarrossel", "p.ts", recusaTarde)).toHaveLength(1);
    expect(verificarPorta("marcaDoCarrossel", "p.ts", "export async function outra() {}")).toHaveLength(1);
  });

  it("todas as rotas /api do repositório estão em ordem, e as do admin ficam de fora", () => {
    const lista = listarRotas();
    expect(lista.length).toBeGreaterThan(30);
    expect(lista).toContain("src/app/api/carrossel/route.ts");
    expect(lista.some((r) => r.startsWith("src/app/api/admin/"))).toBe(false);
    expect(verificarRotasDoRepositorio().problemas).toEqual([]);
  });
});
