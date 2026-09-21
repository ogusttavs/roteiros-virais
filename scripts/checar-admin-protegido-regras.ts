/**
 * Confere que toda `page.tsx` de `src/app/admin/` chama `exigirAdmin()` antes
 * de qualquer outro `await` (achado de seguranca, 20/09/2026: o layout
 * sozinho nao bastava, o App Router roda layout e pagina em paralelo). Sem
 * I/O de escrita nem process.exit aqui, para dar para testar; o ponto de
 * entrada de linha de comando fica em checar-admin-protegido.ts.
 */
import { globSync, readFileSync } from "node:fs";

export const PADRAO = "src/app/admin/**/page.tsx";

export type Problema = { arquivo: string; linha: number; motivo: string };

function ehChamadaExigirAdmin(linha: string): boolean {
  return linha.includes("exigirAdmin(");
}

/** `await params` (e `await searchParams`) nao consultam nada, so leem o proprio pedido. */
function ehAwaitDeParams(linha: string): boolean {
  return /\bawait\s+(search)?[Pp]arams\b/.test(linha);
}

export function verificarConteudo(caminho: string, conteudo: string): Problema[] {
  const linhas = conteudo.split("\n");

  let encontrouExigirAdmin = false;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (ehChamadaExigirAdmin(linha)) {
      encontrouExigirAdmin = true;
      continue;
    }
    if (encontrouExigirAdmin) continue;
    if (/\bawait\s+/.test(linha) && !ehAwaitDeParams(linha)) {
      return [
        {
          arquivo: caminho,
          linha: i + 1,
          motivo: "await antes de exigirAdmin(); toda page.tsx do admin confere a sessao antes de qualquer consulta",
        },
      ];
    }
  }

  if (!encontrouExigirAdmin) {
    return [{ arquivo: caminho, linha: 1, motivo: "nao chama exigirAdmin() em lugar nenhum" }];
  }
  return [];
}

export function verificarArquivo(caminho: string): Problema[] {
  return verificarConteudo(caminho, readFileSync(caminho, "utf8"));
}

export function listarArquivos(padrao: string = PADRAO): string[] {
  return globSync(padrao).sort();
}
