/**
 * Funções puras sobre perfil nas redes (handle, URL de perfil), sem banco
 * nem nenhuma outra dependência de servidor: moram aqui, não em
 * `servicos/curva.ts` ou `servicos/nichos.ts` (onde viviam antes), para dar
 * para importar também de componente de cliente (V12c, item 3b, a E37b,
 * `CampoPerfilRede.tsx`). Os dois serviços reexportam daqui, para nenhum
 * import existente quebrar.
 */
import type { Plataforma } from "@/db/schema";

/**
 * A coleta grava `contas.handle` sem "@" no TikTok e no Instagram, e com
 * "@" no YouTube (`analisarUrlPerfil`, abaixo); o cliente digita o perfil
 * dele no briefing do jeito que quiser. Sem normalizar os dois lados da
 * mesma forma, a comparação nunca batia (rodada de acabamento de 06/09,
 * item 4).
 */
export function normalizarHandle(handle: string, plataforma: Plataforma): string {
  const limpo = handle.replace(/\s+/g, "").replace(/^@+/, "");
  return plataforma === "youtube" ? `@${limpo}` : limpo;
}

/**
 * Só a forma da URL (sem consultar a plataforma na hora de salvar, decisão
 * 2 do `PROXIMO.md`). O handle devolvido bate com o formato que a coleta de
 * verdade grava em `contas.handle` para cada plataforma (upsertConta,
 * normalizadores/*), para uma conta semente e a mesma conta descoberta pela
 * coleta nunca virarem duas linhas: YouTube guarda com "@" (ou o id do
 * canal em /channel/), TikTok e Instagram guardam sem "@".
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
 * V12c, item 3b, a E37b: limpa o que a pessoa colou no campo de um perfil
 * (começo do endereço fixo, ela digita só o nome): endereço inteiro, com
 * arroba ou sem, espaço e barra no fim. Nunca pede link; se vier um link de
 * outra plataforma (colou o do Instagram no campo do TikTok, por exemplo),
 * trata como texto solto, não como link.
 */
export function limparCampoPerfil(valor: string, plataforma: Plataforma): string {
  const aparado = valor.trim();
  if (!aparado) return "";
  const comoUrl = analisarUrlPerfil(aparado);
  if (comoUrl && comoUrl.plataforma === plataforma) {
    return normalizarHandle(comoUrl.handle, plataforma);
  }
  return normalizarHandle(aparado.replace(/\/+$/, ""), plataforma);
}

/**
 * Para o aviso "Confira o nome do perfil" (sem travar o passo, o bloco é
 * opcional): caractere que a plataforma não aceita. Regra simples e
 * generosa (letras, números, ponto, underscore e hífen), o mesmo conjunto
 * que as três redes aceitam em handle.
 */
export function perfilPareceValido(handleLimpo: string): boolean {
  if (!handleLimpo) return true;
  const semArroba = handleLimpo.replace(/^@/, "");
  return /^[a-zA-Z0-9._-]+$/.test(semArroba);
}
