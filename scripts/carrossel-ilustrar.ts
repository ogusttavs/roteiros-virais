/**
 * E69 PR A: pede ao Codex DESTA maquina uma ilustracao por slide de um carrossel e a devolve pelas rotas de admin. Uso:
 *
 *   ILUSTRACAO_COOKIE="<cookie de sessao do admin, nome=valor>" npm run carrossel:ilustrar -- <url-base> <carrosselId> [--so=2,4] [--refazer]
 *
 * O cookie vem so da variavel de ambiente (nunca de argumento, nunca gravado, nunca mostrado). Le os slides em `GET /api/admin/carrossel/<id>/slides`, monta um pedido por slide a partir do texto, roda
 * `codex exec -s workspace-write --skip-git-repo-check -C <pasta temporaria vazia>` (a pasta nao e um repositorio; nunca o modo sem sandbox), confere que saiu uma imagem e a manda por `PUT /api/admin/carrossel/<id>/ilustracao/<n>`. Sem `--refazer`, pula
 * os slides que ja tem ilustracao; `--so=2,4` faz so esses slides (numeros a partir de 1). Antes e depois, resultado e noticia nao recebem pedido. Cada slide leva alguns minutos no Codex.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { pedidoDaIlustracao } from "../src/carrossel/pedido-de-ilustracao";

const TETO = 6 * 1024 * 1024;
const TEMPO_DO_CODEX_MS = 12 * 60 * 1000;

type Slide = { indice: number; tipo: string; texto: string; aceita: boolean; temIlustracao: boolean };
type Dados = { carrosselId: number; tema: string; ramo: string | null; saude: boolean; slides: Slide[] };

function falhar(mensagem: string): never {
  console.error(mensagem);
  process.exit(1);
}

async function chamar(url: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers as Record<string, string>), Cookie: cookie } });
}

function imagemDaPasta(pasta: string): string | null {
  const achadas = readdirSync(pasta).filter((f) => /\.(png|jpe?g)$/i.test(f));
  return achadas.length > 0 ? path.join(pasta, achadas[0]) : null;
}

async function main() {
  const [urlBruta, idBruto, ...opcoes] = process.argv.slice(2);
  const cookie = process.env.ILUSTRACAO_COOKIE;
  if (!urlBruta || !idBruto || !/^\d+$/.test(idBruto)) falhar("Uso: ILUSTRACAO_COOKIE=... npm run carrossel:ilustrar -- <url-base> <carrosselId> [--so=2,4] [--refazer]");
  if (!cookie) falhar("Faltou a variavel ILUSTRACAO_COOKIE (o cookie de sessao do admin, nome=valor).");
  const base = urlBruta.replace(/\/+$/, "");
  const refazer = opcoes.includes("--refazer");
  const so = opcoes.find((o) => o.startsWith("--so="))?.slice(5).split(",").map(Number);

  const resposta = await chamar(`${base}/api/admin/carrossel/${idBruto}/slides`, cookie);
  if (!resposta.ok) falhar(`Nao consegui ler os slides (HTTP ${resposta.status}). Confira a url, o cookie do admin e a chave ILUSTRACAO_ATIVA do servidor.`);
  const dados = (await resposta.json()) as Dados;
  console.log(`Carrossel ${dados.carrosselId}: ${dados.slides.length} slides, tema "${dados.tema}".`);

  let feitos = 0;
  for (const slide of dados.slides) {
    const numero = slide.indice + 1;
    if (so && !so.includes(numero)) continue;
    if (slide.temIlustracao && !refazer && !so) {
      console.log(`slide ${numero} (${slide.tipo}): ja tem ilustracao, pulado`);
      continue;
    }
    const arquivo = `slide-${String(numero).padStart(2, "0")}.png`;
    const pedido = pedidoDaIlustracao({ tipo: slide.tipo, texto: slide.texto, tema: dados.tema, ramo: dados.ramo, arquivo });
    if (!pedido) {
      console.log(`slide ${numero} (${slide.tipo}): este tipo nao recebe ilustracao pelo script, pulado`);
      continue;
    }
    const pasta = mkdtempSync(path.join(tmpdir(), "ilustrar-"));
    try {
      console.log(`slide ${numero} (${slide.tipo}): pedindo ao Codex...`);
      const inicio = Date.now();
      const codex = spawnSync("codex", ["exec", "-s", "workspace-write", "--skip-git-repo-check", "-C", process.platform === "win32" ? `"${pasta}"` : pasta, "-"], {
        input: pedido.prompt,
        encoding: "utf8",
        timeout: TEMPO_DO_CODEX_MS,
        shell: process.platform === "win32",
        maxBuffer: 64 * 1024 * 1024,
      });
      const imagem = imagemDaPasta(pasta);
      if (codex.status !== 0 && !imagem) {
        console.error(`slide ${numero}: o Codex falhou (codigo ${codex.status ?? "sem codigo"}), pulado`);
        const fim = `${codex.stderr ?? ""}${codex.stdout ?? ""}`.trim().split("\n").slice(-4).join(" | ");
        if (fim) console.error(`  ${fim.slice(0, 400)}`);
        continue;
      }
      if (!imagem) {
        console.error(`slide ${numero}: o Codex terminou mas nao salvou nenhuma imagem, pulado`);
        continue;
      }
      if (statSync(imagem).size > TETO) {
        console.error(`slide ${numero}: a imagem passa de 6 MB, pulado`);
        continue;
      }
      const bytes = readFileSync(imagem);
      const envio = await chamar(`${base}/api/admin/carrossel/${idBruto}/ilustracao/${numero}${pedido.generica ? "?generica=1" : ""}`, cookie, {
        method: "PUT",
        headers: { "Content-Type": /\.png$/i.test(imagem) ? "image/png" : "image/jpeg" },
        body: bytes,
      });
      if (!envio.ok) {
        console.error(`slide ${numero}: o servidor recusou a imagem (HTTP ${envio.status})`);
        continue;
      }
      feitos += 1;
      console.log(`slide ${numero}: ilustracao enviada em ${Math.round((Date.now() - inicio) / 1000)} s${pedido.generica ? " (generica)" : ""}`);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }
  console.log(`Pronto: ${feitos} ilustracao(oes) enviada(s).`);
}

void main();
