/**
 * Visita /entrar uma vez antes da suite (achado da revisao da etapa 7, task
 * separada de investigacao): a primeira visita de toda a suite a uma rota
 * nova, contra o `next dev` ainda frio, podia colidir com a hidratacao. O
 * clique do Playwright chegava antes de o React anexar o onSubmit do
 * formulario, o navegador caia no submit nativo do <form> e vazava e-mail e
 * senha na query string (`/entrar?email=...&senha=...`) em vez de navegar
 * para /comecar ou /hoje.
 *
 * Depois que uma rota ja foi compilada uma vez, o resto da suite passa
 * normalmente (o webpack do `next dev` cacheia o bundle compilado); e o que
 * ja acontecia manualmente sempre que alguem testava a tela no navegador
 * antes do e2e. Este arquivo faz isso sozinho, forcando a compilacao e
 * esperando a rede ficar quieta (o que cobre a compilacao sob demanda do
 * bundle cliente) antes do primeiro teste de verdade tocar em /entrar.
 *
 * Mesma familia de achado, revisao da etapa 8: a suite completa falhou duas
 * vezes nos dois primeiros testes (login caindo em /hoje em vez de /comecar;
 * admin preso em /entrar) e passou quando um spec rodou sozinho, com o
 * servidor ja quente. Por isso as outras rotas do fluxo tambem sao
 * aquecidas aqui, nao so /entrar.
 */
import { chromium } from "@playwright/test";

const porta = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${porta}`;

const ROTAS = ["/entrar", "/comecar", "/hoje", "/admin/clientes", "/conta"];

export default async function globalSetup() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const rota of ROTAS) {
      await page.goto(`${baseURL}${rota}`);
      await page.waitForLoadState("networkidle");
    }
  } finally {
    await browser.close();
  }
}
