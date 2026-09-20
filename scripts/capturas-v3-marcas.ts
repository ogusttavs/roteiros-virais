/**
 * Capturas do V3, marcas e acessos (definição de pronto do `PROXIMO.md`):
 * `Casca.VariasMarcas`, `Casca.VariasMarcasAberto`, `Casca.Trocando`,
 * `Conta.Acessos`, `AdminCliente.Acessos`, `AdminCliente.AcessosDar`, nas
 * larguras do design (390, 1024, 1280) e nos dois modos. Script próprio,
 * fora da suíte de testes, no mesmo padrão de `scripts/capturas.ts`: monta o
 * fixture direto no banco (uma segunda marca do cliente de seed, com uma
 * segunda pessoa) e usa o Playwright para navegar e gravar PNG.
 *
 * `Casca.Trocando` é um estado transitório (o cookie grava em poucos
 * milissegundos numa máquina local): a captura atrasa de propósito a
 * resposta da Server Action `trocarMarcaAction` (`page.route`), só para
 * ter uma janela de tempo para o `screenshot`.
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v3-marcas -- <nome-da-etapa>`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { account, briefings, clientes, membrosMarca, temasDia, user, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;
const EMAIL_ADMIN = "admin@exemplo.teste";

const NOME_SEGUNDA_MARCA = "[exemplo] Brilho Automotivo";
const USUARIO_MEMBRO = "captura-v3-membro";
const NOME_MEMBRO = "[exemplo] Uli Segundo";
const EMAIL_MEMBRO = `${USUARIO_MEMBRO}@exemplo.teste`;

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1024", largura: 1024, altura: 768 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function entrar(page: Page, baseUrl: string, email: string, senha: string = SENHA_SEED): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

/**
 * Garante os temas de hoje do nicho (sem isto, `/hoje` cai no estado
 * "sem_tema" da `page.tsx`, que nunca chega a renderizar `HojeTela` nem o
 * seletor de marca dela: achado tirando `Casca.Trocando`, a folha e o
 * esqueleto simplesmente nunca apareciam porque o cliente de seed nao tinha
 * `temas_dia` de hoje).
 */
async function garantirTemasDeHoje(nichoId: number): Promise<void> {
  const [existente] = await db()
    .select({ data: temasDia.data })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
  if (existente) return;

  const temas: TemaDoDia[] = [
    {
      titulo: "[exemplo] o erro que faz a mancha voltar depois da limpeza",
      descricao: "descricao do tema de exemplo",
      porQue: "esta subindo mais rapido que o normal da conta",
      evidencias: [],
      puxaPara: "conversao",
    },
    {
      titulo: "[exemplo] o que fazer antes de aplicar o produto",
      descricao: "descricao do tema de exemplo",
      porQue: "uma duvida que aparece toda semana nos comentarios",
      evidencias: [],
      puxaPara: "engajamento",
    },
    {
      titulo: "[exemplo] quanto custa limpar errado duas vezes",
      descricao: "descricao do tema de exemplo",
      porQue: "assunto de custo esta subindo no setor",
      evidencias: [],
      puxaPara: "alcance",
    },
  ];
  await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
}

/** Garante a segunda marca do cliente de seed (dono) e a segunda pessoa nela (membro). */
async function garantirFixture(): Promise<{ marcaDoisId: number }> {
  const marcas = await marcasDoUsuario(USUARIO_SEED);
  const primeira = marcas[0];
  if (!primeira) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed" primeiro.`);
  }
  if (!primeira.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem nicho; confira o seed.`);
  }
  await garantirTemasDeHoje(primeira.nichoId);

  let marcaDois = marcas.find((m) => m.nome === NOME_SEGUNDA_MARCA);
  if (!marcaDois) {
    const [nova] = await db()
      .insert(clientes)
      .values({ usuarioId: USUARIO_SEED, nome: NOME_SEGUNDA_MARCA, nichoId: primeira.nichoId })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: USUARIO_SEED, clienteId: nova.id, papel: "dono" });
    await db()
      .insert(briefings)
      .values({
        clienteId: nova.id,
        completo: true,
        perfil: {
          fatos: {
            oQueVende: "detalhamento automotivo",
            preco: "pacote a partir de 149 reais",
            clienteIdeal: "dono de carro que cuida do proprio veiculo",
            medos: [],
            frasesDaFala: [],
            proibicoes: [],
            cenasFilmaveis: [],
            concorrentes: [],
            perfisAdmirados: [],
          },
          resumo: "marca de detalhamento automotivo, exemplo para a captura",
          referencias: [],
        },
      });
    marcaDois = nova;
  }

  const [usuarioMembro] = await db().select().from(user).where(eq(user.id, USUARIO_MEMBRO));
  if (!usuarioMembro) {
    await db().insert(user).values({ id: USUARIO_MEMBRO, name: NOME_MEMBRO, email: EMAIL_MEMBRO });
    await db()
      .insert(account)
      .values({
        id: `${USUARIO_MEMBRO}-credential`,
        issuer: "local:credential",
        accountId: USUARIO_MEMBRO,
        providerId: "credential",
        userId: USUARIO_MEMBRO,
        password: await hashPassword(SENHA_SEED),
      });
  }

  // Na marca dois, nao na primeira: e ela que Conta.Acessos e AdminCliente.Acessos
  // capturam (marcaDois e a marca ativa padrao no primeiro login, criada por ultimo).
  const [jaMembro] = await db()
    .select()
    .from(membrosMarca)
    .where(eq(membrosMarca.usuarioId, USUARIO_MEMBRO));
  if (!jaMembro) {
    await db().insert(membrosMarca).values({ usuarioId: USUARIO_MEMBRO, clienteId: marcaDois.id, papel: "membro" });
  }

  return { marcaDoisId: marcaDois.id };
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v3-marcas -- <nome-da-etapa> (ex.: "pr-46")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const { marcaDoisId } = await garantirFixture();

  const arquivosGravados: string[] = [];
  const browser = await chromium.launch();

  async function capturar(page: Page, tela: string, estado: string, rotulo: string, modo: string): Promise<void> {
    const nomeArquivo = `${tela}.${estado}.${rotulo}.${modo}.png`;
    const caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    await page.screenshot({ path: caminhoArquivo, fullPage: true });
    arquivosGravados.push(path.relative(path.resolve(__dirname, "..", ".."), caminhoArquivo));
  }

  /**
   * Troca para `nomeMarca` se ela nao for a ativa (a marca ativa padrao no
   * login muda ao longo do script: as capturas de "Trocando" terminam a
   * troca de verdade, entao a "de acesso mais recente" some do controle
   * depois delas). Sem isto, Conta.Acessos podia cair na marca errada.
   */
  async function garantirMarcaAtiva(page: Page, nomeMarca: string, largura: number): Promise<void> {
    const jaEstaAtiva = await page
      .getByRole("button", { name: new RegExp(`Agora em ${nomeMarca.replace(/[[\]]/g, "\\$&")}$`) })
      .count();
    if (jaEstaAtiva > 0) return;

    await page.getByRole("button", { name: /^Trocar de marca/ }).click();
    if (largura < 768) {
      const folha = page.getByRole("dialog", { name: "Suas marcas" });
      await folha.waitFor({ state: "visible" });
      await folha.getByRole("button", { name: nomeMarca }).click();
    } else {
      const menu = page.getByRole("menu", { name: "Suas marcas" });
      await menu.waitFor({ state: "visible" });
      await menu.getByRole("menuitemradio", { name: nomeMarca }).click();
    }
    await page
      .getByRole("button", { name: new RegExp(`Agora em ${nomeMarca.replace(/[[\]]/g, "\\$&")}$`) })
      .waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");
  }

  async function paraCadaTela(
    email: string,
    caminho: string,
    acao: (page: Page, tamanho: (typeof TAMANHOS)[number], modo: (typeof MODOS)[number]) => Promise<void>,
  ): Promise<void> {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();
        await entrar(page, baseUrl, email);
        await page.goto(`${baseUrl}${caminho}`);
        await page.waitForLoadState("networkidle");
        await acao(page, tamanho, modo);
        await contexto.close();
      }
    }
  }

  try {
    // Casca.VariasMarcas: a pilula (celular) ou o pe da barra lateral (tablet/desktop) fechados.
    await paraCadaTela(EMAIL_SEED, "/hoje", async (page, tamanho, modo) => {
      await capturar(page, "Casca", "VariasMarcas", tamanho.rotulo, modo.rotulo);
    });

    // Casca.VariasMarcasAberto: a folha (celular, role=dialog) ou o menu (desktop, role=menu) abertos.
    await paraCadaTela(EMAIL_SEED, "/hoje", async (page, tamanho, modo) => {
      await page.getByRole("button", { name: /^Trocar de marca/ }).click();
      const seletor =
        tamanho.largura < 768
          ? page.getByRole("dialog", { name: "Suas marcas" })
          : page.getByRole("menu", { name: "Suas marcas" });
      await seletor.waitFor({ state: "visible" });
      await capturar(page, "Casca", "VariasMarcasAberto", tamanho.rotulo, modo.rotulo);
    });

    // Casca.Trocando: segura a resposta da troca de propósito (sem
    // soltar até o screenshot terminar), local demais para um setTimeout
    // fixo correr contra o clique de verdade (achado tirando esta captura:
    // o ciclo inteiro, clique a re-render, terminava em poucos
    // milissegundos, rápido demais para qualquer atraso fixo confiar).
    await paraCadaTela(EMAIL_SEED, "/hoje", async (page, tamanho, modo) => {
      const controle: { liberar: (() => void) | null } = { liberar: null };
      await page.route("**/*", async (route) => {
        const requisicao = route.request();
        if (requisicao.method() === "POST" && requisicao.url().includes("/hoje")) {
          await new Promise<void>((resolve) => {
            controle.liberar = resolve;
          });
        }
        await route.continue();
      });
      await page.getByRole("button", { name: /^Trocar de marca/ }).click();
      // Clica em "a outra marca", nao numa com nome fixo: qual das duas esta
      // ativa por padrao depende da ordem de criacao (marcaPadrao), e a
      // marca ativa some da lista de opcoes (so o destaque no topo).
      if (tamanho.largura < 768) {
        const folha = page.getByRole("dialog", { name: "Suas marcas" });
        await folha.waitFor({ state: "visible" });
        await folha.getByRole("button").first().click();
      } else {
        const menu = page.getByRole("menu", { name: "Suas marcas" });
        await menu.waitFor({ state: "visible" });
        await menu.getByRole("menuitemradio", { checked: false }).first().click();
      }
      // A requisicao da troca esta presa em `controle.liberar`; o esqueleto
      // ja renderizou (marcaAlvo muda antes da requisicao sair). O finally
      // solta a requisicao mesmo se o "Abrindo" nao aparecer, senao o
      // route() fica preso para sempre e o script trava. Sem unroute: o
      // contexto fecha inteiro ao final desta rodada de paraCadaTela, e
      // chamar unroute enquanto outras respostas ainda estao em voo derruba
      // o handler delas ("Route is already handled").
      try {
        // "Abrindo <marca>" aparece duas vezes (o cabecalho e o esqueleto do aparte).
        await page.getByText("Abrindo").first().waitFor({ state: "visible", timeout: 5000 });
        await capturar(page, "Casca", "Trocando", tamanho.rotulo, modo.rotulo);
      } finally {
        controle.liberar?.();
      }
      await page.waitForLoadState("networkidle");
    });

    // Conta.Acessos: o cartao "Quem tem acesso a esta marca", com duas pessoas
    // (a marca dois; garante que ela esteja ativa, sem depender de qual foi
    // a de acesso mais recente depois das capturas de "Trocando" acima).
    await paraCadaTela(EMAIL_SEED, "/conta", async (page, tamanho, modo) => {
      await garantirMarcaAtiva(page, NOME_SEGUNDA_MARCA, tamanho.largura);
      await capturar(page, "Conta", "Acessos", tamanho.rotulo, modo.rotulo);
    });

    // AdminCliente.Acessos: o cartao "Quem tem acesso" do admin, mesma marca.
    await paraCadaTela(EMAIL_ADMIN, `/admin/clientes/${marcaDoisId}`, async (page, tamanho, modo) => {
      await capturar(page, "AdminCliente", "Acessos", tamanho.rotulo, modo.rotulo);
    });

    // AdminCliente.AcessosDar: a folha "Dar acesso" aberta.
    await paraCadaTela(EMAIL_ADMIN, `/admin/clientes/${marcaDoisId}`, async (page, tamanho, modo) => {
      await page.getByRole("button", { name: "dar acesso" }).click();
      await page.getByRole("dialog", { name: /^Dar acesso a/ }).waitFor({ state: "visible" });
      await capturar(page, "AdminCliente", "AcessosDar", tamanho.rotulo, modo.rotulo);
    });
  } finally {
    await browser.close();
  }

  console.log(`${arquivosGravados.length} captura(s) gravada(s):`);
  for (const arquivo of arquivosGravados) console.log(`  ${arquivo}`);

  await getPool().end();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
